"use client";

import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { DOCS_NAV } from "@/lib/nav";
import { useI18n } from "@/lib/i18n";

export function DocsCTASection() {
  const { t } = useI18n();
  const featured = DOCS_NAV.flatMap((s) => s.items).slice(0, 6);

  return (
    <section className="border-t border-zinc-800/50 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-1.5 mb-6 ring-1 ring-violet-500/20">
              <BookOpen className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-medium text-violet-300">
                {t.docsCta.badge}
              </span>
            </div>
            <h2 className="text-4xl font-bold tracking-tight text-zinc-50 mb-4">
              {t.docsCta.title.split("\n").map((line, i, arr) => (
                <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
              ))}
            </h2>
            <p className="text-lg text-zinc-400 leading-relaxed mb-8">
              {t.docsCta.description}
            </p>
            <Link
              href="/docs"
              className="group inline-flex items-center gap-2 rounded-xl bg-zinc-800 border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:border-zinc-600 transition-colors"
            >
              {t.docsCta.cta}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Right: doc links grid */}
          <div className="grid grid-cols-2 gap-3">
            {featured.map((item) => (
              <Link
                key={item.slug}
                href={`/docs/${item.slug}`}
                className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 transition-all"
              >
                <span>{item.title}</span>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
