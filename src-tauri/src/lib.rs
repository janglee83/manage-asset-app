mod db;
mod errors;
mod export;
mod file_types;
mod folder_intel;
mod ignore;
mod relation_graph;
mod hasher;
mod logging;
mod models;
mod recovery;
mod scanner;
mod search;
mod sidecar;
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
        // Auto-updater — uncomment after:
        //   1. Run `bash scripts/keygen.sh` to generate the signing keypair.
        //   2. Paste the public key into tauri.release.conf.json (plugins.updater.pubkey).
        //   3. Add TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
        //      to GitHub Actions secrets (see scripts/keygen.sh output for instructions).
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Initialise structured logging before anything else.
            let log_dir = app.path().app_log_dir().ok();
            logging::init(log_dir);
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "AssetVault starting");

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

            // Start Python semantic-search sidecar.
            // ── Path resolution ─────────────────────────────────────────────────────────
            //  Debug   : ../python-service/ (source tree, venv interpreter)
            //  Release Windows: resources/asset-vault-sidecar/ (PyInstaller onedir)
            //  Release other  : resource_dir/python-service/ (bundled venv)
            let service_dir: std::path::PathBuf = if cfg!(debug_assertions) {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../python-service")
                    .canonicalize()
                    .unwrap_or_else(|_| std::path::PathBuf::from("../python-service"))
            } else {
                app.path()
                    .resource_dir()
                    .unwrap_or_default()
                    .join("python-service")
            };

            // Production Windows: look for a PyInstaller-compiled binary first.
            // The CI script (scripts/build-sidecar.ps1) compiles main.py with
            // --onedir and copies the output to src-tauri/resources/asset-vault-sidecar/.
            // Tauri bundles that directory via `bundle.resources = ["resources/**"]`.
            #[cfg(all(not(debug_assertions), windows))]
            let compiled_sidecar: Option<(std::path::PathBuf, std::path::PathBuf)> = {
                let dir = app
                    .path()
                    .resource_dir()
                    .unwrap_or_default()
                    .join("resources")
                    .join("asset-vault-sidecar");
                let exe = dir.join("asset-vault-sidecar.exe");
                if exe.exists() { Some((exe, dir)) } else { None }
            };
            #[cfg(not(all(not(debug_assertions), windows)))]
            let compiled_sidecar: Option<(std::path::PathBuf, std::path::PathBuf)> = None;

            let sidecar_result = if let Some((exe, cwd)) = compiled_sidecar {
                eprintln!("[sidecar] Using compiled binary: {}", exe.display());
                sidecar::SidecarHandle::spawn_exe(
                    &exe.to_string_lossy(),
                    &cwd.to_string_lossy(),
                    app.handle().clone(),
                )
            } else {
                let script_path = service_dir.join("main.py");
                // Platform-aware venv interpreter path.
                #[cfg(windows)]
                let venv_python = service_dir.join(".venv\\Scripts\\python.exe");
                #[cfg(not(windows))]
                let venv_python = service_dir.join(".venv/bin/python");
                let python_exe = std::env::var("PYTHON_EXE").unwrap_or_else(|_| {
                    if venv_python.exists() {
                        venv_python.to_string_lossy().into_owned()
                    } else {
                        eprintln!("[sidecar] .venv not found at {}; falling back to system Python", venv_python.display());
                        eprintln!("[sidecar] Run: cd python-service && bash setup.sh");
                        if cfg!(windows) { "python".into() } else { "python3".into() }
                    }
                });
                eprintln!("[sidecar] Using python: {python_exe}");
                eprintln!("[sidecar] Script:      {}", script_path.display());
                let script_str  = script_path.to_string_lossy().into_owned();
                let cwd_str     = service_dir.to_string_lossy().into_owned();
                let spawn_cfg   = state::SidecarSpawnConfig {
                    python_exe:  python_exe.clone(),
                    script_path: script_str.clone(),
                    cwd:         cwd_str.clone(),
                };
                if let Ok(mut g) = state.sidecar_python.lock() {
                    *g = Some(spawn_cfg);
                }
                sidecar::SidecarHandle::spawn(
                    &python_exe,
                    &script_str,
                    &cwd_str,
                    app.handle().clone(),
                )
            };

            match sidecar_result {
                Ok(handle) => {
                    if let Ok(mut guard) = state.sidecar.lock() {
                        *guard = Some(std::sync::Arc::new(handle));
                    }
                    eprintln!("[sidecar] Semantic sidecar started.");
                }
                Err(e) => eprintln!("[sidecar] Failed to start semantic sidecar: {e}"),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Folders & assets
            commands::assets::add_folder,
            commands::assets::remove_folder,
            commands::assets::get_folders,
            commands::assets::rescan_folder,
            commands::assets::get_asset,
            commands::assets::toggle_favorite,
            commands::assets::get_stats,
            commands::assets::remove_asset,
            // File ops
            commands::file_ops::open_file,
            commands::file_ops::reveal_in_explorer,
            // Thumbnails
            commands::thumbnails::get_thumbnail,
            commands::thumbnails::get_thumbnails_batch,
            // Keyword search & suggestions
            commands::search::search,
            commands::search::get_suggestions,
            commands::search::record_search,
            commands::search::clear_search_history,
            // Semantic search & embeddings
            commands::semantic::semantic_search,
            commands::semantic::search_by_image,
            commands::semantic::embed_asset,
            commands::semantic::embed_batch,
            commands::semantic::embed_all_assets,
            commands::semantic::rebuild_semantic_index,
            commands::semantic::get_semantic_stats,
            // Duplicate detection
            commands::duplicates::detect_duplicates,
            commands::duplicates::get_duplicate_pairs,
            commands::duplicates::dismiss_duplicate,
            // Auto-tagging
            commands::tags::auto_tag_asset,
            commands::tags::auto_tag_new_assets,
            commands::tags::get_asset_tags,
            commands::tags::add_tag,
            commands::tags::remove_tag,
            // Broken-path recovery
            commands::recovery::detect_broken_assets,
            commands::recovery::apply_recovery,
            // Export
            commands::export::export_assets,
            // Folder intelligence
            commands::folder_intel::get_folder_intelligence,
            commands::folder_intel::list_folder_intelligence,
            commands::folder_intel::override_folder_category,
            // Sidecar management
            commands::sidecar_mgmt::sidecar_alive,
            commands::sidecar_mgmt::restart_sidecar,
            // Relation graph
            commands::relations::get_asset_relations,
            commands::relations::get_relation_groups,
            commands::relations::rebuild_relation_graph,
            // OCR
            commands::ocr::extract_ocr_text,
            commands::ocr::extract_ocr_batch,
            commands::ocr::get_ocr_text,
            // Design language
            commands::design::understand_design_query,
            // .fig metadata
            commands::fig::extract_fig_metadata,
            commands::fig::get_fig_metadata,
            // Intelligence layer
            commands::intelligence::analyze_design_tokens,
            commands::intelligence::analyze_layout,
            commands::intelligence::get_recommendations,
            commands::intelligence::get_or_generate_description,
            commands::intelligence::build_component_families,
            commands::intelligence::detect_version_chains,
            commands::intelligence::rewrite_query,
            commands::intelligence::record_search_interaction,
            commands::intelligence::get_confidence_breakdown,
            commands::intelligence::auto_describe_all,
            // Production features: bulk tags, palette, style, intent
            commands::production::suggest_bulk_tags,
            commands::production::cluster_palette,
            commands::production::search_by_palette,
            commands::production::classify_asset_style,
            commands::production::classify_all_styles,
            commands::production::get_asset_style,
            commands::production::parse_search_intent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
