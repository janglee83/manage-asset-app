// Mirrors Rust models

export type SortBy = "modified_at" | "created_at" | "file_name" | "file_size";
export type ViewMode = "grid" | "list";

// Mirrors Rust models
export interface Asset {
  id: string;
  file_path: string;
  file_name: string;
  extension: string;
  folder: string;
  modified_at: number; // unix timestamp seconds
  created_at: number;  // unix timestamp seconds
  file_size: number;   // bytes
  hash?: string;
  thumbnail_path?: string;
  favorite: boolean;
  indexed_at: number;
}

export interface SearchQuery {
  text?: string;
  extensions?: string[];
  folder?: string;
  from_date?: number;
  to_date?: number;
  limit?: number;
  offset?: number;
  favorites_only?: boolean;
  sort_by?: SortBy;
}

export interface SearchResult {
  assets: Asset[];
  total: number;
}

export interface WatchedFolder {
  id: number;
  path: string;
  added_at: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  current_file: string;
  done: boolean;
}

export interface FileError {
  path: string;
  error: string;
}

export interface ScanResult {
  indexed: number;   // new or updated
  skipped: number;   // unchanged files
  errors: number;
  error_details: FileError[];
  duration_ms: number;
}

export interface AppStats {
  total_assets: number;
  favorites: number;
  watched_folders: number;
}

// ── Semantic search ────────────────────────────────────────────────────────

/**
 * Per-signal weights for multi-factor ranked search.
 * All fields are optional; missing values use Python-side defaults
 * (semantic 0.60 / keyword 0.15 / recency 0.10 / favorite 0.10 / folder 0.05).
 * Weights are re-normalised automatically and need not sum to 1.
 */
export interface RankWeights {
  semantic?: number;
  keyword?:  number;
  recency?:  number;
  favorite?: number;
  folder?:   number;
}

/** Folder-priority rule: assets inside `prefix` receive a `boost` (0–1). */
export interface FolderPriority {
  prefix: string;
  /** Priority boost in the range 0.0 (lowest) to 1.0 (highest). */
  boost: number;
}

/** Per-signal score breakdown attached to each search hit. */
export interface RankSignals {
  semantic: number;
  keyword:  number;
  recency:  number;
  favorite: number;
  folder:   number;
}

export interface SemanticSearchQuery {
  /** Natural-language query — EN, Japanese (日本語), Vietnamese (Tiếng Việt), … */
  query: string;
  /** Max results to return (default 20, max 200). */
  top_k?: number;
  /** Minimum cosine-similarity score 0..1 (default 0.15). */
  min_score?: number;
  /** Per-signal ranking weights. */
  weights?: RankWeights;
  /**
   * Folder-priority rules from app settings.
   * `favorite_ids` is injected by the Rust host — do not set from the frontend.
   */
  folder_priorities?: FolderPriority[];
  /**
   * When `true` (default), the sidecar runs the query through the design
   * language understanding layer and uses multi-prompt vector averaging for
   * queries like `"clean fintech screen"` or `"dark mobile dashboard"`.
   * Set to `false` to force raw encoding without expansion.
   */
  expand_design_terms?: boolean;
}

/** Query for image-similarity search using a local image file as probe. */
export interface ImageSearchQuery {
  /** Absolute path of the query image (any file the user drags in). */
  file_path: string;
  /** Max results to return (default 20, max 200). */
  top_k?: number;
  /** Minimum cosine-similarity threshold 0..1 (default 0.15). */
  min_score?: number;
  /** Per-signal ranking weights. */
  weights?: RankWeights;
  /** Folder-priority rules from app settings. */
  folder_priorities?: FolderPriority[];
}

export interface SemanticHit {
  asset_id: string;
  /** Raw FAISS cosine-similarity score. */
  score: number;
  /** Final composite ranked score (weighted combination of all signals). */
  ranked_score?: number;
  /** Per-signal breakdown for diagnostics and transparent UI display. */
  signals?: RankSignals;
}

