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
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import settings
from app.db.repository import UNSET
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_persona_disclosure_mode,
    get_effective_user_model_settings,
    get_repo,
    run_entity_pruner,
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
    resolve_character_previous_state,
    resolve_phase2_turn_context,
    was_character_present_on_turn,
)
from app.engine.phase3_actor import generate_clerk_cognition, stream_phase3_actor
from app.engine.phase3_cognition import run_phase3_multi_cognition
from app.engine.phase4_prose import stream_phase4_prose
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.engine.phase4_clerk import run_phase4_post_turn_clerk
from app.engine.clerk_placement import generate_clerk_starting_placement
from app.prompts.defaults import PROMPT_KEY_CLERK_WORLD_START_PLACEMENT
from app.schemas.auth import UserProfile
from app.schemas.persona import PersonaRecord, PersonaTurnStateSnapshot
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    ItemFlag,
    MemoryShard,
    format_item_names,
)
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignRecord,
    CampaignStateBundle,
    MechanicsTrigger,
    Phase3ProgressEvent,
    Phase4ProgressEvent,
    Phase5ProgressEvent,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.schemas.world import CampaignLocationLoreUpdatePayload

logger = logging.getLogger("cybercantina.routers.campaigns")
router = APIRouter(tags=["campaigns"])


class CampaignCreateRequest(BaseModel):
    name: str
    world_id: str
    character_id: str | None = None
    persona_id: str | None = None
    character_ids: list[str] = Field(default_factory=list)
    character_locations: dict[str, str] | None = None
    opening_prose: str | None = None
    start_focus: Literal["world", "character"] = "character"
    focus_character_id: str | None = None


class CampaignAddCharacterRequest(BaseModel):
    character_id: str
    location_id: str | None = None


class BranchCheckoutRequest(BaseModel):
    turn_id: str


class LocationOverrideRequest(BaseModel):
    location_id: str


