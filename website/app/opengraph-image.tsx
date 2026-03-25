/**
 * opengraph-image.tsx
 *
 * Default site-wide OG image served at /opengraph-image.
 * Design: premium dark developer-tools aesthetic.
 *  - zinc-950 base with violet radial glow
 *  - subtle grid overlay
 *  - large display headline with violet accent
 *  - platform pills + URL lockup
 *
 * Uses Next.js ImageResponse (Satori) — inline styles only, no Tailwind.
 */

import { ImageResponse } from "next/og";
import { SITE_CONFIG } from "@/lib/seo";

export const runtime = "edge";
export const alt = SITE_CONFIG.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Load Inter Bold once at the module level (edge-cached).
const interBoldPromise = fetch(
  "https://rsms.me/inter/font-files/Inter-Bold.otf",
).then((r) => r.arrayBuffer());

const interRegularPromise = fetch(
  "https://rsms.me/inter/font-files/Inter-Regular.otf",
).then((r) => r.arrayBuffer());

export default async function OGImage() {
  const [interBold, interRegular] = await Promise.all([
    interBoldPromise,
    interRegularPromise,
  ]);

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
        {/* Subtle grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(124,58,237,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.06) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        {/* Large violet radial glow — top-left */}
        <div
          style={{
            position: "absolute",
            top: -180,
            left: -180,
            width: 680,
            height: 680,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(124,58,237,0.18) 0%, rgba(124,58,237,0.04) 50%, transparent 70%)",
          }}
        />

        {/* Smaller secondary glow — bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: -120,
            right: -60,
            width: 420,
            height: 420,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Content layer */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "64px 80px",
            position: "relative",
          }}
        >
          {/* Logo row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            {/* Geometric logo mark */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 24px rgba(124,58,237,0.4)",
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  border: "2.5px solid rgba(255,255,255,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.9)",
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontFamily: "Inter",
                fontWeight: 700,
                fontSize: 20,
                color: "#a78bfa",
                letterSpacing: "-0.02em",
              }}
            >
              AssetVault
            </span>
          </div>

          {/* Main headline — vertically centered */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontFamily: "Inter",
                fontWeight: 700,
                fontSize: 68,
                lineHeight: 1.08,
                letterSpacing: "-0.04em",
                color: "#fafafa",
                marginBottom: 28,
              }}
            >
              Local AI Search
              <br />
              <span
                style={{
                  background: "linear-gradient(90deg, #8b5cf6, #6366f1)",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                for Design Assets
              </span>
            </div>

            <div
              style={{
                fontFamily: "Inter",
                fontWeight: 400,
                fontSize: 24,
                lineHeight: 1.5,
                color: "#71717a",
                maxWidth: 680,
              }}
            >
              Semantic search, image similarity, and duplicate detection —
              all running locally. No cloud, no subscriptions.
            </div>
          </div>

          {/* Bottom row */}
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
                fontSize: 16,
                color: "#3f3f46",
                letterSpacing: "0.02em",
              }}
            >
              assetvault.app
            </span>

            <div style={{ display: "flex", gap: 10 }}>
              {["macOS", "Windows", "Linux"].map((platform) => (
                <div
                  key={platform}
                  style={{
                    padding: "7px 16px",
                    borderRadius: 8,
                    border: "1px solid #27272a",
                    background: "rgba(39,39,42,0.5)",
                    fontFamily: "Inter",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "#71717a",
                    letterSpacing: "0.01em",
                  }}
                >
                  {platform}
                </div>
              ))}
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
