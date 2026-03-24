import { useAssetStore } from "../store/assetStore";

export function ScanProgressBar() {
  const scanProgress = useAssetStore((s) => s.scanProgress);
  const isScanning = useAssetStore((s) => s.isScanning);

  if (!isScanning && !scanProgress) return null;

  const pct =
    scanProgress && scanProgress.total > 0
      ? Math.round((scanProgress.scanned / scanProgress.total) * 100)
      : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-700 px-4 py-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {scanProgress
            ? scanProgress.done
              ? `Done · ${scanProgress.total} files indexed`
              : `Indexing… ${scanProgress.scanned} / ${scanProgress.total}`
            : "Scanning…"}
        </span>
      </div>
      {scanProgress?.current_file && !scanProgress.done && (
        <p className="text-xs text-slate-600 truncate mt-0.5">{scanProgress.current_file}</p>
      )}
    </div>
  );
}
