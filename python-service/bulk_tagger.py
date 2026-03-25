"""
Bulk tag suggestion.

Algorithm:
1. Given a list of asset IDs with known tags, find top-K FAISS neighbours.
2. Collect tags from those neighbours.
3. Suggest tags that appear in ≥ MIN_VOTES neighbours but are NOT already on
   the target asset (merged tag set sorted by vote count).

Rust passes:
    assets_with_tags: {asset_id: [tag, ...]}  — all assets that have tags
    target_ids: [asset_id, ...]               — assets to generate suggestions for
    top_k: int                                — how many neighbours to consider
    min_votes: int                            — minimum neighbour count to surface a tag

Returns:
    {suggestions: {asset_id: [{tag, votes, confidence}]}}
"""
from __future__ import annotations

import logging
from collections import Counter
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

DEFAULT_K     = 8
DEFAULT_VOTES = 2   # tag must appear in at least 2 neighbours
MAX_SUGGEST   = 10


def suggest_bulk_tags(
    *,
    index,                                    # IndexManager
    assets_with_tags: Dict[str, List[str]],   # {asset_id: [tag, ...]}
    target_ids: List[str],                    # assets to suggest for
    top_k: int = DEFAULT_K,
    min_votes: int = DEFAULT_VOTES,
) -> Dict[str, Any]:
    """Build tag suggestions for each target asset via FAISS neighbourhood."""
    import numpy as np

    if not target_ids:
        return {"suggestions": {}}

    suggestions: Dict[str, List[Dict]] = {}

    for asset_id in target_ids:
        own_tags = set(assets_with_tags.get(asset_id, []))
        vec = index.get_vector(asset_id)
        if vec is None:
            suggestions[asset_id] = []
            continue

        # FAISS search for top-k+1 (first result is self in most cases)
        query = vec.reshape(1, -1).astype(np.float32)
        try:
            scores, ids = index._index.search(query, top_k + 2)
        except Exception:
            suggestions[asset_id] = []
            continue

        counter: Counter = Counter()
        conf_sum: Dict[str, float] = {}

        for score, fid in zip(scores[0], ids[0]):
            if fid < 0:
                continue
            neighbour_id = index._meta.fid_to_uuid.get(int(fid))
            if neighbour_id is None or neighbour_id == asset_id:
                continue
            flt_score = float(score)
            if flt_score < 0.72:
                continue
            for tag in assets_with_tags.get(neighbour_id, []):
                if tag not in own_tags:
                    counter[tag] += 1
                    conf_sum[tag] = conf_sum.get(tag, 0.0) + flt_score

        neighbour_count = sum(1 for fid in ids[0] if fid >= 0)
        neighbour_count = max(neighbour_count, 1)

        result = [
            {
                "tag":        tag,
                "votes":      votes,
                "confidence": round(conf_sum.get(tag, 0.0) / votes, 3),
            }
            for tag, votes in counter.most_common(MAX_SUGGEST)
            if votes >= min_votes
        ]
        suggestions[asset_id] = result

    return {"suggestions": suggestions}
