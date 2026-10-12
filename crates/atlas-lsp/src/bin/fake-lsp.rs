//! A tiny scriptable language server for the manager's behavior tests (not shipped).
//!
//! Behaviors, all driven by the protocol itself:
//! - `initialize` → capabilities with incremental sync (`FAKE_SYNC=full|none` changes it).
//! - `textDocument/didOpen|didChange` → `publishDiagnostics` carrying the doc version and
//!   the number of `didChange` events seen, so tests can observe sync.
//! - requests: `test/echo` → params, `test/slow` → never answers until `$/cancelRequest`
//!   (then records it), `test/state` → what the server observed so far, `test/pid`,
//!   `test/applyEdit` → asks the client to apply an edit and reports the answer,
//!   `test/crash` → exits(1) immediately.
//! - Every spawn increments a counter file when `FAKE_COUNT_FILE` is set, so tests can
//!   count restarts.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};

use serde_json::{Value, json};

fn read_msg(r: &mut impl BufRead) -> Option<Value> {
    let mut len = 0usize;
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).ok()? == 0 {
            return None;
        }
        let l = l.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some(v) = l.strip_prefix("Content-Length: ") {
            len = v.parse().ok()?;
        }
    }
    let mut b = vec![0; len];
    std::io::Read::read_exact(r, &mut b).ok()?;
    serde_json::from_slice(&b).ok()
}

fn send(v: &Value) {
    let s = v.to_string();
    let mut o = std::io::stdout().lock();
    let _ = write!(o, "Content-Length: {}\r\n\r\n{}", s.len(), s);
    let _ = o.flush();
}

fn main() {
    if let Ok(p) = std::env::var("FAKE_COUNT_FILE") {
        let n: u32 = std::fs::read_to_string(&p)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        let _ = std::fs::write(&p, (n + 1).to_string());
    }
    if std::env::var("FAKE_EXIT_ON_START").is_ok() {
        std::process::exit(3);
    }
    let sync = match std::env::var("FAKE_SYNC").as_deref() {
        Ok("full") => 1,
        Ok("none") => 0,
        _ => 2,
    };
    let mut r = BufReader::new(std::io::stdin().lock());
    let mut versions: HashMap<String, i64> = HashMap::new();
    let mut texts: HashMap<String, String> = HashMap::new();
    let mut changes = 0u64;
    let mut cancelled: Vec<i64> = vec![];
    let mut change_log: Vec<Value> = vec![];
    let mut next_server_id = 1000;
    let mut edit_waiters: HashMap<i64, i64> = HashMap::new(); // our request id → client id

    while let Some(m) = read_msg(&mut r) {
        let method = m.get("method").and_then(Value::as_str).unwrap_or("");
        let id = m.get("id").cloned();
        let params = m.get("params").cloned().unwrap_or(Value::Null);
        match (method, id) {
            ("initialize", Some(id)) => send(&json!({"jsonrpc":"2.0","id":id,"result":{
                "capabilities": {
                    "textDocumentSync": {"openClose": true, "change": sync, "save": {"includeText": true}},
                    "hoverProvider": true,
                    "renameProvider": {"prepareProvider": true}
                },
                "serverInfo": {"name": "fake-lsp"}
            }})),
            ("shutdown", Some(id)) => send(&json!({"jsonrpc":"2.0","id":id,"result":null})),
            ("exit", _) => std::process::exit(0),
            ("textDocument/didOpen", _) => {
                let td = &params["textDocument"];
                let uri = td["uri"].as_str().unwrap_or("").to_string();
                versions.insert(uri.clone(), td["version"].as_i64().unwrap_or(0));
                texts.insert(uri.clone(), td["text"].as_str().unwrap_or("").into());
                diag(&uri, &versions, changes, &texts);
            }
            ("textDocument/didChange", _) => {
                let uri = params["textDocument"]["uri"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                versions.insert(
                    uri.clone(),
                    params["textDocument"]["version"].as_i64().unwrap_or(0),
                );
                changes += 1;
                change_log.push(params["contentChanges"].clone());
                diag(&uri, &versions, changes, &texts);
            }
            ("textDocument/didClose", _) => {
                let uri = params["textDocument"]["uri"].as_str().unwrap_or("");
                versions.remove(uri);
            }
            ("$/cancelRequest", _) => cancelled.push(params["id"].as_i64().unwrap_or(-1)),
            ("test/echo", Some(id)) => send(&json!({"jsonrpc":"2.0","id":id,"result":params})),
            ("test/slow", Some(_)) => {} // answered only by the client giving up
            ("test/pid", Some(id)) => {
                send(&json!({"jsonrpc":"2.0","id":id,"result":std::process::id()}))
            }
            ("test/state", Some(id)) => send(&json!({"jsonrpc":"2.0","id":id,"result":{
                "open": versions.keys().collect::<Vec<_>>(),
                "changes": changes,
                "cancelled": cancelled,
                "change_log": change_log,
                "texts": texts,
            }})),
            ("test/crash", _) => std::process::exit(1),
            ("test/applyEdit", Some(id)) => {
                next_server_id += 1;
                edit_waiters.insert(next_server_id, id.as_i64().unwrap_or(0));
                send(
                    &json!({"jsonrpc":"2.0","id":next_server_id,"method":"workspace/applyEdit",
                    "params":{"edit":{"changes":{"file:///x":[]}}}}),
                );
            }
            ("test/config", Some(id)) => {
                next_server_id += 1;
                edit_waiters.insert(next_server_id, id.as_i64().unwrap_or(0));
                send(
                    &json!({"jsonrpc":"2.0","id":next_server_id,"method":"workspace/configuration",
                    "params":{"items":[{"section":"rust-analyzer"}]}}),
                );
            }
            (_, Some(id)) if method.is_empty() => {
                // response to one of our requests: forward to the waiting client request
                if let Some(cid) = id.as_i64().and_then(|i| edit_waiters.remove(&i)) {
                    send(
                        &json!({"jsonrpc":"2.0","id":cid,"result":m.get("result").cloned().unwrap_or(Value::Null)}),
                    );
                }
            }
            (_, Some(id)) => {
                send(&json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"unknown"}}))
            }
            _ => {}
        }
    }
}

fn diag(uri: &str, versions: &HashMap<String, i64>, changes: u64, texts: &HashMap<String, String>) {
    send(
        &json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{
            "uri": uri,
            "version": versions.get(uri),
            "diagnostics": [{
                "range": {"start":{"line":0,"character":0},"end":{"line":0,"character":1}},
                "message": format!("v{} changes={} len={}", versions.get(uri).copied().unwrap_or(-1), changes, texts.get(uri).map_or(0, String::len)),
                "severity": 2
            }]
        }}),
    );
}
