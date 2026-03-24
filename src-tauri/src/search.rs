use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use fuzzy_matcher::{FuzzyMatcher, skim::SkimMatcherV2};

use crate::models::{Asset, SearchQuery, SearchResult};

pub fn search_assets(
    db: Arc<Mutex<Connection>>,
    query: SearchQuery,
) -> Result<SearchResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let limit = query.limit.unwrap_or(50).min(500);
    let offset = query.offset.unwrap_or(0);

    // Build dynamic WHERE clauses
    let mut conditions: Vec<String> = Vec::new();
    let mut binds: Vec<String> = Vec::new();

    if let Some(ref exts) = query.extensions {
        if !exts.is_empty() {
            let placeholders: Vec<String> = exts.iter().enumerate()
                .map(|(i, _)| format!("?{}", binds.len() + i + 1))
                .collect();
            conditions.push(format!("extension IN ({})", placeholders.join(",")));
            binds.extend(exts.iter().cloned());
        }
    }

    if let Some(ref folder) = query.folder {
        conditions.push(format!("folder LIKE ?{}", binds.len() + 1));
        binds.push(format!("%{}%", folder));
    }

    if let Some(from) = query.from_date {
        conditions.push(format!("modified_at >= ?{}", binds.len() + 1));
        binds.push(from.to_string());
    }

    if let Some(to) = query.to_date {
        conditions.push(format!("modified_at <= ?{}", binds.len() + 1));
        binds.push(to.to_string());
    }

    if let Some(true) = query.favorites_only {
        conditions.push("favorite = 1".to_string());
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // Dynamic ORDER BY
    let order_by = match query.sort_by.as_deref() {
        Some("file_name")  => "file_name_lower ASC",
        Some("file_size")  => "file_size DESC",
        Some("created_at") => "created_at DESC",
        _                  => "modified_at DESC",
    };

    // Fetch all matching (before text filter, to allow fuzzy on name)
    let sql = format!(
        "SELECT id, file_path, file_name, extension, folder, modified_at, created_at, file_size, hash, thumbnail_path, favorite, indexed_at
         FROM assets
         {}
         ORDER BY {}",
        where_clause, order_by
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let all_assets: Vec<Asset> = stmt
        .query_map(bind_refs.as_slice(), |row| {
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
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    drop(stmt);
    drop(conn);

    // Apply fuzzy text filter if provided
    let filtered: Vec<Asset> = if let Some(ref text) = query.text {
        if text.trim().is_empty() {
            all_assets
        } else {
            let matcher = SkimMatcherV2::default();
            let mut scored: Vec<(i64, Asset)> = all_assets
                .into_iter()
                .filter_map(|a| {
                    matcher
                        .fuzzy_match(&a.file_name, text)
                        .map(|score| (score, a))
                })
                .collect();
            scored.sort_by(|a, b| b.0.cmp(&a.0));
            scored.into_iter().map(|(_, a)| a).collect()
        }
    } else {
        all_assets
    };

    let total = filtered.len() as i64;
    let page: Vec<Asset> = filtered
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();

    Ok(SearchResult {
        assets: page,
        total,
    })
}
