//! Navigation: tabs, log scrolling, follow mode and the mouse.

use super::super::{App, Layer, Message};

impl App {
    /// Handle the nav messages; anything else is handed back for the next domain.
    pub(super) fn reduce_nav(&mut self, msg: Message) -> Option<Message> {
        match msg {
            Message::SwitchTab(idx) => {
                if idx < self.tabs.len() {
                    self.active_tab = idx;
                    self.reset_log_view();
                    self.save_ui_state();
                }
            }
            Message::NextTab => {
                self.active_tab = (self.active_tab + 1) % self.tabs.len();
                self.reset_log_view();
                self.save_ui_state();
            }
            Message::PrevTab => {
                self.active_tab = (self.active_tab + self.tabs.len() - 1) % self.tabs.len();
                self.reset_log_view();
                self.save_ui_state();
            }
            Message::ScrollDown => self.scroll_logs(-1),
            Message::ScrollUp => self.scroll_logs(1),
            Message::ScrollPageDown => self.scroll_logs(-self.log_page()),
            Message::ScrollPageUp => self.scroll_logs(self.log_page()),
            Message::ScrollToBottom => self.reset_log_view(),
            Message::ScrollToTop => self.scroll_logs(isize::MAX),
            // Mouse — click map is the single source of truth
            Message::MouseClick { x, y } => {
                use crate::tui::clicks::Target;
                match self.clicks.hit(x, y).map(|(_, t)| t) {
                    Some(Target::Click(msg)) => self.update(msg),
                    Some(Target::Scrollbar(geo)) => {
                        // Click on track: jump to position and start drag.
                        let n = geo.scroll_for_row(y);
                        self.logs.log_scroll = n.min(geo.max_scroll);
                        self.set_follow(self.logs.log_scroll == 0);
                        self.drag_scrollbar = Some(geo);
                    }
                    Some(Target::Inert) | Some(Target::Wheel(_)) | None => {}
                }
            }
            Message::MouseDrag { y } => {
                if let Some(geo) = self.drag_scrollbar {
                    let n = geo.scroll_for_row(y);
                    self.logs.log_scroll = n.min(geo.max_scroll);
                    self.set_follow(self.logs.log_scroll == 0);
                }
            }
            Message::MouseRelease => {
                self.drag_scrollbar = None;
            }
            Message::MouseScroll { x, y, down } => {
                use crate::tui::clicks::{Target, Wheel};
                match self.clicks.hit(x, y).map(|(_, t)| t) {
                    Some(Target::Wheel(Wheel::Palette)) => {
                        if down {
                            self.update(Message::PaletteDown);
                        } else {
                            self.update(Message::PaletteUp);
                        }
                    }
                    Some(Target::Wheel(Wheel::Picker)) => {
                        if down {
                            self.update(Message::DevicePickerDown);
                        } else {
                            self.update(Message::DevicePickerUp);
                        }
                    }
                    _ if self.layer == Layer::Help => {
                        self.update(Message::HelpScroll(if down { 3 } else { -3 }));
                    }
                    // Anything else (including explicit Logs wheel) scrolls the log.
                    _ => self.scroll_logs(if down { -3 } else { 3 }),
                }
            }
            Message::ScrollLogsTo(n) => {
                let max = self.logs.log_viewport.get().max_scroll;
                self.logs.log_scroll = n.min(max);
                self.set_follow(self.logs.log_scroll == 0);
            }
            Message::ToggleFollow => {
                // The footer shows Following / Paused; no toast needed.
                let follow = !self.logs.follow_logs;
                self.set_follow(follow);
                if follow {
                    self.logs.log_scroll = 0;
                }
            }
            Message::GotoTab(name) | Message::SelectService(name) => {
                // Sidebar/strip click: switch to that service's log tab (no-op if not found).
                if let Some(idx) = self.tabs.iter().position(|t| t == &name) {
                    self.active_tab = idx;
                    self.reset_log_view();
                    self.save_ui_state();
                }
            }
            other => return Some(other),
        }
        None
    }
}
