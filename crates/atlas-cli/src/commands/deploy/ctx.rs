//! Resolved deploy context (project + target) and the small helpers every
//! subcommand shares: console output, identity, and the id shapes allowed in paths.

use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use atlas_core::util::expand_tilde;
use atlas_tui::config::{DeployConfig, DeployTarget};

use super::remote::Remote;

/// Resolved project + target.
pub(super) struct Ctx {
    pub root: PathBuf,
    pub cfg: DeployConfig,
    pub app: String,
    pub name: String,
    pub target: DeployTarget,
    pub dir: String,
    pub remote: Remote,
}

impl Ctx {
    pub fn load(dir: &str, target: Option<&str>) -> Result<Self> {
        let start = PathBuf::from(expand_tilde(dir));
        let root = atlas_tui::config::find_root(&start)
            .with_context(|| format!("no atlas.yaml found in {} or any parent", start.display()))?;
        let project = atlas_tui::config::load(&root)?;
        let cfg = project.deploy.context("no deploy: section in atlas.yaml")?;
        let mut known: Vec<&String> = cfg.targets.keys().collect();
        known.sort();
        let known_s = known
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let name = match target {
            Some(t) if cfg.targets.contains_key(t) => t.to_string(),
            Some(t) => bail!("unknown deploy target '{t}' (known: {known_s})"),
            None if known.len() == 1 => known[0].clone(),
            None => bail!("multiple deploy targets ({known_s}): pass one"),
        };
        let app = cfg.app.clone().unwrap_or(project.name);
        if app.is_empty()
            || !app
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            bail!("project name '{app}' is not [a-z0-9-]+: set deploy.app");
        }
        let target = cfg.targets[&name].clone();
        let dir = target.dir.clone().unwrap_or_else(|| format!("/opt/{app}"));
        let remote = Remote::new(&target.host);
        Ok(Self {
            root,
            cfg,
            app,
            name,
            target,
            dir,
            remote,
        })
    }

    /// `<dir>/.atlas` on the host: state, lock, audit trail and per-run dirs.
    pub fn atlas(&self) -> String {
        format!("{}/.atlas", self.dir)
    }

    pub fn run_dir(&self, id: &str) -> String {
        format!("{}/.atlas/run/{id}", self.dir)
    }
}

pub(super) fn step(msg: &str) {
    eprintln!("\x1b[36m▸\x1b[0m {msg}");
}

pub(super) fn die(code: i32, msg: &str) -> ! {
    eprintln!("\x1b[1;31merror:\x1b[0m {msg}");
    std::process::exit(code);
}

/// `user@host` recorded in the plan (audit trail on the host).
pub(super) fn deploy_user() -> String {
    let user = std::env::var("USER").unwrap_or_else(|_| "unknown".into());
    let host = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    format!("{user}@{host}")
}

/// `YYYYMMDDHHMMSS-<sha7>[-dirty]` — the only shape ever put into a path.
pub(super) fn valid_release_id(s: &str) -> bool {
    let b = s.as_bytes();
    let core = b.len() >= 22
        && b[..14].iter().all(u8::is_ascii_digit)
        && b[14] == b'-'
        && b[15..22]
            .iter()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c));
    core && (b.len() == 22 || &s[22..] == "-dirty")
}

/// A release id or a rollback run id (`rb-<digits>`).
pub(super) fn valid_run_id(s: &str) -> bool {
    valid_release_id(s)
        || s.strip_prefix("rb-")
            .is_some_and(|t| !t.is_empty() && t.bytes().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_id_shape() {
        assert!(valid_release_id("20250101120000-abcdef0"));
        assert!(valid_release_id("20250101120000-abcdef0-dirty"));
        for bad in [
            "../x",
            "20250101120000-abcdef",
            "20250101120000-ABCDEF0",
            "20250101120000-abcdef0/..",
            "20250101120000-abcdef0-dirtyx",
            "",
        ] {
            assert!(!valid_release_id(bad), "{bad}");
        }
        assert!(valid_run_id("rb-20250101120000"));
        assert!(!valid_run_id("rb-../x"));
    }
}
