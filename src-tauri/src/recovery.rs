//! Broken file-path recovery engine.
//!
//! When a watched asset is moved or renamed outside of the app, its stored
//! `file_path` becomes stale.  This module provides three complementary
//! strategies to locate the file's new location, ordered by confidence:
//!
//! | Strategy           | Confidence | Trigger                                          |
//! |--------------------|------------|--------------------------------------------------|
//! | Hash match         | 1.00       | SHA-256 of first 512 KB matches stored hash      |
//! | Same-folder probe  | 0.90       | Exact filename still exists in original folder   |
//! |                    | 0.75       | Same stem + same extension in original folder    |
//! | Name similarity    | ≤ 0.85     | Jaro-Winkler ≥ 0.80 across watched folders      |
//!
//! # Algorithm
//!
//! 1. `detect_broken_paths`  — parallel stat() every stored `file_path`.
//! 2. `build_inventory`      — single WalkDir pass over all watched folders.
//! 3. `find_candidates`      — for each broken asset, run all three strategies
//!                             against the in-memory inventory, ranked by
//!                             confidence descending, top-5 per strategy.
//! 4. `apply_recovery`       — verify path, re-stat, re-hash, UPDATE + FTS.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::file_types::is_supported;
use crate::hasher::hash_file;
use crate::models::Asset;