export interface SemanticSearchResult {
  results: SemanticHit[];
  /**
   * Populated when the query was recognised as design language and expanded.
   * Lets the UI display "Understood as: clean + fintech + dashboard"
   * alongside the search results.
   */
  understanding?: DesignQueryUnderstanding;
}

// ─────────────────────────────────────────────────────────────────────────
// Design language understanding
// ─────────────────────────────────────────────────────────────────────────

/** Visual design concepts detected in a search query. */
export interface DesignConcepts {
  /** e.g. `["clean", "glassmorphism"]` */
  styles: string[];
  /** e.g. `["mobile", "web"]` */
  platforms: string[];
  /** e.g. `["dashboard", "checkout"]` */
  screen_types: string[];
  /** e.g. `["fintech", "saas"]` */
  domains: string[];
  /** e.g. `["dark", "gradient"]` */
  color_schemes: string[];
  /** e.g. `["professional", "elegant"]` */
  moods: string[];
}

/** Structured output from the design language understanding layer. */
export interface DesignQueryUnderstanding {
  /** The original query string. */
  original: string;
  /** Primary CLIP-ready prompt after expansion. */
  expanded_prompt: string;
  /**
   * Multiple prompts generated for multi-vector averaging.
   * The sidecar encodes all and averages the L2-normalised vectors.
   */
  prompts: string[];
  /** Structured breakdown of detected design concepts. */
  concepts: DesignConcepts;
  /** Classifier confidence that this is design language (0–1). */
  confidence: number;
  /** `true` when `confidence >= 0.35` — expansion was applied. */
  is_design_query: boolean;
}

/** A single asset entry for batch embedding. */
export interface EmbedEntry {
  asset_id: string;
  file_path: string;
}

export interface EmbedError {
  asset_id: string;
  error: string;
}

export interface EmbedBatchResult {
  indexed: number;
  skipped: number;
  errors: EmbedError[];
}

export interface IndexStats {
  total: number;
  dimension: number;
  index_type: string;
  image_model: string;
  text_model: string;
  schema_version: number;
  needs_reindex: boolean;
}

/** Push event emitted by the sidecar during batch embedding. */
export interface EmbedProgressEvent {
  event: "embed_progress";
  data: { done: number; total: number };
}

/** Push event emitted when sidecar models finish warming up. */
export interface WarmupCompleteEvent {
  event: "warmup_complete";
  data: { model_info: { image_model: string; text_model: string; dimension: number }; needs_reindex: boolean };
}

// ── Duplicate detection ────────────────────────────────────────────────────

/** Parameters for the duplicate detection pipeline. */
export interface DuplicateQuery {
  /** CLIP cosine cutoff for 'similar' pairs (default 0.92). */
  similarity_threshold?: number;
  /** FAISS k per query (default 10). */
  max_neighbours?: number;
  /** Skip hash-based exact detection. */
  skip_exact?: boolean;
  /** Skip CLIP embedding-based similar detection. */
  skip_similar?: boolean;
}

/** A single detected duplicate pair from the pipeline. */
export interface DuplicatePair {
  asset_a:    string;
  asset_b:    string;
  /** "exact" | "similar" */
  dup_type:   string;
  /** 1.0 for exact; CLIP cosine score for similar. */
  similarity: number;
}

/** Full result returned by the `detect_duplicates` command. */
export interface DuplicateResult {
  exact_pairs:   DuplicatePair[];
  similar_pairs: DuplicatePair[];
  total_exact:   number;
  total_similar: number;
  threshold:     number;
}

/** A duplicate pair row stored in the SQLite `duplicate_pairs` table. */
export interface StoredDuplicatePair {
  id:          number;
  asset_a:     string;
  asset_b:     string;
  dup_type:    string;
  similarity:  number;
  detected_at: number;
  dismissed:   boolean;
}

// ── Auto-tagging ────────────────────────────────────────────────────────────

/** A single tag suggestion returned by the CLIP tagger. */
export interface TagSuggestion {
  tag:   string;
  score: number;
}

/** Request payload for `autoTagAsset`. */
export interface AutoTagQuery {
  asset_id:  string;
  file_path: string;
  top_k?:    number;
  threshold?: number;
  /** When `true`, accepted tags are persisted into the `tags` table with source='ai'. */
  save?:     boolean;
}

