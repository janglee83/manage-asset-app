import { invoke } from "@tauri-apps/api/core";
import type { AutoTagQuery, AutoTagResult, TagEntry } from "../../types";

export const tagsApi = {
  autoTagAsset: (query: AutoTagQuery): Promise<AutoTagResult> =>
    invoke("auto_tag_asset", { query }),

  /** Auto-tag every un-tagged image asset with CLIP. Fire-and-forget safe. */
  autoTagAll: (): Promise<unknown> =>
    invoke("auto_tag_new_assets"),

  getAssetTags: (assetId: string): Promise<TagEntry[]> =>
    invoke("get_asset_tags", { assetId }),

  addTag: (assetId: string, tag: string): Promise<void> =>
    invoke("add_tag", { assetId, tag }),

  removeTag: (assetId: string, tag: string): Promise<void> =>
    invoke("remove_tag", { assetId, tag }),
};
