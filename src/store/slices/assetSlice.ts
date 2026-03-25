//! Core asset and folder slice: search, pagination, favorites, folder management.

import { api } from "../../lib/api";
import { reportError } from "../errorStore";
import type {
  AppStats,
  Asset,
  SearchQuery,
  ViewMode,
  WatchedFolder,
} from "../../types";
import type { AssetStore } from "../assetStore";

export function createAssetSlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  get: () => AssetStore,
) {
  return {
    assets: [] as Asset[],
    total: 0,
    selectedAsset: null as Asset | null,
    selectedIndex: -1,
    searchQuery: { limit: 60, offset: 0, sort_by: "modified_at" } as SearchQuery,
    viewMode: "grid" as ViewMode,
    extFilters: [] as string[],
    watchedFolders: [] as WatchedFolder[],
    stats: null as AppStats | null,
    isLoading: false,

    setSelectedAsset: (asset: Asset | null) =>
      set((s) => ({
        selectedAsset: asset,
        selectedIndex: asset ? s.assets.findIndex((a) => a.id === asset.id) : -1,
      })),

    setSelectedIndex: (idx: number) =>
      set((s) => ({
        selectedIndex: idx,
        selectedAsset: idx >= 0 && idx < s.assets.length ? s.assets[idx] : null,
      })),

    setViewMode: (mode: ViewMode) => set(() => ({ viewMode: mode })),

    setExtFilters: (exts: string[]) => {
      set(() => ({ extFilters: exts }));
      get().setSearchQuery({ extensions: exts.length > 0 ? exts : undefined });
    },

    setSearchQuery: (query: Partial<SearchQuery>) => {
      set((s) => ({
        searchQuery: { ...s.searchQuery, ...query, offset: 0 },
      }));
      get().runSearch();
    },

    runSearch: async () => {
      const q = { ...get().searchQuery, offset: 0 };
      set(() => ({ isLoading: true }));
      try {
        const result = await api.search(q);
        set(() => ({ assets: result.assets, total: result.total, searchQuery: { ...q } }));
      } catch (e) {
        reportError(e, "Search");
      } finally {
        set(() => ({ isLoading: false }));
      }
    },

    loadMore: async () => {
      const { searchQuery, assets, total, isLoading } = get();
      if (isLoading || assets.length >= total) return;
      const nextOffset = assets.length;
      const q = { ...searchQuery, offset: nextOffset };
      set(() => ({ isLoading: true }));
      try {
        const result = await api.search(q);
        set((s) => ({
          assets: [...s.assets, ...result.assets],
          searchQuery: { ...q },
        }));
      } catch (e) {
        reportError(e, "Load more");
      } finally {
        set(() => ({ isLoading: false }));
      }
    },

    loadFolders: async () => {
      const folders = await api.getFolders();
      set(() => ({ watchedFolders: folders }));
    },

    addFolder: async (path: string) => {
      set(() => ({ isScanning: true }));
      try {
        await api.addFolder(path);
        await get().loadFolders();
        await get().runSearch();
        await get().loadStats();
      } catch (e) {
        reportError(e, "Add folder");
      } finally {
        set(() => ({ isScanning: false, scanProgress: null }));
      }
    },

    removeFolder: async (path: string) => {
      try {
        await api.removeFolder(path);
        await get().loadFolders();
        await get().runSearch();
        await get().loadStats();
      } catch (e) {
        reportError(e, "Remove folder");
      }
    },

    rescanFolder: async (path: string) => {
      set(() => ({ isScanning: true }));
      try {
        await api.rescanFolder(path);
        await get().runSearch();
        await get().loadStats();
      } catch (e) {
        reportError(e, "Rescan folder");
      } finally {
        set(() => ({ isScanning: false, scanProgress: null }));
      }
    },

    loadStats: async () => {
      const stats = await api.getStats();
      set(() => ({ stats }));
    },

    toggleFavorite: async (id: string) => {
      try {
        const newVal = await api.toggleFavorite(id);
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, favorite: newVal } : a)),
          selectedAsset:
            s.selectedAsset?.id === id
              ? { ...s.selectedAsset, favorite: newVal }
              : s.selectedAsset,
        }));
      } catch (e) {
        reportError(e, "Toggle favorite");
      }
    },

    removeAsset: async (id: string) => {
      try {
        await api.removeAsset(id);
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
          selectedAsset: s.selectedAsset?.id === id ? null : s.selectedAsset,
          total: s.total - 1,
        }));
        await get().loadStats();
      } catch (e) {
        reportError(e, "Remove asset");
      }
    },
  };
}
