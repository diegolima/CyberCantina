"""Heuristic character memory extraction, deduplication, resolution, and compaction."""

from __future__ import annotations

import re
import uuid

from app.config import (
    ModelProfile,
    settings,
)
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.mentions import filter_user_message_for_character
from app.prompts import (
    DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM,
    render_template,
)
from app.schemas.character import (
    CharacterRecord,
    MemoryShard,
)
from app.schemas.turn import (
    ExtractedCharacterMemory,
    TurnNodeRecord,
)
from pydantic import (
    BaseModel,
    Field,
)
from typing import Literal

_STOP_WORDS = {
    "the",
    "and",
    "that",
    "this",
    "with",
    "from",
    "have",
    "were",
    "they",
    "their",
    "them",
    "what",
    "when",
    "where",
    "which",
    "while",
    "into",
    "about",
    "after",
    "before",
    "during",
    "between",
    "through",
    "under",
    "over",
    "again",
    "then",
    "once",
    "here",
    "there",
    "some",
    "such",
    "only",
    "very",
    "just",
    "user",
    "turn",
}


def _synthesize_concise_sentences(text: str, max_sentences: int = 2) -> str:
    """Clamp memory content to at most max_sentences complete sentences to prevent verbosity."""
    cleaned = re.sub(r"\s+", " ", text.strip())
    if not cleaned:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    selected = [p.strip() for p in parts[:max_sentences] if p.strip()]
    result = " ".join(selected)
    if result and result[-1] not in ".!?":
        result += "."
    return result


def _tokenize_meaningful(text: str) -> set[str]:
    """Extract lowercase 4+ character tokens excluding stop words."""
    return {
        w
        for w in re.findall(r"[a-z0-9]{4,}", text.lower())
        if w not in _STOP_WORDS
    }


def _memory_similarity(
    title_a: str,
    content_a: str,
    kw_a: list[str],
    title_b: str,
    content_b: str,
    kw_b: list[str],
) -> float:
    """Compute lexical + keyword Jaccard similarity between two memory shards (0.0 to 1.0)."""
    norm_title_a = re.sub(r"[^a-z0-9\s]", "", title_a.lower()).strip()
    norm_title_b = re.sub(r"[^a-z0-9\s]", "", title_b.lower()).strip()
    if norm_title_a and norm_title_a == norm_title_b:
        return 1.0

    tokens_a = _tokenize_meaningful(f"{title_a} {content_a}") | {
        k.lower().strip() for k in kw_a if len(k.strip()) >= 3
    }
    tokens_b = _tokenize_meaningful(f"{title_b} {content_b}") | {
        k.lower().strip() for k in kw_b if len(k.strip()) >= 3
    }
    if not tokens_a or not tokens_b:
        return 0.0

    intersection = len(tokens_a & tokens_b)
    union = len(tokens_a | tokens_b)
    jaccard = intersection / union if union else 0.0

    kw_set_a = {k.lower().strip() for k in kw_a if len(k.strip()) >= 3}
    kw_set_b = {k.lower().strip() for k in kw_b if len(k.strip()) >= 3}
    kw_bonus = 0.15 if (kw_set_a and kw_set_b and (kw_set_a & kw_set_b)) else 0.0
    return min(1.0, jaccard + kw_bonus)


_SIGNIFICANCE_PATTERNS: list[
    tuple[Literal["trauma", "bonding", "betrayal", "revelation", "vow"], re.Pattern[str], str]
] = [
    (
        "betrayal",
        re.compile(
            r"\b(betray(?:ed|al|s|ing)?|stabbed .+ in the back|sold .+ out|double-cross(?:ed)?|"
            r"lied to (?:me|her|him|us)|deceived (?:me|her|him|us)|broke .+ trust)\b",
            re.I,
        ),
        "Bitter Betrayal",
    ),
    (
        "vow",
        re.compile(
            r"\b(swear(?:s|ing)? (?:an oath|on my life|to)|solemn(?:ly)? (?:swear|vow)|"
            r"vow(?:s|ed)? to|promise(?:s|d)? on .+ life|blood oath|never break this promise)\b",
            re.I,
        ),
        "Solemn Vow",
    ),
    (
        "trauma",
        re.compile(
            r"\b(traumatic|traumatized|haunted by|horrified as|watched .+ die|"
            r"blood on .+ hands|shattered .+ psyche|panic attack|reliving the nightmare)\b",
            re.I,
        ),
        "Traumatic Scar",
    ),
    (
        "revelation",
        re.compile(
            r"\b(confess(?:es|ed)? (?:that|to)|dark secret|truth about .+ past|"
            r"revealed the secret|secretly worked for|true identity|hidden truth)\b",
            re.I,
        ),
        "Crucial Revelation",
    ),
    (
        "bonding",
        re.compile(
            r"\b(saved (?:my|her|his) life|trust(?:s)? you with (?:my|her|his) life|"
            r"forgive(?:s)? you completely|unbreakable bond|owe(?:s)? you (?:my|her|his) life)\b",
            re.I,
        ),
        "Deepened Bond",
    ),
]


