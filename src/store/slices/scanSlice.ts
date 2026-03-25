//! Scan progress slice: scan state set by the file-watcher event handlers.

import type { ScanProgress } from "../../types";

export function createScanSlice() {
  return {
    scanProgress: null as ScanProgress | null,
    isScanning: false,

    setScanProgress: (p: ScanProgress | null) => ({ scanProgress: p }),
    setIsScanning:   (v: boolean)             => ({ isScanning: v }),
  };
}
