import Link from "next/link";
import { ArrowRight, Github, Cpu } from "lucide-react";
import { DOWNLOAD_CONFIG } from "@/lib/seo";

export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
      {/* Grid background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(124,58,237,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(124,58,237,0.05)_1px,transparent_1px)] [background-size:44px_44px]"
      />

      {/* Large violet glow — top center */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/4 h-[600px] w-[900px] rounded-full bg-violet-600/10 blur-3xl"
      />
      {/* Secondary glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-48 top-1/4 h-[400px] w-[500px] rounded-full bg-indigo-600/8 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6">
        {/* Badge */}
        <div className="flex justify-center mb-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/8 px-4 py-1.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/10">
            <Cpu className="h-3 w-3" />
            v{DOWNLOAD_CONFIG.version} — Now with GPU-accelerated embeddings
          </span>
        </div>

        {/* Headline */}
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-zinc-50 leading-[1.07]">
            Find any design asset{" "}
            <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
              in plain language
            </span>
          </h1>

          <p className="mt-6 text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            AssetVault indexes your entire design library with CLIP AI and makes
            it searchable by meaning — across 100&nbsp;+ languages, from a
            reference image, or by description. Everything runs{" "}
            <em className="text-zinc-300 not-italic font-medium">
              locally on your machine
            </em>
            .
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/#download"
              className="group inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-xl shadow-violet-500/25"
            >
              Download Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
            >
              Read the docs
            </Link>
            <a
              href="https://github.com/janglee83/manage-asset-app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Github className="h-4 w-4" />
              Open source
            </a>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 border-t border-zinc-800/60 pt-10">
          {[
            { value: "100+", label: "languages supported" },
            { value: "< 25 ms", label: "search latency (warm)" },
            { value: "200K+", label: "assets tested" },
            { value: "0 bytes", label: "sent to the cloud" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold tracking-tight text-zinc-100">
                {stat.value}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
