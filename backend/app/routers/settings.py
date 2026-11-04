"""Health, Ollama status, runtime settings, and user model overrides router."""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.config import AppSettings, ModelProfile, persist_settings, settings
from app.db.vector_store import current_embedding_fingerprint
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_persona_disclosure_mode,
    get_repo,
    resolve_effective_models,
)
from app.engine.llm_client import OllamaStatusResponse, query_ollama_status
from app.providers.resolver import ProviderUnavailableError, resolve_endpoint
from app.providers.settings_service import apply_settings
from app.security.url_policy import UrlBlockedError, assert_url_allowed, normalize_base_url
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


class SettingsUpdateResponse(AppSettings):
    """Settings echoed back after an admin save, with embedding-space change information."""

    embedding_reindex_required: bool = False
    stale_embedding_entries: int = 0


def _redacted_for_user(source: AppSettings) -> AppSettings:
    """Non-admin view: no filesystem paths and no endpoint URLs (credentials are never serialized)."""
    public = source.model_copy(deep=True)
    public.db_path = ""
    public.media_dir = ""
    for profile in (public.actor_profile, public.clerk_profile, public.embedding_profile):
        profile.base_url = ""
    return public


@router.get("/api/ollama/status", response_model=OllamaStatusResponse)
async def get_ollama_status(
    base_url: str | None = None,
    provider_id: str | None = None,
    current_user: UserProfile = Depends(get_current_user),
) -> OllamaStatusResponse:
    """Legacy status endpoint. Prefer ``/api/providers/{id}/probe``.

    * ``base_url`` (admin only, subject to the outbound URL policy) probes an arbitrary server.
    * ``provider_id`` probes a provider visible to the caller.
    * neither: status of the caller's effective Actor endpoint.
    """
    if base_url:
        if current_user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Administrator privileges required to probe custom Ollama endpoints.",
            )
        try:
            await assert_url_allowed(normalize_base_url(base_url), allow_private=True)
        except UrlBlockedError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return await query_ollama_status(base_url)
    if provider_id:
        record = get_repo().providers.get(provider_id)
        if record is None or (record.scope == "user" and record.owner_id != current_user.id):
            raise HTTPException(status_code=404, detail="Provider not found.")
        probe_profile = ModelProfile(provider_id=provider_id)
        try:
            endpoint = resolve_endpoint(probe_profile, user_id=current_user.id, role="model")
        except ProviderUnavailableError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        assert endpoint is not None
        return await query_ollama_status(endpoint.root_url, bearer_token=endpoint.bearer_token)
    eff = resolve_effective_models(current_user.id)
    if eff.actor.resolved is not None:
        return await query_ollama_status(eff.actor.resolved.root_url, bearer_token=eff.actor.resolved.bearer_token)
    return await query_ollama_status(eff.actor.base_url if eff.actor.provider_id is None else None)


@router.get("/api/settings", response_model=AppSettings)
def get_settings(
    user: UserProfile = Depends(get_current_user),
) -> AppSettings:
    return settings if user.role == "admin" else _redacted_for_user(settings)


@router.put("/api/settings", response_model=SettingsUpdateResponse)
def update_settings(
    updated: AppSettings,
    _admin: UserProfile = Depends(require_admin),
) -> SettingsUpdateResponse:
    try:
        result = apply_settings(updated, get_repo().providers, persist=persist_settings)
    except HTTPException:
        raise
    except OSError as exc:
        logger.error("Could not persist settings: %s", exc)
        raise HTTPException(status_code=500, detail="Settings could not be saved to disk.") from exc
    logger.info("Updated global app settings")
    stale = get_repo().vector_store.count_stale_entries()
    payload = result.settings.model_dump()
    return SettingsUpdateResponse(
        **payload,
        embedding_reindex_required=stale > 0,
        stale_embedding_entries=stale,
    )


@router.get("/api/admin/embeddings/status")
def embedding_status(_admin: UserProfile = Depends(require_admin)) -> dict[str, object]:
    """Active embedding fingerprint and how many stored vectors belong to a different space."""
    return {
        "fingerprint": current_embedding_fingerprint(),
        "stale_entries": get_repo().vector_store.count_stale_entries(),
    }


@router.post("/api/admin/embeddings/reindex")
async def reindex_embeddings(_admin: UserProfile = Depends(require_admin)) -> dict[str, int]:
    """Re-embed all vectors not in the active embedding space."""
    updated = await get_repo().vector_store.reindex()
    return {"reindexed": updated}


