//! The window chrome during a recording.
//!
//! macOS 15+ draws a "this window is being shared" pill (screen + person glyph) into the titlebar of a window
//! that ScreenCaptureKit captures, in place of the traffic lights, and it is part of the captured pixels. No
//! `SCStreamConfiguration` / `SCContentFilter` setting removes it (`presenterOverlayPrivacyAlertSetting` is the
//! unrelated Presenter Overlay alert; framing, global-clip, opaque and child-window knobs do not touch it; and
//! `NSWindow.sharingType = .none` makes the window uncapturable: all frames come back black). It is drawn where
//! the standard window buttons live, so the three buttons are hidden for the duration of a recording and put
//! back exactly as they were afterwards. Studio draws its own traffic lights in the compositor.
//!
//! `Guard` is the state machine over a `Buttons` seam; the AppKit implementation is `appkit::Window`.

/// The three standard window buttons: close, miniaturize, zoom (`NSWindowButton` 0, 1, 2).
pub const COUNT: usize = 3;

/// What the guard needs from a window.
pub trait Buttons {
    /// `Some(hidden)` for a button the window has, `None` when it has none.
    fn hidden(&self, i: usize) -> Option<bool>;
    fn set_hidden(&mut self, i: usize, hidden: bool);
}

/// Hides the buttons that are visible now; `restore` shows exactly those again (a button the app had hidden
/// itself stays hidden). Restoring twice is harmless.
pub struct Guard {
    hid: [bool; COUNT],
}

impl Guard {
    pub fn hide(w: &mut impl Buttons) -> Self {
        let mut hid = [false; COUNT];
        for (i, h) in hid.iter_mut().enumerate() {
            if w.hidden(i) == Some(false) {
                w.set_hidden(i, true);
                *h = true;
            }
        }
        Self { hid }
    }

    pub fn restore(&mut self, w: &mut impl Buttons) {
        for (i, h) in self.hid.iter_mut().enumerate() {
            if std::mem::take(h) {
                w.set_hidden(i, false);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub mod appkit {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};

    use super::{Buttons, COUNT};

    /// The live `NSWindow*` of a Tauri window; every call must run on the main thread.
    pub struct Window(pub *mut AnyObject);

    // SAFETY: only used inside `run_on_main_thread` closures; the pointer is Tauri's live NSWindow.
    unsafe impl Send for Window {}

    impl Window {
        fn button(&self, i: usize) -> Option<Retained<AnyObject>> {
            debug_assert!(i < COUNT);
            // SAFETY: `standardWindowButton:` takes an NSWindowButton and returns a nullable NSButton.
            unsafe { msg_send![self.0, standardWindowButton: i as isize] }
        }
    }

    impl Buttons for Window {
        fn hidden(&self, i: usize) -> Option<bool> {
            let b = self.button(i)?;
            // SAFETY: `isHidden` is a plain BOOL getter on NSView.
            let h: Bool = unsafe { msg_send![&*b, isHidden] };
            Some(h.as_bool())
        }

        fn set_hidden(&mut self, i: usize, hidden: bool) {
            if let Some(b) = self.button(i) {
                // SAFETY: `setHidden:` takes a BOOL.
                let _: () = unsafe { msg_send![&*b, setHidden: Bool::new(hidden)] };
            }
        }
    }
}

/// Hide the window's standard buttons for a recording. The returned handle restores them (`Hidden::restore`).
#[cfg(target_os = "macos")]
pub struct Hidden {
    win: tauri::Window,
    guard: std::sync::Arc<parking_lot::Mutex<Guard>>,
}

#[cfg(target_os = "macos")]
impl Hidden {
    pub fn hide(win: &tauri::Window) -> Result<Self, String> {
        let ns = win.ns_window().map_err(|e| e.to_string())? as usize;
        let (tx, rx) = std::sync::mpsc::channel();
        win.run_on_main_thread(move || {
            let mut w = appkit::Window(ns as *mut objc2::runtime::AnyObject);
            let _ = tx.send(Guard::hide(&mut w));
        })
        .map_err(|e| e.to_string())?;
        let guard = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "the window did not answer".to_string())?;
        Ok(Self {
            win: win.clone(),
            guard: std::sync::Arc::new(parking_lot::Mutex::new(guard)),
        })
    }

    pub fn restore(&self) {
        let (Ok(ns), guard) = (self.win.ns_window(), self.guard.clone()) else {
            return;
        };
        let ns = ns as usize;
        let _ = self.win.run_on_main_thread(move || {
            let mut w = appkit::Window(ns as *mut objc2::runtime::AnyObject);
            guard.lock().restore(&mut w);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `None` = no such button.
    struct Fake([Option<bool>; COUNT]);

    impl Buttons for Fake {
        fn hidden(&self, i: usize) -> Option<bool> {
            self.0[i]
        }
        fn set_hidden(&mut self, i: usize, hidden: bool) {
            assert!(
                self.0[i].is_some(),
                "touched a button the window does not have"
            );
            self.0[i] = Some(hidden);
        }
    }

    #[test]
    fn hides_every_visible_button_and_restores_them() {
        let mut w = Fake([Some(false); COUNT]);
        let mut g = Guard::hide(&mut w);
        assert_eq!(
            w.0,
            [Some(true); COUNT],
            "pill must not have a traffic light to replace"
        );
        g.restore(&mut w);
        assert_eq!(w.0, [Some(false); COUNT]);
    }

    #[test]
    fn a_button_the_app_hid_itself_stays_hidden_after_restore() {
        let mut w = Fake([Some(false), Some(true), Some(false)]);
        let mut g = Guard::hide(&mut w);
        g.restore(&mut w);
        assert_eq!(w.0, [Some(false), Some(true), Some(false)]);
    }

    #[test]
    fn a_window_without_buttons_is_left_alone() {
        let mut w = Fake([None; COUNT]);
        let mut g = Guard::hide(&mut w);
        g.restore(&mut w);
        assert_eq!(w.0, [None; COUNT]);
    }

    #[test]
    fn restoring_twice_does_not_show_a_button_the_app_hid_meanwhile() {
        let mut w = Fake([Some(false); COUNT]);
        let mut g = Guard::hide(&mut w);
        g.restore(&mut w);
        w.set_hidden(1, true); // the app hides miniaturize after the recording
        g.restore(&mut w);
        assert_eq!(w.0, [Some(false), Some(true), Some(false)]);
    }
}
