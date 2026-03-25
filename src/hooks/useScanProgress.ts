import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAssetStore } from "../store/assetStore";
import type { ScanProgress } from "../types";

export function useScanProgress() {
  const setScanProgress    = useAssetStore((s) => s.setScanProgress);
  const setIsScanning      = useAssetStore((s) => s.setIsScanning);
  const runSearch          = useAssetStore((s) => s.runSearch);
  const loadStats          = useAssetStore((s) => s.loadStats);
  const runEmbedAll        = useAssetStore((s) => s.runEmbedAll);
  const runAutoTagAll      = useAssetStore((s) => s.runAutoTagAll);
  const setAutoTagProgress = useAssetStore((s) => s.setAutoTagProgress);
  const loadIndexStats     = useAssetStore((s) => s.loadIndexStats);

  useEffect(() => {
    const unlisten = listen<ScanProgress>("scan_progress", (event) => {
      const p = event.payload;
      setScanProgress(p);
      if (p.done) {
        setIsScanning(false);
        // Refresh the grid so newly scanned assets appear immediately,
        // even if the store's addFolder / rescanFolder action threw an error.
        runSearch();
        loadStats();
        // Auto-embed any newly indexed assets into the CLIP/FAISS vector index.
        // skip_indexed=true means already-embedded assets are a cheap no-op.
        // Fire-and-forget so the UI stays responsive.
        runEmbedAll().catch(() => undefined);
        loadIndexStats();
        // Auto-tag new image assets in the background after embedding finishes.
        // Safe to call right away — the sidecar queues requests sequentially.
        runAutoTagAll().catch(() => undefined);
      }
    });

    // Listen for auto-tag progress events from the Rust background task.
    const unlistenTag = listen<{ done: number; total: number; finished: boolean }>(
      "auto_tag_progress",
      (event) => {
        const { done, total, finished } = event.payload;
        if (finished) {
          setAutoTagProgress(null);
        } else {
          setAutoTagProgress({ done, total });
        }
      },
    );

    return () => {
      unlisten.then((f) => f());
      unlistenTag.then((f) => f());
    };
  }, [setScanProgress, setIsScanning, runSearch, loadStats, runEmbedAll,
      runAutoTagAll, setAutoTagProgress, loadIndexStats]);
}
