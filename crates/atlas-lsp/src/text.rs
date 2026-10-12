//! Shadow copy of an open document, edited with LSP (UTF-16) positions.
//!
//! Servers that only support full sync get the whole text after each change; servers that
//! take incremental changes get them verbatim. The shadow copy also lets us re-send
//! `didOpen` after a server restart.

use serde_json::Value;

/// Byte offset of `(line, character)`; `character` counts UTF-16 units. Positions past the
/// end of a line clamp to the line end (the LSP spec), past the end of the file to the end.
pub fn offset(text: &str, line: u64, character: u64) -> usize {
    let mut start = 0usize;
    for _ in 0..line {
        match text[start..].find('\n') {
            Some(i) => start += i + 1,
            None => return text.len(),
        }
    }
    let rest = &text[start..];
    let line_end = rest.find('\n').unwrap_or(rest.len());
    // LSP treats \r\n as one line terminator: never place a position between them.
    let content = rest[..line_end]
        .strip_suffix('\r')
        .unwrap_or(&rest[..line_end]);
    let mut units = 0u64;
    for (i, c) in content.char_indices() {
        if units >= character {
            return start + i;
        }
        units += c.len_utf16() as u64;
    }
    start + content.len()
}

fn pos(v: &Value) -> Option<(u64, u64)> {
    Some((v.get("line")?.as_u64()?, v.get("character")?.as_u64()?))
}

/// Apply one `TextDocumentContentChangeEvent`; a change without `range` replaces everything.
pub fn apply(text: &mut String, change: &Value) -> bool {
    let Some(new) = change.get("text").and_then(Value::as_str) else {
        return false;
    };
    let Some(range) = change.get("range").filter(|r| !r.is_null()) else {
        *text = new.to_string();
        return true;
    };
    let (Some(s), Some(e)) = (
        range.get("start").and_then(pos),
        range.get("end").and_then(pos),
    ) else {
        return false;
    };
    let a = offset(text, s.0, s.1);
    let b = offset(text, e.0, e.1).max(a);
    text.replace_range(a..b, new);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ch(sl: u64, sc: u64, el: u64, ec: u64, t: &str) -> Value {
        json!({"range":{"start":{"line":sl,"character":sc},"end":{"line":el,"character":ec}},"text":t})
    }

    #[test]
    fn offsets_count_utf16_units() {
        // 🦀 is 2 UTF-16 units and 4 bytes; é is 1 unit and 2 bytes.
        let t = "a🦀é\nxyz";
        assert_eq!(offset(t, 0, 0), 0);
        assert_eq!(offset(t, 0, 1), 1);
        assert_eq!(offset(t, 0, 3), 5);
        assert_eq!(offset(t, 0, 4), 7);
        assert_eq!(offset(t, 1, 2), 10);
    }

    #[test]
    fn positions_clamp() {
        let t = "ab\ncd";
        assert_eq!(offset(t, 0, 99), 2);
        assert_eq!(offset(t, 9, 0), t.len());
        assert_eq!(offset("ab\r\ncd", 0, 99), 2);
    }

    #[test]
    fn incremental_edits_apply_in_order() {
        let mut t = "fn main() {}\n".to_string();
        assert!(apply(&mut t, &ch(0, 11, 0, 11, "\n    x\n")));
        assert_eq!(t, "fn main() {\n    x\n}\n");
        assert!(apply(&mut t, &ch(1, 4, 1, 5, "🦀")));
        assert_eq!(t, "fn main() {\n    🦀\n}\n");
        assert!(apply(&mut t, &ch(1, 4, 1, 6, "yy")));
        assert_eq!(t, "fn main() {\n    yy\n}\n");
        // delete across lines
        assert!(apply(&mut t, &ch(0, 11, 2, 0, "")));
        assert_eq!(t, "fn main() {}\n");
    }

    #[test]
    fn full_replacement_and_bad_changes() {
        let mut t = "old".to_string();
        assert!(apply(&mut t, &json!({"text": "new"})));
        assert_eq!(t, "new");
        assert!(!apply(&mut t, &json!({"range": {"start": 1}, "text": "x"})));
        assert!(!apply(&mut t, &json!({"range": null})));
        assert_eq!(t, "new");
    }
}
