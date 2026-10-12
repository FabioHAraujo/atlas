//! Native two-finger swipe tracking (Arc/Safari style): an `NSEvent` local monitor for
//! scroll-wheel events, hit-tested against zones the frontend pushes, handing the gesture to
//! AppKit's `trackSwipeEvent` (1:1 amount, rubber band, velocity decision, settle animation).
//!
//! The monitor sees every event before WKWebView, on the main thread, with the real
//! `phase`/`momentumPhase` the DOM never exposes. While a swipe is tracked the events (and the
//! momentum tail) are swallowed. Per tracker callback we emit `swipe://update`, once on the
//! decision `swipe://commit`; the frontend only writes transforms.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2_app_kit::{
    NSEvent, NSEventMask, NSEventPhase, NSEventSwipeTrackingOptions, NSHapticFeedbackManager,
    NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime, NSHapticFeedbackPerformer, NSWindow,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Horizontal travel (pt) before a gesture may become a swipe (WebKit's 15 pt).
const MIN_DX: f64 = 15.0;
/// Vertical travel (pt) after which the whole gesture belongs to scrolling.
const MAX_DY: f64 = 10.0;
/// A tracker that never reports `isComplete` cannot swallow scrolling longer than this.
const STALE: Duration = Duration::from_secs(1);
/// |gestureAmount| past which a release commits (haptic tick on crossing).
const COMMIT_AMOUNT: f64 = 0.5;

#[derive(Clone, Copy, Deserialize)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Deserialize)]
pub struct Zone {
    zone: String,
    id: Option<String>,
    rect: Rect,
    prev: bool,
    next: bool,
    /// `history` only: nothing under the pointer scrolls horizontally.
    #[serde(default)]
    pinned: bool,
}

#[derive(Serialize, Clone)]
struct Update<'a> {
    zone: &'a str,
    id: Option<&'a str>,
    amount: f64,
    phase: &'static str,
    complete: bool,
}

#[derive(Serialize, Clone)]
struct Commit<'a> {
    zone: &'a str,
    id: Option<&'a str>,
    dir: i8,
}

/// Zones, front to back (later entries are nested deeper: the first hit from the end wins).
static ZONES: Mutex<Vec<Zone>> = Mutex::new(Vec::new());
/// Bumped when a new gesture starts; a tracker callback of an older generation is ignored.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Per-gesture state of the monitor. Main thread only (the monitor block and tracker
/// callbacks both run there), so a `Mutex` is just for `static` and is never contended.
#[derive(Default)]
struct Gesture {
    /// `Began` seen; accumulating until the gate opens.
    dx: f64,
    dy: f64,
    /// This gesture belongs to scrolling (vertical, or no zone): leave it alone until `Began`.
    refused: bool,
    /// AppKit owns the gesture; swallow until the tracker completes.
    tracking: bool,
    /// Last tracker callback, for the stale timeout.
    last: Option<Instant>,
}

static GESTURE: Mutex<Gesture> = Mutex::new(Gesture {
    dx: 0.0,
    dy: 0.0,
    refused: false,
    tracking: false,
    last: None,
});

/// Whether native tracking is available: system "Swipe between pages" = two fingers.
pub fn enabled() -> bool {
    NSEvent::isSwipeTrackingFromScrollEventsEnabled()
}

pub fn set_zones(zones: Vec<Zone>) {
    *ZONES.lock() = zones;
}

/// Innermost zone containing the top-left point `(x, y)` that can move in `dir`.
fn hit(x: f64, y: f64) -> Option<Zone> {
    let zones = ZONES.lock();
    zones
        .iter()
        .rev()
        .find(|z| {
            let r = z.rect;
            x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
        })
        .filter(|z| (z.zone != "history" || z.pinned) && (z.prev || z.next))
        .cloned()
}

fn phase_name(p: NSEventPhase) -> &'static str {
    if p.contains(NSEventPhase::Began) {
        "began"
    } else if p.contains(NSEventPhase::Ended) {
        "ended"
    } else if p.contains(NSEventPhase::Cancelled) {
        "cancelled"
    } else {
        "changed"
    }
}

