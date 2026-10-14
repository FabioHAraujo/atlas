//! Well-known locations and executable lookup shared by the CLI, TUI and desktop app.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// `~/.atlas` (falls back to `/.atlas` when there is no home directory).
pub fn atlas_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".atlas")
}

/// Control socket of a running Atlas Desktop (`atlas wt|term|browser|file` talk to it).
pub fn desktop_socket() -> PathBuf {
    atlas_home().join("desktop.sock")
}

/// Per-run auth token for [`desktop_socket`].
pub fn desktop_token() -> PathBuf {
    atlas_home().join("desktop.token")
}

/// Debug-build bridge socket (`atlas desktop debug …`). `ATLAS_DEBUG_SOCK` (an absolute path) picks another
/// instance's bridge: agents run isolated instances and address them without changing `$HOME`.
pub fn desktop_debug_socket() -> PathBuf {
    debug_socket_in(
        std::env::var_os("ATLAS_DEBUG_SOCK").as_deref(),
        &atlas_home(),
    )
}

/// [`desktop_debug_socket`] for an explicit override and home (pure, for tests).
pub fn debug_socket_in(over: Option<&OsStr>, home: &Path) -> PathBuf {
    match over.map(Path::new) {
        Some(p) if p.is_absolute() => p.to_path_buf(),
        _ => home.join("desktop-debug.sock"),
    }
}

/// First executable named `name` in the `PATH`-style list `path`.
pub fn which_in(name: &str, path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|d| d.join(name))
        .find(|p| is_executable(p))
}

/// First executable named `name` on `$PATH`.
pub fn which(name: &str) -> Option<PathBuf> {
    which_in(name, &std::env::var_os("PATH")?)
}

pub fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata()
        .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// The Atlas Desktop that `atlas desktop`/`atlas update` manage, when installed (symlinks count).
/// macOS: `/Applications/Atlas.app`, then `~/Applications/Atlas.app`. Linux: the AppImage at
/// [`linux_app`]. A distro package's app is not one of these: see [`packaged_app`].
pub fn installed_app() -> Option<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    app_candidates(&home)
        .into_iter()
        .find(|p| p.symlink_metadata().is_ok())
}

fn app_candidates(home: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        [PathBuf::from("/Applications"), home.join("Applications")]
            .into_iter()
            .map(|d| d.join("Atlas.app"))
            .collect()
    } else {
        vec![linux_app(home)]
    }
}

/// Linux: where `atlas desktop` puts the AppImage, `~/.local/bin/atlas-desktop` (on `PATH` for most
/// desktops, and the same command name the .deb/.rpm/Arch packages install in `/usr/bin`).
pub fn linux_app(home: &Path) -> PathBuf {
    home.join(".local/bin").join(LINUX_APP_BIN)
}

/// Binary name of Atlas Desktop on Linux (AppImage and distro packages alike).
pub const LINUX_APP_BIN: &str = "atlas-desktop";

/// Linux: Atlas Desktop installed by a distro package (.deb, .rpm, Arch). Its package manager
/// owns it: atlas opens it but never replaces it.
pub fn packaged_app() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        return None;
    }
    Some(Path::new("/usr/bin").join(LINUX_APP_BIN)).filter(|p| is_executable(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_is_looked_for_where_atlas_desktop_installs_it() {
        let home = Path::new("/home/u");
        let found = app_candidates(home);
        if cfg!(target_os = "macos") {
            assert_eq!(
                found,
                [
                    PathBuf::from("/Applications/Atlas.app"),
                    home.join("Applications/Atlas.app")
                ]
            );
        } else {
            // Never `/usr/bin/atlas-desktop`: `atlas update` must not overwrite a distro package's file.
            assert_eq!(found, [PathBuf::from("/home/u/.local/bin/atlas-desktop")]);
        }
    }

    #[test]
    fn the_debug_socket_defaults_to_the_homes_and_an_absolute_override_wins() {
        let home = Path::new("/h/.atlas");
        assert_eq!(debug_socket_in(None, home), home.join("desktop-debug.sock"));
        assert_eq!(
            debug_socket_in(Some(OsStr::new("/tmp/agent-1/debug.sock")), home),
            PathBuf::from("/tmp/agent-1/debug.sock")
        );
    }

    #[test]
    fn a_relative_or_empty_override_is_ignored_not_resolved_against_the_cwd() {
        let home = Path::new("/h/.atlas");
        for bad in ["", "debug.sock", "./x.sock", "../x.sock"] {
            assert_eq!(
                debug_socket_in(Some(OsStr::new(bad)), home),
                home.join("desktop-debug.sock"),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn which_in_finds_only_executables() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("tool");
        std::fs::write(&exe, "#!/bin/sh\n").unwrap();
        let path = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(which_in("tool", &path), None);
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(which_in("tool", &path), Some(exe));
        assert_eq!(which_in("missing", &path), None);
    }
}