/** Response from `autoTagAsset`. */
export interface AutoTagResult {
  asset_id: string;
  /** All suggestions returned by the model (score ≥ threshold). */
  tags:     TagSuggestion[];
  /** Tags actually written to SQLite (only populated when `save = true`). */
  saved:    string[];
}

/** A tag row from the SQLite `tags` table. */
export interface TagEntry {
  id:     number;
  tag:    string;
  /** `"user"` | `"ai"` | `"import"` */
  source: string;
}

// ── Search suggestions ────────────────────────────────────────────────────────

/** Where a suggestion came from — drives the icon in the dropdown. */
export type SuggestionKind = "history" | "tag" | "filename" | "folder";

/** A single autocomplete entry. */
export interface Suggestion {
  /** Text to fill into the search box. */
  text:  string;
  /** Source category. */
  kind:  SuggestionKind;
  /** Frequency / relevance score (higher = better, shown first). */
  score: number;
}

export interface SuggestionsResult {
  suggestions: Suggestion[];
}

// ── Broken-path recovery ───────────────────────────────────────────────

/**
 * How the candidate was found.
 * - `hash`             — SHA-256 match (confidence 1.0)
 * - `same_folder`      — file still in original parent folder
 * - `name_similarity`  — Jaro-Winkler ≥ 0.80, same extension
 */
export type RecoveryStrategy = "hash" | "same_folder" | "name_similarity";

export interface RecoveryCandidate {
  /** Absolute path of the candidate file on disk. */
  new_path:   string;
  /** Confidence in 0–1. */
  confidence: number;
  strategy:   RecoveryStrategy;
}

export interface BrokenAsset {
  /** The stale asset record (file_path no longer exists). */
  asset:      Asset;
  /** Ranked list of candidate replacement paths (may be empty). */
  candidates: RecoveryCandidate[];
}

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json";

// ── Folder intelligence ───────────────────────────────────────────────────────

/**
 * Semantic metadata inferred from a folder's path structure.
 * Mirrors the `folder_intelligence` SQLite table and Rust `FolderIntelligence` struct.
 */
export interface FolderIntelligence {
  /** Absolute folder path (primary key). */
  folder_path: string;
  /** Top-level category, e.g. "design", "icon", "photo". Empty when unknown. */
  category: string;
  /** Second-level label, e.g. "button", "mobile". Empty when none found. */
  subcategory: string;
  /** Space-separated lowercase path tokens used for LIKE matching in SQL. */
  tokens: string;
  /** Classifier confidence in [0, 1]. 1.0 for manual overrides. */
  confidence: number;
  /** Number of path segments (directory depth). */
  depth: number;
  /** True when the user has manually set the category. */
  is_manual: boolean;
}

/** All category labels the folder intelligence system can assign. */
export type FolderCategory =
  | "design"
  | "icon"
  | "brand"
  | "typography"
  | "photo"
  | "marketing"
  | "illustration"
  | "mockup"
  | "video"
  | "audio"
  | "document"
  | "code"
  | "export"
  | "archive"
  | "";

// ─────────────────────────────────────────────────────────────────────────
// Relation graph
// ─────────────────────────────────────────────────────────────────────────

export type RelationKind =
  | "component_family"
  | "version"
  | "platform_variant"
  | "same_stem"
  | "co_location";

/** A single edge in the asset relation graph. */
export interface AssetRelation {
  id: number;
  asset_a: string;
  asset_b: string;
  /** See {@link RelationKind}. */
  relation: RelationKind;
  /** Classifier confidence in the range [0, 1]. */
  confidence: number;
  /** Shared base stem that triggered the relation, e.g. `"button"`. */
  group_key: string;
  detected_at: number;
}

/** A cluster of assets that share the same `group_key`. */
export interface RelationGroup {
  group_key: string;
  relation: RelationKind;
  /** All asset UUIDs that are members of this group. */
  asset_ids: string[];
  confidence: number;
}

