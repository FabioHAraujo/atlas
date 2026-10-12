//! The command palette.

use super::super::{App, Layer, Message};

impl App {
    /// Handle the palette messages; anything else is handed back for the next domain.
    pub(super) fn reduce_palette(&mut self, msg: Message) -> Option<Message> {
        match msg {
            // Command Palette
            Message::ShowPalette => {
                self.layer = Layer::CommandPalette;
                self.palette_input.clear();
                self.palette_filtered = self.filter_palette();
                self.palette_selected = 0;
                self.palette_offset = 0;
            }
            Message::HidePalette => self.layer = Layer::Dashboard,
            Message::PaletteInput(c) => {
                self.palette_input.push(c);
                self.palette_filtered = self.filter_palette();
                self.palette_selected = 0;
                self.palette_offset = 0;
            }
            Message::PaletteBackspace => {
                self.palette_input.pop();
                self.palette_filtered = self.filter_palette();
                self.palette_selected = 0;
                self.palette_offset = 0;
            }
            Message::PaletteClear => {
                self.palette_input.clear();
                self.palette_filtered = self.filter_palette();
                self.palette_selected = 0;
                self.palette_offset = 0;
            }
            Message::PaletteDeleteWord => {
                let trimmed = self.palette_input.trim_end().len();
                self.palette_input.truncate(trimmed);
                let keep = self.palette_input.rfind(' ').map_or(0, |i| i + 1);
                self.palette_input.truncate(keep);
                self.palette_filtered = self.filter_palette();
                self.palette_selected = 0;
                self.palette_offset = 0;
            }
            Message::PaletteUp => {
                self.palette_selected = self.palette_selected.saturating_sub(1);
                self.palette_scroll_into_view(self.palette_rows.get());
            }
            Message::PaletteDown => {
                if self.palette_selected < self.palette_filtered.len().saturating_sub(1) {
                    self.palette_selected += 1;
                }
                self.palette_scroll_into_view(self.palette_rows.get());
            }
            Message::PaletteSelect => {
                if let Some(cmd) = self.palette_filtered.get(self.palette_selected).cloned() {
                    self.layer = Layer::Dashboard;
                    self.remember_command(&cmd.id);
                    self.update(cmd.action);
                }
            }
            Message::PaletteClick(idx) => {
                // Row click: select + run, same as navigating with ↑↓ then Enter.
                if let Some(cmd) = self.palette_filtered.get(idx).cloned() {
                    self.palette_selected = idx;
                    self.layer = Layer::Dashboard;
                    self.remember_command(&cmd.id);
                    self.update(cmd.action);
                }
            }
            other => return Some(other),
        }
        None
    }
}
