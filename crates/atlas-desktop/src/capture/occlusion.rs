//! A page whose window the user cannot see is paused by WebKit: `visibilityState` is `hidden`, `requestAnimationFrame`
//! stops, CSS animations freeze, and a recording of it is a still frame. This is the window's occlusion bit
//! (`NSWindow.occlusionState & .visible`), which AppKit clears whenever other windows cover the window (the user's
//! terminal, a browser...), and WebKit follows.
//!
//! Measured on the dev window while the user's windows covered it 100 % (macOS 26, M-series, app inactive):
//!
//! | what is applied                                                        | page `visibilityState` | `rAF`/s |
//! |------------------------------------------------------------------------|------------------------|---------|
//! | nothing                                                                | hidden                 | 0       |
//! | `-[WKWebView _setWindowOcclusionDetectionEnabled:NO]` (toggled either way) | hidden             | 0       |
//! | WKPreferences `_hiddenPageDOMTimerThrottlingEnabled`, `_pageVisibilityBasedProcessSuppressionEnabled`, `_domTimersThrottlingEnabled` off, `-[WKWebView _setThrottleStateForTesting:]` 0..4 | hidden | 0 |
//! | `-[NSWindow _setOcclusionStateIsVisible:YES]`                           | visible                | 30      |
//!
//! The window SPI is the one that works: it sets the bit AppKit would set for a visible window, without activating
//! the app, moving, raising or covering anything. It is applied for the length of a recording and the bit the window
//! really had is put back afterwards. WebKit renders a window that is not key at 30 Hz (`rAF` p50 gap 33 ms, none of the
//! preferences above changes it), so the page content of a recording of an unfocused window is 30 fps even though the
//! video container runs at 60; `capture_start` reports this as `page_fps_cap`.

use std::ffi::CStr;

use objc2::msg_send;
use objc2::runtime::{AnyObject, Bool, Sel};

const SETTER: &CStr = c"_setOcclusionStateIsVisible:";
/// `NSWindowOcclusionStateVisible`.
const VISIBLE: usize = 1 << 1;

/// What the guard needs from a window.
pub trait Occlusion {
    /// Whether the window implements the private setter: a future macOS may drop it, and then the caller must say so
    /// instead of recording a still.
    fn supported(&self) -> bool;
    /// `NSWindow.occlusionState` raw bits.
    fn state(&self) -> usize;
    fn set_visible(&mut self, visible: bool);
}

/// Forces the window's occlusion bit to visible; `restore` puts back the bit it really had.
pub struct Guard {
    /// The bit before we touched it; `None` = nothing was changed (unsupported, or already visible).
    was_visible: Option<bool>,
}

impl Guard {
    /// `None` when the SPI does not exist on this macOS.
    pub fn force_visible(w: &mut impl Occlusion) -> Option<Self> {
        if !w.supported() {
            return None;
        }
        let was = w.state() & VISIBLE != 0;
        if was {
            // Nothing to override, and nothing to undo: a visible window stays under AppKit's control.
            return Some(Self { was_visible: None });
        }
        w.set_visible(true);
        Some(Self {
            was_visible: Some(was),
        })
    }

    pub fn restore(&mut self, w: &mut impl Occlusion) {
        if let Some(was) = self.was_visible.take() {
            w.set_visible(was);
        }
    }
}

/// The live `NSWindow*` of a Tauri window; every call must run on the main thread.
pub struct Window(pub *mut AnyObject);

// SAFETY: only used inside `run_on_main_thread` closures; the pointer is Tauri's live NSWindow.
unsafe impl Send for Window {}

impl Occlusion for Window {
    fn supported(&self) -> bool {
        // SAFETY: the pointer is a live NSWindow (see `Window`).
        unsafe { &*self.0 }
            .class()
            .responds_to(Sel::register(SETTER))
    }

    fn state(&self) -> usize {
        // SAFETY: `occlusionState` is a plain getter returning NSWindowOcclusionState (NSUInteger).
        unsafe { msg_send![self.0, occlusionState] }
    }

