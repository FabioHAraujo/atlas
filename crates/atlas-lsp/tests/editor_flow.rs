//! The editor's whole language-server round trip, driven through [`Manager`] against the
//! fake server in semantic mode (`FAKE_SEMANTIC`): open → diagnostics → completion →
//! definition → hover → references → rename → edit → diagnostics again, plus the
//! explainability surface (reasons, tail, custom command, settings overrides, restart,
//! uninstall, catalog). No network, no real server: this is the CI-safe twin of `real.rs`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use atlas_lsp::install::{Failure, Launch, Progress, Source};
use atlas_lsp::manager::{Config, Manager, Overrides, Push, Resolver, State};
use atlas_lsp::registry::Server;
use serde_json::{Value, json};
use tokio::sync::mpsc;

const FAKE: &str = env!("CARGO_BIN_EXE_fake-lsp");

/// Resolver that launches the fake in semantic mode, or fails with a chosen [`Failure`].
struct SemanticFake {
    fail: Option<Failure>,
    env: Vec<(String, String)>,
}

impl Resolver for SemanticFake {
    fn resolve<'a>(
        &'a self,
        _server: &'static Server,
        progress: &'a dyn Progress,
    ) -> std::pin::Pin<Box<dyn Future<Output = anyhow::Result<Launch>> + Send + 'a>> {
        Box::pin(async move {
            progress.set("Downloading fake");
            if let Some(f) = &self.fail {
                return Err(anyhow::Error::new(f.clone()));
            }
            let exports: String = self
                .env
                .iter()
                .map(|(k, v)| format!("export {k}='{v}'; "))
                .collect();
            let mut l = Launch::custom(
                "/bin/sh",
                vec![
                    "-c".into(),
                    format!("export FAKE_SEMANTIC=1; {exports}exec '{FAKE}'"),
                ],
            );
            l.source = Source::Managed;
            l.version = Some("9.9.9".into());
            Ok(l)
        })
    }
}

struct Rig {
    m: Manager,
    rx: mpsc::Receiver<Push>,
    base: PathBuf,
    project: PathBuf,
    _tmp: tempfile::TempDir,
}

fn cfg() -> Config {
    Config {
        idle_shutdown: Duration::from_millis(300),
        init_timeout: Duration::from_secs(10),
        max_restarts: 3,
        restart_window: Duration::from_secs(60),
        restart_backoff: Duration::from_millis(30),
        request_timeout: Duration::from_secs(5),
    }
}

fn rig(fail: Option<Failure>, env: &[(&str, &str)]) -> Rig {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("proj");
    std::fs::create_dir_all(project.join("src")).unwrap();
    std::fs::write(project.join("Cargo.toml"), "[package]\nname=\"p\"\n").unwrap();
    let (tx, rx) = mpsc::channel(512);
    let resolver = Arc::new(SemanticFake {
        fail,
        env: env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    });
    let base = tmp.path().to_path_buf();
    let m = Manager::with_resolver(&base, cfg(), tx, resolver);
    Rig {
        m,
        rx,
        base,
        project,
        _tmp: tmp,
    }
}

impl Rig {
    fn file(&self, name: &str) -> String {
        let p = self.project.join("src").join(name);
        std::fs::write(&p, "").unwrap();
        p.to_string_lossy().into_owned()
    }

    async fn diagnostics(&mut self, path: &str, pred: impl Fn(&Value) -> bool) -> Value {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                match self.rx.recv().await.expect("push channel closed") {
                    Push::Diagnostics {
                        path: p,
                        diagnostics,
                        ..
                    } if p == path && pred(&diagnostics) => return diagnostics,
                    _ => {}
                }
            }
        })
        .await
        .expect("diagnostics did not arrive")
    }

    async fn req(&self, path: &str, method: &str, params: Value) -> Value {
        self.m.request(path, method, params, None).await.unwrap()
    }
}

fn td(path: &str) -> Value {
    json!({"uri": format!("file://{path}")})
}

fn at(line: u64, character: u64) -> Value {
    json!({"line": line, "character": character})
}

const SRC: &str = "fn add(a: i32) {}\nfn main() {\n    add(1);\n    let x = add(2); // TODO\n}\n";

