//! Config validation: unknown-key detection (schema-driven, with "did you
//! mean" suggestions) and semantic checks (dependencies, cycles, ports, keys).

mod schema;
mod semantic;

use std::fmt;

pub use schema::{Target, json_schema, unknown_keys};
pub use semantic::{semantic, warnings};

/// Keys bound by the dashboard (`tui/app/input.rs`); an action using one would
/// never fire (built-ins win) or would shadow navigation.
pub const BUILTIN_KEYS: &[char] = &[
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'j', 'k', 'g', 'G', 'f', 'v', 'E', 'M', 'L',
    'P', 'q', 'r', 's', 'S', 't', 'm', 'i', '?', ':', '/', 'n', 'N', 'W', 'T', 'V', 'J', 'z', '-',
    'D', '[', ']', '{', '}',
];

/// One problem found in the config. `path` is the dotted key path
/// (`services.web.helth`), `message` the human explanation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub file: String,
    pub path: String,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.path.is_empty() {
            write!(f, "{}", self.message)
        } else {
            write!(f, "{}: {}", self.path, self.message)
        }
    }
}

/// One line per error, prefixed with the file it came from.
pub fn render_errors(errors: &[ConfigError], default_file: &str) -> String {
    let mut out = format!(
        "{} config error{}:",
        errors.len(),
        if errors.len() == 1 { "" } else { "s" }
    );
    for e in errors {
        let file = if e.file.is_empty() {
            default_file
        } else {
            &e.file
        };
        out.push_str(&format!("\n  {file}: {e}"));
    }
    out
}

/// Closest candidate within a distance that scales with the key length.
pub fn suggest<'a>(key: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let max = (key.chars().count() / 3).clamp(1, 3);
    candidates
        .map(|c| (levenshtein(key, c), c))
        .filter(|(d, _)| *d <= max)
        .min_by_key(|(d, c)| (*d, *c))
        .map(|(_, c)| c)
}

fn levenshtein(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != *cb);
            cur.push((prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}
