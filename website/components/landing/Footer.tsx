import Link from "next/link";
import { Github, Twitter } from "lucide-react";
import { DOCS_NAV } from "@/lib/nav";
import { SITE_CONFIG } from "@/lib/seo";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-800/60 bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4 mb-12">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600">
                <div className="h-3 w-3 rounded-sm border-[1.5px] border-white/90 flex items-center justify-center">
                  <div className="h-1 w-1 rounded-full bg-white/90" />
                </div>
              </div>
              <span className="text-sm font-semibold text-zinc-100">
                AssetVault
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              Local-first AI search for your design library. Open source.
              Privacy-first.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/janglee83/manage-asset-app"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
              >
                <Github className="h-3.5 w-3.5" />
              </a>
              <a
                href={`https://twitter.com/${SITE_CONFIG.twitterHandle.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Twitter"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
              >
                <Twitter className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Docs nav — two sections */}
          {DOCS_NAV.slice(0, 2).map((section) => (
            <div key={section.title}>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
                {section.title}
              </p>
              <ul className="space-y-2.5">
                {section.items.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={`/docs/${item.slug}`}
                      className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Product links */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
              Product
            </p>
            <ul className="space-y-2.5">
              {[
                { label: "Download", href: "/#download" },
                { label: "Changelog", href: "https://github.com/janglee83/manage-asset-app/releases", external: true },
                { label: "Issues", href: "https://github.com/janglee83/manage-asset-app/issues", external: true },
                { label: "Documentation", href: "/docs" },
                { label: "Security", href: "/docs/security" },
              ].map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800/60 pt-8 text-xs text-zinc-600">
          <span>© {currentYear} AssetVault. MIT License.</span>
          <span>
            Built with Next.js, Tailwind CSS, Tauri, Rust, and Python.
          </span>
        </div>
      </div>
    </footer>
  );
}
