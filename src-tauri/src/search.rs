//! Keyword search engine backed by SQLite FTS5 + skim fuzzy matching.
//!
//! # Search modes
//!
//! | mode      | text matching                          | folder / tag matching |
//! |-----------|----------------------------------------|-----------------------|
//! | `exact`   | `file_name_lower = lower(?)`           | equality              |
//! | `partial` | FTS5 `MATCH "tok1* tok2*"` (BM25 rank) | LIKE substring        |
//! | `fuzzy`   | FTS5 prefix for candidates + skim      | LIKE substring        |
//!
//! # SQL optimisation notes
//!
//! * FTS5 with `unicode61 remove_diacritics 2` tokeniser handles international
//!   filenames and accent-insensitive matching.
//! * Positional params (`?1`, `?2`, ...) are built dynamically so no query is
//!   ever assembled with user data inline -- zero SQL-injection surface.
//! * Pagination (`LIMIT / OFFSET`) is pushed into SQL for exact/partial modes;
//!   fuzzy re-ranking happens in Rust over <= 500 FTS candidates.

use std::sync::{Arc, Mutex};

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use rusqlite::Connection;

use crate::models::{Asset, SearchQuery, SearchResult};

// ── Search mode ─────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum SearchMode {
    /// Strict equality: `file_name_lower = lower(?)`, `folder = ?`.
    Exact,
    /// FTS5 prefix MATCH with BM25 ranking -- default, scales to millions of rows.
    Partial,
    /// FTS5 prefix for candidate retrieval, then Skim re-ranks by typo score.
    Fuzzy,
}

impl SearchMode {
    fn from_str(s: &str) -> Self {
        match s {
            "exact" => Self::Exact,
            "fuzzy" => Self::Fuzzy,
            _ => Self::Partial,
        }
    }
}

// ── FTS5 query builder ─────────────────────────────────────────────────────────────────────────────

/// Convert a free-text query into an FTS5 MATCH expression.
///
/// Each whitespace-separated word becomes `"word"*` (prefix match), joined
/// with implicit AND.  Embedded double-quotes are escaped per FTS5 spec.
///
/// Example: `"hero icon"` → `\"hero\"* \"icon\"*`
fn build_fts_query(text: &str) -> String {
    text.split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| {
            let escaped = t.replace('"', "\"\"");
            format!("\"{}\"*", escaped)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Row mapper ────────────────────────────────────────────────────────────────────────────────────

fn row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id:             row.get(0)?,
        file_path:      row.get(1)?,
        file_name:      row.get(2)?,
        extension:      row.get(3)?,
        folder:         row.get(4)?,
        modified_at:    row.get(5)?,
        created_at:     row.get(6)?,
        file_size:      row.get(7)?,
        hash:           row.get(8)?,
        thumbnail_path: row.get(9)?,
        favorite:       row.get::<_, i32>(10)? != 0,
        indexed_at:     row.get(11)?,
        tags:           None,
    })
}

// ── Dynamic param helper ───────────────────────────────────────────────────────────────────────────

/// Heap-allocated heterogeneous SQL parameter list.
type DynParams = Vec<Box<dyn rusqlite::ToSql>>;

fn push_text(p: &mut DynParams, s: impl Into<String>) {
    p.push(Box::new(s.into()));
}
fn push_int(p: &mut DynParams, n: i64) {
    p.push(Box::new(n));
}

// ── Public API ────────────────────────────────────────────────────────────────────────────────────

