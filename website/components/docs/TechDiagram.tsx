/**
 * TechDiagram
 *
 * Reusable SVG-based architecture flow diagram.
 *
 * Usage in MDX:
 *   <TechDiagram />                            — default React→Tauri→…→FAISS
 *   <TechDiagram steps={customSteps} />        — custom linear flow
 */

interface Step {
  label: string;
  sublabel?: string;
  color: "violet" | "blue" | "emerald" | "orange" | "zinc";
}

interface TechDiagramProps {
  steps?: Step[];
  title?: string;
}

const DEFAULT_STEPS: Step[] = [
  { label: "React",   sublabel: "UI / TypeScript",    color: "blue" },
  { label: "Tauri",   sublabel: "IPC bridge",         color: "orange" },
  { label: "Rust",    sublabel: "Commands / SQLite",   color: "orange" },
  { label: "Python",  sublabel: "Sidecar / JSON-RPC",  color: "emerald" },
  { label: "CLIP",    sublabel: "Embeddings",          color: "violet" },
  { label: "FAISS",   sublabel: "Vector index",        color: "violet" },
];

const COLOR_MAP: Record<Step["color"], { bg: string; border: string; text: string }> = {
  violet:  { bg: "bg-violet-950/60", border: "border-violet-700/60", text: "text-violet-300" },
  blue:    { bg: "bg-blue-950/60",   border: "border-blue-700/60",   text: "text-blue-300" },
  emerald: { bg: "bg-emerald-950/60",border: "border-emerald-700/60",text: "text-emerald-300" },
  orange:  { bg: "bg-orange-950/60", border: "border-orange-700/60", text: "text-orange-300" },
  zinc:    { bg: "bg-zinc-800/60",   border: "border-zinc-600/60",   text: "text-zinc-300" },
};

export function TechDiagram({ steps = DEFAULT_STEPS, title }: TechDiagramProps) {
  return (
    <figure className="my-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
      {title && (
        <figcaption className="mb-5 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
          {title}
        </figcaption>
      )}

      {/* Horizontal flow — wraps to multiple rows on small screens */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {steps.map((step, i) => {
          const c = COLOR_MAP[step.color];
          return (
            <div key={step.label} className="flex items-center gap-2">
              <div
                className={`flex flex-col items-center rounded-lg border px-4 py-3 ${c.bg} ${c.border}`}
              >
                <span className={`text-sm font-semibold ${c.text}`}>
                  {step.label}
                </span>
                {step.sublabel && (
                  <span className="mt-0.5 text-[11px] text-zinc-500">
                    {step.sublabel}
                  </span>
                )}
              </div>

              {/* Arrow between steps */}
              {i < steps.length - 1 && (
                <svg
                  aria-hidden
                  className="h-4 w-6 shrink-0 text-zinc-600"
                  viewBox="0 0 24 12"
                  fill="none"
                >
                  <path
                    d="M0 6h20M15 1l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}
