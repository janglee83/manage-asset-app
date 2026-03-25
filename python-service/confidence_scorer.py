"""
Multi-signal confidence scorer (0–100).

Signals
-------
semantic   (FAISS cosine)     weight 0.40
keyword    (filename + tag)   weight 0.25
behavior   (click/fav hist)   weight 0.20
design     (concept alignment) weight 0.10
folder     (folder priority)  weight 0.05

All inputs are [0, 1].  Output is int 0–100 with label and per-signal breakdown.
"""
from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional

_W = {"semantic": 0.40, "keyword": 0.25, "behavior": 0.20, "design": 0.10, "folder": 0.05}


def compute_confidence(
    *,
    semantic_score: float = 0.0,
    keyword_score: float = 0.0,
    behavior_score: float = 0.0,
    design_score: float = 0.0,
    folder_score: float = 0.0,
    ranker_signals: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Return {"score": int 0-100, "label": str, "signals": {...}}.

    If `ranker_signals` (from the existing multi-signal ranker) is provided,
    its keyword/folder/favorite values override the corresponding inputs.
    """
    if ranker_signals:
        keyword_score  = ranker_signals.get("keyword",  keyword_score)
        folder_score   = ranker_signals.get("folder",   folder_score)
        behavior_score = max(behavior_score, ranker_signals.get("favorite", 0.0))

    signals = {
        "semantic":  float(min(1.0, max(0.0, semantic_score))),
        "keyword":   float(min(1.0, max(0.0, keyword_score))),
        "behavior":  float(min(1.0, max(0.0, behavior_score))),
        "design":    float(min(1.0, max(0.0, design_score))),
        "folder":    float(min(1.0, max(0.0, folder_score))),
    }
    raw = sum(signals[k] * _W[k] for k in _W)
    score = max(0, min(100, int(round(raw * 100))))
    if score >= 80:   label = "excellent"
    elif score >= 60: label = "good"
    elif score >= 40: label = "fair"
    elif score >= 20: label = "weak"
    else:             label = "poor"
    return {"score": score, "label": label, "signals": {k: round(v, 3) for k, v in signals.items()}}


def score_results(
    results: List[Dict],
    *,
    query: str = "",
    interaction_scores: Optional[Dict[str, float]] = None,
    design_parser=None,
) -> List[Dict]:
    """
    Enrich a list of search result dicts with 'confidence' in-place.

    Each result must have at minimum `asset_id: str` and `score: float`.
    """
    design_score = 0.0
    if design_parser and query:
        understood = design_parser.understand(query)
        if understood.get("is_design_query"):
            design_score = float(understood.get("confidence", 0.0))

    for r in results:
        r["confidence"] = compute_confidence(
            semantic_score=r.get("score", 0.0),
            behavior_score=(interaction_scores or {}).get(r["asset_id"], 0.0),
            design_score=design_score,
            ranker_signals=r.get("signals"),
        )
    return results