def _extract_heuristic_character_memories(
    *,
    user_message: str,
    raw_prose: str,
    present_characters: list[CharacterRecord],
    active_character: CharacterRecord | None = None,
    mentioned_entities: list[str] | None = None,
) -> list[ExtractedCharacterMemory]:
    """Deterministic fallback extractor for high-salience personal character memories when offline."""
    if not present_characters:
        return []
    combined = f"{user_message}\n{raw_prose}".strip()
    if not combined:
        return []

    matched_sig: Literal["trauma", "bonding", "betrayal", "revelation", "vow"] | None = None
    label_prefix = ""
    for sig, pattern, prefix in _SIGNIFICANCE_PATTERNS:
        if pattern.search(combined):
            matched_sig = sig
            label_prefix = prefix
            break

    if matched_sig is None:
        return []

    # Determine which present character(s) experienced the moment
    combined_lower = combined.lower()
    target_chars: list[CharacterRecord] = []
    for ch in present_characters:
        first_name = ch.name.split()[0].lower() if ch.name.split() else ch.name.lower()
        if ch.name.lower() in combined_lower or (
            len(first_name) >= 3 and re.search(rf"\b{re.escape(first_name)}\b", combined_lower)
        ):
            target_chars.append(ch)

    if not target_chars:
        if active_character and any(c.id == active_character.id for c in present_characters):
            target_chars = [active_character]
        else:
            target_chars = [present_characters[0]]

    # Build a concise 1-2 sentence synthesis
    p_clean = _synthesize_concise_sentences(raw_prose, max_sentences=1)
    kws = list(
        dict.fromkeys(
            [e for e in (mentioned_entities or []) if len(e.strip()) >= 3]
            + list(_tokenize_meaningful(user_message))[:3]
        )
    )[:5]

    results: list[ExtractedCharacterMemory] = []
    for ch in target_chars:
        u_filtered = filter_user_message_for_character(user_message, ch.id, present_characters)
        u_clean_char = _synthesize_concise_sentences(u_filtered or user_message, max_sentences=1)
        synth = _synthesize_concise_sentences(
            f"{ch.name} experienced a {matched_sig} moment: {u_clean_char} {p_clean}",
            max_sentences=2,
        )
        results.append(
            ExtractedCharacterMemory(
                character_id=ch.id,
                title=f"{label_prefix} ({ch.name})",
                content=synth,
                significance=matched_sig,
                keywords=kws or [matched_sig, ch.name],
                emotional_weight=0.85,
            )
        )
    return results


def resolve_present_character_for_memory(
    raw_id_or_name: str,
    present_characters: list[CharacterRecord],
    default_character: CharacterRecord | None = None,
) -> CharacterRecord | None:
    """Resolve an extracted memory's character_id or name strictly within present_characters."""
    if not present_characters:
        return None
    target = raw_id_or_name.strip().lower()
    if not target and default_character:
        for ch in present_characters:
            if ch.id == default_character.id:
                return ch
        return None

    for ch in present_characters:
        if ch.id.lower() == target or ch.name.lower() == target:
            return ch
    for ch in present_characters:
        first_name = ch.name.split()[0].lower() if ch.name.split() else ch.name.lower()
        if len(first_name) >= 3 and (first_name == target or first_name in target or target in ch.name.lower()):
            return ch
    return None


