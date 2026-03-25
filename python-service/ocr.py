"""OCR text extraction module backed by EasyOCR.

Supported language packs
------------------------
* ``en``  — English
* ``ja``  — Japanese (requires the ``easyocr`` Japanese model)
* ``vi``  — Vietnamese

Reader instances are cached at module level keyed by the frozen tuple of
language codes, so repeated calls for the same language set pay only the
initial model-load cost once per process lifetime.

Public API
----------
extract_text(file_path, langs) -> dict
    Extract all text blocks from a single image file.

warm_up(langs)
    Pre-load the EasyOCR Reader for *langs* without performing any OCR.
    Call this during app startup in a background thread so the first real
    OCR request doesn't block.

Returned dict schema (``extract_text``)::

    {
        "full_text":   str,          # all detected words, space-joined
        "blocks":      list[dict],   # [{text, confidence, bbox}]
        "word_count":  int,
        "char_count":  int,
        "languages":   list[str],
    }
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_LANGS: Tuple[str, ...] = ("en", "ja", "vi")

# Discard OCR blocks whose EasyOCR confidence is below this value.
CONFIDENCE_THRESHOLD: float = 0.30

# Resize very large images before OCR to keep memory and latency reasonable.
# EasyOCR itself handles multi-scale, but limiting the input side prevents OOM
# on very high-resolution design exports.
MAX_IMAGE_SIDE: int = 4096

# ── Reader cache ──────────────────────────────────────────────────────────────

_readers: Dict[Tuple[str, ...], Any] = {}


def _get_reader(langs: Tuple[str, ...]) -> Any:
    """Return (and lazily create) an EasyOCR Reader for *langs*.

    The Reader is expensive to construct (model download + GPU/CPU init), so
    results are stored in ``_readers`` and reused across calls.
    """
    if langs not in _readers:
        import easyocr  # deferred so the module loads fast when OCR is unused
        logger.info("Loading EasyOCR reader for languages: %s", list(langs))
        _readers[langs] = easyocr.Reader(list(langs), gpu=False, verbose=False)
        logger.info("EasyOCR reader ready")
    return _readers[langs]


# ── Image pre-processing ──────────────────────────────────────────────────────

def _preprocess(file_path: str) -> str:
    """Return the path to an (possibly resized) image suitable for OCR.

    If the image exceeds ``MAX_IMAGE_SIDE`` on either dimension it is resized
    down (aspect-ratio preserved) to a temporary file and that path is
    returned.  Otherwise the original path is returned unchanged.

    The temporary file, if created, is placed in the system temp directory and
    is *not* deleted here — the OS will clean it up.  (Callers are stateless
    one-shot workers, so leaving temp files is acceptable.)
    """
    try:
        from PIL import Image
        import tempfile, os

        img = Image.open(file_path)
        w, h = img.size

        if max(w, h) <= MAX_IMAGE_SIDE:
            img.close()
            return file_path

        # Scale down keeping aspect ratio.
        ratio = MAX_IMAGE_SIDE / max(w, h)
        new_w, new_h = int(w * ratio), int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

        suffix = Path(file_path).suffix or ".png"
        fd, tmp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        img.save(tmp_path)
        img.close()
        logger.debug("Resized %s (%dx%d) → %s (%dx%d)", file_path, w, h, tmp_path, new_w, new_h)
        return tmp_path
    except Exception:
        # PIL not available or image unreadable — pass the original path and
        # let EasyOCR raise its own error if the file is truly unusable.
        return file_path


# ── Public API ────────────────────────────────────────────────────────────────

def warm_up(langs: Sequence[str] = DEFAULT_LANGS) -> None:
    """Pre-load the EasyOCR model for *langs*.

    Called from the sidecar warmup thread so the first real OCR request
    responds without the cold-start delay.
    """
    _get_reader(tuple(langs))


def extract_text(
    file_path: str,
    langs: Sequence[str] = DEFAULT_LANGS,
) -> Dict:
    """Extract all text from an image file.

    Parameters
    ----------
    file_path:
        Absolute path to the image (PNG, JPG, WEBP, BMP, TIFF, GIF …).
    langs:
        Language codes to use for recognition.  Defaults to
        ``("en", "ja", "vi")``.

    Returns
    -------
    dict
        ``full_text``, ``blocks``, ``word_count``, ``char_count``, ``languages``.

    Raises
    ------
    FileNotFoundError
        If *file_path* does not exist on disk.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"OCR input file not found: {file_path}")

    lang_tuple = tuple(langs)
    reader = _get_reader(lang_tuple)
    process_path = _preprocess(file_path)

    logger.debug("Running OCR on %s (langs=%s)", file_path, lang_tuple)
    raw: List = reader.readtext(process_path, detail=1, paragraph=False)

    blocks: List[Dict] = []
    texts:  List[str]  = []

    for (bbox, text, conf) in raw:
        if float(conf) < CONFIDENCE_THRESHOLD:
            continue
        text = text.strip()
        if not text:
            continue
        texts.append(text)
        # Convert bbox from numpy arrays to plain Python lists so the result
        # is JSON-serialisable without extra post-processing.
        bbox_list = [[float(x), float(y)] for x, y in bbox]
        blocks.append(
            {
                "text":       text,
                "confidence": float(conf),
                "bbox":       bbox_list,
            }
        )

    full_text = " ".join(texts)
    return {
        "full_text":  full_text,
        "blocks":     blocks,
        "word_count": len(texts),
        "char_count": len(full_text),
        "languages":  list(lang_tuple),
    }
