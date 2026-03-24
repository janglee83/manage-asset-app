// Mirrors Rust models

export type SortBy = "modified_at" | "created_at" | "file_name" | "file_size";
export type ViewMode = "grid" | "list";

// Mirrors Rust models
export interface Asset {
  id: string;
  file_path: string;
  file_name: string;
  extension: string;
  folder: string;
  modified_at: number; // unix timestamp seconds
  created_at: number;  // unix timestamp seconds
  file_size: number;   // bytes
  hash?: string;
  thumbnail_path?: string;
  favorite: boolean;
  indexed_at: number;
}

export interface SearchQuery {
  text?: string;
  extensions?: string[];
  folder?: string;
  from_date?: number;
  to_date?: number;
  limit?: number;
  offset?: number;
  favorites_only?: boolean;
  sort_by?: SortBy;
}

export interface SearchResult {
  assets: Asset[];
  total: number;
}

export interface WatchedFolder {
  id: number;
  path: string;
  added_at: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  current_file: string;
  done: boolean;
}

export interface FileError {
  path: string;
  error: string;
}

export interface ScanResult {
  indexed: number;   // new or updated
  skipped: number;   // unchanged files
  errors: number;
  error_details: FileError[];
  duration_ms: number;
}

export interface AppStats {
  total_assets: number;
  favorites: number;
  watched_folders: number;
}
