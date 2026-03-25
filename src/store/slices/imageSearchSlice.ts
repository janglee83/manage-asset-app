//! Image similarity search slice: state + actions for visual search.

import { api } from "../../lib/api";
import { reportError } from "../errorStore";
import type { Asset } from "../../types";
import type { SimilarityResult } from "../assetStore";
import type { AssetStore } from "../assetStore";

export function createImageSearchSlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  get: () => AssetStore,
) {
  return {
    imageSearchActive: false,
    imageSearchResults: [] as SimilarityResult[],
    imageSearchLoading: false,
    imageSearchError: null as string | null,
    imageSearchFile: null as string | null,
    imageSearchMinScore: 0.15,
    imageSearchTopK: 30,

    runImageSearch: async (filePath: string) => {
      set(() => ({ imageSearchLoading: true, imageSearchError: null, imageSearchFile: filePath }));
      try {
        const { imageSearchMinScore, imageSearchTopK } = get();
        const { results } = await api.searchByImage({
          file_path: filePath,
          top_k: imageSearchTopK,
          min_score: imageSearchMinScore,
        });
        if (results.length === 0) {
          set(() => ({ imageSearchActive: true, imageSearchResults: [], imageSearchLoading: false }));
          return;
        }
        const settled = await Promise.allSettled(
          results.map((hit) =>
            api.getAsset(hit.asset_id).then((a) => ({ asset: a, score: hit.score })),
          ),
        );
        const resolved: SimilarityResult[] = settled
          .filter(
            (r): r is PromiseFulfilledResult<{ asset: Asset | null; score: number }> =>
              r.status === "fulfilled",
          )
          .filter((r) => r.value.asset !== null)
          .map((r) => ({ asset: r.value.asset as Asset, score: r.value.score }));
        set(() => ({ imageSearchActive: true, imageSearchResults: resolved, imageSearchLoading: false }));
      } catch (err) {
        set(() => ({ imageSearchLoading: false, imageSearchError: String(err) }));
        reportError(err, "Image search");
      }
    },

    clearImageSearch: () => {
      set(() => ({
        imageSearchActive: false,
        imageSearchResults: [],
        imageSearchError: null,
        imageSearchFile: null,
      }));
    },

    setImageSearchParams: ({ minScore, topK }: { minScore?: number; topK?: number }) => {
      set((s) => ({
        imageSearchMinScore: minScore ?? s.imageSearchMinScore,
        imageSearchTopK: topK ?? s.imageSearchTopK,
      }));
    },
  };
}
