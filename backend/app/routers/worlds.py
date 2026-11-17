"""Worlds and world creation wizard router."""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Literal
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth import get_current_user
from app.dependencies import (
    enforce_quota_and_write_webp,
    get_effective_user_model_settings,
    get_repo,
    render_webp_bytes,
    run_entity_pruner,
    safe_resolve_world_media_path,
)
from app.schemas.auth import UserProfile
from app.schemas.world import (
    WorldMapDraft,
    WorldMapReimagineRequest,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardCommitPayload,
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    draft: WorldWizardCommitPayload,
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class ConvertLocationToContainerRequest(BaseModel):
    container_name: str | None = None
    portal_name: str | None = None
    migrate_lore: bool = True


@router.post(
    "/api/worlds/{world_id}/locations/{location_id}/convert-to-container",
    response_model=WorldRecord,
)
def convert_location_to_container(
    world_id: str,
    location_id: str,
    req: ConvertLocationToContainerRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Wrap an existing Level 0 location inside a new Level 1 container."""
    try:
        return get_repo().convert_location_to_container(
            world_id,
            location_id,
            container_name=req.container_name,
            portal_name=req.portal_name,
            migrate_lore=req.migrate_lore,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    "/api/worlds/{world_id}/containers/{container_id}",
    response_model=WorldRecord,
)
def delete_world_container(
    world_id: str,
    container_id: str,
    reassign_to_container_id: str | None = Query(default=None),
    unparent_children: bool = Query(default=False),
    lore_disposal: Literal["delete", "reassign", "promote_to_world"] = Query(default="delete"),
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Delete a container from a world with explicit child reassignment/unparenting and Level 1 lore disposal."""
    try:
        return get_repo().delete_location_container(
            world_id,
            container_id,
            reassign_to_container_id=reassign_to_container_id,
            unparent_children=unparent_children,
            lore_disposal=lore_disposal,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ------------------------------------------------------------------
# World Media (Images; extensible to Audio)
# ------------------------------------------------------------------


class WorldMediaLabelUpdateRequest(BaseModel):
    label: str = ""


class WorldMediaReorderRequest(BaseModel):
    ordered_media_ids: list[str]


@router.get("/api/media/worlds/{category}/{filename}")
def get_world_media(
    category: str,
    filename: str,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Serve a static world media asset when the user has access."""
    target = safe_resolve_world_media_path(category, filename)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media asset not found.")

    repo = get_repo()
    if not repo.user_can_access_world_media(current_user.id, category, filename):
        raise HTTPException(status_code=404, detail="Media asset not found.")

    media_type = "image/webp" if category == "images" else "application/octet-stream"
    return FileResponse(
        target,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.post("/api/worlds/{world_id}/media", response_model=WorldRecord)
async def upload_world_media(
    world_id: str,
    file: UploadFile = File(...),
    label: str = Form(""),
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Upload a landscape/scene image to a saved world (CoW-forking if campaigns exist)."""
    repo = get_repo()
    try:
        repo.get_world(world_id, base_only=True, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    media_id = f"wmed_{uuid.uuid4().hex[:10]}"
    filename = f"{media_id}.webp"
    target_path = safe_resolve_world_media_path("images", filename)

    webp_bytes = await asyncio.to_thread(
        render_webp_bytes, file_bytes, square_crop=False, max_size=1920
    )
    await asyncio.to_thread(
        enforce_quota_and_write_webp,
        repo,
        current_user,
        webp_bytes,
        target_path,
    )

    stem = Path(file.filename or "").stem.strip()
    effective_label = label.strip() or stem or "World Image"
    try:
        return repo.add_world_media(
            world_id,
            media_id=media_id,
            filename=filename,
            label=effective_label,
            mime_type="image/webp",
            byte_size=len(webp_bytes),
            media_type="image",
            owner_id=current_user.id,
        )
    except Exception:
        target_path.unlink(missing_ok=True)
        raise


@router.patch("/api/worlds/{world_id}/media/{media_id}", response_model=WorldRecord)
def update_world_media_label(
    world_id: str,
    media_id: str,
    req: WorldMediaLabelUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Update a world media item's label (CoW-forking if campaigns reference the world)."""
    try:
        return get_repo().update_world_media_label(
            world_id, media_id, req.label, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/api/worlds/{world_id}/media/reorder", response_model=WorldRecord)
def reorder_world_media(
    world_id: str,
    req: WorldMediaReorderRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Reorder media items on a world (first image becomes the Home card primary visual)."""
    try:
        return get_repo().reorder_world_media(
            world_id, req.ordered_media_ids, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/worlds/{world_id}/media/{media_id}/impact")
def get_world_media_delete_impact(
    world_id: str,
    media_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str | int | bool]:
    """Return active campaign count (including sibling CoW forks) referencing media_id."""
    try:
        return get_repo().get_world_media_usage_summary(
            world_id, media_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/api/worlds/{world_id}/delete-impact")
def get_world_delete_impact(
    world_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str | int]:
    """Return direct and sibling-fork campaign impact for deleting world_id."""
    try:
        return get_repo().get_world_delete_impact(world_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/api/worlds/{world_id}/media/{media_id}", response_model=WorldRecord)
def delete_world_media(
    world_id: str,
    media_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    """Hard-delete a world media item (DB row + physical file) to reclaim quota immediately."""
    try:
        return get_repo().delete_world_media(
            world_id, media_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
