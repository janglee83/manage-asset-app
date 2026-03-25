"""
Multi-signal ranking engine for local asset search results.

Ranking formula (weighted linear combination, every signal in [0.0, 1.0])::

    final = w_sem  * s_semantic
          + w_kw   * s_keyword
          + w_rec  * s_recency
          + w_fav  * s_favorite
          + w_fld  * s_folder

Signals
-------
s_semantic
    FAISS cosine similarity after L2 normalisation (primary signal).

s_keyword
    Filename token overlap with the query string.
    Always 0 for image-based search (no text query available).

s_recency
    Exponential decay by file age: ``exp(−λ·age_days)``, λ=0.007
    (half-life ≈ 99 days).  Returns the neutral value 0.5 when the
    modification time is unknown.

s_favorite
    1.0 when the asset is in the caller-supplied favourite set, else 0.0.

s_folder
    Boost from the longest-matching folder-priority rule (0..1).
    Returns the neutral value 0.5 when no rule matches.

Weights are automatically re-normalised so their sum equals 1.0.
"""

from __future__ import annotations

import math
import re
import time
from dataclasses import asdict, dataclass
from typing import Callable, Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Recency decay constant — half-life ≈ 99 days.
_RECENCY_LAMBDA: float = 0.007
# Neutral recency returned when modified_at is unknown (zero or negative).
_NEUTRAL_RECENCY: float = 0.5
# Neutral folder boost returned when no folder-priority rule matches.
_NEUTRAL_FOLDER: float = 0.5

# FAISS candidates retrieved per requested result before re-ranking.
FETCH_MULTIPLIER: int = 5
MAX_FETCH: int = 500

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class RankWeights:
    """Relative importance of each ranking signal (need not sum to 1)."""

    semantic: float = 0.60
    keyword:  float = 0.15
    recency:  float = 0.10
    favorite: float = 0.10
    folder:   float = 0.05

    def normalised(self) -> "RankWeights":
        """Return a copy with weights re-scaled so they sum exactly to 1.0."""
        total = (
            self.semantic + self.keyword + self.recency
            + self.favorite + self.folder
        )
        if total <= 0.0:
            return RankWeights()
        f = 1.0 / total
        return RankWeights(
            semantic=self.semantic * f,
            keyword =self.keyword  * f,
            recency =self.recency  * f,
            favorite=self.favorite * f,
            folder  =self.folder   * f,
        )


@dataclass
class FolderPriority:
    """Priority rule: assets inside *prefix* receive *boost* (0.0 – 1.0)."""

    prefix: str
    boost:  float   # 0.0 … 1.0


@dataclass
class AssetSignals:
    """Individual signal values for a single ranked candidate (diagnostics)."""

    semantic: float = 0.0
    keyword:  float = 0.0
    recency:  float = 0.0
    favorite: float = 0.0
    folder:   float = 0.0


@dataclass
class RankedResult:
    asset_id:       str
    semantic_score: float        # raw FAISS inner-product score
    ranked_score:   float        # final weighted composite score
    signals:        AssetSignals # per-signal breakdown (diagnostics)


# ---------------------------------------------------------------------------
# Tokenisation
# ---------------------------------------------------------------------------

_CAMEL_RE = re.compile(r"([a-z])([A-Z])")
_SEP_RE   = re.compile(r"[^a-z0-9]+")


def _tokenise(text: str) -> List[str]:
    """
    Split *text* into lowercase tokens, handling camelCase and separators.

    Steps:
    1. Insert a space before every uppercase letter that follows a lowercase letter
       so that camelCase words like ``logoDesign`` become ``logo Design``.
    2. Lowercase the result and split on any non-alphanumeric run (including
       hyphens, underscores, spaces).

    Examples::

        'logoDesign_final'  →  ['logo', 'design', 'final']
        'brand-logo_v2'     →  ['brand', 'logo', 'v2']
        'MY QUERY'          →  ['my', 'query']
    """
    expanded = _CAMEL_RE.sub(r"\1 \2", text)
    parts    = _SEP_RE.split(expanded.lower())
    return [t for t in parts if t]


