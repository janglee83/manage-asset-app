//! Asset relation graph — detects meaningful naming-pattern relationships between
//! assets and persists them as an edge set in SQLite.
//!
//! # Relation kinds
//!
//! | Kind               | Pattern example                        | Confidence |
//! |--------------------|----------------------------------------|------------|
//! | `version`          | login_v1 ↔ login_v2                    | 0.95       |
//! | `platform_variant` | icon_mobile ↔ icon_web                 | 0.90       |
//! | `component_family` | button_primary ↔ button_secondary      | 0.90       |
//! | `same_stem`        | hero_icon ↔ hero_illustration (mixed)  | 0.70–0.72  |
//! | `co_location`      | hero.png ↔ hero.svg (same folder+stem) | 0.95       |
//!
//! # Algorithm
//!
//! 1. **Parse** every asset file stem into `(base, kind)` via last-token suffix
//!    recognition with three vocabulary lists (version patterns, platform names,
//!    component-variant names).
//! 2. **Suffix groups**: group by `(lower_folder || "||" || base)`.  All pairs
//!    within a group get an edge whose `relation` is derived from both endpoints'
//!    kinds; cross-kind pairs fall back to `same_stem`.
//! 3. **Co-location pass**: group by `(lower_folder || "||" || raw_stem)`.
//!    Pairs that share a stem but have **different** extensions get a
//!    `co_location` edge regardless of suffix classification.
//!
//! Edges are stored with `asset_a < asset_b` (lexicographic canonical form) to
//! prevent `(a,b)` / `(b,a)` duplicates — identical to the `duplicate_pairs`
//! table convention.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ── Suffix vocabularies ───────────────────────────────────────────────────────

/// Last-token suffixes that indicate a **component family** variant.
static COMPONENT_SUFFIXES: &[&str] = &[
    // Role / emphasis
    "primary", "secondary", "tertiary",
    "default", "filled", "outlined", "ghost", "text", "plain",
    // Theme
    "dark", "light", "inverted", "transparent",
    // State
    "active", "inactive", "disabled", "hover", "focus",
    "selected", "checked", "unchecked", "pressed", "loading",
    "success", "error", "warning", "info", "danger", "neutral",
    // Size
    "small", "medium", "large", "sm", "md", "lg", "xl", "xs", "2xl",
    "compact", "expanded", "dense", "full", "mini",
    // Direction / position
    "horizontal", "vertical", "left", "right", "top", "bottom",
    "start", "end", "center",
    // Open/closed toggle
    "on", "off", "open", "closed", "empty",
    // Content slot variants
    "icon", "label", "image", "badge",
    // Bold, italic, etc.
    "bold", "regular", "italic",
    // Commerce / domain specific
    "outline", "contained", "elevated", "tonal",
];

/// Last-token suffixes that indicate a **platform / environment** variant.
static PLATFORM_SUFFIXES: &[&str] = &[
    "mobile", "web", "desktop", "tablet", "touch", "watch", "tv",
    "ios", "android", "macos", "windows", "linux",
    "responsive", "retina", "hd", "sd",
    "print", "screen", "email",
];

// ── Internal types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
enum StemKind {
    Version,
    PlatformVariant,
    ComponentFamily,
    Plain,
}

struct ParsedStem {
    asset_id: String,
    /// Lowercased parent folder path — scopes the group to the same directory.
    folder:   String,
    /// Full lowercased stem (no extension) — used for co-location detection.
    raw_stem: String,
    /// Stem with the recognised suffix token removed.  Equals `raw_stem` when
    /// no matching suffix is found.
    base:     String,
    kind:     StemKind,
}

// ── Public data types (returned to frontend) ──────────────────────────────────

/// A single edge in the asset relation graph.
///
/// `asset_a` ≤ `asset_b` lexicographically (canonical form).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRelation {
    pub id:          i64,
    pub asset_a:     String,
    pub asset_b:     String,
    /// One of: `"component_family"` | `"version"` | `"platform_variant"` |
    ///         `"same_stem"` | `"co_location"`
    pub relation:    String,
    /// Classifier confidence in [0.0, 1.0].
    pub confidence:  f64,
    /// Shared base name that formed this group, e.g. `"button"` or `"login"`.
    pub group_key:   String,
    pub detected_at: i64,
}

/// A cluster of assets sharing a `group_key`, with membership and dominant kind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationGroup {
    /// The shared base stem (e.g. `"button"`, `"login"`).
    pub group_key:  String,
    /// Dominant relation kind for this group.
    pub relation:   String,
    /// All asset UUIDs that are members of this group.
    pub asset_ids:  Vec<String>,
    pub confidence: f64,
}

