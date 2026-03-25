import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // All doc pages are statically generated at build time.
  // output: "export" would work for pure static, but we keep "standalone"
  // so Vercel can serve it with edge functions for future dynamic features.

  // Image optimization — allow local and potential future CDN origin.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [],
  },

  // Strict mode helps catch React issues during development.
  reactStrictMode: true,

  // Trailing slashes are off — canonical URLs are /docs/overview (not /docs/overview/).
  trailingSlash: false,

  // Suppress the "X-Powered-By: Next.js" header.
  poweredByHeader: false,

  // Content Security Policy and other security headers.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
