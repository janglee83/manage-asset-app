use rusqlite::{Connection, Result};
use std::path::Path;

pub fn init_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;       -- concurrent reads + non-blocking writes
         PRAGMA foreign_keys=ON;        -- enforce FK constraints
         PRAGMA synchronous=NORMAL;     -- safe + faster than FULL for WAL
         PRAGMA cache_size=-32000;      -- 32 MB page cache
         PRAGMA temp_store=MEMORY;      -- temp tables in RAM
         PRAGMA mmap_size=268435456;",  // 256 MB memory-mapped I/O
    )?;
    create_tables(&conn)?;
    Ok(conn)
}

fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- ────────────────────────────────────────────────────────────────────
        -- assets
        -- Core record per indexed file. file_path is the stable natural key.
        -- id is a UUID string so rows survive file moves (path can be updated).
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS assets (
            id             TEXT    NOT NULL PRIMARY KEY,  -- UUID v4
            file_path      TEXT    NOT NULL UNIQUE,       -- absolute path on disk
            file_name      TEXT    NOT NULL,              -- basename, e.g. "hero.png"
            file_name_lower TEXT   NOT NULL DEFAULT '',   -- lower(file_name) for case-insensitive LIKE
            extension      TEXT    NOT NULL,              -- lowercase, e.g. "png"
            folder         TEXT    NOT NULL,              -- parent directory path
            modified_at    INTEGER NOT NULL,              -- unix seconds (mtime from OS)
            created_at     INTEGER NOT NULL DEFAULT 0,    -- unix seconds (ctime / indexed_at fallback)
            file_size      INTEGER NOT NULL DEFAULT 0,    -- bytes
            hash           TEXT,                          -- SHA-256 of first 512 KB (duplicate detection)
            thumbnail_path TEXT,                          -- path to generated .jpg cache file
            favorite       INTEGER NOT NULL DEFAULT 0,    -- 0 | 1 boolean
            indexed_at     INTEGER NOT NULL DEFAULT 0     -- unix seconds when last indexed
        );

        -- File-name search: used by both LIKE 'x%' and fuzzy scan
        CREATE INDEX IF NOT EXISTS idx_assets_file_name_lower
            ON assets(file_name_lower);

        -- Extension filter (most common "type" filter)
        CREATE INDEX IF NOT EXISTS idx_assets_extension
            ON assets(extension);

        -- Folder drill-down: WHERE folder = ? OR folder LIKE 'prefix%'
        CREATE INDEX IF NOT EXISTS idx_assets_folder
            ON assets(folder);

        -- Date-range sort/filter: ORDER BY modified_at DESC, WHERE modified_at BETWEEN x AND y
        CREATE INDEX IF NOT EXISTS idx_assets_modified
            ON assets(modified_at DESC);

        -- Favorites quick-filter: WHERE favorite = 1
        CREATE INDEX IF NOT EXISTS idx_assets_favorite
            ON assets(favorite) WHERE favorite = 1;

        -- Composite: folder + modified_at covers "all files in folder, newest first"
        CREATE INDEX IF NOT EXISTS idx_assets_folder_modified
            ON assets(folder, modified_at DESC);

        -- Composite: extension + modified_at covers common "filter by type, sort by date"
        CREATE INDEX IF NOT EXISTS idx_assets_ext_modified
            ON assets(extension, modified_at DESC);

        -- Hash uniqueness lookup (duplicate detection)
        CREATE INDEX IF NOT EXISTS idx_assets_hash
            ON assets(hash) WHERE hash IS NOT NULL;

        -- ────────────────────────────────────────────────────────────────────
        -- tags
        -- Many-to-many: one asset ↔ many tags.
        -- UNIQUE(asset_id, tag) prevents duplicates; ON DELETE CASCADE cleans up.
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS tags (
            id       INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_id TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            tag      TEXT    NOT NULL CHECK(length(trim(tag)) > 0),
            source   TEXT    NOT NULL DEFAULT 'user',  -- 'user' | 'ai' | 'import'
            UNIQUE(asset_id, tag)
        );

        -- Lookup by asset (show all tags for an asset)
        CREATE INDEX IF NOT EXISTS idx_tags_asset
            ON tags(asset_id);

        -- Lookup by tag value (find all assets with tag = 'x')
        CREATE INDEX IF NOT EXISTS idx_tags_tag_lower
            ON tags(lower(tag));

        -- FTS virtual table for tag keyword search
        CREATE VIRTUAL TABLE IF NOT EXISTS tags_fts
            USING fts5(tag, asset_id UNINDEXED, content='tags', content_rowid='id');

        -- ────────────────────────────────────────────────────────────────────
        -- assets_fts
        -- Full-text search on file_name + tags for richer keyword search.
        -- Rebuild with: INSERT INTO assets_fts(assets_fts) VALUES('rebuild');
        -- ────────────────────────────────────────────────────────────────────
        CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts
            USING fts5(
                file_name,
                folder    UNINDEXED,
                content   = 'assets',
                content_rowid = 'rowid',
                tokenize  = 'unicode61 remove_diacritics 2'
            );

        -- ────────────────────────────────────────────────────────────────────
        -- embeddings
        -- One row per asset that has been embedded by the Python CLIP sidecar.
        -- vector_ref stores the FAISS index position or an external reference.
        -- model_id tracks which CLIP model version was used (for re-indexing).
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS embeddings (
            id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_id   TEXT    NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
            vector_ref INTEGER,          -- row index inside the FAISS .index file
            model_id   TEXT    NOT NULL DEFAULT 'clip-vit-b32',
            embedded_at INTEGER NOT NULL DEFAULT 0  -- unix seconds
        );

        CREATE INDEX IF NOT EXISTS idx_embeddings_asset
            ON embeddings(asset_id);

        -- Fast lookup: "which assets are NOT yet embedded" (for incremental indexing)
        CREATE INDEX IF NOT EXISTS idx_embeddings_missing
            ON assets(id) WHERE id NOT IN (SELECT asset_id FROM embeddings);

        -- ────────────────────────────────────────────────────────────────────
        -- search_history
        -- Recent keyword searches for autocomplete / analytics.
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS search_history (
            id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            keyword     TEXT    NOT NULL CHECK(length(trim(keyword)) > 0),
            searched_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- Most-recent-first retrieval
        CREATE INDEX IF NOT EXISTS idx_search_history_date
            ON search_history(searched_at DESC);

        -- Prefix autocomplete: WHERE keyword LIKE 'x%'
        CREATE INDEX IF NOT EXISTS idx_search_history_keyword
            ON search_history(keyword);

        -- ────────────────────────────────────────────────────────────────────
        -- watched_folders
        -- Folders the user added for scanning and file watching.
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS watched_folders (
            id        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            path      TEXT    NOT NULL UNIQUE,
            added_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );
        "#,
    )
}

