//! What we tell servers about the client, and the settings we answer `workspace/configuration`
//! with.

use serde_json::{Value, json};

/// `initialize` params. Positions are UTF-16 (the LSP default and what the editor computes).
pub fn initialize_params(root: &str, name: &str, init_options: Value) -> Value {
    let kinds = |k: &[i64]| k.to_vec();
    json!({
        "processId": std::process::id(),
        "clientInfo": {"name": "atlas", "version": env!("CARGO_PKG_VERSION")},
        "locale": "en",
        "rootUri": uri_from_path(root),
        "rootPath": root,
        "workspaceFolders": [{"uri": uri_from_path(root), "name": name}],
        "initializationOptions": init_options,
        "trace": "off",
        "capabilities": {
            "general": {"positionEncodings": ["utf-16"], "markdown": {"parser": "marked"}},
            "window": {
                "workDoneProgress": true,
                "showMessage": {"messageActionItem": {"additionalPropertiesSupport": false}},
                "showDocument": {"support": false}
            },
            "workspace": {
                "applyEdit": true,
                "workspaceEdit": {
                    "documentChanges": true,
                    "resourceOperations": ["create", "rename", "delete"],
                    "failureHandling": "abort",
                    "normalizesLineEndings": false
                },
                "didChangeConfiguration": {"dynamicRegistration": false},
                "didChangeWatchedFiles": {"dynamicRegistration": false},
                "symbol": {
                    "dynamicRegistration": false,
                    "symbolKind": {"valueSet": kinds(&(1..=26).collect::<Vec<_>>())}
                },
                "configuration": true,
                "workspaceFolders": true,
                "inlayHint": {"refreshSupport": false},
                "diagnostics": {"refreshSupport": false}
            },
            "textDocument": {
                "synchronization": {
                    "dynamicRegistration": false,
                    "willSave": false,
                    "willSaveWaitUntil": false,
                    "didSave": true
                },
                "completion": {
                    "dynamicRegistration": false,
                    "contextSupport": true,
                    "insertTextMode": 2,
                    "completionItem": {
                        "snippetSupport": true,
                        "commitCharactersSupport": true,
                        "documentationFormat": ["markdown", "plaintext"],
                        "deprecatedSupport": true,
                        "preselectSupport": true,
                        "insertReplaceSupport": true,
                        "labelDetailsSupport": true,
                        "tagSupport": {"valueSet": [1]},
                        "resolveSupport": {
                            "properties": ["documentation", "detail", "additionalTextEdits", "command"]
                        },
                        "insertTextModeSupport": {"valueSet": [1, 2]}
                    },
                    "completionItemKind": {"valueSet": kinds(&(1..=25).collect::<Vec<_>>())},
                    "completionList": {
                        "itemDefaults": ["commitCharacters", "editRange", "insertTextFormat", "insertTextMode", "data"]
                    }
                },
                "hover": {"dynamicRegistration": false, "contentFormat": ["markdown", "plaintext"]},
                "signatureHelp": {
                    "dynamicRegistration": false,
                    "contextSupport": true,
                    "signatureInformation": {
                        "documentationFormat": ["markdown", "plaintext"],
                        "parameterInformation": {"labelOffsetSupport": true},
                        "activeParameterSupport": true
                    }
                },
                "declaration": {"dynamicRegistration": false, "linkSupport": true},
                "definition": {"dynamicRegistration": false, "linkSupport": true},
                "typeDefinition": {"dynamicRegistration": false, "linkSupport": true},
                "implementation": {"dynamicRegistration": false, "linkSupport": true},
                "references": {"dynamicRegistration": false},
                "documentHighlight": {"dynamicRegistration": false},
                "documentSymbol": {
                    "dynamicRegistration": false,
                    "hierarchicalDocumentSymbolSupport": true,
                    "symbolKind": {"valueSet": kinds(&(1..=26).collect::<Vec<_>>())},
                    "tagSupport": {"valueSet": [1]}
                },
                "codeAction": {
                    "dynamicRegistration": false,
                    "isPreferredSupport": true,
                    "disabledSupport": true,
                    "dataSupport": true,
                    "honorsChangeAnnotations": false,
                    "resolveSupport": {"properties": ["edit", "command"]},
                    "codeActionLiteralSupport": {
                        "codeActionKind": {
                            "valueSet": [
                                "", "quickfix", "refactor", "refactor.extract", "refactor.inline",
                                "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"
                            ]
                        }
                    }
                },
                "formatting": {"dynamicRegistration": false},
                "rangeFormatting": {"dynamicRegistration": false},
                "rename": {
                    "dynamicRegistration": false,
                    "prepareSupport": true,
                    "prepareSupportDefaultBehavior": 1
                },
                "publishDiagnostics": {
                    "relatedInformation": true,
                    "tagSupport": {"valueSet": [1, 2]},
                    "versionSupport": true,
                    "codeDescriptionSupport": true,
                    "dataSupport": true
                },
                "inlayHint": {
                    "dynamicRegistration": false,
                    "resolveSupport": {"properties": ["tooltip", "textEdits", "label.tooltip", "label.location", "label.command"]}
                },
                "foldingRange": {"dynamicRegistration": false, "lineFoldingOnly": true},
                "selectionRange": {"dynamicRegistration": false}
            }
        }
    })
}

