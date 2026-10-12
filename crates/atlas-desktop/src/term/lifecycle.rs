//! Opening, moving and closing a terminal: the AppKit view, the render thread and the
//! reader task that feeds the `Vt` from hostd.

use std::sync::Arc;
use std::thread;
use std::time::Instant;

use atlas_term::colors::{Palette, Rgb as TermRgb, parse_hex};
use atlas_term::{Renderer, Stats, Vt, VtEvent};
use parking_lot::{Condvar, Mutex};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncReadExt;

use super::mac;
use super::render_loop::render_loop;
use super::shared::{BELL, Shared, State};
use super::{APP, TERMS, Term, TermPrefs, on_main, write_clipboard, write_pty};
use crate::host::HostHub;

/// Where a hidden terminal's view is parked.
const OFFSCREEN: f64 = -20_000.0;

/// `#rrggbb` fg/bg + optional 16 ANSI overrides (`null` slots keep the default).
pub(super) fn build_palette(
    fg: &str,
    bg: &str,
    ansi16: Option<&[Option<String>]>,
    min_contrast: Option<f32>,
) -> Result<Palette, String> {
    let ansi: Option<[Option<TermRgb>; 16]> = ansi16.filter(|v| v.len() >= 16).map(|v| {
        let mut a = [None; 16];
        for (slot, s) in a.iter_mut().zip(v) {
            *slot = s.as_deref().and_then(parse_hex);
        }
        a
    });
    let mut pal = Palette::new(
        parse_hex(fg).ok_or("fg: expected #rrggbb")?,
        parse_hex(bg).ok_or("bg: expected #rrggbb")?,
        ansi.as_ref(),
    );
    pal.min_contrast = min_contrast.unwrap_or(0.0);
    Ok(pal)
}

