/**
 * app/page.tsx — AssetVault landing page
 *
 * All sections are server components except DownloadSection and FAQSection
 * which use client-side interactivity (OS detection, accordion state).
 * FAQPage JSON-LD is emitted from the server for full crawlability.
 */

import type { Metadata } from "next";
import { buildFaqJsonLd, buildHomeMetadata } from "@/lib/seo";
import { en } from "@/messages/en";
import { NavBar } from "@/components/landing/NavBar";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { ArchitectureSection } from "@/components/landing/ArchitectureSection";
import { PlatformSection } from "@/components/landing/PlatformSection";
import { WhyLocalFirst } from "@/components/landing/WhyLocalFirst";
import { DownloadSection } from "@/components/landing/DownloadSection";
import { DocsCTASection } from "@/components/landing/DocsCTASection";
import { FAQSection } from "@/components/landing/FAQSection";
import { Footer } from "@/components/landing/Footer";

export const metadata: Metadata = buildHomeMetadata();

export default function HomePage() {
  const faqJsonLd = buildFaqJsonLd(
    en.faq.items.map((f) => ({ question: f.q, answer: f.a })),
  );

  return (
    <>
      {/* FAQ structured data — important for Google "People also ask" */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Page */}
      <div className="min-h-screen bg-zinc-950 text-zinc-50">
        <NavBar />
        <main>
          <HeroSection />
          <FeaturesSection />
          <ArchitectureSection />
          <PlatformSection />
          <WhyLocalFirst />
          <DownloadSection />
          <DocsCTASection />
          <FAQSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
