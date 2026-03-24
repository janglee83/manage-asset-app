use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use crate::watcher::WatcherHandle;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cache_dir: std::path::PathBuf,
    pub db_path: std::path::PathBuf,
    /// Handle to the running file watcher.  `None` until the first folder is
    /// added (or until startup folders are loaded from the DB).
    pub watcher: Mutex<Option<WatcherHandle>>,
}

impl AppState {
    pub fn new(db: Connection, cache_dir: std::path::PathBuf, db_path: std::path::PathBuf) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
            cache_dir,
            db_path,
            watcher: Mutex::new(None),
        }
    }
}
