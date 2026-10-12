//! Which language server serves which language, how to install it, and how to find the
//! project root it should be started in.

use std::path::{Path, PathBuf};

/// How a server's executable is obtained when it is not already on `PATH`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Install {
    /// GitHub release asset, gzip-compressed single binary (rust-analyzer).
    GithubGz,
    /// `go install <module>@<version>` into the server dir (needs `go`).
    GoInstall,
    /// `npm install` of pinned packages into the server dir with a managed or system Node.
    Npm,
}

#[derive(Debug, Clone, Copy)]
pub struct Server {
    /// Stable id: dir name under `~/.atlas/lsp`, log file name, status `name`.
    pub name: &'static str,
    /// Executable looked up on `PATH` first.
    pub bin: &'static str,
    pub args: &'static [&'static str],
    pub install: Install,
    /// Pinned version of the main package/release.
    pub version: &'static str,
    /// npm: `pkg@version` list; go: module path (single entry).
    pub packages: &'static [&'static str],
    /// npm: path of the JS entry point relative to `node_modules/` (run with node).
    pub entry: &'static str,
    /// Files/dirs that mark a project root, nearest ancestor wins unless `topmost`.
    pub markers: &'static [&'static str],
    /// Rust: prefer the topmost ancestor whose Cargo.toml has a `[workspace]` table.
    pub cargo_workspace: bool,
    /// LSP language ids this server handles.
    pub languages: &'static [&'static str],
}

pub const SERVERS: &[Server] = &[
    Server {
        name: "rust-analyzer",
        bin: "rust-analyzer",
        args: &[],
        install: Install::GithubGz,
        version: "2026-10-12",
        packages: &[],
        entry: "",
        markers: &["Cargo.toml", "rust-project.json"],
        cargo_workspace: true,
        languages: &["rust"],
    },
    Server {
        name: "gopls",
        bin: "gopls",
        args: &[],
        install: Install::GoInstall,
        version: "v0.23.0",
        packages: &["golang.org/x/tools/gopls"],
        entry: "",
        markers: &["go.work", "go.mod"],
        cargo_workspace: false,
        languages: &["go", "gomod", "gowork", "gotmpl"],
    },
    Server {
        name: "typescript-language-server",
        bin: "typescript-language-server",
        args: &["--stdio"],
        install: Install::Npm,
        version: "6.0.2",
        // typescript 5.x: tsserver is the JS implementation the language server drives.
        packages: &["typescript-language-server@6.0.2", "typescript@5.9.3"],
        entry: "typescript-language-server/lib/cli.mjs",
        markers: &["tsconfig.json", "jsconfig.json", "package.json"],
        cargo_workspace: false,
        languages: &[
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ],
    },
    Server {
        name: "vscode-html-language-server",
        bin: "vscode-html-language-server",
        args: &["--stdio"],
        install: Install::Npm,
        version: "4.10.0",
        packages: &["vscode-langservers-extracted@4.10.0"],
        entry: "vscode-langservers-extracted/bin/vscode-html-language-server",
        markers: &["package.json", ".git"],
        cargo_workspace: false,
        languages: &["html"],
    },
    Server {
        name: "vscode-css-language-server",
        bin: "vscode-css-language-server",
        args: &["--stdio"],
        install: Install::Npm,
        version: "4.10.0",
        packages: &["vscode-langservers-extracted@4.10.0"],
        entry: "vscode-langservers-extracted/bin/vscode-css-language-server",
        markers: &["package.json", ".git"],
        cargo_workspace: false,
        languages: &["css", "scss", "less"],
    },
    Server {
        name: "vscode-json-language-server",
        bin: "vscode-json-language-server",
        args: &["--stdio"],
        install: Install::Npm,
        version: "4.10.0",
        packages: &["vscode-langservers-extracted@4.10.0"],
        entry: "vscode-langservers-extracted/bin/vscode-json-language-server",
        markers: &["package.json", ".git"],
        cargo_workspace: false,
        languages: &["json", "jsonc"],
    },
    Server {
        name: "intelephense",
        bin: "intelephense",
        args: &["--stdio"],
        install: Install::Npm,
        version: "1.18.5",
        packages: &["intelephense@1.18.5"],
        entry: "intelephense/lib/intelephense.js",
        markers: &["composer.json", ".git"],
        cargo_workspace: false,
        languages: &["php"],
    },
    Server {
        name: "basedpyright",
        bin: "basedpyright-langserver",
        args: &["--stdio"],
        install: Install::Npm,
        version: "1.40.2",
        packages: &["basedpyright@1.40.2"],
        entry: "basedpyright/langserver.index.js",
        markers: &[
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "pyrightconfig.json",
            "requirements.txt",
        ],
        cargo_workspace: false,
        languages: &["python"],
    },
    Server {
        name: "yaml-language-server",
        bin: "yaml-language-server",
        args: &["--stdio"],
        install: Install::Npm,
        version: "1.25.0",
        packages: &["yaml-language-server@1.25.0"],
        entry: "yaml-language-server/bin/yaml-language-server",
        markers: &[".git"],
        cargo_workspace: false,
        languages: &["yaml"],
    },
    Server {
        name: "bash-language-server",
        bin: "bash-language-server",
        args: &["start"],
        install: Install::Npm,
        version: "5.8.1",
        packages: &["bash-language-server@5.8.1"],
        entry: "bash-language-server/out/cli.js",
        markers: &[".git"],
        cargo_workspace: false,
        languages: &["shellscript", "bash", "sh", "shell"],
    },
];

