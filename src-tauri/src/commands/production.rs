//! Production feature commands: bulk-tag suggestion, palette clustering/search,
//! per-asset design style classification, and natural-language intent parsing.
//!
//! All heavy work is delegated to the Python sidecar.  Rust reads DB context,
//! the sidecar processes, and Rust writes results back — consistent with every
//! other command in this codebase.

use tauri::State;
use serde_json::Value;
use crate::state::AppState;
use crate::sidecar::{EMBED_TIMEOUT, SEARCH_TIMEOUT};
use crate::models::{
    BulkTagSuggestResult, BulkTagSuggestion,
    ClassifyAllStylesResult, StyleClassification, StyleScore,
    PaletteCluster, PaletteClusterResult, PaletteSearchHit, PaletteSearchResult,
    SearchIntent, IntentFilters,
};

/// Maximum number of assets exposed to the sidecar in a single context payload.
/// Prevents OOM on very large libraries while still covering typical usage.
const MAX_CONTEXT_ASSETS: usize = 50_000;
/// Hard cap on the number of asset IDs accepted per API call.
const MAX_ASSET_IDS: usize = 500;
/// Timeout for single-asset, fast sidecar calls (style classify, intent parse).
const FAST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// Timeout for batch classification/description that iterates over many assets.
/// Reuses EMBED_TIMEOUT (30 min) — same category of work as embedding pipelines.
use crate::sidecar::EMBED_TIMEOUT as BATCH_TIMEOUT;

// ── Bulk-tag suggestion ───────────────────────────────────────────────────────

/// Suggest tags for a set of target assets based on what tags their FAISS
/// neighbours own.  Only suggests tags that were voted on by at least
/// `min_votes` neighbours (default 2).
///
/// The sidecar receives the FAISS index directly (in-process state) so no
/// embeddings need to be transferred over the JSON RPC pipe.
#[tauri::command]
pub async fn suggest_bulk_tags(
    asset_ids: Vec<String>,
    top_k:     Option<i64>,
    min_votes: Option<i64>,
    state: State<'_, AppState>,
) -> Result<BulkTagSuggestResult, String> {
    if asset_ids.is_empty() {
        return Ok(BulkTagSuggestResult { suggestions: Default::default() });
    }
    if asset_ids.len() > MAX_ASSET_IDS {
        return Err(format!(
            "Too many asset IDs ({} > max {}). Split into smaller batches.",
            asset_ids.len(), MAX_ASSET_IDS
        ));
    }
    // Reject obviously malformed IDs (must be non-empty, no path separators).
    for id in &asset_ids {
        if id.trim().is_empty() || id.contains('/') || id.contains('\\') {
            return Err(format!("Invalid asset_id: {:?}", id));
        }
    }

    // Gather {asset_id → [tags]} for the surrounding context.
    // Limited to MAX_CONTEXT_ASSETS rows to prevent unbounded memory use.
    let assets_with_tags: serde_json::Value = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT a.id, \
                    COALESCE((SELECT json_group_array(t.tag) FROM asset_tags t \
                              WHERE t.asset_id = a.id), '[]') \
             FROM assets a \
             LIMIT ?1",
        ).map_err(|e| e.to_string())?;
        let map: serde_json::Map<String, Value> = stmt
            .query_map(rusqlite::params![MAX_CONTEXT_ASSETS as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter_map(|(id, tags_json)| {
                let tags: Vec<String> = serde_json::from_str(&tags_json).ok()?;
                Some((id, serde_json::Value::Array(
                    tags.into_iter().map(Value::String).collect()
                )))
            })
            .collect();
        drop(stmt);
        serde_json::Value::Object(map)
    };

    let k       = top_k.unwrap_or(8).clamp(1, 30);
    let votes   = min_votes.unwrap_or(2).clamp(1, 10);

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "suggest_bulk_tags",
        serde_json::json!({
            "asset_ids":       asset_ids,
            "assets_with_tags": assets_with_tags,
            "top_k":           k,
            "min_votes":       votes,
        }),
        EMBED_TIMEOUT,
    ).await?;

    let raw_suggestions: serde_json::Map<String, Value> = result
        .get("suggestions")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let suggestions = raw_suggestions.into_iter().filter_map(|(asset_id, arr)| {
        let tags: Vec<BulkTagSuggestion> = arr.as_array()?.iter().filter_map(|t| {
            Some(BulkTagSuggestion {
                tag:        t.get("tag")?.as_str()?.to_string(),
                votes:      t.get("votes")?.as_i64()? as i32,
                confidence: t.get("confidence")?.as_f64()? as f32,
            })
        }).collect();
        Some((asset_id, tags))
    }).collect();

    Ok(BulkTagSuggestResult { suggestions })
}

