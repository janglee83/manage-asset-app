//! Embedding / FAISS index slice: stats and embed-all actions.

import { api } from "../../lib/api";
import { reportError } from "../errorStore";
import type { EmbedBatchResult, IndexStats } from "../../types";
import type { AssetStore } from "../assetStore";

export function createEmbeddingSlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  get: () => AssetStore,
) {
  return {
    indexStats: null as IndexStats | null,
    indexStatsLoading: false,
    embedAllLoading: false,
    embedAllResult: null as EmbedBatchResult | null,
    autoTagLoading: false,
    autoTagProgress: null as { done: number; total: number } | null,

    loadIndexStats: async () => {
      set(() => ({ indexStatsLoading: true }));
      try {
        const stats = await api.getSemanticStats();
        set(() => ({ indexStats: stats }));
      } catch {
        // Sidecar not available yet — silently ignore
      } finally {
        set(() => ({ indexStatsLoading: false }));
      }
    },

    runEmbedAll: async () => {
      if (get().embedAllLoading) return;
      set(() => ({ embedAllLoading: true, embedAllResult: null }));
      try {
        const result = await api.embedAllAssets();
        set(() => ({ embedAllResult: result, embedAllLoading: false }));
        await get().loadIndexStats();
      } catch (err) {
        set(() => ({ embedAllLoading: false }));
        reportError(err, "Build visual search index");
      }
    },

    runAutoTagAll: async () => {
      if (get().autoTagLoading) return;
      set(() => ({ autoTagLoading: true, autoTagProgress: null }));
      try {
        await api.autoTagAll();
      } catch {
        // Non-fatal: sidecar may not be running yet
      } finally {
        set(() => ({ autoTagLoading: false, autoTagProgress: null }));
      }
    },

    setAutoTagProgress: (p: { done: number; total: number } | null) => ({ autoTagProgress: p }),
  };
}
