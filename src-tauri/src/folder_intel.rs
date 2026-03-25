//! Folder intelligence: derives semantic categories from folder path structure.
//!
//! Entirely rule-based (no ML, no sidecar).  Runs in microseconds per path.
//! Results are persisted in `folder_intelligence` for search ranking.
//!
//! # Category taxonomy
//!
//! Each [`FolderCategory`] is keyed by trigger keywords that appear anywhere
//! in the lowercased, tokenised path.  When multiple categories match, the one
//! whose keyword appears in the **deepest** two segments wins (specificity).
//!
//! # Confidence scoring
//!
//! | Situation                                  | Score |
//! |--------------------------------------------|-------|
//! | keyword in last 2 path segments            |  0.90 |
//! | keyword only in earlier segments           |  0.60 |
//! | 2+ keywords matching the winning category  | +0.05 |
//! | a subcategory keyword is also found        | +0.05 |
//! | manual override                            |  1.00 |
//!
//! Confidence is capped at 1.0.

use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ── Taxonomy ─────────────────────────────────────────────────────────────────

/// (category_label, trigger_keywords[])
///
/// The first entry whose keywords include any token from the path becomes the
/// candidate category.  All matching candidates are compared; the one with the
/// deepest (most specific) hit wins.
static CATEGORY_RULES: &[(&str, &[&str])] = &[
    (
        "design",
        &[
            "design", "designs", "ui", "ux", "interface", "component",
            "components", "widget", "widgets", "layout", "layouts",
        ],
    ),
    (
        "icon",
        &[
            "icon", "icons", "glyph", "glyphs", "symbol", "symbols",
            "pictogram", "pictograms",
        ],
    ),
    (
        "brand",
        &["brand", "branding", "identity", "logo", "logos", "logotype"],
    ),
    (
        "typography",
        &["typography", "font", "fonts", "typeface", "typefaces"],
    ),
    (
        "photo",
        &[
            "photo", "photos", "photography", "photograph", "photographs",
            "portrait", "portraits", "landscape", "studio", "shoot",
        ],
    ),
    (
        "marketing",
        &[
            "marketing", "campaign", "campaigns", "ads", "advertisement",
            "advertisements", "banner", "banners", "social", "email",
            "newsletter", "newsletters", "promo", "promotional",
        ],
    ),
    (
        "illustration",
        &[
            "illustration", "illustrations", "drawing", "drawings",
            "artwork", "artworks", "art", "graphic", "graphics",
        ],
    ),
    (
        "mockup",
        &[
            "mockup", "mockups", "wireframe", "wireframes", "prototype",
            "prototypes", "sketch", "sketches", "lofi", "hifi",
        ],
    ),
    (
        "video",
        &[
            "video", "videos", "motion", "animation", "animations",
            "clip", "clips", "footage", "recording", "recordings",
            "reel", "reels",
        ],
    ),
    (
        "audio",
        &["audio", "music", "sound", "sounds", "sfx", "voice", "podcast", "podcasts"],
    ),
    (
        "document",
        &[
            "document", "documents", "doc", "docs", "pdf", "report",
            "reports", "brief", "briefs", "spec", "specs", "proposal",
            "proposals",
        ],
    ),
    (
        "code",
        &[
            "src", "source", "code", "lib", "library", "libs", "package",
            "packages", "dist", "build",
        ],
    ),
    (
        "export",
        &[
            "export", "exports", "output", "outputs", "delivery",
            "deliverable", "deliverables", "final", "finals", "release",
            "releases",
        ],
    ),
    (
        "archive",
        &[
            "archive", "archives", "backup", "backups", "tmp", "temp",
            "legacy", "deprecated",
        ],
    ),
];

/// Common subcategory tokens that appear *inside* a category tree.
/// Checked after the top-level category is determined.
static SUBCATEGORY_KEYWORDS: &[&str] = &[
    // Platform
    "mobile", "web", "desktop", "tablet", "ios", "android", "responsive",
    // UI components
    "button", "buttons", "card", "cards", "modal", "modals", "nav",
    "navigation", "form", "forms", "input", "inputs", "badge", "badges",
    "header", "footer", "sidebar", "menu", "menus", "dropdown", "alert",
    "dialog", "chip", "chips", "tab", "tabs", "toolbar",
    // Commerce / domain
    "payment", "payments", "ecommerce", "finance", "shopping", "cart",
    // Asset subtypes
    "avatar", "avatars", "background", "backgrounds", "texture", "textures",
    "pattern", "patterns", "flag", "flags", "emoji",
    // Colour scheme / theming
    "darkmode", "lightmode", "dark", "light", "theme",
];

// ── Data types ────────────────────────────────────────────────────────────────

