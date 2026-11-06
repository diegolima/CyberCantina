"""Phase 2: 4-Zone KV-Cache-Preserving Prompt & Context Assembler."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any
from app.config import settings
from app.engine.mentions import (
    DecomposedUserMessage,
    decompose_user_message,
    filter_user_message_for_character,
)
from app.engine.world_clock import describe_world_timestamp
from app.prompts import get_default_prompt, render_template
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    ItemInstance,
    coerce_item_list,
    format_item_names,
    normalize_item_key,
)
from app.schemas.persona import (
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.turn import (
    EpisodicChunkRecord,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, LoreNode, NeighborLocationView, WorldRecord

_WORD_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_DISCOVERY_CHECK_STEMS = (
    "search",
    "investigat",
    "inspect",
    "examin",
    "perceiv",
    "percept",
    "spot",
    "notice",
    "scan",
    "hack",
    "intrusion",
    "decrypt",
    "lockpick",
    "pick",
    "pry",
    "sweep",
    "snoop",
    "uncover",
    "find",
    "look",
    "listen",
    "eavesdrop",
    "sense",
    "probe",
    "check",
)


def _tag_matches_text(tag: str, text_lower: str) -> bool:
    cleaned = tag.strip().lower()
    if len(cleaned) < 2 or not text_lower:
        return False
    pattern = r"(?<![a-z0-9])" + re.escape(cleaned) + r"(?![a-z0-9])"
    return bool(re.search(pattern, text_lower))


_LORE_OVERLAP_STOPWORDS = {
    "the",
    "and",
    "for",
    "from",
    "with",
    "into",
    "over",
    "under",
    "this",
    "that",
    "these",
    "those",
    "about",
    "after",
    "before",
    "during",
    "between",
    "through",
    "around",
    "was",
    "were",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "their",
    "there",
    "they",
    "them",
    "her",
    "his",
    "its",
    "she",
    "him",
    "you",
    "your",
    "who",
    "whom",
    "which",
    "what",
    "when",
    "where",
    "while",
    "only",
    "very",
    "just",
    "still",
    "some",
    "more",
    "most",
    "such",
    "than",
    "then",
    "also",
    "item",
    "items",
    "worn",
    "carried",
    "equipped",
}

_ITEM_SIGNAL_ADJECTIVES = {
    "old",
    "new",
    "worn",
    "dark",
    "light",
    "heavy",
    "small",
    "large",
    "tiny",
    "black",
    "white",
    "red",
    "blue",
    "green",
    "silver",
    "gold",
    "golden",
    "brass",
    "iron",
    "steel",
    "copper",
    "wooden",
    "leather",
    "cloth",
    "tarnished",
    "rusted",
    "rusty",
    "broken",
    "cracked",
    "damaged",
    "polished",
    "ornate",
    "ancient",
    "weathered",
    "faded",
    "stained",
    "concealed",
    "hidden",
    "spare",
    "standard",
    "custom",
    "modified",
    "battered",
    "scratched",
}


def get_character_working_window(
    branch_turns: list[TurnNodeRecord],
    episodic_chunks: list[EpisodicChunkRecord],
    *,
    character_id: str | None = None,
    is_narrator: bool = False,
    working_memory_turns: int | None = None,
) -> list[TurnNodeRecord]:
    """Return the exact slice of unsummarized turns present in Zone 3 Working Memory."""
    max_summarized_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    unsummarized_turns = [
        t
        for t in branch_turns
        if t.depth_index > max_summarized_depth
        and (
            is_narrator
            or not character_id
            or was_character_present_on_turn(t, character_id)
        )
    ]
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    return unsummarized_turns[-wm_limit:]


def is_lore_substantively_in_working_window(
    lore_text: str,
    working_window: list[TurnNodeRecord],
    *,
    overlap_threshold: float = 0.60,
) -> bool:
    """Return True if the substantive content of lore_text is already present in Zone 3."""
    clean_lore = re.sub(r"\s+", " ", (lore_text or "").strip().lower())
    if not clean_lore or not working_window:
        return False

    window_corpus = "\n".join(
        f"{t.user_message}\n{t.raw_prose}" for t in working_window
    ).lower()
    if not window_corpus.strip():
        return False

    if len(clean_lore) >= 12 and clean_lore in window_corpus:
        return True

    lore_tokens = {
        tok
        for tok in _WORD_TOKEN_RE.findall(clean_lore)
        if tok not in _LORE_OVERLAP_STOPWORDS
    }
    if not lore_tokens:
        return False

    window_tokens = set(_WORD_TOKEN_RE.findall(window_corpus))
    matched_count = len(lore_tokens & window_tokens)
    return (matched_count / len(lore_tokens)) >= overlap_threshold


def _item_matches_turn_signal(
    item: ItemInstance,
    signal_lower: str,
    artifact_lore: LoreNode | None = None,
) -> bool:
    """Return True only when item name (or linked artifact title/tags) is explicitly referenced in turn signal."""
    if not signal_lower:
        return False

    clean_key = normalize_item_key(item.name)
    if clean_key and _tag_matches_text(clean_key, signal_lower):
        return True

    raw_tokens = re.findall(r"[a-z0-9]+", clean_key)
    distinctive_tokens = [
        tok
        for tok in raw_tokens
        if len(tok) >= 4
        and tok not in _ITEM_SIGNAL_ADJECTIVES
        and tok not in _LORE_OVERLAP_STOPWORDS
    ]
    if any(_tag_matches_text(tok, signal_lower) for tok in distinctive_tokens):
        return True

    if raw_tokens:
        head_noun = raw_tokens[-1]
        if (
            len(head_noun) >= 3
            and head_noun not in _ITEM_SIGNAL_ADJECTIVES
            and head_noun not in _LORE_OVERLAP_STOPWORDS
            and _tag_matches_text(head_noun, signal_lower)
        ):
            return True

    if artifact_lore is not None:
        if _tag_matches_text(artifact_lore.title, signal_lower):
            return True
        if any(_tag_matches_text(tag, signal_lower) for tag in artifact_lore.entity_tags):
            return True

    return False


def resolve_triggered_item_lore(
    *,
    world: WorldRecord,
    branch_turns: list[TurnNodeRecord],
    episodic_chunks: list[EpisodicChunkRecord],
    present_characters: list[CharacterRecord],
    all_character_states: dict[str, CharacterStateSnapshot],
    pre_turn: PreTurnAnalysis,
    user_message: str,
    narrator_directive: str | None,
    shared_scene_items: list[RecalledMemoryItem],
    per_character_recalled_items: dict[str, list[RecalledMemoryItem]],
    is_narrator: bool = False,
    working_memory_turns: int | None = None,
) -> tuple[list[RecalledMemoryItem], dict[str, list[RecalledMemoryItem]]]:
    """Conditionally inject relevant item notes and linked world artifact lore with Zone 3 hygiene & epistemic isolation."""
    signal_parts = [
        user_message or "",
        narrator_directive or "",
        *(pre_turn.mentioned_entities if pre_turn else []),
        *(pre_turn.memory_search_queries if pre_turn else []),
    ]
    signal_lower = " ".join(p for p in signal_parts if p).lower()

    updated_shared = list(shared_scene_items)
    updated_per_char: dict[str, list[RecalledMemoryItem]] = {
        cid: list(items) for cid, items in per_character_recalled_items.items()
    }
    for c in present_characters:
        updated_per_char.setdefault(c.id, [])

    if not signal_lower.strip():
        return updated_shared, updated_per_char

    world_artifacts_by_id: dict[str, LoreNode] = {
        ln.id: ln
        for ln in world.lore_nodes
        if ln.category == "artifact" and ln.location_id is None
    }

    primary_speaker_id = (
        None
        if is_narrator
        else (
            pre_turn.active_speaker_id
            if pre_turn.active_speaker_id in {c.id for c in present_characters}
            else (present_characters[0].id if present_characters else None)
        )
    )
    shared_window = get_character_working_window(
        branch_turns,
        episodic_chunks,
        character_id=primary_speaker_id,
        is_narrator=is_narrator,
        working_memory_turns=working_memory_turns,
    )

    # Also suppress any RAG-recalled world artifact lore already substantively present in Zone 3
    if world_artifacts_by_id and shared_window:
        updated_shared = [
            m
            for m in updated_shared
            if not (
                m.id in world_artifacts_by_id
                and is_lore_substantively_in_working_window(m.content, shared_window)
            )
        ]

    for c in present_characters:
        c_state = all_character_states.get(c.id)
        if c_state is None:
            continue
        c_window = get_character_working_window(
            branch_turns,
            episodic_chunks,
            character_id=c.id,
            is_narrator=False,
            working_memory_turns=working_memory_turns,
        )
        char_entries: list[tuple[str, ItemInstance]] = [
            *(("equipped", it) for it in coerce_item_list(list(c_state.equipped))),
            *(("inventory", it) for it in coerce_item_list(list(c_state.inventory))),
        ]
        for bucket_kind, item in char_entries:
            artifact_lore = (
                world_artifacts_by_id.get(item.lore_id) if item.lore_id else None
            )
            if not artifact_lore and not item.note.strip():
                continue
            if not _item_matches_turn_signal(item, signal_lower, artifact_lore):
                continue

            # 1. World Artifact Lore (shared scene lore, deduplicated against RAG vector_store)
            if artifact_lore is not None:
                if normalize_item_key(item.name) != artifact_lore.title.strip().lower():
                    prov_title = f"{artifact_lore.title} (held by {c.name} as '{item.name}')"
                else:
                    prov_title = f"{artifact_lore.title} (held by {c.name})"

                if is_lore_substantively_in_working_window(
                    artifact_lore.content, shared_window
                ):
                    updated_shared = [
                        m for m in updated_shared if m.id != artifact_lore.id
                    ]
                else:
                    existing_idx = next(
                        (
                            i
                            for i, m in enumerate(updated_shared)
                            if m.id == artifact_lore.id
                        ),
                        None,
                    )
                    if existing_idx is not None:
                        updated_shared[existing_idx] = updated_shared[
                            existing_idx
                        ].model_copy(update={"title": prov_title})
                    else:
                        updated_shared.append(
                            RecalledMemoryItem(
                                id=artifact_lore.id,
                                source_type="lore",
                                title=prov_title,
                                content=artifact_lore.content,
                                score=1.0,
                            )
                        )

            # 2. Personal Mini-Lore Note (strictly epistemically isolated to holder, or visible equipped on narrator)
            clean_note = item.note.strip()
            if clean_note:
                eff_window = shared_window if is_narrator else c_window
                if not is_lore_substantively_in_working_window(clean_note, eff_window):
                    note_mem_id = f"item_lore:{c.id}:{item.id}"
                    note_mem = RecalledMemoryItem(
                        id=note_mem_id,
                        source_type="item_lore",
                        title=f"{c.name}'s {item.name}",
                        content=clean_note,
                        score=1.0,
                    )
                    holder_list = updated_per_char.setdefault(c.id, [])
                    if not any(m.id == note_mem_id for m in holder_list):
                        holder_list.append(note_mem)
                    if (
                        is_narrator
                        and bucket_kind == "equipped"
                        and not any(m.id == note_mem_id for m in updated_shared)
                    ):
                        updated_shared.append(note_mem)

    return updated_shared, updated_per_char


def select_active_location_lore_for_turn(
    active_location: LocationNode,
    *,
    user_message: str = "",
    pre_turn: PreTurnAnalysis | None = None,
    narrator_directive: str | None = None,
    max_ambient_entries: int = 5,
) -> list[LoreNode]:
    """Select active-location lore for prompt injection with hard Python secret gating."""
    if not active_location.lore_nodes:
        return []

    ambient_entries = [n for n in active_location.lore_nodes if n.category != "secret"]
    secret_entries = [n for n in active_location.lore_nodes if n.category == "secret"]

    mentioned = list(pre_turn.mentioned_entities) if pre_turn else []
    queries = list(pre_turn.memory_search_queries) if pre_turn else []
    combined_signal = " ".join(
        part for part in [user_message, narrator_directive or "", *mentioned, *queries] if part
    ).lower()
    signal_tokens = set(_WORD_TOKEN_RE.findall(combined_signal))

    scored_ambient: list[tuple[int, int, LoreNode]] = []
    for idx, entry in enumerate(ambient_entries):
        score = 0
        for tag in entry.entity_tags:
            if _tag_matches_text(tag, combined_signal):
                score += 10
        entry_tokens = set(
            _WORD_TOKEN_RE.findall(
                f"{entry.title} {' '.join(entry.entity_tags)} {entry.content}".lower()
            )
        )
        score += len(signal_tokens & entry_tokens)
        scored_ambient.append((score, -idx, entry))

    scored_ambient.sort(key=lambda item: (item[0], item[1]), reverse=True)
    selected_ambient_set = {id(item[2]) for item in scored_ambient[: max(0, max_ambient_entries)]}
    selected: list[LoreNode] = [
        entry for entry in ambient_entries if id(entry) in selected_ambient_set
    ]

    if not secret_entries:
        return selected

    # Evaluate roll outcomes for hard secret gating
    all_rolls = []
    if pre_turn is not None:
        if pre_turn.character_rolls:
            all_rolls.extend(pre_turn.character_rolls.values())
        elif pre_turn.resolved_roll is not None:
            all_rolls.append(pre_turn.resolved_roll)

    succeeding_rolls = [
        r for r in all_rolls if r.outcome_tier in ("Clean Success", "Critical Success")
    ]
    has_only_failed_rolls = bool(all_rolls) and not succeeding_rolls

    has_discovery_roll_success = False
    roll_signal_lower = ""
    if succeeding_rolls:
        roll_signal_lower = " ".join(
            f"{r.action_description} {r.skill_or_approach}" for r in succeeding_rolls
        ).lower()
        combined_roll_context = f"{roll_signal_lower} {(user_message or '').lower()}"
        has_discovery_roll_success = any(
            stem in combined_roll_context for stem in _DISCOVERY_CHECK_STEMS
        )

    user_and_mentioned_lower = " ".join(
        part for part in [user_message, *mentioned] if part
    ).lower()
    directive_lower = (narrator_directive or "").lower()

    for secret in secret_entries:
        # Explicit narrator directive mentioning a secret tag always unlocks it for narrator scenes
        if directive_lower and any(
            _tag_matches_text(tag, directive_lower) for tag in secret.entity_tags
        ):
            selected.append(secret)
            continue

        # Never leak secrets on turns where a mechanical check occurred and failed
        if has_only_failed_rolls:
            continue

        # Unlock on Clean/Critical Success discovery roll or roll matching secret tags
        if succeeding_rolls:
            if has_discovery_roll_success or any(
                _tag_matches_text(tag, roll_signal_lower) for tag in secret.entity_tags
            ):
                selected.append(secret)
                continue

        # Unlock on direct uncontested keyword mention in player message / mentioned entities
        if user_and_mentioned_lower and any(
            _tag_matches_text(tag, user_and_mentioned_lower) for tag in secret.entity_tags
        ):
            selected.append(secret)

    return selected


@dataclass(frozen=True)
class DiscoveredPersonaView:
    """Subset of persona traits known to a specific character at turn execution time."""

    persona_id: str
    name: str
    physical_appearance: str
    revealed_age: str | None
    visible_equipped: list[PersonaItemInstance]
    known_inventory: list[PersonaItemInstance]
    known_lore: list[PersonaLoreEntry]


def resolve_character_known_persona(
    persona_snapshot: PersonaRecord | None,
    current_player_state: PersonaTurnStateSnapshot | None,
    unlocked_keys: list[str] | set[str] | None,
) -> DiscoveredPersonaView | None:
    """Resolve the epistemically filtered view of the player persona for an NPC."""
    if persona_snapshot is None:
        return None
    keys = set(unlocked_keys or [])

    revealed_age = None
    if persona_snapshot.age:
        if not persona_snapshot.age_is_secret or "age" in keys:
            revealed_age = str(persona_snapshot.age)

    equipped_pool = (
        current_player_state.equipped
        if current_player_state is not None
        else persona_snapshot.equipped
    )
    inventory_pool = (
        current_player_state.inventory
        if current_player_state is not None
        else persona_snapshot.inventory
    )

    visible_equipped = [
        it for it in equipped_pool if not it.is_secret or it.id in keys
    ]
    known_inventory = [
        it for it in inventory_pool if not it.is_secret or it.id in keys
    ]
    known_lore = [
        l for l in persona_snapshot.lore_entries if not l.is_secret or l.id in keys
    ]

    return DiscoveredPersonaView(
        persona_id=persona_snapshot.id,
        name=persona_snapshot.name,
        physical_appearance=persona_snapshot.physical_appearance,
        revealed_age=revealed_age,
        visible_equipped=visible_equipped,
        known_inventory=known_inventory,
        known_lore=known_lore,
    )


def build_all_character_known_personas(
    persona_snapshot: PersonaRecord | None,
    current_player_state: PersonaTurnStateSnapshot | None,
    all_character_states: dict[str, CharacterStateSnapshot],
) -> dict[str, DiscoveredPersonaView]:
    """Precompute known persona views for every character in the turn context."""
    if persona_snapshot is None:
        return {}
    res: dict[str, DiscoveredPersonaView] = {}
    for cid, cstate in all_character_states.items():
        view = resolve_character_known_persona(
            persona_snapshot,
            current_player_state,
            cstate.unlocked_persona_keys,
        )
        if view is not None:
            res[cid] = view
    return res


def format_zone1_player_protagonist_block(persona_snapshot: PersonaRecord | None) -> str:
    """Format static protagonist identity block for Zone 1.

    Guarantees 100% KV-cache reuse because player name and physical_appearance
    are immutable for the campaign.
    """
    if not persona_snapshot:
        return ""
    app_text = (
        f"Physical Appearance: {persona_snapshot.physical_appearance}\n"
        if persona_snapshot.physical_appearance.strip()
        else ""
    )
    return (
        f"\n\n=== PLAYER / PROTAGONIST ===\n"
        f"Name: {persona_snapshot.name}\n"
        f"{app_text}"
        f"Note: This is the player character. Do NOT speak, decide, or act on behalf of the player."
    )


def build_zone1_narrator_system_prompt(
    world: WorldRecord,
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Strictly static system prompt prefix for the Narrator Meta-Actor."""
    template = prompt_template or get_default_prompt("narrator_zone1_system")
    base = render_template(
        template,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
    )
    return base + format_zone1_player_protagonist_block(persona_snapshot)


