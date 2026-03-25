/**
 * /docs layout
 *
 * Shared shell for every page under /docs/[slug].
 * Renders the sidebar (server) and leaves the right column for page content.
 * The TOC is rendered per-page from within the [slug] page component because
 * it depends on the specific doc's headings.
 */

import type { Metadata } from "next";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { getAllDocs } from "@/lib/docs";

export const metadata: Metadata = {
  title: {
    template: "%s — AssetVault Docs",
    default: "Documentation — AssetVault",
  },
  description:
    "Full technical documentation for AssetVault — local-first AI-powered design asset search.",
};

interface DocsLayoutProps {
  children: React.ReactNode;
}

export default async function DocsLayout({ children }: DocsLayoutProps) {
  // Pre-load all doc metadata for the sidebar on the server.
  const allDocs = await getAllDocs();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar — anchored so content scrolls beneath it */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="text-violet-400">AssetVault</span>
            <span className="text-zinc-500">/</span>
            <span className="text-zinc-300">Docs</span>
          </a>
          <div className="ml-auto flex items-center gap-4 text-sm text-zinc-400">
            <a href="/download" className="hover:text-zinc-100 transition-colors">
              Download
            </a>
            <a
              href="https://github.com/janglee83/manage-asset-app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-100 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-screen-2xl">
        {/* Left sidebar — hidden on mobile, shown md+ */}
        <aside className="hidden md:block w-64 shrink-0 border-r border-zinc-800 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          <DocsSidebar allDocs={allDocs} />
        </aside>

        {/* Main content area — fills remaining space */}
        <main className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
