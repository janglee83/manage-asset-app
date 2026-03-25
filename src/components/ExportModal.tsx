import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, FileText, Braces, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import type { ExportFormat } from "../types";

interface Props {
  /** IDs of assets to export. */
  assetIds: string[];
  onClose: () => void;
}

type Status = "idle" | "exporting" | "done" | "error";

export function ExportModal({ assetIds, onClose }: Props) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount]   = useState(0);
  const [error, setError]   = useState("");
  const t = useT();

  const handleExport = async () => {
    // Ask the user where to save the file.
    const outputPath = await save({
      defaultPath: `assets-export.${format}`,
      filters: [
        format === "csv"
          ? { name: "CSV", extensions: ["csv"] }
          : { name: "JSON", extensions: ["json"] },
      ],
    });

    if (!outputPath) return; // user cancelled

    setStatus("exporting");
    setError("");

    try {
      const written = await api.exportAssets(assetIds, format, outputPath);
      setCount(written);
      setStatus("done");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  };

  const formatOptions: { value: ExportFormat; label: string; Icon: React.ElementType; ext: string; tip: string }[] = [
    { value: "csv",  label: t.export.csv,  Icon: FileText, ext: ".csv",  tip: t.export.csvTip  },
    { value: "json", label: t.export.json, Icon: Braces,   ext: ".json", tip: t.export.jsonTip },
  ];

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div className="relative w-full max-w-sm rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-100 font-semibold text-sm">
            <Download size={15} className="text-violet-400" />
            {t.export.title}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Asset count */}
        <p className="text-xs text-slate-400">
          <span className="text-slate-200 font-medium">{assetIds.length}</span>{" "}
          {assetIds.length === 1 ? t.export.assetCount : t.export.assetsCount} {t.export.willBeExported}
        </p>

        {/* Format selector */}
        <div className="flex flex-col gap-2">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Format</span>
          <div className="flex gap-2">
            {formatOptions.map(({ value, label, Icon, ext, tip }) => (
              <button
                key={value}
                onClick={() => setFormat(value)}
                title={tip}
                className={
                  "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border text-xs font-medium transition-colors " +
                  (format === value
                    ? "border-violet-500 bg-violet-500/15 text-violet-300"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500 hover:text-slate-200")
                }
              >
                <Icon size={16} />
                {label}
                <span className="text-[10px] opacity-60">{ext}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Status feedback */}
        {status === "done" && (
          <div className="flex items-center gap-2 text-emerald-400 text-xs bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} />
            Exported {count} {count === 1 ? "asset" : "assets"} successfully.
          </div>
        )}
        {status === "error" && (
          <div className="flex items-start gap-2 text-red-400 text-xs bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            {status === "done" ? t.general.close : t.export.cancel}
          </button>
          {status !== "done" && (
            <button
              onClick={handleExport}
              disabled={assetIds.length === 0 || status === "exporting"}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-medium
                         hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === "exporting" ? (
                <>
                  <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download size={12} />
                  Choose location &amp; Export
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
