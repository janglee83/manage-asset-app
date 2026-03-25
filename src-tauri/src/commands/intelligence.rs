//! Intelligence layer Tauri commands.
//!
//! Each command delegates to the Python sidecar, then persists results in SQLite.
//! Design: Rust reads DB context, sidecar processes, Rust writes results back.

use std::collections::HashMap;
use tauri::State;
use serde_json::Value;
use crate::state::AppState;
use crate::sidecar::{EMBED_TIMEOUT, SEARCH_TIMEOUT};
use crate::models::{
    AssetDescription, BuildFamiliesResult, ComponentFamily, ConfidenceResult,
    ConfidenceSignals, DesignTokens, DetectVersionsResult, DominantColor,
    FamilyMember, LayoutSignature, QueryRewrite, Recommendation,
    RecommendationResult, TypographyZone, VersionChain, VersionEntry,
};

// ── Timeout for long-running intelligence calls ───────────────────────────────
const INTEL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

// ── Helper: sha256 hex of a string ───────────────────────────────────────────
fn hash_query(query: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    query.hash(&mut h);
    format!("{:x}", h.finish())
}

// ── Design tokens ─────────────────────────────────────────────────────────────

/// Analyse design tokens (colors, typography, spacing) for an asset.
/// Results are cached in `asset_design_tokens`.
#[tauri::command]
pub async fn analyze_design_tokens(
    asset_id:  String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<DesignTokens, String> {
    // Check cache
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let cached: Option<(String, String, String)> = conn.query_row(
            "SELECT dominant_colors, typography_zones, spacing_class \
             FROM asset_design_tokens WHERE asset_id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok();
        if let Some((colors_json, zones_json, spacing)) = cached {
            let dominant_colors: Vec<DominantColor> =
                serde_json::from_str(&colors_json).unwrap_or_default();
            let typography_zones: Vec<TypographyZone> =
                serde_json::from_str(&zones_json).unwrap_or_default();
            return Ok(DesignTokens { asset_id, dominant_colors, typography_zones,
                                     spacing_class: spacing });
        }
    }

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "analyze_design_tokens",
        serde_json::json!({ "asset_id": asset_id, "file_path": file_path }),
        INTEL_TIMEOUT,
    ).await?;

    if result.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(result.get("error")
            .and_then(Value::as_str).unwrap_or("unknown").to_string());
    }

    let dominant_colors: Vec<DominantColor> = result
        .get("dominant_colors")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let typography_zones: Vec<TypographyZone> = result
        .get("typography_zones")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let spacing_class = result
        .get("spacing_class")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let colors_json  = serde_json::to_string(&dominant_colors).unwrap_or_default();
    let zones_json   = serde_json::to_string(&typography_zones).unwrap_or_default();
    let now = chrono::Utc::now().timestamp();

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO asset_design_tokens \
             (asset_id, dominant_colors, typography_zones, spacing_class, analyzed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![asset_id, colors_json, zones_json, spacing_class, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(DesignTokens { asset_id, dominant_colors, typography_zones, spacing_class })
}

// ── Layout analysis ───────────────────────────────────────────────────────────

/// Extract a color-agnostic structural layout fingerprint for an asset.
#[tauri::command]
pub async fn analyze_layout(
    asset_id:  String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<LayoutSignature, String> {
    // Check cache
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let cached: Option<(f64, String, String, String)> = conn.query_row(
            "SELECT aspect_ratio, layout_fingerprint, region_complexity, layout_class \
             FROM asset_layout_signature WHERE asset_id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).ok();
        if let Some((ar, fp_json, rc_json, lc)) = cached {
            let layout_fingerprint: Vec<f32> =
                serde_json::from_str(&fp_json).unwrap_or_default();
            let region_complexity: Value =
                serde_json::from_str(&rc_json).unwrap_or(Value::Object(Default::default()));
            return Ok(LayoutSignature {
                asset_id, aspect_ratio: ar as f32, layout_fingerprint,
                region_complexity, layout_class: lc,
            });
        }
    }

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "analyze_layout",
        serde_json::json!({ "asset_id": asset_id, "file_path": file_path }),
        INTEL_TIMEOUT,
    ).await?;

    if result.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(result.get("error")
            .and_then(Value::as_str).unwrap_or("unknown").to_string());
    }

    let aspect_ratio = result.get("aspect_ratio")
        .and_then(Value::as_f64).unwrap_or(1.0) as f32;
    let layout_fingerprint: Vec<f32> = result
        .get("layout_fingerprint")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let region_complexity = result
        .get("region_complexity").cloned()
        .unwrap_or(Value::Object(Default::default()));
    let layout_class = result
        .get("layout_class").and_then(Value::as_str)
        .unwrap_or("unknown").to_string();

    let fp_json = serde_json::to_string(&layout_fingerprint).unwrap_or_default();
    let rc_json = serde_json::to_string(&region_complexity).unwrap_or_default();
    let now = chrono::Utc::now().timestamp();

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO asset_layout_signature \
             (asset_id, aspect_ratio, layout_fingerprint, region_complexity, layout_class, analyzed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![asset_id, aspect_ratio, fp_json, rc_json, layout_class, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(LayoutSignature { asset_id, aspect_ratio, layout_fingerprint, region_complexity, layout_class })
}

// ── Recommendations ───────────────────────────────────────────────────────────

/// Return visually similar assets for a given asset_id.
#[tauri::command]
pub async fn get_recommendations(
    asset_id: String,
    top_k:    Option<i64>,
    state: State<'_, AppState>,
) -> Result<RecommendationResult, String> {
    let k = top_k.unwrap_or(8).min(20) as i64;
    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "get_similar_assets",
        serde_json::json!({ "asset_id": asset_id, "top_k": k }),
        SEARCH_TIMEOUT,
    ).await?;

    let raw_results: Vec<Value> = result
        .get("results")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let similar_assets: Vec<Recommendation> = raw_results.iter().map(|r| {
        Recommendation {
            asset_id: r.get("asset_id").and_then(Value::as_str)
                       .unwrap_or("").to_string(),
            score:    r.get("ranked_score").or_else(|| r.get("score"))
                       .and_then(Value::as_f64).unwrap_or(0.0) as f32,
            reason:   "visually similar".to_string(),
        }
    }).collect();

    Ok(RecommendationResult { asset_id, similar_assets })
}

// ── Description generation ────────────────────────────────────────────────────

/// Get or generate a human-readable description for an asset.
#[tauri::command]
pub async fn get_or_generate_description(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<AssetDescription, String> {
    // Check cache
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let cached: Option<(String, f64)> = conn.query_row(
            "SELECT description, confidence FROM asset_descriptions WHERE asset_id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();
        if let Some((description, confidence)) = cached {
            if !description.is_empty() {
                return Ok(AssetDescription {
                    asset_id, description, confidence: confidence as f32, from_cache: true,
                });
            }
        }
    }

    // Fetch asset data from DB
    let (file_path, tags_json): (String, String) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let asset_row: Option<(String, Option<String>)> = conn.query_row(
            "SELECT a.file_path, \
                    (SELECT json_group_array(t.tag) FROM asset_tags t WHERE t.asset_id = a.id) \
             FROM assets a WHERE a.id = ?1",
            rusqlite::params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();
        match asset_row {
            Some((fp, tags)) => (fp, tags.unwrap_or_else(|| "[]".into())),
            None => return Err(format!("Asset {asset_id} not found")),
        }
    };

    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

    // Fetch cached design tokens for color context
    let color_data: Value = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT dominant_colors FROM asset_design_tokens WHERE asset_id = ?1",
            rusqlite::params![asset_id],
            |row| row.get::<_, String>(0),
        ).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Array(vec![]))
    };

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "generate_description",
        serde_json::json!({
            "asset_id":   asset_id,
            "file_path":  file_path,
            "tags":       tags,
            "color_data": { "dominant_colors": color_data },
        }),
        INTEL_TIMEOUT,
    ).await?;

    let description = result.get("description")
        .and_then(Value::as_str).unwrap_or("").to_string();
    let confidence = result.get("confidence")
        .and_then(Value::as_f64).unwrap_or(0.0) as f32;
    let now = chrono::Utc::now().timestamp();

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO asset_descriptions \
             (asset_id, description, confidence, generated_at) VALUES (?1,?2,?3,?4)",
            rusqlite::params![asset_id, description, confidence, now],
        ).map_err(|e| e.to_string())?;
    }

    Ok(AssetDescription { asset_id, description, confidence, from_cache: false })
}