/// Server for an LSP language id (`None`: no language server for it).
pub fn for_language(language_id: &str) -> Option<&'static Server> {
    SERVERS.iter().find(|s| s.languages.contains(&language_id))
}

/// Display name of a server (`TypeScript / JavaScript`, `Rust`…), for settings and the status bar.
pub fn server_label(s: &Server) -> &'static str {
    match s.name {
        "rust-analyzer" => "rust-analyzer",
        "gopls" => "gopls",
        "typescript-language-server" => "typescript-language-server",
        "vscode-html-language-server" => "HTML language server",
        "vscode-css-language-server" => "CSS language server",
        "vscode-json-language-server" => "JSON language server",
        "intelephense" => "Intelephense",
        "basedpyright" => "basedpyright",
        "yaml-language-server" => "YAML language server",
        "bash-language-server" => "Bash language server",
        other => other,
    }
}

/// Human language names for the catalog (settings, "no server for X" messages), by LSP id.
pub fn language_label(id: &str) -> &str {
    match id {
        "typescript" => "TypeScript",
        "typescriptreact" => "TypeScript React",
        "javascript" => "JavaScript",
        "javascriptreact" => "JavaScript React",
        "rust" => "Rust",
        "go" => "Go",
        "gomod" => "go.mod",
        "gowork" => "go.work",
        "gotmpl" => "Go templates",
        "html" => "HTML",
        "css" => "CSS",
        "scss" => "SCSS",
        "less" => "Less",
        "json" => "JSON",
        "jsonc" => "JSON with comments",
        "php" => "PHP",
        "python" => "Python",
        "yaml" => "YAML",
        "shellscript" | "bash" | "sh" | "shell" => "Shell",
        other => other,
    }
}

/// Languages that have a server, for "No language server for X; supported: …" messages.
/// One entry per server language group, in registry order, without duplicates.
pub fn supported_languages() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = vec![];
    for s in SERVERS {
        for l in s.languages {
            let label = language_label(l);
            if !out.contains(&label) {
                out.push(label);
            }
        }
    }
    out
}

pub fn by_name(name: &str) -> Option<&'static Server> {
    SERVERS.iter().find(|s| s.name == name)
}

/// Is `file` third-party source the user browses rather than a project they work on: a package manager
/// store (`node_modules`, the cargo registry and git checkouts) or the Rust toolchain's own sources?
/// Such a file is served by the server of the project that led there, never by one rooted in it.
pub fn is_dependency(file: &Path) -> bool {
    let parts: Vec<_> = file
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect();
    let has = |a: &str, b: &str| parts.windows(2).any(|w| w[0] == a && w[1] == b);
    parts.iter().any(|p| p == "node_modules")
        || has(".cargo", "registry")
        || has(".cargo", "git")
        || has(".rustup", "toolchains")
}

