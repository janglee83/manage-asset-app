"""
AssetVault Python Sidecar Service
Phase 2: Semantic search using CLIP + FAISS
Communicates with Tauri Rust via stdio JSON-RPC
"""

from __future__ import annotations

import sys
import json
import os
import pickle
from pathlib import Path
from typing import Optional, List, Dict, Any


# ── Lazy imports (only loaded when actually needed) ────────────────────────────
_clip_model = None
_clip_preprocess = None
_faiss_index = None
_asset_ids: List[str] = []  # Maps FAISS index position → asset id


def _get_app_dir() -> Path:
    """Returns data directory for storing faiss index and embeddings."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path.home() / ".local" / "share"
    d = base / "com.lethanhgiang.asset-vault"
    d.mkdir(parents=True, exist_ok=True)
    return d


APP_DIR = _get_app_dir()
FAISS_INDEX_PATH = APP_DIR / "faiss.index"
ASSET_IDS_PATH = APP_DIR / "asset_ids.pkl"


def _load_clip():
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        import torch
        import clip  # openai-clip
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device)
    return _clip_model, _clip_preprocess


def _load_faiss():
    global _faiss_index, _asset_ids
    if _faiss_index is None:
        import faiss
        if FAISS_INDEX_PATH.exists():
            _faiss_index = faiss.read_index(str(FAISS_INDEX_PATH))
            if ASSET_IDS_PATH.exists():
                with open(ASSET_IDS_PATH, "rb") as f:
                    _asset_ids = pickle.load(f)
        else:
            # Create fresh 512-dim (CLIP ViT-B/32) flat L2 index
            _faiss_index = faiss.IndexFlatIP(512)
            _asset_ids = []
    return _faiss_index, _asset_ids


def _save_faiss():
    import faiss
    index, ids = _load_faiss()
    faiss.write_index(index, str(FAISS_INDEX_PATH))
    with open(ASSET_IDS_PATH, "wb") as f:
        pickle.dump(ids, f)


# ── Handlers ──────────────────────────────────────────────────────────────────

def handle_health(_params: Dict) -> Dict:
    return {"status": "ok", "version": "0.1.0"}


def handle_embed_image(params: Dict) -> Dict:
    """Generate and store CLIP embedding for an image file."""
    import torch
    import numpy as np
    from PIL import Image

    file_path: str = params["file_path"]
    asset_id: str = params["asset_id"]

    model, preprocess = _load_clip()
    index, ids = _load_faiss()

    img = preprocess(Image.open(file_path).convert("RGB")).unsqueeze(0)
    with torch.no_grad():
        vec = model.encode_image(img).float().cpu().numpy()
    # L2 normalize for cosine similarity via inner product
    vec = vec / (np.linalg.norm(vec, axis=1, keepdims=True) + 1e-8)

    index.add(vec)
    ids.append(asset_id)
    _save_faiss()

    return {"asset_id": asset_id, "ok": True}


def handle_search_text(params: Dict) -> Dict:
    """Semantic text search: returns ranked list of asset_ids."""
    import torch
    import clip
    import numpy as np

    query: str = params["query"]
    top_k: int = params.get("top_k", 20)

    model, _ = _load_clip()
    index, ids = _load_faiss()

    if index.ntotal == 0:
        return {"results": []}

    tokens = clip.tokenize([query])
    with torch.no_grad():
        vec = model.encode_text(tokens).float().cpu().numpy()
    vec = vec / (np.linalg.norm(vec, axis=1, keepdims=True) + 1e-8)

    k = min(top_k, index.ntotal)
    scores, indices = index.search(vec, k)

    results = [
        {"asset_id": ids[i], "score": float(scores[0][rank])}
        for rank, i in enumerate(indices[0])
        if i >= 0
    ]
    return {"results": results}


def handle_search_image(params: Dict) -> Dict:
    """Similar image search by file path."""
    import torch
    import numpy as np
    from PIL import Image

    file_path: str = params["file_path"]
    top_k: int = params.get("top_k", 20)

    model, preprocess = _load_clip()
    index, ids = _load_faiss()

    if index.ntotal == 0:
        return {"results": []}

    img = preprocess(Image.open(file_path).convert("RGB")).unsqueeze(0)
    with torch.no_grad():
        vec = model.encode_image(img).float().cpu().numpy()
    vec = vec / (np.linalg.norm(vec, axis=1, keepdims=True) + 1e-8)

    k = min(top_k, index.ntotal)
    scores, indices = index.search(vec, k)

    results = [
        {"asset_id": ids[i], "score": float(scores[0][rank])}
        for rank, i in enumerate(indices[0])
        if i >= 0
    ]
    return {"results": results}


def handle_remove_asset(params: Dict) -> Dict:
    """Remove an asset embedding from the index (requires rebuild)."""
    asset_id: str = params["asset_id"]
    import faiss
    import numpy as np

    index, ids = _load_faiss()

    if asset_id not in ids:
        return {"ok": True}

    # FAISS flat index doesn't support deletion; rebuild without the asset
    pos = ids.index(asset_id)
    ids.pop(pos)

    # Re-add all vectors except the removed one
    all_vecs = index.reconstruct_n(0, index.ntotal)  # (N, 512)
    new_vecs = np.delete(all_vecs, pos, axis=0)

    new_index = faiss.IndexFlatIP(512)
    if new_vecs.shape[0] > 0:
        new_index.add(new_vecs)

    global _faiss_index
    _faiss_index = new_index
    _save_faiss()

    return {"ok": True}


HANDLERS = {
    "health": handle_health,
    "embed_image": handle_embed_image,
    "search_text": handle_search_text,
    "search_image": handle_search_image,
    "remove_asset": handle_remove_asset,
}


# ── JSON-RPC stdio loop ────────────────────────────────────────────────────────

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req: Dict = json.loads(line)
            method: str = req.get("method", "")
            params: Dict = req.get("params", {})
            req_id = req.get("id")

            handler = HANDLERS.get(method)
            if handler is None:
                response = {
                    "id": req_id,
                    "error": f"Unknown method: {method}",
                }
            else:
                result = handler(params)
                response = {"id": req_id, "result": result}

        except Exception as exc:
            response = {
                "id": req.get("id") if "req" in dir() else None,
                "error": str(exc),
            }

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
