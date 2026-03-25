/**
 * ImageSearchDropzone
 *
 * A compact drop-zone button that lives in the app header.
 *
 * States:
 *   idle          — camera icon + label "Find similar"
 *   drag-over     — glowing violet ring prompts "Drop image"
 *   loading       — spinner while CLIP encodes + FAISS searches
 *   results-ready — shows hit count and a clear (✕) button
 *   error         — red badge with short error text
 *
 * The component also renders a full-screen dim overlay while an image is
 * being dragged over it, making the drop target hard to miss.
 */

import { useCallback } from "react";
import { Camera, X, Loader2, ScanSearch, Image } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { useImageSearch } from "../hooks/useImageSearch";
import clsx from "clsx";

export function ImageSearchDropzone() {
  const {
    runImageSearch,
    clearImageSearch,
    imageSearchActive,
    imageSearchLoading,
    imageSearchError,
    imageSearchResults,
    imageSearchFile,
  } = useAssetStore();

  const handleDrop = useCallback(
    (filePath: string) => {
      runImageSearch(filePath);
    },
    [runImageSearch]
  );

  const { isDragOver, dropProps } = useImageSearch(handleDrop);

  const resultCount = imageSearchResults.length;
  const queryName   = imageSearchFile?.split(/[/\\]/).pop();

  return (
    <>
      {/* ── Drop zone button ─────────────────────────────────────────────── */}
      <div
        {...dropProps}
        className={clsx(
          "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm",
          "border transition-all duration-150 select-none cursor-default shrink-0",
          isDragOver && [
            "border-violet-400 bg-violet-500/15 ring-2 ring-violet-500/30",
            "scale-105",
          ],
          !isDragOver && imageSearchActive && !imageSearchLoading && [
            "border-violet-600/50 bg-violet-900/20 text-violet-300",
          ],
          !isDragOver && !imageSearchActive && !imageSearchLoading && [
            "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-600 hover:text-slate-300",
          ],
          imageSearchLoading && "border-violet-700/50 bg-violet-900/20 text-violet-400",
          imageSearchError && "border-red-700/50 bg-red-900/10 text-red-400",
        )}
        title={
          isDragOver
            ? "Drop to find similar assets"
            : imageSearchActive
            ? `Showing results similar to ${queryName}`
            : "Drop an image to find visually similar assets"
        }
      >
        {/* Icon */}
        {imageSearchLoading ? (
          <Loader2 size={14} className="animate-spin shrink-0" />
        ) : imageSearchError ? (
          <ScanSearch size={14} className="shrink-0 text-red-400" />
        ) : (
          <Camera size={14} className="shrink-0" />
        )}

        {/* Label */}
        <span className="text-xs whitespace-nowrap">
          {isDragOver
            ? "Drop image…"
            : imageSearchLoading
            ? "Searching…"
            : imageSearchError
            ? "Error"
            : imageSearchActive
            ? `${resultCount} similar`
            : "Find similar"}
        </span>

        {/* Clear results button */}
        {imageSearchActive && !imageSearchLoading && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearImageSearch();
            }}
            className="ml-0.5 text-slate-400 hover:text-slate-100 transition-colors rounded"
            aria-label="Exit similarity mode"
            title="Exit similarity mode"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* ── Full-window drag-over overlay ─────────────────────────────────── */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
          {/* Dim */}
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
          {/* Drop target */}
          <div className="relative flex flex-col items-center gap-4 px-12 py-10 rounded-2xl border-2 border-dashed border-violet-400/70 bg-violet-900/20">
          <Image size={48} className="text-violet-400 opacity-80" />
            <div className="text-center">
              <p className="text-lg font-semibold text-violet-300">Drop to find similar assets</p>
              <p className="text-sm text-violet-400/70 mt-1">
                CLIP embeds the image and searches your library
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
