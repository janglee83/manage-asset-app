import { invoke } from "@tauri-apps/api/core";
import type { FolderCategory, FolderIntelligence } from "../../types";

export const folderIntelApi = {
  getFolderIntelligence: (path: string): Promise<FolderIntelligence | null> =>
    invoke("get_folder_intelligence", { path }),

  listFolderIntelligence: (): Promise<FolderIntelligence[]> =>
    invoke("list_folder_intelligence"),

  overrideFolderCategory: (
    path: string,
    category: FolderCategory,
    subcategory: string,
  ): Promise<void> =>
    invoke("override_folder_category", { path, category, subcategory }),
};
