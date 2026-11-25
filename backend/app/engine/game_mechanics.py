"""Pure static loader, trigger matcher, scorer, and formatters for CyberCantina Game Mechanics."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

UMBRELLA_MECHANIC_ID = "__all__"
UMBRELLA_MECHANIC_LABEL = "Mechanics"
CARRYOVER_MATCH_MIN_SCORE = 8

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "reference" / "game_mechanics_catalog.json"

# Linear, non-overlapping boundary matchers (ReDoS-safe, no mid-word emails like user@mechanics.io).
_INLINE_MECHANIC_RE = re.compile(
    r"(?:^|[\s(\[\"'`])@mechanics?(?=$|[\s.,!?;:)\]'\"`])",
    re.IGNORECASE,
)
_STRIP_MECHANIC_MENTION_RE = re.compile(
    r"(?:^|(?<=[\s(\[\"'`]))@mechanics?(?=$|[\s.,!?;:)\]'\"`])",
    re.IGNORECASE,
)
_QUERY_TOKEN_RE = re.compile(r"/?[a-z0-9][a-z0-9_/-]*")

_STOP_WORDS = frozenset(
    {
        "the",
        "how",
        "does",
        "what",
        "is",
        "are",
        "can",
        "you",
        "tell",
        "me",
        "about",
        "explain",
        "work",
        "works",
        "in",
        "of",
        "to",
        "for",
        "on",
        "and",
        "or",
        "do",
        "my",
        "with",
        "when",
        "why",
        "this",
        "that",
        "it",
        "be",
        "from",
        "if",
        "vs",
        "use",
        "using",
        "did",
        "was",
        "were",
        "has",
        "have",
        "not",
        "no",
        "so",
        "but",
        "just",
        "more",
        "also",
        "then",
        "than",
        "like",
        "get",
        "set",
        "make",
        "into",
        "at",
        "by",
        "as",
        "an",
        "all",
        "any",
        "its",
        "their",
        "your",
        "our",
        "they",
        "them",
        "she",
        "he",
        "we",
        "who",
        "where",
        "which",
        "will",
        "would",
        "could",
        "should",
        "right",
        "now",
    }
)


@dataclass(frozen=True)
class MechanicsSubcategory:
    """Category metadata for a CyberCantina Game Mechanics group."""

    id: str
    label: str
    short_label: str
    description: str


@dataclass(frozen=True)
class MechanicsScale:
    """Structured mode/scale row inside a Game Mechanics article."""

    label: str
    range_or_tag: str
    meaning: str


@dataclass(frozen=True)
class MechanicsUnderTheHoodItem:
    """Single deterministic constant or threshold under the hood."""

    label: str
    value: str
    detail: str | None = None


@dataclass(frozen=True)
class MechanicsUnderTheHood:
    """Optional technical constants block inside a Game Mechanics article."""

    title: str | None
    summary: str
    items: tuple[MechanicsUnderTheHoodItem, ...]


@dataclass(frozen=True)
class MechanicsArticle:
    """Single Game Mechanics reference article derived from the canonical catalog."""

    id: str
    subcategory_id: str
    title: str
    short_title: str | None
    keywords: tuple[str, ...]
    in_one_line: str
    scales: tuple[MechanicsScale, ...]
    how_it_changes: tuple[str, ...]
    effect_on_play: tuple[str, ...]
    under_the_hood: MechanicsUnderTheHood | None
    related_topic_ids: tuple[str, ...]


@dataclass(frozen=True)
class _IndexedArticle:
    """Pre-indexed lowercase fields for fast deterministic search."""

    index: int
    article: MechanicsArticle
    id_low: str
    id_segments: frozenset[str]
    title_low: str
    short_title_low: str
    keywords_low: tuple[str, ...]
    keywords_exact: frozenset[str]
    keywords_joined: str
    multiword_keywords: tuple[str, ...]
    subcat_low: str
    summary_and_scales_low: str
    body_low: str


@dataclass(frozen=True)
class MechanicsCatalog:
    """Parsed Game Mechanics catalog plus lookup and search indices."""

    schema_version: int
    subcategories: tuple[MechanicsSubcategory, ...]
    articles: tuple[MechanicsArticle, ...]
    subcategories_by_id: dict[str, MechanicsSubcategory]
    articles_by_id: dict[str, MechanicsArticle]
    indexed_articles: tuple[_IndexedArticle, ...]


def _parse_article(raw: dict[str, Any]) -> MechanicsArticle:
    raw_uth = raw.get("under_the_hood")
    uth: MechanicsUnderTheHood | None = None
    if isinstance(raw_uth, dict):
        uth = MechanicsUnderTheHood(
            title=raw_uth.get("title"),
            summary=str(raw_uth.get("summary") or ""),
            items=tuple(
                MechanicsUnderTheHoodItem(
                    label=str(item.get("label") or ""),
                    value=str(item.get("value") or ""),
                    detail=item.get("detail"),
                )
                for item in (raw_uth.get("items") or [])
            ),
        )
    return MechanicsArticle(
        id=str(raw["id"]),
        subcategory_id=str(raw["subcategory_id"]),
        title=str(raw["title"]),
        short_title=raw.get("short_title"),
        keywords=tuple(str(k) for k in (raw.get("keywords") or [])),
        in_one_line=str(raw.get("in_one_line") or ""),
        scales=tuple(
            MechanicsScale(
                label=str(s.get("label") or ""),
                range_or_tag=str(s.get("range_or_tag") or ""),
                meaning=str(s.get("meaning") or ""),
            )
            for s in (raw.get("scales") or [])
        ),
        how_it_changes=tuple(str(x) for x in (raw.get("how_it_changes") or [])),
        effect_on_play=tuple(str(x) for x in (raw.get("effect_on_play") or [])),
        under_the_hood=uth,
        related_topic_ids=tuple(str(t) for t in (raw.get("related_topic_ids") or [])),
    )


def _build_indexed_article(
    index: int,
    article: MechanicsArticle,
    subcat: MechanicsSubcategory | None,
) -> _IndexedArticle:
    id_low = article.id.lower()
    keywords_low = tuple(k.lower() for k in article.keywords)
    subcat_low = (
        f"{subcat.label} {subcat.short_label} {subcat.description}".lower()
        if subcat
        else ""
    )
    summary_and_scales_low = " ".join(
        [
            article.in_one_line,
            *(f"{s.label} {s.range_or_tag}" for s in article.scales),
        ]
    ).lower()
    uth_parts: list[str] = []
    if article.under_the_hood is not None:
        uth_parts.append(article.under_the_hood.summary)
        for item in article.under_the_hood.items:
            uth_parts.append(f"{item.label} {item.value} {item.detail or ''}")
    body_low = " ".join(
        [
            *(s.meaning for s in article.scales),
            *article.how_it_changes,
            *article.effect_on_play,
            *uth_parts,
        ]
    ).lower()

    return _IndexedArticle(
        index=index,
        article=article,
        id_low=id_low,
        id_segments=frozenset(seg for seg in id_low.split("-") if seg),
        title_low=article.title.lower(),
        short_title_low=(article.short_title or "").lower(),
        keywords_low=keywords_low,
        keywords_exact=frozenset(keywords_low),
        keywords_joined=" ".join(keywords_low),
        multiword_keywords=tuple(k for k in keywords_low if " " in k),
        subcat_low=subcat_low,
        summary_and_scales_low=summary_and_scales_low,
        body_low=body_low,
    )


@lru_cache(maxsize=1)
def load_mechanics_catalog() -> MechanicsCatalog:
    """Load and index the canonical Game Mechanics JSON catalog from `backend/app/reference/`."""
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    subcategories = tuple(
        MechanicsSubcategory(
            id=str(s["id"]),
            label=str(s["label"]),
            short_label=str(s["short_label"]),
            description=str(s["description"]),
        )
        for s in raw["subcategories"]
    )
    subcategories_by_id = {s.id: s for s in subcategories}
    articles = tuple(_parse_article(a) for a in raw["articles"])
    articles_by_id = {a.id: a for a in articles}
    indexed = tuple(
        _build_indexed_article(i, art, subcategories_by_id.get(art.subcategory_id))
        for i, art in enumerate(articles)
    )
    return MechanicsCatalog(
        schema_version=int(raw.get("schema_version") or 1),
        subcategories=subcategories,
        articles=articles,
        subcategories_by_id=subcategories_by_id,
        articles_by_id=articles_by_id,
        indexed_articles=indexed,
    )


def has_inline_mechanics_trigger(text: str) -> bool:
    """Return True when `text` contains a standalone `@mechanic` or `@mechanics` mention."""
    if not text:
        return False
    return bool(_INLINE_MECHANIC_RE.search(text))


def list_mechanics_articles() -> tuple[MechanicsArticle, ...]:
    """Return all Game Mechanics articles in canonical catalog order."""
    return load_mechanics_catalog().articles


def get_mechanics_article(topic_id: str) -> MechanicsArticle | None:
    """Return a Game Mechanics article by topic slug, or None."""
    return load_mechanics_catalog().articles_by_id.get(topic_id)


def get_subcategory_map() -> dict[str, MechanicsSubcategory]:
    """Return mapping of subcategory slug to `MechanicsSubcategory`."""
    return load_mechanics_catalog().subcategories_by_id


def _clean_query_and_tokens(query: str) -> tuple[str, list[str]]:
    stripped = _STRIP_MECHANIC_MENTION_RE.sub(" ", query or "")
    cleaned = " ".join(stripped.lower().split())
    if not cleaned:
        return "", []
    tokens: list[str] = []
    seen: set[str] = set()
    for raw_tok in _QUERY_TOKEN_RE.findall(cleaned):
        base_check = raw_tok[1:] if raw_tok.startswith("/") else raw_tok
        if len(raw_tok) < 2 or base_check in _STOP_WORDS:
            continue
        if raw_tok not in seen:
            seen.add(raw_tok)
            tokens.append(raw_tok)
    return cleaned, tokens


def _score_article(entry: _IndexedArticle, cleaned: str, tokens: list[str]) -> int:
    score = 0
    if len(cleaned) >= 3:
        if cleaned in entry.title_low or cleaned in entry.short_title_low or cleaned == entry.id_low:
            score += 18
        if any(cleaned in kw for kw in entry.keywords_low):
            score += 14
        for kw in entry.multiword_keywords:
            if kw in cleaned and kw != cleaned:
                score += 12

    for tok in tokens:
        forms = (tok, tok[1:]) if tok.startswith("/") and len(tok) > 1 else (tok,)
        if any(f in entry.keywords_exact or f in entry.id_segments for f in forms):
            score += 8
        if any(
            len(f) >= 3
            and (f in entry.title_low or f in entry.short_title_low or f in entry.keywords_joined)
            for f in forms
        ):
            score += 5
        if any(f in entry.subcat_low for f in forms):
            score += 3
        if any(f in entry.summary_and_scales_low for f in forms):
            score += 2
        if any(f in entry.body_low for f in forms):
            score += 1
    return score


def search_mechanics_articles(
    query: str,
    *,
    limit: int = 2,
    min_score: int = 1,
) -> list[tuple[int, MechanicsArticle]]:
    """Deterministically rank Game Mechanics articles matching `query`."""
    cleaned, tokens = _clean_query_and_tokens(query)
    if not cleaned and not tokens:
        return []

    catalog = load_mechanics_catalog()
    scored: list[tuple[int, int, MechanicsArticle]] = []
    for entry in catalog.indexed_articles:
        s = _score_article(entry, cleaned, tokens)
        if s >= min_score:
            scored.append((s, entry.index, entry.article))

    scored.sort(key=lambda item: (-item[0], item[1]))
    return [(item[0], item[2]) for item in scored[: max(1, limit)]]


def format_mechanics_article_prompt_block(
    article: MechanicsArticle,
    subcat_label: str,
) -> str:
    """Format a single Game Mechanics article cleanly for `<game_mechanics>` injection."""
    lines = [
        f"### {article.title} ({subcat_label})",
        f"Summary: {article.in_one_line}",
    ]
    if article.scales:
        lines.append("Scales & Modes:")
        for row in article.scales:
            lines.append(f"- {row.label} [{row.range_or_tag}]: {row.meaning}")
    if article.how_it_changes:
        lines.append("How It Changes:")
        for bullet in article.how_it_changes:
            lines.append(f"- {bullet}")
    if article.effect_on_play:
        lines.append("Effect on Play:")
        for bullet in article.effect_on_play:
            lines.append(f"- {bullet}")
    if article.under_the_hood is not None:
        uth = article.under_the_hood
        lines.append(f"Under the Hood: {uth.summary}")
        for item in uth.items:
            detail_part = f" — {item.detail}" if item.detail else ""
            lines.append(f"- {item.label}: {item.value}{detail_part}")
    if article.related_topic_ids:
        lines.append("Related Topics: " + ", ".join(article.related_topic_ids))
    return "\n".join(lines)


def format_mechanics_directory_block() -> str:
    """Return a compact 7-category overview for generic bare `@mechanics` queries."""
    catalog = load_mechanics_catalog()
    by_sub: dict[str, list[str]] = {sub.id: [] for sub in catalog.subcategories}
    for art in catalog.articles:
        by_sub.setdefault(art.subcategory_id, []).append(art.title)
    lines = [
        "### CyberCantina Game Mechanics Directory",
        "No single specific rule topic matched directly. Available Codex → Game Mechanics categories and articles:",
    ]
    for sub in catalog.subcategories:
        titles = ", ".join(by_sub.get(sub.id, ()))
        lines.append(f"- {sub.label}: {titles}")
    lines.append("Tip: Pin a specific article via `@mechanics:<topic>` or name a rule (e.g., composure, d20, /choice, travel time, Context Health).")
    return "\n".join(lines)


def format_mechanics_tool_result(
    articles: list[MechanicsArticle],
    subcat_map: dict[str, MechanicsSubcategory],
    total_count: int,
) -> dict[str, Any]:
    """Build single-round structured JSON payload for `lookup_game_rules`."""
    out_articles: list[dict[str, Any]] = []
    for art in articles:
        sub = subcat_map.get(art.subcategory_id)
        item: dict[str, Any] = {
            "id": art.id,
            "subcategory": sub.label if sub else art.subcategory_id,
            "title": art.title,
            "in_one_line": art.in_one_line,
            "scales": [
                {
                    "label": row.label,
                    "range_or_tag": row.range_or_tag,
                    "meaning": row.meaning,
                }
                for row in art.scales
            ],
            "how_it_changes": list(art.how_it_changes),
            "effect_on_play": list(art.effect_on_play),
            "under_the_hood": None,
            "related_topic_ids": list(art.related_topic_ids),
        }
        if art.under_the_hood is not None:
            item["under_the_hood"] = {
                "summary": art.under_the_hood.summary,
                "items": [
                    {
                        "label": u.label,
                        "value": u.value,
                        **({"detail": u.detail} if u.detail else {}),
                    }
                    for u in art.under_the_hood.items
                ],
            }
        out_articles.append(item)
    return {
        "articles": out_articles,
        "total_mechanics_articles": total_count,
    }


def wrap_game_mechanics_section(blocks: list[str]) -> str:
    """Wrap formatted Game Mechanics blocks in `<game_mechanics>` with a strict canon boundary note."""
    note = (
        "NOTE: The entries below document CyberCantina's application and simulation mechanics "
        "(engine rules, UI controls, math, and commands). They are NOT in-universe world canon—"
        "never confuse them with <world> rules or <retrieved_lore>, and never draft World Codex entries from them."
    )
    return "<game_mechanics>\n" + note + "\n\n" + "\n\n".join(blocks) + "\n</game_mechanics>"
