/**
 * TOCClient
 *
 * Client island — highlights the active heading as the user scrolls using
 * IntersectionObserver.  The headings themselves are pre-rendered by DocsTOC.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

interface TOCClientProps {
  headings: Heading[];
}

export function TOCClient({ headings }: TOCClientProps) {
  const [activeId, setActiveId] = useState<string>("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const handleIntersect: IntersectionObserverCallback = (entries) => {
      // Use the topmost visible heading as the active one.
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
          break;
        }
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: "-80px 0% -70% 0%",
      threshold: 1.0,
    });

    const targets = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[];

    targets.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [headings]);

  return (
    <nav aria-label="Page sections">
      <ul className="flex flex-col gap-1 border-l border-zinc-800">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={clsx(
                "block py-1 text-xs transition-colors",
                heading.level === 2 ? "pl-3" : "pl-6",
                activeId === heading.id
                  ? "border-l-2 -ml-px border-violet-500 text-violet-300 font-medium"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(heading.id);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
                // Update the URL hash without a full page navigation.
                window.history.pushState(null, "", `#${heading.id}`);
                setActiveId(heading.id);
              }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
