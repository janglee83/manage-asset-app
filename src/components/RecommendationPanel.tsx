import { useEffect } from "react";
import { Sparkles, Loader2, FileImage } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { isImage } from "../lib/utils";
import clsx from "clsx";

interface Props {
  /** Asset ID to load recommendations for. */
  assetId: string;
}

export function RecommendationPanel({ assetId }: Props) {
  const {
    recommendations,
    recommendationsLoading,
    getRecommendations,
    thumbnailCache,
    setSelectedAsset,
    assets,
  } = useAssetStore();

  useEffect(() => {
    getRecommendations(assetId);
  }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const hits = recommendations?.similar_assets ?? [];

  if (recommendationsLoading) {
    return (
      <div className="pt-3 border-t border-slate-700/50">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-2">
          <Sparkles size={11} />
          <span>Similar assets</span>
        </div>
        <div className="flex justify-center py-3">
          <Loader2 size={14} className="animate-spin text-slate-500" />
        </div>
      </div>
    );
  }

  if (hits.length === 0) return null;

  return (
    <div className="pt-3 border-t border-slate-700/50">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-2">
        <Sparkles size={11} />
        <span>Similar assets</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {hits.slice(0, 6).map((hit) => {
          const relatedAsset = assets.find((a) => a.id === hit.asset_id);
          const thumb = thumbnailCache[hit.asset_id];
          const pct   = Math.round(hit.score * 100);

          return (
            <button
              key={hit.asset_id}
              onClick={() => relatedAsset && setSelectedAsset(relatedAsset)}
              className={clsx(
                "relative group rounded-lg overflow-hidden bg-slate-800 border border-slate-700/50",
                "hover:border-violet-500/50 transition-colors focus:outline-none",
                "aspect-square flex items-center justify-center",
              )}
              title={relatedAsset?.file_name ?? hit.asset_id}
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={relatedAsset?.file_name ?? ""}
                  className="w-full h-full object-cover"
                />
              ) : relatedAsset && isImage(relatedAsset.extension) ? (
                <FileImage size={20} className="text-slate-600" />
              ) : (
                <span className="text-[10px] text-slate-500 uppercase font-bold">
                  {relatedAsset?.extension ?? "?"}
                </span>
              )}

              {/* Score badge */}
              <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-[9px] text-slate-300 px-1 py-0.5 rounded leading-none opacity-0 group-hover:opacity-100 transition-opacity">
                {pct}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
