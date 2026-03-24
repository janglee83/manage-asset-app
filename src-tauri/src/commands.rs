use std::path::Path;
use tauri::{AppHandle, State};
use rusqlite::params;
use crate::state::AppState;
use crate::models::{Asset, SearchQuery, SearchResult, ScanResult, WatchedFolder};
use crate::scanner::{scan_folder, add_watched_folder};
use crate::search::search_assets;
use crate::thumbnail::{generate_thumbnail, thumbnail_as_base64};
use crate::watcher;

// ──────────────────────────────────────────────
// Folder management
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn add_folder(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ScanResult, String> {
    let folder_path = Path::new(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("Folder does not exist: {}", path));
    }

    add_watched_folder(state.db.clone(), &path).map_err(|e| e.to_string())?;

    // Ensure watcher is running and watching this new path.
    {
        let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(handle) => handle.add_path(folder_path),
            None => {
                // First folder ever: spin up the watcher.
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

    tokio::task::spawn_blocking(move || {
        scan_folder(Path::new(&path_clone), db, &cache_dir, &app_clone)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    // Tell the watcher to stop watching this path before we delete DB rows.
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
    // Remove assets from that folder
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

    tokio::task::spawn_blocking(move || {
        scan_folder(Path::new(&path_clone), db, &cache_dir, &app_clone)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn search(
    query: SearchQuery,
    state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    search_assets(state.db.clone(), query)
}

// ──────────────────────────────────────────────
// Asset detail
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn get_asset(id: String, state: State<'_, AppState>) -> Result<Option<Asset>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT id, file_path, file_name, extension, folder, modified_at, created_at, file_size, hash, thumbnail_path, favorite, indexed_at
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

// ──────────────────────────────────────────────
// Thumbnail
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn get_thumbnail(id: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    // Extract what we need while holding the lock, then drop it before any await
    let (thumb_opt, file_path) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let row: Result<(Option<String>, String), _> = conn.query_row(
            "SELECT thumbnail_path, file_path FROM assets WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        match row {
            Ok(r) => r,
            Err(_) => return Ok(None),
        }
    };
    // Lock is dropped here

    match thumb_opt {
        Some(thumb_path) => {
            let path = std::path::Path::new(&thumb_path);
            if path.exists() {
                return Ok(thumbnail_as_base64(path));
            }
            Ok(None)
        }
        None => {
            // Generate on demand
            let cache_dir = state.cache_dir.clone();
            let file_p = std::path::PathBuf::from(&file_path);
            let result = tokio::task::spawn_blocking(move || {
                generate_thumbnail(&file_p, &cache_dir)
            })
            .await
            .map_err(|e| e.to_string())?;

            if let Some(thumb_path) = result {
                let thumb_str = thumb_path.to_string_lossy().to_string();
                {
                    let conn = state.db.lock().map_err(|e| e.to_string())?;
                    let _ = conn.execute(
                        "UPDATE assets SET thumbnail_path = ?1 WHERE id = ?2",
                        params![thumb_str, id],
                    );
                }
                return Ok(thumbnail_as_base64(&thumb_path));
            }
            Ok(None)
        }
    }
}

// ──────────────────────────────────────────────
// Open file natively
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_explorer(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(&["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(&["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let folder = file_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ──────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// Delete asset from index (not from disk)
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn remove_asset(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
