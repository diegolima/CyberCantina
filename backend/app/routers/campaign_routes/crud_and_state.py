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
from app.engine.phase5_clerk import summarize_turn_for_bookmark
from app.prompts.defaults import (
    PROMPT_KEY_CLERK_BOOKMARK_SUMMARY,
    PROMPT_KEY_CLERK_WORLD_START_PLACEMENT,
)
from app.schemas.auth import UserProfile
from app.schemas.character import CharacterRecord
from app.schemas.persona import PersonaTurnStateSnapshot
from app.schemas.physical import PhysicalStateOverrideRequest
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignRecord,
    CampaignStateBundle,
    CampaignWorldSettings,
    TurnNodeRecord,
)
from app.security.log_sanitize import sanitize_log_value
from fastapi import (
    BackgroundTasks,
    Depends,
    HTTPException,
)
from app.routers.campaign_routes.schemas_and_gate import (
    BranchCheckoutRequest,
    CampaignAddCharacterRequest,
    CampaignCreateRequest,
    CampaignWorldSettingsPatchRequest,
    CharacterLocationOverrideRequest,
    ItemEquipToggleRequest,
    LocationOverrideRequest,
    PartyCreateRequest,
    TurnBookmarkSummaryResponse,
    TurnBookmarkUpdateRequest,
    _resolve_facade_attr,
    campaign_turn_gate,
    logger,
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
        raise HTTPException(status_code=404, detail="World not found.") from exc
    if world.pending_deletion:
        raise HTTPException(
            status_code=400,
            detail="The selected world is archived or deleted and cannot be used to start a new campaign.",
        )

    start_loc = next(
        (loc for loc in world.locations if loc.is_starting_location),
        world.locations[0] if world.locations else None,
    )
    if not start_loc:
        raise HTTPException(status_code=400, detail="The selected world has no locations.")

    loaded_chars: dict[str, CharacterRecord] = {}
    for cid in all_char_ids:
        try:
            char_rec = repo.get_character(cid, owner_id=current_user.id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Character not found.") from exc
        if char_rec.pending_deletion:
            raise HTTPException(
                status_code=400,
                detail="Archived or deleted characters cannot be used to start a new campaign.",
            )
        loaded_chars[cid] = char_rec

    loc_map = dict(req.character_locations or {})
    start_party_ids = [
        cid for cid in dict.fromkeys(req.start_in_party_character_ids or []) if cid in all_char_ids
    ]
    for pid in start_party_ids:
        loc_map[pid] = loc_map.get(primary_char_id, start_loc.id)

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
        present_npcs = [loaded_chars[cid] for cid in present_char_ids if cid in loaded_chars]

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
                party_character_ids=start_party_ids,
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
            character_locations=loc_map,
            opening_prose=opening_prose,
            persona_id=req.persona_id,
            owner_id=current_user.id,
            actor_id=actor_id,
            start_focus=req.start_focus,
            skip_turn_0_cognition=True,
            start_in_party_character_ids=start_party_ids,
            narrative_voice=req.narrative_voice,
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
        raise HTTPException(status_code=404, detail="Campaign, character, or location not found.") from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Archived or deleted characters cannot be added to a campaign.",
        ) from exc


@router.get("/api/campaigns/{campaign_id}/persona-state", response_model=PersonaTurnStateSnapshot | None)
def get_campaign_player_turn_state(
    campaign_id: str,
    turn_id: str | None = None,
    current_user: UserProfile = Depends(get_current_user),
) -> PersonaTurnStateSnapshot | None:
    """Retrieve player dynamic inventory & equipment for the campaign's active (or target) turn."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        camp = repo.get_campaign(campaign_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Campaign not found.") from exc
    target_turn_id = turn_id or camp.active_leaf_turn_id
    if not target_turn_id:
        return None
    if turn_id and not repo.turn_belongs_to_campaign(camp.id, target_turn_id):
        raise HTTPException(
            status_code=404,
            detail=f"Turn '{target_turn_id}' not found in campaign '{campaign_id}'.",
        )
    return repo.get_campaign_persona_turn_state(target_turn_id, campaign_id=camp.id)


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
async def override_campaign_location(
    campaign_id: str,
    req: LocationOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override the current active location on the leaf turn with party-aware movement semantics."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().override_campaign_location,
                campaign_id,
                req.location_id,
                move_mode=req.move_mode,
                accompanying_character_ids=req.accompanying_character_ids,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign or target location not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid location override parameters.") from exc


@router.post(
    "/api/campaigns/{campaign_id}/characters/{character_id}/location-override",
    response_model=CampaignStateBundle,
)
async def override_campaign_character_location(
    campaign_id: str,
    character_id: str,
    req: CharacterLocationOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Relocate a single campaign NPC in-place on the leaf turn without triggering arrival/visited side effects."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().override_character_location,
                campaign_id,
                character_id,
                req.location_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign, character, or location not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid character location override request.") from exc


@router.post(
    "/api/campaigns/{campaign_id}/characters/{character_id}/physical-state-override",
    response_model=CampaignStateBundle,
)
async def override_campaign_character_physical_state(
    campaign_id: str,
    character_id: str,
    req: PhysicalStateOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override a participant NPC's physical stance and context in-place on the active leaf turn."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().override_character_physical_state,
                campaign_id,
                character_id,
                physical_stance=req.physical_stance,
                physical_context=req.physical_context,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign or character not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid character physical state override request.") from exc


@router.post(
    "/api/campaigns/{campaign_id}/player-physical-state-override",
    response_model=CampaignStateBundle,
)
async def override_campaign_player_physical_state(
    campaign_id: str,
    req: PhysicalStateOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override the player's physical stance and context in-place on the active leaf turn."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().override_player_physical_state,
                campaign_id,
                physical_stance=req.physical_stance,
                physical_context=req.physical_context,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid player physical state override request.") from exc


@router.post("/api/campaigns/{campaign_id}/parties", response_model=CampaignStateBundle)
async def create_campaign_npc_party(
    campaign_id: str,
    req: PartyCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Create a co-located NPC-only party in-place on the active leaf turn."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().create_npc_party,
                campaign_id,
                req.member_ids,
                name=req.name,
                shared_goal=req.shared_goal,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign not found.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid NPC party creation request.") from exc


@router.delete("/api/campaigns/{campaign_id}/parties/{party_id}", response_model=CampaignStateBundle)
async def delete_campaign_party(
    campaign_id: str,
    party_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Instant OOC disband of an NPC-only party (rejects player parties with 422)."""
    async with campaign_turn_gate.lock_for(campaign_id):
        try:
            return await asyncio.to_thread(
                _resolve_facade_attr("get_repo", get_repo)().disband_party,
                campaign_id,
                party_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Campaign or party not found.") from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail="Player parties must be disbanded in-character via /party disband.",
            ) from exc


@router.patch("/api/campaigns/{campaign_id}/world-settings", response_model=CampaignStateBundle)
def update_campaign_world_settings(
    campaign_id: str,
    req: CampaignWorldSettingsPatchRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update campaign-scoped world settings forward-only without modifying base worlds."""
    try:
        repo = _resolve_facade_attr("get_repo", get_repo)()
        existing = repo.get_campaign(campaign_id, owner_id=current_user.id).world_settings
        next_settings = CampaignWorldSettings(
            describe_on_first_visit=(
                req.describe_on_first_visit
                if req.describe_on_first_visit is not None
                else existing.describe_on_first_visit
            ),
            unlock_lore=(
                req.unlock_lore
                if req.unlock_lore is not None
                else existing.unlock_lore
            ),
            auto_spawn_props_on_search_crit=(
                req.auto_spawn_props_on_search_crit
                if req.auto_spawn_props_on_search_crit is not None
                else existing.auto_spawn_props_on_search_crit
            ),
            narrative_voice=existing.narrative_voice,
        )
        return repo.update_campaign_world_settings(
            campaign_id,
            next_settings,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
    """Delete the active leaf turn (and its childless same-prompt swipes) without affecting sibling or descendant branches."""
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
    """Delete the specified leaf turn (and its childless same-prompt swipes) without affecting sibling or descendant branches."""
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


@router.patch(
    "/api/campaigns/{campaign_id}/turns/{turn_id}/bookmark",
    response_model=TurnNodeRecord,
)
def update_campaign_turn_bookmark(
    campaign_id: str,
    turn_id: str,
    req: TurnBookmarkUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> TurnNodeRecord:
    """Toggle bookmark state and/or update a non-context-injected note on an eligible turn."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    fields_set = req.model_fields_set
    try:
        return repo.update_turn_bookmark(
            campaign_id,
            turn_id,
            is_bookmarked=(
                req.is_bookmarked
                if "is_bookmarked" in fields_set and req.is_bookmarked is not None
                else UNSET
            ),
            user_note=req.user_note if "user_note" in fields_set else UNSET,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="Campaign or turn not found."
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/campaigns/{campaign_id}/turns/{turn_id}/bookmark-summary",
    response_model=TurnBookmarkSummaryResponse,
)
async def summarize_campaign_turn_for_bookmark(
    campaign_id: str,
    turn_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> TurnBookmarkSummaryResponse:
    """Use the Clerk model to produce a 1-sentence bookmark summary with parent-turn context."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        campaign = repo.get_campaign(campaign_id, owner_id=current_user.id)
        turn = repo.get_turn_node(turn_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="Campaign or turn not found."
        ) from exc

    if turn.campaign_id != campaign.id:
        raise HTTPException(
            status_code=404, detail="Campaign or turn not found."
        )
    if turn.depth_index == 0:
        raise HTTPException(status_code=400, detail="Turn #0 cannot be bookmarked.")
    if turn.actor_id == "__arrival__":
        raise HTTPException(
            status_code=400, detail="Map-move turns cannot be bookmarked."
        )

    previous_turn: TurnNodeRecord | None = None
    if turn.parent_turn_id:
        try:
            candidate_prev = repo.get_turn_node(turn.parent_turn_id)
            if candidate_prev.campaign_id == campaign.id:
                previous_turn = candidate_prev
        except KeyError:
            previous_turn = None

    participant_ids = list(
        dict.fromkeys(
            [
                campaign.character_id,
                *(campaign.participant_character_ids or []),
                *(
                    [turn.actor_id]
                    if turn.actor_id
                    not in ("__narrator__", "__arrival__", "__solo__")
                    else []
                ),
            ]
        )
    )
    characters: list[CharacterRecord] = []
    character_name_map: dict[str, str] = {}
    for cid in participant_ids:
        try:
            char_rec = repo.get_character(cid, campaign_id=campaign.id)
            characters.append(char_rec)
            character_name_map[cid] = char_rec.name
        except KeyError:
            continue

    location_name: str | None = None
    try:
        location_name = repo.get_location(
            turn.world_snapshot.active_location_id, campaign_id=campaign.id
        ).name
    except KeyError:
        location_name = None

    previous_location_name: str | None = None
    if previous_turn is not None:
        try:
            previous_location_name = repo.get_location(
                previous_turn.world_snapshot.active_location_id,
                campaign_id=campaign.id,
            ).name
        except KeyError:
            previous_location_name = None

    _, eff_clerk, _, _, _ = _resolve_facade_attr(
        "get_effective_user_model_settings", get_effective_user_model_settings
    )(current_user.id)
    effective_prompts = repo.resolve_effective_prompts(
        user_id=current_user.id, campaign_id=campaign.id
    )
    prompt_tpl = effective_prompts.get(PROMPT_KEY_CLERK_BOOKMARK_SUMMARY)

    try:
        summary = await _resolve_facade_attr(
            "summarize_turn_for_bookmark", summarize_turn_for_bookmark
        )(
            turn,
            previous_turn=previous_turn,
            characters=characters,
            character_name_map=character_name_map,
            location_name=location_name,
            previous_location_name=previous_location_name,
            profile=eff_clerk,
            prompt_template=prompt_tpl,
        )
    except Exception as exc:
        logger.exception(
            "Failed to generate Clerk bookmark summary for campaign=%s turn=%s",
            sanitize_log_value(campaign_id),
            sanitize_log_value(turn_id),
        )
        raise HTTPException(
            status_code=502,
            detail="Failed to summarize turn with Clerk model.",
        ) from exc

    return TurnBookmarkSummaryResponse(summary=summary)
