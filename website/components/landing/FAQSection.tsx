"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Does AssetVault send my images to a cloud AI service?",
    a: "No. CLIP, EasyOCR, and all AI models run locally inside the Python sidecar process. No image, vector, or metadata is transmitted to any external server. The only outbound request is an optional version check that sends only the app version number.",
  },
  {
    q: "How long does indexing take for a large library?",
    a: "Initial scanning is fast — around 70 seconds for 50 000 files on an M1 Pro. Embedding (generating CLIP vectors) takes longer: about 7 minutes on CPU, 2.5 minutes with Metal GPU (Apple Silicon), or 70 seconds with CUDA. Embedding runs in the background; you can search already-indexed assets while it runs.",
  },
  {
    q: "What happens if the sidecar crashes?",
    a: "AssetVault detects a dead sidecar via a heartbeat mechanism and emits a toast notification. You can restart the sidecar from Settings → Intelligence without restarting the main app. All SQLite metadata is preserved; only in-flight embedding jobs are lost.",
  },
  {
    q: "Can I use AssetVault with Figma or Sketch files?",
    a: "Yes. Figma exported files, Sketch files, SVGs, PSDs, and AIs are first-class file types. The scanner assigns them higher priority so they appear first in results. Note that .fig files require an export step — AssetVault reads the exported file, not the live Figma cloud document.",
  },
  {
    q: "Is there a command-line interface?",
    a: "Not yet, but it's on the roadmap. The Rust codebase is structured so that a CLI wrapper sharing the same library could be added without changing the core logic. If this is important to you, open a GitHub issue.",
  },
  {
    q: "How do I update to a new version?",
    a: "AssetVault checks for updates at launch (opt-in). When an update is available, you'll see a banner in Settings → About. Download the new installer from the release page and run it over the existing installation — your data directory and index are preserved.",
  },
  {
    q: "What is the maximum library size?",
    a: "There is no hard maximum. Libraries up to 200 000 assets have been tested. Above 1 million assets, the flat FAISS index will use significant RAM (~2 GB). A sharded IVF index for very large libraries is planned for a future release.",
  },
  {
    q: "Can I search by color palette?",
    a: "Yes. Add 'color:red' or 'palette:blue tones' to your query and the palette_search module will extract dominant colors and filter by hue similarity. You can also use the Color filter in the sidebar to browse by palette.",
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium text-zinc-200 hover:text-zinc-100 transition-colors"
      >
        <span>{q}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm text-zinc-400 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

export function FAQSection() {
  return (
    <section className="border-t border-zinc-800/50 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center mb-14">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            FAQ
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            Common questions
          </h2>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-8">
          {faqs.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

export { faqs };
