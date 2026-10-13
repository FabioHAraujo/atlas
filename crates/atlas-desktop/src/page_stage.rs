//! The native stage's decisions, pure (no AppKit): when the snapshot overlay goes up, which snapshot is the
//! outgoing and which the incoming page for each frame, how a commit re-labels them, and when the overlay may
//! come down. `page_layers.rs` is the thin AppKit shell that executes the [`Do`] this returns.
//!
//! The stage draws a slide from two cached snapshots (the page the gesture began on and the page it heads to)
//! moved natively at display rate, so the slide never waits on JS or on the 60 Hz webview. The live DOM sits
//! hidden under the overlay and is swapped to the new page behind it; the overlay comes down only after JS
//! acknowledges that the new page painted (or a watchdog fires), so no frame ever shows an unpainted page.
//!
//! Page ids are opaque strings (space ids, or tab ids of a group). `order` is the order the pages are in; the
//! stage never decides which page is next, it only reads `order`.

use std::collections::HashMap;

/// Longest the overlay may stay after the engine reached rest while waiting for JS's ack (ms).
pub const ACK_WATCHDOG_MS: f64 = 400.0;

/// A snapshot the shell holds for a page. `fresh` = taken since the page last changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Snap {
    pub fresh: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Do {
    /// Put the overlay up showing `cur` (and `inc` entering), over the pager rect. `inc` is `None` when the
    /// target page has no snapshot yet: the slide shows the page background there.
    Raise { cur: String, inc: Option<String> },
    /// Place the layers: `cur_x` / `inc_x` in fractions of the page width (negative = left).
    Move {
        cur_x: f64,
        inc_x: f64,
        inc: Option<String>,
    },
    /// The origin page changed (a commit): the outgoing layer is now what was incoming, swap the images.
    Rebase { cur: String },
    /// JS may now swap the live DOM under the overlay; ask it to ack once the new page painted.
    AwaitAck { seq: u64 },
    /// Take the overlay down.
    Lower,
}

#[derive(Debug, Default)]
pub struct Stage {
    /// Snapshots held, by page id.
    snaps: HashMap<String, Snap>,
    order: Vec<String>,
    /// The page the live DOM shows (the origin of the next gesture) while no overlay is up.
    active: Option<String>,
    up: Option<Up>,
    /// A still picture of the screen is up (a warm-up in progress): a gesture may take it over.
    covered: bool,
}

#[derive(Debug)]
struct Up {
    seq: u64,
    /// The page the amounts are relative to (changes on a commit).
    origin: String,
    /// Fixed incoming page (a jump), else the neighbour by the sign of the amount.
    target: Option<String>,
    committed: Option<i8>,
    /// Engine reached rest, waiting for JS.
    resting: Option<f64>,
    acked: bool,
}

impl Stage {
    pub fn set_pages(&mut self, order: Vec<String>, active: Option<String>) {
        self.snaps.retain(|id, _| order.contains(id));
        self.order = order;
        if self.up.is_none() {
            self.active = active;
        }
    }

    /// A snapshot of `id` was taken (`fresh`) or the page changed (`!fresh`, kept as a stale placeholder).
    pub fn snapped(&mut self, id: &str, fresh: bool) {
        self.snaps.insert(id.to_string(), Snap { fresh });
    }

    pub fn invalidate(&mut self, id: &str) {
        if let Some(s) = self.snaps.get_mut(id) {
            s.fresh = false;
        }
    }

    pub fn has(&self, id: &str) -> bool {
        self.snaps.contains_key(id)
    }

    pub fn is_up(&self) -> bool {
        self.up.is_some()
    }

    /// A cover was raised (the shell snapshotted the screen and put it over the pager).
    pub fn cover(&mut self) {
        self.covered = true;
    }

    /// Lift the cover, unless a gesture is drawing on it.
    pub fn uncover(&mut self) -> Vec<Do> {
        if self.up.is_some() || !self.covered {
            return vec![];
        }
        self.covered = false;
        vec![Do::Lower]
    }

    fn around(&self, id: &str, dir: i8) -> Option<String> {
        let i = self.order.iter().position(|x| x == id)?;
        let n = self.order.len();
        if n < 2 {
            return None;
        }
        let j = (i as i64 + i64::from(dir)).rem_euclid(n as i64) as usize;
        Some(self.order[j].clone())
    }

