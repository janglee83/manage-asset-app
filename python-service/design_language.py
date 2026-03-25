"""Design language query understanding for visual asset search.

Maps design-oriented natural language queries into enriched prompts that are
optimised for CLIP-based visual search.  The key insight is that short design
adjectives like "clean" or "dark" leave CLIP underspecified — expanding them
to visually descriptive phrases gives the encoder more surface area to match
against indexed design assets.

Multi-prompt averaging
----------------------
When a query is recognised as design language, ``understand()`` returns
multiple natural-language prompts that describe the same intent from different
angles.  Encoding all prompts and averaging the L2-normalised vectors before
passing to FAISS consistently improves retrieval precision for design queries
(analogous to the multi-template prompting used in the original CLIP paper).

Supported concepts
------------------
*   **Styles**       — clean, dark, glassmorphism, neumorphism, brutal, …
*   **Platforms**    — mobile, web, desktop, tablet, watch, tv, …
*   **Screen types** — dashboard, checkout, login, onboarding, card, feed, …
*   **Domains**      — fintech, e-commerce, SaaS, healthcare, social, …
*   **Color schemes** — dark, light, neon, pastel, gradient, monochrome, …
*   **Moods**        — modern, minimal, bold, elegant, playful, serious, …

Examples
--------
>>> p = DesignQueryParser()
>>> r = p.understand("clean fintech screen")
>>> r["is_design_query"]
True
>>> r["concepts"]["domains"]
['fintech']
>>> r["expanded_prompt"]
'a clean minimal fintech financial technology screen UI design'

>>> r = p.understand("dark mobile dashboard")
>>> r["concepts"]["styles"]
['dark']
>>> r["concepts"]["platforms"]
['mobile']
>>> r["concepts"]["screen_types"]
['dashboard']
"""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

# ── Vocabulary maps ────────────────────────────────────────────────────────────
# Each key is the design token.  Each value is a list of CLIP-friendly phrases,
# ordered from most specific to most general.  The first 2 are used in
# caption-style prompts; all are used in the keyword-expansion prompt.

STYLES: Dict[str, List[str]] = {
    "clean":        ["clean minimal", "white space", "uncluttered", "simple layout"],
    "minimal":      ["minimal", "minimalist", "simple", "clean whitespace"],
    "modern":       ["modern", "contemporary", "sleek", "latest design trends"],
    "flat":         ["flat design", "simple 2D", "material influence", "no shadow"],
    "material":     ["material design", "elevation cards", "Google design", "shadow depth"],
    "glassmorphism":["glassmorphism", "frosted glass effect", "translucent blur", "glass UI"],
    "glass":        ["glassmorphism", "frosted glass", "transparent blur"],
    "neumorphism":  ["neumorphism", "soft UI", "extruded surface", "subtle shadow"],
    "skeuomorphic": ["skeuomorphic design", "realistic texture", "3D appearance"],
    "bold":         ["bold typography", "strong contrast", "vibrant colors", "heavy weight"],
    "elegant":      ["elegant", "premium quality", "sophisticated", "luxury design"],
    "playful":      ["playful", "friendly", "colorful rounded shapes", "fun interface"],
    "serious":      ["serious professional", "formal", "business-grade"],
    "vibrant":      ["vibrant colors", "vivid palette", "saturated hues"],
    "muted":        ["muted colors", "desaturated", "soft tones"],
    "brutalist":    ["brutalist design", "raw grid layout", "stark typography"],
    "gradient":     ["gradient background", "color blend", "vibrant gradient"],
    "retro":        ["retro design", "vintage style", "nostalgic aesthetic"],
    "futuristic":   ["futuristic design", "sci-fi UI", "high-tech interface"],
    "cyberpunk":    ["cyberpunk aesthetic", "neon dark theme", "dystopian UI"],
    "corporate":    ["corporate design", "enterprise style", "business design"],
    "luxury":       ["luxury premium design", "high-end", "sophisticated aesthetic"],
}

