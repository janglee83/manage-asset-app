"""
Natural-language intent parser for structured search commands.

Converts free-text queries like:
   "show latest blue mobile dashboard"
   "find new fintech screens from this week"
   "oldest icon set in design folder"

into a structured SearchIntent dict:

{
    "semantic_query":  str,          # cleaned CLIP query
    "filters": {
        "date_range":  {from, to} | None,   # Unix timestamps
        "sort_by":     "newest" | "oldest" | "relevance",
        "colors":      [str, ...],
        "style":       str | None,           # fintech / ecommerce / ...
        "platform":    str | None,           # mobile / web / desktop
        "folder_hint": str | None,           # folder name substring
        "extensions":  [str, ...],
    },
    "confidence": float,
    "parsed_terms": {key: value},     # diagnostic
}

No network calls — entirely local, regex + vocabulary.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple

# ── Temporal vocabulary ───────────────────────────────────────────────────────

_TEMPORAL: Dict[str, Tuple[Optional[int], Optional[int], str]] = {
    # (from_delta_seconds, to_delta_seconds=0, sort_by)
    "latest":     (-7 * 86400, None, "newest"),
    "newest":     (-7 * 86400, None, "newest"),
    "recent":     (-14 * 86400, None, "newest"),
    "new":        (-7 * 86400, None, "newest"),
    "today":      (-86400,     None, "newest"),
    "yesterday":  (-2 * 86400, -86400, "newest"),
    "this week":  (-7 * 86400, None, "newest"),
    "last week":  (-14 * 86400, -7 * 86400, "newest"),
    "this month": (-30 * 86400, None, "newest"),
    "last month": (-60 * 86400, -30 * 86400, "newest"),
    "oldest":     (None, None, "oldest"),
    "old":        (None, None, "oldest"),
    "outdated":   (None, None, "oldest"),
    "legacy":     (None, None, "oldest"),
    "archive":    (None, None, "oldest"),
    "archived":   (None, None, "oldest"),
}

# ── Platform / type vocabulary ────────────────────────────────────────────────

_PLATFORM: Dict[str, str] = {
    "mobile":   "mobile",  "iphone":  "mobile",   "android":  "mobile",
    "ios":      "mobile",  "phone":   "mobile",   "app":      "mobile",
    "web":      "web",     "website": "web",      "browser":  "web",
    "desktop":  "desktop", "macos":   "desktop",  "windows":  "desktop",
    "tablet":   "tablet",  "ipad":    "tablet",
}

# ── Extension vocabulary ──────────────────────────────────────────────────────

_EXT_WORDS: Dict[str, str] = {
    "figma":    "fig",  "fig":     "fig",
    "psd":      "psd",  "sketch":  "sketch",
    "pdf":      "pdf",  "svg":     "svg",
    "png":      "png",  "jpg":     "jpg",  "jpeg": "jpg",
    "webp":     "webp",
    "icon":     "svg",  "icons":   "svg",
}

# ── Style (domain) vocabulary ─────────────────────────────────────────────────

_STYLE_WORDS: Dict[str, str] = {
    "fintech":     "fintech",  "financial":   "fintech",  "banking":     "fintech",
    "ecommerce":   "ecommerce","shop":        "ecommerce","store":       "ecommerce",
    "enterprise":  "enterprise","admin":      "enterprise","crm":        "enterprise",
    "gaming":      "gaming",   "game":        "gaming",
    "healthcare":  "healthcare","medical":    "healthcare",
    "social":      "social",   "community":  "social",
    "education":   "education","learning":   "education","school":      "education",
    "playful":     "playful",  "cartoon":    "playful",  "kids":        "playful",
    "productivity":"productivity","task":     "productivity","todo":      "productivity",
    "saas":        "saas",     "dashboard":  "enterprise",
}

# ── Color terms already handled by query_rewriter → only extract here ──────────

_COLOR_RE = re.compile(
    r"\b(red|orange|yellow|green|teal|blue|indigo|purple|pink|rose|cyan|lime|"
    r"white|black|gray|grey|dark|light|gold|silver|navy|brown)\b",
    re.IGNORECASE,
)

# ── Folder hints ──────────────────────────────────────────────────────────────

_FOLDER_WORDS: List[str] = [
    "designs", "design", "assets", "ui", "ux", "screens", "export",
    "mockups", "wireframes", "icons", "illustrations",
]


def parse_intent(query: str) -> Dict[str, Any]:
    """
    Parse natural-language query into structured SearchIntent.

    Parameters
    ----------
    query : raw user input string

    Returns
    -------
    SearchIntent dict (see module docstring)
    """
    # Hard cap — protect regex loops against adversarial inputs.
    # A realistic search query fits comfortably in 200 chars;
    # 500 is generous enough for any legitimate multi-clause query.
    if len(query) > 500:
        query = query[:500]

    now         = int(time.time())
    lower       = query.lower()
    parsed      = {}
    cleaned     = query                 # progressively stripped of structural terms
    confidence  = 0.0

    sort_by     : str               = "relevance"
    date_from   : Optional[int]     = None
    date_to     : Optional[int]     = None
    colors      : List[str]         = []
    style       : Optional[str]     = None
    platform    : Optional[str]     = None
    folder_hint : Optional[str]     = None
    extensions  : List[str]         = []

    # ── Temporal ──────────────────────────────────────────────────────────────
    for phrase in sorted(_TEMPORAL.keys(), key=len, reverse=True):  # longest first
        if phrase in lower:
            delta_from, delta_to, sort = _TEMPORAL[phrase]
            if delta_from is not None:
                date_from = now + delta_from
            if delta_to is not None:
                date_to = now + delta_to
            sort_by = sort
            parsed["temporal"] = phrase
            cleaned = re.sub(re.escape(phrase), "", cleaned, flags=re.IGNORECASE).strip()
            confidence += 0.2
            break

    # ── Platform ──────────────────────────────────────────────────────────────
    for word, plat in _PLATFORM.items():
        if re.search(r"\b" + word + r"\b", lower):
            platform = plat
            parsed["platform"] = platform
            cleaned  = re.sub(r"\b" + word + r"\b", "", cleaned, flags=re.IGNORECASE).strip()
            confidence += 0.1
            break

    # ── Style / domain ────────────────────────────────────────────────────────
    for word, sty in _STYLE_WORDS.items():
        if re.search(r"\b" + word + r"\b", lower):
            style = sty
            parsed["style"] = style
            cleaned = re.sub(r"\b" + word + r"\b", "", cleaned, flags=re.IGNORECASE).strip()
            confidence += 0.15
            break

    # ── Extension ─────────────────────────────────────────────────────────────
    for word, ext in _EXT_WORDS.items():
        if re.search(r"\b" + word + r"\b", lower):
            if ext not in extensions:
                extensions.append(ext)
            cleaned = re.sub(r"\b" + word + r"\b", "", cleaned, flags=re.IGNORECASE).strip()
            parsed["extension"] = ext
            confidence += 0.1

    # ── Colours ───────────────────────────────────────────────────────────────
    for m in _COLOR_RE.finditer(query):
        colors.append(m.group(0).lower())
        confidence += 0.05
    colors = list(dict.fromkeys(colors))  # deduplicate, preserve order

    # ── Folder hint ───────────────────────────────────────────────────────────
    for fw in _FOLDER_WORDS:
        if re.search(r"\b" + fw + r"\b", lower):
            folder_hint = fw
            parsed["folder_hint"] = folder_hint
            cleaned = re.sub(r"\b" + fw + r"\b", "", cleaned, flags=re.IGNORECASE).strip()
            confidence += 0.05
            break

    # ── Clean semantic query ──────────────────────────────────────────────────
    # Remove filler words used only for parsing
    fillers = ["show", "find", "get", "search", "list", "display", "give me",
               "look for", "from", "in the", "in a", "from a", "from the",
               "screens", "screen", "image", "images", "files", "file",
               "this", "last", "that", "all"]
    for filler in fillers:
        cleaned = re.sub(r"\b" + re.escape(filler) + r"\b", "", cleaned, flags=re.IGNORECASE)

    semantic_query = re.sub(r"\s{2,}", " ", cleaned).strip() or query

    return {
        "semantic_query": semantic_query,
        "original_query": query,
        "filters": {
            "date_range":  {"from": date_from, "to": date_to} if (date_from or date_to) else None,
            "sort_by":     sort_by,
            "colors":      colors,
            "style":       style,
            "platform":    platform,
            "folder_hint": folder_hint,
            "extensions":  extensions,
        },
        "confidence":   round(min(confidence, 1.0), 3),
        "parsed_terms": parsed,
    }
