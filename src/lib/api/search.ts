import { invoke } from "@tauri-apps/api/core";
import type { SearchQuery, SearchResult, SuggestionsResult } from "../../types";

export const searchApi = {
  search: (query: SearchQuery): Promise<SearchResult> =>
    invoke("search", { query }),

  getSuggestions: (prefix: string, limit?: number): Promise<SuggestionsResult> =>
    invoke("get_suggestions", { prefix, limit: limit ?? 10 }),

  recordSearch: (keyword: string): Promise<void> =>
    invoke("record_search", { keyword }),

  clearSearchHistory: (): Promise<void> =>
    invoke("clear_search_history"),
};
