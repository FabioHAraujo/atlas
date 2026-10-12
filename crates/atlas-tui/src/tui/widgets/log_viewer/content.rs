//! What text a log row shows: JSON compaction, searchable text, and links.

use super::*;

pub(super) fn char_width(c: char) -> usize {
    if c == '\t' {
        TAB_WIDTH
    } else {
        c.width().unwrap_or(0)
    }
}

/// What the message column of `entry` shows: the (possibly JSON-compacted)
/// text and the level it is colored by.
pub fn display_content(entry: &LogEntry, json: bool) -> (std::borrow::Cow<'_, str>, LogLevel) {
    if json && let Some((level, text)) = compact_json(&entry.content) {
        return (text.into(), level);
    }
    (entry.content.as_str().into(), entry.level)
}

/// `{"level":30,"msg":"x","a":1}` → `("INFO", "x a=1")`-style compaction.
/// Only lines that are exactly one JSON object qualify.
pub(super) fn compact_json(content: &str) -> Option<(LogLevel, String)> {
    let trimmed = content.trim();
    if !(trimmed.starts_with('{') && trimmed.ends_with('}')) {
        return None;
    }
    let serde_json::Value::Object(map) = serde_json::from_str(trimmed).ok()? else {
        return None;
    };
    let level = map.get("level").or_else(|| map.get("severity"));
    let (lvl, label) = match level {
        Some(serde_json::Value::Number(n)) => match n.as_u64() {
            Some(0..=20) => (LogLevel::Debug, "TRACE"),
            Some(21..=30) => (LogLevel::Info, "INFO"),
            Some(31..=40) => (LogLevel::Warn, "WARN"),
            Some(_) => (LogLevel::Error, "ERROR"),
            None => (LogLevel::Info, "INFO"),
        },
        Some(serde_json::Value::String(s)) => match s.to_ascii_lowercase().as_str() {
            "trace" | "debug" | "verbose" => (LogLevel::Debug, "DEBUG"),
            "warn" | "warning" => (LogLevel::Warn, "WARN"),
            "error" | "err" | "fatal" | "critical" | "panic" => (LogLevel::Error, "ERROR"),
            _ => (LogLevel::Info, "INFO"),
        },
        _ => (LogLevel::detect(content), ""),
    };
    let msg = ["msg", "message"]
        .iter()
        .find_map(|k| map.get(*k).and_then(|v| v.as_str()))
        .unwrap_or("");
    let mut out = String::new();
    if !label.is_empty() {
        out.push_str(label);
        out.push(' ');
    }
    out.push_str(msg);
    for (k, v) in &map {
        if matches!(
            k.as_str(),
            "level"
                | "severity"
                | "msg"
                | "message"
                | "time"
                | "timestamp"
                | "pid"
                | "hostname"
                | "v"
        ) {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        match v {
            serde_json::Value::String(s) => out.push_str(&format!("{k}={s}")),
            other => out.push_str(&format!("{k}={other}")),
        }
    }
    Some((lvl, out))
}

pub use crate::runtime::logindex::search_text;

/// URLs / `path:line` references / OSC 8 links of `entry`'s visible message,
/// left to right. Byte ranges are into `search_text(entry, json)`.
pub fn entry_links(entry: &LogEntry, json: bool) -> Vec<crate::runtime::loglinks::Link> {
    use crate::runtime::loglinks::{Link, Target, find};
    if entry.is_separator() {
        return Vec::new();
    }
    let (text, _) = display_content(entry, json);
    // Fast reject: no scheme and no `:<digit>` means nothing to find.
    let b = text.as_bytes();
    let maybe = text.contains("://")
        || text.contains('\x1b')
        || b.windows(2).any(|w| w[0] == b':' && w[1].is_ascii_digit());
    if !maybe {
        return Vec::new();
    }
    let parsed = ansi::parse(theme::current(), &text, Style::default());
    let plain: String = parsed.spans.iter().map(|s| s.content.as_ref()).collect();
    let mut links: Vec<Link> = parsed
        .links
        .iter()
        .map(|l| Link {
            range: l.start..l.end,
            target: Target::Url(l.url.clone()),
        })
        .collect();
    for l in find(&plain) {
        if !links
            .iter()
            .any(|o| o.range.start < l.range.end && l.range.start < o.range.end)
        {
            links.push(l);
        }
    }
    links.sort_by_key(|l| l.range.start);
    links
}