/// Open (or move) the GPU terminal for `tab` over the pane rect; `fg`/`bg` are `#rrggbb`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn term_open(
    app: AppHandle,
    tab: String,
    pty: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    fg: String,
    bg: String,
    ansi16: Option<Vec<Option<String>>>,
    min_contrast: Option<f32>,
    prefs: Option<TermPrefs>,
) -> Result<(), String> {
    if TERMS.lock().contains_key(&tab) {
        return term_bounds(app, tab, x, y, w, h, true).await;
    }
    let raw = atlas_host::client::attach_raw(&atlas_host::paths::base(), &pty, true)
        .await
        .map_err(|e| format!("GPU terminal (local terminals only): {e:#}"))?;
    let win = app.get_window("main").ok_or("no main window")?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let ns_win = win.ns_window().map_err(|e| e.to_string())? as usize;
    let pal = build_palette(&fg, &bg, ansi16.as_deref(), min_contrast)?;
    let (cols, rows) = (
        raw.info["cols"].as_u64().unwrap_or(80) as u16,
        raw.info["rows"].as_u64().unwrap_or(24) as u16,
    );
    let prefs = prefs.unwrap_or_default();
    let font_pt = prefs.font_size.clamp(6.0, 48.0);
    let (a, p, t) = (app.clone(), pty.clone(), tab.clone());
    let shared = Arc::new_cyclic(|weak: &std::sync::Weak<Shared>| {
        let weak = weak.clone();
        Shared {
            vt: Vt::new(cols, rows, move |e| match e {
                VtEvent::Write(s) => write_pty(&a, &p, s.as_bytes()),
                VtEvent::ClipboardWrite(text) => {
                    let policy = weak.upgrade().map(|s| s.osc52.lock().clone());
                    match policy.as_deref().unwrap_or("ask") {
                        "deny" => {}
                        "ask" => {
                            let _ = a.emit("term://osc52", json!({"tab": t, "text": text}));
                        }
                        _ => write_clipboard(&text),
                    }
                }
                VtEvent::Bell => {
                    if let Some(sh) = weak.upgrade() {
                        sh.update(|s| s.bell_until = Some(Instant::now() + BELL));
                    }
                    if let Some(win) = a.get_window("main")
                        && !win.is_focused().unwrap_or(true)
                    {
                        let _ = win
                            .request_user_attention(Some(tauri::UserAttentionType::Informational));
                    }
                }
                VtEvent::Cwd(cwd) => {
                    let _ = a.emit("term://cwd", json!({"tab": t, "cwd": cwd}));
                }
                VtEvent::CommandFinished(exit) => {
                    let _ = a.emit("term://command", json!({"tab": t, "exit": exit}));
                }
                // OSC 0/2 titles come from hostd (`pty_title`).
                VtEvent::Title(_) => {}
            }),
            state: Mutex::new(State {
                size: Some(((w * scale) as u32, (h * scale) as u32)),
                pal,
                pal_new: false,
                font_pt: None,
                ligatures: Some(prefs.ligatures),
                font_cur: font_pt,
                dirty: false,
                reset: false,
                closed: false,
                stats: Stats::default(),
                cell: [0.0; 2],
                focused: false,
                bell_until: None,
            }),
            osc52: Mutex::new(prefs.osc52.clone()),
            wake: Condvar::new(),
        }
    });
    shared
        .vt
        .set_options(prefs.scrollback, &prefs.cursor_shape, prefs.cursor_blink);

    // Surface creation touches the NSView/CAMetalLayer: main thread only.
    let (view, renderer) = on_main(&app, move || {
        let view = mac::create(ns_win, x, y, w, h)?;
        let ptr = std::ptr::NonNull::new(view as *mut std::ffi::c_void).ok_or("null view")?;
        let (pw, ph) = ((w * scale) as u32, (h * scale) as u32);
        // SAFETY: the view stays retained until `term_close` joins the render thread.
        match unsafe { Renderer::new(ptr, pw, ph, font_pt, scale as f32) } {
            Ok(r) => Ok((view, r)),
            Err(e) => {
                mac::destroy(view);
                Err(e)
            }
        }
    })?;
    let (sh, a, p) = (shared.clone(), app.clone(), pty.clone());
    let render = thread::Builder::new()
        .name("atlas-term-render".into())
        .spawn(move || {
            render_loop(renderer, sh, |cols, rows| {
                let hub = a.state::<Arc<HostHub>>().inner().clone();
                let args = json!({"pty": p, "cols": cols, "rows": rows});
                tauri::async_runtime::spawn(async move {
                    let _ = hub.call("pty_resize", args).await;
                });
            })
        })
        .map_err(|e| e.to_string())?;
    let sh = shared.clone();
    let reader = tauri::async_runtime::spawn(async move {
        // Bind the whole `RawPty`: precise capture would move only `reader` and drop
        // the write half here, which hostd reads as a hang-up.
        let mut raw = raw;
        let mut buf = vec![0u8; 64 * 1024];
        // EOF = the pty exited (or hostd went away); the last screen stays up.
        // `feed` follows output to the bottom of the scrollback.
        // A synchronized update (mode 2026) that never ends is flushed at its deadline.
        loop {
            let read = raw.reader.read(&mut buf);
            let n = match sh.vt.sync_deadline() {
                Some(d) => match tokio::time::timeout_at(d.into(), read).await {
                    Ok(r) => r,
                    Err(_) => {
                        sh.vt.flush_sync();
                        sh.redraw();
                        continue;
                    }
                },
                None => read.await,
            };
            let Ok(n @ 1..) = n else { break };
            sh.vt.feed(&buf[..n]);
            sh.redraw();
        }
    });
    let _ = APP.set(app.clone());
    TERMS.lock().insert(
        tab,
        Term {
            pty,
            view,
            shared,
            render: Some(render),
            reader,
        },
    );
    Ok(())
}

/// Move/resize over the pane; `visible: false` parks it offscreen.
#[tauri::command]
pub async fn term_bounds(
    app: AppHandle,
    tab: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    visible: bool,
) -> Result<(), String> {
    let (view, shared) = {
        let t = TERMS.lock();
        let t = t
            .get(&tab)
            .ok_or_else(|| format!("no terminal for tab {tab}"))?;
        (t.view, t.shared.clone())
    };
    let (vx, vy) = if visible {
        (x, y)
    } else {
        (OFFSCREEN, OFFSCREEN)
    };
    on_main(&app, move || {
        mac::set_frame(view, vx, vy, w, h);
        Ok(())
    })?;
    if visible {
        let scale = app
            .get_window("main")
            .and_then(|w| w.scale_factor().ok())
            .unwrap_or(2.0);
        shared.update(|s| s.size = Some(((w * scale) as u32, (h * scale) as u32)));
    }
    Ok(())
}

#[tauri::command]
pub async fn term_close(app: AppHandle, tab: String) -> Result<(), String> {
    let Some(mut t) = TERMS.lock().remove(&tab) else {
        return Ok(());
    };
    t.reader.abort();
    t.shared.update(|s| s.closed = true);
    // The surface must be gone before its view is released.
    if let Some(r) = t.render.take() {
        let _ = r.join();
    }
    on_main(&app, move || {
        mac::destroy(t.view);
        Ok(())
    })?;
    Ok(())
}
