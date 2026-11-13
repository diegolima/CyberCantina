"""Campaign CRUD, branching, character membership, inventory equip, and turn deletion endpoints."""

from __future__ import annotations

import asyncio

from app.auth import get_current_user
from app.db.repository import UNSET
from app.dependencies import (
    get_effective_user_model_settings,
    get_repo,
    run_entity_pruner,
)
from app.engine.clerk_placement import generate_clerk_starting_placement
from app.prompts.defaults import PROMPT_KEY_CLERK_WORLD_START_PLACEMENT
from app.schemas.auth import UserProfile
from app.schemas.character import CharacterRecord
from app.schemas.persona import PersonaTurnStateSnapshot
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignRecord,
    CampaignStateBundle,
)
from fastapi import (
    BackgroundTasks,
    Depends,
    HTTPException,
)
from app.routers.campaign_routes.schemas_and_gate import _resolve_facade_attr

from app.routers.campaign_routes.schemas_and_gate import (
    BranchCheckoutRequest,
    CampaignAddCharacterRequest,
    CampaignCreateRequest,
    ItemEquipToggleRequest,
    LocationOverrideRequest,
    campaign_turn_gate,
    router,
)

@router.get("/api/campaigns", response_model=list[CampaignRecord])
def list_campaigns(
    current_user: UserProfile = Depends(get_current_user),
) -> list[CampaignRecord]:
    return _resolve_facade_attr("get_repo", get_repo)().list_campaigns(owner_id=current_user.id)


@router.post("/api/campaigns", response_model=CampaignStateBundle)
async def create_campaign(
    req: CampaignCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    repo = _resolve_facade_attr("get_repo", get_repo)()

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
            staging_text = await _resolve_facade_attr("generate_clerk_starting_placement", generate_clerk_starting_placement)(
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
    repo = _resolve_facade_attr("get_repo", get_repo)()
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
    repo = _resolve_facade_attr("get_repo", get_repo)()
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
    repo = _resolve_facade_attr("get_repo", get_repo)()
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
        return _resolve_facade_attr("get_repo", get_repo)().get_campaign_state_bundle(
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
                _resolve_facade_attr("get_repo", get_repo)().checkout_turn_branch,
                campaign_id,
                req.turn_id,
                owner_id=current_user.id,
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/campaigns/{campaign_id}/location-override", response_model=CampaignStateBundle)
def override_campaign_location(
    campaign_id: str,
    req: LocationOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override the current active location on the leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().override_campaign_location(
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
        return _resolve_facade_attr("get_repo", get_repo)().toggle_campaign_item_equip(
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
    repo = _resolve_facade_attr("get_repo", get_repo)()
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
                _resolve_facade_attr("get_repo", get_repo)().delete_last_turn,
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
                _resolve_facade_attr("get_repo", get_repo)().delete_last_turn,
                campaign_id,
                turn_id=turn_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
