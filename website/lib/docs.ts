/**
 * docs.ts
 *
 * Core docs engine.  All file I/O is async and isolated here so that page
 * components remain pure renderers that don't touch the filesystem directly.
 *
 * Content lives in /content/docs/*.mdx.
 * Each file must declare a YAML frontmatter block with at minimum `title`.
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocFrontmatter {
  /** Displayed in <title>, sidebar, and h1. */
  title: string;
  /** Used for <meta name="description"> and doc cards. */
  description: string;
  /** Controls sort order in the sidebar within its section. */
  order?: number;
  /** ISO 8601 date of last meaningful content update. */
  updatedAt?: string;
}

export interface DocMeta extends DocFrontmatter {
  /** URL slug, e.g. "semantic-search". */
  slug: string;
  /** Estimated reading time string, e.g. "4 min read". */
  readingTime: string;
}

export interface Doc extends DocMeta {
  /** Raw MDX source — passed to next-mdx-remote for compilation. */
  content: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOCS_DIR = path.join(process.cwd(), "content", "docs");

/** Returns the locale-specific docs directory, falling back to the default. */
function docsDir(locale: string): string {
  if (locale === "en" || !locale) return DOCS_DIR;
  return path.join(DOCS_DIR, locale);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Coerce frontmatter data to a safe DocFrontmatter shape. */
function parseFrontmatter(
  data: Record<string, unknown>,
  slug: string,
): DocFrontmatter {
  return {
    title: typeof data["title"] === "string" ? data["title"] : slug,
    description:
      typeof data["description"] === "string" ? data["description"] : "",
    order: typeof data["order"] === "number" ? data["order"] : 999,
    updatedAt:
      typeof data["updatedAt"] === "string" ? data["updatedAt"] : undefined,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return metadata for every document, sorted by order then title.
 * Safe to call from Server Components and `generateStaticParams`.
 */
export async function getAllDocs(): Promise<DocMeta[]> {
  let files: string[];
  try {
    files = await fs.readdir(DOCS_DIR);
  } catch {
    return [];
  }

  const metas = await Promise.all(
    files
      .filter((f) => f.endsWith(".mdx"))
      .map(async (file): Promise<DocMeta> => {
        const slug = file.replace(/\.mdx$/, "");
        const raw = await fs.readFile(path.join(DOCS_DIR, file), "utf8");
        const { data, content } = matter(raw);
        const fm = parseFrontmatter(data as Record<string, unknown>, slug);
        return {
          ...fm,
          slug,
          readingTime: readingTime(content).text,
        };
      }),
  );

  return metas.sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    return orderDiff !== 0 ? orderDiff : a.title.localeCompare(b.title);
  });
}

/**
 * Return all doc slugs — used by `generateStaticParams`.
 */
export async function getAllDocSlugs(): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(DOCS_DIR);
  } catch {
    return [];
  }
  return files.filter((f) => f.endsWith(".mdx")).map((f) => f.replace(/\.mdx$/, ""));
}

/**
 * Return the full Doc (including raw MDX source) for a given slug.
 * Tries the locale-specific file first, falls back to English.
 * Returns `null` when neither file exists — callers should `notFound()`.
 */
export async function getDocBySlug(
  slug: string,
  locale: string = "en",
): Promise<Doc | null> {
  // Normalise the slug: strip leading/trailing slashes, reject path traversal.
  const safe = slug.replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
  if (!safe || safe.includes("/")) return null;

  // Build candidate paths: locale-specific first, then English fallback.
  const candidates: string[] = [];
  if (locale && locale !== "en") {
    const localeDir = docsDir(locale);
    const localePath = path.join(localeDir, `${safe}.mdx`);
    // Security: resolved path must stay within content/docs/
    const resolvedLocale = path.resolve(localePath);
    if (resolvedLocale.startsWith(path.resolve(DOCS_DIR))) {
      candidates.push(localePath);
    }
  }
  candidates.push(path.join(DOCS_DIR, `${safe}.mdx`));

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const { data, content } = matter(raw);
      const fm = parseFrontmatter(data as Record<string, unknown>, safe);
      return {
        ...fm,
        slug: safe,
        readingTime: readingTime(content).text,
        content,
      };
    } catch {
      // File not found — try next candidate.
    }
  }

  return null;
}
