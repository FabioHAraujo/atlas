//! Bridge to `atlas hostd` instances: the local one plus one per SSH host
//! (`ssh:<alias>`, see `remote.rs`). Pushes from every host are re-emitted as
//! Tauri events; pty ids are UUIDs, so they never collide across hosts.
//!
//! Routing (`HostHub::call`): an explicit `host` arg wins; else a `pty` arg goes
//! to the host that created it; else a path arg (`cwd`/`path`/`from`) goes to the
//! host of the registry entry whose root contains it; else `local`.
//!
//! Events: `pty://<id>` `{data, replay}` (base64), `host://event` for
//! `pty_title`/`pty_exit`/`fs_event`, `host://reconnected {host}` after a reconnect
//! (the frontend re-attaches its terminals).
//!
//! The local daemon outlives app updates, so on every (re)connect of it `reconcile` compares
//! it with this app (`atlas_host::upgrade::decide`) and acts: live `upgrade`, silent restart
//! of an empty host, or - when terminals run and features are missing - ask the user. The
//! result is a [`HostState`], kept in the hub and pushed as `host://status` (camelCase);
//! `host://prompt {ptys, reason}` asks once per daemon pid, `host://toast {kind, text}` reports
//! a finished upgrade. Commands: `host_status`, `host_restart`, `host_postpone`,
//! `host_restart_when_idle`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use atlas_host::HostClient;
use atlas_host::upgrade::{
    Choice, Decision, caps_of, decide, live_ptys, missing_caps, skew_reason,
};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

pub const LOCAL: &str = "local";

/// How often an armed "restart when idle" looks at the terminals (pty exits also wake it).
const IDLE_POLL: Duration = Duration::from_secs(5);

/// A running terminal, as listed in the restart prompt.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HostPty {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub argv: Vec<String>,
}

/// What the webview shows about the local terminal host (`host://status`, camelCase).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostState {
    /// `current | upgrading | upgraded | outdated | restarting`.
    pub status: &'static str,
    pub version: Option<String>,
    pub proto: Option<u64>,
    pub caps: Vec<String>,
    pub app_version: String,
    /// `none | upgradable | needsRestart`.
    pub skew: &'static str,
    /// Running terminals only.
    pub ptys: Vec<HostPty>,
    /// The sentence from `skew_reason`; empty when current.
    pub reason: String,
    /// The user chose "Later" this session.
    pub deferred: bool,
    /// The user chose "Restart when idle"; the host restarts the moment no terminal runs.
    pub idle_armed: bool,
    pub missing: Vec<String>,
}

/// Everything `reconcile` and the commands share for the local daemon.
struct HostCtl {
    state: Option<HostState>,
    /// What the user said about a host that cannot be replaced without ending terminals.
    choice: Choice,
    /// Daemon pid the restart prompt was already raised for (once per daemon per session).
    prompted_pid: Option<u64>,
    /// A prompt was raised and no webview has taken it yet: the daemon is usually reconciled
    /// before the webview listens, so the event alone would be lost (`host_take_prompt`).
    prompt_pending: bool,
    /// `(pid, version)` a live upgrade / restart was already attempted on: an installed CLI
    /// older than the app would otherwise loop forever.
    attempted: Option<(u64, String)>,
}

impl Default for HostCtl {
    fn default() -> Self {
        Self {
            state: None,
            choice: Choice::Ask,
            prompted_pid: None,
            prompt_pending: false,
            attempted: None,
        }
    }
}

#[derive(Default)]
pub struct HostHub {
    clients: RwLock<HashMap<String, HostClient>>,
    pty_host: Mutex<HashMap<String, String>>,
    /// The reconciled state of the local daemon, kept so a webview that registers its
    /// listeners after startup still learns it (`host_status`).
    ctl: Mutex<HostCtl>,
    /// Woken by `set`, so a caller waiting for the local daemon continues the moment it connects.
    connected: tokio::sync::Notify,
    /// Woken when a pty exits, so an armed "restart when idle" reacts at once.
    ptys_changed: tokio::sync::Notify,
    /// Debug only: `ATLAS_DEBUG_FAKE_HOST` is on and restarts only clear the fake state.
    #[cfg(debug_assertions)]
    fake: Mutex<Option<Fake>>,
}

