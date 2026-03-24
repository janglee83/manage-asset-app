import { useState } from "react";
import { FolderOpen, FolderPlus, Trash2, RefreshCw, ChevronDown, ChevronRight, Star, Filter } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAssetStore } from "../store/assetStore";
import { IMAGE_EXTENSIONS, DESIGN_EXTENSIONS } from "../lib/utils";
import clsx from "clsx";

const EXTENSION_GROUPS = [
  { label: "Images", exts: IMAGE_EXTENSIONS },
  { label: "Design", exts: DESIGN_EXTENSIONS },
  { label: "PDF",    exts: ["pdf"] },
  { label: "Video",  exts: ["mp4", "mov", "avi", "webm"] },
];

export function Sidebar() {
  const {
    watchedFolders,
    addFolder,
    removeFolder,
    rescanFolder,
    isScanning,
    searchQuery,
    setSearchQuery,
    extFilters,
    setExtFilters,
    stats,
  } = useAssetStore();

  const [foldersOpen, setFoldersOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [dateOpen,    setDateOpen]    = useState(false);

  const handleAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      await addFolder(selected);
    }
  };

  const toggleExt = (ext: string) => {
    const newExts = extFilters.includes(ext)
      ? extFilters.filter((e) => e !== ext)
      : [...extFilters, ext];
    setExtFilters(newExts);
  };

  const toggleFavorites = () => {
    setSearchQuery({ favorites_only: searchQuery.favorites_only ? undefined : true });
  };

  const setFromDate = (iso: string) => {
    const ts = iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined;
    setSearchQuery({ from_date: ts });
  };

  const setToDate = (iso: string) => {
    const ts = iso ? Math.floor(new Date(iso + "T23:59:59").getTime() / 1000) : undefined;
    setSearchQuery({ to_date: ts });
  };

  const fromIso = searchQuery.from_date
    ? new Date(searchQuery.from_date * 1000).toISOString().slice(0, 10)
    : "";
  const toIso = searchQuery.to_date
    ? new Date(searchQuery.to_date * 1000).toISOString().slice(0, 10)
    : "";

  return (
    <aside className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1 text-sm">
      {/* Stats */}
      {stats && (
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
          <p className="text-slate-400 text-xs mb-1">Total indexed</p>
          <p className="text-2xl font-bold text-slate-100">{stats.total_assets.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">{stats.favorites} favorites · {stats.watched_folders} folders</p>
        </div>
      )}

      {/* Folders */}
      <section>
        <button
          onClick={() => setFoldersOpen((v) => !v)}
          className="flex items-center justify-between w-full text-slate-300 font-medium px-1 mb-2"
        >
          <span className="flex items-center gap-1.5">
            {foldersOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Folders
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); handleAddFolder(); }}
            disabled={isScanning}
            className="p-0.5 rounded text-slate-400 hover:text-violet-400 hover:bg-slate-700 transition-colors disabled:opacity-40"
            title="Add folder"
          >
            <FolderPlus size={14} />
          </button>
        </button>

        {foldersOpen && (
          <ul className="space-y-0.5">
            {watchedFolders.length === 0 && (
              <li className="text-slate-500 text-xs px-2 py-1 italic">
                No folders added yet
              </li>
            )}
            {watchedFolders.map((f) => {
              const name = f.path.split(/[/\\]/).pop() ?? f.path;
              return (
                <li key={f.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-slate-800 transition-colors">
                  <FolderOpen size={13} className="text-yellow-500 shrink-0" />
                  <span className="flex-1 truncate text-slate-300 text-xs" title={f.path}>
                    {name}
                  </span>
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      onClick={() => rescanFolder(f.path)}
                      className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
                      title="Rescan"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      onClick={() => removeFolder(f.path)}
                      className="p-0.5 rounded text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Filters */}
      <section>
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex items-center gap-1.5 w-full text-slate-300 font-medium px-1 mb-2"
        >
          {filtersOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Filter size={13} />
          Filters
        </button>

        {filtersOpen && (
          <div className="space-y-3">
            {/* Favorites */}
            <button
              onClick={toggleFavorites}
              className={clsx(
                "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors",
                searchQuery.favorites_only
                  ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <Star size={13} className={searchQuery.favorites_only ? "fill-yellow-400 text-yellow-400" : ""} />
              Favorites only
            </button>

            {/* Extension groups */}
            {EXTENSION_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs text-slate-500 px-2 mb-1">{group.label}</p>
                <div className="flex flex-wrap gap-1 px-2">
                  {group.exts.slice(0, 6).map((ext) => (
                    <button
                      key={ext}
                      onClick={() => toggleExt(ext)}
                      className={clsx(
                        "px-2 py-0.5 rounded text-xs font-mono transition-colors",
                        extFilters.includes(ext)
                          ? "bg-violet-500/30 text-violet-300 border border-violet-500/50"
                          : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-500"
                      )}
                    >
                      .{ext}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Date range */}
            <div>
              <button
                onClick={() => setDateOpen((v) => !v)}
                className="flex items-center gap-1.5 w-full text-xs text-slate-400 hover:text-slate-200 px-2 mb-1 transition-colors"
              >
                {dateOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Date range
                {(fromIso || toIso) && (
                  <span className="ml-auto text-violet-400">●</span>
                )}
              </button>
              {dateOpen && (
                <div className="px-2 space-y-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">From</label>
                    <input
                      type="date"
                      value={fromIso}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">To</label>
                    <input
                      type="date"
                      value={toIso}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  {(fromIso || toIso) && (
                    <button
                      onClick={() => setSearchQuery({ from_date: undefined, to_date: undefined })}
                      className="text-xs text-slate-500 hover:text-slate-300 px-1 transition-colors"
                    >
                      Clear dates
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </aside>
  );
}
