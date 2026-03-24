# AssetVault

Local-first desktop application for searching and managing design assets (images, design files, reference files) stored directly on your computer — no internet required.

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
