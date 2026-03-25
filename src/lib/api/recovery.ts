import { invoke } from "@tauri-apps/api/core";
import type { Asset, BrokenAsset } from "../../types";

export const recoveryApi = {
  detectBrokenAssets: (): Promise<BrokenAsset[]> =>
    invoke("detect_broken_assets"),

  applyRecovery: (assetId: string, newPath: string): Promise<Asset> =>
    invoke("apply_recovery", { assetId, newPath }),
};
