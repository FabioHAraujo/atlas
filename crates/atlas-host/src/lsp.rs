//! hostd's side of the `lsp_*` commands: thin glue between the wire protocol and
//! [`atlas_lsp::Manager`], plus the pump that fans manager pushes out to every connection.

use std::path::Path;
use std::sync::Weak;

use atlas_lsp::Push;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::protocol::HostCmd;
use crate::server::Hub;

fn rpc_err(e: atlas_lsp::rpc::RpcError) -> String {
    e.to_string()
}

fn abs(path: &str) -> Result<(), String> {
    if Path::new(path).is_absolute() {
        Ok(())
    } else {
        Err(format!("path must be absolute: {path}"))
    }
}

/// Handle one `lsp_*` command. `None`: not an LSP command.
pub(crate) async fn handle(hub: &Hub, cmd: HostCmd, conn_id: u64) -> Option<Result<Value, String>> {
    let lsp = &hub.lsp;
    Some(match cmd {
        HostCmd::LspOpen {
            path,
            language_id,
            text,
            version,
        } => {
            if let Err(e) = abs(&path) {
                return Some(Err(e));
            }
            // No marker found: the file's own directory. The desktop opens projects at
            // worktree roots, which carry a marker for every language that matters.
            hub.lsp_docs.lock().insert(path.clone(), conn_id);
            let r = lsp.open(&path, &language_id, text, version, None).await;
            Ok(json!({"server": r.server, "status": r.status, "capabilities": r.capabilities}))
        }
        HostCmd::LspChange {
            path,
            version,
            changes,
        } => lsp
            .change(&path, version, changes)
            .await
            .map(|()| json!({}))
            .map_err(|e| format!("{e:#}")),
        HostCmd::LspClose { path } => {
            hub.lsp_docs.lock().remove(&path);
            lsp.close(&path).await;
            Ok(json!({}))
        }
        HostCmd::LspSave { path, text } => lsp
            .save(&path, text)
            .await
            .map(|()| json!({}))
            .map_err(|e| format!("{e:#}")),
        HostCmd::LspRequest {
            path,
            method,
            params,
            rid,
        } => lsp
            .request(&path, &method, params, rid)
            .await
            .map_err(rpc_err),
        HostCmd::LspCancel { id } => {
            lsp.cancel(&id).await;
            Ok(json!({}))
        }
        HostCmd::LspStatus {} => Ok(json!({"servers": lsp.status()})),
        HostCmd::LspApplyEditResult { id, applied } => {
            lsp.apply_edit_result(&id, applied);
            Ok(json!({}))
        }
        _ => return None,
    })
}

/// A connection ended: close the documents it still owns (it never sent `lsp_close`).
pub(crate) async fn connection_closed(hub: &Hub, conn_id: u64) {
    let orphans: Vec<String> = {
        let mut docs = hub.lsp_docs.lock();
        let paths: Vec<String> = docs
            .iter()
            .filter(|(_, c)| **c == conn_id)
            .map(|(p, _)| p.clone())
            .collect();
        for p in &paths {
            docs.remove(p);
        }
        paths
    };
    for p in orphans {
        hub.lsp.close(&p).await;
    }
}

