//! Broken-path recovery slice: detection and repair of missing asset files.

import { api } from "../../lib/api";
import { reportError } from "../errorStore";
import type { BrokenAsset } from "../../types";
import type { AssetStore } from "../assetStore";

export function createRecoverySlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  _get: () => AssetStore,
) {
  return {
    brokenAssets: [] as BrokenAsset[],
    brokenLoading: false,

    detectBrokenAssets: async () => {
      set(() => ({ brokenLoading: true }));
      try {
        const broken = await api.detectBrokenAssets();
        set(() => ({ brokenAssets: broken }));
      } catch (e) {
        reportError(e, "Broken path detection");
      } finally {
        set(() => ({ brokenLoading: false }));
      }
    },

    applyRecovery: async (assetId: string, newPath: string) => {
      try {
        const updatedAsset = await api.applyRecovery(assetId, newPath);
        set((s) => ({
          brokenAssets: s.brokenAssets.filter((b) => b.asset.id !== assetId),
          assets: s.assets.map((a) => (a.id === assetId ? updatedAsset : a)),
          selectedAsset: s.selectedAsset?.id === assetId ? updatedAsset : s.selectedAsset,
        }));
      } catch (e) {
        reportError(e, "Apply recovery");
      }
    },

    skipBrokenAsset: (assetId: string) => {
      set((s) => ({
        brokenAssets: s.brokenAssets.filter((b) => b.asset.id !== assetId),
      }));
    },
  };
}
