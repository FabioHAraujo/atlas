//! The swipe engine: physics and decisions for two-finger trackpad swipes, pure (no AppKit, no clock, no
//! Tauri), so the exact code that runs in the app is unit-tested against synthesized and recorded traces
//! (`swipe_trace.rs`).
//!
//! `swipe_mac.rs` is a thin adapter: it turns each `NSEvent` scroll event into a [`Sample`], calls
//! [`Engine::feed`] (and [`Engine::tick`] on a timer while settling) and acts on the returned [`Step`].
//! Nothing else decides anything.
//!
//! One gesture = fingers down → `Changed`* → lift (`Ended`/`Cancelled`) → momentum tail (swallowed, never a
//! second gesture). The engine owns a single source of truth for the page position:
//!
//! * `Idle`: nothing claimed; events pass through to the page (vertical scroll, no zone, wheel mouse, …).
//! * `Pending`: fingers moved but the gate (distance + axis dominance) is not open yet.
//! * `Tracking`: claimed; `amount` follows the fingers 1:1 (rubber-banded past the ends).
//! * `Settling`: fingers lifted; a critically damped spring carries `amount` to the target page (or back).
//!   A new gesture during it preempts and continues from the spring's *current* position.
//!
//! Every decision carries a `seq` that grows once per claimed gesture, so a consumer applies each commit
//! exactly once and ignores a stale one (the "it switches and then it's a mess" class of bugs).
//!
//! Sign convention: `amount` > 0 = toward the *next* page (fingers moved left, `scrollingDeltaX` < 0), in
//! page widths. `dir` is -1 / 0 / +1 the same way.

use serde::{Deserialize, Serialize};

/// Horizontal travel (pt) before a gesture may become a swipe (WebKit's 15 pt).
pub const MIN_DX: f64 = 15.0;
/// Horizontal must exceed vertical by this factor to claim.
pub const AXIS_RATIO: f64 = 2.0;
/// Vertical travel (pt) past which a gesture the horizontal does not dominate belongs to scrolling.
pub const MAX_DY: f64 = 10.0;
/// Release projection time (s): where the page would coast to at the lift velocity (paging scroll views).
pub const PROJECT_S: f64 = 0.12;
/// Projected |amount| past which a release commits.
pub const COMMIT_AT: f64 = 0.5;
/// A release slower than this (page-widths/s) never counts as a flick, whatever the projection.
pub const FLICK_MIN_V: f64 = 0.35;
/// Window (ms) of recent samples the lift velocity is measured over.
pub const VELOCITY_WINDOW_MS: f64 = 90.0;
/// Spring stiffness, mass 1, critically damped (ω = √k = 30): 0.3 s from rest to within 1 px of the next
/// page of 1000 px, no overshoot (rest: under 0.5 px away and under 0.4 px per 120 Hz frame). (Firefox/WebKit use ~250: 0.5 s, which reads as sluggish here.)
pub const STIFFNESS: f64 = 900.0;
/// Rubber band: past an end the page moves at most this many page-widths.
pub const MAX_OVERSCROLL: f64 = 0.15;
/// A settle is over when within this of the target and slower than [`REST_V`] (page-widths, page-widths/s).
pub const REST_X: f64 = 0.0005;
pub const REST_V: f64 = 0.05;
/// A gesture that has been silent this long (ms) while tracking is treated as lifted (a lost `Ended`).
pub const STALE_MS: f64 = 400.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    None,
    MayBegin,
    Began,
    Changed,
    Ended,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Momentum {
    None,
    Began,
    Changed,
    Ended,
}

/// One `NSEvent` scroll event. `dx`/`dy` are `scrollingDeltaX/Y` (pt): negative X = fingers moved left = next.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    /// ms, monotonic.
    pub t: f64,
    pub phase: Phase,
    pub momentum: Momentum,
    pub dx: f64,
    pub dy: f64,
    pub precise: bool,
    pub x: f64,
    pub y: f64,
}

