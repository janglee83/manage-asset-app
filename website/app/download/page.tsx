/**
 * app/download/page.tsx
 *
 * Dedicated /download page with per-platform download links and OS detection.
 * This page is indexed separately for "download AssetVault" keyword intent.
 */

import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/seo";
import { fetchLatestRelease } from "@/lib/releases";
import { DownloadSection } from "@/components/landing/DownloadSection";
import { NavBar } from "@/components/landing/NavBar";
import { Footer } from "@/components/landing/Footer";

export const metadata: Metadata = {
  title: "Download AssetVault",
  description:
    "Download AssetVault for macOS, Windows, or Linux. Free for up to 5 000 assets. No account, no cloud, no telemetry.",
  keywords: [
    "download AssetVault",
    "AssetVault installer",
    "design asset search desktop app",
    "local AI search download",
    "macOS design tool",
    "Windows design search",
  ],
  alternates: {
    canonical: `${SITE_CONFIG.siteUrl}/download`,
  },
  openGraph: {
    title: "Download AssetVault",
    description:
      "Native installers for macOS (Apple Silicon + Intel), Windows x64, and Linux. Free to try.",
    url: `${SITE_CONFIG.siteUrl}/download`,
    type: "website",
  },
};

export default async function DownloadPage() {
  const release = await fetchLatestRelease();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <NavBar />
      <main className="pt-16">
        {/* Page header */}
        <div className="border-b border-zinc-800/50 py-16 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-violet-600/6 to-transparent"
          />
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            Downloads
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-50 mb-3">
            AssetVault v{release.version}
          </h1>
          <p className="text-zinc-400 text-lg max-w-md mx-auto">
            Released {release.releaseDate} · Free for up to 5 000 assets
          </p>
        </div>

        <DownloadSection releaseData={release} />

        {/* Version table */}
        <section className="border-t border-zinc-800/50 py-16">
          <div className="mx-auto max-w-3xl px-6">
            <h2 className="text-xl font-semibold text-zinc-100 mb-6">
              All packages
            </h2>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">
                      Platform
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">
                      Format
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500">
                      Size
                    </th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(release.downloads).map(
                    ([key, asset]) => (
                      <tr
                        key={key}
                        className="border-b border-zinc-800 last:border-0 hover:bg-zinc-900/30 transition-colors"
                      >
                        <td className="px-6 py-4 text-zinc-300">
                          {asset.label}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-zinc-500">
                          {asset.format}
                        </td>
                        <td className="px-6 py-4 text-zinc-500">{asset.size}</td>
                        <td className="px-6 py-4 text-right">
                          <a
                            href={asset.url}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                            rel="nofollow"
                          >
                            Download
                          </a>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-zinc-600">
              All installers are code-signed. SHA-256 checksums are available on
              the{" "}
              <a
                href="https://github.com/janglee83/manage-asset-app/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-zinc-200 underline"
              >
                GitHub releases page
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
