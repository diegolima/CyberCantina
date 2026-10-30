"""Phase 4: Async Post-Turn Clerk (World Clock, Spatial Graph Mutation, and Episodic Summarizer)."""

from __future__ import annotations

import asyncio
import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.prompts import (
    DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM,
    get_default_prompt,
    render_template,
)
from app.engine.world_clock import (
    advance_world_timestamp,  # noqa: F401  (re-exported for backwards compatibility)
    describe_world_timestamp,
    extract_time_hint_minutes,
    parse_world_timestamp,
    resolve_turn_timestamp,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    MemoryShard,
)
from app.schemas.turn import (
    EpisodicChunkRecord,
    ExtractedCharacterMemory,
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, NeighborLocationView, normalize_compass_direction


def merge_scene_flags(
    existing_flags: list[str],
    updated_flags: list[str],
    removed_flags: list[str] | None = None,
    max_flags: int = 10,
) -> list[str]:
    """Merge new scene/inventory/world flags into existing_flags without overwriting prior flags,
    applying removals and maintaining a sliding FIFO window of at most max_flags."""
    remove_set = {f.strip().lower() for f in (removed_flags or []) if f.strip()}
    additions: list[str] = []
    for raw in updated_flags:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            remove_set.add(cleaned[1:].strip().lower())
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    merged: list[str] = []
    seen_lower: set[str] = set()
    for flag in existing_flags:
        f_clean = flag.strip()
        f_low = f_clean.lower()
        if f_clean and f_low not in remove_set and f_low not in seen_lower:
            merged.append(f_clean)
            seen_lower.add(f_low)

    for flag in additions:
        f_low = flag.lower()
        if f_low not in remove_set and f_low not in seen_lower:
            merged.append(flag)
            seen_lower.add(f_low)

    if max_flags > 0 and len(merged) > max_flags:
        merged = merged[-max_flags:]

    return merged


def _normalize_inventory_item(raw: str) -> str:
    """Normalize an inventory item label by stripping state tags like '[Worn]' or '(worn)'."""
    s = raw.strip().lower()
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


def _matches_inventory_removal(existing_item: str, removal_queries: set[str]) -> bool:
    """Return True if existing_item matches any removal query exactly, by normalized name, or by 4+ char substring."""
    if not removal_queries:
        return False
    ex_low = existing_item.strip().lower()
    ex_norm = _normalize_inventory_item(existing_item)
    if ex_low in removal_queries or ex_norm in removal_queries:
        return True
    for rem in removal_queries:
        if len(rem) >= 4 and (rem in ex_norm or (len(ex_norm) >= 4 and ex_norm in rem)):
            return True
    return False


def merge_inventory(
    existing_inventory: list[str],
    added_items: list[str],
    removed_items: list[str] | None = None,
) -> list[str]:
    """Merge added and removed clothing/objects into existing_inventory with prefix/substring tolerance."""
    remove_queries: set[str] = set()
    for raw_rem in removed_items or []:
        cleaned = raw_rem.strip()
        if cleaned:
            remove_queries.add(cleaned.lower())
            norm = _normalize_inventory_item(cleaned)
            if norm:
                remove_queries.add(norm)

    additions: list[str] = []
    for raw in added_items:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            rem_val = cleaned[1:].strip()
            remove_queries.add(rem_val.lower())
            norm = _normalize_inventory_item(rem_val)
            if norm:
                remove_queries.add(norm)
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    addition_overrides: dict[str, str] = {}
    for item in additions:
        norm = _normalize_inventory_item(item)
        if norm:
            addition_overrides[norm] = item

    merged: list[str] = []
    seen_norm: set[str] = set()
    for existing in existing_inventory:
        ex_clean = existing.strip()
        if not ex_clean:
            continue
        if _matches_inventory_removal(ex_clean, remove_queries):
            continue
        ex_norm = _normalize_inventory_item(ex_clean)
        if not ex_norm or ex_norm in seen_norm:
            continue
        if ex_norm in addition_overrides:
            merged.append(addition_overrides[ex_norm])
        else:
            merged.append(ex_clean)
        seen_norm.add(ex_norm)

    for item in additions:
        item_norm = _normalize_inventory_item(item)
        if not item_norm or item_norm in seen_norm:
            continue
        if _matches_inventory_removal(item, remove_queries):
            continue
        merged.append(item)
        seen_norm.add(item_norm)

    return merged


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


def _extract_heuristic_inventory_delta(
    user_message: str,
    raw_prose: str,
    current_inventory: list[str] | None = None,
) -> tuple[list[str], list[str]]:
    """Extract deterministic inventory additions and removals when running without a live Clerk LLM."""
    combined = f"{user_message}\n{raw_prose}"
    combined_lower = combined.lower()
    inv_added: list[str] = []
    inv_removed: list[str] = []

    remove_cue = bool(
        re.search(
            r"\b(take off|takes off|took off|remove|removes|removed|shed|sheds|unfasten|unfastens|"
            r"strip off|strips off|drop|drops|dropped|hand over|hands over|give|gives|gave|toss|tosses|discard|discards)\b",
            combined_lower,
        )
    )
    if remove_cue and current_inventory:
        for item in current_inventory:
            norm = _normalize_inventory_item(item)
            if not norm:
                continue
            if norm in combined_lower:
                inv_removed.append(item)
                continue
            tokens = [
                w
                for w in re.findall(r"[a-z0-9]{4,}", norm)
                if w not in _GENERIC_ITEM_ADJECTIVES
            ]
            if any(re.search(rf"\b{re.escape(tok)}\b", combined_lower) for tok in tokens):
                inv_removed.append(item)

    wear_matches = re.finditer(
        r"\b(?:put on|puts on|pull on|pulls on|slip into|slips into|wear|wears|don|dons)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|over|under|as|from|in)\b)",
        combined,
        re.I,
    )
    for m in wear_matches:
        garment = m.group(1).strip()
        if len(garment) >= 3:
            inv_added.append(f"[Worn] {garment[0].upper() + garment[1:]}")

    acquire_matches = re.finditer(
        r"\b(?:pick up|picks up|pocket|pockets|grab|grabs|hand you|hands you|give you|gives you|"
        r"hand her|hands her|hand him|hands him|give her|gives her|give him|gives him)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|off|on|in|into|across)\b)",
        combined,
        re.I,
    )
    for m in acquire_matches:
        obj = m.group(1).strip()
        if len(obj) >= 3 and obj.lower() not in {"it", "them", "this", "that", "him", "her", "me", "you"}:
            inv_added.append(obj[0].upper() + obj[1:])

    return inv_added, inv_removed


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
    u_clean = _synthesize_concise_sentences(user_message, max_sentences=1)
    p_clean = _synthesize_concise_sentences(raw_prose, max_sentences=1)
    kws = list(
        dict.fromkeys(
            [e for e in (mentioned_entities or []) if len(e.strip()) >= 3]
            + list(_tokenize_meaningful(user_message))[:3]
        )
    )[:5]

    results: list[ExtractedCharacterMemory] = []
    for ch in target_chars:
        synth = _synthesize_concise_sentences(
            f"{ch.name} experienced a {matched_sig} moment: {u_clean} {p_clean}",
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


def heuristic_post_turn_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
    current_timestamp: str | None = None,
    present_characters: list[CharacterRecord] | None = None,
    active_character: CharacterRecord | None = None,
) -> PostTurnStateDelta:
    """Deterministic fallback state extractor when the Auxiliary Clerk endpoint is offline."""
    delta = _heuristic_spatial_and_inventory_delta(
        user_message=user_message,
        raw_prose=raw_prose,
        pre_turn=pre_turn,
        active_location=active_location,
        neighbors=neighbors,
        current_inventory=current_inventory,
    )
    # Honor explicit time cues in the user's message (e.g. "it's 5am", "slept until morning").
    if current_timestamp is not None:
        hint_minutes = extract_time_hint_minutes(user_message, current_timestamp)
        if hint_minutes is not None and hint_minutes > 0:
            if parse_world_timestamp(current_timestamp) is not None:
                delta.new_world_timestamp = advance_world_timestamp(current_timestamp, hint_minutes)
            delta.elapsed_minutes = min(hint_minutes, 1440)

    if present_characters:
        delta.character_memories = _extract_heuristic_character_memories(
            user_message=user_message,
            raw_prose=raw_prose,
            present_characters=present_characters,
            active_character=active_character,
            mentioned_entities=pre_turn.mentioned_entities,
        )
    return delta


def _heuristic_spatial_and_inventory_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
) -> PostTurnStateDelta:
    """Deterministic spatial transition + inventory extraction (clock defaults only)."""
    combined = f"{user_message} {raw_prose}".lower()
    inv_added, inv_removed = _extract_heuristic_inventory_delta(
        user_message, raw_prose, current_inventory
    )

    # Check if movement to a known neighbor occurred
    if pre_turn.spatial_intent == "move_known":
        for nb in neighbors:
            if (
                pre_turn.target_location_hint
                and pre_turn.target_location_hint.lower() in nb.destination.name.lower()
            ):
                return PostTurnStateDelta(
                    elapsed_minutes=max(2, nb.travel_minutes + 1),
                    transition_type="move_existing",
                    target_location_id=nb.destination.id,
                    notable_event_summary=(
                        f"Moved from {active_location.name} to {nb.destination.name}."
                    ),
                    scene_flags_updated=[f"At {nb.destination.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )
        # Fallback to matching neighbor words in combined text
        for nb in neighbors:
            dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
            if any(w in combined for w in dest_words):
                return PostTurnStateDelta(
                    elapsed_minutes=max(2, nb.travel_minutes + 1),
                    transition_type="move_existing",
                    target_location_id=nb.destination.id,
                    notable_event_summary=(
                        f"Transitioned from {active_location.name} to {nb.destination.name}."
                    ),
                    scene_flags_updated=[f"At {nb.destination.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )

    # Check if an unmapped room was explored/improvised
    if pre_turn.spatial_intent == "explore_new":
        room_match = re.search(
            r"(?:into the|open the|enter the|inside the)\s+([a-z0-9\s\-]{3,28})",
            user_message,
            re.I,
        )
        raw_room = room_match.group(1).strip().title() if room_match else "Uncharted Annex"
        room_name = raw_room if len(raw_room) >= 4 else "Uncharted Annex"
        inferred_dir = normalize_compass_direction(None, f"{user_message} {raw_prose}")
        return PostTurnStateDelta(
            elapsed_minutes=4,
            transition_type="improvise_new",
            improvised_location=ImprovisedLocationSpec(
                name=room_name,
                summary=f"Newly accessed area adjoining {active_location.name}.",
                description=(
                    f"A dimly lit space beyond {active_location.name}, thick with dust and "
                    "the hum of concealed infrastructure."
                ),
                environmental_tags=["dim lighting", "uncharted threshold", "echoing acoustics"],
                entry_direction_label=f"Passage to {room_name}",
                return_direction_label=f"Doorway back to {active_location.name}",
                compass_direction=inferred_dir,
                travel_minutes=2,
            ),
            notable_event_summary=f"Discovered and entered {room_name} from {active_location.name}.",
            scene_flags_updated=[f"Discovered {room_name}"],
            inventory_added=inv_added,
            inventory_removed=inv_removed,
        )

    elapsed = 3 if len(raw_prose) > 350 else 2
    notable = None
    flags_added: list[str] = []
    if pre_turn.resolved_roll is not None:
        r = pre_turn.resolved_roll
        notable = (
            f"Attempted '{r.action_description}' ({r.skill_or_approach}) at {active_location.name}: "
            f"{r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})."
        )
        flags_added.append(f"{r.skill_or_approach}: {r.outcome_tier}")

    return PostTurnStateDelta(
        elapsed_minutes=elapsed,
        transition_type="stay",
        notable_event_summary=notable,
        scene_flags_updated=flags_added,
        inventory_added=inv_added,
        inventory_removed=inv_removed,
    )


async def summarize_turn_chunk(
    turns: list[TurnNodeRecord],
    character: CharacterRecord,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    character_name_map: dict[str, str] | None = None,
) -> str:
    """Summarize a slice of working memory turns into an objective storyline episodic paragraph."""
    name_lookup = character_name_map or {character.id: character.name}
    transcript_lines: list[str] = []
    for t in turns:
        speaker_label = (
            "Narrator"
            if t.actor_id == "__narrator__"
            else name_lookup.get(t.actor_id, character.name)
        )
        flags_str = (
            f" [Flags: {', '.join(t.world_snapshot.scene_flags[-3:])}]"
            if t.world_snapshot.scene_flags
            else ""
        )
        transcript_lines.append(
            f"Turn {t.depth_index}{flags_str} | User: {t.user_message}\n{speaker_label}: {t.raw_prose}"
        )
    transcript = "\n".join(transcript_lines)
    system_prompt = render_template(
        prompt_template or get_default_prompt("clerk_episodic_summary_system")
    )
    clerk_prof = profile or settings.clerk_profile
    try:
        summary = await llm_client.complete_text(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            profile=clerk_prof,
            temperature=0.2,
            max_tokens=256,
        )
        if summary.strip():
            return summary.strip()
    except Exception:
        if not settings.allow_offline_fallback:
            raise

    # Deterministic fallback episodic compression focused on objective actions & state
    start_d = turns[0].depth_index
    end_d = turns[-1].depth_index
    snippets: list[str] = []
    for t in turns:
        u_short = t.user_message.strip().replace("\n", " ")[:70]
        if t.post_turn and t.post_turn.notable_event_summary:
            outcome_short = t.post_turn.notable_event_summary.strip()[:80]
            snippets.append(f"[T{t.depth_index}] {outcome_short}")
        else:
            c_short = t.cognition.plan.strip()[:70] or t.cognition.want.strip()[:70]
            snippets.append(f"[T{t.depth_index}] Action: '{u_short}' -> {c_short}")
    return f"Turns {start_d}–{end_d} summary: " + " | ".join(snippets[:4])


async def run_phase4_post_turn_clerk(
    *,
    repo: CantinaRepository,
    campaign_id: str,
    world_id: str,
    character: CharacterRecord,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord] | None = None,
    profile: ModelProfile | None = None,
    working_memory_turns: int | None = None,
    ephemeral_lifespan_turns: int | None = None,
    max_scene_flags: int | None = None,
    post_turn_prompt_template: str | None = None,
    summary_prompt_template: str | None = None,
) -> tuple[TurnNodeRecord, list[EpisodicChunkRecord]]:
    """Run Phase 4 Clerk to advance the clock, mutate the Spatial Graph, extract per-character memories, and compress Episodic Memory."""
    clerk_prof = profile or settings.clerk_profile
    scene_characters = (
        [c for c in present_characters if c.id != "__narrator__"]
        if present_characters is not None
        else ([character] if character.id != "__narrator__" else [])
    )

    branch_turns = repo.get_branch_turn_chain(completed_turn.id)
    valid_turn_ids = {t.id for t in branch_turns}

    raw_shards_by_char: dict[str, list[MemoryShard]] = {}
    present_chars_lines: list[str] = []
    existing_memories_lines: list[str] = []
    for ch in scene_characters:
        raw_shards = repo.get_raw_campaign_character_memories(campaign_id, ch.id)
        raw_shards_by_char[ch.id] = raw_shards
        present_chars_lines.append(f"- id='{ch.id}': {ch.name} ({ch.tagline})")
        active_shards = [
            s for s in raw_shards if repo._is_shard_active_on_branch(s, valid_turn_ids)
        ]
        if active_shards:
            for s in active_shards[-6:]:
                existing_memories_lines.append(
                    f"- [{ch.name} | id='{s.id}' | {s.origin}{f'/{s.significance}' if s.significance else ''}] "
                    f"{s.title}: {s.content}"
                )
        else:
            existing_memories_lines.append(f"- [{ch.name}]: None")

    present_chars_str = "\n".join(present_chars_lines) or "None"
    existing_memories_str = "\n".join(existing_memories_lines) or "None"

    neighbor_options = "\n".join(
        f"- [{n.compass_direction or 'N'}] id='{n.destination.id}': {n.destination.name} (via {n.direction_label}, {n.travel_minutes}m)"
        for n in neighbors
    ) or "None"
    existing_flags_str = (
        ", ".join(completed_turn.world_snapshot.scene_flags)
        if completed_turn.world_snapshot.scene_flags
        else "None"
    )
    equipped_str = (
        ", ".join(completed_turn.character_state.equipped)
        if completed_turn.character_state.equipped
        else "None"
    )
    existing_inventory_str = (
        ", ".join(completed_turn.character_state.inventory)
        if completed_turn.character_state.inventory
        else "None"
    )

    current_timestamp = completed_turn.world_snapshot.world_timestamp
    current_time_str = describe_world_timestamp(current_timestamp)

    system_prompt = render_template(
        post_turn_prompt_template or get_default_prompt("clerk_post_turn_system"),
        character_name=character.name,
    )
    user_prompt = (
        f"Current In-Game Time (start of this turn): {current_time_str}\n"
        f"Current Location: {active_location.name} (id='{active_location.id}')\n"
        f"Current Scene Flags: {existing_flags_str}\n"
        f"Characters Present in Scene:\n{present_chars_str}\n"
        f"Existing Character Memories (do NOT duplicate these):\n{existing_memories_str}\n"
        f"{character.name} Equipped / Worn: {equipped_str}\n"
        f"{character.name} Carried Inventory: {existing_inventory_str}\n"
        f"Known Exits:\n{neighbor_options}\n\n"
        f"User Message: {completed_turn.user_message}\n"
        f"{character.name} Cognition Plan: {completed_turn.cognition.plan}\n"
        f"{character.name} Response:\n{completed_turn.raw_prose}"
    )

    async def _compute_delta() -> PostTurnStateDelta:
        try:
            return await llm_client.complete_structured(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                PostTurnStateDelta,
                profile=clerk_prof,
            )
        except Exception:
            if not settings.allow_offline_fallback:
                raise
            return heuristic_post_turn_delta(
                user_message=completed_turn.user_message,
                raw_prose=completed_turn.raw_prose,
                pre_turn=completed_turn.pre_turn,
                active_location=active_location,
                neighbors=neighbors,
                current_inventory=[
                    *(completed_turn.character_state.equipped or []),
                    *(completed_turn.character_state.inventory or []),
                ],
                current_timestamp=current_timestamp,
                present_characters=scene_characters,
                active_character=character,
            )

    # Check Rolling Episodic Compression threshold upfront so delta extraction and chunk summarization run concurrently
    existing_chunks = repo.get_branch_episodic_chunks(campaign_id, valid_turn_ids)
    max_summarized_depth = max((c.end_turn_depth for c in existing_chunks), default=0)

    unsummarized = [t for t in branch_turns if t.depth_index > max_summarized_depth]
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    needs_chunk_summary = len(unsummarized) > wm_limit
    chunk_slice = (
        unsummarized[: settings.memory_config.episodic_chunk_size]
        if needs_chunk_summary
        else []
    )
    char_name_map = {c.id: c.name for c in scene_characters}
    char_name_map[character.id] = character.name

    if needs_chunk_summary:
        summarize_coro = summarize_turn_chunk(
            chunk_slice,
            character,
            profile=clerk_prof,
            prompt_template=summary_prompt_template,
            character_name_map=char_name_map,
        )
        delta, summary_text = await asyncio.gather(
            _compute_delta(),
            summarize_coro,
        )
    else:
        delta = await _compute_delta()
        summary_text = None

    # 1. Resolve new active location (stay, move_existing, or improvise_new)
    new_location_id = active_location.id
    valid_neighbor_ids = {n.destination.id for n in neighbors}
    if delta.transition_type == "move_existing" and delta.target_location_id in valid_neighbor_ids:
        new_location_id = delta.target_location_id  # type: ignore[assignment]
    elif delta.transition_type == "improvise_new" and delta.improvised_location is not None:
        created_loc = repo.add_improvised_location(
            world_id=world_id,
            from_location_id=active_location.id,
            created_at_turn_id=completed_turn.id,
            spec=delta.improvised_location,
            valid_turn_ids=valid_turn_ids,
        )
        new_location_id = created_loc.id
        delta.target_location_id = created_loc.id

    # 2. Advance World Clock & Merge Scene Flags (maintain only new location marker on transition; sliding FIFO otherwise)
    new_timestamp = resolve_turn_timestamp(
        current_timestamp,
        delta.elapsed_minutes,
        delta.new_world_timestamp,
    )
    location_changed = new_location_id != active_location.id
    if location_changed:
        try:
            new_loc_name = repo.get_location(new_location_id).name
        except Exception:
            new_loc_name = ""
        merged_flags = [f"At {new_loc_name}"] if new_loc_name else []
    else:
        eff_max_flags = (
            max_scene_flags
            if max_scene_flags is not None
            else getattr(settings.memory_config, "max_scene_flags", 10)
        )
        merged_flags = merge_scene_flags(
            completed_turn.world_snapshot.scene_flags,
            delta.scene_flags_updated,
            delta.scene_flags_removed,
            max_flags=eff_max_flags,
        )
    updated_world_snapshot = WorldStateSnapshot(
        turn_id=completed_turn.id,
        world_timestamp=new_timestamp,
        active_location_id=new_location_id,
        scene_flags=merged_flags,
    )

    # 3. Update Character State Snapshot from Phase 3 Cognition + Phase 4 Delta
    rel_notes = dict(completed_turn.character_state.relationship_notes)
    if delta.relationship_shift_note:
        rel_notes["user"] = delta.relationship_shift_note

    # Determine whether the active speaker moved with the user or stayed behind (if user moved alone)
    msg_lower = completed_turn.user_message.lower()
    user_moved_alone = bool(
        new_location_id != active_location.id
        and re.search(r"\b(alone|by myself|without you|slip out alone|leave .+ behind)\b", msg_lower)
    )
    actor_new_location_id = active_location.id if user_moved_alone else new_location_id

    rem_queries: set[str] = set()
    for raw_rem in delta.inventory_removed or []:
        cleaned = raw_rem.strip()
        if cleaned:
            rem_queries.add(cleaned.lower())
            norm = _normalize_inventory_item(cleaned)
            if norm:
                rem_queries.add(norm)

    updated_equipped = [
        item for item in (completed_turn.character_state.equipped or [])
        if not _matches_inventory_removal(item, rem_queries)
    ]

    merged_inventory = merge_inventory(
        completed_turn.character_state.inventory,
        delta.inventory_added,
        delta.inventory_removed,
    )

    updated_char_state = CharacterStateSnapshot(
        turn_id=completed_turn.id,
        character_id=character.id,
        current_location_id=actor_new_location_id,
        mood_label=completed_turn.cognition.feeling[:80] or completed_turn.character_state.mood_label,
        valence=completed_turn.cognition.valence,
        arousal=completed_turn.cognition.arousal,
        active_want=completed_turn.cognition.want or completed_turn.character_state.active_want,
        active_plan=completed_turn.cognition.plan or completed_turn.character_state.active_plan,
        relationship_notes=rel_notes,
        equipped=updated_equipped,
        inventory=merged_inventory,
    )

    # 4. Process per-character personal memories (ephemeral extraction + deduplication + 40-turn compaction)
    modified_char_ids = apply_extracted_character_memories(
        extracted_memories=delta.character_memories,
        present_characters=scene_characters,
        default_character=character,
        raw_shards_by_char=raw_shards_by_char,
        valid_turn_ids=valid_turn_ids,
        completed_turn=completed_turn,
    )

    lifespan_limit = (
        ephemeral_lifespan_turns
        if ephemeral_lifespan_turns is not None
        else settings.memory_config.ephemeral_memory_lifespan_turns
    )
    for ch in scene_characters:
        char_shards = raw_shards_by_char.get(ch.id, [])
        aged_indices: list[int] = []
        aged_shards: list[MemoryShard] = []
        for idx, s in enumerate(char_shards):
            if (
                s.origin == "clerk_ephemeral"
                and repo._is_shard_active_on_branch(s, valid_turn_ids)
                and s.created_at_depth is not None
                and (completed_turn.depth_index - s.created_at_depth) >= lifespan_limit
            ):
                aged_indices.append(idx)
                aged_shards.append(s)

        if aged_shards:
            compacted_spec = await compact_character_memories(
                aged_shards, ch, profile=clerk_prof
            )
            for idx in aged_indices:
                char_shards[idx] = char_shards[idx].model_copy(
                    update={"superseded_at_turn_id": completed_turn.id}
                )
            consolidated_shard = MemoryShard(
                id=f"mem_comp_{ch.id}_{completed_turn.id}_{uuid.uuid4().hex[:6]}",
                title=compacted_spec.title.strip()[:80],
                content=compacted_spec.content.strip(),
                keywords=list(
                    dict.fromkeys(k.strip() for k in compacted_spec.keywords if k.strip())
                )[:6],
                emotional_weight=max(0.0, min(1.0, compacted_spec.emotional_weight)),
                origin="compacted",
                significance="consolidated",
                anchor_turn_id=completed_turn.id,
                created_at_depth=completed_turn.depth_index,
                superseded_at_turn_id=None,
            )
            char_shards.append(consolidated_shard)
            raw_shards_by_char[ch.id] = char_shards
            modified_char_ids.add(ch.id)

    updated_turn = repo.update_turn_post_clerk(
        turn_id=completed_turn.id,
        post_turn=delta,
        updated_world_snapshot=updated_world_snapshot,
        updated_character_state=updated_char_state,
    )

    # 5. Asynchronously embed and index notable atomic event, episodic chunk, and updated character memories
    async_tasks = []
    if delta.notable_event_summary:
        async_tasks.append(
            repo.vector_store.aupsert_entry(
                entry_id=f"event_{completed_turn.id}",
                source_type="episodic_chunk",
                world_id=world_id,
                character_id=character.id,
                campaign_id=campaign_id,
                anchor_turn_id=completed_turn.id,
                title=f"Turn {completed_turn.depth_index} Event ({new_timestamp})",
                content=delta.notable_event_summary,
                keywords=completed_turn.pre_turn.mentioned_entities,
            )
        )

    if needs_chunk_summary and summary_text is not None:
        async_tasks.append(
            repo.asave_episodic_chunk(
                campaign_id=campaign_id,
                world_id=world_id,
                character_id=character.id,
                start_turn_depth=chunk_slice[0].depth_index,
                end_turn_depth=chunk_slice[-1].depth_index,
                leaf_turn_id=completed_turn.id,
                summary_text=summary_text,
            )
        )

    for cid in modified_char_ids:
        async_tasks.append(
            repo.aupdate_campaign_character_memories(
                campaign_id=campaign_id,
                character_id=cid,
                memory_shards=raw_shards_by_char[cid],
                preserve_other_branches=False,
            )
        )

    if async_tasks:
        results = await asyncio.gather(*async_tasks)
        for res in results:
            if isinstance(res, EpisodicChunkRecord):
                existing_chunks.append(res)

    return updated_turn, existing_chunks
