//! Public GitHub Releases client shared by `atlas update`, `atlas desktop` and the desktop app.
//!
//! Uses no REST API and no token: the unauthenticated API allows 60 requests an hour per IP,
//! which a shared network (or a few update checks) exhausts. Instead, through `curl`
//! (present on every supported OS):
//! - the latest tag comes from the `releases/latest` redirect on github.com;
//! - release notes are the `## [X.Y.Z] - date` sections of `CHANGELOG.md` at that tag
//!   (the release body is the same section, extracted by `release.yml`);
//! - assets come from the public `releases/download` URLs.

use std::path::Path;
use std::process::{Command, Stdio};

use thiserror::Error;

pub const MISSING: &str = "curl not found — install it and try again";

#[derive(Debug, Error)]
pub enum GithubError {
    #[error("{MISSING}")]
    Missing,
    #[error("GitHub request failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub url: String,
    /// `YYYY-MM-DD` from the CHANGELOG heading ("" when it has none).
    pub published_at: String,
    pub body: String,
}

impl ReleaseInfo {
    /// The tag without its leading `v`.
    pub fn version(&self) -> &str {
        self.tag_name.trim_start_matches('v')
    }

    /// The release notes ("" when the release has none).
    pub fn notes(&self) -> &str {
        &self.body
    }
}

/// Base `curl` invocation: silent, fail on HTTP errors, bounded time.
fn curl() -> Command {
    let mut c = Command::new("curl");
    c.args(["-fsS", "--max-time", "120", "-H", "User-Agent: atlas-cli"])
        .stdin(Stdio::null());
    c
}

/// Run `cmd` and return its stdout; a spawn failure means curl is missing.
fn run(mut cmd: Command) -> Result<Vec<u8>, GithubError> {
    let out = cmd.output().map_err(|_| GithubError::Missing)?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    Err(GithubError::Failed(
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
    ))
}

/// Tag of the latest published (non-draft, non-prerelease) release, from the redirect
/// `github.com/<repo>/releases/latest` → `.../releases/tag/<tag>`.
fn latest_tag(repo: &str) -> Result<String, GithubError> {
    let mut c = curl();
    c.args(["-o", "/dev/null", "-w", "%{redirect_url}"])
        .arg(format!("https://github.com/{repo}/releases/latest"));
    let url = String::from_utf8_lossy(&run(c)?).trim().to_string();
    url.rsplit_once("/releases/tag/")
        .map(|(_, tag)| tag.to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| GithubError::Failed(format!("{repo} has no published release")))
}

/// `CHANGELOG.md` of `repo` at `tag`.
fn changelog(repo: &str, tag: &str) -> Result<String, GithubError> {
    let mut c = curl();
    c.arg(format!(
        "https://raw.githubusercontent.com/{repo}/{tag}/CHANGELOG.md"
    ));
    Ok(String::from_utf8_lossy(&run(c)?).into_owned())
}

/// Released sections of a Keep a Changelog file, newest first: `## [X.Y.Z] - date` headings
/// (`[Unreleased]` and other non-version headings are skipped) with their bodies.
fn sections(repo: &str, md: &str) -> Vec<ReleaseInfo> {
    let mut out: Vec<ReleaseInfo> = Vec::new();
    let mut current: Option<ReleaseInfo> = None;
    for line in md.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            out.extend(current.take());
            let Some((version, rest)) = head
                .strip_prefix('[')
                .and_then(|h| h.split_once(']'))
                .filter(|(v, _)| v.starts_with(|c: char| c.is_ascii_digit()))
            else {
                continue;
            };
            let tag = format!("v{version}");
            current = Some(ReleaseInfo {
                url: format!("https://github.com/{repo}/releases/tag/{tag}"),
                tag_name: tag,
                published_at: rest
                    .trim_start_matches([' ', '-', '—', '–'])
                    .trim()
                    .to_string(),
                body: String::new(),
            });
        } else if let Some(r) = current.as_mut() {
            r.body.push_str(line);
            r.body.push('\n');
        }
    }
    out.extend(current);
    for r in &mut out {
        r.body = r.body.trim().to_string();
    }
    out
}

/// Every published release, newest first: the sections of `CHANGELOG.md` at the latest tag,
/// which carries the whole history (older tags may not exist in this repository).
pub fn releases(repo: &str) -> Result<Vec<ReleaseInfo>, GithubError> {
    Ok(sections(repo, &changelog(repo, &latest_tag(repo)?)?))
}

/// Latest published (non-draft, non-prerelease) release of `repo`.
pub fn latest_release(repo: &str) -> Result<ReleaseInfo, GithubError> {
    let tag = latest_tag(repo)?;
    let version = tag.trim_start_matches('v');
    sections(repo, &changelog(repo, &tag)?)
        .into_iter()
        .find(|r| r.version() == version)
        .ok_or_else(|| GithubError::Failed(format!("CHANGELOG.md at {tag} has no [{version}]")))
}

/// Download the release asset `name` of `tag` into `dest`.
pub fn download_asset(repo: &str, tag: &str, name: &str, dest: &Path) -> Result<(), GithubError> {
    download_asset_progress(repo, tag, name, dest, |_, _| {})
}

