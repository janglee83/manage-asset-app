import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NavItem } from "@/lib/nav";

interface PrevNextNavProps {
  prev: NavItem | null;
  next: NavItem | null;
}

export function PrevNextNav({ prev, next }: PrevNextNavProps) {
  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Page navigation"
      className="mt-12 flex items-center justify-between border-t border-zinc-800 pt-6 text-sm"
    >
      {prev ? (
        <Link
          href={`/docs/${prev.slug}`}
          className="group flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span className="flex flex-col items-start">
            <span className="text-xs text-zinc-600">Previous</span>
            <span>{prev.title}</span>
          </span>
        </Link>
      ) : (
        <div />
      )}

      {next ? (
        <Link
          href={`/docs/${next.slug}`}
          className="group flex items-center gap-2 text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <span className="flex flex-col items-end">
            <span className="text-xs text-zinc-600">Next</span>
            <span>{next.title}</span>
          </span>
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
