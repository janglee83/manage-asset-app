import { invoke } from "@tauri-apps/api/core";
import type {
  EmbedBatchResult,
  EmbedEntry,
  ImageSearchQuery,
  IndexStats,
  SemanticSearchQuery,
  SemanticSearchResult,
} from "../../types";

export const semanticApi = {
  semanticSearch: (query: SemanticSearchQuery): Promise<SemanticSearchResult> =>
    invoke("semantic_search", { query }),

  searchByImage: (query: ImageSearchQuery): Promise<SemanticSearchResult> =>
    invoke("search_by_image", { query }),

  embedAsset: (assetId: string, filePath: string): Promise<unknown> =>
    invoke("embed_asset", { assetId, filePath }),

  embedBatch: (entries: EmbedEntry[]): Promise<EmbedBatchResult> =>
    invoke("embed_batch", { entries }),

  embedAllAssets: (): Promise<EmbedBatchResult> =>
    invoke("embed_all_assets"),

  rebuildSemanticIndex: (): Promise<unknown> =>
    invoke("rebuild_semantic_index"),

  getSemanticStats: (): Promise<IndexStats> =>
    invoke("get_semantic_stats"),
};
