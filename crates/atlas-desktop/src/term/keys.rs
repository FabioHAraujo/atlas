//! Keyboard, paste and scrolling commands, plus prompt navigation (OSC 133) and clear.

use atlas_term::input::{self, Mods};
use tauri::AppHandle;

use super::{with_term, write_pty};

/// A key from the webview: `text` for printable input (IME/dead keys already
/// composed), else the DOM `key` name with modifiers. `meta` (⌘) is only sent for the
/// macOS line-editing chords (⌘⌫ ⌘← ⌘→); every other ⌘ chord is an app shortcut.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn term_key(
    app: AppHandle,
    tab: String,
    key: String,
    text: Option<String>,
    shift: bool,
    alt: bool,
    ctrl: bool,
    meta: Option<bool>,
) -> Result<bool, String> {
    let (pty, sh) = with_term(&tab)?;
    // ⇧PgUp / ⇧PgDn page through the scrollback (Terminal.app, iTerm2, xterm); on the
    // alternate screen the program owns the keys and gets `CSI 5;2~` as usual.
    if text.is_none()
        && shift
        && !alt
        && !ctrl
        && let Some(up) = input::shift_page(&key, sh.vt.mode())
    {
        sh.vt.scroll_page(up);
        sh.redraw();
        return Ok(true);
    }
    let bytes = match text {
        Some(t) => input::text(&t, sh.vt.mode()),
        None => {
            let m = Mods {
                shift,
                alt,
                ctrl,
                meta: meta.unwrap_or(false),
            };
            match input::key(&key, m, sh.vt.mode()) {
                Some(b) => b,
                None => return Ok(false),
            }
        }
    };
    write_pty(&app, &pty, &bytes);
    Ok(true)
}

#[tauri::command]
pub fn term_paste(app: AppHandle, tab: String, text: String) -> Result<(), String> {
    let (pty, sh) = with_term(&tab)?;
    write_pty(&app, &pty, &input::paste(&text, sh.vt.mode()));
    Ok(())
}

/// ⌘V: paste whatever the pasteboard holds (text, copied files, or an image the program
/// reads itself), decided by `input::paste_clipboard`.
#[tauri::command]
pub fn term_paste_clipboard(app: AppHandle, tab: String) -> Result<(), String> {
    let (pty, sh) = with_term(&tab)?;
    if let Some(bytes) = input::paste_clipboard(&super::read_clipboard(), sh.vt.mode()) {
        write_pty(&app, &pty, &bytes);
    }
    Ok(())
}

/// Scroll the viewport; positive `delta` goes up into history. On the alternate screen
/// (less, vim, htop) there is no scrollback: the wheel becomes arrow keys (Ghostty's
/// mouse-scroll on the alt screen, xterm mode 1007).
#[tauri::command]
pub fn term_scroll(app: AppHandle, tab: String, delta: i32) -> Result<(), String> {
    let (pty, sh) = with_term(&tab)?;
    if let Some(arrows) = input::alt_scroll(delta, sh.vt.mode()) {
        write_pty(&app, &pty, &arrows);
        return Ok(());
    }
    sh.vt.scroll(delta);
    sh.redraw();
    Ok(())
}

/// Where `term_scroll_to` goes (⌘Home / ⌘End / ⌘PgUp / ⌘PgDn, Ghostty's scroll_* actions).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScrollTo {
    Top,
    Bottom,
    PageUp,
    PageDown,
}

#[tauri::command]
pub fn term_scroll_to(tab: String, to: ScrollTo) -> Result<(), String> {
    let sh = with_term(&tab)?.1;
    match to {
        ScrollTo::Top => sh.vt.scroll_to_top(),
        ScrollTo::Bottom => sh.vt.scroll_to_bottom(),
        ScrollTo::PageUp => sh.vt.scroll_page(true),
        ScrollTo::PageDown => sh.vt.scroll_page(false),
    }
    sh.redraw();
    Ok(())
}

/// ⌘A: select everything (scrollback and screen). The text goes to the clipboard on ⌘C.
#[tauri::command]
pub fn term_select_all(tab: String) -> Result<(), String> {
    let sh = with_term(&tab)?.1;
    sh.vt.select_all();
    sh.redraw();
    Ok(())
}

/// ⇧⌘Y: select the output of the last finished command (OSC 133 C..D); again = the one
/// before. The text also goes to the clipboard. `false` = no marked output to select.
#[tauri::command]
pub fn term_select_output(tab: String) -> Result<bool, String> {
    let sh = with_term(&tab)?.1;
    let found = sh.vt.select_last_output();
    if found && let Some(text) = sh.vt.end_selection() {
        super::write_clipboard(&text);
    }
    sh.redraw();
    Ok(found)
}

/// ⌘K (Ghostty `clear_screen`): erase screen and scrollback, then `^L` so the shell redraws
/// its prompt at the top. On the alternate screen the program owns the display: no-op.
#[tauri::command]
pub fn term_clear(app: AppHandle, tab: String) -> Result<bool, String> {
    let (pty, sh) = with_term(&tab)?;
    let cleared = sh.vt.clear_screen();
    if cleared {
        write_pty(&app, &pty, b"\x0c");
        sh.redraw();
    }
    Ok(cleared)
}

/// Scroll to the previous (`up`) / next shell prompt (OSC 133). `false` = no prompt there.
#[tauri::command]
pub fn term_jump_prompt(tab: String, up: bool) -> Result<bool, String> {
    let sh = with_term(&tab)?.1;
    let moved = sh.vt.jump_to_prompt(up);
    sh.redraw();
    Ok(moved)
}

/// Click on the prompt line moves the cursor there (Ghostty `cursor-click-to-move`): the
/// delta from the cursor becomes arrow keys. `false` = the click is not on an editable
/// prompt (no OSC 133, a command is running, alternate screen) and is a plain click.
#[tauri::command]
pub fn term_click_move(app: AppHandle, tab: String, col: u16, row: u16) -> Result<bool, String> {
    let (pty, sh) = with_term(&tab)?;
    let Some((dx, dy)) = sh.vt.click_to_move(col as usize, row as i32) else {
        return Ok(false);
    };
    let bytes = input::cursor_moves(dx, dy, sh.vt.mode());
    if bytes.is_empty() {
        return Ok(false);
    }
    write_pty(&app, &pty, &bytes);
    Ok(true)
}
