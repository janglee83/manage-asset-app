import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAssetStore } from "../store/assetStore";

interface FileChangeEvent {
  kind: "update" | "remove";  // matches watcher.rs apply_action output
  path: string;
}

export function useFileWatcher() {
  const runSearch = useAssetStore((s) => s.runSearch);
  const loadStats = useAssetStore((s) => s.loadStats);

  useEffect(() => {
    // Debounce re-search on file changes
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unlisten = listen<FileChangeEvent>("file_change", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await runSearch();
        await loadStats();
      }, 800);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unlisten.then((f) => f());
    };
  }, [runSearch, loadStats]);
}
