Build a full production-grade product website for an AI-powered local-first desktop design asset search application.

Main goal:

Create a highly professional product website with:

1. Landing page
2. Download system
3. Documentation platform
4. SEO-first architecture
5. Production-ready deployment on Vercel free tier

Use:

* Next.js (latest App Router)
* TypeScript
* Tailwind CSS
* MDX for docs
* Static generation where possible
* Dynamic metadata when needed

---

## A. LANDING PAGE REQUIREMENTS

Build a strong landing page optimized for conversion and SEO.

Landing page sections:

1. Hero section

* clear product title
* product subtitle
* local-first AI search positioning
* CTA download button
* CTA docs button

2. Product feature section
   Explain:

* semantic search
* multilingual search
* image similarity search
* duplicate detection
* local privacy
* offline-first

3. Architecture section
   Visual technical flow:

React
→ Tauri
→ Rust
→ SQLite
→ Python
→ FAISS

4. Supported platform section
   Clearly show support:

Windows:

* Windows 10+
* Windows 11

macOS:

* Monterey+
* Ventura+
* Sonoma+

Support:

* Intel x64
* Apple Silicon M1 / M2 / M3

Ubuntu:

* Ubuntu 22.04+
* Ubuntu 24.04+

5. Why local-first section
   Explain:

* privacy
* speed
* no cloud dependency
* no subscription

6. Download section
   Auto detect OS
   Suggest correct installer automatically

7. Documentation CTA section

8. FAQ section

9. Footer

---

## B. DOWNLOAD SYSTEM REQUIREMENTS

Need browser OS detection.

Detect:

* Windows
* macOS Intel
* macOS Apple Silicon
* Ubuntu/Linux

Download mapping:

Windows:
.exe installer

macOS Intel:
.dmg x64

macOS Apple Silicon:
.dmg arm64

Ubuntu:
.AppImage
.deb

Need fallback:
manual OS selection dropdown

Need show supported version clearly.

Need architecture:
download link config centralized

---

## C. SEO REQUIREMENTS

SEO must be very strong.

Implement:

* metadata API
* sitemap.xml
* robots.txt
* canonical URLs
* OpenGraph tags
* Twitter meta tags
* JSON-LD structured data

Target SEO keywords:

* design asset search
* local semantic search
* offline design search
* desktop AI search
* image similarity search local
* multilingual asset finder

Need:
semantic heading structure

Need:
high Lighthouse score

Need:
fast first paint

Need:
static pages where possible

---

## D. DOCUMENTATION SYSTEM REQUIREMENTS

Create full docs site under:

/docs

Use MDX.

Docs structure:

/docs/overview
/docs/architecture
/docs/installation
/docs/supported-platforms
/docs/file-discovery
/docs/indexing-engine
/docs/semantic-search
/docs/image-search
/docs/multilingual-search
/docs/duplicate-detection
/docs/ai-models
/docs/security
/docs/performance
/docs/limitations
/docs/faq

---

## E. DOCUMENTATION CONTENT REQUIREMENTS

Docs must explain deeply:

1. Product overview
2. Full architecture
3. Why local-first chosen
4. How indexing works
5. How file discovery works
6. How vector search works
7. How multilingual search works
8. How image search works
9. How duplicate detection works
10. How recommendation works
11. SQLite role
12. Rust role
13. Python sidecar role
14. FAISS role
15. Performance strategy
16. Security strategy
17. Limitations
18. Future roadmap

Need technical diagrams.

Need clear engineering explanation.

---

## F. USER GUIDE REQUIREMENTS

Add usage guide:

1. Install application
2. Select folders
3. First indexing
4. Search by keyword
5. Search by image
6. Search multilingual
7. Favorite assets
8. Detect duplicates
9. Read recommendations
10. Export metadata

---

## G. PRODUCT ANALYSIS SECTION

Add product analysis section:

Strengths:

* local privacy
* fast local search
* offline AI

Weaknesses:

* first indexing cost
* local storage usage
* local model size

Need compare local-first vs cloud model.

---

## H. WEBSITE ARCHITECTURE REQUIREMENTS

Need production-grade folder structure:

/app
/components
/lib
/content/docs
/public/downloads
/public/images
/styles

Need reusable components.

Need strong separation:
landing / docs / shared layout

---

## I. PERFORMANCE REQUIREMENTS

Need:

* lazy loading
* code splitting
* image optimization
* static rendering where possible

Need docs search optimized.

---

## J. SECURITY REQUIREMENTS

Need:

* sanitize all download links
* no unsafe external scripts
* CSP ready
* secure metadata rendering

---

## K. CODE QUALITY REQUIREMENTS

All code must be:

* production-ready
* modular
* scalable
* readable
* strongly typed

Never generate:

* toy code
* tutorial code
* pseudo code

Always output:

1. folder placement
2. code
3. explanation
4. why architecture chosen

Before writing code:

First explain architecture risks.
Then write safest production implementation.

Use visual quality similar to premium developer tools homepage.

Reference quality level:
modern AI infrastructure products

Need:
balanced whitespace
strong typography
subtle gradients
professional technical aesthetic
