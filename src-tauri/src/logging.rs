//! Structured logging initialisation.
//!
//! # Output format
//! - Debug builds : pretty human-readable text to stderr (coloured when the
//!   terminal supports it).
//! - Release builds: newline-delimited JSON written to
//!   `<app-data-dir>/logs/asset-vault.log` and mirrored to stderr.
//!
//! # Log level
//! Override at runtime with the `RUST_LOG` env variable:
//!   RUST_LOG=debug npm run tauri dev
//!   RUST_LOG=asset_vault=trace,info
//!
//! Default: `info` in release, `debug` in dev.
//!
//! # Usage
//! ```rust
//! // In lib.rs setup:
//! logging::init(Some(log_dir));
//!
//! // Anywhere in the codebase:
//! use tracing::{debug, info, warn, error};
//! tracing::error!(command = "search", err = %e, "SQLite query failed");
//! ```

use std::path::PathBuf;
use tracing_subscriber::{
    fmt::{self, writer::MakeWriterExt},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Initialise the global `tracing` subscriber.
///
/// Call once from `lib.rs` before any other setup.
/// `log_dir` — directory where `asset-vault.log` is written (release builds).
/// Pass `None` to log to stderr only.
pub fn init(log_dir: Option<PathBuf>) {
    let default_level = if cfg!(debug_assertions) { "debug" } else { "info" };
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(default_level));

    if cfg!(debug_assertions) || log_dir.is_none() {
        // Dev: coloured human-readable output to stderr.
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().with_writer(std::io::stderr).pretty())
            .init();
    } else {
        // Release: JSON to file + plain text to stderr.
        let log_path = log_dir.unwrap().join("asset-vault.log");

        // Create parent directory if it doesn't exist.
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            Ok(file) => {
                let file_writer = std::sync::Mutex::new(file);
                tracing_subscriber::registry()
                    .with(filter)
                    // JSON layer → log file
                    .with(
                        fmt::layer()
                            .json()
                            .with_writer(file_writer),
                    )
                    // Plain text layer → stderr (visible in Windows Event Viewer / macOS Console)
                    .with(
                        fmt::layer()
                            .with_writer(std::io::stderr.with_max_level(tracing::Level::WARN)),
                    )
                    .init();
                tracing::info!(log_file = %log_path.display(), "Logging initialised");
            }
            Err(e) => {
                // Log file creation failed — fall back to stderr only.
                tracing_subscriber::registry()
                    .with(filter)
                    .with(fmt::layer().with_writer(std::io::stderr))
                    .init();
                tracing::warn!("Could not open log file {}: {e} — logging to stderr only", log_path.display());
            }
        }
    }
}
