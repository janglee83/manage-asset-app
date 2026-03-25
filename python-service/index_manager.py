"""
FAISS vector index lifecycle manager.

Index choice
------------
``faiss.IndexIDMap2(faiss.IndexFlatIP(512))``

  ✔ Exact inner-product search (cosine cosine similarity after L2 normalisation)
  ✔ Native removal via remove_ids() — no manual vector reconstruction needed
  ✔ Scales well for local asset libraries (< 500 K items on CPU)
  ✔ No training step required

IndexIDMap2 wraps the inner flat index and maintains an external-ID → internal-
position mapping.  We assign each asset a monotonically-increasing int64 FAISS
ID stored in IndexMeta; this decouples UUID strings from FAISS internals.

Persistence
-----------
  <app_dir>/semantic.faiss      — binary FAISS index
  <app_dir>/semantic.json       — IndexMeta (ID maps, model names, schema version)
  <app_dir>/semantic_meta.json  — AssetMeta store (filename/folder/mtime per asset)
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

from schema import EMBED_DIM, AssetMeta, IndexMeta

log = logging.getLogger(__name__)

FAISS_INDEX_FILE  = "semantic.faiss"
META_FILE         = "semantic.json"
ASSET_META_FILE   = "semantic_meta.json"

# Cosine-similarity threshold below which results are dropped by default.
DEFAULT_MIN_SCORE: float = 0.15
# ── IVFFlat upgrade thresholds ────────────────────────────────────────────────
#
# When ntotal exceeds IVF_THRESHOLD, every rebuild_index call will migrate from
# IndexFlatIP to IndexIVFFlat.  IVFFlat is ~20× faster than Flat for 50 K+
# vectors at <1% accuracy loss, and requires no per-query overhead once trained.
#
# nlist = number of Voronoi cells (sqrt(N) is a common choice).
# nprobe = cells visited per query (higher = more accurate, slower).
# Training requires at least 39 * nlist samples (FAISS guideline).
IVF_THRESHOLD: int = 10_000
IVF_MIN_TRAIN_MULT: int = 39     # FAISS minimum
IVF_NPROBE_FRACTION: float = 0.125  # probe 12.5% of cells (accuracy vs speed)

# How long to wait after the last mutation before flushing to disk.
# 5 s is long enough to coalesce a whole embed_batch in one write.
SAVE_DEBOUNCE_SECS: float = 5.0

class IndexManager:
    """
    Thread-safe FAISS index manager.

    All mutating operations (add, remove, save) should be called from the
    single-threaded JSON-RPC dispatcher to avoid concurrent writes.
    read-only calls (search) are safe to call concurrently because FAISS's
    IndexFlatIP does not modify internal state during search.
    """

    def __init__(self, app_dir: Path) -> None:
        self._app_dir    = app_dir
        self._index      = None           # faiss.IndexIDMap2
        self._meta       = IndexMeta()
        # Per-asset metadata for multi-signal ranking (filename, folder, mtime).
        self._asset_meta: Dict[str, AssetMeta] = {}
        self._meta_dirty: bool = False
        # Background save timer (debounced).
        self._save_timer: Optional[threading.Timer] = None

    # ── Initialization ────────────────────────────────────────────────────────

    def load_or_create(self) -> bool:
        """
        Load an existing index from disk, or create a fresh one.

        Returns True if data was loaded from disk, False if created fresh.
        If the persisted schema version is stale, the index is discarded and
        re-created so the caller can trigger a full re-index.
        """
        import faiss  # deferred — not needed until first use

        meta_path  = self._app_dir / META_FILE
        index_path = self._app_dir / FAISS_INDEX_FILE
        meta = IndexMeta.load(meta_path)

        # Wipe stale data so embeddings from old models are not mixed with new.
        if meta.needs_reindex():
            log.warning(
                "[index] Schema version mismatch (persisted=%d, current=%d). "
                "Index will be rebuilt.",
                meta.schema_version,
                meta.schema_version,
            )
            self._meta  = IndexMeta()
            self._index = self._fresh_index(faiss)
            return False

        if index_path.exists():
            try:
                self._index = faiss.read_index(str(index_path))
                self._meta  = meta
                log.info("[index] Loaded %d vectors from disk.", meta.total)
                self._load_asset_meta()
                return True
            except Exception as exc:
                log.error("[index] Failed to load index: %s. Creating fresh.", exc)

        self._meta  = IndexMeta()
        self._index = self._fresh_index(faiss)
        return False

    def _load_asset_meta(self) -> None:
        """Load per-asset metadata from semantic_meta.json, ignoring errors."""
        path = self._app_dir / ASSET_META_FILE
        if not path.exists():
            return
        try:
            raw: dict = json.loads(path.read_text(encoding="utf-8"))
            self._asset_meta = {
                k: AssetMeta(**v) for k, v in raw.items()
                if isinstance(v, dict)
            }
            log.info("[index] Loaded metadata for %d assets.", len(self._asset_meta))
        except Exception as exc:
            log.warning("[index] Could not load asset metadata: %s", exc)
            self._asset_meta = {}

    @staticmethod
    def _fresh_index(faiss, *, use_ivf: bool = False, ntotal: int = 0):
        """Create an IndexIDMap2 wrapping either FlatIP or IVFFlat."""
        if use_ivf and ntotal >= IVF_THRESHOLD:
            nlist = max(64, int(math.sqrt(ntotal)))
            quantizer = faiss.IndexFlatIP(EMBED_DIM)
            inner     = faiss.IndexIVFFlat(quantizer, EMBED_DIM, nlist,
                                           faiss.METRIC_INNER_PRODUCT)
            log.info("[index] Using IVFFlat (nlist=%d) for %d vectors.", nlist, ntotal)
            return faiss.IndexIDMap2(inner)
        inner = faiss.IndexFlatIP(EMBED_DIM)
        return faiss.IndexIDMap2(inner)

    # ── Persistence ───────────────────────────────────────────────────────────

    def save(self) -> None:
        import faiss

        self._app_dir.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self._index, str(self._app_dir / FAISS_INDEX_FILE))
        self._meta.total = self._index.ntotal
        self._meta.save(self._app_dir / META_FILE)
        self.save_meta()

    def save_meta(self) -> None:
        """Flush the per-asset metadata store to semantic_meta.json."""
        if not self._meta_dirty:
            return
        self._app_dir.mkdir(parents=True, exist_ok=True)
        path = self._app_dir / ASSET_META_FILE
        path.write_text(
            json.dumps({k: asdict(v) for k, v in self._asset_meta.items()}, indent=2),
            encoding="utf-8",
        )
        self._meta_dirty = False

    def schedule_save(self) -> None:
        """
        Start (or restart) a debounced background timer that flushes the index
        to disk SAVE_DEBOUNCE_SECS after the last call.

        This prevents a synchronous 200 MB write on every single embed_asset
        call when the user triggers rapid re-indexing.  The Rust host does not
        need to wait for the flush since the data is already in RAM.
        """
        if self._save_timer is not None:
            self._save_timer.cancel()
        self._save_timer = threading.Timer(SAVE_DEBOUNCE_SECS, self._background_save)
        self._save_timer.daemon = True
        self._save_timer.start()

    def _background_save(self) -> None:
        """Called by the debounce timer on a background thread."""
        self._save_timer = None
        try:
            self.save()
            log.info("[index] Background save complete (%d vectors).", self._index.ntotal if self._index else 0)
        except Exception as exc:
            log.error("[index] Background save failed: %s", exc)

    def rebuild_with_upgrade(self) -> int:
        """
        Rebuild the FAISS index in-place, migrating to IVFFlat when ntotal
        exceeds IVF_THRESHOLD.

        Steps:
          1. Extract all valid (fid, vector) pairs from the current index.
          2. Decide whether FlatIP or IVFFlat is appropriate.
          3. Train (IVFFlat only) on the full set of vectors.
          4. Re-add all vectors.
          5. Save.

        Returns the number of vectors in the new index.
        """
        import faiss

        if self._index is None or self._index.ntotal == 0:
            return 0

        total = self._index.ntotal
        log.info("[index] Rebuilding index (%d vectors) ...", total)

        # Extract all current (external_id, vector) pairs.
        valid_fids = list(self._meta.fid_to_uuid.keys())
        if not valid_fids:
            return 0

        vecs = np.zeros((len(valid_fids), EMBED_DIM), dtype=np.float32)
        for i, fid in enumerate(valid_fids):
            try:
                self._index.reconstruct(fid, vecs[i])
            except Exception:
                pass  # keep zero vector; it gets filtered by min_score at query time

        fids_arr = np.array(valid_fids, dtype=np.int64)

        # Build the new index (IVFFlat when large enough).
        use_ivf = total >= IVF_THRESHOLD
        new_index = self._fresh_index(faiss, use_ivf=use_ivf, ntotal=total)

        if use_ivf:
            nlist = max(64, int(math.sqrt(total)))
            min_train = IVF_MIN_TRAIN_MULT * nlist
            n_train   = min(total, max(min_train, total))
            train_vecs = vecs[:n_train]
            log.info("[index] Training IVFFlat on %d vectors ...", len(train_vecs))
            new_index.index.train(train_vecs)  # type: ignore[attr-defined]

        new_index.add_with_ids(vecs, fids_arr)
        self._index = new_index
        self._meta.index_type = "ivf" if use_ivf else "flat"
        self.save()
        return self._index.ntotal

    # ── Mutation ──────────────────────────────────────────────────────────────

    def add_vectors(
        self,
        asset_uuids: List[str],
        vectors: np.ndarray,
        failed_indices: List[int],
        *,
        save: bool = True,
    ) -> List[str]:
        """
        Add / update embeddings for a list of assets.

        Parameters
        ----------
        asset_uuids    : parallel list of asset UUIDs.
        vectors        : float32 array of shape (len(asset_uuids), EMBED_DIM).
                         Rows at `failed_indices` must be zero-filled (they are skipped).
        failed_indices : indices of assets whose image could not be opened.
        save           : persist to disk after mutation (default True).

        Returns
        -------
        List of UUIDs that were actually indexed (i.e. not in failed_indices).
        """
        import faiss

        failed_set = set(failed_indices)
        to_add_uuids: List[str] = []
        to_add_vecs:  List[np.ndarray] = []
        to_add_fids:  List[int] = []

        for i, uuid in enumerate(asset_uuids):
            if i in failed_set:
                continue

            # Remove old vector if this asset is being re-indexed.
            old_fid = self._meta.uuid_to_fid.get(uuid)
            if old_fid is not None:
                sel = faiss.IDSelectorBatch(
                    np.array([old_fid], dtype=np.int64)
                )
                self._index.remove_ids(sel)
                self._meta.release_fid(uuid)

            fid = self._meta.alloc_fid(uuid)
            to_add_uuids.append(uuid)
            to_add_vecs.append(vectors[i])
            to_add_fids.append(fid)

        if to_add_vecs:
            mat  = np.stack(to_add_vecs, axis=0)
            fids = np.array(to_add_fids, dtype=np.int64)
            self._index.add_with_ids(mat, fids)

        if save and to_add_vecs:
            self.save()

        return to_add_uuids

    def remove_asset(self, asset_uuid: str) -> bool:
        """
        Remove an asset's embedding.  Returns True if the asset was found.
        """
        import faiss

        fid = self._meta.release_fid(asset_uuid)
        if fid is None:
            return False

        sel = faiss.IDSelectorBatch(np.array([fid], dtype=np.int64))
        self._index.remove_ids(sel)
        self._asset_meta.pop(asset_uuid, None)
        self._meta_dirty = True
        self.save()
        return True

    def clear(self) -> None:
        """Wipe the entire index and metadata."""
        import faiss
        self._meta       = IndexMeta()
        self._index      = self._fresh_index(faiss)
        self._asset_meta = {}
        self._meta_dirty = True
        self.save()

    # ── Asset metadata (for ranking) ─────────────────────────────────────────

    def update_meta_from_path(self, asset_uuid: str, file_path: str) -> None:
        """
        Derive and store ranking metadata from *file_path*.

        Extracts filename, parent folder, and filesystem modification time
        so the ranker can compute keyword, recency, and folder signals
        without a database round-trip.
        """
        try:
            p = Path(file_path)
            mtime = p.stat().st_mtime if p.exists() else 0.0
        except OSError:
            mtime = 0.0
        self._asset_meta[asset_uuid] = AssetMeta(
            filename    = os.path.basename(file_path),
            folder_path = str(Path(file_path).parent),
            modified_at = mtime,
        )
        self._meta_dirty = True

    def get_meta(self, asset_uuid: str) -> Optional[AssetMeta]:
        """Return the stored AssetMeta for *asset_uuid*, or None."""
        return self._asset_meta.get(asset_uuid)

    # ── Querying ──────────────────────────────────────────────────────────────

    def search(
        self,
        query_vec: np.ndarray,
        top_k: int = 20,
        min_score: float = DEFAULT_MIN_SCORE,
    ) -> List[Tuple[str, float]]:
        """
        Return the top-k most similar assets.

        Parameters
        ----------
        query_vec : float32 array of shape (1, EMBED_DIM) or (EMBED_DIM,).
        top_k     : maximum number of results.
        min_score : inner-product threshold; results below this are dropped.

        Returns
        -------
        List of (asset_uuid, score) tuples, sorted by score descending.
        """
        if self._index is None or self._index.ntotal == 0:
            return []

        vec = query_vec.reshape(1, EMBED_DIM).astype(np.float32)
        k   = min(top_k, self._index.ntotal)

        # For IVFFlat: set nprobe proportional to nlist for accuracy/speed balance.
        # For FlatIP:  no-op (nprobe is not an attribute of flat indexes).
        inner = getattr(self._index, "index", None)
        if inner is not None and hasattr(inner, "nprobe"):
            nlist  = getattr(inner, "nlist", 64)
            nprobe = max(1, int(nlist * IVF_NPROBE_FRACTION))
            inner.nprobe = nprobe

        scores, fids = self._index.search(vec, k)

        results: List[Tuple[str, float]] = []
        for score, fid in zip(scores[0], fids[0]):
            if fid < 0:           # FAISS returns -1 for empty slots
                continue
            if score < min_score:
                continue
            uuid = self._meta.fid_to_uuid.get(int(fid))
            if uuid is not None:
                results.append((uuid, float(score)))

        return results

    # ── Stats ─────────────────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "total":      self._index.ntotal if self._index else 0,
            "dimension":  self._meta.dimension,
            "index_type": self._meta.index_type,
            "image_model": self._meta.image_model,
            "text_model":  self._meta.text_model,
            "schema_version": self._meta.schema_version,
            "needs_reindex":  self._meta.needs_reindex(),
        }

    def has_asset(self, asset_uuid: str) -> bool:
        return self._meta.has_asset(asset_uuid)

    def get_vector(self, asset_uuid: str):
        """Return the FAISS-stored float32 vector for one asset, or None."""
        import numpy as np
        fid = self._meta.uuid_to_fid.get(asset_uuid)
        if fid is None or self._index is None:
            return None
        try:
            vec = np.empty(EMBED_DIM, dtype=np.float32)
            self._index.reconstruct(fid, vec)
            return vec
        except Exception:
            return None

    def get_all_vectors(self):
        """
        Return (uuids, vectors) for all indexed assets.

        Returns
        -------
        uuids   : list of str
        vectors : np.ndarray of shape (n, EMBED_DIM), float32
        """
        import numpy as np
        with self._lock:
            valid_fids = list(self._meta.fid_to_uuid.keys())
            if not valid_fids or self._index is None:
                return [], np.empty((0, EMBED_DIM), dtype=np.float32)
            uuids = [self._meta.fid_to_uuid[fid] for fid in valid_fids]
            vecs  = np.zeros((len(valid_fids), EMBED_DIM), dtype=np.float32)
            for i, fid in enumerate(valid_fids):
                try:
                    self._index.reconstruct(fid, vecs[i])
                except Exception:
                    pass
        return uuids, vecs

    # ── Ranked search ─────────────────────────────────────────────────────────

    def search_ranked(
        self,
        query_vec:         np.ndarray,
        query_text:        str,
        ranker:            object,
        top_k:             int = 20,
        min_score:         float = DEFAULT_MIN_SCORE,
        favorite_ids:      Optional[Set[str]] = None,
        folder_priorities: Optional[list] = None,
        weights:           Optional[object] = None,
        enable_keyword:    bool = True,
    ) -> list:
        """
        Retrieve FAISS candidates and re-rank them using multi-signal scoring.

        An over-sized candidate pool is fetched from FAISS first
        (``ranker.fetch_k(top_k)`` candidates) so that assets with lower
        pure-semantic scores but strong keyword/recency/favorite/folder signals
        can still surface in the final top-*top_k*.

        A relaxed semantic threshold (``min_score * 0.5``) is used for the
        FAISS phase to preserve broadly relevant candidates for re-ranking.

        Parameters
        ----------
        ranker            Ranker instance (imported from ranker.py).
        favorite_ids      UUIDs of favourited assets (injected by Rust).
        folder_priorities FolderPriority rules (passed from the frontend).
        weights           RankWeights (defaults to module defaults).
        enable_keyword    False for image-based search.
        """
        from ranker import RankWeights as RW

        fetch_k   = ranker.fetch_k(top_k)
        # Use a relaxed threshold so recency/favorite/folder signals can
        # rescue semantically borderline but otherwise highly relevant files.
        faiss_min = max(0.0, min_score * 0.5)
        candidates = self.search(query_vec, top_k=fetch_k, min_score=faiss_min)

        return ranker.rank(
            candidates        = candidates,
            query_text        = query_text,
            meta_lookup       = self.get_meta,
            favorite_ids      = favorite_ids or set(),
            folder_priorities = folder_priorities or [],
            weights           = weights if weights is not None else RW(),
            top_k             = top_k,
            enable_keyword    = enable_keyword,
        )
