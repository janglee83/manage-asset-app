import { invoke } from "@tauri-apps/api/core";
import type { DesignQueryUnderstanding } from "../../types";

export const designApi = {
  understandDesignQuery: (query: string): Promise<DesignQueryUnderstanding> =>
    invoke("understand_design_query", { query }),
};
