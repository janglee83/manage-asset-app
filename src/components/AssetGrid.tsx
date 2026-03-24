import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Heart, FileImage, File } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { getExtensionColor, isImage } from "../lib/utils";
import type { Asset } from "../types";
import clsx from "clsx";

// ─── Layout constants ─────────────────────────────────────────────────────────
const CARD_MIN_W  = 160;
const CARD_GAP    = 12;
const CARD_H_GRID = 210;  // thumb 144px + name area ~66px
const CARD_H_LIST = 56;
const OVERSCAN    = 4;

// ─── Column count hook (ResizeObserver) ───────────────────────────────────────
function useGridCols(
  containerRef: React.RefObject<HTMLDivElement | null>,
  isGrid: boolean
) {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    if (!isGrid) { setCols(1); return; }
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setCols(Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN_W + CARD_GAP))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, isGrid]);
  return cols;
}

// ─── Asset card (grid mode) ───────────────────────────────────────────────────
interface CardProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: (asset: Asset) => void;
}

function GridCard({ asset, isSelected, onSelect }: CardProps) {
  const { loadThumbnail, thumbnailCache, toggleFavorite } = useAssetStore();

  useEffect(() => {
    if (isImage(asset.extension)) loadThumbnail(asset.id);
  }, [asset.id, asset.extension]);

  const thumb    = thumbnailCache[asset.id];
  const extColor = getExtensionColor(asset.extension);

  return (
    <div
      onClick={() => onSelect(asset)}
      role="button"
      tabIndex={-1}
      className={clsx(
        "group relative flex flex-col rounded-xl overflow-hidden cursor-pointer border transition-all duration-100 select-none",
        isSelected
          ? "border-violet-500 ring-2 ring-violet-500/25 bg-slate-800"
          : "border-slate-700/50 bg-slate-800/60 hover:border-slate-600 hover:bg-slate-800"
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-slate-900/80 flex items-center justify-center overflow-hidden shrink-0">
        {thumb ? (
          <img
            src={thumb}
            alt={asset.file_name}
            draggable={false}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="opacity-40">
            {isImage(asset.extension)
              ? <FileImage size={28} className="text-slate-400" />
              : <File size={28} className="text-slate-400" />}
          </div>
        )}

        {/* Extension badge */}
        <span
          className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-xs font-mono font-semibold uppercase"
          style={{ backgroundColor: extColor + "33", color: extColor, border: `1px solid ${extColor}44` }}
        >
          {asset.extension}
        </span>

        {/* Favorite button */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(asset.id); }}
          className={clsx(
            "absolute top-1.5 right-1.5 p-1 rounded transition-all",
            asset.favorite
              ? "text-yellow-400 opacity-100"
              : "text-slate-500 opacity-0 group-hover:opacity-100 hover:text-yellow-400"
          )}
          aria-label={asset.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Heart size={13} className={asset.favorite ? "fill-yellow-400" : ""} />
        </button>
      </div>

      {/* Name */}
      <div className="px-2 py-2 min-w-0">
        <p className="text-xs text-slate-200 truncate font-medium" title={asset.file_name}>
          {asset.file_name}
        </p>
        <p className="text-xs text-slate-500 truncate mt-0.5" title={asset.folder}>
          {asset.folder.split(/[/\\]/).pop()}
        </p>
      </div>
    </div>
  );
}

// ─── Asset row (list mode) ────────────────────────────────────────────────────
function ListRow({ asset, isSelected, onSelect }: CardProps) {
  const { loadThumbnail, thumbnailCache, toggleFavorite } = useAssetStore();

  useEffect(() => {
    if (isImage(asset.extension)) loadThumbnail(asset.id);
  }, [asset.id, asset.extension]);

  const thumb    = thumbnailCache[asset.id];
  const extColor = getExtensionColor(asset.extension);

  return (
    <div
      onClick={() => onSelect(asset)}
      role="button"
      tabIndex={-1}
      className={clsx(
        "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-all duration-100 select-none",
        isSelected
          ? "border-violet-500/60 bg-slate-800 ring-1 ring-violet-500/20"
          : "border-transparent hover:bg-slate-800/70"
      )}
    >
      {/* Mini thumbnail */}
      <div className="w-9 h-9 rounded-md bg-slate-900/80 flex items-center justify-center overflow-hidden shrink-0">
        {thumb ? (
          <img src={thumb} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-mono font-bold" style={{ color: extColor }}>
            .{asset.extension}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate font-medium" title={asset.file_name}>
          {asset.file_name}
        </p>
        <p className="text-xs text-slate-500 truncate" title={asset.folder}>
          {asset.folder}
        </p>
      </div>

      {/* Favorite + extension */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="hidden sm:inline px-1.5 py-0.5 rounded text-xs font-mono"
          style={{ backgroundColor: extColor + "22", color: extColor }}
        >
          {asset.extension}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFavorite(asset.id); }}
          className={clsx(
            "p-1 rounded transition-colors",
            asset.favorite ? "text-yellow-400" : "text-slate-600 hover:text-yellow-400"
          )}
        >
          <Heart size={12} className={asset.favorite ? "fill-yellow-400" : ""} />
        </button>
      </div>
    </div>
  );
}

// ─── Main grid component ──────────────────────────────────────────────────────
export function AssetGrid() {
  const {
    assets,
    total,
    isLoading,
    selectedAsset,
    selectedIndex,
    setSelectedIndex,
    loadMore,
    searchQuery,
    viewMode,
  } = useAssetStore();

  const isGrid        = viewMode === "grid";
  const scrollRef     = useRef<HTMLDivElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const cols          = useGridCols(containerRef, isGrid);
  const cardH         = isGrid ? CARD_H_GRID : CARD_H_LIST;

  // Number of virtual rows
  const dataRows = isGrid ? Math.ceil(assets.length / cols) : assets.length;
  // +1 sentinel row for load-more / loading indicator
  const totalRows = assets.length < total ? dataRows + 1 : dataRows;

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (i >= dataRows ? 48 : cardH + CARD_GAP),
    overscan: OVERSCAN,
    gap: isGrid ? 0 : 2,
  });

  // Trigger loadMore when sentinel row becomes visible
  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems();
    if (!items.length) return;
    const last = items[items.length - 1];
    if (last.index >= dataRows && !isLoading && assets.length < total) {
      loadMore();
    }
  }, [rowVirtualizer.getVirtualItems()]);

  // Scroll selected item into view when it changes via keyboard
  useEffect(() => {
    if (selectedIndex < 0) return;
    const rowIdx = isGrid ? Math.floor(selectedIndex / cols) : selectedIndex;
    rowVirtualizer.scrollToIndex(rowIdx, { align: "auto", behavior: "smooth" });
  }, [selectedIndex, cols, isGrid]);

  // Keyboard up/down inside grid (left/right handled globally in useKeyboardShortcuts)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const count = assets.length;
      if (!count) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = selectedIndex < 0
          ? 0
          : Math.min(selectedIndex + (isGrid ? cols : 1), count - 1);
        setSelectedIndex(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(0, selectedIndex - (isGrid ? cols : 1));
        setSelectedIndex(prev);
      }
    },
    [assets.length, selectedIndex, cols, isGrid, setSelectedIndex]
  );

  const handleSelect = useCallback((asset: Asset) => {
    const idx = assets.findIndex((a) => a.id === asset.id);
    setSelectedIndex(idx);
  }, [assets, setSelectedIndex]);

  if (assets.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
        <FileImage size={48} className="opacity-25" />
        <p className="text-sm font-medium">No assets found</p>
        <p className="text-xs text-slate-600 text-center max-w-xs">
          {searchQuery.text
            ? `No results for "${searchQuery.text}" — try a different term.`
            : "Add a folder from the sidebar to start indexing."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Result count */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <p className="text-xs text-slate-500">
          {total.toLocaleString()} {total === 1 ? "asset" : "assets"}
          {assets.length < total && ` · showing ${assets.length.toLocaleString()}`}
        </p>
        {isLoading && (
          <span className="text-xs text-slate-600 animate-pulse">Loading…</span>
        )}
      </div>

      {/* Virtualised scroll container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Asset grid"
        role="grid"
      >
        {/* Measure container for column calculation */}
        <div ref={containerRef} className="w-full">
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              // Sentinel row for infinite scroll
              if (vRow.index >= dataRows) {
                return (
                  <div
                    key="sentinel"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vRow.start}px)`,
                      height: vRow.size,
                    }}
                    className="flex items-center justify-center"
                  >
                    {isLoading && (
                      <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                );
              }

              if (isGrid) {
                // Each virtual row contains 'cols' cards
                const startIdx = vRow.index * cols;
                const row = assets.slice(startIdx, startIdx + cols);

                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: CARD_H_GRID,
                      transform: `translateY(${vRow.start}px)`,
                      display: "grid",
                      gridTemplateColumns: `repeat(${cols}, 1fr)`,
                      gap: CARD_GAP,
                      paddingBottom: 0,
                    }}
                  >
                    {row.map((asset) => (
                      <GridCard
                        key={asset.id}
                        asset={asset}
                        isSelected={selectedAsset?.id === asset.id}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                );
              }

              // List mode: one asset per virtual row
              const asset = assets[vRow.index];
              if (!asset) return null;
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: CARD_H_LIST,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <ListRow
                    asset={asset}
                    isSelected={selectedAsset?.id === asset.id}
                    onSelect={handleSelect}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
