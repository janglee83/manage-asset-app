"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DOWNLOAD_CONFIG } from "@/lib/seo";
import { Menu, X, Github } from "lucide-react";

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-500/20 transition-shadow group-hover:shadow-violet-500/40">
            <div className="h-3.5 w-3.5 rounded-sm border-[1.5px] border-white/90 flex items-center justify-center">
              <div className="h-1.5 w-1.5 rounded-full bg-white/90" />
            </div>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
            AssetVault
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
          <Link href="/docs" className="hover:text-zinc-100 transition-colors">
            Docs
          </Link>
          <Link
            href="/#features"
            className="hover:text-zinc-100 transition-colors"
          >
            Features
          </Link>
          <Link
            href="/#download"
            className="hover:text-zinc-100 transition-colors"
          >
            Download
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="https://github.com/janglee83/manage-asset-app"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <Github className="h-4 w-4" />
          </a>

          <Link
            href="/#download"
            className="flex h-9 items-center rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-500 transition-colors shadow-lg shadow-violet-500/20"
          >
            Download v{DOWNLOAD_CONFIG.version}
          </Link>

          {/* Mobile toggle */}
          <button
            className="flex md:hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md px-6 py-4 flex flex-col gap-3 text-sm">
          <Link
            href="/docs"
            className="text-zinc-300 hover:text-white transition-colors py-1"
            onClick={() => setMobileOpen(false)}
          >
            Docs
          </Link>
          <Link
            href="/#features"
            className="text-zinc-300 hover:text-white transition-colors py-1"
            onClick={() => setMobileOpen(false)}
          >
            Features
          </Link>
          <Link
            href="/#download"
            className="text-zinc-300 hover:text-white transition-colors py-1"
            onClick={() => setMobileOpen(false)}
          >
            Download
          </Link>
        </div>
      )}
    </header>
  );
}
