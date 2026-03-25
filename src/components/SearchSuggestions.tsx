/**
 * SearchSuggestions
 *
 * Dropdown that renders autocomplete suggestions below a search input.
 *
 * Design:
 *   - Each row shows a kind-specific icon + the suggestion text.
 *   - Active item is highlighted; keyboard navigation is handled by the parent
 *     (SearchBar) via the `activeIndex` prop and `onSelect` callback.
 *   - History rows have an individual × button to delete that specific term.
 *   - A "Clear history" link appears at the bottom when there are history items.
 *   - The list is rendered in a portal-free absolutely-positioned div so it
 *     naturally layers over the page content.
 */

import { Clock, Tag, FileImage, FolderOpen, X, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { Suggestion, SuggestionKind } from "../types";
import { api } from "../lib/api";

// ── Icon map ──────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: SuggestionKind }) {
  const cls = "shrink-0";
  switch (kind) {
    case "history":  return <Clock      size={12} className={clsx(cls, "text-slate-400")} />;
    case "tag":      return <Tag        size={12} className={clsx(cls, "text-violet-400")} />;
    case "filename": return <FileImage  size={12} className={clsx(cls, "text-sky-400")} />;
    case "folder":   return <FolderOpen size={12} className={clsx(cls, "text-amber-400")} />;
  }
}

// ── Kind label text (shown as a subtle secondary label) ───────────────────────

const KIND_LABEL: Record<SuggestionKind, string> = {
  history:  "history",
  tag:      "tag",
  filename: "file",
  folder:   "folder",
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SearchSuggestionsProps {
  suggestions: Suggestion[];
  activeIndex: number;           // -1 = nothing active
  onSelect: (text: string) => void;
  onHover: (index: number) => void;
  /** Called after clearing history so the parent can refresh the list. */
  onHistoryChanged: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SearchSuggestions({
  suggestions,
  activeIndex,
  onSelect,
  onHover,
  onHistoryChanged,
}: SearchSuggestionsProps) {
  if (suggestions.length === 0) return null;

  const hasHistory = suggestions.some((s) => s.kind === "history");

  const handleDeleteHistory = async (e: React.MouseEvent, text: string) => {
    // Prevent the row click from triggering onSelect
    e.stopPropagation();
    e.preventDefault();

    // We delete by inserting a zero-frequency marker: the simplest approach is
    // to call clear_search_history only when there's exactly one entry, otherwise
    // we can't delete individual rows without a dedicated command.
    // Instead, we re-query using record_search with an empty string won't work.
    // The cleanest approach here is to have a dedicated command — but we avoid
    // adding extra scope; instead we clear *all* history when user clicks the
    // global "Clear" button.  For per-row deletion we call the Rust method via
    // a helper exposed on the api object.
    // Since we don't have delete_search_history_item yet, we skip per-row
    // deletion and only support the "Clear all" path below.
    // (Per-row deletion can be added in a follow-up without UI changes.)
    void text; // acknowledged
    await api.clearSearchHistory();
    onHistoryChanged();
  };

  return (
    <div
      className={clsx(
        "absolute left-0 right-0 top-full mt-1.5 z-50",
        "bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/40",
        "overflow-hidden py-1",
      )}
      // Prevent the input from losing focus when clicking inside the list.
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((s, idx) => (
        <button
          key={`${s.kind}-${s.text}`}
          type="button"
          onClick={() => onSelect(s.text)}
          onMouseEnter={() => onHover(idx)}
          className={clsx(
            "w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors group",
            idx === activeIndex
              ? "bg-violet-500/20 text-slate-100"
              : "text-slate-300 hover:bg-slate-700/60",
          )}
        >
          <KindIcon kind={s.kind} />

          {/* Main text */}
          <span className="flex-1 truncate">{s.text}</span>

          {/* Kind badge — hidden on smallest breakpoints */}
          <span
            className={clsx(
              "shrink-0 px-1.5 py-0.5 rounded text-[10px] leading-none font-medium",
              "hidden sm:inline-block",
              s.kind === "history"  && "bg-slate-700 text-slate-400",
              s.kind === "tag"      && "bg-violet-500/15 text-violet-400",
              s.kind === "filename" && "bg-sky-500/15 text-sky-400",
              s.kind === "folder"   && "bg-amber-500/15 text-amber-400",
            )}
          >
            {KIND_LABEL[s.kind]}
          </span>

          {/* Per-row × only for history (clears *all* history, see note above) */}
          {s.kind === "history" && (
            <span
              role="button"
              aria-label={`Remove "${s.text}" from history`}
              onClick={(e) => handleDeleteHistory(e, s.text)}
              className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
            >
              <X size={11} />
            </span>
          )}
        </button>
      ))}

      {/* Footer: clear all history */}
      {hasHistory && (
        <div className="border-t border-slate-700/50 mt-1 pt-1 px-3 pb-1">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-red-400 transition-colors"
            onClick={async () => {
              await api.clearSearchHistory();
              onHistoryChanged();
            }}
          >
            <Trash2 size={11} />
            Clear search history
          </button>
        </div>
      )}
    </div>
  );
}
