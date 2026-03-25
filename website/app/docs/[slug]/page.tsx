/**
 * /docs/[slug] — individual documentation page.
 *
 * All pages are statically generated at build time from MDX files in
 * /content/docs/*.mdx.  Unknown slugs produce a 404.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import { getAllDocSlugs, getDocBySlug } from "@/lib/docs";
import { getPrevNext } from "@/lib/nav";
import {
  buildDocPageMetadata,
  buildTechArticleJsonLd,
  buildDocBreadcrumbJsonLd,
} from "@/lib/seo";
import { mdxComponents } from "@/components/docs/MDXComponents";
import { DocsTOC } from "@/components/docs/DocsTOC";
import { PrevNextNav } from "@/components/docs/PrevNextNav";
import { Clock, Calendar } from "lucide-react";

// ── Static generation ─────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const slugs = await getAllDocSlugs();
  return slugs.map((slug) => ({ slug }));
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);
  if (!doc) return {};

  return buildDocPageMetadata({
    slug,
    title: doc.title,
    description: doc.description,
    updatedAt: doc.updatedAt,
  });
}

// ── MDX processing options ────────────────────────────────────────────────────

const rehypePrettyCodeOptions: Parameters<typeof rehypePrettyCode>[0] = {
  // Use a dark theme that matches the site's zinc-950 background.
  theme: "github-dark-dimmed",
  keepBackground: true,
  defaultLang: "plaintext",
};

const rehypeAutolinkOptions: Parameters<typeof rehypeAutolinkHeadings>[0] = {
  behavior: "wrap",
  properties: {
    className: ["anchor-link"],
    ariaLabel: "Link to section",
  },
};

// ── Page component ────────────────────────────────────────────────────────────

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) notFound();

  const { prev, next } = getPrevNext(slug);

  const techArticleJsonLd = buildTechArticleJsonLd({
    slug,
    title: doc.title,
    description: doc.description,
    updatedAt: doc.updatedAt,
  });
  const breadcrumbJsonLd = buildDocBreadcrumbJsonLd(slug, doc.title);

  return (
    <>
      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(techArticleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

    <div className="flex gap-8 px-6 py-10 lg:px-10">
      {/* Main content column */}
      <article className="min-w-0 flex-1 max-w-3xl">
        {/* Page header */}
        <header className="mb-8 border-b border-zinc-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-50 mb-3">
            {doc.title}
          </h1>
          {doc.description && (
            <p className="text-lg text-zinc-400 leading-relaxed">
              {doc.description}
            </p>
          )}
          <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {doc.readingTime}
            </span>
            {doc.updatedAt && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Updated {new Date(doc.updatedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </header>

        {/* MDX content */}
        <div className="prose prose-invert prose-zinc max-w-none
          prose-headings:scroll-mt-20
          prose-h2:text-xl prose-h2:font-semibold prose-h2:text-zinc-100
          prose-h3:text-base prose-h3:font-semibold prose-h3:text-zinc-200
          prose-p:text-zinc-300 prose-p:leading-7
          prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-zinc-100
          prose-code:text-violet-300 prose-code:bg-zinc-800 prose-code:px-1
          prose-code:py-0.5 prose-code:rounded prose-code:text-sm
          prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700
          prose-pre:rounded-lg prose-pre:p-0
          prose-table:text-sm prose-thead:border-zinc-700
          prose-th:text-zinc-300 prose-td:text-zinc-400
          prose-blockquote:border-violet-500 prose-blockquote:text-zinc-400
          prose-hr:border-zinc-800
          prose-li:text-zinc-300">
          <MDXRemote
            source={doc.content}
            components={mdxComponents}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [
                  rehypeSlug,
                  [rehypeAutolinkHeadings, rehypeAutolinkOptions],
                  [rehypePrettyCode, rehypePrettyCodeOptions],
                ],
              },
            }}
          />
        </div>

        {/* Prev / next */}
        <PrevNextNav prev={prev} next={next} />
      </article>

      {/* Right-side TOC — hidden on small screens */}
      <aside className="hidden xl:block w-56 shrink-0">
        <div className="sticky top-24">
          <DocsTOC source={doc.content} />
        </div>
      </aside>
    </div>
    </>
  );
}
