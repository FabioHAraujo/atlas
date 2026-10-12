//! Versions, dev links and self-update. All installs go through the CLI
//! (`atlas update` → `atlas desktop --sync`), so the app and the terminal share
//! one code path for downloading, verifying and replacing binaries.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::cmds::atlas_bin;

const REPO: &str = "codeatlasdev/atlas";

/// Version this app reports as installed. Debug builds honour `ATLAS_DEBUG_FAKE_VERSION`
/// so the "behind" UI can be exercised without a real older build.
fn app_version() -> String {
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("ATLAS_DEBUG_FAKE_VERSION")
        && semver::Version::parse(&v).is_ok()
    {
        return v;
    }
    env!("CARGO_PKG_VERSION").to_string()
}

/// An install is running in this process (any window, the tray): a second one is refused.
static INSTALLING: AtomicBool = AtomicBool::new(false);

struct InstallGuard;

impl InstallGuard {
    fn take() -> Result<Self, String> {
        INSTALLING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "An update is already running".to_string())
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

/// Structured progress of an install, parsed from the CLI's `@@atlas …` lines and sent as
/// `updates://progress`. The phase ids match `Phase::id` in `atlas-cli`'s `update_core`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Progress {
    Phase { id: String },
    Bytes { done: u64, total: u64 },
    Rollback { state: String },
    Host { state: String, live: u64 },
}