PLATFORMS: Dict[str, List[str]] = {
    "mobile":      ["mobile app", "smartphone screen", "iOS Android app"],
    "android":     ["Android app", "mobile application", "Google material design"],
    "ios":         ["iOS app", "iPhone iPad interface", "Apple design"],
    "web":         ["web application", "browser interface", "website design"],
    "desktop":     ["desktop application", "software window", "computer screen"],
    "tablet":      ["tablet interface", "iPad app", "large mobile screen"],
    "responsive":  ["responsive design", "multi-device layout", "adaptive design"],
    "watch":       ["smartwatch app", "wearable interface", "Apple Watch UI"],
    "tv":          ["TV app interface", "smart television", "large screen UI"],
    "kiosk":       ["kiosk interface", "public terminal", "touch screen display"],
    "ar":          ["augmented reality UI", "AR interface", "spatial design"],
    "vr":          ["virtual reality interface", "VR UI", "immersive design"],
}

SCREEN_TYPES: Dict[str, List[str]] = {
    "dashboard":    ["dashboard", "analytics overview", "data visualization metrics KPI"],
    "checkout":     ["checkout screen", "payment flow", "order summary purchase"],
    "login":        ["login screen", "sign in page", "authentication interface"],
    "signin":       ["sign in screen", "login page", "user authentication"],
    "signup":       ["sign up screen", "registration form", "create account onboarding"],
    "register":     ["registration screen", "sign up form", "create account"],
    "onboarding":   ["onboarding screen", "welcome tutorial", "getting started flow"],
    "welcome":      ["welcome screen", "onboarding", "app introduction"],
    "profile":      ["user profile page", "account screen", "personal settings view"],
    "settings":     ["settings screen", "preferences configuration", "app settings"],
    "feed":         ["news feed", "social timeline", "content stream"],
    "landing":      ["landing page", "marketing hero section", "promotional screen"],
    "home":         ["home screen", "main page", "app homepage"],
    "card":         ["card component", "content card UI", "information panel"],
    "form":         ["form screen", "input fields", "data entry interface"],
    "modal":        ["modal dialog", "popup overlay", "confirmation dialog"],
    "nav":          ["navigation bar", "menu interface", "sidebar navigation"],
    "navigation":   ["navigation", "menu bar", "sidebar nav drawer"],
    "list":         ["list view", "item list", "content listing"],
    "detail":       ["detail page", "product detail view", "item information"],
    "search":       ["search interface", "search results page", "discovery screen"],
    "payment":      ["payment screen", "billing interface", "transaction view"],
    "map":          ["map interface", "location view", "geolocation screen"],
    "chart":        ["chart graphs", "data visualization", "analytics charts"],
    "gallery":      ["image gallery", "photo grid", "media viewer"],
    "calendar":     ["calendar view", "schedule interface", "date picker"],
    "shop":         ["product listing", "e-commerce shop", "store catalog"],
    "cart":         ["shopping cart", "bag checkout", "items to buy"],
    "notification": ["notification center", "alerts inbox", "push notifications"],
    "empty":        ["empty state", "zero state placeholder", "no results screen"],
    "error":        ["error screen", "404 page", "failure state"],
    "success":      ["success confirmation", "completion screen", "done state"],
    "loading":      ["loading screen", "skeleton placeholder", "progress indicator"],
    "splash":       ["splash screen", "launch screen", "app loading"],
    "chat":         ["chat interface", "messaging screen", "conversation UI"],
    "inbox":        ["email inbox", "messages list", "notification inbox"],
    "video":        ["video player interface", "media player", "streaming screen"],
    "table":        ["data table", "spreadsheet view", "grid list"],
    "pricing":      ["pricing page", "subscription plans", "tier comparison"],
    "review":       ["review screen", "rating interface", "feedback form"],
    "screen":       ["UI screen", "application screen", "interface view"],
    "page":         ["web page design", "screen layout", "interface page"],
    "ui":           ["user interface", "app design", "screen layout"],
    "interface":    ["user interface design", "app screen", "interaction design"],
    "layout":       ["layout design", "screen composition", "UI structure"],
    "component":    ["UI component", "design element", "interface widget"],
    "wireframe":    ["wireframe layout", "prototype screen", "UI skeleton"],
}

