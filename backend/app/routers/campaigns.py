"""Campaigns, branching timelines, spatial edges, and 4-phase turn execution router."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import get_current_user
from app.config import settings
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_user_model_settings,
    get_repo,
    run_entity_pruner,
)
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import (
    assemble_four_zone_messages,
    resolve_character_previous_state,
    was_character_present_on_turn,
)
from app.engine.phase3_actor import generate_clerk_cognition, stream_phase3_actor
from app.engine.phase4_clerk import run_phase4_post_turn_clerk
from app.schemas.auth import UserProfile
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    MemoryShard,
)
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignRecord,
    CampaignStateBundle,
    MechanicsTrigger,
    Phase4ProgressEvent,
    PreTurnAnalysis,
    TurnSubmitRequest,
    WorldStateSnapshot,
)

logger = logging.getLogger("cybercantina.routers.campaigns")
router = APIRouter(tags=["campaigns"])


class CampaignCreateRequest(BaseModel):
    name: str
    world_id: str
    character_id: str
    character_ids: list[str] | None = None
    character_locations: dict[str, str] | None = None
    opening_prose: str | None = None


class CampaignAddCharacterRequest(BaseModel):
    character_id: str
    location_id: str | None = None


class BranchCheckoutRequest(BaseModel):
    turn_id: str


class LocationOverrideRequest(BaseModel):
    location_id: str


class ItemEquipToggleRequest(BaseModel):
    item: str
    action: Literal["equip", "unequip", "remove", "add"]
    target: Literal["equipped", "inventory"] | None = None
    character_id: str | None = None


class LinkedLocationCreateRequest(BaseModel):
    from_location_id: str
    name: str
    compass_direction: str
    travel_minutes: int = 2
    description: str
    environmental_tags: list[str] = []


class CampaignEdgeCreateRequest(BaseModel):
    from_location_id: str
    to_location_id: str
    direction_label: str | None = None
    compass_direction: str = "N"
    travel_minutes: int = 1
    bidirectional: bool = True


class CampaignEdgeDistanceUpdateRequest(BaseModel):
    travel_minutes: int
    update_reciprocal: bool = True


@router.get("/api/campaigns", response_model=list[CampaignRecord])
def list_campaigns(
    current_user: UserProfile = Depends(get_current_user),
) -> list[CampaignRecord]:
    return get_repo().list_campaigns(owner_id=current_user.id)


@router.post("/api/campaigns", response_model=CampaignStateBundle)
def create_campaign(
    req: CampaignCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    repo = get_repo()
    try:
        camp = repo.create_campaign(
            name=req.name,
            world_id=req.world_id,
            character_id=req.character_id,
            character_ids=req.character_ids,
            character_locations=req.character_locations,
            opening_prose=req.opening_prose,
            owner_id=current_user.id,
        )
        return repo.get_campaign_state_bundle(camp.id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/characters", response_model=CampaignStateBundle)
def add_campaign_character(
    campaign_id: str,
    req: CampaignAddCharacterRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Add an additional character to a campaign (optionally stationed at a specific location_id)."""
    repo = get_repo()
    try:
        return repo.add_character_to_campaign(
            campaign_id=campaign_id,
            character_id=req.character_id,
            location_id=req.location_id,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/api/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str]:
    """Delete a campaign and its entire timeline, then prune any unreferenced pending_deletion characters and worlds."""
    repo = get_repo()
    try:
        repo.delete_campaign(campaign_id, owner_id=current_user.id)
        background_tasks.add_task(run_entity_pruner)
        return {"status": "deleted", "campaign_id": campaign_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/campaigns/{campaign_id}/state", response_model=CampaignStateBundle)
def get_campaign_state(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    try:
        return get_repo().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/checkout", response_model=CampaignStateBundle)
def checkout_campaign_branch(
    campaign_id: str,
    req: BranchCheckoutRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    try:
        return get_repo().checkout_turn_branch(
            campaign_id, req.turn_id, owner_id=current_user.id
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/locations", response_model=CampaignStateBundle)
def create_campaign_linked_location(
    campaign_id: str,
    req: LinkedLocationCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually create a new location linked to an existing one (bound to the active timeline)."""
    try:
        return get_repo().create_linked_location(
            campaign_id,
            from_location_id=req.from_location_id,
            name=req.name,
            description=req.description,
            environmental_tags=req.environmental_tags,
            compass_direction=req.compass_direction,
            travel_minutes=req.travel_minutes,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/edges", response_model=CampaignStateBundle)
def connect_campaign_locations(
    campaign_id: str,
    req: CampaignEdgeCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Connect two existing map locations on the campaign's active timeline."""
    try:
        return get_repo().connect_campaign_locations(
            campaign_id,
            from_location_id=req.from_location_id,
            to_location_id=req.to_location_id,
            direction_label=req.direction_label,
            compass_direction=req.compass_direction,
            travel_minutes=req.travel_minutes,
            bidirectional=req.bidirectional,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/api/campaigns/{campaign_id}/edges/{edge_id}", response_model=CampaignStateBundle)
def update_campaign_edge_distance(
    campaign_id: str,
    edge_id: str,
    req: CampaignEdgeDistanceUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update distance (travel_minutes) of an existing edge on the active timeline."""
    try:
        return get_repo().update_campaign_edge_distance(
            campaign_id,
            edge_id=edge_id,
            travel_minutes=req.travel_minutes,
            update_reciprocal=req.update_reciprocal,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/campaigns/{campaign_id}/edges/{edge_id}", response_model=CampaignStateBundle)
def remove_campaign_edge(
    campaign_id: str,
    edge_id: str,
    remove_reciprocal: bool = True,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Remove a link on the active timeline, ensuring each location retains at least one connection."""
    try:
        return get_repo().remove_campaign_edge(
            campaign_id,
            edge_id=edge_id,
            remove_reciprocal=remove_reciprocal,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/location-override", response_model=CampaignStateBundle)
def override_campaign_location(
    campaign_id: str,
    req: LocationOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override the current active location on the leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
    try:
        return get_repo().override_campaign_location(
            campaign_id, req.location_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/item-equip", response_model=CampaignStateBundle)
def toggle_campaign_item_equip(
    campaign_id: str,
    req: ItemEquipToggleRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Equip, unequip, remove, or add an item for a character on the active leaf turn (applies next turn)."""
    try:
        return get_repo().toggle_campaign_item_equip(
            campaign_id,
            item=req.item,
            action=req.action,
            target=req.target,
            character_id=req.character_id,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/characters/{character_id}/memories", response_model=CampaignStateBundle)
async def update_campaign_character_memories(
    campaign_id: str,
    character_id: str,
    req: CampaignCharacterMemoriesUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update campaign-scoped memory shards for a character (applies from next turn onwards)."""
    repo = get_repo()
    try:
        campaign = repo.get_campaign(
            campaign_id,
            owner_id=current_user.id,
        )
        participants = campaign.participant_character_ids or [campaign.character_id]
        if character_id != campaign.character_id and character_id not in participants:
            raise HTTPException(
                status_code=400,
                detail=f"Character '{character_id}' is not a participant in campaign '{campaign_id}'.",
            )
        return await repo.aupdate_campaign_character_memories(
            campaign_id,
            character_id,
            memory_shards=req.memory_shards,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/campaigns/{campaign_id}/turns/last", response_model=CampaignStateBundle)
def delete_campaign_last_turn(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the last user message turn on the active branch, including all generated swipes."""
    try:
        return get_repo().delete_last_turn(campaign_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/campaigns/{campaign_id}/turns/{turn_id}", response_model=CampaignStateBundle)
def delete_campaign_turn(
    campaign_id: str,
    turn_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the specified last user message turn (and its sibling swipes) from the campaign."""
    try:
        return get_repo().delete_last_turn(
            campaign_id, turn_id=turn_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


_Phase4QueueItem = _StreamPacketItem | _StreamErrorItem | _StreamDoneSentinel


async def _execute_turn_stream_events(
    campaign_id: str,
    req: TurnSubmitRequest,
    owner_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Orchestrate Phases 1, 2, 3, and 4 for a single turn, yielding structured events."""
    repo = get_repo()
    campaign = repo.get_campaign(campaign_id, owner_id=owner_id)
    parent_id = req.parent_turn_id or campaign.active_leaf_turn_id
    if not parent_id:
        raise RuntimeError(f"Campaign '{campaign_id}' has no parent turn node")

    # Resolve parent branch chain (allows instantaneous swipe/branch from any node!)
    branch_turns = repo.get_branch_turn_chain(parent_id)
    valid_turn_ids = {t.id for t in branch_turns}
    parent_turn = branch_turns[-1]

    world = repo.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
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
        override_loc = repo.get_location(req.override_location_id)
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
            active_location = repo.get_location(parent_active_loc_id)
    else:
        active_location = repo.get_location(parent_active_loc_id)

    neighbors = repo.get_neighbor_locations(
        world.id,
        active_location.id,
        valid_turn_ids=valid_turn_ids,
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

    # Collect known entity tags from lore and present characters' shards for Phase 1
    known_entities: list[str] = [c.name for c in present_characters]
    for lore in world.lore_nodes:
        known_entities.append(lore.title)
        known_entities.extend(lore.entity_tags)
    for c in present_characters:
        for shard in c.memory_shards:
            known_entities.extend(shard.keywords)
    for loc in world.locations:
        known_entities.append(loc.name)

    eff_actor, eff_clerk, eff_wm_turns, eff_delegate_cognition, eff_max_flags = get_effective_user_model_settings(owner_id)
    eff_dispatch_mode = get_effective_agent_dispatch_mode(owner_id)
    effective_prompts = repo.resolve_effective_prompts(user_id=owner_id, campaign_id=campaign.id)

    effective_user_message = req.user_message.strip()

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
                m = re.search(r"(\d+)\s*minutes?", lower_msg)
                if m:
                    req.duration_minutes = int(m.group(1))
        elif lower_msg.startswith("[introduce a complication") or lower_msg.startswith("[introduce an unexpected complication"):
            req.narrative_mode = "complication"
            dir_match = re.search(r"^\[introduce a complication:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
        elif lower_msg.startswith("[perception check") or lower_msg.startswith("[examine the scene"):
            req.narrative_mode = "perception"
            dir_match = re.search(r"^\[perception check:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
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

    is_narrator = req.narrative_mode in ("describe", "advance", "complication", "perception", "custom")
    if not effective_user_message:
        if req.narrative_mode == "describe":
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
        elif req.narrative_mode == "perception":
            effective_user_message = (
                f"[Perception check: {req.narrator_directive}]"
                if req.narrator_directive
                else "[Examine the scene for subtle details and lore]"
            )
        elif req.narrative_mode == "custom":
            effective_user_message = req.narrator_directive or "[Director request]"
        else:
            raise HTTPException(status_code=400, detail="User message cannot be empty")

    # PHASE 1: Auxiliary Pre-Turn Analysis, Multi-Character Speaker Orchestration & RNG Mechanics
    if is_narrator:
        if req.narrative_mode == "complication":
            subtext = "Introduce an unexpected external complication or inciting incident"
            queries = [active_location.name, "hazard", "threat", "complication"] + (
                [req.narrator_directive] if req.narrator_directive else []
            )
        elif req.narrative_mode == "perception":
            subtext = "Analyze subtle perceptual markers, sensory nuances, and historical lore tied to this space"
            queries = [active_location.name, active_location.summary] + (
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

        pre_turn = PreTurnAnalysis(
            user_sentiment="objective, observational",
            subtext_interpretation=subtext,
            mentioned_entities=[active_location.name],
            memory_search_queries=queries,
            spatial_intent="stay",
            active_speaker_id="__narrator__",
            speaker_order=["__narrator__"],
            mechanics_check=MechanicsTrigger(requires_roll=False),
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
        pre_turn = await run_phase1_pre_analysis(
            user_message=effective_user_message,
            character=present_characters[0],
            active_location=active_location,
            neighbors=neighbors,
            known_entities=known_entities,
            manual_dice_override=req.manual_dice_override,
            present_characters=present_characters,
            previous_speaker_id=parent_turn.actor_id,
            profile=eff_clerk,
            prompt_template=effective_prompts.get("clerk_pre_turn_system"),
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

    # Hybrid GraphRAG Memory Retrieval (filtered by valid_turn_ids & character room presence)
    character_present_turn_ids = {
        t.id for t in branch_turns if was_character_present_on_turn(t, character.id)
    }
    recalled_items = await repo.vector_store.search_memories(
        queries=pre_turn.memory_search_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        world_id=world.id,
        character_id=character.id,
        campaign_id=campaign.id,
        valid_branch_turn_ids=valid_turn_ids,
        character_present_turn_ids=character_present_turn_ids,
        top_k=settings.memory_config.rag_top_k,
    )

    yield {
        "event": "phase1_complete",
        "data": {
            "pre_turn": pre_turn.model_dump(),
            "recalled_items": [m.model_dump() for m in recalled_items],
        },
    }

    # Phase 2.5: Optional Clerk-Delegated Character Cognition
    pregenerated_cognition: CognitionBlock | None = None
    if eff_delegate_cognition and not is_narrator:
        pregenerated_cognition = await generate_clerk_cognition(
            user_message=effective_user_message,
            character=character,
            previous_state=prev_char_state,
            active_location=active_location,
            neighbors=neighbors,
            recalled_items=recalled_items,
            pre_turn=pre_turn,
            profile=eff_clerk,
        )

    # PHASE 2: 4-Zone KV-Cache-Preserving Context Assembly
    messages = assemble_four_zone_messages(
        world=world,
        character=character,
        branch_turns=branch_turns,
        episodic_chunks=episodic_chunks,
        active_location=active_location,
        neighbors=neighbors,
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
        established_cognition=pregenerated_cognition,
    )

    # PHASE 3: Guided Single-Pass <cognition> + Narrative Prose Streaming
    final_cognition = (
        CognitionBlock(
            recall=f"Observing {active_location.name}",
            feeling="Objective / Detached",
            valence=0.0,
            arousal=0.0,
            want="Depict environment and world state neutrally",
            plan=req.narrator_directive
            or (
                "Describe scene environment"
                if req.narrative_mode == "describe"
                else (
                    "Depict unexpected complication"
                    if req.narrative_mode == "complication"
                    else (
                        "Detail subtle perceptual clues"
                        if req.narrative_mode == "perception"
                        else "Depict passage of time"
                    )
                )
            ),
        )
        if is_narrator
        else (
            pregenerated_cognition
            if pregenerated_cognition is not None
            else CognitionBlock(
                recall="",
                feeling=prev_char_state.mood_label,
                valence=prev_char_state.valence,
                arousal=prev_char_state.arousal,
                want=prev_char_state.active_want,
                plan=prev_char_state.active_plan,
                skipped=True,
            )
        )
    )
    final_prose = ""

    async for item in stream_phase3_actor(
        messages=messages,
        user_message=effective_user_message,
        character=character,
        previous_state=prev_char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        profile=eff_actor,
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        pregenerated_cognition=pregenerated_cognition,
    ):
        if item["event"] == "actor_finished":
            final_cognition = CognitionBlock.model_validate(item["data"]["cognition"])
            final_prose = item["data"]["raw_prose"]
        else:
            yield item

    # Persist initial Turn Node prior to Phase 4 Clerk
    new_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
    new_depth = parent_turn.depth_index + 1
    initial_world_snapshot = WorldStateSnapshot(
        turn_id=new_turn_id,
        world_timestamp=parent_turn.world_snapshot.world_timestamp,
        active_location_id=active_location.id,
        scene_flags=parent_turn.world_snapshot.scene_flags,
    )
    initial_char_state = CharacterStateSnapshot(
        turn_id=new_turn_id,
        character_id=character.id,
        current_location_id=active_location.id,
        mood_label=prev_char_state.mood_label if is_narrator else (final_cognition.feeling[:80] or prev_char_state.mood_label),
        valence=prev_char_state.valence if is_narrator else final_cognition.valence,
        arousal=prev_char_state.arousal if is_narrator else final_cognition.arousal,
        active_want=prev_char_state.active_want if is_narrator else (final_cognition.want or prev_char_state.active_want),
        active_plan=prev_char_state.active_plan if is_narrator else (final_cognition.plan or prev_char_state.active_plan),
        relationship_notes=prev_char_state.relationship_notes,
        equipped=list(prev_char_state.equipped),
        inventory=list(prev_char_state.inventory),
    )

    saved_turn = repo.save_turn_node(
        turn_id=new_turn_id,
        campaign_id=campaign.id,
        parent_turn_id=parent_turn.id,
        depth_index=new_depth,
        user_message=effective_user_message,
        actor_id=actor_id,
        raw_prose=final_prose,
        cognition=final_cognition,
        pre_turn=pre_turn,
        world_snapshot=initial_world_snapshot,
        character_state=initial_char_state,
        recalled_items=recalled_items,
    )

    yield {"event": "turn_saved", "data": saved_turn.model_dump()}

    # PHASE 4: Post-Turn Global Clerk + Per-Character State Agents & Arbitration
    p4_queue: asyncio.Queue[_Phase4QueueItem] = asyncio.Queue()

    async def _progress_cb(ev: Phase4ProgressEvent) -> None:
        await p4_queue.put(_StreamPacketItem(event=ev.event, data=ev.model_dump()))

    async def _run_phase4_worker() -> None:
        try:
            updated_turn, _chunks = await run_phase4_post_turn_clerk(
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
                on_progress=_progress_cb,
            )
            bundle = repo.get_campaign_state_bundle(campaign.id)
            await p4_queue.put(
                _StreamPacketItem(
                    event="phase4_complete",
                    data={
                        "turn": updated_turn.model_dump(),
                        "state_bundle": bundle.model_dump(),
                    },
                )
            )
        except BaseException as exc:
            await p4_queue.put(_StreamErrorItem(exception=exc))
        finally:
            await p4_queue.put(_StreamDoneSentinel())

    worker_task = asyncio.create_task(_run_phase4_worker())
    try:
        while True:
            item = await p4_queue.get()
            if isinstance(item, _StreamDoneSentinel):
                break
            if isinstance(item, _StreamErrorItem):
                raise item.exception
            yield {"event": item.event, "data": item.data}
    finally:
        # Shield worker so client disconnect cannot abort SQLite transaction mid-commit
        if not worker_task.done():
            await asyncio.shield(worker_task)


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
        except Exception as exc:
            logger.error("Turn stream failed for campaign '%s': %s", campaign_id, exc)
            err_payload = json.dumps({"error": str(exc)})
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
            if packet["event"] == "phase4_complete":
                final_bundle = packet["data"]["state_bundle"]
        if final_bundle is not None:
            return CampaignStateBundle.model_validate(final_bundle)
        return get_repo().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