// ── Component families ─────────────────────────────────────────────────────────

/// Build component family clusters from all indexed assets.
#[tauri::command]
pub async fn build_component_families(
    state: State<'_, AppState>,
) -> Result<BuildFamiliesResult, String> {
    // Gather all assets: {id -> file_name} and {id -> [tags]}
    let (asset_names, asset_tags): (HashMap<String, String>, HashMap<String, Vec<String>>) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT a.id, a.file_name, \
                    (SELECT json_group_array(t.tag) FROM asset_tags t WHERE t.asset_id = a.id) \
             FROM assets a"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        drop(conn);
        let names: HashMap<_, _> = rows.iter()
            .map(|(id, name, _)| (id.clone(), name.clone())).collect();
        let tags: HashMap<_, _> = rows.iter()
            .map(|(id, _, tj)| {
                let t = tj.as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                (id.clone(), t)
            }).collect();
        (names, tags)
    };

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "build_component_families",
        serde_json::json!({ "asset_names": asset_names, "asset_tags": asset_tags }),
        INTEL_TIMEOUT,
    ).await?;

    let families_raw: Vec<Value> = result
        .get("families")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp();
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut families: Vec<ComponentFamily> = Vec::new();

    for fam in &families_raw {
        let fam_id   = fam.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let fam_name = fam.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let archetype: Option<String> = fam.get("archetype_id")
            .and_then(Value::as_str).map(|s| s.to_string());
        let tags_summary = fam.get("tags_summary").cloned().unwrap_or(Value::Array(vec![]));
        let tags_json = serde_json::to_string(&tags_summary).unwrap_or_default();
        let members_raw: Vec<Value> = fam.get("members")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        conn.execute(
            "INSERT OR REPLACE INTO component_families \
             (id, name, archetype_id, member_count, tags_summary, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![fam_id, fam_name, archetype, members_raw.len() as i64,
                              tags_json, now],
        ).map_err(|e| e.to_string())?;

        let mut members: Vec<FamilyMember> = Vec::new();
        for m in &members_raw {
            let aid  = m.get("asset_id").and_then(Value::as_str).unwrap_or("").to_string();
            let role = m.get("role").and_then(Value::as_str).unwrap_or("member").to_string();
            let conf = m.get("confidence").and_then(Value::as_f64).unwrap_or(1.0) as f32;
            conn.execute(
                "INSERT OR REPLACE INTO asset_component_family \
                 (asset_id, family_id, role, confidence) VALUES (?1,?2,?3,?4)",
                rusqlite::params![aid, fam_id, role, conf],
            ).map_err(|e| e.to_string())?;
            members.push(FamilyMember { asset_id: aid, role, confidence: conf });
        }
        families.push(ComponentFamily {
            id: fam_id, name: fam_name, archetype_id: archetype, members,
        });
    }

    let total_assets: usize = families.iter().map(|f| f.members.len()).sum();
    Ok(BuildFamiliesResult {
        total_families: families.len(),
        total_assets,
        families,
    })
}

