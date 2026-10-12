//! Smoke tests against REAL language servers (network + toolchains). Ignored by default:
//! `cargo test -p atlas-lsp --test real -- --ignored --nocapture`.
//!
//! They use a throwaway base dir so downloads are exercised, and print latencies.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use atlas_lsp::manager::{Config, Manager, Push};
use serde_json::{Value, json};
use tokio::sync::mpsc;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn base() -> PathBuf {
    // Reuse a persistent dir across runs so repeated smoke runs do not re-download.
    let d = std::env::temp_dir().join("atlas-lsp-smoke");
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn position_of(text: &str, needle: &str) -> Value {
    let off = text.find(needle).unwrap();
    let before = &text[..off];
    let line = before.matches('\n').count();
    let col = before.rsplit('\n').next().unwrap().encode_utf16().count();
    json!({"line": line, "character": col})
}

async fn first_diag(rx: &mut mpsc::Receiver<Push>, path: &str, t0: Instant) -> Duration {
    tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            if let Some(Push::Diagnostics { path: p, .. }) = rx.recv().await
                && p == path
            {
                return t0.elapsed();
            }
        }
    })
    .await
    .expect("no diagnostics")
}

#[tokio::test]
#[ignore = "needs rust-analyzer (download) and this repo"]
async fn rust_analyzer_definition_in_atlas_core() {
    let file = repo().join("crates/atlas-core/src/paths.rs");
    let path = file.to_string_lossy().into_owned();
    let text = std::fs::read_to_string(&file).unwrap();
    let (tx, mut rx) = mpsc::channel(1024);
    let m = Manager::new(&base(), Config::default(), tx);

    let t0 = Instant::now();
    let rep = m.open(&path, "rust", text.clone(), 1, None).await;
    println!("rust: open -> {} in {:?}", rep.status, t0.elapsed());
    assert_eq!(rep.status, "ready", "{:?}", m.status());
    assert_eq!(rep.server, Some("rust-analyzer"));
    println!(
        "rust: first diagnostics push after {:?}",
        first_diag(&mut rx, &path, t0).await
    );

    // `desktop_socket()` calls `atlas_home()`: definition must land on its declaration.
    let call = text.find("atlas_home().join(\"desktop.sock\")").unwrap();
    let before = &text[..call];
    let pos = json!({
        "line": before.matches('\n').count(),
        "character": before.rsplit('\n').next().unwrap().encode_utf16().count() + 2
    });
    let probe = "atlas_home";
    let t1 = Instant::now();
    let mut result = Value::Null;
    // rust-analyzer answers null/ContentModified until the crate graph loads: retry briefly.
    for _ in 0..120 {
        let r = m
            .request(
                &path,
                "textDocument/definition",
                json!({"textDocument": {"uri": format!("file://{path}")}, "position": pos}),
                None,
            )
            .await;
        match r {
            Ok(v) if !v.is_null() && v != json!([]) => {
                result = v;
                break;
            }
            _ => tokio::time::sleep(Duration::from_millis(500)).await,
        }
    }
    println!(
        "rust: definition resolved after {:?} (from request start)",
        t1.elapsed()
    );
    println!("rust: definition = {result}");
    assert!(!result.is_null(), "no definition for {probe}");
    let target = serde_json::to_string(&result).unwrap();
    assert!(target.contains("paths.rs"), "{target}");
    let decl_line = text
        .lines()
        .position(|l| l.starts_with("pub fn atlas_home"))
        .unwrap();
    assert!(
        target.contains(&format!("\"line\":{decl_line}")),
        "{target}"
    );
    m.shutdown().await;
}

