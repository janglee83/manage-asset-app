use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub folder: String,
    pub modified_at: i64,
    pub created_at: i64,
    pub file_size: i64,
    pub hash: Option<String>,
    pub thumbnail_path: Option<String>,
    pub favorite: bool,
    pub indexed_at: i64,
    /// Tags associated with this asset.  Populated only when explicitly
    /// requested (e.g. asset detail view); `None` in bulk search results.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub text: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub folder: Option<String>,
    pub from_date: Option<i64>,
    pub to_date: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub favorites_only: Option<bool>,
    /// One of: "modified_at" | "created_at" | "file_name" | "file_size"
    pub sort_by: Option<String>,
    /// Tag values the result must include (AND semantics: all tags must match).
    pub tags: Option<Vec<String>>,
    /// One of: "exact" | "partial" | "fuzzy"  (default: "partial")
    pub search_mode: Option<String>,
    /// When `true`, text search also matches against OCR-extracted text stored
    /// in `asset_ocr`.  Defaults to `false` to preserve existing result ordering.
    pub include_ocr: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub assets: Vec<Asset>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned: usize,
    pub total: usize,
    pub current_file: String,
    pub done: bool,
}

/// Per-file error collected during a scan (non-fatal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileError {
    pub path: String,
    pub error: String,
}

/// Returned by a completed scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub indexed: usize,   // new or updated
    pub skipped: usize,   // unchanged (modified_at + size identical)
    pub errors: usize,    // files that could not be processed
    pub error_details: Vec<FileError>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedFolder {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
}

// ── Semantic search types ─────────────────────────────────────────────────────

/// Per-signal weight configuration for multi-factor ranked search.
/// All values are optional; missing ones fall back to Python-side defaults
/// (semantic 0.60 / keyword 0.15 / recency 0.10 / favorite 0.10 / folder 0.05).
/// Weights are re-normalised automatically so they need not sum to 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankWeights {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyword:  Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recency:  Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder:   Option<f32>,
}

/// Folder-priority rule: assets inside `prefix` receive `boost` (0.0 – 1.0).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderPriority {
    pub prefix: String,
    /// Priority boost in the range 0.0 (lowest) to 1.0 (highest).
    pub boost: f32,
}

/// Individual signal scores returned with each search hit (for diagnostics
/// and transparent UI display).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankSignals {
    pub semantic: f32,
    pub keyword:  f32,
    pub recency:  f32,
    pub favorite: f32,
    pub folder:   f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchQuery {
    /// Natural-language query (EN, Japanese, Vietnamese, or any of 50+ languages).
    pub query: String,
    /// Maximum results to return (default 20, max 200).
    pub top_k: Option<i64>,
    /// Minimum cosine similarity threshold, 0..1 (default 0.15).
    pub min_score: Option<f32>,
    /// Per-signal ranking weights.  Injected or overridden by the Rust host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<RankWeights>,
    /// UUIDs of assets currently marked as favourites.
    /// Injected by the Rust host from SQLite; callers need not populate this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite_ids: Option<Vec<String>>,
    /// Folder-priority rules (e.g. from app settings).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_priorities: Option<Vec<FolderPriority>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticHit {
    pub asset_id: String,
    /// Raw FAISS cosine-similarity score.
    pub score: f32,
    /// Final composite ranked score (weighted combination of all signals).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ranked_score: Option<f32>,
    /// Per-signal breakdown for diagnostics / transparent UI display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signals: Option<RankSignals>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchResult {
    pub results: Vec<SemanticHit>,
    /// Populated when the query was recognised as design language and expanded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub understanding: Option<DesignQueryUnderstanding>,
}

/// Detected concepts from the design language understanding layer.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DesignConcepts {
    pub styles:        Vec<String>,
    pub platforms:     Vec<String>,
    pub screen_types:  Vec<String>,
    pub domains:       Vec<String>,
    pub color_schemes: Vec<String>,
    pub moods:         Vec<String>,
}

