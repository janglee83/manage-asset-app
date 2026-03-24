import { useEffect, useCallback } from "react";
import { useAssetStore } from "../store/assetStore";
import { api } from "../lib/api";

export function useKeyboardShortcuts() {
  const assets          = useAssetStore((s) => s.assets);
  const selectedIndex   = useAssetStore((s) => s.selectedIndex);
  const selectedAsset   = useAssetStore((s) => s.selectedAsset);
  const setSelectedIndex = useAssetStore((s) => s.setSelectedIndex);
  const setSelectedAsset = useAssetStore((s) => s.setSelectedAsset);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Ctrl+K / Cmd+K — focus the search bar
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("global-search-input") as HTMLInputElement | null;
        input?.focus();
        input?.select();
        return;
      }

      // Asset navigation (disabled while typing in an input)
      if (typing) return;

      const count = assets.length;
      if (count === 0) return;

      switch (e.key) {
        case "ArrowRight": {
          e.preventDefault();
          const next = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, count - 1);
          setSelectedIndex(next);
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const prev = selectedIndex <= 0 ? 0 : selectedIndex - 1;
          setSelectedIndex(prev);
          break;
        }
        case "Enter": {
          if (selectedAsset) {
            e.preventDefault();
            api.openFile(selectedAsset.file_path);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setSelectedAsset(null);
          break;
        }
      }
    },
    [assets, selectedIndex, selectedAsset, setSelectedIndex, setSelectedAsset]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
