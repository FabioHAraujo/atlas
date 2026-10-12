//! Non-macOS: no native swipe tracking; the frontend keeps its wheel recognizer.

#[tauri::command]
pub fn swipe_zones(_zones: Vec<serde_json::Value>) {}

#[tauri::command]
pub async fn swipe_native() -> bool {
    false
}
