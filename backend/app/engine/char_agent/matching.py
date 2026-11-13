"""Item token matching, mood normalization, and relationship stance formatting."""

from __future__ import annotations

import logging
import re

from app.schemas.character import (
    CharacterRecord,
    ItemInstance,
)
from collections.abc import Sequence

logger = logging.getLogger("cybercantina.character_agent")


_TRAILING_FILLER_WORDS = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "with",
    "from",
    "by",
    "as",
    "while",
    "beneath",
    "under",
    "over",
    "into",
    "her",
    "his",
    "their",
    "its",
    "my",
    "your",
    "is",
    "are",
    "was",
    "were",
    "feeling",
    "currently",
    "very",
    "quite",
}


_LEADING_FILLER_WORDS = {
    "she",
    "he",
    "they",
    "i",
    "is",
    "are",
    "was",
    "feels",
    "feeling",
    "currently",
    "a",
    "an",
    "the",
}


_GENERIC_ITEM_ADJECTIVES = {
    "dark",
    "light",
    "heavy",
    "worn",
    "old",
    "new",
    "small",
    "large",
    "black",
    "white",
    "work",
    "utility",
    "stained",
    "leather",
    "concealed",
}


_USER_ALIASES = {
    "user",
    "player",
    "protagonist",
    "you",
    "the user",
    "the player",
    "the protagonist",
    "stranger",
}


_NARRATOR_ALIASES = {
    "__narrator__",
    "narrator",
    "the narrator",
    "gm",
    "game master",
    "director",
}


_ITEM_ARTICLES = {
    "a",
    "an",
    "the",
    "my",
    "his",
    "her",
    "their",
    "your",
    "some",
    "this",
    "that",
}


def normalize_inventory_item(raw: str | ItemInstance) -> str:
    """Normalize an inventory item label by stripping state tags like '[Worn]' or '(equipped)'."""
    raw_str = raw.name if isinstance(raw, ItemInstance) else str(raw)
    s = raw_str.strip().lower()
    s = re.sub(
        r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*",
        "",
        s,
    )
    s = re.sub(
        r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$",
        "",
        s,
    )
    return s.strip()


def clean_equipped_display_label(raw: str | ItemInstance) -> str:
    """Strip redundant '[Worn]' / '[Equipped]' prefixes when storing into the dedicated equipped list."""
    raw_str = raw.name if isinstance(raw, ItemInstance) else str(raw)
    s = raw_str.strip()
    s = re.sub(r"^[+-]\s*", "", s)
    s = re.sub(
        r"^\[(?:worn|equipped|held|clothing)\]\s*",
        "",
        s,
        flags=re.I,
    )
    s = re.sub(
        r"\s*\((?:worn|equipped|held)\)$",
        "",
        s,
        flags=re.I,
    )
    return s.strip()


def _significant_item_tokens(norm_str: str) -> list[str]:
    stripped = re.sub(r"^[a-z0-9]+'s\s+", "", norm_str.strip().lower())
    return [
        t
        for t in re.findall(r"[a-z0-9]+", stripped)
        if t not in _ITEM_ARTICLES and len(t) >= 2
    ]


def item_names_match_word_bounded(a_raw: str | ItemInstance, b_raw: str | ItemInstance) -> bool:
    """Match item labels strictly on exact normalized name or whole-word significant token subset."""
    a_norm = normalize_inventory_item(a_raw)
    b_norm = normalize_inventory_item(b_raw)
    if not a_norm or not b_norm:
        return False
    if a_norm == b_norm:
        return True

    a_tokens = _significant_item_tokens(a_norm)
    b_tokens = _significant_item_tokens(b_norm)
    if not a_tokens or not b_tokens:
        return False

    a_set = set(a_tokens)
    b_set = set(b_tokens)
    if a_set == b_set:
        return True

    if a_set.issubset(b_set):
        return any(len(t) >= 3 and t not in _GENERIC_ITEM_ADJECTIVES for t in a_set)
    if b_set.issubset(a_set):
        return any(len(t) >= 3 and t not in _GENERIC_ITEM_ADJECTIVES for t in b_set)
    return False


def matches_inventory_query(existing_item: str | ItemInstance, queries: set[str]) -> bool:
    """Return True if existing_item matches any query by exact normalized name or whole-word token subset."""
    if not queries:
        return False
    raw_str = existing_item.name if isinstance(existing_item, ItemInstance) else str(existing_item)
    ex_low = raw_str.strip().lower()
    ex_norm = normalize_inventory_item(raw_str)
    if ex_low in queries or ex_norm in queries:
        return True
    for q in queries:
        if item_names_match_word_bounded(ex_norm, q):
            return True
    return False


def match_best_item_instance(
    candidates: Sequence[ItemInstance],
    raw_query: str,
) -> int | None:
    """Find the single best matching ItemInstance index for raw_query using word-bounded matching."""
    q_norm = normalize_inventory_item(raw_query)
    if not q_norm or not candidates:
        return None
    for idx, cand in enumerate(candidates):
        if normalize_inventory_item(cand.name) == q_norm:
            return idx

    q_tokens = set(_significant_item_tokens(q_norm))
    best_idx: int | None = None
    best_score = 0
    for idx, cand in enumerate(candidates):
        if item_names_match_word_bounded(cand.name, q_norm):
            c_tokens = set(_significant_item_tokens(normalize_inventory_item(cand.name)))
            overlap = len(q_tokens & c_tokens)
            if overlap > best_score:
                best_score = overlap
                best_idx = idx
    return best_idx


