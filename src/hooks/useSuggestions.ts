/**
 * useSuggestions
 *
 * Debounced autocomplete hook.  Calls the Rust `get_suggestions` command
 * whenever the search prefix changes and returns the ranked suggestion list.
 *
 * Guarantees:
 *  - Stale responses (from a previous query that resolved late) are discarded.
 *  - All suggestion requests are cancelled on unmount.
 *  - An empty prefix still returns the most-frequent history entries
 *    (useful for showing "recent searches" when the input is first focused).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Suggestion } from "../types";

const DEBOUNCE_MS = 120; // fast enough to feel instant; avoids per-keystroke IPC

interface UseSuggestionsOptions {
  /** Maximum suggestions to request from the backend (default 10). */
  limit?: number;
  /** Whether to fetch history-only suggestions when prefix is empty (default true). */
  showWhenEmpty?: boolean;
}

export interface UseSuggestionsResult {
  suggestions: Suggestion[];
  loading: boolean;
  /** Call this to immediately clear the cached suggestion list. */
  clear: () => void;
}

export function useSuggestions(
  prefix: string,
  options: UseSuggestionsOptions = {},
): UseSuggestionsResult {
  const { limit = 10, showWhenEmpty = true } = options;

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading,     setLoading]     = useState(false);

  // An ever-incrementing counter lets us discard responses from outdated fetches.
  const requestIdRef = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    setSuggestions([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Cancel any in-flight debounce timer.
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = prefix.trim();

    // If prefix is empty and the caller doesn't want empty-state suggestions, bail.
    if (!trimmed && !showWhenEmpty) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const myId = ++requestIdRef.current;

    timerRef.current = setTimeout(async () => {
      try {
        const result = await api.getSuggestions(trimmed, limit);
        // Discard if a newer request has already fired.
        if (myId !== requestIdRef.current) return;
        setSuggestions(result.suggestions);
      } catch {
        if (myId !== requestIdRef.current) return;
        setSuggestions([]);
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [prefix, limit, showWhenEmpty]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      requestIdRef.current = Number.MAX_SAFE_INTEGER; // discard all pending responses
    };
  }, []);

  return { suggestions, loading, clear };
}
