//! Styling of one entry's spans: service colors, find/cursor highlights.

use super::*;

/// Stable per-service color for the prefix label. The palette avoids amber,
/// orange, yellow and red so a prefix is never mistaken for warn/error.
pub(super) fn service_color(name: &str) -> Color {
    const PALETTE: &[Color] = &[
        Color::Rgb(0x60, 0xA5, 0xFA), // blue
        Color::Rgb(0x34, 0xD3, 0x99), // emerald
        Color::Rgb(0xA7, 0x8B, 0xFA), // violet
        Color::Rgb(0x38, 0xBD, 0xF8), // sky
        Color::Rgb(0x2D, 0xD4, 0xBF), // teal
        Color::Rgb(0x81, 0x8C, 0xF8), // indigo
        Color::Rgb(0xC4, 0xB5, 0xFD), // lavender
        Color::Rgb(0x6E, 0xE7, 0xB7), // mint
    ];
    let hash: u32 = name
        .bytes()
        .fold(5381u32, |h, b| h.wrapping_mul(33).wrapping_add(b as u32));
    PALETTE[hash as usize % PALETTE.len()]
}

/// Restyle byte `ranges` of the concatenated span text with `f(range index)`.
/// Ranges must be sorted and non-overlapping.
pub(super) fn restyle_spans(
    spans: Vec<Span<'static>>,
    ranges: &[(Range<usize>, Style)],
) -> Vec<Span<'static>> {
    if ranges.is_empty() {
        return spans;
    }
    let mut out = Vec::with_capacity(spans.len() + ranges.len() * 2);
    let mut pos = 0usize;
    for span in spans {
        let text = span.content.as_ref();
        let (start, end) = (pos, pos + text.len());
        let mut at = 0usize; // byte offset inside `text`
        for (r, patch) in ranges {
            if r.end <= start || r.start >= end {
                continue;
            }
            let a = r.start.max(start) - start;
            let b = r.end.min(end) - start;
            if a < at {
                continue;
            }
            if a > at {
                out.push(Span::styled(text[at..a].to_string(), span.style));
            }
            out.push(Span::styled(
                text[a..b].to_string(),
                span.style.patch(*patch),
            ));
            at = b;
        }
        if at < text.len() {
            out.push(Span::styled(text[at..].to_string(), span.style));
        }
        pos = end;
    }
    out
}

/// Everything one entry draws: prefix columns + (JSON-compacted) message.
pub(super) fn entry_spans(
    entry: &LogEntry,
    opts: &ViewOpts,
    find: Option<&FindHighlight<'_>>,
    cursor: Option<&Cursor>,
) -> Vec<Span<'static>> {
    let t = theme::current();
    if entry.mark {
        return vec![Span::styled(
            entry.content.clone(),
            Style::default().fg(t.text_dim),
        )];
    }
    if entry.restart {
        return vec![Span::styled(
            entry.content.clone(),
            Style::default().fg(t.accent).add_modifier(Modifier::DIM),
        )];
    }
    let (text, level) = display_content(entry, opts.json);
    let base_style = match level {
        LogLevel::Error => Style::default().fg(t.error),
        LogLevel::Warn => Style::default().fg(t.warning),
        LogLevel::Debug => Style::default().fg(t.text_muted),
        LogLevel::Info => Style::default().fg(t.text),
    };
    let mut spans = Vec::new();
    if opts.timestamps {
        spans.push(Span::styled(
            format!("{} ", entry.time_str),
            Style::default().fg(t.text_dim),
        ));
    }
    if opts.show_service {
        spans.push(Span::styled(
            format!("[{}] ", entry.service),
            Style::default().fg(service_color(&entry.service)),
        ));
    }
    let parsed = ansi::parse(t, &text, base_style);
    let mut msg = parsed.spans;
    // Links (underlined; the cursor's one inverted) then find hits on top.
    let mut patches: Vec<(Range<usize>, Style)> = Vec::new();
    if !entry.truncated || !text.is_empty() {
        let links = entry_links(entry, opts.json);
        for (i, l) in links.iter().enumerate() {
            let mut style = Style::default()
                .fg(t.info)
                .add_modifier(Modifier::UNDERLINED);
            if cursor.is_some_and(|c| c.seq == entry.seq && c.link == i) {
                style = style.bg(t.bg_float).add_modifier(Modifier::BOLD);
            }
            patches.push((l.range.clone(), style));
        }
    }
    msg = restyle_spans(msg, &patches);
    if let Some(f) = find {
        let plain: String = msg.iter().map(|s| s.content.as_ref()).collect();
        let ranges = f.finder.ranges(&plain);
        let current = f
            .current
            .and_then(|(seq, idx)| (seq == entry.seq).then_some(idx));
        let hit = Style::default().bg(t.bg_float).fg(t.accent).bold();
        let cur = Style::default().bg(t.accent).fg(t.bg).bold();
        let patches: Vec<_> = ranges
            .into_iter()
            .enumerate()
            .map(|(i, r)| (r, if Some(i) == current { cur } else { hit }))
            .collect();
        msg = restyle_spans(msg, &patches);
    }
    spans.extend(msg);
    spans
}
