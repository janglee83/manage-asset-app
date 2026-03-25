/**
 * ImageSearchPanel
 *
 * A slide-in right-hand panel (320 px) that provides the full
 * drag-and-drop image similarity search experience.
 *
 * Layout (top → bottom):
 *   ─ Header         "Visual Search"  •  close (×) button
 *   ─ Drop zone      Large dashed area.  Shows query-image preview after drop.
 *   ─ Controls       Similarity slider (0.10 – 0.90) + top-K selector
 *   ─ Action row     "Browse…" button + "Re-search" (when result is stale)
 *   ─ Results list   Compact ranked rows: thumbnail • name • score bar
 *   ─ Footer         "Back to all assets" clear button
 *
 * The panel is shown/hidden by toggling `imageSearchOpen` in the store.
 * The AssetGrid continues to power the main grid view; results are displayed
 * *both* inline in the panel (compact) and in the main grid (full fidelity).
 *
 * Drop behaviour
 * ──────────────
 * A global `tauri://drag-drop` listener (useGlobalImageDrop) handles drops
 * anywhere on the window.  The drop zone element also accepts HTML5 drag
 * events for when the panel is open.  Both paths call `runImageSearch`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Upload, ScanSearch, Loader2, FolderOpen,
  ArrowLeft, Sliders, Image as ImageIcon, TriangleAlert,
  RefreshCw, DatabaseZap, CheckCircle2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAssetStore } from "../store/assetStore";
import { useT } from "../lib/i18n";
import clsx from "clsx";

// ── Image extensions accepted by the browse dialog ─────────────────────────────
const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp",
  "tiff", "tif", "heic", "heif", "avif", "svg",
]);

// ── Score bar colour (green → amber → red going low) ─────────────────────────
function scoreColor(s: number): string {
  if (s >= 0.75) return "bg-emerald-500";
  if (s >= 0.55) return "bg-violet-500";
  if (s >= 0.35) return "bg-amber-500";
  return "bg-slate-500";
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface ImageSearchPanelProps {
  onClose: () => void;
}

export function ImageSearchPanel({ onClose }: ImageSearchPanelProps) {
  const {
    runImageSearch,
    clearImageSearch,
    imageSearchActive,
    imageSearchLoading,
    imageSearchError,
    imageSearchResults,
    imageSearchFile,
    imageSearchMinScore,
    imageSearchTopK,
    setImageSearchParams,
    setSelectedAsset,
    assets,
    indexStats,
    indexStatsLoading,
    embedAllLoading,
    embedAllResult,
    loadIndexStats,
    runEmbedAll,
  } = useAssetStore();

  const t = useT();

  // Load index stats once when the panel first mounts
  useEffect(() => {
    loadIndexStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto re-run the search when params change (debounced 600 ms) so slider
  // and top-K selector immediately refresh the server-side result pool.
  const rerunTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!imageSearchFile || imageSearchLoading) return;
    if (rerunTimerRef.current) clearTimeout(rerunTimerRef.current);
    rerunTimerRef.current = setTimeout(() => {
      runImageSearch(imageSearchFile);
    }, 600);
    return () => {
      if (rerunTimerRef.current) clearTimeout(rerunTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSearchMinScore, imageSearchTopK]);

  // Local drag-over state (for the drop zone element only)
  const [zoneDragOver, setZoneDragOver] = useState(false);
  const dragCountRef = useRef(0);

  // ── Zone drag handlers ────────────────────────────────────────────────────
  const onZoneDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current += 1;
    setZoneDragOver(true);
  }, []);

  const onZoneDragLeave = useCallback(() => {
    dragCountRef.current -= 1;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setZoneDragOver(false);
    }
  }, []);

  const onZoneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onZoneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setZoneDragOver(false);
    // Extract OS file path from dataTransfer (fallback for non-Tauri drop events)
    const items = Array.from(e.dataTransfer.files);
    if (items.length > 0) {
      // On Tauri desktop the actual path comes from the tauri://drag-drop event;
      // here we just trigger to ensure consistent behaviour when dragging within
      // the same Tauri window.
    }
    // The tauri://drag-drop global listener handles the actual path resolution.
  }, []);

  // ── Browse (file picker) ──────────────────────────────────────────────────
  const browse = useCallback(async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: [...IMAGE_EXTS] }],
    });
    if (picked && typeof picked === "string") {
      await runImageSearch(picked);
    }
  }, [runImageSearch]);

  // ── Re-run search (after param change) ───────────────────────────────────
  const rerun = useCallback(() => {
    if (imageSearchFile) runImageSearch(imageSearchFile);
  }, [imageSearchFile, runImageSearch]);

  // ── Select result item → highlight in main grid ───────────────────────────
  const handleResultClick = useCallback(
    (assetId: string) => {
      const asset = assets.find((a) => a.id === assetId)
        ?? imageSearchResults.find((r) => r.asset.id === assetId)?.asset;
      if (asset) setSelectedAsset(asset);
    },
    [assets, imageSearchResults, setSelectedAsset]
  );

  // ── Query image src (Tauri asset protocol) ────────────────────────────────
  const querySrc = imageSearchFile ? convertFileSrc(imageSearchFile) : null;
  const queryName = imageSearchFile?.split(/[/\\]/).pop() ?? "";

  return (
    <aside
      className={clsx(
        "flex flex-col w-80 shrink-0 border-l border-slate-700/50",
        "bg-slate-900/60 backdrop-blur-sm overflow-hidden",
      )}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <ScanSearch size={15} className="text-violet-400" />
          <div>
            <p>{t.imageSearch.title}</p>
            <p className="text-[10px] text-slate-500 font-normal">{t.imageSearch.subtitle}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
          title={t.general.close}
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Index status banner ──────────────────────────────────────── */}
      {(() => {
        if (embedAllLoading) {
          return (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-violet-900/30 border border-violet-700/40 flex items-center gap-2 shrink-0">
              <Loader2 size={13} className="text-violet-400 animate-spin shrink-0" />
              <span className="text-[11px] text-violet-300">{t.imageSearch.building}</span>
            </div>
          );
        }
        if (embedAllResult && embedAllResult.indexed > 0) {
          return (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/30 flex items-center gap-2 shrink-0">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <span className="text-[11px] text-emerald-300">
                {embedAllResult.indexed} {t.imageSearch.indexed}
              </span>
            </div>
          );
        }
        if (!indexStatsLoading && indexStats !== null && indexStats.total === 0) {
          return (
            <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-700/30 shrink-0">
              <div className="flex items-start gap-2">
                <TriangleAlert size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-amber-300 font-medium">{t.imageSearch.notIndexed}</p>
                  <p className="text-[10px] text-amber-400/70 mt-0.5">{t.imageSearch.notIndexedDesc}</p>
                </div>
              </div>
              <button
                onClick={runEmbedAll}
                title={t.imageSearch.buildIndexTip}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors"
              >
                <DatabaseZap size={11} />
                {t.imageSearch.buildIndex}
              </button>
            </div>
          );
        }
        if (!indexStatsLoading && indexStats !== null && indexStats.total > 0) {
          return (
            <div className="mx-3 mt-2 px-2 py-1 rounded-md flex items-center gap-1.5 shrink-0">
              <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
              <span className="text-[10px] text-slate-500">
                {indexStats.total.toLocaleString()} {t.imageSearch.indexed}
              </span>
              <button
                onClick={runEmbedAll}
                title={t.imageSearch.buildIndexTip}
                className="ml-auto text-slate-600 hover:text-violet-400 transition-colors"
              >
                <RefreshCw size={10} />
              </button>
            </div>
          );
        }
        return null;
      })()}

      {/* ── Drop zone / preview ──────────────────────────────────────── */}
      <div
        onDragEnter={onZoneDragEnter}
        onDragLeave={onZoneDragLeave}
        onDragOver={onZoneDragOver}
        onDrop={onZoneDrop}
        onClick={!imageSearchFile ? browse : undefined}
        className={clsx(
          "relative mx-3 mt-3 rounded-xl border-2 border-dashed transition-all duration-150",
          "flex items-center justify-center overflow-hidden shrink-0",
          imageSearchFile ? "h-44" : "h-36 cursor-pointer",
          zoneDragOver
            ? "border-violet-400 bg-violet-500/10 scale-[1.02]"
            : imageSearchFile
            ? "border-slate-600/60 bg-slate-900"
            : "border-slate-600/50 bg-slate-800/40 hover:border-slate-500 hover:bg-slate-800/60",
        )}
      >
        {/* Loading overlay */}
        {imageSearchLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm rounded-xl gap-2">
            <Loader2 size={24} className="text-violet-400 animate-spin" />
            <span className="text-xs text-violet-300 font-medium">Embedding with CLIP…</span>
          </div>
        )}

        {/* Query image preview */}
        {querySrc && !zoneDragOver ? (
          <>
            <img
              src={querySrc}
              alt={queryName}
              className="w-full h-full object-contain"
              draggable={false}
            />
            {/* Filename overlay */}
            <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-slate-950/90 to-transparent">
              <p className="text-xs text-slate-300 truncate font-medium">{queryName}</p>
            </div>
            {/* Replace button */}
            <button
              onClick={(e) => { e.stopPropagation(); browse(); }}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
              title="Replace image"
            >
              <RefreshCw size={12} />
            </button>
          </>
        ) : zoneDragOver ? (
          <div className="flex flex-col items-center gap-2 pointer-events-none">
            <ImageIcon size={28} className="text-violet-400" />
            <span className="text-xs font-medium text-violet-300">Drop to search</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-4">
            <div className="w-12 h-12 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Upload size={20} className="text-violet-400" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-slate-300">{t.imageSearch.dropHint}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{t.imageSearch.dropSubHint}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-1 space-y-2.5 shrink-0">
        {/* Similarity threshold */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400" title={t.imageSearch.minSimilarityTip}>
              <Sliders size={10} />
              {t.imageSearch.minSimilarity}
            </label>
            <span className="text-[11px] font-mono text-violet-300">
              {Math.round(imageSearchMinScore * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={Math.round(imageSearchMinScore * 100)}
            onChange={(e) =>
              setImageSearchParams({ minScore: Number(e.target.value) / 100 })
            }
            className="w-full h-1.5 accent-violet-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-600 mt-0.5 px-0.5">
            <span>10%</span>
            <span>90%</span>
          </div>
        </div>

        {/* Top-K */}
        <div className="flex items-center justify-between">
          <label className="text-[11px] text-slate-400" title={t.imageSearch.maxResultsTip}>{t.imageSearch.maxResults}</label>
          <select
            value={imageSearchTopK}
            onChange={(e) => setImageSearchParams({ topK: Number(e.target.value) })}
            className="text-[11px] bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-200 focus:outline-none focus:border-violet-500"
          >
            {[10, 20, 30, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Action row ───────────────────────────────────────────────── */}
      <div className="px-3 pb-2 flex gap-2 shrink-0">
        <button
          onClick={browse}
          disabled={imageSearchLoading}
          title={t.imageSearch.browseTip}
          className={clsx(
            "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            "bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40",
          )}
        >
          <FolderOpen size={12} />
          {t.imageSearch.browse}
        </button>
        {imageSearchFile && (
          <button
            onClick={rerun}
            disabled={imageSearchLoading}
            title={t.imageSearch.researchTip}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              "bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40",
            )}
          >
            {imageSearchLoading
              ? <Loader2 size={12} className="animate-spin" />
              : <ScanSearch size={12} />}
            {imageSearchLoading ? t.imageSearch.searching.split("…")[0] + "…" : t.imageSearch.research}
          </button>
        )}
      </div>

      {/* ── Divider ───────────────────────────────────────────────────  */}
      <div className="border-t border-slate-700/50 mx-3" />

      {/* ── Results ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 min-h-0">
        {/* Error state */}
        {imageSearchError && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <TriangleAlert size={28} className="text-red-400 opacity-60" />
            <p className="text-xs text-red-400 font-medium">Search failed</p>
            <p className="text-[11px] text-slate-500 max-w-[220px]">{imageSearchError}</p>
          </div>
        )}

        {/* Empty state after successful search */}
        {imageSearchActive && !imageSearchLoading && !imageSearchError && imageSearchResults.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ScanSearch size={28} className="text-slate-600" />
            <p className="text-xs text-slate-500 font-medium">No similar assets found</p>
            <p className="text-[11px] text-slate-600 max-w-[200px]">
              Try lowering the similarity threshold — some assets may not have been embedded yet.
            </p>
          </div>
        )}

        {/* Idle / no query */}
        {!imageSearchActive && !imageSearchLoading && !imageSearchFile && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ImageIcon size={28} className="text-slate-700" />
            <p className="text-[11px] text-slate-600">
              Drop or browse an image to find<br />visually similar assets in your library
            </p>
          </div>
        )}

        {/* Results list */}
        {imageSearchResults.length > 0 && (
          <>
            <p className="text-[10px] text-slate-500 px-0.5 pb-1 pt-0.5 font-medium uppercase tracking-wider">
              {imageSearchResults.length} result{imageSearchResults.length !== 1 ? "s" : ""} · sorted by similarity
            </p>
            {imageSearchResults.map((r, idx) => (
              <ResultRow
                key={r.asset.id}
                asset={r.asset}
                score={r.score}
                rank={idx + 1}
                onClick={() => handleResultClick(r.asset.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      {imageSearchActive && (
        <div className="shrink-0 border-t border-slate-700/50 px-3 py-2">
          <button
            onClick={() => { clearImageSearch(); }}
            className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-violet-400 transition-colors"
          >
            <ArrowLeft size={11} />
            Back to all assets
          </button>
        </div>
      )}
    </aside>
  );
}

// ── Compact result row ────────────────────────────────────────────────────────

interface ResultRowProps {
  asset: import("../types").Asset;
  score: number;
  rank: number;
  onClick: () => void;
}

function ResultRow({ asset, score, rank, onClick }: ResultRowProps) {
  const { thumbnailCache, loadThumbnail } = useAssetStore();

  // Kick off thumbnail load if not cached
  if (!thumbnailCache[asset.id]) {
    loadThumbnail(asset.id).catch(() => undefined);
  }

  const thumb = thumbnailCache[asset.id];
  const pct   = Math.round(score * 100);

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors group",
        "hover:bg-slate-800/70 active:bg-slate-800",
      )}
      title={asset.file_path}
    >
      {/* Rank number */}
      <span className="text-[10px] font-mono text-slate-600 w-4 shrink-0 text-right">{rank}</span>

      {/* Thumbnail */}
      <div className="w-9 h-9 rounded-md bg-slate-900 overflow-hidden shrink-0 border border-slate-700/50">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={14} className="text-slate-600" />
          </div>
        )}
      </div>

      {/* Name + folder + score bar */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-slate-200 font-medium truncate leading-tight">
          {asset.file_name}
        </p>
        <p className="text-[10px] text-slate-500 truncate leading-tight">
          {asset.folder.split(/[/\\]/).pop()}
        </p>
        {/* Score bar */}
        <div className="flex items-center gap-1.5 mt-1">
          <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
            <div
              className={clsx("h-full rounded-full transition-all", scoreColor(score))}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-400 shrink-0 w-7 text-right">
            {pct}%
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Full-window drag-over overlay (rendered from App.tsx) ─────────────────────

export function GlobalDropOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      {/* Drop indicator */}
      <div className="relative flex flex-col items-center gap-4 px-14 py-10 rounded-2xl border-2 border-dashed border-violet-400/70 bg-violet-950/40">
        <div className="w-16 h-16 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <ImageIcon size={32} className="text-violet-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-violet-200">Drop image to search</p>
          <p className="text-sm text-violet-400/70 mt-1">
            CLIP embeds the image and finds visually similar assets
          </p>
        </div>
      </div>
    </div>
  );
}
