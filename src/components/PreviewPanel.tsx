import { X, Heart, ExternalLink, FolderOpen, Trash2, FileImage, Clock, HardDrive, Hash, Tag, Wand2, Plus, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useAssetStore } from "../store/assetStore";
import { useActivityLock } from "../hooks/useActivityLock";
import { useT } from "../lib/i18n";
import { Tooltip } from "./Tooltip";
import { api } from "../lib/api";
import { formatFileSize, formatDate, formatRelativeDate, getExtensionColor, isImage } from "../lib/utils";
import { RecommendationPanel } from "./RecommendationPanel";
import type { TagEntry } from "../types";
import clsx from "clsx";

export function PreviewPanel() {
  const {
    selectedAsset: asset,
    setSelectedAsset,
    thumbnailCache,
    toggleFavorite,
    removeAsset,
  } = useAssetStore();

  const { canRemoveAsset, lockTooltip } = useActivityLock();
  const t = useT();

  const [tags,      setTags]      = useState<TagEntry[]>([]);
  const [tagging,   setTagging]   = useState(false);
  const [tagInput,  setTagInput]  = useState("");

  const loadTags = useCallback(async (id: string) => {
    try {
      const list = await api.getAssetTags(id);
      setTags(list);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    if (asset) {
      setTags([]);
      loadTags(asset.id);
    }
  }, [asset?.id, loadTags]);

  const handleAutoTag = async () => {
    if (!asset || tagging) return;
    setTagging(true);
    try {
      await api.autoTagAsset({
        asset_id:  asset.id,
        file_path: asset.file_path,
        save:      true,
      });
      await loadTags(asset.id);
    } catch { /* non-fatal */ } finally {
      setTagging(false);
    }
  };

  const handleAddTag = async () => {
    if (!asset) return;
    const t = tagInput.trim();
    if (!t) return;
    try {
      await api.addTag(asset.id, t);
      setTagInput("");
      await loadTags(asset.id);
    } catch { /* non-fatal */ }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!asset) return;
    try {
      await api.removeTag(asset.id, tag);
      await loadTags(asset.id);
    } catch { /* non-fatal */ }
  };

  if (!asset) return null;

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
            <span className="text-xs">{t.preview.generatingPreview}</span>
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
          { icon: <Clock size={12} />, label: t.preview.modified, value: `${formatDate(asset.modified_at)} (${formatRelativeDate(asset.modified_at)})` },
          { icon: <HardDrive size={12} />, label: t.preview.size, value: formatFileSize(asset.file_size) },
          { icon: <FolderOpen size={12} />, label: t.preview.location, value: asset.folder, truncate: true },
          ...(asset.hash ? [{ icon: <Hash size={12} />, label: t.preview.hash, value: asset.hash.slice(0, 16) + "…" }] : []),
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

        {/* Tags section */}
        <div className="pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 text-slate-500">
              <Tag size={11} />
              {t.preview.tags}
            </span>
            <Tooltip text={t.preview.autoTagTip} position="left">
              <button
                onClick={handleAutoTag}
                disabled={tagging}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 border border-violet-500/30 transition-colors disabled:opacity-50"
              >
                {tagging
                  ? <Loader2 size={10} className="animate-spin" />
                  : <Wand2 size={10} />}
                {tagging ? t.preview.tagging : t.preview.autoTag}
              </button>
            </Tooltip>
          </div>

          {/* Existing tag chips */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className={clsx(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium select-none",
                    t.source === "ai"
                      ? "bg-violet-500/15 text-violet-300 border border-violet-500/20"
                      : "bg-slate-600/50 text-slate-300 border border-slate-500/30"
                  )}
                >
                  {t.tag}
                  <button
                    onClick={() => handleRemoveTag(t.tag)}
                    className="text-slate-400 hover:text-red-400 transition-colors ml-0.5"
                    aria-label={`Remove tag ${t.tag}`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Manual tag input */}
          <div className="flex gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); }}
              placeholder={t.preview.addTagPlaceholder}
              maxLength={100}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-800 border border-slate-600 text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none focus:border-violet-500"
            />
            <button
              onClick={handleAddTag}
              disabled={!tagInput.trim()}
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-40 transition-colors"
              aria-label="Add tag"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>

        {/* Similar assets */}
        <RecommendationPanel assetId={asset.id} />
      </div>

      {/* Actions */}
      <div className="shrink-0 px-4 py-3 border-t border-slate-700/50 space-y-2">
        <Tooltip text={t.preview.openFileTip} position="top">
          <button
            onClick={() => api.openFile(asset.file_path)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors"
          >
            <ExternalLink size={13} />
            {t.preview.openFile}
          </button>
        </Tooltip>
        <div className="flex gap-2">
          <Tooltip text={t.preview.revealTip} position="top">
            <button
              onClick={() => api.revealInExplorer(asset.file_path)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition-colors"
            >
              <FolderOpen size={12} />
              {t.preview.reveal}
            </button>
          </Tooltip>
          <Tooltip text={t.preview.favoriteTip} position="top">
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
              {asset.favorite ? t.preview.unfavorite : t.preview.favorite}
            </button>
          </Tooltip>
          <Tooltip text={canRemoveAsset ? t.preview.removeAssetTip : lockTooltip("scan")} position="top">
            <button
              onClick={() => canRemoveAsset && removeAsset(asset.id)}
              disabled={!canRemoveAsset}
              className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
