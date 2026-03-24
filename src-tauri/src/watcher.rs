/// Production-grade file watcher.
///
/// Design:
/// ─────────────────────────────────────────────────────────────────────────────
/// notify thread  ──raw events──▶  crossbeam channel  ──▶  debounce thread
///                                                              │
///                         HashMap<PathBuf, PendingEvent>  ◀───┘
///                         (deduplicates within DEBOUNCE window)
///                                   │
///                         on expiry: flush to SQLite + emit Tauri event
/// ─────────────────────────────────────────────────────────────────────────────
///
/// Debounce window: 500 ms.  Events for the same path within the window are
/// coalesced: whichever arrives last wins, except that a Remove always wins
/// over Create/Modify (the file is gone regardless).
///
/// Windows stability:
///  • Temp files are silently skipped (see `is_transient`).
///  • notify `Config::with_poll_interval` tunes the poll fallback to 2 s on
///    platforms without native inotify/kqueue/ReadDirectoryChangesW.
///  • ACCESS events (common on Windows when apps open/read files) are dropped.
///
/// Thread safety:
///  • `WatcherHandle` contains only `Arc`/`Sender` types – `Send + Sync`.
///  • The SQLite `Arc<Mutex<Connection>>` is locked for one statement at a time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crossbeam_channel::{bounded, select, tick, Receiver, Sender};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use chrono::Utc;

use crate::file_types::is_scan_target;
use crate::hasher::hash_file;
use crate::thumbnail::generate_thumbnail;

// ─── Constants ───────────────────────────────────────────────────────────────

/// How long after the last event for a given path we wait before acting.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// How often the debounce thread wakes up to flush expired entries.
const TICK: Duration = Duration::from_millis(100);

// ─── Control messages sent to the watcher thread ─────────────────────────────

enum WatcherCmd {
    AddPath(PathBuf),
    RemovePath(PathBuf),
    Shutdown,
}

// ─── Pending event inside the debounce map ───────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Upsert,
    Remove,
}

struct Pending {
    action: Action,
    deadline: Instant,
}

// ─── Public handle ────────────────────────────────────────────────────────────

/// Cheap-to-clone handle.  Lets callers add/remove watched paths at runtime.
#[derive(Clone)]
pub struct WatcherHandle {
    cmd_tx: Sender<WatcherCmd>,
}

impl WatcherHandle {
    pub fn add_path(&self, path: &Path) {
        let _ = self.cmd_tx.send(WatcherCmd::AddPath(path.to_path_buf()));
    }

    pub fn remove_path(&self, path: &Path) {
        let _ = self.cmd_tx.send(WatcherCmd::RemovePath(path.to_path_buf()));
    }

    pub fn shutdown(&self) {
        let _ = self.cmd_tx.send(WatcherCmd::Shutdown);
    }
}

// ─── Public constructor ───────────────────────────────────────────────────────