#[tokio::test]
async fn open_diagnostics_completion_definition_hover_references_rename() {
    let mut r = rig(None, &[]);
    let f = r.file("lib.rs");
    let rep = r.m.open(&f, "rust", SRC.into(), 1, None).await;
    assert_eq!(rep.status, "ready");
    assert_eq!(rep.capabilities["definitionProvider"], true);
    assert!(rep.reason.is_none());

    // diagnostics: the TODO on line 3
    let d = r
        .diagnostics(&f, |d| d.as_array().is_some_and(|a| !a.is_empty()))
        .await;
    assert_eq!(d[0]["message"], "TODO left in code");
    assert_eq!(d[0]["range"]["start"]["line"], 3);

    // completion after typing `ad` on a fresh line: the declared `add` matches the prefix
    let comp = r
        .req(
            &f,
            "textDocument/completion",
            json!({"textDocument": td(&f), "position": at(2, 7)}),
        )
        .await;
    let labels: Vec<_> = comp["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["label"].as_str().unwrap().to_string())
        .collect();
    assert!(labels.contains(&"add".to_string()), "{labels:?}");

    // go to definition of the `add` call on line 2 lands on `fn add` (line 0, col 3..6)
    let def = r
        .req(
            &f,
            "textDocument/definition",
            json!({"textDocument": td(&f), "position": at(2, 5)}),
        )
        .await;
    assert_eq!(def[0]["range"]["start"], at(0, 3));
    assert_eq!(def[0]["range"]["end"], at(0, 6));

    // hover on the declaration
    let hov = r
        .req(
            &f,
            "textDocument/hover",
            json!({"textDocument": td(&f), "position": at(0, 4)}),
        )
        .await;
    assert!(
        hov["contents"]["value"]
            .as_str()
            .unwrap()
            .contains("fn add")
    );

    // references: declaration + two calls
    let refs = r
        .req(
            &f,
            "textDocument/references",
            json!({"textDocument": td(&f), "position": at(0, 4), "context": {"includeDeclaration": true}}),
        )
        .await;
    assert_eq!(refs.as_array().unwrap().len(), 3);

    // rename: one edit per occurrence, all in this file
    let ws = r
        .req(
            &f,
            "textDocument/rename",
            json!({"textDocument": td(&f), "position": at(2, 5), "newName": "plus"}),
        )
        .await;
    let edits = ws["changes"][format!("file://{f}")].as_array().unwrap();
    assert_eq!(edits.len(), 3);
    assert!(edits.iter().all(|e| e["newText"] == "plus"));
}

#[tokio::test]
async fn edits_flow_to_the_server_and_change_its_answers() {
    let mut r = rig(None, &[]);
    let f = r.file("lib.rs");
    r.m.open(&f, "rust", "fn one() {}\n".into(), 1, None).await;
    // The server must see the incremental edit: insert `fn two() {}` after line 0.
    r.m.change(
        &f,
        2,
        vec![json!({
            "range": {"start": at(1, 0), "end": at(1, 0)},
            "text": "fn two() {} // TODO\n",
        })],
    )
    .await
    .unwrap();
    let d = r
        .diagnostics(&f, |d| d.as_array().is_some_and(|a| !a.is_empty()))
        .await;
    assert_eq!(
        d[0]["range"]["start"]["line"], 1,
        "diagnostic on the new line"
    );
    let syms = r
        .req(
            &f,
            "textDocument/documentSymbol",
            json!({"textDocument": td(&f)}),
        )
        .await;
    let names: Vec<_> = syms
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["one", "two"]);
    // Fixing the TODO clears the diagnostic.
    r.m.change(
        &f,
        3,
        vec![json!({
            "range": {"start": at(1, 12), "end": at(1, 19)},
            "text": "",
        })],
    )
    .await
    .unwrap();
    r.diagnostics(&f, |d| d.as_array().is_some_and(Vec::is_empty))
        .await;
}

#[tokio::test]
async fn a_typed_install_failure_reaches_the_reply_and_the_status() {
    let failure = Failure::new("no_go", "gopls is not installed and `go` was not found")
        .hint("Install Go.")
        .command("brew install go");
    let r = rig(Some(failure.clone()), &[]);
    let f = r.project.join("main.go");
    std::fs::write(r.project.join("go.mod"), "module x\n").unwrap();
    std::fs::write(&f, "").unwrap();
    let f = f.to_string_lossy().into_owned();
    let rep = r.m.open(&f, "go", String::new(), 1, None).await;
    assert_eq!(rep.status, "missing");
    assert_eq!(rep.server, Some("gopls"));
    let reason = rep.reason.expect("reason");
    assert_eq!(reason.code, "no_go");
    assert_eq!(reason.command.as_deref(), Some("brew install go"));
    let st = r.m.status();
    assert_eq!(st[0].state, State::Missing);
    assert_eq!(st[0].reason.as_ref().unwrap().code, "no_go");
    assert!(st[0].log.ends_with("lsp/logs/gopls.log"), "{}", st[0].log);
}

#[tokio::test]
async fn unsupported_language_lists_what_is_supported() {
    let r = rig(None, &[]);
    let f = r.file("a.rs");
    let rep = r.m.open(&f, "brainfuck", String::new(), 1, None).await;
    assert_eq!(rep.status, "disabled");
    assert!(rep.server.is_none());
    assert!(rep.supported.contains(&"TypeScript"));
    assert!(rep.supported.contains(&"Rust"));
    assert!(rep.supported.contains(&"Go"));
}