    /// An engine frame (`amount` relative to the current origin). Raises the overlay on a new generation when
    /// the origin page has a snapshot; otherwise returns nothing and the JS pager draws this gesture (the same
    /// frames, 60 Hz).
    pub fn frame(
        &mut self,
        seq: u64,
        amount: f64,
        rest: bool,
        target: Option<&str>,
        now: f64,
    ) -> Vec<Do> {
        let mut out = vec![];
        if self.up.as_ref().is_some_and(|u| seq < u.seq) {
            return out;
        }
        if self.up.as_ref().is_none_or(|u| seq > u.seq) {
            // New generation. If an overlay is still up (a gesture preempting a settle) it keeps drawing: the
            // origin is whatever the previous one committed to.
            let origin = match &self.up {
                Some(u) => match u.committed {
                    Some(d) if d != 0 => u
                        .target
                        .clone()
                        .or_else(|| self.around(&u.origin, d))
                        .unwrap_or(u.origin.clone()),
                    _ => u.origin.clone(),
                },
                None => match &self.active {
                    Some(a) => a.clone(),
                    None => return out,
                },
            };
            let raised = self.up.is_some() || std::mem::take(&mut self.covered);
            if !self.has(&origin) {
                // No snapshot of where we are: the page cannot be drawn natively; JS draws it.
                if raised {
                    out.push(Do::Lower);
                    self.up = None;
                }
                return out;
            }
            self.up = Some(Up {
                seq,
                origin: origin.clone(),
                target: target.map(String::from),
                committed: None,
                resting: None,
                acked: false,
            });
            if raised {
                out.push(Do::Rebase { cur: origin });
            } else {
                let inc = self.incoming(amount);
                out.push(Do::Raise { cur: origin, inc });
            }
        }
        let u = self.up.as_mut().expect("raised above");
        if rest {
            u.resting = Some(now);
            out.push(Do::AwaitAck { seq });
            // The final pose: the page at rest on the origin (a commit has re-labelled the origin).
            return out;
        }
        let inc = self.incoming(amount);
        let dir = if amount >= 0.0 { 1.0 } else { -1.0 };
        out.push(Do::Move {
            cur_x: -amount,
            inc_x: dir - amount,
            inc,
        });
        out
    }

    fn incoming(&self, amount: f64) -> Option<String> {
        let u = self.up.as_ref();
        let origin = u
            .map(|u| u.origin.clone())
            .or_else(|| self.active.clone())?;
        let id = match u.and_then(|u| u.target.clone()) {
            Some(t) => t,
            None => self.around(&origin, if amount >= 0.0 { 1 } else { -1 })?,
        };
        self.has(&id).then_some(id)
    }

    /// The release decision. Idempotent per generation.
    pub fn commit(&mut self, seq: u64, dir: i8) {
        if let Some(u) = self.up.as_mut()
            && u.seq == seq
            && u.committed.is_none()
        {
            u.committed = Some(dir);
        }
    }

    /// JS acknowledged that the live DOM shows the page the generation ended on and painted it.
    pub fn ack(&mut self, seq: u64) -> Vec<Do> {
        match &mut self.up {
            Some(u) if u.seq == seq && u.resting.is_some() => {
                u.acked = true;
                self.finish()
            }
            _ => vec![],
        }
    }

    /// The overlay waited for an ack past the watchdog: take it down anyway.
    pub fn tick(&mut self, now: f64) -> Vec<Do> {
        match &self.up {
            Some(Up {
                resting: Some(t0), ..
            }) if now - t0 > ACK_WATCHDOG_MS => self.finish(),
            _ => vec![],
        }
    }

    fn finish(&mut self) -> Vec<Do> {
        let Some(u) = self.up.take() else {
            return vec![];
        };
        // The origin of the next gesture is where this one ended.
        let end = match u.committed {
            Some(d) if d != 0 => u.target.clone().or_else(|| self.around(&u.origin, d)),
            _ => Some(u.origin),
        };
        self.active = end;
        vec![Do::Lower]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage() -> Stage {
        let mut s = Stage::default();
        s.set_pages(vec!["a".into(), "b".into(), "c".into()], Some("b".into()));
        for id in ["a", "b", "c"] {
            s.snapped(id, true);
        }
        s
    }

    fn moves(d: &[Do]) -> Vec<(f64, f64)> {
        d.iter()
            .filter_map(|x| match x {
                Do::Move { cur_x, inc_x, .. } => Some((*cur_x, *inc_x)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_first_frame_raises_the_overlay_on_the_origin_with_the_neighbour_entering() {
        let mut s = stage();
        let d = s.frame(1, 0.2, false, None, 0.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "b".into(),
                inc: Some("c".into())
            }
        );
        assert_eq!(moves(&d), vec![(-0.2, 0.8)]);
        // Fingers the other way: the previous page enters from the left.
        let mut s = stage();
        let d = s.frame(1, -0.3, false, None, 0.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "b".into(),
                inc: Some("a".into())
            }
        );
        assert_eq!(moves(&d), vec![(0.3, -0.7)]);
    }

    #[test]
    fn without_a_snapshot_of_the_origin_nothing_is_drawn_natively() {
        let mut s = Stage::default();
        s.set_pages(vec!["a".into(), "b".into()], Some("a".into()));
        assert!(s.frame(1, 0.2, false, None, 0.0).is_empty());
        assert!(!s.is_up());
    }

    #[test]
    fn a_neighbour_without_a_snapshot_slides_in_as_background_not_as_a_wrong_page() {
        let mut s = Stage::default();
        s.set_pages(vec!["a".into(), "b".into(), "c".into()], Some("b".into()));
        s.snapped("b", true);
        let d = s.frame(1, 0.2, false, None, 0.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "b".into(),
                inc: None
            }
        );
    }

    #[test]
    fn the_overlay_stays_until_js_acks_the_swap_and_then_the_origin_is_the_committed_page() {
        let mut s = stage();
        s.frame(1, 0.4, false, None, 0.0);
        s.commit(1, 1);
        s.commit(1, -1); // a second decision for the same generation is ignored
        let d = s.frame(1, 1.0, true, None, 500.0);
        assert!(d.contains(&Do::AwaitAck { seq: 1 }));
        assert!(
            s.is_up(),
            "no ack yet: the overlay must still cover the swap"
        );
        assert!(
            s.ack(2).is_empty(),
            "an ack for another generation does nothing"
        );
        assert_eq!(s.ack(1), vec![Do::Lower]);
        assert!(!s.is_up());
        // The next gesture starts from `c`, the page the commit went to.
        let d = s.frame(2, 0.1, false, None, 900.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "c".into(),
                inc: Some("a".into())
            }
        );
    }

    #[test]
    fn a_cancel_comes_back_to_the_same_origin() {
        let mut s = stage();
        s.frame(1, 0.2, false, None, 0.0);
        s.commit(1, 0);
        s.frame(1, 0.0, true, None, 300.0);
        s.ack(1);
        let d = s.frame(2, -0.1, false, None, 800.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "b".into(),
                inc: Some("a".into())
            }
        );
    }

