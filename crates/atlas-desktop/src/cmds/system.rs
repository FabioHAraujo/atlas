//! Hand things to macOS `open`: the editor, the browser, Finder.

use super::root_of;

fn open(args: &[&str]) -> Result<(), String> {
    let st = std::process::Command::new("open")
        .args(args)
        .status()
        .map_err(|e| e.to_string())?;
    if st.success() {
        Ok(())
    } else {
        Err(format!("open {} failed", args.join(" ")))
    }
}

#[tauri::command]
pub fn open_in_editor(id: String) -> Result<(), String> {
    let root = root_of(&id)?;
    let r = root.to_string_lossy();
    open(&["-a", "Visual Studio Code", &r]).or_else(|_| open(&[&r]))
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("refusing to open {url}"));
    }
    open(&[&url])
}

#[tauri::command]
pub fn reveal(id: String) -> Result<(), String> {
    let root = root_of(&id)?;
    open(&["-R", &root.join("atlas.yaml").to_string_lossy()])
}