#[tokio::test]
async fn disabled_override_never_starts_a_server() {
    let r = rig(None, &[]);
    let f = r.file("a.rs");
    let o = Overrides {
        disabled: true,
        ..Default::default()
    };
    let rep = r.m.open_with(&f, "rust", String::new(), 1, None, &o).await;
    assert_eq!(
        (rep.server, rep.status),
        (Some("rust-analyzer"), "disabled")
    );
    assert_eq!(r.m.instance_count(), 0);
}

#[tokio::test]
async fn custom_command_replaces_the_registry_server_and_reports_custom() {
    let mut r = rig(
        Some(Failure::new("install_failed", "registry must not be used")),
        &[],
    );
    let f = r.file("a.rs");
    // The "custom server" is the fake itself, launched through sh by absolute path.
    let o = Overrides {
        command: Some("/bin/sh".into()),
        args: vec!["-c".into(), format!("FAKE_SEMANTIC=1 exec '{FAKE}'")],
        ..Default::default()
    };
    let rep =
        r.m.open_with(&f, "rust", "fn z() {} // TODO".into(), 1, None, &o)
            .await;
    assert_eq!(rep.status, "ready", "{:?}", rep.reason);
    let st = r.m.status();
    assert_eq!(st[0].source, Some(Source::Custom));
    r.diagnostics(&f, |d| d.as_array().is_some_and(|a| !a.is_empty()))
        .await;
}

#[tokio::test]
async fn a_missing_custom_command_says_so_and_names_the_command() {
    let r = rig(None, &[]);
    let f = r.file("a.rs");
    let o = Overrides {
        command: Some("definitely-not-a-real-server-xyz".into()),
        ..Default::default()
    };
    let rep = r.m.open_with(&f, "rust", String::new(), 1, None, &o).await;
    assert_eq!(rep.status, "missing");
    let reason = rep.reason.unwrap();
    assert_eq!(reason.code, "custom_not_found");
    assert!(reason.message.contains("definitely-not-a-real-server-xyz"));
    assert!(reason.hint.unwrap().contains("Settings"));
}

#[tokio::test]
async fn custom_and_default_servers_for_one_root_do_not_share_an_instance() {
    let r = rig(None, &[]);
    let (a, b) = (r.file("a.rs"), r.file("b.rs"));
    let o = Overrides {
        command: Some("/bin/sh".into()),
        args: vec!["-c".into(), format!("FAKE_SEMANTIC=1 exec '{FAKE}'")],
        ..Default::default()
    };
    r.m.open(&a, "rust", String::new(), 1, None).await;
    r.m.open_with(&b, "rust", String::new(), 1, None, &o).await;
    assert_eq!(r.m.instance_count(), 2);
}

#[tokio::test]
async fn initialization_options_override_is_sent_in_initialize() {
    // `test/config` makes the fake ask the client for `workspace/configuration`; the user's
    // `settings` must be merged over Atlas's defaults in the answer.
    let r = rig(None, &[]);
    let f = r.file("a.rs");
    let o = Overrides {
        settings: Some(json!({"rust-analyzer": {"check": {"command": "check"}}})),
        ..Default::default()
    };
    r.m.open_with(&f, "rust", String::new(), 1, None, &o).await;
    let cfg = r.req(&f, "test/config", Value::Null).await;
    assert_eq!(cfg[0]["check"]["command"], "check", "{cfg}");
    assert_eq!(cfg[0]["checkOnSave"], true, "defaults survive the merge");
}

#[tokio::test]
async fn crashed_server_status_carries_its_stderr_tail() {
    let mut r = rig(None, &[("FAKE_EXIT_ON_START", "1")]);
    let f = r.file("a.rs");
    // Pre-seed the server log: the fake exits before writing, so stand in for a real stderr.
    let log = r.base.join("lsp/logs/rust-analyzer.log");
    std::fs::create_dir_all(log.parent().unwrap()).unwrap();
    std::fs::write(
        &log,
        "booting\nerror: cannot find rustc\nfatal: giving up\n",
    )
    .unwrap();
    let rep = r.m.open(&f, "rust", String::new(), 1, None).await;
    assert_eq!(rep.status, "crashed");
    assert!(rep.reason.is_some());
    // Wait for the settled status push (restart budget exhausted).
    let st = loop {
        let p = tokio::time::timeout(Duration::from_secs(10), r.rx.recv())
            .await
            .expect("status push")
            .expect("open channel");
        if let Push::Status(v) = p
            && v.iter()
                .any(|s| s.state == State::Crashed && !s.tail.is_empty())
        {
            break v;
        }
    };
    let s = &st[0];
    assert_eq!(s.tail.last().map(String::as_str), Some("fatal: giving up"));
    assert!(s.tail.iter().any(|l| l.contains("cannot find rustc")));
    let (path, text) = r.m.log("rust-analyzer", 2);
    assert_eq!(path, log);
    assert_eq!(text, "error: cannot find rustc\nfatal: giving up");
}