DOMAINS: Dict[str, List[str]] = {
    "fintech":      ["fintech financial technology", "banking app", "finance money"],
    "banking":      ["banking application", "financial services", "bank account"],
    "finance":      ["financial app", "money management", "investment portfolio"],
    "crypto":       ["cryptocurrency app", "blockchain wallet", "DeFi web3 interface"],
    "blockchain":   ["blockchain interface", "crypto wallet", "web3 application"],
    "ecommerce":    ["e-commerce shopping", "online retail", "product catalog store"],
    "shop":         ["shopping app", "retail store", "e-commerce product"],
    "retail":       ["retail app", "store interface", "product shopping"],
    "saas":         ["SaaS dashboard", "software service", "enterprise B2B tool"],
    "enterprise":   ["enterprise application", "business software", "corporate tool"],
    "healthcare":   ["healthcare medical app", "patient portal", "clinic interface"],
    "health":       ["health wellness app", "medical tracking", "fitness health"],
    "medical":      ["medical app", "patient interface", "clinical software"],
    "fitness":      ["fitness workout app", "exercise tracking", "health monitoring"],
    "education":    ["education e-learning", "course platform", "student learning portal"],
    "learning":     ["learning platform", "education app", "course interface"],
    "social":       ["social media app", "social network", "community platform"],
    "travel":       ["travel booking app", "hotel flight reservation", "trip planning"],
    "food":         ["food delivery app", "restaurant ordering", "meal booking"],
    "delivery":     ["delivery service app", "logistics tracking", "order status"],
    "music":        ["music streaming app", "audio player", "playlist interface"],
    "streaming":    ["streaming app", "video audio platform", "media service"],
    "news":         ["news reading app", "media articles", "content publication"],
    "realestate":   ["real estate app", "property listing", "home rental"],
    "gaming":       ["gaming interface", "game UI", "player stats screen"],
    "game":         ["game design", "gaming UI", "interactive entertainment"],
    "hr":           ["HR management", "employee portal", "workforce app"],
    "crm":          ["CRM system", "customer management", "sales pipeline"],
    "productivity": ["productivity app", "task management", "project planning tool"],
    "analytics":    ["analytics platform", "data dashboard", "business intelligence"],
    "data":         ["data management", "analytics interface", "reporting dashboard"],
    "admin":        ["admin panel", "management interface", "backend dashboard"],
    "marketplace":  ["marketplace app", "buy sell platform", "peer to peer commerce"],
    "logistics":    ["logistics tracking", "supply chain", "shipping management"],
    "insurance":    ["insurance app", "policy management", "coverage interface"],
    "portfolio":    ["portfolio website", "creative showcase", "design gallery"],
}

COLOR_SCHEMES: Dict[str, List[str]] = {
    "dark":         ["dark mode", "dark theme", "dark background dark UI"],
    "light":        ["light mode", "white background", "light clean theme"],
    "night":        ["dark night theme", "dark mode", "low-light interface"],
    "black":        ["black dark design", "dark monochrome", "noir interface"],
    "white":        ["white clean minimal", "bright light background"],
    "blue":         ["blue color scheme", "navy azure design", "blue brand"],
    "purple":       ["purple violet indigo theme", "purple brand colors"],
    "green":        ["green color theme", "emerald design", "nature green"],
    "red":          ["red accent design", "coral crimson theme"],
    "orange":       ["orange amber warm theme", "orange brand"],
    "pink":         ["pink rose feminine design", "pink brand palette"],
    "gradient":     ["gradient background", "colorful gradient blend", "multi-color"],
    "neon":         ["neon glowing colors", "vivid neon design", "cyberpunk vivid"],
    "pastel":       ["pastel soft colors", "gentle muted palette", "soft tones"],
    "monochrome":   ["monochrome grayscale", "single color palette", "black and white"],
    "colorful":     ["colorful vibrant", "multi-color interface", "bright palette"],
    "earth":        ["earth tones", "warm brown natural colors", "earthy design"],
    "transparent":  ["transparent background", "glass effect", "see-through UI"],
    "minimal":      ["minimal color usage", "simple palette", "clean tones"],
}