/// Host of the registry entry whose root contains `path` (longest match).
pub fn host_for_path(path: &str) -> String {
    crate::registry::load()
        .unwrap_or_default()
        .into_iter()
        .filter(|e| path == e.root || path.starts_with(&format!("{}/", e.root)))
        .max_by_key(|e| e.root.len())
        .and_then(|e| e.host)
        .unwrap_or_else(|| LOCAL.into())
}

impl HostHub {
    /// Connected client for `host`; the local one is waited for (startup), remote
    /// ones are connected on demand.
    pub async fn client(&self, host: &str) -> Result<HostClient, String> {
        if host != LOCAL {
            if let Some(c) = self.clients.read().await.get(host).cloned() {
                return Ok(c);
            }
            return Err(format!("{host} is not connected (Settings → SSH)"));
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            // Register interest before checking, so a `set` in between is not missed.
            let woken = self.connected.notified();
            if let Some(c) = self.clients.read().await.get(LOCAL).cloned() {
                return Ok(c);
            }
            if tokio::time::timeout_at(deadline, woken).await.is_err() {
                return Err("atlas hostd is not reachable (see ~/.atlas/hostd.log)".into());
            }
        }
    }

    pub async fn set(&self, host: &str, c: Option<HostClient>) {
        let mut m = self.clients.write().await;
        match c {
            Some(c) => m.insert(host.to_string(), c),
            None => m.remove(host),
        };
        drop(m);
        self.connected.notify_waiters();
    }

    fn route(&self, args: &Value) -> String {
        if let Some(h) = args["host"].as_str() {
            return h.to_string();
        }
        if let Some(p) = args["pty"].as_str() {
            return self
                .pty_host
                .lock()
                .get(p)
                .cloned()
                .unwrap_or_else(|| LOCAL.into());
        }
        ["cwd", "path", "from"]
            .iter()
            .find_map(|k| args[*k].as_str())
            .map(host_for_path)
            .unwrap_or_else(|| LOCAL.into())
    }

    /// Run a hostd command on the routed host. Local `exec` gets the user's
    /// login-shell env (PATH for git/gh/atlas); remote hosts use their own.
    pub async fn call(&self, cmd: &str, mut args: Value) -> Result<Value, String> {
        let host = self.route(&args);
        if let Some(o) = args.as_object_mut() {
            o.remove("host");
        }
        if cmd == "exec" && host == LOCAL {
            let mut env = crate::shell_env::vars_json_async().await;
            if let Some(own) = args["env"].as_object() {
                env.extend(own.clone());
            }
            args["env"] = Value::Object(env);
        }
        let res = self
            .client(&host)
            .await?
            .call(cmd, args)
            .await
            .map_err(|e| format!("{e:#}"))?;
        if cmd == "pty_create"
            && let Some(p) = res["pty"].as_str()
        {
            self.pty_host.lock().insert(p.to_string(), host);
        }
        Ok(res)
    }

    /// Learn which host owns each existing pty (after (re)connecting).
    pub async fn index_ptys(&self, host: &str) {
        let Ok(c) = self.client(host).await else {
            return;
        };
        if let Ok(v) = c.call("pty_list", json!({})).await {
            let mut m = self.pty_host.lock();
            for p in v["ptys"].as_array().into_iter().flatten() {
                if let Some(id) = p["pty"].as_str() {
                    m.insert(id.to_string(), host.to_string());
                }
            }
        }
    }
}

/// Filesystem helpers over hostd, so local and SSH checkouts share one code path.
impl HostHub {
    pub async fn exists(&self, host: &str, path: &str) -> bool {
        self.call("fs_stat", json!({"host": host, "path": path}))
            .await
            .is_ok()
    }

    pub async fn mkdir(&self, host: &str, path: &str) -> Result<(), String> {
        self.call("fs_mkdir", json!({"host": host, "path": path}))
            .await
            .map(|_| ())
    }

    /// File contents, `None` when missing.
    pub async fn read_text(&self, host: &str, path: &str) -> Option<String> {
        use base64::Engine;
        let r = self
            .call("fs_read", json!({"host": host, "path": path}))
            .await
            .ok()?;
        let b = base64::engine::general_purpose::STANDARD
            .decode(r["data"].as_str()?)
            .ok()?;
        String::from_utf8(b).ok()
    }

