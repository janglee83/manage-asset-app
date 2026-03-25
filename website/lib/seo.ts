/**
 * seo.ts
 *
 * Single source of truth for all SEO configuration.
 * Provides:
 *  - SITE_CONFIG: canonical site constants
 *  - DOWNLOAD_CONFIG: typed download links per platform
 *  - JSON-LD schema builders for schema.org structured data
 *  - Metadata builder helpers consumed by page components
 */

import type { Metadata } from "next";

// ── Site constants ────────────────────────────────────────────────────────────

export const SITE_CONFIG = {
  siteUrl: "https://assetvault.app",
  siteName: "AssetVault",
  title: "AssetVault — Local AI Search for Design Assets",
  titleTemplate: "%s — AssetVault",
  description:
    "The fastest way to find any asset in your design library. Semantic search, image similarity, and duplicate detection — all running locally on your machine. No cloud, no subscriptions.",
  twitterHandle: "@assetvault",
  locale: "en_US",
  /** Primary SEO keyword targets from the product brief. */
  keywords: [
    "design asset search",
    "local semantic search",
    "offline design search",
    "desktop AI search",
    "image similarity search local",
    "multilingual asset finder",
    "figma asset manager",
    "design library management",
    "CLIP local search",
    "FAISS desktop",
    "local-first AI",
    "privacy-first design tool",
  ],
  /** Default OG image — must be committed to /public/ */
  ogImage: "/og-default.png",
} as const;

// ── Download config ───────────────────────────────────────────────────────────

export interface DownloadAsset {
  label: string;
  url: string;
  size: string;
  format: string;
}

export const DOWNLOAD_CONFIG = {
  version: "0.9.0",
  releaseDate: "2026-03-25",
  downloads: {
    "macos-arm64": {
      label: "macOS Apple Silicon",
      url: "https://github.com/janglee83/manage-asset-app/releases/download/v0.9.0/AssetVault_0.9.0_aarch64.dmg",
      size: "42 MB",
      format: ".dmg",
    },
    "macos-x64": {
      label: "macOS Intel",
      url: "https://github.com/janglee83/manage-asset-app/releases/download/v0.9.0/AssetVault_0.9.0_x64.dmg",
      size: "44 MB",
      format: ".dmg",
    },
    "windows-x64": {
      label: "Windows x64",
      url: "https://github.com/janglee83/manage-asset-app/releases/download/v0.9.0/AssetVault_0.9.0_x64.msi",
      size: "38 MB",
      format: ".msi",
    },
    "linux-appimage": {
      label: "Linux AppImage",
      url: "https://github.com/janglee83/manage-asset-app/releases/download/v0.9.0/AssetVault_0.9.0_amd64.AppImage",
      size: "55 MB",
      format: ".AppImage",
    },
    "linux-deb": {
      label: "Linux .deb",
      url: "https://github.com/janglee83/manage-asset-app/releases/download/v0.9.0/AssetVault_0.9.0_amd64.deb",
      size: "48 MB",
      format: ".deb",
    },
  },
} as const;

// ── JSON-LD builders ──────────────────────────────────────────────────────────

/** SoftwareApplication schema — placed in root layout. */
export function buildSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AssetVault",
    applicationCategory: "DesignApplication",
    applicationSubCategory: "Asset Management",
    operatingSystem: "Windows 10+, macOS 12+, Ubuntu 22.04+",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description: SITE_CONFIG.description,
    url: SITE_CONFIG.siteUrl,
    downloadUrl: `${SITE_CONFIG.siteUrl}/download`,
    screenshot: `${SITE_CONFIG.siteUrl}/og-default.png`,
    softwareVersion: DOWNLOAD_CONFIG.version,
    datePublished: DOWNLOAD_CONFIG.releaseDate,
    author: {
      "@type": "Organization",
      name: "AssetVault",
      url: SITE_CONFIG.siteUrl,
    },
    featureList: [
      "Semantic search powered by CLIP",
      "Reverse image search",
      "Multilingual search in 100+ languages",
      "Duplicate detection (exact, perceptual, semantic)",
      "Fully offline — no cloud required",
      "FAISS vector index",
      "Auto-tagging with zero-shot AI",
      "OCR text extraction",
    ],
    keywords: SITE_CONFIG.keywords.join(", "),
  };
}

