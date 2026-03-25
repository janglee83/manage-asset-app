import { invoke } from "@tauri-apps/api/core";
import type { OcrBatchEntry, OcrBatchResult, OcrEntry, OcrExtractQuery } from "../../types";

export const ocrApi = {
  extractOcrText: (query: OcrExtractQuery): Promise<OcrEntry> =>
    invoke("extract_ocr_text", { query }),

  extractOcrBatch: (entries: OcrBatchEntry[], langs?: string[]): Promise<OcrBatchResult> =>
    invoke("extract_ocr_batch", { entries, langs }),

  getOcrText: (assetId: string): Promise<OcrEntry | null> =>
    invoke("get_ocr_text", { assetId }),
};