/// Finger travel (pt) that moves the page one full page-width. AppKit's own `gestureAmount` is a fixed
/// `scrollingDeltaX / 1000` whatever the view's size (measured: the same -30 pt reads -0.03 in a 400 pt and a
/// 1000 pt window), which makes a half-page drag a 500 pt reach across the whole trackpad. Two fingers span
/// about 450 pt of scroll delta edge to edge; one page per 420 pt puts "past half" at a comfortable ~210 pt.
pub const PAGE_TRAVEL: f64 = 420.0;

/// What the pointer is over when a gesture claims: which neighbours exist and how many points of finger travel
/// make one page (normally [`PAGE_TRAVEL`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub prev: bool,
    pub next: bool,
    pub width: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    /// Fingers on the pad, the page follows them.
    Track,
    /// Fingers lifted, the spring is carrying the page.
    Settle,
    /// Back at rest (the gesture is over; the page is at `target`).
    Rest,
}

/// The page position at one instant.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Frame {
    pub seq: u64,
    /// Page widths toward next; already rubber-banded.
    pub amount: f64,
    pub stage: Stage,
}

/// The release decision: sent exactly once per `seq`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Commit {
    pub seq: u64,
    /// -1 previous, 0 stay (cancel), +1 next.
    pub dir: i8,
}

/// What the adapter does after a sample or a tick.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Step {
    /// Do not deliver this event to the page.
    pub swallow: bool,
    /// The page position changed (always set while tracking, and per tick while settling).
    pub frame: Option<Frame>,
    /// The fingers lifted on a decision.
    pub commit: Option<Commit>,
    /// The commit threshold was crossed by the fingers: a haptic tick (`true` = past, `false` = back below).
    pub threshold: Option<bool>,
}

/// Rubber band: soft resistance past `[lo, hi]`, saturating at [`MAX_OVERSCROLL`] beyond the end.
pub fn rubber(x: f64, lo: f64, hi: f64) -> f64 {
    let past = |over: f64| MAX_OVERSCROLL * (1.0 - (-over / MAX_OVERSCROLL * 1.2).exp()).max(0.0);
    if x > hi {
        hi + past(x - hi)
    } else if x < lo {
        lo - past(lo - x)
    } else {
        x
    }
}

/// The fastest release velocity (page-widths/s) a critically damped spring can start with toward `to` without
/// crossing it: `x(t) = to + (d + (v0 + ωd)t)e^{-ωt}` crosses `to` iff `v0 + ωd` points the way of travel.
/// Faster flicks are capped here (the spring still starts at full speed, it just stops exactly on the target),
/// slower or wrong-way velocities pass through.
pub fn max_release_v(x0: f64, to: f64) -> f64 {
    STIFFNESS.sqrt() * (to - x0)
}

/// Critically damped spring, closed form: position and velocity at `t` seconds, released at `x0` with `v0`
/// (page-widths/s) toward `to`.
pub fn spring(x0: f64, v0: f64, to: f64, t: f64) -> (f64, f64) {
    let w = STIFFNESS.sqrt();
    let d = x0 - to;
    let c = v0 + w * d;
    let e = (-w * t).exp();
    (to + (d + c * t) * e, (c - w * (d + c * t)) * e)
}

/// Seconds until the spring is at rest (within [`REST_X`] and slower than [`REST_V`]).
#[cfg(test)]
pub fn spring_duration(x0: f64, v0: f64, to: f64) -> f64 {
    let mut t = 0.0;
    while t < 2.0 {
        let (x, v) = spring(x0, v0, to, t);
        if (x - to).abs() < REST_X && v.abs() < REST_V {
            return t;
        }
        t += 0.004;
    }
    2.0
}

#[derive(Clone, Copy, Debug)]
struct Pending {
    dx: f64,
    dy: f64,
    refused: bool,
    /// Where the page is when the fingers land: 0 at rest, the spring's position when preempting a settle.
    base: f64,
}

