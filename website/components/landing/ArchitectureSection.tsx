"use client";

import { useI18n } from "@/lib/i18n";

const steps = [
  {
    label: "React",
    sublabel: "UI + Zustand",
    color: "from-sky-500 to-cyan-500",
    glow: "shadow-sky-500/20",
    ring: "ring-sky-500/30",
    dot: "bg-sky-400",
  },
  {
    label: "Tauri",
    sublabel: "IPC bridge",
    color: "from-amber-500 to-orange-500",
    glow: "shadow-amber-500/20",
    ring: "ring-amber-500/30",
    dot: "bg-amber-400",
  },
  {
    label: "Rust",
    sublabel: "SQLite + I/O",
    color: "from-orange-500 to-red-500",
    glow: "shadow-orange-500/20",
    ring: "ring-orange-500/30",
    dot: "bg-orange-400",
  },
  {
    label: "Python",
    sublabel: "Sidecar (JSON-RPC)",
    color: "from-emerald-500 to-green-500",
    glow: "shadow-emerald-500/20",
    ring: "ring-emerald-500/30",
    dot: "bg-emerald-400",
  },
  {
    label: "CLIP",
    sublabel: "ViT-B/32 (ONNX)",
    color: "from-violet-500 to-purple-500",
    glow: "shadow-violet-500/20",
    ring: "ring-violet-500/30",
    dot: "bg-violet-400",
  },
  {
    label: "FAISS",
    sublabel: "Vector index",
    color: "from-indigo-500 to-violet-500",
    glow: "shadow-indigo-500/20",
    ring: "ring-indigo-500/30",
    dot: "bg-indigo-400",
  },
];

export function ArchitectureSection() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      {/* Background noise */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(124,58,237,0.04)_1px,transparent_1px)] bg-size-[20px_20px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-125 w-150 -translate-x-1/3 rounded-full bg-violet-600/6 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          {/* Left: text */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
              {t.architecture.sectionLabel}
            </p>
            <h2 className="text-4xl font-bold tracking-tight text-zinc-50 mb-6">
              {t.architecture.title}
            </h2>
            <p className="text-lg text-zinc-400 leading-relaxed mb-8">
              {t.architecture.description}
            </p>
            <ul className="space-y-3 text-sm text-zinc-400">
              {t.architecture.points.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <span className="mt-0.5 h-5 w-5 flex shrink-0 items-center justify-center rounded-full bg-violet-500/10 ring-1 ring-violet-500/25">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: flow diagram */}
          <div className="flex items-center justify-center">
            <div className="relative w-full max-w-sm">
              <div className="flex flex-col items-center gap-0">
                {steps.map((step, i) => (
                  <div key={step.label} className="flex flex-col items-center">
                    {/* Node */}
                    <div
                      className={`relative flex w-72 items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/70 px-5 py-3.5 shadow-lg ring-1 ${step.ring} backdrop-blur-sm`}
                    >
                      {/* Gradient indicator */}
                      <div
                        className={`h-8 w-8 shrink-0 rounded-lg bg-linear-to-br ${step.color} flex items-center justify-center shadow-md ${step.glow}`}
                      >
                        <span className="text-xs font-bold text-white/90">
                          {i + 1}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">
                          {step.label}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {step.sublabel}
                        </div>
                      </div>
                      {/* Running dot */}
                      <div
                        className={`ml-auto h-2 w-2 rounded-full ${step.dot} shadow-sm opacity-70`}
                      />
                    </div>

                    {/* Connector arrow */}
                    {i < steps.length - 1 && (
                      <div className="flex flex-col items-center my-0.5">
                        <div className="h-4 w-px bg-zinc-700" />
                        <svg
                          className="text-zinc-600"
                          width="10"
                          height="6"
                          viewBox="0 0 10 6"
                          fill="none"
                        >
                          <path
                            d="M1 1L5 5L9 1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
