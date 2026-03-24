import { X, Heart, ExternalLink, FolderOpen, Trash2, FileImage, Clock, HardDrive, Hash } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { api } from "../lib/api";
import { formatFileSize, formatDate, formatRelativeDate, getExtensionColor, isImage } from "../lib/utils";
import clsx from "clsx";

export function PreviewPanel() {
  const {
    selectedAsset: asset,
    setSelectedAsset,
    thumbnailCache,
    toggleFavorite,
    removeAsset,
  } = useAssetStore();

  if (!asset) {
    return (
      <aside className="w-72 shrink-0 flex flex-col items-center justify-center text-slate-600 border-l border-slate-700/50 gap-3">
        <FileImage size={36} className="opacity-30" />
        <p className="text-sm text-center px-4">Select an asset to preview</p>
      </aside>
    );
  }

  const thumb = thumbnailCache[asset.id];
  const extColor = getExtensionColor(asset.extension);

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <h3 className="text-sm font-semibold text-slate-200 truncate" title={asset.file_name}>
          {asset.file_name}
        </h3>
        <button
          onClick={() => setSelectedAsset(null)}
          className="text-slate-500 hover:text-slate-300 transition-colors ml-2 shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Preview image */}
      <div className="shrink-0 h-48 bg-slate-900 flex items-center justify-center overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={asset.file_name}
            className="max-w-full max-h-full object-contain"
          />
        ) : isImage(asset.extension) ? (
          <div className="flex flex-col items-center gap-2 opacity-30">
            <FileImage size={40} />
            <span className="text-xs">Generating preview…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-16 h-20 rounded-lg flex items-center justify-center text-lg font-bold uppercase"
              style={{ backgroundColor: extColor + "22", color: extColor, border: `2px solid ${extColor}44` }}
            >
              .{asset.extension}
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        {/* Metadata rows */}
        {[
          { icon: <Clock size={12} />, label: "Modified", value: `${formatDate(asset.modified_at)} (${formatRelativeDate(asset.modified_at)})` },
          { icon: <HardDrive size={12} />, label: "Size", value: formatFileSize(asset.file_size) },
          { icon: <FolderOpen size={12} />, label: "Location", value: asset.folder, truncate: true },
          ...(asset.hash ? [{ icon: <Hash size={12} />, label: "Hash", value: asset.hash.slice(0, 16) + "…" }] : []),
        ].map((row) => (
          <div key={row.label} className="flex gap-2">
            <span className="text-slate-500 shrink-0 mt-0.5">{row.icon}</span>
            <div className="flex flex-col min-w-0">
              <span className="text-slate-500">{row.label}</span>
              <span className={clsx("text-slate-300", row.truncate && "truncate")} title={row.value}>
                {row.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="shrink-0 px-4 py-3 border-t border-slate-700/50 space-y-2">
        <button
          onClick={() => api.openFile(asset.file_path)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
        >
          <ExternalLink size={13} />
          Open File
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => api.revealInExplorer(asset.file_path)}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition-colors"
            title="Show in Explorer"
          >
            <FolderOpen size={12} />
            Reveal
          </button>
          <button
            onClick={() => toggleFavorite(asset.id)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors",
              asset.favorite
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "bg-slate-700 hover:bg-slate-600 text-slate-200"
            )}
          >
            <Heart size={12} className={asset.favorite ? "fill-yellow-400" : ""} />
            {asset.favorite ? "Unfav" : "Favorite"}
          </button>
          <button
            onClick={() => removeAsset(asset.id)}
            className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 text-xs transition-colors"
            title="Remove from index"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </aside>
  );
}