/// Spawns the notify watcher + debounce threads and returns a `WatcherHandle`.
pub fn start_watching(
    folders: Vec<String>,
    db: Arc<Mutex<Connection>>,
    cache_dir: std::path::PathBuf,
    app: AppHandle,
) -> WatcherHandle {
    // Channel: notify thread → debounce thread (raw events, bounded so a burst
    // of thousands of renames does not grow RAM unbounded).
    let (raw_tx, raw_rx): (Sender<Event>, Receiver<Event>) = bounded(512);

    // Channel: public API → watcher thread (add/remove path commands).
    let (cmd_tx, cmd_rx): (Sender<WatcherCmd>, Receiver<WatcherCmd>) = bounded(64);

    let initial_folders: Vec<PathBuf> = folders.iter().map(PathBuf::from).collect();

    // ── Watcher thread ────────────────────────────────────────────────────────
    // Owns `RecommendedWatcher` (which is !Send on some platforms).
    // All event dispatching happens on notify's internal thread via the closure.
    std::thread::spawn(move || {
        let raw_tx_clone = raw_tx.clone();

        let handler = move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                // Drop pure ACCESS events – very common on Windows when
                // Explorer or antivirus reads files.
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                let _ = raw_tx_clone.send(event);
            }
        };

        let config = Config::default()
            // Poll interval used only when the OS backend falls back to polling.
            .with_poll_interval(Duration::from_secs(2))
            // Use mtime for change detection, not content hashing.
            .with_compare_contents(false);

        let mut watcher: RecommendedWatcher =
            match notify::RecommendedWatcher::new(handler, config) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[watcher] failed to create watcher: {e}");
                    return;
                }
            };

        for folder in &initial_folders {
            if let Err(e) = watcher.watch(folder, RecursiveMode::Recursive) {
                eprintln!("[watcher] watch {:?}: {e}", folder);
            }
        }

        loop {
            match cmd_rx.recv() {
                Ok(WatcherCmd::AddPath(p)) => {
                    if let Err(e) = watcher.watch(&p, RecursiveMode::Recursive) {
                        eprintln!("[watcher] add_path {:?}: {e}", p);
                    }
                }
                Ok(WatcherCmd::RemovePath(p)) => {
                    let _ = watcher.unwatch(&p);
                }
                Ok(WatcherCmd::Shutdown) | Err(_) => break,
            }
        }
    });

    // ── Debounce thread ───────────────────────────────────────────────────────
    // Collects raw events into a HashMap<PathBuf, Pending>.
    // A ticker wakes it every TICK ms to flush entries whose deadline passed.
    std::thread::spawn(move || {
        let ticker = tick(TICK);
        let mut pending: HashMap<PathBuf, Pending> = HashMap::new();

        loop {
            select! {
                recv(raw_rx) -> msg => {
                    match msg {
                        Ok(event) => ingest(&mut pending, event),
                        Err(_) => break, // sender dropped -> watcher thread exited
                    }
                }
                recv(ticker) -> _ => {
                    flush_expired(&mut pending, &db, &cache_dir, &app);
                }
            }
        }

        // Best-effort drain on shutdown.
        for (path, Pending { action, .. }) in pending.drain() {
            apply_action(&path, action, &db, &cache_dir, &app);
        }
    });

    WatcherHandle { cmd_tx }
}

// ─── Debounce helpers ─────────────────────────────────────────────────────────

/// Add a raw event to the pending map (deduplication logic lives here).
fn ingest(pending: &mut HashMap<PathBuf, Pending>, event: Event) {
    let Some(action) = classify(&event.kind) else { return };
    let deadline = Instant::now() + DEBOUNCE;

    for path in event.paths {
        if is_transient(&path) || !is_scan_target(&path) {
            continue;
        }
        pending
            .entry(path)
            .and_modify(|p| {
                // Remove always wins (file is gone no matter what).
                if action == Action::Remove || p.action != Action::Remove {
                    p.action = action;
                }
                p.deadline = deadline;
            })
            .or_insert(Pending { action, deadline });
    }
}

/// Flush every entry whose deadline has elapsed.
fn flush_expired(
    pending: &mut HashMap<PathBuf, Pending>,
    db: &Arc<Mutex<Connection>>,
    cache_dir: &PathBuf,
    app: &AppHandle,
) {
    let now = Instant::now();
    let ready: Vec<PathBuf> = pending
        .iter()
        .filter(|(_, p)| p.deadline <= now)
        .map(|(k, _)| k.clone())
        .collect();

    for path in ready {
        let Pending { action, .. } = pending.remove(&path).unwrap();
        apply_action(&path, action, db, cache_dir, app);
    }
}

/// Map `EventKind` to `Action`. Returns `None` for unactionable events.
fn classify(kind: &EventKind) -> Option<Action> {
    use notify::event::{CreateKind, ModifyKind, RemoveKind};
    match kind {
        EventKind::Create(CreateKind::File | CreateKind::Any)
        | EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Any | ModifyKind::Metadata(_)) => {
            Some(Action::Upsert)
        }
        EventKind::Remove(RemoveKind::File | RemoveKind::Any) => Some(Action::Remove),
        // Rename fires as Remove(old) + Create(new); let those events propagate.
        EventKind::Modify(ModifyKind::Name(_)) => None,
        _ => None,
    }
}

