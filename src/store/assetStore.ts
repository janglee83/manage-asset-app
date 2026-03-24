import { create } from "zustand";
import { api } from "../lib/api";
import type {
  Asset,
  SearchQuery,
  WatchedFolder,
  ScanProgress,
  AppStats,
  ViewMode,
} from "../types";

interface AssetStore {
  // Assets
  assets: Asset[];
  total: number;
  selectedAsset: Asset | null;
  selectedIndex: number;          // -1 = none; used for keyboard navigation
  thumbnailCache: Record<string, string>; // id -> base64

  // Search state
  searchQuery: SearchQuery;

  // UI state (persisted across searches)
  viewMode: ViewMode;
  extFilters: string[];           // active extension filter chips

  // Folders
  watchedFolders: WatchedFolder[];

  // Scan progress
  scanProgress: ScanProgress | null;
  isScanning: boolean;

  // Stats
  stats: AppStats | null;

  // Loading
  isLoading: boolean;

  // Actions
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
  setScanProgress: (p: ScanProgress | null) => void;
  setIsScanning: (v: boolean) => void;
  toggleFavorite: (id: string) => Promise<void>;
  loadThumbnail: (id: string) => Promise<void>;
  loadStats: () => Promise<void>;
  removeAsset: (id: string) => Promise<void>;
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  assets: [],
  total: 0,
  selectedAsset: null,
  selectedIndex: -1,
  thumbnailCache: {},
  searchQuery: { limit: 60, offset: 0, sort_by: "modified_at" },
  viewMode: "grid",
  extFilters: [],
  watchedFolders: [],
  scanProgress: null,
  isScanning: false,
  stats: null,
  isLoading: false,

  setSelectedAsset: (asset) =>
    set((s) => ({
      selectedAsset: asset,
      selectedIndex: asset ? s.assets.findIndex((a) => a.id === asset.id) : -1,
    })),

  setSelectedIndex: (idx) =>
    set((s) => ({
      selectedIndex: idx,
      selectedAsset: idx >= 0 && idx < s.assets.length ? s.assets[idx] : null,
    })),

  setViewMode: (mode) => set({ viewMode: mode }),

  setExtFilters: (exts) => {
    set({ extFilters: exts });
    get().setSearchQuery({ extensions: exts.length > 0 ? exts : undefined });
  },

  setSearchQuery: (query) => {
    set((s) => ({
      searchQuery: { ...s.searchQuery, ...query, offset: 0 },
    }));
    get().runSearch();
  },

  runSearch: async () => {
    const q = { ...get().searchQuery, offset: 0 };
    set({ isLoading: true });
    try {
      const result = await api.search(q);
      set({ assets: result.assets, total: result.total, searchQuery: { ...q } });
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { searchQuery, assets, total, isLoading } = get();
    if (isLoading || assets.length >= total) return;
    const nextOffset = assets.length;
    const q = { ...searchQuery, offset: nextOffset };
    set({ isLoading: true });
    try {
      const result = await api.search(q);
      set((s) => ({
        assets: [...s.assets, ...result.assets],
        searchQuery: { ...q },
      }));
    } finally {
      set({ isLoading: false });
    }
  },

  loadFolders: async () => {
    const folders = await api.getFolders();
    set({ watchedFolders: folders });
  },

  addFolder: async (path) => {
    set({ isScanning: true });
    try {
      await api.addFolder(path);
      await get().loadFolders();
      await get().runSearch();
      await get().loadStats();
    } finally {
      set({ isScanning: false, scanProgress: null });
    }
  },

  removeFolder: async (path) => {
    await api.removeFolder(path);
    await get().loadFolders();
    await get().runSearch();
    await get().loadStats();
  },

  rescanFolder: async (path) => {
    set({ isScanning: true });
    try {
      await api.rescanFolder(path);
      await get().runSearch();
      await get().loadStats();
    } finally {
      set({ isScanning: false, scanProgress: null });
    }
  },

  setScanProgress: (p) => set({ scanProgress: p }),
  setIsScanning: (v) => set({ isScanning: v }),

  toggleFavorite: async (id) => {
    const newVal = await api.toggleFavorite(id);
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, favorite: newVal } : a
      ),
      selectedAsset:
        s.selectedAsset?.id === id
          ? { ...s.selectedAsset, favorite: newVal }
          : s.selectedAsset,
    }));
  },

  loadThumbnail: async (id) => {
    if (get().thumbnailCache[id]) return;
    const thumb = await api.getThumbnail(id);
    if (thumb) {
      set((s) => ({
        thumbnailCache: { ...s.thumbnailCache, [id]: thumb },
      }));
    }
  },

  loadStats: async () => {
    const stats = await api.getStats();
    set({ stats });
  },

  removeAsset: async (id) => {
    await api.removeAsset(id);
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
      selectedAsset: s.selectedAsset?.id === id ? null : s.selectedAsset,
      total: s.total - 1,
    }));
    await get().loadStats();
  },
}));
