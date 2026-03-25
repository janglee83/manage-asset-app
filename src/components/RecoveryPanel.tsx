/**
 * RecoveryPanel
 *
 * Right-hand side panel listing every asset whose `file_path` no longer
 * exists on disk, along with automatically-discovered replacement candidates.
 *
 * Layout (per broken asset)
 * ─────────────────────────
 *  ● File name  ── Missing badge
 *    Old path (dimmed)
 *    ▸ Candidate list:
 *        [strategy badge]  [confidence bar]  path  [Apply]
 *    [Skip / ignore this asset]
 *
 * Strategies
 * ──────────
 *  hash           — SHA-256 match  → confidence 1.0 (green)
 *  same_folder    — file in same folder → 0.90 / 0.75 (violet)
 *  name_similarity — Jaro-Winkler ≥ 0.80 → ≤ 0.85 (amber)
 */

import { useCallback, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  File, FolderSearch, Hash, RefreshCw, SkipForward, Sparkles,
  X,
} from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import type { BrokenAsset, RecoveryCandidate, RecoveryStrategy } from "../types";
import clsx from "clsx";

// ── Strategy meta ─────────────────────────────────────────────────────────────

const STRATEGY_META: Record<
  RecoveryStrategy,
  { label: string; Icon: typeof Hash; color: string; bg: string }
> = {
  hash: {
    label: "Hash",
    Icon:  Hash,
    color: "text-emerald-400",
    bg:    "bg-emerald-500/10 border-emerald-500/30",
  },
  same_folder: {
    label: "Folder",
    Icon:  FolderSearch,
    color: "text-violet-400",
    bg:    "bg-violet-500/10 border-violet-500/30",
  },
  name_similarity: {
    label: "Similar",
    Icon:  Sparkles,
    color: "text-amber-400",
    bg:    "bg-amber-500/10 border-amber-500/30",
  },
};

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct   = Math.round(confidence * 100);
  const color =
    confidence >= 0.95 ? "bg-emerald-500"
    : confidence >= 0.75 ? "bg-violet-500"
    : "bg-amber-500";

  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-slate-400 w-7 text-right shrink-0">
        {pct}%
      </span>
    </div>
  );
}

// ── Single candidate row ──────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  onApply,
  applying,
}: {
  candidate: RecoveryCandidate;
  onApply: (path: string) => void;
  applying: boolean;
}) {
  const meta = STRATEGY_META[candidate.strategy];
  const fileName = candidate.new_path.split(/[/\\]/).pop() ?? candidate.new_path;
  const folder   = candidate.new_path.split(/[/\\]/).slice(0, -1).join("/");

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 group">
      {/* Strategy badge */}
      <span
        className={clsx(
          "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0",
          meta.bg, meta.color,
        )}
      >
        <meta.Icon size={9} />
        {meta.label}
      </span>

      {/* Confidence */}
      <ConfidenceBar confidence={candidate.confidence} />

      {/* Path */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-slate-200 font-medium truncate leading-tight">
          {fileName}
        </p>
        <p className="text-[10px] text-slate-500 truncate leading-tight" title={folder}>
          {folder.split(/[/\\]/).pop()}
        </p>
      </div>

      {/* Apply button */}
      <button
        onClick={() => onApply(candidate.new_path)}
        disabled={applying}
        className="shrink-0 px-2 py-1 text-[11px] font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors flex items-center gap-1"
        title={`Recover to: ${candidate.new_path}`}
      >
        {applying ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
        Apply
      </button>
    </div>
  );
}

// ── Single broken-asset card ──────────────────────────────────────────────────

function BrokenAssetCard({ broken }: { broken: BrokenAsset }) {
  const { applyRecovery, skipBrokenAsset } = useAssetStore();
  const [expanded, setExpanded]   = useState(true);
  const [applying, setApplying]   = useState<string | null>(null);

  const handleApply = useCallback(async (newPath: string) => {
    setApplying(newPath);
    try {
      await applyRecovery(broken.asset.id, newPath);
    } catch (e) {
      console.error("apply_recovery failed:", e);
    } finally {
      setApplying(null);
    }
  }, [broken.asset.id, applyRecovery]);

  const hasMatch = broken.candidates.length > 0;

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-800/40 transition-colors text-left"
      >
        {/* File icon */}
        <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/50 flex items-center justify-center shrink-0">
          <File size={14} className="text-slate-500" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className="text-xs text-slate-200 font-medium truncate">
              {broken.asset.file_name}
            </p>
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20 shrink-0">
              <AlertTriangle size={8} />
              Missing
            </span>
          </div>
          <p className="text-[10px] text-slate-600 truncate" title={broken.asset.file_path}>
            {broken.asset.file_path}
          </p>
        </div>

        {/* Candidate badge */}
        <div className="shrink-0 flex items-center gap-1.5">
          {hasMatch ? (
            <span className="text-[10px] font-medium text-emerald-400">
              {broken.candidates.length} match{broken.candidates.length !== 1 ? "es" : ""}
            </span>
          ) : (
            <span className="text-[10px] text-slate-600">no matches</span>
          )}
          {expanded ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
        </div>
      </button>

      {/* Expanded candidate list */}
      {expanded && (
        <div className="border-t border-slate-700/40 px-1 py-1 space-y-0.5">
          {broken.candidates.length === 0 ? (
            <p className="text-[11px] text-slate-600 text-center py-3 px-4">
              No automatic matches found. The file may have been deleted or moved outside watched folders.
            </p>
          ) : (
            broken.candidates.map((cand, idx) => (
              <CandidateRow
                key={`${cand.new_path}-${idx}`}
                candidate={cand}
                onApply={handleApply}
                applying={applying === cand.new_path}
              />
            ))
          )}

          {/* Skip row */}
          <div className="pt-1 pb-0.5 flex justify-end px-1">
            <button
              onClick={() => skipBrokenAsset(broken.asset.id)}
              className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              <SkipForward size={10} />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface RecoveryPanelProps {
  onClose: () => void;
}

export function RecoveryPanel({ onClose }: RecoveryPanelProps) {
  const {
    brokenAssets,
    brokenLoading,
    detectBrokenAssets,
  } = useAssetStore();

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l border-slate-700/50 bg-slate-900/60 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <AlertTriangle size={14} className="text-amber-400" />
          Path Recovery
          {brokenAssets.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
              {brokenAssets.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scan button */}
      <div className="px-3 py-2.5 border-b border-slate-700/40 shrink-0">
        <button
          onClick={detectBrokenAssets}
          disabled={brokenLoading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
        >
          {brokenLoading ? (
            <><RefreshCw size={12} className="animate-spin" /> Scanning…</>
          ) : (
            <><FolderSearch size={12} /> Detect Broken Paths</>
          )}
        </button>
        <p className="text-[10px] text-slate-600 text-center mt-1.5">
          Compares stored paths against the filesystem and tries to recover each missing file.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-0">
        {/* Idle — nothing scanned yet */}
        {!brokenLoading && brokenAssets.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 size={32} className="text-slate-700" />
            <div>
              <p className="text-xs font-medium text-slate-500">No broken paths detected</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Click "Detect Broken Paths" to scan your library.
              </p>
            </div>
          </div>
        )}

        {/* Broken asset cards */}
        {brokenAssets.map((broken) => (
          <BrokenAssetCard key={broken.asset.id} broken={broken} />
        ))}
      </div>
    </aside>
  );
}
