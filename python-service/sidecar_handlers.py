"""
Handler functions for each JSON-RPC method.

Each handler receives:
  params  – the decoded ``params`` dict from the request
  ctx     – a ``SidecarContext`` instance holding all shared module singletons

Returns a JSON-serialisable dict that becomes ``result`` in the response.
"""

from __future__ import annotations

import sys
import threading
from typing import Any, Callable, Dict

from embedder import Embedder
from index_manager import IndexManager
from ranker import Ranker, weights_from_dict, folder_priorities_from_list
from tagger import Tagger, DEFAULT_THRESHOLD, DEFAULT_MAX_TAGS
from design_language import DesignQueryParser
from duplicate_detector import run_pipeline as _run_dup_pipeline
from fig_extractor import extract_fig_metadata as _extract_fig_metadata
import design_tokens as _design_tokens
import layout_analyzer as _layout
import query_expander as _qexpand
import query_rewriter as _qrewrite
import confidence_scorer as _cscorer
import description_generator as _descgen
import component_classifier as _compclass
import version_detector as _verdet
import bulk_tagger as _bulk_tagger
import palette_search as _palette
import style_classifier as _style_cls
import intent_parser as _intent


class SidecarContext:
    """Shared singleton state for all handlers."""

    def __init__(
        self,
        embedder: Embedder,
        index: IndexManager,
        ranker: Ranker,
        tagger: Tagger,
        design_parser: DesignQueryParser,
        push: Callable[[str, Any], None],
    ) -> None:
        self.embedder = embedder
        self.index = index
        self.ranker = ranker
        self.tagger = tagger
        self.design_parser = design_parser
        self.push = push


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def handle_health(_params: Dict, ctx: SidecarContext) -> Dict:
    return {
        "status": "ok",
        "version": "2.0.0",
        "model_info": ctx.embedder.model_info(),
        "index": ctx.index.stats(),
    }


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def handle_embed_asset(params: Dict, ctx: SidecarContext) -> Dict:
    asset_id = str(params["asset_id"])
    file_path = str(params["file_path"])
    force = bool(params.get("force", False))

    if not force and ctx.index.has_asset(asset_id):
        return {"ok": True, "already_indexed": True}

    vecs, failed = ctx.embedder.encode_images([file_path])
    if failed:
        return {"ok": False, "error": f"Cannot open image: {file_path}"}

    ctx.index.add_vectors([asset_id], vecs, failed_indices=[], save=False)
    ctx.index.update_meta_from_path(asset_id, file_path)
    ctx.index.schedule_save()
    return {"ok": True, "already_indexed": False}


def handle_embed_batch(params: Dict, ctx: SidecarContext) -> Dict:
    entries = list(params.get("entries", []))
    skip_indexed = bool(params.get("skip_indexed", True))
    batch_size = int(params.get("batch_size", 16))

    if not entries:
        return {"indexed": 0, "skipped": 0, "errors": []}

    total = len(entries)
    indexed = 0
    skipped = 0
    errors: list = []

    to_process = []
    for e in entries:
        aid = str(e["asset_id"])
        if skip_indexed and ctx.index.has_asset(aid):
            skipped += 1
        else:
            to_process.append(e)

    for batch_start in range(0, len(to_process), batch_size):
        chunk = to_process[batch_start: batch_start + batch_size]
        uuids = [str(c["asset_id"]) for c in chunk]
        paths = [str(c["file_path"]) for c in chunk]

        vecs, failed_indices = ctx.embedder.encode_images(paths)
        added = ctx.index.add_vectors(uuids, vecs, failed_indices=failed_indices, save=False)

        for fi in failed_indices:
            errors.append({"asset_id": uuids[fi], "error": f"Cannot open: {paths[fi]}"})

        for i, uuid in enumerate(uuids):
            if i not in set(failed_indices):
                ctx.index.update_meta_from_path(uuid, paths[i])

        indexed += len(added)
        ctx.push("embed_progress", {"done": batch_start + len(chunk) + skipped, "total": total})

    ctx.index.save()
    return {"indexed": indexed, "skipped": skipped, "errors": errors}


