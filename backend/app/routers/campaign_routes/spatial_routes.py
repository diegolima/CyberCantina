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
)
from fastapi import (
    Depends,
    HTTPException,
)
from app.routers.campaign_routes.schemas_and_gate import _resolve_facade_attr

from app.routers.campaign_routes.schemas_and_gate import (
    CampaignEdgeCreateRequest,
    CampaignEdgeDistanceUpdateRequest,
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
        return _resolve_facade_attr("get_repo", get_repo)().connect_campaign_locations(
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
        return _resolve_facade_attr("get_repo", get_repo)().update_campaign_edge_distance(
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
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_location_lore(
            campaign_id,
            location_id,
            req.lore_nodes,
            owner_id=current_user.id,
        )
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
    """Update campaign-scoped Copy-on-Write lore entries for a Level 1 container."""
    try:
        return await _resolve_facade_attr("get_repo", get_repo)().aupdate_campaign_container_lore(
            campaign_id,
            container_id,
            req.lore_nodes,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