/// Summary returned after a full graph rebuild or incremental refresh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationGraphStats {
    pub edges_created: usize,
    pub groups:        usize,
    pub assets_linked: usize,
    pub duration_ms:   u64,
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/// Split a stem on common delimiter characters into lowercase tokens.
fn tokenize(stem: &str) -> Vec<String> {
    stem.split(|c: char| matches!(c, '_' | '-' | '.' | ' ' | '+'))
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Return `true` if `token` is a version designator.
///
/// Supports: `v1`, `v2`, `v1.0`, `r1`, `r2`, pure digits (`1`, `02`),
/// and named release labels (`final`, `beta`, `rc`, `draft`, …).
fn is_version(token: &str) -> bool {
    let t = token.to_lowercase();
    // v + digit(s), e.g. v1, v10, v1_2
    if t.starts_with('v') && t.len() > 1 {
        if t[1..].chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return true;
        }
    }
    // r + digit(s), e.g. r1, r2 (revision)
    if t.starts_with('r') && t.len() > 1 {
        let rest = &t[1..];
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    // Pure digit string: 1, 2, 01, 002
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // Named release labels
    matches!(
        t.as_str(),
        "final" | "draft" | "latest" | "old" | "new"
            | "alpha" | "beta" | "rc" | "preview"
            | "prod" | "staging" | "dev" | "release"
    )
}

/// Parse a single asset's naming metadata into a `ParsedStem`.
///
/// Priority order for last-token matching: version > platform > component.
/// Single-token stems are never stripped (avoids wrong base = "").
fn parse_stem(asset_id: &str, file_name: &str, extension: &str, folder: &str) -> ParsedStem {
    let lower_name = file_name.to_lowercase();
    let raw_stem: String = if !extension.is_empty() {
        let dot_ext = format!(".{}", extension.to_lowercase());
        lower_name
            .strip_suffix(&dot_ext)
            .unwrap_or(&lower_name)
            .to_string()
    } else {
        lower_name
    };

    let tokens = tokenize(&raw_stem);
    let folder_lower = folder.to_lowercase();

    if tokens.is_empty() {
        return ParsedStem {
            asset_id: asset_id.to_string(),
            folder:   folder_lower,
            raw_stem,
            base:     String::new(),
            kind:     StemKind::Plain,
        };
    }

    // Only attempt suffix stripping when the stem has more than one token.
    // (A stem like "mobile.svg" shouldn't have "mobile" stripped as its base
    //  would become empty — making it impossible to distinguish from other
    //  single-word stems.)
    if tokens.len() > 1 {
        let last = tokens.last().unwrap().as_str();
        let base = tokens[..tokens.len() - 1].join("_");

        if is_version(last) {
            return ParsedStem {
                asset_id: asset_id.to_string(),
                folder:   folder_lower,
                raw_stem,
                base,
                kind: StemKind::Version,
            };
        }
        if PLATFORM_SUFFIXES.contains(&last) {
            return ParsedStem {
                asset_id: asset_id.to_string(),
                folder:   folder_lower,
                raw_stem,
                base,
                kind: StemKind::PlatformVariant,
            };
        }
        if COMPONENT_SUFFIXES.contains(&last) {
            return ParsedStem {
                asset_id: asset_id.to_string(),
                folder:   folder_lower,
                raw_stem,
                base,
                kind: StemKind::ComponentFamily,
            };
        }
    }

    // No recognised suffix — full stem is the base.
    ParsedStem {
        asset_id: asset_id.to_string(),
        folder:   folder_lower,
        raw_stem: raw_stem.clone(),
        base:     raw_stem,
        kind:     StemKind::Plain,
    }
}

/// Derive the edge relation label and confidence from the two endpoints' kinds.
fn edge_label(a: &StemKind, b: &StemKind) -> (&'static str, f64) {
    match (a, b) {
        (StemKind::Version, StemKind::Version) =>
            ("version", 0.95),
        (StemKind::PlatformVariant, StemKind::PlatformVariant) =>
            ("platform_variant", 0.90),
        (StemKind::ComponentFamily, StemKind::ComponentFamily) =>
            ("component_family", 0.90),
        (StemKind::Plain, StemKind::Plain) =>
            ("same_stem", 0.70),
        // Cross-kind: still meaningfully related, less specific.
        _ => ("same_stem", 0.72),
    }
}

/// Return `(a, b)` ordered with `a ≤ b` lexicographically.
fn canonical(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/// Return all relations in which `asset_id` is an endpoint.
pub fn get_relations(conn: &Connection, asset_id: &str) -> rusqlite::Result<Vec<AssetRelation>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, asset_a, asset_b, relation, confidence, group_key, detected_at
         FROM asset_relations
         WHERE asset_a = ?1 OR asset_b = ?1
         ORDER BY confidence DESC, detected_at DESC",
    )?;
    let rows = stmt.query_map([asset_id], row_to_relation)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Return all `RelationGroup`s that contain `asset_id`, including all member IDs.
pub fn get_groups_for_asset(
    conn: &Connection,
    asset_id: &str,
) -> rusqlite::Result<Vec<RelationGroup>> {
    // Find all group_keys this asset participates in.
    let mut keys_stmt = conn.prepare_cached(
        "SELECT DISTINCT group_key FROM asset_relations
         WHERE asset_a = ?1 OR asset_b = ?1",
    )?;
    let keys: Vec<String> = keys_stmt
        .query_map([asset_id], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut groups = Vec::new();
    for key in keys {
        let mut stmt = conn.prepare_cached(
            "SELECT asset_a, asset_b, relation, confidence
             FROM asset_relations WHERE group_key = ?1",
        )?;
        let edges: Vec<(String, String, String, f64)> = stmt
            .query_map([&key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();

        if edges.is_empty() {
            continue;
        }

        let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut dominant = "same_stem".to_string();
        let mut max_conf = 0.0_f64;

        for (a, b, rel, conf) in &edges {
            ids.insert(a.clone());
            ids.insert(b.clone());
            if *conf > max_conf {
                max_conf = *conf;
                dominant = rel.clone();
            }
        }

        let mut members: Vec<String> = ids.into_iter().collect();
        members.sort_unstable();

        groups.push(RelationGroup {
            group_key:  key,
            relation:   dominant,
            asset_ids:  members,
            confidence: max_conf,
        });
    }

    Ok(groups)
}

fn row_to_relation(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetRelation> {
    Ok(AssetRelation {
        id:          row.get(0)?,
        asset_a:     row.get(1)?,
        asset_b:     row.get(2)?,
        relation:    row.get(3)?,
        confidence:  row.get(4)?,
        group_key:   row.get(5)?,
        detected_at: row.get(6)?,
    })
}

// ── Core detection ────────────────────────────────────────────────────────────

/// Rebuild the entire relation graph from scratch.
///
/// 1. Drops all existing `asset_relations` rows.
/// 2. Parses all assets.
/// 3. Emits suffix-based edges (version / platform / component / same_stem).
/// 4. Emits co-location edges (same folder + same stem, different extension).
///
/// Intended to be called inside `tokio::task::spawn_blocking`.
pub fn rebuild_relation_graph(db: &Arc<Mutex<Connection>>) -> Result<RelationGraphStats, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let start = Instant::now();

    // ── Load all assets ───────────────────────────────────────────────────────
    let assets: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, file_name, extension, folder FROM assets")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?;
        let result: Vec<_> = rows.filter_map(|r| r.ok()).collect();
        result
    };

    let parsed: Vec<ParsedStem> = assets
        .iter()
        .map(|(id, name, ext, folder)| parse_stem(id, name, ext, folder))
        .collect();

    // ── Suffix groups (folder || base) ────────────────────────────────────────
    let mut suffix_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in parsed.iter().enumerate() {
        if p.base.is_empty() {
            continue;
        }
        let key = format!("{}||{}", p.folder, p.base);
        suffix_groups.entry(key).or_default().push(i);
    }

    // ── Co-location groups (folder || raw_stem) ───────────────────────────────
    let mut coloc_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in parsed.iter().enumerate() {
        if p.raw_stem.is_empty() {
            continue;
        }
        let key = format!("{}||{}", p.folder, p.raw_stem);
        coloc_groups.entry(key).or_default().push(i);
    }

    // ── Wipe existing relations ───────────────────────────────────────────────
    conn.execute("DELETE FROM asset_relations", [])
        .map_err(|e| e.to_string())?;

    let mut edges_created = 0usize;
    let mut group_count   = 0usize;
    let mut linked: std::collections::HashSet<&str> = std::collections::HashSet::new();

    // ── Emit suffix-based edges ───────────────────────────────────────────────
    for (gk, members) in &suffix_groups {
        if members.len() < 2 {
            continue;
        }
        group_count += 1;

        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let pa = &parsed[members[i]];
                let pb = &parsed[members[j]];
                let (rel, conf) = edge_label(&pa.kind, &pb.kind);
                let (a, b) = canonical(&pa.asset_id, &pb.asset_id);

                conn.execute(
                    "INSERT OR IGNORE INTO asset_relations
                         (asset_a, asset_b, relation, confidence, group_key, detected_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
                    params![a, b, rel, conf, gk],
                )
                .map_err(|e| e.to_string())?;

                edges_created += 1;
                linked.insert(&pa.asset_id);
                linked.insert(&pb.asset_id);
            }
        }
    }

    // ── Emit co-location edges ────────────────────────────────────────────────
    for (gk, members) in &coloc_groups {
        if members.len() < 2 {
            continue;
        }
        // Only emit when at least two different extensions are present.
        let exts: std::collections::HashSet<&str> =
            members.iter().map(|&i| assets[i].2.as_str()).collect();
        if exts.len() < 2 {
            continue;
        }

        group_count += 1;
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let ai = &assets[members[i]];
                let aj = &assets[members[j]];
                if ai.2 == aj.2 {
                    continue; // same extension → skip
                }
                let (a, b) = canonical(&ai.0, &aj.0);

                conn.execute(
                    "INSERT OR IGNORE INTO asset_relations
                         (asset_a, asset_b, relation, confidence, group_key, detected_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
                    params![a, b, "co_location", 0.95_f64, gk],
                )
                .map_err(|e| e.to_string())?;

                edges_created += 1;
                linked.insert(&ai.0);
                linked.insert(&aj.0);
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    tracing::info!(
        edges = edges_created,
        groups = group_count,
        assets = linked.len(),
        ms = duration_ms,
        "relation graph rebuilt"
    );

    Ok(RelationGraphStats {
        edges_created,
        groups:        group_count,
        assets_linked: linked.len(),
        duration_ms,
    })
}

/// Incremental refresh: redetect relations only for assets under `root_path`.
///
/// Deletes existing edges where **both** endpoints are in the root subtree,
/// then re-emits edges for those assets.  Cross-root edges (one endpoint
/// outside `root_path`) are preserved unchanged.
pub fn refresh_relations_for_root(
    db: &Arc<Mutex<Connection>>,
    root_path: &str,
) -> Result<usize, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let like_pat = format!("{}%", root_path);

    // Load assets in this subtree.
    let assets: Vec<(String, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, file_name, extension, folder FROM assets
                 WHERE folder = ?1 OR folder LIKE ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![root_path, like_pat], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?;
        let result: Vec<_> = rows.filter_map(|r| r.ok()).collect();
        result
    };

    if assets.is_empty() {
        return Ok(0);
    }

    // Build a safe SQL IN-list (IDs are UUIDs so only hex + hyphens).
    let ids_sql: String = assets
        .iter()
        .map(|a| format!("'{}'", a.0.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");

    conn.execute_batch(&format!(
        "DELETE FROM asset_relations
         WHERE asset_a IN ({ids}) AND asset_b IN ({ids})",
        ids = ids_sql,
    ))
    .map_err(|e| e.to_string())?;

    let parsed: Vec<ParsedStem> = assets
        .iter()
        .map(|(id, name, ext, folder)| parse_stem(id, name, ext, folder))
        .collect();

    let mut suffix_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in parsed.iter().enumerate() {
        if p.base.is_empty() {
            continue;
        }
        let key = format!("{}||{}", p.folder, p.base);
        suffix_groups.entry(key).or_default().push(i);
    }

    let mut coloc_groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in parsed.iter().enumerate() {
        if p.raw_stem.is_empty() {
            continue;
        }
        let key = format!("{}||{}", p.folder, p.raw_stem);
        coloc_groups.entry(key).or_default().push(i);
    }

    let mut edges = 0usize;

    for (gk, members) in &suffix_groups {
        if members.len() < 2 {
            continue;
        }
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let pa = &parsed[members[i]];
                let pb = &parsed[members[j]];
                let (rel, conf) = edge_label(&pa.kind, &pb.kind);
                let (a, b) = canonical(&pa.asset_id, &pb.asset_id);

                let _ = conn.execute(
                    "INSERT OR IGNORE INTO asset_relations
                         (asset_a, asset_b, relation, confidence, group_key, detected_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
                    params![a, b, rel, conf, gk],
                );
                edges += 1;
            }
        }
    }

    for (gk, members) in &coloc_groups {
        if members.len() < 2 {
            continue;
        }
        let exts: std::collections::HashSet<&str> =
            members.iter().map(|&i| assets[i].2.as_str()).collect();
        if exts.len() < 2 {
            continue;
        }
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                let ai = &assets[members[i]];
                let aj = &assets[members[j]];
                if ai.2 == aj.2 {
                    continue;
                }
                let (a, b) = canonical(&ai.0, &aj.0);
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO asset_relations
                         (asset_a, asset_b, relation, confidence, group_key, detected_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
                    params![a, b, "co_location", 0.95_f64, gk],
                );
                edges += 1;
            }
        }
    }

    tracing::info!(root = %root_path, edges, "relation graph refreshed for root");
    Ok(edges)
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ps(name: &str, ext: &str, folder: &str) -> ParsedStem {
        parse_stem("test-id", name, ext, folder)
    }

    #[test]
    fn detects_component_family() {
        let a = ps("button_primary.png", "png", "/design");
        let b = ps("button_secondary.png", "png", "/design");
        assert_eq!(a.base, "button");
        assert_eq!(a.kind, StemKind::ComponentFamily);
        assert_eq!(b.base, "button");
        assert_eq!(b.kind, StemKind::ComponentFamily);
        let (rel, conf) = edge_label(&a.kind, &b.kind);
        assert_eq!(rel, "component_family");
        assert!(conf >= 0.90);
    }

    #[test]
    fn detects_version() {
        let a = ps("login_v1.png", "png", "/screens");
        let b = ps("login_v2.png", "png", "/screens");
        assert_eq!(a.base, "login");
        assert_eq!(a.kind, StemKind::Version);
        assert_eq!(b.base, "login");
        let (rel, _) = edge_label(&a.kind, &b.kind);
        assert_eq!(rel, "version");
    }

    #[test]
    fn detects_platform_variant() {
        let a = ps("icon_mobile.svg", "svg", "/icons");
        let b = ps("icon_web.svg", "svg", "/icons");
        assert_eq!(a.base, "icon");
        assert_eq!(a.kind, StemKind::PlatformVariant);
        let (rel, _) = edge_label(&a.kind, &b.kind);
        assert_eq!(rel, "platform_variant");
    }

    #[test]
    fn colocation_uses_raw_stem() {
        // hero.png and hero.svg — same stem, different extension
        let a = ps("hero.png", "png", "/assets");
        let b = ps("hero.svg", "svg", "/assets");
        assert_eq!(a.raw_stem, "hero");
        assert_eq!(b.raw_stem, "hero");
        assert_eq!(a.folder, b.folder);
        // raw_stems are equal → will be grouped for co-location
        assert_eq!(a.raw_stem, b.raw_stem);
    }

    #[test]
    fn cross_folder_different_group_keys() {
        let a = ps("button_primary.png", "png", "/design/web");
        let b = ps("button_secondary.png", "png", "/design/mobile");
        // Different folders = different group keys → no shared group
        assert_ne!(
            format!("{}||{}", a.folder, a.base),
            format!("{}||{}", b.folder, b.base)
        );
    }

    #[test]
    fn single_token_not_stripped() {
        // "mobile.svg" → single token; should NOT become base="" after stripping
        let p = ps("mobile.svg", "svg", "/icons");
        assert_eq!(p.raw_stem, "mobile");
        assert_eq!(p.base, "mobile");
        assert_eq!(p.kind, StemKind::Plain);
    }

    #[test]
    fn cross_kind_edge_is_same_stem() {
        let a = ps("banner_v1.jpg", "jpg", "/marketing");
        let b = ps("banner_primary.jpg", "jpg", "/marketing");
        // a is Version, b is ComponentFamily → cross-kind → same_stem
        let (rel, _) = edge_label(&a.kind, &b.kind);
        assert_eq!(rel, "same_stem");
    }

    #[test]
    fn dash_separator() {
        let p = ps("button-primary.png", "png", "/design");
        assert_eq!(p.base, "button");
        assert_eq!(p.kind, StemKind::ComponentFamily);
    }

    #[test]
    fn is_version_patterns() {
        for tok in &["v1", "v2", "v10", "1", "02", "r1", "final", "beta", "rc"] {
            assert!(is_version(tok), "expected version: {tok}");
        }
        for tok in &["icon", "primary", "mobile", "vx"] {
            assert!(!is_version(tok), "expected NOT version: {tok}");
        }
    }

    #[test]
    fn canonical_ordering() {
        let (a, b) = canonical("zzz", "aaa");
        assert!(a <= b);
        let (a, b) = canonical("aaa", "zzz");
        assert!(a <= b);
    }

    #[test]
    fn component_with_multi_word_base() {
        // "card_header_dark" → base = "card_header", kind = ComponentFamily
        let p = ps("card_header_dark.png", "png", "/design");
        assert_eq!(p.base, "card_header");
        assert_eq!(p.kind, StemKind::ComponentFamily);
    }
}
