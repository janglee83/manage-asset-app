//! Thumbnail cache slice: LRU cache management, batch loading, single-load.

import { api } from "../../lib/api";
import type { AssetStore } from "../assetStore";

const MAX_THUMB_CACHE = 500;

/** IDs whose thumbnail fetch is in-flight or queued. */
const _thumbPending = new Set<string>();

/** Timer handle for the debounced batch-flush. */
let _thumbFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** Merge new thumbnails into the cache, evicting oldest entries (LRU). */
export function applyThumbUpdate(
  s: { thumbnailCache: Record<string, string>; _thumbKeys: string[] },
  incoming: Record<string, string>,
): { thumbnailCache: Record<string, string>; _thumbKeys: string[] } {
  const newEntries = Object.entries(incoming).filter(([k]) => !s.thumbnailCache[k]);
  const merged = { ...s.thumbnailCache, ...incoming };
  const keys = [...s._thumbKeys, ...newEntries.map(([k]) => k)];

  if (keys.length > MAX_THUMB_CACHE) {
    const evict = keys.splice(0, keys.length - MAX_THUMB_CACHE);
    evict.forEach((k) => delete merged[k]);
  }

  return { thumbnailCache: merged, _thumbKeys: keys };
}

export function createThumbnailSlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  get: () => AssetStore,
) {
  return {
    thumbnailCache: {} as Record<string, string>,
    _thumbKeys: [] as string[],

    loadThumbnail: async (id: string) => {
      if (get().thumbnailCache[id]) return;
      const thumb = await api.getThumbnail(id);
      if (thumb) {
        set((s) => applyThumbUpdate(s, { [id]: thumb }));
      }
    },

    scheduleThumbLoad: (id: string) => {
      if (get().thumbnailCache[id] || _thumbPending.has(id)) return;
      _thumbPending.add(id);
      if (_thumbFlushTimer !== null) return;
      _thumbFlushTimer = window.setTimeout(() => {
        _thumbFlushTimer = null;
        const batch = [..._thumbPending];
        _thumbPending.clear();
        if (batch.length === 0) return;
        api.getThumbnailsBatch(batch).then((map) => {
          if (Object.keys(map).length === 0) return;
          set((s) => applyThumbUpdate(s, map));
        }).catch(() => undefined);
      }, 16);
    },
  };
}