    /// `$HOME` of the host's hostd user.
    pub async fn home(&self, host: &str) -> Result<String, String> {
        if host == LOCAL {
            return Ok(dirs::home_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned());
        }
        let r = self
            .call(
                "exec",
                json!({"host": host, "cwd": "/", "argv": ["sh", "-c", "printf %s \"$HOME\""]}),
            )
            .await?;
        use base64::Engine;
        let b = base64::engine::general_purpose::STANDARD
            .decode(r["stdout"].as_str().unwrap_or(""))
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&b).into_owned())
    }

    /// atlas.yaml (+ atlas.local.yaml) of a checkout on any host, ports shifted
    /// by `offset`. Remote files are copied to a temp dir and parsed locally.
    pub async fn load_config(
        &self,
        host: &str,
        root: &str,
        offset: u16,
    ) -> Result<atlas_tui::config::ProjectConfig, String> {
        use atlas_tui::config;
        let mut cfg = if host == LOCAL {
            config::load(std::path::Path::new(root)).map_err(|e| format!("{e:#}"))?
        } else {
            let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
            for f in ["atlas.yaml", "atlas.local.yaml"] {
                if let Some(t) = self.read_text(host, &format!("{root}/{f}")).await {
                    std::fs::write(tmp.path().join(f), t).map_err(|e| e.to_string())?;
                }
            }
            config::load(tmp.path()).map_err(|e| format!("{e:#}"))?
        };
        if offset > 0 {
            config::apply_port_offset(&mut cfg, offset);
        }
        Ok(cfg)
    }
}

fn forward(app: &AppHandle, ev: &Value) {
    match ev["ev"].as_str() {
        Some(k @ ("pty_output" | "pty_replay")) => {
            let pty = ev["pty"].as_str().unwrap_or_default();
            let _ = app.emit(
                &format!("pty://{pty}"),
                json!({"data": ev["data"], "replay": k == "pty_replay"}),
            );
        }
        Some("disconnected") | None => {}
        Some(_) => {
            let _ = app.emit("host://event", ev);
        }
    }
}

/// Register a connected client and pump its events until it disconnects.
pub async fn serve_client(app: &AppHandle, host: &str, c: HostClient) {
    let hub = app.state::<Arc<HostHub>>().inner().clone();
    let mut rx = c.events();
    hub.set(host, Some(c)).await;
    hub.index_ptys(host).await;
    let _ = app.emit("host://reconnected", json!({"host": host}));
    while let Ok(ev) = rx.recv().await {
        if ev["ev"] == "disconnected" {
            break;
        }
        if host == LOCAL && ev["ev"] == "pty_exit" {
            hub.drop_pty(app, ev["pty"].as_str().unwrap_or_default());
        }
        forward(app, &ev);
    }
    hub.set(host, None).await;
}