/// Structured output from running a query through the design language layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignQueryUnderstanding {
    /// The original query string.
    pub original:        String,
    /// Single enriched prompt (first of `prompts`).
    pub expanded_prompt: String,
    /// Multiple prompts generated for multi-vector averaging.
    pub prompts:         Vec<String>,
    pub concepts:        DesignConcepts,
    /// Classifier confidence that this is a design-language query (0..1).
    pub confidence:      f64,
    pub is_design_query: bool,
}

/// Query for image-similarity search (the query IS an image file on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSearchQuery {
    /// Absolute path of the query image (any file the user drags in).
    pub file_path: String,
    /// Maximum results to return (default 20, max 200).
    pub top_k: Option<i64>,
    /// Minimum cosine similarity threshold (default 0.15).
    pub min_score: Option<f32>,
    /// Per-signal ranking weights.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<RankWeights>,
    /// UUIDs of assets currently marked as favourites.
    /// Injected by the Rust host from SQLite; callers need not populate this.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorite_ids: Option<Vec<String>>,
    /// Folder-priority rules (e.g. from app settings).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_priorities: Option<Vec<FolderPriority>>,
}

/// A single asset to embed (used in batch operations).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedEntry {
    pub asset_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedError {
    pub asset_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedBatchResult {
    pub indexed: i64,
    pub skipped: i64,
    pub errors: Vec<EmbedError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    pub total: i64,
    pub dimension: i32,
    pub index_type: String,
    pub image_model: String,
    pub text_model: String,
    pub schema_version: i32,
    pub needs_reindex: bool,
}

// ── Duplicate detection types ─────────────────────────────────────────────────

/// One asset entry sent to the Python sidecar for hash-based exact detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetHashEntry {
    pub asset_id: String,
    pub hash: Option<String>,
}

/// A single detected duplicate pair returned by the sidecar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicatePair {
    pub asset_a:    String,
    pub asset_b:    String,
    /// "exact" or "similar"
    pub dup_type:   String,
    /// 1.0 for exact duplicates; CLIP cosine score for similar duplicates.
    pub similarity: f32,
}

/// Full result returned by `detect_duplicates`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateResult {
    pub exact_pairs:   Vec<DuplicatePair>,
    pub similar_pairs: Vec<DuplicatePair>,
    pub total_exact:   i64,
    pub total_similar: i64,
    /// The similarity threshold that was used.
    pub threshold: f32,
}

/// Query parameters for the duplicate-detection command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateQuery {
    /// CLIP cosine-similarity cutoff for visual duplicates (default 0.92).
    pub similarity_threshold: Option<f32>,
    /// FAISS k per query (default 10).  Higher values find more distant pairs.
    pub max_neighbours: Option<i64>,
    /// Skip hash-based exact detection.
    pub skip_exact: Option<bool>,
    /// Skip CLIP embedding-based similar detection.
    pub skip_similar: Option<bool>,
}

/// A persisted duplicate pair row from the SQLite `duplicate_pairs` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredDuplicatePair {
    pub id:          i64,
    pub asset_a:     String,
    pub asset_b:     String,
    pub dup_type:    String,
    pub similarity:  f32,
    pub detected_at: i64,
    pub dismissed:   bool,
}

// ── Auto-tagging ────────────────────────────────────────────────────────────

/// A single tag suggestion returned by the Python CLIP tagger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagSuggestion {
    pub tag:   String,
    pub score: f32,
}

/// Request payload for `auto_tag_asset`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTagQuery {
    pub asset_id:  String,
    pub file_path: String,
    /// Maximum tags to return (default 8).
    pub top_k:     Option<i64>,
    /// Minimum cosine similarity to accept a tag (default 0.22).
    pub threshold: Option<f32>,
    /// If `true`, accepted tags are persisted into the `tags` table.
    pub save:      Option<bool>,
}

