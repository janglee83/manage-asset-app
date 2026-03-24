import { format, formatDistanceToNow } from "date-fns";

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return format(d, "MMM d, yyyy");
}

export function formatRelativeDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return formatDistanceToNow(d, { addSuffix: true });
}

export function getExtensionColor(ext: string): string {
  const colors: Record<string, string> = {
    // Images
    jpg: "#4ade80",
    jpeg: "#4ade80",
    png: "#60a5fa",
    gif: "#f472b6",
    webp: "#a78bfa",
    svg: "#fb923c",
    // Design files
    fig: "#a259ff",
    sketch: "#f7b731",
    xd: "#ff61f6",
    psd: "#31a8ff",
    ai: "#ff9a00",
    // Documents
    pdf: "#ef4444",
  };
  return colors[ext.toLowerCase()] ?? "#94a3b8";
}

export const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "svg", "ico",
  "heic", "heif", "avif",
];

export const DESIGN_EXTENSIONS = ["fig", "sketch", "xd", "psd", "ai", "eps", "indd"];

export const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DESIGN_EXTENSIONS, "pdf", "mp4", "mov"];

export function isImage(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext.toLowerCase());
}
