//! The engine's clock: a display-rate timer that exists only while a gesture is in flight.
//!
//! `NSView.displayLink` (macOS 14+) follows the refresh of the screen the window is on (120 Hz on a ProMotion
//! panel, 60 on the agent's virtual display). Each callback advances the engine to `systemUptime` (the clock
//! `NSEvent.timestamp` uses, so event time and tick time are comparable) and publishes the frame. When the
//! engine reports rest the link is invalidated: an idle app pays nothing.

use std::sync::atomic::{AtomicBool, Ordering};

use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::NSWindow;
use objc2_foundation::{NSObject, NSProcessInfo, NSRunLoopCommonModes};
use objc2_quartz_core::CADisplayLink;
use parking_lot::Mutex;
use tauri::{AppHandle, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);
static LINK: Mutex<Option<usize>> = Mutex::new(None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

/// Seconds since boot, the timebase of `NSEvent.timestamp`, in ms.
pub fn now_ms() -> f64 {
    NSProcessInfo::processInfo().systemUptime() * 1000.0
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no Drop impl.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "AtlasSwipeClock"]
    struct Clock;

    impl Clock {
        #[unsafe(method(tick:))]
        fn tick(&self, _link: &CADisplayLink) {
            let app = APP.lock().clone();
            let busy = app.is_some_and(|a| crate::swipe_mac::on_tick(&a, now_ms()));
            if !busy {
                stop();
            }
        }
    }
);

/// Start ticking (idempotent). Main thread.
pub fn start(app: &AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    };
    let Some(ns) = app.get_window("main").and_then(|w| w.ns_window().ok()) else {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    };
    // SAFETY: Tauri's live main NSWindow, main thread.
    let win = unsafe { &*(ns as *const NSWindow) };
    let Some(view) = win.contentView() else {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    };
    *APP.lock() = Some(app.clone());
    let target: Retained<Clock> = unsafe { msg_send![Clock::alloc(mtm), init] };
    // SAFETY: the target outlives the link (retained by it); both live on the main run loop.
    let link = unsafe { view.displayLinkWithTarget_selector(&target, sel!(tick:)) };
    // SAFETY: main run loop, common modes so it also runs while the app tracks events.
    unsafe {
        link.addToRunLoop_forMode(
            &objc2_foundation::NSRunLoop::mainRunLoop(),
            NSRunLoopCommonModes,
        )
    };
    *LINK.lock() = Some(Retained::into_raw(link) as usize);
    std::mem::forget(target);
}

/// Stop ticking. Main thread.
pub fn stop() {
    if let Some(p) = LINK.lock().take() {
        // SAFETY: balances `into_raw` in `start`.
        let link: Retained<CADisplayLink> =
            unsafe { Retained::from_raw(p as *mut CADisplayLink) }.expect("link");
        link.invalidate();
    }
    RUNNING.store(false, Ordering::SeqCst);
}
