"""Campaign linked-location, edge distance, map layout, and lore endpoints."""

from __future__ import annotations

from app.auth import get_current_user
from app.dependencies import get_repo
from app.schemas.auth import UserProfile
from app.schemas.turn import (
    CampaignMapUpdatePayload,
    CampaignStateBundle,
)
from app.schemas.world import (
    CampaignContainerLoreUpdatePayload,
    CampaignLocationLoreUpdatePayload,
    CampaignLocationPropsUpdatePayload,
)
from fastapi import (
    Depends,
    HTTPException,
)
from app.routers.campaign_routes.schemas_and_gate import _resolve_facade_attr

from app.routers.campaign_routes.schemas_and_gate import (
    CampaignEdgeCreateRequest,
    CampaignEdgeDistanceUpdateRequest,
    CampaignEdgeRevealRequest,
    CampaignLoreRevealRequest,
    CampaignMajorEventUpdateRequest,
    CampaignPropRevealRequest,
    CampaignPropTransferRequest,
    CampaignWorldLoreEntryUpsertRequest,
    CampaignWorldLoreEntryUpsertResponse,
    CampaignWorldLoreUpdateRequest,
    LinkedLocationCreateRequest,
    router,
)

@router.post("/api/campaigns/{campaign_id}/locations", response_model=CampaignStateBundle)
def create_campaign_linked_location(
    campaign_id: str,
    req: LinkedLocationCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually create a new location linked to an existing one (bound to the active timeline)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().create_linked_location(
            campaign_id,
            from_location_id=req.from_location_id,
            name=req.name,
            description=req.description,
            environmental_tags=req.environmental_tags,
            compass_direction=req.compass_direction,
            distance_meters=req.distance_meters,
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
        return _resolve_facade_attr("get_repo", get_repo)().connect_campaign_locations(
            campaign_id,
            from_location_id=req.from_location_id,
            to_location_id=req.to_location_id,
            direction_label=req.direction_label,
            compass_direction=req.compass_direction,
            distance_meters=req.distance_meters,
            bidirectional=req.bidirectional,
            speed_modifier=req.speed_modifier,
            travel_mode=req.travel_mode,
            obstacles=req.obstacles,
            is_blocked=req.is_blocked,
            is_secret=req.is_secret,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
    """Update link properties of an existing edge on the active timeline."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().update_campaign_edge(
            campaign_id,
            edge_id=edge_id,
            distance_meters=req.distance_meters,
            speed_modifier=req.speed_modifier,
            travel_mode=req.travel_mode,
            travel_mode_provided="travel_mode" in req.model_fields_set,
            obstacles=req.obstacles,
            is_blocked=req.is_blocked,
            is_secret=req.is_secret,
            direction_label=req.direction_label,
            reciprocal_direction_label=req.reciprocal_direction_label,
            update_reciprocal=req.update_reciprocal,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/campaigns/{campaign_id}/edges/{edge_id}/reveal",
    response_model=CampaignStateBundle,
)
def toggle_campaign_edge_reveal(
    campaign_id: str,
    edge_id: str,
    req: CampaignEdgeRevealRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually reveal or hide a secret link pair on the active branch (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().toggle_campaign_edge_reveal(
            campaign_id,
            edge_id,
            revealed=req.revealed,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
        return _resolve_facade_attr("get_repo", get_repo)().remove_campaign_edge(
            campaign_id,
            edge_id=edge_id,
            remove_reciprocal=remove_reciprocal,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/api/campaigns/{campaign_id}/map", response_model=CampaignStateBundle)
def update_campaign_map(
    campaign_id: str,
    req: CampaignMapUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Atomically save staged map changes on the active campaign branch with safety validation."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().update_campaign_map(
            campaign_id,
            req,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put(
    "/api/campaigns/{campaign_id}/lore",
    response_model=CampaignStateBundle,
)
async def update_campaign_world_lore(
    campaign_id: str,
    req: CampaignWorldLoreUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update branch-safe campaign-scoped Copy-on-Write World Codex lore entries (requires GM Mode)."""
    try:
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_world_lore(
            campaign_id,
            req.lore_nodes,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/campaigns/{campaign_id}/lore/entries",
    response_model=CampaignWorldLoreEntryUpsertResponse,
)
async def upsert_campaign_world_lore_entry(
    campaign_id: str,
    req: CampaignWorldLoreEntryUpsertRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignWorldLoreEntryUpsertResponse:
    """Append a new campaign World Codex entry or update an existing one (base-world overwrite requires GM Mode)."""
    repo = _resolve_facade_attr("get_repo", get_repo)()
    try:
        bundle, saved_lore_id = await repo.aupsert_campaign_world_lore_entry(
            campaign_id,
            req.draft,
            replace_lore_id=req.replace_lore_id,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    updated_proposal = None
    if req.proposal_id:
        updated_proposal = repo.update_gm_proposal_status(
            campaign_id,
            req.proposal_id,
            "confirmed",
            saved_lore_id=saved_lore_id,
            replace_lore_id=req.replace_lore_id,
            final_draft=req.draft,
        )

    return CampaignWorldLoreEntryUpsertResponse(
        bundle=bundle,
        saved_lore_id=saved_lore_id,
        proposal=updated_proposal,
    )


@router.post(
    "/api/campaigns/{campaign_id}/lore/{lore_id}/reveal",
    response_model=CampaignStateBundle,
)
def toggle_campaign_lore_reveal(
    campaign_id: str,
    lore_id: str,
    req: CampaignLoreRevealRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually mark a location or container secret lore entry revealed or hidden on the active branch (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().toggle_campaign_lore_reveal(
            campaign_id,
            lore_id,
            revealed=req.revealed,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch(
    "/api/campaigns/{campaign_id}/major-events/{turn_id}",
    response_model=CampaignStateBundle,
)
async def update_campaign_major_event(
    campaign_id: str,
    turn_id: str,
    req: CampaignMajorEventUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Edit a World or Location Major Event directly from the Story Major Events tab (requires GM Mode)."""
    try:
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_major_event(
            campaign_id,
            turn_id,
            title=req.title,
            summary=req.summary,
            keywords=req.keywords,
            updated_description=req.updated_description,
            environmental_tags=req.environmental_tags,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    "/api/campaigns/{campaign_id}/major-events/{turn_id}",
    response_model=CampaignStateBundle,
)
def delete_campaign_major_event(
    campaign_id: str,
    turn_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete a World Major Event or delete & revert a Location Major Event (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().delete_campaign_major_event(
            campaign_id,
            turn_id,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
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
    """Update campaign-scoped Copy-on-Write lore entries for a visible location (requires GM Mode)."""
    try:
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_location_lore(
            campaign_id,
            location_id,
            req.lore_nodes,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put(
    "/api/campaigns/{campaign_id}/containers/{container_id}/lore",
    response_model=CampaignStateBundle,
)
async def update_campaign_container_lore(
    campaign_id: str,
    container_id: str,
    req: CampaignContainerLoreUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update campaign-scoped Copy-on-Write lore entries for a Level 1 container (requires GM Mode)."""
    try:
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_container_lore(
            campaign_id,
            container_id,
            req.lore_nodes,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put(
    "/api/campaigns/{campaign_id}/locations/{location_id}/props",
    response_model=CampaignStateBundle,
)
def update_campaign_location_props(
    campaign_id: str,
    location_id: str,
    req: CampaignLocationPropsUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Replace portable props for a Level 0 location on the active campaign branch (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().update_campaign_location_props(
            campaign_id,
            location_id,
            req.props,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/campaigns/{campaign_id}/props/{prop_id}/reveal",
    response_model=CampaignStateBundle,
)
def toggle_campaign_prop_reveal(
    campaign_id: str,
    prop_id: str,
    req: CampaignPropRevealRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually reveal or hide a tracked location prop on the active branch (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().toggle_campaign_prop_reveal(
            campaign_id,
            prop_id,
            revealed=req.revealed,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/campaigns/{campaign_id}/props/{prop_id}/transfer",
    response_model=CampaignStateBundle,
)
def transfer_campaign_prop(
    campaign_id: str,
    prop_id: str,
    req: CampaignPropTransferRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually transfer an unclaimed location prop to Player or NPC inventory (requires GM Mode)."""
    try:
        return _resolve_facade_attr("get_repo", get_repo)().transfer_campaign_prop(
            campaign_id,
            prop_id,
            holder_id=req.holder_id,
            owner_id=current_user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
