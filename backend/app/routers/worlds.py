"""Worlds and world creation wizard router."""

from __future__ import annotations

import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.dependencies import get_effective_user_model_settings, get_repo, run_entity_pruner
from app.schemas.auth import UserProfile
from app.schemas.world import (
    WorldMapDraft,
    WorldMapReimagineRequest,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
    WorldWizardSeed,
)
from app.wizards.world_wizard import generate_world_draft, reimagine_world_map

logger = logging.getLogger("cybercantina.routers.worlds")
router = APIRouter(tags=["worlds"])


@router.get("/api/worlds", response_model=list[WorldRecord])
def list_worlds(
    current_user: UserProfile = Depends(get_current_user),
) -> list[WorldRecord]:
    return get_repo().list_worlds(owner_id=current_user.id)


@router.get("/api/worlds/{world_id}", response_model=WorldRecord)
def get_world(
    world_id: str,
    base_only: bool = True,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    try:
        return get_repo().get_world(world_id, base_only=base_only, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/api/wizards/world/draft", response_model=WorldWizardDraft)
async def wizard_draft_world(
    seed: WorldWizardSeed,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldWizardDraft:
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    effective_prompts = get_repo().resolve_effective_prompts(user_id=current_user.id)
    try:
        return await generate_world_draft(
            seed,
            profile=eff_actor,
            prompt_template=effective_prompts.get("wizard_world_system"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/wizards/world/reimagine-map", response_model=WorldMapDraft)
async def wizard_reimagine_map(
    req: WorldMapReimagineRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldMapDraft:
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    effective_prompts = get_repo().resolve_effective_prompts(user_id=current_user.id)
    try:
        return await reimagine_world_map(
            req,
            profile=eff_actor,
            prompt_template=effective_prompts.get("wizard_map_reimagine_system"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/wizards/world/commit", response_model=WorldRecord)
async def wizard_commit_world(
    draft: WorldWizardDraft,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    return await get_repo().acreate_world_from_draft(draft, owner_id=current_user.id)


@router.put("/api/worlds/{world_id}", response_model=WorldRecord)
async def update_world(
    world_id: str,
    payload: WorldUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Update a world in-place if unused, or silently fork a new version if used by campaigns."""
    try:
        return await get_repo().aupdate_world(
            world_id, payload, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/api/worlds/{world_id}")
def delete_world(
    world_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, int | str | bool]:
    """Mark a world as pending deletion (hiding it from the UI) and trigger background pruning."""
    repo = get_repo()
    try:
        result = repo.mark_world_pending_deletion(world_id, owner_id=current_user.id)
        background_tasks.add_task(run_entity_pruner)
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