def apply_extracted_character_memories(
    *,
    extracted_memories: list[ExtractedCharacterMemory],
    present_characters: list[CharacterRecord],
    default_character: CharacterRecord | None,
    raw_shards_by_char: dict[str, list[MemoryShard]],
    valid_turn_ids: set[str],
    completed_turn: TurnNodeRecord,
) -> set[str]:
    """
    Validate, synthesize, deduplicate, and merge extracted personal memories into raw_shards_by_char.
    Returns the set of character_ids whose memory lists were modified.
    """
    modified_char_ids: set[str] = set()
    if not extracted_memories or not present_characters:
        return modified_char_ids

    for item in extracted_memories:
        target_char = resolve_present_character_for_memory(
            item.character_id, present_characters, default_character
        )
        if target_char is None:
            # Strict spatial isolation: characters not present in the room cannot form memories
            continue

        clean_title = item.title.strip()[:80]
        clean_content = _synthesize_concise_sentences(item.content, max_sentences=2)
        if not clean_title or not clean_content:
            continue

        char_shards = raw_shards_by_char.get(target_char.id, [])
        active_shards = [
            (idx, s)
            for idx, s in enumerate(char_shards)
            if CantinaRepository._is_shard_active_on_branch(s, valid_turn_ids)
        ]

        # 1. Check explicit supersedes_memory_id if provided by the Clerk
        superseded_idx: int | None = None
        inherited_depth = completed_turn.depth_index
        if item.supersedes_memory_id:
            for idx, existing in active_shards:
                if existing.id == item.supersedes_memory_id and existing.origin == "clerk_ephemeral":
                    superseded_idx = idx
                    if existing.created_at_depth is not None:
                        inherited_depth = existing.created_at_depth
                    break

        # 2. Check redundancy against existing permanent memories & recent ephemeral memories
        is_redundant_with_permanent = False
        best_ephemeral_match_idx: int | None = None
        best_ephemeral_sim = 0.0

        for idx, existing in active_shards:
            sim = _memory_similarity(
                clean_title,
                clean_content,
                item.keywords,
                existing.title,
                existing.content,
                existing.keywords,
            )
            if existing.origin in ("backstory", "clerk_promoted", "compacted"):
                if sim >= 0.50:
                    is_redundant_with_permanent = True
                    break
            elif existing.origin == "clerk_ephemeral":
                turn_age = (
                    completed_turn.depth_index - existing.created_at_depth
                    if existing.created_at_depth is not None
                    else 999
                )
                same_scene_topic = (
                    turn_age <= 5
                    and existing.significance == item.significance
                    and sim >= 0.25
                )
                if (sim >= 0.40 or same_scene_topic) and sim > best_ephemeral_sim:
                    best_ephemeral_sim = sim
                    best_ephemeral_match_idx = idx

        if is_redundant_with_permanent:
            continue

        if superseded_idx is None and best_ephemeral_match_idx is not None:
            superseded_idx = best_ephemeral_match_idx
            prev_depth = char_shards[superseded_idx].created_at_depth
            if prev_depth is not None:
                inherited_depth = prev_depth

        if superseded_idx is not None:
            char_shards[superseded_idx] = char_shards[superseded_idx].model_copy(
                update={"superseded_at_turn_id": completed_turn.id}
            )

        new_shard = MemoryShard(
            id=f"mem_{target_char.id}_{completed_turn.id}_{uuid.uuid4().hex[:6]}",
            title=clean_title,
            content=clean_content,
            keywords=list(dict.fromkeys(k.strip() for k in item.keywords if k.strip()))[:6],
            emotional_weight=max(0.0, min(1.0, item.emotional_weight)),
            origin="clerk_ephemeral",
            significance=item.significance,
            anchor_turn_id=completed_turn.id,
            created_at_depth=inherited_depth,
            superseded_at_turn_id=None,
        )
        char_shards.append(new_shard)
        raw_shards_by_char[target_char.id] = char_shards
        modified_char_ids.add(target_char.id)

    return modified_char_ids


class CompactedMemorySpec(BaseModel):
    """Structured output produced when compacting aged ephemeral character memories."""

    title: str = Field(description="3-6 word title for the consolidated permanent memory.")
    content: str = Field(
        description="Strictly 2-3 synthesized sentences preserving key emotional truths, vows, traumas, or revelations."
    )
    keywords: list[str] = Field(default_factory=list)
    emotional_weight: float = Field(default=0.85, ge=0.0, le=1.0)


async def compact_character_memories(
    aged_shards: list[MemoryShard],
    character: CharacterRecord,
    profile: ModelProfile | None = None,
) -> CompactedMemorySpec:
    """Consolidate aged unpromoted ephemeral memories into a single permanent memory shard."""
    merged_keywords = list(
        dict.fromkeys(kw for s in aged_shards for kw in s.keywords if kw.strip())
    )[:6]
    max_weight = max((s.emotional_weight for s in aged_shards), default=0.8)

    if len(aged_shards) == 1:
        single = aged_shards[0]
        return CompactedMemorySpec(
            title=single.title,
            content=_synthesize_concise_sentences(single.content, max_sentences=2),
            keywords=merged_keywords or [character.name],
            emotional_weight=max_weight,
        )

    clerk_prof = profile or settings.clerk_profile
    system_prompt = render_template(
        DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM,
        character_name=character.name,
    )
    shards_input = "\n".join(
        f"- [{s.significance or 'memory'}] {s.title}: {s.content} (keywords: {', '.join(s.keywords)})"
        for s in aged_shards
    )
    try:
        spec = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": shards_input},
            ],
            CompactedMemorySpec,
            profile=clerk_prof,
        )
        spec.content = _synthesize_concise_sentences(spec.content, max_sentences=3)
        if not spec.keywords:
            spec.keywords = merged_keywords
        return spec
    except Exception:
        if not settings.allow_offline_fallback:
            raise

    # Deterministic fallback consolidation
    titles = ", ".join(s.title for s in aged_shards[:3])
    combined_sentences = " ".join(
        _synthesize_concise_sentences(s.content, max_sentences=1) for s in aged_shards[:3]
    )
    return CompactedMemorySpec(
        title=f"Consolidated Memories: {titles[:48]}",
        content=_synthesize_concise_sentences(combined_sentences, max_sentences=3),
        keywords=merged_keywords or [character.name],
        emotional_weight=max_weight,
    )
