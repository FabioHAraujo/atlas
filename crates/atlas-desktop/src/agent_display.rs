//! The one virtual display of an agent instance, and the parking of its window on it. Pure policy is in
//! `agent_mode.rs`, the display's lifecycle in `display_mac.rs`; this is the glue that owns it for the process.

use std::sync::LazyLock;

use objc2::msg_send;
use objc2::runtime::AnyObject;
use tauri::AppHandle;

use crate::agent_mode::{Rect, window_origin};
use crate::display_mac::{Cg, Display};

/// Logical size of the agent display: the app's default window size, so a window fills it.
const LOGICAL: (u32, u32) = (1280, 820);

/// Kept for the life of the process: the display exists exactly as long as this instance does. A clean exit, a panic
/// and a SIGKILL all end the process, and the OS removes a virtual display with its owner.
static DISPLAY: LazyLock<parking_lot::Mutex<Option<Display<Cg>>>> =
    LazyLock::new(|| parking_lot::Mutex::new(None));

/// Create the display once. Errors are returned, never papered over: an agent instance without its display must not
/// fall back to the user's monitors.
pub fn ensure() -> Result<(u32, Rect), String> {
    let mut g = DISPLAY.lock();
    if g.is_none() {
        let scale =
            crate::agent_mode::scale_from(std::env::var("ATLAS_AGENT_SCALE").ok().as_deref());
        *g = Some(Display::create(Cg::new(), LOGICAL, scale)?);
    }
    let d = g.as_ref().expect("just created");
    Ok((d.id, d.bounds))
}

/// The window's frame now, in global top-left points (AppKit reports bottom-left; `primary_h` flips it).
fn frame_of(ns: *mut AnyObject, primary_h: f64) -> Rect {
    // SAFETY: `-frame` is a plain getter on the live NSWindow, called on the main thread.
    let f: objc2_foundation::NSRect = unsafe { msg_send![ns, frame] };
    Rect {
        x: f.origin.x,
        y: primary_h - (f.origin.y + f.size.height),
        w: f.size.width,
        h: f.size.height,
    }
}

/// Move `win` onto the agent display and show it without activating the app. If the display cannot be created the
/// window stays hidden: an agent instance never shows on the user's monitors.
pub fn park_and_show(app: &AppHandle, win: &tauri::Window) {
    let (display_id, bounds) = match ensure() {
        Ok(b) => b,
        Err(e) => {
            eprintln!(
                "atlas-agent: no virtual display ({e}); the window stays hidden (it never falls back to your monitors)"
            );
            return;
        }
    };
    let _ = app;
    let size = win
        .outer_size()
        .ok()
        .zip(win.scale_factor().ok())
        .map_or((f64::from(LOGICAL.0), f64::from(LOGICAL.1)), |(s, f)| {
            (f64::from(s.width) / f, f64::from(s.height) / f)
        });
    let size = crate::agent_mode::fit_size(size, bounds);
    let Ok(ns) = win.ns_window() else {
        eprintln!("atlas-agent: no NSWindow; the window stays hidden");
        return;
    };
    let w = ns as *mut AnyObject;
    // Place it with AppKit itself, synchronously: Tauri's `set_position` on a window that has never been shown is
    // applied later, which left the frame on the user's monitor at the moment of the check (first agent run).
    let (x, y) = window_origin(bounds, size);
    let target = crate::agent_mode::cocoa_frame(
        Rect {
            x,
            y,
            w: size.0,
            h: size.1,
        },
        crate::display_mac::primary_height(),
    );
    let frame = objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(target.x, target.y),
        objc2_foundation::NSSize::new(target.w, target.h),
    );
    // SAFETY: Tauri's live NSWindow on the main thread (`show_main` runs there); `setFrame:display:` takes a rect.
    unsafe {
        let _: () = msg_send![w, setFrame: frame, display: false];
    }
    // The last check, in code, before a single pixel can reach a screen: where AppKit really put the window.
    let frame = frame_of(w, crate::display_mac::primary_height());
    let real = crate::display_mac::active_bounds_except(display_id);
    if let Err(e) = crate::agent_mode::safe_to_show(frame, bounds, &real) {
        eprintln!("atlas-agent: not showing the window: {e}");
        return;
    }
    // `orderFront:` shows the window without making it key and without activating the application.
    // SAFETY: Tauri's live NSWindow, main thread (`show_main` runs there); `orderFront:` takes a sender or nil.
    unsafe {
        let _: () = msg_send![w, orderFront: std::ptr::null::<AnyObject>()];
    }
}
