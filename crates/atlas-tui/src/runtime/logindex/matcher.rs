//! One compiled search query and the text it runs against.

use std::borrow::Cow;
use std::ops::Range;

use regex::{Regex, RegexBuilder};

use crate::runtime::logs::LogEntry;
use crate::runtime::text::{has_control_bytes, visible_chars};

/// A compiled query: literal or regex, smartcase (an all-lowercase query is
/// case-insensitive).
#[derive(Debug, Clone)]
pub struct Matcher {
    re: Regex,
    /// The query text this was built from (identity for cache keys).
    query: String,
    is_regex: bool,
}

impl Matcher {
    /// `None` for an empty query or an invalid regex.
    pub fn new(query: &str, regex: bool) -> Option<Self> {
        Self::compile(query, regex).ok()
    }

    /// Like `new` but keeps the regex error for callers that report it (MCP).
    pub fn compile(query: &str, regex: bool) -> Result<Self, String> {
        Self::build(query, regex, !query.chars().any(char::is_uppercase))
    }

    /// Always case-insensitive (the MCP search contract).
    pub fn compile_insensitive(query: &str, regex: bool) -> Result<Self, String> {
        Self::build(query, regex, true)
    }

    fn build(query: &str, regex: bool, insensitive: bool) -> Result<Self, String> {
        if query.is_empty() {
            return Err("query must not be empty".into());
        }
        let pat: Cow<'_, str> = if regex {
            query.into()
        } else {
            regex::escape(query).into()
        };
        RegexBuilder::new(&pat)
            .case_insensitive(insensitive)
            .build()
            .map(|re| Self {
                re,
                query: query.to_string(),
                is_regex: regex,
            })
            .map_err(|e| format!("invalid regex: {e}"))
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    pub fn is_regex(&self) -> bool {
        self.is_regex
    }

    /// Match byte ranges in `text` (empty matches skipped).
    pub fn ranges(&self, text: &str) -> Vec<Range<usize>> {
        self.re
            .find_iter(text)
            .filter(|m| !m.is_empty())
            .map(|m| m.range())
            .collect()
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.re.find_iter(text).any(|m| !m.is_empty())
    }

    /// Number of non-empty matches in `text`.
    pub fn count(&self, text: &str) -> usize {
        self.re.find_iter(text).filter(|m| !m.is_empty()).count()
    }
}

/// What the message column of `entry` shows to the search (JSON-compacted when
/// `json`), with escape sequences removed.
pub fn search_text(entry: &LogEntry, json: bool) -> String {
    let (text, _) = crate::tui::widgets::log_viewer::display_content(entry, json);
    visible_chars(&text).collect()
}

/// Cheap prefilter: plain text of a line without allocating when it has no
/// escape/control bytes (the overwhelmingly common case).
pub(super) fn plain_text(entry: &LogEntry, json: bool) -> Cow<'_, str> {
    if !json && !has_control_bytes(&entry.content) {
        Cow::Borrowed(entry.content.as_str())
    } else {
        Cow::Owned(search_text(entry, json))
    }
}
