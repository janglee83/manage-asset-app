/**
 * useGlobalImageDrop
 *
 * Listens for image files dropped anywhere on the Tauri window.
 * Returns `isDragging` (true while an image is in-flight over the window)
 * and fires `onImageDrop(filePath)` when the user releases.
 *
 * This is separate from the per-element useImageSearch hook so the
 * full-screen overlay can be rendered from App.tsx regardless of which
 * element the pointer is hovering.
 */

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

const IMAGE_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif",
  "heic", "heif", "avif", "svg",
]);

function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(p.split(".").pop()?.toLowerCase() ?? "");
}

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

export function useGlobalImageDrop(onImageDrop: (filePath: string) => void) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let drop: (() => void) | undefined;
    let enter: (() => void) | undefined;
    let leave: (() => void) | undefined;

    listen<DragDropPayload>("tauri://drag-drop", (e) => {
      const images = e.payload.paths.filter(isImagePath);
      setIsDragging(false);
      if (images.length > 0) onImageDrop(images[0]);
    }).then((fn) => { drop = fn; });

    listen("tauri://drag-enter", () => setIsDragging(true))
      .then((fn) => { enter = fn; });

    listen("tauri://drag-leave", () => setIsDragging(false))
      .then((fn) => { leave = fn; });

    return () => { drop?.(); enter?.(); leave?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isDragging };
}