#[derive(Clone, Debug)]
struct Track {
    hit: Hit,
    /// Raw finger position (page widths toward next), unbanded.
    raw: f64,
    /// Recent (t, raw) points for the lift velocity.
    hist: Vec<(f64, f64)>,
    last_t: f64,
    past: bool,
}

#[derive(Clone, Copy, Debug)]
struct Settle {
    from: f64,
    v0: f64,
    to: f64,
    t0: f64,
}

#[derive(Clone, Debug)]
enum State {
    Idle,
    Pending(Pending),
    Tracking(Track),
    Settling(Settle),
}

/// Scroll momentum after a lift keeps arriving for ~1 s; it belongs to the gesture that produced it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tail {
    None,
    /// Swallowing this gesture's momentum tail (it was ours).
    Ours,
}

#[derive(Clone, Debug)]
pub struct Engine {
    state: State,
    tail: Tail,
    seq: u64,
    /// Where the page is right now when not tracking (for a preempting gesture).
    amount: f64,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self {
            state: State::Idle,
            tail: Tail::None,
            seq: 0,
            amount: 0.0,
        }
    }

    pub fn seq(&self) -> u64 {
        self.seq
    }

    /// Fingers are on the pad and the engine owns the page.
    pub fn tracking(&self) -> bool {
        matches!(self.state, State::Tracking(_))
    }

    pub fn settling(&self) -> bool {
        matches!(self.state, State::Settling(_))
    }

    /// The engine has a gesture in flight (tracking or settling): the adapter should tick it.
    pub fn busy(&self) -> bool {
        self.tracking() || self.settling()
    }

    fn bounds(hit: Hit) -> (f64, f64) {
        (
            if hit.prev { -1.0 } else { 0.0 },
            if hit.next { 1.0 } else { 0.0 },
        )
    }

    /// One scroll event. `hit` resolves the zone under `(x, y)`; it is only called when a gesture claims.
    pub fn feed(&mut self, s: &Sample, hit: impl FnOnce(f64, f64) -> Option<Hit>) -> Step {
        // Fingers down: a new gesture. A settle in flight is preempted from where the spring is *now*.
        if matches!(s.phase, Phase::Began | Phase::MayBegin) {
            if let State::Settling(st) = &self.state {
                // The committed page is the new origin: the preempting gesture's amount is relative to it,
                // so a settle that was 70% of the way to the next page resumes at -0.3, not at 0.7 (the
                // consumer already moved its selection to `st.to` when the commit fired).
                let (x, _) = spring(st.from, st.v0, st.to, ((s.t - st.t0) / 1000.0).max(0.0));
                self.amount = x - st.to;
            }
            if !self.tracking() {
                self.state = State::Idle;
            }
            self.tail = Tail::None;
        }
        // A tail event of a swallowed gesture.
        if s.momentum != Momentum::None {
            return Step {
                swallow: self.tail == Tail::Ours,
                ..Step::default()
            };
        }
        match &mut self.state {
            State::Idle | State::Settling(_) => self.feed_idle(s, hit),
            State::Pending(_) => self.feed_pending(s, hit),
            State::Tracking(_) => self.feed_tracking(s),
        }
    }

    fn feed_idle(&mut self, s: &Sample, hit: impl FnOnce(f64, f64) -> Option<Hit>) -> Step {
        if !s.precise || !matches!(s.phase, Phase::Began | Phase::Changed) {
            return Step::default();
        }
        // `amount` is the page position: 0 at rest, the spring's position when this preempts a settle.
        self.state = State::Pending(Pending {
            dx: 0.0,
            dy: 0.0,
            refused: false,
            base: self.amount,
        });
        self.feed_pending(s, hit)
    }

    fn feed_pending(&mut self, s: &Sample, hit: impl FnOnce(f64, f64) -> Option<Hit>) -> Step {
        let State::Pending(p) = &mut self.state else {
            return Step::default();
        };
        if matches!(s.phase, Phase::Ended | Phase::Cancelled) {
            self.state = State::Idle;
            return Step::default();
        }
        if p.refused || !s.precise {
            return Step::default();
        }
        p.dx += s.dx;
        p.dy += s.dy;
        if p.dy.abs() > MAX_DY && p.dy.abs() * AXIS_RATIO >= p.dx.abs() {
            p.refused = true;
            return Step::default();
        }
        if p.dx.abs() < MIN_DX || p.dx.abs() <= AXIS_RATIO * p.dy.abs() {
            return Step::default();
        }
        let Some(h) = hit(s.x, s.y).filter(|h| (h.prev || h.next) && h.width > 1.0) else {
            p.refused = true;
            return Step::default();
        };
        // Claim. The travel so far counts: no dead zone under the fingers.
        let carried = p.base - p.dx / h.width;
        self.seq += 1;
        let (lo, hi) = Self::bounds(h);
        let tr = Track {
            hit: h,
            raw: carried,
            hist: vec![(s.t, carried)],
            last_t: s.t,
            past: false,
        };
        let amount = rubber(tr.raw, lo, hi);
        self.state = State::Tracking(tr);
        self.amount = amount;
        Step {
            swallow: true,
            frame: Some(Frame {
                seq: self.seq,
                amount,
                stage: Stage::Track,
            }),
            ..Step::default()
        }
    }

    fn feed_tracking(&mut self, s: &Sample) -> Step {
        let State::Tracking(tr) = &mut self.state else {
            return Step::default();
        };
        if matches!(s.phase, Phase::Ended | Phase::Cancelled) {
            return self.release(s.t, s.phase == Phase::Cancelled);
        }
        if s.phase == Phase::Changed || s.phase == Phase::Began {
            tr.raw -= s.dx / tr.hit.width;
            tr.last_t = s.t;
            tr.hist.push((s.t, tr.raw));
            let cutoff = s.t - VELOCITY_WINDOW_MS;
            tr.hist.retain(|(t, _)| *t >= cutoff);
        }
        let (lo, hi) = Self::bounds(tr.hit);
        let amount = rubber(tr.raw, lo, hi);
        self.amount = amount;
        let past = amount.abs() >= COMMIT_AT
            && ((amount > 0.0 && tr.hit.next) || (amount < 0.0 && tr.hit.prev));
        let threshold = (past != tr.past).then_some(past);
        tr.past = past;
        Step {
            swallow: true,
            frame: Some(Frame {
                seq: self.seq,
                amount,
                stage: Stage::Track,
            }),
            threshold,
            ..Step::default()
        }
    }

    /// Fingers lifted: measure the velocity, decide, start the spring.
    fn release(&mut self, now: f64, cancelled: bool) -> Step {
        let State::Tracking(tr) = &self.state else {
            return Step::default();
        };
        let (lo, hi) = Self::bounds(tr.hit);
        let at = rubber(tr.raw, lo, hi);
        let v = velocity(&tr.hist, now);
        let proj = at + v * PROJECT_S;
        let want = if proj >= COMMIT_AT && v >= -FLICK_MIN_V || at >= COMMIT_AT {
            1
        } else if proj <= -COMMIT_AT && v <= FLICK_MIN_V || at <= -COMMIT_AT {
            -1
        } else {
            0
        };
        // A "flick" needs speed in the direction of travel; a slow drag only commits by distance.
        let dir: i8 = match want {
            1 if tr.hit.next && (at >= COMMIT_AT || v >= FLICK_MIN_V) => 1,
            -1 if tr.hit.prev && (at <= -COMMIT_AT || v <= -FLICK_MIN_V) => -1,
            _ => 0,
        };
        let dir = if cancelled { 0 } else { dir };
        let to = f64::from(dir);
        let settle = Settle {
            from: at,
            v0: release_v(at, to, v),
            to,
            t0: now,
        };
        self.state = State::Settling(settle);
        self.tail = Tail::Ours;
        self.amount = at;
        Step {
            swallow: true,
            commit: Some(Commit { seq: self.seq, dir }),
            frame: Some(Frame {
                seq: self.seq,
                amount: at,
                stage: Stage::Settle,
            }),
            threshold: None,
        }
    }

    /// Programmatic page change (keyboard, click, history): the same spring, clock, generation and commit as a
    /// release, from where the page is now. `None` while the fingers are on the pad (they win).
    pub fn go(&mut self, dir: i8, now: f64) -> Option<Step> {
        if dir == 0 || self.tracking() {
            return None;
        }
        // Where the page is now, relative to the page it was heading to (see `feed`'s preempt).
        let base = match &self.state {
            State::Settling(st) => {
                spring(st.from, st.v0, st.to, ((now - st.t0) / 1000.0).max(0.0)).0 - st.to
            }
            _ => 0.0,
        };
        self.seq += 1;
        self.tail = Tail::None;
        self.amount = base;
        self.state = State::Settling(Settle {
            from: base,
            v0: 0.0,
            to: f64::from(dir),
            t0: now,
        });
        Some(Step {
            swallow: false,
            commit: Some(Commit { seq: self.seq, dir }),
            frame: Some(Frame {
                seq: self.seq,
                amount: base,
                stage: Stage::Settle,
            }),
            threshold: None,
        })
    }

    /// Advance the engine to `now` (ms). While settling it yields the spring's position and ends the gesture
    /// at rest; while tracking it detects a lost lift (no `Ended`) after [`STALE_MS`].
    pub fn tick(&mut self, now: f64) -> Step {
        match &self.state {
            State::Tracking(tr) if now - tr.last_t > STALE_MS => self.release(now, false),
            State::Settling(st) => {
                let t = ((now - st.t0) / 1000.0).max(0.0);
                let (x, v) = spring(st.from, st.v0, st.to, t);
                if (x - st.to).abs() < REST_X && v.abs() < REST_V {
                    let (seq, to) = (self.seq, st.to);
                    // The page it landed on is the new origin: the next gesture's amounts start at 0.
                    self.amount = 0.0;
                    self.state = State::Idle;
                    return Step {
                        frame: Some(Frame {
                            seq,
                            amount: to,
                            stage: Stage::Rest,
                        }),
                        ..Step::default()
                    };
                }
                self.amount = x;
                Step {
                    swallow: false,
                    frame: Some(Frame {
                        seq: self.seq,
                        amount: x,
                        stage: Stage::Settle,
                    }),
                    ..Step::default()
                }
            }
            _ => Step::default(),
        }
    }
}