def handle_remove_asset(params: Dict, ctx: SidecarContext) -> Dict:
    ok = ctx.index.remove_asset(str(params["asset_id"]))
    return {"ok": ok}


# ---------------------------------------------------------------------------
# Semantic search
# ---------------------------------------------------------------------------

def handle_search_semantic(params: Dict, ctx: SidecarContext) -> Dict:
    import numpy as np

    query = str(params.get("query", "")).strip()
    top_k = min(int(params.get("top_k", 20)), 200)
    min_score = float(params.get("min_score", 0.15))
    expand = bool(params.get("expand_design_terms", True))

    if not query:
        return {"results": []}

    weights = weights_from_dict(params.get("weights"))
    favorite_ids = set(params.get("favorite_ids") or [])
    folder_priorities = folder_priorities_from_list(params.get("folder_priorities"))

    understanding = None
    if expand:
        understood = ctx.design_parser.understand(query)
        if understood["is_design_query"]:
            understanding = understood
            prompts = understood["prompts"]
            vecs_multi = ctx.embedder.encode_texts(prompts)
            vec = vecs_multi.mean(axis=0)
            norm = float(np.linalg.norm(vec))
            if norm > 0:
                vec = vec / norm
        else:
            vecs = ctx.embedder.encode_texts([query])
            vec = vecs[0]
    else:
        vecs = ctx.embedder.encode_texts([query])
        vec = vecs[0]

    ranked = ctx.index.search_ranked(
        query_vec=vec,
        query_text=query,
        ranker=ctx.ranker,
        top_k=top_k,
        min_score=min_score,
        favorite_ids=favorite_ids,
        folder_priorities=folder_priorities,
        weights=weights,
        enable_keyword=True,
    )
    results = [
        {
            "asset_id": r.asset_id,
            "score": r.semantic_score,
            "ranked_score": r.ranked_score,
            "signals": {
                "semantic": r.signals.semantic,
                "keyword": r.signals.keyword,
                "recency": r.signals.recency,
                "favorite": r.signals.favorite,
                "folder": r.signals.folder,
            },
        }
        for r in ranked
    ]
    response: Dict = {"results": results}
    if understanding is not None:
        response["understanding"] = understanding
    return response


def handle_search_by_image(params: Dict, ctx: SidecarContext) -> Dict:
    file_path = str(params["file_path"])
    top_k = min(int(params.get("top_k", 20)), 200)
    min_score = float(params.get("min_score", 0.15))

    vecs, failed = ctx.embedder.encode_images([file_path])
    if failed:
        return {"results": [], "error": f"Cannot open: {file_path}"}

    weights = weights_from_dict(params.get("weights"))
    favorite_ids = set(params.get("favorite_ids") or [])
    folder_priorities = folder_priorities_from_list(params.get("folder_priorities"))

    ranked = ctx.index.search_ranked(
        query_vec=vecs[0],
        query_text="",
        ranker=ctx.ranker,
        top_k=top_k,
        min_score=min_score,
        favorite_ids=favorite_ids,
        folder_priorities=folder_priorities,
        weights=weights,
        enable_keyword=False,
    )
    results = [
        {
            "asset_id": r.asset_id,
            "score": r.semantic_score,
            "ranked_score": r.ranked_score,
            "signals": {
                "semantic": r.signals.semantic,
                "keyword": r.signals.keyword,
                "recency": r.signals.recency,
                "favorite": r.signals.favorite,
                "folder": r.signals.folder,
            },
        }
        for r in ranked
    ]
    return {"results": results}


def handle_rebuild_index(_params: Dict, ctx: SidecarContext) -> Dict:
    total_before = ctx.index.stats()["total"]
    if total_before > 0:
        new_total = ctx.index.rebuild_with_upgrade()
        return {"ok": True, "total_evicted": 0, "total": new_total}
    ctx.index.clear()
    return {"ok": True, "total_evicted": total_before, "total": 0}


