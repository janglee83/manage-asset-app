# AssetVault — Full Integration Architecture

**Stack:** React → Tauri 2 → Rust → SQLite (WAL) → Python sidecar → FAISS

---

## System Boot Sequence

```
tauri::Builder::setup()
  │
  ├─ db::init_db()
  │    PRAGMA WAL | FK | cache=32MB | mmap=256MB
  │    CREATE TABLE assets, tags, watched_folders, assets_fts (FTS5)
  │    AppState { db: Arc<Mutex<Connection>>, cache_dir, watcher, sidecar }
  │
  ├─ watcher::start_watching(saved_folders)
  │    notify thread ──raw events──► crossbeam channel ──► debounce thread(500ms)
  │    debounce flush ──► SQLite upsert + Tauri emit("file_changed")
  │
  └─ sidecar::SidecarHandle::spawn("python3", "python-service/main.py")
       std::process::Command { stdin: piped, stdout: piped, stderr: inherit }
       Python sidecar starts:
         _index.load_or_create()          ← reads semantic.faiss + semantic.json
         threading.Thread(_warmup).start() ← lazy-load CLIP models (~440 MB)
         _push("warmup_complete", {...})   ← id=null push → sidecar_event
       background reader thread:
         id: Some(n) → oneshot::Sender from pending map
         id: None    → app.emit("sidecar_event", data)
```

---

