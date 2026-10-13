//! Agent instances: an Atlas Desktop started by an agent (to debug, screenshot or record it) must never appear on the
//! user's desktop: no window on his monitors or Spaces, no Dock icon or bounce, no focus theft, no mouse/keyboard.
//!
//! It runs with `ATLAS_AGENT=1` (debug builds only: a release app ignores it) and then
//!   * its activation policy is `Prohibited` (never frontmost, no Dock icon, no menu bar takeover),
//!   * its window is placed on a private virtual display (`display_mac.rs`) that is not any of the user's displays,
//!     is never occluded (full-rate `requestAnimationFrame`, no visibility throttling) and is capturable,
//!   * nothing in the app activates it or steals focus (`show_main` consults [`Mode::focus_allowed`]).
//!
//! This module is the pure part: the decision, and where a window goes on the virtual display.

/// Environment variable that switches the mode on.
pub const ENV: &str = "ATLAS_AGENT";

/// How this process was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// The user's own app.
    User,
    /// Started by an agent: invisible to the user.
    Agent,
}

impl Mode {
    /// `value` = the `ATLAS_AGENT` variable, `debug_build` = `cfg!(debug_assertions)`. A release app is always the user's.
    pub fn resolve(value: Option<&str>, debug_build: bool) -> Self {
        match value {
            Some("1" | "true") if debug_build => Mode::Agent,
            _ => Mode::User,
        }
    }

    pub fn current() -> Self {
        Self::resolve(std::env::var(ENV).ok().as_deref(), cfg!(debug_assertions))
    }

    /// Whether the app may raise itself, take focus, or switch Spaces.
    pub fn focus_allowed(self) -> bool {
        self == Mode::User
    }

    /// macOS activation policy: the user's app is a normal app (Dock icon, can be frontmost); an agent instance is
    /// `Prohibited` (no Dock icon or bounce, can never become frontmost, no menu bar takeover).
    pub fn policy(self) -> Policy {
        match self {
            Mode::User => Policy::Regular,
            Mode::Agent => Policy::Prohibited,
        }
    }

    /// The menu-bar tray icon is the user's; an agent instance has none (it would appear in HIS menu bar).
    pub fn tray_allowed(self) -> bool {
        self == Mode::User
    }
}

/// The macOS activation policies this app uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    Regular,
    Prohibited,
}

/// A rectangle in global display coordinates (points, origin top-left like `CGDisplayBounds`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn intersects(&self, o: &Rect) -> bool {
        self.x < o.x + o.w && o.x < self.x + self.w && self.y < o.y + o.h && o.y < self.y + self.h
    }
}

/// Where the virtual display goes: to the right of every real display, with a gap, so that the mouse can never reach
/// it by accident and no real display's coordinates change. `real` = bounds of the user's displays.
pub fn virtual_origin(real: &[Rect]) -> (f64, f64) {
    const GAP: f64 = 0.0; // macOS clamps a display to touch the arrangement; the right edge is the quietest side
    let right = real.iter().map(|r| r.x + r.w).fold(0.0, f64::max);
    (right + GAP, 0.0)
}

/// Top-left origin for a window of `size` on a display of `display` bounds, centered. Never negative offsets inside
/// the display: a window larger than the display sits at its top-left corner.
pub fn window_origin(display: Rect, size: (f64, f64)) -> (f64, f64) {
    (
        display.x + ((display.w - size.0) / 2.0).max(0.0),
        display.y + ((display.h - size.1) / 2.0).max(0.0),
    )
}

/// A top-left global frame as AppKit's bottom-left one: Cocoa's origin is the bottom-left of the PRIMARY display, and
/// `primary_h` is that display's height. `y` flips about it.
pub fn cocoa_frame(frame: Rect, primary_h: f64) -> Rect {
    Rect {
        y: primary_h - (frame.y + frame.h),
        ..frame
    }
}

/// The window size that fits the virtual display: a restored size (window-state, `--scratch` settings from a bigger
/// monitor) larger than the display is clamped to it, so the window is shown rather than refused.
pub fn fit_size(size: (f64, f64), display: Rect) -> (f64, f64) {
    (size.0.min(display.w), size.1.min(display.h))
}

