import { Wand2 } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { useT } from "../lib/i18n";

export function ScanProgressBar() {
  const scanProgress   = useAssetStore((s) => s.scanProgress);
  const isScanning     = useAssetStore((s) => s.isScanning);
  const autoTagLoading = useAssetStore((s) => s.autoTagLoading);
  const autoTagProgress = useAssetStore((s) => s.autoTagProgress);
  const t = useT();

  const showScan = isScanning || (scanProgress && !scanProgress.done);
  const showTag  = autoTagLoading && !showScan;

  if (!showScan && !showTag) return null;

  if (showTag) {
    const tagPct = autoTagProgress && autoTagProgress.total > 0
      ? Math.round((autoTagProgress.done / autoTagProgress.total) * 100)
      : null;
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur border-t border-slate-700 px-4 py-2">
        <div className="flex items-center gap-3">
          <Wand2 size={13} className="text-violet-400 animate-pulse shrink-0" />
          <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: tagPct !== null ? `${tagPct}%` : "30%" }}
            />
          </div>
          <span className="text-xs text-slate-400 shrink-0">
            {autoTagProgress
              ? `${t.scan.autoTagging} ${autoTagProgress.done} / ${autoTagProgress.total}`
              : t.scan.autoTagging}
          </span>
        </div>
      </div>
    );
  }

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
              ? `${t.scan.done} · ${scanProgress.total} ${t.scan.filesIndexed}`
              : `${t.scan.indexing} ${scanProgress.scanned} / ${scanProgress.total}`
            : t.scan.scanning}
        </span>
      </div>
      {scanProgress?.current_file && !scanProgress.done && (
        <p className="text-xs text-slate-600 truncate mt-0.5">
          {t.scan.scanningFile}: {scanProgress.current_file}
        </p>
      )}
    </div>
  );
}
