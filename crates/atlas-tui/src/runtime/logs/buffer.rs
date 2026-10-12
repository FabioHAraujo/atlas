//! Per-service ring buffers with one monotonic sequence across all services.

use std::collections::{HashMap, VecDeque};

use super::{LogEntry, LogLevel, LogStream};
use crate::runtime::clock::{HmsCache, now_ms};
use crate::runtime::linebuf::TRUNCATION_MARK;
use crate::runtime::text;

/// Evictions remembered for indexes that sync between frames; a reader that
/// fell further behind rebuilds.
const EVICTION_LOG: usize = 65_536;

#[cfg(test)]
pub(crate) const EVICTION_LOG_FOR_TESTS: usize = EVICTION_LOG;

/// Default per-service byte budget (entry payload + bookkeeping).
pub const DEFAULT_RING_BYTES: usize = 8 * 1024 * 1024;

/// One service's ring plus its running byte cost.
#[derive(Default)]
struct Ring {
    entries: VecDeque<LogEntry>,
    bytes: usize,
}

impl Ring {
    /// Append `e`, evicting from the front past the line/byte budget; every
    /// evicted entry's `seq` goes to `evicted`.
    fn push(
        &mut self,
        e: LogEntry,
        max_lines: usize,
        max_bytes: usize,
        mut evicted: impl FnMut(u64),
    ) {
        self.bytes += e.cost();
        self.entries.push_back(e);
        // Always keep the newest entry, however big.
        while self.entries.len() > 1 && (self.entries.len() > max_lines || self.bytes > max_bytes) {
            if let Some(old) = self.entries.pop_front() {
                self.bytes -= old.cost();
                evicted(old.seq);
            }
        }
    }
}

