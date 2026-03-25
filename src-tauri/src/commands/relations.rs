//! Asset relation graph commands.

use tauri::State;
use crate::state::AppState;
use crate::relation_graph::{self, AssetRelation, RelationGroup, RelationGraphStats};

/// Return every relation edge involving `asset_id` as either endpoint.
#[tauri::command]
pub async fn get_asset_relations(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AssetRelation>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    relation_graph::get_relations(&conn, &asset_id).map_err(|e| e.to_string())
}

/// Return all `RelationGroup`s containing `asset_id`.
#[tauri::command]
pub async fn get_relation_groups(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RelationGroup>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    relation_graph::get_groups_for_asset(&conn, &asset_id).map_err(|e| e.to_string())
}

/// Full rebuild: drop all auto-detected edges and redetect from scratch.
#[tauri::command]
pub async fn rebuild_relation_graph(
    state: State<'_, AppState>,
) -> Result<RelationGraphStats, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || relation_graph::rebuild_relation_graph(&db))
        .await
        .map_err(|e| e.to_string())?
}
