//! Key → message mapping for the log pane, the search bar and the custom
//! time prompt.
use super::super::{App, Message};

impl App {
    /// Search-bar key → message (used by input.rs while `log_searching`).
    pub(in crate::tui::app) fn map_search_key(
        &self,
        key: crossterm::event::KeyEvent,
    ) -> Option<Message> {
        use crossterm::event::{KeyCode, KeyModifiers};
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Tab => Some(Message::ToggleSearchMode),
            KeyCode::Char('r') if ctrl => Some(Message::ToggleSearchRegex),
            _ => prompt_key(
                key,
                PromptKeys {
                    cancel: Message::LogSearchClear,
                    commit: Message::LogSearchCommit,
                    backspace: Message::LogSearchBackspace,
                    input: Message::LogSearchInput,
                },
            ),
        }
    }

    /// Custom time-range prompt key → message (used by input.rs while the
    /// prompt is open; it owns the keyboard like the search bar).
    pub(in crate::tui::app) fn map_time_key(
        &self,
        key: crossterm::event::KeyEvent,
    ) -> Option<Message> {
        prompt_key(
            key,
            PromptKeys {
                cancel: Message::TimeCancel,
                commit: Message::TimeCommit,
                backspace: Message::TimeBackspace,
                input: Message::TimeInput,
            },
        )
    }

    /// Dashboard keys that drive the log pane. `n`/`N` only count while a find
    /// query is active (otherwise they fall through to open_key/action bindings).
    pub(in crate::tui::app) fn log_view_key(&self, c: char) -> Option<Message> {
        match c {
            'n' if self.find_active() => Some(Message::FindNext),
            'N' if self.find_active() => Some(Message::FindPrev),
            'W' => Some(Message::ToggleWrap),
            'T' => Some(Message::ToggleTimestamps),
            'V' => Some(Message::CycleTimeRange),
            'J' => Some(Message::ToggleJson),
            '-' => Some(Message::InsertMark),
            'z' => Some(Message::ToggleZoom),
            'o' if self.logs.link_cursor.is_some() => Some(Message::OpenLink),
            'y' if self.logs.link_cursor.is_some() => Some(Message::CopyLink),
            ']' | '[' => Some(Message::ChordStart(c)),
            '}' => Some(Message::StepLink { forward: true }),
            '{' => Some(Message::StepLink { forward: false }),
            _ => None,
        }
    }

    /// Second key of a `]` / `[` chord: `e` errors, `w` warnings+errors.
    pub(in crate::tui::app) fn chord_key(&self, first: char, c: char) -> Option<Message> {
        let forward = first == ']';
        match c {
            'e' => Some(Message::JumpProblem {
                forward,
                warn: false,
            }),
            'w' => Some(Message::JumpProblem {
                forward,
                warn: true,
            }),
            _ => None,
        }
    }
}

/// The messages a one-line text prompt (search bar, time prompt) emits.
struct PromptKeys {
    cancel: Message,
    commit: Message,
    backspace: Message,
    input: fn(char) -> Message,
}

/// Keys every prompt shares: Esc / Enter / Backspace, typed characters, and
/// Ctrl+C quitting. Other Ctrl/Alt chords are ignored.
fn prompt_key(key: crossterm::event::KeyEvent, keys: PromptKeys) -> Option<Message> {
    use crossterm::event::{KeyCode, KeyModifiers};
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    match key.code {
        KeyCode::Esc => Some(keys.cancel),
        KeyCode::Enter => Some(keys.commit),
        KeyCode::Backspace => Some(keys.backspace),
        KeyCode::Char('c') if ctrl => Some(Message::Quit),
        KeyCode::Char(_) if ctrl || key.modifiers.contains(KeyModifiers::ALT) => None,
        KeyCode::Char(c) => Some((keys.input)(c)),
        _ => None,
    }
}