def handle_get_index_stats(_params: Dict, ctx: SidecarContext) -> Dict:
    return ctx.index.stats()


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

def handle_detect_duplicates(params: Dict, ctx: SidecarContext) -> Dict:
    asset_hashes = list(params.get("asset_hashes", []))
    similarity_threshold = float(params.get("similarity_threshold", 0.92))
    max_neighbours = int(params.get("max_neighbours", 10))
    skip_exact = bool(params.get("skip_exact", False))
    skip_similar = bool(params.get("skip_similar", False))

    return _run_dup_pipeline(
        index_manager=ctx.index,
        asset_hashes=asset_hashes,
        similarity_threshold=similarity_threshold,
        max_neighbours=max_neighbours,
        skip_exact=skip_exact,
        skip_similar=skip_similar,
    )


# ---------------------------------------------------------------------------
# Auto-tagging
# ---------------------------------------------------------------------------

def handle_tag_asset(params: Dict, ctx: SidecarContext) -> Dict:
    file_path = str(params["file_path"])
    top_k = int(params.get("top_k", DEFAULT_MAX_TAGS))
    threshold = float(params.get("threshold", DEFAULT_THRESHOLD))

    try:
        tags = ctx.tagger.tag_image_file(
            file_path=file_path,
            embedder=ctx.embedder,
            threshold=threshold,
            max_tags=top_k,
        )
    except IOError as exc:
        return {"tags": [], "error": str(exc)}

    return {"tags": tags}


def handle_tag_batch(params: Dict, ctx: SidecarContext) -> Dict:
    entries = list(params.get("entries", []))
    top_k = int(params.get("top_k", DEFAULT_MAX_TAGS))
    threshold = float(params.get("threshold", DEFAULT_THRESHOLD))

    results = ctx.tagger.batch_tag(
        entries=entries,
        embedder=ctx.embedder,
        threshold=threshold,
        max_tags=top_k,
    )
    return {"results": results}


# ---------------------------------------------------------------------------
# Design language understanding
# ---------------------------------------------------------------------------

def handle_understand_design_query(params: Dict, ctx: SidecarContext) -> Dict:
    query = str(params.get("query", "")).strip()
    return ctx.design_parser.understand(query)


# ---------------------------------------------------------------------------
# OCR text extraction
# ---------------------------------------------------------------------------

def handle_extract_ocr(params: Dict, ctx: SidecarContext) -> Dict:
    from ocr import extract_text, DEFAULT_LANGS

    file_path = params["file_path"]
    langs = tuple(params.get("langs", list(DEFAULT_LANGS)))
    return extract_text(file_path, langs)


def handle_extract_ocr_batch(params: Dict, ctx: SidecarContext) -> Dict:
    from ocr import extract_text, DEFAULT_LANGS

    entries = list(params.get("entries", []))
    langs = tuple(params.get("langs", list(DEFAULT_LANGS)))

    results = []
    for i, entry in enumerate(entries):
        asset_id = entry["asset_id"]
        file_path = entry["file_path"]
        try:
            r = extract_text(file_path, langs)
            results.append({
                "asset_id": asset_id,
                "success": True,
                "full_text": r["full_text"],
                "word_count": r["word_count"],
                "char_count": r["char_count"],
                "error": None,
            })
        except Exception as exc:
            results.append({
                "asset_id": asset_id,
                "success": False,
                "full_text": "",
                "word_count": 0,
                "char_count": 0,
                "error": str(exc),
            })

        ctx.push("ocr_progress", {
            "asset_id": asset_id,
            "done": i + 1,
            "total": len(entries),
        })

    success_count = sum(1 for r in results if r["success"])
    return {"total": len(results), "success_count": success_count, "results": results}


# ---------------------------------------------------------------------------
# .fig metadata extraction
# ---------------------------------------------------------------------------

