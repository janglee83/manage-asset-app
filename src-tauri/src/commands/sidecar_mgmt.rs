//! Python sidecar lifecycle management commands.

use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::state::AppState;

/// Returns `true` if the Python sidecar process is currently alive.
#[tauri::command]
pub async fn sidecar_alive(state: State<'_, AppState>) -> Result<bool, String> {
    let guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        None => Ok(false),
        Some(h) => Ok(!h.dead.load(std::sync::atomic::Ordering::SeqCst)),
    }
}

/// Restart the Python sidecar after a crash.
/// No-op if the sidecar is already running.
#[tauri::command]
pub async fn restart_sidecar(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let cfg = {
        let guard = state.sidecar_python.lock().map_err(|e| e.to_string())?;
        guard
            .clone()
            .ok_or("Sidecar spawn config not available (compiled binary path)")?
    };

    {
        let guard = state.sidecar.lock().map_err(|e| e.to_string())?;
        if let Some(h) = guard.as_ref() {
            if !h.dead.load(std::sync::atomic::Ordering::SeqCst) {
                return Ok(());
            }
        }
    }

    tracing::info!(python = %cfg.python_exe, "restart_sidecar: spawning new sidecar process");

    let new_handle = crate::sidecar::SidecarHandle::spawn(
        &cfg.python_exe,
        &cfg.script_path,
        &cfg.cwd,
        app.clone(),
    )?;

    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    *guard = Some(Arc::new(new_handle));

    tracing::info!("restart_sidecar: new sidecar process started");
    Ok(())
}