/// Response from `auto_tag_asset`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoTagResult {
    pub asset_id: String,
    /// All suggestions from the model (score ≥ threshold).
    pub tags:     Vec<TagSuggestion>,
    /// Tags that were actually written to SQLite (only when `save = true`).
    pub saved:    Vec<String>,
}

/// A tag row returned by `get_asset_tags`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagEntry {
    pub id:     i64,
    pub tag:    String,
    /// `"user"` | `"ai"` | `"import"`
    pub source: String,
}

// ── Search suggestions ────────────────────────────────────────────────────────

/// Category of a search suggestion — drives the icon shown in the dropdown.
///
/// * `History`  — string was previously searched by the user
/// * `Tag`      — matches a `tags.tag` value in the library
/// * `Filename` — matches a file name in the `assets` table
/// * `Folder`   — matches a folder path in the `assets` table
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionKind {
    History,
    Tag,
    Filename,
    Folder,
}

/// A single autocomplete suggestion row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
    /// The text to fill into the search box when this item is selected.
    pub text:  String,
    /// Where this suggestion came from.
    pub kind:  SuggestionKind,
    /// Frequency / relevance score used for ranking (higher = better).
    /// History: occurrence count.  Others: 1.
    pub score: i64,
}

/// Response from `get_suggestions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestionsResult {
    pub suggestions: Vec<Suggestion>,
}

// ────────────────────────────────────────────────────────────────────────
// OCR models
// ────────────────────────────────────────────────────────────────────────

/// Persisted OCR record for a single asset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrEntry {
    /// Asset UUID this record belongs to.
    pub asset_id:     String,
    /// All recognised text joined by spaces.
    pub full_text:    String,
    /// Languages used during extraction, e.g. `["en", "ja", "vi"]`.
    pub langs:        Vec<String>,
    /// Number of accepted text blocks (words / short phrases).
    pub word_count:   i64,
    /// Unix epoch of the last successful extraction.
    pub extracted_at: i64,
}

/// Input for the single-asset OCR command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrExtractQuery {
    pub asset_id:  String,
    pub file_path: String,
    /// Language codes to use.  Defaults to `["en", "ja", "vi"]` when absent.
    pub langs: Option<Vec<String>>,
}

/// One entry in a batch OCR request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrBatchEntry {
    pub asset_id:  String,
    pub file_path: String,
}

/// Per-item result inside `OcrBatchResult`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrItemResult {
    pub asset_id:   String,
    pub success:    bool,
    pub full_text:  String,
    pub word_count: i64,
    /// Populated when `success` is `false`.
    pub error:      Option<String>,
}

/// Final result of a batch OCR run returned by `extract_ocr_batch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrBatchResult {
    pub total:         usize,
    pub success_count: usize,
    pub results:       Vec<OcrItemResult>,
}

// ────────────────────────────────────────────────────────────────────────────
// .fig file metadata
// ────────────────────────────────────────────────────────────────────────────

/// Live extraction result returned directly from the sidecar.
/// Confidence is always "heuristic" for name fields (see fig_extractor.py).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FigMetadata {
    /// File stem (always available — from the file-system path).
    pub file_name:         String,
    /// Probable page names (heuristic — may include false positives).
    pub pages:             Vec<String>,
    /// Probable top-level frame names (heuristic).
    pub frame_names:       Vec<String>,
    /// Probable component / variant names (heuristic).
    pub component_names:   Vec<String>,
    /// Every candidate string extracted before classification (unfiltered).
    pub all_names:         Vec<String>,
    /// Number of thumbnail PNGs found in the ZIP (≈ page count, not names).
    pub thumbnail_count:   u32,
    /// All entry paths inside the ZIP archive.
    pub zip_entries:       Vec<String>,
    /// True when the file opened as a ZIP and contained a canvas blob.
    pub is_valid_fig:      bool,
    /// Always "kiwi_string_scan".
    pub extraction_method: String,
    /// Human-readable limitation notes.
    pub limitations:       Vec<String>,
}