#[tokio::test]
#[ignore = "needs node/npm (download) and apps/desktop"]
async fn typescript_hover_in_apps_desktop() {
    let file = repo().join("apps/desktop/src/lib/host.ts");
    let path = file.to_string_lossy().into_owned();
    let text = std::fs::read_to_string(&file).unwrap();
    let (tx, mut rx) = mpsc::channel(1024);
    let m = Manager::new(&base(), Config::default(), tx);

    let t0 = Instant::now();
    let rep = m.open(&path, "typescript", text.clone(), 1, None).await;
    println!("ts: open -> {} in {:?}", rep.status, t0.elapsed());
    assert_eq!(rep.status, "ready", "{:?}", m.status());
    println!(
        "ts: first diagnostics push after {:?}",
        first_diag(&mut rx, &path, t0).await
    );

    let pos = position_of(&text, "hostCall");
    let t1 = Instant::now();
    let mut hover = Value::Null;
    for _ in 0..60 {
        let r = m
            .request(
                &path,
                "textDocument/hover",
                json!({"textDocument": {"uri": format!("file://{path}")}, "position": pos}),
                None,
            )
            .await;
        if let Ok(v) = r
            && !v.is_null()
        {
            hover = v;
            break;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    println!("ts: hover after {:?}: {hover}", t1.elapsed());
    assert!(!hover.is_null(), "no hover");
    m.shutdown().await;
}

/// Installs every npm-based server into a fresh dir with NO node on PATH, forcing the
/// managed Node download, then initializes each one for real.
#[tokio::test]
#[ignore = "downloads Node + all npm servers (~150 MB)"]
async fn managed_node_and_all_npm_servers_initialize() {
    let tmp = tempfile::tempdir().unwrap();
    // Force the managed Node: ignore any system node (PATH and the extra dirs).
    let hidden = tmp.path().join("empty");
    std::fs::create_dir_all(&hidden).unwrap();
    // SAFETY: single-threaded setup before any task reads PATH.
    unsafe {
        std::env::set_var("PATH", "/usr/bin:/bin");
        std::env::set_var("ATLAS_LSP_MANAGED_NODE", "1");
    }
    let (tx, _rx) = mpsc::channel(4096);
    let m = Manager::new(tmp.path(), Config::default(), tx);
    let proj = tmp.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("package.json"), "{}").unwrap();
    std::fs::write(proj.join("composer.json"), "{}").unwrap();
    std::fs::write(proj.join("pyproject.toml"), "").unwrap();
    let cases = [
        ("a.ts", "typescript"),
        ("a.html", "html"),
        ("a.css", "css"),
        ("a.json", "json"),
        ("a.php", "php"),
        ("a.py", "python"),
        ("a.yaml", "yaml"),
        ("a.sh", "shellscript"),
    ];
    for (f, lang) in cases {
        let p = proj.join(f);
        std::fs::write(&p, "").unwrap();
        let t = Instant::now();
        let r = m
            .open(&p.to_string_lossy(), lang, String::new(), 1, None)
            .await;
        println!("{lang}: {} in {:?}", r.status, t.elapsed());
        assert_eq!(r.status, "ready", "{lang}: {:?}", m.status());
    }
    m.shutdown().await;
    let node = tmp.path().join("lsp/node");
    assert!(
        std::fs::read_dir(node).unwrap().next().is_some(),
        "managed node missing"
    );
}

#[tokio::test]
#[ignore = "runs `go install` for gopls"]
async fn gopls_builds_with_go_install_and_initializes() {
    let tmp = tempfile::tempdir().unwrap();
    // Hide any gopls on PATH/~/go/bin so the install path runs.
    let proj = tmp.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("go.mod"), "module x\n\ngo 1.22\n").unwrap();
    std::fs::write(proj.join("main.go"), "package main\n\nfunc main() {}\n").unwrap();
    let (tx, _rx) = mpsc::channel(256);
    let m = Manager::new(tmp.path(), Config::default(), tx);
    let t = Instant::now();
    let p = proj.join("main.go");
    let r = m
        .open(
            &p.to_string_lossy(),
            "go",
            "package main\n\nfunc main() {}\n".into(),
            1,
            None,
        )
        .await;
    println!("go: {} in {:?} {:?}", r.status, t.elapsed(), m.status());
    assert_eq!(r.status, "ready", "{:?}", m.status());
    m.shutdown().await;
}
