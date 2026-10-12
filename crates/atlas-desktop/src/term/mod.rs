//! GPU terminal: one native view per tab laid over the pane, drawn by `atlas-term`.
//!
//! Per terminal, as in Ghostty: a reader task (hostd `pty_attach_raw` → `Vt`), a render
//! thread (snapshot → wgpu, woken only by new bytes or a resize), and writes (keys,
//! paste, VT replies) through the hostd connection. Clicks pass through the view to the
//! webview (`hitTest:` → nil), so focus and keyboard stay in the frontend for now.
//! Local hostd only: the raw stream is a dedicated socket connection. macOS only (AppKit view).
//!
//! This file is the registry of open terminals plus the pty/clipboard/main-thread helpers.
//! The `#[tauri::command]`s live by concern: `lifecycle` (open/bounds/close), `keys`
//! (input, scrolling, prompts), `select` (selection, links, search), `settings` (theme,
//! prefs, font, focus, stats); `render_loop`, `mac` and `shared` are the machinery.

mod keys;
mod lifecycle;
mod mac;
mod render_loop;
mod select;
mod settings;
mod shared;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, OnceLock};
use std::thread::JoinHandle;

use base64::Engine;
use parking_lot::Mutex;
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::host::HostHub;
use shared::Shared;

pub use keys::*;
pub use lifecycle::*;
pub use select::*;
pub use settings::*;

/// `terminal.*` settings for a GPU terminal (defaults when absent).
#[derive(serde::Deserialize)]
#[serde(default)]
pub struct TermPrefs {
    pub(super) font_size: f32,
    pub(super) scrollback: usize,
    /// `block` | `bar` | `underline` | `hollow`.
    pub(super) cursor_shape: String,
    pub(super) cursor_blink: bool,
    /// OSC 52 (program writes the clipboard): `allow` | `ask` | `deny`.
    pub(super) osc52: String,
    /// Programming ligatures (calt/liga).
    pub(super) ligatures: bool,
}

impl Default for TermPrefs {
    fn default() -> Self {
        Self {
            font_size: 12.5,
            scrollback: 10_000,
            cursor_shape: "block".into(),
            cursor_blink: false,
            // Ghostty's default: a program may not overwrite the clipboard unasked.
            osc52: "ask".into(),
            ligatures: true,
        }
    }
}

struct Term {
    pty: String,
    /// Retained `NSView*`; touched only on the main thread.
    view: usize,
    shared: Arc<Shared>,
    render: Option<JoinHandle<()>>,
    reader: tauri::async_runtime::JoinHandle<()>,
}

static TERMS: LazyLock<Mutex<HashMap<String, Term>>> = LazyLock::new(Default::default);
/// Set at first `term_open`; lets non-command paths (VT callbacks) reach the app.
static APP: OnceLock<AppHandle> = OnceLock::new();

fn with_term(tab: &str) -> Result<(String, Arc<Shared>), String> {
    let t = TERMS.lock();
    let t = t
        .get(tab)
        .ok_or_else(|| format!("no terminal for tab {tab}"))?;
    Ok((t.pty.clone(), t.shared.clone()))
}

/// The terminal of `tab`, or every open one when omitted.
fn targets(tab: Option<&str>) -> Result<Vec<Arc<Shared>>, String> {
    let terms = TERMS.lock();
    match tab {
        Some(t) => terms
            .get(t)
            .map(|t| vec![t.shared.clone()])
            .ok_or_else(|| format!("no terminal for tab {t}")),
        None => Ok(terms.values().map(|t| t.shared.clone()).collect()),
    }
}

/// Text → the system pasteboard (⌘C, OSC 52).
fn write_clipboard(text: &str) {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    // SAFETY: NSPasteboard general pasteboard is safe off the main thread for plain writes;
    // `NSPasteboardTypeString` is a static NSString constant.
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        pb.setString_forType(&NSString::from_str(text), NSPasteboardTypeString);
    }
}

fn write_pty(app: &AppHandle, pty: &str, bytes: &[u8]) {
    let hub = app.state::<Arc<HostHub>>().inner().clone();
    let args = json!({
        "pty": pty,
        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
    });
    tauri::async_runtime::spawn(async move {
        let _ = hub.call("pty_write", args).await;
    });
}

fn on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}