/// `@@atlas phase download` / `@@atlas bytes 10 100` / `@@atlas rollback restored`.
fn parse_progress(line: &str) -> Option<Progress> {
    let mut it = line.strip_prefix("@@atlas ")?.split_whitespace();
    match it.next()? {
        "phase" => Some(Progress::Phase {
            id: it.next()?.to_string(),
        }),
        "bytes" => Some(Progress::Bytes {
            done: it.next()?.parse().ok()?,
            total: it.next()?.parse().ok()?,
        }),
        "rollback" => Some(Progress::Rollback {
            state: it.next()?.to_string(),
        }),
        "host" => Some(Progress::Host {
            state: it.next()?.to_string(),
            live: it.next().and_then(|n| n.parse().ok()).unwrap_or(0),
        }),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct CliInfo {
    path: Option<String>,
    version: Option<String>,
    /// `atlas link`: `~/.atlas/bin/atlas` → the repo's `target/debug/atlas`.
    linked_to: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct AppInfo {
    version: String,
    /// The `.app` this process runs from (None when running `cargo tauri dev`).
    bundle: Option<String>,
    /// The installed `Atlas.app` is a symlink to a dev bundle (`atlas link --desktop`).
    linked_to: Option<String>,
    dev: bool,
}

#[derive(Serialize)]
pub struct SystemInfo {
    app: AppInfo,
    cli: CliInfo,
}

#[derive(Serialize)]
pub struct Release {
    version: String,
    url: String,
    published_at: String,
    notes: String,
    /// Installed CLI is older than `version` (false when unknown or unparseable).
    cli_behind: bool,
    /// This app is older than `version`.
    app_behind: bool,
}

/// `latest > current` by semver (a pre-release sorts before its release); unparseable → false.
fn behind(latest: &str, current: Option<&str>) -> bool {
    use semver::Version;
    match (Version::parse(latest), current.map(Version::parse)) {
        (Ok(l), Some(Ok(c))) => l > c,
        _ => false,
    }
}

/// First line of `atlas version` is `atlas X.Y.Z`.
async fn cli_version(bin: &Path) -> Option<String> {
    let out = tokio::process::Command::new(bin)
        .arg("version")
        .output()
        .await
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("atlas "))
        .map(|v| v.trim().to_string())
}

fn link_target(p: &Path) -> Option<String> {
    std::fs::read_link(p)
        .ok()
        .map(|t| t.to_string_lossy().into_owned())
}

/// `.../Atlas.app` when this binary is `.../Atlas.app/Contents/MacOS/<bin>`.
fn own_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app = exe.parent()?.parent()?.parent()?;
    (app.extension()? == "app").then(|| app.to_path_buf())
}

#[tauri::command]
pub async fn system_info() -> Result<SystemInfo, String> {
    let cli = match atlas_bin() {
        Err(e) => CliInfo {
            path: None,
            version: None,
            linked_to: None,
            error: Some(e),
        },
        Ok(bin) => {
            let version = cli_version(&bin).await;
            CliInfo {
                linked_to: link_target(&bin),
                path: Some(bin.to_string_lossy().into_owned()),
                error: version
                    .is_none()
                    .then(|| "could not read `atlas version`".into()),
                version,
            }
        }
    };
    let bundle = own_bundle();
    let app = AppInfo {
        version: app_version(),
        dev: bundle.is_none(),
        bundle: bundle.map(|b| b.to_string_lossy().into_owned()),
        linked_to: atlas_core::paths::installed_app()
            .as_deref()
            .and_then(link_target),
    };
    Ok(SystemInfo { app, cli })
}

/// Latest published release (public GitHub Releases API).
#[tauri::command]
pub async fn latest_release() -> Result<Release, String> {
    let info = tauri::async_runtime::spawn_blocking(|| atlas_core::github::latest_release(REPO))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let version = info.version().to_string();
    let cli = match atlas_bin() {
        Ok(bin) => cli_version(&bin).await,
        Err(_) => None,
    };
    Ok(Release {
        cli_behind: behind(&version, cli.as_deref()),
        app_behind: behind(&version, Some(&app_version())),
        version,
        notes: info.notes().to_string(),
        url: info.url,
        published_at: info.published_at,
    })
}

/// Platform suffix of the release assets (`aarch64-apple-darwin`, ...), as `atlas update` names them.
fn platform() -> String {
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    format!("{arch}-apple-darwin")
}

/// Bytes an update to `version` downloads (CLI tarball + app tarball, whichever is behind);
/// `None` when a size cannot be read (offline, asset missing).
#[tauri::command]
pub async fn update_size(version: String, cli: bool, app: bool) -> Option<u64> {
    tauri::async_runtime::spawn_blocking(move || {
        let tag = format!("v{version}");
        let p = platform();
        let mut total = 0;
        if cli {
            total +=
                atlas_core::github::asset_size(REPO, &tag, &format!("atlas-{version}-{p}.tar.gz"))?;
        }
        if app {
            total += atlas_core::github::asset_size(
                REPO,
                &tag,
                &format!("Atlas-{version}-{p}.app.tar.gz"),
            )?;
        }
        (total > 0).then_some(total)
    })
    .await
    .ok()
    .flatten()
}

/// One published release, for the "What's new" sheet.
#[derive(Serialize)]
pub struct ReleaseNotes {
    version: String,
    url: String,
    published_at: String,
    notes: String,
}

/// Releases (newest first) newer than `installed` and not newer than `latest`;
/// `installed == latest` keeps just that one ("what changed in the version I run").
fn in_range(
    all: Vec<atlas_core::github::ReleaseInfo>,
    installed: &str,
    latest: &str,
) -> Vec<atlas_core::github::ReleaseInfo> {
    use semver::Version;
    let (Ok(from), Ok(to)) = (Version::parse(installed), Version::parse(latest)) else {
        return Vec::new();
    };
    all.into_iter()
        .filter(|r| {
            Version::parse(r.version())
                .is_ok_and(|v| v <= to && (v > from || from == to && v == to))
        })
        .collect()
}

/// Release notes of every release in `(from, to]`, newest first (at most 10).
#[tauri::command]
pub async fn releases_between(from: String, to: String) -> Result<Vec<ReleaseNotes>, String> {
    const MAX: usize = 10;
    tauri::async_runtime::spawn_blocking(move || {
        let all = atlas_core::github::releases(REPO).map_err(|e| e.to_string())?;
        Ok(in_range(all, &from, &to)
            .into_iter()
            .take(MAX)
            .map(|info| ReleaseNotes {
                version: info.version().to_string(),
                notes: info.notes().to_string(),
                url: info.url,
                published_at: info.published_at,
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forward lines as `updates://log` (and `@@atlas` protocol lines as `updates://progress`);
/// returns the last non-empty plain line (the error, on failure).
async fn pump<R: tokio::io::AsyncRead + Unpin>(rd: R, app: AppHandle) -> String {
    let mut lines = BufReader::new(rd).lines();
    let mut last = String::new();
    while let Ok(Some(l)) = lines.next_line().await {
        let clean = atlas_tui::runtime::text::strip_ansi(&l);
        if let Some(p) = parse_progress(&clean) {
            let _ = app.emit("updates://progress", p);
            continue;
        }
        if !clean.trim().is_empty() {
            last = clean.clone();
        }
        let _ = app.emit("updates://log", clean);
    }
    last
}

/// Run an atlas CLI subcommand, streaming each output line as `updates://log`.
/// Only one install runs at a time in this process; the CLI's own lock covers other processes.
async fn stream(app: &AppHandle, args: &[&str]) -> Result<(), String> {
    let _guard = InstallGuard::take()?;
    let mut child = tokio::process::Command::new(atlas_bin()?)
        .envs(crate::shell_env::vars_async().await)
        .args(args)
        .env("NO_COLOR", "1")
        .env("ATLAS_UPDATE_PROGRESS", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run atlas: {e}"))?;
    let out = child.stdout.take().expect("piped");
    let err = child.stderr.take().expect("piped");
    let (_, last_err) = tokio::join!(pump(out, app.clone()), pump(err, app.clone()));
    let st = child.wait().await.map_err(|e| e.to_string())?;
    if st.success() {
        Ok(())
    } else {
        Err(if last_err.is_empty() {
            format!("atlas {} failed ({st})", args.join(" "))
        } else {
            last_err
        })
    }
}

/// Modification time of this bundle's `Info.plist`: changes when the app was replaced.
fn bundle_stamp() -> Option<std::time::SystemTime> {
    std::fs::metadata(own_bundle()?.join("Contents/Info.plist"))
        .ok()?
        .modified()
        .ok()
}

/// `atlas update`: the CLI, then (via `atlas desktop --sync`) the installed app, rolling the
/// CLI back when the app cannot follow. Returns whether this app's bundle changed on disk
/// and needs a relaunch.
#[tauri::command]
pub async fn update_all(app: AppHandle) -> Result<bool, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("ATLAS_DEBUG_FAKE_VERSION").is_some() {
        return Err("Updates are disabled while ATLAS_DEBUG_FAKE_VERSION is set".into());
    }
    let before = bundle_stamp();
    stream(&app, &["update"]).await?;
    Ok(before.is_some() && before != bundle_stamp())
}

/// Install/repair the app from the newest release, through the CLI.
#[tauri::command]
pub async fn reinstall_app(app: AppHandle) -> Result<(), String> {
    stream(&app, &["desktop", "--install", "--latest", "--no-open"]).await
}

/// `atlas unlink`: back to the release CLI (and release app, when linked).
#[tauri::command]
pub async fn unlink(app: AppHandle) -> Result<(), String> {
    stream(&app, &["unlink"]).await
}

/// Reopen the (possibly replaced) bundle, then quit this process.
#[tauri::command]
pub fn relaunch(app: AppHandle) -> Result<(), String> {
    let bundle = atlas_core::paths::installed_app()
        .or_else(own_bundle)
        .ok_or("not running from an installed Atlas.app")?;
    std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(r#"sleep 1; /usr/bin/open "$0""#)
        .arg(&bundle)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{InstallGuard, Progress, behind, parse_progress};

    #[test]
    fn progress_lines_parse_and_plain_lines_do_not() {
        assert_eq!(
            parse_progress("@@atlas phase install-cli"),
            Some(Progress::Phase {
                id: "install-cli".into()
            })
        );
        assert_eq!(
            parse_progress("@@atlas bytes 1024 4096"),
            Some(Progress::Bytes {
                done: 1024,
                total: 4096
            })
        );
        assert_eq!(
            parse_progress("@@atlas rollback restored"),
            Some(Progress::Rollback {
                state: "restored".into()
            })
        );
        assert_eq!(
            parse_progress("@@atlas host needs-restart 2"),
            Some(Progress::Host {
                state: "needs-restart".into(),
                live: 2
            })
        );
        for bad in [
            "◆ Downloading v1",
            "@@atlas bytes x 1",
            "@@atlas bytes 1",
            "@@atlas nope 1",
            "@@atlas phase",
        ] {
            assert_eq!(parse_progress(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_one_install_at_a_time() {
        let first = InstallGuard::take().expect("free");
        assert!(InstallGuard::take().is_err(), "second install is refused");
        drop(first);
        InstallGuard::take().expect("free again after the first ends");
    }

    #[test]
    fn behind_compares_semver_with_prereleases() {
        assert!(behind("0.5.9", Some("0.5.8")));
        assert!(!behind("0.5.8", Some("0.5.8")));
        assert!(!behind("0.5.7", Some("0.5.8")));
        assert!(
            behind("0.5.8", Some("0.5.8-rc.1")),
            "release > its pre-release"
        );
        assert!(!behind("0.5.8-rc.1", Some("0.5.8")));
        assert!(behind("0.10.0", Some("0.9.9")), "numeric, not lexical");
    }

    #[test]
    fn behind_is_false_when_unknown_or_unparseable() {
        assert!(!behind("0.5.9", None));
        assert!(!behind("garbage", Some("0.5.8")));
        assert!(!behind("0.5.9", Some("garbage")));
    }

    #[test]
    fn in_range_keeps_only_the_range() {
        use super::in_range;
        let all = || {
            ["1.0.2", "1.0.1", "1.0.0", "0.9.0"]
                .map(|v| atlas_core::github::ReleaseInfo {
                    tag_name: format!("v{v}"),
                    url: String::new(),
                    published_at: String::new(),
                    body: String::new(),
                })
                .to_vec()
        };
        let v = |r: Vec<atlas_core::github::ReleaseInfo>| {
            r.iter()
                .map(|r| r.version().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(v(in_range(all(), "1.0.0", "1.0.2")), ["1.0.2", "1.0.1"]);
        assert_eq!(v(in_range(all(), "1.0.0", "1.0.1")), ["1.0.1"]);
        assert_eq!(v(in_range(all(), "1.0.2", "1.0.2")), ["1.0.2"]);
        assert!(in_range(all(), "garbage", "1.0.2").is_empty());
    }
}