fn tick() {
    let p = NSHapticFeedbackManager::defaultPerformer();
    p.performFeedbackPattern_performanceTime(
        NSHapticFeedbackPattern::Alignment,
        NSHapticFeedbackPerformanceTime::Now,
    );
}

/// Install the monitor. Main thread (Tauri `setup`).
pub fn install(app: &AppHandle) {
    let app = app.clone();
    let block = RcBlock::new(move |ev: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a live event for the duration of the call.
        let ev = unsafe { ev.as_ref() };
        if on_scroll(&app, ev) {
            std::ptr::null_mut()
        } else {
            ev as *const NSEvent as *mut NSEvent
        }
    });
    // SAFETY: the block returns null or the event it was given. The monitor lives for the
    // whole process, so the returned token is intentionally leaked.
    let token = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &block)
    };
    std::mem::forget(token);
}

/// Top-left point of the event in the main window's content view, if it is the main window.
fn point_in_main(app: &AppHandle, ev: &NSEvent, mtm: MainThreadMarker) -> Option<(f64, f64)> {
    let main = app.get_window("main")?.ns_window().ok()?;
    let win: Retained<NSWindow> = ev.window(mtm)?;
    if !std::ptr::eq(
        Retained::as_ptr(&win) as *const AnyObject,
        main as *const AnyObject,
    ) {
        return None;
    }
    let content = win.contentView()?;
    let p = content.convertPoint_fromView(ev.locationInWindow(), None);
    let h = content.bounds().size.height;
    Some((p.x, if content.isFlipped() { p.y } else { h - p.y }))
}

/// Returns true to swallow the event.
fn on_scroll(app: &AppHandle, ev: &NSEvent) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let mut g = GESTURE.lock();
    let phase = ev.phase();
    let momentum = ev.momentumPhase();

    // Fingers down again: a new gesture preempts a tracker still settling (its handler sees the
    // bumped generation and stops).
    if phase.contains(NSEventPhase::Began) || phase.contains(NSEventPhase::MayBegin) {
        *g = Gesture::default();
        GENERATION.fetch_add(1, Ordering::SeqCst);
    }
    if g.tracking {
        // AppKit drives the gesture; keep the page from scrolling under it, momentum included.
        if g.last.is_some_and(|t| t.elapsed() > STALE) {
            *g = Gesture::default();
            return false;
        }
        return true;
    }
    if g.refused || !momentum.is_empty() || !ev.hasPreciseScrollingDeltas() {
        return false;
    }
    if phase.contains(NSEventPhase::Ended) || phase.contains(NSEventPhase::Cancelled) {
        *g = Gesture::default();
        return false;
    }
    if !phase.contains(NSEventPhase::Changed) || !enabled() {
        return false;
    }
    g.dx += ev.scrollingDeltaX();
    g.dy += ev.scrollingDeltaY();
    if g.dy.abs() > MAX_DY && g.dy.abs() * 2.0 >= g.dx.abs() {
        g.refused = true;
        return false;
    }
    if g.dx.abs() < MIN_DX || g.dx.abs() <= 2.0 * g.dy.abs() {
        return false;
    }
    let Some((x, y)) = point_in_main(app, ev, mtm) else {
        g.refused = true;
        return false;
    };
    let Some(zone) = hit(x, y) else {
        g.refused = true;
        return false;
    };
    // `gestureAmount` is positive toward "next": fingers moving left under natural scrolling.
    // Let AppKit own the direction sign; bounds say which way exists.
    let (min, max) = (-(zone.prev as u8 as f64), zone.next as u8 as f64);
    g.tracking = true;
    g.last = Some(Instant::now());
    let generation = GENERATION.load(Ordering::SeqCst);
    drop(g);

    let app = app.clone();
    let crossed = std::cell::Cell::new(false);
    // Sign of the last movement: the amount at `Ended` can be 0 right at the decision.
    let sign = std::cell::Cell::new(1);
    let handler = RcBlock::new(
        move |amount: f64, phase: NSEventPhase, complete: Bool, stop: NonNull<Bool>| {
            if GENERATION.load(Ordering::SeqCst) != generation {
                // SAFETY: AppKit's out-parameter, valid for the call.
                unsafe { *stop.as_ptr() = Bool::YES };
                return;
            }
            let name = phase_name(phase);
            let complete = complete.as_bool();
            if amount != 0.0 {
                sign.set(if amount > 0.0 { 1 } else { -1 });
            }
            let past = amount.abs() >= COMMIT_AMOUNT;
            if past != crossed.get() && name == "changed" {
                crossed.set(past);
                tick();
            }
            let id = zone.id.as_deref();
            let _ = app.emit(
                "swipe://update",
                Update {
                    zone: &zone.zone,
                    id,
                    amount,
                    phase: name,
                    complete,
                },
            );
            if name == "ended" {
                let _ = app.emit(
                    "swipe://commit",
                    Commit {
                        zone: &zone.zone,
                        id,
                        dir: sign.get(),
                    },
                );
            }
            let mut g = GESTURE.lock();
            g.last = Some(Instant::now());
            if complete {
                *g = Gesture::default();
            }
        },
    );
    ev.trackSwipeEventWithOptions_dampenAmountThresholdMin_max_usingHandler(
        NSEventSwipeTrackingOptions::LockDirection,
        min,
        max,
        &handler,
    );
    true
}

