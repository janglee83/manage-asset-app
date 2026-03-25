"""
Color palette clustering and palette-based search.

Responsibilities:
1. cluster_by_palette(asset_color_map) → palette groups
2. search_by_palette(query_colors, asset_color_map) → ranked asset IDs

Algorithm:
- Represent each asset as a weighted average LAB vector from its dominant colors.
- Use greedy k-means (k=auto, 3–12 clusters) to group assets by palette.
- For search: compute cosine similarity between query color vector and each
  asset's palette vector, return top-k ranked results.

Input color format: [{"hex": "#3B82F6", "name": "blue", "weight": 0.45}, ...]

No new dependencies — pure numpy only.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

# ── Colour math helpers ───────────────────────────────────────────────────────

def _hex_to_rgb(hex_str: str) -> Tuple[float, float, float]:
    h = hex_str.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return r / 255.0, g / 255.0, b / 255.0


def _rgb_to_lab(r: float, g: float, b: float) -> Tuple[float, float, float]:
    """sRGB → CIE LAB (D65 white point)."""
    def _linearize(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = _linearize(r), _linearize(g), _linearize(b)
    x = r * 0.4124 + g * 0.3576 + b * 0.1805
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = r * 0.0193 + g * 0.1192 + b * 0.9505
    x /= 0.95047; z /= 1.08883

    def _f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    x, y, z = _f(x), _f(y), _f(z)
    L = 116 * y - 16
    a = 500 * (x - y)
    b_ = 200 * (y - z)
    return L, a, b_


def _color_list_to_vector(colors: List[Dict]) -> Optional[np.ndarray]:
    """Weighted mean of LAB vectors → 3-dim palette vector."""
    if not colors:
        return None
    total_w = 0.0
    vec = np.zeros(3, dtype=np.float64)
    for c in colors:
        hex_str = c.get("hex", "")
        weight  = float(c.get("weight", 1.0))
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", hex_str):
            continue
        try:
            r, g, b = _hex_to_rgb(hex_str)
            L, a, b_ = _rgb_to_lab(r, g, b)
            vec += np.array([L, a, b_]) * weight
            total_w += weight
        except Exception:
            continue
    if total_w == 0:
        return None
    vec /= total_w
    # Normalise to unit sphere for cosine similarity
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec /= norm
    return vec.astype(np.float32)


# ── Simple named colour query parser ─────────────────────────────────────────

_NAMED_COLORS: Dict[str, str] = {
    "red":       "#E53E3E", "orange":  "#ED8936", "yellow":  "#ECC94B",
    "green":     "#38A169", "teal":    "#319795", "blue":    "#3182CE",
    "indigo":    "#667EEA", "purple":  "#805AD5", "pink":    "#D53F8C",
    "rose":      "#F56565", "cyan":    "#0BC5EA", "lime":    "#9AE600",
    "white":     "#FFFFFF", "black":   "#000000", "gray":    "#718096",
    "grey":      "#718096", "dark":    "#1A202C", "light":   "#F7FAFC",
    "gold":      "#D69E2E", "silver":  "#A0AEC0", "navy":    "#2B6CB0",
    "brown":     "#975A16",
}

def parse_color_query(query: str) -> List[Dict]:
    """Turn a colour name string into a color list for palette search."""
    tokens = query.lower().split()
    result = []
    for token in tokens:
        if token in _NAMED_COLORS:
            result.append({"hex": _NAMED_COLORS[token], "name": token, "weight": 1.0})
        elif re.fullmatch(r"#?[0-9a-fA-F]{6}", token):
            hex_str = token if token.startswith("#") else f"#{token}"
            result.append({"hex": hex_str, "name": "custom", "weight": 1.0})
    return result


# ── Public API ────────────────────────────────────────────────────────────────

def build_palette_vectors(
    asset_color_map: Dict[str, List[Dict]],
) -> Dict[str, np.ndarray]:
    """Convert {asset_id: [colors]} → {asset_id: 3-dim unit vector}."""
    result = {}
    for asset_id, colors in asset_color_map.items():
        vec = _color_list_to_vector(colors)
        if vec is not None:
            result[asset_id] = vec
    return result


def cluster_by_palette(
    asset_color_map: Dict[str, List[Dict]],
    n_clusters: int = 0,   # 0 = auto (3 – 12)
    n_iterations: int = 30,
) -> Dict[str, Any]:
    """
    Cluster assets into palette groups.

    Iteration is capped at `n_iterations` (default 30) so this function
    always terminates in bounded time regardless of hardware float behaviour.

    Returns
    -------
    {
        "clusters": [
            {"cluster_id": int, "centroid_lab": [L,a,b], "asset_ids": [...]},
            ...
        ],
        "total_clusters": int,
    }
    """
    vectors = build_palette_vectors(asset_color_map)
    if len(vectors) < 2:
        return {"clusters": [], "total_clusters": 0}

    ids  = list(vectors.keys())
    mat  = np.array(list(vectors.values()), dtype=np.float32)   # (n, 3)
    n    = len(ids)

    k = max(3, min(12, n // 10)) if n_clusters <= 0 else max(1, n_clusters)
    k = min(k, n)

    # k-means with random++ seed selection
    rng = np.random.default_rng(42)
    centroids = mat[rng.choice(n, size=k, replace=False)]

    for _ in range(n_iterations):
        dists    = np.linalg.norm(mat[:, None, :] - centroids[None, :, :], axis=2)  # (n,k)
        labels   = dists.argmin(axis=1)
        new_cent = np.array([
            mat[labels == i].mean(axis=0) if (labels == i).any() else centroids[i]
            for i in range(k)
        ])
        # Both rtol and atol are explicit — avoids relying on numpy
        # default rtol=1e-05 which can vary subtly across BLAS backends.
        if np.allclose(new_cent, centroids, rtol=1e-5, atol=1e-4):
            break
        centroids = new_cent

    # Unscale centroid back to LAB (just undo unit-norm not possible — report as-is)
    clusters = []
    for i in range(k):
        member_ids = [ids[j] for j in range(n) if labels[j] == i]
        if not member_ids:
            continue
        clusters.append({
            "cluster_id":    i,
            "centroid_lab":  centroids[i].tolist(),
            "asset_ids":     member_ids,
        })

    return {"clusters": clusters, "total_clusters": len(clusters)}


def search_by_palette(
    query_colors: List[Dict],
    asset_color_map: Dict[str, List[Dict]],
    top_k: int = 20,
    min_score: float = 0.5,
) -> Dict[str, Any]:
    """
    Find assets whose dominant palette is closest to the query colors.

    Returns [{asset_id, score}] sorted descending.
    """
    query_vec = _color_list_to_vector(query_colors)
    if query_vec is None:
        return {"ok": False, "error": "Could not parse query colors", "results": []}

    vectors = build_palette_vectors(asset_color_map)
    if not vectors:
        return {"ok": True, "results": []}

    ids = list(vectors.keys())
    mat = np.array(list(vectors.values()), dtype=np.float32)  # (n, 3)

    scores = (mat @ query_vec.reshape(3, 1)).flatten()  # cosine since both unit-normed

    ranked = sorted(zip(ids, scores.tolist()), key=lambda x: -x[1])
    results = [
        {"asset_id": aid, "score": round(float(s), 4)}
        for aid, s in ranked
        if s >= min_score
    ][:top_k]

    return {"ok": True, "results": results}