class ItemEquipToggleRequest(BaseModel):
    item: str = ""
    item_id: str | None = None
    action: Literal["equip", "unequip", "remove", "add", "update"]
    target: Literal["equipped", "inventory"] | None = None
    character_id: str | None = None
    new_name: str | None = None
    note: str | None = None
    flags: list[ItemFlag] | None = None
    lore_id: str | None = None


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
async def create_campaign(
    req: CampaignCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    repo = get_repo()

    primary_char_id = req.focus_character_id or req.character_id or (req.character_ids[0] if req.character_ids else None)
    if not primary_char_id:
        raise HTTPException(status_code=400, detail="At least one character must be selected for the campaign.")

    all_char_ids = list(req.character_ids or [])
    if primary_char_id not in all_char_ids:
        all_char_ids.insert(0, primary_char_id)

    try:
        world = repo.get_world(req.world_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"World not found: {exc}") from exc

    start_loc = next(
        (loc for loc in world.locations if loc.is_starting_location),
        world.locations[0] if world.locations else None,
    )
    if not start_loc:
        raise HTTPException(status_code=400, detail="The selected world has no locations.")

    loc_map = req.character_locations or {}
    opening_prose = req.opening_prose
    actor_id: str | None = None

    if req.start_focus == "world":
        actor_id = "__narrator__"
        world_starting_msg = (start_loc.starting_message or "").strip()
        if not world_starting_msg:
            world_starting_msg = f"*{start_loc.name} serves as the starting threshold. {start_loc.description}*"

        present_char_ids = [
            cid for cid in all_char_ids
            if loc_map.get(cid, start_loc.id) == start_loc.id
        ]
        present_npcs: list[CharacterRecord] = []
        for cid in present_char_ids:
            try:
                present_npcs.append(repo.get_character(cid, owner_id=current_user.id))
            except KeyError:
                continue

        if present_npcs:
            eff_actor, eff_clerk, _, _, _ = get_effective_user_model_settings(current_user.id)
            effective_prompts = repo.resolve_effective_prompts(user_id=current_user.id)
            prompt_tpl = effective_prompts.get(PROMPT_KEY_CLERK_WORLD_START_PLACEMENT)
            staging_text = await generate_clerk_starting_placement(
                world=world,
                location=start_loc,
                participant_characters=present_npcs,
                profile=eff_clerk,
                prompt_template=prompt_tpl,
                timeout_seconds=10.0,
            )
            opening_prose = f"{world_starting_msg}{staging_text}".strip()
        else:
            opening_prose = world_starting_msg
    else:
        actor_id = primary_char_id

    try:
        camp = repo.create_campaign(
            name=req.name,
            world_id=req.world_id,
            character_id=primary_char_id,
            character_ids=all_char_ids,
            character_locations=req.character_locations,
            opening_prose=opening_prose,
            persona_id=req.persona_id,
            owner_id=current_user.id,
            actor_id=actor_id,
            skip_turn_0_cognition=True,
        )
        return repo.get_campaign_state_bundle(camp.id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.get("/api/campaigns/{campaign_id}/persona-state", response_model=PersonaTurnStateSnapshot | None)
def get_campaign_player_turn_state(
    campaign_id: str,
    turn_id: str | None = None,
    current_user: UserProfile = Depends(get_current_user),
) -> PersonaTurnStateSnapshot | None:
    """Retrieve player dynamic inventory & equipment for the campaign's active (or target) turn."""
    repo = get_repo()
    camp = repo.get_campaign(campaign_id, owner_id=current_user.id)
    target_turn_id = turn_id or camp.active_leaf_turn_id
    if not target_turn_id:
        return None
    return repo.get_campaign_persona_turn_state(target_turn_id)


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
async def checkout_campaign_branch(
    campaign_id: str,
    req: BranchCheckoutRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                get_repo().checkout_turn_branch,
                campaign_id,
                req.turn_id,
                owner_id=current_user.id,
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


@router.put(
    "/api/campaigns/{campaign_id}/locations/{location_id}/lore",
    response_model=CampaignStateBundle,
)
async def update_campaign_location_lore(
    campaign_id: str,
    location_id: str,
    req: CampaignLocationLoreUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update campaign-scoped Copy-on-Write lore entries for a visible location."""
    try:
        return await get_repo().aupdate_campaign_location_lore(
            campaign_id,
            location_id,
            req.lore_nodes,
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
    """Equip, unequip, remove, add, or update an item for a character on the active leaf turn (applies next turn)."""
    fields_set = req.model_fields_set
    try:
        return get_repo().toggle_campaign_item_equip(
            campaign_id,
            item=req.item,
            item_id=req.item_id,
            action=req.action,
            target=req.target,
            character_id=req.character_id,
            new_name=req.new_name if "new_name" in fields_set else UNSET,
            note=req.note if "note" in fields_set else UNSET,
            flags=req.flags if "flags" in fields_set else UNSET,
            lore_id=req.lore_id if "lore_id" in fields_set else UNSET,
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
async def delete_campaign_last_turn(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the last user message turn on the active branch, including all generated swipes."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                get_repo().delete_last_turn,
                campaign_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/campaigns/{campaign_id}/turns/{turn_id}", response_model=CampaignStateBundle)
async def delete_campaign_turn(
    campaign_id: str,
    turn_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the specified last user message turn (and its sibling swipes) from the campaign."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                get_repo().delete_last_turn,
                campaign_id,
                turn_id=turn_id,
                owner_id=current_user.id,
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


_PhaseQueueItem = _StreamPacketItem | _StreamErrorItem | _StreamDoneSentinel
_Phase4QueueItem = _PhaseQueueItem
_Phase5QueueItem = _PhaseQueueItem


class CampaignTurnGate:
    """Keyed per-campaign asyncio.Lock registry serializing turn streams, swipes, and deletes."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}

    def lock_for(self, campaign_id: str) -> asyncio.Lock:
        lock = self._locks.get(campaign_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[campaign_id] = lock
        return lock


campaign_turn_gate = CampaignTurnGate()


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
    repo = get_repo()
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

    known_entities: list[str] = []
    seen_known_lower: set[str] = set()
    for ent in raw_known_entities:
        cleaned_ent = ent.strip()
        if cleaned_ent and cleaned_ent.lower() not in seen_known_lower:
            seen_known_lower.add(cleaned_ent.lower())
            known_entities.append(cleaned_ent)

    eff_actor, eff_clerk, eff_wm_turns, eff_delegate_cognition, eff_max_flags = get_effective_user_model_settings(owner_id)
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
                m = re.search(r"(\d+)\s*minutes?", lower_msg)
                if m:
                    req.duration_minutes = int(m.group(1))
        elif lower_msg.startswith("[introduce a complication") or lower_msg.startswith("[introduce an unexpected complication"):
            req.narrative_mode = "complication"
            dir_match = re.search(r"^\[introduce a complication:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
        elif lower_msg.startswith("[perception check") or lower_msg.startswith("[examine the scene"):
            # Backwards-compatibility for historical swipes/edits: normalize legacy perception cues into custom directive
            req.narrative_mode = "custom"
            dir_match = re.search(r"^\[perception check:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
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
        pre_turn = await run_phase1_pre_analysis(
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
            cogs = await run_phase3_multi_cognition(
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
        established_cognitions=established_cognitions,
        persona_snapshot=persona_snapshot,
        current_player_state=current_player_state,
        decomposed_message=decomposed_msg,
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

    async for item in stream_phase4_prose(
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
            updated_turn, _chunks = await run_phase5_post_turn_clerk(
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
            if packet["event"] in ("phase5_complete", "phase4_complete"):
                final_bundle = packet["data"]["state_bundle"]
        if final_bundle is not None:
            return CampaignStateBundle.model_validate(final_bundle)
        return get_repo().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
