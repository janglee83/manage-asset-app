"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  return (
    <section className="border-t border-zinc-800/50 py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center mb-14">
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-400 mb-3">
            {t.faq.sectionLabel}
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-zinc-50">
            {t.faq.title}
          </h2>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-8">
          {t.faq.items.map((item) => (
            <FAQItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}


