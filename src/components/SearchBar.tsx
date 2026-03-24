import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Loader2, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { useAssetStore } from "../store/assetStore";
import type { SortBy, ViewMode } from "../types";
import clsx from "clsx";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "modified_at", label: "Date modified" },
  { value: "created_at",  label: "Date created"  },
  { value: "file_name",   label: "Name"           },
  { value: "file_size",   label: "File size"      },
];

const DEBOUNCE_MS = 300;

export function SearchBar() {
  const [localText, setLocalText] = useState("");
  const [sortOpen,  setSortOpen]  = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const setSearchQuery = useAssetStore((s) => s.setSearchQuery);
  const searchQuery    = useAssetStore((s) => s.searchQuery);
  const viewMode       = useAssetStore((s) => s.viewMode);
  const setViewMode    = useAssetStore((s) => s.setViewMode);
  const isLoading      = useAssetStore((s) => s.isLoading);

  const currentSort = searchQuery.sort_by ?? "modified_at";

  // Debounced text search
  const handleChange = useCallback((v: string) => {
    setLocalText(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery({ text: v.trim() || undefined });
    }, DEBOUNCE_MS);
  }, [setSearchQuery]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const clear = () => {
    setLocalText("");
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

  const sortLabel = SORT_OPTIONS.find((o) => o.value === currentSort)?.label ?? "Sort";

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      {/* Search input */}
      <div className="relative flex items-center flex-1 max-w-2xl">
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
          placeholder="Search assets… (Ctrl+K)"
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
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
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
          title="Sort by"
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
            title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
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