impl HostHub {
    /// A local terminal exited: it no longer counts in the restart prompt, and an armed
    /// "restart when idle" looks again.
    fn drop_pty(&self, app: &AppHandle, pty: &str) {
        let state = {
            let mut g = self.ctl.lock();
            let Some(s) = g.state.as_mut() else { return };
            let before = s.ptys.len();
            s.ptys.retain(|p| p.id != pty);
            (s.ptys.len() != before).then(|| s.clone())
        };
        if let Some(s) = state {
            let _ = app.emit("host://status", s);
        }
        self.ptys_changed.notify_one();
    }
}

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Running terminals out of a `pty_list` reply (exited ones are not at stake in a restart).
fn live_list(list: &Value) -> Vec<HostPty> {
    list["ptys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["exited"].is_null())
        .filter_map(|p| {
            Some(HostPty {
                id: p["pty"].as_str()?.to_string(),
                title: p["title"].as_str().unwrap_or_default().to_string(),
                cwd: p["cwd"].as_str().unwrap_or_default().to_string(),
                argv: p["argv"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|a| a.as_str().map(str::to_string))
                    .collect(),
            })
        })
        .collect()
}

/// `info` with the `upgrade` capability removed: what `decide` must see after a handoff failed
/// (or for a daemon an upgrade was already tried on).
fn without_upgrade(info: &Value) -> Value {
    let mut i = info.clone();
    let caps: Vec<&str> = caps_of(info)
        .into_iter()
        .filter(|c| *c != "upgrade")
        .collect();
    i["caps"] = json!(caps);
    i
}

/// The state to show for `info` after `decision`. Only the skew that matters is `needsRestart`
/// (the daemon cannot be brought current without ending terminals); `Passive` keeps the
/// status `current` so nothing nags, but still carries the reason for the calm chip.
fn state_for(info: &Value, ptys: Vec<HostPty>, decision: Decision, choice: Choice) -> HostState {
    let (status, skew) = match decision {
        Decision::Current => ("current", "none"),
        Decision::Upgrade => ("upgrading", "upgradable"),
        Decision::RestartNow => ("restarting", "needsRestart"),
        Decision::Passive => ("current", "needsRestart"),
        Decision::Prompt | Decision::WaitIdle | Decision::Deferred => ("outdated", "needsRestart"),
    };
    HostState {
        status,
        version: info["version"].as_str().map(str::to_string),
        proto: info
            .is_object()
            .then(|| info["proto"].as_u64().unwrap_or(1)),
        caps: caps_of(info).into_iter().map(str::to_string).collect(),
        app_version: APP_VERSION.to_string(),
        skew,
        ptys,
        reason: skew_reason(info, APP_VERSION, &format!("Atlas {APP_VERSION}")).unwrap_or_default(),
        deferred: choice == Choice::Later && decision == Decision::Deferred,
        idle_armed: decision == Decision::WaitIdle,
        missing: missing_caps(info).into_iter().map(str::to_string).collect(),
    }
}

/// The decision for a daemon, with the loop guard applied: a live upgrade or restart is tried
/// at most once per `(pid, version)`. When that same daemon is still there afterwards (the
/// installed CLI is itself older than the app) it is only reported, never retried.
fn plan(info: &Value, live: usize, choice: Choice, attempted: Option<&(u64, String)>) -> Decision {
    let pid = info["pid"].as_u64().unwrap_or(0);
    let version = info["version"].as_str().unwrap_or("");
    let seen = attempted.is_some_and(|(p, v)| *p == pid && v == version);
    if !seen {
        return decide(info, live, APP_VERSION, choice);
    }
    match decide(&without_upgrade(info), live, APP_VERSION, choice) {
        Decision::RestartNow => Decision::Passive,
        d => d,
    }
}

/// The restart prompt is shown at most once per daemon pid per session, and only for
/// `Decision::Prompt` (never after "Later", never when "when idle" is armed).
fn should_prompt(decision: Decision, prompted: Option<u64>, pid: u64) -> bool {
    decision == Decision::Prompt && prompted != Some(pid)
}

impl HostHub {
    fn publish(&self, app: &AppHandle, state: HostState) {
        self.ctl.lock().state = Some(state.clone());
        let _ = app.emit("host://status", state);
    }
}

/// What the connect loop does after `reconcile`.
enum Outcome {
    /// Keep this connection.
    Serve,
    /// The daemon was replaced or is going away: drop the connection and connect again.
    Reconnect,
}

/// Compare the daemon we connected to with this app and act (see the module docs). Runs on
/// every (re)connect of the local daemon.
async fn reconcile(app: &AppHandle, hub: &HostHub, c: &HostClient, bin: &Path) -> Outcome {
    let Some((info, list)) = probe(hub, c).await else {
        return Outcome::Serve;
    };
    let ptys = live_list(&list);
    let pid = info["pid"].as_u64().unwrap_or(0);
    let version = info["version"].as_str().unwrap_or("").to_string();
    let (choice, attempted) = {
        let g = hub.ctl.lock();
        (g.choice, g.attempted.clone())
    };
    let mut decision = plan(&info, ptys.len(), choice, attempted.as_ref());

    if decision == Decision::Upgrade {
        hub.ctl.lock().attempted = Some((pid, version.clone()));
        hub.publish(app, state_for(&info, ptys.clone(), decision, choice));
        match c
            .call("upgrade", json!({"exe": bin.to_string_lossy()}))
            .await
        {
            Ok(_) => return Outcome::Reconnect,
            Err(e) => {
                let _ = app.emit(
                    "host://error",
                    format!("terminal host upgrade failed: {e:#}"),
                );
                // The old host keeps running: decide again as for one that cannot hand over.
                decision = plan(&info, ptys.len(), choice, hub.ctl.lock().attempted.as_ref());
            }
        }
    }

    if decision == Decision::RestartNow {
        hub.ctl.lock().attempted = Some((pid, version));
        hub.publish(app, state_for(&info, ptys, decision, choice));
        #[cfg(debug_assertions)]
        if hub.fake.lock().is_some() {
            return Outcome::Serve;
        }
        let _ = c.call("shutdown", json!({})).await;
        return Outcome::Reconnect;
    }

    let prompt = {
        let mut g = hub.ctl.lock();
        let p = should_prompt(decision, g.prompted_pid, pid);
        if p {
            g.prompted_pid = Some(pid);
            g.prompt_pending = true;
        }
        p
    };
    let state = state_for(&info, ptys, decision, choice);
    let ask = json!({"ptys": state.ptys, "reason": state.reason});
    // Status first: the webview opens the dialog from its own state when the prompt arrives.
    hub.publish(app, state);
    if prompt {
        let _ = app.emit("host://prompt", ask);
    }
    Outcome::Serve
}

/// `info` + `pty_list` of the local daemon (the debug fake replaces both).
async fn probe(hub: &HostHub, c: &HostClient) -> Option<(Value, Value)> {
    #[cfg(debug_assertions)]
    if let Some(f) = hub.fake.lock().as_ref() {
        return Some((f.info(), f.list()));
    }
    #[cfg(not(debug_assertions))]
    let _ = hub;
    let info = c.call("info", json!({})).await.ok()?;
    // Always listed: the prompt names the terminals, and a proto 1 daemon has no `live_ptys`.
    let list = c.call("pty_list", json!({})).await.unwrap_or(json!({}));
    Some((info, list))
}

/// After a reconnect that followed an `upgrade`: the new daemon is this app's version.
fn verify_upgrade(app: &AppHandle, hub: &HostHub) {
    let g = hub.ctl.lock();
    let done = g.attempted.is_some()
        && g.state
            .as_ref()
            .is_some_and(|s| s.status == "current" && s.version.as_deref() == Some(APP_VERSION));
    drop(g);
    if done {
        hub.ctl.lock().attempted = None;
        let _ = app.emit(
            "host://toast",
            json!({"kind": "success", "text": "Terminal host updated"}),
        );
    }
}

/// Running terminals of the local daemon now (`None` when it cannot be asked).
async fn live_now(hub: &HostHub) -> Option<usize> {
    #[cfg(debug_assertions)]
    if let Some(f) = hub.fake.lock().as_ref() {
        return Some(f.ptys.len());
    }
    let c = hub.clients.read().await.get(LOCAL).cloned()?;
    let info = c.call("info", json!({})).await.ok()?;
    let from_list = if info["live_ptys"].is_null() {
        live_list(&c.call("pty_list", json!({})).await.ok()?).len()
    } else {
        0
    };
    Some(live_ptys(&info, from_list))
}

/// Ask the local daemon to exit (its terminals end); `start`'s loop reconnects to a fresh one
/// from the installed CLI. With the debug fake only the fake state is cleared.
async fn restart_local(app: &AppHandle, hub: &HostHub) {
    {
        let mut g = hub.ctl.lock();
        g.attempted = None;
        g.choice = Choice::Ask;
        g.prompt_pending = false;
    }
    #[cfg(debug_assertions)]
    if hub.fake.lock().take().is_some() {
        hub.publish(app, HostState::fake_current());
        let _ = app.emit("host://reconnected", json!({"host": LOCAL}));
        return;
    }
    let mut s = hub.ctl.lock().state.clone();
    if let Some(s) = s.as_mut() {
        s.status = "restarting";
        s.idle_armed = false;
    }
    if let Some(s) = s {
        hub.publish(app, s);
    }
    if let Some(c) = hub.clients.read().await.get(LOCAL).cloned() {
        let _ = c.call("shutdown", json!({})).await;
    }
}

/// Armed "restart when idle": restart the moment no terminal runs. Polls every [`IDLE_POLL`]
/// and on every pty exit. Runs for the whole session.
fn spawn_idle_watch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let hub = app.state::<Arc<HostHub>>().inner().clone();
        loop {
            let woken = hub.ptys_changed.notified();
            let _ = tokio::time::timeout(IDLE_POLL, woken).await;
            let armed = hub.ctl.lock().state.as_ref().is_some_and(|s| s.idle_armed);
            if armed && live_now(&hub).await == Some(0) {
                restart_local(&app, &hub).await;
            }
        }
    });
}