def _public_profile(profile: ModelProfile, user: UserProfile) -> ModelProfile:
    """Endpoint URLs are only for admins; everyone else identifies the endpoint by provider_id."""
    if user.role == "admin":
        return profile
    return profile.model_copy(update={"base_url": "", "resolved": None})


def _sanitize_user_profile(
    profile: ModelProfile, role: str, user: UserProfile, default: ModelProfile
) -> ModelProfile:
    """Users choose provider + model + sampling only, never URLs or keys.

    Legacy connection fields are overwritten with the system defaults (closing a direct-URL SSRF
    path), a missing provider inherits the system default's, and the provider must be visible to
    the caller right now.
    """
    clean = profile.model_copy(
        update={
            "base_url": default.base_url,
            "api_key": default.api_key,
            "resolved": None,
            "provider_id": profile.provider_id or default.provider_id,
        }
    )
    if clean.provider_id:
        try:
            resolve_endpoint(clean, user_id=user.id, role=role)
        except ProviderUnavailableError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"The selected {role} provider is not available to you ({exc.code}).",
            ) from exc
    return clean


@router.get("/api/profile/models", response_model=ProfileModelSettingsResponse)
def get_profile_models(
    current_user: UserProfile = Depends(get_current_user),
) -> ProfileModelSettingsResponse:
    repo = get_repo()
    user_override = repo.get_user_model_settings(current_user.id)
    eff = resolve_effective_models(current_user.id)
    eff_dispatch = get_effective_agent_dispatch_mode(current_user.id)
    eff_pdm = get_effective_persona_disclosure_mode(current_user.id)
    has_override = user_override is not None and (
        user_override.actor_profile is not None
        or user_override.clerk_profile is not None
        or user_override.working_memory_turns is not None
        or user_override.active_prompt_preset_id is not None
        or user_override.delegate_cognition_to_clerk is not None
        or user_override.max_scene_flags is not None
        or user_override.agent_dispatch_mode is not None
        or user_override.persona_disclosure_mode is not None
        or user_override.clerk_mirrors_actor is not None
    )
    return ProfileModelSettingsResponse(
        allow_user_model_overrides=settings.allow_user_model_overrides,
        allow_user_providers=settings.allow_user_providers,
        warnings=eff.warnings,
        has_override=has_override,
        effective_actor_profile=_public_profile(eff.actor, current_user),
        effective_clerk_profile=_public_profile(eff.clerk, current_user),
        effective_working_memory_turns=eff.working_memory_turns,
        effective_delegate_cognition_to_clerk=eff.delegate_cognition_to_clerk,
        effective_max_scene_flags=eff.max_scene_flags,
        effective_agent_dispatch_mode=eff_dispatch,
        effective_persona_disclosure_mode=eff_pdm,
        effective_clerk_mirrors_actor=eff.clerk_mirrors_actor,
        user_actor_profile=_public_profile(user_override.actor_profile, current_user) if user_override and user_override.actor_profile else None,
        user_clerk_profile=_public_profile(user_override.clerk_profile, current_user) if user_override and user_override.clerk_profile else None,
        user_working_memory_turns=user_override.working_memory_turns if user_override else None,
        user_delegate_cognition_to_clerk=user_override.delegate_cognition_to_clerk if user_override else None,
        user_max_scene_flags=user_override.max_scene_flags if user_override else None,
        user_agent_dispatch_mode=user_override.agent_dispatch_mode if user_override else None,
        user_persona_disclosure_mode=user_override.persona_disclosure_mode if user_override else None,
        user_clerk_mirrors_actor=user_override.clerk_mirrors_actor if user_override else None,
        active_prompt_preset_id=user_override.active_prompt_preset_id if user_override else None,
        default_actor_profile=_public_profile(settings.actor_profile, current_user),
        default_clerk_profile=_public_profile(settings.clerk_profile, current_user),
        default_working_memory_turns=settings.memory_config.working_memory_turns,
        default_delegate_cognition_to_clerk=settings.delegate_cognition_to_clerk,
        default_max_scene_flags=settings.memory_config.max_scene_flags,
        default_agent_dispatch_mode=settings.agent_dispatch_mode,
        default_persona_disclosure_mode="llm_intent",
        default_clerk_mirrors_actor=settings.clerk_mirrors_actor,
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
    if payload.actor_profile is not None:
        payload.actor_profile = _sanitize_user_profile(
            payload.actor_profile, "actor", current_user, settings.actor_profile
        )
    if payload.clerk_profile is not None:
        payload.clerk_profile = _sanitize_user_profile(
            payload.clerk_profile, "clerk", current_user, settings.clerk_profile
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
