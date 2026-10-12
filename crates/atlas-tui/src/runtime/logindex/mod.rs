//! Search and view indexing over a `LogBuffer`.
//!
//! * `Matcher` — one compiled query (literal or regex, smartcase) shared by the
//!   TUI find bar and the MCP `atlas_logs_search` tool.
//! * `ViewIndex` — the rows of one *view* (tab + level filter + time window +
//!   optional filter query) plus every find hit in them, built
//!   **incrementally**: the buffer is scanned by sequence number, so each new
//!   line is looked at once and a frame never rescans history. A change of the
//!   view definition (`ViewKey`) or an eviction/clear in the buffer rebuilds
//!   it once. A sliding time window ("last 5 min") is advanced with
//!   `advance_clock`, which only pops the rows that aged out of the front.
//!
//! Hits are addressed as `(seq, occurrence)`; `n`-th / next / prev are
//! `O(log N)` over a prefix-sum of per-row hit counts.

mod matcher;
#[cfg(test)]
mod tests;
mod trim;

use std::borrow::Cow;
use std::collections::VecDeque;
use std::ops::Range;

pub use matcher::{Matcher, search_text};

use super::logs::{LogBuffer, LogLevel};
use super::timerange::Window;
use matcher::plain_text;

/// A sliding time window is re-evaluated at most this often.
pub const CLOCK_STEP_MS: u64 = 1000;

/// Which entries a view shows and what it searches. Any change rebuilds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewKey {
    /// `None` = every non-hidden service (the All tab).
    pub service: Option<String>,
    /// Services excluded from the All tab.
    pub hidden: Vec<String>,
    /// Minimum level (`None` = all). Marks always pass.
    pub min_level: Option<LogLevel>,
    /// Filter mode: only lines matching this survive (`query`, `regex`).
    pub filter: Option<(String, bool)>,
    /// Find mode: hits are counted for this (`query`, `regex`).
    pub find: Option<(String, bool)>,
    /// Search the JSON-compacted text.
    pub json: bool,
    /// Time bounds (`Window::default()` = unbounded). Resolved by the caller;
    /// a sliding window keeps only its length, so it never changes the key.
    pub window: Window,
}

#[derive(Debug, Clone, Copy)]
struct Row {
    seq: u64,
    /// Epoch millis of the line (the sliding window drops by it).
    ts: u64,
    /// Find hits inside this row.
    hits: u32,
    problem: Problem,
}

/// What a row is to the `]e` / `[e` jumps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Problem {
    None,
    Warn,
    Error,
}

/// Oldest timestamp among the live rows: an ordered set of `(ts, seq)`, so
/// the minimum, an insert and the removal of any row are all O(log n). Lines
/// mostly arrive in time order, but a replayed backlog or an interior eviction
/// makes "the front row is the oldest" false, hence a real ordered set.
#[derive(Debug, Default)]
struct MinTs(std::collections::BTreeSet<(u64, u64)>);

impl MinTs {
    fn push(&mut self, seq: u64, ts: u64) {
        self.0.insert((ts, seq));
    }

    fn min(&self) -> Option<u64> {
        self.0.first().map(|&(ts, _)| ts)
    }

    fn remove(&mut self, row: &Row) {
        self.0.remove(&(row.ts, row.seq));
    }

    fn clear(&mut self) {
        self.0.clear();
    }
}

/// Sequence numbers of a row range: exact-size, double-ended and cheap to clone.
#[derive(Debug, Clone)]
pub struct Seqs<'a>(std::collections::vec_deque::Iter<'a, Row>);

impl Iterator for Seqs<'_> {
    type Item = u64;

    fn next(&mut self) -> Option<u64> {
        self.0.next().map(|r| r.seq)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.0.size_hint()
    }
}

impl ExactSizeIterator for Seqs<'_> {}

impl DoubleEndedIterator for Seqs<'_> {
    fn next_back(&mut self) -> Option<u64> {
        self.0.next_back().map(|r| r.seq)
    }
}

/// Incremental projection of a `LogBuffer` for one `ViewKey`.
#[derive(Debug)]
pub struct ViewIndex {
    key: Option<ViewKey>,
    filter: Option<Matcher>,
    find: Option<Matcher>,
    rows: VecDeque<Row>,
    /// `prefix[i]` = total hits before `rows[i]`, counted from the first row
    /// ever indexed (monotonic; subtract `prefix[0]` for view-relative ordinals).
    /// Length = rows + 1.
    prefix: VecDeque<u64>,
    /// Every entry with `seq < next_seq` has been considered.
    next_seq: u64,
    /// Buffer generation this index was built from.
    generation: u64,
    /// Evictions of the buffer this index has already applied.
    evicted_seen: u64,
    /// Warn and error rows in order (`true` = error): `]e` / `[e` targets.
    problems: VecDeque<(u64, bool)>,
    errors: usize,
    warns: usize,
    /// The filter query does not compile: the view is empty by definition.
    reject_all: bool,
    /// The clock the sliding window was last evaluated at (epoch millis).
    clock_ms: u64,
    /// Oldest timestamp among the rows (sliding-window minimum).
    ts_min: MinTs,
    /// How many times `compact` ran (tests assert the straggler path is hit).
    #[cfg(test)]
    compactions: usize,
}

