"""
Local AI auto-tagging pipeline for design assets.

Approach
--------
We reuse the CLIP image encoder that is already loaded for semantic search.
For each image we compute the cosine similarity between its 512-dim CLIP
embedding and the embeddings of a curated multilingual tag vocabulary.
Tags whose similarity exceeds *threshold* are accepted; the result is
sorted by score descending and capped at *max_tags*.

No additional model downloads are required — the same ``clip-ViT-B-32``
encoder used for search drives tagging.

Tag vocabulary
--------------
The vocabulary covers three domains commonly found in digital design libraries:

  • UI elements   — button, icon, card, modal, menu, …
  • Visual traits — blue, dark, gradient, outline, flat, …
  • Asset type    — illustration, photo, logo, wireframe, …

Every tag is provided in English together with Japanese and Vietnamese
translations so the inserted ``tags`` rows cover all three languages
(source = 'ai').

Multilingual generation
~~~~~~~~~~~~~~~~~~~~~~~
The text encoder (``clip-ViT-B-32-multilingual-v1``) produces vectors in
the same 512-dim CLIP space for all supported languages.  We embed each
translation and average the resulting vectors to produce one robust
language-agnostic centroid per tag.  This makes cross-lingual search work
"for free" — a query in any language can hit assets whose tags were
originally written in a different language.

Performance
-----------
Tag embeddings are computed once on first use and cached in memory for the
lifetime of the sidecar process.  Subsequent tag calls skip the text
encoding step entirely: tagging an image requires only one CLIP image
forward pass plus a matrix-vector product.

Typical latency on CPU (ViT-B/32):
  First call  : ~1–3 s  (includes building the tag embedding cache)
  Subsequent  : ~150–400 ms per image
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Multilingual tag vocabulary
# Each entry: (canonical_english_tag, [translations_for_embedding])
# Translations are fed to the multilingual text encoder to build language-
# agnostic centroids.  The canonical English name is what gets stored in
# SQLite; the translations only influence the CLIP cosine score.
# ---------------------------------------------------------------------------
_VOCAB: List[Tuple[str, List[str]]] = [
    # ── UI Elements ──────────────────────────────────────────────────────────
    ("button",       ["button", "ボタン", "nút bấm"]),
    ("icon",         ["icon", "アイコン", "biểu tượng"]),
    ("card",         ["card component", "カード", "thẻ giao diện"]),
    ("modal",        ["modal dialog", "モーダル", "hộp thoại"]),
    ("menu",         ["navigation menu", "メニュー", "menu điều hướng"]),
    ("navbar",       ["navigation bar", "ナビゲーションバー", "thanh điều hướng"]),
    ("sidebar",      ["sidebar panel", "サイドバー", "thanh bên"]),
    ("form",         ["form input", "フォーム", "biểu mẫu"]),
    ("input",        ["text input field", "入力フィールド", "ô nhập liệu"]),
    ("dropdown",     ["dropdown selector", "ドロップダウン", "danh sách thả xuống"]),
    ("checkbox",     ["checkbox toggle", "チェックボックス", "hộp kiểm"]),
    ("toggle",       ["toggle switch", "トグル", "nút chuyển đổi"]),
    ("badge",        ["badge label", "バッジ", "huy hiệu"]),
    ("tooltip",      ["tooltip popup", "ツールチップ", "chú thích tooltip"]),
    ("tab",          ["tab navigation", "タブ", "thanh tab"]),
    ("table",        ["data table", "テーブル", "bảng dữ liệu"]),
    ("chart",        ["data chart graph", "チャート", "biểu đồ dữ liệu"]),
    ("avatar",       ["user avatar profile picture", "アバター", "ảnh đại diện"]),
    ("notification", ["notification alert", "通知", "thông báo"]),
    ("search",       ["search bar", "検索バー", "thanh tìm kiếm"]),
    ("pagination",   ["pagination controls", "ページネーション", "phân trang"]),
    ("breadcrumb",   ["breadcrumb navigation", "パンくずリスト", "đường dẫn"]),
    ("progress",     ["progress bar loading", "プログレスバー", "thanh tiến trình"]),
    ("spinner",      ["loading spinner", "スピナー", "vòng xoay tải"]),
    ("dialog",       ["dialog box popup", "ダイアログ", "hộp thoại"]),
    ("header",       ["page header", "ヘッダー", "tiêu đề trang"]),
    ("footer",       ["page footer", "フッター", "chân trang"]),
    ("hero",         ["hero section banner", "ヒーロー", "banner chính"]),
    ("grid",         ["layout grid", "グリッドレイアウト", "bố cục lưới"]),
    ("list",         ["list items", "リスト", "danh sách"]),

    # ── Visual traits ────────────────────────────────────────────────────────
    ("blue",         ["blue color", "青色", "màu xanh lam"]),
    ("red",          ["red color", "赤色", "màu đỏ"]),
    ("green",        ["green color", "緑色", "màu xanh lá"]),
    ("yellow",       ["yellow color", "黄色", "màu vàng"]),
    ("purple",       ["purple violet color", "紫色", "màu tím"]),
    ("orange",       ["orange color", "オレンジ色", "màu cam"]),
    ("dark",         ["dark theme dark mode", "ダークテーマ", "giao diện tối"]),
    ("light",        ["light theme white", "ライトテーマ", "giao diện sáng"]),
    ("gradient",     ["gradient background", "グラジェント", "gradient màu"]),
    ("outline",      ["outline stroke border", "アウトライン", "viền ngoài"]),
    ("flat",         ["flat design minimalist", "フラットデザイン", "thiết kế phẳng"]),
    ("3d",           ["3D render", "3Dレンダリング", "mô hình 3D"]),
    ("rounded",      ["rounded corners", "角丸", "góc bo tròn"]),
    ("shadow",       ["drop shadow", "シャドウ", "bóng đổ"]),
    ("transparent",  ["transparent background", "透明背景", "nền trong suốt"]),
    ("colorful",     ["colorful multicolor", "カラフル", "nhiều màu sắc"]),
    ("monochrome",   ["monochrome single color", "モノクロ", "đơn sắc"]),

    # ── Asset type / domain ──────────────────────────────────────────────────
    ("illustration", ["vector illustration", "イラスト", "hình minh họa"]),
    ("photo",        ["photograph realistic photo", "写真", "ảnh chụp thực tế"]),
    ("logo",         ["logo brand mark", "ロゴ", "logo thương hiệu"]),
    ("wireframe",    ["wireframe mockup", "ワイヤーフレーム", "khung dây"]),
    ("mockup",       ["app mockup prototype", "モックアップ", "bản mô phỏng"]),
    ("typography",   ["typography font text", "タイポグラフィ", "kiểu chữ"]),
    ("pattern",      ["background pattern texture", "パターン", "hoa văn nền"]),
    ("animation",    ["animation motion", "アニメーション", "hoạt ảnh"]),
    ("screenshot",   ["screenshot capture", "スクリーンショット", "ảnh chụp màn hình"]),
    ("dashboard",    ["admin dashboard panel", "ダッシュボード", "bảng điều khiển"]),
    ("landing",      ["landing page website", "ランディングページ", "trang đích"]),
    ("mobile",       ["mobile app smartphone", "モバイルアプリ", "ứng dụng di động"]),
    ("desktop",      ["desktop application", "デスクトップアプリ", "ứng dụng máy tính"]),
    ("email",        ["email template newsletter", "メールテンプレート", "mẫu email"]),
    ("social",       ["social media post", "ソーシャルメディア", "mạng xã hội"]),
    ("presentation", ["slide presentation", "プレゼンテーション", "bài thuyết trình"]),
    ("infographic",  ["infographic diagram", "インフォグラフィック", "đồ họa thông tin"]),
    ("map",          ["map geographic", "地図", "bản đồ"]),
    ("avatar-image", ["avatar character person", "人物アバター", "nhân vật hình đại diện"]),
    ("background",   ["background wallpaper", "壁紙背景", "hình nền"]),
    ("banner",       ["banner advertisement", "バナー広告", "banner quảng cáo"]),
]

# Minimum cosine similarity to accept a tag (inner-product on L2-normalised vectors).
DEFAULT_THRESHOLD: float = 0.22

# Maximum tags returned per asset.
DEFAULT_MAX_TAGS: int = 8


# ---------------------------------------------------------------------------
# Tag embedding cache
# ---------------------------------------------------------------------------

@dataclass
class _TagEntry:
    tag:      str          # canonical English tag (stored in SQLite)
    centroid: np.ndarray   # L2-normalised average of translation embeddings


class Tagger:
    """
    Zero-extra-download auto-tagger that reuses the CLIP text + image encoders.

    The tagger is instantiated once in main.py.  On first use it builds a
    512-dim centroid vector per tag by averaging the multilingual CLIP text
    embeddings for each translation.  The centroids are cached so subsequent
    calls only require one image forward pass.
    """

    def __init__(self) -> None:
        self._entries: Optional[List[_TagEntry]] = None  # None = not built yet
        self._tag_matrix: Optional[np.ndarray]  = None  # (n_tags, 512)

    # ── Cache build ───────────────────────────────────────────────────────────

    def _build_cache(self, embedder) -> None:
        """
        Encode all tag translations once and build the centroid matrix.

        Parameters
        ----------
        embedder  Embedder instance (from embedder.py); provides encode_texts().
        """
        if self._entries is not None:
            return

        log.info("[tagger] Building tag embedding cache (%d tags)…", len(_VOCAB))

        # Flatten all translations into one big batch for efficiency.
        all_texts:  List[str] = []
        boundaries: List[int] = [0]  # start index per tag

        for _, translations in _VOCAB:
            all_texts.extend(translations)
            boundaries.append(len(all_texts))

        # Encode in one shot — text encoder is already warm from search usage.
        all_vecs = embedder.encode_texts(all_texts)  # (total_texts, 512)

        entries: List[_TagEntry] = []
        for i, (tag, _) in enumerate(_VOCAB):
            start = boundaries[i]
            end   = boundaries[i + 1]
            chunk = all_vecs[start:end]  # (n_translations, 512)
            # Average and re-normalise to produce a language-agnostic centroid.
            centroid = chunk.mean(axis=0)
            norm     = np.linalg.norm(centroid)
            if norm > 0:
                centroid /= norm
            entries.append(_TagEntry(tag=tag, centroid=centroid))

        self._entries    = entries
        self._tag_matrix = np.stack([e.centroid for e in entries])  # (n_tags, 512)
        log.info("[tagger] Tag cache ready.")

    # ── Public API ────────────────────────────────────────────────────────────

    def suggest_tags(
        self,
        image_vec: np.ndarray,
        embedder,
        threshold: float = DEFAULT_THRESHOLD,
        max_tags:  int   = DEFAULT_MAX_TAGS,
    ) -> List[Dict]:
        """
        Return suggested tags for a pre-encoded image vector.

        Parameters
        ----------
        image_vec
            L2-normalised CLIP image embedding, shape (512,) or (1, 512).
        embedder
            Embedder instance — used only for building the cache on first call.
        threshold
            Minimum cosine similarity to include a tag.
        max_tags
            Maximum number of tags to return.

        Returns
        -------
        List of ``{"tag": str, "score": float}`` dicts, sorted by score desc.
        Scores are rounded to 4 decimal places.
        """
        self._build_cache(embedder)

        vec = image_vec.reshape(512).astype(np.float32)
        # tag_matrix is already L2-normalised; vec is already normalised.
        # Dot product = cosine similarity.
        scores = self._tag_matrix @ vec  # (n_tags,)

        results = []
        for entry, score in zip(self._entries, scores):
            if float(score) >= threshold:
                results.append({"tag": entry.tag, "score": round(float(score), 4)})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:max_tags]

    def tag_image_file(
        self,
        file_path: str,
        embedder,
        threshold: float = DEFAULT_THRESHOLD,
        max_tags:  int   = DEFAULT_MAX_TAGS,
    ) -> List[Dict]:
        """
        End-to-end convenience: open an image, embed it, return tag suggestions.

        Parameters
        ----------
        file_path  Absolute path to an image file.
        embedder   Embedder instance.
        threshold  Cosine similarity cutoff.
        max_tags   Cap on returned tags.

        Returns
        -------
        List of ``{"tag": str, "score": float}`` dicts.

        Raises
        ------
        IOError if the file cannot be opened or embedded.
        """
        vecs, failed = embedder.encode_images([file_path])
        if failed:
            raise IOError(f"Cannot open image: {file_path}")
        return self.suggest_tags(vecs[0], embedder, threshold=threshold, max_tags=max_tags)

    def batch_tag(
        self,
        entries: List[Dict],
        embedder,
        threshold: float = DEFAULT_THRESHOLD,
        max_tags:  int   = DEFAULT_MAX_TAGS,
    ) -> List[Dict]:
        """
        Tag multiple assets efficiently using a single batched image encode call.

        Parameters
        ----------
        entries
            List of ``{"asset_id": str, "file_path": str}`` dicts.
        embedder
            Embedder instance.
        threshold
            Cosine similarity cutoff.
        max_tags
            Cap per asset.

        Returns
        -------
        List of::

            {
                "asset_id": str,
                "tags":     [{"tag": str, "score": float}, ...],
                "error":    str | None,
            }
        """
        if not entries:
            return []

        self._build_cache(embedder)

        paths     = [e["file_path"] for e in entries]
        asset_ids = [e["asset_id"]  for e in entries]

        vecs, failed_indices = embedder.encode_images(paths)
        failed_set = set(failed_indices)

        results = []
        for i, aid in enumerate(asset_ids):
            if i in failed_set:
                results.append({
                    "asset_id": aid,
                    "tags":  [],
                    "error": f"Cannot open: {paths[i]}",
                })
            else:
                tags = self.suggest_tags(vecs[i], embedder,
                                          threshold=threshold,
                                          max_tags=max_tags)
                results.append({"asset_id": aid, "tags": tags, "error": None})

        return results