MOODS: Dict[str, List[str]] = {
    "professional": ["professional formal design", "business grade polish"],
    "friendly":     ["friendly approachable", "warm welcoming design"],
    "trustworthy":  ["trustworthy reliable", "secure professional", "credible design"],
    "innovative":   ["innovative cutting-edge", "forward-thinking design"],
    "calm":         ["calm serene", "relaxed soft", "peaceful interface"],
    "energetic":    ["energetic dynamic", "active lively", "high-energy design"],
    "premium":      ["premium high-end", "luxury quality", "exclusive design"],
    "accessible":   ["accessible inclusive", "clear readable", "easy-to-use design"],
    "efficient":    ["efficient streamlined", "productive workflow", "no-frills design"],
    "immersive":    ["immersive engaging", "full-screen experience", "absorbed UI"],
}

# ── Synonym aliases ────────────────────────────────────────────────────────────
# Maps user tokens that don't appear as vocabulary keys to a key that does.
ALIASES: Dict[str, Tuple[str, str]] = {
    # (target_category, target_key)
    "app":          ("screen_types", "ui"),
    "application":  ("screen_types", "ui"),
    "website":      ("platforms",    "web"),
    "site":         ("platforms",    "web"),
    "phone":        ("platforms",    "mobile"),
    "smartphone":   ("platforms",    "mobile"),
    "iphone":       ("platforms",    "ios"),
    "ipad":         ("platforms",    "tablet"),
    "ecom":         ("domains",      "ecommerce"),
    "e-commerce":   ("domains",      "ecommerce"),
    "crypto":       ("domains",      "crypto"),
    "bank":         ("domains",      "banking"),
    "medical":      ("domains",      "healthcare"),
    "gym":          ("domains",      "fitness"),
    "signin":       ("screen_types", "login"),
    "sign-in":      ("screen_types", "login"),
    "sign-up":      ("screen_types", "signup"),
    "register":     ("screen_types", "signup"),
    "dash":         ("screen_types", "dashboard"),
    "cart":         ("screen_types", "cart"),
    "pay":          ("screen_types", "payment"),
    "msg":          ("screen_types", "chat"),
    "message":      ("screen_types", "chat"),
    "inbox":        ("screen_types", "inbox"),
    "notification": ("screen_types", "notification"),
    "night":        ("color_schemes","dark"),
    "black":        ("color_schemes","dark"),
    "white":        ("color_schemes","light"),
    "neon":         ("color_schemes","neon"),
    "pastel":       ("color_schemes","pastel"),
    "glass":        ("styles",       "glassmorphism"),
    "neomorphism":  ("styles",       "neumorphism"),
    "material":     ("styles",       "material"),
    "flat":         ("styles",       "flat"),
    "brutalism":    ("styles",       "brutalist"),
    "modern":       ("moods",        "innovative"),
    "premium":      ("moods",        "premium"),
    "pro":          ("moods",        "professional"),
}

# ── Category map (for lookup) ─────────────────────────────────────────────────
_CATEGORY_MAPS: Dict[str, Dict[str, List[str]]] = {
    "styles":        STYLES,
    "platforms":     PLATFORMS,
    "screen_types":  SCREEN_TYPES,
    "domains":       DOMAINS,
    "color_schemes": COLOR_SCHEMES,
    "moods":         MOODS,
}

# ── Tokeniser ─────────────────────────────────────────────────────────────────

_SPLIT_RE = re.compile(r"[\s_\-/+,;|]+")


def _tokenize(text: str) -> List[str]:
    """Return lowercase non-empty tokens from *text*."""
    return [t for t in _SPLIT_RE.split(text.lower().strip()) if t]


