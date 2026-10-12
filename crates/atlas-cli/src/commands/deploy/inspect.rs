//! Read-only host queries: `atlas deploy status | logs | history`.

use anyhow::{Result, bail};
use atlas_tui::config::DeployKind;
use serde_json::{Value, json};

use super::ctx::{Ctx, die, valid_run_id};
use super::remote::shq;

const TERMINAL: [&str; 4] = ["healthy", "noop", "rolled_back", "failed"];

/// What the host reported in one `status` probe.
struct HostStatus {
    current: Option<String>,
    lock: Option<String>,
    state: Value,
    releases: Vec<Value>,
    services: Vec<Value>,
}

impl HostStatus {
    /// Parse the tagged lines printed by the probe script.
    fn parse(stdout: &str) -> Self {
        let mut s = Self {
            current: None,
            lock: None,
            state: Value::Null,
            releases: vec![],
            services: vec![],
        };
        for line in stdout.lines() {
            let (tag, rest) = line.split_once(' ').unwrap_or((line, ""));
            let f: Vec<&str> = rest.split(' ').collect();
            match tag {
                "CURRENT" => s.current = Some(rest.to_string()),
                "REL" if f.len() == 3 => s
                    .releases
                    .push(json!({"id": f[0], "sha": f[1], "status": f[2]})),
                "LOCK" => s.lock = Some(rest.to_string()),
                "STATE" => s.state = serde_json::from_str(rest).unwrap_or(Value::Null),
                "SVC" if f.len() == 3 => s
                    .services
                    .push(json!({"name": f[0], "active": f[1] == "1", "healthy": f[2] == "1"})),
                _ => {}
            }
        }
        s
    }

    fn phase(&self) -> &str {
        self.state
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    /// No phase yet, or the last run reached a final one (otherwise it was interrupted).
    fn terminal(&self) -> bool {
        self.phase().is_empty() || TERMINAL.contains(&self.phase())
    }

    fn ok(&self) -> bool {
        self.current.is_some()
            && self.terminal()
            && self.services.iter().all(|s| s["healthy"] == true)
            && self.lock.is_none()
    }
}

/// The bash probe: current release, releases, lock holder, state and per-service health.
fn status_script(ctx: &Ctx) -> String {
    let mut svc = String::new();
    for s in &ctx.target.services {
        let kind = match s.kind {
            DeployKind::Systemd => "systemd",
            DeployKind::Compose => "compose",
            DeployKind::Command => "command",
        };
        svc.push_str(&format!(
            "svc {} {} {} {}\n",
            shq(&s.name),
            kind,
            shq(s.health.as_deref().unwrap_or("")),
            shq(s.compose_file.as_deref().unwrap_or("compose.yml")),
        ));
    }
    format!(
        r#"D={dir}; A={app}
cd "$D" 2>/dev/null || {{ echo "NODIR"; exit 0; }}
[ -L current ] && echo "CURRENT $(basename "$(readlink current)")"
for r in $(ls -1 releases 2>/dev/null | sort -r); do
  m=releases/$r/.atlas-release
  sha=$(sed -n 's/.*"sha":"\([^"]*\)".*/\1/p' "$m" 2>/dev/null); st=$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' "$m" 2>/dev/null)
  echo "REL $r ${{sha:--}} ${{st:-unknown}}"
done
if [ -e .atlas/lock ] && command -v flock >/dev/null && ! flock -n .atlas/lock true; then echo "LOCK $(cat .atlas/lock.owner 2>/dev/null)"; fi
[ -f .atlas/state.json ] && echo "STATE $(cat .atlas/state.json)"
svc() {{
  n=$1 k=$2 h=$3 c=$4 a=0 ok=0
  case $k in
    systemd) systemctl is-active --quiet "$n" && a=1 ;;
    compose) [ -n "$(docker compose -p "$A" -f "$D/current/$c" ps -q --status running "$n" 2>/dev/null)" ] && a=1 ;;
    command) a=1 ;;
  esac
  if [ -n "$h" ]; then curl -fsS -o /dev/null --max-time 5 "$h" 2>/dev/null && ok=1; else ok=$a; fi
  echo "SVC $n $a $ok"
}}
{svc}"#,
        dir = shq(&ctx.dir),
        app = shq(&ctx.app),
    )
}

