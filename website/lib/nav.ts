/**
 * nav.ts
 *
 * Single source of truth for the documentation navigation tree.
 * Update this file whenever a new doc page is added or renamed.
 *
 * The order of items here controls the sidebar and the prev/next links.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NavItem {
  /** Human-readable label. */
  title: string;
  /** Matches the MDX filename (without .mdx) and the URL slug. */
  slug: string;
  /** Optional short badge text, e.g. "New". */
  badge?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// ── Navigation tree ───────────────────────────────────────────────────────────

export const DOCS_NAV: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Overview",            slug: "overview" },
      { title: "Architecture",        slug: "architecture" },
      { title: "Installation",        slug: "installation" },
      { title: "Supported Platforms", slug: "supported-platforms" },
    ],
  },
  {
    title: "Core Features",
    items: [
      { title: "File Discovery",      slug: "file-discovery" },
      { title: "Indexing Engine",     slug: "indexing-engine" },
      { title: "Semantic Search",     slug: "semantic-search" },
      { title: "Image Search",        slug: "image-search" },
      { title: "Multilingual Search", slug: "multilingual-search" },
      { title: "Duplicate Detection", slug: "duplicate-detection" },
    ],
  },
  {
    title: "AI & Models",
    items: [
      { title: "AI Models",     slug: "ai-models" },
    ],
  },
  {
    title: "Advanced",
    items: [
      { title: "Security",     slug: "security" },
      { title: "Performance",  slug: "performance" },
      { title: "Limitations",  slug: "limitations" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "FAQ", slug: "faq" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Flat ordered list — drives prev/next navigation. */
export function flattenNav(): NavItem[] {
  return DOCS_NAV.flatMap((section) => section.items);
}

/** First doc slug — used for /docs redirect. */
export function firstDocSlug(): string {
  return DOCS_NAV[0]?.items[0]?.slug ?? "overview";
}

/** Prev / next links for a given slug. */
export function getPrevNext(slug: string): {
  prev: NavItem | null;
  next: NavItem | null;
} {
  const flat = flattenNav();
  const index = flat.findIndex((item) => item.slug === slug);
  return {
    prev: index > 0 ? (flat[index - 1] ?? null) : null,
    next: index < flat.length - 1 ? (flat[index + 1] ?? null) : null,
  };
}

/** Find which section contains a given slug. */
export function getSectionTitle(slug: string): string | null {
  for (const section of DOCS_NAV) {
    if (section.items.some((item) => item.slug === slug)) {
      return section.title;
    }
  }
  return null;
}
