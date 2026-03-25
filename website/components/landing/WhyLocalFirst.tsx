"use client";

import { ShieldCheck, Zap, Server, CreditCard } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const icons = [ShieldCheck, Zap, Server, CreditCard];
const colors = ["emerald", "amber", "violet", "sky"] as const;

const colorMap: Record<string, { icon: string; stat: string; bg: string }> = {
  emerald: {
    icon: "text-emerald-400",
    stat: "text-emerald-300",
    bg: "bg-emerald-500/8",
  },
  amber: {
    icon: "text-amber-400",
    stat: "text-amber-300",
    bg: "bg-amber-500/8",
  },
  violet: {
    icon: "text-violet-400",
    stat: "text-violet-300",
    bg: "bg-violet-500/8",
  },
  sky: { icon: "text-sky-400", stat: "text-sky-300", bg: "bg-sky-500/8" },
};

export function WhyLocalFirst() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden py-24 sm:py-32 border-t border-zinc-800/50">
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/3 h-150 w-150 rounded-full bg-violet-600/6 blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            {t.whyLocal.sectionLabel}
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            {t.whyLocal.title}
          </h2>
          <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
            {t.whyLocal.description}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {t.whyLocal.items.map((item, i) => {
            const Icon = icons[i % icons.length]!;
            const color = colors[i % colors.length]!;
            const styles = colorMap[color] ?? colorMap["violet"]!;
            return (
              <div
                key={item.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 hover:bg-zinc-900/70 transition-colors"
              >
                <div className="flex items-start gap-5">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles.bg} ring-1 ring-inset ring-zinc-700`}
                  >
                    <Icon className={`h-5 w-5 ${styles.icon}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100 mb-2">
                      {item.title}
                    </h3>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                      {item.description}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-bold tracking-tight ${styles.stat}`}
                      >
                        {item.stat}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {item.statLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparison bar */}
        <div className="mt-10 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="grid grid-cols-3 px-8 py-4 bg-zinc-900/60">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              {t.whyLocal.compareCapability}
            </div>
            <div className="text-xs font-semibold text-violet-400 text-center uppercase tracking-widest">
              {t.whyLocal.compareAsset}
            </div>
            <div className="text-xs font-semibold text-zinc-500 text-center uppercase tracking-widest">
              {t.whyLocal.compareCloud}
            </div>
          </div>
          {t.whyLocal.rows.map((cap, i) => {
              const cloudVaries = i >= 4;
            return (
              <div
                key={cap}
                className="grid grid-cols-3 border-t border-zinc-800 px-8 py-3.5 text-sm hover:bg-zinc-900/30 transition-colors"
              >
                <span className="text-zinc-400">{cap}</span>
                <span className="text-center">
                  <span className="text-emerald-400 font-semibold">✓</span>
                </span>
                <span className="text-center">
                  {cloudVaries ? (
                    <span className="text-zinc-500 text-xs">varies</span>
                  ) : (
                    <span className="text-zinc-600">✗</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
