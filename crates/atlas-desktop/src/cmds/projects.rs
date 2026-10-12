//! The project registry commands: list, add, remove, pin, identity and discovery.

use std::path::Path;

use atlas_tui::{config, status};
use serde::Serialize;
use tauri::{AppHandle, State};

use super::{notify_changed, root_of, update_entry};
use crate::live::LiveHub;
use crate::registry::{self, Entry};

#[derive(Serialize)]
pub struct ProjectView {
    id: String,
    root: String,
    name: String,
    pinned: bool,
    running: bool,
    mode: Option<String>,
    services_total: usize,
    services_healthy: usize,
    error: Option<String>,
    profiles: Vec<String>,
    parent: Option<String>,
    port_offset: u16,
    branch: Option<String>,
    /// `ssh:<alias>` for SSH checkouts.
    host: Option<String>,
    /// User-chosen icon and color (`None` = automatic).
    identity: Option<registry::Identity>,
}

/// The part of a `ProjectView` that comes from reading the checkout (config + live runner).
#[derive(Default)]
struct Detail {
    name: Option<String>,
    error: Option<String>,
    profiles: Vec<String>,
    mode: Option<String>,
    running: bool,
    services_total: usize,
    services_healthy: usize,
}

fn read_local(root: &Path) -> Detail {
    let (name, error, total, profiles) = match config::load_checked(root) {
        Ok((cfg, errs)) => (
            Some(cfg.name.clone()),
            (!errs.is_empty()).then(|| config::render_errors(&errs, "atlas.yaml")),
            cfg.services.len(),
            cfg.profiles.keys().cloned().collect(),
        ),
        Err(err) => (None, Some(format!("{err:#}")), 0, Vec::new()),
    };
    let snap = status::live_snapshot(root).ok();
    Detail {
        name,
        error,
        profiles,
        mode: snap.as_ref().map(|s| s.mode.clone()),
        running: snap.is_some(),
        services_total: snap.as_ref().map_or(total, |s| s.services.len()),
        services_healthy: snap.as_ref().map_or(0, |s| {
            s.services.iter().filter(|r| r.state == "running").count()
        }),
    }
}

fn view(e: &Entry) -> ProjectView {
    let root = Path::new(&e.root);
    // Never read a remote path on this machine; details come via hostd.
    let d = if e.is_remote() {
        Detail::default()
    } else {
        read_local(root)
    };
    let name = d.name.unwrap_or_else(|| {
        root.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| e.root.clone())
    });
    ProjectView {
        id: e.id.clone(),
        root: e.root.clone(),
        name,
        pinned: e.pinned,
        running: d.running,
        mode: d.mode,
        services_total: d.services_total,
        services_healthy: d.services_healthy,
        error: d.error,
        profiles: d.profiles,
        parent: e.parent.clone(),
        port_offset: e.port_offset,
        branch: e.branch.clone(),
        host: e.host.clone(),
        identity: e.identity.clone(),
    }
}

#[tauri::command]
pub fn projects_list(app: AppHandle, hub: State<'_, LiveHub>) -> Result<Vec<ProjectView>, String> {
    let entries = registry::load()?;
    for e in entries.iter().filter(|e| !e.is_remote()) {
        hub.ensure(&app, &e.id, Path::new(&e.root));
    }
    Ok(entries.iter().map(view).collect())
}

/// Restart a project's subscription so the frontend gets a fresh `snapshot`
/// (after a webview reload, the long-lived task would otherwise only send deltas).
#[tauri::command]
pub fn live_resync(app: AppHandle, hub: State<'_, LiveHub>, id: String) -> Result<(), String> {
    let root = root_of(&id)?;
    hub.remove(&id);
    hub.ensure(&app, &id, &root);
    Ok(())
}

#[tauri::command]
pub fn projects_add(
    app: AppHandle,
    hub: State<'_, LiveHub>,
    root: String,
) -> Result<ProjectView, String> {
    let root = config::find_root(Path::new(&root)).ok_or(format!("no atlas.yaml in {root}"))?;
    let root = root.canonicalize().unwrap_or(root);
    let mut entries = registry::load()?;
    let id = registry::id_for(&root);
    if let Some(e) = entries.iter().find(|e| e.id == id) {
        return Ok(view(e));
    }
    let entry = Entry {
        id: id.clone(),
        root: root.to_string_lossy().into_owned(),
        pinned: false,
        added: chrono::Utc::now().to_rfc3339(),
        parent: None,
        port_offset: 0,
        branch: None,
        host: None,
        identity: None,
    };
    entries.push(entry.clone());
    registry::save(&entries)?;
    hub.ensure(&app, &id, &root);
    notify_changed(&app);
    Ok(view(&entry))
}

#[tauri::command]
pub fn projects_remove(app: AppHandle, hub: State<'_, LiveHub>, id: String) -> Result<(), String> {
    let mut entries = registry::load()?;
    entries.retain(|e| e.id != id);
    registry::save(&entries)?;
    hub.remove(&id);
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn projects_pin(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    update_entry(&app, &id, |e| {
        e.pinned = pinned;
        Ok(())
    })
}

/// Set (or, with `None`/an empty identity, clear) the icon and color of a project.
#[tauri::command]
pub fn projects_set_identity(
    app: AppHandle,
    id: String,
    identity: Option<registry::Identity>,
) -> Result<(), String> {
    let identity = identity
        .map(registry::Identity::validated)
        .transpose()?
        .flatten();
    update_entry(&app, &id, |e| {
        e.identity = identity;
        Ok(())
    })
}

#[tauri::command]
pub async fn projects_discover() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = dirs::home_dir().ok_or("cannot locate home directory")?;
        let known: Vec<String> = registry::load()?.into_iter().map(|e| e.root).collect();
        let mut found = Vec::new();
        for dir in ["Projetos", "Projects", "code", "dev"] {
            scan(&home.join(dir), 0, &mut found);
        }
        found.retain(|p| !known.contains(p));
        found.sort();
        found.dedup();
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn scan(dir: &Path, depth: u32, out: &mut Vec<String>) {
    if dir.join("atlas.yaml").is_file() {
        out.push(dir.to_string_lossy().into_owned());
    }
    if depth >= 3 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        if ent.file_type().is_ok_and(|t| t.is_dir()) {
            scan(&ent.path(), depth + 1, out);
        }
    }
}
