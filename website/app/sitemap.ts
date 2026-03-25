/**
 * sitemap.ts
 *
 * Dynamically generates /sitemap.xml at build time using Next.js 15
 * MetadataRoute.Sitemap. All doc pages are included with their actual
 * `updatedAt` dates from frontmatter.
 */

import type { MetadataRoute } from "next";
import { getAllDocs } from "@/lib/docs";
import { SITE_CONFIG } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await getAllDocs();

  const docEntries: MetadataRoute.Sitemap = docs.map((doc) => ({
    url: `${SITE_CONFIG.siteUrl}/docs/${doc.slug}`,
    lastModified: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [
    {
      url: SITE_CONFIG.siteUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE_CONFIG.siteUrl}/download`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE_CONFIG.siteUrl}/docs`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.85,
    },
    ...docEntries,
  ];
}
