/**
 * messages/en.ts — English UI strings
 */
export const en = {
  nav: {
    docs: "Docs",
    features: "Features",
    download: "Download",
  },
  hero: {
    badge: "v{version} — Now with GPU-accelerated embeddings",
    headline1: "Find any design asset",
    headline2: "in plain language",
    description:
      "AssetVault indexes your entire design library with CLIP AI and makes it searchable by meaning — across 100+ languages, from a reference image, or by description. Everything runs",
    descriptionEmphasis: "locally on your machine",
    ctaDownload: "Download Free",
    ctaDocs: "Read the docs",
    ctaGithub: "Open source",
    stat1Value: "100+",
    stat1Label: "languages supported",
    stat2Value: "< 25 ms",
    stat2Label: "search latency (warm)",
    stat3Value: "200K+",
    stat3Label: "assets tested",
    stat4Value: "0 bytes",
    stat4Label: "sent to the cloud",
  },
  features: {
    sectionLabel: "Capabilities",
    sectionTitle: "Everything your design search should be",
    sectionDescription:
      "Six deeply integrated features powered by CLIP, FAISS, and EasyOCR — all running locally in under 25 ms.",
    items: {
      semantic: {
        title: "Semantic Search",
        description:
          "Describe what you're looking for in plain English. CLIP understands meaning, not just keywords — find that 'dark dashboard with charts' without tags.",
      },
      multilingual: {
        title: "Multilingual",
        description:
          "Search in Japanese, Arabic, Spanish, or any of 100+ languages. CLIP's shared embedding space maps your query to the right visual results regardless of language.",
      },
      image: {
        title: "Image Search",
        description:
          "Drag any reference image onto the search bar. AssetVault finds visually similar assets instantly. Combine with text to cross-modal search — 'like this but darker'.",
      },
      duplicate: {
        title: "Duplicate Detection",
        description:
          "Three-level detection: exact (SHA-256), perceptual (pHash hamming ≤ 10), and semantic (CLIP cosine similarity). Review and bulk-resolve with a single click.",
      },
      privacy: {
        title: "Total Privacy",
        description:
          "Every vector, thumbnail, and tag lives in a local SQLite database. Zero telemetry. Zero cloud API calls. The only outbound request is an optional version check.",
      },
      offline: {
        title: "Offline-First",
        description:
          "After the one-time model download, AssetVault works with no internet connection. Your library is always accessible, on a plane or behind a corporate firewall.",
      },
    },
  },
  architecture: {
    sectionLabel: "Architecture",
    title: "Six layers, zero cloud",
    description:
      "AssetVault uses a strict three-process architecture: the React UI communicates exclusively via Tauri's typed IPC, Rust owns all disk I/O and SQLite state, and the Python sidecar handles AI inference over a local JSON-RPC channel.",
    points: [
      "Frontend has zero filesystem access — IPC only",
      "Sidecar has no network socket — stdin/stdout only",
      "SQLite is the only state store; FAISS is the only vector store",
      "CLIP and FAISS run entirely in-process — no external API",
    ],
  },
  platforms: {
    sectionLabel: "Platform Support",
    title: "Works where you work",
    description:
      "Native installers for every major operating system and CPU architecture.",
    accelerationTitle: "Apple Silicon M1 / M2 / M3",
    accelerationDesc:
      "Native arm64 execution — no Rosetta, 3× faster CLIP embedding via Metal GPU (MPS)",
    cudaTitle: "CUDA GPU acceleration",
    cudaDesc:
      "Detected automatically on Windows / Linux — reduces embedding time by up to 6×",
    cpuTitle: "CPU fallback",
    cpuDesc:
      "OpenBLAS CPU inference on all platforms with no additional setup",
  },
  whyLocal: {
    sectionLabel: "Why Local-First",
    title: "Privacy and speed by default",
    description:
      "Cloud-based design tools trade your data for convenience. AssetVault gives you both — without the tradeoff.",
    compareCapability: "Capability",
    compareAsset: "AssetVault",
    compareCloud: "Cloud-based tools",
    rows: [
      "Works offline",
      "No data upload",
      "No API key / quota",
      "Sub-30 ms search",
      "Free core tier",
      "100+ languages",
    ],
    items: [
      {
        title: "Your files never leave your machine",
        description:
          "CLIP vectors, thumbnails, tags, and search history are stored in a local SQLite database. Zero telemetry. Zero cloud upload. Confidential client work stays confidential.",
        stat: "0 bytes",
        statLabel: "sent to any server",
      },
      {
        title: "Sub-30 ms search on a warm query",
        description:
          "FAISS nearest-neighbour lookup is 3–5 ms. The full round-trip from keypress to rendered results takes ~25 ms on a 50 000-asset library with no network round-trips.",
        stat: "< 25 ms",
        statLabel: "search latency (warm)",
      },
      {
        title: "No external service dependency",
        description:
          "No API key to manage, no quota to exhaust, no rate limits, no vendor lock-in. Your search works on a plane, at a client site, or behind a strict corporate firewall.",
        stat: "100%",
        statLabel: "uptime (offline-capable)",
      },
      {
        title: "No subscription required for core features",
        description:
          "Semantic search, image search, duplicate detection, and multilingual support are available on the free tier for up to 5 000 assets. No credit card to trial the product.",
        stat: "Free",
        statLabel: "up to 5 K assets",
      },
    ],
  },
  download: {
    sectionLabel: "Download",
    title: "Get AssetVault for free",
    subtitle:
      "Free for up to 5 000 assets. No account, no credit card, no telemetry.",
    detectedLabel: "Detected:",
    primaryCta: "Download for {platform}",
    versionNote: "v{version} — {format} installer",
    selectPlatform: "Select platform",
    allReleases: "View all releases on GitHub",
  },
  docsCta: {
    badge: "Full documentation",
    title: "Comprehensive docs,\nopen source code",
    description:
      "Every component is documented — the SQLite schema, Rust command surface, Python sidecar JSON-RPC protocol, FAISS index structure, and security model.",
    cta: "Browse documentation",
  },
  faq: {
    sectionLabel: "FAQ",
    title: "Common questions",
    items: [
      {
        q: "Does AssetVault send my images to a cloud AI service?",
        a: "No. CLIP, EasyOCR, and all AI models run locally inside the Python sidecar process. No image, vector, or metadata is transmitted to any external server.",
      },
      {
        q: "How long does indexing take for a large library?",
        a: "Initial scanning is fast — around 70 seconds for 50 000 files on an M1 Pro. Embedding takes about 7 minutes on CPU, 2.5 minutes with Metal GPU, or 70 seconds with CUDA.",
      },
      {
        q: "What happens if the sidecar crashes?",
        a: "AssetVault detects a dead sidecar and shows a toast notification. You can restart from Settings → Intelligence without restarting the main app. All SQLite state is preserved.",
      },
      {
        q: "Can I use AssetVault with Figma or Sketch files?",
        a: "Yes. Figma exported files, Sketch, SVGs, PSDs, and AIs are first-class file types. They are prioritised in scan order so design files appear first in results.",
      },
      {
        q: "Is there a command-line interface?",
        a: "Not yet, but it's on the roadmap. The Rust codebase is structured so a CLI wrapper could be added without changing core logic.",
      },
      {
        q: "How do I update to a new version?",
        a: "AssetVault checks for updates at launch (opt-in). Download the new installer from the release page and run it — your data directory and index are preserved.",
      },
      {
        q: "What is the maximum library size?",
        a: "Libraries up to 200 000 assets have been tested. Above 1 million, FAISS memory usage will exceed 2 GB. A sharded IVF index for very large libraries is planned.",
      },
      {
        q: "Can I search by color palette?",
        a: "Yes. Add 'color:red' or 'palette:blue tones' to your query and the palette search module filters by hue similarity. You can also use the Color filter in the sidebar.",
      },
    ],
  },
  footer: {
    tagline: "Local-first AI search for your design library. Open source. Privacy-first.",
    copyright: "© {year} AssetVault. MIT License.",
    builtWith: "Built with Next.js, Tailwind CSS, Tauri, Rust, and Python.",
    product: "Product",
    links: {
      download: "Download",
      changelog: "Changelog",
      issues: "Issues",
      documentation: "Documentation",
      security: "Security",
    },
  },
} as const;

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type Messages = DeepStringify<typeof en>;