// ── Public types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryStrategy {
    /// SHA-256 hash match — highest confidence.
    Hash,
    /// File located in the asset's original parent folder.
    SameFolder,
    /// Jaro-Winkler filename similarity across all watched folders.
    NameSimilarity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryCandidate {
    /// Absolute path of the candidate file on disk.
    pub new_path:   String,
    /// Confidence score 0.0 – 1.0.
    pub confidence: f32,
    pub strategy:   RecoveryStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokenAsset {
    /// The stale asset record.
    pub asset:      Asset,
    /// Ranked recovery candidates (best first).  May be empty if no match
    /// was found; the user can still provide a path manually.
    pub candidates: Vec<RecoveryCandidate>,
}

// ── Jaro-Winkler similarity (no external crate required) ─────────────────────

fn jaro(s1: &str, s2: &str) -> f64 {
    if s1 == s2 { return 1.0; }

    let s1c: Vec<char> = s1.chars().collect();
    let s2c: Vec<char> = s2.chars().collect();
    let (l1, l2) = (s1c.len(), s2c.len());
    if l1 == 0 || l2 == 0 { return 0.0; }

    let win = (l1.max(l2) / 2).saturating_sub(1);
    let mut m1 = vec![false; l1];
    let mut m2 = vec![false; l2];
    let mut matches = 0usize;

    for i in 0..l1 {
        let lo = i.saturating_sub(win);
        let hi = (i + win + 1).min(l2);
        for j in lo..hi {
            if m2[j] || s1c[i] != s2c[j] { continue; }
            m1[i] = true; m2[j] = true; matches += 1; break;
        }
    }
    if matches == 0 { return 0.0; }

    let mut transpos = 0usize;
    let mut k = 0;
    for i in 0..l1 {
        if !m1[i] { continue; }
        while !m2[k] { k += 1; }
        if s1c[i] != s2c[k] { transpos += 1; }
        k += 1;
    }

    let m = matches as f64;
    let t = (transpos / 2) as f64;
    (m / l1 as f64 + m / l2 as f64 + (m - t) / m) / 3.0
}

fn jaro_winkler(s1: &str, s2: &str) -> f64 {
    let j = jaro(s1, s2);
    let c1: Vec<char> = s1.chars().collect();
    let c2: Vec<char> = s2.chars().collect();
    let prefix = c1.iter().zip(c2.iter()).take(4).take_while(|(a, b)| a == b).count() as f64;
    j + prefix * 0.1 * (1.0 - j)
}

// ── Inventory entry (one discovered file) ────────────────────────────────────

struct FileEntry {
    path:      PathBuf,
    file_name: String,  // "hero.png"
    #[allow(dead_code)]
    stem:      String,  // "hero" — reserved for future stem-prefix matching
    extension: String,  // "png"
    file_size: i64,
}

/// Walk all watched folders once and return every supported file.
fn build_inventory(watched_folders: &[String]) -> Vec<FileEntry> {
    watched_folders
        .iter()
        .flat_map(|folder| {
            WalkDir::new(folder)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file() && is_supported(e.path()))
                .filter_map(|e| {
                    let path      = e.path().to_path_buf();
                    let file_name = path.file_name()?.to_str()?.to_string();
                    let stem      = path.file_stem()?.to_str()?.to_string();
                    let extension = path.extension()
                        .and_then(|x| x.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let file_size = std::fs::metadata(&path)
                        .map(|m| m.len() as i64)
                        .unwrap_or(-1);
                    Some(FileEntry { path, file_name, stem, extension, file_size })
                })
        })
        .collect()
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Scan the database and return every asset whose `file_path` no longer
/// exists on disk.  Uses Rayon for parallel `stat()` calls.
pub fn detect_broken_paths(db: Arc<Mutex<Connection>>) -> Result<Vec<Asset>, String> {
    let all: Vec<Asset> = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, file_name, extension, folder,
                    modified_at, created_at, file_size, hash,
                    thumbnail_path, favorite, indexed_at
             FROM assets",
        ).map_err(|e| e.to_string())?;

        let result: Vec<Asset> = stmt
            .query_map([], |row| {
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
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    // Parallel file-existence check — one stat() per asset.
    let broken: Vec<Asset> = all
        .into_par_iter()
        .filter(|a| !Path::new(&a.file_path).exists())
        .collect();

    Ok(broken)
}

/// For each broken asset, search the watched folders for recovery candidates.
///
/// Performs ONE WalkDir pass across all watched folders, then matches all
/// three strategies against the in-memory inventory.  No redundant I/O.
pub fn find_candidates(broken: &[Asset], watched_folders: &[String]) -> Vec<BrokenAsset> {
    if broken.is_empty() {
        return vec![];
    }

    let inventory = if watched_folders.is_empty() {
        vec![]
    } else {
        build_inventory(watched_folders)
    };

    // Pre-build lookup indexes so strategies can run in O(1) / O(k) time:
    //   size_ext_idx:  (file_size, extension) → Vec<inventory index>
    //   ext_idx:       extension → Vec<inventory index>
    let mut size_ext_idx: HashMap<(i64, String), Vec<usize>> = HashMap::new();
    let mut ext_idx:      HashMap<String, Vec<usize>> = HashMap::new();

    for (i, e) in inventory.iter().enumerate() {
        if e.file_size >= 0 {
            size_ext_idx.entry((e.file_size, e.extension.clone())).or_default().push(i);
        }
        ext_idx.entry(e.extension.clone()).or_default().push(i);
    }

    broken.iter().map(|asset| {
        let mut candidates: Vec<RecoveryCandidate> = Vec::new();
        let asset_ext = asset.extension.to_lowercase();

        // ── Strategy 1 — exact hash match ──────────────────────────────────
        // Pre-filter by (size, extension) to avoid hashing unrelated files.
        if let Some(ref stored_hash) = asset.hash {
            let key = (asset.file_size, asset_ext.clone());
            if let Some(indices) = size_ext_idx.get(&key) {
                'hash_loop: for &idx in indices {
                    let entry = &inventory[idx];
                    // Skip the broken path itself.
                    if entry.path.to_string_lossy() == asset.file_path { continue; }
                    if let Some(computed_hash) = hash_file(&entry.path) {
                        if &computed_hash == stored_hash {
                            candidates.push(RecoveryCandidate {
                                new_path:   entry.path.to_string_lossy().into_owned(),
                                confidence: 1.0,
                                strategy:   RecoveryStrategy::Hash,
                            });
                            // Hash is globally unique — stop after first match.
                            break 'hash_loop;
                        }
                    }
                }
            }
        }

        // ── Strategy 2 — same-folder probe ─────────────────────────────────
        //
        // Only run when hash strategy did not produce a definitive result
        // (or the asset has no stored hash).
        let has_hash_match = candidates.iter().any(|c| c.strategy == RecoveryStrategy::Hash);
        if !has_hash_match {
            let original_dir = Path::new(&asset.folder);
            if original_dir.is_dir() {
                // 2a. Exact filename still present (file was perhaps a temporary
                //     "missing" because the folder was temporarily unmounted).
                let exact = original_dir.join(&asset.file_name);
                if exact.exists() && exact.to_string_lossy() != asset.file_path {
                    candidates.push(RecoveryCandidate {
                        new_path:   exact.to_string_lossy().into_owned(),
                        confidence: 0.90,
                        strategy:   RecoveryStrategy::SameFolder,
                    });
                }

                // 2b. Same stem, same extension — covers simple numbering renames
                //     like "hero.png" → "hero (1).png" OR "hero_final.png".
                let asset_stem = Path::new(&asset.file_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                if let Ok(dir_iter) = std::fs::read_dir(original_dir) {
                    for entry in dir_iter.flatten() {
                        let ep  = entry.path();
                        if !ep.is_file() { continue; }
                        let ep_name = ep.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        // Skip exact name (covered above) and broken path.
                        if ep_name == asset.file_name || ep.to_string_lossy() == asset.file_path {
                            continue;
                        }
                        let ep_stem = ep.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                        let ep_ext  = ep.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                        if ep_ext == asset_ext
                            && ep_stem.starts_with(&asset_stem)
                            && !candidates.iter().any(|c| c.new_path == ep.to_string_lossy().as_ref())
                        {
                            candidates.push(RecoveryCandidate {
                                new_path:   ep.to_string_lossy().into_owned(),
                                confidence: 0.75,
                                strategy:   RecoveryStrategy::SameFolder,
                            });
                        }
                    }
                }
            }
        }

        // ── Strategy 3 — Jaro-Winkler filename similarity ──────────────────
        // Skip when a hash match was already found.
        if !has_hash_match {
            let name_lower = asset.file_name.to_lowercase();
            if let Some(ext_entries) = ext_idx.get(&asset_ext) {
                let mut sim_cands: Vec<RecoveryCandidate> = ext_entries
                    .iter()
                    .filter_map(|&idx| {
                        let entry = &inventory[idx];
                        let ep_str = entry.path.to_string_lossy();
                        // Skip broken path and anything already in candidates.
                        if ep_str == asset.file_path { return None; }
                        if candidates.iter().any(|c| c.new_path == ep_str.as_ref()) { return None; }

                        let sim = jaro_winkler(&name_lower, &entry.file_name.to_lowercase());
                        if sim >= 0.80 {
                            Some(RecoveryCandidate {
                                new_path:   ep_str.into_owned(),
                                confidence: (sim as f32 * 0.85).min(0.85),
                                strategy:   RecoveryStrategy::NameSimilarity,
                            })
                        } else {
                            None
                        }
                    })
                    .collect();

                // Keep top-5 by confidence.
                sim_cands.sort_unstable_by(|a, b| {
                    b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal)
                });
                sim_cands.truncate(5);
                candidates.extend(sim_cands);
            }
        }

        // Sort all candidates: highest confidence first.
        candidates.sort_unstable_by(|a, b| {
            b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal)
        });

        // Deduplicate by path (can arise if folder-probe and similarity both find the same file).
        candidates.dedup_by(|a, b| a.new_path == b.new_path);

        BrokenAsset { asset: asset.clone(), candidates }
    })
    .collect()
}

/// Apply a recovery: update the asset's path and all derived metadata in DB.
///
/// SQLite `UPDATE` triggers automatically keep `assets_fts` in sync — no
/// manual FTS manipulation required.
///
/// Returns the refreshed `Asset` row.
pub fn apply_recovery(
    db:       Arc<Mutex<Connection>>,
    id:       &str,
    new_path: &str,
) -> Result<Asset, String> {
    let new_p = Path::new(new_path);
    if !new_p.exists() {
        return Err(format!("Recovery path does not exist on disk: {new_path}"));
    }

    let meta = std::fs::metadata(new_p).map_err(|e| e.to_string())?;

    let file_name       = new_p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let file_name_lower = file_name.to_lowercase();
    let extension       = new_p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let folder          = new_p.parent().and_then(|p| p.to_str()).unwrap_or("").to_string();
    let modified_at     = meta.modified().ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let file_size = meta.len() as i64;

    // Re-hash before holding the DB lock (I/O-intensive).
    let new_hash = hash_file(new_p);
    let now      = Utc::now().timestamp();

    let conn = db.lock().map_err(|e| e.to_string())?;

    // The UPDATE trigger on `assets` automatically fires:
    //   assets_fts_au → deletes old FTS row, inserts new one.
    conn.execute(
        "UPDATE assets SET
             file_path       = ?1,
             file_name       = ?2,
             file_name_lower = ?3,
             extension       = ?4,
             folder          = ?5,
             modified_at     = ?6,
             file_size       = ?7,
             hash            = ?8,
             indexed_at      = ?9
         WHERE id = ?10",
        params![
            new_path,
            file_name,
            file_name_lower,
            extension,
            folder,
            modified_at,
            file_size,
            new_hash,
            now,
            id,
        ],
    ).map_err(|e| e.to_string())?;

    // Return the fully-refreshed row.
    conn.query_row(
        "SELECT id, file_path, file_name, extension, folder,
                modified_at, created_at, file_size, hash,
                thumbnail_path, favorite, indexed_at
         FROM assets WHERE id = ?1",
        params![id],
        |row| {
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
        },
    ).map_err(|e| e.to_string())
}
