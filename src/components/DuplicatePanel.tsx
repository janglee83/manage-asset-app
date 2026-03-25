/**
 * DuplicatePanel
 *
 * Full-panel view that shows detected duplicate asset pairs and lets the user
 * inspect or dismiss them.
 *
 * Layout
 * ------
 * ┌──────────────────────────────────────────────────────────────┐
 * │  Header: title + scan button + threshold slider + tabs       │
 * ├──────────────────────────────────────────────────────────────┤
 * │  List of duplicate pair cards                                │
 * │    ┌──────────────┐  ┌──────────────┐                       │
 * │    │  Asset A     │  │  Asset B     │  similarity  dismiss   │
 * │    └──────────────┘  └──────────────┘                       │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Each card shows thumbnails (from the store cache), filenames, similarity
 * type (exact / similar), the CLIP score, and action buttons.
 */

import { useEffect, useState } from "react";
import {
  GitMerge, Loader2, ScanSearch, X, Hash,
  Eye, AlertTriangle, CheckCircle2,
} from "lucide-react";
import clsx from "clsx";
import { useDuplicates } from "../hooks/useDuplicates";
import { useAssetStore } from "../store/assetStore";
import { useActivityLock } from "../hooks/useActivityLock";
import { useT } from "../lib/i18n";
import { Tooltip } from "./Tooltip";
import { api } from "../lib/api";
import { formatFileSize } from "../lib/utils";
import type { Asset, StoredDuplicatePair } from "../types";

// ---------------------------------------------------------------------------
// Threshold presets
// ---------------------------------------------------------------------------
const PRESETS = [
  { label: "Near-identical",  value: 0.98, desc: "Same image, different format/crop" },
  { label: "Very similar",    value: 0.95, desc: "Same subject, minor edits" },
  { label: "Similar",         value: 0.92, desc: "Same scene, different lighting" },
  { label: "Broadly similar", value: 0.85, desc: "Same theme or concept" },
];

// ---------------------------------------------------------------------------
// PairCard
// ---------------------------------------------------------------------------

interface PairCardProps {
  pair:     StoredDuplicatePair;
  assetA:   Asset | null;
  assetB:   Asset | null;
  onView:   (asset: Asset) => void;
  onDismiss: (id: number) => void;
}

