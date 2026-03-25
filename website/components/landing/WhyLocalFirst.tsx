import { ShieldCheck, Zap, Server, CreditCard } from "lucide-react";

const reasons = [
  {
    icon: ShieldCheck,
    title: "Your files never leave your machine",
    description:
      "CLIP vectors, thumbnails, tags, and search history are stored in a local SQLite database. Zero telemetry. Zero cloud upload. Confidential client work stays confidential.",
    stat: "0 bytes",
    statLabel: "sent to any server",
    color: "emerald",
  },
  {
    icon: Zap,
    title: "Sub-30 ms search on a warm query",
    description:
      "FAISS nearest-neighbour lookup is 3–5 ms. The full round-trip from keypress to rendered results takes ~25 ms on a 50 000-asset library with no network round-trips.",
    stat: "< 25 ms",
    statLabel: "search latency (warm)",
    color: "amber",
  },
  {
    icon: Server,
    title: "No external service dependency",
    description:
      "No API key to manage, no quota to exhaust, no rate limits, no vendor lock-in. Your search works on a plane, at a client site, or behind a strict corporate firewall.",
    stat: "100%",
    statLabel: "uptime (offline-capable)",
    color: "violet",
  },
  {
    icon: CreditCard,
    title: "No subscription required for core features",
    description:
      "Semantic search, image search, duplicate detection, and multilingual support are available on the free tier for up to 5 000 assets. No credit card to trial the product.",
    stat: "Free",
    statLabel: "up to 5 K assets",
    color: "sky",
  },
];

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
  return (
    <section className="relative overflow-hidden py-24 sm:py-32 border-t border-zinc-800/50">
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/3 h-[600px] w-[600px] rounded-full bg-violet-600/6 blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            Why Local-First
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            Privacy and speed by default
          </h2>
          <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
            Cloud-based design tools trade your data for convenience. AssetVault
            gives you both — without the tradeoff.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {reasons.map((reason) => {
            const Icon = reason.icon;
            const styles = colorMap[reason.color] ?? colorMap["violet"]!;
            return (
              <div
                key={reason.title}
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
                      {reason.title}
                    </h3>
                    <p className="text-sm text-zinc-400 leading-relaxed mb-4">
                      {reason.description}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-bold tracking-tight ${styles.stat}`}
                      >
                        {reason.stat}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {reason.statLabel}
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
              Capability
            </div>
            <div className="text-xs font-semibold text-violet-400 text-center uppercase tracking-widest">
              AssetVault
            </div>
            <div className="text-xs font-semibold text-zinc-500 text-center uppercase tracking-widest">
              Cloud-based tools
            </div>
          </div>
          {[
            ["Works offline", true, false],
            ["No data upload", true, false],
            ["No API key / quota", true, false],
            ["Sub-30 ms search", true, false],
            ["Free core tier", true, "varies"],
            ["100+ languages", true, "varies"],
          ].map(([cap, local, cloud]) => (
            <div
              key={String(cap)}
              className="grid grid-cols-3 border-t border-zinc-800 px-8 py-3.5 text-sm hover:bg-zinc-900/30 transition-colors"
            >
              <span className="text-zinc-400">{cap as string}</span>
              <span className="text-center">
                {local === true ? (
                  <span className="text-emerald-400 font-semibold">✓</span>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </span>
              <span className="text-center">
                {cloud === false ? (
                  <span className="text-zinc-600">✗</span>
                ) : (
                  <span className="text-zinc-500 text-xs">{cloud as string}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
