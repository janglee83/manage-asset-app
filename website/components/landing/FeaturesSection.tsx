"use client";

import {
  Search,
  Languages,
  Images,
  Copy,
  Lock,
  WifiOff,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

const featureDefs = [
  { key: "semantic" as const, icon: Search, accent: "violet" },
  { key: "multilingual" as const, icon: Languages, accent: "indigo" },
  { key: "image" as const, icon: Images, accent: "purple" },
  { key: "duplicate" as const, icon: Copy, accent: "fuchsia" },
  { key: "privacy" as const, icon: Lock, accent: "emerald" },
  { key: "offline" as const, icon: WifiOff, accent: "sky" },
];

const accentStyles: Record<string, { icon: string; ring: string; bg: string }> = {
  violet: {
    icon: "text-violet-400",
    ring: "ring-violet-500/20",
    bg: "bg-violet-500/8",
  },
  indigo: {
    icon: "text-indigo-400",
    ring: "ring-indigo-500/20",
    bg: "bg-indigo-500/8",
  },
  purple: {
    icon: "text-purple-400",
    ring: "ring-purple-500/20",
    bg: "bg-purple-500/8",
  },
  fuchsia: {
    icon: "text-fuchsia-400",
    ring: "ring-fuchsia-500/20",
    bg: "bg-fuchsia-500/8",
  },
  emerald: {
    icon: "text-emerald-400",
    ring: "ring-emerald-500/20",
    bg: "bg-emerald-500/8",
  },
  sky: {
    icon: "text-sky-400",
    ring: "ring-sky-500/20",
    bg: "bg-sky-500/8",
  },
};

export function FeaturesSection() {
  const { t } = useI18n();
  return (
    <section id="features" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            {t.features.sectionLabel}
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            {t.features.sectionTitle}
          </h2>
          <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
            {t.features.sectionDescription}
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featureDefs.map((fd) => {
            const styles = accentStyles[fd.accent] ?? accentStyles["violet"]!;
            const Icon = fd.icon;
            const item = t.features.items[fd.key];
            return (
              <div
                key={fd.key}
                className="group relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 hover:border-zinc-700 hover:bg-zinc-900 transition-all duration-200"
              >
                {/* Hover glow */}
                <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity [background:radial-gradient(400px_at_top_left,rgba(124,58,237,0.06),transparent)]" />

                <div
                  className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${styles.ring} ${styles.bg}`}
                >
                  <Icon className={`h-5 w-5 ${styles.icon}`} />
                </div>

                <h3 className="text-base font-semibold text-zinc-100 mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