/// Persisted row from `asset_fig_metadata` returned by `get_fig_metadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FigMetadataEntry {
    pub id:              i64,
    pub asset_id:        String,
    pub pages:           Vec<String>,
    pub frame_names:     Vec<String>,
    pub component_names: Vec<String>,
    pub all_names:       Vec<String>,
    pub thumbnail_count: u32,
    pub is_valid_fig:    bool,
    pub confidence:      String,
    pub extracted_at:    i64,
}

// ── Intelligence layer types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DominantColor {
    pub hex:    String,
    pub name:   String,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypographyZone {
    pub y:       f32,
    pub height:  f32,
    pub density: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignTokens {
    pub asset_id:         String,
    pub dominant_colors:  Vec<DominantColor>,
    pub typography_zones: Vec<TypographyZone>,
    pub spacing_class:    String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutSignature {
    pub asset_id:           String,
    pub aspect_ratio:       f32,
    pub layout_fingerprint: Vec<f32>,
    /// Serialised JSON of per-region complexity values.
    pub region_complexity:  serde_json::Value,
    pub layout_class:       String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetDescription {
    pub asset_id:    String,
    pub description: String,
    pub confidence:  f32,
    pub from_cache:  bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation {
    pub asset_id: String,
    pub score:    f32,
    pub reason:   String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendationResult {
    pub asset_id:       String,
    pub similar_assets: Vec<Recommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FamilyMember {
    pub asset_id: String,
    pub role:     String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentFamily {
    pub id:           String,
    pub name:         String,
    pub archetype_id: Option<String>,
    pub members:      Vec<FamilyMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildFamiliesResult {
    pub families:       Vec<ComponentFamily>,
    pub total_families: usize,
    pub total_assets:   usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub asset_id:      String,
    pub version_label: String,
    pub seq:           i32,
    pub modified_at:   i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionChain {
    pub chain_key:        String,
    pub versions:         Vec<VersionEntry>,
    pub latest_asset_id:  String,
    pub oldest_asset_id:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectVersionsResult {
    pub chains: Vec<VersionChain>,
    pub total:  usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRewrite {
    pub original:   String,
    pub rewritten:  String,
    pub confidence: f32,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfidenceSignals {
    pub semantic:  f32,
    pub keyword:   f32,
    pub behavior:  f32,
    pub design:    f32,
    pub folder:    f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfidenceResult {
    pub asset_id: String,
    pub score:    i32,
    pub label:    String,
    pub signals:  ConfidenceSignals,
}

// ── Bulk-tag suggestion ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkTagSuggestion {
    pub tag:        String,
    pub votes:      i32,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkTagSuggestResult {
    /// asset_id → list of tag suggestions (sorted by votes desc).
    pub suggestions: std::collections::HashMap<String, Vec<BulkTagSuggestion>>,
}

// ── Palette search ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteSearchHit {
    pub asset_id: String,
    pub score:    f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteSearchResult {
    pub results: Vec<PaletteSearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteCluster {
    pub id:       String,
    pub centroid: Vec<f32>,   // [L, a, b]
    pub member_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteClusterResult {
    pub clusters: Vec<PaletteCluster>,
}

// ── Design style classification ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleScore {
    pub style: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleClassification {
    pub asset_id:   String,
    pub style:      String,
    pub confidence: f32,
    pub all_styles: Vec<StyleScore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyAllStylesResult {
    pub classified: usize,
    pub total:      usize,
}

// ── Search intent parsing ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IntentFilters {
    pub date_from:   Option<i64>,
    pub date_to:     Option<i64>,
    pub sort_by:     String,
    pub colors:      Vec<String>,
    pub style:       Option<String>,
    pub platform:    Option<String>,
    pub folder_hint: Option<String>,
    pub extensions:  Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchIntent {
    pub semantic_query:  String,
    pub original_query:  String,
    pub filters:         IntentFilters,
    pub confidence:      f32,
    pub parsed_terms:    Vec<String>,
}