// ── Palette clustering ────────────────────────────────────────────────────────

/// Cluster all assets into palette groups by their dominant LAB colors.
/// Cluster IDs are persisted to `palette_clusters` + `asset_palette_cluster`.
/// Returns the cluster centroids and member counts.
#[tauri::command]
pub async fn cluster_palette(
    n_clusters: Option<i64>,
    state: State<'_, AppState>,
) -> Result<PaletteClusterResult, String> {
    // Collect {asset_id → [{hex, name, weight}]} for every asset that has tokens.
    let asset_color_map: serde_json::Value = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT asset_id, dominant_colors FROM asset_design_tokens \
             WHERE dominant_colors != '[]'",
        ).map_err(|e| e.to_string())?;
        let map: serde_json::Map<String, Value> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter_map(|(id, colors_json)| {
                let colors: Value = serde_json::from_str(&colors_json).ok()?;
                Some((id, colors))
            })
            .collect();
        drop(stmt);
        serde_json::Value::Object(map)
    };

    if asset_color_map.as_object().map(|m| m.is_empty()).unwrap_or(true) {
        return Ok(PaletteClusterResult { clusters: vec![] });
    }

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "cluster_by_palette",
        serde_json::json!({
            "asset_color_map": asset_color_map,
            "n_clusters":      n_clusters.unwrap_or(0),
        }),
        EMBED_TIMEOUT,
    ).await?;

    let raw_clusters: Vec<Value> = result
        .get("clusters")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Clear old clusters before inserting new ones.
    conn.execute("DELETE FROM asset_palette_cluster", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM palette_clusters", [])
        .map_err(|e| e.to_string())?;

    let mut clusters: Vec<PaletteCluster> = Vec::new();

    for c in &raw_clusters {
        let cluster_id = c.get("cluster_id")
            .and_then(Value::as_str).unwrap_or("").to_string();
        if cluster_id.is_empty() { continue; }

        let centroid: Vec<f32> = c.get("centroid")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let centroid_json = serde_json::to_string(&centroid).unwrap_or_default();

        conn.execute(
            "INSERT OR REPLACE INTO palette_clusters (id, centroid, created_at) \
             VALUES (?1, ?2, ?3)",
            rusqlite::params![cluster_id, centroid_json, now],
        ).map_err(|e| e.to_string())?;

        let member_ids: Vec<String> = c.get("asset_ids")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let member_count = member_ids.len() as i64;

        for asset_id in &member_ids {
            conn.execute(
                "INSERT OR REPLACE INTO asset_palette_cluster (asset_id, cluster_id) \
                 VALUES (?1, ?2)",
                rusqlite::params![asset_id, cluster_id],
            ).map_err(|e| e.to_string())?;
        }

        clusters.push(PaletteCluster { id: cluster_id, centroid, member_count });
    }

    Ok(PaletteClusterResult { clusters })
}

// ── Palette search ────────────────────────────────────────────────────────────

/// Find assets whose dominant palette most closely matches the query colors.
/// `query` may be a hex string ("#3B82F6"), a color name ("blue"), or a
/// comma-separated list of either.
#[tauri::command]
pub async fn search_by_palette(
    query:     String,
    top_k:     Option<i64>,
    min_score: Option<f32>,
    state: State<'_, AppState>,
) -> Result<PaletteSearchResult, String> {
    // Validate before any DB work.
    if query.trim().is_empty() {
        return Ok(PaletteSearchResult { results: vec![] });
    }
    if query.len() > 200 || query.contains('/') || query.contains('\\') {
        return Err("Invalid palette query: must be ≤ 200 chars, no path separators".to_string());
    }

    // Collect {asset_id → dominant_colors} for all assets.
    let asset_color_map: serde_json::Value = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT asset_id, dominant_colors FROM asset_design_tokens \
             WHERE dominant_colors != '[]'",
        ).map_err(|e| e.to_string())?;
        let map: serde_json::Map<String, Value> = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter_map(|(id, cj)| {
                let colors: Value = serde_json::from_str(&cj).ok()?;
                Some((id, colors))
            })
            .collect();
        drop(stmt);
        serde_json::Value::Object(map)
    };

    if asset_color_map.as_object().map(|m| m.is_empty()).unwrap_or(true) {
        return Ok(PaletteSearchResult { results: vec![] });
    }

    let k     = top_k.unwrap_or(20).clamp(1, 200);
    let min_s = min_score.unwrap_or(0.5_f32).clamp(0.0, 1.0);

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "search_by_palette",
        serde_json::json!({
            "query":           query,
            "asset_color_map": asset_color_map,
            "top_k":           k,
            "min_score":       min_s,
        }),
        SEARCH_TIMEOUT,
    ).await?;

    let raw: Vec<Value> = result
        .get("results")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let results: Vec<PaletteSearchHit> = raw.iter().filter_map(|r| {
        Some(PaletteSearchHit {
            asset_id: r.get("asset_id")?.as_str()?.to_string(),
            score:    r.get("score")?.as_f64()? as f32,
        })
    }).collect();

    Ok(PaletteSearchResult { results })
}

