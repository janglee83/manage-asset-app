import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, ScanSearch, GitMerge, Globe, HelpCircle } from "lucide-react";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { AssetGrid } from "./components/AssetGrid";
import { PreviewPanel } from "./components/PreviewPanel";
import { ScanProgressBar } from "./components/ScanProgressBar";
import { ImageSearchPanel, GlobalDropOverlay } from "./components/ImageSearchPanel";
import { RecoveryPanel } from "./components/RecoveryPanel";
import { ExportModal } from "./components/ExportModal";
import { DuplicatePanel } from "./components/DuplicatePanel";
import { WelcomeGuide } from "./components/WelcomeGuide";
import { Tooltip } from "./components/Tooltip";
import { useAssetStore } from "./store/assetStore";
import { useScanProgress } from "./hooks/useScanProgress";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useFileWatcher } from "./hooks/useFileWatcher";
import { useGlobalImageDrop } from "./hooks/useGlobalImageDrop";
import { useSidecarWatcher } from "./hooks/useSidecarWatcher";
import { useActivityLock } from "./hooks/useActivityLock";
import { useT, useLang } from "./lib/i18n";
import { ToastStack } from "./components/ToastStack";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Side panel types — only one can be open at a time.
type Panel = "visual" | "recovery" | "duplicates" | null;

export default function App() {
  const { runSearch, loadFolders, loadStats, runImageSearch, imageSearchActive, brokenAssets, assets, watchedFolders } =
    useAssetStore();
  const [activePanel,      setActivePanel]      = useState<Panel>(null);
  const [exportModalOpen,  setExportModalOpen]  = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => localStorage.getItem("assetvault_welcome_dismissed") === "1",
  );
  // null = guide closed, -1 = open at overview, 0-3 = open at specific step
  const [helpStep, setHelpStep] = useState<number | null>(null);

  const { canImageSearch, lockTooltip } = useActivityLock();
  const t  = useT();
  const { lang, setLang } = useLang();

  useScanProgress();
  useKeyboardShortcuts();
  useFileWatcher();
  useSidecarWatcher();

  useEffect(() => {
    loadFolders();
    loadStats();
    runSearch();
  }, []);

  // When image search activates externally (e.g. global drop), open the visual panel
  useEffect(() => {
    if (imageSearchActive) setActivePanel("visual");
  }, [imageSearchActive]);

  const handleGlobalImageDrop = useCallback(
    async (filePath: string) => {
      setActivePanel("visual");
      await runImageSearch(filePath);
    },
    [runImageSearch],
  );

  const { isDragging } = useGlobalImageDrop(handleGlobalImageDrop);

  const brokenCount = brokenAssets.length;

  // Toggle a panel: opening one closes all others.
  const togglePanel = (panel: Panel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  const handleDismissWelcome = () => {
    localStorage.setItem("assetvault_welcome_dismissed", "1");
    setWelcomeDismissed(true);
    setHelpStep(null);
  };

  const showWelcome = (!welcomeDismissed && watchedFolders.length === 0) || helpStep !== null;

  return (
    <>
      <ToastStack />

      {showWelcome && (
        <WelcomeGuide
          onDismiss={handleDismissWelcome}
          initialStep={helpStep === -1 ? null : helpStep}
        />
      )}

      <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
        {isDragging && <GlobalDropOverlay />}

        {/* ── Header ────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900 shrink-0">
          <span className="text-sm font-bold text-violet-400 tracking-tight shrink-0">
            {t.header.appName}
          </span>

          <SearchBar />

          {/* Visual search toggle */}
          <Tooltip text={canImageSearch ? t.header.visualSearchTip : lockTooltip("embed")} position="bottom">
            <button
              onClick={() => canImageSearch && togglePanel("visual")}
              disabled={!canImageSearch}
              className={
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 " +
                (activePanel === "visual"
                  ? "bg-violet-600 text-white"
                  : canImageSearch
                  ? "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed opacity-50")
              }
            >
              <ScanSearch size={13} />
              {t.header.visualSearch}
            </button>
          </Tooltip>

          {/* Duplicate detection toggle */}
          <Tooltip text={t.header.duplicatesTip} position="bottom">
            <button
              onClick={() => togglePanel("duplicates")}
              className={
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 " +
                (activePanel === "duplicates"
                  ? "bg-violet-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100")
              }
            >
              <GitMerge size={13} />
              {t.header.duplicates}
            </button>
          </Tooltip>

          {/* Recovery toggle — amber badge when broken paths found */}
          <Tooltip text={t.header.recoveryTip} position="bottom">
            <button
              onClick={() => togglePanel("recovery")}
              className={
                "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 " +
                (activePanel === "recovery"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100")
              }
            >
              <AlertTriangle size={13} />
              {t.header.recovery}
              {brokenCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {brokenCount > 9 ? "9+" : brokenCount}
                </span>
              )}
            </button>
          </Tooltip>

          {/* Export button */}
          <Tooltip text={assets.length > 0 ? t.header.exportTip : undefined} position="bottom">
            <button
              onClick={() => setExportModalOpen(true)}
              disabled={assets.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0
                         bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} />
              {t.header.export}
            </button>
          </Tooltip>

          {/* Language switcher */}
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <Globe size={12} className="text-slate-500" />
            {(["en", "vi"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={
                  "px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors " +
                  (lang === l
                    ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                    : "text-slate-500 hover:text-slate-300")
                }
                title={t.general.lang}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Help / Guide button */}
          <Tooltip text={t.welcome.helpTip} position="bottom">
            <button
              onClick={() => setHelpStep(-1)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-violet-400 hover:bg-slate-800 transition-colors shrink-0"
            >
              <HelpCircle size={15} />
            </button>
          </Tooltip>
        </header>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <nav className="w-56 shrink-0 bg-slate-900/50 border-r border-slate-700/50 overflow-y-auto px-3 py-4">
            <Sidebar />
          </nav>

          {/* Duplicate panel takes over the main area when open */}
          {activePanel === "duplicates" ? (
            <main className="flex-1 min-w-0 overflow-hidden px-4 py-4">
              <ErrorBoundary label="Duplicate Panel">
                <DuplicatePanel onClose={() => setActivePanel(null)} />
              </ErrorBoundary>
            </main>
          ) : (
            <main className="flex-1 min-w-0 overflow-hidden px-4 py-4">
              <ErrorBoundary label="Asset Grid">
                <AssetGrid />
              </ErrorBoundary>
            </main>
          )}

          <ErrorBoundary label="Preview Panel">
            <PreviewPanel />
          </ErrorBoundary>

          {activePanel === "visual" && (
            <ImageSearchPanel onClose={() => setActivePanel(null)} />
          )}

          {activePanel === "recovery" && (
            <RecoveryPanel onClose={() => setActivePanel(null)} />
          )}

          {exportModalOpen && (
            <ExportModal
              assetIds={assets.map((a) => a.id)}
              onClose={() => setExportModalOpen(false)}
            />
          )}
        </div>

      <ScanProgressBar />
    </div>
    </>
  );
}
