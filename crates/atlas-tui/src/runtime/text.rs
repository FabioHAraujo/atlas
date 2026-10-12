//! Terminal-escape handling for log text: the one place that knows how to turn
//! raw child output into plain, searchable characters.

use std::borrow::Cow;

/// `s` without escape sequences and control bytes (tab, LF and CR are kept).
pub fn strip_ansi(s: &str) -> String {
    visible_chars(s).collect()
}

/// True when `s` has bytes below space or DEL: the cheap test that lets plain
/// lines (the overwhelmingly common case) skip the stripping pass.
pub fn has_control_bytes(s: &str) -> bool {
    s.bytes().any(|b| b < 0x20 || b == 0x7f)
}

/// Like `strip_ansi`, but borrows when there is nothing to strip. Non-ASCII
/// text is always scanned because C1 controls (U+0080–U+009F) are multi-byte.
pub fn plain(s: &str) -> Cow<'_, str> {
    if s.bytes().any(|b| b < 0x20 || b == 0x7f || b >= 0x80) {
        strip_ansi(s).into()
    } else {
        s.into()
    }
}

/// Characters of `s` that remain after removing CSI/OSC/string-control escape
/// sequences and C0/C1 control bytes (tab, LF and CR are kept).
pub fn visible_chars(s: &str) -> impl Iterator<Item = char> + '_ {
    #[derive(Clone, Copy)]
    enum State {
        Ground,
        Esc,
        Csi,
        Osc,
        OscEsc,
        StringControl,
        StringEsc,
    }

    let mut state = State::Ground;
    s.chars().filter_map(move |ch| {
        let code = ch as u32;
        let mut out = None;
        state = match state {
            State::Ground => match ch {
                '\x1b' => State::Esc,
                '\u{009b}' => State::Csi,
                '\u{009d}' => State::Osc,
                '\u{0090}' | '\u{009e}' | '\u{009f}' => State::StringControl,
                '\t' | '\n' | '\r' => {
                    out = Some(ch);
                    State::Ground
                }
                _ if code < 0x20 || (0x7f..=0x9f).contains(&code) => State::Ground,
                _ => {
                    out = Some(ch);
                    State::Ground
                }
            },
            State::Esc => match ch {
                '[' => State::Csi,
                ']' => State::Osc,
                'P' | 'X' | '^' | '_' => State::StringControl,
                '\x1b' => State::Esc,
                _ => State::Ground,
            },
            State::Csi => {
                if ch == '\x1b' {
                    State::Esc
                } else if (0x40..=0x7e).contains(&code) {
                    State::Ground
                } else {
                    State::Csi
                }
            }
            State::Osc => match ch {
                '\x07' => State::Ground,
                '\x1b' => State::OscEsc,
                _ => State::Osc,
            },
            State::OscEsc => match ch {
                '\\' => State::Ground,
                '\x1b' => State::OscEsc,
                _ => State::Osc,
            },
            State::StringControl => match ch {
                '\x1b' => State::StringEsc,
                _ => State::StringControl,
            },
            State::StringEsc => match ch {
                '\\' => State::Ground,
                '\x1b' => State::StringEsc,
                _ => State::StringControl,
            },
        };
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_visible_chars_matches_strip_ansi() {
        let s = "\x1b[1;34mblue\x1b[0m \x1b]0;title\x07text\x1b[?25l";
        assert_eq!(visible_chars(s).collect::<String>(), "blue text");
    }

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("\x1b[31mError\x1b[0m"), "Error");
        assert_eq!(strip_ansi("no escapes here"), "no escapes here");
        assert_eq!(strip_ansi("\x1b[1;34mblue\x1b[0m text"), "blue text");
    }

    #[test]
    fn test_strip_ansi_preserves_newlines() {
        assert_eq!(
            strip_ansi("\x1b[31mfirst\x1b[0m\nsecond\r\n"),
            "first\nsecond\r\n"
        );
        assert_eq!(strip_ansi("\x1b[?25lready\x1b[?25h"), "ready");
    }

    #[test]
    fn plain_borrows_clean_ascii_and_strips_the_rest() {
        assert!(matches!(plain("just text"), Cow::Borrowed(_)));
        assert_eq!(plain("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(plain("a\u{9b}31mb"), "ab");
        assert!(has_control_bytes("a\x1bb") && !has_control_bytes("ab"));
    }
}