// ── Style classification ──────────────────────────────────────────────────────

/// Classify a single asset's design style (fintech / ecommerce / enterprise …).
/// Result is cached in `asset_styles` and returned immediately on repeat calls.
#[tauri::command]
pub async fn classify_asset_style(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<StyleClassification, String> {
    // Check cache.
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let cached: Option<(String, f64, String)> = conn.query_row(
            "SELECT style, confidence, all_styles FROM asset_styles WHERE asset_id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok();
        if let Some((style, confidence, all_json)) = cached {
            let all_styles: Vec<StyleScore> =
                serde_json::from_str(&all_json).unwrap_or_default();
            return Ok(StyleClassification {
                asset_id, style, confidence: confidence as f32, all_styles,
            });
        }
    }

    let (file_path, tags_json, colors_json): (String, String, Option<String>) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT a.file_path, \
                    COALESCE((SELECT json_group_array(t.tag) FROM asset_tags t \
                              WHERE t.asset_id = a.id), '[]'), \
                    (SELECT dominant_colors FROM asset_design_tokens dt \
                     WHERE dt.asset_id = a.id) \
             FROM assets a WHERE a.id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|_| format!("Asset {asset_id} not found"))?
    };

    let tags: Vec<String>   = serde_json::from_str(&tags_json).unwrap_or_default();
    let colors: Value       = colors_json.as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Array(vec![]));

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "classify_style",
        serde_json::json!({
            "asset_id":        asset_id,
            "file_path":       file_path,
            "tags":            tags,
            "dominant_colors": colors,
        }),
        FAST_TIMEOUT,
    ).await?;

    let style      = result.get("style").and_then(Value::as_str)
        .unwrap_or("unknown").to_string();
    let confidence = result.get("confidence").and_then(Value::as_f64).unwrap_or(0.0) as f32;
    let all_styles: Vec<StyleScore> = result
        .get("all_styles")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let signals_json = result.get("signals").cloned()
        .map(|s| serde_json::to_string(&s).unwrap_or_default())
        .unwrap_or_else(|| "{}".into());
    let all_json = serde_json::to_string(&all_styles).unwrap_or_default();

    let now = chrono::Utc::now().timestamp();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO asset_styles \
             (asset_id, style, confidence, all_styles, signals, classified_at) \
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![asset_id, style, confidence, all_json, signals_json, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(StyleClassification { asset_id, style, confidence, all_styles })
}

