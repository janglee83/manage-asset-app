/**
 * Global error/notification store.
 *
 * Any part of the app can call `useErrorStore.getState().push(…)` to queue a
 * toast notification without prop-drilling.
 *
 * Severity levels:
 *   "info"    — neutral feedback (e.g. "Export complete")
 *   "warning" — degraded but non-fatal (e.g. semantic search unavailable)
 *   "error"   — something failed that the user should be aware of
 *
 * Toasts auto-dismiss after `duration` ms (default 5 s for errors,
 * 3 s for info/warning).  Clicking the dismiss button removes them instantly.
 */
import { create } from "zustand";

export type ToastSeverity = "info" | "warning" | "error";

export interface Toast {
  id: string;
  severity: ToastSeverity;
  title: string;
  /** Optional detail shown in collapsed body. */
  detail?: string;
  /** Auto-dismiss after this many ms. 0 = never auto-dismiss. */
  duration: number;
}

interface ErrorStore {
  toasts: Toast[];
  push: (severity: ToastSeverity, title: string, detail?: string, duration?: number, id?: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let _seq = 0;

export const useErrorStore = create<ErrorStore>((set) => ({
  toasts: [],

  push: (severity, title, detail, duration, id) => {
    const toastId = id ?? `toast-${++_seq}`;
    const dur = duration ?? (severity === "error" ? 8000 : severity === "warning" ? 5000 : 3000);

    set((s) => ({
      toasts: [
        // Remove any existing toast with the same explicit id (dedup).
        ...s.toasts.filter((t) => t.id !== toastId),
        { id: toastId, severity, title, detail, duration: dur },
      ],
    }));

    if (dur > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toastId) }));
      }, dur);
    }
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

// ── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Call this wherever a Tauri `invoke()` might throw to surface a typed
 * user-visible error.
 *
 * If the error is a JSON object with `{code, message}` (AppError from Rust),
 * the `code` is mapped to a human title; otherwise the raw string is used.
 *
 * Sidecar errors are downgraded to "warning" (feature unavailable) rather
 * than "error" (something broke) so the UX feels less alarming.
 */
export function reportError(raw: unknown, context?: string): void {
  const store = useErrorStore.getState();

  let title  = context ?? "Something went wrong";
  let detail = String(raw);
  let severity: ToastSeverity = "error";

  if (raw && typeof raw === "object" && "code" in raw && "message" in raw) {
    const e = raw as { code: string; message: string };
    switch (e.code) {
      case "sidecar":
        title    = "Semantic search unavailable";
        detail   = e.message;
        severity = "warning";
        break;
      case "database":
        title  = "Database error";
        detail = e.message;
        break;
      case "not_found":
        title  = "Asset not found";
        detail = e.message;
        break;
      case "invalid_input":
        title  = "Invalid input";
        detail = e.message;
        break;
      default:
        title  = context ?? "Internal error";
        detail = e.message;
    }
  } else if (typeof raw === "string") {
    // Legacy string errors from Rust commands that still return String.
    if (raw.includes("sidecar") || raw.includes("Sidecar") || raw.includes("semantic")) {
      title    = "Semantic search unavailable";
      detail   = raw;
      severity = "warning";
    } else if (raw.includes("SQL") || raw.includes("locked") || raw.includes("busy")) {
      title  = "Database error";
      detail = raw;
    } else {
      detail = raw;
    }
  }

  store.push(severity, title, detail);
}
