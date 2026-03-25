//! Tauri command modules, split by domain.
//!
//! Shared helpers (`get_sidecar`, `db_retry`) are defined here and accessible
//! by every sub-module via `super::get_sidecar(...)`.

use std::sync::Arc;
use tauri::State;
use crate::sidecar::SidecarHandle;
use crate::state::AppState;
use crate::errors::with_db_retry;

pub mod assets;
pub mod design;
pub mod duplicates;
pub mod export;
pub mod fig;
pub mod file_ops;
pub mod folder_intel;
pub mod intelligence;
pub mod ocr;
pub mod recovery;
pub mod relations;
pub mod search;
pub mod semantic;
pub mod sidecar_mgmt;
pub mod tags;
pub mod thumbnails;
pub mod production;

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Retrieve the live sidecar handle, or return an error if it's unavailable.
fn get_sidecar(state: &State<'_, AppState>) -> Result<Arc<SidecarHandle>, String> {
    let guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    let handle = guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "Semantic search sidecar is not running".to_string())?;

    if handle.dead.load(std::sync::atomic::Ordering::SeqCst) {
        tracing::error!("[sidecar] get_sidecar called but sidecar is dead");
        return Err("Semantic search sidecar has crashed — restart the app to recover".into());
    }
    Ok(handle)
}

/// Retry a DB write on BUSY/LOCKED errors.
#[allow(dead_code)]
#[inline]
fn db_retry<F, T>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    F: Fn(&rusqlite::Connection) -> rusqlite::Result<T>,
{
    with_db_retry(&state.db, f).map_err(|e| e.message)
}

// ── Re-exports are intentionally omitted — lib.rs references sub-modules directly,
// e.g. `commands::assets::add_folder`.  Add re-exports here if other Rust code
// ever needs a flat `commands::xxx` path.
