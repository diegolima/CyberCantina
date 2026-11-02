"""Phase 2: 4-Zone KV-Cache-Preserving Prompt & Context Assembler."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from app.config import settings
from app.engine.world_clock import describe_world_timestamp
from app.prompts import get_default_prompt, render_template
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import (
    EpisodicChunkRecord,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, NeighborLocationView, WorldRecord


def build_zone1_narrator_system_prompt(
    world: WorldRecord,
    prompt_template: str | None = None,
) -> str:
    """Zone 1: Strictly static system prompt prefix for the Narrator Meta-Actor."""
    template = prompt_template or get_default_prompt("narrator_zone1_system")
    return render_template(
        template,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
    )


def build_zone1_static_system_prompt(
    world: WorldRecord,
    character: CharacterRecord,
    prompt_template: str | None = None,
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
    return render_template(
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


def build_zone1_ensemble_system_prompt(
    world: WorldRecord,
    present_characters: list[CharacterRecord],
    prompt_template: str | None = None,
) -> str:
    """Zone 1: Static prefix for multi-character ensemble prose generation.
    If len(present_characters) == 1: uses standard build_zone1_static_system_prompt.
    If len > 1: sorts characters by canonical id to maximize KV-cache reuse,
    rendering an ensemble cast sheet with persona, drive, fear, and voice anchors.
    """
    if len(present_characters) <= 1:
        single_char = present_characters[0] if present_characters else None
        if single_char is None:
            return build_zone1_narrator_system_prompt(world, prompt_template=prompt_template)
        return build_zone1_static_system_prompt(world, single_char, prompt_template=prompt_template)

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

    return (
        f"You are the narrative ensemble writer in an interactive story.\n\n"
        f"=== WORLD SETTING: {world.name} ===\n"
        f"Genre & Tone: {world.global_rules.genre} — {world.global_rules.tone}\n"
        f"Overview: {world.global_rules.setting_overview}\n"
        f"World Rules: {world.global_rules.tech_or_magic_rules}\n\n"
        f"=== CAST PRESENT IN ROOM ===\n"
        f"{ensemble_cast_text}\n\n"
        f"=== NARRATIVE PROTOCOL ===\n"
        f"Write rich, immersive, multi-character narrative prose capturing physical actions (*italics*) "
        f"and spoken dialogue (\"quotes\") for the present characters. "
        f"Honor each character's voice anchors, active thoughts, feelings, and tactical plans provided in the turn context. "
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
) -> TurnContextBundle:
    """Phase 2: Scoped RAG & Context Resolution.
    Computes query embeddings once and partitions memory items between shared scene items
    and strictly epistemically-isolated per-character items.
    """
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
    )

    all_character_states = {
        c.id: resolve_character_previous_state(branch_turns, c, active_location.id)
        for c in present_characters
    }

    leaf_turn = branch_turns[-1]

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
        shared_scene_items=recall_bundle.shared_scene_items,
        per_character_recalled_items=recall_bundle.by_character,
        all_character_states=all_character_states,
        character_name_map=character_name_map,
        is_narrator=is_narrator,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        working_memory_turns=working_memory_turns,
        actor_system_prompt_template=actor_system_prompt_template,
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

    rng_section = ""
    if pre_turn.resolved_roll is not None:
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
    name_lookup_local = dict(character_name_map or {})
    for pc in present_characters or []:
        name_lookup_local.setdefault(pc.id, pc.name)
    rel_notes_text = (
        "; ".join(
            f"{name_lookup_local.get(k, k)}: {v}"
            for k, v in character_state.relationship_notes.items()
        )
        if character_state.relationship_notes
        else "None"
    )
    equipped_text = (
        ", ".join(character_state.equipped)
        if character_state.equipped
        else "None"
    )
    inventory_text = (
        ", ".join(character_state.inventory)
        if character_state.inventory
        else "None"
    )

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
                oc_equipped = oc_state.equipped if oc_state is not None else oc.equipped
                oc_inv = oc_state.inventory if oc_state is not None else oc.inventory
                eq_info = f" | Equipped: {', '.join(oc_equipped)}" if oc_equipped else ""
                inv_info = f" | Carried: {', '.join(oc_inv)}" if oc_inv else ""
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
                "Describe the immediate environment, lighting, acoustics, smells, and visible points of interest "
                "with objective neutrality. Do not speak or decide for the user's character."
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
        elif narrative_mode == "perception":
            default_dir = (
                "Detail subtle perceptual clues and environmental lore tied to this space. "
                "Focus on what is physically observable: structural wear, hidden markings, faint odors, subtle vibrations, "
                "or technological signatures from the recalled lore. Do not tell the protagonist how to feel."
            )
        else:
            default_dir = (
                "Follow the director guidance with strict objective detachment: "
                f"{narrator_directive or 'Depict the scene objectively.'}"
            )
        directive_text = narrator_directive if narrator_directive and narrative_mode not in ("describe", "complication", "perception") else default_dir
        if narrator_directive and narrative_mode in ("complication", "perception"):
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
        mind_state_section = (
            f"  <character_previous_mind_state character=\"{character.name}\">\n"
            f"    Previous Mood: {character_state.mood_label} "
            f"(Valence: {character_state.valence:+.2f}, Arousal: {character_state.arousal:.2f})\n"
            f"    Previous Want: {character_state.active_want}\n"
            f"    Previous Plan: {character_state.active_plan}\n"
            f"    Relationship Notes: {rel_notes_text}\n"
            f"    Equipped / Worn: {equipped_text}\n"
            f"    Carried Inventory: {inventory_text}\n"
            f"    Emotional Anchor: Evolve valence and arousal gradually from this previous baseline (typically ±0.05 to ±0.20), reserving large swings for dramatic turning points or acute shocks.\n"
            f"  </character_previous_mind_state>"
        )
        user_tail = f"User Action / Dialogue:\n{user_message}"

    established_cognition_section = ""
    if not is_narrator:
        if established_cognitions:
            cog_blocks: list[str] = []
            present_chars = present_characters or [character]
            primary_id = pre_turn.active_speaker_id or character.id
            ordered_chars = sorted(
                present_chars,
                key=lambda c: (0 if c.id == primary_id else 1, c.id),
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

    return (
        "<scene_context>\n"
        f"  <world_clock>{describe_world_timestamp(world_snapshot.world_timestamp)}</world_clock>\n"
        f"  <scene_flags>{scene_flags_text}</scene_flags>\n"
        f"  <active_location name=\"{active_location.name}\">\n"
        f"    {active_location.description}\n"
        f"    Props & Atmosphere: {env_tags}\n"
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
        f"{established_cognition_section}\n"
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
) -> list[dict[str, str]]:
    """Construct the complete 4-Zone OpenAI messages array for the Main Actor Model."""
    if is_narrator:
        zone1_prompt = build_zone1_narrator_system_prompt(world, prompt_template=actor_system_prompt_template)
    elif present_characters and len(present_characters) > 1:
        zone1_prompt = build_zone1_ensemble_system_prompt(world, present_characters, prompt_template=actor_system_prompt_template)
    else:
        zone1_prompt = build_zone1_static_system_prompt(world, character, prompt_template=actor_system_prompt_template)
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

        if turn.depth_index == 0 and turn.user_message == "[Scene Start]":
            messages.append({"role": "assistant", "content": prose_text})
        else:
            messages.append({"role": "user", "content": turn.user_message})
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
    )
    messages.append({"role": "user", "content": zone4_content})
    return messages
