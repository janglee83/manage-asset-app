"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DOWNLOAD_CONFIG } from "@/lib/seo";
import { useI18n, LOCALES } from "@/lib/i18n";
import { Menu, X, Github, Globe } from "lucide-react";

export function NavBar() {
  const { t, locale, setLocale } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-500/20 transition-shadow group-hover:shadow-violet-500/40">
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
            {t.nav.docs}
          </Link>
          <Link
            href="/#features"
            className="hover:text-zinc-100 transition-colors"
          >
            {t.nav.features}
          </Link>
          <Link
            href="/#download"
            className="hover:text-zinc-100 transition-colors"
          >
            {t.nav.download}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors text-xs"
              aria-label="Switch language"
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline font-medium uppercase tracking-wide">
                {locale}
              </span>
            </button>

            {langOpen && (
              <div className="absolute right-0 mt-1 w-36 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl z-50 overflow-hidden">
                {LOCALES.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => {
                      setLocale(l.value);
                      setLangOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                      locale === l.value
                        ? "bg-violet-600/20 text-violet-300"
                        : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    <span>{l.flag}</span>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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
            {t.nav.download} v{DOWNLOAD_CONFIG.version}
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
            {t.nav.docs}
          </Link>
          <Link
            href="/#features"
            className="text-zinc-300 hover:text-white transition-colors py-1"
            onClick={() => setMobileOpen(false)}
          >
            {t.nav.features}
          </Link>
          <Link
            href="/#download"
            className="text-zinc-300 hover:text-white transition-colors py-1"
            onClick={() => setMobileOpen(false)}
          >
            {t.nav.download}
          </Link>
          <div className="flex gap-2 pt-1 border-t border-zinc-800">
            {LOCALES.map((l) => (
              <button
                key={l.value}
                onClick={() => {
                  setLocale(l.value);
                  setMobileOpen(false);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  locale === l.value
                    ? "bg-violet-600/20 text-violet-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