# ---------------------------------------------------------------------------
# Individual signal functions
# ---------------------------------------------------------------------------

def _keyword_score(query: str, filename: str) -> float:
    """
    Filename–query relevance in [0, 1].

    Algorithm
    ---------
    1. Strip the file extension from *filename* to get the stem.
    2. Exact stem match → return 1.0 immediately.
    3. Compute token-level F1 over query-tokens ∩ filename-tokens.
    4. Compute a substring bonus: fraction of query tokens that appear
       anywhere inside the filename stem string.
    5. Return ``0.40·F1 + 0.60·substring_score`` (clamped to 1.0).

    The substring approach surfaces partial matches such as "logo" in
    "black-logo-v2.png" even when tokenisation splits words differently.
    """
    if not query or not filename:
        return 0.0

    # Drop extension; e.g. "brand-logo_v2.PNG" → "brand-logo_v2"
    stem = re.sub(r"\.[^.]+$", "", filename)

    q_tokens = set(_tokenise(query))
    f_tokens = set(_tokenise(stem))

    if not q_tokens:
        return 0.0

    # Fast path: stem equals query exactly (case-insensitive)
    if stem.lower() == query.strip().lower():
        return 1.0

    # Token-level F1
    common    = q_tokens & f_tokens
    precision = len(common) / len(f_tokens) if f_tokens else 0.0
    recall    = len(common) / len(q_tokens)
    denom     = precision + recall
    f1        = (2.0 * precision * recall / denom) if denom else 0.0

    # Substring bonus: query tokens that appear anywhere inside the stem
    stem_lower      = stem.lower()
    substring_hits  = sum(1 for t in q_tokens if t in stem_lower)
    substring_score = substring_hits / len(q_tokens)

    return min(1.0, 0.40 * f1 + 0.60 * substring_score)


def _recency_score(modified_at: float) -> float:
    """
    Exponential decay: ``exp(−λ·age_days)`` where λ = 0.007
    (half-life ≈ 99 days).

    Returns the neutral value 0.5 when *modified_at* is zero or negative
    (i.e. the modification time is unknown).
    """
    if modified_at <= 0.0:
        return _NEUTRAL_RECENCY
    age_days = max(0.0, (time.time() - modified_at) / 86_400.0)
    return math.exp(-_RECENCY_LAMBDA * age_days)


def _folder_score(folder_path: str, priorities: List[FolderPriority]) -> float:
    """
    Return the boost from the best-matching (longest prefix) folder-priority
    rule.  Returns 0.5 (neutral) when *folder_path* matches no rule.

    Rules should be sorted longest-first to short-circuit early on the
    most specific match, but correctness does not depend on ordering.
    """
    best: Optional[FolderPriority] = None
    for rule in priorities:
        if folder_path.startswith(rule.prefix):
            if best is None or len(rule.prefix) > len(best.prefix):
                best = rule
    return best.boost if best is not None else _NEUTRAL_FOLDER


# ---------------------------------------------------------------------------
# Ranker
# ---------------------------------------------------------------------------

