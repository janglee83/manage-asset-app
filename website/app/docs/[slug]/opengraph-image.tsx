/**
 * /docs/[slug]/opengraph-image.tsx
 *
 * Per-documentation-page OG image.
 * Design mirrors the default OG image but swaps the headline for the
 * document title and shows a "Docs" breadcrumb path.
 *
 * Uses Next.js ImageResponse (Satori) — inline styles only.
 */

import { ImageResponse } from "next/og";
import { getDocBySlug } from "@/lib/docs";
import { SITE_CONFIG } from "@/lib/seo";
import { notFound } from "next/navigation";

// Edge runtime can't use Node.js built-ins (fs, reading-time).
// Switch to nodejs runtime so lib/docs.ts can read files from disk.
export const runtime = "nodejs";
export const alt = "AssetVault Documentation";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const interBoldPromise = fetch(
  "https://rsms.me/inter/font-files/Inter-Bold.otf",
).then((r) => r.arrayBuffer());

const interRegularPromise = fetch(
  "https://rsms.me/inter/font-files/Inter-Regular.otf",
).then((r) => r.arrayBuffer());

export default async function DocOGImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getDocBySlug(slug);

  if (!doc) notFound();

  const [interBold, interRegular] = await Promise.all([
    interBoldPromise,
    interRegularPromise,
  ]);

  // Truncate description to avoid overflow.
  const description =
    doc.description.length > 120
      ? `${doc.description.slice(0, 117)}…`
      : doc.description;

  // Truncate title if very long.
  const title =
    doc.title.length > 48 ? `${doc.title.slice(0, 45)}…` : doc.title;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#09090b",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(124,58,237,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.05) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        {/* Glow — top-right for variety vs the home page */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 600,
            height: 600,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,58,237,0.16) 0%, rgba(124,58,237,0.04) 50%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -80,
            left: 100,
            width: 380,
            height: 380,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(79,70,229,0.10) 0%, transparent 70%)",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "60px 80px",
            position: "relative",
          }}
        >
          {/* Top: Logo + breadcrumb */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 20px rgba(124,58,237,0.35)",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: "2px solid rgba(255,255,255,0.85)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.85)",
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontFamily: "Inter",
                fontWeight: 700,
                fontSize: 17,
                color: "#a78bfa",
                letterSpacing: "-0.01em",
              }}
            >
              AssetVault
            </span>
            <span
              style={{
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 17,
                color: "#3f3f46",
              }}
            >
              /
            </span>
            <span
              style={{
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 17,
                color: "#52525b",
              }}
            >
              Docs
            </span>
          </div>

          {/* Doc title — large */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {/* Docs label pill */}
            <div
              style={{
                display: "flex",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid rgba(124,58,237,0.3)",
                  background: "rgba(124,58,237,0.08)",
                  fontFamily: "Inter",
                  fontWeight: 400,
                  fontSize: 13,
                  color: "#a78bfa",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Documentation
              </div>
            </div>

            <div
              style={{
                fontFamily: "Inter",
                fontWeight: 700,
                fontSize: title.length > 30 ? 58 : 72,
                lineHeight: 1.1,
                letterSpacing: "-0.04em",
                color: "#fafafa",
                marginBottom: 24,
              }}
            >
              {title}
            </div>

            <div
              style={{
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 22,
                lineHeight: 1.5,
                color: "#71717a",
                maxWidth: 760,
              }}
            >
              {description}
            </div>
          </div>

          {/* Bottom */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 15,
                color: "#3f3f46",
                letterSpacing: "0.02em",
              }}
            >
              {SITE_CONFIG.siteUrl.replace("https://", "")}/docs/{slug}
            </span>
            <div
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                border: "1px solid rgba(124,58,237,0.25)",
                background: "rgba(124,58,237,0.06)",
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 13,
                color: "#7c3aed",
                letterSpacing: "0.02em",
              }}
            >
              Read the docs →
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: interBold, weight: 700, style: "normal" },
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      ],
    },
  );
}
