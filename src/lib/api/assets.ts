import { invoke } from "@tauri-apps/api/core";
import type {
  Asset,
  AppStats,
  ScanResult,
  WatchedFolder,
} from "../../types";

export const assetsApi = {
  addFolder: (path: string): Promise<ScanResult> =>
    invoke("add_folder", { path }),

  removeFolder: (path: string): Promise<void> =>
    invoke("remove_folder", { path }),

  getFolders: (): Promise<WatchedFolder[]> =>
    invoke("get_folders"),

  rescanFolder: (path: string): Promise<ScanResult> =>
    invoke("rescan_folder", { path }),

  getAsset: (id: string): Promise<Asset | null> =>
    invoke("get_asset", { id }),

  toggleFavorite: (id: string): Promise<boolean> =>
    invoke("toggle_favorite", { id }),

  getThumbnail: (id: string): Promise<string | null> =>
    invoke("get_thumbnail", { id }),

  getThumbnailsBatch: (ids: string[]): Promise<Record<string, string>> =>
    invoke("get_thumbnails_batch", { ids }),

  openFile: (path: string): Promise<void> =>
    invoke("open_file", { path }),

  revealInExplorer: (path: string): Promise<void> =>
    invoke("reveal_in_explorer", { path }),

  getStats: (): Promise<AppStats> =>
    invoke("get_stats"),

  removeAsset: (id: string): Promise<void> =>
    invoke("remove_asset", { id }),
};
