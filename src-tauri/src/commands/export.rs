//! Asset export command.

use tauri::State;
use crate::state::AppState;

/// Serialise a list of assets to a file (CSV or JSON).
#[tauri::command]
pub async fn export_assets(
    ids: Vec<String>,
    format: String,
    output_path: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    tracing::info!(count = ids.len(), format = %format, output = %output_path, "export_assets: starting");
    let db = state.db.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::export::export_assets(db, &ids, &format, &output_path)
    })
    .await
    .map_err(|e| e.to_string())?;
    match &result {
        Ok(n) => tracing::info!(written = n, "export_assets: done"),
        Err(e) => tracing::error!(error = %e, "export_assets: failed"),
    }
    result
}
