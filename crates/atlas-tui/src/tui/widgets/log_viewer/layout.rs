//! Row layout: the prefix column, hanging indent, wrapped/truncated spans and
//! the row count (which must match what is drawn).

use super::*;

/// The `time` / `[svc]` prefix of an entry, exactly as `entry_spans` draws it.
/// Its width is also the hanging indent for continuation rows.
pub(super) struct Prefix {
    text: String,
}

impl Prefix {
    pub(super) fn new(entry: &LogEntry, opts: &ViewOpts) -> Self {
        let mut text = String::new();
        if opts.timestamps {
            text.push_str(&entry.time_str);
            text.push(' ');
        }
        if opts.show_service {
            text.push('[');
            text.push_str(&entry.service);
            text.push_str("] ");
        }
        Self { text }
    }

    /// Columns taken by the prefix.
    pub(super) fn width(&self) -> usize {
        self.text.chars().count()
    }

    pub(super) fn chars(&self) -> std::str::Chars<'_> {
        self.text.chars()
    }
}

/// Hanging indent for continuation rows, capped so the message keeps room.
pub(super) fn indent_for(prefix: usize, width: usize) -> usize {
    if prefix + 8 <= width { prefix } else { 0 }
}

/// Number of screen rows `entry` occupies at `width` columns.
/// Must stay in lockstep with `wrap_spans`.
pub fn entry_rows(entry: &LogEntry, width: u16, opts: &ViewOpts) -> usize {
    if !opts.wrap || entry.is_separator() {
        return 1;
    }
    let width = (width as usize).max(1);
    let prefix = Prefix::new(entry, opts);
    let indent = indent_for(prefix.width(), width);
    let (text, _) = display_content(entry, opts.json);
    let (mut rows, mut col) = (1, 0);
    for c in prefix.chars().chain(visible_chars(&text)) {
        let cw = char_width(c);
        if cw == 0 {
            continue;
        }
        if col + cw > width && col > indent {
            rows += 1;
            col = indent;
        }
        col += cw;
    }
    rows
}

/// Hard-wrap styled spans into rows of at most `width` columns (char-level,
/// nothing dropped). Zero-width/control chars are removed, tabs expanded.
/// `prefix` columns of the leading spans form the hanging indent: continuation
/// rows are indented by `prefix` (when it fits) and dimmed.
pub(super) fn wrap_spans(
    spans: Vec<Span<'static>>,
    width: usize,
    prefix: usize,
) -> Vec<Line<'static>> {
    let width = width.max(1);
    let indent = indent_for(prefix, width);
    let dim = Style::default().fg(theme::current().text_muted);
    let mut rows = Vec::new();
    let mut cur: Vec<Span<'static>> = Vec::new();
    let mut buf = String::new();
    let mut col = 0;
    for span in spans {
        let style = span.style;
        for c in span.content.chars() {
            let cw = char_width(c);
            if cw == 0 {
                continue;
            }
            if col + cw > width && col > indent {
                if !buf.is_empty() {
                    cur.push(Span::styled(std::mem::take(&mut buf), style));
                }
                rows.push(Line::from(std::mem::take(&mut cur)));
                col = indent;
                if indent > 0 {
                    cur.push(Span::styled(" ".repeat(indent), dim));
                }
            }
            if c == '\t' {
                buf.push_str("    ");
            } else {
                buf.push(c);
            }
            col += cw;
        }
        if !buf.is_empty() {
            cur.push(Span::styled(std::mem::take(&mut buf), style));
        }
    }
    rows.push(Line::from(cur));
    rows
}

/// Single-row layout for `wrap = false`: skip `hscroll` columns, show at most
/// `width`, mark clipped edges with `←`/`→`. Returns the row and the full width.
pub(super) fn truncate_spans(
    spans: Vec<Span<'static>>,
    width: usize,
    hscroll: usize,
) -> (Line<'static>, usize) {
    let dim = Style::default().fg(theme::current().text_dim);
    let mut out: Vec<Span<'static>> = Vec::new();
    let mut buf = String::new();
    let (mut col, mut total) = (0usize, 0usize);
    let end = hscroll + width;
    for span in spans {
        let style = span.style;
        for c in span.content.chars() {
            let cw = char_width(c);
            if cw == 0 {
                continue;
            }
            total += cw;
            // Glyphs straddling either edge are dropped.
            if col >= hscroll && col + cw <= end {
                if c == '\t' {
                    buf.push_str("    ");
                } else {
                    buf.push(c);
                }
            }
            col += cw;
        }
        if !buf.is_empty() {
            out.push(Span::styled(std::mem::take(&mut buf), style));
        }
    }
    if total > end
        && let Some(last) = out.last_mut()
    {
        // Replace the final glyph with the "more" marker.
        let mut s = last.content.to_string();
        s.pop();
        s.push('→');
        *last = Span::styled(s, dim);
    }
    (Line::from(out), total)
}
