import { invoke } from "@tauri-apps/api/core";
import type {
  Asset,
  SearchQuery,
  SearchResult,
  WatchedFolder,
  AppStats,
  ScanResult,
} from "../types";

export const api = {
  // Folder management
  addFolder: (path: string): Promise<ScanResult> =>
    invoke("add_folder", { path }),

  removeFolder: (path: string): Promise<void> =>
    invoke("remove_folder", { path }),

  getFolders: (): Promise<WatchedFolder[]> => invoke("get_folders"),

  rescanFolder: (path: string): Promise<ScanResult> =>
    invoke("rescan_folder", { path }),

  // Search
  search: (query: SearchQuery): Promise<SearchResult> =>
    invoke("search", { query }),

  // Asset detail
  getAsset: (id: string): Promise<Asset | null> =>
    invoke("get_asset", { id }),

  toggleFavorite: (id: string): Promise<boolean> =>
    invoke("toggle_favorite", { id }),

  getThumbnail: (id: string): Promise<string | null> =>
    invoke("get_thumbnail", { id }),

  // File actions
  openFile: (path: string): Promise<void> =>
    invoke("open_file", { path }),

  revealInExplorer: (path: string): Promise<void> =>
    invoke("reveal_in_explorer", { path }),

  // Stats
  getStats: (): Promise<AppStats> => invoke("get_stats"),

  // Remove from index
  removeAsset: (id: string): Promise<void> =>
    invoke("remove_asset", { id }),
};