## Flow 1 — Keyword Search Request

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REACT (SearchBar.tsx)                                                        │
│                                                                              │
│  <input onChange> ──debounce 300ms──► setSearchQuery({ text })              │
│  useAssetStore.runSearch()                                                   │
│    └─ api.search({ text, extensions, folder, limit, offset, sort_by })      │
│       invoke("search", { query: SearchQuery })                               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ IPC (JSON serialised via serde)
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ TAURI COMMAND  commands::search()                                            │
│                                                                              │
│  search_assets(state.db.clone(), query)                                     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ RUST  search.rs::search_assets()                                             │
│                                                                              │
│  SearchMode::from_str(query.search_mode)  ── "exact" | "partial" | "fuzzy" │
│                                                                              │
│  ┌── EXACT ─────────────────────────────────────────────────────────────┐   │
│  │  SELECT … FROM assets                                                │   │
│  │  WHERE file_name_lower = lower(?1)                                   │   │
│  │  [AND extension = ?N] [AND folder = ?N] [AND modified_at BETWEEN …] │   │
│  │  [AND favorite = 1]                                                  │   │
│  │  ORDER BY {sort_col} DESC LIMIT ? OFFSET ?                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── PARTIAL (default) ─────────────────────────────────────────────────┐   │
│  │  WITH fts AS (                                                        │   │
│  │    SELECT rowid FROM assets_fts                                       │   │
│  │    WHERE assets_fts MATCH '"tok1"* "tok2"*'   ← FTS5 prefix BM25    │   │
│  │  )                                                                    │   │
│  │  SELECT a.* FROM assets a JOIN fts ON a.rowid=fts.rowid              │   │
│  │  [filters…] ORDER BY … LIMIT ? OFFSET ?                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌── FUZZY ─────────────────────────────────────────────────────────────┐   │
│  │  FTS5 prefix → up to 500 candidates in Rust Vec                      │   │
│  │  SkimMatcherV2::fuzzy_match(file_name, text) → score                 │   │
│  │  Sort by skim score DESC, take top-N                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  COUNT(*) query for pagination total                                         │
│  Returns SearchResult { assets: Vec<Asset>, total: i64 }                    │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ SQLITE (WAL, 32MB cache, mmap 256MB)                                         │
│                                                                              │
│  assets table  +  assets_fts (FTS5 virtual table)                           │
│  Indices: file_name_lower, extension, folder, modified_at, favorite         │
│  Composite: (folder, modified_at), (extension, modified_at)                 │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │  SearchResult JSON
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ REACT (AssetGrid.tsx)                                                        │
│                                                                              │
│  set({ assets, total })                                                      │
│  useVirtualizer renders only visible rows                                   │
│  Infinite scroll: loadMore() appends next page on sentinel visibility       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 2 — File Preview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REACT (AssetGrid.tsx → PreviewPanel.tsx)                                     │
│                                                                              │
│  GridCard onClick ──► setSelectedIndex(idx) ──► state.selectedAsset = asset │
│  PreviewPanel renders: metadata (name, size, mtime, hash, tags)             │
│    + thumbnail image (from thumbnailCache[id] if populated)                 │
│    + action buttons: Open, Reveal, Favorite, Delete                          │
│                                                                              │
│  api.openFile(asset.file_path)     → invoke("open_file")                    │
│  api.revealInExplorer(file_path)   → invoke("reveal_in_explorer")           │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ TAURI COMMANDS                                                               │
│                                                                              │
│  open_file:         std::process::Command::new("open").arg(&path)  [macOS]  │
│  reveal_in_explorer:std::process::Command::new("open").args(["-R",&path])   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 3 — Thumbnail Generation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REACT (GridCard.tsx / PreviewPanel.tsx)                                      │
│                                                                              │
│  useEffect → loadThumbnail(asset.id) if isImage(extension)                  │
│    if (thumbnailCache[id]) return  ← memory-cache fast path                 │
│    api.getThumbnail(id) → invoke("get_thumbnail", { id })                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ TAURI COMMAND  commands::get_thumbnail()                                     │
│                                                                              │
│  db.lock() → SELECT thumbnail_path, file_path FROM assets WHERE id=?        │
│  db.unlock()  ← critical: lock released before any blocking I/O             │
│                                                                              │
│  if thumbnail_path EXISTS on disk:                                           │
│    thumbnail_as_base64(path)  → Some("data:image/jpeg;base64,…")           │
│                                                                              │
│  else (on-demand generation):                                                │
│    tokio::task::spawn_blocking(|| generate_thumbnail(&file_p, &cache_dir)) │
│    UPDATE assets SET thumbnail_path=? WHERE id=?                            │
│    thumbnail_as_base64(new_path)                                             │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ RUST  thumbnail.rs::generate_thumbnail()                                     │
│                                                                              │
│  Cache key: SHA-256(file_path_bytes ++ mtime_le_u64)[..24].jpg              │
│    → rotates automatically on file modification (stale = unreachable)       │
│                                                                              │
│  Fast path: if cache_path.exists() → return path immediately                │
│                                                                              │
│  SVG path (resvg):                                                           │
│    usvg::Tree::from_data() → tiny_skia::Pixmap → encode JPEG 85             │
│                                                                              │
│  Raster path (image crate):                                                  │
│    DynamicImage::from_path()                                                 │
│    filter = if scale_ratio > 4.0 { Lanczos3 } else { Triangle }            │
│    resize_to_fill(256, 256, filter)                                          │
│    JpegEncoder::new_with_quality(buf, 85)                                    │
│    write atomically to cache_dir/<hash>.jpg                                  │
│                                                                              │
│  Scanner batch path (rayon):                                                 │
│    generate_thumbnails_batch(entries) ─── par_iter() ──► per-file above     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ "data:image/jpeg;base64,…"
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ REACT                                                                        │
│                                                                              │
│  set({ thumbnailCache: { ...cache, [id]: dataUrl } })                       │
│  <img src={thumb} className="w-full h-full object-cover" loading="lazy" />  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 4A — Semantic Search (Text Query)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REACT (SearchBar.tsx or custom UI)                                           │
│                                                                              │
│  api.semanticSearch({ query: "海辺の風景写真", top_k: 20 })                  │
│  invoke("semantic_search", { query: SemanticSearchQuery })                  │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ TAURI COMMAND  commands::semantic_search()                                   │
│                                                                              │
│  get_sidecar(&state)                                                         │
│    state.sidecar.lock() → Arc<SidecarHandle>.clone()  ← O(1), no blocking  │
│  sidecar.call("search_semantic", { query, top_k, min_score }).await         │
│    next_id.fetch_add(1)                                                      │
│    oneshot::channel() → insert id into pending map                          │
│    stdin.lock() → writeln!(req JSON) + flush()  ← lock released immediately│
│    rx.await  ← tokio parks this future, 0 CPU until response arrives        │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ stdin pipe (UTF-8 newline-delimited JSON)
                                  │ {"id":1,"method":"search_semantic",
                                  │  "params":{"query":"…","top_k":20}}
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ PYTHON  main.py::handle_search_semantic()                                    │
│                                                                              │
│  query = params["query"].strip()                      ← validated           │
│  vecs  = _embedder.encode_texts([query])              ← 512-dim float32     │
│                                                                              │
│  encode_texts() internals (embedder.py):                                    │
│    _txt_model() ← lazy load on first call, cached in _text_model            │
│    SentenceTransformer("clip-ViT-B-32-multilingual-v1")                     │
│    model.encode([query], convert_to_numpy=True, normalize_embeddings=True)  │
│    → ndarray(1, 512) float32, L2-normalised                                 │
│                                                                              │
│  hits = _index.search(vecs[0], top_k=20, min_score=0.15)                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ FAISS  index_manager.py::search()                                            │
│                                                                              │
│  IndexIDMap2(IndexFlatIP(512))                                               │
│    scores, faiss_ids = self._index.search(                                  │
│        vec.reshape(1, -1).astype("float32"), k=top_k                        │
│    )                                                                         │
│    filter: score >= min_score (cosine sim, 0..1 after L2-norm)              │
│    map faiss_ids → uuid strings via meta.fid_to_uuid                        │
│  Returns: List[(uuid_str, float)]  sorted by score desc                     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ stdout pipe
                                  │ {"id":1,"result":{"results":[
                                  │   {"asset_id":"…","score":0.87},…]}}
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ RUST  sidecar.rs reader thread                                               │
│                                                                              │
│  serde_json::from_str::<RpcResponse>(&line)                                 │
│  id: Some(1) → pending.lock().remove(1) → tx.send(Ok(result))              │
│  oneshot rx wakes tokio future in commands::semantic_search()               │
│                                                                              │
│  serde_json::from_value::<Vec<SemanticHit>>(result["results"])              │
│  → SemanticSearchResult { results: Vec<SemanticHit> }                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ SemanticSearchResult JSON
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ REACT (assetStore.ts / AssetGrid.tsx)                                        │
│                                                                              │
│  results = [{ asset_id, score }]                                            │
│  Promise.allSettled(results.map(h => api.getAsset(h.asset_id)))             │
│    → resolves UUIDs to full Asset objects via SQLite                        │
│  set({ imageSearchActive: true, imageSearchResults: [...] })                │
│  AssetGrid renders similarity mode: score % badges, violet banner           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 4B — Image Similarity Search (Drag & Drop)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REACT (ImageSearchDropzone.tsx + useImageSearch.ts)                          │
│                                                                              │
│  listen("tauri://drag-drop", handler)  ← window-level OS drag event         │
│  HTML drag-counter pattern:                                                  │
│    onDragEnter: counter++ → setIsDragOver(true)                              │
│    onDragLeave: counter-- → if(counter<=0) setIsDragOver(false)             │
│    (avoids false-leave when pointer crosses child elements)                  │
│                                                                              │
│  handler: payload.paths.filter(isImageExtension)[0]                         │
│  → runImageSearch(filePath)                                                  │
│    api.searchByImage({ file_path: "/abs/path/query.png", top_k: 30 })      │
│    invoke("search_by_image", { query: ImageSearchQuery })                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ TAURI COMMAND  commands::search_by_image()                                   │
│                                                                              │
│  (same IPC path as semantic_search above)                                   │
│  sidecar.call("search_by_image", { file_path, top_k, min_score }).await     │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ {"id":2,"method":"search_by_image",…}
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ PYTHON  main.py::handle_search_by_image()                                    │
│                                                                              │
│  vecs, failed = _embedder.encode_images([file_path])                        │
│                                                                              │
│  encode_images() internals (embedder.py):                                   │
│    Image.open(file_path).convert("RGB")   ← any format Pillow supports      │
│    _img_model().encode([pil_img],          ← SentenceTransformer CLIP       │
│        convert_to_numpy=True,                 clip-ViT-B-32                  │
│        normalize_embeddings=True)         ← L2-normalised                   │
│    → ndarray(1, 512) float32                                                │
│                                                                              │
│  if failed: return {"results": [], "error": "Cannot open: …"}               │
│  hits = _index.search(vecs[0], top_k, min_score)    ← same FAISS path      │
│  → {"results": [{asset_id, score}, …]}                                      │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ (same return path as Flow 4A)
┌─────────────────────────────────▼───────────────────────────────────────────┐
│ REACT                                                                        │
│                                                                              │
│  Resolved to full Asset objects via api.getAsset() parallel calls           │
│  imageSearchResults: SimilarityResult[] = [{ asset, score }]                │
│  AssetGrid enters similarity mode                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Push Notifications (Sidecar → Frontend)