/** WebSite schema with SearchAction — placed in root layout. */
export function buildWebSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_CONFIG.siteName,
    url: SITE_CONFIG.siteUrl,
    description: SITE_CONFIG.description,
    inLanguage: "en-US",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_CONFIG.siteUrl}/docs?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
    publisher: {
      "@type": "Organization",
      name: SITE_CONFIG.siteName,
      url: SITE_CONFIG.siteUrl,
    },
  };
}

/** BreadcrumbList schema for a documentation page. */
export function buildDocBreadcrumbJsonLd(
  slug: string,
  title: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_CONFIG.siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Documentation",
        item: `${SITE_CONFIG.siteUrl}/docs`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: title,
        item: `${SITE_CONFIG.siteUrl}/docs/${slug}`,
      },
    ],
  };
}

/** TechArticle schema for a documentation page. */
export function buildTechArticleJsonLd({
  slug,
  title,
  description,
  updatedAt,
}: {
  slug: string;
  title: string;
  description: string;
  updatedAt?: string;
}): Record<string, unknown> {
  const pageUrl = `${SITE_CONFIG.siteUrl}/docs/${slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `${title} — AssetVault Documentation`,
    description,
    url: pageUrl,
    inLanguage: "en-US",
    dateModified: updatedAt ?? DOWNLOAD_CONFIG.releaseDate,
    author: {
      "@type": "Organization",
      name: SITE_CONFIG.siteName,
      url: SITE_CONFIG.siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_CONFIG.siteName,
      url: SITE_CONFIG.siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_CONFIG.siteUrl}/icon-192.png`,
      },
    },
    isPartOf: {
      "@type": "WebSite",
      name: `${SITE_CONFIG.siteName} Documentation`,
      url: `${SITE_CONFIG.siteUrl}/docs`,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl,
    },
  };
}

/** FAQPage schema — accepts an array of Q&A items. */
export function buildFaqJsonLd(
  items: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  };
}

// ── Metadata builders ─────────────────────────────────────────────────────────

/** Full Metadata object for a docs page. */
export function buildDocPageMetadata({
  slug,
  title,
  description,
  updatedAt,
}: {
  slug: string;
  title: string;
  description: string;
  updatedAt?: string;
}): Metadata {
  const canonicalUrl = `${SITE_CONFIG.siteUrl}/docs/${slug}`;
  const fullTitle = `${title} — AssetVault Docs`;

  return {
    title,
    description,
    keywords: [...SITE_CONFIG.keywords, title.toLowerCase()],
    authors: [{ name: "AssetVault", url: SITE_CONFIG.siteUrl }],
    creator: "AssetVault",
    publisher: "AssetVault",
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalUrl,
      siteName: SITE_CONFIG.siteName,
      type: "article",
      locale: SITE_CONFIG.locale,
      modifiedTime: updatedAt,
      authors: [SITE_CONFIG.siteUrl],
      images: [
        {
          // next/og generates this dynamically from opengraph-image.tsx
          url: `/docs/${slug}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: fullTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: SITE_CONFIG.twitterHandle,
      creator: SITE_CONFIG.twitterHandle,
      title: fullTitle,
      description,
      images: [`/docs/${slug}/opengraph-image`],
    },
  };
}

/** Full Metadata for the home page. */
export function buildHomeMetadata(): Metadata {
  return {
    title: {
      absolute: SITE_CONFIG.title,
    },
    description: SITE_CONFIG.description,
    keywords: SITE_CONFIG.keywords,
    authors: [{ name: "AssetVault", url: SITE_CONFIG.siteUrl }],
    creator: "AssetVault",
    publisher: "AssetVault",
    alternates: {
      canonical: SITE_CONFIG.siteUrl,
    },
    openGraph: {
      title: SITE_CONFIG.title,
      description: SITE_CONFIG.description,
      url: SITE_CONFIG.siteUrl,
      siteName: SITE_CONFIG.siteName,
      type: "website",
      locale: SITE_CONFIG.locale,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: SITE_CONFIG.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: SITE_CONFIG.twitterHandle,
      creator: SITE_CONFIG.twitterHandle,
      title: SITE_CONFIG.title,
      description: SITE_CONFIG.description,
      images: ["/opengraph-image"],
    },
  };
}
