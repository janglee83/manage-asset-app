"""
Lazy-loaded dual-encoder for semantic asset search.

Encoder pair
------------
Image encoder : ``clip-ViT-B-32`` via sentence-transformers
                512-dim CLIP visual features, L2-normalised

Text encoder  : ``sentence-transformers/clip-ViT-B-32-multilingual-v1``
                512-dim vectors aligned to the CLIP image space via
                multilingual knowledge distillation.

                Supported query languages (non-exhaustive):
                  • English   – "landscape photography on a beach"
                  • Japanese  – "海辺の風景写真"
                  • Vietnamese – "ảnh phong cảnh bãi biển"
                  …and 50+ other languages from the mUSE distillation set.

Because both encoders produce vectors in the same 512-dim CLIP embedding space,
text queries in any supported language can retrieve semantically similar images
without any language-specific post-processing.

Thread safety
-------------
Model weights are loaded once and shared across calls.  encode_images /
encode_texts hold the GIL only during the forward pass, which is short
(< 200 ms per batch on CPU with ViT-B/32).  For bulk indexing, prefer larger
batches (64–128 images) to amortise Python overhead.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model identifiers — must match schema.py constants.
# ---------------------------------------------------------------------------
IMAGE_MODEL_NAME = "clip-ViT-B-32"
TEXT_MODEL_NAME  = "sentence-transformers/clip-ViT-B-32-multilingual-v1"
EMBED_DIM        = 512

# Recommended batch sizes for CPU inference.
IMAGE_BATCH_SIZE = 32
TEXT_BATCH_SIZE  = 128


class Embedder:
    """Thread-safe lazy loader for CLIP image + multilingual text encoders."""

    def __init__(self) -> None:
        self._image_model = None
        self._text_model  = None

    # ── Lazy model loaders ────────────────────────────────────────────────────

    def _img_model(self):
        if self._image_model is None:
            from sentence_transformers import SentenceTransformer
            log.info("[embedder] Loading image model: %s …", IMAGE_MODEL_NAME)
            self._image_model = SentenceTransformer(IMAGE_MODEL_NAME)
            log.info("[embedder] Image model ready.")
        return self._image_model

    def _txt_model(self):
        if self._text_model is None:
            from sentence_transformers import SentenceTransformer
            log.info("[embedder] Loading text model: %s …", TEXT_MODEL_NAME)
            self._text_model = SentenceTransformer(TEXT_MODEL_NAME)
            log.info("[embedder] Text model ready.")
        return self._text_model

    # ── Public API ────────────────────────────────────────────────────────────

    def encode_images(self, paths: List[str]) -> tuple[np.ndarray, List[int]]:
        """
        Encode a list of image file paths to L2-normalised 512-dim vectors.

        Returns
        -------
        vecs          : np.ndarray, shape (len(paths), 512), float32
                        Rows for files that could not be opened are zeroed out.
        failed_indices: list[int] — indices in `paths` that failed to open.
        """
        images: List = []
        valid: List[int] = []
        failed: List[int] = []

        for i, p in enumerate(paths):
            try:
                img = Image.open(p).convert("RGB")
                images.append(img)
                valid.append(i)
            except Exception as exc:
                log.warning("[embedder] Cannot open image %s: %s", p, exc)
                failed.append(i)

        result = np.zeros((len(paths), EMBED_DIM), dtype=np.float32)

        if images:
            model = self._img_model()
            raw = model.encode(
                images,
                batch_size=IMAGE_BATCH_SIZE,
                convert_to_numpy=True,
                show_progress_bar=False,
            ).astype(np.float32)
            norms = np.linalg.norm(raw, axis=1, keepdims=True)
            raw /= np.where(norms > 0, norms, 1.0)
            for out_pos, in_pos in enumerate(valid):
                result[in_pos] = raw[out_pos]

        return result, failed

    def encode_texts(self, texts: List[str]) -> np.ndarray:
        """
        Encode a list of text strings (any supported language) to L2-normalised
        512-dim vectors in the CLIP image embedding space.

        Parameters
        ----------
        texts : List of raw query strings.  No pre-processing required.

        Returns
        -------
        np.ndarray of shape (len(texts), 512), dtype float32.
        """
        if not texts:
            return np.empty((0, EMBED_DIM), dtype=np.float32)

        model = self._txt_model()
        vecs = model.encode(
            texts,
            batch_size=TEXT_BATCH_SIZE,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).astype(np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        vecs /= np.where(norms > 0, norms, 1.0)
        return vecs

    def warmup(self) -> None:
        """
        Pre-load both models so the first user query is not slow.
        Call this once at startup in a background thread.
        """
        _ = self._img_model()
        _ = self._txt_model()

    def model_info(self) -> dict:
        return {
            "image_model": IMAGE_MODEL_NAME,
            "text_model": TEXT_MODEL_NAME,
            "dimension": EMBED_DIM,
        }