class Ranker:
    """
    Rerank a list of FAISS candidates using multiple contextual signals.

    Usage::

        ranker = Ranker()
        results = ranker.rank(
            candidates        = [(asset_id, score), ...],
            query_text        = "logo design",
            meta_lookup       = index_manager.get_meta,
            favorite_ids      = {"uuid1", "uuid2"},
            folder_priorities = [FolderPriority("/design/brand", 0.9)],
            weights           = RankWeights(semantic=0.6, keyword=0.2),
            top_k             = 20,
        )
    """

    @staticmethod
    def fetch_k(top_k: int) -> int:
        """
        Number of FAISS candidates to retrieve before re-ranking.

        Fetching a larger pool allows keyword/recency/favorite/folder signals
        to surface results that score lower on pure semantic similarity.
        """
        return min(top_k * FETCH_MULTIPLIER, MAX_FETCH)

    def rank(
        self,
        candidates:        List[Tuple[str, float]],
        query_text:        str,
        meta_lookup:       Callable[[str], Optional[object]],
        favorite_ids:      Set[str],
        folder_priorities: List[FolderPriority],
        weights:           RankWeights,
        top_k:             int,
        enable_keyword:    bool = True,
    ) -> List[RankedResult]:
        """
        Score and sort *candidates*; return the top-*top_k* results.

        Parameters
        ----------
        candidates
            ``(asset_id, semantic_score)`` pairs from FAISS (already filtered
            by the minimum semantic threshold).
        query_text
            Original text query; empty string for image-similarity search.
        meta_lookup
            Callable that accepts an ``asset_id`` string and returns an
            object with ``filename``, ``folder_path``, ``modified_at``
            attributes — or ``None`` when metadata is unavailable.
        favorite_ids
            Set of asset UUID strings that are currently favourited.
        folder_priorities
            Folder-prefix → boost rules, ordered longest-first for efficiency.
        weights
            Per-signal weights (re-normalised internally; need not sum to 1).
        top_k
            Maximum number of results to return.
        enable_keyword
            Pass ``False`` for image-similarity search.  The keyword weight
            is redistributed to the semantic signal when disabled.
        """
        w = weights.normalised()

        # Redistribute keyword weight to semantic when there is no text query.
        if not enable_keyword:
            w = RankWeights(
                semantic=w.semantic + w.keyword,
                keyword =0.0,
                recency =w.recency,
                favorite=w.favorite,
                folder  =w.folder,
            ).normalised()

        ranked: List[RankedResult] = []

        for asset_id, sem_score in candidates:
            meta = meta_lookup(asset_id)
            filename    = meta.filename    if meta else ""
            folder_path = meta.folder_path if meta else ""
            modified_at = meta.modified_at if meta else 0.0

            s_sem = max(0.0, float(sem_score))
            s_kw  = _keyword_score(query_text, filename) if enable_keyword else 0.0
            s_rec = _recency_score(modified_at)
            s_fav = 1.0 if asset_id in favorite_ids else 0.0
            s_fld = _folder_score(folder_path, folder_priorities)

            final = (
                w.semantic  * s_sem
                + w.keyword * s_kw
                + w.recency * s_rec
                + w.favorite * s_fav
                + w.folder  * s_fld
            )

            ranked.append(RankedResult(
                asset_id       = asset_id,
                semantic_score = float(sem_score),
                ranked_score   = round(final, 6),
                signals        = AssetSignals(
                    semantic = round(s_sem, 4),
                    keyword  = round(s_kw,  4),
                    recency  = round(s_rec, 4),
                    favorite = s_fav,
                    folder   = round(s_fld, 4),
                ),
            ))

        ranked.sort(key=lambda r: r.ranked_score, reverse=True)
        return ranked[:top_k]


# ---------------------------------------------------------------------------
# Helpers for deserialising from JSON-RPC params (used by main.py)
# ---------------------------------------------------------------------------

def weights_from_dict(d: Optional[Dict]) -> RankWeights:
    """Parse a weights dict from JSON-RPC params, using defaults for missing keys."""
    if not d:
        return RankWeights()
    return RankWeights(
        semantic=float(d.get("semantic", 0.60)),
        keyword =float(d.get("keyword",  0.15)),
        recency =float(d.get("recency",  0.10)),
        favorite=float(d.get("favorite", 0.10)),
        folder  =float(d.get("folder",   0.05)),
    )


def folder_priorities_from_list(lst: Optional[List]) -> List[FolderPriority]:
    """
    Parse folder-priority rules from the JSON-RPC params.

    Rules are sorted longest-prefix-first so that ``_folder_score`` returns
    the most specific match on first encounter.
    """
    if not lst:
        return []
    result: List[FolderPriority] = []
    for item in lst:
        try:
            result.append(FolderPriority(
                prefix=str(item["prefix"]),
                boost =float(item["boost"]),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    result.sort(key=lambda r: len(r.prefix), reverse=True)
    return result