pub(super) async fn status(ctx: &Ctx, json_out: bool) -> Result<()> {
    let out = ctx.remote.exec(&status_script(ctx)).await?;
    if out.code == 255 {
        die(
            4,
            &format!("cannot reach {}: {}", ctx.target.host, out.stderr.trim()),
        );
    }
    let st = HostStatus::parse(&out.stdout);
    let ok = st.ok();
    if json_out {
        let o = json!({"ok": ok, "current": st.current, "releases": st.releases, "lock": st.lock,
            "phase": st.phase(), "services": st.services});
        println!("{}", serde_json::to_string_pretty(&o)?);
    } else {
        print_status(ctx, &st);
    }
    std::process::exit(if ok { 0 } else { 1 });
}

fn print_status(ctx: &Ctx, st: &HostStatus) {
    let phase = st.phase();
    println!("target   {} ({}:{})", ctx.name, ctx.target.host, ctx.dir);
    println!("current  {}", st.current.as_deref().unwrap_or("-"));
    let mut p = format!("phase    {}", if phase.is_empty() { "-" } else { phase });
    if let Some(r) = st
        .state
        .get("reason")
        .and_then(Value::as_str)
        .filter(|r| !r.is_empty())
    {
        p.push_str(&format!(" ({r})"));
    }
    if !st.terminal() && st.lock.is_none() {
        p.push_str("  \x1b[1;31mINTERRUPTED\x1b[0m — next deploy will recover");
    }
    println!("{p}");
    println!("lock     {}", st.lock.as_deref().unwrap_or("free"));
    println!("releases");
    for r in &st.releases {
        let mark = if Some(r["id"].as_str().unwrap_or("")) == st.current.as_deref() {
            "*"
        } else {
            " "
        };
        println!(
            "  {mark} {}  {:.7}  {}",
            r["id"].as_str().unwrap_or(""),
            r["sha"].as_str().unwrap_or(""),
            r["status"].as_str().unwrap_or("")
        );
    }
    println!("services");
    for s in &st.services {
        let icon = if s["healthy"] == true {
            "\x1b[32m✓\x1b[0m"
        } else {
            "\x1b[31m✗\x1b[0m"
        };
        println!(
            "  {icon} {} (active: {})",
            s["name"].as_str().unwrap_or(""),
            s["active"]
        );
    }
}

pub(super) async fn logs(ctx: &Ctx, release: Option<&str>, follow: bool) -> Result<()> {
    let pick = match release {
        Some(r) if valid_run_id(r) => shq(r),
        Some(r) => bail!("invalid release id: {r}"),
        None => "\"$(ls -1t \"$R\" 2>/dev/null | head -n1)\"".into(),
    };
    let cmd = if follow { "tail -n +1 -F" } else { "cat" };
    let script = format!("R={}/run; {cmd} \"$R\"/{pick}/log", shq(&ctx.atlas()));
    let code = ctx.remote.stream(&script).await?;
    std::process::exit(code);
}

pub(super) async fn history(ctx: &Ctx, n: usize, json_out: bool) -> Result<()> {
    let out = ctx
        .remote
        .exec(&format!(
            "tail -n {n} {}/deploys.jsonl 2>/dev/null; true",
            shq(&ctx.atlas())
        ))
        .await?;
    if json_out {
        print!("{}", out.stdout);
        return Ok(());
    }
    println!(
        "{:<20}  {:<24}  {:<8}  {:<11}  {:>5}  REASON",
        "FINISHED", "RELEASE", "MODE", "RESULT", "SECS"
    );
    for line in out.stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let g = |k: &str| {
            v.get(k)
                .map(|x| {
                    x.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| x.to_string())
                })
                .unwrap_or_default()
        };
        println!(
            "{:<20}  {:<24}  {:<8}  {:<11}  {:>5}  {}",
            g("finished"),
            g("release"),
            g("mode"),
            g("result"),
            g("duration_s"),
            g("reason")
        );
    }
    Ok(())
}
