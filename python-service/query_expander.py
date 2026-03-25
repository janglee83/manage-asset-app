"""
Multilingual query expansion — EN / JA / VI.

Strategy
--------
1. Detect query language from Unicode block distribution.
2. Look up the normalised query against a curated UI/design term dictionary
   (English keys + Japanese/Vietnamese translations + synonyms).
3. Return a list of phrases covering all 3 languages so the caller can
   encode them with the multilingual CLIP text encoder and average the
   resulting vectors into a language-agnostic semantic centroid.
4. If no dictionary match, return [query] — the multilingual model handles
   arbitrary language natively.

The averaged multi-prompt vector consistently outperforms single-prompt
encoding for cross-lingual retrieval (same principle as CLIP multi-template).
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Multilingual design term dictionary
# canonical → {en, ja, vi, synonyms}
# ---------------------------------------------------------------------------
_DICT: Dict[str, Dict[str, List[str]]] = {
    "button": {
        "en": ["button", "click button", "call to action"],
        "ja": ["ボタン", "クリックボタン", "送信ボタン"],
        "vi": ["nút bấm", "nút nhấn", "nút điều hướng"],
        "synonyms": ["CTA", "submit button", "action button"],
    },
    "icon": {
        "en": ["icon", "symbol", "glyph"],
        "ja": ["アイコン", "シンボル", "ピクトグラム"],
        "vi": ["biểu tượng", "icon", "ký hiệu"],
        "synonyms": ["pictogram", "vector icon"],
    },
    "card": {
        "en": ["card component", "product card", "info card"],
        "ja": ["カードコンポーネント", "カードUI"],
        "vi": ["thẻ giao diện", "card component"],
        "synonyms": ["tile", "panel", "widget"],
    },
    "modal": {
        "en": ["modal dialog", "popup overlay", "lightbox"],
        "ja": ["モーダルダイアログ", "ポップアップ"],
        "vi": ["hộp thoại", "cửa sổ popup"],
        "synonyms": ["dialog", "overlay", "popup"],
    },
    "nav": {
        "en": ["navigation bar", "menu navigation", "navbar"],
        "ja": ["ナビゲーションバー", "メニューバー"],
        "vi": ["thanh điều hướng", "menu điều hướng"],
        "synonyms": ["header nav", "top bar", "main menu"],
    },
    "dashboard": {
        "en": ["dashboard analytics", "admin dashboard", "data overview"],
        "ja": ["ダッシュボード", "管理画面", "分析画面"],
        "vi": ["bảng điều khiển", "màn hình quản lý"],
        "synonyms": ["analytics panel", "control panel", "metrics"],
    },
    "checkout": {
        "en": ["checkout screen", "payment form", "order summary"],
        "ja": ["チェックアウト", "支払い画面", "注文確認"],
        "vi": ["màn hình thanh toán", "thanh toán"],
        "synonyms": ["cart", "payment", "billing page"],
    },
    "login": {
        "en": ["login form", "sign in screen", "authentication"],
        "ja": ["ログイン画面", "サインイン"],
        "vi": ["màn hình đăng nhập", "đăng nhập"],
        "synonyms": ["sign in", "auth screen", "account login"],
    },
    "form": {
        "en": ["form input", "data entry form", "registration form"],
        "ja": ["フォーム", "入力フォーム"],
        "vi": ["biểu mẫu", "form nhập liệu"],
        "synonyms": ["input form", "user form"],
    },
    "table": {
        "en": ["data table", "grid table", "spreadsheet view"],
        "ja": ["データテーブル", "表", "グリッド"],
        "vi": ["bảng dữ liệu", "table"],
        "synonyms": ["list view", "data grid"],
    },
    "chart": {
        "en": ["data chart", "bar chart", "line graph"],
        "ja": ["チャート", "グラフ", "棒グラフ"],
        "vi": ["biểu đồ", "đồ thị dữ liệu"],
        "synonyms": ["visualization", "graph", "statistics"],
    },
    "profile": {
        "en": ["user profile", "account page", "profile screen"],
        "ja": ["プロフィール", "アカウント画面"],
        "vi": ["trang cá nhân", "hồ sơ người dùng"],
        "synonyms": ["user page", "account settings"],
    },
    "settings": {
        "en": ["settings screen", "preferences panel"],
        "ja": ["設定画面", "環境設定"],
        "vi": ["màn hình cài đặt", "cài đặt"],
        "synonyms": ["preferences", "options", "config"],
    },
    "onboarding": {
        "en": ["onboarding screen", "welcome wizard", "getting started"],
        "ja": ["オンボーディング", "ウェルカム画面"],
        "vi": ["màn hình chào đón", "hướng dẫn khởi đầu"],
        "synonyms": ["intro screen", "tutorial", "first run"],
    },
    "notification": {
        "en": ["notification alert", "toast notification", "system alert"],
        "ja": ["通知", "アラート", "お知らせ"],
        "vi": ["thông báo", "cảnh báo"],
        "synonyms": ["alert", "banner notification", "push message"],
    },
    "mobile": {
        "en": ["mobile design", "smartphone UI", "mobile app"],
        "ja": ["モバイルデザイン", "スマートフォンUI"],
        "vi": ["thiết kế di động", "ứng dụng điện thoại"],
        "synonyms": ["phone UI", "iOS app", "android app"],
    },
    "dark": {
        "en": ["dark theme", "dark mode UI", "night mode"],
        "ja": ["ダークテーマ", "ダークモード"],
        "vi": ["giao diện tối", "chế độ tối"],
        "synonyms": ["dark background", "dark color scheme"],
    },
    "light": {
        "en": ["light theme", "white UI", "clean light design"],
        "ja": ["ライトテーマ", "ホワイトUI"],
        "vi": ["giao diện sáng", "chủ đề sáng"],
        "synonyms": ["white background", "bright UI"],
    },
    "landing": {
        "en": ["landing page", "homepage hero", "marketing page"],
        "ja": ["ランディングページ", "ホームページ"],
        "vi": ["trang đích", "trang chủ"],
        "synonyms": ["home screen", "marketing landing"],
    },
}

# Flat lookup: every alias → canonical key
_LOOKUP: Dict[str, str] = {}
for _canon, _entry in _DICT.items():
    _LOOKUP[_canon.lower()] = _canon
    for _syn in _entry.get("synonyms", []):
        _LOOKUP[_syn.lower()] = _canon


def detect_language(query: str) -> str:
    """Return 'ja', 'vi', or 'en' based on Unicode heuristics."""
    if any("\u3040" <= c <= "\u30ff" for c in query):
        return "ja"
    vi_re = re.compile(
        r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũ"
        r"ưừứựửữỳýỵỷỹđ]", re.IGNORECASE)
    if vi_re.search(query):
        return "vi"
    return "en"


def expand_query(query: str) -> List[str]:
    """
    Return a list of multilingual query strings.

    If the query matches a known design term, returns EN + JA + VI translations.
    Otherwise returns [query] for direct CLIP encoding.
    """
    norm = query.lower().strip()

    # Exact word match
    canonical: Optional[str] = _LOOKUP.get(norm)

    # Substring word match
    if canonical is None:
        for alias, canon in _LOOKUP.items():
            if re.search(r"\b" + re.escape(alias) + r"\b", norm):
                canonical = canon
                break

    if canonical is not None:
        entry = _DICT[canonical]
        prompts: List[str] = []
        if query not in prompts:
            prompts.insert(0, query)
        prompts.extend(entry.get("en", []))
        prompts.extend(entry.get("ja", []))
        prompts.extend(entry.get("vi", []))
        # Deduplicate, order-preserving
        seen: set = set()
        return [p for p in prompts if not (p in seen or seen.add(p))][:12]

    return [query]
