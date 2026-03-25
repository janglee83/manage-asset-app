/**
 * lib/releases.ts
 *
 * Fetches the latest GitHub release for AssetVault and maps the raw asset
 * list into the same shape as DOWNLOAD_CONFIG so callers can use either
 * the dynamic data or the static fallback transparently.
 *
 * Result is cached by Next.js for 1 hour (revalidate: 3600).
 */

import { DOWNLOAD_CONFIG } from "./seo";

export interface ReleaseAsset {
  label: string;
  url: string;
  size: string;
  format: string;
}

export interface ReleaseData {
  version: string;
  releaseDate: string;
  downloads: Record<string, ReleaseAsset>;
}

// ── Asset name → platform key ──────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  "macos-arm64": "macOS Apple Silicon",
  "macos-x64": "macOS Intel",
  "windows-x64": "Windows x64",
  "linux-appimage": "Linux AppImage",
  "linux-deb": "Linux .deb",
};

const PLATFORM_FORMATS: Record<string, string> = {
  "macos-arm64": ".dmg",
  "macos-x64": ".dmg",
  "windows-x64": ".exe",
  "linux-appimage": ".AppImage",
  "linux-deb": ".deb",
};

function matchPlatform(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith("_aarch64.dmg")) return "macos-arm64";
  if (lower.endsWith("_x64.dmg")) return "macos-x64";
  if (lower.endsWith("_x64-setup.exe") || lower.endsWith("_x64_en-us.msi"))
    return "windows-x64";
  if (lower.endsWith(".appimage")) return "linux-appimage";
  if (lower.endsWith(".deb")) return "linux-deb";
  return null;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

// ── Fetcher ────────────────────────────────────────────────────────────────

export async function fetchLatestRelease(): Promise<ReleaseData> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/janglee83/manage-asset-app/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Cache for 1 hour; Vercel / Next.js ISR will revalidate automatically
        next: { revalidate: 3600 },
      },
    );

    if (!res.ok) return DOWNLOAD_CONFIG as ReleaseData;

    const data = await res.json();
    const version = (data.tag_name as string).replace(/^v/, "");
    const releaseDate = (data.published_at as string).slice(0, 10);

    const downloads: Record<string, ReleaseAsset> = {};

    for (const asset of data.assets as Array<{
      name: string;
      browser_download_url: string;
      size: number;
    }>) {
      const platform = matchPlatform(asset.name);
      if (!platform) continue;
      downloads[platform] = {
        label: PLATFORM_LABELS[platform] ?? platform,
        url: asset.browser_download_url,
        size: formatBytes(asset.size),
        format: PLATFORM_FORMATS[platform] ?? "",
      };
    }

    // Backfill any platform not present in the release with the static fallback
    for (const [key, val] of Object.entries(DOWNLOAD_CONFIG.downloads)) {
      if (!downloads[key]) {
        downloads[key] = val as ReleaseAsset;
      }
    }

    // Only use dynamic data if at least one real asset was found
    if (Object.keys(downloads).length === 0) return DOWNLOAD_CONFIG as ReleaseData;

    return { version, releaseDate, downloads };
  } catch {
    // Network error, rate-limit, etc. — silently fall back to static config
    return DOWNLOAD_CONFIG as ReleaseData;
  }
}
