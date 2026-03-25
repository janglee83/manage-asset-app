"""
Component family clustering using CLIP embedding similarity.

Groups assets whose CLIP vectors have cosine similarity ≥ THRESHOLD into
families, then names each family using its most common AI tags.

Role detection inside a family is pattern-matched from filenames:
  primary / secondary / disabled / hover / dark / light / member

This runs via the `build_component_families` sidecar method — called as a
background job after batch embedding, not on every search request.

Returns structured data; the Rust host writes it to SQLite.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from collections import Counter
from typing import Any, Dict, List, Tuple

import numpy as np

log = logging.getLogger(__name__)

FAMILY_THRESHOLD = 0.88  # min cosine similarity to be in the same family
MIN_FAMILY_SIZE  = 2     # singletons are excluded

_ROLE_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("hover",     re.compile(r"\b(hover|focus|active|pressed|selected)\b")),
    ("disabled",  re.compile(r"\b(disabled|inactive|muted|unavailable)\b")),
    ("secondary", re.compile(r"\b(secondary|outline|ghost|tertiary)\b")),
    ("dark",      re.compile(r"\b(dark|night|black)\b")),
    ("light",     re.compile(r"\b(light|day|white)\b")),
    ("primary",   re.compile(r"\b(primary|default|normal|base)\b")),
]


def _infer_role(file_name: str) -> str:
    name = file_name.lower()
    for role, pat in _ROLE_PATTERNS:
        if pat.search(name):
            return role
    return "member"


def build_component_families(
    *,
    index,              # IndexManager
    asset_names: Dict[str, str],   # {asset_id: file_name} — passed by Rust
    asset_tags:  Dict[str, List[str]],  # {asset_id: [tag, ...]} from SQLite
) -> Dict[str, Any]:
    """
    Cluster all indexed assets into component families.

    Returns
    -------
    {
        "families": [
            {
                "id": "uuid",
                "name": "button + dark + rounded",
                "archetype_id": "uuid",
                "members": [{"asset_id": "uuid", "role": "primary"}, ...]
            },
            ...
        ],
        "total_families": int,
        "total_assets": int
    }
    """
    all_ids, all_vecs = index.get_all_vectors()
    if not all_ids:
        return {"families": [], "total_families": 0, "total_assets": 0}

    vecs = np.array(all_vecs, dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    vecs = vecs / np.where(norms == 0, 1.0, norms)
    n = len(all_ids)
    log.info("component_classifier: clustering %d assets", n)

    # Union-Find greedy clustering
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    if n <= 8000:
        # O(n²) block dot-product
        block = 256
        for i in range(0, n, block):
            chunk = vecs[i:i + block]
            sims = chunk @ vecs.T           # (block, n)
            for li, row in enumerate(sims):
                gi = i + li
                idx = np.where(row >= FAMILY_THRESHOLD)[0]
                for j in idx:
                    j = int(j)
                    if j > gi:
                        pi, pj = find(gi), find(j)
                        if pi != pj:
                            parent[pi] = pj
    else:
        # FAISS-based for large libraries
        try:
            import faiss  # type: ignore
            idx_f = faiss.IndexFlatIP(vecs.shape[1])
            idx_f.add(vecs)
            k = min(20, n)
            D, I = idx_f.search(vecs, k)
            for i, (row_d, row_i) in enumerate(zip(D, I)):
                for d, j in zip(row_d, row_i):
                    j = int(j)
                    if j > i and d >= FAMILY_THRESHOLD:
                        pi, pj = find(i), find(j)
                        if pi != pj:
                            parent[pi] = pj
        except ImportError:
            log.warning("component_classifier: FAISS not available, skipping large-dataset clustering")

    # Collect clusters
    clusters: Dict[int, List[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)

    families = []
    total_assets = 0
    for root, indices in clusters.items():
        if len(indices) < MIN_FAMILY_SIZE:
            continue
        members_ids = [all_ids[i] for i in indices]
        # Name from most common tags
        tag_counter: Counter = Counter()
        for aid in members_ids:
            for tag in asset_tags.get(aid, []):
                tag_counter[tag] += 1
        top_tags = [t for t, _ in tag_counter.most_common(5)]
        family_name = " + ".join(top_tags[:3]) if top_tags else "unlabeled-family"

        # Archetype: most central member (highest avg similarity to rest)
        member_vecs = vecs[indices]
        centroid = member_vecs.mean(axis=0)
        cn = np.linalg.norm(centroid)
        if cn > 0:
            centroid /= cn
        sims = member_vecs @ centroid
        archetype_idx = int(np.argmax(sims))
        archetype_id = members_ids[archetype_idx]

        members_out = [
            {"asset_id": aid, "role": _infer_role(asset_names.get(aid, ""))}
            for aid in members_ids
        ]
        families.append({
            "id": str(uuid.uuid4()),
            "name": family_name,
            "archetype_id": archetype_id,
            "tags_summary": top_tags,
            "members": members_out,
        })
        total_assets += len(members_ids)

    return {"families": families, "total_families": len(families), "total_assets": total_assets}
