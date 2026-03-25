//! Thumbnail generation and retrieval commands.

use tauri::State;
use rusqlite::params;
use crate::state::AppState;
use crate::thumbnail::{generate_thumbnail, thumbnail_as_base64};

#[tauri::command]
pub async fn get_thumbnail(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
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

    match thumb_opt {
        Some(thumb_path) => {
            let path = std::path::Path::new(&thumb_path);
            if path.exists() {
                return Ok(thumbnail_as_base64(path));
            }
            Ok(None)
        }
        None => {
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

/// Fetch or generate thumbnails for multiple assets in a single round-trip.
///
/// Returns a map of `{ asset_id → "data:image/jpeg;base64,…" }`.
/// IDs that can't be thumbnailed are silently omitted.
#[tauri::command]
pub async fn get_thumbnails_batch(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    if ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let placeholders: String = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");

    let sql = format!(
        "SELECT id, thumbnail_path, file_path \
         FROM assets WHERE id IN ({placeholders})"
    );

    let rows: Vec<(String, Option<String>, String)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let bind: Vec<&dyn rusqlite::ToSql> = ids.iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        let result: Vec<_> = stmt
            .query_map(bind.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let cache_dir = state.cache_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;
        rows.into_par_iter()
            .filter_map(|(id, thumb_opt, file_path)| {
                if let Some(ref tp) = thumb_opt {
                    let p = std::path::Path::new(tp);
                    if p.exists() {
                        return thumbnail_as_base64(p).map(|b64| (id, b64));
                    }
                }
                let fp = std::path::PathBuf::from(&file_path);
                generate_thumbnail(&fp, &cache_dir)
                    .and_then(|tp| thumbnail_as_base64(&tp))
                    .map(|b64| (id, b64))
            })
            .collect::<std::collections::HashMap<String, String>>()
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}