# ── Parser ────────────────────────────────────────────────────────────────────

class DesignQueryParser:
    """Parse human design queries into enriched CLIP-ready prompts.

    Thread-safe (stateless after construction).
    """

    def understand(self, query: str) -> Dict:
        """Return structured understanding of *query*.

        Return schema::

            {
                "original":        str,
                "expanded_prompt": str,    # primary enriched prompt
                "prompts":         list[str], # 1–3 variants for multi-avg
                "concepts": {
                    "styles":        list[str],
                    "platforms":     list[str],
                    "screen_types":  list[str],
                    "domains":       list[str],
                    "color_schemes": list[str],
                    "moods":         list[str],
                },
                "confidence":      float,  # 0.0–1.0
                "is_design_query": bool,
            }
        """
        if not query or not query.strip():
            return self._empty(query)

        tokens   = _tokenize(query)
        concepts = self._extract_concepts(tokens)
        prompts  = self._build_prompts(concepts, query)
        conf     = self._confidence(concepts)

        return {
            "original":        query,
            "expanded_prompt": prompts[0] if prompts else query,
            "prompts":         prompts if prompts else [query],
            "concepts":        concepts,
            "confidence":      round(conf, 3),
            "is_design_query": conf >= 0.35,
        }

    def expand(self, query: str) -> str:
        """Return a single expanded CLIP-friendly prompt for *query*."""
        r = self.understand(query)
        return r["expanded_prompt"]

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _empty(self, original: str) -> Dict:
        return {
            "original":        original,
            "expanded_prompt": original,
            "prompts":         [original] if original else [],
            "concepts":        {k: [] for k in _CATEGORY_MAPS},
            "confidence":      0.0,
            "is_design_query": False,
        }

    def _extract_concepts(self, tokens: List[str]) -> Dict[str, List[str]]:
        """Map each token to its vocabulary category."""
        hits: Dict[str, List[str]] = {k: [] for k in _CATEGORY_MAPS}

        for token in tokens:
            # 1. Direct key lookup in all category maps.
            for cat, vmap in _CATEGORY_MAPS.items():
                if token in vmap and token not in hits[cat]:
                    hits[cat].append(token)
                    break

            # 2. Alias lookup (only if not already matched above).
            else:
                if token in ALIASES:
                    cat, key = ALIASES[token]
                    if cat in hits and key not in hits[cat]:
                        hits[cat].append(key)

        return hits

    def _confidence(self, concepts: Dict[str, List[str]]) -> float:
        """Confidence that the query is design language (0.0–1.0).

        Scoring:
        * 0 matches     → 0.0
        * 1 category    → 0.45
        * 2 categories  → 0.60
        * 3 categories  → 0.75
        * 4+ categories → ~0.85–0.90
        """
        total_matches = sum(len(v) for v in concepts.values())
        if total_matches == 0:
            return 0.0
        hit_cats = sum(1 for v in concepts.values() if v)
        return min(1.0, 0.45 + 0.15 * (hit_cats - 1))

    def _build_prompts(self, concepts: Dict[str, List[str]], original: str) -> List[str]:
        """Build 1–3 caption-style prompts from detected design concepts.

        Three prompts are generated when enough concepts are present:
        * Prompt 1 — Direct caption: "a dark minimal mobile fintech dashboard UI"
        * Prompt 2 — App description: "dark mobile fintech application dashboard"
        * Prompt 3 — Keyword expansion: all expansion terms joined as a phrase

        When nothing is detected, the original query is returned as-is.
        """
        styles   = concepts.get("styles",        [])
        plats    = concepts.get("platforms",      [])
        screens  = concepts.get("screen_types",   [])
        domains  = concepts.get("domains",        [])
        colors   = concepts.get("color_schemes",  [])
        moods    = concepts.get("moods",          [])

        # Gather first expansion for each detected concept.
        style_exp  = _first_exp(STYLES,        styles)
        plat_exp   = _first_exp(PLATFORMS,     plats)
        screen_exp = _first_exp(SCREEN_TYPES,  screens)
        domain_exp = _first_exp(DOMAINS,       domains)
        color_exp  = _first_exp(COLOR_SCHEMES, colors)
        mood_exp   = _first_exp(MOODS,         moods)

        # ── Prompt 1: caption style ────────────────────────────────────────────
        p1: List[str] = ["a"]
        if style_exp:  p1.append(style_exp)
        if color_exp and color_exp not in style_exp:
            p1.append(color_exp)
        if mood_exp:   p1.append(mood_exp)
        if plat_exp:   p1.append(plat_exp)
        if domain_exp: p1.append(domain_exp)
        p1.append(screen_exp or "UI design")
        if screen_exp:
            p1.append("UI design")
        prompt1 = " ".join(p1).strip()

        # ── Prompt 2: application context ──────────────────────────────────────
        p2: List[str] = []
        if style_exp:  p2.append(style_exp)
        if color_exp and color_exp not in style_exp:
            p2.append(color_exp)
        if plat_exp:   p2.append(plat_exp)
        if domain_exp: p2.append(domain_exp)
        p2.append("application")
        if screen_exp:
            p2 += ["with", screen_exp, "screen"]
        prompt2 = " ".join(p2).strip()

        # ── Prompt 3: keyword expansion ─────────────────────────────────────────
        all_exps: List[str] = []
        for key in styles:
            all_exps.extend(STYLES.get(key, [])[:2])
        for key in colors:
            exps = COLOR_SCHEMES.get(key, [])
            # Skip color if already captured in style expansion (avoid dup)
            all_exps.extend(exps[:2])
        for key in plats:
            all_exps.extend(PLATFORMS.get(key, [])[:2])
        for key in domains:
            all_exps.extend(DOMAINS.get(key, [])[:2])
        for key in screens:
            all_exps.extend(SCREEN_TYPES.get(key, [])[:2])
        for key in moods:
            all_exps.extend(MOODS.get(key, [])[:1])

        # Deduplicate while preserving order.
        seen: set = set()
        deduped: List[str] = []
        for t in all_exps:
            tl = t.lower()
            if tl not in seen:
                seen.add(tl)
                deduped.append(t)

        prompt3 = (" ".join(deduped[:14]) + " design").strip()

        # Collect non-empty unique prompts.
        prompts: List[str] = []
        for p in [prompt1, prompt2, prompt3]:
            p = p.strip()
            if p and p not in prompts:
                prompts.append(p)

        # No vocabulary matched → fall back to original.
        if not deduped:
            return [original]

        return prompts


