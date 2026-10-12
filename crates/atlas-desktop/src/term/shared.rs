//! State shared between a terminal's reader task, its render thread and the Tauri commands.

use std::time::{Duration, Instant};

use atlas_term::Stats;
use atlas_term::Vt;
use atlas_term::colors::Palette;
use parking_lot::{Condvar, Mutex};

pub(super) struct State {
    /// Pending physical size for the render thread.
    pub(super) size: Option<(u32, u32)>,
    pub(super) dirty: bool,
    pub(super) reset: bool,
    pub(super) closed: bool,
    pub(super) stats: Stats,
    /// Cell size in physical pixels, from the renderer.
    pub(super) cell: [f32; 2],
    /// Keyboard focus is in this terminal's input sink.
    pub(super) focused: bool,
    /// Visual bell: tint the frame until then.
    pub(super) bell_until: Option<Instant>,
    /// Theme colors; `term_recolor` swaps them and sets `pal_new` for the render thread.
    pub(super) pal: Palette,
    pub(super) pal_new: bool,
    /// Pending font size (pt) for the render thread (`term_set_prefs`).
    pub(super) font_pt: Option<f32>,
    /// Pending ligature setting for the renderer.
    pub(super) ligatures: Option<bool>,
    /// Font size (pt) the terminal is at, or will be once `font_pt` is applied.
    pub(super) font_cur: f32,
}

pub(super) const BLINK: Duration = Duration::from_millis(530);
pub(super) const BELL: Duration = Duration::from_millis(120);

pub(super) struct Shared {
    pub(super) vt: Vt,
    pub(super) state: Mutex<State>,
    /// OSC 52 policy (`allow` | `ask` | `deny`), live-updatable.
    pub(super) osc52: Mutex<String>,
    pub(super) wake: Condvar,
}

impl Shared {
    /// Ask the render thread for a new frame.
    pub(super) fn redraw(&self) {
        self.update(|s| s.dirty = true);
    }

    pub(super) fn update(&self, f: impl FnOnce(&mut State)) {
        f(&mut self.state.lock());
        self.wake.notify_one();
    }
}