/// Like [`download_asset`], reporting `(bytes_done, bytes_total)` (total 0 while unknown)
/// as the file grows. curl writes straight to `dest`; its size is polled from this thread
/// until curl exits, so no output parsing and no extra copy are involved.
pub fn download_asset_progress(
    repo: &str,
    tag: &str,
    name: &str,
    dest: &Path,
    on_progress: impl FnMut(u64, u64),
) -> Result<(), GithubError> {
    let url = format!("https://github.com/{repo}/releases/download/{tag}/{name}");
    let total = content_length(&url).unwrap_or(0);
    let mut c = curl();
    c.arg("-L").arg("-o").arg(dest).arg(&url);
    watch_download(
        c,
        dest,
        total,
        std::time::Duration::from_millis(120),
        on_progress,
    )
}

/// Run `cmd` (which writes `dest`) to completion, calling `on_progress(size, total)` every
/// `poll` while the file grows and once more at the end with the final size. A failed exit
/// is an error carrying the command's stderr.
fn watch_download(
    mut cmd: Command,
    dest: &Path,
    total: u64,
    poll: std::time::Duration,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), GithubError> {
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|_| GithubError::Missing)?;
    let size = || std::fs::metadata(dest).map_or(0, |m| m.len());
    let mut last = u64::MAX;
    loop {
        if let Some(st) = child
            .try_wait()
            .map_err(|e| GithubError::Failed(e.to_string()))?
        {
            if !st.success() {
                let mut err = String::new();
                if let Some(mut s) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut s, &mut err);
                }
                return Err(GithubError::Failed(err.trim().to_string()));
            }
            break;
        }
        let done = size();
        if done != last {
            last = done;
            on_progress(done, total);
        }
        std::thread::sleep(poll);
    }
    let done = size();
    on_progress(done, done.max(total));
    Ok(())
}

/// `Content-Length` of release asset `name` of `tag`; `None` when unknown or offline.
pub fn asset_size(repo: &str, tag: &str, name: &str) -> Option<u64> {
    content_length(&format!(
        "https://github.com/{repo}/releases/download/{tag}/{name}"
    ))
}

/// `Content-Length` of the final response of `url` (follows redirects); `None` when unknown.
fn content_length(url: &str) -> Option<u64> {
    let mut c = curl();
    c.args([
        "-L",
        "-I",
        "-o",
        "/dev/null",
        "-w",
        "%header{content-length}",
    ])
    .arg(url);
    let out = run(c).ok()?;
    String::from_utf8_lossy(&out).trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MD: &str = "# Changelog\n\nintro\n\n## [Unreleased]\n\n- wip\n\n\
        ## [1.1.0] — 2026-10-12\n\nBig release.\n\n### Added\n- a\n\n\
        ## [1.0.1] - 2026-10-11\n\n- fix\n";

    #[test]
    fn sections_skip_unreleased_and_keep_bodies_newest_first() {
        let s = sections("o/r", MD);
        assert_eq!(
            s.iter().map(|r| r.tag_name.as_str()).collect::<Vec<_>>(),
            ["v1.1.0", "v1.0.1"]
        );
        assert_eq!(s[0].notes(), "Big release.\n\n### Added\n- a");
        assert_eq!(s[0].published_at, "2026-10-12");
        assert_eq!(s[0].url, "https://github.com/o/r/releases/tag/v1.1.0");
        assert_eq!((s[1].version(), s[1].notes()), ("1.0.1", "- fix"));
    }

    #[test]
    fn heading_without_date_or_sections_still_parses() {
        let s = sections("o/r", "## [2.0.0]\n");
        assert_eq!(
            (s[0].version(), s[0].published_at.as_str(), s[0].notes()),
            ("2.0.0", "", "")
        );
        assert!(sections("o/r", "no headings").is_empty());
    }

    fn sh(script: &str) -> Command {
        let mut c = Command::new("sh");
        c.args(["-c", script]);
        c
    }

    #[test]
    fn watch_reports_growth_then_the_final_size() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("a.bin");
        let script = format!(
            "printf aaaa > {d}; sleep 0.4; printf bbbb >> {d}; sleep 0.4; printf cccc >> {d}",
            d = dest.display()
        );
        let mut seen = Vec::new();
        watch_download(
            sh(&script),
            &dest,
            12,
            std::time::Duration::from_millis(20),
            |d, t| {
                seen.push((d, t));
            },
        )
        .unwrap();
        assert!(
            seen.windows(2).all(|w| w[0].0 <= w[1].0),
            "monotonic: {seen:?}"
        );
        assert!(
            seen.iter().any(|&(d, _)| d == 4 || d == 8),
            "intermediate: {seen:?}"
        );
        assert_eq!(seen.last(), Some(&(12, 12)));
    }

    #[test]
    fn watch_total_follows_the_file_when_the_size_was_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("a.bin");
        let script = format!("printf hello > {}", dest.display());
        let mut last = (0, 0);
        watch_download(
            sh(&script),
            &dest,
            0,
            std::time::Duration::from_millis(10),
            |d, t| {
                last = (d, t);
            },
        )
        .unwrap();
        assert_eq!(last, (5, 5));
    }

    #[test]
    fn watch_failure_carries_the_commands_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("a.bin");
        let e = watch_download(
            sh("echo 'curl: (22) 404' >&2; exit 22"),
            &dest,
            0,
            std::time::Duration::from_millis(10),
            |_, _| {},
        )
        .unwrap_err();
        assert!(e.to_string().contains("404"), "{e}");
    }

    #[test]
    fn watch_missing_program_is_reported_as_missing_curl() {
        let dir = tempfile::tempdir().unwrap();
        let e = watch_download(
            Command::new("definitely-not-a-program"),
            &dir.path().join("x"),
            0,
            std::time::Duration::from_millis(10),
            |_, _| {},
        )
        .unwrap_err();
        assert!(matches!(e, GithubError::Missing));
    }
}
