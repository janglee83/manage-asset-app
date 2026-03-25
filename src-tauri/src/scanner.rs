//! Production-ready folder scanner.
//!
//! Design goals:
//!  - Skip unchanged files (modified_at + size unchanged → no re-hash)
//!  - Batched SQLite transactions (200 files per commit → ~100× faster)
//!  - Rate-limited progress events (max 1 per 150 ms → no UI flooding)
//!  - Per-file error collection (one bad file never aborts the whole scan)
//!  - Typed errors via `ScanError`
//!  - Fully async-safe: runs inside `tokio::task::spawn_blocking`

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use chrono::Utc;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use walkdir::WalkDir;

use rayon::prelude::*;

use crate::file_types::{is_design_file, is_supported};
use crate::hasher::hash_file;
use crate::models::{FileError, ScanProgress, ScanResult};
use crate::thumbnail::generate_thumbnail;
use crate::ignore::should_ignore_path;

// ── Error type ────────────────────────────────────────────────────────────────

/// Errors that can abort the entire scan (distinct from per-file errors).
#[derive(Debug)]
pub enum ScanError {
    Io(std::io::Error),
    Database(rusqlite::Error),
    LockPoisoned,
}

impl std::fmt::Display for ScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScanError::Io(e) => write!(f, "I/O error: {e}"),
            ScanError::Database(e) => write!(f, "Database error: {e}"),
            ScanError::LockPoisoned => write!(f, "Database mutex was poisoned"),
        }
    }
}

impl From<rusqlite::Error> for ScanError {
    fn from(e: rusqlite::Error) -> Self {
        ScanError::Database(e)
    }
}

impl From<std::io::Error> for ScanError {
    fn from(e: std::io::Error) -> Self {
        ScanError::Io(e)
    }
}