def handle_extract_fig_metadata(params: Dict, ctx: SidecarContext) -> Dict:
    file_path = str(params.get("file_path", ""))
    if not file_path:
        return {"error": "file_path is required"}
    return _extract_fig_metadata(file_path)


# ---------------------------------------------------------------------------
# Intelligence layer — design tokens
# ---------------------------------------------------------------------------

def handle_analyze_design_tokens(params: Dict, ctx: SidecarContext) -> Dict:
    file_path = str(params.get("file_path", ""))
    if not file_path:
        return {"ok": False, "error": "file_path is required"}
    n_colors = int(params.get("n_colors", 6))
    return _design_tokens.extract_design_tokens(file_path, n_colors=n_colors)


# ---------------------------------------------------------------------------
# Intelligence layer — layout analysis
# ---------------------------------------------------------------------------

def handle_analyze_layout(params: Dict, ctx: SidecarContext) -> Dict:
    file_path = str(params.get("file_path", ""))
    if not file_path:
        return {"ok": False, "error": "file_path is required"}
    return _layout.extract_layout_signature(file_path)


# ---------------------------------------------------------------------------
# Intelligence layer — multilingual query expansion
# ---------------------------------------------------------------------------

def handle_expand_query_multilingual(params: Dict, ctx: SidecarContext) -> Dict:
    query = str(params.get("query", "")).strip()
    if not query:
        return {"ok": False, "error": "query is required"}
    prompts = _qexpand.expand_query(query)
    # Multi-encode all prompts and return the averaged vector
    import numpy as np
    vecs = ctx.embedder.encode_texts(prompts)
    if vecs is None or len(vecs) == 0:
        return {"ok": False, "error": "Embedding failed"}
    avg_vec = vecs.mean(axis=0)
    norm = float(np.linalg.norm(avg_vec))
    if norm > 0:
        avg_vec = avg_vec / norm
    return {
        "ok": True,
        "original": query,
        "prompts": prompts,
        "vector": avg_vec.tolist(),
    }


# ---------------------------------------------------------------------------
# Intelligence layer — get similar assets
# ---------------------------------------------------------------------------

def handle_get_similar_assets(params: Dict, ctx: SidecarContext) -> Dict:
    asset_id = str(params.get("asset_id", "")).strip()
    top_k    = int(params.get("top_k", 10))
    if not asset_id:
        return {"ok": False, "error": "asset_id is required"}
    import numpy as np

    vec = ctx.index.get_vector(asset_id)
    if vec is None:
        return {"ok": False, "error": "Asset not indexed"}

    vec_2d = vec.reshape(1, -1).astype(np.float32)
    results = ctx.index.search_ranked(
        query_vec=vec_2d,
        query_text="",
        ranker=ctx.ranker,
        top_k=top_k + 1,
        min_score=0.72,
        enable_keyword=False,
    )
    filtered = [r for r in results if r.get("asset_id") != asset_id][:top_k]
    return {"ok": True, "results": filtered}


# ---------------------------------------------------------------------------
# Intelligence layer — auto description
# ---------------------------------------------------------------------------

def handle_generate_description(params: Dict, ctx: SidecarContext) -> Dict:
    tags       = params.get("tags") or []
    color_data = params.get("color_data") or {}
    file_path  = str(params.get("file_path", ""))
    return _descgen.generate_description(
        tags=tags,
        color_data=color_data,
        file_path=file_path,
        design_parser=ctx.design_parser,
    )


# ---------------------------------------------------------------------------
# Intelligence layer — batch auto-description
# ---------------------------------------------------------------------------

