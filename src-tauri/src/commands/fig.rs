//! .fig file metadata extraction commands.

use tauri::State;
use rusqlite::params;
use crate::state::AppState;
use crate::models::{FigMetadata, FigMetadataEntry};

/// Extract metadata from a local .fig file via the Python sidecar and persist
/// the result in `asset_fig_metadata` (upsert on re-extraction).
#[tauri::command]
pub async fn extract_fig_metadata(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<FigMetadata, String> {
    let file_path: String = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT file_path FROM assets WHERE id = ?1",
            params![asset_id],
            |row| row.get(0),
        )
        .map_err(|_| format!("Asset not found: {asset_id}"))?
    };

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar
        .call(
            "extract_fig_metadata",
            serde_json::json!({ "file_path": file_path }),
        )
        .await
        .map_err(|e| format!("Fig metadata sidecar call failed: {e}"))?;

    let meta: FigMetadata = serde_json::from_value(result).map_err(|e| e.to_string())?;

    {
        let pages_json = serde_json::to_string(&meta.pages).unwrap_or_default();
        let frames_json = serde_json::to_string(&meta.frame_names).unwrap_or_default();
        let components_json = serde_json::to_string(&meta.component_names).unwrap_or_default();
        let all_names_json = serde_json::to_string(&meta.all_names).unwrap_or_default();
        let is_valid: i32 = if meta.is_valid_fig { 1 } else { 0 };

        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.execute(
            "INSERT INTO asset_fig_metadata
                 (asset_id, pages_json, frames_json, components_json,
                  all_names_json, thumbnail_count, is_valid_fig, extracted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())
             ON CONFLICT(asset_id) DO UPDATE SET
                 pages_json      = excluded.pages_json,
                 frames_json     = excluded.frames_json,
                 components_json = excluded.components_json,
                 all_names_json  = excluded.all_names_json,
                 thumbnail_count = excluded.thumbnail_count,
                 is_valid_fig    = excluded.is_valid_fig,
                 extracted_at    = excluded.extracted_at",
            params![
                asset_id,
                pages_json,
                frames_json,
                components_json,
                all_names_json,
                meta.thumbnail_count,
                is_valid,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(meta)
}

/// Retrieve previously extracted .fig metadata for an asset from SQLite.
/// Returns `None` when no extraction has been run yet.
#[tauri::command]
pub async fn get_fig_metadata(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Option<FigMetadataEntry>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = db.query_row(
        "SELECT id, asset_id, pages_json, frames_json, components_json,
                all_names_json, thumbnail_count, is_valid_fig, confidence, extracted_at
         FROM asset_fig_metadata
         WHERE asset_id = ?1",
        params![asset_id],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, u32>(6)?,
                row.get::<_, i32>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
            ))
        },
    );

    match row {
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok((id, aid, pages_j, frames_j, components_j, all_j, thumb, valid, conf, ts)) => {
            let parse_arr = |s: &str| -> Vec<String> {
                serde_json::from_str(s).unwrap_or_default()
            };
            Ok(Some(FigMetadataEntry {
                id,
                asset_id: aid,
                pages: parse_arr(&pages_j),
                frame_names: parse_arr(&frames_j),
                component_names: parse_arr(&components_j),
                all_names: parse_arr(&all_j),
                thumbnail_count: thumb,
                is_valid_fig: valid != 0,
                confidence: conf,
                extracted_at: ts,
            }))
        }
    }
}