/// Classifier output for one folder path.  Maps 1-to-1 with the
/// `folder_intelligence` SQLite table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderIntelligence {
    pub folder_path: String,
    /// Top-level category label, e.g. `"design"`, `"icon"`, `"photo"`.
    /// Empty string when the category is unknown.
    pub category: String,
    /// Inferred second-level label, e.g. `"button"`, `"mobile"`.
    /// Empty when no subcategory keyword was found.
    pub subcategory: String,
    /// All meaningful lowercase tokens from the path, space-separated.
    /// Stored this way so `fi.tokens LIKE '%button%'` works in SQL.
    pub tokens: String,
    /// Classifier confidence in [0.0, 1.0].  1.0 for manual overrides.
    pub confidence: f64,
    /// Number of non-empty path segments (directory depth).
    pub depth: usize,
    /// `true` when a human has explicitly set the category, preventing
    /// subsequent auto-inference from overwriting it.
    pub is_manual: bool,
}

// ── Tokeniser ─────────────────────────────────────────────────────────────────

/// Split a folder path into lowercase tokens, deduplicating while preserving
/// first-occurrence order.
///
/// Splits on `/`, `\`, `-`, `_`, `.`, and ASCII spaces.
/// Tokens of length ≤ 1 are discarded as noise (drive letters, dots).
pub fn tokenize_path(path: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    path.split(|c| matches!(c, '/' | '\\' | '-' | '_' | '.' | ' '))
        .map(|s| s.to_lowercase())
        .filter(|s| s.len() > 1)
        .filter(|s| seen.insert(s.clone()))
        .collect()
}

// ── Core classifier ───────────────────────────────────────────────────────────

/// Infer semantic category and subcategory for an arbitrary folder path.
///
/// This function is pure (no I/O) and runs in a few microseconds.
/// DB-persisted rows with `is_manual = true` are **not** passed here;
/// the persistence layer skips auto-inference for those rows.
pub fn infer_folder(path: &str) -> FolderIntelligence {
    let tokens = tokenize_path(path);
    let token_set: std::collections::HashSet<&str> =
        tokens.iter().map(String::as_str).collect();

    // Identify the "deep" segments (last 2) to weight specificity.
    let segments: Vec<String> = path
        .split(|c| matches!(c, '/' | '\\'))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect();
    let deep_set: std::collections::HashSet<&str> = segments
        .iter()
        .rev()
        .take(2)
        .map(String::as_str)
        .collect();

    // ── Match top-level categories ────────────────────────────────────────────
    let mut best_cat = "";
    let mut best_score = 0.0_f64;
    let mut best_hits = 0usize;

    for &(cat, keywords) in CATEGORY_RULES {
        let mut hits = 0usize;
        let mut deep_hit = false;
        for &kw in keywords {
            if token_set.contains(kw) {
                hits += 1;
                if deep_set.contains(kw) {
                    deep_hit = true;
                }
            }
        }
        if hits == 0 {
            continue;
        }
        // Deep hit (last 2 segments) → higher confidence than a root-level hint.
        let score = if deep_hit { 0.90 } else { 0.60 }
            + if hits > 1 { 0.05 } else { 0.0 };
        if score > best_score || (score == best_score && hits > best_hits) {
            best_cat = cat;
            best_score = score;
            best_hits = hits;
        }
    }

    // ── Match subcategory ─────────────────────────────────────────────────────
    let mut subcategory = String::new();
    for &kw in SUBCATEGORY_KEYWORDS {
        // Skip if it's the same word as the top-level category (redundant).
        if token_set.contains(kw) && kw != best_cat {
            if deep_set.contains(kw) {
                subcategory = kw.to_string();
                best_score = (best_score + 0.05).min(1.0);
                break; // prefer the deepest hit; stop on first deep match
            } else if subcategory.is_empty() {
                subcategory = kw.to_string();
                best_score = (best_score + 0.03).min(1.0);
                // don't break: a deeper hit later may replace this
            }
        }
    }

    FolderIntelligence {
        folder_path: path.to_string(),
        category: best_cat.to_string(),
        subcategory,
        tokens: tokens.join(" "),
        confidence: best_score,
        depth: segments.len(),
        is_manual: false,
    }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/// Upsert a `FolderIntelligence` row.
///
/// If the existing row has `is_manual = 1` (user override), the auto-inferred
/// `category`, `subcategory`, `tokens`, and `confidence` columns are left
/// unchanged — only `depth` and `updated_at` are refreshed.
pub fn upsert_folder_intel(
    conn: &Connection,
    intel: &FolderIntelligence,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO folder_intelligence
             (folder_path, category, subcategory, tokens, confidence, depth, is_manual, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, unixepoch())
         ON CONFLICT(folder_path) DO UPDATE SET
             category    = CASE WHEN is_manual = 1 THEN category    ELSE excluded.category    END,
             subcategory = CASE WHEN is_manual = 1 THEN subcategory ELSE excluded.subcategory END,
             tokens      = CASE WHEN is_manual = 1 THEN tokens      ELSE excluded.tokens      END,
             confidence  = CASE WHEN is_manual = 1 THEN confidence  ELSE excluded.confidence  END,
             depth       = excluded.depth,
             updated_at  = unixepoch()",
        params![
            &intel.folder_path,
            &intel.category,
            &intel.subcategory,
            &intel.tokens,
            intel.confidence,
            intel.depth as i64,
        ],
    )?;
    Ok(())
}

