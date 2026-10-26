"""Phase 2: 4-Zone KV-Cache-Preserving Prompt & Context Assembler."""

from __future__ import annotations

from app.config import settings
from app.engine.world_clock import describe_world_timestamp
from app.schemas.character import CharacterRecord, CharacterStateSnapshot
from app.schemas.turn import (
    EpisodicChunkRecord,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, NeighborLocationView, WorldRecord


def build_zone1_static_system_prompt(
    world: WorldRecord,
    character: CharacterRecord,
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
    return (
        f"You are roleplaying as {character.name} in an interactive narrative.\n\n"
        f"=== WORLD SETTING: {world.name} ===\n"
        f"Genre & Tone: {world.global_rules.genre} — {world.global_rules.tone}\n"
        f"Overview: {world.global_rules.setting_overview}\n"
        f"World Rules: {world.global_rules.tech_or_magic_rules}\n\n"
        f"=== CHARACTER IDENTITY: {character.name} ===\n"
        f"Tagline: {character.tagline}\n"
        f"{appearance_line}"
        f"Persona: {character.core_persona}\n"
        f"Core Drive: {character.baseline_psyche.core_drive}\n"
        f"Core Fear: {character.baseline_psyche.core_fear}\n\n"
        f"=== VOICE & MANNERISM ANCHORS ===\n"
        f"{voice_lines}\n\n"
        "=== COGNITIVE & NARRATIVE OUTPUT PROTOCOL ===\n"
        "Before writing your narrative response, you MUST think through the turn inside a single "
        "<cognition> XML block following this exact 4-step cognitive flow:\n"
        "<cognition>\n"
        "  <recall>What you remember from your history, lore, or recent events relevant right now.</recall>\n"
        "  <feeling valence=\"0.0\" arousal=\"0.5\">How you feel right now (valence -1.0 to +1.0, arousal 0.0 to 1.0) and why.</feeling>\n"
        "  <want>What you immediately need or want in this scene.</want>\n"
        "  <plan>Your concrete plan for what to do or say in this turn.</plan>\n"
        "</cognition>\n"
        "Immediately after closing </cognition>, write your immersive, in-character narrative prose "
        "(actions in *italics*, spoken dialogue in \"quotes\"). Never speak or act on behalf of the user.\n"
        "The current in-game date and time is given in <world_clock> each turn: keep lighting, "
        "activity, fatigue, and any time references consistent with it, and treat it as the time "
        "at the start of the user's action."
    )


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
    rel_notes_text = (
        "; ".join(f"{k}: {v}" for k, v in character_state.relationship_notes.items())
        if character_state.relationship_notes
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
                oc_inv = oc_state.inventory if oc_state is not None else oc.inventory
                inv_info = f" | Attire/Items: {', '.join(oc_inv)}" if oc_inv else ""
                other_lines.append(
                    f"    - {oc.name} ({oc.tagline}){mood_info}{app_info}{inv_info}"
                )
            co_present_section = (
                "\n  <other_characters_in_room>\n"
                + "\n".join(other_lines)
                + "\n  </other_characters_in_room>"
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
        f"  <character_previous_mind_state character=\"{character.name}\">\n"
        f"    Previous Mood: {character_state.mood_label} "
        f"(Valence: {character_state.valence:+.2f}, Arousal: {character_state.arousal:.2f})\n"
        f"    Previous Want: {character_state.active_want}\n"
        f"    Previous Plan: {character_state.active_plan}\n"
        f"    Relationship Notes: {rel_notes_text}\n"
        f"    Current Inventory & Attire: {inventory_text}\n"
        f"  </character_previous_mind_state>\n"
        "</scene_context>\n\n"
        f"User Action / Dialogue:\n{user_message}"
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
) -> list[dict[str, str]]:
    """Construct the complete 4-Zone OpenAI messages array for the Main Actor Model."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_zone1_static_system_prompt(world, character)}
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
        and was_character_present_on_turn(t, character.id)
    ]
    working_window = unsummarized_turns[-settings.memory_config.working_memory_turns :]

    # Zone 3: Verbatim recent turns (with old <cognition> stripped to preserve context window)
    name_lookup = dict(character_name_map or {})
    for c in present_characters or []:
        name_lookup[c.id] = c.name
    name_lookup[character.id] = character.name

    for turn in working_window:
        prose_text = turn.raw_prose
        if turn.actor_id != character.id and turn.actor_id in name_lookup:
            prose_text = f"[{name_lookup[turn.actor_id]}]: {turn.raw_prose}"

        if turn.depth_index == 0 and turn.user_message == "[Scene Start]":
            messages.append({"role": "assistant", "content": prose_text})
        else:
            messages.append({"role": "user", "content": turn.user_message})
            messages.append({"role": "assistant", "content": prose_text})

    # Zone 4: Ephemeral Turn Frame + latest user message at the very tail
    leaf_turn = branch_turns[-1]
    char_state = leaf_turn.character_states.get(character.id, leaf_turn.character_state)
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
        all_character_states=leaf_turn.character_states,
    )
    messages.append({"role": "user", "content": zone4_content})
    return messages