/// Per-service ring buffers: a chatty service can only evict its own history.
/// `capacity` is lines per service, `max_bytes` bytes per service (whichever
/// is hit first evicts the oldest); `all()` merges by arrival sequence number.
/// Every line gets a monotonic `seq`, its level and its timestamp exactly once,
/// at ingest.
pub struct LogBuffer {
    rings: HashMap<String, Ring>,
    /// `seq` of the newest restart separator per service. Survives the marker
    /// being evicted from its ring, so "since restart" stays correct.
    last_restart: HashMap<String, u64>,
    /// `seq` of recently evicted entries, oldest first; `evicted_total` counts
    /// every eviction ever, so a reader remembers "how many I have seen".
    evictions: VecDeque<u64>,
    evicted_total: u64,
    capacity: usize,
    max_bytes: usize,
    next_seq: u64,
    /// Bumped by anything that invalidates indexes built over the buffer
    /// without being an append (`clear`).
    generation: u64,
    time: HmsCache,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self::with_budget(capacity, DEFAULT_RING_BYTES)
    }

    pub fn with_budget(capacity: usize, max_bytes: usize) -> Self {
        Self {
            rings: HashMap::new(),
            last_restart: HashMap::new(),
            evictions: VecDeque::new(),
            evicted_total: 0,
            capacity,
            max_bytes,
            next_seq: 0,
            generation: 0,
            time: HmsCache::default(),
        }
    }

    pub fn push(&mut self, service: String, content: String, stream: LogStream) -> &LogEntry {
        let kind = if content.ends_with(TRUNCATION_MARK) {
            Kind::Truncated
        } else {
            Kind::Line
        };
        self.push_entry(service, content, stream, kind, None)
    }

    /// Like `push`, for a line that happened earlier (an attached client's backlog):
    /// keeps the original epoch-millis time instead of stamping "now".
    pub fn push_at(&mut self, service: String, content: String, stream: LogStream, ts_ms: u64) {
        self.push_entry(service, content, stream, Kind::Line, Some(ts_ms));
    }

    /// Ingest with the wire `kind` of a replayed/streamed line: `"restart"`
    /// and `"mark"` become separators, anything else a normal line.
    pub fn push_kind(
        &mut self,
        service: String,
        content: String,
        stream: LogStream,
        kind: &str,
        ts_ms: Option<u64>,
    ) {
        let kind = match kind {
            "restart" => Kind::Restart,
            "mark" => Kind::Mark,
            _ if content.ends_with(TRUNCATION_MARK) => Kind::Truncated,
            _ => Kind::Line,
        };
        self.push_entry(service, content, stream, kind, ts_ms);
    }

    /// Insert a `──── HH:MM:SS mark ────` separator into `service`'s stream.
    /// Returns the line text (for the disk log).
    pub fn push_mark(&mut self, service: String) -> String {
        let line = format!("──── {} mark ────", self.time.format(now_ms()));
        self.push_entry(service, line.clone(), LogStream::Stdout, Kind::Mark, None);
        line
    }

    /// Insert a `──── HH:MM:SS restarted ────` separator: the lines below it
    /// belong to a new run of `service`. Returns the line text (disk log).
    pub fn push_restart(&mut self, service: String) -> String {
        let line = format!("──── {} restarted ────", self.time.format(now_ms()));
        self.push_entry(
            service,
            line.clone(),
            LogStream::Stdout,
            Kind::Restart,
            None,
        );
        line
    }

    fn push_entry(
        &mut self,
        service: String,
        content: String,
        stream: LogStream,
        kind: Kind,
        at_ms: Option<u64>,
    ) -> &LogEntry {
        let timestamp = at_ms.unwrap_or_else(now_ms);
        let time_str = self.time.format(timestamp).to_string();
        let level = if matches!(kind, Kind::Line | Kind::Truncated) {
            LogLevel::detect(&content)
        } else {
            LogLevel::Info
        };
        let entry = LogEntry {
            seq: self.next_seq,
            timestamp,
            service: service.clone(),
            stream,
            level,
            content,
            time_str,
            mark: kind == Kind::Mark,
            restart: kind == Kind::Restart,
            truncated: kind == Kind::Truncated,
        };
        self.next_seq += 1;
        if kind == Kind::Restart {
            self.last_restart.insert(service.clone(), entry.seq);
        }
        let (cap, bytes) = (self.capacity, self.max_bytes);
        let ring = self.rings.entry(service).or_default();
        let (log, total) = (&mut self.evictions, &mut self.evicted_total);
        ring.push(entry, cap, bytes, |seq| {
            if log.len() == EVICTION_LOG {
                log.pop_front();
            }
            log.push_back(seq);
            *total += 1;
        });
        ring.entries.back().expect("just pushed")
    }

    /// Sequence number the next pushed entry will get (entries with `seq >= n`
    /// arrived after `n` was sampled).
    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    /// Evictions so far (see `evicted_since`).
    pub fn evicted_total(&self) -> u64 {
        self.evicted_total
    }

    /// `seq` of the entries evicted after the first `seen` evictions, in
    /// eviction order. `None` when the log no longer reaches back that far (the
    /// reader must rebuild).
    pub fn evicted_since(&self, seen: u64) -> Option<impl Iterator<Item = u64> + '_> {
        let missed = self.evicted_total.checked_sub(seen)? as usize;
        (missed <= self.evictions.len()).then(|| {
            self.evictions
                .range(self.evictions.len() - missed..)
                .copied()
        })
    }

    /// Changes when the buffer was cleared (indexes must rebuild).
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// `seq` of the newest restart separator of `service` — or of any service
    /// for `None`. `None` when nothing restarted since the buffer was cleared.
    pub fn last_restart_seq(&self, service: Option<&str>) -> Option<u64> {
        match service {
            Some(s) => self.last_restart.get(s).copied(),
            None => self.last_restart.values().copied().max(),
        }
    }

    /// Oldest `seq` still held — for one service, or across all of them.
    /// `next_seq` when empty.
    pub fn oldest_seq(&self, service: Option<&str>) -> u64 {
        let front = |r: &Ring| r.entries.front().map(|e| e.seq);
        match service {
            Some(s) => self.rings.get(s).and_then(front),
            None => self.rings.values().filter_map(front).min(),
        }
        .unwrap_or(self.next_seq)
    }

    /// Total heap bytes held by all rings (what the byte budget bounds).
    pub fn bytes(&self) -> usize {
        self.rings.values().map(|r| r.bytes).sum()
    }

    /// Visit entries with `seq >= from` in `seq` order, for one service or all.
    /// Cost is O(visited + services · log ring): each ring is binary-searched.
    pub fn for_each_from(&self, from: u64, service: Option<&str>, mut f: impl FnMut(&LogEntry)) {
        let mut cursors: Vec<std::collections::vec_deque::Iter<'_, LogEntry>> = self
            .rings
            .iter()
            .filter(|(name, _)| service.is_none_or(|s| s == name.as_str()))
            .map(|(_, r)| {
                let start = r.entries.partition_point(|e| e.seq < from);
                r.entries.range(start..)
            })
            .collect();
        match cursors.len() {
            0 => {}
            1 => cursors.swap_remove(0).for_each(&mut f),
            _ => {
                // k-way merge by seq (k = number of services: tiny).
                let mut heads: Vec<Option<&LogEntry>> =
                    cursors.iter_mut().map(Iterator::next).collect();
                while let Some((i, _)) = heads
                    .iter()
                    .enumerate()
                    .filter_map(|(i, h)| h.map(|e| (i, e.seq)))
                    .min_by_key(|&(_, s)| s)
                {
                    if let Some(e) = heads[i] {
                        f(e);
                    }
                    heads[i] = cursors[i].next();
                }
            }
        }
    }

    /// The entry with this `seq` (binary search in its service's ring).
    pub fn get(&self, service: &str, seq: u64) -> Option<&LogEntry> {
        let ring = &self.rings.get(service)?.entries;
        let i = ring.partition_point(|e| e.seq < seq);
        ring.get(i).filter(|e| e.seq == seq)
    }

    /// The entry with this `seq`, whichever service owns it (log(ring) per service).
    pub fn get_any(&self, seq: u64) -> Option<&LogEntry> {
        self.rings.values().find_map(|r| {
            let i = r.entries.partition_point(|e| e.seq < seq);
            r.entries.get(i).filter(|e| e.seq == seq)
        })
    }

    pub fn len(&self) -> usize {
        self.rings.values().map(|r| r.entries.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.rings.values().all(|r| r.entries.is_empty())
    }

    /// Every entry, oldest first (merged by sequence number).
    pub fn all(&self) -> Vec<&LogEntry> {
        self.merged(|_| true)
    }

    /// Merge the rings whose service passes `keep`, oldest first.
    pub fn merged(&self, keep: impl Fn(&str) -> bool) -> Vec<&LogEntry> {
        let mut out: Vec<&LogEntry> = self
            .rings
            .iter()
            .filter(|(name, _)| keep(name))
            .flat_map(|(_, ring)| ring.entries.iter())
            .collect();
        out.sort_unstable_by_key(|e| e.seq);
        out
    }

    /// Newest entry across all services.
    pub fn last(&self) -> Option<&LogEntry> {
        self.rings
            .values()
            .filter_map(|r| r.entries.back())
            .max_by_key(|e| e.seq)
    }

    pub fn filter_service(&self, service: &str) -> Vec<&LogEntry> {
        self.rings
            .get(service)
            .map(|r| r.entries.iter().collect())
            .unwrap_or_default()
    }

    pub fn filter_level(&self, min_level: LogLevel) -> Vec<&LogEntry> {
        self.merged(|_| true)
            .into_iter()
            .filter(|e| e.level.rank() >= min_level.rank())
            .collect()
    }

    pub fn errors(&self) -> Vec<&LogEntry> {
        self.merged(|_| true)
            .into_iter()
            .filter(|e| e.level == LogLevel::Error && !e.is_separator())
            .collect()
    }

    pub fn since(&self, seconds: u64) -> Vec<&LogEntry> {
        let cutoff = now_ms().saturating_sub(seconds.saturating_mul(1000));
        self.merged(|_| true)
            .into_iter()
            .filter(|e| e.timestamp >= cutoff)
            .collect()
    }

    pub fn tail(&self, n: usize) -> Vec<&LogEntry> {
        let all = self.all();
        let start = all.len().saturating_sub(n);
        all[start..].to_vec()
    }

    pub fn tail_service(&self, service: &str, n: usize) -> Vec<&LogEntry> {
        let filtered = self.filter_service(service);
        let start = filtered.len().saturating_sub(n);
        filtered[start..].to_vec()
    }

    /// Entries whose visible text matches `pattern` (smartcase literal).
    pub fn search(&self, pattern: &str) -> Vec<&LogEntry> {
        let Some(m) = crate::runtime::logindex::Matcher::new(pattern, false) else {
            return Vec::new();
        };
        self.merged(|_| true)
            .into_iter()
            .filter(|e| !e.is_separator() && m.is_match(&text::strip_ansi(&e.content)))
            .collect()
    }

    pub fn clear(&mut self) {
        self.rings.clear();
        self.last_restart.clear();
        self.evictions.clear();
        self.generation += 1;
    }
}

