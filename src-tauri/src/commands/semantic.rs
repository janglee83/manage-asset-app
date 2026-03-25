//! CLIP/FAISS semantic search and embedding commands.

use tauri::State;
use serde_json::Value;
use crate::state::AppState;
use crate::sidecar::{EMBED_TIMEOUT, SEARCH_TIMEOUT};
use crate::models::{
    DesignQueryUnderstanding, EmbedBatchResult, EmbedEntry, ImageSearchQuery,
    IndexStats, SemanticHit, SemanticSearchQuery, SemanticSearchResult,
};

#[tauri::command]
pub async fn semantic_search(
    mut query: SemanticSearchQuery,
    state: State<'_, AppState>,
) -> Result<SemanticSearchResult, String> {
    tracing::debug!(query = %query.query, "semantic_search");
    let fav_ids: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM assets WHERE favorite = 1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);
        ids
    };
    query.favorite_ids = Some(fav_ids);

    let sidecar = super::get_sidecar(&state)?;
    let params = serde_json::to_value(&query).map_err(|e| e.to_string())?;
    let result = sidecar
        .call("search_semantic", params)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "semantic_search: sidecar call failed");
            e
        })?;
    let hits: Vec<SemanticHit> = serde_json::from_value(
        result.get("results").cloned().unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| e.to_string())?;
    let understanding: Option<DesignQueryUnderstanding> = result
        .get("understanding")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    if let Some(ref u) = understanding {
        tracing::debug!(expanded = %u.expanded_prompt, prompts = u.prompts.len(), "semantic_search: design terms expanded");
    }
    tracing::debug!(hits = hits.len(), "semantic_search: done");
    Ok(SemanticSearchResult { results: hits, understanding })
}

#[tauri::command]
pub async fn embed_asset(
    asset_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let sidecar = super::get_sidecar(&state)?;
    sidecar
        .call_with_timeout(
            "embed_asset",
            serde_json::json!({ "asset_id": asset_id, "file_path": file_path }),
            SEARCH_TIMEOUT,
        )
        .await
}

#[tauri::command]
pub async fn embed_batch(
    entries: Vec<EmbedEntry>,
    state: State<'_, AppState>,
) -> Result<EmbedBatchResult, String> {
    let sidecar = super::get_sidecar(&state)?;
    let params = serde_json::json!({ "entries": entries, "skip_indexed": true });
    let result = sidecar.call_with_timeout("embed_batch", params, EMBED_TIMEOUT).await?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rebuild_semantic_index(state: State<'_, AppState>) -> Result<Value, String> {
    let sidecar = super::get_sidecar(&state)?;
    sidecar.call("rebuild_index", serde_json::json!({})).await
}

/// Embed every asset in the library (skip_indexed=true — safe to call repeatedly).
#[tauri::command]
pub async fn embed_all_assets(state: State<'_, AppState>) -> Result<EmbedBatchResult, String> {
    let entries: Vec<EmbedEntry> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM assets ORDER BY indexed_at ASC")
            .map_err(|e| e.to_string())?;
        let rows: Vec<EmbedEntry> = stmt
            .query_map([], |row| {
                Ok(EmbedEntry {
                    asset_id: row.get(0)?,
                    file_path: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    if entries.is_empty() {
        return Ok(EmbedBatchResult { indexed: 0, skipped: 0, errors: vec![] });
    }

    let sidecar = super::get_sidecar(&state)?;
    let params = serde_json::json!({
        "entries":      entries,
        "skip_indexed": true,
        "batch_size":   32,
    });
    let result = sidecar.call_with_timeout("embed_batch", params, EMBED_TIMEOUT).await?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_semantic_stats(state: State<'_, AppState>) -> Result<IndexStats, String> {
    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call("get_index_stats", serde_json::json!({})).await?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

/// Visual similarity search: embed a query image through CLIP and find nearest
/// neighbours in the FAISS index.  The query image need not be in the library.
#[tauri::command]
pub async fn search_by_image(
    mut query: ImageSearchQuery,
    state: State<'_, AppState>,
) -> Result<SemanticSearchResult, String> {
    let fav_ids: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM assets WHERE favorite = 1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);
        ids
    };
    query.favorite_ids = Some(fav_ids);

    let sidecar = super::get_sidecar(&state)?;
    let params = serde_json::to_value(&query).map_err(|e| e.to_string())?;
    let result = sidecar
        .call_with_timeout("search_by_image", params, SEARCH_TIMEOUT)
        .await?;
    let hits: Vec<SemanticHit> = serde_json::from_value(
        result.get("results").cloned().unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| e.to_string())?;
    Ok(SemanticSearchResult { results: hits, understanding: None })
}
