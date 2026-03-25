/**
 * useImageSearch
 *
 * Provides two things:
 *
 * 1. `dropProps` — spread these onto the drop-zone <div> to get correct
 *    visual-hover tracking even when the div has child elements (avoids the
 *    classic dragLeave-on-child issue via a counter).
 *
 * 2. `isDragOver` — true while an image is being dragged over the drop zone.
 *
 * File paths are captured via Tauri's window-level `tauri://drag-drop` event
 * (which carries the full OS path), but only acted upon when the pointer is
 * currently over the registered drop zone element.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";

// Extensions treated as images for the CLIP visual similarity search
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "avif",
]);

function isImagePath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

/**
 * @param onImageDrop — called with the first image path when the user drops
 *                      an image file onto the registered drop zone.
 */
export function useImageSearch(onImageDrop: (filePath: string) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCountRef = useRef(0); // prevents false dragLeave from child elements

  // Keep a stable ref to the callback so we don't re-subscribe on every render.
  const callbackRef = useRef(onImageDrop);
  callbackRef.current = onImageDrop;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<DragDropPayload>("tauri://drag-drop", (event) => {
      if (dragCountRef.current <= 0) return; // drop happened outside our zone

      const images = event.payload.paths.filter(isImagePath);
      if (images.length > 0) {
        callbackRef.current(images[0]);
      }

      // Reset overlay regardless (drop event ends the drag)
      dragCountRef.current = 0;
      setIsDragOver(false);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []); // no deps — subscribe once

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current += 1;
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((_e: React.DragEvent) => {
    dragCountRef.current -= 1;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); // required to allow drop
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    // Prevent browser from opening the file; path resolution is handled by
    // the Tauri event listener above which fires concurrently.
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDragOver(false);
  }, []);

  return {
    isDragOver,
    dropProps: { onDragEnter, onDragLeave, onDragOver, onDrop },
  };
}