def build_zone1_static_system_prompt(
    world: WorldRecord,
    character: CharacterRecord,
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Strictly static system prompt prefix to guarantee 100% KV-cache hits across turns."""
    voice_lines = "\n".join(
        f"- [{v.context}]: {v.snippet}" for v in character.voice_anchors
    )
    appearance_line = (
        f"Physical Appearance (Immutable Anatomy & Features): {character.physical_appearance}\n"
        if character.physical_appearance.strip()
        else ""
    )
    template = prompt_template or get_default_prompt("actor_zone1_system")
    base = render_template(
        template,
        character_name=character.name,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
        tagline=character.tagline,
        appearance_section=appearance_line,
        physical_appearance=character.physical_appearance,
        core_persona=character.core_persona,
        core_drive=character.baseline_psyche.core_drive,
        core_fear=character.baseline_psyche.core_fear,
        voice_lines=voice_lines,
    )
    return base + format_zone1_player_protagonist_block(persona_snapshot)


def build_zone1_ensemble_system_prompt(
    world: WorldRecord,
    present_characters: list[CharacterRecord],
    prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
) -> str:
    """Zone 1: Static prefix for multi-character ensemble prose generation.
    If len(present_characters) == 1: uses standard build_zone1_static_system_prompt.
    If len > 1: sorts characters by canonical id to maximize KV-cache reuse,
    rendering an ensemble cast sheet with persona, drive, fear, and voice anchors.
    """
    if len(present_characters) <= 1:
        single_char = present_characters[0] if present_characters else None
        if single_char is None:
            return build_zone1_narrator_system_prompt(world, prompt_template=prompt_template, persona_snapshot=persona_snapshot)
        return build_zone1_static_system_prompt(world, single_char, prompt_template=prompt_template, persona_snapshot=persona_snapshot)

    # Multi-character ensemble: sort strictly by canonical id
    sorted_cast = sorted(present_characters, key=lambda c: c.id)
    cast_sections: list[str] = []
    for c in sorted_cast:
        v_lines = "\n".join(f"  - [{v.context}]: {v.snippet}" for v in c.voice_anchors) or "  - None"
        app_text = f"  Physical Appearance: {c.physical_appearance}\n" if c.physical_appearance.strip() else ""
        cast_sections.append(
            f"=== CHARACTER: {c.name} (id='{c.id}') ===\n"
            f"Tagline: {c.tagline}\n"
            f"{app_text}"
            f"Persona: {c.core_persona}\n"
            f"Drive: {c.baseline_psyche.core_drive} | Fear: {c.baseline_psyche.core_fear}\n"
            f"Voice & Mannerism Anchors:\n{v_lines}"
        )
    ensemble_cast_text = "\n\n".join(cast_sections)

    protagonist_block = format_zone1_player_protagonist_block(persona_snapshot)

    return (
        f"You are the narrative ensemble writer in an interactive story.\n\n"
        f"=== WORLD SETTING: {world.name} ===\n"
        f"Genre & Tone: {world.global_rules.genre} — {world.global_rules.tone}\n"
        f"Overview: {world.global_rules.setting_overview}\n"
        f"World Rules: {world.global_rules.tech_or_magic_rules}\n\n"
        f"=== CAST PRESENT IN ROOM ===\n"
        f"{ensemble_cast_text}"
        f"{protagonist_block}\n\n"
        f"=== NARRATIVE PROTOCOL ===\n"
        f"Write rich, immersive, multi-character narrative prose capturing physical actions (*italics*) "
        f"and spoken dialogue (\"quotes\") for the present characters. "
        f"Honor each character's voice anchors, active thoughts, feelings, and tactical plans provided in the turn context. "
        f"When characters act under a dice check, strictly enforce the mechanical outcome tier in narrative prose:\n"
        f"- Critical Failure: The action catastrophically backfires with severe consequences. Never narrate success.\n"
        f"- Failure with Consequences: The attempt fails with noticeable resistance or secondary complications.\n"
        f"- Simple Failure: The attempt cleanly fails without piling on extra disasters.\n"
        f"- Clean Success: The attempt succeeds smoothly as intended.\n"
        f"- Critical Success: The attempt succeeds with outstanding flair and extra advantage.\n"
        f"Do NOT output <cognition> blocks. Never speak or act on behalf of the user."
    )


@dataclass(frozen=True)
class TurnContextBundle:
    """Consolidated turn context payload resolved during Phase 2."""

    world: WorldRecord
    branch_turns: list[TurnNodeRecord]
    leaf_turn: TurnNodeRecord
    active_location: LocationNode
    neighbors: list[NeighborLocationView]
    present_characters: list[CharacterRecord]
    pre_turn: PreTurnAnalysis
    user_message: str
    episodic_chunks: list[EpisodicChunkRecord]
    shared_scene_items: list[RecalledMemoryItem]
    per_character_recalled_items: dict[str, list[RecalledMemoryItem]]
    all_character_states: dict[str, CharacterStateSnapshot]
    character_name_map: dict[str, str]
    is_narrator: bool = False
    narrative_mode: str | None = None
    narrator_directive: str | None = None
    working_memory_turns: int | None = None
    actor_system_prompt_template: str | None = None
    persona_snapshot: PersonaRecord | None = None
    current_player_state: PersonaTurnStateSnapshot | None = None
    per_character_known_personas: dict[str, DiscoveredPersonaView] = field(default_factory=dict)
    decomposed_message: DecomposedUserMessage | None = None


def build_zone2_episodic_summary(chunks: list[EpisodicChunkRecord]) -> str | None:
    """Zone 2: Semi-static episodic summary block (updated only at chunk checkpoints)."""
    if not chunks:
        return None
    lines = [
        f"[Episode Turns {c.start_turn_depth}–{c.end_turn_depth}]: {c.summary_text}"
        for c in chunks
    ]
    return "=== STORY SO FAR (EPISODIC MEMORY) ===\n" + "\n".join(lines)


def was_character_present_on_turn(turn: TurnNodeRecord, character_id: str) -> bool:
    """Return True if character_id was present in the turn's active_location (or was the speaker)."""
    if turn.actor_id == character_id:
        return True
    if turn.character_states and character_id in turn.character_states:
        return (
            turn.character_states[character_id].current_location_id
            == turn.world_snapshot.active_location_id
        )
    if turn.character_state.character_id == character_id:
        return turn.character_state.current_location_id == turn.world_snapshot.active_location_id
    return False


def resolve_character_previous_state(
    branch_turns: list[TurnNodeRecord],
    character: CharacterRecord,
    fallback_location_id: str,
) -> CharacterStateSnapshot:
    """Resolve a character's state before the current turn, anchoring emotional state to the last non-narrator turn."""
    if not branch_turns:
        return CharacterStateSnapshot(
            turn_id="turn_root",
            character_id=character.id,
            current_location_id=fallback_location_id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            equipped=list(character.equipped),
            inventory=list(character.inventory),
        )

    parent_turn = branch_turns[-1]
    current_state = parent_turn.character_states.get(
        character.id,
        parent_turn.character_state if parent_turn.character_state.character_id == character.id else None,
    )
    if current_state is None:
        current_state = CharacterStateSnapshot(
            turn_id=parent_turn.id,
            character_id=character.id,
            current_location_id=fallback_location_id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            equipped=list(character.equipped),
            inventory=list(character.inventory),
        )

    # If the parent turn was a narrator turn or holds a detached narrator placeholder mood,
    # walk backwards along branch_turns to recover the authentic emotional state from the last non-narrator turn.
    if parent_turn.actor_id == "__narrator__" or current_state.mood_label == "Objective / Detached":
        for turn in reversed(branch_turns):
            if turn.actor_id == "__narrator__":
                continue
            hist_state = turn.character_states.get(
                character.id,
                turn.character_state if turn.character_state.character_id == character.id else None,
            )
            if hist_state and hist_state.mood_label != "Objective / Detached":
                return current_state.model_copy(
                    update={
                        "mood_label": hist_state.mood_label,
                        "valence": hist_state.valence,
                        "arousal": hist_state.arousal,
                        "active_want": hist_state.active_want,
                        "active_plan": hist_state.active_plan,
                    }
                )

        # Fallback to baseline psyche if no non-narrator turn had custom emotion
        return current_state.model_copy(
            update={
                "mood_label": character.baseline_psyche.mood_label,
                "valence": character.baseline_psyche.valence,
                "arousal": character.baseline_psyche.arousal,
                "active_want": character.baseline_psyche.default_want,
                "active_plan": character.baseline_psyche.default_plan,
            }
        )

    return current_state


async def resolve_phase2_turn_context(
    *,
    repo: Any,
    campaign_id: str,
    world: WorldRecord,
    branch_turns: list[TurnNodeRecord],
    pre_turn: PreTurnAnalysis,
    user_message: str,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord],
    character_name_map: dict[str, str],
    episodic_chunks: list[EpisodicChunkRecord],
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    working_memory_turns: int | None = None,
    actor_system_prompt_template: str | None = None,
    rag_top_k: int = 5,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> TurnContextBundle:
    """Phase 2: Scoped RAG & Context Resolution.
    Computes query embeddings once and partitions memory items between shared scene items
    and strictly epistemically-isolated per-character items.
    """
    decomp = (
        decomposed_message
        if decomposed_message is not None
        else decompose_user_message(user_message, present_characters)
    )
    valid_branch_turn_ids = {t.id for t in branch_turns}
    character_witnessed_turn_ids = {
        c.id: {t.id for t in branch_turns if was_character_present_on_turn(t, c.id)}
        for c in present_characters
    }
    char_ids = [c.id for c in present_characters]

    recall_bundle = await repo.vector_store.search_memories_for_characters(
        queries=pre_turn.memory_search_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        world_id=world.id,
        character_ids=char_ids,
        campaign_id=campaign_id,
        valid_branch_turn_ids=valid_branch_turn_ids,
        character_witnessed_turn_ids=character_witnessed_turn_ids,
        top_k=rag_top_k,
        exclude_location_id=active_location.id,
    )

    all_character_states = {
        c.id: resolve_character_previous_state(branch_turns, c, active_location.id)
        for c in present_characters
    }

    shared_items, per_char_items = resolve_triggered_item_lore(
        world=world,
        branch_turns=branch_turns,
        episodic_chunks=episodic_chunks,
        present_characters=present_characters,
        all_character_states=all_character_states,
        pre_turn=pre_turn,
        user_message=user_message,
        narrator_directive=narrator_directive,
        shared_scene_items=recall_bundle.shared_scene_items,
        per_character_recalled_items=recall_bundle.by_character,
        is_narrator=is_narrator,
        working_memory_turns=working_memory_turns,
    )

    leaf_turn = branch_turns[-1]
    per_char_known = build_all_character_known_personas(
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        all_character_states=all_character_states,
    )

    return TurnContextBundle(
        world=world,
        branch_turns=branch_turns,
        leaf_turn=leaf_turn,
        active_location=active_location,
        neighbors=neighbors,
        present_characters=present_characters,
        pre_turn=pre_turn,
        user_message=user_message,
        episodic_chunks=episodic_chunks,
        shared_scene_items=shared_items,
        per_character_recalled_items=per_char_items,
        all_character_states=all_character_states,
        character_name_map=character_name_map,
        is_narrator=is_narrator,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        working_memory_turns=working_memory_turns,
        actor_system_prompt_template=actor_system_prompt_template,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        per_character_known_personas=per_char_known,
        decomposed_message=decomp,
    )


def build_zone4_ephemeral_tail_frame(
    *,
    user_message: str,
    character: CharacterRecord,
    world_snapshot: WorldStateSnapshot,
    character_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    present_characters: list[CharacterRecord] | None = None,
    all_character_states: dict[str, CharacterStateSnapshot] | None = None,
    character_name_map: dict[str, str] | None = None,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    established_cognition: CognitionBlock | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> str:
    """Zone 4: Dynamic turn-specific context injected at the tail of the prompt."""
    exits_text = "\n".join(
        f"  - [{n.compass_direction or 'N'}] {n.direction_label} -> {n.destination.name} ({n.destination.summary}) "
        f"[{n.travel_minutes} min{' | LOCKED/HIDDEN' if n.is_locked_or_hidden else ''}]"
        for n in neighbors
    ) or "  - None visible"

    memories_text = "\n".join(
        f"  - [{m.source_type.upper()}] {m.title}: {m.content}"
        for m in recalled_items
    ) or "  - No specific background lore triggered this turn."

    name_lookup_local = dict(character_name_map or {})
    for pc in present_characters or []:
        name_lookup_local.setdefault(pc.id, pc.name)

    rng_section = ""
    if pre_turn.character_rolls:
        roll_lines = []
        for cid, r in pre_turn.character_rolls.items():
            name_label = r.character_name or name_lookup_local.get(cid, cid)
            roll_lines.append(
                f"    <character_roll character=\"{name_label}\" character_id=\"{cid}\">\n"
                f"      Action: {r.action_description} ({r.skill_or_approach}, role: {r.check_role})\n"
                f"      Roll: d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class} -> [{r.outcome_tier}]\n"
                f"      Directive: {r.narrative_directive}\n"
                f"    </character_roll>"
            )
        rng_section = (
            f"\n  <mechanics_outcome>\n"
            + "\n".join(roll_lines)
            + "\n    <mechanics_guidance>\n"
            "      Enforce each character's outcome tier strictly in dialogue and action. If co-present characters rolled opposing outcomes, higher tiers take precedence over contested objectives (Critical Success > Clean Success > Simple Failure > Failure with Consequences > Critical Failure).\n"
            "    </mechanics_guidance>\n"
            f"  </mechanics_outcome>"
        )
    elif pre_turn.resolved_roll is not None:
        r = pre_turn.resolved_roll
        rng_section = (
            f"\n  <mechanics_outcome>\n"
            f"    Action: {r.action_description} ({r.skill_or_approach})\n"
            f"    Roll: d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class} -> [{r.outcome_tier}]\n"
            f"    Directive: {r.narrative_directive}\n"
            f"  </mechanics_outcome>"
        )

    env_tags = ", ".join(active_location.environmental_tags) if active_location.environmental_tags else "None"
    scene_flags_text = (
        ", ".join(world_snapshot.scene_flags)
        if world_snapshot.scene_flags
        else "None"
    )
    rel_notes_text = (
        "; ".join(
            f"{name_lookup_local.get(k, k)}: {v}"
            for k, v in character_state.relationship_notes.items()
        )
        if character_state.relationship_notes
        else "None"
    )
    eq_names = format_item_names(character_state.equipped)
    inv_names = format_item_names(character_state.inventory)
    equipped_text = ", ".join(eq_names) if eq_names else "None"
    inventory_text = ", ".join(inv_names) if inv_names else "None"

    co_present_section = ""
    if present_characters:
        others = [c for c in present_characters if c.id != character.id]
        if others:
            other_lines: list[str] = []
            for oc in others:
                oc_state = (all_character_states or {}).get(oc.id)
                mood_info = f" [Mood: {oc_state.mood_label}]" if oc_state else ""
                app_info = (
                    f" | Appearance: {oc.physical_appearance}"
                    if oc.physical_appearance.strip()
                    else ""
                )
                oc_eq_names = format_item_names(
                    oc_state.equipped if oc_state is not None else oc.equipped
                )
                oc_inv_names = format_item_names(
                    oc_state.inventory if oc_state is not None else oc.inventory
                )
                eq_info = f" | Equipped: {', '.join(oc_eq_names)}" if oc_eq_names else ""
                inv_info = f" | Carried: {', '.join(oc_inv_names)}" if oc_inv_names else ""
                other_lines.append(
                    f"    - {oc.name} ({oc.tagline}){mood_info}{app_info}{eq_info}{inv_info}"
                )
            co_present_section = (
                "\n  <other_characters_in_room>\n"
                + "\n".join(other_lines)
                + "\n  </other_characters_in_room>"
            )

    if is_narrator:
        if narrative_mode == "describe":
            default_dir = (
                "Describe the immediate environment, lighting, acoustics, smells, visible points of interest, "
                "and subtle observable details or lore markers with objective neutrality. Do not speak or decide for the user's character."
            )
        elif narrative_mode == "advance":
            default_dir = (
                "Advance the story and depict the passage of time without player character actions. "
                "Detail environmental shifts, ambient sounds, lighting cycles, weather, or machine cycles."
            )
        elif narrative_mode == "complication":
            default_dir = (
                "Introduce an unexpected external complication or inciting incident (e.g. a sudden power surge, "
                "an unannounced arrival, mechanical failure, alarm, or environmental hazard). "
                "Do NOT force the protagonist's emotional or physical reaction; present the event as external fact."
            )
        else:
            default_dir = (
                "Follow the director guidance with strict objective detachment: "
                f"{narrator_directive or 'Depict the scene objectively.'}"
            )
        directive_text = narrator_directive if narrator_directive and narrative_mode not in ("describe", "complication") else default_dir
        if narrator_directive and narrative_mode == "complication":
            directive_text += f" (Focus hint: {narrator_directive})"
        mind_state_section = (
            f"  <narrator_directive mode=\"{narrative_mode or 'custom'}\">\n"
            f"    Directive: {directive_text}\n"
            f"    STRICT NEUTRALITY CONSTRAINTS:\n"
            f"    - Zero emotional puppeteering (do not write 'you feel', 'relief', 'panic', 'dread').\n"
            f"    - Zero helpful hints or editorial guidance (do not suggest what to do).\n"
            f"    - Zero heroic sycophancy (no 'luckily', 'bravely', 'against all odds').\n"
            f"    - The world is completely indifferent to the characters.\n"
            f"  </narrator_directive>"
        )
        user_tail = f"Director / Narrator Request:\n{user_message}"
    else:
        char_roll_for_anchor = pre_turn.character_rolls.get(character.id) or (
            pre_turn.resolved_roll
            if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
            else None
        )
        if char_roll_for_anchor and char_roll_for_anchor.outcome_tier in ("Critical Failure", "Critical Success"):
            anchor_line = f"    Emotional Anchor: This turn resulted in a [{char_roll_for_anchor.outcome_tier}]! You are explicitly permitted a sharp immediate emotional shift from this previous baseline.\n"
        else:
            anchor_line = "    Emotional Anchor: Evolve valence and arousal gradually from this previous baseline (typically ±0.05 to ±0.20), reserving large swings for dramatic turning points or acute shocks.\n"

        mind_state_section = (
            f"  <character_previous_mind_state character=\"{character.name}\">\n"
            f"    Previous Mood: {character_state.mood_label} "
            f"(Valence: {character_state.valence:+.2f}, Arousal: {character_state.arousal:.2f})\n"
            f"    Previous Want: {character_state.active_want}\n"
            f"    Previous Plan: {character_state.active_plan}\n"
            f"    Relationship Notes: {rel_notes_text}\n"
            f"    Equipped / Worn: {equipped_text}\n"
            f"    Carried Inventory: {inventory_text}\n"
            f"{anchor_line}"
            f"  </character_previous_mind_state>"
        )
        user_tail = f"User Action / Dialogue:\n{user_message}"

    established_cognition_section = ""
    if not is_narrator:
        if established_cognitions:
            cog_blocks: list[str] = []
            present_chars = present_characters or [character]
            primary_id = pre_turn.active_speaker_id or character.id
            from app.engine.choices import cognition_dispatch_order
            choice_target_ids = set(pre_turn.choice_resolutions.keys())
            ordered_chars = cognition_dispatch_order(
                present_chars,
                primary_id=primary_id,
                choice_target_ids=choice_target_ids,
            )
            for pc in ordered_chars:
                cog = established_cognitions.get(pc.id)
                if not cog or cog.skipped:
                    continue
                role_label = "primary_speaker" if pc.id == primary_id else "co_present"
                cog_blocks.append(
                    f"  <character_active_cognition character=\"{pc.name}\" character_id=\"{pc.id}\" role=\"{role_label}\">\n"
                    f"    <feeling valence=\"{cog.valence:+.2f}\" arousal=\"{cog.arousal:.2f}\">{cog.feeling}</feeling>\n"
                    f"    <want>{cog.want}</want>\n"
                    f"    <plan>\n{cog.plan}\n    </plan>\n"
                    f"  </character_active_cognition>"
                )
            if cog_blocks:
                established_cognition_section = (
                    "\n"
                    + "\n".join(cog_blocks)
                    + "\n  <actor_directive>\n"
                    "    CRITICAL: Internal thoughts, emotional feelings, and tactical plans for the characters have already been established above in <character_active_cognition>.\n"
                    "    Do NOT output <cognition> blocks. Output ONLY immersive, in-character narrative prose executing these plans.\n"
                    "  </actor_directive>"
                )
        elif established_cognition:
            established_cognition_section = (
                f"\n  <character_active_cognition character=\"{character.name}\">\n"
                f"    <recall>\n{established_cognition.recall}\n    </recall>\n"
                f"    <feeling valence=\"{established_cognition.valence:+.2f}\" arousal=\"{established_cognition.arousal:.2f}\">{established_cognition.feeling}</feeling>\n"
                f"    <want>{established_cognition.want}</want>\n"
                f"    <plan>\n{established_cognition.plan}\n    </plan>\n"
                f"  </character_active_cognition>\n"
                f"  <actor_directive>\n"
                f"    CRITICAL: Your character's internal thoughts and immediate plan for this turn have already been established above in <character_active_cognition>.\n"
                f"    Do NOT output <cognition> blocks. Output ONLY immersive, in-character narrative prose embodying this feeling and executing this plan.\n"
                f"  </actor_directive>"
            )

    selected_local_lore = select_active_location_lore_for_turn(
        active_location,
        user_message=user_message,
        pre_turn=pre_turn,
        narrator_directive=narrator_directive,
    )
    local_lore_block = ""
    if selected_local_lore:
        local_lore_lines = "\n".join(
            f"      - [{'SECRET — DISCOVERED' if ln.category == 'secret' else ln.category.upper()}] {ln.title}: {ln.content}"
            for ln in selected_local_lore
        )
        local_lore_block = f"\n    <local_lore>\n{local_lore_lines}\n    </local_lore>"

    player_gear_section = ""
    if persona_snapshot:
        eq_items = (
            current_player_state.equipped
            if current_player_state is not None
            else persona_snapshot.equipped
        )
        vis_eq = [it.name for it in eq_items if not it.is_secret]
        if vis_eq:
            player_gear_section = (
                f"\n  <player_visible_equipment player=\"{persona_snapshot.name}\">\n"
                f"    Equipped / Worn: {', '.join(vis_eq)}\n"
                f"  </player_visible_equipment>"
            )

    directed_cues_section = ""
    if decomposed_message and decomposed_message.whispers:
        whisper_lines = []
        for w in decomposed_message.whispers:
            pts = []
            if w.speech_parts:
                pts.append(f"Spoken Dialogue: {w.speech_parts}")
            if w.sensory_parts:
                pts.append(f"Sensory/Perception: {w.sensory_parts}")
            whisper_lines.append(f"    - @{w.character_name} ({w.target_scope.value.upper()}): {'; '.join(pts)}")
        directed_cues_section = (
            f"\n  <directed_character_cues>\n"
            + "\n".join(whisper_lines)
            + "\n    CRITICAL DIRECTIVE: Characters are only aware of their own private perceptions and words spoken aloud in the room. Characters must NOT metagame each other's private sensory observations.\n"
            f"  </directed_character_cues>"
        )

    return (
        "<scene_context>\n"
        f"  <world_clock>{describe_world_timestamp(world_snapshot.world_timestamp)}</world_clock>\n"
        f"  <scene_flags>{scene_flags_text}</scene_flags>\n"
        f"  <active_location name=\"{active_location.name}\">\n"
        f"    {active_location.description}\n"
        f"    Props & Atmosphere: {env_tags}{local_lore_block}\n"
        f"  </active_location>{co_present_section}\n"
        f"  <connected_locations>\n{exits_text}\n  </connected_locations>\n"
        f"  <recalled_memories_and_lore>\n{memories_text}\n  </recalled_memories_and_lore>\n"
        f"  <auxiliary_prompt_analysis>\n"
        f"    User Tone/Sentiment: {pre_turn.user_sentiment}\n"
        f"    Subtext Cue: {pre_turn.subtext_interpretation}\n"
        f"    Spatial Intent: {pre_turn.spatial_intent}"
        f"{f' ({pre_turn.target_location_hint})' if pre_turn.target_location_hint else ''}\n"
        f"  </auxiliary_prompt_analysis>{rng_section}\n"
        f"{mind_state_section}"
        f"{established_cognition_section}"
        f"{player_gear_section}"
        f"{directed_cues_section}\n"
        "</scene_context>\n\n"
        f"{user_tail}"
    )


def assemble_four_zone_messages(
    *,
    world: WorldRecord,
    character: CharacterRecord,
    branch_turns: list[TurnNodeRecord],
    episodic_chunks: list[EpisodicChunkRecord],
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    user_message: str,
    present_characters: list[CharacterRecord] | None = None,
    character_name_map: dict[str, str] | None = None,
    working_memory_turns: int | None = None,
    actor_system_prompt_template: str | None = None,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    established_cognition: CognitionBlock | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> list[dict[str, str]]:
    """Construct the complete 4-Zone OpenAI messages array for the Main Actor Model."""
    if is_narrator:
        zone1_prompt = build_zone1_narrator_system_prompt(world, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    elif present_characters and len(present_characters) > 1:
        zone1_prompt = build_zone1_ensemble_system_prompt(world, present_characters, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    else:
        zone1_prompt = build_zone1_static_system_prompt(world, character, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": zone1_prompt,
        }
    ]

    # Zone 2: Chunked episodic summaries
    zone2 = build_zone2_episodic_summary(episodic_chunks)
    if zone2:
        messages.append({"role": "system", "content": zone2})

    # Determine where Working Memory (Zone 3) starts, filtering to turns where character was in the room
    max_summarized_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    unsummarized_turns = [
        t
        for t in branch_turns
        if t.depth_index > max_summarized_depth
        and (is_narrator or was_character_present_on_turn(t, character.id))
    ]
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    working_window = unsummarized_turns[-wm_limit:]

    # Zone 3: Verbatim recent turns (with old <cognition> stripped to preserve context window)
    name_lookup = dict(character_name_map or {})
    name_lookup["__narrator__"] = "Narrator"
    for c in present_characters or []:
        name_lookup[c.id] = c.name
    name_lookup[character.id] = character.name

    active_actor_id = "__narrator__" if is_narrator else character.id
    for turn in working_window:
        prose_text = turn.raw_prose
        if turn.actor_id != active_actor_id and turn.actor_id in name_lookup:
            prose_text = f"[{name_lookup[turn.actor_id]}]: {turn.raw_prose}"
        elif turn.actor_id == "__narrator__" and active_actor_id != "__narrator__":
            prose_text = f"[Narrator]: {turn.raw_prose}"

        filtered_user_msg = (
            turn.user_message
            if is_narrator
            else filter_user_message_for_character(
                turn.user_message,
                target_character_id=character.id,
                campaign_characters=present_characters or [character],
            )
        )

        if turn.depth_index == 0 and turn.user_message == "[Scene Start]":
            messages.append({"role": "assistant", "content": prose_text})
        else:
            messages.append({"role": "user", "content": filtered_user_msg})
            messages.append({"role": "assistant", "content": prose_text})

    # Zone 4: Ephemeral Turn Frame + latest user message at the very tail
    leaf_turn = branch_turns[-1]
    char_state = resolve_character_previous_state(branch_turns, character, active_location.id)
    resolved_all_states = {
        c.id: resolve_character_previous_state(branch_turns, c, active_location.id)
        for c in (present_characters or [character])
    }
    zone4_content = build_zone4_ephemeral_tail_frame(
        user_message=user_message,
        character=character,
        world_snapshot=leaf_turn.world_snapshot,
        character_state=char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        present_characters=present_characters,
        all_character_states=resolved_all_states,
        character_name_map=name_lookup,
        is_narrator=is_narrator,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        established_cognition=established_cognition,
        established_cognitions=established_cognitions,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_message,
    )
    messages.append({"role": "user", "content": zone4_content})
    return messages
