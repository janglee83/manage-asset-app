"use client";

import { useState, useEffect } from "react";
import { Download, ChevronDown, ArrowUpRight } from "lucide-react";
import { DOWNLOAD_CONFIG, type DownloadAsset } from "@/lib/seo";

type Platform =
  | "macos-arm64"
  | "macos-x64"
  | "windows-x64"
  | "linux-appimage"
  | "linux-deb"
  | null;

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;

  if (/Windows/.test(ua)) return "windows-x64";
  if (/Mac/.test(ua)) {
    // Best-effort Apple Silicon detection. Chrome on M1/M2 ships with
    // the string "Mac OS X" and we cannot reliably distinguish intel vs arm
    // from the UA alone — so we default to arm64 for Macs and let the user
    // override with the dropdown.
    return "macos-arm64";
  }
  if (/Linux/.test(ua)) return "linux-appimage";
  return null;
}

const platformLabels: Record<string, string> = {
  "macos-arm64": "macOS Apple Silicon",
  "macos-x64": "macOS Intel",
  "windows-x64": "Windows x64",
  "linux-appimage": "Linux AppImage",
  "linux-deb": "Linux .deb",
};

const platforms = Object.keys(platformLabels) as Platform[];

export function DownloadSection() {
  const [detected, setDetected] = useState<Platform>(null);
  const [selected, setSelected] = useState<Platform>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    setDetected(p);
    setSelected(p);
  }, []);

  const active = selected ?? "macos-arm64";
  const asset = DOWNLOAD_CONFIG.downloads[active] as DownloadAsset | undefined;

  return (
    <section
      id="download"
      className="relative overflow-hidden py-24 sm:py-32 border-t border-zinc-800/50"
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[700px] rounded-full bg-violet-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
          Download
        </p>
        <h2 className="text-4xl font-bold tracking-tight text-zinc-50 mb-4">
          Get AssetVault for free
        </h2>
        <p className="text-lg text-zinc-400 mb-12">
          Free for up to 5 000 assets. No account, no credit card, no
          telemetry.
        </p>

        {/* Primary download card */}
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900/80 backdrop-blur-sm p-8 mb-6 ring-1 ring-violet-500/10">
          {detected && (
            <p className="text-xs text-zinc-500 mb-4">
              Detected:{" "}
              <span className="text-zinc-300">
                {platformLabels[detected] ?? detected}
              </span>
            </p>
          )}

          {asset && (
            <>
              <a
                href={asset.url}
                className="group inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-4 text-base font-semibold text-white hover:from-violet-500 hover:to-indigo-500 transition-all shadow-2xl shadow-violet-500/20 hover:shadow-violet-500/35"
                rel="nofollow"
              >
                <Download className="h-5 w-5" />
                Download for {platformLabels[active]}
                <span className="text-violet-200/60 text-sm font-normal">
                  {asset.size}
                </span>
              </a>
              <p className="mt-3 text-xs text-zinc-600">
                v{DOWNLOAD_CONFIG.version} — {asset.format} installer
              </p>
            </>
          )}
        </div>

        {/* Platform selector */}
        <div className="relative inline-block text-left">
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {selected ? platformLabels[selected] : "Select platform"}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>

          {dropdownOpen && (
            <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-56 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl ring-1 ring-black/10 z-10 overflow-hidden">
              {(platforms.filter(Boolean) as NonNullable<Platform>[]).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSelected(p);
                      setDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                      selected === p
                        ? "bg-violet-600/20 text-violet-300"
                        : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {platformLabels[p]}
                    {selected === p && (
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    )}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {/* All downloads link */}
        <div className="mt-8">
          <a
            href="https://github.com/janglee83/manage-asset-app/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            View all releases on GitHub
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
