//! OCR text extraction commands (backed by EasyOCR via the Python sidecar).

use tauri::State;
use rusqlite::params;
use crate::state::AppState;
use crate::sidecar::OCR_BATCH_TIMEOUT;
use crate::models::{OcrBatchEntry, OcrBatchResult, OcrEntry, OcrExtractQuery, OcrItemResult};

/// Extract OCR text from a single image and persist it in `asset_ocr`.
#[tauri::command]
pub async fn extract_ocr_text(
    query: OcrExtractQuery,
    state: State<'_, AppState>,
) -> Result<OcrEntry, String> {
    let sidecar = super::get_sidecar(&state)?;
    let langs = query.langs.clone().unwrap_or_else(|| {
        vec!["en".to_string(), "ja".to_string(), "vi".to_string()]
    });

    let raw = sidecar
        .call(
            "extract_ocr",
            serde_json::json!({
                "file_path": query.file_path,
                "langs":     langs,
            }),
        )
        .await
        .map_err(|e| format!("OCR sidecar call failed: {e}"))?;

    let full_text = raw.get("full_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let word_count = raw.get("word_count").and_then(|v| v.as_i64()).unwrap_or(0);
    let langs_used: Vec<String> = raw
        .get("languages")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_else(|| langs.clone());

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO asset_ocr (asset_id, full_text, langs, word_count, extracted_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch())
         ON CONFLICT(asset_id) DO UPDATE SET
             full_text    = excluded.full_text,
             langs        = excluded.langs,
             word_count   = excluded.word_count,
             extracted_at = unixepoch()",
        params![
            query.asset_id,
            full_text,
            langs_used.join(","),
            word_count,
        ],
    )
    .map_err(|e| format!("Failed to save OCR result: {e}"))?;

    let extracted_at = conn
        .query_row(
            "SELECT extracted_at FROM asset_ocr WHERE asset_id = ?1",
            params![query.asset_id],
            |r| r.get(0),
        )
        .unwrap_or(0_i64);

    Ok(OcrEntry {
        asset_id: query.asset_id,
        full_text,
        langs: langs_used,
        word_count,
        extracted_at,
    })
}

/// Batch-extract OCR from multiple assets.
/// Progress is pushed as `sidecar_event` with `event = "ocr_progress"`.
#[tauri::command]
pub async fn extract_ocr_batch(
    entries: Vec<OcrBatchEntry>,
    langs: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<OcrBatchResult, String> {
    let sidecar = super::get_sidecar(&state)?;
    let langs_val = langs.unwrap_or_else(|| {
        vec!["en".to_string(), "ja".to_string(), "vi".to_string()]
    });

    let raw = sidecar
        .call_with_timeout(
            "extract_ocr_batch",
            serde_json::json!({
                "entries": entries,
                "langs":   langs_val,
            }),
            OCR_BATCH_TIMEOUT,
        )
        .await
        .map_err(|e| format!("OCR batch sidecar call failed: {e}"))?;

    let raw_results: Vec<serde_json::Value> = raw
        .get("results")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let total = raw.get("total").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let success_count = raw.get("success_count").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut results: Vec<OcrItemResult> = Vec::with_capacity(raw_results.len());

    for item in &raw_results {
        let asset_id = item.get("asset_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let success = item.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
        let full_text = item.get("full_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let word_count = item.get("word_count").and_then(|v| v.as_i64()).unwrap_or(0);
        let error = item.get("error").and_then(|v| v.as_str()).map(str::to_string);

        if success && !asset_id.is_empty() {
            let langs_str = langs_val.join(",");
            let _ = conn.execute(
                "INSERT INTO asset_ocr (asset_id, full_text, langs, word_count, extracted_at)
                 VALUES (?1, ?2, ?3, ?4, unixepoch())
                 ON CONFLICT(asset_id) DO UPDATE SET
                     full_text    = excluded.full_text,
                     langs        = excluded.langs,
                     word_count   = excluded.word_count,
                     extracted_at = unixepoch()",
                params![asset_id, full_text, langs_str, word_count],
            );
        }

        results.push(OcrItemResult { asset_id, success, full_text, word_count, error });
    }

    Ok(OcrBatchResult { total, success_count, results })
}

/// Return the stored OCR record for a single asset, or `None` if not yet run.
#[tauri::command]
pub async fn get_ocr_text(
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<Option<OcrEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT asset_id, full_text, langs, word_count, extracted_at
         FROM asset_ocr WHERE asset_id = ?1",
        params![asset_id],
        |r| {
            let langs_str: String = r.get(2)?;
            let langs: Vec<String> = langs_str.split(',').map(str::to_string).collect();
            Ok(OcrEntry {
                asset_id: r.get(0)?,
                full_text: r.get(1)?,
                langs,
                word_count: r.get(3)?,
                extracted_at: r.get(4)?,
            })
        },
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
