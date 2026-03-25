/**
 * useActivityLock — derives the current "exclusive activity" from store state.
 *
 * Rules:
 *  scan     → cannot add/remove/rescan folders; cannot remove asset from index
 *  embed    → cannot start visual search; cannot run duplicate detection
 *  searching → cannot start another image search
 *
 * Components use the returned helpers to set `disabled` on buttons and show
 * a tooltip that explains *why* the action is blocked.
 */

import { useAssetStore } from "../store/assetStore";
import { useT } from "../lib/i18n";

export type LockReason = "scan" | "embed" | "search" | null;

export interface ActivityLock {
  /** The active exclusive activity, or null when idle. */
  lockReason: LockReason;

  /** True while any folder scan is in progress. */
  isScanning: boolean;
  /** True while the CLIP FAISS index is being (re)built. */
  isEmbedding: boolean;
  /** True while an image similarity search is in flight. */
  isSearching: boolean;

  // ── Derived capability flags ──────────────────────────────────────────────
  /** Folder add / remove / rescan → blocked while scanning. */
  canModifyFolders: boolean;
  /** Asset removal from index → blocked while scanning. */
  canRemoveAsset: boolean;
  /** Start a visual image search → blocked while embedding. */
  canImageSearch: boolean;
  /** Trigger duplicate detection → blocked while scanning or embedding. */
  canDetectDuplicates: boolean;
  /** Trigger embed-all → blocked while scanning. */
  canBuildIndex: boolean;

  /**
   * Returns a localised tooltip string explaining why an action is blocked,
   * or undefined when the action is available.
   */
  lockTooltip: (needs: LockReason | LockReason[]) => string | undefined;
}

export function useActivityLock(): ActivityLock {
  const isScanning          = useAssetStore((s) => s.isScanning);
  const isEmbedding         = useAssetStore((s) => s.embedAllLoading);
  const isSearching         = useAssetStore((s) => s.imageSearchLoading);
  const t                   = useT();

  const lockReason: LockReason = isScanning  ? "scan"
                               : isEmbedding ? "embed"
                               : null;

  const lockTooltip = (needs: LockReason | LockReason[]): string | undefined => {
    const reasons = Array.isArray(needs) ? needs : [needs];
    if (isScanning  && reasons.includes("scan"))   return t.general.scanLocked;
    if (isEmbedding && reasons.includes("embed"))  return t.general.embedLocked;
    if (isSearching && reasons.includes("search")) return t.general.searchLocked;
    return undefined;
  };

  return {
    lockReason,
    isScanning,
    isEmbedding,
    isSearching,

    canModifyFolders:  !isScanning,
    canRemoveAsset:    !isScanning,
    canImageSearch:    !isEmbedding,
    canDetectDuplicates: !isScanning && !isEmbedding,
    canBuildIndex:     !isScanning,

    lockTooltip,
  };
}
