"""
Version chain detector.

Groups assets into ordered version chains using:
1. Filename stem normalisation (strip v1/v2/final/old/new/… markers)
2. Folder co-location
3. CLIP visual similarity confirmation (≥ 0.72) to reject false-positives

Rust passes the full asset list; Python returns detected chains.
Rust writes them back to asset_relations with relation = 'version'.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

VISUAL_THRESHOLD = 0.72
MIN_CHAIN_SIZE   = 2

# Regex: matches version markers inside filenames
_VER_RE = re.compile(
    r"(?:[_\-\.]?)(?:v(?:ersion)?\.?\s*(\d+)"
    r"|(?:^|[_\-\.])(\d+)(?:[_\-\.]|$)"
    r"|(final|old|new|updated|revised|latest|legacy|backup|copy"
    r"|original|draft|wip|done|release|prod|dev|staging))",
    re.IGNORECASE,
)
_NUM_VER_RE = re.compile(r"(?:^|[_\-\.])v?(?:ersion)?\.?\s*(\d+)", re.IGNORECASE)
_LABEL_ORDER: Dict[str, int] = {
    "original": 0, "draft": 1, "wip": 2, "old": 3, "legacy": 4,
    "staging": 5, "dev": 6, "backup": 7, "copy": 8, "revised": 11,
    "updated": 12, "new": 13, "release": 14, "prod": 15, "done": 16,
    "latest": 17, "final": 18,
}


def _strip_version(stem: str) -> str:
    cleaned = _VER_RE.sub("", stem)
    cleaned = re.sub(r"[_\-\.]{2,}", "_", cleaned)
    return cleaned.lower().strip("_-. ")


def _version_label(file_name: str) -> Tuple[str, int]:
    name = file_name.lower()
    m = _NUM_VER_RE.search(name)
    if m:
        n = int(m.group(1))
        return f"v{n}", n
    for label, order in sorted(_LABEL_ORDER.items(), key=lambda x: -len(x[0])):
        if re.search(r"(?:^|[_\-\.])" + re.escape(label) + r"(?:[_\-\.]|$)", name):
            return label, _LABEL_ORDER[label]
    return "", 99


def detect_version_chains(
    assets: List[Dict],     # [{id, file_name, folder, modified_at}]
    *,
    index,                  # IndexManager (for CLIP confirmation)
) -> List[Dict[str, Any]]:
    """
    Detect version chains from asset list + CLIP similarity.

    Returns
    -------
    [
        {
            "chain_key": "folder||stem",
            "versions": [{"asset_id", "version_label", "seq", "modified_at"}, ...],
            "latest_asset_id": str,
            "oldest_asset_id": str
        },
        ...
    ]
    """
    groups: Dict[str, List[Dict]] = defaultdict(list)
    for a in assets:
        stem = re.sub(r"\.[^.]+$", "", a["file_name"])
        base = _strip_version(stem)
        if not base:
            continue
        chain_key = a["folder"].lower().rstrip("/\\") + "||" + base
        label, sort_key = _version_label(a["file_name"])
        groups[chain_key].append({**a, "version_label": label or a["file_name"], "sort_key": sort_key})

    chains = []
    for chain_key, members in groups.items():
        if len(members) < MIN_CHAIN_SIZE:
            continue
        verified = _verify_visual(members, index=index)
        if len(verified) < MIN_CHAIN_SIZE:
            continue
        verified.sort(key=lambda m: (m["sort_key"], m["modified_at"]))
        versions = [
            {"asset_id": m["id"], "version_label": m["version_label"],
             "seq": seq, "modified_at": m["modified_at"]}
            for seq, m in enumerate(verified, 1)
        ]
        chains.append({
            "chain_key": chain_key,
            "versions": versions,
            "latest_asset_id": versions[-1]["asset_id"],
            "oldest_asset_id": versions[0]["asset_id"],
        })
    return chains


def _verify_visual(members: List[Dict], *, index) -> List[Dict]:
    embedded = [m for m in members if index.has_asset(m["id"])]
    if len(embedded) < 2:
        return members  # trust filename grouping

    vecs = []
    valid = []
    for m in embedded:
        v = index.get_vector(m["id"])
        if v is not None:
            vecs.append(v)
            valid.append(m)
    if len(valid) < 2:
        return members

    mat = np.array(vecs, dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    mat = mat / np.where(norms == 0, 1.0, norms)
    sim_matrix = mat @ mat.T

    confirmed = set()
    for i in range(len(valid)):
        for j in range(len(valid)):
            if i != j and sim_matrix[i, j] >= VISUAL_THRESHOLD:
                confirmed.add(valid[i]["id"])
                confirmed.add(valid[j]["id"])
                break

    # Assets without embeddings get benefit of the doubt
    for m in members:
        if m["id"] not in {v["id"] for v in valid}:
            confirmed.add(m["id"])

    return [m for m in members if m["id"] in confirmed]
