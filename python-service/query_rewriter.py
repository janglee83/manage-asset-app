"""
Local AI query rewriter.

Transforms natural language like:
  "find old blue mobile checkout screen"
Into an optimised semantic search string:
  "vintage legacy mobile checkout payment screen, blue color scheme"

Pipeline
--------
1. Detect and expand temporal markers  (old → vintage legacy, new → modern fresh)
2. Extract color terms from query
3. Run design_language.py for concept expansion (style/platform/domain)
4. Assemble into a comma-joined enriched prompt
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Temporal markers → visual-style phrases
_TEMPORAL: Dict[str, List[str]] = {
    "old":      ["vintage", "legacy", "classic design"],
    "older":    ["legacy", "older version"],
    "outdated": ["outdated design", "legacy UI"],
    "legacy":   ["legacy design", "vintage UI"],
    "previous": ["previous version", "old version"],
    "original": ["original version", "v1"],
    "ancient":  ["vintage", "retro design"],
    "new":      ["modern", "fresh design"],
    "newer":    ["updated design", "latest"],
    "recent":   ["recent design", "modern"],
    "latest":   ["latest version", "newest design"],
    "current":  ["current version", "latest design"],
    "updated":  ["updated version", "refreshed"],
    "final":    ["final version", "finished design"],
    "draft":    ["draft", "work in progress", "WIP"],
}

# Color synonyms
_COLORS: Dict[str, str] = {
    "blue": "blue color scheme", "red": "red design", "green": "green palette",
    "dark": "dark theme", "light": "light theme", "white": "white background",
    "black": "dark black background", "purple": "purple design",
    "orange": "orange accents", "gray": "grayscale design", "grey": "grayscale design",
    "yellow": "yellow accent", "pink": "pink design", "teal": "teal color",
    "indigo": "indigo dark blue",
}


def _sig(query: str) -> str:
    return hashlib.sha256(" ".join(query.lower().split()).encode()).hexdigest()[:16]


def rewrite_query(
    query: str,
    *,
    design_parser=None,
) -> Dict[str, Any]:
    """
    Rewrite a natural language query for better CLIP retrieval.

    Returns
    -------
    {"original": str, "rewritten": str, "confidence": float}
    """
    tokens = query.lower().split()
    enrichments: List[str] = []
    confidence = 0.0

    # Pass 1: temporal markers
    for token in tokens:
        expansion = _TEMPORAL.get(token)
        if expansion:
            enrichments.extend(expansion[:2])
            confidence += 0.20
            break

    # Pass 2: color terms
    for token in tokens:
        color_hint = _COLORS.get(token)
        if color_hint:
            enrichments.append(color_hint)
            confidence += 0.10
            break

    # Pass 3: design language expansion
    if design_parser:
        understood = design_parser.understand(query)
        if understood.get("is_design_query"):
            base = understood.get("expanded_prompt", query)
            concepts = understood.get("concepts", {})
            confidence += float(understood.get("confidence", 0.0)) * 0.50
            extras: List[str] = []
            for cat in ("platforms", "domains", "screen_types"):
                vals = concepts.get(cat, [])
                if vals:
                    extras.append(vals[0])
            rewritten = base
            if enrichments:
                rewritten += ", " + ", ".join(enrichments)
            if extras:
                rewritten += ", " + " ".join(extras)
        else:
            rewritten = ", ".join([query] + enrichments) if enrichments else query
    else:
        rewritten = ", ".join([query] + enrichments) if enrichments else query

    if rewritten == query:
        confidence = max(confidence, 0.10)

    return {
        "original": query,
        "rewritten": rewritten,
        "confidence": round(min(1.0, confidence), 2),
    }