impl Default for ViewIndex {
    fn default() -> Self {
        Self {
            key: None,
            filter: None,
            find: None,
            rows: VecDeque::new(),
            prefix: VecDeque::from([0]),
            next_seq: 0,
            generation: u64::MAX,
            evicted_seen: 0,
            problems: VecDeque::new(),
            errors: 0,
            warns: 0,
            reject_all: false,
            clock_ms: 0,
            ts_min: MinTs::default(),
            #[cfg(test)]
            compactions: 0,
        }
    }
}

impl ViewIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bring the index up to date with `buf` for `key`. Cost: O(new lines +
    /// lines that aged out of a sliding window) when only appends happened;
    /// one full rebuild when the key changed or the buffer evicted/cleared
    /// lines the index still holds.
    pub fn sync(&mut self, buf: &LogBuffer, key: &ViewKey) {
        self.sync_at(buf, key, super::clock::now_ms());
    }

    /// `sync` at an explicit wall-clock `now_ms` (the clock only matters to a
    /// sliding window).
    pub fn sync_at(&mut self, buf: &LogBuffer, key: &ViewKey, now_ms: u64) {
        // A view change, a clear, or an eviction log that no longer reaches
        // back to what this index has applied: rebuild once from the buffer.
        let rebuild = self.key.as_ref() != Some(key)
            || self.generation != buf.generation()
            || buf.evicted_since(self.evicted_seen).is_none();
        if rebuild {
            self.reset(key.clone());
            self.generation = buf.generation();
            self.evicted_seen = buf.evicted_total();
            self.clock_ms = now_ms;
        }
        // Appends only advance the high-water mark; eviction is handled by
        // `trim` below so memory follows the ring, not the history.
        let from = self.next_seq;
        let to = buf.next_seq();
        if from < to {
            if !self.reject_all {
                self.scan(buf, key, from);
            }
            self.next_seq = to;
        }
        self.trim(buf);
        self.advance_clock(now_ms);
    }

    /// Append `row`: rows, prefix sum, jump targets and the oldest-timestamp
    /// tracker move together.
    fn push_row(&mut self, row: Row) {
        let last = self.prefix.back().copied().unwrap_or(0);
        self.prefix.push_back(last + u64::from(row.hits));
        match row.problem {
            Problem::Error => {
                self.problems.push_back((row.seq, true));
                self.errors += 1;
            }
            Problem::Warn => {
                self.problems.push_back((row.seq, false));
                self.warns += 1;
            }
            Problem::None => {}
        }
        self.ts_min.push(row.seq, row.ts);
        self.rows.push_back(row);
    }

    /// Consider every entry with `seq >= from` once.
    fn scan(&mut self, buf: &LogBuffer, key: &ViewKey, from: u64) {
        let json = key.json;
        let min = key.min_level;
        let window = key.window;
        let cutoff = window.cutoff(self.clock_ms);
        buf.for_each_from(from.max(window.min_seq), key.service.as_deref(), |e| {
            if key.service.is_none() && key.hidden.contains(&e.service) {
                return;
            }
            if !window.allows(e.seq, e.timestamp, cutoff) {
                return;
            }
            let synthetic = e.mark || e.restart;
            if !synthetic && min.is_some_and(|m| e.level.rank() < m.rank()) {
                return;
            }
            let mut text: Option<Cow<'_, str>> = None;
            if let Some(f) = &self.filter {
                if synthetic {
                    return;
                }
                if !f.is_match(text.get_or_insert_with(|| plain_text(e, json))) {
                    return;
                }
            }
            let hits = match (&self.find, synthetic) {
                (Some(f), false) => f.count(text.get_or_insert_with(|| plain_text(e, json))) as u32,
                _ => 0,
            };
            let problem = match e.level {
                _ if synthetic => Problem::None,
                LogLevel::Error => Problem::Error,
                LogLevel::Warn => Problem::Warn,
                _ => Problem::None,
            };
            self.push_row(Row {
                seq: e.seq,
                ts: e.timestamp,
                hits,
                problem,
            });
        });
    }

    fn reset(&mut self, key: ViewKey) {
        self.filter = key.filter.as_ref().and_then(|(q, r)| Matcher::new(q, *r));
        self.find = key.find.as_ref().and_then(|(q, r)| Matcher::new(q, *r));
        self.reject_all = key.filter.is_some() && self.filter.is_none();
        self.rows.clear();
        self.prefix.clear();
        self.prefix.push_back(0);
        self.next_seq = 0;
        self.problems.clear();
        self.errors = 0;
        self.warns = 0;
        self.ts_min.clear();
        self.key = Some(key);
    }

    // ---- rows -----------------------------------------------------------

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Sequence number of row `i` (oldest = 0).
    pub fn seq_at(&self, i: usize) -> Option<u64> {
        self.rows.get(i).map(|r| r.seq)
    }

    /// Row index of `seq` (exact), if that line is in the view.
    pub fn index_of(&self, seq: u64) -> Option<usize> {
        let i = self.rows.partition_point(|r| r.seq < seq);
        (self.rows.get(i)?.seq == seq).then_some(i)
    }

    /// First row index with `seq >= s`.
    pub fn lower_bound(&self, seq: u64) -> usize {
        self.rows.partition_point(|r| r.seq < seq)
    }

    // ---- find hits ------------------------------------------------------

    /// Total hits in the view (0 without a find query).
    pub fn total_hits(&self) -> usize {
        (self.prefix.back().copied().unwrap_or(0) - self.base()) as usize
    }

    /// Hits already dropped off the front.
    fn base(&self) -> u64 {
        self.prefix.front().copied().unwrap_or(0)
    }

    /// The n-th hit (0-based, oldest first) as `(seq, occurrence)`.
    pub fn nth_hit(&self, n: usize) -> Option<(u64, usize)> {
        if n >= self.total_hits() {
            return None;
        }
        let base = self.base();
        let n = n as u64 + base;
        // First row whose running total exceeds n.
        let at = |i: usize| self.prefix[i];
        let (mut lo, mut hi) = (1usize, self.prefix.len() - 1);
        while lo < hi {
            let mid = (lo + hi) / 2;
            if at(mid) > n {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        let row = lo - 1;
        Some((self.rows[row].seq, (n - at(row)) as usize))
    }

    /// Ordinal (0-based) of the hit `(seq, occ)`; `None` if it is not a hit of this view.
    pub fn hit_ordinal(&self, seq: u64, occ: usize) -> Option<usize> {
        let i = self.index_of(seq)?;
        (occ < self.rows[i].hits as usize).then(|| (self.prefix[i] - self.base()) as usize + occ)
    }

    /// Ordinal of the first hit at or after row-sequence `seq` (`total_hits`
    /// when there is none) — where a cursor sitting at `seq` lands.
    pub fn hit_ordinal_from_seq(&self, seq: u64) -> usize {
        (self.prefix[self.lower_bound(seq)] - self.base()) as usize
    }

    /// Next hit after ordinal `cur` (wraps); `None` without hits.
    pub fn next_hit(&self, cur: usize) -> Option<usize> {
        let n = self.total_hits();
        (n > 0).then(|| (cur.min(n - 1) + 1) % n)
    }

    /// Previous hit before ordinal `cur` (wraps); `None` without hits.
    pub fn prev_hit(&self, cur: usize) -> Option<usize> {
        let n = self.total_hits();
        (n > 0).then(|| (cur.min(n - 1) + n - 1) % n)
    }

    // ---- level jumps ----------------------------------------------------

    /// Nearest error (`warn` = also warnings) strictly after/before `from`,
    /// wrapping around the view. `from = None` starts at the newest edge
    /// (backward) or oldest edge (forward). `None` when the view has none.
    pub fn jump_level(&self, from: Option<u64>, forward: bool, warn: bool) -> Option<u64> {
        let want = |&(_, is_err): &(u64, bool)| warn || is_err;
        let n = self.problems.len();
        // Index of the first problem with seq > from (forward) / the slot to
        // search backwards from.
        let split = match from {
            Some(s) => self.problems.partition_point(|&(q, _)| q <= s),
            None if forward => 0,
            None => n,
        };
        let found = if forward {
            self.problems
                .range(split..)
                .chain(self.problems.range(..split))
                .find(|p| want(p))
        } else {
            let before = match from {
                // Strictly before `from`: skip an entry equal to it.
                Some(s) => self.problems.partition_point(|&(q, _)| q < s),
                None => n,
            };
            self.problems
                .range(..before)
                .rev()
                .chain(self.problems.range(before..).rev())
                .find(|p| want(p))
        };
        found.map(|&(s, _)| s)
    }

    pub fn error_count(&self) -> usize {
        self.errors
    }

    pub fn warn_count(&self) -> usize {
        self.warns
    }

    /// Row indices `[start, end)` as seqs, for the renderer (O(range)).
    pub fn seqs(&self, range: Range<usize>) -> Seqs<'_> {
        Seqs(
            self.rows
                .range(range.start.min(self.rows.len())..range.end.min(self.rows.len())),
        )
    }

    /// Hits inside row `i`.
    pub fn hits_at(&self, i: usize) -> usize {
        self.rows.get(i).map_or(0, |r| r.hits as usize)
    }
}
