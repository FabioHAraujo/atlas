//! Keeping a `ViewIndex` honest as the buffer ages: sliding-window expiry,
//! eviction trimming and compaction. Everything here only *removes* rows.

use super::{CLOCK_STEP_MS, Problem, Row, ViewIndex};
use crate::runtime::logs::LogBuffer;

impl ViewIndex {
    /// Move a sliding window's cutoff to `now_ms`, dropping the rows that aged
    /// out. Pops from the front only (lines arrive in time order), so it costs
    /// O(dropped). No-op without a sliding window, and re-evaluated at most
    /// once per `CLOCK_STEP_MS` so a frame never pays for it.
    pub fn advance_clock(&mut self, now_ms: u64) {
        let Some(last_ms) = self.key.as_ref().and_then(|k| k.window.last_ms) else {
            return;
        };
        if now_ms < self.clock_ms + CLOCK_STEP_MS {
            return;
        }
        self.clock_ms = now_ms;
        let cutoff = now_ms.saturating_sub(last_ms);
        // Lines arrive in time order, so aged-out rows are almost always a
        // prefix: pop it. `oldest_ts` says in O(1) when one is hiding behind a
        // newer row (replayed backlog, a clock step) and only then compact.
        let mut dropped = None;
        while self.rows.front().is_some_and(|r| r.ts < cutoff) {
            if let Some(row) = self.rows.pop_front() {
                self.ts_min.remove(&row);
                dropped = Some(row.seq);
            }
            self.prefix.pop_front();
        }
        if let Some(last_seq) = dropped {
            self.drop_problems_through(last_seq);
        }
        if self.ts_min.min().is_some_and(|ts| ts < cutoff) {
            self.compact(|r| r.ts >= cutoff);
        }
    }

    /// Rebuild rows, prefix sums, problem jumps and the timestamp tracker from
    /// the rows `keep` accepts. O(rows); only reached for out-of-order stragglers.
    pub(super) fn compact(&mut self, keep: impl Fn(&Row) -> bool) {
        #[cfg(test)]
        {
            self.compactions += 1;
        }
        let kept: Vec<Row> = self.rows.iter().copied().filter(|r| keep(r)).collect();
        let base = self.base();
        self.rows.clear();
        self.prefix.clear();
        self.prefix.push_back(base);
        self.problems.clear();
        self.errors = 0;
        self.warns = 0;
        self.ts_min.clear();
        for r in kept {
            self.push_row(r);
        }
    }

    /// Drop exactly the rows whose entries the buffer evicted since the last
    /// sync. Each ring evicts from its own front, so on the All tab a dead row
    /// can sit anywhere among a quiet service's older lines: the buffer reports
    /// the evicted `seq`s and each is located by binary search. O(evicted ·
    /// log rows) plus a memmove; a reader that fell behind the eviction log
    /// rebuilds from the buffer once.
    pub(super) fn trim(&mut self, buf: &LogBuffer) {
        let gone: Vec<u64> = buf
            .evicted_since(self.evicted_seen)
            .map(Iterator::collect)
            .unwrap_or_default();
        self.evicted_seen = buf.evicted_total();
        self.remove_batch(gone);
    }

    /// Remove the rows of `gone` (the view may not hold some: filtered out or
    /// aged out of a window already). Entries at the front of the view go in
    /// O(1); the rest are dropped in one pass over the tail that starts at the
    /// first of them, so the cost per sync does not grow with how many a
    /// burst evicted.
    fn remove_batch(&mut self, mut gone: Vec<u64>) {
        gone.sort_unstable();
        let mut at = 0;
        loop {
            // Skip evicted seqs the view never held (below its front).
            while at < gone.len() && self.rows.front().is_some_and(|r| gone[at] < r.seq) {
                at += 1;
            }
            let Some(front) = self.rows.front().map(|r| r.seq) else {
                return;
            };
            if gone.get(at) != Some(&front) {
                break;
            }
            let row = self.rows.pop_front().expect("front checked");
            self.ts_min.remove(&row);
            self.prefix.pop_front();
            self.drop_problems_through(row.seq);
            at += 1;
        }
        let interior = &gone[at..];
        let Some(&first) = interior.first() else {
            return;
        };
        let from = self.lower_bound(first);
        if from >= self.rows.len() {
            return;
        }
        let tail: Vec<Row> = self.rows.drain(from..).collect();
        // `prefix[i]` precedes `rows[i]`: keep entries 0..=from, rebuild after.
        self.prefix.truncate(from + 1);
        for r in tail {
            if interior.binary_search(&r.seq).is_ok() {
                self.ts_min.remove(&r);
                if r.problem != Problem::None
                    && let Ok(p) = self.problems.binary_search_by_key(&r.seq, |&(s, _)| s)
                {
                    self.problems.remove(p);
                    match r.problem {
                        Problem::Error => self.errors -= 1,
                        _ => self.warns -= 1,
                    }
                }
            } else {
                let last = self.prefix.back().copied().unwrap_or(0);
                self.prefix.push_back(last + u64::from(r.hits));
                self.rows.push_back(r);
            }
        }
    }

    /// Forget warn/error jump targets with `seq <= last` (their rows are gone).
    fn drop_problems_through(&mut self, last: u64) {
        while let Some(&(s, is_err)) = self.problems.front() {
            if s > last {
                break;
            }
            self.problems.pop_front();
            if is_err {
                self.errors -= 1;
            } else {
                self.warns -= 1;
            }
        }
    }
}