/// The last check before an agent window is shown: its actual frame (read back from AppKit after placing it) lies
/// entirely inside the virtual display and touches none of the user's displays. Anything else (the window manager
/// moved it, a display layout changed, the position was clamped) means "do not show": an agent window never appears
/// on the user's screens, not even for a frame.
pub fn safe_to_show(frame: Rect, virtual_display: Rect, real: &[Rect]) -> Result<(), String> {
    let inside = frame.x >= virtual_display.x
        && frame.y >= virtual_display.y
        && frame.x + frame.w <= virtual_display.x + virtual_display.w
        && frame.y + frame.h <= virtual_display.y + virtual_display.h;
    if !inside {
        return Err(format!(
            "window frame {frame:?} is not inside the virtual display {virtual_display:?}"
        ));
    }
    if let Some(r) = real.iter().find(|r| r.intersects(&frame)) {
        return Err(format!(
            "window frame {frame:?} overlaps the user's display {r:?}"
        ));
    }
    Ok(())
}

/// Pixel ratio of the agent display from `ATLAS_AGENT_SCALE`: `1` (a standard monitor) or `2` (retina, the default).
/// Anything else is the default: a typo must not silently give an unexpected ratio such as 3.
pub fn scale_from(value: Option<&str>) -> u32 {
    match value {
        Some("1") => 1,
        _ => 2,
    }
}

