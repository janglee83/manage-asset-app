import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAssetStore } from "../store/assetStore";
import type { ScanProgress } from "../types";

export function useScanProgress() {
  const setScanProgress = useAssetStore((s) => s.setScanProgress);
  const setIsScanning = useAssetStore((s) => s.setIsScanning);

  useEffect(() => {
    const unlisten = listen<ScanProgress>("scan_progress", (event) => {
      const p = event.payload;
      setScanProgress(p);
      if (p.done) {
        setIsScanning(false);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [setScanProgress, setIsScanning]);
}
