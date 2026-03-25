# AssetVault

Local-first desktop application for searching, managing, and understanding design assets stored on your computer.  No internet required, no cloud sync, no subscription.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [AI Pipeline — Python Sidecar](#ai-pipeline--python-sidecar)
5. [Data Storage](#data-storage)
6. [Project Structure](#project-structure)
7. [Developer Setup](#developer-setup)
8. [Usage Guide](#usage-guide)
9. [Tech Stack](#tech-stack)

---

## Overview

AssetVault indexes design assets (PNG, JPG, SVG, WebP, .fig, .sketch, .xd, etc.) from any folder on your machine and provides:

- **Instant keyword search** — fuzzy name + tag + OCR text search backed by SQLite FTS5
- **Visual similarity search** — drag any image; CLIP encodes it and finds the most similar assets in your library
- **AI-powered semantic search** — describe what you want in natural language ("dark mobile dashboard fintech") and the design language layer expands your query into CLIP vectors
- **Auto-tagging** — ML model generates descriptive tags for every image
- **OCR text extraction** — extract readable text from screenshots, mockups, presentations
- **Duplicate detection** — exact (SHA-256) and visual (cosine similarity) duplicate pairs
- **Folder intelligence** — automatically infers the semantic category of every watched folder
- **Asset relation graph** — detects related assets (component families, version variants, platform variants)
- **`.fig` metadata extraction** — extracts probable page, frame, and component names from local Figma files via binary scanning
- **Broken path recovery** — detects moved/deleted files and suggests recovery paths

---

## Features

### Library Management

| Feature | Description |
|---------|-------------|
| **Folder watching** | Add any folder; all supported files are indexed recursively. Real-time updates via `notify`. |
| **File types** | PNG · JPG/JPEG · GIF · WebP · BMP · TIFF · HEIC · AVIF · SVG · .fig · .sketch · .xd · .psd · .ai · .eps · .indd · .pdf · .mp4 · .mov · .ttf · .otf · .woff(2) |
| **Metadata** | File name, path, extension, folder, modified/created dates, file size, SHA-256 hash, favorite flag |
| **Thumbnails** | Auto-generated 200×200 JPEG thumbnails cached to disk; batch-loaded with LRU eviction (500 cap) |
| **Favorites** | Star any asset for boosted ranking in semantic search results |
| **Reveal / Open** | Open file in its default app or reveal in Finder/Explorer |
| **Export** | Export asset metadata as CSV or JSON |
| **Broken path recovery** | Detects moved or deleted files and proposes candidates by name similarity |

### Search

| Feature | Description |
|---------|-------------|
| **Keyword search** | Fuzzy name + tag + folder search using the Skim algorithm (fuzzy-matcher crate) with SQLite FTS5 full-text fallback |
| **OCR text search** | If OCR extraction has been run, the indexed text is included in keyword search results |
| **Filter / sort** | Filter by extension, folder, date range, favorites; sort by modified date, created date, name, size |
| **Autocomplete** | Search history + tag + filename + folder suggestions with 120 ms debounce |
| **Semantic search** | CLIP text embedding via multilingual model; re-ranks with a composite signal (semantic · keyword · recency · favorite · folder priority) |
| **Visual / image search** | Drag any image or use "Browse…" to find visually similar assets by CLIP cosine distance |
| **Design language** | Natural-language queries like "clean fintech screen" or "dark mobile dashboard" are expanded via a vocabulary layer into three CLIP prompts, then averaged for superior retrieval |
| **Keyboard shortcut** | `⌘K` / `Ctrl+K` focuses the search bar |

### AI Features (Python Sidecar)

| Feature | Description |
|---------|-------------|
| **CLIP image embeddings** | `sentence-transformers/clip-ViT-B-32` — 512-dim vectors, enables cross-modal image↔text search |
| **Multilingual text encoder** | `clip-ViT-B-32-multilingual-v1` — same 512-dim CLIP space, supports EN/VI/JA and 50+ languages |
| **FAISS vector index** | Inner-product / cosine similarity search over all embedded assets |
| **Design language understanding** | Vocabulary maps (22 styles · 12 platforms · 40+ screen types · 35 domains · 15 color schemes · 10 moods) + 3-prompt multi-vector averaging for design queries |
| **Auto-tagging** | ML model generates up to 15 descriptive tags per image; stored in `tags` table and FTS5 index |
| **Duplicate detection** | Exact (SHA-256 hash) + visual (CLIP cosine ≥ threshold) duplicate pair surface |
| **OCR extraction** | EasyOCR with English · Japanese · Vietnamese support; indexed in FTS5 table `ocr_fts` |
| **`.fig` metadata** | Heuristic Kiwi binary scanner — extracts probable page / frame / component names from local `.fig` files |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React + Vite + Tailwind (frontend)                 │
│  Zustand store  ·  @tauri-apps/api invoke()         │
└──────────────────┬──────────────────────────────────┘
                   │  Tauri IPC (type-safe)
┌──────────────────▼──────────────────────────────────┐
│  Rust (Tauri v2 / commands.rs)                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  scanner.rs   watcher.rs   search.rs         │   │
│  │  thumbnail.rs hasher.rs    db.rs             │   │
│  │  folder_intel.rs           relation_graph.rs │   │
│  │  export.rs    recovery.rs  logging.rs        │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │ rusqlite (bundled)         │
│  ┌──────────────────────▼───────────────────────┐   │
│  │  SQLite  (assets.db)                         │   │
│  │  assets · tags · embeddings · search_history │   │
│  │  duplicate_pairs · watched_folders           │   │
│  │  folder_intelligence · asset_relations       │   │
│  │  asset_ocr · asset_fig_metadata              │   │
│  └──────────────────────┬───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │  JSON-RPC stdio (newline-delimited)
┌─────────────────────────▼───────────────────────────┐
│  Python sidecar (main.py)                           │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ embedder │  │ index_manager│  │    ranker    │  │
│  │  CLIP    │  │    FAISS     │  │ multi-signal │  │
│  └──────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  tagger  │  │design_language│  │    ocr.py    │  │
│  │  ML tags │  │ vocab + prompts│  │  EasyOCR    │  │
│  └──────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │  fig_extractor.py   duplicate_detector.py    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  FAISS vector index  (semantic/faiss.index)         │
│  CLIP model cache    (sentence-transformers)        │
└─────────────────────────────────────────────────────┘
```

### Key Data Flows

**Folder scan:**
1. User adds folder → `add_folder` Tauri command
2. Rust `scanner.rs` walks directory tree with WalkDir
3. Each file → SHA-256 hash · thumbnail · SQLite upsert
4. `scan_progress` events pushed to frontend via Tauri event channel
5. On completion → `useScanProgress` hook triggers auto-embed of new assets

**Keyword search:**
1. `search` command → `search.rs` builds SQLite query
2. FTS5 match on `assets_fts` (file name + folder) — optionally unioned with `ocr_fts`
3. Fuzzy matching via Skim algorithm for non-FTS fallback
4. Results paged via `limit` / `offset`

**Semantic search (text):**
1. Frontend sends query → `semantic_search` Rust command
2. Rust injects favorite IDs from SQLite → sidecar `search_semantic` RPC
3. Python: design language layer → 1–3 CLIP prompts → CLIP text encoder → 512-dim vector(s)
4. Multi-vector averaging when `is_design_query` (3 prompts)
5. FAISS nearest-neighbour search → composite ranking (semantic · keyword · recency · favorite · folder)
6. Hits with `asset_id + score + signals` returned to Rust → frontend

**Visual / image search (drag & drop):**
1. User drops image anywhere on window → `tauri://drag-drop` event
2. `useGlobalImageDrop` hook → `runImageSearch(filePath)`
3. Rust `search_by_image` injects favorites → sidecar `search_by_image` RPC
4. Python: `encode_images([path])` → CLIP image encoder → 512-dim vector
5. FAISS nearest-neighbour → ranking (no keyword component)
6. Frontend resolves `asset_id` hits to full `Asset` objects via parallel `getAsset` calls
7. `ImageSearchPanel` shows query preview + ranked results

**OCR pipeline:**
1. `extract_ocr_text(assetId)` → sidecar `extract_ocr` RPC
2. EasyOCR reads image → list of text blocks → joined `full_text`
3. Upserted into `asset_ocr`; sync triggers keep `ocr_fts` consistent
4. Subsequent keyword searches with `include_ocr: true` union `ocr_fts`

**Design language understanding:**
1. `understand_design_query(query)` sidecar call (standalone, no search)
2. `DesignQueryParser` tokenizes → matches 6 vocabulary categories
3. Confidence ≥ 0.35 → `is_design_query: true` → 3 prompts generated
4. Returns `{ original, expanded_prompt, prompts, concepts, confidence, is_design_query }`

**`.fig` metadata extraction (heuristic):**
1. Open file as ZIP archive (`.fig` is a ZIP)
2. Count `thumbnails/*.png` → approximate page count
3. Read `canvas` binary blob (Kiwi-encoded — Figma's undocumented format)
4. Slide byte-by-byte; treat each position as LEB128-prefixed UTF-8 string
5. Filter via block-list + regex; classify into pages / frames / components heuristically
6. Persist to `asset_fig_metadata`; return with confidence notes and limitations

---

## AI Pipeline — Python Sidecar

The sidecar (`python-service/main.py`) is a **newline-delimited JSON-RPC** process launched as a Tauri sidecar. Communication is via **stdin/stdout**. All blocking model calls run in a background thread; the main loop is non-blocking.

### Models

| Model | Purpose | Dimension |
|-------|---------|-----------|
| `sentence-transformers/clip-ViT-B-32` | Image encoder | 512 |
| `clip-ViT-B-32-multilingual-v1` | Text encoder (EN/VI/JA + 50 languages) | 512 |
| EasyOCR (EN + JA + VI) | Text recognition from images | — |
| Custom tagger | Image auto-tagging | — |

Both CLIP models share the same 512-dimensional embedding space, enabling **cross-modal search** — a text query ("dark dashboard") finds images, and a query image finds similar images.

### Ranking Signals

Every search result is scored by a composite formula:

```
ranked_score = w_semantic · semantic
             + w_keyword  · keyword
             + w_recency  · recency
             + w_favorite · favorite
             + w_folder   · folder
```

Default weights: `0.60 / 0.15 / 0.10 / 0.10 / 0.05`.  Weights are normalized automatically and can be overridden per request.

### Design Language Vocabulary

The `DesignQueryParser` maps natural-language design terms to expansion tokens across 6 categories:

- **Styles** (22): minimal, glassmorphism, neumorphism, brutalist, dark, light, flat, material, ios, android, …
- **Platforms** (12): mobile, desktop, tablet, web, wearable, tv, …
- **Screen types** (40+): dashboard, login, onboarding, checkout, settings, profile, map, feed, …
- **Domains** (35): fintech, healthcare, e-commerce, social, gaming, productivity, …
- **Color schemes** (15): dark mode, light mode, monochrome, neon, pastel, …
- **Moods** (10): clean, bold, elegant, playful, serious, …

A query like `"clean fintech screen"` becomes three prompts:
1. `"a clean modern mobile fintech dashboard UI design"`
2. `"clean mobile fintech application with dashboard screen"`
3. `"clean minimal modern fintech banking dashboard finance money screen UI design"`

The three CLIP vectors are averaged and L2-normalized before FAISS search, significantly improving retrieval precision for design queries.

---

## Data Storage

### macOS
```
~/Library/Application Support/com.lethanhgiang.asset-vault/
├── assets.db                    # SQLite — all metadata
└── semantic/
    ├── faiss.index              # FAISS flat index (float32, 512-dim)
    ├── id_map.json              # FAISS position → asset_id mapping
    └── (sentence-transformers cache)
```

### Windows
```
%APPDATA%\com.lethanhgiang.asset-vault\
```

### SQLite Schema (Key Tables)

| Table | Description |
|-------|-------------|
| `assets` | Core file records (path · name · ext · hash · thumbnail · favorite) |
| `tags` | Asset tags (source: user / ai / import) + `tags_fts` FTS5 virtual table |
| `assets_fts` | FTS5 full-text index over file name + folder |
| `embeddings` | CLIP embedding registration (FAISS position per asset) |
| `search_history` | Keyword autocomplete history |
| `duplicate_pairs` | Exact + visual duplicate pairs with dismiss flag |
| `watched_folders` | User-added folders |
| `folder_intelligence` | Per-folder semantic category + confidence |
| `asset_relations` | Auto-detected relations (component_family · version · platform_variant · same_stem · co_location) |
| `asset_ocr` | OCR-extracted full text + `ocr_fts` FTS5 virtual table |
| `asset_fig_metadata` | Heuristic `.fig` page/frame/component names |

Original files are **never modified or copied**.  Only metadata, thumbnails, and the FAISS vector index are stored.

---

## Project Structure

```
manage-asset-app/
├── src/                          # React frontend (TypeScript + Tailwind)
│   ├── App.tsx                   # Root layout, global drop handler
│   ├── components/
│   │   ├── AssetGrid.tsx         # Main asset grid (grid + list modes)
│   │   ├── SearchBar.tsx         # Debounced search + autocomplete
│   │   ├── Sidebar.tsx           # Folder tree + extension filter chips
│   │   ├── PreviewPanel.tsx      # Right-side asset preview + metadata
│   │   ├── ImageSearchPanel.tsx  # Visual search slide-in panel
│   │   ├── DuplicatePanel.tsx    # Duplicate detection results
│   │   ├── RecoveryPanel.tsx     # Broken path recovery UI
│   │   ├── ExportModal.tsx       # CSV / JSON export dialog
│   │   ├── ScanProgressBar.tsx   # Scan progress indicator
│   │   └── ToastStack.tsx        # Error / info toasts
│   ├── hooks/
│   │   ├── useScanProgress.ts    # Listens to scan_progress events; auto-embeds on done
│   │   ├── useFileWatcher.ts     # Handles real-time file add/update/delete events
│   │   ├── useGlobalImageDrop.ts # Tauri drag-drop → visual search
│   │   ├── useImageSearch.ts     # Per-element drag-over tracking
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── useSidecarWatcher.ts  # Detects sidecar crash → shows warning
│   │   └── useSuggestions.ts     # Debounced autocomplete
│   ├── store/
│   │   ├── assetStore.ts         # Zustand store (assets · search · image search · embedding)
│   │   └── errorStore.ts         # Global error reporting → ToastStack
│   ├── lib/
│   │   ├── api.ts                # Type-safe Tauri IPC wrappers (46 commands)
│   │   └── utils.ts
│   └── types/index.ts            # All shared TypeScript interfaces
│
├── src-tauri/
│   └── src/
│       ├── lib.rs                # Plugin setup + invoke_handler registration
│       ├── commands.rs           # All Tauri commands (~1700 lines)
│       ├── db.rs                 # SQLite schema init + migrations
│       ├── models.rs             # Serde models for IPC
│       ├── scanner.rs            # WalkDir recursive scan
│       ├── watcher.rs            # notify file system watcher
│       ├── search.rs             # SQLite + FTS5 + fuzzy search
│       ├── thumbnail.rs          # image crate thumbnail generation
│       ├── hasher.rs             # SHA-256 file hashing
│       ├── file_types.rs         # Extension constants + predicates
│       ├── folder_intel.rs       # Folder intelligence analysis
│       ├── relation_graph.rs     # Asset relation detection (11 unit tests)
│       ├── export.rs             # CSV / JSON export
│       ├── recovery.rs           # Broken path detection + recovery
│       ├── sidecar.rs            # Python sidecar process management + JSON-RPC
│       ├── state.rs              # AppState (db mutex + sidecar handle)
│       ├── errors.rs             # Error types + with_db_retry
│       └── logging.rs            # tracing subscriber setup
│
└── python-service/
    ├── main.py                   # JSON-RPC stdio dispatcher (~600 lines)
    ├── embedder.py               # CLIP image + text encoder (thread-safe lazy loader)
    ├── index_manager.py          # FAISS index lifecycle (load / save / rebuild)
    ├── ranker.py                 # Multi-signal ranking engine
    ├── design_language.py        # Design query vocabulary + prompt expansion
    ├── ocr.py                    # EasyOCR multilingual text extraction
    ├── fig_extractor.py          # .fig ZIP / Kiwi binary scanner
    ├── tagger.py                 # ML auto-tagger
    ├── duplicate_detector.py     # Exact + visual duplicate pipeline
    ├── schema.py                 # Asset metadata schema
    ├── requirements.txt
    └── setup.sh                  # venv setup + pip install
```

---

## Developer Setup

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 20
- [Rust](https://rustup.rs) (stable, ≥ 1.77)
- [Python](https://python.org) ≥ 3.10 (for the sidecar)
- macOS 12+ / Windows 10+ / Linux (X11 or Wayland)

### 1. Install JS dependencies

```bash
npm install
```

### 2. Set up the Python sidecar

```bash
cd python-service
bash setup.sh        # creates .venv + installs requirements.txt
cd ..
```

> **First launch takes 1–2 minutes** while the CLIP models (~500 MB) download to the sentence-transformers cache.

### 3. Start development server

```bash
npm run tauri dev
```

### 4. Build production app

```bash
npm run tauri build
```

The installer is placed under `src-tauri/target/release/bundle/`.

---

## Usage Guide

### Adding folders to your library

1. Click **"+ Add Folder"** in the left sidebar.
2. Select a folder — all supported files are indexed recursively.
3. A progress bar shows scan status. When it finishes, new assets are automatically embedded into the CLIP vector index.

### Keyword search

Type in the search bar.  Results update with a 300 ms debounce.  Press `⌘K` / `Ctrl+K` to jump to the bar.

- **Tag search**: `tag:dark` or `tag:ui` matches assets with that AI-generated or user tag
- **Extension filter**: click tile chips below the search bar (PNG, SVG, …)
- **Sort**: dropdown on the right of the search bar

### Visual / image search

1. Click **"Visual Search"** in the header to open the panel.
2. **Drag** any image file from Finder/Explorer anywhere onto the window
   — or click **"Browse…"** inside the panel to pick a file.
3. The query image preview appears, CLIP encodes it, and the most visually similar assets are listed with similarity scores.
4. Adjust **Min similarity** (10–90%) and **Max results** (10–100) sliders to tune results.
5. Click any result row to highlight the asset in the main grid.

> **First time?** If the panel shows "Library not indexed", click **"Build Search Index"**.
> This runs once per install (or after a model upgrade) and takes a few seconds per 100 images.

### Semantic / design language search

Type a descriptive query like:

```
dark mobile fintech dashboard
clean minimal onboarding screen
glassmorphism card ui
```

AssetVault automatically detects design-language terms and expands them into 3 CLIP prompts for multi-vector averaging — yielding better results than a literal text match.

### OCR text search

1. Open **Preview Panel** for an image (select it in the grid).
2. Run "Extract text" (if available) to index the image's text content.
3. After extraction, text from that asset appears in keyword search results.

### Duplicate detection

1. Open the **Duplicate** panel (icon in the toolbar).
2. Click **"Detect duplicates"**.
3. Exact duplicates (same SHA-256 hash) and visual duplicates (high CLIP cosine similarity) are listed in pairs.
4. Click **Dismiss** to hide a pair, or open either asset to inspect.

### Broken path recovery

1. Click **"Recovery"** in the header.
2. The system scans for assets whose file_path no longer exists on disk.
3. For each broken asset, suggested recovery paths (moved files with matching names) are shown.
4. Click **"Apply"** to update the path in the database.

### `.fig` metadata

For `.fig` files in your library, AssetVault can extract:

- **Page names** (approximate)
- **Frame names** (approximate)
- **Component names** (heuristic)

Select a `.fig` asset in the grid → details appear in the preview panel.

> **Limitations**: Figma uses an undocumented binary format. Names are extracted by scanning for UTF-8 strings and may include false positives. The Figma REST API is the only guaranteed source of typed metadata.

### Export

1. Click **"Export"** in the header.
2. Choose **CSV** (spreadsheet-friendly) or **JSON** (machine-readable).
3. The file is saved to your chosen location.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + Vite 5 + TypeScript | UI framework |
| Styling | Tailwind CSS v4 | Utility-first CSS |
| State management | Zustand | Client state + async actions |
| Desktop shell | Tauri v2 | Native desktop bridge |
| Native backend | Rust (stable) | Commands, file I/O, SQLite |
| Database | SQLite 3 (rusqlite bundled) | All metadata + FTS5 search |
| File scanning | WalkDir 2 | Recursive directory traversal |
| File watching | notify 8 | Real-time FS events |
| Image processing | image 0.25 · resvg 0.47 | Thumbnail generation + SVG rasterization |
| Parallel execution | Rayon | Thumbnail batch generation |
| Fuzzy search | fuzzy-matcher (Skim) | Typo-tolerant name matching |
| Hashing | sha2 | SHA-256 file fingerprinting |
| AI embeddings | sentence-transformers + CLIP | 512-dim cross-modal vectors |
| Vector search | FAISS (faiss-cpu) | Nearest-neighbour retrieval |
| OCR | EasyOCR | Multilingual text extraction |
| Design language | Custom vocab + prompt engine | Natural-language query expansion |
| Duplicate detection | Custom CLIP + hash pipeline | Exact + visual de-duplication |


## Features

### Phase 1 (Implemented)
- **File Scan** — Select local folders; recursively indexes image, design, and reference files
- **Metadata Storage** — SQLite database stores path, name, extension, modified time, file size, hash
- **Thumbnail Cache** — Auto-generates JPEG thumbnails for image files (200×200px)
- **Keyword Search** — Fast fuzzy search by file name using Skim matcher
- **Filter Search** — Filter by extension, folder, date range, favorites
- **Folder Watch** — Real-time detection of file add/update/delete using `notify`
- **Preview Panel** — Instant thumbnail preview + metadata without opening external apps
- **Favorites** — Mark/unmark files as favorites
- **Reveal in Explorer** — Open file or show in file explorer
- **Progress Bar** — Visual scan progress during indexing
- **Keyboard Shortcut** — `Ctrl+K` / `Cmd+K` for global search focus

### Phase 2 (Architecture Ready)
- **Semantic Search** — CLIP embeddings via Python sidecar (multilingual: EN/VI/JP)
- **Similar Image Search** — Drag image to find visually similar assets
- FAISS vector index stored locally

### Phase 3 (Planned)
- Auto-tagging with AI
- Duplicate detection by hash
- Similar asset recommendations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind CSS v4 |
| Desktop Shell | Tauri v2 |
| Native Backend | Rust |
| Local Database | SQLite (rusqlite bundled) |
| File Watching | `notify` crate |
| Image Processing | `image` crate |
| Fuzzy Search | `fuzzy-matcher` (Skim algorithm) |
| AI Service | Python sidecar (CLIP + FAISS) |
| State Management | Zustand |

## Architecture

```
React UI (Vite + Tailwind)
   ↓ @tauri-apps/api invoke()
Tauri IPC Bridge
   ↓ #[tauri::command]
Rust Commands (commands.rs)
   ├── scanner.rs → WalkDir file scan
   ├── watcher.rs → notify file watching
   ├── search.rs  → SQLite + fuzzy search
   ├── thumbnail.rs → image crate resize
   ├── hasher.rs  → SHA-256 file hash
   └── db.rs      → SQLite init + schema
   ↓
SQLite (assets.db)
   ↓ JSON-RPC stdio  [Phase 2]
Python Sidecar (CLIP + FAISS)
   ↓
FAISS vector index (faiss.index)
```

## Project Structure

```
manage-asset-app/
├── src/                         # React frontend
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── AssetGrid.tsx
│   │   ├── PreviewPanel.tsx
│   │   └── ScanProgressBar.tsx
│   ├── hooks/
│   │   ├── useScanProgress.ts
│   │   ├── useFileWatcher.ts
│   │   └── useKeyboardShortcuts.ts
│   ├── store/
│   │   └── assetStore.ts
│   ├── lib/
│   │   ├── api.ts
│   │   └── utils.ts
│   └── types/index.ts
├── src-tauri/
│   └── src/
│       ├── lib.rs
│       ├── commands.rs
│       ├── db.rs
│       ├── models.rs
│       ├── scanner.rs
│       ├── watcher.rs
│       ├── search.rs
│       ├── thumbnail.rs
│       ├── hasher.rs
│       ├── file_types.rs
│       └── state.rs
└── python-service/
    ├── main.py
    ├── requirements.txt
    └── setup.sh
```

## Development

```bash
npm install
npm run tauri dev
```

### Build Windows installer
```bash
npm run tauri build
```

### Setup Python service (Phase 2 only)
```bash
cd python-service && bash setup.sh
```

## Data Location

- **Windows**: `%APPDATA%\com.lethanhgiang.asset-vault\`
- **macOS**: `~/Library/Application Support/com.lethanhgiang.asset-vault/`

Original files are never copied. Only metadata + thumbnails are stored locally.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