def _first_exp(vmap: Dict[str, List[str]], keys: List[str]) -> str:
    """Return the first expansion phrase for the first matched key, or ''."""
    for key in keys:
        exps = vmap.get(key, [])
        if exps:
            return exps[0]
    return ""


# ── Module-level singleton ────────────────────────────────────────────────────
# Instantiated once; callers import this instead of creating their own.
parser = DesignQueryParser()


# ── Tests ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    cases = [
        "clean fintech screen",
        "dark mobile dashboard",
        "modern checkout UI",
        "glassmorphism social login",
        "minimal SaaS admin panel",
        "colorful e-commerce product listing",
        "professional healthcare onboarding",
        "hero.png",               # should NOT be design query
        "button_primary.svg",     # should NOT be design query
        "dark",                   # single design token — borderline
        "mobile",                 # single token
    ]

    for q in cases:
        r = parser.understand(q)
        flag = "✓ design" if r["is_design_query"] else "✗ generic"
        print(f"{flag}  [{r['confidence']:.2f}]  {q!r}")
        if r["is_design_query"]:
            print(f"         concepts : {r['concepts']}")
            print(f"         prompt[0]: {r['prompts'][0]!r}")
            if len(r["prompts"]) > 1:
                print(f"         prompt[1]: {r['prompts'][1]!r}")
        print()
