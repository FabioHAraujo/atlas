//! The log pane widget. `ViewOpts` + `LogViewport` are the shared vocabulary;
//! `content` decides what a row says, `layout` how it wraps, `style` how it is
//! colored and `render` draws the window.

mod content;
mod layout;
mod render;
mod style;
#[cfg(test)]
mod tests;

use std::cell::Cell;
use std::ops::Range;

use ratatui::prelude::*;
use ratatui::widgets::*;
use unicode_width::UnicodeWidthChar;

use super::ansi;
use super::rowcache::RowCache;
use crate::runtime::logindex::ViewIndex;
use crate::runtime::logs::{LogBuffer, LogEntry, LogLevel};
use crate::runtime::text::visible_chars;
use crate::theme;
use crate::tui::app::Message;
use crate::tui::clicks::{ClickMap, ScrollbarGeometry, Target, Wheel};

pub use content::{display_content, entry_links, search_text};
pub use layout::entry_rows;
pub use render::{LogPane, Source, render, text_width_for};

// Siblings share one vocabulary through `super::*`.
use content::char_width;
use layout::{Prefix, truncate_spans, wrap_spans};
use style::entry_spans;

const PAD_LEFT: u16 = 2;

const PAD_RIGHT: u16 = 1;

const TAB_WIDTH: usize = 4;

/// Geometry of the last rendered log view, in wrapped screen rows.
/// Written by `render`, read by scroll handlers so they clamp to real content.
#[derive(Debug, Clone, Copy, Default)]
pub struct LogViewport {
    /// Columns available for text (wrap width).
    pub text_width: u16,
    /// Visible rows.
    pub height: usize,
    /// Largest valid `log_scroll` (rows above the bottom).
    pub max_scroll: usize,
    /// Widest line seen (columns) — bounds the horizontal scroll when wrap is off.
    pub max_hscroll: usize,
}

/// How entries are laid out. Row counting and rendering share it so the
/// scroll math can never drift from what is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewOpts {
    /// Show the `[svc]` prefix (off on single-service tabs).
    pub show_service: bool,
    pub timestamps: bool,
    /// Hard-wrap long lines (off = truncate, `hscroll` pans).
    pub wrap: bool,
    /// Compact JSON-object lines into `level msg key=val …`.
    pub json: bool,
    /// Columns panned when `wrap` is off.
    pub hscroll: usize,
}

impl Default for ViewOpts {
    fn default() -> Self {
        Self {
            show_service: true,
            timestamps: true,
            wrap: true,
            json: false,
            hscroll: 0,
        }
    }
}

/// A compiled find query (shared with MCP search and the index).
pub use crate::runtime::logindex::Matcher as Finder;

/// Find highlighting for a render pass.
#[derive(Clone, Copy)]
pub struct FindHighlight<'a> {
    pub finder: &'a Finder,
    /// `(entry seq, occurrence index within the entry)` of the current match.
    pub current: Option<(u64, usize)>,
}

/// A link under the view cursor: opened by `o`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cursor {
    /// Entry the cursor sits on.
    pub seq: u64,
    /// Which link of that entry (index into `entry_links`).
    pub link: usize,
}