function PairCard({ pair, assetA, assetB, onView, onDismiss }: PairCardProps) {
  const { thumbnailCache, loadThumbnail } = useAssetStore();

  useEffect(() => {
    if (assetA) loadThumbnail(assetA.id);
    if (assetB) loadThumbnail(assetB.id);
  }, [assetA?.id, assetB?.id]);

  const thumbA = assetA ? thumbnailCache[assetA.id] : undefined;
  const thumbB = assetB ? thumbnailCache[assetB.id] : undefined;
  const isExact = pair.dup_type === "exact";

  return (
    <div className="flex items-center gap-3 bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 hover:border-slate-600 transition-colors">
      {/* Asset A */}
      <AssetThumb asset={assetA} thumb={thumbA} onView={onView} />

      {/* Similarity indicator */}
      <div className="flex flex-col items-center gap-1 shrink-0 w-20 text-center">
        {isExact ? (
          <Hash size={16} className="text-amber-400" />
        ) : (
          <GitMerge size={16} className="text-violet-400" />
        )}
        <span
          className={clsx(
            "text-[11px] font-semibold px-2 py-0.5 rounded-full",
            isExact
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "bg-violet-500/15 text-violet-300 border border-violet-500/30"
          )}
        >
          {isExact ? "exact" : `${Math.round(pair.similarity * 100)}%`}
        </span>
        <span className="text-[10px] text-slate-500">{isExact ? "hash match" : "visual"}</span>
      </div>

      {/* Asset B */}
      <AssetThumb asset={assetB} thumb={thumbB} onView={onView} />

      {/* Actions */}
      <div className="ml-auto flex flex-col gap-1.5 shrink-0">
        <button
          onClick={() => onDismiss(pair.id)}
          title="Dismiss this pair"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
        >
          <X size={11} />
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssetThumb
// ---------------------------------------------------------------------------

interface AssetThumbProps {
  asset: Asset | null;
  thumb: string | undefined;
  onView: (a: Asset) => void;
}

function AssetThumb({ asset, thumb, onView }: AssetThumbProps) {
  if (!asset) {
    return (
      <div className="w-20 h-20 rounded-lg bg-slate-700/50 flex items-center justify-center shrink-0">
        <AlertTriangle size={16} className="text-slate-500" />
      </div>
    );
  }

  return (
    <button
      onClick={() => onView(asset)}
      className="group flex flex-col items-center gap-1 w-24 shrink-0"
      title={asset.file_path}
    >
      <div className="w-24 h-20 rounded-lg overflow-hidden bg-slate-900 flex items-center justify-center border border-slate-700/50 group-hover:border-violet-500/50 transition-colors">
        {thumb ? (
          <img src={thumb} alt={asset.file_name} className="w-full h-full object-cover" />
        ) : (
          <Eye size={16} className="text-slate-500" />
        )}
      </div>
      <span className="text-[10px] text-slate-400 w-full truncate text-center" title={asset.file_name}>
        {asset.file_name}
      </span>
      <span className="text-[10px] text-slate-600">
        {formatFileSize(asset.file_size)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DuplicatePanel
// ---------------------------------------------------------------------------

export function DuplicatePanel({ onClose }: { onClose?: () => void }) {
  const { pairs, isScanning, error, totalExact, totalSimilar, threshold, scan, load, dismiss } =
    useDuplicates();

  const { assets, setSelectedAsset } = useAssetStore();
  const { canDetectDuplicates, lockTooltip } = useActivityLock();
  const t = useT();

  const [activeTab,  setActiveTab]  = useState<"all" | "exact" | "similar">("all");
  const [customThreshold, setCustomThreshold] = useState(0.92);
  const [skipExact,   setSkipExact]   = useState(false);
  const [skipSimilar, setSkipSimilar] = useState(false);
  const [assetCache,  setAssetCache]  = useState<Record<string, Asset>>({});

  // Build a fast UUID → Asset lookup from the store
  useEffect(() => {
    const map: Record<string, Asset> = {};
    for (const a of assets) map[a.id] = a;
    setAssetCache(map);
  }, [assets]);

  // Fetch assets for pair members that aren't in the store (e.g. after page load)
  useEffect(() => {
    const missing = new Set<string>();
    for (const p of pairs) {
      if (!assetCache[p.asset_a]) missing.add(p.asset_a);
      if (!assetCache[p.asset_b]) missing.add(p.asset_b);
    }
    if (missing.size === 0) return;
    Promise.all(
      [...missing].map((id) => api.getAsset(id))
    ).then((results) => {
      setAssetCache((prev) => {
        const next = { ...prev };
        for (const a of results) if (a) next[a.id] = a;
        return next;
      });
    });
  }, [pairs]);

  // Load existing pairs on mount
  useEffect(() => {
    load();
  }, []);

  const visiblePairs =
    activeTab === "all"
      ? pairs
      : pairs.filter((p) => p.dup_type === activeTab);

  const handleScan = () => {
    scan({
      similarity_threshold: customThreshold,
      skip_exact:   skipExact,
      skip_similar: skipSimilar,
    });
  };

  const tabCls = (tab: typeof activeTab) =>
    clsx(
      "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
      activeTab === tab
        ? "bg-violet-600 text-white"
        : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
    );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-700/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitMerge size={17} className="text-violet-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-200">{t.duplicates.title}</h2>
              <p className="text-[11px] text-slate-500">{t.duplicates.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScan}
              disabled={isScanning || !canDetectDuplicates}
              title={canDetectDuplicates ? t.duplicates.detectTip : lockTooltip(["scan", "embed"])}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                isScanning || !canDetectDuplicates
                  ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 text-white"
              )}
            >
              {isScanning ? (
                <><Loader2 size={12} className="animate-spin" /> {t.duplicates.detecting}</>
              ) : (
                <><ScanSearch size={12} /> {t.duplicates.detect}</>
              )}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                title={t.duplicates.close}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Threshold + options */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Tooltip text={t.duplicates.thresholdTip} position="right">
              <span className="text-slate-400 shrink-0 cursor-help">{t.duplicates.threshold}:</span>
            </Tooltip>
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  title={p.desc}
                  onClick={() => setCustomThreshold(p.value)}
                  className={clsx(
                    "px-2 py-0.5 rounded-md border text-[11px] transition-colors",
                    customThreshold === p.value
                      ? "border-violet-500 bg-violet-500/20 text-violet-300"
                      : "border-slate-600 text-slate-400 hover:border-slate-500"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-slate-500 tabular-nums">
              {(customThreshold * 100).toFixed(0)}%
            </span>
          </div>

          <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={skipExact}
              onChange={(e) => setSkipExact(e.target.checked)}
              className="accent-violet-500"
            />
            Skip exact
          </label>
          <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={skipSimilar}
              onChange={(e) => setSkipSimilar(e.target.checked)}
              className="accent-violet-500"
            />
            Skip similar
          </label>
        </div>

        {/* Stats summary */}
        {(totalExact > 0 || totalSimilar > 0) && (
          <div className="flex items-center gap-3 text-xs">
            <CheckCircle2 size={12} className="text-green-400" />
            <span className="text-slate-300">
              Found{" "}
              <span className="font-semibold text-amber-300">{totalExact} {t.duplicates.exact}</span>
              {" "}+{" "}
              <span className="font-semibold text-violet-300">{totalSimilar} {t.duplicates.visual}</span>
              {" "}pairs
              {" "}(threshold {(threshold * 100).toFixed(0)}%)
            </span>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </p>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1">
          <button className={tabCls("all")}     onClick={() => setActiveTab("all")}>
            {t.duplicates.tabAll} ({pairs.length})
          </button>
          <button className={tabCls("exact")}   onClick={() => setActiveTab("exact")}>
            {t.duplicates.tabExact} ({pairs.filter((p) => p.dup_type === "exact").length})
          </button>
          <button className={tabCls("similar")} onClick={() => setActiveTab("similar")}>
            {t.duplicates.tabVisual} ({pairs.filter((p) => p.dup_type === "similar").length})
          </button>
        </div>
      </div>

      {/* ── Pair list ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {visiblePairs.length === 0 && !isScanning && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-500">
            <GitMerge size={32} className="opacity-30" />
            <p className="text-sm">
              {pairs.length === 0
                ? t.duplicates.runFirstDesc
                : `No ${activeTab === "exact" ? t.duplicates.exact : t.duplicates.visual} duplicates.`}
            </p>
          </div>
        )}

        {visiblePairs.map((pair) => (
          <PairCard
            key={pair.id}
            pair={pair}
            assetA={assetCache[pair.asset_a] ?? null}
            assetB={assetCache[pair.asset_b] ?? null}
            onView={(a) => setSelectedAsset(a)}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}
