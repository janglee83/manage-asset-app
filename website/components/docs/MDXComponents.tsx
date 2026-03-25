/**
 * MDXComponents
 *
 * Global component map passed to every <MDXRemote>.
 * Remaps HTML elements and adds custom MDX components.
 * Import and pass as `components` prop — never import React here.
 */

import type { MDXComponents as MDXComponentsType } from "mdx/types";
import Link from "next/link";
import { Callout } from "./Callout";
import { TechDiagram } from "./TechDiagram";

// ── Heading factory — adds a visible anchor link ──────────────────────────────

function makeHeading(Tag: "h2" | "h3" | "h4") {
  return function Heading({
    id,
    children,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
      <Tag id={id} {...props}>
        {children}
        {id && (
          <a
            href={`#${id}`}
            aria-label="Permalink"
            className="ml-2 inline-block text-zinc-600 opacity-0 transition-opacity hover:text-zinc-400 group-hover:opacity-100 focus:opacity-100 text-sm"
            tabIndex={-1}
          >
            #
          </a>
        )}
      </Tag>
    );
  };
}

// ── Code block — rendered by rehype-pretty-code, styled here ─────────────────

function Pre({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  return (
    <div className="group relative my-4">
      <pre
        {...props}
        className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

// ── Inline link — use Next/Link for internal, <a> for external ───────────────

function Anchor({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <a {...props}>{children}</a>;
  const isExternal = href.startsWith("http") || href.startsWith("//");
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

// ── Table — horizontal scroll wrapper for narrow viewports ───────────────────

function Table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-zinc-800">
      <table {...props} className="min-w-full text-sm">
        {children}
      </table>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export const mdxComponents: MDXComponentsType = {
  // Remap standard HTML elements
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
  pre: Pre,
  a: Anchor,
  table: Table,

  // Custom MDX components (used directly in .mdx files)
  Callout,
  TechDiagram,
};
