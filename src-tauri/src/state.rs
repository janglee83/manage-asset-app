use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use crate::watcher::WatcherHandle;
use crate::sidecar::SidecarHandle;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cache_dir: std::path::PathBuf,
    pub db_path: std::path::PathBuf,
    /// Handle to the running file watcher.  `None` until the first folder is
    /// added (or until startup folders are loaded from the DB).
    pub watcher: Mutex<Option<WatcherHandle>>,
    /// Handle to the Python semantic-search sidecar process.
    /// `None` if the sidecar failed to start or is not yet running.
    pub sidecar: Mutex<Option<Arc<SidecarHandle>>>,
    /// Parameters needed to re-spawn the sidecar after a crash.
    /// `None` on the compiled-binary path (spawn_exe) or before first spawn.
    pub sidecar_python: Mutex<Option<SidecarSpawnConfig>>,
}

/// The three strings required to re-spawn the Python sidecar via `SidecarHandle::spawn`.
#[derive(Debug, Clone)]
pub struct SidecarSpawnConfig {
    pub python_exe:  String,
    pub script_path: String,
    pub cwd:         String,
}

impl AppState {
    pub fn new(db: Connection, cache_dir: std::path::PathBuf, db_path: std::path::PathBuf) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
            cache_dir,
            db_path,
            watcher: Mutex::new(None),
            sidecar: Mutex::new(None),
            sidecar_python: Mutex::new(None),
        }
    }
}