/// App is quitting: an armed "restart when idle" with no terminal left ends the old host now,
/// so the next launch starts a current one. Terminals are never ended here.
pub fn on_exit(app: &AppHandle) {
    let hub = app.state::<Arc<HostHub>>().inner().clone();
    if !hub.ctl.lock().state.as_ref().is_some_and(|s| s.idle_armed) {
        return;
    }
    #[cfg(debug_assertions)]
    if hub.fake.lock().is_some() {
        return;
    }
    tauri::async_runtime::block_on(async {
        if live_now(&hub).await == Some(0)
            && let Some(c) = hub.clients.read().await.get(LOCAL).cloned()
        {
            let _ =
                tokio::time::timeout(Duration::from_secs(2), c.call("shutdown", json!({}))).await;
        }
    });
}

/// Connect to the local hostd (starting it if needed) and keep it alive.
pub fn start(app: &AppHandle) {
    #[cfg(debug_assertions)]
    {
        let hub = app.state::<Arc<HostHub>>();
        *hub.fake.lock() = Fake::from_env();
    }
    spawn_idle_watch(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let hub = app.state::<Arc<HostHub>>().inner().clone();
        let mut backoff = Duration::from_secs(1);
        loop {
            let bin = match atlas_host::client::atlas_bin() {
                Ok(b) => b,
                Err(e) => {
                    let _ = app.emit("host://error", e.to_string());
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };
            match atlas_host::client::ensure_local(&bin, "desktop").await {
                Ok(c) => {
                    backoff = Duration::from_secs(1);
                    // Every (re)connect is reconciled; the loop guard in `plan` keeps an
                    // installed CLI older than the app from looping.
                    if let Outcome::Reconnect = reconcile(&app, &hub, &c, &bin).await {
                        // Replaced: drop this connection and connect to the new daemon
                        // (`serve_client` then emits `host://reconnected`).
                        drop(c);
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        continue;
                    }
                    verify_upgrade(&app, &hub);
                    serve_client(&app, LOCAL, c).await;
                }
                Err(e) => {
                    let _ = app.emit("host://error", format!("{e:#}"));
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(10));
                }
            }
        }
    });
}

