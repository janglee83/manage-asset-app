//! Duplicate detection commands.

use tauri::State;
use rusqlite::params;
use crate::state::AppState;
use crate::models::{AssetHashEntry, DuplicateQuery, DuplicateResult, StoredDuplicatePair};

/// Run the full duplicate-detection pipeline (exact hash + CLIP visual similarity).
/// Results are upserted into `duplicate_pairs` and returned.
#[tauri::command]
pub async fn detect_duplicates(
    query: DuplicateQuery,
    state: State<'_, AppState>,
) -> Result<DuplicateResult, String> {
    let asset_hashes: Vec<AssetHashEntry> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, hash FROM assets")
            .map_err(|e| e.to_string())?;
        let entries: Vec<AssetHashEntry> = stmt
            .query_map([], |row| {
                Ok(AssetHashEntry {
                    asset_id: row.get::<_, String>(0)?,
                    hash: row.get::<_, Option<String>>(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);
        entries
    };

    let sidecar = super::get_sidecar(&state)?;
    let params = serde_json::json!({
        "asset_hashes":          asset_hashes,
        "similarity_threshold":  query.similarity_threshold.unwrap_or(0.92),
        "max_neighbours":        query.max_neighbours.unwrap_or(10),
        "skip_exact":            query.skip_exact.unwrap_or(false),
        "skip_similar":          query.skip_similar.unwrap_or(false),
    });
    let result = sidecar.call("detect_duplicates", params).await?;
    let dup_result: DuplicateResult =
        serde_json::from_value(result).map_err(|e| e.to_string())?;

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        for pair in dup_result.exact_pairs.iter().chain(dup_result.similar_pairs.iter()) {
            conn.execute(
                "INSERT OR IGNORE INTO duplicate_pairs
                 (asset_a, asset_b, dup_type, similarity)
                 VALUES (?1, ?2, ?3, ?4)",
                params![pair.asset_a, pair.asset_b, pair.dup_type, pair.similarity],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(dup_result)
}

/// Return all non-dismissed pairs, optionally filtered by `dup_type`.
#[tauri::command]
pub async fn get_duplicate_pairs(
    dup_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<StoredDuplicatePair>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let (sql, filter_type): (&str, bool) = match &dup_type {
        Some(_) => (
            "SELECT id, asset_a, asset_b, dup_type, similarity, detected_at, dismissed
             FROM duplicate_pairs
             WHERE dismissed = 0 AND dup_type = ?1
             ORDER BY similarity DESC",
            true,
        ),
        None => (
            "SELECT id, asset_a, asset_b, dup_type, similarity, detected_at, dismissed
             FROM duplicate_pairs
             WHERE dismissed = 0
             ORDER BY dup_type ASC, similarity DESC",
            false,
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let row_to_pair = |row: &rusqlite::Row| -> rusqlite::Result<StoredDuplicatePair> {
        Ok(StoredDuplicatePair {
            id: row.get(0)?,
            asset_a: row.get(1)?,
            asset_b: row.get(2)?,
            dup_type: row.get(3)?,
            similarity: row.get(4)?,
            detected_at: row.get(5)?,
            dismissed: row.get::<_, i32>(6)? != 0,
        })
    };

    let pairs: Vec<StoredDuplicatePair> = if filter_type {
        stmt.query_map(params![dup_type.unwrap()], row_to_pair)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    } else {
        stmt.query_map([], row_to_pair)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    Ok(pairs)
}

#[tauri::command]
pub async fn dismiss_duplicate(
    pair_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE duplicate_pairs SET dismissed = 1 WHERE id = ?1",
        params![pair_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
