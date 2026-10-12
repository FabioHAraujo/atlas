//! Frame timing samples and their percentiles.

use std::time::Instant;

/// Frame timing. `work` = snapshot upload + encode + submit + present after the
/// drawable is acquired; `interval` = time between presents (vsync-bound under load).
#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub frames: u64,
    pub work_p50_us: u32,
    pub work_p95_us: u32,
    pub work_max_us: u32,
    pub interval_p50_us: u32,
    pub interval_p95_us: u32,
}

/// Most recent samples kept for percentiles.
const WINDOW: usize = 4096;

fn pct(v: &[u32], p: usize) -> u32 {
    if v.is_empty() {
        return 0;
    }
    let mut s = v.to_vec();
    s.sort_unstable();
    s[(s.len() - 1) * p / 100]
}

/// Rolling window of per-frame measurements.
pub(super) struct Timing {
    pub frames: u64,
    work: Vec<u32>,
    interval: Vec<u32>,
    last_present: Option<Instant>,
}

impl Timing {
    pub fn new() -> Self {
        Self {
            frames: 0,
            work: Vec::with_capacity(WINDOW),
            interval: Vec::with_capacity(WINDOW),
            last_present: None,
        }
    }

    /// Record a presented frame that started at `t0`.
    pub fn record(&mut self, t0: Instant) {
        let now = Instant::now();
        push_capped(&mut self.work, (now - t0).as_micros() as u32);
        if let Some(prev) = self.last_present.replace(now) {
            push_capped(&mut self.interval, (now - prev).as_micros() as u32);
        }
        self.frames += 1;
    }

    pub fn stats(&self) -> Stats {
        Stats {
            frames: self.frames,
            work_p50_us: pct(&self.work, 50),
            work_p95_us: pct(&self.work, 95),
            work_max_us: self.work.iter().copied().max().unwrap_or(0),
            interval_p50_us: pct(&self.interval, 50),
            interval_p95_us: pct(&self.interval, 95),
        }
    }

    /// Reset the measurement window.
    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

fn push_capped(v: &mut Vec<u32>, x: u32) {
    if v.len() == WINDOW {
        v.remove(0);
    }
    v.push(x);
}