def handle_generate_description_batch(params: Dict, ctx: SidecarContext) -> Dict:
    """Generate descriptions for multiple assets in one call.

    params:
        entries: [{asset_id, file_path, tags: [...], dominant_colors: [...]}]

    Returns {results: [{asset_id, description, confidence}]}
    """
    entries = params.get("entries") or []
    results = []
    for entry in entries:
        asset_id   = str(entry.get("asset_id", ""))
        file_path  = str(entry.get("file_path", ""))
        tags       = entry.get("tags") or []
        color_data = {"dominant_colors": entry.get("dominant_colors") or []}
        try:
            r = _descgen.generate_description(
                tags=tags,
                color_data=color_data,
                file_path=file_path,
                design_parser=ctx.design_parser,
            )
            results.append({
                "asset_id":    asset_id,
                "description": r.get("description", ""),
                "confidence":  r.get("confidence", 0.0),
                "ok":          r.get("ok", False),
            })
        except Exception as exc:
            results.append({"asset_id": asset_id, "description": "", "confidence": 0.0,
                            "ok": False, "error": str(exc)})
    return {"ok": True, "results": results}


# ---------------------------------------------------------------------------
# Intelligence layer — component families
# ---------------------------------------------------------------------------

def handle_build_component_families(params: Dict, ctx: SidecarContext) -> Dict:
    asset_names = params.get("asset_names") or {}  # {asset_id: file_name}
    asset_tags  = params.get("asset_tags")  or {}  # {asset_id: [tags]}
    return _compclass.build_component_families(
        index=ctx.index,
        asset_names=asset_names,
        asset_tags=asset_tags,
    )


# ---------------------------------------------------------------------------
# Intelligence layer — version chains
# ---------------------------------------------------------------------------

def handle_detect_version_chains(params: Dict, ctx: SidecarContext) -> Dict:
    assets = params.get("assets") or []  # [{id, file_name, folder, modified_at}]
    chains = _verdet.detect_version_chains(assets, index=ctx.index)
    return {"ok": True, "chains": chains, "total": len(chains)}


# ---------------------------------------------------------------------------
# Intelligence layer — query rewriter
# ---------------------------------------------------------------------------

def handle_rewrite_query(params: Dict, ctx: SidecarContext) -> Dict:
    query = str(params.get("query", "")).strip()
    if not query:
        return {"ok": False, "error": "query is required"}
    result = _qrewrite.rewrite_query(query, design_parser=ctx.design_parser)
    return {"ok": True, **result}


# ---------------------------------------------------------------------------
# Intelligence layer — confidence scoring
# ---------------------------------------------------------------------------

def handle_score_results(params: Dict, ctx: SidecarContext) -> Dict:
    results           = params.get("results") or []
    query             = str(params.get("query", ""))
    interaction_scores = params.get("interaction_scores") or {}
    enriched = _cscorer.score_results(
        results,
        query=query,
        interaction_scores=interaction_scores,
        design_parser=ctx.design_parser,
    )
    return {"ok": True, "results": enriched}


# ---------------------------------------------------------------------------
# Intelligence layer — bulk tag suggestion
# ---------------------------------------------------------------------------

def handle_suggest_bulk_tags(params: Dict, ctx: SidecarContext) -> Dict:
    assets_with_tags = params.get("assets_with_tags") or {}
    target_ids       = params.get("target_ids") or []
    top_k            = int(params.get("top_k", 8))
    min_votes        = int(params.get("min_votes", 2))
    return _bulk_tagger.suggest_bulk_tags(
        index=ctx.index,
        assets_with_tags=assets_with_tags,
        target_ids=target_ids,
        top_k=top_k,
        min_votes=min_votes,
    )


# ---------------------------------------------------------------------------
# Intelligence layer — palette clustering + search
# ---------------------------------------------------------------------------

def handle_cluster_by_palette(params: Dict, ctx: SidecarContext) -> Dict:
    asset_color_map = params.get("asset_color_map") or {}
    n_clusters      = int(params.get("n_clusters", 0))
    return _palette.cluster_by_palette(asset_color_map, n_clusters=n_clusters)


