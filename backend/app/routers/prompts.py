"""Prompt presets and template customization router."""

from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.dependencies import get_repo
from app.prompts import FACTORY_DEFAULT_PROMPTS, PROMPTS_METADATA
from app.schemas.auth import UserProfile
from app.schemas.prompt import (
    PromptDefaultsResponse,
    PromptMetadata,
    PromptPresetCreatePayload,
    PromptPresetRecord,
    PromptPresetUpdatePayload,
)
from app.schemas.turn import CampaignRecord

logger = logging.getLogger("cybercantina.routers.prompts")
router = APIRouter(tags=["prompts"])


class SetCampaignPresetRequest(BaseModel):
    preset_id: str | None = None


class SetUserActivePresetRequest(BaseModel):
    preset_id: str | None = None


@router.get("/api/prompts/defaults", response_model=PromptDefaultsResponse)
def get_prompt_defaults(
    current_user: UserProfile = Depends(get_current_user),
) -> PromptDefaultsResponse:
    """Return factory defaults, template documentation/variables, and available presets."""
    repo = get_repo()
    presets = repo.list_prompt_presets(user_id=current_user.id)
    ums = repo.get_user_model_settings(current_user.id)
    active_preset_id = ums.active_prompt_preset_id if ums else None
    return PromptDefaultsResponse(
        presets=presets,
        defaults=dict(FACTORY_DEFAULT_PROMPTS),
        metadata=[PromptMetadata.model_validate(m) for m in PROMPTS_METADATA],
        active_preset_id=active_preset_id,
    )


@router.get("/api/prompts/active")
def get_active_prompt_preset(
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Get the current user's active prompt preset."""
    repo = get_repo()
    ums = repo.get_user_model_settings(current_user.id)
    active_id = ums.active_prompt_preset_id if ums else None
    return {"active_prompt_preset_id": active_id}


@router.put("/api/prompts/active")
def set_active_prompt_preset(
    payload: SetUserActivePresetRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Set or clear the active prompt preset for the current user."""
    repo = get_repo()
    if payload.preset_id:
        preset = repo.get_prompt_preset(payload.preset_id)
        if not preset or (
            not preset.is_builtin
            and preset.owner_id
            and preset.owner_id != current_user.id
        ):
            raise HTTPException(
                status_code=404,
                detail=f"Preset '{payload.preset_id}' not found or access denied.",
            )
    repo.set_user_active_prompt_preset(current_user.id, payload.preset_id)
    return {"status": "ok", "active_prompt_preset_id": payload.preset_id}


@router.get("/api/prompts/presets", response_model=list[PromptPresetRecord])
def list_prompt_presets(
    current_user: UserProfile = Depends(get_current_user),
) -> list[PromptPresetRecord]:
    """List all presets accessible to the current user (built-in + owned)."""
    repo = get_repo()
    return repo.list_prompt_presets(user_id=current_user.id)


@router.get("/api/prompts/presets/{preset_id}", response_model=PromptPresetRecord)
def get_prompt_preset(
    preset_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Fetch details of a single prompt preset."""
    repo = get_repo()
    preset = repo.get_prompt_preset(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
    if (
        not preset.is_builtin
        and preset.owner_id
        and preset.owner_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
    return preset


@router.post("/api/prompts/presets", response_model=PromptPresetRecord)
def create_prompt_preset(
    payload: PromptPresetCreatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Create a new custom prompt preset (optionally cloned from an existing preset)."""
    repo = get_repo()
    base_prompts: dict[str, str] = {}
    if payload.base_preset_id:
        base = repo.get_prompt_preset(payload.base_preset_id)
        if not base or (
            not base.is_builtin
            and base.owner_id
            and base.owner_id != current_user.id
        ):
            raise HTTPException(
                status_code=404,
                detail=f"Base preset '{payload.base_preset_id}' not found or access denied.",
            )
        base_prompts = dict(base.prompts)
    if payload.prompts:
        base_prompts.update(payload.prompts)

    return repo.create_prompt_preset(
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
        prompts=base_prompts,
        is_builtin=False,
    )


@router.put("/api/prompts/presets/{preset_id}", response_model=PromptPresetRecord)
def update_prompt_preset(
    preset_id: str,
    payload: PromptPresetUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Update a custom prompt preset's metadata or templates."""
    repo = get_repo()
    try:
        return repo.update_prompt_preset(
            preset_id,
            name=payload.name,
            description=payload.description,
            prompts=payload.prompts,
            user_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete("/api/prompts/presets/{preset_id}")
def delete_prompt_preset(
    preset_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete a custom prompt preset."""
    repo = get_repo()
    try:
        deleted = repo.delete_prompt_preset(
            preset_id,
            user_id=current_user.id,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
        return {"status": "deleted", "id": preset_id}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/api/prompts/presets/{preset_id}/reset", response_model=PromptPresetRecord)
def reset_prompt_preset(
    preset_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Reset a custom prompt preset back to factory default prompt templates."""
    repo = get_repo()
    try:
        return repo.reset_prompt_preset(
            preset_id,
            user_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/api/campaigns/{campaign_id}/prompt-preset", response_model=CampaignRecord)
def set_campaign_prompt_preset(
    campaign_id: str,
    payload: SetCampaignPresetRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignRecord:
    """Assign or clear an active prompt preset on a specific campaign."""
    repo = get_repo()
    if payload.preset_id:
        preset = repo.get_prompt_preset(payload.preset_id)
        if not preset or (
            not preset.is_builtin
            and preset.owner_id
            and preset.owner_id != current_user.id
        ):
            raise HTTPException(
                status_code=404,
                detail=f"Preset '{payload.preset_id}' not found or access denied.",
            )
    try:
        return repo.set_campaign_prompt_preset(
            campaign_id,
            payload.preset_id,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