pub fn uri_from_path(path: &str) -> String {
    let mut out = String::from("file://");
    for b in path.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// `file://` URI → absolute path (percent-decoded). `None` for other schemes.
pub fn path_from_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(v) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?, 16)
        {
            out.push(v);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Initialization options per server (sent in `initialize`).
pub fn init_options(server: &str) -> Value {
    match server {
        "typescript-language-server" => json!({
            "hostInfo": "atlas",
            "preferences": {
                "includeCompletionsForModuleExports": true,
                "includeCompletionsWithInsertText": true,
                "includeInlayParameterNameHints": "literals",
                "includeInlayVariableTypeHints": false
            }
        }),
        "intelephense" => json!({"clearCache": false, "licenceKey": ""}),
        "vscode-html-language-server" | "vscode-css-language-server" => json!({
            "provideFormatter": true,
            "embeddedLanguages": {"css": true, "javascript": true}
        }),
        "vscode-json-language-server" => json!({"provideFormatter": true}),
        _ => Value::Null,
    }
}

/// Answer for one `workspace/configuration` item. `section` is e.g. `rust-analyzer` or
/// `python.analysis`; unknown sections get `null` (the spec's "no value").
pub fn configuration(server: &str, section: Option<&str>) -> Value {
    let sect = section.unwrap_or("");
    match server {
        "rust-analyzer" => {
            let all = json!({
                "checkOnSave": true,
                "check": {"command": "clippy"},
                "cargo": {"buildScripts": {"enable": true}},
                "procMacro": {"enable": true},
                "inlayHints": {
                    "typeHints": {"enable": true},
                    "parameterHints": {"enable": true},
                    "chainingHints": {"enable": true}
                },
                "completion": {"callable": {"snippets": "fill_arguments"}}
            });
            match sect {
                "rust-analyzer" | "" => all,
                s => s
                    .strip_prefix("rust-analyzer.")
                    .and_then(|k| dig(&all, k))
                    .unwrap_or(Value::Null),
            }
        }
        "gopls" => json!({
            "gofumpt": false, "staticcheck": true, "usePlaceholders": true,
            "completeUnimported": true, "hints": {"parameterNames": true, "assignVariableTypes": true}
        }),
        "basedpyright" => match sect {
            "python.analysis" | "basedpyright.analysis" => {
                json!({"typeCheckingMode": "standard", "autoSearchPaths": true, "useLibraryCodeForTypes": true, "diagnosticMode": "openFilesOnly"})
            }
            "python" => json!({"analysis": {"autoSearchPaths": true}}),
            _ => Value::Null,
        },
        "intelephense" => json!({"files": {"maxSize": 5_000_000}}),
        "typescript-language-server" => Value::Null,
        "vscode-html-language-server"
        | "vscode-css-language-server"
        | "vscode-json-language-server" => match sect {
            "html" => {
                json!({"format": {"enable": true}, "autoClosingTags": true, "validate": {"scripts": true, "styles": true}})
            }
            "css" | "scss" | "less" => json!({"validate": true, "lint": {}}),
            "json" => json!({"validate": {"enable": true}, "format": {"enable": true}}),
            "http" => json!({"proxy": ""}),
            _ => Value::Null,
        },
        "yaml-language-server" => match sect {
            "yaml" => {
                json!({"validate": true, "format": {"enable": true}, "completion": true, "hover": true})
            }
            _ => Value::Null,
        },
        "bash-language-server" => json!({"globPattern": "**/*@(.sh|.inc|.bash|.command)"}),
        _ => Value::Null,
    }
}

fn dig(v: &Value, dotted: &str) -> Option<Value> {
    dotted.split('.').try_fold(v, |cur, k| cur.get(k)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_roundtrip_with_special_characters() {
        for p in ["/a/b.rs", "/with space/ü/日本.rs", "/p/100%/a#b?c.ts"] {
            let u = uri_from_path(p);
            assert!(u.starts_with("file:///"));
            assert!(!u.contains(' ') && !u.contains('#') && !u.contains('?'));
            assert_eq!(path_from_uri(&u).as_deref(), Some(p));
        }
        assert_eq!(path_from_uri("untitled:Untitled-1"), None);
        assert_eq!(path_from_uri("file:///a%2"), Some("/a%2".into()));
    }

    #[test]
    fn rust_analyzer_config_sections() {
        assert_eq!(
            configuration("rust-analyzer", Some("rust-analyzer"))["checkOnSave"],
            true
        );
        assert_eq!(
            configuration("rust-analyzer", Some("rust-analyzer.check.command")),
            "clippy"
        );
        assert_eq!(
            configuration("rust-analyzer", Some("rust-analyzer.nope")),
            Value::Null
        );
        assert_eq!(configuration("unknown", Some("x")), Value::Null);
    }

    #[test]
    fn initialize_advertises_utf16_and_core_features() {
        let p = initialize_params("/r", "r", Value::Null);
        assert_eq!(
            p["capabilities"]["general"]["positionEncodings"],
            json!(["utf-16"])
        );
        let td = &p["capabilities"]["textDocument"];
        assert_eq!(td["completion"]["completionItem"]["snippetSupport"], true);
        assert_eq!(td["rename"]["prepareSupport"], true);
        assert_eq!(
            td["documentSymbol"]["hierarchicalDocumentSymbolSupport"],
            true
        );
        assert_eq!(td["definition"]["linkSupport"], true);
        assert_eq!(p["rootUri"], "file:///r");
    }
}
