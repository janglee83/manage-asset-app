/**
 * robots.ts
 *
 * Generates /robots.txt via Next.js 15 MetadataRoute.Robots.
 * Blocks _next/ build artefacts from indexing while allowing all
 * public pages and assets.
 */

import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/_next/", "/api/"],
      },
    ],
    sitemap: `${SITE_CONFIG.siteUrl}/sitemap.xml`,
    host: SITE_CONFIG.siteUrl,
  };
}
