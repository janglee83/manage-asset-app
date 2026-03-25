import { useState, useCallback } from "react";
import { api } from "../lib/api";
import type { DuplicateQuery, StoredDuplicatePair } from "../types";

export interface ResolvedDuplicatePair {
  stored: StoredDuplicatePair;
}

export interface UseDuplicatesReturn {
  // State
  pairs:      StoredDuplicatePair[];
  isScanning: boolean;
  error:      string | null;
  totalExact:   number;
  totalSimilar: number;
  threshold:    number;

  // Actions
  scan:    (opts?: DuplicateQuery) => Promise<void>;
  load:    (dupType?: string)      => Promise<void>;
  dismiss: (pairId: number)        => Promise<void>;
  clear:   ()                      => void;
}

/**
 * Manages duplicate detection state for the UI.
 *
 * Usage
 * -----
 * ```tsx
 * const { pairs, isScanning, scan, dismiss } = useDuplicates();
 *
 * // Run full pipeline with default threshold (0.92)
 * await scan();
 *
 * // Run with custom threshold
 * await scan({ similarity_threshold: 0.97, skip_exact: false });
 *
 * // Dismiss a pair
 * await dismiss(pair.id);
 * ```
 */
export function useDuplicates(): UseDuplicatesReturn {
  const [pairs,        setPairs]        = useState<StoredDuplicatePair[]>([]);
  const [isScanning,   setIsScanning]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [totalExact,   setTotalExact]   = useState(0);
  const [totalSimilar, setTotalSimilar] = useState(0);
  const [threshold,    setThreshold]    = useState(0.92);

  /** Run the full detection pipeline then refresh the stored pairs list. */
  const scan = useCallback(async (opts: DuplicateQuery = {}) => {
    setIsScanning(true);
    setError(null);
    try {
      const result = await api.detectDuplicates(opts);
      setTotalExact(result.total_exact);
      setTotalSimilar(result.total_similar);
      setThreshold(result.threshold);
      // Reload the stored pairs after the pipeline has persisted them.
      const fresh = await api.getDuplicatePairs();
      setPairs(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsScanning(false);
    }
  }, []);

  /** Load previously detected (persisted) pairs without re-running the pipeline. */
  const load = useCallback(async (dupType?: string) => {
    setError(null);
    try {
      const result = await api.getDuplicatePairs(dupType);
      setPairs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Dismiss a pair so it disappears from the list. */
  const dismiss = useCallback(async (pairId: number) => {
    try {
      await api.dismissDuplicate(pairId);
      setPairs((prev) => prev.filter((p) => p.id !== pairId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const clear = useCallback(() => {
    setPairs([]);
    setError(null);
    setTotalExact(0);
    setTotalSimilar(0);
  }, []);

  return { pairs, isScanning, error, totalExact, totalSimilar, threshold, scan, load, dismiss, clear };
}
