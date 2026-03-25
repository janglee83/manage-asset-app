//! Asset auto-tagging and manual tag management commands.

use tauri::{AppHandle, Emitter, State};
use rusqlite::params;
use serde_json::{json, Value};
use crate::sidecar::EMBED_TIMEOUT;
use crate::state::AppState;
use crate::models::{AutoTagQuery, AutoTagResult, TagEntry, TagSuggestion};

/// Run the Python CLIP zero-shot tagger on one asset.
#[tauri::command]
pub async fn auto_tag_asset(
    query: AutoTagQuery,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<AutoTagResult, String> {
    let sidecar = super::get_sidecar(&state)?;

    let resp = sidecar
        .call(
            "tag_asset",
            serde_json::json!({
                "file_path": query.file_path,
                "top_k":     query.top_k.unwrap_or(8),
                "threshold": query.threshold.unwrap_or(0.22),
            }),
        )
        .await
        .map_err(|e| e.to_string())?;

    let tags: Vec<TagSuggestion> = resp["tags"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|t| {
            let tag = t["tag"].as_str()?.to_string();
            let score = t["score"].as_f64()? as f32;
            Some(TagSuggestion { tag, score })
        })
        .collect();

    let mut saved: Vec<String> = Vec::new();
    if query.save.unwrap_or(false) && !tags.is_empty() {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for ts in &tags {
            let result = conn.execute(
                "INSERT OR IGNORE INTO tags (asset_id, tag, source) VALUES (?1, ?2, 'ai')",
                params![query.asset_id, ts.tag],
            );
            if result.map(|n| n > 0).unwrap_or(false) {
                saved.push(ts.tag.clone());
            }
        }
    }

    Ok(AutoTagResult {
        asset_id: query.asset_id,
        tags,
        saved,
    })
}

#[tauri::command]
pub async fn get_asset_tags(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TagEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, tag, source FROM tags WHERE asset_id = ?1 ORDER BY tag")
        .map_err(|e| e.to_string())?;
    let entries: Vec<TagEntry> = stmt
        .query_map(params![asset_id], |row| {
            Ok(TagEntry {
                id: row.get(0)?,
                tag: row.get(1)?,
                source: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn add_tag(
    asset_id: String,
    tag: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let trimmed = tag.trim().to_string();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return Err("Invalid tag: must be 1-100 non-whitespace characters.".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO tags (asset_id, tag, source) VALUES (?1, ?2, 'user')",
        params![asset_id, trimmed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_tag(
    asset_id: String,
    tag: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM tags WHERE asset_id = ?1 AND tag = ?2",
        params![asset_id, tag],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Bulk background auto-tagging ──────────────────────────────────────────────

/// Auto-tag every image asset that does not yet have an AI-generated tag.
///
/// Designed as a fire-and-forget task called by the frontend after a scan:
///   - Fetches all un-tagged image assets in one DB query
///   - Sends them to the Python CLIP tagger in batches of 32 (efficient batched
///     image encoding — one forward pass per batch instead of N passes)
///   - Saves accepted tags to SQLite with `source = 'ai'`
///   - Emits `auto_tag_progress` events so the UI can show a progress bar
///
/// Already-tagged assets are skipped, so this is safe to call repeatedly.
#[tauri::command]
pub async fn auto_tag_new_assets(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    // Image extensions that the CLIP tagger can process (raster/vector images).
    const IMAGE_EXTS: &[&str] = &[
        "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "heic", "heif", "avif",
    ];

    // Build SQL IN clause dynamically from the extension list.
    let placeholders = IMAGE_EXTS
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT a.id, a.file_path FROM assets a \
         WHERE LOWER(a.extension) IN ({placeholders}) \
         AND NOT EXISTS ( \
             SELECT 1 FROM tags t WHERE t.asset_id = a.id AND t.source = 'ai' \
         ) \
         ORDER BY a.indexed_at ASC"
    );

    // Collect entries without holding the lock during async work.
    let entries: Vec<Value> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

        // rusqlite requires &dyn ToSql refs — build them from the static strs.
        let param_values: Vec<&dyn rusqlite::types::ToSql> =
            IMAGE_EXTS.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();

        let collected: Vec<Value> = stmt.query_map(param_values.as_slice(), |row| {
            Ok(json!({
                "asset_id":  row.get::<_, String>(0)?,
                "file_path": row.get::<_, String>(1)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        drop(stmt);
        drop(conn);
        collected
    };

    if entries.is_empty() {
        let _ = app.emit("auto_tag_progress", json!({"done": 0, "total": 0, "finished": true}));
        return Ok(json!({"tagged": 0, "skipped": 0, "errors": []}));
    }

    let total = entries.len();
    let sidecar = super::get_sidecar(&state)?;

    const BATCH: usize = 32;
    let mut tagged = 0usize;
    let mut all_errors: Vec<String> = Vec::new();
    let mut done_so_far = 0usize;

    for chunk in entries.chunks(BATCH) {
        let params_val = json!({
            "entries":   chunk,
            "top_k":     8,
            "threshold": 0.22,
        });

        let result = match sidecar
            .call_with_timeout("tag_batch", params_val, EMBED_TIMEOUT)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                all_errors.push(format!("batch error: {e}"));
                break;
            }
        };

        let results_arr = result
            .get("results")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // Save accepted tags — re-acquire DB lock only for the write.
        {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            for item in &results_arr {
                let asset_id = item["asset_id"].as_str().unwrap_or_default();
                if asset_id.is_empty() {
                    continue;
                }
                if let Some(err_msg) = item["error"].as_str().filter(|e| !e.is_empty()) {
                    all_errors.push(format!("{asset_id}: {err_msg}"));
                    continue;
                }
                if let Some(tags_arr) = item["tags"].as_array() {
                    let mut inserted = 0usize;
                    for tag_obj in tags_arr {
                        if let Some(tag) = tag_obj["tag"].as_str().filter(|t| !t.is_empty()) {
                            if conn
                                .execute(
                                    "INSERT OR IGNORE INTO tags (asset_id, tag, source) \
                                     VALUES (?1, ?2, 'ai')",
                                    params![asset_id, tag],
                                )
                                .map(|n| n > 0)
                                .unwrap_or(false)
                            {
                                inserted += 1;
                            }
                        }
                    }
                    if inserted > 0 {
                        tagged += 1;
                    }
                }
            }
        }

        done_so_far += chunk.len();
        let _ = app.emit(
            "auto_tag_progress",
            json!({"done": done_so_far, "total": total, "finished": false}),
        );
    }

    let _ = app.emit(
        "auto_tag_progress",
        json!({"done": total, "total": total, "finished": true, "tagged": tagged}),
    );

    Ok(json!({
        "tagged":  tagged,
        "skipped": 0,
        "errors":  all_errors,
    }))
}
