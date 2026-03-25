//! Keyword search, autocomplete suggestions, and search-history commands.

use tauri::State;
use rusqlite::params;
use crate::state::AppState;
use crate::models::{SearchQuery, SearchResult, Suggestion, SuggestionKind, SuggestionsResult};
use crate::search::search_assets;

#[tauri::command]
pub async fn search(
    query: SearchQuery,
    state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    tracing::debug!(text = ?query.text, folder = ?query.folder, "search");
    let result = search_assets(state.db.clone(), query);
    if let Err(ref e) = result {
        tracing::error!(error = %e, "search: SQLite query failed");
    }
    result
}

/// Return up to `limit` autocomplete suggestions for a partial query string.
///
/// Merges four sources ranked by frequency: history, tags, filenames, folders.
#[tauri::command]
pub async fn get_suggestions(
    prefix: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<SuggestionsResult, String> {
    let cap = limit.unwrap_or(10).min(50).max(1) as usize;

    // Reject abusive payloads before acquiring the DB lock.
    // A legitimate prefix is never longer than a typical filename (255 bytes).
    if prefix.len() > 500 {
        return Err("prefix too long (max 500 chars)".to_string());
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let trimmed = prefix.trim().to_lowercase();
    let like_pat = format!("{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));

    let mut suggestions: Vec<Suggestion> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── 1. History ────────────────────────────────────────────────────────────
    let push_history = |kw: String,
                        freq: i64,
                        seen: &mut std::collections::HashSet<String>,
                        out: &mut Vec<Suggestion>| {
        if seen.insert(kw.to_lowercase()) {
            out.push(Suggestion { text: kw, kind: SuggestionKind::History, score: freq });
        }
    };

    if trimmed.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT keyword, COUNT(*) as freq
             FROM search_history
             GROUP BY keyword
             ORDER BY freq DESC, MAX(searched_at) DESC
             LIMIT ?1",
        ).map_err(|e| e.to_string())?;
        let pairs: Vec<(String, i64)> = stmt
            .query_map(params![cap as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for (kw, freq) in pairs { push_history(kw, freq, &mut seen, &mut suggestions); }
    } else {
        let mut stmt = conn.prepare(
            "SELECT keyword, COUNT(*) as freq
             FROM search_history
             WHERE lower(keyword) LIKE ?1 ESCAPE '\\'
             GROUP BY keyword
             ORDER BY freq DESC, MAX(searched_at) DESC
             LIMIT ?2",
        ).map_err(|e| e.to_string())?;
        let pairs: Vec<(String, i64)> = stmt
            .query_map(params![like_pat.as_str(), cap as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for (kw, freq) in pairs { push_history(kw, freq, &mut seen, &mut suggestions); }
    }

    if !trimmed.is_empty() {
        // ── 2. Tags ───────────────────────────────────────────────────────────
        {
            let mut stmt = conn
                .prepare(
                    "SELECT tag, COUNT(DISTINCT asset_id) as cnt
                     FROM tags
                     WHERE lower(tag) LIKE ?1 ESCAPE '\\'
                     GROUP BY lower(tag)
                     ORDER BY cnt DESC
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, i64)> = stmt
                .query_map(params![like_pat, cap as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for (tag, cnt) in rows {
                if seen.insert(tag.to_lowercase()) {
                    suggestions.push(Suggestion { text: tag, kind: SuggestionKind::Tag, score: cnt });
                }
            }
        }

        // ── 3. Filenames ──────────────────────────────────────────────────────
        {
            let mut stmt = conn
                .prepare(
                    "SELECT file_name, COUNT(*) as cnt
                     FROM assets
                     WHERE file_name_lower LIKE ?1 ESCAPE '\\'
                     GROUP BY file_name_lower
                     ORDER BY cnt DESC
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, i64)> = stmt
                .query_map(params![like_pat, cap as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for (name, cnt) in rows {
                if seen.insert(name.to_lowercase()) {
                    suggestions.push(Suggestion { text: name, kind: SuggestionKind::Filename, score: cnt });
                }
            }
        }

        // ── 4. Folders ────────────────────────────────────────────────────────
        {
            let contains_pat = format!("%{}%", trimmed.replace('%', "\\%").replace('_', "\\_"));
            let mut stmt = conn
                .prepare(
                    "SELECT folder, COUNT(*) as cnt
                     FROM assets
                     WHERE lower(folder) LIKE ?1 ESCAPE '\\'
                        OR lower(folder) LIKE ?2 ESCAPE '\\'
                     GROUP BY folder
                     ORDER BY cnt DESC
                     LIMIT ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, i64)> = stmt
                .query_map(params![like_pat, contains_pat, cap as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for (folder, cnt) in rows {
                if seen.insert(folder.to_lowercase()) {
                    suggestions.push(Suggestion { text: folder, kind: SuggestionKind::Folder, score: cnt });
                }
            }
        }
    }

    suggestions.sort_by(|a, b| b.score.cmp(&a.score).then(a.text.cmp(&b.text)));
    suggestions.truncate(cap);

    Ok(SuggestionsResult { suggestions })
}

#[tauri::command]
pub async fn record_search(
    keyword: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let trimmed = keyword.trim().to_string();
    if trimmed.is_empty() || trimmed.len() > 500 {
        return Ok(());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO search_history (keyword) VALUES (?1)",
        params![trimmed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn clear_search_history(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM search_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
