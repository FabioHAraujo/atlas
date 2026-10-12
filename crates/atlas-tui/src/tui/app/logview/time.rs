//! The time-range filter (`V`): presets, the custom prompt and its commit.
use crate::runtime::timerange::{self, TimeRange};

use super::super::App;

impl App {
    /// `V`: next preset; after the last one the custom prompt opens, and
    /// leaving the prompt without a value returns to all time.
    pub(in crate::tui::app) fn cycle_time_range(&mut self) {
        self.logs.time_error = None;
        if self.logs.time_input.is_some() {
            self.time_cancel();
            return;
        }
        if self.logs.time_range == TimeRange::SinceStackStart {
            // The prompt follows the last preset; the range stays until a value is committed.
            self.logs.time_input = Some(String::new());
            return;
        }
        self.set_time_range(self.logs.time_range.next());
    }

    pub(in crate::tui::app) fn set_time_range(&mut self, range: TimeRange) {
        if self.logs.time_range != range {
            self.logs.time_range = range;
            self.reset_log_view();
        }
    }

    pub(in crate::tui::app) fn time_input(&mut self, c: char) {
        if let Some(t) = &mut self.logs.time_input {
            t.push(c);
            self.logs.time_error = None;
        }
    }

    pub(in crate::tui::app) fn time_backspace(&mut self) {
        if let Some(t) = &mut self.logs.time_input {
            t.pop();
            self.logs.time_error = None;
        }
    }

    /// Enter: apply the typed range, or keep the prompt open with the reason.
    /// An empty field applies nothing and closes (back to all time).
    pub(in crate::tui::app) fn time_commit(&mut self) {
        let Some(text) = self.logs.time_input.clone() else {
            return;
        };
        if text.trim().is_empty() {
            self.time_cancel();
            return;
        }
        match timerange::parse_custom(&text) {
            Ok(range) => {
                self.logs.time_input = None;
                self.logs.time_error = None;
                self.set_time_range(range);
            }
            Err(why) => self.logs.time_error = Some(why),
        }
    }

    /// Esc: close the prompt; the range returns to all time.
    pub(in crate::tui::app) fn time_cancel(&mut self) {
        self.logs.time_input = None;
        self.logs.time_error = None;
        self.set_time_range(TimeRange::All);
    }
}