    #[test]
    fn a_gesture_preempting_a_settle_rebases_on_the_committed_page_and_keeps_the_overlay() {
        let mut s = stage();
        s.frame(1, 0.6, false, None, 0.0);
        s.commit(1, 1);
        s.frame(1, 0.85, false, None, 100.0);
        // seq 2 arrives while the overlay is up: rebased on `c`, amount relative to it.
        let d = s.frame(2, -0.15, false, None, 120.0);
        assert_eq!(d[0], Do::Rebase { cur: "c".into() });
        assert_eq!(moves(&d), vec![(0.15, -0.85)]);
        assert!(s.is_up(), "never drops the overlay between two gestures");
    }

    #[test]
    fn a_frame_of_an_older_generation_changes_nothing() {
        let mut s = stage();
        s.frame(2, 0.3, false, None, 0.0);
        assert!(s.frame(1, 0.9, false, None, 5.0).is_empty());
    }

    #[test]
    fn the_watchdog_takes_the_overlay_down_when_js_never_acks() {
        let mut s = stage();
        s.frame(1, 0.6, false, None, 0.0);
        s.commit(1, 1);
        s.frame(1, 1.0, true, None, 300.0);
        assert!(s.tick(300.0 + ACK_WATCHDOG_MS - 1.0).is_empty());
        assert_eq!(s.tick(300.0 + ACK_WATCHDOG_MS + 1.0), vec![Do::Lower]);
        assert!(!s.is_up());
    }

    #[test]
    fn a_jump_to_a_non_adjacent_page_slides_that_page_in() {
        let mut s = stage();
        let d = s.frame(1, 0.3, false, Some("a"), 0.0);
        assert_eq!(
            d[0],
            Do::Raise {
                cur: "b".into(),
                inc: Some("a".into())
            }
        );
        s.commit(1, 1);
        s.frame(1, 1.0, true, Some("a"), 300.0);
        s.ack(1);
        assert_eq!(
            s.frame(2, 0.1, false, None, 900.0)[0],
            Do::Raise {
                cur: "a".into(),
                inc: Some("b".into())
            }
        );
    }

    #[test]
    fn a_gesture_starting_under_a_cover_reuses_the_overlay_instead_of_stacking_a_second_one() {
        let mut s = stage();
        s.cover();
        assert!(!s.is_up(), "a cover is not a gesture");
        let d = s.frame(1, 0.2, false, None, 0.0);
        assert_eq!(
            d[0],
            Do::Rebase { cur: "b".into() },
            "the cover already shows the origin: no new overlay"
        );
        assert!(!d.iter().any(|x| matches!(x, Do::Raise { .. })));
        assert_eq!(moves(&d), vec![(-0.2, 0.8)]);
    }

    #[test]
    fn a_cover_is_lifted_by_uncover_but_never_while_a_gesture_draws() {
        let mut s = stage();
        s.cover();
        assert_eq!(s.uncover(), vec![Do::Lower]);
        s.cover();
        s.frame(1, 0.2, false, None, 0.0);
        assert!(s.uncover().is_empty(), "a running gesture owns the overlay");
    }

    #[test]
    fn pages_that_left_the_order_lose_their_snapshots() {
        let mut s = stage();
        s.set_pages(vec!["a".into(), "b".into()], Some("b".into()));
        assert!(!s.has("c"));
        assert!(s.has("a"));
    }
}