/// Fetch the stored `FolderIntelligence` for a single path.
pub fn get_folder_intel(
    conn: &Connection,
    path: &str,
) -> rusqlite::Result<Option<FolderIntelligence>> {
    let mut stmt = conn.prepare_cached(
        "SELECT folder_path, category, subcategory, tokens, confidence, depth, is_manual
         FROM folder_intelligence
         WHERE folder_path = ?1",
    )?;
    let mut rows = stmt.query_map([path], row_to_intel)?;
    rows.next().transpose()
}

/// Return all stored `FolderIntelligence` rows ordered by path.
pub fn list_folder_intel(conn: &Connection) -> rusqlite::Result<Vec<FolderIntelligence>> {
    let mut stmt = conn.prepare(
        "SELECT folder_path, category, subcategory, tokens, confidence, depth, is_manual
         FROM folder_intelligence
         ORDER BY folder_path",
    )?;
    let rows = stmt.query_map([], row_to_intel)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Apply a manual category + subcategory override for `path`.
///
/// Sets `is_manual = 1`, which prevents future auto-inference from overwriting
/// the values.  Tokens and depth are recomputed from the path.
pub fn set_manual_override(
    conn: &Connection,
    path: &str,
    category: &str,
    subcategory: &str,
) -> rusqlite::Result<()> {
    let tokens = tokenize_path(path).join(" ");
    let depth = path
        .split(|c| matches!(c, '/' | '\\'))
        .filter(|s| !s.is_empty())
        .count() as i64;
    conn.execute(
        "INSERT INTO folder_intelligence
             (folder_path, category, subcategory, tokens, confidence, depth, is_manual, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1.0, ?5, 1, unixepoch())
         ON CONFLICT(folder_path) DO UPDATE SET
             category    = excluded.category,
             subcategory = excluded.subcategory,
             confidence  = 1.0,
             is_manual   = 1,
             updated_at  = unixepoch()",
        params![path, category, subcategory, &tokens, depth],
    )?;
    Ok(())
}

/// Refresh folder intelligence for every distinct `folder` value in `assets`
/// that sits under `root_path`.
///
/// Rows with `is_manual = 1` are preserved (the upsert skips their semantic
/// columns).  Safe to call after any scan; skipped silently on lock failure.
pub fn refresh_folder_intel_for_root(
    db: &Arc<Mutex<Connection>>,
    root_path: &str,
) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT folder FROM assets WHERE folder LIKE ?1 || '%'")
        .map_err(|e| e.to_string())?;
    let folders: Vec<String> = stmt
        .query_map([root_path], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let count = folders.len();
    for folder in &folders {
        let intel = infer_folder(folder);
        let _ = upsert_folder_intel(&conn, &intel);
    }
    tracing::info!(root = %root_path, folders = count, "folder intelligence refreshed");
    Ok(count)
}

// ── Row mapper ────────────────────────────────────────────────────────────────

fn row_to_intel(row: &rusqlite::Row<'_>) -> rusqlite::Result<FolderIntelligence> {
    Ok(FolderIntelligence {
        folder_path: row.get(0)?,
        category:    row.get(1)?,
        subcategory: row.get(2)?,
        tokens:      row.get(3)?,
        confidence:  row.get(4)?,
        depth:       row.get::<_, i64>(5)? as usize,
        is_manual:   row.get::<_, i32>(6)? != 0,
    })
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_design_button_mobile() {
        let fi = infer_folder("/design/button/mobile");
        assert_eq!(fi.category, "design");
        assert_eq!(fi.subcategory, "mobile");
        // "design" is in the first (shallow) segment, so we get 0.60 base + 0.05 subcategory bonus
        assert!(fi.confidence >= 0.60, "confidence={}", fi.confidence);
    }

    #[test]
    fn classify_design_icon_payment() {
        let fi = infer_folder("/design/icon/payment");
        // "icon" is deeper than "design" so it wins
        assert_eq!(fi.category, "icon");
        assert_eq!(fi.subcategory, "payment");
    }

    #[test]
    fn classify_branding_logos() {
        let fi = infer_folder("/projects/acme/branding/logos");
        assert_eq!(fi.category, "brand");
        assert!(fi.confidence > 0.0);
    }

    #[test]
    fn classify_unknown_path() {
        let fi = infer_folder("/Users/lethanhgiang/random_data");
        assert_eq!(fi.category, "");
        assert_eq!(fi.confidence, 0.0);
    }

    #[test]
    fn tokenizer_deduplicates() {
        let tokens = tokenize_path("/design/design/button");
        assert_eq!(tokens.iter().filter(|t| t.as_str() == "design").count(), 1);
    }

    #[test]
    fn tokenizer_strips_noise() {
        let tokens = tokenize_path("/a/bb/design");
        // "a" (len 1) should be dropped
        assert!(!tokens.contains(&"a".to_string()));
        assert!(tokens.contains(&"design".to_string()));
    }

    #[test]
    fn deep_hit_beats_shallow() {
        // "icon" is in the last segment → should win over "design" in an earlier one
        let fi = infer_folder("/design/assets/icon");
        assert_eq!(fi.category, "icon");
    }
}