/// Forward manager pushes to every connection. Holds the hub weakly so it ends with it.
pub(crate) async fn pump(hub: Weak<Hub>, mut rx: mpsc::Receiver<Push>) {
    while let Some(p) = rx.recv().await {
        let Some(hub) = hub.upgrade() else { return };
        let line = match p {
            Push::Diagnostics {
                path,
                version,
                diagnostics,
            } => {
                json!({"ev": "lsp_diagnostics", "path": path, "version": version, "diagnostics": diagnostics})
            }
            Push::Status(servers) => json!({"ev": "lsp_status", "servers": servers}),
            Push::ApplyEdit { id, edit } => json!({"ev": "lsp_apply_edit", "id": id, "edit": edit}),
        };
        hub.broadcast(line.to_string());
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use serde_json::{Value, json};

    use crate::client::HostClient;
    use crate::{paths, server};

    /// A shell "language server": answers `initialize`, then publishes one diagnostic per
    /// `didOpen` and echoes `test/echo`. Enough to exercise hostd's wire layer for real.
    const FAKE: &str = r#"#!/bin/sh
send() { printf 'Content-Length: %s\r\n\r\n%s' "${#1}" "$1"; }
while IFS= read -r line; do
  line=${line%?}
  case "$line" in
    Content-Length:*) len=${line#Content-Length: }; IFS= read -r _; body=$(dd bs=1 count="$len" 2>/dev/null)
      case "$body" in
        *'"method":"initialize"'*) id=${body#*\"id\":}; id=${id%%,*}
          send "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":{\"capabilities\":{\"textDocumentSync\":2,\"hoverProvider\":true}}}";;
        *'"method":"textDocument/didOpen"'*)
          uri=${body#*\"uri\":\"}; uri=${uri%%\"*}
          send "{\"jsonrpc\":\"2.0\",\"method\":\"textDocument/publishDiagnostics\",\"params\":{\"uri\":\"$uri\",\"version\":1,\"diagnostics\":[{\"message\":\"boom\",\"range\":{\"start\":{\"line\":0,\"character\":0},\"end\":{\"line\":0,\"character\":1}}}]}}";;
        *'"method":"test/echo"'*) id=${body#*\"id\":}; id=${id%%,*}
          send "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":\"pong\"}";;
        *'"method":"shutdown"'*) id=${body#*\"id\":}; id=${id%%,*}
          send "{\"jsonrpc\":\"2.0\",\"id\":$id,\"result\":null}";;
        *'"method":"exit"'*) exit 0;;
      esac;;
  esac
done
"#;

    #[tokio::test]
    async fn lsp_commands_and_pushes_over_the_wire() {
        let tmp = tempfile::tempdir().unwrap();
        // The registry resolves `rust-analyzer` from PATH first (probing `--version`).
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let ra = bin.join("rust-analyzer");
        std::fs::write(
            &ra,
            format!(
                "#!/bin/sh\n[ \"$1\" = --version ] && {{ echo fake 1; exit 0; }}\n{}",
                &FAKE[FAKE.find('\n').unwrap() + 1..]
            ),
        )
        .unwrap();
        std::fs::set_permissions(&ra, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = format!("{}:/usr/bin:/bin", bin.display());
        // SAFETY: set before the server starts; this test owns the process env for PATH.
        unsafe { std::env::set_var("PATH", &path) };

        let dir = tmp.path().join("hostd");
        let d2 = dir.clone();
        let srv = tokio::spawn(async move { server::serve(&d2).await });
        let client = loop {
            if let Ok(c) = HostClient::connect_dir(&dir, "test").await {
                break c;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        let info = client.call("info", json!({})).await.unwrap();
        assert!(info["caps"].as_array().unwrap().iter().any(|c| c == "lsp"));

        let proj = tmp.path().join("p");
        std::fs::create_dir_all(proj.join("src")).unwrap();
        std::fs::write(proj.join("Cargo.toml"), "[package]\n").unwrap();
        let file = proj.join("src/lib.rs").to_string_lossy().into_owned();
        let mut events = client.events();

        let r = client
            .call(
                "lsp_open",
                json!({"path": file, "language_id": "rust", "text": "fn x(){}", "version": 1}),
            )
            .await
            .unwrap();
        assert_eq!(r["status"], "ready");
        assert_eq!(r["server"], "rust-analyzer");
        assert_eq!(r["capabilities"]["hoverProvider"], true);

        let mut diag = None;
        let mut statuses = 0;
        tokio::time::timeout(Duration::from_secs(10), async {
            while diag.is_none() {
                let ev = events.recv().await.unwrap();
                match ev["ev"].as_str() {
                    Some("lsp_diagnostics") => diag = Some(ev),
                    Some("lsp_status") => statuses += 1,
                    _ => {}
                }
            }
        })
        .await
        .expect("no diagnostics push");
        let d = diag.unwrap();
        assert_eq!(d["path"], file.as_str());
        assert_eq!(d["diagnostics"][0]["message"], "boom");
        assert!(statuses >= 1, "status push before ready");

        let pong = client
            .call(
                "lsp_request",
                json!({"path": file, "method": "test/echo", "params": {}}),
            )
            .await
            .unwrap();
        assert_eq!(pong, "pong");
        let caps = client
            .call(
                "lsp_request",
                json!({"path": file, "method": "$/capabilities"}),
            )
            .await
            .unwrap();
        assert_eq!(caps["textDocumentSync"], 2);
        let st = client.call("lsp_status", json!({})).await.unwrap();
        assert_eq!(st["servers"][0]["state"], "ready");

        // errors are replies, not disconnects
        let e = client
            .call(
                "lsp_request",
                json!({"path": "/not/open.rs", "method": "x"}),
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("not open"), "{e}");
        let e = client
            .call(
                "lsp_open",
                json!({"path": "relative.rs", "language_id": "rust", "text": ""}),
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("absolute"), "{e}");
        let none = client
            .call(
                "lsp_open",
                json!({"path": file, "language_id": "klingon", "text": ""}),
            )
            .await
            .unwrap();
        assert_eq!(
            (none["server"].clone(), none["status"].clone()),
            (Value::Null, json!("disabled"))
        );

        // A dropped connection's documents are closed; the new owner of a re-opened one is
        // the connection that re-opened it.
        let other = proj.join("src/other.rs").to_string_lossy().into_owned();
        let c2 = HostClient::connect_dir(&dir, "test2").await.unwrap();
        for p in [&other, &file] {
            let open = json!({"path": p, "language_id": "rust", "text": "", "version": 1});
            c2.call("lsp_open", open).await.unwrap();
        }
        drop(c2); // no lsp_close: hostd must close both
        for p in [&other, &file] {
            let mut closed = false;
            for _ in 0..100 {
                let q = json!({"path": p, "method": "$/capabilities"});
                if client.call("lsp_request", q).await.is_err() {
                    closed = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            assert!(closed, "{p} still open after its connection dropped");
        }
        // re-opening on the first connection owns it again and survives
        let open = json!({"path": file, "language_id": "rust", "text": "", "version": 1});
        client.call("lsp_open", open).await.unwrap();
        let q = json!({"path": file, "method": "$/capabilities"});
        client.call("lsp_request", q).await.unwrap();
        client
            .call("lsp_close", json!({"path": file}))
            .await
            .unwrap();
        client.call("shutdown", json!({})).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), srv)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(!paths::socket(&dir).exists());
    }
}
