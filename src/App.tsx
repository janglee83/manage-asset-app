import { useEffect } from "react";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { AssetGrid } from "./components/AssetGrid";
import { PreviewPanel } from "./components/PreviewPanel";
import { ScanProgressBar } from "./components/ScanProgressBar";
import { useAssetStore } from "./store/assetStore";
import { useScanProgress } from "./hooks/useScanProgress";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useFileWatcher } from "./hooks/useFileWatcher";

export default function App() {
  const { runSearch, loadFolders, loadStats } = useAssetStore();

  useScanProgress();
  useKeyboardShortcuts();
  useFileWatcher();

  useEffect(() => {
    loadFolders();
    loadStats();
    runSearch();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <header className="flex items-center gap-4 px-4 py-3 border-b border-slate-700/50 bg-slate-900 shrink-0">
        <span className="text-sm font-bold text-violet-400 tracking-tight shrink-0">
          AssetVault
        </span>
        <SearchBar />
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <nav className="w-56 shrink-0 bg-slate-900/50 border-r border-slate-700/50 overflow-y-auto px-3 py-4">
          <Sidebar />
        </nav>

        <main className="flex-1 min-w-0 overflow-hidden px-4 py-4">
          <AssetGrid />
        </main>

        <PreviewPanel />
      </div>

      <ScanProgressBar />
    </div>
  );
}
