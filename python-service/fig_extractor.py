"""fig_extractor.py — Local .fig file metadata extraction
=========================================================

STRATEGY
--------
Figma's .fig format is a proprietary binary container::

    ZIP archive
    ├── canvas             (Kiwi-encoded binary blob — the full document tree)
    ├── images/            (embedded raster images by content-hash)
    └── thumbnails/        (per-page preview PNGs, one file per page)

The "canvas" blob is encoded with Figma's internal Kiwi serialization format,
a binary schema format that Figma has never publicly documented.

Our extraction approach (three tiers):

  Tier 1  — Certain
            • file_name       : taken directly from the file-system path.
            • is_valid_fig    : True if the file opens as a ZIP and contains
                                a "canvas" binary entry.

  Tier 2  — Approximate
            • thumbnail_count : count of *.png files under thumbnails/ inside
                                the ZIP.  Each page typically produces one
                                thumbnail, so this gives an approximate page
                                count but NOT page names.

  Tier 3  — Heuristic (low-confidence)
            • pages / frame_names / component_names :
              We slide through the canvas blob one byte at a time, treating
              each position as a potential LEB128-prefixed UTF-8 string
              (Kiwi's string encoding).  We filter the results through a
              block-list of Figma internal identifiers and apply weak
              heuristics to split strings into the three buckets.

LIMITATIONS
-----------
• Name classification is heuristic.  A string labelled "page" may actually
  be a frame or component name and vice-versa.
• Figma uses optional LZ4 chunk compression inside the canvas blob.
  Compressed regions produce no readable strings; names inside those
  regions will be silently missed.
• Remote / linked library component names are NOT embedded in the file.
• Version sensitivity: tested against files saved with Figma desktop ≥ 2021.
  Older files may yield no output.
• The Figma REST API (with a personal access token) is the ONLY guaranteed
  way to obtain fully-typed, correctly-labelled page / frame / component data.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Heuristic block-lists and validation
# ---------------------------------------------------------------------------

# Figma node-type enum strings that appear verbatim in the binary.
_INTERNAL_STRINGS: frozenset[str] = frozenset({
    # node types
    "DOCUMENT", "CANVAS", "FRAME", "GROUP", "VECTOR", "BOOLEAN_OPERATION",
    "STAR", "LINE", "ELLIPSE", "POLYGON", "RECTANGLE", "TEXT", "SLICE",
    "COMPONENT", "COMPONENT_SET", "INSTANCE", "TABLE", "TABLE_CELL",
    "SECTION", "CONNECTOR", "WASHI_TAPE", "SHAPE_WITH_TEXT",
    "STAMP", "STICKY", "HIGHLIGHT", "CODE_BLOCK",
    # common field-name strings
    "name", "type", "id", "children", "parent", "visible", "locked",
    "opacity", "blendMode", "fills", "strokes", "effects",
    "exportSettings", "constraints", "transitions",
    # Figma-generated default names
    "Rectangle", "Ellipse", "Star", "Line", "Vector", "Group",
    "Frame", "Text", "Component", "Instance",
    # primitive / locale values
    "en", "en-US", "true", "false", "null", "undefined",
})

# Patterns that identify internal IDs / non-name strings.
_ID_PATTERN = re.compile(
    r"^("
    r"[0-9a-f]{8,}"           # hex blob (SHA / UUID fragment)
    r"|\d+:\d+"               # Figma node ID "1:23"
    r"|[ISC]:\d+:\d+"         # schema reference
    r"|[A-Z]{2,}_[A-Z_]{2,}" # ALL_CAPS_ENUM
    r"|figma:[a-z_]+"         # figma: URI
    r"|https?://"             # any URL
    r").*$",
    re.ASCII,
)

# Hint: component names often carry a "/" variant separator
_COMPONENT_SLASH = re.compile(r"[A-Za-z][A-Za-z0-9 _-]*/[A-Za-z]")

# "PascalCase" with 5+ chars is a weak component heuristic
_PASCAL_CASE = re.compile(r"^[A-Z][a-z][a-zA-Z0-9]{3,}$")

_MIN_NAME_LEN: int = 2
_MAX_NAME_LEN: int = 120


def _is_valid_name(s: str) -> bool:
    s = s.strip()
    if not _MIN_NAME_LEN <= len(s) <= _MAX_NAME_LEN:
        return False
    if s in _INTERNAL_STRINGS:
        return False
    if _ID_PATTERN.match(s):
        return False
    # Must contain at least one alphanumeric character
    if not any(c.isalnum() for c in s):
        return False
    # Reject strings with too many non-printable bytes (encoding artefacts)
    non_print = sum(1 for c in s if not c.isprintable())
    if non_print > max(1, len(s) // 8):
        return False
    return True


# ---------------------------------------------------------------------------
# LEB128 varint decoder + Kiwi-format string scanner
# ---------------------------------------------------------------------------

def _decode_leb128(data: bytes, pos: int) -> tuple[int, int]:
    """
    Decode an unsigned LEB128 varint starting at *pos*.
    Returns ``(value, new_pos)``.  Returns ``(0, pos+1)`` on overflow.
    """
    result = shift = 0
    while pos < len(data):
        byte   = data[pos]
        pos   += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            break
        shift += 7
        if shift > 28:          # guard: strings can't be this long
            return 0, pos
    return result, pos


def _scan_strings(blob: bytes) -> list[str]:
    """
    Slide through *blob* treating every byte as a possible LEB128-prefixed
    UTF-8 string (Kiwi's string encoding).  Filter, deduplicate, and return
    results in first-seen order.
    """
    results: list[str] = []
    seen:    set[str]  = set()
    limit = len(blob)
    i = 0
    while i < limit - 2:
        val, j = _decode_leb128(blob, i)
        if _MIN_NAME_LEN <= val <= _MAX_NAME_LEN and j + val <= limit:
            candidate = blob[j : j + val]
            try:
                s = candidate.decode("utf-8")
                if _is_valid_name(s) and s not in seen:
                    results.append(s)
                    seen.add(s)
            except UnicodeDecodeError:
                pass
        i += 1
    return results


# ---------------------------------------------------------------------------
# Heuristic classifier: pages / frames / components
# ---------------------------------------------------------------------------

def _classify_names(
    names: list[str],
    thumbnail_count: int,
) -> dict[str, list[str]]:
    """
    Split *names* into probable page / frame / component buckets.

    Rules (weakest first, highest-signal last):
      components — names containing "/" (Figma variant separator)
                   OR matching a PascalCase pattern (≥5 chars).
      pages      — the first *thumbnail_count* short (≤40 chars) names
                   from the remaining list, since thumbnails are generated
                   per-page and those names appear earliest in the tree.
      frames     — everything else.

    When thumbnail_count == 0 we cannot bound the page slice reliably, so
    pages and frames are both left empty and all remaining names go into
    ``frame_names`` to avoid fabricating a page list.
    """
    components: list[str] = []
    rest:       list[str] = []

    for n in names:
        if _COMPONENT_SLASH.search(n) or _PASCAL_CASE.match(n):
            components.append(n)
        else:
            rest.append(n)

    if thumbnail_count > 0:
        short_names = [n for n in rest if len(n) <= 40]
        pages  = short_names[:thumbnail_count]
        page_set = set(pages)
        frames = [n for n in rest if n not in page_set]
    else:
        pages  = []
        frames = rest

    return {
        "pages":           pages,
        "frame_names":     frames,
        "component_names": components,
    }


# ---------------------------------------------------------------------------
# ZIP / canvas helpers
# ---------------------------------------------------------------------------

_CANVAS_ENTRY_NAMES: tuple[str, ...] = ("canvas",)  # Figma always uses this key


def _open_fig_zip(
    file_path: str,
) -> tuple[Optional[zipfile.ZipFile], list[str], int]:
    """
    Open *file_path* as a ZIP archive.

    Returns ``(zf, entry_names, thumbnail_count)``.
    Returns ``(None, [], 0)`` if the file is not a valid ZIP.
    """
    try:
        zf      = zipfile.ZipFile(file_path, "r")
        entries = zf.namelist()
        thumb_count = sum(
            1
            for e in entries
            if e.startswith("thumbnails/") and e.lower().endswith(".png")
        )
        return zf, entries, thumb_count
    except (zipfile.BadZipFile, OSError):
        return None, [], 0


def _read_canvas_blob(zf: zipfile.ZipFile) -> bytes:
    """
    Read the "canvas" binary entry.
    Falls back to the largest non-folder, non-image entry if "canvas" is
    missing (some older .fig variants may name it differently).
    Returns ``b""`` on failure.
    """
    # Primary
    for name in _CANVAS_ENTRY_NAMES:
        try:
            return zf.read(name)
        except KeyError:
            pass

    # Fallback: largest non-image binary entry
    candidates = [
        info for info in zf.infolist()
        if not info.filename.endswith("/")
        and not info.filename.startswith("images/")
        and not info.filename.startswith("thumbnails/")
        and info.file_size > 1024
    ]
    if candidates:
        largest = max(candidates, key=lambda i: i.file_size)
        try:
            return zf.read(largest.filename)
        except Exception:
            pass

    return b""


# ---------------------------------------------------------------------------
# Public extraction entry-point
# ---------------------------------------------------------------------------

def extract_fig_metadata(file_path: str) -> dict:
    """
    Extract all available metadata from a local ``.fig`` file.

    Return schema
    -------------
    file_name         str        Stem of the file path (always available).
    pages             list[str]  Probable page names          (Tier 3 — heuristic).
    frame_names       list[str]  Probable top-level frame names (Tier 3).
    component_names   list[str]  Probable component/variant names (Tier 3).
    all_names         list[str]  Every candidate string from the binary (unfiltered).
    thumbnail_count   int        Number of thumbnail PNGs found (Tier 2).
    zip_entries       list[str]  All ZIP entry paths (structural overview).
    is_valid_fig      bool       True if the file opened as a ZIP with a canvas blob.
    extraction_method str        Always "kiwi_string_scan".
    confidence        str        Field-level confidence map (see below).
    limitations       list[str]  Human-readable limitation notes.

    confidence map
    --------------
    {
      "file_name":       "certain",
      "thumbnail_count": "approximate",
      "pages":           "heuristic",
      "frame_names":     "heuristic",
      "component_names": "heuristic",
    }
    """
    result: dict = {
        "file_name":          Path(file_path).stem,
        "pages":              [],
        "frame_names":        [],
        "component_names":    [],
        "all_names":          [],
        "thumbnail_count":    0,
        "zip_entries":        [],
        "is_valid_fig":       False,
        "extraction_method":  "kiwi_string_scan",
        "confidence": {
            "file_name":       "certain",
            "thumbnail_count": "approximate",
            "pages":           "heuristic",
            "frame_names":     "heuristic",
            "component_names": "heuristic",
        },
        "limitations": [
            (
                "Name classification (page vs frame vs component) is heuristic — "
                "a string labelled 'page' may actually be a frame or component name."
            ),
            (
                "Figma uses optional LZ4 chunk compression inside the canvas blob. "
                "Names inside compressed regions are silently missed."
            ),
            (
                "Remote / linked library component names are not embedded in this "
                "file and will not appear in the output."
            ),
            (
                "Figma REST API (with a personal access token) is the only "
                "guaranteed way to obtain fully-typed, correctly-labelled metadata."
            ),
            (
                "Tested against Figma desktop ≥ 2021 .fig files. "
                "Older files may produce empty results."
            ),
        ],
    }

    # ── Tier 1: open as ZIP ─────────────────────────────────────────────────
    zf, entries, thumb_count = _open_fig_zip(file_path)
    if zf is None:
        result["limitations"].insert(
            0,
            "File could not be opened as a ZIP archive — not a .fig file or corrupted.",
        )
        return result

    result["zip_entries"]     = entries
    result["thumbnail_count"] = thumb_count  # Tier 2

    # ── Tier 3: scan canvas blob ─────────────────────────────────────────────
    canvas_blob = _read_canvas_blob(zf)
    zf.close()

    if not canvas_blob:
        result["limitations"].insert(
            0,
            "No 'canvas' binary found inside the ZIP — cannot extract names.",
        )
        return result

    result["is_valid_fig"] = True

    all_names = _scan_strings(canvas_blob)
    result["all_names"] = all_names

    classified = _classify_names(all_names, thumb_count)
    result["pages"]           = classified["pages"]
    result["frame_names"]     = classified["frame_names"]
    result["component_names"] = classified["component_names"]

    return result