pub fn search_assets(
    db: Arc<Mutex<Connection>>,
    query: SearchQuery,
) -> Result<SearchResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let limit  = query.limit.unwrap_or(50).min(500) as usize;
    let offset = query.offset.unwrap_or(0) as usize;

    let mode = query
        .search_mode
        .as_deref()
        .map(SearchMode::from_str)
        .unwrap_or(SearchMode::Partial);

    // Treat blank / whitespace-only text as no text filter.
    let text = query.text.as_deref().filter(|t| !t.trim().is_empty());

    // ── Dynamic query assembly ──────────────────────────────────────────────────────────────────────────
    // All user-supplied values go into `params` -- nothing is interpolated
    // directly into the SQL string.  Parameter positions are 1-indexed (?1, ?2).
    let mut params: DynParams = Vec::new();
    let mut joins:  Vec<String> = Vec::new();
    let mut wheres: Vec<String> = Vec::new();

    // Whether the FTS alias `af` is present (needed for ORDER BY af.rank).
    let mut uses_fts = false;

    // ── Text filter ─────────────────────────────────────────────────────────────────────────────────
    match (mode, text) {
        (SearchMode::Exact, Some(t)) => {
            let n = params.len() + 1;
            wheres.push(format!("a.file_name_lower = lower(?{n})"));
            push_text(&mut params, t);
        }
        (SearchMode::Partial | SearchMode::Fuzzy, Some(t)) => {
            let fts_q = build_fts_query(t);
            if !fts_q.is_empty() {
                let n = params.len() + 1;
                if query.include_ocr.unwrap_or(false) {
                    // Union: assets matching on filename FTS *or* OCR text FTS.
                    // We cannot preserve af.rank across a UNION subquery, so
                    // `uses_fts` stays false and results order by modified_at.
                    wheres.push(format!(
                        "a.id IN (\
                            SELECT a2.id FROM assets a2 \
                            JOIN assets_fts af2 ON af2.rowid = a2.rowid \
                            WHERE af2 MATCH ?{n} \
                            UNION \
                            SELECT ao.asset_id FROM asset_ocr ao \
                            JOIN ocr_fts of2 ON of2.rowid = ao.id \
                            WHERE of2 MATCH ?{n}\
                        )"
                    ));
                    push_text(&mut params, fts_q);
                    // uses_fts = false — no af alias, ORDER BY falls to modified_at
                } else {
                    joins.push("JOIN assets_fts af ON af.rowid = a.rowid".to_string());
                    wheres.push(format!("af MATCH ?{n}"));
                    push_text(&mut params, fts_q);
                    uses_fts = true;
                }
            }
        }
        _ => {}
    }

    // ── Folder filter ───────────────────────────────────────────────────────────────────────────────────
    if let Some(ref folder) = query.folder {
        let f = folder.trim();
        if !f.is_empty() {
            let n = params.len() + 1;
            match mode {
                SearchMode::Exact => {
                    wheres.push(format!("a.folder = ?{n}"));
                    push_text(&mut params, f);
                }
                _ => {
                    // Substring match: "icons" finds /design/icons AND /design/icons/svg
                    wheres.push(format!("a.folder LIKE '%' || ?{n} || '%'"));
                    push_text(&mut params, f);
                }
            }
        }
    }

    // ── Tag filters (AND semantics: asset must carry every listed tag) ────────────────────────────
    if let Some(ref tags) = query.tags {
        for tag in tags.iter().filter(|t| !t.trim().is_empty()) {
            let n = params.len() + 1;
            match mode {
                SearchMode::Exact => {
                    wheres.push(format!(
                        "EXISTS (SELECT 1 FROM tags _t                          WHERE _t.asset_id = a.id                          AND lower(_t.tag) = lower(?{n}))"
                    ));
                    push_text(&mut params, tag.as_str());
                }
                _ => {
                    // Non-correlated sub-select -- runs once, returns asset_id set.
                    let fts_q = build_fts_query(tag);
                    if !fts_q.is_empty() {
                        wheres.push(format!(
                            "a.id IN (SELECT asset_id FROM tags_fts                              WHERE tags_fts MATCH ?{n})"
                        ));
                        push_text(&mut params, fts_q);
                    }
                }
            }
        }
    }

    // ── Extension filter ──────────────────────────────────────────────────────────────────────────────────
    if let Some(ref exts) = query.extensions {
        if !exts.is_empty() {
            let placeholders: Vec<String> = exts
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", params.len() + i + 1))
                .collect();
            wheres.push(format!("a.extension IN ({})", placeholders.join(",")));
            for e in exts {
                push_text(&mut params, e.as_str());
            }
        }
    }

    // ── Date-range filters ─────────────────────────────────────────────────────────────────────────────────
    if let Some(from) = query.from_date {
        let n = params.len() + 1;
        wheres.push(format!("a.modified_at >= ?{n}"));
        push_int(&mut params, from);
    }
    if let Some(to) = query.to_date {
        let n = params.len() + 1;
        wheres.push(format!("a.modified_at <= ?{n}"));
        push_int(&mut params, to);
    }

    // ── Favorites filter ──────────────────────────────────────────────────────────────────────────────────
    if let Some(true) = query.favorites_only {
        wheres.push("a.favorite = 1".to_string());
    }

    // ── Folder-intelligence boost ─────────────────────────────────────────────
    // When a text query is active, LEFT-JOIN `folder_intelligence` and promote
    // assets whose folder `tokens` column contains the primary search token.
    //
    // In FTS partial mode this adjusts `af.rank` (lower = better in FTS5):
    //   ORDER BY af.rank - fi_boost
    // In non-FTS / default-sort mode the boost acts as a secondary DESC key:
    //   ORDER BY fi_boost DESC, a.modified_at DESC
    //
    // The join uses the existing `idx_assets_folder` covering index and adds
    // at most one extra lookup per result row — negligible overhead.
    let mut fi_boost_expr = String::new();
    if let Some(t) = text {
        // Pick the first token longer than 2 chars; it carries the most signal.
        if let Some(tok) = t.split_whitespace().find(|w| w.len() > 2) {
            let n = params.len() + 1;
            joins.push(
                "LEFT JOIN folder_intelligence fi ON fi.folder_path = a.folder".to_string(),
            );
            fi_boost_expr = format!(
                "COALESCE(CASE WHEN fi.tokens LIKE '%' || ?{n} || '%' THEN 1.5 ELSE 0.0 END, 0.0)"
            );
            push_text(&mut params, tok.to_lowercase());
        }
    }

    // ── Assemble clauses ────────────────────────────────────────────────────────────────────────────────────
    let join_clause  = joins.join(" ");
    let where_clause = if wheres.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", wheres.join(" AND "))
    };

    // ORDER BY:
    //   * partial + FTS active -> BM25 rank adjusted by folder-intel boost
    //   * all other cases      -> user-chosen column (boost as secondary for default sort)
    let order_by: String = if uses_fts && mode == SearchMode::Partial {
        if fi_boost_expr.is_empty() {
            "af.rank".into()
        } else {
            format!("af.rank - {fi_boost_expr}")
        }
    } else {
        match query.sort_by.as_deref() {
            Some("file_name")  => "a.file_name_lower ASC".into(),
            Some("file_size")  => "a.file_size DESC".into(),
            Some("created_at") => "a.created_at DESC".into(),
            _ => {
                if fi_boost_expr.is_empty() {
                    "a.modified_at DESC".into()
                } else {
                    format!("{fi_boost_expr} DESC, a.modified_at DESC")
                }
            }
        }
    };

    // Fuzzy: fetch <=500 FTS candidates; Skim applies LIMIT/OFFSET after ranking.
    let (sql_limit, sql_offset) = if mode == SearchMode::Fuzzy && uses_fts {
        (500usize, 0usize)
    } else {
        (limit, offset)
    };

    let select_cols = "a.id, a.file_path, a.file_name, a.extension, a.folder, \
                       a.modified_at, a.created_at, a.file_size, a.hash, \
                       a.thumbnail_path, a.favorite, a.indexed_at";

    let count_sql = format!(
        "SELECT COUNT(*) FROM assets a {join_clause} {where_clause}"
    );
    let data_sql = format!(
        "SELECT {select_cols} FROM assets a {join_clause} {where_clause} \
         ORDER BY {order_by} LIMIT {sql_limit} OFFSET {sql_offset}"
    );

    // Bind refs must outlive the prepared statement.
    let bind_refs: Vec<&dyn rusqlite::ToSql> =
        params.iter().map(|b| b.as_ref()).collect();

    // ── COUNT (exact/partial only; fuzzy counts after skim) ────────────────────────────────────────
    let pre_fuzzy_total: i64 = if mode != SearchMode::Fuzzy {
        conn.query_row(&count_sql, bind_refs.as_slice(), |r| r.get(0))
            .unwrap_or(0)
    } else {
        0
    };

    // ── Data fetch ─────────────────────────────────────────────────────────────────────────────────────────
    let mut stmt = conn.prepare(&data_sql).map_err(|e| e.to_string())?;
    let mut assets: Vec<Asset> = stmt
        .query_map(bind_refs.as_slice(), row_to_asset)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    drop(conn);

    // ── Fuzzy re-ranking ──────────────────────────────────────────────────────────────────────────────────────
    // FTS5 already narrowed by prefix; Skim scores typo-tolerance.
    let total: i64 = if mode == SearchMode::Fuzzy {
        match text {
            Some(t) => {
                let matcher = SkimMatcherV2::default();
                let mut scored: Vec<(i64, Asset)> = assets
                    .into_iter()
                    .filter_map(|a| {
                        // Primary: file_name.  Fallback: last folder segment so
                        // "src" also matches paths like /projects/src/icons/.
                        let name_score = matcher.fuzzy_match(&a.file_name, t);
                        let folder_score = a
                            .folder
                            .rsplit('/')
                            .next()
                            .and_then(|seg| matcher.fuzzy_match(seg, t));
                        name_score.or(folder_score).map(|s| (s, a))
                    })
                    .collect();
                scored.sort_unstable_by(|x, y| y.0.cmp(&x.0));
                let total = scored.len() as i64;
                assets = scored
                    .into_iter()
                    .skip(offset)
                    .take(limit)
                    .map(|(_, a)| a)
                    .collect();
                total
            }
            None => {
                let total = assets.len() as i64;
                assets = assets.into_iter().skip(offset).take(limit).collect();
                total
            }
        }
    } else {
        pre_fuzzy_total
    };

    Ok(SearchResult { assets, total })
}
