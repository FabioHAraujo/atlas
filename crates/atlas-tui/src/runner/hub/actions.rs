//! Recent non-session action runs, replayed to clients that attach later.

use std::collections::VecDeque;

use serde_json::{Value, json};

use crate::runtime::clock;

/// Action runs remembered for a newly attached client.
pub(in crate::runner) const ACTION_RUNS: usize = 10;
/// Output lines kept per remembered action run.
pub(in crate::runner) const ACTION_TAIL_LINES: usize = 500;

/// One execution of a non-session action, as replayed to new clients.
pub(super) struct ActionRun {
    pub(super) label: String,
    start: u64,
    /// `None` while running, else whether it exited 0.
    pub(super) done: Option<(u64, bool)>,
    tail: VecDeque<String>,
    skipped: u64,
}

impl ActionRun {
    pub(super) fn new(label: &str) -> Self {
        Self {
            label: label.to_string(),
            start: clock::now_ms(),
            done: None,
            tail: VecDeque::new(),
            skipped: 0,
        }
    }

    pub(super) fn push(&mut self, line: &str) {
        if self.tail.len() >= ACTION_TAIL_LINES {
            self.tail.pop_front();
            self.skipped += 1;
        }
        self.tail.push_back(line.to_string());
    }

    pub(super) fn json(&self) -> Value {
        let (status, end) = match self.done {
            None => ("running", Value::Null),
            Some((t, true)) => ("ok", t.into()),
            Some((t, false)) => ("failed", t.into()),
        };
        json!({
            "label": self.label, "start": self.start, "end": end, "status": status,
            "lines": self.tail, "skipped": self.skipped,
        })
    }
}