/// Root directory for `file` under `server`. `fallback` (the worktree root, or the file's
/// directory) applies when no marker is found.
pub fn find_root(server: &Server, file: &Path, fallback: Option<&Path>) -> PathBuf {
    let start = file.parent().unwrap_or(file);
    let mut found: Option<PathBuf> = None;
    for dir in start.ancestors() {
        if server.cargo_workspace {
            // Topmost Cargo.toml that declares [workspace]; else the nearest Cargo.toml.
            let manifest = dir.join("Cargo.toml");
            if manifest.is_file() {
                if found.is_none() {
                    found = Some(dir.to_path_buf());
                }
                if std::fs::read_to_string(&manifest)
                    .is_ok_and(|t| t.lines().any(|l| l.trim_start().starts_with("[workspace")))
                {
                    return dir.to_path_buf();
                }
                continue;
            }
            if server.markers.iter().skip(1).any(|m| dir.join(m).exists()) && found.is_none() {
                found = Some(dir.to_path_buf());
            }
            continue;
        }
        if let Some(i) = server.markers.iter().position(|m| dir.join(m).exists()) {
            // Earlier markers are stronger (go.work over go.mod, tsconfig over package.json).
            if server.name == "gopls" {
                // go.work wins over a nested go.mod even when it is higher up.
                if i == 0 {
                    return dir.to_path_buf();
                }
                found.get_or_insert_with(|| dir.to_path_buf());
                continue;
            }
            return dir.to_path_buf();
        }
    }
    found.unwrap_or_else(|| {
        fallback
            .map(Path::to_path_buf)
            .unwrap_or_else(|| start.to_path_buf())
    })
}

#[cfg(test)]
mod label_tests {
    use super::*;

    #[test]
    fn supported_languages_are_human_unique_and_cover_the_core_set() {
        let s = supported_languages();
        for l in [
            "TypeScript",
            "JavaScript",
            "Rust",
            "Go",
            "Python",
            "JSON",
            "YAML",
            "Shell",
        ] {
            assert!(s.contains(&l), "{l} missing from {s:?}");
        }
        let mut dedup = s.clone();
        dedup.sort_unstable();
        dedup.dedup();
        assert_eq!(dedup.len(), s.len(), "duplicates in {s:?}");
    }