/// Classify all assets that have not been classified yet (or whose cached
/// classification is older than `max_age_days`, when provided).
/// Processes in batches of 100 to avoid sidecar timeout.
#[tauri::command]
pub async fn classify_all_styles(
    state: State<'_, AppState>,
) -> Result<ClassifyAllStylesResult, String> {
    const BATCH: usize = 100;

    let pending: Vec<(String, String, String, Option<String>)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT a.id, a.file_path, \
                    COALESCE((SELECT json_group_array(t.tag) FROM asset_tags t \
                              WHERE t.asset_id = a.id), '[]'), \
                    (SELECT dominant_colors FROM asset_design_tokens dt \
                     WHERE dt.asset_id = a.id) \
             FROM assets a \
             WHERE NOT EXISTS ( \
                 SELECT 1 FROM asset_styles s WHERE s.asset_id = a.id \
             ) \
             LIMIT 10000",
        ).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);
        rows
    };

    let total = pending.len();
    if total == 0 {
        return Ok(ClassifyAllStylesResult { classified: 0, total: 0 });
    }

    let sidecar = super::get_sidecar(&state)?;
    let mut classified = 0usize;

    for chunk in pending.chunks(BATCH) {
        let entries: Vec<Value> = chunk.iter().map(|(id, fp, tags_json, colors_json)| {
            let tags: Vec<String> = serde_json::from_str(tags_json).unwrap_or_default();
            let colors: Value = colors_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(Value::Array(vec![]));
            serde_json::json!({
                "asset_id":        id,
                "file_path":       fp,
                "tags":            tags,
                "dominant_colors": colors,
            })
        }).collect();

        let result = sidecar.call_with_timeout(
            "classify_style_batch",
            serde_json::json!({ "entries": entries }),
            BATCH_TIMEOUT,
        ).await;

        let result = match result {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, "classify_all_styles: batch failed, continuing");
                continue;
            }
        };

        let results: Vec<Value> = result
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let now = chrono::Utc::now().timestamp();
        if let Ok(conn) = state.db.lock() {
            for r in &results {
                let asset_id = r.get("asset_id").and_then(Value::as_str).unwrap_or("");
                if asset_id.is_empty() { continue; }
                let style = r.get("style").and_then(Value::as_str).unwrap_or("unknown");
                let confidence = r.get("confidence").and_then(Value::as_f64).unwrap_or(0.0);
                let all_json = r.get("all_styles")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_else(|| "[]".into());
                let signals_json = r.get("signals")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_else(|| "{}".into());
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO asset_styles \
                     (asset_id, style, confidence, all_styles, signals, classified_at) \
                     VALUES (?1,?2,?3,?4,?5,?6)",
                    rusqlite::params![asset_id, style, confidence, all_json, signals_json, now],
                );
                classified += 1;
            }
        }
    }

    Ok(ClassifyAllStylesResult { classified, total })
}

/// Return the cached style classification for an asset, or None if not yet classified.
#[tauri::command]
pub async fn get_asset_style(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Option<StyleClassification>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, f64, String)> = conn.query_row(
        "SELECT style, confidence, all_styles FROM asset_styles WHERE asset_id = ?1",
        rusqlite::params![asset_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).ok();

    match row {
        None => Ok(None),
        Some((style, confidence, all_json)) => {
            let all_styles: Vec<StyleScore> = serde_json::from_str(&all_json).unwrap_or_default();
            Ok(Some(StyleClassification { asset_id, style, confidence: confidence as f32, all_styles }))
        }
    }
}

// ── Natural-language intent parsing ──────────────────────────────────────────

/// Parse a natural-language query into structured search filters.
/// Example: "show latest blue mobile dashboard" →
///   { semantic_query: "mobile dashboard", filters: { colors: ["blue"], sort_by: "newest", platform: "mobile" } }
///
/// The result is purely computed (not cached) so it is always fresh.
#[tauri::command]
pub async fn parse_search_intent(
    query: String,
    state: State<'_, AppState>,
) -> Result<SearchIntent, String> {
    if query.trim().is_empty() {
        return Ok(SearchIntent {
            semantic_query: String::new(),
            original_query: query,
            filters: IntentFilters {
                sort_by: "relevance".into(),
                ..Default::default()
            },
            confidence: 1.0,
            parsed_terms: vec![],
        });
    }

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "parse_intent",
        serde_json::json!({ "query": query }),
        FAST_TIMEOUT,
    ).await?;

    let semantic_query = result.get("semantic_query")
        .and_then(Value::as_str).unwrap_or(&query).to_string();
    let original_query = result.get("original_query")
        .and_then(Value::as_str).unwrap_or(&query).to_string();
    let confidence = result.get("confidence")
        .and_then(Value::as_f64).unwrap_or(0.5) as f32;
    let parsed_terms: Vec<String> = result
        .get("parsed_terms")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let filters_raw = result.get("filters").cloned().unwrap_or(Value::Object(Default::default()));

    let filters = IntentFilters {
        date_from:   filters_raw.get("date_range")
            .and_then(|dr| dr.get("from")).and_then(Value::as_i64),
        date_to:     filters_raw.get("date_range")
            .and_then(|dr| dr.get("to")).and_then(Value::as_i64),
        sort_by:     filters_raw.get("sort_by")
            .and_then(Value::as_str).unwrap_or("relevance").to_string(),
        colors:      filters_raw.get("colors")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        style:       filters_raw.get("style")
            .and_then(Value::as_str).map(|s| s.to_string()),
        platform:    filters_raw.get("platform")
            .and_then(Value::as_str).map(|s| s.to_string()),
        folder_hint: filters_raw.get("folder_hint")
            .and_then(Value::as_str).map(|s| s.to_string()),
        extensions:  filters_raw.get("extensions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
    };

    Ok(SearchIntent { semantic_query, original_query, filters, confidence, parsed_terms })
}
