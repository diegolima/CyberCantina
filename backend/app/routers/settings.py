"""Health, Ollama status, runtime settings, and user model overrides router."""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.config import AppSettings, persist_settings, settings
from app.dependencies import get_effective_user_model_settings, get_repo
from app.engine.llm_client import OllamaStatusResponse, query_ollama_status
from app.schemas.auth import (
    ProfileModelSettingsResponse,
    UserModelSettingsPayload,
    UserProfile,
)

logger = logging.getLogger("cybercantina.routers.settings")
router = APIRouter(tags=["settings"])


@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "cybercantina-backend"}


@router.get("/api/ollama/status", response_model=OllamaStatusResponse)
async def get_ollama_status(
    base_url: str | None = None,
    current_user: UserProfile = Depends(get_current_user),
) -> OllamaStatusResponse:
    target_url = base_url
    if base_url:
        eff_actor, eff_clerk, *_ = get_effective_user_model_settings(current_user.id)
        allowed_urls = {
            settings.actor_profile.base_url,
            settings.clerk_profile.base_url,
            settings.embedding_profile.base_url,
            eff_actor.base_url,
            eff_clerk.base_url,
        }
        if current_user.role != "admin" and base_url not in allowed_urls:
            raise HTTPException(
                status_code=403,
                detail="Administrator privileges required to probe custom Ollama endpoints.",
            )
    return await query_ollama_status(target_url)


@router.get("/api/settings", response_model=AppSettings)
def get_settings(
    _user: UserProfile = Depends(get_current_user),
) -> AppSettings:
    return settings


@router.put("/api/settings", response_model=AppSettings)
def update_settings(
    updated: AppSettings,
    _admin: UserProfile = Depends(require_admin),
) -> AppSettings:
    settings.actor_profile = updated.actor_profile
    settings.clerk_profile = updated.clerk_profile
    settings.embedding_profile = updated.embedding_profile
    settings.memory_config = updated.memory_config
    settings.allow_offline_fallback = updated.allow_offline_fallback
    settings.allow_user_model_overrides = updated.allow_user_model_overrides
    settings.delegate_cognition_to_clerk = updated.delegate_cognition_to_clerk
    persist_settings(settings)
    logger.info("Updated global app settings")
    return settings


@router.get("/api/profile/models", response_model=ProfileModelSettingsResponse)
def get_profile_models(
    current_user: UserProfile = Depends(get_current_user),
) -> ProfileModelSettingsResponse:
    repo = get_repo()
    user_override = repo.get_user_model_settings(current_user.id)
    eff_actor, eff_clerk, eff_wm_turns, eff_delegate, eff_max_flags = get_effective_user_model_settings(current_user.id)
    has_override = user_override is not None and (
        user_override.actor_profile is not None
        or user_override.clerk_profile is not None
        or user_override.working_memory_turns is not None
        or user_override.active_prompt_preset_id is not None
        or user_override.delegate_cognition_to_clerk is not None
        or user_override.max_scene_flags is not None
    )
    return ProfileModelSettingsResponse(
        allow_user_model_overrides=settings.allow_user_model_overrides,
        has_override=has_override,
        effective_actor_profile=eff_actor,
        effective_clerk_profile=eff_clerk,
        effective_working_memory_turns=eff_wm_turns,
        effective_delegate_cognition_to_clerk=eff_delegate,
        effective_max_scene_flags=eff_max_flags,
        user_actor_profile=user_override.actor_profile if user_override else None,
        user_clerk_profile=user_override.clerk_profile if user_override else None,
        user_working_memory_turns=user_override.working_memory_turns if user_override else None,
        user_delegate_cognition_to_clerk=user_override.delegate_cognition_to_clerk if user_override else None,
        user_max_scene_flags=user_override.max_scene_flags if user_override else None,
        active_prompt_preset_id=user_override.active_prompt_preset_id if user_override else None,
        default_actor_profile=settings.actor_profile,
        default_clerk_profile=settings.clerk_profile,
        default_working_memory_turns=settings.memory_config.working_memory_turns,
        default_delegate_cognition_to_clerk=settings.delegate_cognition_to_clerk,
        default_max_scene_flags=settings.memory_config.max_scene_flags,
    )


@router.put("/api/profile/models", response_model=ProfileModelSettingsResponse)
def update_profile_models(
    payload: UserModelSettingsPayload,
    current_user: UserProfile = Depends(get_current_user),
) -> ProfileModelSettingsResponse:
    if not settings.allow_user_model_overrides:
        raise HTTPException(
            status_code=403,
            detail="Per-user model overrides are currently disabled by the system administrator.",
        )
    repo = get_repo()
    if payload.active_prompt_preset_id:
        preset = repo.get_prompt_preset(payload.active_prompt_preset_id)
        if not preset or (
            not preset.is_builtin
            and preset.owner_id
            and preset.owner_id != current_user.id
        ):
            raise HTTPException(
                status_code=404,
                detail=f"Preset '{payload.active_prompt_preset_id}' not found or access denied.",
            )
    repo.save_user_model_settings(current_user.id, payload)
    return get_profile_models(current_user=current_user)


@router.delete("/api/profile/models", response_model=ProfileModelSettingsResponse)
def reset_profile_models(
    current_user: UserProfile = Depends(get_current_user),
) -> ProfileModelSettingsResponse:
    repo = get_repo()
    repo.delete_user_model_settings(current_user.id)
    return get_profile_models(current_user=current_user)
