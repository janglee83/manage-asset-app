import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Loader2, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { useSuggestions } from "../hooks/useSuggestions";
import { SearchSuggestions } from "./SearchSuggestions";
import type { SortBy, ViewMode } from "../types";
import clsx from "clsx";

function useSortOptions() {
  const t = useT();
  return [
    { value: "modified_at" as SortBy, label: t.search.dateModified },
    { value: "created_at"  as SortBy, label: t.search.dateCreated  },
    { value: "file_name"   as SortBy, label: t.search.name         },
    { value: "file_size"   as SortBy, label: t.search.fileSize     },
  ];
}

const DEBOUNCE_MS = 300;

export function SearchBar() {
  const [localText,    setLocalText]    = useState("");
  const [sortOpen,     setSortOpen]     = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [activeIndex,  setActiveIndex]  = useState(-1);

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortMenuRef  = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  const setSearchQuery = useAssetStore((s) => s.setSearchQuery);
  const searchQuery    = useAssetStore((s) => s.searchQuery);
  const viewMode       = useAssetStore((s) => s.viewMode);
  const setViewMode    = useAssetStore((s) => s.setViewMode);
  const isLoading      = useAssetStore((s) => s.isLoading);
  const t              = useT();
  const SORT_OPTIONS   = useSortOptions();

  const currentSort = searchQuery.sort_by ?? "modified_at";

  // ── Suggestions ────────────────────────────────────────────────────────────
  const { suggestions, clear: clearSuggestions } = useSuggestions(localText, {
    showWhenEmpty: true, // show history even before user types
  });

  const showDropdown = inputFocused && suggestions.length > 0;

  // Reset active item whenever suggestion list changes.
  useEffect(() => { setActiveIndex(-1); }, [suggestions]);

  // ── Apply a selected suggestion ────────────────────────────────────────────
  const applySuggestion = useCallback((text: string) => {
    setLocalText(text);
    clearSuggestions();
    setInputFocused(false);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery({ text: text.trim() || undefined });
    // Record: "folder" and "filename" suggestions are informational hints —
    // record them so they appear in future history too.
    if (text.trim()) api.recordSearch(text.trim()).catch(() => undefined);
  }, [setSearchQuery, clearSuggestions]);

  // ── Debounced text search ──────────────────────────────────────────────────
  const handleChange = useCallback((v: string) => {
    setLocalText(v);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery({ text: v.trim() || undefined });
    }, DEBOUNCE_MS);
  }, [setSearchQuery]);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (e.key === "Enter" && localText.trim()) {
        api.recordSearch(localText.trim()).catch(() => undefined);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        applySuggestion(suggestions[activeIndex].text);
      } else {
        // Submit current text as-is
        clearSuggestions();
        setInputFocused(false);
        if (localText.trim()) api.recordSearch(localText.trim()).catch(() => undefined);
      }
    } else if (e.key === "Escape") {
      clearSuggestions();
      setInputFocused(false);
      setActiveIndex(-1);
    }
  }, [showDropdown, suggestions, activeIndex, applySuggestion, clearSuggestions, localText]);

  // ── Cleanup debounce on unmount ────────────────────────────────────────────
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const clear = () => {
    setLocalText("");
    clearSuggestions();
    setInputFocused(false);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery({ text: undefined });
    const input = document.getElementById("global-search-input") as HTMLInputElement | null;
    input?.focus();
  };

  const setSort = (v: SortBy) => {
    setSortOpen(false);
    setSearchQuery({ sort_by: v });
  };

  // Close sort dropdown when clicking outside
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (!sortMenuRef.current?.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  // Close suggestion dropdown when clicking outside the input wrapper
  useEffect(() => {
    if (!inputFocused) return;
    const handler = (e: MouseEvent) => {
      if (!inputWrapRef.current?.contains(e.target as Node)) {
        setInputFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inputFocused]);

  const sortLabel = SORT_OPTIONS.find((o) => o.value === currentSort)?.label ?? "Sort";

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {/* Search input */}
      <div className="relative flex items-center flex-1" ref={inputWrapRef}>
        <span className="absolute left-3 text-slate-400 pointer-events-none">
          {isLoading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Search size={15} />
          )}
        </span>
        <input
          id="global-search-input"
          type="text"
          value={localText}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={t.search.placeholder}
          autoComplete="off"
          spellCheck={false}
          className={clsx(
            "w-full pl-9 pr-8 py-1.5 rounded-lg text-sm outline-none transition-all",
            "bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500",
            "focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40"
          )}
        />
        {localText && (
          <button
            onClick={clear}
            className="absolute right-2.5 text-slate-400 hover:text-slate-200 transition-colors"
            aria-label={t.search.clearSearch}
          >
            <X size={13} />
          </button>
        )}

        {/* Suggestion dropdown */}
        {showDropdown && (
          <SearchSuggestions
            suggestions={suggestions}
            activeIndex={activeIndex}
            onSelect={applySuggestion}
            onHover={setActiveIndex}
            onHistoryChanged={() => {
              // Force the hook to re-fetch by briefly blurring the prefix.
              // Since useSuggestions listens to `localText`, we poke the
              // prefix by re-setting the same value via a microtask.
              const cur = localText;
              setLocalText("\u200b"); // zero-width space triggers effect
              requestAnimationFrame(() => setLocalText(cur));
            }}
          />
        )}
      </div>

      {/* Sort dropdown */}
      <div className="relative shrink-0" ref={sortMenuRef}>
        <button
          onClick={() => setSortOpen((v) => !v)}
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
            "border text-slate-300",
            sortOpen
              ? "bg-slate-700 border-slate-600"
              : "bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-750"
          )}
          title={t.search.sortBy}
        >
          <ArrowUpDown size={12} className="text-slate-400" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </button>
        {sortOpen && (
          <div className="absolute right-0 top-full mt-1.5 z-50 w-44 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 text-xs">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={clsx(
                  "w-full text-left px-3 py-1.5 transition-colors",
                  currentSort === opt.value
                    ? "bg-violet-500/20 text-violet-300"
                    : "text-slate-300 hover:bg-slate-700"
                )}
              >
                {opt.label}
                {currentSort === opt.value && (
                  <span className="float-right text-violet-400">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View mode toggle */}
      <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shrink-0">
        {(["grid", "list"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            title={mode === "grid" ? t.search.gridView : t.search.listView}
            className={clsx(
              "flex items-center justify-center px-2 py-1.5 transition-colors",
              viewMode === mode
                ? "bg-violet-500/20 text-violet-300"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            {mode === "grid" ? <LayoutGrid size={14} /> : <List size={14} />}
          </button>
        ))}
      </div>
    </div>
  );
}