/// Debug only (`ATLAS_DEBUG_FAKE_HOST=proto1`, `ATLAS_DEBUG_FAKE_PTYS=<n>`): pretend the local
/// daemon is a 0.6.2 proto-1 host running `n` terminals, to exercise the prompt without
/// touching any real daemon. Restarting only clears this fake.
#[cfg(debug_assertions)]
struct Fake {
    ptys: Vec<HostPty>,
}

#[cfg(debug_assertions)]
impl Fake {
    fn from_env() -> Option<Self> {
        if std::env::var("ATLAS_DEBUG_FAKE_HOST").ok()?.is_empty() {
            return None;
        }
        let n: usize = std::env::var("ATLAS_DEBUG_FAKE_PTYS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        const SAMPLES: [(&str, &str, &str); 4] = [
            ("zsh", "/Users/me/Projetos/atlas", "zsh"),
            (
                "bun run dev",
                "/Users/me/Projetos/analisa-ai/apps/web",
                "bun",
            ),
            (
                "claude",
                "/Users/me/Projetos/atlas/.worktrees/amber-fox",
                "claude",
            ),
            ("cargo watch -x test", "/Users/me/Projetos/atlas", "cargo"),
        ];
        let ptys = (0..n)
            .map(|i| {
                let (title, cwd, argv0) = SAMPLES[i % SAMPLES.len()];
                HostPty {
                    id: format!("fake-{i}"),
                    title: title.into(),
                    cwd: cwd.into(),
                    argv: vec![argv0.into()],
                }
            })
            .collect();
        Some(Self { ptys })
    }

    fn info(&self) -> Value {
        json!({"version": "0.6.2"})
    }

    fn list(&self) -> Value {
        let ptys: Vec<Value> = self
            .ptys
            .iter()
            .map(|p| json!({"pty": p.id, "title": p.title, "cwd": p.cwd, "argv": p.argv, "exited": null}))
            .collect();
        json!({"ptys": ptys})
    }
}

#[cfg(debug_assertions)]
impl HostState {
    /// The state after the fake host was "restarted": a current daemon, same path as a real one.
    fn fake_current() -> Self {
        let info = json!({"version": APP_VERSION, "proto": atlas_host::protocol::PROTO,
                          "caps": atlas_host::protocol::CAPS});
        state_for(&info, vec![], Decision::Current, Choice::Ask)
    }
}

/// `pty_list` of every connected host, merged (`host` added to each item).
#[tauri::command]
pub async fn host_pty_list(hub: tauri::State<'_, Arc<HostHub>>) -> Result<Vec<Value>, String> {
    let hosts: Vec<(String, HostClient)> = hub
        .clients
        .read()
        .await
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut out = Vec::new();
    for (h, c) in hosts {
        if let Ok(v) = c.call("pty_list", json!({})).await {
            for mut p in v["ptys"].as_array().cloned().unwrap_or_default() {
                if let Some(id) = p["pty"].as_str() {
                    hub.pty_host.lock().insert(id.to_string(), h.clone());
                }
                p["host"] = json!(h);
                out.push(p);
            }
        }
    }
    Ok(out)
}