// ── Version chains ────────────────────────────────────────────────────────────

/// Detect version chains across all assets (filename + visual similarity).
#[tauri::command]
pub async fn detect_version_chains(
    state: State<'_, AppState>,
) -> Result<DetectVersionsResult, String> {
    // Read all assets
    let asset_list: Vec<Value> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, folder, modified_at FROM assets"
        ).map_err(|e| e.to_string())?;
        let list: Vec<Value> = stmt.query_map([], |row| {
            let id:     String = row.get(0)?;
            let name:   String = row.get(1)?;
            let folder: String = row.get(2)?;
            let mtime:  i64    = row.get(3)?;
            Ok(serde_json::json!({
                "id": id, "file_name": name, "folder": folder, "modified_at": mtime
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        drop(stmt);
        drop(conn);
        list
    };

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "detect_version_chains",
        serde_json::json!({ "assets": asset_list }),
        INTEL_TIMEOUT,
    ).await?;

    let chains_raw: Vec<Value> = result
        .get("chains")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let chains: Vec<VersionChain> = chains_raw.iter().filter_map(|c| {
        let chain_key = c.get("chain_key")?.as_str()?.to_string();
        let latest    = c.get("latest_asset_id")?.as_str()?.to_string();
        let oldest    = c.get("oldest_asset_id").and_then(Value::as_str)
                        .unwrap_or("").to_string();
        let versions: Vec<VersionEntry> = c.get("versions")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        Some(VersionChain { chain_key, versions, latest_asset_id: latest, oldest_asset_id: oldest })
    }).collect();

    Ok(DetectVersionsResult { total: chains.len(), chains })
}

// ── Query rewriting ───────────────────────────────────────────────────────────

/// Rewrite a natural-language query into an CLIP-optimised prompt.
/// Result is cached in `query_rewrites`.
#[tauri::command]
pub async fn rewrite_query(
    query: String,
    state: State<'_, AppState>,
) -> Result<QueryRewrite, String> {
    let hash = hash_query(&query);

    // Check cache
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let cached: Option<(String, f64)> = conn.query_row(
            "SELECT rewritten, confidence FROM query_rewrites WHERE query_hash = ?1",
            rusqlite::params![hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok();
        if let Some((rewritten, confidence)) = cached {
            conn.execute(
                "UPDATE query_rewrites SET hit_count = hit_count + 1, \
                 used_at = unixepoch() WHERE query_hash = ?1",
                rusqlite::params![hash],
            ).ok();
            return Ok(QueryRewrite {
                original: query, rewritten, confidence: confidence as f32, from_cache: true,
            });
        }
    }

    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar.call_with_timeout(
        "rewrite_query",
        serde_json::json!({ "query": query }),
        SEARCH_TIMEOUT,
    ).await?;

    let rewritten  = result.get("rewritten").and_then(Value::as_str).unwrap_or(&query).to_string();
    let confidence = result.get("confidence").and_then(Value::as_f64).unwrap_or(0.5) as f32;

    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO query_rewrites \
             (query_hash, original, rewritten, confidence, hit_count) VALUES (?1,?2,?3,?4,1)",
            rusqlite::params![hash, query, rewritten, confidence],
        ).map_err(|e| e.to_string())?;
    }

    Ok(QueryRewrite { original: query, rewritten, confidence, from_cache: false })
}

// ── Search interaction recording ──────────────────────────────────────────────

/// Record a user interaction (click / favorite / copy) with a search result.
#[tauri::command]
pub async fn record_search_interaction(
    query:            String,
    asset_id:         String,
    interaction_type: String,
    semantic_score:   f32,
    session_key:      String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let hash = hash_query(&query);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO search_interactions \
         (query, query_hash, asset_id, interaction_type, semantic_score, session_key) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![query, hash, asset_id, interaction_type, semantic_score, session_key],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Confidence breakdown ──────────────────────────────────────────────────────

/// Return a 0–100 confidence score for a specific (query, asset) pair.
#[tauri::command]
pub async fn get_confidence_breakdown(
    asset_id:       String,
    query:          String,
    semantic_score: f32,
    state: State<'_, AppState>,
) -> Result<ConfidenceResult, String> {
    let query_hash = hash_query(&query);

    // Behavior score: how many times was this asset clicked for this query?
    let behavior_score: f32 = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM search_interactions \
             WHERE query_hash = ?1 AND asset_id = ?2 AND interaction_type = 'click'",
            rusqlite::params![query_hash, asset_id],
            |r| r.get(0),
        ).unwrap_or(0);
        (count as f32 / 5.0).min(1.0)
    };

    let sidecar = super::get_sidecar(&state)?;
    let interaction_scores = serde_json::json!({ (asset_id.clone()): behavior_score });
    let result = sidecar.call_with_timeout(
        "score_results",
        serde_json::json!({
            "query": query,
            "interaction_scores": interaction_scores,
            "results": [{ "asset_id": asset_id.clone(), "score": semantic_score }],
        }),
        SEARCH_TIMEOUT,
    ).await?;

    let enriched: Vec<Value> = result
        .get("results")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if let Some(first) = enriched.first() {
        let score   = first.get("confidence_score").and_then(Value::as_i64).unwrap_or(0) as i32;
        let label   = first.get("confidence_label")
            .and_then(Value::as_str).unwrap_or("low").to_string();
        let signals = first.get("confidence_signals")
            .and_then(|s| {
                let se = s.get("semantic").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let kw = s.get("keyword").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let bh = s.get("behavior").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let de = s.get("design").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                let fo = s.get("folder").and_then(Value::as_f64).unwrap_or(0.0) as f32;
                Some(ConfidenceSignals { semantic: se, keyword: kw, behavior: bh, design: de, folder: fo })
            })
            .unwrap_or(ConfidenceSignals {
                semantic: semantic_score, keyword: 0.0,
                behavior: behavior_score, design: 0.0, folder: 0.0,
            });
        return Ok(ConfidenceResult { asset_id, score, label, signals });
    }

    Ok(ConfidenceResult {
        asset_id,
        score: (semantic_score * 100.0) as i32,
        label: "low".to_string(),
        signals: ConfidenceSignals {
            semantic: semantic_score, keyword: 0.0,
            behavior: behavior_score, design: 0.0, folder: 0.0,
        },
    })
}

