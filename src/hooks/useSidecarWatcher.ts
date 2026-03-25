/**
 * Watches for sidecar lifecycle events and surfaces user-facing toasts.
 *
 * Handles two scenarios:
 *  1. `warmup_complete` push from the Python process — clears any existing
 *     sidecar-dead toast so the user knows semantic features are now available.
 *  2. `sidecar_dead` synthetic event emitted by the Tauri Rust layer when the
 *     reader thread detects EOF — shows a warning toast with a "Restart" action.
 *
 * The hook also polls `sidecar_alive` once on mount to catch the case where the
 * sidecar died before this hook was registered (e.g. crash during startup).
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { useErrorStore } from "../store/errorStore";

const SIDECAR_TOAST_ID = "sidecar-dead";

export function useSidecarWatcher() {
  const push    = useErrorStore((s) => s.push);
  const dismiss = useErrorStore((s) => s.dismiss);

  // Keep a stable ref to dismiss so the async restart callback is not stale.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    // ── Poll once on mount ────────────────────────────────────────────────────
    api.sidecarAlive()
      .then((alive) => {
        if (!alive) showDeadToast(push, dismissRef.current);
      })
      .catch(() => {
        // Command not available (older build) — silently skip.
      });

    // ── Listen for sidecar push events on the `sidecar_event` bus ────────────
    // The Rust reader thread emits these via app.emit("sidecar_event", data).
    const unlistenEvent = listen<{ event: string; data: unknown }>(
      "sidecar_event",
      (e) => {
        if (e.payload.event === "warmup_complete") {
          // Sidecar is (re)alive — dismiss any dead-toast.
          dismissRef.current(SIDECAR_TOAST_ID);
        }
      },
    );

    // ── Listen for the synthetic sidecar_dead event ───────────────────────────
    // Emitted by the Rust reader thread when it detects EOF (process exited).
    const unlistenDead = listen<void>(
      "sidecar_dead",
      () => showDeadToast(push, dismissRef.current),
    );

    return () => {
      unlistenEvent.then((f) => f());
      unlistenDead.then((f) => f());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showDeadToast(
  push: ReturnType<typeof useErrorStore.getState>["push"],
  dismiss: (id: string) => void,
) {
  // Avoid stacking duplicates.
  dismiss(SIDECAR_TOAST_ID);
  push(
    "warning",
    "Semantic features unavailable",
    "The AI model process has stopped. Image search and auto-tagging are disabled.",
    0, // never auto-dismiss — user must act
    SIDECAR_TOAST_ID,
  );
}
