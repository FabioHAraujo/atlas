//! Non-macOS: no native page stage (it draws `WKWebView` snapshots in `CALayer`s). Snapshots and
//! covers report `false`, which the frontend pager already treats as "slide the DOM instead".

#[tauri::command]
pub fn pager_pages() {}

#[tauri::command]
pub fn pager_snapshot() -> bool {
    false
}

#[tauri::command]
pub fn pager_invalidate() {}

#[tauri::command]
pub fn pager_cover() -> bool {
    false
}

#[tauri::command]
pub fn pager_uncover() {}

#[tauri::command]
pub fn pager_ready() {}

#[tauri::command]
pub fn pager_state() -> serde_json::Value {
    serde_json::Value::Null
}