/// Return `true` for transient/lock files that must be silently ignored.
fn is_transient(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.starts_with(".~lock.")                         // LibreOffice lock
        || name.starts_with("~$")                       // Microsoft Office temp
        || name.ends_with(".tmp")                       // generic temp
        || name.ends_with(".swp")                       // Vim swap
        || name.ends_with(".swpx")                      // Neovim swap
        || name == ".DS_Store"                          // macOS metadata
        || name.starts_with("._")                       // macOS resource fork
        || name.eq_ignore_ascii_case("Thumbs.db")       // Windows thumbnail cache
        || name.eq_ignore_ascii_case("desktop.ini")     // Windows folder settings
}

/// Execute the final action: upsert or delete SQLite row + emit Tauri event.
fn apply_action(
    path: &Path,
    action: Action,
    db: &Arc<Mutex<Connection>>,
    cache_dir: &PathBuf,
    app: &AppHandle,
) {
    match action {
        Action::Upsert => {
            if path.is_file() {
                upsert_file(path, db, cache_dir);
                let _ = app.emit(
                    "file_change",
                    serde_json::json!({ "kind": "update", "path": path.to_string_lossy() }),
                );
            }
        }
        Action::Remove => {
            delete_file(path, db);
            let _ = app.emit(
                "file_change",
                serde_json::json!({ "kind": "remove", "path": path.to_string_lossy() }),
            );
        }
    }
}

// ─── SQLite helpers ───────────────────────────────────────────────────────────

fn upsert_file(path: &Path, db: &Arc<Mutex<Connection>>, cache_dir: &PathBuf) {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[watcher] metadata {:?}: {e}", path);
            return;
        }
    };

    let modified_at = unix_secs(meta.modified()).unwrap_or(0);
    let created_at = unix_secs(meta.created()).unwrap_or(modified_at);
    let file_size = meta.len() as i64;

    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let file_name_lower = file_name.to_lowercase();
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let folder = path.parent().and_then(|p| p.to_str()).unwrap_or("").to_string();
    let file_path_str = path.to_string_lossy().to_string();

    let hash = hash_file(path);
    let thumb_path = generate_thumbnail(path, cache_dir)
        .and_then(|p| p.to_str().map(|s| s.to_string()));
    let now = Utc::now().timestamp();

    let Ok(conn) = db.lock() else { return };
    if let Err(e) = conn.execute(
        r#"INSERT INTO assets
               (id, file_path, file_name, file_name_lower, extension, folder,
                modified_at, created_at, file_size, hash, thumbnail_path, indexed_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
           ON CONFLICT(file_path) DO UPDATE SET
               file_name       = excluded.file_name,
               file_name_lower = excluded.file_name_lower,
               extension       = excluded.extension,
               folder          = excluded.folder,
               modified_at     = excluded.modified_at,
               file_size       = excluded.file_size,
               hash            = excluded.hash,
               thumbnail_path  = COALESCE(excluded.thumbnail_path, thumbnail_path),
               indexed_at      = excluded.indexed_at"#,
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            file_path_str, file_name, file_name_lower, extension, folder,
            modified_at, created_at, file_size, hash, thumb_path, now,
        ],
    ) {
        eprintln!("[watcher] upsert {:?}: {e}", path);
    }
}

fn delete_file(path: &Path, db: &Arc<Mutex<Connection>>) {
    let path_str = path.to_string_lossy().to_string();
    let Ok(conn) = db.lock() else { return };
    if let Err(e) = conn.execute(
        "DELETE FROM assets WHERE file_path = ?1",
        rusqlite::params![path_str],
    ) {
        eprintln!("[watcher] delete {:?}: {e}", path);
    }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

fn unix_secs(time: std::io::Result<std::time::SystemTime>) -> Option<i64> {
    time.ok()
        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}
