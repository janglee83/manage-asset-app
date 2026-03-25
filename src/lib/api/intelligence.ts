import { invoke } from "@tauri-apps/api/core";
import type {
  AssetDescription,
  BuildFamiliesResult,
  BulkTagSuggestResult,
  ClassifyAllStylesResult,
  ConfidenceResult,
  DesignTokens,
  DetectVersionsResult,
  LayoutSignature,
  PaletteClusterResult,
  PaletteSearchResult,
  QueryRewrite,
  RecommendationResult,
  SearchIntent,
  StyleClassification,
} from "../../types";

export const intelligenceApi = {
  /** Analyse design tokens (colors, typography, spacing) for an asset. */
  analyzeDesignTokens: (assetId: string, filePath: string): Promise<DesignTokens> =>
    invoke("analyze_design_tokens", { assetId, filePath }),

  /** Extract a color-agnostic layout fingerprint for an asset. */
  analyzeLayout: (assetId: string, filePath: string): Promise<LayoutSignature> =>
    invoke("analyze_layout", { assetId, filePath }),

  /** Return visually similar assets for a given asset. */
  getRecommendations: (assetId: string, topK?: number): Promise<RecommendationResult> =>
    invoke("get_recommendations", { assetId, topK: topK ?? 8 }),

  /** Get or auto-generate a human-readable description for an asset. */
  getOrGenerateDescription: (assetId: string): Promise<AssetDescription> =>
    invoke("get_or_generate_description", { assetId }),

  /** Cluster all indexed assets into component families. */
  buildComponentFamilies: (): Promise<BuildFamiliesResult> =>
    invoke("build_component_families"),

  /** Detect version chains (v1/v2/final/old…) across all assets. */
  detectVersionChains: (): Promise<DetectVersionsResult> =>
    invoke("detect_version_chains"),

  /** Rewrite a query into a CLIP-optimised prompt (cached). */
  rewriteQuery: (query: string): Promise<QueryRewrite> =>
    invoke("rewrite_query", { query }),

  /** Record a user interaction (click / favorite) with a search result. */
  recordSearchInteraction: (
    query: string,
    assetId: string,
    interactionType: "click" | "favorite" | "copy",
    semanticScore: number,
    sessionKey: string,
  ): Promise<void> =>
    invoke("record_search_interaction", {
      query, assetId, interactionType, semanticScore, sessionKey,
    }),

  /** Get a 0–100 confidence breakdown for a (query, asset) pair. */
  getConfidenceBreakdown: (
    assetId: string,
    query: string,
    semanticScore: number,
  ): Promise<ConfidenceResult> =>
    invoke("get_confidence_breakdown", { assetId, query, semanticScore }),

  /**
   * Generate descriptions for all assets that don't have one yet.
   * Runs in the background — subscribe to the `auto_describe_progress` event
   * for incremental updates.
   */
  autoDescribeAll: (): Promise<{ ok: boolean; generated: number; total: number }> =>
    invoke("auto_describe_all"),

  // ── Bulk-tag suggestion ────────────────────────────────────────────────────

  /**
   * Suggest tags for `assetIds` by voting from their FAISS neighbours.
   * @param assetIds  IDs of assets to receive suggestions.
   * @param topK      Neighbours to inspect per asset (default 8).
   * @param minVotes  Minimum vote count for a tag to be included (default 2).
   */
  suggestBulkTags: (
    assetIds:  string[],
    topK?:     number,
    minVotes?: number,
  ): Promise<BulkTagSuggestResult> =>
    invoke("suggest_bulk_tags", { assetIds, topK, minVotes }),

  // ── Palette clustering + search ────────────────────────────────────────────

  /**
   * Cluster all assets by their dominant color palette.
   * Cluster IDs are persisted to SQLite for later filtering.
   */
  clusterPalette: (nClusters?: number): Promise<PaletteClusterResult> =>
    invoke("cluster_palette", { nClusters }),

  /**
   * Find assets whose dominant palette best matches the given color query.
   * @param query     Hex "#3B82F6", a color name "blue", or a comma-list.
   * @param topK      Max results (default 20).
   * @param minScore  Minimum LAB cosine similarity (default 0.5).
   */
  searchByPalette: (
    query:     string,
    topK?:     number,
    minScore?: number,
  ): Promise<PaletteSearchResult> =>
    invoke("search_by_palette", { query, topK, minScore }),

  // ── Style classification ──────────────────────────────────────────────────

  /**
   * Classify a single asset's design style.
   * Result is cached — subsequent calls return the cached version instantly.
   */
  classifyAssetStyle: (assetId: string): Promise<StyleClassification> =>
    invoke("classify_asset_style", { assetId }),

  /** Classify all assets that haven't been classified yet (batched). */
  classifyAllStyles: (): Promise<ClassifyAllStylesResult> =>
    invoke("classify_all_styles"),

  /** Return the cached style classification, or `null` if not yet classified. */
  getAssetStyle: (assetId: string): Promise<StyleClassification | null> =>
    invoke("get_asset_style", { assetId }),

  // ── Natural-language intent parsing ───────────────────────────────────────

  /**
   * Parse a natural-language search query into structured filters.
   *
   * @example
   * const intent = await api.parseSearchIntent("latest blue mobile dashboard");
   * // → { semantic_query: "mobile dashboard", filters: { colors: ["blue"],
   * //      sort_by: "newest", platform: "mobile" } }
   *
   * Pass `intent.semantic_query` to `semanticSearch` and merge
   * `intent.filters` into `SearchQuery` for combined keyword+filter search.
   */
  parseSearchIntent: (query: string): Promise<SearchIntent> =>
    invoke("parse_search_intent", { query }),
};