// ── Auto-description batch indexing ──────────────────────────────────────────

/// Generate descriptions for all assets that don't have one yet.
/// Designed to run as a background fire-and-forget after a scan.
/// Processes in batches of 50 to avoid sidecar timeout.
#[tauri::command]
pub async fn auto_describe_all(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;

    const BATCH: usize = 50;

    // Collect assets that still need descriptions.
    let pending: Vec<(String, String, String, Option<String>)> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT a.id, a.file_path, \
                    COALESCE((SELECT json_group_array(t.tag) FROM asset_tags t \
                              WHERE t.asset_id = a.id), '[]'), \
                    (SELECT dominant_colors FROM asset_design_tokens dt \
                     WHERE dt.asset_id = a.id) \
             FROM assets a \
             WHERE NOT EXISTS (\
                SELECT 1 FROM asset_descriptions ad \
                WHERE ad.asset_id = a.id AND ad.description != '') \
             ORDER BY a.indexed_at DESC \
             LIMIT 5000",
        ).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| {
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
        return Ok(serde_json::json!({ "ok": true, "generated": 0, "total": 0 }));
    }

    let sidecar = super::get_sidecar(&state)?;
    let mut generated = 0usize;

    for chunk in pending.chunks(BATCH) {
        let entries: Vec<serde_json::Value> = chunk.iter().map(|(id, fp, tags_json, colors_json)| {
            let tags: Vec<String> = serde_json::from_str(tags_json).unwrap_or_default();
            let dominant_colors: serde_json::Value = colors_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::Value::Array(vec![]));
            serde_json::json!({
                "asset_id":        id,
                "file_path":       fp,
                "tags":            tags,
                "dominant_colors": dominant_colors,
            })
        }).collect();

        let result = sidecar.call_with_timeout(
            "generate_description_batch",
            serde_json::json!({ "entries": entries }),
            INTEL_TIMEOUT,
        ).await;

        let result = match result {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, "auto_describe_all: batch failed, continuing");
                continue;
            }
        };

        let results: Vec<serde_json::Value> = result
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let now = chrono::Utc::now().timestamp();
        if let Ok(conn) = state.db.lock() {
            for r in &results {
                let asset_id = r.get("asset_id").and_then(Value::as_str).unwrap_or("");
                let description = r.get("description").and_then(Value::as_str).unwrap_or("");
                let confidence = r.get("confidence").and_then(Value::as_f64).unwrap_or(0.0);
                if !asset_id.is_empty() && !description.is_empty() {
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO asset_descriptions \
                         (asset_id, description, confidence, generated_at) VALUES (?1,?2,?3,?4)",
                        rusqlite::params![asset_id, description, confidence, now],
                    );
                    generated += 1;
                }
            }
        }

        let _ = app.emit("auto_describe_progress", serde_json::json!({
            "done": generated, "total": total,
        }));
    }

    Ok(serde_json::json!({ "ok": true, "generated": generated, "total": total }))
}