    fn set_visible(&mut self, visible: bool) {
        // SAFETY: the selector takes one BOOL and returns void (checked by `supported` before any call).
        let _: () = unsafe { msg_send![self.0, _setOcclusionStateIsVisible: Bool::new(visible)] };
    }
}

/// The occlusion override of one window for a recording; `restore` ends it.
pub struct Forced {
    win: tauri::Window,
    guard: std::sync::Arc<parking_lot::Mutex<Guard>>,
}

impl Forced {
    /// `Ok(None)` when this macOS has no such SPI.
    pub fn force_visible(win: &tauri::Window) -> Result<Option<Self>, String> {
        let ns = win.ns_window().map_err(|e| e.to_string())? as usize;
        let (tx, rx) = std::sync::mpsc::channel();
        win.run_on_main_thread(move || {
            let mut w = Window(ns as *mut AnyObject);
            let _ = tx.send(Guard::force_visible(&mut w));
        })
        .map_err(|e| e.to_string())?;
        let guard = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "the window did not answer".to_string())?;
        Ok(guard.map(|g| Self {
            win: win.clone(),
            guard: std::sync::Arc::new(parking_lot::Mutex::new(g)),
        }))
    }

    pub fn restore(&self) {
        let Ok(ns) = self.win.ns_window() else {
            return;
        };
        let (ns, guard) = (ns as usize, self.guard.clone());
        let _ = self.win.run_on_main_thread(move || {
            guard.lock().restore(&mut Window(ns as *mut AnyObject));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        supported: bool,
        state: usize,
        calls: Vec<bool>,
    }

    impl Occlusion for Fake {
        fn supported(&self) -> bool {
            self.supported
        }
        fn state(&self) -> usize {
            self.state
        }
        fn set_visible(&mut self, visible: bool) {
            assert!(self.supported, "called an SPI the window does not have");
            self.calls.push(visible);
            self.state = if visible {
                self.state | VISIBLE
            } else {
                self.state & !VISIBLE
            };
        }
    }

    fn fake(state: usize) -> Fake {
        Fake {
            supported: true,
            state,
            calls: vec![],
        }
    }

    /// The incident: the user's windows cover the window (state 8192, bit 2 clear), the page goes hidden and the
    /// recording is a still frame.
    #[test]
    fn an_occluded_window_is_forced_visible_and_put_back_afterwards() {
        let mut w = fake(8192);
        let mut g = Guard::force_visible(&mut w).expect("supported");
        assert_eq!(w.state, 8194, "the visible bit must be set while recording");
        g.restore(&mut w);
        assert_eq!(w.state, 8192, "the real occlusion bit must come back");
        assert_eq!(w.calls, [true, false]);
    }

    #[test]
    fn a_window_that_is_visible_is_never_touched() {
        let mut w = fake(8194);
        let mut g = Guard::force_visible(&mut w).expect("supported");
        g.restore(&mut w);
        assert!(w.calls.is_empty(), "{:?}", w.calls);
    }

    #[test]
    fn a_macos_without_the_spi_is_reported_not_papered_over() {
        let mut w = Fake {
            supported: false,
            ..fake(8192)
        };
        assert!(Guard::force_visible(&mut w).is_none());
        assert!(w.calls.is_empty());
    }

    #[test]
    fn restoring_twice_sets_the_bit_once() {
        let mut w = fake(0);
        let mut g = Guard::force_visible(&mut w).expect("supported");
        g.restore(&mut w);
        g.restore(&mut w);
        assert_eq!(w.calls, [true, false]);
    }

    /// Bits other than `visible` belong to AppKit and must survive both calls.
    #[test]
    fn other_state_bits_are_preserved() {
        let mut w = fake(0b1010_0000_0000_0000 | 1);
        let before = w.state;
        let mut g = Guard::force_visible(&mut w).expect("supported");
        assert_eq!(w.state, before | VISIBLE);
        g.restore(&mut w);
        assert_eq!(w.state, before);
    }

    #[test]
    fn nsobject_does_not_implement_the_spi_and_the_window_type_says_so() {
        let obj = objc2::runtime::NSObject::new();
        let mut w = Window(&*obj as *const _ as *mut AnyObject);
        assert!(!w.supported());
        assert!(Guard::force_visible(&mut w).is_none());
    }
}
