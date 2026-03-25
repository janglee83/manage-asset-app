/**
 * DocsSidebar
 *
 * Server component — renders the full nav tree from DOCS_NAV.
 * Active state is highlighted via a Client Component island (ActiveLink)
 * so the server-rendered HTML doesn't need to know the current URL.
 */

import { DOCS_NAV } from "@/lib/nav";
import type { DocMeta } from "@/lib/docs";
import { SidebarActiveLink } from "./SidebarActiveLink";

interface DocsSidebarProps {
  allDocs: DocMeta[];
}

export function DocsSidebar({ allDocs }: DocsSidebarProps) {
  // Build a quick lookup for reading-time and badge data.
  const metaBySlug = new Map(allDocs.map((d) => [d.slug, d]));

  return (
    <nav
      aria-label="Documentation navigation"
      className="flex flex-col gap-6 py-6 px-4"
    >
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const meta = metaBySlug.get(item.slug);
              return (
                <li key={item.slug}>
                  <SidebarActiveLink
                    href={`/docs/${item.slug}`}
                    title={item.title}
                    badge={item.badge}
                    readingTime={meta?.readingTime}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
