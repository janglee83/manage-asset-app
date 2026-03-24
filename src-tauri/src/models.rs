use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub folder: String,
    pub modified_at: i64,
    pub created_at: i64,
    pub file_size: i64,
    pub hash: Option<String>,
    pub thumbnail_path: Option<String>,
    pub favorite: bool,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub text: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub folder: Option<String>,
    pub from_date: Option<i64>,
    pub to_date: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub favorites_only: Option<bool>,
    /// One of: "modified_at" | "created_at" | "file_name" | "file_size"
    pub sort_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub assets: Vec<Asset>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: usize,
    pub total: usize,
    pub current_file: String,
    pub done: bool,
}

/// Per-file error collected during a scan (non-fatal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileError {
    pub path: String,
    pub error: String,
}

/// Returned by a completed scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub indexed: usize,   // new or updated
    pub skipped: usize,   // unchanged (modified_at + size identical)
    pub errors: usize,    // files that could not be processed
    pub error_details: Vec<FileError>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
}
