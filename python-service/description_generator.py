"""
Auto-description generator.

Produces human-readable descriptions like:
  "blue payment button with rounded corners, mobile UI"
  "dark analytics dashboard with sidebar, enterprise SaaS"

Pipeline
--------
1. Color from design_tokens → top 1-2 non-neutral colours
2. Tags (passed in) → element type, visual traits, platform, domain
3. design_language.py concepts → style/platform expansion if tags sparse
4. Template: "{color} {element} with {traits}, {platform/domain} UI"
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

_NEUTRAL = {"black", "near-black", "dark-gray", "medium-gray",
            "light-gray", "near-white", "white", "cream", "transparent"}

_ELEMENTS = [
    "button", "icon", "card", "modal", "nav", "navbar", "sidebar", "form",
    "input", "dropdown", "badge", "tab", "table", "chart", "avatar",
    "notification", "search", "pagination", "progress", "dialog", "header",
    "footer", "hero", "grid", "list", "illustration", "logo", "wireframe",
    "mockup", "banner", "dashboard",
]
_TRAITS  = ["dark", "light", "gradient", "flat", "outlined", "filled", "rounded",
            "shadow", "blur", "transparent", "minimal", "detailed", "colorful",
            "monochrome", "animated"]
_PLATFORMS = ["mobile", "web", "desktop", "tablet", "watch"]
_DOMAINS   = ["fintech", "ecommerce", "healthcare", "social", "saas",
              "enterprise", "gaming", "education", "productivity"]


def generate_description(
    *,
    tags: List[str],
    color_data: Optional[Dict] = None,
    file_path: Optional[str] = None,
    design_parser=None,
) -> Dict[str, Any]:
    """
    Generate a textual description from tags and optional color data.

    Parameters
    ----------
    tags         : list of AI tag strings (already loaded by caller from SQLite)
    color_data   : result of design_tokens.extract_design_tokens() (optional)
    file_path    : used for path-based design hint fallback
    design_parser: DesignQueryParser instance

    Returns
    -------
    {"description": str, "confidence": float, "ok": True}
    """
    # ── Colors ────────────────────────────────────────────────────────────
    colors: List[str] = []
    if color_data and color_data.get("ok"):
        for entry in color_data.get("dominant_colors", []):
            if entry.get("name") not in _NEUTRAL and entry.get("weight", 0) > 0.08:
                colors.append(entry["name"])

    # ── Tags → element, traits, platform, domain ─────────────────────────
    lower_tags = [t.lower() for t in tags]
    element: Optional[str] = None
    traits: List[str] = []
    platform: Optional[str] = None
    domain: Optional[str] = None
    for tag in lower_tags:
        if tag in _ELEMENTS and element is None:
            element = tag
        if tag in _TRAITS and len(traits) < 2:
            traits.append(tag)
        if tag in _PLATFORMS and platform is None:
            platform = tag
        if tag in _DOMAINS and domain is None:
            domain = tag

    # ── Design language hint from path (fallback) ─────────────────────────
    if design_parser and not (element and platform):
        if file_path:
            import os
            hint = " ".join(re.split(r"[/\\_ -]", os.path.normpath(file_path))[-4:])
            understood = design_parser.understand(hint)
            concepts = understood.get("concepts", {})
            if not platform and concepts.get("platforms"):
                platform = concepts["platforms"][0]
            if not domain and concepts.get("domains"):
                domain = concepts["domains"][0]
            if not traits and concepts.get("styles"):
                traits = concepts["styles"][:2]
            if not element and concepts.get("screen_types"):
                element = concepts["screen_types"][0]

    # ── Assemble ──────────────────────────────────────────────────────────
    parts: List[str] = []
    confidence = 0.0

    if colors:
        parts.append(colors[0] if len(colors) == 1 else f"{colors[0]}/{colors[1]}")
        confidence += 0.20
    if element:
        parts.append(element)
        confidence += 0.35
    else:
        parts.append("design asset")
        confidence += 0.05
    if traits:
        parts.append("with " + " ".join(traits))
        confidence += 0.20
    if domain:
        parts.append(domain)
        confidence += 0.15
    if platform:
        parts.append(platform + " UI")
        confidence += 0.10

    description = re.sub(r"\s+", " ", " ".join(parts)).strip()
    return {"ok": True, "description": description, "confidence": round(min(1.0, confidence), 2)}