```
Python sidecar emits push at any time (no request ID):
  {"id": null, "result": {"event": "embed_progress", "data": {"done":32,"total":500}}}
  {"id": null, "result": {"event": "warmup_complete", "data": {...}}}

Rust sidecar reader thread:
  id: None → app.emit("sidecar_event", data)

React (any component):
  import { listen } from "@tauri-apps/api/event";
  await listen("sidecar_event", (e) => {
    if (e.payload.event === "embed_progress") updateProgress(e.payload.data);
    if (e.payload.event === "warmup_complete") setModelsReady(true);
  });
```

---

## File Watcher → Real-time Index Updates

```
OS filesystem event (inotify / kqueue / ReadDirectoryChangesW)
  │
notify::RecommendedWatcher
  │ raw event (path, kind: Create|Modify|Remove)
crossbeam channel (bounded 512)
  │
debounce thread (500ms window, 100ms tick):
  HashMap<PathBuf, PendingEvent>
  coalesce: Remove wins over Create/Modify within window
  skip ACCESS events, temp files (*.tmp, *.part, ~*)
  │ on expiry
  ├── Create/Modify:
  │     hash_file() + generate_thumbnail() + SQLite upsert
  │     app.emit("file_changed", { kind: "upsert", asset })
  └── Remove:
        DELETE FROM assets WHERE file_path = ?
        app.emit("file_changed", { kind: "delete", id })

React useFileWatcher hook:
  listen("file_changed") → runSearch() to refresh grid
```