/** Summary returned by a full graph rebuild. */
export interface RelationGraphStats {
  edges_created: number;
  groups: number;
  assets_linked: number;
  duration_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────
// OCR
// ─────────────────────────────────────────────────────────────────────────

/** Persisted OCR record for a single asset. */
export interface OcrEntry {
  asset_id: string;
  /** All recognised text joined by spaces. */
  full_text: string;
  /** Language codes used during extraction, e.g. `["en", "ja", "vi"]`. */
  langs: string[];
  /** Number of accepted text blocks. */
  word_count: number;
  /** Unix epoch of the last successful extraction. */
  extracted_at: number;
}

/** Input query for {@link api.extractOcrText}. */
export interface OcrExtractQuery {
  asset_id: string;
  file_path: string;
  /** Defaults to `["en", "ja", "vi"]` when omitted. */
  langs?: string[];
}

/** Single item in an OCR batch request. */
export interface OcrBatchEntry {
  asset_id: string;
  file_path: string;
}

/** Per-item result in an OCR batch response. */
export interface OcrItemResult {
  asset_id: string;
  success: boolean;
  full_text: string;
  word_count: number;
  /** Set when `success` is `false`. */
  error: string | null;
}

/** Final result returned by {@link api.extractOcrBatch}. */
export interface OcrBatchResult {
  total: number;
  success_count: number;
  results: OcrItemResult[];
}

// ── .fig file metadata ──────────────────────────────────────────────────────

/**
 * Live extraction result returned by {@link api.extractFigMetadata}.
 *
 * Confidence is **always heuristic** for `pages`, `frame_names`, and
 * `component_names`.  Only `file_name` is certain.  See `fig_extractor.py`
 * and the `limitations` array for the full explanation.
 */
export interface FigMetadata {
  /** File stem — always available, taken directly from the file-system path. */
  file_name: string;
  /** Probable page names (Tier 3 — heuristic). May include false positives. */
  pages: string[];
  /** Probable top-level frame names (Tier 3 — heuristic). */
  frame_names: string[];
  /** Probable component / variant names (Tier 3 — heuristic). */
  component_names: string[];
  /** Every candidate string extracted before classification (unfiltered). */
  all_names: string[];
  /**
   * Number of thumbnail PNGs found in the ZIP archive (Tier 2 — approximate).
   * Figma generates one thumbnail per page, so this is an approximate page count,
   * but does NOT provide page names.
   */
  thumbnail_count: number;
  /** All entry paths inside the ZIP archive (structural overview). */
  zip_entries: string[];
  /** True when the file opened as a ZIP and contained a canvas binary blob. */
  is_valid_fig: boolean;
  /** Always `"kiwi_string_scan"`. */
  extraction_method: string;
  /** Human-readable notes about limitations of this extraction. */
  limitations: string[];
}

/**
 * Persisted row from `asset_fig_metadata` returned by
 * {@link api.getFigMetadata}.  `null` when no extraction has been run yet.
 */
export interface FigMetadataEntry {
  id: number;
  asset_id: string;
  pages: string[];
  frame_names: string[];
  component_names: string[];
  all_names: string[];
  thumbnail_count: number;
  is_valid_fig: boolean;
  /** Always `"heuristic"`. */
  confidence: string;
  /** Unix epoch of the last successful extraction. */
  extracted_at: number;
}

// ── Intelligence layer types ──────────────────────────────────────────────────

export interface DominantColor {
  hex: string;
  name: string;
  weight: number;
}

export interface TypographyZone {
  y: number;
  height: number;
  density: number;
}

export interface DesignTokens {
  asset_id: string;
  dominant_colors: DominantColor[];
  typography_zones: TypographyZone[];
  spacing_class: string;
}

export interface LayoutSignature {
  asset_id: string;
  aspect_ratio: number;
  layout_fingerprint: number[];
  region_complexity: Record<string, number>;
  layout_class: string;
}

export interface AssetDescription {
  asset_id: string;
  description: string;
  confidence: number;
  from_cache: boolean;
}

export interface Recommendation {
  asset_id: string;
  score: number;
  reason: string;
}

export interface RecommendationResult {
  asset_id: string;
  similar_assets: Recommendation[];
}

export interface FamilyMember {
  asset_id: string;
  role: string;
  confidence: number;
}

export interface ComponentFamily {
  id: string;
  name: string;
  archetype_id: string | null;
  members: FamilyMember[];
}

export interface BuildFamiliesResult {
  families: ComponentFamily[];
  total_families: number;
  total_assets: number;
}

export interface VersionEntry {
  asset_id: string;
  version_label: string;
  seq: number;
  modified_at: number;
}

export interface VersionChain {
  chain_key: string;
  versions: VersionEntry[];
  latest_asset_id: string;
  oldest_asset_id: string;
}

export interface DetectVersionsResult {
  chains: VersionChain[];
  total: number;
}

export interface QueryRewrite {
  original: string;
  rewritten: string;
  confidence: number;
  from_cache: boolean;
}

export interface ConfidenceSignals {
  semantic: number;
  keyword: number;
  behavior: number;
  design: number;
  folder: number;
}

export interface ConfidenceResult {
  asset_id: string;
  score: number;
  label: "high" | "medium" | "low";
  signals: ConfidenceSignals;
}

// ── Bulk-tag suggestion ────────────────────────────────────────────────────────

/** A single tag suggested for an asset by neighbourhood voting. */
export interface BulkTagSuggestion {
  tag:        string;
  /** Number of FAISS neighbours that carry this tag. */
  votes:      number;
  /** votes / top_k normalised to 0–1. */
  confidence: number;
}

/** Map of asset_id → list of tag suggestions. */
export interface BulkTagSuggestResult {
  suggestions: Record<string, BulkTagSuggestion[]>;
}

// ── Palette clustering + search ────────────────────────────────────────────────

/** A single cluster with its LAB centroid and member count. */
export interface PaletteCluster {
  id:           string;
  /** LAB centroid vector [L, a, b]. */
  centroid:     number[];
  member_count: number;
}

export interface PaletteClusterResult {
  clusters: PaletteCluster[];
}

/** A single palette-search hit. */
export interface PaletteSearchHit {
  asset_id: string;
  /** Cosine similarity in LAB space (0–1). */
  score:    number;
}

export interface PaletteSearchResult {
  results: PaletteSearchHit[];
}

// ── Design style classification ────────────────────────────────────────────────

/** A style option with its classifier score. */
export interface StyleScore {
  style: string;
  score: number;
}

/**
 * Result of classifying one asset's design style.
 * Possible `style` values: fintech | ecommerce | enterprise | saas |
 * gaming | healthcare | social | education | playful | productivity | unknown
 */
export interface StyleClassification {
  asset_id:   string;
  style:      string;
  confidence: number;
  all_styles: StyleScore[];
}

export interface ClassifyAllStylesResult {
  classified: number;
  total:      number;
}

// ── Natural-language intent parsing ───────────────────────────────────────────

/** Structured filters extracted from a natural-language query. */
export interface IntentFilters {
  date_from?:   number;   // Unix timestamp
  date_to?:     number;
  sort_by:      "newest" | "oldest" | "relevance";
  colors:       string[];
  style?:       string;
  platform?:    "mobile" | "web" | "desktop" | "tablet";
  folder_hint?: string;
  extensions:   string[];
}

/**
 * Structured output from parsing a natural-language search query.
 *
 * @example
 * parseSearchIntent("latest blue mobile dashboard")
 *  → { semantic_query: "mobile dashboard", filters: { colors: ["blue"],
 *      sort_by: "newest", platform: "mobile" }, confidence: 0.92 }
 */
export interface SearchIntent {
  /** Query with temporal/filter terms stripped — pass this to semantic search. */
  semantic_query:  string;
  /** Original unmodified input. */
  original_query:  string;
  filters:         IntentFilters;
  /** Confidence that parsing extracted at least one useful filter (0–1). */
  confidence:      number;
  /** The terms that were recognised and consumed as filters. */
  parsed_terms:    string[];
}