#[tokio::test]
async fn restart_brings_a_crashed_server_back_and_resets_the_budget() {
    let mut r = rig(None, &[]);
    let f = r.file("a.rs");
    r.m.open(&f, "rust", "fn a() {}".into(), 1, None).await;
    let before = r.m.pids();
    assert_eq!(before.len(), 1);
    assert!(r.m.restart("rust-analyzer", None).await);
    // New process, documents replayed: a semantic query works again.
    let mut ok = false;
    for _ in 0..200 {
        if r.m.pids().first().is_some_and(|p| *p != before[0]) {
            let q =
                r.m.request(
                    &f,
                    "textDocument/definition",
                    json!({"textDocument": td(&f), "position": at(0, 4)}),
                    None,
                )
                .await;
            if q.is_ok() {
                ok = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(ok, "server did not come back");
    r.diagnostics(&f, |_| true).await;
    assert!(!r.m.restart("gopls", None).await, "nothing to restart");
}

#[tokio::test]
async fn catalog_lists_every_server_with_detection_and_never_installs() {
    let r = rig(None, &[]);
    let cat = r.m.catalog().await;
    let names: Vec<_> = cat.iter().map(|c| c.name).collect();
    for n in [
        "rust-analyzer",
        "gopls",
        "typescript-language-server",
        "basedpyright",
    ] {
        assert!(names.contains(&n), "{names:?}");
    }
    let ts = cat
        .iter()
        .find(|c| c.name == "typescript-language-server")
        .unwrap();
    assert!(ts.languages.contains(&"typescript"));
    assert!(ts.language_labels.contains(&"TypeScript"));
    assert_eq!(ts.install, "npm");
    // Nothing was downloaded as a side effect.
    assert!(!r.base.join("lsp").exists());
}

#[tokio::test]
async fn uninstall_removes_only_the_managed_copy_and_stops_instances() {
    let r = rig(None, &[]);
    let f = r.file("a.rs");
    r.m.open(&f, "rust", String::new(), 1, None).await;
    let managed = r.base.join("lsp/rust-analyzer/9.9.9");
    std::fs::create_dir_all(&managed).unwrap();
    std::fs::write(managed.join("rust-analyzer"), "x").unwrap();
    assert!(r.m.uninstall("rust-analyzer").await.unwrap());
    assert!(!r.base.join("lsp/rust-analyzer").exists());
    assert_eq!(r.m.instance_count(), 0);
    assert!(r.m.pids().is_empty());
    // A second uninstall has nothing to remove; an unknown name is an error.
    assert!(!r.m.uninstall("rust-analyzer").await.unwrap());
    assert!(r.m.uninstall("nope").await.is_err());
}

#[tokio::test]
async fn explicit_install_reports_progress_and_surfaces_failure() {
    let mut r = rig(
        Some(
            Failure::new("offline", "Could not download rust-analyzer")
                .hint("Check the connection."),
        ),
        &[],
    );
    let err = r.m.install("rust-analyzer", false).await.unwrap_err();
    assert_eq!(err.code, "offline");
    // A `downloading` status with progress was pushed while it ran, then removed.
    let mut saw = false;
    while let Ok(p) = r.rx.try_recv() {
        if let Push::Status(v) = p
            && v.iter().any(|s| {
                s.name == "rust-analyzer"
                    && s.state == State::Downloading
                    && s.progress.as_deref() == Some("Downloading fake")
            })
        {
            saw = true;
        }
    }
    assert!(saw, "no downloading status with progress");
    assert!(r.m.status().iter().all(|s| s.name != "rust-analyzer"));
    assert_eq!(
        r.m.install("zzz", false).await.unwrap_err().code,
        "install_failed"
    );
}

#[tokio::test]
async fn reinstall_removes_the_managed_copy_before_resolving_again() {
    let r = rig(None, &[]);
    let managed = r.base.join("lsp/rust-analyzer/old");
    std::fs::create_dir_all(&managed).unwrap();
    std::fs::write(managed.join("rust-analyzer"), "stale").unwrap();
    r.m.install("rust-analyzer", true).await.unwrap();
    assert!(!managed.exists(), "stale managed copy survived a reinstall");
    // A plain install never deletes anything.
    std::fs::create_dir_all(&managed).unwrap();
    r.m.install("rust-analyzer", false).await.unwrap();
    assert!(managed.exists());
}
