/**
 * Toast notification stack.
 *
 * Rendered once at the top level of the app (in App.tsx).  Toasts appear in
 * the top-right corner, stack vertically, and slide out automatically.
 *
 * The sidecar-dead toast (id = "sidecar-dead") renders an extra "Restart"
 * button that calls the restart_sidecar Tauri command.
 *
 * Usage:
 *   import { useErrorStore, reportError } from "../store/errorStore";
 *   useErrorStore.getState().push("error", "Title", "Detail…");
 *   reportError(caughtError, "Context label");
 */
import { useState } from "react";
import { X, AlertTriangle, AlertCircle, Info, RotateCcw } from "lucide-react";
import { useErrorStore, type Toast, type ToastSeverity } from "../store/errorStore";
import { api } from "../lib/api";

const SEV: Record<ToastSeverity, { Icon: React.ElementType; bar: string; bg: string; text: string }> = {
  info:    { Icon: Info,          bar: "bg-blue-500",   bg: "bg-slate-800 border-slate-600",  text: "text-blue-300"   },
  warning: { Icon: AlertTriangle, bar: "bg-amber-500",  bg: "bg-slate-800 border-amber-700/50", text: "text-amber-300" },
  error:   { Icon: AlertCircle,   bar: "bg-red-500",    bg: "bg-slate-800 border-red-700/50",   text: "text-red-300"   },
};

const SIDECAR_TOAST_ID = "sidecar-dead";

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useErrorStore((s) => s.dismiss);
  const { Icon, bar, bg, text } = SEV[toast.severity];
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await api.restartSidecar();
      dismiss(toast.id);
      useErrorStore.getState().push("info", "Restarting AI model…", "Semantic search will be available shortly.", 4000);
    } catch (e) {
      useErrorStore.getState().push("error", "Restart failed", String(e), 8000);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div
      className={`relative flex flex-col gap-1.5 w-80 rounded-lg border shadow-xl overflow-hidden p-3 pr-7 ${bg} animate-fade-in`}
      role="alert"
    >
      {/* Severity stripe */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />

      <div className={`flex items-center gap-2 text-xs font-semibold ${text}`}>
        <Icon size={13} />
        {toast.title}
      </div>

      {toast.detail && (
        <p className="text-xs text-slate-400 break-words line-clamp-3 pl-5">
          {toast.detail}
        </p>
      )}

      {/* Restart button only on the sidecar-dead toast */}
      {toast.id === SIDECAR_TOAST_ID && (
        <button
          onClick={handleRestart}
          disabled={restarting}
          className="mt-1 ml-5 self-start flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium
                     bg-amber-700/40 hover:bg-amber-700/70 text-amber-200 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw size={11} className={restarting ? "animate-spin" : ""} />
          {restarting ? "Restarting…" : "Restart"}
        </button>
      )}

      <button
        onClick={() => dismiss(toast.id)}
        className="absolute top-2 right-2 text-slate-500 hover:text-slate-300 transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastStack() {
  const toasts = useErrorStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
