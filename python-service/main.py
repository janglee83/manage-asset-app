"""
AssetVault Semantic Search Sidecar.

Transport: stdin/stdout JSON-RPC (newline-delimited).

Request:  {"id": <uint64>, "method": "<name>", "params": {...}}
Response: {"id": <uint64>, "result": {...}}
Push:     {"id": null, "result": {"event": "<name>", "data": {...}}}

Push events:
  embed_progress  - during embed_batch: data: {done, total}
  warmup_complete - after model load:   data: {model_info, needs_reindex}

Methods:
  health            {}                                    -> {status, version, model_info, index}
  embed_asset       {asset_id, file_path, force?}         -> {ok, already_indexed}
  embed_batch       {entries, skip_indexed?, batch_size?} -> {indexed, skipped, errors}
  remove_asset      {asset_id}                            -> {ok}
  search_semantic   {query, top_k?, min_score?,           -> {results:[{asset_id, score,
                     weights?, favorite_ids?,                ranked_score, signals}]}
                     folder_priorities?}
  search_by_image   {file_path, top_k?, min_score?,       -> {results:[{asset_id, score,
                     weights?, favorite_ids?,                ranked_score, signals}]}
                     folder_priorities?}
  rebuild_index     {}                                    -> {ok, total_evicted}
  get_index_stats   {}                                    -> {total, dimension, ...}

Ranking params (search_semantic / search_by_image)
--------------------------------------------------
  weights           {semantic, keyword, recency, favorite, folder}  (floats, default
                    0.60/0.15/0.10/0.10/0.05 — re-normalised automatically)
  favorite_ids      ["uuid", ...]  injected by the Rust host from the SQLite database
  folder_priorities [{"prefix": "/path", "boost": 0.9}, ...]  from app settings

  detect_duplicates {asset_hashes, similarity_threshold?, max_neighbours?,  -> {exact_pairs,
                     skip_exact?, skip_similar?}                                similar_pairs,
                                                                               total_exact,
                                                                               total_similar,
                                                                               threshold}

  asset_hashes: [{"asset_id": str, "hash": str|null}, ...]
    Each entry corresponds to one row from the assets table.  Assets without a
    hash (null) are ignored for exact detection.  All indexed assets are scanned
    for visual duplicates regardless of whether a hash is present.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# IMPORTANT: Set thread-count limits BEFORE any scientific library is imported.
#
# On macOS, OpenBLAS / OpenMP create a shared semaphore for their thread pool.
# If the semaphore is not released cleanly (e.g. due to a crash or unexpected
# exit), Python's resource_tracker warns at shutdown and the process may be
# killed by the OS.  Restricting each library to 1 thread prevents semaphore
# creation entirely and also avoids the over-subscription that causes crashes
# on Python 3.9 from macOS CommandLineTools.
# ---------------------------------------------------------------------------
import os

os.environ.setdefault("OMP_NUM_THREADS",         "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS",    "1")
os.environ.setdefault("MKL_NUM_THREADS",         "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS",  "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS",     "1")
# Prevents HuggingFace fast tokenizers from spawning child processes.
os.environ.setdefault("TOKENIZERS_PARALLELISM",  "false")
# Silence the PyTorch "fork safety" warning; we never use torch.multiprocessing.
os.environ.setdefault("PYTHONWARNINGS", "ignore::UserWarning:multiprocessing")

import json
import logging
import sys
import threading
from pathlib import Path
from typing import Any, Dict

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("sidecar")


def _app_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path.home() / ".local" / "share"
    d = base / "com.lethanhgiang.asset-vault" / "semantic"
    d.mkdir(parents=True, exist_ok=True)
    return d


APP_DIR: Path = _app_dir()

from embedder import Embedder
from index_manager import IndexManager
from ranker import Ranker
from tagger import Tagger
from design_language import DesignQueryParser
from sidecar_handlers import SidecarContext, build_handlers

_embedder      = Embedder()
_index         = IndexManager(APP_DIR)
_ranker        = Ranker()
_tagger        = Tagger()
_design_parser = DesignQueryParser()
_stdout_lock   = threading.Lock()


def _push(event: str, data: Any) -> None:
    msg = json.dumps({"id": None, "result": {"event": event, "data": data}})
    with _stdout_lock:
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()


_ctx = SidecarContext(
    embedder=_embedder,
    index=_index,
    ranker=_ranker,
    tagger=_tagger,
    design_parser=_design_parser,
    push=_push,
)
HANDLERS = build_handlers(_ctx)

def _startup() -> None:
    needs_rebuild = not _index.load_or_create()
    if needs_rebuild:
        log.info("[sidecar] Index schema stale -- full re-index required.")

    def _warmup():
        try:
            _embedder.warmup()
            _push("warmup_complete", {
                "model_info":    _embedder.model_info(),
                "needs_reindex": needs_rebuild,
            })
            log.info("[sidecar] Warmup complete.")
            # Pre-load EasyOCR models in the background so the first OCR
            # request doesn't block on model initialisation.
            try:
                from ocr import warm_up as _ocr_warm_up, DEFAULT_LANGS
                _ocr_warm_up(DEFAULT_LANGS)
                log.info("[sidecar] OCR models ready.")
            except Exception as ocr_exc:
                log.warning("[sidecar] OCR warmup skipped: %s", ocr_exc)
        except Exception as exc:
            log.error("[sidecar] Warmup failed: %s", exc)

    threading.Thread(target=_warmup, daemon=True).start()


# ---------------------------------------------------------------------------
# JSON-RPC stdio loop
# ---------------------------------------------------------------------------

def main() -> None:
    _startup()

    for raw_line in sys.stdin.buffer:
        line = raw_line.strip()
        if not line:
            continue

        req_id = None
        try:
            req    = json.loads(line)
            req_id = req.get("id")
            method = str(req.get("method", ""))
            params = req.get("params") or {}

            handler = HANDLERS.get(method)
            if handler is None:
                raise ValueError(f"Unknown method: {method!r}")

            result   = handler(params)
            response = {"id": req_id, "result": result}

        except Exception as exc:
            log.exception("[sidecar] Error handling request id=%s", req_id)
            response = {"id": req_id, "error": str(exc)}

        with _stdout_lock:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
