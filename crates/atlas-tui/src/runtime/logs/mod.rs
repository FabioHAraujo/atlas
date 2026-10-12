//! The log pipeline's data model: lines as `LogEntry`, held in a per-service
//! `LogBuffer`, classified by `LogLevel`, fed by `spawn_line_pump`, exported by
//! the clipboard/AI formatters.

mod buffer;
mod export;
mod level;
mod pump;

#[cfg(test)]
pub(crate) use buffer::EVICTION_LOG_FOR_TESTS;
pub use buffer::{DEFAULT_RING_BYTES, LogBuffer};
pub use export::{ClipboardContext, copy_to_clipboard, format_for_ai_prompt, format_for_clipboard};
pub use level::LogLevel;
pub(crate) use pump::spawn_line_pump;

#[derive(Debug, Clone)]
pub struct LogEntry {
    /// Global arrival order across all services (merge key for the All tab).
    pub seq: u64,
    pub timestamp: u64,
    pub service: String,
    pub stream: LogStream,
    pub content: String,
    pub level: LogLevel,
    /// Pre-formatted "HH:MM:SS" — computed once at push, free on every render.
    pub time_str: String,
    /// `-` separator line inserted by the user (never counted as output/errors).
    pub mark: bool,
    /// `── restarted ──` separator inserted when a service (re)starts. Like a
    /// mark it is never output; unlike a mark it is not user-made.
    pub restart: bool,
    /// The line was cut at `linebuf::MAX_LINE_BYTES`.
    pub truncated: bool,
}

impl LogEntry {
    /// Marks and restart separators: drawn as rules, never searched/counted.
    pub fn is_separator(&self) -> bool {
        self.mark || self.restart
    }

    /// Heap bytes this entry holds (what the ring's byte budget counts).
    pub(super) fn cost(&self) -> usize {
        std::mem::size_of::<Self>() + self.content.len() + self.service.len() + self.time_str.len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogStream {
    Stdout,
    Stderr,
}
