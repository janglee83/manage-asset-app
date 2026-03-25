import { invoke } from "@tauri-apps/api/core";
import type { ExportFormat } from "../../types";

export const exportApi = {
  exportAssets: (ids: string[], format: ExportFormat, outputPath: string): Promise<number> =>
    invoke("export_assets", { ids, format, outputPath }),
};
