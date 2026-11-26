"""Phase 2 turn context resolver and 4-zone prompt message assembler."""

from __future__ import annotations

from app.config import settings
from app.engine.mentions import (
    DecomposedUserMessage,
    decompose_user_message,
    filter_user_message_for_character,
)
from app.engine.telemetry import active_turn_telemetry
from app.schemas.character import (
    CharacterRecord,
    CognitionBlock,
)
from app.schemas.party import PartyRecord
from app.schemas.persona import (
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.telemetry import Phase4BudgetReport
from app.schemas.turn import (
    EpisodicChunkRecord,
    NarrativeVoice,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
)
from app.schemas.world import (
    LocationNode,
    LocationProp,
    NeighborLocationView,
    WorldRecord,
)
from typing import Any

from app.engine.context.lore_scope import (
    _PROMPT_SAFETY_MARGIN_TOKENS,
    estimate_messages_tokens,
    get_immediate_level1_container,
    logger,
    resolve_triggered_item_lore,
    was_character_present_on_turn,
)
from app.engine.context.zone1_static import (
    build_all_character_known_personas,
    build_zone1_ensemble_system_prompt,
    build_zone1_narrator_system_prompt,
    build_zone1_solo_system_prompt,
    build_zone1_static_system_prompt,
    build_zone1_storyteller_system_prompt,
)
from app.engine.context.zone2_episodic import (
    TurnContextBundle,
    elevate_compacted_episode_turns,
    pack_recalled_items_to_budget,
    render_zone2_lod_episodic_summary,
)
from app.engine.context.zone4_ephemeral import (
    _project_snapshot_to_elapsed,
    build_zone4_ephemeral_tail_frame,
    resolve_character_previous_state,
)

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
    recall_budget_cognition_tokens: int | None = None,
    narrative_voice: NarrativeVoice = "first_person",
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

    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    recent_turn_texts = [
        f"{t.user_message}\n{t.raw_prose}" for t in branch_turns[-wm_limit:]
    ]
    effective_queries = list(pre_turn.memory_search_queries)
    if user_message and user_message.strip():
        effective_queries.append(user_message.strip())

    imm_container = get_immediate_level1_container(active_location, world)
    recall_bundle = await repo.vector_store.search_memories_for_characters(
        queries=effective_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        world_id=world.id,
        character_ids=char_ids,
        campaign_id=campaign_id,
        valid_branch_turn_ids=valid_branch_turn_ids,
        character_witnessed_turn_ids=character_witnessed_turn_ids,
        recent_turn_texts=recent_turn_texts,
        use_dynamic_max=True,
        top_k=rag_top_k,
        exclude_location_id=active_location.id,
        exclude_container_id=imm_container.id if imm_container else None,
    )

    leaf_turn = branch_turns[-1]
    target_elapsed = leaf_turn.world_snapshot.campaign_elapsed_minutes
    all_character_states = {
        c.id: _project_snapshot_to_elapsed(
            resolve_character_previous_state(branch_turns, c, active_location.id),
            c,
            target_elapsed,
        )
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

    # Phase D: Dynamic Turn Elevation for compacted episodic chunks (epistemically scoped per character)
    shared_items = elevate_compacted_episode_turns(
        recalled_items=shared_items,
        episodic_chunks=episodic_chunks,
        branch_turns=branch_turns,
        queries=effective_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        recent_turn_texts=recent_turn_texts,
        target_character_id=None,
        present_characters=present_characters,
        character_name_map=character_name_map,
        working_memory_turns=working_memory_turns,
        is_narrator=is_narrator,
    )
    per_char_items = {
        cid: elevate_compacted_episode_turns(
            recalled_items=items,
            episodic_chunks=episodic_chunks,
            branch_turns=branch_turns,
            queries=effective_queries,
            mentioned_entities=pre_turn.mentioned_entities,
            recent_turn_texts=recent_turn_texts,
            target_character_id=cid,
            present_characters=present_characters,
            character_name_map=character_name_map,
            working_memory_turns=working_memory_turns,
            is_narrator=is_narrator,
        )
        for cid, items in per_char_items.items()
    }

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
        recall_budget_cognition_tokens=recall_budget_cognition_tokens,
        active_parties=list(leaf_turn.world_snapshot.parties or []),
        narrative_voice=narrative_voice,
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
    is_solo: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    established_cognition: CognitionBlock | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
    origin_location_id: str | None = None,
    max_context_tokens: int | None = None,
    reserved_output_tokens: int = 0,
    min_working_memory_turns: int | None = None,
    lod_summary_chunks: int | None = None,
    lod_importance_bonus: int | None = None,
    zone2_budget_share_pct: int | None = None,
    recall_budget_prose_tokens: int | None = None,
    active_parties: list[PartyRecord] | None = None,
    budget_report_out: list[Phase4BudgetReport] | None = None,
    newly_discovered_edge_ids: set[str] | None = None,
    visible_location_props: list[LocationProp] | None = None,
    newly_revealed_prop_ids: set[str] | None = None,
    newly_spawned_prop_ids: set[str] | None = None,
    narrative_voice: NarrativeVoice | None = None,
    pov_character: CharacterRecord | None = None,
) -> list[dict[str, str]]:
    """Construct the complete 4-Zone OpenAI messages array for the Main Actor Model."""
    zone_pov_char = pov_character or character
    eff_is_solo = bool(
        is_solo
        or (not is_narrator and present_characters is not None and len(present_characters) == 0)
    )
    if is_narrator:
        zone1_prompt = build_zone1_narrator_system_prompt(world, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    elif eff_is_solo:
        zone1_prompt = build_zone1_solo_system_prompt(world, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    elif narrative_voice == "storyteller":
        zone1_prompt = build_zone1_storyteller_system_prompt(
            world,
            present_characters or [character],
            prompt_template=actor_system_prompt_template,
            persona_snapshot=persona_snapshot,
        )
    elif narrative_voice == "first_person":
        co_present = [c for c in (present_characters or []) if c.id != zone_pov_char.id]
        zone1_prompt = build_zone1_static_system_prompt(
            world,
            zone_pov_char,
            prompt_template=actor_system_prompt_template,
            persona_snapshot=persona_snapshot,
            co_present_characters=co_present or None,
        )
    elif present_characters and len(present_characters) > 1:
        zone1_prompt = build_zone1_ensemble_system_prompt(world, present_characters, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    else:
        zone1_prompt = build_zone1_static_system_prompt(world, character, prompt_template=actor_system_prompt_template, persona_snapshot=persona_snapshot)
    zone1_msg = {
        "role": "system",
        "content": zone1_prompt,
    }

    # Determine where Working Memory (Zone 3) starts, filtering to turns where character was in the room
    max_summarized_depth = max((c.end_turn_depth for c in episodic_chunks), default=-1)
    storyteller_cast = present_characters or [character]
    unsummarized_turns = [
        t
        for t in branch_turns
        if t.depth_index > max_summarized_depth
        and t.actor_id != "__arrival__"
        and (
            is_narrator
            or eff_is_solo
            or (
                any(was_character_present_on_turn(t, c.id) for c in storyteller_cast)
                if narrative_voice == "storyteller"
                else was_character_present_on_turn(t, zone_pov_char.id)
            )
        )
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
    name_lookup["__solo__"] = "Narrator"
    for c in present_characters or []:
        name_lookup[c.id] = c.name
    name_lookup[character.id] = character.name
    name_lookup[zone_pov_char.id] = zone_pov_char.name

    active_actor_id = (
        "__narrator__"
        if is_narrator
        else ("__solo__" if eff_is_solo else zone_pov_char.id)
    )
    zone3_turn_entries: list[list[dict[str, str]]] = []
    for turn in working_window:
        prose_text = turn.raw_prose
        is_pov_anchored_turn = (
            narrative_voice == "first_person"
            and turn.actor_id not in ("__narrator__", "__solo__", "__arrival__")
            and was_character_present_on_turn(turn, zone_pov_char.id)
        )
        if (
            turn.actor_id != active_actor_id
            and turn.actor_id in name_lookup
            and not is_pov_anchored_turn
        ):
            prose_text = f"[{name_lookup[turn.actor_id]}]: {turn.raw_prose}"
        elif (
            turn.actor_id in ("__narrator__", "__solo__")
            and active_actor_id not in ("__narrator__", "__solo__")
        ):
            prose_text = f"[Narrator]: {turn.raw_prose}"

        filtered_user_msg = (
            turn.user_message
            if (is_narrator or eff_is_solo)
            else filter_user_message_for_character(
                turn.user_message,
                target_character_id=zone_pov_char.id,
                campaign_characters=present_characters or [zone_pov_char],
            )
        )

        if turn.depth_index == 0 and turn.user_message == "[Scene Start]":
            zone3_turn_entries.append([{"role": "assistant", "content": prose_text}])
        else:
            zone3_turn_entries.append(
                [
                    {"role": "user", "content": filtered_user_msg},
                    {"role": "assistant", "content": prose_text},
                ]
            )

    # Zone 4: Ephemeral Turn Frame + latest user message at the very tail
    leaf_turn = branch_turns[-1]
    target_elapsed = leaf_turn.world_snapshot.campaign_elapsed_minutes
    char_state = _project_snapshot_to_elapsed(
        resolve_character_previous_state(branch_turns, zone_pov_char, active_location.id),
        zone_pov_char,
        target_elapsed,
    )
    resolved_all_states = (
        {}
        if eff_is_solo
        else {
            c.id: _project_snapshot_to_elapsed(
                resolve_character_previous_state(branch_turns, c, active_location.id),
                c,
                target_elapsed,
            )
            for c in (present_characters or [zone_pov_char])
        }
    )
    eff_recall_prose_budget = (
        recall_budget_prose_tokens
        if recall_budget_prose_tokens is not None
        else settings.memory_config.recall_budget_prose_tokens
    )
    packed_recalled_items = (
        pack_recalled_items_to_budget(recalled_items, eff_recall_prose_budget)
        if recalled_items
        else []
    )
    zone4_content = build_zone4_ephemeral_tail_frame(
        user_message=user_message,
        character=zone_pov_char,
        world_snapshot=leaf_turn.world_snapshot,
        character_state=char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=packed_recalled_items,
        pre_turn=pre_turn,
        present_characters=[] if eff_is_solo else present_characters,
        all_character_states=resolved_all_states,
        character_name_map=name_lookup,
        is_narrator=is_narrator,
        is_solo=eff_is_solo,
        narrative_mode=narrative_mode,
        narrator_directive=narrator_directive,
        established_cognition=established_cognition,
        established_cognitions=established_cognitions,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_message,
        world=world,
        origin_location_id=origin_location_id,
        active_parties=(
            list(active_parties)
            if active_parties is not None
            else list(leaf_turn.world_snapshot.parties or [])
        ),
        newly_discovered_edge_ids=newly_discovered_edge_ids,
        visible_location_props=visible_location_props,
        newly_revealed_prop_ids=newly_revealed_prop_ids,
        newly_spawned_prop_ids=newly_spawned_prop_ids,
        narrative_voice=narrative_voice,
    )
    zone4_msg = {"role": "user", "content": zone4_content}

    # Zone 2 Sealed-Episode LOD Cascade + Zone 3 Floor Protection:
    # 1. Render Zone 2 using LOD tiers (newest/salient chunks in 'summary', older chunks in 1-line 'synopsis').
    # 2. Protect at least `min_working_memory_turns` in Zone 3 before cascading Zone 2 LOD (summary -> synopsis -> dropped).
    # 3. Only trim Zone 3 below `min_working_memory_turns` if Zone 2 is completely dropped and budget is still exceeded.
    eff_min_wm = (
        min_working_memory_turns
        if min_working_memory_turns is not None
        else settings.memory_config.min_working_memory_turns
    )
    eff_lod_chunks = (
        lod_summary_chunks
        if lod_summary_chunks is not None
        else settings.memory_config.lod_summary_chunks
    )
    eff_lod_bonus = (
        lod_importance_bonus
        if lod_importance_bonus is not None
        else settings.memory_config.lod_importance_bonus
    )
    eff_z2_share_pct = (
        zone2_budget_share_pct
        if zone2_budget_share_pct is not None
        else settings.memory_config.zone2_budget_share_pct
    )

    active_chunks = list(episodic_chunks)
    zone2, initial_lod_tiers = render_zone2_lod_episodic_summary(
        active_chunks,
        lod_summary_chunks=eff_lod_chunks,
        lod_importance_bonus=eff_lod_bonus,
    )
    lod_tiers = dict(initial_lod_tiers)
    total_zone3_available = len(zone3_turn_entries)
    total_zone2_available = len(active_chunks)
    zone1_tokens = estimate_messages_tokens([zone1_msg])
    zone4_tokens = estimate_messages_tokens([zone4_msg])
    turn_costs = [estimate_messages_tokens(entry) for entry in zone3_turn_entries]
    zone3_tokens = sum(turn_costs)
    zone2_tokens = (
        estimate_messages_tokens([{"role": "system", "content": zone2}])
        if zone2
        else 0
    )
    dropped_zone3 = 0
    dropped_zone2 = 0
    downgraded_zone2 = 0
    trimmed_below_min_wm = False
    base_exceeds_budget = False
    estimated_cropped_tokens = 0
    input_budget: int | None = None

    if max_context_tokens is not None and max_context_tokens > 0:
        input_budget = max(
            0,
            int(max_context_tokens)
            - max(0, int(reserved_output_tokens))
            - _PROMPT_SAFETY_MARGIN_TOKENS,
        )
        base_tokens = zone1_tokens + zone4_tokens

        remaining_history_budget = max(0, input_budget - base_tokens)
        z2_share_cap = int(remaining_history_budget * (eff_z2_share_pct / 100.0))

        # Guaranteed Zone 3 budget is at least (100 - eff_z2_share_pct)% of remaining_history_budget,
        # plus any unused portion of Zone 2's share cap.
        guaranteed_z3_budget = max(
            0, remaining_history_budget - min(zone2_tokens, z2_share_cap)
        )
        protected_floor_count = 0
        protected_z3_tokens = 0
        for cost in reversed(turn_costs):
            if protected_floor_count >= max(1, eff_min_wm):
                break
            if protected_z3_tokens + cost <= guaranteed_z3_budget:
                protected_floor_count += 1
                protected_z3_tokens += cost
            else:
                break

        # If Zone 2 exceeds its share cap while total prompt exceeds budget, cascade Zone 2 LOD first
        if (
            active_chunks
            and zone2_tokens > z2_share_cap
            and (base_tokens + zone2_tokens + zone3_tokens) > input_budget
        ):
            zone2, lod_tiers = render_zone2_lod_episodic_summary(
                active_chunks,
                budget_tokens=z2_share_cap,
                lod_summary_chunks=eff_lod_chunks,
                lod_importance_bonus=eff_lod_bonus,
            )
            zone2_tokens = (
                estimate_messages_tokens([{"role": "system", "content": zone2}])
                if zone2
                else 0
            )

        # Step 1: Trim oldest Zone 3 turns ONLY down to protected_floor_count
        while (
            len(zone3_turn_entries) > protected_floor_count
            and (base_tokens + zone2_tokens + zone3_tokens) > input_budget
        ):
            zone3_turn_entries.pop(0)
            zone3_tokens -= turn_costs.pop(0)
            dropped_zone3 += 1

        # Step 2: If still over budget, cascade Zone 2 LOD (summary -> synopsis -> dropped)
        if active_chunks and (base_tokens + zone2_tokens + zone3_tokens) > input_budget:
            allowed_z2 = max(0, input_budget - base_tokens - zone3_tokens)
            zone2, lod_tiers = render_zone2_lod_episodic_summary(
                active_chunks,
                budget_tokens=allowed_z2,
                lod_summary_chunks=eff_lod_chunks,
                lod_importance_bonus=eff_lod_bonus,
            )
            zone2_tokens = (
                estimate_messages_tokens([{"role": "system", "content": zone2}])
                if zone2
                else 0
            )

        # Step 3: Last-resort trim below protected_floor_count only if Zone 2 is empty and budget is still exceeded
        while zone3_turn_entries and (base_tokens + zone2_tokens + zone3_tokens) > input_budget:
            zone3_turn_entries.pop(0)
            zone3_tokens -= turn_costs.pop(0)
            dropped_zone3 += 1
            trimmed_below_min_wm = True

        # Also flag trimmed_below_min_wm if we had enough turns to meet eff_min_wm but ended up below it due to budget
        if (
            total_zone3_available >= max(1, eff_min_wm)
            and len(zone3_turn_entries) < max(1, eff_min_wm)
            and dropped_zone3 > 0
        ):
            trimmed_below_min_wm = True

        dropped_zone2 = sum(1 for t in lod_tiers.values() if t == "dropped")
        downgraded_zone2 = sum(
            1
            for cid, init_tier in initial_lod_tiers.items()
            if init_tier == "summary" and lod_tiers.get(cid) == "synopsis"
        )

        if dropped_zone3 or dropped_zone2:
            logger.warning(
                "Actor prompt exceeded context budget (%d ctx - %d output - %d margin = %d input tok); "
                "trimmed %d oldest Zone 3 turn(s) and dropped %d oldest Zone 2 chunk(s) via LOD cascade to protect Zone 1.",
                max_context_tokens,
                max(0, int(reserved_output_tokens)),
                _PROMPT_SAFETY_MARGIN_TOKENS,
                input_budget,
                dropped_zone3,
                dropped_zone2,
            )
        if (base_tokens + zone2_tokens) > input_budget:
            base_exceeds_budget = True
            estimated_cropped_tokens = max(0, (base_tokens + zone2_tokens) - input_budget)
            logger.warning(
                "Zone 1 + Zone 4 alone (~%d tok) exceed Actor input budget (%d tok); "
                "increase Actor context_size or switch to Fast & Concise preset.",
                base_tokens + zone2_tokens,
                input_budget,
            )

    report = Phase4BudgetReport(
        context_ceiling=int(max_context_tokens) if max_context_tokens and max_context_tokens > 0 else None,
        reserved_output_tokens=max(0, int(reserved_output_tokens)),
        safety_margin_tokens=_PROMPT_SAFETY_MARGIN_TOKENS,
        input_budget=input_budget,
        zone1_tokens=zone1_tokens,
        zone2_tokens=zone2_tokens,
        zone3_tokens=zone3_tokens,
        zone4_tokens=zone4_tokens,
        total_zone3_turns_available=total_zone3_available,
        dropped_zone3_turns=dropped_zone3,
        trimmed_below_min_wm=trimmed_below_min_wm,
        total_zone2_chunks_available=total_zone2_available,
        downgraded_zone2_chunks=downgraded_zone2,
        dropped_zone2_chunks=dropped_zone2,
        base_exceeds_budget=base_exceeds_budget,
        estimated_cropped_tokens=estimated_cropped_tokens,
    )
    if budget_report_out is not None:
        budget_report_out.append(report)
    collector = active_turn_telemetry.get()
    if collector is not None:
        collector.set_phase4_budget(report)

    messages: list[dict[str, str]] = [zone1_msg]
    if zone2:
        messages.append({"role": "system", "content": zone2})
    for entry in zone3_turn_entries:
        messages.extend(entry)
    messages.append(zone4_msg)
    return messages
