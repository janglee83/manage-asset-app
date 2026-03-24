mod db;
mod file_types;
mod hasher;
mod models;
mod scanner;
mod search;
mod state;
mod thumbnail;
mod commands;
mod watcher;

use tauri::Manager;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Resolve app data directory for DB and cache
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data dir");

            let db_path = app_data_dir.join("assets.db");
            let cache_dir = app_data_dir.join("thumbnails");
            std::fs::create_dir_all(&cache_dir)
                .expect("Failed to create cache dir");

            let conn = db::init_db(&db_path).expect("Failed to init database");
            let app_state = AppState::new(conn, cache_dir.clone(), db_path);
            app.manage(app_state);

            // Start file watcher for previously-watched folders
            let state: tauri::State<AppState> = app.state();
            let folders = scanner::get_watched_folders(state.db.clone()).unwrap_or_default();
            if !folders.is_empty() {
                let handle = watcher::start_watching(
                    folders,
                    state.db.clone(),
                    cache_dir,
                    app.handle().clone(),
                );
                if let Ok(mut guard) = state.watcher.lock() {
                    *guard = Some(handle);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_folder,
            commands::remove_folder,
            commands::get_folders,
            commands::rescan_folder,
            commands::search,
            commands::get_asset,
            commands::toggle_favorite,
            commands::get_thumbnail,
            commands::open_file,
            commands::reveal_in_explorer,
            commands::get_stats,
            commands::remove_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