def normalize_mood_label(raw: str, fallback: str = "Observant and composed") -> str:
    """Normalize an affective mood string into a crisp 2-4 word evocative mood description."""
    cleaned = re.sub(r"\s*\((?:valence|arousal)[^)]*\)", "", raw or "", flags=re.I)
    cleaned = re.sub(r"^\[mood:\s*([^\]]+)\]", r"\1", cleaned, flags=re.I)
    cleaned = cleaned.strip().strip("\"'`*_.-:;! ")
    if not cleaned:
        cleaned = fallback.strip() or "Observant and composed"

    # Prefer the primary clause before explanatory conjunctions or semicolons when over-verbose
    words_all = cleaned.split()
    if len(words_all) > 4:
        clause = re.split(
            r"[;:.!?\n]|(?:\s+[—–-]\s+)|\b(?:because|while|beneath|despite|after|when|as\s+(?:she|he|they))\b",
            cleaned,
            maxsplit=1,
            flags=re.I,
        )[0].strip()
        if len(clause.split()) >= 2:
            cleaned = clause

    words = [w.strip(",;:!?.") for w in cleaned.split() if w.strip(",;:!?.")]
    while len(words) > 2 and words[0].lower() in _LEADING_FILLER_WORDS:
        words.pop(0)

    if len(words) > 4:
        words = words[:4]
    while len(words) > 2 and words[-1].lower() in _TRAILING_FILLER_WORDS:
        words.pop()

    if len(words) == 1:
        single = words[0].capitalize()
        return f"{single} and observant" if single.lower() != "observant" else "Observant and composed"
    if not words:
        return fallback or "Observant and composed"

    result = " ".join(words)
    return result[0].upper() + result[1:]


def _clamp_sentence(text: str, max_chars: int = 160) -> str:
    """Normalize a stance note into a single clean sentence."""
    s = re.sub(r"\s+", " ", (text or "").strip()).strip("\"'")
    if not s:
        return ""
    first_sent = re.split(r"(?<=[.!?])\s+", s, maxsplit=1)[0].strip()
    if len(first_sent) > max_chars:
        first_sent = first_sent[: max_chars - 1].rsplit(" ", 1)[0].rstrip(",;:") + "."
    if first_sent and first_sent[-1] not in ".!?":
        first_sent += "."
    return first_sent


def normalize_stance_updates(
    raw_stances: dict[str, str],
    *,
    self_id: str,
    self_name: str = "",
    persona_name: str | None = None,
    known_characters: list[CharacterRecord] | None = None,
) -> dict[str, str]:
    """Resolve raw target labels in stance_updates to canonical 'user' or character.id keys."""
    if not raw_stances:
        return {}
    chars = known_characters or []
    normalized: dict[str, str] = {}
    p_low = persona_name.strip().lower() if (persona_name and persona_name.strip()) else ""
    p_first = p_low.split()[0] if p_low else ""

    for raw_target, raw_note in raw_stances.items():
        target_clean = raw_target.strip()
        note_clean = _clamp_sentence(raw_note)
        if not target_clean or not note_clean:
            continue

        t_low = target_clean.lower()
        if t_low in _NARRATOR_ALIASES:
            continue
        if t_low == self_id.lower() or (self_name and t_low == self_name.strip().lower()):
            continue

        canonical_key: str | None = None
        if (
            t_low in _USER_ALIASES
            or t_low.startswith("player ")
            or t_low.startswith("user ")
            or (p_low and t_low == p_low)
            or (len(p_first) >= 3 and t_low == p_first)
        ):
            canonical_key = "user"
        else:
            for ch in chars:
                if ch.id.lower() == t_low or ch.name.strip().lower() == t_low:
                    canonical_key = ch.id
                    break
            if canonical_key is None:
                matches = [
                    ch
                    for ch in chars
                    if len(ch.name.split()[0]) >= 3
                    and (
                        ch.name.split()[0].lower() == t_low
                        or ch.name.split()[0].lower() in t_low
                    )
                ]
                if len(matches) == 1:
                    canonical_key = matches[0].id

        if canonical_key is None:
            # Allow minor unindexed NPC names in clean Title Case, avoiding self
            if self_name and self_name.split()[0].lower() == t_low:
                continue
            canonical_key = target_clean

        if canonical_key != self_id:
            normalized[canonical_key] = note_clean

    return normalized


def format_relationship_notes_for_prompt(
    relationship_notes: dict[str, str],
    character_name_map: dict[str, str] | None = None,
) -> str:
    """Format canonical relationship_notes using human-readable character names for prompts."""
    if not relationship_notes:
        return "None"
    lookup = character_name_map or {}
    parts: list[str] = []
    for key, note in relationship_notes.items():
        if key == "user":
            label = "Player (user)"
        else:
            label = lookup.get(key, key)
        parts.append(f"{label}: {note}")
    return "; ".join(parts)