/// Pixels of the virtual display for a logical `size` at `scale` (2.0 = retina).
pub fn backing_pixels(size: (u32, u32), scale: u32) -> (u32, u32) {
    (size.0 * scale, size.1 * scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_debug_build_with_the_variable_set_is_an_agent_instance() {
        assert_eq!(Mode::resolve(Some("1"), true), Mode::Agent);
        assert_eq!(Mode::resolve(Some("true"), true), Mode::Agent);
        assert_eq!(Mode::resolve(None, true), Mode::User);
        assert_eq!(Mode::resolve(Some("0"), true), Mode::User);
        assert_eq!(Mode::resolve(Some(""), true), Mode::User);
        // a release app must never be silenced by a leftover variable
        assert_eq!(Mode::resolve(Some("1"), false), Mode::User);
    }

    #[test]
    fn an_agent_instance_has_no_dock_icon_no_tray_and_cannot_be_frontmost() {
        assert_eq!(Mode::Agent.policy(), Policy::Prohibited);
        assert!(!Mode::Agent.tray_allowed());
        assert_eq!(Mode::User.policy(), Policy::Regular);
        assert!(Mode::User.tray_allowed());
    }

    #[test]
    fn an_agent_instance_may_never_take_focus_the_users_app_may() {
        assert!(!Mode::Agent.focus_allowed());
        assert!(Mode::User.focus_allowed());
    }

    const BUILTIN: Rect = Rect {
        x: 0.0,
        y: 0.0,
        w: 1352.0,
        h: 878.0,
    };

    #[test]
    fn the_virtual_display_goes_right_of_every_real_display_and_overlaps_none() {
        let external = Rect {
            x: 1352.0,
            y: -200.0,
            w: 2560.0,
            h: 1440.0,
        };
        for real in [vec![BUILTIN], vec![BUILTIN, external]] {
            let (x, y) = virtual_origin(&real);
            let v = Rect {
                x,
                y,
                w: 1280.0,
                h: 820.0,
            };
            assert!(real.iter().all(|r| !r.intersects(&v)), "{real:?} vs {v:?}");
            assert!(real.iter().all(|r| x >= r.x + r.w));
        }
        assert_eq!(virtual_origin(&[BUILTIN]), (1352.0, 0.0));
    }

    #[test]
    fn with_no_displays_the_origin_is_zero() {
        assert_eq!(virtual_origin(&[]), (0.0, 0.0));
    }

    #[test]
    fn a_window_is_centered_on_the_virtual_display_and_stays_inside_it() {
        let d = Rect {
            x: 1352.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        assert_eq!(window_origin(d, (1280.0, 820.0)), (1352.0, 0.0));
        assert_eq!(window_origin(d, (1000.0, 600.0)), (1492.0, 110.0));
        // bigger than the display: top-left corner, never off to the left/top of it
        assert_eq!(window_origin(d, (3000.0, 2000.0)), (1352.0, 0.0));
    }

    #[test]
    fn a_window_is_shown_only_when_it_is_wholly_on_the_virtual_display() {
        let v = Rect {
            x: 1352.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        let real = [BUILTIN];
        assert!(safe_to_show(v, v, &real).is_ok());
        // still on the user's monitor (placement failed or was undone)
        let on_user = Rect {
            x: 100.0,
            y: 100.0,
            w: 1280.0,
            h: 820.0,
        };
        assert!(safe_to_show(on_user, v, &real).is_err());
        // straddling the seam: half on his display, half on ours
        let seam = Rect {
            x: 1000.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        assert!(safe_to_show(seam, v, &real).is_err());
        // inside the arrangement but off the virtual display (a stale display layout)
        let beside = Rect {
            x: 3000.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        assert!(safe_to_show(beside, v, &real).is_err());
        // one pixel too tall: a window the display cannot hold is not shown either
        let tall = Rect {
            x: 1352.0,
            y: 0.0,
            w: 1280.0,
            h: 821.0,
        };
        assert!(safe_to_show(tall, v, &real).is_err());
        // the virtual display itself overlapping a real one (layout changed under us) refuses even an "inside" frame
        let moved = [Rect {
            x: 1400.0,
            y: 0.0,
            w: 500.0,
            h: 500.0,
        }];
        assert!(
            safe_to_show(
                Rect {
                    x: 1352.0,
                    y: 0.0,
                    w: 1280.0,
                    h: 820.0
                },
                v,
                &moved
            )
            .is_err()
        );
    }

    /// Incident (first agent run): the window was placed with a top-left position but read back in AppKit's
    /// bottom-left space, so frames never matched; the conversion is its own inverse about the primary display.
    #[test]
    fn cocoa_and_global_frames_convert_both_ways_about_the_primary_display() {
        let primary_h = 878.0;
        let top_left = Rect {
            x: 1352.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        let cocoa = cocoa_frame(top_left, primary_h);
        assert_eq!(
            cocoa,
            Rect {
                x: 1352.0,
                y: 58.0,
                w: 1280.0,
                h: 820.0
            }
        );
        assert_eq!(cocoa_frame(cocoa, primary_h), top_left);
        // a display above the primary has a negative top-left y
        let above = Rect {
            x: 0.0,
            y: -820.0,
            w: 1280.0,
            h: 820.0,
        };
        assert_eq!(cocoa_frame(above, primary_h).y, 878.0);
    }

    #[test]
    fn a_restored_window_bigger_than_the_display_is_clamped_to_it() {
        let d = Rect {
            x: 1352.0,
            y: 0.0,
            w: 1280.0,
            h: 820.0,
        };
        assert_eq!(fit_size((1000.0, 600.0), d), (1000.0, 600.0));
        assert_eq!(fit_size((2400.0, 1400.0), d), (1280.0, 820.0));
        assert_eq!(fit_size((2400.0, 600.0), d), (1280.0, 600.0));
    }

    #[test]
    fn the_agent_display_is_retina_unless_one_is_asked_for_and_nothing_else_is_accepted() {
        assert_eq!(scale_from(None), 2);
        assert_eq!(scale_from(Some("2")), 2);
        assert_eq!(scale_from(Some("1")), 1);
        for bad in ["", "3", "0", "1.5", "retina", "-1"] {
            assert_eq!(scale_from(Some(bad)), 2, "{bad:?}");
        }
    }

    #[test]
    fn retina_means_twice_the_pixels() {
        assert_eq!(backing_pixels((1280, 820), 2), (2560, 1640));
        assert_eq!(backing_pixels((1280, 820), 1), (1280, 820));
    }
}
