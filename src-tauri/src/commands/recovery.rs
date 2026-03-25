//! Broken-path detection and recovery commands.

use tauri::State;
use crate::state::AppState;
use crate::models::Asset;

/// Detect assets whose stored `file_path` no longer exists on disk and
/// attempt to locate each file using hash, folder-probe, and name-similarity.
#[tauri::command]
pub async fn detect_broken_assets(
    state: State<'_, AppState>,
) -> Result<Vec<crate::recovery::BrokenAsset>, String> {
    let db = state.db.clone();
    let watched_folders: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path FROM watched_folders ORDER BY added_at ASC")
            .map_err(|e| e.to_string())?;
        let result: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    tokio::task::spawn_blocking(move || {
        let broken = crate::recovery::detect_broken_paths(db)?;
        Ok(crate::recovery::find_candidates(&broken, &watched_folders))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Apply a recovery decision: update `file_path` and all derived metadata in
/// SQLite, then return the refreshed `Asset` row.
#[tauri::command]
pub async fn apply_recovery(
    asset_id: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<Asset, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        crate::recovery::apply_recovery(db, &asset_id, &new_path)
    })
    .await
    .map_err(|e| e.to_string())?
}
