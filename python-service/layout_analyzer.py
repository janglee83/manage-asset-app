"""
Layout fingerprint extractor — color-agnostic structural similarity.

Algorithm
---------
1. Resize to 64×64 grayscale.
2. Sobel edge map → structural content distribution.
3. Divide into 4×4 grid → 16 edge-density features.
4. Compute margin ratios (top/bottom/left/right whitespace).
5. Global stats: overall density, vertical balance, aspect ratio.
6. Stack into a 24-element unit-norm vector.

Two assets with cosine similarity > 0.92 share the same layout template
independent of colors or content.

Layout classes:
  icon       — square, high central density
  dashboard  — wide (>2:1), multi-region
  card       — portrait, dense top band, sparse body
  hero       — portrait, dense lower half
  list       — equally spaced horizontal bands
  split      — two equal halves with different density
  full-bleed — dense everywhere
  banner     — wide with sparse content
  balanced   — default
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import numpy as np

log = logging.getLogger(__name__)

_GRID = 4       # 4×4 = 16 cells
_THUMB = 64     # px per side


def _sobel_norm(gray_uint8: np.ndarray) -> np.ndarray:
    """Return per-pixel gradient magnitude, normalised 0–1."""
    g = gray_uint8.astype(np.float32)
    gx = np.zeros_like(g)
    gy = np.zeros_like(g)
    gx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) / 2
    gy[1:-1, :] = (g[2:, :] - g[:-2, :]) / 2
    mag = np.hypot(gx, gy)
    peak = mag.max()
    return (mag / peak).astype(np.float32) if peak > 0 else mag


def extract_layout_signature(file_path: str) -> Dict[str, Any]:
    """
    Compute a layout fingerprint.

    Returns
    -------
    {
        "ok": True,
        "aspect_ratio": 1.78,
        "layout_fingerprint": [float, ...],   # 24 normalised floats
        "region_complexity": {"top_left": 0.3, ...},
        "layout_class": "dashboard"
    }
    """
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return {"ok": False, "error": "Pillow not installed"}

    try:
        img = Image.open(file_path)
        ow, oh = img.size
        ar = ow / oh if oh > 0 else 1.0
        gray = np.array(img.convert("L").resize((_THUMB, _THUMB), Image.Resampling.BILINEAR),
                        dtype=np.uint8)
        edges = _sobel_norm(gray)

        # 4×4 grid densities
        cell = _THUMB // _GRID
        grid: List[float] = [
            float(edges[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell].mean())
            for r in range(_GRID) for c in range(_GRID)
        ]

        # Margin ratios: fraction of leading bright rows/cols
        lum = gray.astype(np.float32) / 255.0
        def margin(arr: np.ndarray) -> float:
            n = len(arr)
            for i, v in enumerate(arr):
                if v <= 0.85:
                    return i / n
            return 1.0
        mt = margin(lum.mean(axis=1))
        mb = margin(lum.mean(axis=1)[::-1])
        ml = margin(lum.mean(axis=0))
        mr = margin(lum.mean(axis=0)[::-1])

        # Global stats
        gd = float(edges.mean())
        h2 = _THUMB // 2
        vb = float(edges[:h2].mean()) / (float(edges[h2:].mean()) + 1e-7)

        fp_raw = np.array(grid + [mt, mb, ml, mr, gd, vb, ar], dtype=np.float32)
        norm = np.linalg.norm(fp_raw)
        fp = (fp_raw / norm).tolist() if norm > 0 else fp_raw.tolist()

        quad = {
            "top_left":     round(float(edges[:h2, :h2].mean()), 3),
            "top_right":    round(float(edges[:h2, h2:].mean()), 3),
            "bottom_left":  round(float(edges[h2:, :h2].mean()), 3),
            "bottom_right": round(float(edges[h2:, h2:].mean()), 3),
        }

        lc = _classify_layout(ar, gd, vb, mt, mb, ml, mr, quad)
        return {
            "ok": True,
            "aspect_ratio": round(ar, 3),
            "layout_fingerprint": [round(v, 4) for v in fp],
            "region_complexity": quad,
            "layout_class": lc,
        }
    except Exception as exc:
        log.warning("layout_analyzer: %s — %s", file_path, exc)
        return {"ok": False, "error": str(exc)}


def _classify_layout(ar, gd, vb, mt, mb, ml, mr, quad) -> str:
    tl, tr, bl, br = quad["top_left"], quad["top_right"], quad["bottom_left"], quad["bottom_right"]
    top = (tl + tr) / 2
    bot = (bl + br) / 2
    left = (tl + bl) / 2
    right = (tr + br) / 2
    if 0.9 <= ar <= 1.1 and gd > 0.3:
        return "icon"
    if ar > 2.0:
        return "dashboard" if gd > 0.25 else "banner"
    if abs(left - right) > 0.15:
        return "split"
    if top > 0.3 and bot < 0.15 and mt < 0.1:
        return "card"
    if vb > 1.4:
        return "hero"
    if gd < 0.1 and (ml > 0.2 or mr > 0.2):
        return "list"
    if gd > 0.3:
        return "full-bleed"
    return "balanced"


def layout_similarity(fp_a: List[float], fp_b: List[float]) -> float:
    """Cosine similarity between two fingerprint vectors → [0, 1]."""
    a = np.array(fp_a, dtype=np.float32)
    b = np.array(fp_b, dtype=np.float32)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))