def handle_search_by_palette(params: Dict, ctx: SidecarContext) -> Dict:
    query_str       = str(params.get("query", ""))
    asset_color_map = params.get("asset_color_map") or {}
    top_k           = int(params.get("top_k", 20))
    min_score       = float(params.get("min_score", 0.5))
    # Allow either raw color list or a color name string
    query_colors    = params.get("query_colors") or []
    if not query_colors and query_str:
        query_colors = _palette.parse_color_query(query_str)
    return _palette.search_by_palette(query_colors, asset_color_map,
                                      top_k=top_k, min_score=min_score)


# ---------------------------------------------------------------------------
# Intelligence layer — design style classification
# ---------------------------------------------------------------------------

def handle_classify_style(params: Dict, ctx: SidecarContext) -> Dict:
    asset_id        = str(params.get("asset_id", ""))
    tags            = params.get("tags") or []
    file_path       = str(params.get("file_path", ""))
    dominant_colors = params.get("dominant_colors")
    result = _style_cls.classify_design_style(
        tags=tags, file_path=file_path, dominant_colors=dominant_colors,
    )
    return {"ok": True, "asset_id": asset_id, **result}


def handle_classify_style_batch(params: Dict, ctx: SidecarContext) -> Dict:
    entries = params.get("entries") or []
    results = _style_cls.classify_batch(entries)
    return {"ok": True, "results": results}


# ---------------------------------------------------------------------------
# Intelligence layer — NL intent parser
# ---------------------------------------------------------------------------

def handle_parse_intent(params: Dict, ctx: SidecarContext) -> Dict:
    query = str(params.get("query", "")).strip()
    if not query:
        return {"ok": False, "error": "query is required"}
    intent = _intent.parse_intent(query)
    return {"ok": True, **intent}


# ---------------------------------------------------------------------------
# Handler registry builder
# ---------------------------------------------------------------------------

def build_handlers(ctx: SidecarContext) -> Dict[str, Any]:
    """Return a ``{method: callable}`` dict with ``ctx`` bound via closure."""

    def _bind(fn):
        return lambda p: fn(p, ctx)

    return {
        "health":                       _bind(handle_health),
        "embed_asset":                  _bind(handle_embed_asset),
        "embed_batch":                  _bind(handle_embed_batch),
        "remove_asset":                 _bind(handle_remove_asset),
        "search_semantic":              _bind(handle_search_semantic),
        "search_by_image":              _bind(handle_search_by_image),
        "rebuild_index":                _bind(handle_rebuild_index),
        "get_index_stats":              _bind(handle_get_index_stats),
        "detect_duplicates":            _bind(handle_detect_duplicates),
        "tag_asset":                    _bind(handle_tag_asset),
        "tag_batch":                    _bind(handle_tag_batch),
        "extract_ocr":                  _bind(handle_extract_ocr),
        "extract_ocr_batch":            _bind(handle_extract_ocr_batch),
        "understand_design_query":      _bind(handle_understand_design_query),
        "extract_fig_metadata":         _bind(handle_extract_fig_metadata),
        # Intelligence layer
        "analyze_design_tokens":        _bind(handle_analyze_design_tokens),
        "analyze_layout":               _bind(handle_analyze_layout),
        "expand_query_multilingual":    _bind(handle_expand_query_multilingual),
        "get_similar_assets":           _bind(handle_get_similar_assets),
        "generate_description":         _bind(handle_generate_description),
        "generate_description_batch":   _bind(handle_generate_description_batch),
        "build_component_families":     _bind(handle_build_component_families),
        "detect_version_chains":        _bind(handle_detect_version_chains),
        "rewrite_query":                _bind(handle_rewrite_query),
        "score_results":                _bind(handle_score_results),
        # Bulk tagging
        "suggest_bulk_tags":            _bind(handle_suggest_bulk_tags),
        # Palette
        "cluster_by_palette":           _bind(handle_cluster_by_palette),
        "search_by_palette":            _bind(handle_search_by_palette),
        # Style classification
        "classify_style":               _bind(handle_classify_style),
        "classify_style_batch":         _bind(handle_classify_style_batch),
        # NL intent parser
        "parse_intent":                 _bind(handle_parse_intent),
    }