/// The reconciled state of the local terminal host, `null` before the first reconcile.
#[tauri::command]
pub fn host_status(hub: tauri::State<'_, Arc<HostHub>>) -> Option<HostState> {
    hub.ctl.lock().state.clone()
}

/// The webview is ready to ask: `true` once per raised prompt (the daemon was reconciled before
/// it listened, or the event arrived while it was reloading). Cleared on read.
#[tauri::command]
pub fn host_take_prompt(hub: tauri::State<'_, Arc<HostHub>>) -> bool {
    std::mem::take(&mut hub.ctl.lock().prompt_pending)
}

/// "Restart now": the user agreed to end the terminals. The host exits; `start`'s loop
/// reconnects to a fresh one from the installed CLI (`restarting` then `current`).
#[tauri::command]
pub async fn host_restart(
    app: AppHandle,
    hub: tauri::State<'_, Arc<HostHub>>,
) -> Result<(), String> {
    restart_local(&app, &hub).await;
    Ok(())
}

/// "Later": no prompt for the rest of this session (a new launch asks again); the chip stays.
#[tauri::command]
pub fn host_postpone(app: AppHandle, hub: tauri::State<'_, Arc<HostHub>>) {
    choose(&app, &hub, Choice::Later);
}

/// "Restart when idle": the host restarts the moment no terminal runs (or when the app
/// quits with none running).
#[tauri::command]
pub fn host_restart_when_idle(app: AppHandle, hub: tauri::State<'_, Arc<HostHub>>) {
    choose(&app, &hub, Choice::WhenIdle);
    hub.ptys_changed.notify_one();
}

/// Remember the user's choice and reflect it in the state at once.
fn choose(app: &AppHandle, hub: &HostHub, choice: Choice) {
    let state = {
        let mut g = hub.ctl.lock();
        g.choice = choice;
        g.prompt_pending = false;
        let Some(s) = g.state.as_mut() else { return };
        // Only a host that is waiting on the user changes; a current one ignores the choice.
        if s.status == "outdated" {
            s.deferred = choice == Choice::Later;
            s.idle_armed = choice == Choice::WhenIdle;
        }
        s.clone()
    };
    let _ = app.emit("host://status", state);
}