/// The velocity the settle starts with: the finger's, but never away from the target and never so fast that
/// the spring would cross it (zero overshoot).
fn release_v(at: f64, to: f64, v: f64) -> f64 {
    let toward = (to - at).signum();
    if (to - at).abs() < f64::EPSILON || v * toward < 0.0 {
        return 0.0;
    }
    let cap = max_release_v(at, to).abs();
    toward * (v.abs()).min(cap)
}

/// Lift velocity (page-widths/s) from `(t ms, raw)` points: least-squares slope over the window, so a
/// single noisy sample cannot decide a release.
fn velocity(hist: &[(f64, f64)], now: f64) -> f64 {
    let pts: Vec<&(f64, f64)> = hist
        .iter()
        .filter(|(t, _)| now - t <= VELOCITY_WINDOW_MS + 8.0)
        .collect();
    if pts.len() < 2 {
        return 0.0;
    }
    let n = pts.len() as f64;
    let (st, sx) = pts.iter().fold((0.0, 0.0), |(a, b), (t, x)| (a + t, b + x));
    let (mt, mx) = (st / n, sx / n);
    let (num, den) = pts.iter().fold((0.0, 0.0), |(a, b), (t, x)| {
        (a + (t - mt) * (x - mx), b + (t - mt) * (t - mt))
    });
    if den == 0.0 { 0.0 } else { num / den * 1000.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f64 = 1000.0;
    const BOTH: Hit = Hit {
        prev: true,
        next: true,
        width: W,
    };

    fn s(t: f64, phase: Phase, dx: f64, dy: f64) -> Sample {
        Sample {
            t,
            phase,
            momentum: Momentum::None,
            dx,
            dy,
            precise: true,
            x: 100.0,
            y: 100.0,
        }
    }

    fn run(e: &mut Engine, samples: &[Sample], hit: Hit) -> Vec<Step> {
        samples
            .iter()
            .map(|x| e.feed(x, |_, _| Some(hit)))
            .collect()
    }

    #[test]
    fn rubber_is_identity_inside_and_saturates_outside() {
        assert_eq!(rubber(0.4, -1.0, 1.0), 0.4);
        assert!(rubber(1.5, -1.0, 1.0) > 1.0);
        assert!(rubber(9.0, -1.0, 1.0) < 1.0 + MAX_OVERSCROLL + 1e-9);
        assert_eq!(rubber(-0.3, 0.0, 1.0).signum(), -1.0);
        assert!(rubber(-0.3, 0.0, 1.0) > -MAX_OVERSCROLL);
    }

    #[test]
    fn spring_never_overshoots_and_ends_at_the_target() {
        for (x0, v, to) in [
            (0.4, 2.0, 1.0),
            (0.9, 0.0, 1.0),
            (0.2, -1.0, 0.0),
            (0.7, 6.0, 1.0),
            (0.05, 40.0, 1.0),
        ] {
            // The engine never starts a spring with the raw finger velocity: `release_v` caps it.
            let v0 = release_v(x0, to, v);
            let mut prev = x0;
            let mut t = 0.0;
            while t < 1.5 {
                let (x, _) = spring(x0, v0, to, t);
                // monotone toward the target, never past it
                if to >= x0 {
                    assert!(x <= to + 1e-9, "{x0} {v0} {to}: overshoot {x}");
                } else {
                    assert!(x >= to - 1e-9);
                }
                prev = x;
                t += 0.004;
            }
            assert!((prev - to).abs() < 1e-3);
            let d = spring_duration(x0, v0, to);
            assert!((0.05..0.9).contains(&d), "duration {d}");
        }
    }

    #[test]
    fn a_fast_flick_commits_on_release_even_below_half() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        // 8 px per 8 ms = 1 px/ms = 1 page/s at W=1000: a flick; total 40 px = 0.04 page.
        for i in 1..=5 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -8.0, 0.0));
        }
        v.push(s(48.0, Phase::Ended, 0.0, 0.0));
        let steps = run(&mut e, &v, BOTH);
        // 40 px < MIN_DX*... claim needs 15 px, so it claimed; release by velocity: 1 page/s * 0.12 = 0.12 + 0.04 < 0.5 → cancel
        let c = steps.iter().find_map(|x| x.commit).expect("a decision");
        assert_eq!(c.dir, 0, "1 page/s from 0.04 does not project past 0.5");
    }

    #[test]
    fn fast_and_far_commits_next_once() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        // 60 px per 8 ms = 7.5 px/ms = 7.5 pages/s; 3 samples = 0.18 page; projects to 0.18+0.9
        for i in 1..=3 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -60.0, 0.0));
        }
        v.push(s(32.0, Phase::Ended, 0.0, 0.0));
        let steps = run(&mut e, &v, BOTH);
        let commits: Vec<_> = steps.iter().filter_map(|x| x.commit).collect();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].dir, 1);
        assert_eq!(commits[0].seq, 1);
    }

    #[test]
    fn vertical_scroll_is_never_claimed() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=20 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -1.0, -14.0));
        }
        let steps = run(&mut e, &v, BOTH);
        assert!(steps.iter().all(|x| !x.swallow && x.frame.is_none()));
        assert!(!e.busy());
    }

    #[test]
    fn no_neighbour_means_never_claimed() {
        let mut e = Engine::new();
        let none = Hit {
            prev: false,
            next: false,
            width: W,
        };
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=10 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -20.0, 0.0));
        }
        assert!(run(&mut e, &v, none).iter().all(|x| !x.swallow));
    }

    #[test]
    fn at_the_last_page_the_swipe_only_rubber_bands_and_never_commits() {
        let mut e = Engine::new();
        let last = Hit {
            prev: true,
            next: false,
            width: W,
        };
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=12 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -40.0, 0.0));
        }
        v.push(s(110.0, Phase::Ended, 0.0, 0.0));
        let steps = run(&mut e, &v, last);
        let max = steps
            .iter()
            .filter_map(|x| x.frame)
            .map(|f| f.amount)
            .fold(0.0, f64::max);
        assert!(
            max <= MAX_OVERSCROLL + 1e-9,
            "rubber band stays small: {max}"
        );
        assert_eq!(steps.iter().filter_map(|x| x.commit).next().unwrap().dir, 0);
    }

    #[test]
    fn the_momentum_tail_is_swallowed_and_never_starts_a_second_gesture() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=4 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -60.0, 0.0));
        }
        v.push(s(40.0, Phase::Ended, 0.0, 0.0));
        run(&mut e, &v, BOTH);
        let g = e.seq();
        for i in 0..40 {
            let mut m = s(48.0 + f64::from(i) * 8.0, Phase::None, -30.0, 0.0);
            m.momentum = if i == 0 {
                Momentum::Began
            } else {
                Momentum::Changed
            };
            let st = e.feed(&m, |_, _| Some(BOTH));
            assert!(st.swallow, "momentum event {i} must be swallowed");
            assert!(st.commit.is_none());
        }
        assert_eq!(e.seq(), g, "no new gesture from the tail");
    }

    #[test]
    fn a_new_gesture_during_the_settle_continues_from_the_spring_position() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=4 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -60.0, 0.0));
        }
        v.push(s(40.0, Phase::Ended, 0.0, 0.0));
        run(&mut e, &v, BOTH);
        // 80 ms into the settle a new swipe begins the other way.
        let now = 120.0;
        let pos = e.tick(now).frame.unwrap().amount;
        let mut w = vec![s(now, Phase::Began, 0.0, 0.0)];
        for i in 1..=3 {
            w.push(s(now + f64::from(i) * 8.0, Phase::Changed, 40.0, 0.0));
        }
        let steps = run(&mut e, &w, BOTH);
        let first = steps.iter().find_map(|x| x.frame).unwrap();
        assert_eq!(first.seq, 2, "a preempting gesture is a new generation");
        // It resumes near where the page was, minus the new finger travel: no jump back to 0.
        // (`pos` is the spring's absolute position toward the committed page, which is the new origin: -(1 - pos)).
        // The first +40 pt event already passes the 15 pt gate, so the claim carries exactly that travel;
        // fingers moving right lower the amount.
        let expect = pos - 1.0 - 40.0 / BOTH.width;
        assert!(
            (first.amount - expect).abs() < 0.01,
            "{} vs {}",
            first.amount,
            expect
        );
    }

    /// Budget: a settle from rest to the next page takes 250-350 ms (to within 1 px of a 1000 px page).
    #[test]
    fn a_settle_from_rest_to_the_next_page_takes_250_to_350_ms() {
        let d = spring_duration(0.0, 0.0, 1.0) * 1000.0;
        assert!((250.0..=350.0).contains(&d), "settle took {d:.0} ms");
        // A flick released at 0.2 with real speed is not slower.
        assert!(spring_duration(0.2, 2.0, 1.0) * 1000.0 <= d);
    }

    #[test]
    fn go_commits_at_once_and_settles_from_rest_with_a_new_generation() {
        let mut e = Engine::new();
        let st = e
            .go(1, 1000.0)
            .expect("idle engine accepts a programmatic switch");
        assert_eq!(st.commit, Some(Commit { seq: 1, dir: 1 }));
        assert_eq!(st.frame.unwrap().amount, 0.0);
        // The spring runs to the page and ends at rest, once.
        let mut rest = 0;
        let mut last = 0.0;
        for i in 1..200 {
            let f = e.tick(1000.0 + f64::from(i) * 8.33).frame;
            if let Some(f) = f {
                assert!(f.amount >= last - 1e-9, "monotone toward the target");
                last = f.amount;
                if f.stage == Stage::Rest {
                    rest += 1;
                    assert_eq!(f.amount, 1.0);
                }
            }
        }
        assert_eq!(rest, 1);
        assert!(!e.busy());
    }

    #[test]
    fn go_is_refused_while_the_fingers_are_on_the_pad() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=4 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -20.0, 0.0));
        }
        run(&mut e, &v, BOTH);
        assert!(e.tracking());
        assert!(
            e.go(1, 100.0).is_none(),
            "keyboard must not fight the fingers"
        );
        assert!(e.tracking());
    }

    #[test]
    fn go_during_a_settle_continues_from_where_the_page_is() {
        let mut e = Engine::new();
        e.go(1, 0.0).unwrap();
        let mid = e.tick(100.0).frame.unwrap().amount; // somewhere between 0 and 1
        assert!(mid > 0.05 && mid < 0.95);
        let st = e.go(1, 100.0).unwrap();
        // The new switch is relative to the page we were heading to: -(1 - mid).
        assert!(
            (st.frame.unwrap().amount - (mid - 1.0)).abs() < 1e-9,
            "{:?}",
            st.frame
        );
        assert_eq!(st.commit.unwrap().seq, 2);
    }

    /// Incident (live bench): after a committed swipe finished settling, the next gesture started from the PREVIOUS
    /// page's end amount (-0.95 instead of 0): a left swipe read as a right one and the page went the wrong way.
    /// Once a settle is at rest the page it landed on is the new origin: the next gesture starts at 0.
    #[test]
    fn a_gesture_after_a_finished_settle_starts_from_rest_on_the_new_page() {
        let mut e = Engine::new();
        // A committed swipe to the next page, then let the settle finish.
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=4 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -60.0, 0.0));
        }
        v.push(s(40.0, Phase::Ended, 0.0, 0.0));
        let steps = run(&mut e, &v, BOTH);
        assert_eq!(steps.iter().find_map(|x| x.commit).unwrap().dir, 1);
        let mut t = 40.0;
        while e.busy() {
            t += 8.33;
            e.tick(t);
        }
        // A fresh swipe the same way: its first frame is a small amount toward next, not the old end (+1).
        let mut w = vec![s(t + 500.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=3 {
            w.push(s(
                t + 500.0 + f64::from(i) * 8.0,
                Phase::Changed,
                -40.0,
                0.0,
            ));
        }
        let first = run(&mut e, &w, BOTH).iter().find_map(|x| x.frame).unwrap();
        assert!(
            first.amount > 0.0 && first.amount < 0.2,
            "started at {}",
            first.amount
        );
        // And a cancelled swipe leaves the origin at 0 too.
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=3 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -10.0, 0.0));
        }
        v.push(s(30.0, Phase::Ended, 0.0, 0.0));
        run(&mut e, &v, BOTH);
        let mut t = 30.0;
        while e.busy() {
            t += 8.33;
            e.tick(t);
        }
        let mut w = vec![s(t + 500.0, Phase::Began, 0.0, 0.0)];
        w.push(s(t + 508.0, Phase::Changed, 40.0, 0.0));
        let first = run(&mut e, &w, BOTH).iter().find_map(|x| x.frame).unwrap();
        assert!(
            first.amount < 0.0 && first.amount > -0.2,
            "started at {}",
            first.amount
        );
    }

    #[test]
    fn a_lost_lift_is_released_after_the_stale_timeout() {
        let mut e = Engine::new();
        let mut v = vec![s(0.0, Phase::Began, 0.0, 0.0)];
        for i in 1..=5 {
            v.push(s(f64::from(i) * 8.0, Phase::Changed, -40.0, 0.0));
        }
        run(&mut e, &v, BOTH);
        assert!(e.tracking());
        assert!(e.tick(100.0).commit.is_none());
        let st = e.tick(40.0 + STALE_MS + 1.0);
        assert!(
            st.commit.is_some(),
            "no Ended ever came: the engine must release by itself"
        );
    }
}
