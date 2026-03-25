/// Export module — serialise asset metadata to CSV or JSON.
///
/// Fields exported per asset:
///   id, file_path, file_name, folder, extension, favorite, created_at, tags
///
/// Tags are fetched from the `tags` table (any source: user / ai / import).
/// CSV: RFC-4180 quoting — fields containing commas, double-quotes, or newlines
///      are wrapped in double-quotes with internal double-quotes doubled.
/// JSON: pretty-printed UTF-8 array of objects.

use rusqlite::params;
use serde::Serialize;
use std::sync::{Arc, Mutex};

// ── Data row ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ExportRow {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub folder: String,
    pub extension: String,
    pub favorite: bool,
    pub created_at: i64,
    pub tags: Vec<String>,
}

// ── Public entry-point ────────────────────────────────────────────────────────

/// Export a list of assets (by ID) to `output_path` in the requested format.
///
/// * `ids`         — asset IDs to export; empty slice → 0 rows written.
/// * `format`      — `"csv"` or `"json"`
/// * `output_path` — absolute path chosen via the frontend save-dialog.
///
/// Returns the number of rows written.
pub fn export_assets(
    db: Arc<Mutex<rusqlite::Connection>>,
    ids: &[String],
    format: &str,
    output_path: &str,
) -> Result<usize, String> {
    if ids.is_empty() {
        // Write an empty document so the file is created.
        let empty: &[ExportRow] = &[];
        let content = match format {
            "json" => serde_json::to_string_pretty(empty).map_err(|e| e.to_string())?,
            "csv"  => "id,file_path,file_name,folder,extension,favorite,created_at,tags\n".to_string(),
            other  => return Err(format!("Unknown export format: {}", other)),
        };
        std::fs::write(output_path, content).map_err(|e| e.to_string())?;
        return Ok(0);
    }

    let rows = fetch_rows(db, ids)?;
    let count = rows.len();

    let content = match format {
        "json" => serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?,
        "csv"  => to_csv(&rows),
        other  => return Err(format!("Unknown export format: {}", other)),
    };

    std::fs::write(output_path, content).map_err(|e| e.to_string())?;
    Ok(count)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn fetch_rows(
    db: Arc<Mutex<rusqlite::Connection>>,
    ids: &[String],
) -> Result<Vec<ExportRow>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Build a parameterised IN-list: ?1, ?2, …
    let placeholders: String = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT id, file_path, file_name, folder, extension, favorite, created_at \
         FROM assets WHERE id IN ({placeholders}) ORDER BY file_name ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let bind: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let mut rows: Vec<ExportRow> = stmt
        .query_map(bind.as_slice(), |row| {
            Ok(ExportRow {
                id:         row.get(0)?,
                file_path:  row.get(1)?,
                file_name:  row.get(2)?,
                folder:     row.get(3)?,
                extension:  row.get(4)?,
                favorite:   row.get::<_, i32>(5)? != 0,
                created_at: row.get(6)?,
                tags:       Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch tags for each row (assets with no tags → empty vec).
    let mut tag_stmt = conn
        .prepare("SELECT tag FROM tags WHERE asset_id = ?1 ORDER BY tag ASC")
        .map_err(|e| e.to_string())?;

    for row in &mut rows {
        row.tags = tag_stmt
            .query_map(params![row.id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
    }

    Ok(rows)
}

/// RFC-4180-compliant CSV serialisation.
///
/// Fields are quoted when they contain commas, double-quotes, or newlines.
/// Internal double-quotes are escaped by doubling them.
fn to_csv(rows: &[ExportRow]) -> String {
    let mut out =
        String::from("id,file_path,file_name,folder,extension,favorite,created_at,tags\n");

    for r in rows {
        let tags_str = r.tags.join(";");
        out.push_str(&csv_field(&r.id));
        out.push(',');
        out.push_str(&csv_field(&r.file_path));
        out.push(',');
        out.push_str(&csv_field(&r.file_name));
        out.push(',');
        out.push_str(&csv_field(&r.folder));
        out.push(',');
        out.push_str(&csv_field(&r.extension));
        out.push(',');
        out.push_str(if r.favorite { "true" } else { "false" });
        out.push(',');
        out.push_str(&r.created_at.to_string());
        out.push(',');
        out.push_str(&csv_field(&tags_str));
        out.push('\n');
    }

    out
}

/// Quote a single CSV field when necessary.
#[inline]
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}
