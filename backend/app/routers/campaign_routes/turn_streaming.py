"""Campaign turn execution pipeline, SSE streaming, and synchronous turn submission."""

from __future__ import annotations

import asyncio
import json
import re
import uuid

from app.auth import get_current_user
from app.config import settings
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_persona_disclosure_mode,
    get_effective_user_model_settings,
    get_repo,
    resolve_effective_models,
)
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
)
from app.engine.mentions import decompose_user_message
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import (
    assemble_four_zone_messages,
    resolve_actor_context_ceiling,
    resolve_character_previous_state,
    resolve_phase2_turn_context,
)
from app.engine.phase3_cognition import run_phase3_multi_cognition
from app.engine.phase4_prose import stream_phase4_prose
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.providers.local_relay import (
    RelayRemoteError,
    RelayUnavailableError,
)
from app.schemas.auth import UserProfile
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    format_item_names,
)
from app.schemas.persona import (
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.turn import (
    CampaignStateBundle,
    MechanicsTrigger,
    Phase3ProgressEvent,
    Phase5ProgressEvent,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.security.log_sanitize import sanitize_log_value
from collections.abc import AsyncIterator
from dataclasses import dataclass
from fastapi import (
    Depends,
    HTTPException,
)
from fastapi.responses import StreamingResponse
from typing import Any
from app.routers.campaign_routes.schemas_and_gate import _resolve_facade_attr

from app.routers.campaign_routes.schemas_and_gate import (
    campaign_turn_gate,
    logger,
    router,
)

# ------------------------------------------------------------------
# 4-Phase Turn Execution Pipeline (SSE Stream & Sync REST)
# ------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _StreamPacketItem:
    event: str
    data: dict[str, Any]


@dataclass(frozen=True, slots=True)
class _StreamErrorItem:
    exception: BaseException


@dataclass(frozen=True, slots=True)
class _StreamDoneSentinel:
    pass


_PhaseQueueItem = _StreamPacketItem | _StreamErrorItem | _StreamDoneSentinel


_Phase4QueueItem = _PhaseQueueItem


_Phase5QueueItem = _PhaseQueueItem


async def _execute_turn_stream_events(
    campaign_id: str,
    req: TurnSubmitRequest,
    owner_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Serialize per-campaign turn execution through CampaignTurnGate until Phase 5 commits."""
    async with campaign_turn_gate.lock_for(campaign_id):
        async for packet in _execute_turn_stream_events_unlocked(
            campaign_id, req, owner_id=owner_id
        ):
            yield packet


async def _execute_turn_stream_events_unlocked(
    campaign_id: str,
    req: TurnSubmitRequest,
    owner_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Orchestrate Phases 1, 2, 3, and 4 for a single turn, yielding structured events."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    campaign = repo.get_campaign(campaign_id, owner_id=owner_id)
    parent_id = req.parent_turn_id or campaign.active_leaf_turn_id
    if not parent_id:
        raise RuntimeError(f"Campaign '{campaign_id}' has no parent turn node")

    # Resolve parent branch chain (allows instantaneous swipe/branch from any node!)
    branch_turns = repo.get_branch_turn_chain(parent_id)
    valid_turn_ids = {t.id for t in branch_turns}
    parent_turn = branch_turns[-1]

    persona_snapshot: PersonaRecord | None = campaign.persona_snapshot
    current_player_state: PersonaTurnStateSnapshot | None = repo.get_campaign_persona_turn_state(parent_turn.id)
    if current_player_state is None and persona_snapshot is not None:
        current_player_state = PersonaTurnStateSnapshot(
            turn_id=parent_turn.id,
            equipped=list(persona_snapshot.equipped),
            inventory=list(persona_snapshot.inventory),
        )

    world = repo.get_world(
        campaign.world_id,
        valid_turn_ids=valid_turn_ids,
        campaign_id=campaign.id,
    )
    primary_character = repo.get_character(
        campaign.character_id, campaign_id=campaign.id, valid_turn_ids=valid_turn_ids
    )
    participant_ids = campaign.participant_character_ids or [campaign.character_id]
    participants: list[CharacterRecord] = []
    for cid in participant_ids:
        try:
            participants.append(
                repo.get_character(
                    cid, campaign_id=campaign.id, valid_turn_ids=valid_turn_ids
                )
            )
        except KeyError:
            continue
    if not participants:
        participants = [primary_character]
    participants_by_id = {c.id: c for c in participants}

    parent_active_loc_id = parent_turn.world_snapshot.active_location_id
    if req.override_location_id:
        override_loc = repo.get_location(
            req.override_location_id, campaign_id=campaign.id
        )
        if override_loc.world_id == world.id:
            active_location = override_loc
            if active_location.created_at_turn_id:
                valid_turn_ids = set(valid_turn_ids) | {active_location.created_at_turn_id}
            parent_turn.world_snapshot.active_location_id = active_location.id
            for st in parent_turn.character_states.values():
                if st.current_location_id == parent_active_loc_id:
                    st.current_location_id = active_location.id
            if parent_turn.character_state.current_location_id == parent_active_loc_id:
                parent_turn.character_state.current_location_id = active_location.id
        else:
            active_location = repo.get_location(
                parent_active_loc_id, campaign_id=campaign.id
            )
    else:
        active_location = repo.get_location(
            parent_active_loc_id, campaign_id=campaign.id
        )

    neighbors = repo.get_neighbor_locations(
        world.id,
        active_location.id,
        valid_turn_ids=valid_turn_ids,
        campaign_id=campaign.id,
    )
    episodic_chunks = repo.get_branch_episodic_chunks(campaign.id, valid_turn_ids)

    # Filter characters physically present in active_location (room-level spatial isolation)
    present_characters = [
        c
        for c in participants
        if parent_turn.character_states.get(c.id, parent_turn.character_state).current_location_id
        == active_location.id
    ]
    if not present_characters:
        present_characters = [primary_character]

    # Collect prioritized, deduplicated known entity tags (excluding secret tags!) for Phase 1
    raw_known_entities: list[str] = [c.name for c in present_characters]
    for loc_lore in active_location.lore_nodes:
        if loc_lore.category != "secret":
            raw_known_entities.extend(loc_lore.entity_tags)
    for loc in world.locations:
        raw_known_entities.append(loc.name)
    for lore in world.lore_nodes:
        raw_known_entities.append(lore.title)
        raw_known_entities.extend(lore.entity_tags)
    for c in present_characters:
        c_st = parent_turn.character_states.get(c.id, parent_turn.character_state)
        if c_st.character_id == c.id:
            raw_known_entities.extend(format_item_names(c_st.equipped))
            raw_known_entities.extend(format_item_names(c_st.inventory))
        else:
            raw_known_entities.extend(format_item_names(c.equipped))
            raw_known_entities.extend(format_item_names(c.inventory))
        for shard in c.memory_shards:
            raw_known_entities.extend(shard.keywords)
    for loc in world.locations:
        if loc.id == active_location.id:
            continue
        for loc_lore in loc.lore_nodes:
            if loc_lore.category != "secret":
                raw_known_entities.extend(loc_lore.entity_tags)
    for cont in world.containers:
        raw_known_entities.append(cont.name)
        for cont_lore in cont.lore_nodes:
            if cont_lore.category != "secret":
                raw_known_entities.extend(cont_lore.entity_tags)

    # Resolve origin location prior to transition for LCA Zone 4 entry/exit cues
    origin_location_id: str | None = None
    if req.override_location_id and req.override_location_id != parent_active_loc_id:
        origin_location_id = parent_active_loc_id
    elif len(branch_turns) >= 2:
        origin_location_id = branch_turns[-2].world_snapshot.active_location_id

    known_entities: list[str] = []
    seen_known_lower: set[str] = set()
    for ent in raw_known_entities:
        cleaned_ent = ent.strip()
        if cleaned_ent and cleaned_ent.lower() not in seen_known_lower:
            seen_known_lower.add(cleaned_ent.lower())
            known_entities.append(cleaned_ent)

    eff_actor, eff_clerk, eff_wm_turns, eff_delegate_cognition, eff_max_flags = get_effective_user_model_settings(owner_id)
    eff_models = resolve_effective_models(owner_id)
    eff_dispatch_mode = get_effective_agent_dispatch_mode(owner_id)
    eff_disclosure_mode = get_effective_persona_disclosure_mode(owner_id)
    effective_prompts = repo.resolve_effective_prompts(user_id=owner_id, campaign_id=campaign.id)

    effective_user_message = req.user_message.strip()

    applied_choices = dict(req.character_choices)

    # Defense-in-depth: Auto-detect narrator mode if client omitted narrative_mode or swiped a narrator turn
    if req.narrative_mode == "standard" and effective_user_message:
        lower_msg = effective_user_message.lower()
        if lower_msg.startswith("[describe the current scene"):
            req.narrative_mode = "describe"
        elif lower_msg.startswith("[advance the story") or (
            lower_msg.startswith("[") and ("wait for" in lower_msg or "minutes elapse" in lower_msg)
        ):
            req.narrative_mode = "advance"
            if not req.duration_minutes:
                for m in re.finditer(r"\d+", lower_msg):
                    if lower_msg[m.end() :].lstrip().startswith("minute"):
                        req.duration_minutes = int(m.group(0))
                        break
        elif lower_msg.startswith("[introduce a complication") or lower_msg.startswith("[introduce an unexpected complication"):
            req.narrative_mode = "complication"
            dir_match = re.search(r"^\[introduce a complication:(.*)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
        elif lower_msg.startswith("[perception check") or lower_msg.startswith("[examine the scene"):
            # Backwards-compatibility for historical swipes/edits: normalize legacy perception cues into custom directive
            req.narrative_mode = "custom"
            dir_match = re.search(r"^\[perception check:(.*)\]$", effective_user_message, re.IGNORECASE)
            if dir_match:
                req.narrator_directive = dir_match.group(1).strip()
            else:
                req.narrator_directive = effective_user_message.replace("[", "").replace("]", "").strip()
        elif req.parent_turn_id and campaign.active_leaf_turn_id:
            try:
                active_leaf = repo.get_turn_node(campaign.active_leaf_turn_id)
                if (
                    active_leaf.parent_turn_id == req.parent_turn_id
                    and active_leaf.actor_id == "__narrator__"
                    and active_leaf.user_message.strip() == effective_user_message
                ):
                    req.narrative_mode = "custom"
                    req.narrator_directive = effective_user_message
            except KeyError:
                pass

    is_narrator = req.narrative_mode in ("describe", "advance", "complication", "custom")
    if applied_choices and is_narrator:
        raise HTTPException(
            status_code=422,
            detail="Director choices cannot be applied in narrator modes.",
        )

    from app.engine.choices import DIRECTOR_CONTINUE_MESSAGE, filter_choices_to_present

    present_char_ids = {c.id for c in present_characters}
    applied_choices, dropped_ids = filter_choices_to_present(applied_choices, present_char_ids)
    if dropped_ids:
        yield {
            "event": "choices_adjusted",
            "data": {"dropped_character_ids": dropped_ids},
        }

    message_is_synthetic = False
    if not effective_user_message:
        if applied_choices:
            effective_user_message = DIRECTOR_CONTINUE_MESSAGE
            message_is_synthetic = True
        elif req.narrative_mode == "describe":
            effective_user_message = "[Describe the current scene]"
        elif req.narrative_mode == "advance":
            if req.duration_minutes:
                effective_user_message = f"[Advance the story: wait for {req.duration_minutes} minutes]"
            elif req.narrator_directive:
                effective_user_message = f"[Advance the story: {req.narrator_directive}]"
            else:
                effective_user_message = "[Advance the story without player action]"
        elif req.narrative_mode == "complication":
            effective_user_message = (
                f"[Introduce a complication: {req.narrator_directive}]"
                if req.narrator_directive
                else "[Introduce an unexpected complication or external event]"
            )
        elif req.narrative_mode == "custom":
            effective_user_message = req.narrator_directive or "[Director request]"
        else:
            raise HTTPException(status_code=400, detail="User message cannot be empty")

    # Decompose user message into public text vs character-directed whispers
    present_char_ids = {c.id for c in present_characters}
    decomposed_msg = decompose_user_message(
        effective_user_message,
        campaign_characters=participants,
        present_character_ids=present_char_ids,
    )

    # PHASE 1: Auxiliary Pre-Turn Analysis, Multi-Character Speaker Orchestration & RNG Mechanics
    if is_narrator:
        if req.narrative_mode == "complication":
            subtext = "Introduce an unexpected external complication or inciting incident"
            queries = [active_location.name, "hazard", "threat", "complication"] + (
                [req.narrator_directive] if req.narrator_directive else []
            )
        elif req.narrative_mode == "advance":
            subtext = (
                f"Depict the passage of time ({req.duration_minutes} minutes)"
                if req.duration_minutes
                else "Depict the passage of time and shifting ambient conditions"
            )
            queries = [active_location.name, "time", "routine"]
        else:
            subtext = (
                f"Narrator direction: {req.narrator_directive}"
                if req.narrator_directive
                else "Environmental narration without player character action"
            )
            queries = [active_location.name] + ([req.narrator_directive] if req.narrator_directive else [])

        # In narrator mode, dice are never rolled under any circumstance
        pre_turn = PreTurnAnalysis(
            user_sentiment="objective, observational",
            subtext_interpretation=subtext,
            mentioned_entities=[active_location.name],
            memory_search_queries=queries,
            spatial_intent="stay",
            active_speaker_id="__narrator__",
            speaker_order=["__narrator__"],
            dice_mode="disabled",
            manual_dice_value=None,
            mechanics_check=MechanicsTrigger(requires_roll=False),
            character_rolls={},
            resolved_roll=None,
        )
        character = primary_character
        actor_id = "__narrator__"
        prev_char_state = resolve_character_previous_state(
            branch_turns,
            primary_character,
            active_location.id,
        )
    else:
        char_states_for_p1 = {
            c.id: resolve_character_previous_state(branch_turns, c, active_location.id)
            for c in present_characters
        }
        pre_turn = await _resolve_facade_attr("run_phase1_pre_analysis", run_phase1_pre_analysis)(
            user_message=effective_user_message,
            character=present_characters[0],
            active_location=active_location,
            neighbors=neighbors,
            known_entities=known_entities,
            dice_mode=req.dice_mode,
            manual_dice_override=req.manual_dice_override,
            present_characters=present_characters,
            previous_speaker_id=parent_turn.actor_id,
            character_states=char_states_for_p1,
            profile=eff_clerk,
            prompt_template=effective_prompts.get("clerk_pre_turn_system"),
            character_choices=applied_choices,
            message_is_synthetic=message_is_synthetic,
            persona_snapshot=persona_snapshot,
            current_player_items=(current_player_state.equipped + current_player_state.inventory) if current_player_state else None,
            disclosure_detection_mode=eff_disclosure_mode,
            decomposed_message=decomposed_msg,
        )
        # Resolve active speaker selected by Phase 1 from characters present in the room
        character = (
            participants_by_id.get(pre_turn.active_speaker_id or "")
            if pre_turn.active_speaker_id in {c.id for c in present_characters}
            else None
        ) or present_characters[0]
        actor_id = character.id
        prev_char_state = resolve_character_previous_state(
            branch_turns,
            character,
            active_location.id,
        )

    # PHASE 2: Scoped RAG & Context Resolution
    context_bundle = await resolve_phase2_turn_context(
        repo=repo,
        campaign_id=campaign.id,
        world=world,
        branch_turns=branch_turns,
        pre_turn=pre_turn,
        user_message=effective_user_message,
        active_location=active_location,
        neighbors=neighbors,
        present_characters=present_characters,
        character_name_map={c.id: c.name for c in participants},
        episodic_chunks=episodic_chunks,
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        working_memory_turns=eff_wm_turns,
        actor_system_prompt_template=(
            effective_prompts.get("narrator_zone1_system")
            if is_narrator
            else effective_prompts.get("actor_zone1_system")
        ),
        rag_top_k=settings.memory_config.rag_top_k,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_msg,
        recall_budget_cognition_tokens=eff_models.recall_budget_cognition_tokens,
    )

    seen_recall_ids: set[str] = set()
    recalled_items: list[RecalledMemoryItem] = []
    for m in (
        *context_bundle.shared_scene_items,
        *context_bundle.per_character_recalled_items.get(character.id, []),
    ):
        if m.id not in seen_recall_ids:
            seen_recall_ids.add(m.id)
            recalled_items.append(m)

    yield {
        "event": "phase1_complete",
        "data": {
            "pre_turn": pre_turn.model_dump(),
            "recalled_items": [m.model_dump() for m in recalled_items],
        },
    }

    # PHASE 3: Per-Character Multi-Cognition Swarm
    p3_queue: asyncio.Queue[_PhaseQueueItem] = asyncio.Queue()

    async def _phase3_progress_cb(ev: Phase3ProgressEvent) -> None:
        await p3_queue.put(_StreamPacketItem(event=ev.event, data=ev.model_dump()))

    async def _run_phase3_worker() -> None:
        try:
            cogs = await _resolve_facade_attr("run_phase3_multi_cognition", run_phase3_multi_cognition)(
                context=context_bundle,
                profile=eff_clerk,
                dispatch_mode=eff_dispatch_mode,
                cognition_system_template=effective_prompts.get("character_cognition_system"),
                on_progress=_phase3_progress_cb,
            )
            await p3_queue.put(_StreamPacketItem(event="_p3_internal_done", data={"cognitions": cogs}))
        except BaseException as exc:
            await p3_queue.put(_StreamErrorItem(exception=exc))
        finally:
            await p3_queue.put(_StreamDoneSentinel())

    p3_task = asyncio.create_task(_run_phase3_worker())
    established_cognitions: dict[str, CognitionBlock] = {}
    try:
        while True:
            item = await p3_queue.get()
            if isinstance(item, _StreamDoneSentinel):
                break
            if isinstance(item, _StreamErrorItem):
                raise item.exception
            if item.event == "_p3_internal_done":
                established_cognitions = item.data["cognitions"]
            else:
                yield {"event": item.event, "data": item.data}
    finally:
        if not p3_task.done():
            await asyncio.shield(p3_task)

    # PHASE 4: Narrative Prose Generation & Streaming
    actor_ctx_ceiling, actor_reserved_out = resolve_actor_context_ceiling(eff_actor)
    messages = assemble_four_zone_messages(
        world=world,
        character=character,
        branch_turns=branch_turns,
        episodic_chunks=episodic_chunks,
        active_location=active_location,
        neighbors=neighbors,
        origin_location_id=origin_location_id,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        user_message=effective_user_message,
        present_characters=present_characters,
        character_name_map={c.id: c.name for c in participants},
        working_memory_turns=eff_wm_turns,
        actor_system_prompt_template=(
            effective_prompts.get("narrator_zone1_system")
            if is_narrator
            else effective_prompts.get("actor_zone1_system")
        ),
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        established_cognitions=established_cognitions,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_msg,
        max_context_tokens=actor_ctx_ceiling,
        reserved_output_tokens=actor_reserved_out,
        min_working_memory_turns=eff_models.min_working_memory_turns,
        lod_summary_chunks=eff_models.lod_summary_chunks,
        lod_importance_bonus=eff_models.lod_importance_bonus,
        zone2_budget_share_pct=eff_models.zone2_budget_share_pct,
        recall_budget_prose_tokens=eff_models.recall_budget_prose_tokens,
    )

    primary_cognition = (
        established_cognitions.get(character.id)
        if not is_narrator and character.id in established_cognitions
        else CognitionBlock(
            recall=f"Observing {active_location.name}",
            feeling="Objective / Detached" if is_narrator else prev_char_state.mood_label,
            valence=0.0 if is_narrator else prev_char_state.valence,
            arousal=0.0 if is_narrator else prev_char_state.arousal,
            want="Depict environment and world state neutrally" if is_narrator else prev_char_state.active_want,
            plan=req.narrator_directive or "Describe scene" if is_narrator else prev_char_state.active_plan,
            skipped=is_narrator,
        )
    )
    final_cognition = primary_cognition
    final_prose = ""

    async for item in _resolve_facade_attr("stream_phase4_prose", stream_phase4_prose)(
        messages=messages,
        user_message=effective_user_message,
        character=character,
        previous_state=prev_char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        present_characters=present_characters,
        all_character_states=context_bundle.all_character_states,
        established_cognitions=established_cognitions,
        profile=eff_actor,
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_msg,
    ):
        if item["event"] == "actor_finished":
            final_cognition = CognitionBlock.model_validate(item["data"]["cognition"])
            final_prose = item["data"]["raw_prose"]
        else:
            yield item

    # Persist initial Turn Node prior to Phase 5 Post-Turn Clerk
    new_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
    new_depth = parent_turn.depth_index + 1
    parent_elapsed = parent_turn.world_snapshot.campaign_elapsed_minutes
    initial_world_snapshot = WorldStateSnapshot(
        turn_id=new_turn_id,
        world_timestamp=parent_turn.world_snapshot.world_timestamp,
        campaign_elapsed_minutes=parent_elapsed,
        active_location_id=active_location.id,
        scene_flags=parent_turn.world_snapshot.scene_flags,
    )
    base_primary_state = context_bundle.all_character_states.get(character.id) or prev_char_state
    base_primary_care = ensure_snapshot_care_state(
        base_primary_state,
        character.baseline_psyche,
        elapsed_minutes=parent_elapsed,
    )
    if not is_narrator and not final_cognition.skipped:
        primary_roll = pre_turn.character_rolls.get(character.id) or (
            pre_turn.resolved_roll
            if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
            else None
        )
        provisional_primary_care = compute_provisional_cognition_preview(
            base_primary_care,
            final_cognition.to_feeling_impulse(),
            roll_outcome=primary_roll.outcome_tier if primary_roll else None,
        )
    else:
        provisional_primary_care = base_primary_care

    initial_char_state = CharacterStateSnapshot(
        turn_id=new_turn_id,
        character_id=character.id,
        current_location_id=active_location.id,
        mood_label=(
            base_primary_state.mood_label
            if is_narrator
            else (final_cognition.feeling[:80] or provisional_primary_care.short_mood_label)
        ),
        valence=base_primary_state.valence if is_narrator else provisional_primary_care.valence,
        arousal=base_primary_state.arousal if is_narrator else provisional_primary_care.arousal,
        active_want=base_primary_state.active_want if is_narrator else (final_cognition.want or base_primary_state.active_want),
        active_plan=base_primary_state.active_plan if is_narrator else (final_cognition.plan or base_primary_state.active_plan),
        relationship_notes=dict(base_primary_state.relationship_notes),
        equipped=list(base_primary_state.equipped),
        inventory=list(base_primary_state.inventory),
        unlocked_persona_keys=list(base_primary_state.unlocked_persona_keys),
        persona_knowledge_provenance=dict(base_primary_state.persona_knowledge_provenance),
        care_state=provisional_primary_care,
    )

    # Seed all participant character states so UI doesn't drop co-present character state
    extra_character_states = []
    for p in participants:
        if p.id != character.id and p.id in context_bundle.all_character_states:
            st = context_bundle.all_character_states[p.id].model_copy(update={"turn_id": new_turn_id})
            cog = established_cognitions.get(p.id)
            if cog and not cog.skipped and not is_narrator:
                p_care = ensure_snapshot_care_state(
                    st,
                    p.baseline_psyche,
                    elapsed_minutes=parent_elapsed,
                )
                p_roll = pre_turn.character_rolls.get(p.id)
                p_prov = compute_provisional_cognition_preview(
                    p_care,
                    cog.to_feeling_impulse(),
                    roll_outcome=p_roll.outcome_tier if p_roll else None,
                )
                st = materialize_snapshot_with_care(st, p_prov).model_copy(
                    update={
                        "mood_label": cog.feeling[:80] or p_prov.short_mood_label,
                        "active_want": cog.want or st.active_want,
                        "active_plan": cog.plan or st.active_plan,
                    }
                )
            extra_character_states.append(st)

    saved_turn = repo.save_turn_node(
        turn_id=new_turn_id,
        campaign_id=campaign.id,
        parent_turn_id=parent_turn.id,
        depth_index=new_depth,
        user_message=effective_user_message,
        actor_id=actor_id,
        raw_prose=final_prose,
        cognition=final_cognition,
        cognitions=established_cognitions,
        cognition_character_names={c.id: c.name for c in participants},
        pre_turn=pre_turn,
        whispers=decomposed_msg.whispers,
        world_snapshot=initial_world_snapshot,
        character_state=initial_char_state,
        extra_character_states=extra_character_states,
        recalled_items=recalled_items,
    )

    yield {"event": "turn_saved", "data": saved_turn.model_dump()}

    # PHASE 5: Post-Turn Global Clerk + Per-Character State Agents & Arbitration
    p5_queue: asyncio.Queue[_PhaseQueueItem] = asyncio.Queue()

    async def _phase5_progress_cb(ev: Phase5ProgressEvent) -> None:
        await p5_queue.put(_StreamPacketItem(event=ev.event, data=ev.model_dump()))
        # If event starts with phase5_, also send phase4_ alias for legacy SSE listeners
        if ev.event.startswith("phase5_"):
            legacy_ev = "phase4_" + ev.event[len("phase5_"):]
            legacy_data = dict(ev.model_dump())
            legacy_data["event"] = legacy_ev
            await p5_queue.put(_StreamPacketItem(event=legacy_ev, data=legacy_data))

    async def _run_phase5_worker() -> None:
        try:
            updated_turn, _chunks = await _resolve_facade_attr("run_phase5_post_turn_clerk", run_phase5_post_turn_clerk)(
                repo=repo,
                campaign_id=campaign.id,
                world_id=world.id,
                character=character,
                completed_turn=saved_turn,
                active_location=active_location,
                neighbors=neighbors,
                present_characters=present_characters,
                all_participants=participants,
                profile=eff_clerk,
                dispatch_mode=eff_dispatch_mode,
                working_memory_turns=eff_wm_turns,
                max_scene_flags=eff_max_flags,
                post_turn_prompt_template=effective_prompts.get("clerk_post_turn_system"),
                character_post_turn_prompt_template=effective_prompts.get("character_post_turn_system"),
                arbitration_prompt_template=effective_prompts.get("clerk_arbitration_system"),
                summary_prompt_template=effective_prompts.get("clerk_episodic_summary_system"),
                persona_snapshot=persona_snapshot,
                current_player_state=current_player_state,
                on_progress=_phase5_progress_cb,
            )
            bundle = repo.get_campaign_state_bundle(campaign.id)
            # Emit both phase5_complete and legacy phase4_complete
            complete_payload = {
                "turn": updated_turn.model_dump(),
                "state_bundle": bundle.model_dump(),
            }
            await p5_queue.put(_StreamPacketItem(event="phase5_complete", data=complete_payload))
            await p5_queue.put(_StreamPacketItem(event="phase4_complete", data=complete_payload))
        except BaseException as exc:
            await p5_queue.put(_StreamErrorItem(exception=exc))
        finally:
            await p5_queue.put(_StreamDoneSentinel())

    worker_task = asyncio.create_task(_run_phase5_worker())
    try:
        while True:
            item = await p5_queue.get()
            if isinstance(item, _StreamDoneSentinel):
                break
            if isinstance(item, _StreamErrorItem):
                raise item.exception
            yield {"event": item.event, "data": item.data}
    finally:
        # Shield worker so client disconnect cannot abort SQLite transaction mid-commit
        if not worker_task.done():
            await asyncio.shield(worker_task)


_RELAY_ERROR_MESSAGES = {
    "webgpu_unsupported": "WebGPU is not supported or enabled in this browser. Switch to Local Ollama or a cloud provider in Profile > Models.",
    "cors_or_network_error": "Could not connect to local Ollama from your browser. Verify Ollama is running with OLLAMA_ORIGINS configured and Local Network Access allowed.",
    "model_not_found": "The selected local model is not installed in Ollama. Pull the model or select an installed one in Profile > Models.",
    "inference_failed": "Local browser model execution failed. Check browser GPU memory or Ollama logs.",
}


@router.post("/api/campaigns/{campaign_id}/turns/stream")
async def stream_campaign_turn(
    campaign_id: str,
    req: TurnSubmitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> StreamingResponse:
    """SSE endpoint streaming Phase 1, Phase 3 (<cognition> + prose), and Phase 4 updates."""

    async def _sse_generator() -> AsyncIterator[str]:
        try:
            async for packet in _execute_turn_stream_events(
                campaign_id, req, owner_id=current_user.id
            ):
                ev_name = packet["event"]
                payload = json.dumps(packet["data"])
                yield f"event: {ev_name}\ndata: {payload}\n\n"
        except RelayUnavailableError:
            logger.warning("Turn stream relay offline for campaign '%s'", sanitize_log_value(campaign_id))
            err_payload = json.dumps(
                {
                    "error": (
                        "Browser inference relay is not connected. Keep this browser tab open "
                        "and check your Local Ollama or WebGPU provider in Profile."
                    )
                }
            )
            yield f"event: error\ndata: {err_payload}\n\n"
        except RelayRemoteError as exc:
            logger.warning(
                "Turn stream browser driver error (%s) for campaign '%s'",
                sanitize_log_value(exc.code),
                sanitize_log_value(campaign_id),
            )
            msg = _RELAY_ERROR_MESSAGES.get(exc.code, _RELAY_ERROR_MESSAGES["inference_failed"])
            err_payload = json.dumps({"error": msg})
            yield f"event: error\ndata: {err_payload}\n\n"
        except KeyError as exc:
            logger.warning(
                "Turn stream target missing for campaign '%s': %s",
                sanitize_log_value(campaign_id),
                sanitize_log_value(exc),
            )
            err_payload = json.dumps({"error": "Campaign or required entity not found."})
            yield f"event: error\ndata: {err_payload}\n\n"
        except ValueError as exc:
            logger.warning(
                "Turn stream validation failed for campaign '%s': %s",
                sanitize_log_value(campaign_id),
                sanitize_log_value(exc),
            )
            err_payload = json.dumps({"error": "Invalid turn request."})
            yield f"event: error\ndata: {err_payload}\n\n"
        except Exception:
            logger.exception("Turn stream failed for campaign '%s'", sanitize_log_value(campaign_id))
            err_payload = json.dumps({"error": "An internal error occurred while streaming the turn."})
            yield f"event: error\ndata: {err_payload}\n\n"

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/campaigns/{campaign_id}/turns", response_model=CampaignStateBundle)
async def submit_campaign_turn_sync(
    campaign_id: str,
    req: TurnSubmitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Execute all 4 phases synchronously and return the updated CampaignStateBundle."""
    try:
        final_bundle: dict[str, Any] | None = None
        async for packet in _execute_turn_stream_events(
            campaign_id, req, owner_id=current_user.id
        ):
            if packet["event"] in ("phase5_complete", "phase4_complete"):
                final_bundle = packet["data"]["state_bundle"]
        if final_bundle is not None:
            return CampaignStateBundle.model_validate(final_bundle)
        return _resolve_facade_attr("get_repo", get_repo)().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
