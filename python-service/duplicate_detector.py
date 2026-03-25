"""
Duplicate asset detection pipeline.

Two detection modes
-------------------
exact
    SHA-256 hash comparison: assets with identical hashes are byte-perfect
    duplicates regardless of filename or folder.  Hashes are passed in from
    the SQLite database by the Rust host — no extra I/O required.

similar
    CLIP cosine-similarity: every pair of indexed assets whose inner-product
    score exceeds *similarity_threshold* is reported as a visual duplicate.
    Uses the FAISS index for efficient batch retrieval instead of an O(n²)
    pairwise scan.

Algorithm for similar detection (O(n · k) via FAISS)
------------------------------------------------------
For each embedded asset we query the FAISS index for its *k* nearest
neighbours (k = max_neighbours, default 10) and collect pairs whose score
exceeds the threshold.  Because the query asset itself is always the nearest
neighbour (score ≈ 1.0) we skip scores ≥ SELF_SCORE_CUTOFF.  Pairs are
normalised so asset_a < asset_b (lexicographic) to avoid duplicates.

Complexity
    FAISS inner-product search: O(n · EMBED_DIM) per query ≈ O(n) for flat index
    Total: O(n · k) calls × O(n) each = O(n²) worst case,
    but k is small (default 10) so in practice ≈ O(10n) vector operations.

Outputs
-------
Dicts ready for direct insertion into the duplicate_pairs SQLite table:

    {
        "asset_a":    str,   # UUID; always < asset_b lexicographically
        "asset_b":    str,   # UUID
        "dup_type":   "exact" | "similar",
        "similarity": float  # 1.0 for exact; CLIP score for similar
    }
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

log = logging.getLogger(__name__)

# Two vectors from the same asset whose score ≈ 1.0 — skip self-matches.
_SELF_SCORE_CUTOFF: float = 0.9999


# ---------------------------------------------------------------------------
# Exact duplicate detection (hash-based)
# ---------------------------------------------------------------------------

def detect_exact(
    asset_hashes: List[Dict],
) -> List[Dict]:
    """
    Find exact duplicates by grouping assets with the same SHA-256 hash.

    Parameters
    ----------
    asset_hashes
        List of ``{"asset_id": str, "hash": str}`` dicts.
        Assets with a ``None`` / empty hash are silently skipped.

    Returns
    -------
    List of duplicate-pair dicts (see module docstring).
    """
    # Group asset IDs by hash
    groups: Dict[str, List[str]] = defaultdict(list)
    for entry in asset_hashes:
        h = entry.get("hash") or ""
        if h:
            groups[h].append(str(entry["asset_id"]))

    pairs: List[Dict] = []
    for ids in groups.values():
        if len(ids) < 2:
            continue
        # Enumerate every unordered pair within the group
        ids_sorted = sorted(ids)
        for i in range(len(ids_sorted)):
            for j in range(i + 1, len(ids_sorted)):
                pairs.append({
                    "asset_a":    ids_sorted[i],
                    "asset_b":    ids_sorted[j],
                    "dup_type":   "exact",
                    "similarity": 1.0,
                })

    log.info("[dup] Exact: found %d pairs from %d groups.",
             len(pairs), sum(1 for g in groups.values() if len(g) >= 2))
    return pairs


# ---------------------------------------------------------------------------
# Visual duplicate detection (FAISS embedding similarity)
# ---------------------------------------------------------------------------

def detect_similar(
    index_manager,
    similarity_threshold: float = 0.92,
    max_neighbours: int = 10,
    exclude_pairs: Optional[Set[Tuple[str, str]]] = None,
) -> List[Dict]:
    """
    Find visually similar asset pairs using FAISS nearest-neighbour search.

    Parameters
    ----------
    index_manager
        An ``IndexManager`` instance with a loaded FAISS index.
    similarity_threshold
        Minimum cosine similarity (CLIP inner-product after L2 normalisation)
        to classify a pair as "similar".  Range: [0, 1].
        Recommended values:
          0.98+ : near-identical (different crop/resize/format)
          0.92  : strongly similar (same subject, different lighting)
          0.85  : visually related (same scene/theme)
    max_neighbours
        Maximum nearest neighbours to retrieve per asset.  Higher values
        catch more distant duplicates but increase runtime linearly.
    exclude_pairs
        Set of (asset_a, asset_b) tuples (already normalised lexicographically)
        to skip; used to avoid re-reporting known exact duplicates.

    Returns
    -------
    List of duplicate-pair dicts (see module docstring).
    """
    import faiss

    if index_manager._index is None or index_manager._index.ntotal < 2:
        log.info("[dup] Similar: index is empty or has < 2 vectors; skipping.")
        return []

    idx        = index_manager._index
    meta       = index_manager._meta
    total      = idx.ntotal
    k          = min(max_neighbours + 1, total)  # +1 to include self
    seen_pairs: Set[Tuple[str, str]] = set(exclude_pairs or [])
    pairs: List[Dict] = []

    # Reconstruct all stored vectors in one batch for efficiency.
    # IndexIDMap2 does not expose a bulk reconstruct_n directly — we iterate
    # over all known FAISS IDs from the metadata map.
    known_fids  = sorted(meta.fid_to_uuid.keys())
    if not known_fids:
        return []

    n           = len(known_fids)
    fid_arr     = np.array(known_fids, dtype=np.int64)

    # Reconstruct stored vectors (shape: [n, EMBED_DIM])
    from schema import EMBED_DIM
    all_vecs = np.zeros((n, EMBED_DIM), dtype=np.float32)
    for i, fid in enumerate(known_fids):
        try:
            idx.reconstruct(fid, all_vecs[i])
        except Exception:
            # Slot not present (e.g. removed asset with gap in IDs)
            all_vecs[i] = 0.0

    # Batch search: query every vector against the index
    scores_matrix, fids_matrix = idx.search(all_vecs, k)

    for i, query_fid in enumerate(known_fids):
        uid_a = meta.fid_to_uuid.get(query_fid)
        if uid_a is None:
            continue

        for score, neighbour_fid in zip(scores_matrix[i], fids_matrix[i]):
            if neighbour_fid < 0:          # FAISS padding
                continue
            if score >= _SELF_SCORE_CUTOFF:  # skip self
                continue
            if score < similarity_threshold:
                break                       # results are sorted descending

            uid_b = meta.fid_to_uuid.get(int(neighbour_fid))
            if uid_b is None:
                continue

            # Normalise pair order to prevent (a,b) and (b,a) duplicates.
            pair_key = (min(uid_a, uid_b), max(uid_a, uid_b))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            pairs.append({
                "asset_a":    pair_key[0],
                "asset_b":    pair_key[1],
                "dup_type":   "similar",
                "similarity": round(float(score), 6),
            })

    log.info("[dup] Similar: found %d pairs (threshold=%.3f, k=%d, n=%d).",
             len(pairs), similarity_threshold, max_neighbours, n)
    return pairs


# ---------------------------------------------------------------------------
# Combined pipeline
# ---------------------------------------------------------------------------

def run_pipeline(
    index_manager,
    asset_hashes: List[Dict],
    similarity_threshold: float = 0.92,
    max_neighbours: int = 10,
    skip_exact: bool = False,
    skip_similar: bool = False,
) -> Dict:
    """
    Run both detection stages and return a combined result dict.

    Parameters
    ----------
    index_manager     IndexManager instance (required for similar detection).
    asset_hashes      ``[{"asset_id", "hash"}, ...]`` from SQLite.
    similarity_threshold  CLIP cosine-similarity cutoff for 'similar' pairs.
    max_neighbours    FAISS k for the nearest-neighbour step.
    skip_exact        Skip the hash-based stage.
    skip_similar      Skip the CLIP embedding stage.

    Returns
    -------
    {
        "exact_pairs":   [...],   # sorted list of exact-dup dicts
        "similar_pairs": [...],   # sorted list of similar-dup dicts
        "total_exact":   int,
        "total_similar": int,
        "threshold":     float,
    }
    """
    exact_pairs: List[Dict]   = []
    similar_pairs: List[Dict] = []

    if not skip_exact:
        exact_pairs = detect_exact(asset_hashes)

    # Build the exclude set from exact pairs so we don't double-report them
    # as "similar" (exact duplicates will always have similarity ≈ 1.0).
    exact_pair_keys: Set[Tuple[str, str]] = {
        (p["asset_a"], p["asset_b"]) for p in exact_pairs
    }

    if not skip_similar:
        similar_pairs = detect_similar(
            index_manager,
            similarity_threshold=similarity_threshold,
            max_neighbours=max_neighbours,
            exclude_pairs=exact_pair_keys,
        )

    return {
        "exact_pairs":   exact_pairs,
        "similar_pairs": similar_pairs,
        "total_exact":   len(exact_pairs),
        "total_similar": len(similar_pairs),
        "threshold":     similarity_threshold,
    }
