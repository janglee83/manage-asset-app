"""
Design style auto-classifier.

Assigns one of: fintech, ecommerce, enterprise, saas, gaming, healthcare,
social, education, playful, productivity, or "unknown" to an asset based on:
  1. Tags from the tagger (primary signal)
  2. Filename / folder path hints (secondary)
  3. Colour palette hints (tertiary)

No ML model required — rule-based with weighted voting.
All weights derived from domain knowledge; tunable.

Returns:
    {style: str, confidence: float, signals: {tag: float, path: float, color: float}}
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# ── Style vocabulary ──────────────────────────────────────────────────────────

# Each style maps to positive-evidence tags/keywords (lowercase) and a base weight.
_STYLE_SIGNALS: Dict[str, List[str]] = {
    "fintech":    ["payment", "finance", "money", "wallet", "bank", "credit",
                   "invoice", "transaction", "crypto", "trading", "transfer",
                   "receipt", "balance", "account", "invest", "portfolio"],
    "ecommerce":  ["cart", "shop", "product", "checkout", "buying", "order",
                   "purchase", "marketplace", "catalog", "listing", "shipping",
                   "store", "add_to_cart", "wishlist", "price", "discount"],
    "enterprise": ["dashboard", "analytics", "report", "table", "settings",
                   "admin", "management", "crm", "erp", "workflow",
                   "task", "monitor", "compliance", "audit", "approval"],
    "saas":       ["saas", "subscription", "pricing", "onboarding", "upgrade",
                   "settings", "integration", "api", "webhook", "team",
                   "workspace", "invite", "plan", "trial"],
    "gaming":     ["game", "player", "score", "leaderboard", "level",
                   "quest", "achievement", "inventory", "character", "map",
                   "battle", "attack", "skill", "loot"],
    "healthcare": ["health", "medical", "patient", "doctor", "appointment",
                   "symptom", "prescription", "telemedicine", "clinic",
                   "record", "diagnosis", "medication", "wellness"],
    "social":     ["feed", "post", "like", "comment", "follow", "share",
                   "profile", "notification", "message", "story",
                   "community", "friends", "chat"],
    "education":  ["course", "lesson", "quiz", "student", "teacher",
                   "assignment", "grade", "progress", "learning",
                   "certificate", "curriculum", "class", "study"],
    "playful":    ["illustration", "playful", "colorful", "cartoon",
                   "fun", "game", "kids", "emoji", "bright", "mascot",
                   "rounded", "gradient", "sticker"],
    "productivity": ["todo", "task", "calendar", "note", "reminder",
                     "habit", "timer", "focus", "planner", "schedule",
                     "deadline", "project", "kanban", "board"],
}

_PATH_SIGNALS: Dict[str, List[str]] = {
    "fintech":    ["fintech", "bank", "finance", "pay", "wallet"],
    "ecommerce":  ["shop", "store", "ecom", "product", "cart"],
    "enterprise": ["enterprise", "admin", "crm", "erp", "dashboard"],
    "gaming":     ["game", "gaming", "play"],
    "healthcare": ["health", "medical", "clinic"],
    "social":     ["social", "feed", "community"],
    "saas":       ["saas", "app", "platform"],
    "education":  ["edu", "learn", "school"],
    "playful":    ["playful", "kids", "fun"],
    "productivity": ["todo", "tasks", "planner"],
}

# Colour heuristics: styles often associated with specific colour moods
_COLOR_SIGNALS: Dict[str, List[str]] = {
    "fintech":    ["navy", "dark", "green", "gold"],
    "ecommerce":  ["orange", "red", "yellow"],
    "healthcare": ["teal", "green", "white", "blue"],
    "gaming":     ["purple", "indigo", "dark", "black"],
    "social":     ["blue", "pink", "purple"],
    "education":  ["blue", "green", "yellow"],
    "playful":    ["pink", "yellow", "orange", "purple"],
}


def classify_design_style(
    *,
    tags: List[str],
    file_path: str,
    dominant_colors: Optional[List[Dict]] = None,
    top_n: int = 1,
) -> Dict[str, Any]:
    """
    Classify an asset's design style.

    Parameters
    ----------
    tags            : list of tag strings (lowercase; may have 'ai:' prefix stripped)
    file_path       : absolute path (used for folder/filename hints)
    dominant_colors : list of {hex, name, weight} dicts
    top_n           : return top-N styles (default 1)

    Returns
    -------
    {
        "style":      str,          # top-1 predicted style
        "confidence": float,        # 0.0–1.0
        "all_styles": [{style, score}, ...],
        "signals":    {tag, path, color},
    }
    """
    scores: Dict[str, float] = {s: 0.0 for s in _STYLE_SIGNALS}
    tag_contribution: Dict[str, float] = {s: 0.0 for s in _STYLE_SIGNALS}
    path_contribution: Dict[str, float] = {s: 0.0 for s in _STYLE_SIGNALS}
    color_contribution: Dict[str, float] = {s: 0.0 for s in _STYLE_SIGNALS}

    # ── Tag signals (weight 3.0 per match) ───────────────────────────────────
    clean_tags = [t.lower().lstrip("ai:").strip() for t in tags]
    for style, keywords in _STYLE_SIGNALS.items():
        for tag in clean_tags:
            for kw in keywords:
                if kw in tag:
                    scores[style]           += 3.0
                    tag_contribution[style] += 3.0
                    break

    # ── Path signals (weight 1.5 per match) ───────────────────────────────────
    path_lower = file_path.lower()
    for style, patterns in _PATH_SIGNALS.items():
        for pat in patterns:
            if pat in path_lower:
                scores[style]            += 1.5
                path_contribution[style] += 1.5

    # ── Colour signals (weight 1.0 per match) ─────────────────────────────────
    if dominant_colors:
        color_names = {c.get("name", "").lower() for c in dominant_colors}
        for style, colors in _COLOR_SIGNALS.items():
            for name in color_names:
                if name in colors:
                    scores[style]             += 1.0 * (dominant_colors[0].get("weight", 0.5) if dominant_colors else 0.5)
                    color_contribution[style] += 1.0

    total = sum(scores.values())
    if total == 0:
        return {
            "style": "unknown", "confidence": 0.0,
            "all_styles": [],
            "signals": {"tag": 0.0, "path": 0.0, "color": 0.0},
        }

    # Normalise
    normalised = {s: v / total for s, v in scores.items()}
    ranked     = sorted(normalised.items(), key=lambda x: -x[1])
    top_style, top_conf = ranked[0]

    return {
        "style":      top_style if top_conf > 0 else "unknown",
        "confidence": round(top_conf, 4),
        "all_styles": [{"style": s, "score": round(sc, 4)} for s, sc in ranked[:top_n + 3]],
        "signals": {
            "tag":   round(tag_contribution.get(top_style, 0.0), 3),
            "path":  round(path_contribution.get(top_style, 0.0), 3),
            "color": round(color_contribution.get(top_style, 0.0), 3),
        },
    }


def classify_batch(
    entries: List[Dict],
) -> List[Dict]:
    """
    Classify a batch of assets.

    Each entry: {asset_id, tags, file_path, dominant_colors (optional)}
    Returns:    [same fields + {style, confidence, all_styles, signals}]
    """
    results = []
    for entry in entries:
        asset_id = entry.get("asset_id", "")
        result   = classify_design_style(
            tags            = entry.get("tags") or [],
            file_path       = entry.get("file_path") or "",
            dominant_colors = entry.get("dominant_colors"),
        )
        results.append({
            "asset_id":   asset_id,
            **result,
        })
    return results
