//! Design language understanding command.

use tauri::State;
use crate::state::AppState;
use crate::models::DesignQueryUnderstanding;

/// Parse a user query through the design language understanding layer without
/// performing any semantic search.
#[tauri::command]
pub async fn understand_design_query(
    query: String,
    state: State<'_, AppState>,
) -> Result<DesignQueryUnderstanding, String> {
    let sidecar = super::get_sidecar(&state)?;
    let result = sidecar
        .call(
            "understand_design_query",
            serde_json::json!({ "query": query }),
        )
        .await
        .map_err(|e| format!("Design language sidecar call failed: {e}"))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}
