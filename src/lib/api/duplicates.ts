import { invoke } from "@tauri-apps/api/core";
import type { DuplicateQuery, DuplicateResult, StoredDuplicatePair } from "../../types";

export const duplicatesApi = {
  detectDuplicates: (query: DuplicateQuery): Promise<DuplicateResult> =>
    invoke("detect_duplicates", { query }),

  getDuplicatePairs: (dupType?: string): Promise<StoredDuplicatePair[]> =>
    invoke("get_duplicate_pairs", { dupType: dupType ?? null }),

  dismissDuplicate: (pairId: number): Promise<void> =>
    invoke("dismiss_duplicate", { pairId }),
};