/// Generic passthrough to hostd (`pty_*`, `exec`, `fs_*`, `info`), routed by host.
#[tauri::command]
pub async fn host_call(
    hub: tauri::State<'_, Arc<HostHub>>,
    cmd: String,
    args: Option<Value>,
) -> Result<Value, String> {
    if cmd == "shutdown" {
        return Err("shutdown is not allowed from the app".into());
    }
    hub.call(&cmd, args.unwrap_or_else(|| json!({}))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn old() -> Value {
        json!({"version": "0.6.2", "pid": 7})
    }

    fn pty(id: &str, exited: bool) -> Value {
        json!({"pty": id, "title": "zsh", "cwd": "/w", "argv": ["zsh", "-l"],
               "exited": if exited { json!({"code": 0}) } else { Value::Null }})
    }

    #[test]
    fn only_running_terminals_are_listed_with_their_shape() {
        let l = live_list(&json!({"ptys": [pty("a", false), pty("b", true), {"title": "no id"}]}));
        assert_eq!(
            l,
            vec![HostPty {
                id: "a".into(),
                title: "zsh".into(),
                cwd: "/w".into(),
                argv: vec!["zsh".into(), "-l".into()],
            }]
        );
        assert!(live_list(&json!({})).is_empty());
    }

    #[test]
    fn state_serializes_camel_case_per_the_contract() {
        let s = state_for(&old(), vec![], Decision::Prompt, Choice::Ask);
        let v = serde_json::to_value(&s).unwrap();
        for k in [
            "status",
            "version",
            "proto",
            "caps",
            "appVersion",
            "skew",
            "ptys",
            "reason",
            "deferred",
            "idleArmed",
            "missing",
        ] {
            assert!(v.get(k).is_some(), "missing {k}");
        }
        assert_eq!(
            (v["status"].as_str(), v["skew"].as_str()),
            (Some("outdated"), Some("needsRestart"))
        );
        assert_eq!(v["proto"], 1, "a daemon that reports no proto is proto 1");
        assert_eq!(v["missing"], json!(["pty_attach_raw", "lsp"]));
        assert!(
            v["reason"]
                .as_str()
                .unwrap()
                .starts_with("Terminal host 0.6.2 is older than Atlas")
        );
    }

    #[test]
    fn status_and_skew_per_decision() {
        let t = |d, c| {
            let s = state_for(&old(), vec![], d, c);
            (s.status, s.skew, s.deferred, s.idle_armed)
        };
        assert_eq!(
            t(Decision::Upgrade, Choice::Ask),
            ("upgrading", "upgradable", false, false)
        );
        assert_eq!(
            t(Decision::RestartNow, Choice::Ask),
            ("restarting", "needsRestart", false, false)
        );
        assert_eq!(
            t(Decision::Prompt, Choice::Ask),
            ("outdated", "needsRestart", false, false)
        );
        assert_eq!(
            t(Decision::WaitIdle, Choice::WhenIdle),
            ("outdated", "needsRestart", false, true)
        );
        assert_eq!(
            t(Decision::Deferred, Choice::Later),
            ("outdated", "needsRestart", true, false)
        );
        // Only the version differs: calm, no nag, but the skew is still visible.
        assert_eq!(
            t(Decision::Passive, Choice::Ask),
            ("current", "needsRestart", false, false)
        );
    }

    #[test]
    fn a_current_host_has_no_reason_and_nothing_missing() {
        let info = json!({"version": APP_VERSION, "pid": 1, "proto": 2,
                          "caps": ["pty_attach_raw", "upgrade", "lsp"]});
        let s = state_for(&info, vec![], Decision::Current, Choice::Ask);
        assert_eq!((s.status, s.skew), ("current", "none"));
        assert!(s.reason.is_empty() && s.missing.is_empty());
        assert_eq!(s.proto, Some(2));
    }

    #[test]
    fn the_prompt_is_shown_once_per_daemon_and_only_when_asking() {
        assert!(should_prompt(Decision::Prompt, None, 7));
        assert!(!should_prompt(Decision::Prompt, Some(7), 7));
        assert!(
            should_prompt(Decision::Prompt, Some(7), 8),
            "a new daemon asks again"
        );
        for d in [
            Decision::WaitIdle,
            Decision::Deferred,
            Decision::Passive,
            Decision::Current,
        ] {
            assert!(!should_prompt(d, None, 7));
        }
    }

    #[test]
    fn a_replacement_is_tried_once_per_pid_and_version() {
        let upgradeable = json!({"version": "0.6.2", "pid": 7,
                                 "caps": ["pty_attach_raw", "upgrade", "lsp"]});
        assert_eq!(plan(&upgradeable, 3, Choice::Ask, None), Decision::Upgrade);
        let tried = (7, "0.6.2".to_string());
        // Same daemon still there: the CLI cannot make it current, so it is only reported.
        assert_eq!(
            plan(&upgradeable, 3, Choice::Ask, Some(&tried)),
            Decision::Passive
        );
        // An empty host the restart did not replace must not be restarted in a loop either.
        assert_eq!(plan(&old(), 0, Choice::Ask, None), Decision::RestartNow);
        assert_eq!(
            plan(&old(), 0, Choice::Ask, Some(&tried)),
            Decision::Passive
        );
        // A different pid or version is a new daemon: reconciled again.
        assert_eq!(
            plan(&old(), 0, Choice::Ask, Some(&(8, "0.6.2".into()))),
            Decision::RestartNow
        );
    }

    #[test]
    fn a_failed_handoff_falls_back_to_the_user_path() {
        let info = json!({"version": "0.9.0", "pid": 7, "caps": ["pty_attach_raw", "upgrade"]});
        let stripped = without_upgrade(&info);
        assert_eq!(caps_of(&stripped), vec!["pty_attach_raw"]);
        assert_eq!(
            decide(&stripped, 2, APP_VERSION, Choice::Ask),
            Decision::Prompt
        );
    }

    #[test]
    fn choices_decide_what_a_blocked_host_does() {
        let d = |c| plan(&old(), 2, c, None);
        assert_eq!(d(Choice::Ask), Decision::Prompt);
        assert_eq!(d(Choice::WhenIdle), Decision::WaitIdle);
        assert_eq!(d(Choice::Later), Decision::Deferred);
    }
}
