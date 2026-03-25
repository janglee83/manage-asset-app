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
    maybe_rebuild_fts(&conn)?;
    // Update query-planner statistics so SQLite picks optimal indexes.
    // On a warm database this is near-instant; on a fresh one it analyzes up to
    // analysis_limit pages per table (400 is the SQLite recommended cap).
    conn.execute_batch(
        "PRAGMA analysis_limit=400;
         PRAGMA optimize;",
    )?;
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

        -- NOTE: SQLite prohibits subqueries in partial-index WHERE clauses, so
        -- there is no partial index here.  "Unembedded assets" are found with:
        --   SELECT a.id FROM assets a
        --   LEFT JOIN embeddings e ON e.asset_id = a.id
        --   WHERE e.asset_id IS NULL;
        -- The LEFT JOIN uses idx_embeddings_asset and is O(n) at worst.

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

        -- Frequency ranking: supports GROUP BY keyword ORDER BY count(*) DESC
        CREATE INDEX IF NOT EXISTS idx_search_history_keyword_covering
            ON search_history(keyword, searched_at DESC);

        -- ────────────────────────────────────────────────────────────────────
        -- duplicate_pairs
        -- Persisted results from the duplicate-detection pipeline.
        -- Each row records a pair (asset_a, asset_b) where asset_a < asset_b
        -- lexicographically, which prevents storing both (a,b) and (b,a).
        --
        -- dup_type: 'exact'   - identical SHA-256 hash
        --           'similar' - CLIP cosine similarity >= threshold
        -- similarity: 0.0 for exact pairs (use 1.0 semantically), otherwise
        --             the raw CLIP inner-product score in [0, 1].
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS duplicate_pairs (
            id         INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_a    TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            asset_b    TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            dup_type   TEXT    NOT NULL CHECK(dup_type IN ('exact','similar')),
            similarity REAL    NOT NULL DEFAULT 1.0,
            detected_at INTEGER NOT NULL DEFAULT (unixepoch()),
            dismissed  INTEGER NOT NULL DEFAULT 0,  -- user dismissed this pair
            UNIQUE(asset_a, asset_b)
        );

        CREATE INDEX IF NOT EXISTS idx_dup_asset_a  ON duplicate_pairs(asset_a);
        CREATE INDEX IF NOT EXISTS idx_dup_asset_b  ON duplicate_pairs(asset_b);
        CREATE INDEX IF NOT EXISTS idx_dup_type     ON duplicate_pairs(dup_type);
        CREATE INDEX IF NOT EXISTS idx_dup_active   ON duplicate_pairs(dismissed) WHERE dismissed = 0;

        -- ────────────────────────────────────────────────────────────────────
        -- watched_folders
        -- Folders the user added for scanning and file watching.
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS watched_folders (
            id        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            path      TEXT    NOT NULL UNIQUE,
            added_at  INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- ────────────────────────────────────────────────────────────────────
        -- FTS5 sync triggers — assets_fts
        -- Content table: FTS index stores rowid posting lists; actual column
        -- values are fetched from assets at query time.  Triggers keep the
        -- posting lists in sync with INSERT / UPDATE / DELETE on assets.
        -- ────────────────────────────────────────────────────────────────────
        CREATE TRIGGER IF NOT EXISTS assets_fts_ai
        AFTER INSERT ON assets BEGIN
            INSERT INTO assets_fts(rowid, file_name, folder)
            VALUES (new.rowid, new.file_name, new.folder);
        END;

        CREATE TRIGGER IF NOT EXISTS assets_fts_ad
        AFTER DELETE ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, file_name, folder)
            VALUES ('delete', old.rowid, old.file_name, old.folder);
        END;

        CREATE TRIGGER IF NOT EXISTS assets_fts_au
        AFTER UPDATE ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, file_name, folder)
            VALUES ('delete', old.rowid, old.file_name, old.folder);
            INSERT INTO assets_fts(rowid, file_name, folder)
            VALUES (new.rowid, new.file_name, new.folder);
        END;

        -- ────────────────────────────────────────────────────────────────────
        -- FTS5 sync triggers — tags_fts
        -- ────────────────────────────────────────────────────────────────────
        CREATE TRIGGER IF NOT EXISTS tags_fts_ai
        AFTER INSERT ON tags BEGIN
            INSERT INTO tags_fts(rowid, tag, asset_id)
            VALUES (new.id, new.tag, new.asset_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tags_fts_ad
        AFTER DELETE ON tags BEGIN
            INSERT INTO tags_fts(tags_fts, rowid, tag, asset_id)
            VALUES ('delete', old.id, old.tag, old.asset_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tags_fts_au
        AFTER UPDATE ON tags BEGIN
            INSERT INTO tags_fts(tags_fts, rowid, tag, asset_id)
            VALUES ('delete', old.id, old.tag, old.asset_id);
            INSERT INTO tags_fts(rowid, tag, asset_id)
            VALUES (new.id, new.tag, new.asset_id);
        END;

        -- ────────────────────────────────────────────────────────────────────
        -- folder_intelligence
        -- Persisted output of the folder semantic classifier.
        -- One row per distinct `folder` value found in `assets`.
        --
        -- category    : top-level label, e.g. "design", "icon", "photo"
        -- subcategory : second-level label, e.g. "button", "mobile"
        -- tokens      : space-separated lowercase path tokens for LIKE matching
        -- confidence  : 0.0–1.0; 1.0 for manual overrides
        -- is_manual   : 1 when a human has set the category (auto skips update)
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS folder_intelligence (
            folder_path  TEXT    NOT NULL PRIMARY KEY,
            category     TEXT    NOT NULL DEFAULT '',
            subcategory  TEXT    NOT NULL DEFAULT '',
            tokens       TEXT    NOT NULL DEFAULT '',
            confidence   REAL    NOT NULL DEFAULT 0.0,
            depth        INTEGER NOT NULL DEFAULT 0,
            is_manual    INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_folder_intel_category
            ON folder_intelligence(category)
            WHERE category != '';

        -- ────────────────────────────────────────────────────────────────────
        -- asset_relations
        -- Automatically detected relationships between assets based on naming
        -- patterns.  Edges are deduplicated by UNIQUE(asset_a, asset_b, relation)
        -- with asset_a ≤ asset_b lexicographically (canonical form).
        --
        -- relation    : one of 'version' | 'platform_variant' | 'component_family'
        --                       | 'same_stem' | 'co_location'
        -- confidence  : classifier confidence 0.0–1.0
        -- group_key   : shared base name that triggered the relation,
        --               format: lower(folder) || '||' || base_stem
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS asset_relations (
            id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_a      TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            asset_b      TEXT    NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            relation     TEXT    NOT NULL CHECK(relation IN (
                             'component_family','version','platform_variant',
                             'same_stem','co_location')),
            confidence   REAL    NOT NULL DEFAULT 1.0,
            group_key    TEXT    NOT NULL DEFAULT '',
            detected_at  INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(asset_a, asset_b, relation)
        );

        CREATE INDEX IF NOT EXISTS idx_rel_asset_a
            ON asset_relations(asset_a);
        CREATE INDEX IF NOT EXISTS idx_rel_asset_b
            ON asset_relations(asset_b);
        CREATE INDEX IF NOT EXISTS idx_rel_group
            ON asset_relations(group_key) WHERE group_key != '';
        CREATE INDEX IF NOT EXISTS idx_rel_kind
            ON asset_relations(relation);

        -- ────────────────────────────────────────────────────────────────────
        -- asset_ocr
        -- Stores extracted OCR text for assets that have been put through the
        -- OCR pipeline.  One row per asset (upsert on re-extract).
        --
        -- full_text    : all recognised text, space-joined
        -- langs        : comma-separated language codes used, e.g. "en,ja,vi"
        -- word_count   : number of accepted text blocks
        -- extracted_at : Unix epoch of the last successful extraction
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS asset_ocr (
            id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_id     TEXT    NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
            full_text    TEXT    NOT NULL DEFAULT '',
            langs        TEXT    NOT NULL DEFAULT 'en,ja,vi',
            word_count   INTEGER NOT NULL DEFAULT 0,
            extracted_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_ocr_asset_id
            ON asset_ocr(asset_id);
        CREATE INDEX IF NOT EXISTS idx_ocr_extracted_at
            ON asset_ocr(extracted_at);

        -- FTS5 virtual table for full-text search over OCR-extracted text.
        -- unicode61 with remove_diacritics 2 gives accent-insensitive matching
        -- consistent with assets_fts.
        CREATE VIRTUAL TABLE IF NOT EXISTS ocr_fts USING fts5(
            full_text,
            asset_id  UNINDEXED,
            content   = 'asset_ocr',
            content_rowid = 'id',
            tokenize  = 'unicode61 remove_diacritics 2'
        );

        -- Sync triggers: keep ocr_fts consistent with asset_ocr changes.
        CREATE TRIGGER IF NOT EXISTS ocr_fts_ai
        AFTER INSERT ON asset_ocr BEGIN
            INSERT INTO ocr_fts(rowid, full_text, asset_id)
            VALUES (new.id, new.full_text, new.asset_id);
        END;

        CREATE TRIGGER IF NOT EXISTS ocr_fts_ad
        AFTER DELETE ON asset_ocr BEGIN
            INSERT INTO ocr_fts(ocr_fts, rowid, full_text, asset_id)
            VALUES ('delete', old.id, old.full_text, old.asset_id);
        END;

        CREATE TRIGGER IF NOT EXISTS ocr_fts_au
        AFTER UPDATE ON asset_ocr BEGIN
            INSERT INTO ocr_fts(ocr_fts, rowid, full_text, asset_id)
            VALUES ('delete', old.id, old.full_text, old.asset_id);
            INSERT INTO ocr_fts(rowid, full_text, asset_id)
            VALUES (new.id, new.full_text, new.asset_id);
        END;

        -- ────────────────────────────────────────────────────────────────────
        -- asset_fig_metadata
        -- Stores heuristically-extracted .fig file metadata (pages, frames,
        -- component names) for assets whose extension is "fig".
        --
        -- Data is obtained by scanning the Kiwi-encoded canvas binary inside
        -- the .fig ZIP archive for length-prefixed UTF-8 strings. Confidence
        -- is always "heuristic" — the Figma REST API is needed for typed data.
        --
        -- pages_json / frames_json / components_json : JSON arrays of name strings
        -- all_names_json                             : unfiltered candidate strings
        -- thumbnail_count                            : per-page preview PNGs found in ZIP
        -- is_valid_fig                               : 1 if canvas blob was readable
        -- extracted_at                               : Unix epoch of last extraction
        -- ────────────────────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS asset_fig_metadata (
            id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            asset_id         TEXT    NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
            pages_json       TEXT    NOT NULL DEFAULT '[]',
            frames_json      TEXT    NOT NULL DEFAULT '[]',
            components_json  TEXT    NOT NULL DEFAULT '[]',
            all_names_json   TEXT    NOT NULL DEFAULT '[]',
            thumbnail_count  INTEGER NOT NULL DEFAULT 0,
            is_valid_fig     INTEGER NOT NULL DEFAULT 0,
            confidence       TEXT    NOT NULL DEFAULT 'heuristic',
            extracted_at     INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_fig_asset_id
            ON asset_fig_metadata(asset_id);

        -- ────────────────────────────────────────────────────────────────────
        -- Intelligence layer tables
        -- ────────────────────────────────────────────────────────────────────

        CREATE TABLE IF NOT EXISTS asset_design_tokens (
            asset_id         TEXT NOT NULL PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
            dominant_colors  TEXT NOT NULL DEFAULT '[]',
            typography_zones TEXT NOT NULL DEFAULT '[]',
            spacing_class    TEXT NOT NULL DEFAULT 'unknown',
            analyzed_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS asset_layout_signature (
            asset_id           TEXT NOT NULL PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
            aspect_ratio       REAL NOT NULL DEFAULT 1.0,
            layout_fingerprint TEXT NOT NULL DEFAULT '[]',
            region_complexity  TEXT NOT NULL DEFAULT '{}',
            layout_class       TEXT NOT NULL DEFAULT 'unknown',
            analyzed_at        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS asset_descriptions (
            asset_id     TEXT NOT NULL PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
            description  TEXT NOT NULL DEFAULT '',
            confidence   REAL NOT NULL DEFAULT 0.0,
            generated_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS component_families (
            id           TEXT NOT NULL PRIMARY KEY,
            name         TEXT NOT NULL DEFAULT '',
            archetype_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
            member_count INTEGER NOT NULL DEFAULT 0,
            tags_summary TEXT NOT NULL DEFAULT '[]',
            created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS asset_component_family (
            asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            family_id  TEXT NOT NULL REFERENCES component_families(id) ON DELETE CASCADE,
            role       TEXT NOT NULL DEFAULT 'member',
            confidence REAL NOT NULL DEFAULT 1.0,
            PRIMARY KEY (asset_id, family_id)
        );
        CREATE INDEX IF NOT EXISTS idx_acf_family ON asset_component_family(family_id);

        CREATE TABLE IF NOT EXISTS search_interactions (
            id               INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            query            TEXT NOT NULL,
            query_hash       TEXT NOT NULL,
            asset_id         TEXT REFERENCES assets(id) ON DELETE CASCADE,
            interaction_type TEXT NOT NULL DEFAULT 'click',
            semantic_score   REAL NOT NULL DEFAULT 0.0,
            session_key      TEXT NOT NULL DEFAULT '',
            interacted_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_interact_asset ON search_interactions(asset_id);
        CREATE INDEX IF NOT EXISTS idx_interact_query ON search_interactions(query_hash);
        CREATE INDEX IF NOT EXISTS idx_interact_at    ON search_interactions(interacted_at DESC);

        CREATE TABLE IF NOT EXISTS query_rewrites (
            query_hash TEXT NOT NULL PRIMARY KEY,
            original   TEXT NOT NULL,
            rewritten  TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.0,
            hit_count  INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            used_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );

        -- Design style per asset (fintech / ecommerce / enterprise / ...)
        CREATE TABLE IF NOT EXISTS asset_styles (
            asset_id     TEXT NOT NULL PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
            style        TEXT NOT NULL DEFAULT 'unknown',
            confidence   REAL NOT NULL DEFAULT 0.0,
            all_styles   TEXT NOT NULL DEFAULT '[]',
            signals      TEXT NOT NULL DEFAULT '{}',
            classified_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_asset_style ON asset_styles(style);

        -- Palette cluster membership
        CREATE TABLE IF NOT EXISTS palette_clusters (
            id         TEXT NOT NULL PRIMARY KEY,
            centroid   TEXT NOT NULL DEFAULT '[]',   -- JSON [L, a, b]
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS asset_palette_cluster (
            asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            cluster_id TEXT NOT NULL REFERENCES palette_clusters(id) ON DELETE CASCADE,
            PRIMARY KEY (asset_id, cluster_id)
        );
        CREATE INDEX IF NOT EXISTS idx_apc_cluster ON asset_palette_cluster(cluster_id);
        "#,
    )
}

/// Populate FTS5 indexes the first time they are encountered on an existing
/// database (i.e. triggers were just added but the index is still empty).
/// On subsequent startups the check is a single-row LIMIT 1 — essentially free.
fn maybe_rebuild_fts(conn: &Connection) -> Result<()> {
    let fts_empty = conn
        .query_row("SELECT rowid FROM assets_fts LIMIT 1", [], |r| {
            r.get::<_, i64>(0)
        })
        .is_err();

    let has_assets = conn
        .query_row("SELECT rowid FROM assets LIMIT 1", [], |r| {
            r.get::<_, i64>(0)
        })
        .is_ok();

    if fts_empty && has_assets {
        conn.execute_batch(
            "INSERT INTO assets_fts(assets_fts) VALUES('rebuild');
             INSERT INTO tags_fts(tags_fts)   VALUES('rebuild');",
        )?;
    }

    // Rebuild ocr_fts if it has fallen out of sync with asset_ocr
    // (e.g. the table was added to an existing database).
    let ocr_fts_empty = conn
        .query_row("SELECT rowid FROM ocr_fts LIMIT 1", [], |r| r.get::<_, i64>(0))
        .is_err();
    let has_ocr = conn
        .query_row("SELECT id FROM asset_ocr LIMIT 1", [], |r| r.get::<_, i64>(0))
        .is_ok();
    if ocr_fts_empty && has_ocr {
        conn.execute_batch("INSERT INTO ocr_fts(ocr_fts) VALUES('rebuild');")?;
    }

    Ok(())
}

