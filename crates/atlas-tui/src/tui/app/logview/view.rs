//! The active view's definition (`ViewKey`) and the sync of the incremental
//! index + row cache to the buffer.
use crate::runtime::clock::now_ms;
use crate::runtime::logindex::{Matcher, ViewKey};
use crate::runtime::logs::{LogEntry, LogLevel};
use crate::runtime::timerange::{self, Window};
use crate::tui::widgets::log_viewer::{Finder, LogViewport, ViewOpts};

use super::super::{App, LevelFilter};
use super::SearchMode;

impl App {
    /// Compiled query (None while empty or an invalid regex).
    pub fn finder(&self) -> Option<Finder> {
        Matcher::new(&self.logs.log_search_input, self.logs.search_regex)
    }

    /// The query is non-empty but does not compile (bad regex).
    pub fn search_invalid(&self) -> bool {
        !self.logs.log_search_input.is_empty() && self.finder().is_none()
    }

    /// Find is highlighting (not filtering) with a usable query.
    pub fn find_active(&self) -> bool {
        self.logs.search_mode == SearchMode::Find && self.finder().is_some()
    }

    /// Layout options for the active tab.
    pub fn view_opts(&self) -> ViewOpts {
        ViewOpts {
            // All and the tunnel tab mix sources; a service tab is one source.
            show_service: self.active_tab == 0,
            timestamps: self.logs.log_timestamps,
            wrap: self.logs.log_wrap,
            json: self.logs.log_json_pretty,
            hscroll: self.logs.log_hscroll,
        }
    }

    /// Service whose ring backs the active tab (`None` = All).
    pub fn view_service(&self) -> Option<&str> {
        if self.active_tab == 0 {
            None
        } else {
            self.tabs.get(self.active_tab).map(String::as_str)
        }
    }

    /// Seq of the entry under a viewport row counted from the bottom: the row
    /// `back(viewport)` rows above the scrolled bottom (`height` = top row, `1` =
    /// bottom row). `None` while the row cache lags the index or the view is empty.
    pub(super) fn seq_at_viewport_row(
        &self,
        back: impl FnOnce(&LogViewport) -> usize,
    ) -> Option<u64> {
        let vp = self.logs.log_viewport.get();
        let ix = self.logs.index.borrow();
        let rows = self.logs.rows.borrow();
        if rows.len() != ix.len() || ix.is_empty() {
            return None;
        }
        let row = rows
            .total()
            .saturating_sub(self.logs.log_scroll.min(vp.max_scroll) + back(&vp));
        rows.locate(row).and_then(|(i, _)| ix.seq_at(i))
    }

    /// Definition of the active view: any change rebuilds the index once.
    pub(super) fn view_key(&self) -> ViewKey {
        let q = &self.logs.log_search_input;
        let query = (!q.is_empty()).then(|| (q.clone(), self.logs.search_regex));
        let (filter, find) = match self.logs.search_mode {
            SearchMode::Filter => (query, None),
            SearchMode::Find => (None, query),
        };
        let mut hidden: Vec<String> = if self.active_tab == 0 {
            self.manager
                .hidden_service_names()
                .into_iter()
                .map(String::from)
                .collect()
        } else {
            Vec::new()
        };
        hidden.sort();
        let window = timerange::resolve(
            self.logs.time_range,
            &self.logs.log_buffer,
            self.view_service(),
            now_ms(),
        )
        // A nonexistent local time (DST gap) resolves to nothing: show nothing.
        .unwrap_or(Window {
            min_seq: u64::MAX,
            ..Window::default()
        });
        ViewKey {
            service: self.view_service().map(String::from),
            hidden,
            min_level: match self.logs.level_filter {
                LevelFilter::All => None,
                LevelFilter::Warn => Some(LogLevel::Warn),
                LevelFilter::Error => Some(LogLevel::Error),
            },
            filter,
            find,
            json: self.logs.log_json_pretty,
            window,
        }
    }

    /// Advance the view index (and row cache, when the pane has been laid out)
    /// to the current buffer. Cheap when nothing changed.
    pub fn sync_logs(&self) {
        let key = self.view_key();
        let mut ix = self.logs.index.borrow_mut();
        ix.sync(&self.logs.log_buffer, &key);
        let vp = self.logs.log_viewport.get();
        if vp.text_width > 0 {
            self.logs.rows.borrow_mut().sync(
                &self.logs.log_buffer,
                key.service.as_deref(),
                ix.seqs(0..ix.len()),
                vp.text_width,
                &self.view_opts(),
            );
        }
    }

    /// The text width the next frame will wrap at, once known.
    pub fn sync_rows_for(&self, width: u16) {
        let key = self.view_key();
        let ix = self.logs.index.borrow();
        self.logs.rows.borrow_mut().sync(
            &self.logs.log_buffer,
            key.service.as_deref(),
            ix.seqs(0..ix.len()),
            width,
            &self.view_opts(),
        );
    }

    /// Entries of the current view, oldest first (allocates; for copy/tests —
    /// the renderer reads the index directly).
    pub fn filtered_logs(&self) -> Vec<&LogEntry> {
        self.sync_logs();
        let ix = self.logs.index.borrow();
        let svc = self.view_service();
        ix.seqs(0..ix.len())
            .filter_map(|seq| match svc {
                Some(s) => self.logs.log_buffer.get(s, seq),
                None => self.logs.log_buffer.get_any(seq),
            })
            .collect()
    }

    /// Whether `e` shows up in the current tab + level (+ filter) view. Uses
    /// the already-synced index: O(log N).
    pub(in crate::tui::app) fn log_visible(&self, e: &LogEntry) -> bool {
        self.sync_logs();
        self.logs.index.borrow().index_of(e.seq).is_some()
    }
}
