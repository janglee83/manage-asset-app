//! Centralized application error type and retry utilities.
//!
//! All Tauri commands should return `Result<T, AppError>` (serialised to the
//! frontend as a JSON object with `code` + `message` fields) rather than the
//! raw `String` that was used previously.  Legacy commands that still return
//! `Result<T, String>` degrade gracefully — the frontend receives the raw
//! string inside `message`.
//!
//! # Retry semantics
//!
//! SQLite returns `SQLITE_BUSY` (error code 5) or `SQLITE_LOCKED` (6) when
//! another connection is writing. `with_db_retry` wraps any closure that
//! touches the DB mutex with an exponential-backoff retry loop (up to 5
//! attempts, 50 ms → 400 ms).  This is the only place retry logic lives —
//! callers do not need to implement it themselves.

use std::fmt;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;

// ── Error type ────────────────────────────────────────────────────────────────

/// Machine-readable error category forwarded to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// SQLite operation failed (includes lock timeouts).
    Database,
    /// Python sidecar unreachable, crashed, or timed out.
    Sidecar,
    /// Requested file or asset was not found.
    NotFound,
    /// Argument validation failure.
    InvalidInput,
    /// All other Rust-side failures.
    Internal,
}

/// The canonical error type for all Tauri command results.
///
/// Implements `Serialize` so Tauri can serialise it directly into a
/// `{ "code": "…", "message": "…" }` JSON object on the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn db(msg: impl fmt::Display)            -> Self { Self { code: ErrorCode::Database,     message: msg.to_string() } }
    pub fn sidecar(msg: impl fmt::Display)       -> Self { Self { code: ErrorCode::Sidecar,      message: msg.to_string() } }
    pub fn not_found(msg: impl fmt::Display)     -> Self { Self { code: ErrorCode::NotFound,     message: msg.to_string() } }
    pub fn invalid_input(msg: impl fmt::Display) -> Self { Self { code: ErrorCode::InvalidInput, message: msg.to_string() } }
    pub fn internal(msg: impl fmt::Display)      -> Self { Self { code: ErrorCode::Internal,     message: msg.to_string() } }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

// Allow using AppError with `?` from String-returning functions.
impl From<String> for AppError {
    fn from(s: String) -> Self { AppError::internal(s) }
}
impl From<&str> for AppError {
    fn from(s: &str) -> Self { AppError::internal(s) }
}
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self { AppError::db(e) }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self { AppError::internal(e) }
}

// ── SQLite retry ──────────────────────────────────────────────────────────────

/// Maximum number of attempts before giving up on a locked DB.
const DB_MAX_RETRIES: u32 = 5;
/// Initial back-off delay in milliseconds (doubles each attempt).
const DB_BACKOFF_MS_INIT: u64 = 50;

/// Acquire the DB mutex and run `f(conn)` with automatic retry on SQLite BUSY.
///
/// Retries up to `DB_MAX_RETRIES` times with exponential back-off
/// (`50 ms`, `100 ms`, `200 ms`, `400 ms`) before returning an error.
///
/// # Example
/// ```rust
/// let count = with_db_retry(&state.db, |conn| {
///     conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get::<_, i64>(0))
/// })?;
/// ```
pub fn with_db_retry<F, T>(db: &Arc<Mutex<Connection>>, f: F) -> Result<T, AppError>
where
    F: Fn(&Connection) -> rusqlite::Result<T>,
{
    let mut delay = DB_BACKOFF_MS_INIT;
    for attempt in 1..=DB_MAX_RETRIES {
        let conn = db
            .lock()
            .map_err(|_| AppError::db("DB mutex poisoned"))?;
        match f(&conn) {
            Ok(v) => return Ok(v),
            Err(rusqlite::Error::SqliteFailure(e, msg))
                if e.code == rusqlite::ErrorCode::DatabaseBusy
                    || e.code == rusqlite::ErrorCode::DatabaseLocked =>
            {
                drop(conn); // release before sleeping
                let detail = msg.as_deref().unwrap_or("busy/locked");
                tracing::warn!(
                    attempt,
                    delay_ms = delay,
                    "{detail} — retrying DB operation ({attempt}/{DB_MAX_RETRIES})"
                );
                if attempt < DB_MAX_RETRIES {
                    thread::sleep(Duration::from_millis(delay));
                    delay = (delay * 2).min(2_000);
                } else {
                    return Err(AppError::db(format!(
                        "SQLite locked after {DB_MAX_RETRIES} attempts: {detail}"
                    )));
                }
            }
            Err(e) => return Err(AppError::db(e)),
        }
    }
    unreachable!()
}