/// Frontend → native: the swipe zones of the current layout (CSS px in the main webview).
#[tauri::command]
pub fn swipe_zones(zones: Vec<Zone>) {
    set_zones(zones);
}

/// Whether native swipe tracking is active (otherwise the frontend keeps its wheel recognizer).
#[tauri::command]
pub async fn swipe_native(app: AppHandle) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    // `isSwipeTrackingFromScrollEventsEnabled` reads user defaults; ask on the main thread.
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(enabled());
        })
        .is_err()
    {
        return false;
    }
    rx.recv().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zone(
        name: &str,
        id: Option<&str>,
        r: [f64; 4],
        prev: bool,
        next: bool,
        pinned: bool,
    ) -> Zone {
        Zone {
            zone: name.into(),
            id: id.map(Into::into),
            rect: Rect {
                x: r[0],
                y: r[1],
                w: r[2],
                h: r[3],
            },
            prev,
            next,
            pinned,
        }
    }

    #[test]
    fn innermost_zone_wins_and_needs_a_neighbour() {
        // Outer first (the frontend sorts by area, largest first), nested last.
        set_zones(vec![
            zone(
                "history",
                None,
                [260.0, 0.0, 1000.0, 800.0],
                true,
                true,
                true,
            ),
            zone(
                "tab",
                Some("g1"),
                [260.0, 40.0, 500.0, 760.0],
                false,
                true,
                false,
            ),
            zone("space", None, [0.0, 0.0, 260.0, 800.0], true, true, false),
        ]);
        let h = hit(100.0, 100.0).map(|z| z.zone);
        assert_eq!(h.as_deref(), Some("space"));
        let h = hit(300.0, 100.0).map(|z| (z.zone, z.id));
        assert_eq!(h, Some(("tab".into(), Some("g1".into()))));
        // Outside the tab group, over the history zone only.
        assert_eq!(
            hit(900.0, 100.0).map(|z| z.zone).as_deref(),
            Some("history")
        );
        assert!(hit(5000.0, 5.0).is_none());
        // No neighbour either way: nothing to track.
        set_zones(vec![zone(
            "space",
            None,
            [0.0, 0.0, 260.0, 800.0],
            false,
            false,
            false,
        )]);
        assert!(hit(10.0, 10.0).is_none());
        // History only when pinned.
        set_zones(vec![zone(
            "history",
            None,
            [0.0, 0.0, 260.0, 800.0],
            true,
            true,
            false,
        )]);
        assert!(hit(10.0, 10.0).is_none());
    }

    #[test]
    fn phase_names_follow_appkit_flags() {
        assert_eq!(phase_name(NSEventPhase::Began), "began");
        assert_eq!(phase_name(NSEventPhase::Ended), "ended");
        assert_eq!(phase_name(NSEventPhase::Cancelled), "cancelled");
        assert_eq!(phase_name(NSEventPhase::Changed), "changed");
    }
}
