"""
Design token extractor — dominant colors, typography zones, spacing tendency.

All processing is CPU-only.  Target latency: < 300 ms per 1080p image.

Color extraction
----------------
1. Resize to 128×128 thumbnail (fast, no AA).
2. Convert sRGB → CIE LAB for perceptual k-means.
3. k-means with k=6 on LAB values → dominant cluster centroids.
4. Map each centroid back to sRGB hex + nearest named colour (32-colour vocab).
5. Sort by pixel-count weight descending.

Typography zone detection
-------------------------
Sobel edge map on grayscale, row-wise edge density → bands of dense horizontal
edges are likely text regions.  Intentionally a spatial heuristic, not OCR.

Spacing tendency
----------------
Ratio of bright/low-saturation pixels → compact | balanced | spacious.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

import numpy as np

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Colour vocabulary (sRGB tuples) — 32 perceptually-distributed entries
# ---------------------------------------------------------------------------
_NAMED: List[Tuple[str, Tuple[int, int, int]]] = [
    ("black",      (  0,   0,   0)), ("near-black",  ( 20,  20,  20)),
    ("dark-gray",  ( 64,  64,  64)), ("medium-gray", (128, 128, 128)),
    ("light-gray", (200, 200, 200)), ("near-white",  (240, 240, 240)),
    ("white",      (255, 255, 255)), ("red",         (220,  50,  47)),
    ("dark-red",   (139,   0,   0)), ("orange",      (255, 140,   0)),
    ("amber",      (255, 191,   0)), ("yellow",      (255, 235,  59)),
    ("lime",       (132, 204,  22)), ("green",       ( 34, 197,  94)),
    ("dark-green", (  0, 100,   0)), ("teal",        ( 20, 184, 166)),
    ("cyan",       (  6, 182, 212)), ("sky-blue",    ( 56, 189, 248)),
    ("blue",       ( 59, 130, 246)), ("dark-blue",   ( 29,  78, 216)),
    ("navy",       ( 15,  23,  42)), ("indigo",      ( 99, 102, 241)),
    ("violet",     (139,  92, 246)), ("purple",      (168,  85, 247)),
    ("pink",       (236,  72, 153)), ("rose",        (244,  63,  94)),
    ("brown",      (120,  53,  15)), ("tan",         (217, 119,  87)),
    ("cream",      (254, 243, 199)), ("mint",        (167, 243, 208)),
    ("lavender",   (221, 214, 254)), ("gold",        (212, 175,  55)),
]
_NAMED_RGB = np.array([c[1] for c in _NAMED], dtype=np.float32)
_NAMED_NAMES = [c[0] for c in _NAMED]


def _nearest_name(rgb: Tuple[float, float, float]) -> str:
    arr = np.array(rgb, dtype=np.float32)
    return _NAMED_NAMES[int(np.argmin(np.linalg.norm(_NAMED_RGB - arr, axis=1)))]


def _rgb_hex(r: float, g: float, b: float) -> str:
    return "#{:02x}{:02x}{:02x}".format(int(r), int(g), int(b))


# ---------------------------------------------------------------------------
# Colour space conversions (numpy, no scipy/sklearn deps)
# ---------------------------------------------------------------------------
def _srgb_to_lab(arr_uint8: np.ndarray) -> np.ndarray:
    """(H×W×3 uint8) → (N×3 float32) in CIE LAB."""
    pix = arr_uint8.reshape(-1, 3).astype(np.float32) / 255.0
    mask = pix > 0.04045
    pix[mask]  = ((pix[mask] + 0.055) / 1.055) ** 2.4
    pix[~mask] /= 12.92
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
    xyz = pix @ M.T / np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
    d = 6.0 / 29.0
    f = np.where(xyz > d ** 3, xyz ** (1 / 3), xyz / (3 * d ** 2) + 4 / 29)
    L = 116 * f[:, 1] - 16
    a = 500 * (f[:, 0] - f[:, 1])
    b = 200 * (f[:, 1] - f[:, 2])
    return np.stack([L, a, b], axis=1)


def _lab_centroid_to_rgb(L: float, a: float, b: float) -> Tuple[float, float, float]:
    """CIE LAB → sRGB (D65)."""
    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200
    X = 0.95047 * (fx ** 3 if fx > 0.206897 else (fx - 16 / 116) / 7.787)
    Y = 1.00000 * (fy ** 3 if fy > 0.206897 else (fy - 16 / 116) / 7.787)
    Z = 1.08883 * (fz ** 3 if fz > 0.206897 else (fz - 16 / 116) / 7.787)
    rl =  3.2406 * X - 1.5372 * Y - 0.4986 * Z
    gl = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
    bl =  0.0557 * X - 0.2040 * Y + 1.0570 * Z
    def g(v: float) -> float:
        v = max(0.0, min(1.0, v))
        return 1.055 * v ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * v
    return g(rl) * 255, g(gl) * 255, g(bl) * 255


def _kmeans(data: np.ndarray, k: int, max_iter: int = 25) -> Tuple[np.ndarray, np.ndarray]:
    """Lightweight k-means (no sklearn)."""
    rng = np.random.default_rng(42)
    centroids = data[rng.choice(len(data), k, replace=False)].copy()
    labels = np.zeros(len(data), dtype=np.int32)
    for _ in range(max_iter):
        dists = np.linalg.norm(data[:, None] - centroids[None], axis=2)
        new_labels = np.argmin(dists, axis=1).astype(np.int32)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for j in range(k):
            pts = data[labels == j]
            if len(pts):
                centroids[j] = pts.mean(axis=0)
    return centroids, labels


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def extract_design_tokens(file_path: str, n_colors: int = 6) -> Dict[str, Any]:
    """
    Extract design tokens from an image file.

    Returns
    -------
    {
        "ok": True,
        "dominant_colors": [{"hex": "#3b82f6", "name": "blue", "weight": 0.43}, ...],
        "typography_zones": [{"y": 0.12, "height": 0.05, "density": 0.72}, ...],
        "spacing_class": "balanced"   # compact | balanced | spacious
    }
    """
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return {"ok": False, "error": "Pillow not installed"}

    try:
        img = Image.open(file_path)
        if img.mode != "RGB":
            img = img.convert("RGB")
        orig_w, orig_h = img.size

        # ── Colors ───────────────────────────────────────────────────────
        thumb = np.array(img.resize((128, 128), Image.Resampling.BILINEAR), dtype=np.uint8)
        lab = _srgb_to_lab(thumb)
        n = min(4096, len(lab))
        sample = lab[np.linspace(0, len(lab) - 1, n, dtype=int)]
        centroids, labels = _kmeans(sample, k=n_colors)
        counts = np.bincount(labels, minlength=n_colors)
        weights = counts / (counts.sum() or 1)
        dominant_colors = []
        for ci in np.argsort(-weights):
            r, g, b = _lab_centroid_to_rgb(*centroids[ci])
            dominant_colors.append({
                "hex":    _rgb_hex(r, g, b),
                "name":   _nearest_name((r, g, b)),
                "weight": round(float(weights[ci]), 3),
            })

        # ── Typography zones (edge-density bands) ─────────────────────────
        aw = 256
        ah = max(32, int(orig_h * aw / orig_w)) if orig_w > 0 else 256
        gray = np.array(img.resize((aw, ah)).convert("L"), dtype=np.float32)
        gx = np.abs(np.diff(gray, axis=1))
        gy = np.abs(np.diff(gray, axis=0))
        mh = min(gx.shape[0], gy.shape[0])
        mw = min(gx.shape[1], gy.shape[1])
        edge_row_density = np.hypot(gx[:mh, :mw], gy[:mh, :mw]).mean(axis=1) / 255.0
        zones = []
        in_zone, z_start = False, 0
        for row_i, d in enumerate(edge_row_density):
            if not in_zone and d > 0.08:
                in_zone, z_start = True, row_i
            elif in_zone and d <= 0.08:
                in_zone = False
                h = row_i - z_start
                if h >= 3:
                    zones.append({"y": round(z_start / ah, 3),
                                  "height": round(h / ah, 3),
                                  "density": round(float(edge_row_density[z_start:row_i].mean()), 3)})
        if in_zone and (len(edge_row_density) - z_start) >= 3:
            h = len(edge_row_density) - z_start
            zones.append({"y": round(z_start / ah, 3), "height": round(h / ah, 3),
                          "density": round(float(edge_row_density[z_start:].mean()), 3)})

        # ── Spacing tendency ──────────────────────────────────────────────
        small = np.array(img.resize((64, 64)), dtype=np.float32)
        lum = 0.2126 * small[:, :, 0] + 0.7152 * small[:, :, 1] + 0.0722 * small[:, :, 2]
        sat = small.max(axis=2) - small.min(axis=2)
        empty_ratio = float(((lum > 220) & (sat < 30)).mean())
        if empty_ratio > 0.45:
            spacing_class = "spacious"
        elif empty_ratio > 0.20:
            spacing_class = "balanced"
        else:
            spacing_class = "compact"

        return {
            "ok": True,
            "dominant_colors": dominant_colors,
            "typography_zones": zones[:10],
            "spacing_class": spacing_class,
        }
    except Exception as exc:
        log.warning("design_tokens: %s — %s", file_path, exc)
        return {"ok": False, "error": str(exc)}