/// What kind of row an entry is (private: callers use the `push_*` methods).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Line,
    Truncated,
    Mark,
    Restart,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_buffer_push_and_tail() {
        let mut buf = LogBuffer::new(100);
        buf.push("api".to_string(), "line 1".to_string(), LogStream::Stdout);
        buf.push("api".to_string(), "line 2".to_string(), LogStream::Stdout);
        buf.push("web".to_string(), "line 3".to_string(), LogStream::Stdout);

        assert_eq!(buf.len(), 3);
        assert_eq!(buf.tail(2).len(), 2);
        assert_eq!(buf.tail(2)[0].content, "line 2");
    }

    #[test]
    fn test_log_buffer_capacity() {
        let mut buf = LogBuffer::new(3);
        for i in 0..5 {
            buf.push("svc".to_string(), format!("line {i}"), LogStream::Stdout);
        }
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.all().first().unwrap().content, "line 2");
        assert_eq!(buf.all().last().unwrap().content, "line 4");
    }

    #[test]
    fn chatty_service_cannot_evict_others() {
        let mut buf = LogBuffer::new(3);
        buf.push("quiet".into(), "q0".into(), LogStream::Stdout);
        for i in 0..50 {
            buf.push("chatty".into(), format!("c{i}"), LogStream::Stdout);
        }
        buf.push("quiet".into(), "q1".into(), LogStream::Stdout);
        // Quiet keeps both lines; chatty keeps only its newest 3.
        assert_eq!(buf.filter_service("quiet").len(), 2);
        let chatty: Vec<_> = buf
            .filter_service("chatty")
            .iter()
            .map(|e| e.content.clone())
            .collect();
        assert_eq!(chatty, ["c47", "c48", "c49"]);
        // All merges by arrival order.
        let merged: Vec<_> = buf.all().iter().map(|e| e.content.clone()).collect();
        assert_eq!(merged, ["q0", "c47", "c48", "c49", "q1"]);
        assert_eq!(buf.last().unwrap().content, "q1");
    }

    #[test]
    fn mark_is_inserted_and_not_an_error() {
        let mut buf = LogBuffer::new(10);
        let line = buf.push_mark("api".into());
        assert!(line.starts_with("──── ") && line.ends_with(" mark ────"));
        let e = buf.all()[0];
        assert!(e.mark);
        assert_eq!(e.content, line);
        assert!(buf.errors().is_empty());
    }

    #[test]
    fn test_log_buffer_filter_service() {
        let mut buf = LogBuffer::new(100);
        buf.push("api".to_string(), "api line".to_string(), LogStream::Stdout);
        buf.push("web".to_string(), "web line".to_string(), LogStream::Stdout);
        buf.push(
            "api".to_string(),
            "api line 2".to_string(),
            LogStream::Stdout,
        );

        let filtered = buf.filter_service("api");
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_log_buffer_errors() {
        let mut buf = LogBuffer::new(100);
        buf.push(
            "api".to_string(),
            "normal log".to_string(),
            LogStream::Stdout,
        );
        buf.push(
            "api".to_string(),
            "Error: something broke".to_string(),
            LogStream::Stderr,
        );
        buf.push(
            "api".to_string(),
            "another normal".to_string(),
            LogStream::Stdout,
        );

        let errors = buf.errors();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].content, "Error: something broke");
    }

    #[test]
    fn test_log_buffer_search() {
        let mut buf = LogBuffer::new(100);
        buf.push(
            "api".to_string(),
            "Connected to database".to_string(),
            LogStream::Stdout,
        );
        buf.push(
            "api".to_string(),
            "Error: database timeout".to_string(),
            LogStream::Stderr,
        );
        buf.push(
            "web".to_string(),
            "Compiled successfully".to_string(),
            LogStream::Stdout,
        );

        let results = buf.search("database");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_log_buffer_tail_service() {
        let mut buf = LogBuffer::new(100);
        for i in 0..10 {
            buf.push("api".to_string(), format!("api {i}"), LogStream::Stdout);
            buf.push("web".to_string(), format!("web {i}"), LogStream::Stdout);
        }

        let tail = buf.tail_service("api", 3);
        assert_eq!(tail.len(), 3);
        assert_eq!(tail[0].content, "api 7");
        assert_eq!(tail[2].content, "api 9");
    }

    #[test]
    fn every_line_gets_a_monotonic_seq_level_and_time_once() {
        let mut b = LogBuffer::new(100);
        b.push("a".into(), "ok".into(), LogStream::Stdout);
        b.push("b".into(), "ERROR boom".into(), LogStream::Stderr);
        b.push("a".into(), "warn: slow".into(), LogStream::Stdout);
        let all = b.all();
        assert_eq!(all.iter().map(|e| e.seq).collect::<Vec<_>>(), [0, 1, 2]);
        assert_eq!(
            all.iter().map(|e| e.level).collect::<Vec<_>>(),
            [LogLevel::Info, LogLevel::Error, LogLevel::Warn]
        );
        assert!(all.iter().all(|e| e.time_str.len() == 8 && e.timestamp > 0));
        assert_eq!(b.next_seq(), 3);
    }

    #[test]
    fn restart_marker_is_a_separator_not_output_or_an_error() {
        let mut b = LogBuffer::new(100);
        b.push("a".into(), "boot".into(), LogStream::Stdout);
        let line = b.push_restart("a".into());
        assert!(line.starts_with("──── ") && line.ends_with(" restarted ────"));
        let e = b.last().unwrap();
        assert!(e.restart && e.is_separator() && !e.mark);
        assert!(b.errors().is_empty());
        assert!(
            b.search("restarted").is_empty(),
            "separators are never matched"
        );
    }

    #[test]
    fn truncated_lines_are_flagged_from_the_assembler_marker() {
        let mut b = LogBuffer::new(10);
        let cut = format!("{}{}", "x".repeat(10), TRUNCATION_MARK);
        b.push("a".into(), cut, LogStream::Stdout);
        b.push("a".into(), "normal".into(), LogStream::Stdout);
        let v = b.filter_service("a");
        assert!(v[0].truncated && !v[1].truncated);
    }

    #[test]
    fn byte_budget_evicts_oldest_but_always_keeps_the_newest_line() {
        let mut b = LogBuffer::with_budget(1_000_000, 4096);
        for i in 0..100 {
            b.push(
                "a".into(),
                format!("{i} {}", "y".repeat(200)),
                LogStream::Stdout,
            );
        }
        assert!(b.bytes() <= 4096 + 600, "bytes {}", b.bytes());
        assert!(b.len() < 100 && !b.is_empty());
        assert!(b.last().unwrap().content.starts_with("99 "));
        // A single line over the whole budget is still kept.
        let mut b = LogBuffer::with_budget(10, 100);
        b.push("a".into(), "z".repeat(10_000), LogStream::Stdout);
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn for_each_from_merges_services_by_seq_and_starts_at_from() {
        let mut b = LogBuffer::new(100);
        for i in 0..6 {
            b.push(
                if i % 2 == 0 { "a" } else { "b" }.into(),
                format!("{i}"),
                LogStream::Stdout,
            );
        }
        let mut seen = Vec::new();
        b.for_each_from(2, None, |e| seen.push(e.seq));
        assert_eq!(seen, [2, 3, 4, 5]);
        let mut a = Vec::new();
        b.for_each_from(0, Some("a"), |e| a.push(e.seq));
        assert_eq!(a, [0, 2, 4]);
        assert_eq!(b.get("b", 3).unwrap().content, "3");
        assert!(b.get("a", 3).is_none());
        assert_eq!(b.get_any(5).unwrap().content, "5");
    }

    #[test]
    fn oldest_seq_follows_eviction_per_service_and_overall() {
        let mut b = LogBuffer::new(2);
        for i in 0..5 {
            b.push("a".into(), format!("{i}"), LogStream::Stdout);
        }
        b.push("b".into(), "x".into(), LogStream::Stdout);
        assert_eq!(b.oldest_seq(Some("a")), 3);
        assert_eq!(b.oldest_seq(None), 3);
        assert_eq!(b.oldest_seq(Some("zzz")), b.next_seq());
    }
}