---

## State Machine — AppState (Rust)

```rust
pub struct AppState {
    pub db:      Arc<Mutex<Connection>>,   // single SQLite connection, WAL mode
    pub cache_dir: PathBuf,                // thumbnails/
    pub db_path:   PathBuf,               // assets.db
    pub watcher:  Mutex<Option<WatcherHandle>>,    // None until first folder added
    pub sidecar:  Mutex<Option<Arc<SidecarHandle>>>, // None if Python unavailable
}
```

Locking discipline:
- `db` lock is held **only for the duration of one SQL statement**, never across `await` points
- `sidecar` lock is acquired to clone the `Arc`, then immediately released before `call().await`
- `watcher` lock is acquired only during `add_path` / `remove_path` — both are O(1)

---

## Data Models — Cross-layer Mapping

```
SQLite row          Rust struct (models.rs)      TypeScript interface (types/index.ts)
─────────────────── ──────────────────────────── ────────────────────────────────────
assets.id           Asset.id: String             Asset.id: string
assets.file_path    Asset.file_path: String       Asset.file_path: string
assets.file_name    Asset.file_name: String       Asset.file_name: string
assets.extension    Asset.extension: String       Asset.extension: string
assets.modified_at  Asset.modified_at: i64        Asset.modified_at: number
assets.file_size    Asset.file_size: i64          Asset.file_size: number
assets.thumbnail_path Asset.thumbnail_path: Option<String> Asset.thumbnail_path?: string
assets.favorite     Asset.favorite: bool          Asset.favorite: boolean

FAISS int64 id      —                             —
  (internal only)   fid_to_uuid / uuid_to_fid maps in schema.py::IndexMeta

search hit          SemanticHit { asset_id, score: f32 }   SemanticHit { asset_id, score }
image search query  ImageSearchQuery { file_path, top_k, min_score }  ImageSearchQuery
resolved hit        —                             SimilarityResult { asset: Asset, score }
```

---

## Embedding Index Lifecycle

```
First launch
  Python sidecar: IndexMeta.load() → schema_version mismatch → create fresh
  warmup thread: load clip-ViT-B-32 + multilingual (~440 MB from HuggingFace cache)
  emit("warmup_complete")

Indexing assets (embed_batch)
  React → embed_batch([{ asset_id, file_path }, …])
  Python:
    encode_images(paths_chunk[0:16])     ← batch_size=16
    index.add_vectors(uuids, vecs)        ← faiss.IndexIDMap2.add_with_ids()
    _push("embed_progress", {done, total})
    index.save()   ← semantic.faiss + semantic.json (atomic write via tmpfile rename)

Removing an asset
  React → removeAsset(id) [SQLite] + Python remove_asset(asset_id)
  Python: IDSelectorBatch(np.array([fid])) → index.remove_ids()
  No full rebuild needed

Schema upgrade (model change)
  schema.py: SCHEMA_VERSION += 1
  On next startup: needs_reindex() → True → index.clear()
  Caller triggers: rebuildSemanticIndex() → re-embed all known assets
```

---

## Security Properties

| Concern | Mitigation |
|---|---|
| SQL injection | All params via positional `?N` placeholders; user strings never concatenated into SQL |
| FTS5 injection | `build_fts_query()` escapes `"` → `""` per FTS5 spec, wraps each token in quotes |
| Path traversal | File paths are opened by OS, not interpolated into shell commands; `open_file` verifies `path.exists()` before delegating to OS |
| IPC spoofing | Tauri IPC restricted to allowed origins; no remote URLs access commands |
| Sidecar stdout | Only newline-delimited JSON parsed by `serde_json`; malformed lines are logged and skipped |
| FAISS IDs | Internal int64 IDs isolated in `IndexMeta`; UUIDs are the only public identifier |
