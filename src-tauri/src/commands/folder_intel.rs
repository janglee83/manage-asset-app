//! Folder intelligence commands: semantic categorisation of watched folders.

use tauri::State;
use crate::state::AppState;
use crate::folder_intel::{self, FolderIntelligence};

/// Return the stored `FolderIntelligence` record for a single folder path.
#[tauri::command]
pub async fn get_folder_intelligence(
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<FolderIntelligence>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    folder_intel::get_folder_intel(&conn, &path).map_err(|e| e.to_string())
}

/// Return all stored `FolderIntelligence` records ordered by folder path.
#[tauri::command]
pub async fn list_folder_intelligence(
    state: State<'_, AppState>,
) -> Result<Vec<FolderIntelligence>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    folder_intel::list_folder_intel(&conn).map_err(|e| e.to_string())
}

/// Manually set the category and subcategory for a folder path.
/// Sets `is_manual = true`, preventing future auto-inference from overwriting it.
#[tauri::command]
pub async fn override_folder_category(
    path: String,
    category: String,
    subcategory: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    folder_intel::set_manual_override(&conn, &path, &category, &subcategory)
        .map_err(|e| e.to_string())
}
