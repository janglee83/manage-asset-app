//! Folder and asset management commands.

use std::path::Path;
use tauri::{AppHandle, State};
use rusqlite::params;
use crate::state::AppState;
use crate::models::{Asset, ScanResult, WatchedFolder};
use crate::folder_intel;
use crate::relation_graph;
use crate::scanner::{add_watched_folder, scan_folder};
use crate::watcher;

// ─── Folders ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn add_folder(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ScanResult, String> {
    tracing::info!(folder = %path, "add_folder: starting");
    let folder_path = Path::new(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        tracing::warn!(folder = %path, "add_folder: path does not exist or is not a directory");
        return Err(format!("Folder does not exist: {}", path));
    }

    add_watched_folder(state.db.clone(), &path).map_err(|e| e.to_string())?;

    {
        let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(handle) => handle.add_path(folder_path),
            None => {
                let handle = watcher::start_watching(
                    vec![path.clone()],
                    state.db.clone(),
                    state.cache_dir.clone(),
                    app.clone(),
                );
                *guard = Some(handle);
            }
        }
    }

    let db = state.db.clone();
    let cache_dir = state.cache_dir.clone();
    let path_clone = path.clone();
    let app_clone = app.clone();

    let result = tokio::task::spawn_blocking(move || {
        scan_folder(Path::new(&path_clone), db, &cache_dir, &app_clone)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    match &result {
        Ok(r) => tracing::info!(folder = %path, indexed = r.indexed, skipped = r.skipped, errors = r.errors, "add_folder: scan complete"),
        Err(e) => tracing::error!(folder = %path, error = %e, "add_folder: scan failed"),
    }

    if result.is_ok() {
        let intel_db = state.db.clone();
        let intel_path = path.clone();
        tokio::task::spawn_blocking(move || {
            let _ = folder_intel::refresh_folder_intel_for_root(&intel_db, &intel_path);
        })
        .await
        .ok();

        let rel_db = state.db.clone();
        let rel_path = path.clone();
        tokio::task::spawn_blocking(move || {
            let _ = relation_graph::refresh_relations_for_root(&rel_db, &rel_path);
        })
        .await
        .ok();
    }

    result
}

#[tauri::command]
pub async fn remove_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(guard) = state.watcher.lock() {
        if let Some(handle) = guard.as_ref() {
            handle.remove_path(Path::new(&path));
        }
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM watched_folders WHERE path = ?1",
        params![path],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM assets WHERE folder = ?1 OR folder LIKE ?2",
        params![path, format!("{}%", path)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_folders(state: State<'_, AppState>) -> Result<Vec<WatchedFolder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, path, added_at FROM watched_folders ORDER BY added_at ASC")
        .map_err(|e| e.to_string())?;
    let folders: Vec<WatchedFolder> = stmt
        .query_map([], |row| {
            Ok(WatchedFolder {
                id: row.get(0)?,
                path: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(folders)
}

#[tauri::command]
pub async fn rescan_folder(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ScanResult, String> {
    let db = state.db.clone();
    let cache_dir = state.cache_dir.clone();
    let path_clone = path.clone();
    let app_clone = app.clone();

    let result = tokio::task::spawn_blocking(move || {
        scan_folder(Path::new(&path_clone), db, &cache_dir, &app_clone)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.is_ok() {
        let intel_db = state.db.clone();
        let intel_path = path.clone();
        tokio::task::spawn_blocking(move || {
            let _ = folder_intel::refresh_folder_intel_for_root(&intel_db, &intel_path);
        })
        .await
        .ok();

        let rel_db = state.db.clone();
        let rel_path = path.clone();
        tokio::task::spawn_blocking(move || {
            let _ = relation_graph::refresh_relations_for_root(&rel_db, &rel_path);
        })
        .await
        .ok();
    }

    result
}

// ─── Asset detail ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_asset(id: String, state: State<'_, AppState>) -> Result<Option<Asset>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, file_path, file_name, extension, folder, modified_at, created_at,
                file_size, hash, thumbnail_path, favorite, indexed_at
         FROM assets WHERE id = ?1",
        params![id],
        |row| {
            Ok(Asset {
                id: row.get(0)?,
                file_path: row.get(1)?,
                file_name: row.get(2)?,
                extension: row.get(3)?,
                folder: row.get(4)?,
                modified_at: row.get(5)?,
                created_at: row.get(6)?,
                file_size: row.get(7)?,
                hash: row.get(8)?,
                thumbnail_path: row.get(9)?,
                favorite: row.get::<_, i32>(10)? != 0,
                indexed_at: row.get(11)?,
                tags: None,
            })
        },
    );
    match result {
        Ok(asset) => Ok(Some(asset)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn toggle_favorite(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current: i32 = conn
        .query_row(
            "SELECT favorite FROM assets WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let new_val = if current == 0 { 1 } else { 0 };
    conn.execute(
        "UPDATE assets SET favorite = ?1 WHERE id = ?2",
        params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val == 1)
}

#[tauri::command]
pub async fn get_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
        .unwrap_or(0);
    let favorites: i64 = conn
        .query_row("SELECT COUNT(*) FROM assets WHERE favorite = 1", [], |r| r.get(0))
        .unwrap_or(0);
    let folders: i64 = conn
        .query_row("SELECT COUNT(*) FROM watched_folders", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(serde_json::json!({
        "total_assets": total,
        "favorites": favorites,
        "watched_folders": folders,
    }))
}

#[tauri::command]
pub async fn remove_asset(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
