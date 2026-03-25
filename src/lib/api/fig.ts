import { invoke } from "@tauri-apps/api/core";
import type { FigMetadata, FigMetadataEntry } from "../../types";

export const figApi = {
  extractFigMetadata: (assetId: string): Promise<FigMetadata> =>
    invoke("extract_fig_metadata", { assetId }),

  getFigMetadata: (assetId: string): Promise<FigMetadataEntry | null> =>
    invoke("get_fig_metadata", { assetId }),
};
