import {
  Search,
  Languages,
  Images,
  Copy,
  Lock,
  WifiOff,
} from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Semantic Search",
    description:
      "Describe what you're looking for in plain English. CLIP understands meaning, not just keywords — find that 'dark dashboard with charts' without tags.",
    accent: "violet",
  },
  {
    icon: Languages,
    title: "Multilingual",
    description:
      "Search in Japanese, Arabic, Spanish, or any of 100+ languages. CLIP's shared embedding space maps your query to the right visual results regardless of language.",
    accent: "indigo",
  },
  {
    icon: Images,
    title: "Image Search",
    description:
      "Drag any reference image onto the search bar. AssetVault finds visually similar assets instantly. Combine with text to cross-modal search — 'like this but darker'.",
    accent: "purple",
  },
  {
    icon: Copy,
    title: "Duplicate Detection",
    description:
      "Three-level detection: exact (SHA-256), perceptual (pHash hamming ≤&nbsp;10), and semantic (CLIP cosine similarity). Review and bulk-resolve with a single click.",
    accent: "fuchsia",
  },
  {
    icon: Lock,
    title: "Total Privacy",
    description:
      "Every vector, thumbnail, and tag lives in a local SQLite database. Zero telemetry. Zero cloud API calls. The only outbound request is an optional version check.",
    accent: "emerald",
  },
  {
    icon: WifiOff,
    title: "Offline-First",
    description:
      "After the one-time model download, AssetVault works with no internet connection. Your library is always accessible, on a plane or behind a corporate firewall.",
    accent: "sky",
  },
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
  return (
    <section id="features" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            Capabilities
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            Everything your design search should be
          </h2>
          <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
            Six deeply integrated features powered by CLIP, FAISS, and EasyOCR —
            all running locally in under 25&nbsp;ms.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const styles = accentStyles[feature.accent] ?? accentStyles["violet"]!;
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
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
                  {feature.title}
                </h3>
                <p
                  className="text-sm text-zinc-400 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: feature.description }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
