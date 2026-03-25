/**
 * DocsTOC — Table of Contents
 *
 * Extracts h2 and h3 headings from raw MDX source at the server level,
 * then renders a client island that highlights the active heading using
 * IntersectionObserver.  The heading list itself is static HTML.
 */

import { TOCClient } from "./TOCClient";

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Extract headings from raw MDX source.
 * Deliberately simple: regex is safe here because MDX headings are line-based
 * and we only target h2/h3, not h1 (which is the page title).
 */
function extractHeadings(source: string): Heading[] {
  const lines = source.split("\n");
  const headings: Heading[] = [];

  for (const line of lines) {
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);

    const raw = h2?.[1] ?? h3?.[1];
    if (!raw) continue;

    const level = h2 ? 2 : 3;
    // Generate the slug the same way rehype-slug does.
    const id = raw
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();

    headings.push({ id, text: raw.replace(/`/g, ""), level });
  }

  return headings;
}

interface DocsTOCProps {
  source: string;
}

export function DocsTOC({ source }: DocsTOCProps) {
  const headings = extractHeadings(source);

  if (headings.length < 2) return null;

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        On this page
      </p>
      <TOCClient headings={headings} />
    </div>
  );
}