impl From<ScanError> for String {
    fn from(e: ScanError) -> Self {
        e.to_string()
    }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Commit a transaction every N files to balance speed vs. latency.
const BATCH_SIZE: usize = 200;

/// Minimum wall-clock gap between progress events emitted to the frontend.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Score a path for priority ordering (higher = process first).
/// Design files in design-named folders get the highest priority.
fn priority_score(path: &Path, now_secs: u64, mtime: u64) -> u64 {
    let is_design = path.ancestors()
        .filter_map(|p| p.file_name())
        .any(|n| {
            let s = n.to_string_lossy().to_lowercase();
            matches!(s.as_str(), "designs" | "design" | "assets" | "ui" | "ux"
                | "mockups" | "mockup" | "wireframes" | "exports" | "screens")
        });
    let age = now_secs.saturating_sub(mtime);
    // Recency score: 0 = brand-new, 1_000_000 = ≥ 1 week old
    let recency_score: u64 = (1_000_000_u64).saturating_sub(age.min(1_000_000));
    let design_bonus: u64 = if is_design_file(path) { 2_000_000 } else { 0 };
    let design_folder_bonus: u64 = if is_design { 1_000_000 } else { 0 };
    recency_score + design_bonus + design_folder_bonus
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Scan `folder_path` recursively, insert/update matching files in SQLite.
///
/// Runs synchronously — intended to be called inside `tokio::task::spawn_blocking`.
/// Progress is emitted to the frontend via the `"scan_progress"` Tauri event.
pub fn scan_folder(
    folder_path: &Path,
    db: Arc<Mutex<Connection>>,
    cache_dir: &Path,
    app_handle: &AppHandle,
) -> Result<ScanResult, ScanError> {
    let start = Instant::now();
    let now_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // ── Step 1: collect candidate paths ──────────────────────────────────────
    // WalkDir errors (permission denied etc.) are logged per-entry and skipped.
    // Directories matching the smart-ignore list are pruned immediately so their
    // contents (potentially millions of files in node_modules) are never walked.
    let mut all_files: Vec<(PathBuf, u64 /* priority */)> = WalkDir::new(folder_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.file_type().is_dir() {
                !should_ignore_path(e.path())
            } else {
                true
            }
        })
        .filter_map(|entry| match entry {
            Ok(e) if e.file_type().is_file() => Some(e.path().to_path_buf()),
            Ok(_) => None,
            Err(e) => {
                eprintln!("[scanner] walk error: {e}");
                None
            }
        })
        .filter(|p| !should_ignore_path(p) && is_supported(p))
        .map(|p| {
            let mtime = std::fs::metadata(&p)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let score = priority_score(&p, now_secs, mtime);
            (p, score)
        })
        .collect();

    // Sort: highest priority first (recent design files trump everything).
    all_files.sort_unstable_by(|a, b| b.1.cmp(&a.1));

    let all_files: Vec<PathBuf> = all_files.into_iter().map(|(p, _)| p).collect();
    let total = all_files.len();

    // ── Step 2: load already-indexed state for skip detection ─────────────────
    // Single query fetches (file_path, modified_at, file_size) for ALL files
    // currently stored under this folder prefix — avoids N+1 DB reads.
    let already_indexed = load_existing_index(&db, folder_path)?;

    // ── Step 3: process files in batches ──────────────────────────────────────
    //
    // Each batch runs three phases so that the DB mutex is held only during
    // the brief final write step:
    //   A. Stat + skip-detection (serial, no I/O beyond stat())
    //   B. Hash + thumbnail        (parallel via rayon, no DB lock)
    //   C. Batch upsert            (serial, lock acquired once per batch)

    let mut indexed: usize = 0;
    let mut skipped: usize = 0;
    let mut file_errors: Vec<FileError> = Vec::new();
    let mut last_event = Instant::now()
        .checked_sub(PROGRESS_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut processed: usize = 0;

    // Emit initial zero-progress event so the UI shows the progress bar.
    emit_progress(app_handle, 0, total, "", false);

    for chunk in all_files.chunks(BATCH_SIZE) {
        // ── Phase A: metadata stat + skip detection ───────────────────────────
        struct FileMeta {
            path:            PathBuf,
            path_str:        String,
            file_name:       String,
            file_name_lower: String,
            extension:       String,
            folder:          String,
            modified_at:     i64,
            created_at:      i64,
            file_size:       i64,
        }

        let mut to_process: Vec<FileMeta> = Vec::with_capacity(chunk.len());
        for file_path in chunk {
            let meta = match std::fs::metadata(file_path) {
                Ok(m) => m,
                Err(e) => {
                    file_errors.push(FileError {
                        path:  file_path.display().to_string(),
                        error: format!("metadata: {e}"),
                    });
                    continue;
                }
            };

            let modified_at = system_time_to_unix(meta.modified().ok()).unwrap_or(0);
            let created_at  = system_time_to_unix(meta.created().ok()).unwrap_or(modified_at);
            let file_size   = meta.len() as i64;
            let path_str    = file_path.to_string_lossy().to_string();

            // Skip-if-unchanged
            if let Some(&(existing_mtime, existing_size)) = already_indexed.get(&path_str) {
                if existing_mtime == modified_at && existing_size == file_size {
                    skipped += 1;
                    continue;
                }
            }

            let file_name       = file_name_str(file_path);
            let file_name_lower = file_name.to_lowercase();
            let extension = file_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let folder = file_path
                .parent()
                .and_then(|p| p.to_str())
                .unwrap_or("")
                .to_string();

            to_process.push(FileMeta {
                path: file_path.clone(),
                path_str,
                file_name,
                file_name_lower,
                extension,
                folder,
                modified_at,
                created_at,
                file_size,
            });
        }

        // ── Phase B: parallel hash + thumbnail (no DB lock held) ──────────────
        // rayon distributes CPU/I-O work across all cores.  With cache-hit fast
        // paths in generate_thumbnail this phase is nearly free on re-scans.
        struct Computed {
            meta:  FileMeta,
            hash:  Option<String>,
            thumb: Option<String>,
        }

        let computed: Vec<Computed> = to_process
            .into_par_iter()
            .map(|meta| {
                let hash  = hash_file(&meta.path);
                let thumb = generate_thumbnail(&meta.path, cache_dir)
                    .and_then(|p| p.to_str().map(str::to_string));
                Computed { meta, hash, thumb }
            })
            .collect();

        // ── Phase C: batch upsert (lock acquired once, held only for writes) ──
        let conn = db.lock().map_err(|_| ScanError::LockPoisoned)?;
        conn.execute_batch("BEGIN")?;

        let now = Utc::now().timestamp();
        for c in &computed {
            match conn.execute(
                r#"
                INSERT INTO assets
                    (id, file_path, file_name, file_name_lower, extension, folder,
                     modified_at, created_at, file_size, hash, thumbnail_path, indexed_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(file_path) DO UPDATE SET
                    file_name       = excluded.file_name,
                    file_name_lower = excluded.file_name_lower,
                    extension       = excluded.extension,
                    folder          = excluded.folder,
                    modified_at     = excluded.modified_at,
                    created_at      = excluded.created_at,
                    file_size       = excluded.file_size,
                    hash            = excluded.hash,
                    thumbnail_path  = COALESCE(excluded.thumbnail_path, thumbnail_path),
                    indexed_at      = excluded.indexed_at
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    c.meta.path_str,
                    c.meta.file_name,
                    c.meta.file_name_lower,
                    c.meta.extension,
                    c.meta.folder,
                    c.meta.modified_at,
                    c.meta.created_at,
                    c.meta.file_size,
                    c.hash,
                    c.thumb,
                    now,
                ],
            ) {
                Ok(_) => indexed += 1,
                Err(e) => file_errors.push(FileError {
                    path:  c.meta.path_str.clone(),
                    error: format!("db upsert: {e}"),
                }),
            }
        }

        if let Err(e) = conn.execute_batch("COMMIT") {
            eprintln!("[scanner] batch commit failed: {e}");
            let _ = conn.execute_batch("ROLLBACK");
        }
        drop(conn);

        processed += chunk.len();

        // Rate-limited progress event
        if last_event.elapsed() >= PROGRESS_INTERVAL {
            let last_name = computed.last().map(|c| c.meta.file_name.as_str()).unwrap_or("");
            emit_progress(app_handle, processed, total, last_name, false);
            last_event = Instant::now();
        }
    }

    // ── Step 4: final progress event ─────────────────────────────────────────
    emit_progress(app_handle, total, total, "", true);

    Ok(ScanResult {
        indexed,
        skipped,
        errors: file_errors.len(),
        error_details: file_errors,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Loads `(file_path → (modified_at, file_size))` for every asset whose
/// `folder` starts with `prefix`. Single query; used for skip-detection.
fn load_existing_index(
    db: &Arc<Mutex<Connection>>,
    prefix: &Path,
) -> Result<HashMap<String, (i64, i64)>, ScanError> {
    // Two-branch WHERE covers:
    //   - exact match:  folder = '/path/to/Photos'
    //   - child match:  folder LIKE '/path/to/Photos/%'
    // The trailing '/' prevents '/path/to/PhotosExtra' from matching.
    // idx_assets_folder covers both branches.
    let exact   = prefix.to_string_lossy().to_string();
    let subtree = format!("{}/", exact);
    let conn = db.lock().map_err(|_| ScanError::LockPoisoned)?;
    let mut stmt = conn.prepare(
        "SELECT file_path, modified_at, file_size \
         FROM assets WHERE folder = ?1 OR folder LIKE ?2 || '%'",
    )?;
    let map = stmt
        .query_map(params![exact, subtree], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?
        .filter_map(|r| r.ok())
        .map(|(path, mtime, size)| (path, (mtime, size)))
        .collect();
    Ok(map)
}

/// Extract filename as `&str`, falling back to empty string on non-UTF-8 paths.
fn file_name_str(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}

/// Convert `Option<SystemTime>` to `Option<i64>` unix seconds.
fn system_time_to_unix(t: Option<SystemTime>) -> Option<i64> {
    t.and_then(|st| st.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// Emit a `scan_progress` event; silently ignores emit failures.
fn emit_progress(app: &AppHandle, scanned: usize, total: usize, current: &str, done: bool) {
    let _ = app.emit(
        "scan_progress",
        ScanProgress {
            scanned,
            total,
            current_file: current.to_string(),
            done,
        },
    );
}

// ── Folder management ─────────────────────────────────────────────────────────

/// Persist a folder path to `watched_folders` (idempotent).
pub fn add_watched_folder(db: Arc<Mutex<Connection>>, folder_path: &str) -> Result<(), ScanError> {
    let conn = db.lock().map_err(|_| ScanError::LockPoisoned)?;
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO watched_folders (path, added_at) VALUES (?1, ?2)",
        params![folder_path, now],
    )?;
    Ok(())
}

/// Return all persisted folder paths ordered by insertion time.
pub fn get_watched_folders(db: Arc<Mutex<Connection>>) -> Result<Vec<String>, ScanError> {
    let conn = db.lock().map_err(|_| ScanError::LockPoisoned)?;
    let mut stmt =
        conn.prepare("SELECT path FROM watched_folders ORDER BY added_at ASC")?;
    let folders = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(folders)
}

