//! Severity of a log line, detected once at ingest from whole-word level tokens.

use std::fmt;
use std::sync::LazyLock;

use regex::Regex;

use crate::runtime::text;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

static LEVEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(error|err|fatal|panic|warn|warning|trace|debug)\b").expect("level regex")
});

impl LogLevel {
    /// Lowercase wire name (`debug|info|warn|error`).
    pub fn wire(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }

    /// Severity order: Debug < Info < Warn < Error.
    pub fn rank(self) -> u8 {
        match self {
            Self::Debug => 0,
            Self::Info => 1,
            Self::Warn => 2,
            Self::Error => 3,
        }
    }

    /// Classify a line by whole-word level tokens in its visible text
    /// (`"0 errors found"` and URLs like `/debug` stay `Info`).
    pub fn detect(content: &str) -> Self {
        // Fast path: the vast majority of lines carry no level word at all.
        if !may_contain_level(content.as_bytes()) {
            return Self::Info;
        }
        let plain = text::plain(content);
        let mut level = Self::Info;
        for m in LEVEL_RE.find_iter(&plain) {
            // `/debug` or `.error` inside a path/URL/identifier is not a level token.
            if matches!(
                plain[..m.start()].chars().next_back(),
                Some('/' | '.' | '-' | '_')
            ) {
                continue;
            }
            let found = match m.as_str().to_ascii_lowercase().as_str() {
                "error" | "err" | "fatal" | "panic" => Self::Error,
                "warn" | "warning" => Self::Warn,
                _ => Self::Debug,
            };
            // Severity wins over Debug: Error > Warn > Debug > Info.
            let rank = |l: Self| match l {
                Self::Error => 3,
                Self::Warn => 2,
                Self::Debug => 1,
                Self::Info => 0,
            };
            if rank(found) > rank(level) {
                level = found;
            }
        }
        level
    }
}

/// Could `bytes` contain one of the level words (`err`, `fatal`, `panic`,
/// `warn`, `trace`, `debug`) in any case? A cheap 3-byte window test that lets
/// `detect` skip the regex for ordinary lines. False positives are fine.
fn may_contain_level(bytes: &[u8]) -> bool {
    bytes.windows(3).any(|w| {
        let l = [
            w[0].to_ascii_lowercase(),
            w[1].to_ascii_lowercase(),
            w[2].to_ascii_lowercase(),
        ];
        matches!(&l, b"err" | b"fat" | b"pan" | b"war" | b"tra" | b"deb")
    })
}

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Debug => write!(f, "DEBUG"),
            Self::Info => write!(f, "INFO"),
            Self::Warn => write!(f, "WARN"),
            Self::Error => write!(f, "ERROR"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_detect_error() {
        assert_eq!(
            LogLevel::detect("Error: connection refused"),
            LogLevel::Error
        );
        assert_eq!(LogLevel::detect("FATAL: out of memory"), LogLevel::Error);
        assert_eq!(
            LogLevel::detect("panic: index out of bounds"),
            LogLevel::Error
        );
    }

    #[test]
    fn test_log_level_detect_word_tokens() {
        assert_eq!(LogLevel::detect("0 errors found"), LogLevel::Info);
        assert_eq!(LogLevel::detect("ERROR: boom"), LogLevel::Error);
        assert_eq!(LogLevel::detect("https://x/debug"), LogLevel::Info);
        assert_eq!(
            LogLevel::detect("\x1b[31mERROR\x1b[0m boom"),
            LogLevel::Error
        );
        assert_eq!(
            LogLevel::detect("\x1b[31mred but plain\x1b[0m"),
            LogLevel::Info
        );
        assert_eq!(LogLevel::detect("debug then warn"), LogLevel::Warn);
    }

    #[test]
    fn test_log_level_detect_warn() {
        assert_eq!(LogLevel::detect("Warning: deprecated API"), LogLevel::Warn);
        assert_eq!(LogLevel::detect("WARN slow query detected"), LogLevel::Warn);
    }

    #[test]
    fn test_log_level_detect_info() {
        assert_eq!(
            LogLevel::detect("Server listening on port 3000"),
            LogLevel::Info
        );
        assert_eq!(LogLevel::detect("GET /api/users 200"), LogLevel::Info);
    }

    /// One table for both languages: `apps/desktop/src/lib/logs.test.ts` runs the same file
    /// through the desktop's `levelOf` (which shows debug as info).
    #[test]
    fn test_log_level_detect_shared_fixture() {
        let raw = include_str!("../../../../../testdata/log-levels.json");
        let v: serde_json::Value = serde_json::from_str(raw).expect("fixture json");
        let cases = v["cases"].as_array().expect("cases");
        assert!(cases.len() > 20);
        for c in cases {
            let text = c["text"].as_str().expect("text");
            let want = c["level"].as_str().expect("level");
            assert_eq!(LogLevel::detect(text).wire(), want, "{text:?}");
        }
    }

    #[test]
    fn test_log_level_detect_debug() {
        assert_eq!(
            LogLevel::detect("DEBUG: cache hit for key xyz"),
            LogLevel::Debug
        );
        assert_eq!(LogLevel::detect("trace entering function"), LogLevel::Debug);
    }

    #[test]
    fn level_detect_fast_path_agrees_with_the_regex_path() {
        for (line, want) in [
            ("plain text 12345", LogLevel::Info),
            ("ERROR x", LogLevel::Error),
            ("WaRn x", LogLevel::Warn),
            ("a debug b", LogLevel::Debug),
            ("terror in the night", LogLevel::Info),
            ("café ERROR ünï", LogLevel::Error),
            ("\x1b[31mFATAL\x1b[0m", LogLevel::Error),
        ] {
            assert_eq!(LogLevel::detect(line), want, "{line:?}");
        }
    }
}