    #[test]
    fn every_server_has_a_label_and_every_language_a_server() {
        for srv in SERVERS {
            assert!(!server_label(srv).is_empty());
            for l in srv.languages {
                assert_eq!(for_language(l).map(|x| x.name), Some(srv.name));
            }
        }
        assert_eq!(language_label("unknown-lang"), "unknown-lang");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn dependency_locations_are_recognised_and_projects_are_not() {
        for p in [
            "/p/node_modules/typescript/lib/lib.d.ts",
            "/p/apps/a/node_modules/.bun/x@1/node_modules/x/index.d.ts",
            "/Users/me/.cargo/registry/src/index.crates.io-6f17/serde-1.0/src/lib.rs",
            "/Users/me/.cargo/git/checkouts/foo-abc/1234/src/lib.rs",
            "/Users/me/.rustup/toolchains/stable-aarch64-apple-darwin/lib/rustlib/src/rust/library/std/src/path.rs",
        ] {
            assert!(is_dependency(Path::new(p)), "{p}");
        }
        for p in [
            "/Users/me/Projetos/atlas/crates/atlas-core/src/lib.rs",
            "/Users/me/node_modules_notes/a.ts",
            "/Users/me/cargo/registry/x.rs",
            "/Users/me/.cargo/bin/tool",
        ] {
            assert!(!is_dependency(Path::new(p)), "{p}");
        }
    }

    fn touch(p: &Path) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "").unwrap();
    }

    fn srv(lang: &str) -> &'static Server {
        for_language(lang).unwrap()
    }

    #[test]
    fn every_language_maps_to_one_server() {
        for s in SERVERS {
            for l in s.languages {
                assert_eq!(for_language(l).unwrap().name, s.name, "{l}");
            }
        }
        for l in [
            "rust",
            "go",
            "typescript",
            "javascript",
            "tsx_is_not_an_id",
            "php",
            "html",
            "css",
            "json",
            "python",
            "yaml",
            "shellscript",
        ] {
            let _ = for_language(l);
        }
        assert!(for_language("rust").is_some());
        assert!(for_language("brainfuck").is_none());
        assert_eq!(
            for_language("typescriptreact").unwrap().name,
            "typescript-language-server"
        );
    }

    #[test]
    fn npm_servers_have_pinned_packages_and_entry() {
        for s in SERVERS.iter().filter(|s| s.install == Install::Npm) {
            assert!(!s.entry.is_empty(), "{}", s.name);
            assert!(
                s.packages.iter().all(|p| p
                    .rsplit_once('@')
                    .is_some_and(|(n, v)| !n.is_empty() && !v.is_empty())),
                "{}",
                s.name
            );
        }
    }

    #[test]
    fn rust_root_is_topmost_workspace_manifest() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        fs::write(
            r.join("Cargo.toml"),
            "[workspace]\nmembers=[\"crates/a\"]\n",
        )
        .unwrap();
        touch(&r.join("crates/a/src/lib.rs"));
        fs::write(r.join("crates/a/Cargo.toml"), "[package]\nname=\"a\"\n").unwrap();
        assert_eq!(
            find_root(srv("rust"), &r.join("crates/a/src/lib.rs"), None),
            r
        );
    }

    #[test]
    fn rust_root_is_nearest_manifest_without_workspace() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("a/Cargo.toml"));
        touch(&r.join("a/src/main.rs"));
        assert_eq!(
            find_root(srv("rust"), &r.join("a/src/main.rs"), None),
            r.join("a")
        );
    }

    #[test]
    fn go_work_beats_nested_go_mod() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("go.work"));
        touch(&r.join("svc/go.mod"));
        touch(&r.join("svc/main.go"));
        assert_eq!(find_root(srv("go"), &r.join("svc/main.go"), None), r);
        let t2 = tempfile::tempdir().unwrap();
        touch(&t2.path().join("m/go.mod"));
        touch(&t2.path().join("m/x/y.go"));
        assert_eq!(
            find_root(srv("go"), &t2.path().join("m/x/y.go"), None),
            t2.path().join("m")
        );
    }

    #[test]
    fn ts_prefers_nearest_tsconfig_or_package_json() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("package.json"));
        touch(&r.join("apps/web/package.json"));
        touch(&r.join("apps/web/src/a.ts"));
        assert_eq!(
            find_root(srv("typescript"), &r.join("apps/web/src/a.ts"), None),
            r.join("apps/web")
        );
    }

    #[test]
    fn php_python_html_roots() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        touch(&r.join("composer.json"));
        touch(&r.join("src/A.php"));
        assert_eq!(find_root(srv("php"), &r.join("src/A.php"), None), r);
        touch(&r.join("py/pyproject.toml"));
        touch(&r.join("py/pkg/m.py"));
        assert_eq!(
            find_root(srv("python"), &r.join("py/pkg/m.py"), None),
            r.join("py")
        );
        touch(&r.join("py/requirements.txt"));
        touch(&r.join("site/package.json"));
        touch(&r.join("site/index.html"));
        assert_eq!(
            find_root(srv("html"), &r.join("site/index.html"), None),
            r.join("site")
        );
    }

    #[test]
    fn no_marker_uses_fallback_then_file_dir() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path().join("lone");
        touch(&r.join("x.py"));
        let fb = t.path().join("wt");
        assert_eq!(find_root(srv("python"), &r.join("x.py"), Some(&fb)), fb);
        assert_eq!(find_root(srv("python"), &r.join("x.py"), None), r);
    }
}
