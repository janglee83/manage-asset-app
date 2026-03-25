/**
 * Combined Zustand store — assembles all domain slices.
 *
 * Slice implementations live in ./slices/ (one file per concern):
 *   assetSlice        — assets, folders, search, favorites
 *   thumbnailSlice    — thumbnail cache + LRU eviction
 *   scanSlice         — scan progress
 *   imageSearchSlice  — visual image-similarity search
 *   embeddingSlice    — CLIP/FAISS index stats + embed-all
 *   recoverySlice     — broken-path detection and repair
 *   intelligenceSlice — recommendations, descriptions, version chains, query rewriting
 */

import { create } from "zustand";
import type {
  Asset,
  AppStats,
  AssetDescription,
  BrokenAsset,
  BuildFamiliesResult,
  ConfidenceResult,
  DetectVersionsResult,
  EmbedBatchResult,
  IndexStats,
  QueryRewrite,
  RecommendationResult,
  ScanProgress,
  SearchQuery,
  ViewMode,
  WatchedFolder,
} from "../types";

import { createAssetSlice }        from "./slices/assetSlice";
import { createThumbnailSlice }    from "./slices/thumbnailSlice";
import { createImageSearchSlice }  from "./slices/imageSearchSlice";
import { createEmbeddingSlice }    from "./slices/embeddingSlice";
import { createRecoverySlice }     from "./slices/recoverySlice";
import { createIntelligenceSlice } from "./slices/intelligenceSlice";

// Resolved image-similarity hit (asset + cosine score)
export interface SimilarityResult {
  asset: Asset;
  score: number;
}

// Full store interface — union of all slices.
export interface AssetStore {
  // ── Asset / folder slice ─────────────────────────────────────────────────
  assets: Asset[];
  total: number;
  selectedAsset: Asset | null;
  selectedIndex: number;
  searchQuery: SearchQuery;
  viewMode: ViewMode;
  extFilters: string[];
  watchedFolders: WatchedFolder[];
  stats: AppStats | null;
  isLoading: boolean;
  setSelectedAsset: (asset: Asset | null) => void;
  setSelectedIndex: (idx: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setExtFilters: (exts: string[]) => void;
  setSearchQuery: (query: Partial<SearchQuery>) => void;
  runSearch: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadFolders: () => Promise<void>;
  addFolder: (path: string) => Promise<void>;
  removeFolder: (path: string) => Promise<void>;
  rescanFolder: (path: string) => Promise<void>;
  loadStats: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;

  // ── Thumbnail slice ──────────────────────────────────────────────────────
  thumbnailCache: Record<string, string>;
  _thumbKeys: string[];
  loadThumbnail: (id: string) => Promise<void>;
  scheduleThumbLoad: (id: string) => void;

  // ── Scan slice ───────────────────────────────────────────────────────────
  scanProgress: ScanProgress | null;
  isScanning: boolean;
  setScanProgress: (p: ScanProgress | null) => void;
  setIsScanning: (v: boolean) => void;

  // ── Image search slice ───────────────────────────────────────────────────
  imageSearchActive: boolean;
  imageSearchResults: SimilarityResult[];
  imageSearchLoading: boolean;
  imageSearchError: string | null;
  imageSearchFile: string | null;
  imageSearchMinScore: number;
  imageSearchTopK: number;
  runImageSearch: (filePath: string) => Promise<void>;
  clearImageSearch: () => void;
  setImageSearchParams: (params: { minScore?: number; topK?: number }) => void;

  // ── Embedding slice ──────────────────────────────────────────────────────
  indexStats: IndexStats | null;
  indexStatsLoading: boolean;
  embedAllLoading: boolean;
  embedAllResult: EmbedBatchResult | null;
  autoTagLoading: boolean;
  autoTagProgress: { done: number; total: number } | null;
  loadIndexStats: () => Promise<void>;
  runEmbedAll: () => Promise<void>;
  runAutoTagAll: () => Promise<void>;
  setAutoTagProgress: (p: { done: number; total: number } | null) => void;

  // ── Recovery slice ───────────────────────────────────────────────────────
  brokenAssets: BrokenAsset[];
  brokenLoading: boolean;
  detectBrokenAssets: () => Promise<void>;
  applyRecovery: (assetId: string, newPath: string) => Promise<void>;
  skipBrokenAsset: (assetId: string) => void;

  // ── Intelligence slice ───────────────────────────────────────────────────
  recommendations: RecommendationResult | null;
  recommendationsLoading: boolean;
  getRecommendations: (assetId: string) => Promise<void>;
  clearRecommendations: () => void;
  assetDescription: AssetDescription | null;
  descriptionLoading: boolean;
  getDescription: (assetId: string) => Promise<void>;
  componentFamilies: BuildFamiliesResult | null;
  familiesLoading: boolean;
  buildComponentFamilies: () => Promise<void>;
  versionChains: DetectVersionsResult | null;
  versionChainsLoading: boolean;
  detectVersionChains: () => Promise<void>;
  lastRewrite: QueryRewrite | null;
  rewriteQuery: (query: string) => Promise<QueryRewrite>;
  lastConfidence: ConfidenceResult | null;
  recordInteraction: (
    query: string,
    assetId: string,
    type: "click" | "favorite" | "copy",
    semanticScore: number,
    sessionKey?: string,
  ) => Promise<void>;
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  ...createAssetSlice(set, get),
  ...createThumbnailSlice(set, get),
  // Scan slice fields
  scanProgress: null,
  isScanning: false,
  setScanProgress: (p) => set({ scanProgress: p }),
  setIsScanning:   (v) => set({ isScanning: v }),
  ...createImageSearchSlice(set, get),
  ...createEmbeddingSlice(set, get),
  ...createRecoverySlice(set, get),
  ...createIntelligenceSlice(set, get),
}));
