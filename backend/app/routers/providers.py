"""Provider fleet API: tenant-scoped CRUD, probing, and policy enforcement."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.auth import get_current_user
from app.config import settings
from app.db.provider_store import (
    ProviderNameConflictError,
    ProviderNotFoundError,
    ProviderStore,
    ProviderVersionConflictError,
)
from app.dependencies import get_repo
from app.providers.openrouter_catalog import openrouter_catalog_service
from app.providers.probe import ProbeRateLimited, probe_service
from app.providers.references import clear_user_overrides, find_references
from app.providers.resolver import visibility_problem
from app.schemas.auth import UserProfile
from app.schemas.provider import (
    ProviderCreatePayload,
    ProviderDeleteConflict,
    ProviderDraft,
    ProviderProbeResponse,
    ProviderRecord,
    ProviderResponse,
    ProviderUpdatePayload,
)
from app.security.url_policy import UrlBlockedError, assert_url_allowed, normalize_base_url

logger = logging.getLogger("cybercantina.routers.providers")
router = APIRouter(prefix="/api/providers", tags=["providers"])


def _store() -> ProviderStore:
    return get_repo().providers


def _is_admin(user: UserProfile) -> bool:
    return user.role == "admin"


def _can_manage(record: ProviderRecord, user: UserProfile) -> bool:
    """Edit/delete rights: admins manage system providers; owners manage their personal ones."""
    if record.scope == "system":
        return _is_admin(user)
    return record.owner_id == user.id


def _to_response(record: ProviderRecord, user: UserProfile) -> ProviderResponse:
    problem = visibility_problem(record, record.owner_id if record.scope == "user" else None)
    show_url = _is_admin(user) or record.owner_id == user.id
    cached_models = (
        openrouter_catalog_service.get_cached_models_sync() or record.cached_models
        if record.type == "openrouter"
        else record.cached_models
    )
    return ProviderResponse(
        id=record.id,
        name=record.name,
        type=record.type,  # type: ignore[arg-type]
        scope=record.scope,  # type: ignore[arg-type]
        owner_id=record.owner_id if record.owner_id == user.id else None,
        color=record.color,  # type: ignore[arg-type]
        is_enabled=record.is_enabled,
        base_url=record.base_url if show_url else None,
        has_bearer_token=bool(record.secret_enc),
        usable=problem is None,
        unusable_reason=problem if problem in ("disabled", "byop_disabled") else None,  # type: ignore[arg-type]
        cached_models=cached_models,
        last_probed_at=record.last_probed_at,
        last_error_code=record.last_error_code,  # type: ignore[arg-type]
        version=record.version,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _visible_or_404(store: ProviderStore, provider_id: str, user: UserProfile) -> ProviderRecord:
    """System providers are visible to all; personal ones only to their owner (404, never 403)."""
    record = store.get(provider_id)
    if record is None or (record.scope == "user" and record.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Provider not found.")
    return record


def _validate_url(raw: str | None, *, provider_type: str = "ollama", allow_private: bool):
    try:
        url = normalize_base_url(raw or "", provider_type=provider_type)
    except UrlBlockedError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc
    return url


async def _check_url_policy(url, *, allow_private: bool) -> None:
    try:
        await assert_url_allowed(url, allow_private=allow_private)
    except UrlBlockedError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)}) from exc


@router.get("", response_model=list[ProviderResponse])
def list_providers(user: UserProfile = Depends(get_current_user)) -> list[ProviderResponse]:
    """System providers plus the caller's own personal providers (admins never see other users')."""
    store = _store()
    records = [*store.list_system(), *store.list_for_owner(user.id)]
    return [_to_response(r, user) for r in records]


@router.post("", response_model=ProviderResponse, status_code=201)
async def create_provider(
    payload: ProviderCreatePayload, user: UserProfile = Depends(get_current_user)
) -> ProviderResponse:
    if payload.scope == "system":
        if not _is_admin(user):
            raise HTTPException(status_code=403, detail="Administrator privileges required to create system providers.")
    elif not settings.allow_user_providers:
        raise HTTPException(status_code=403, detail="Personal providers are disabled by the administrator.")
    allow_private = _is_admin(user)

    raw_token = (payload.settings.bearer_token or "").strip()
    if payload.type == "openrouter":
        if not raw_token:
            raise HTTPException(status_code=422, detail="OpenRouter requires an API key (Bearer token).")
        raw_url = (payload.settings.base_url or "").strip() or "https://openrouter.ai/api/v1"
    elif payload.type == "aihorde":
        raw_url = (payload.settings.base_url or "").strip() or "https://oai.stablehorde.net/v1"
    else:
        raw_url = (payload.settings.base_url or "").strip()

    url = _validate_url(raw_url, provider_type=payload.type, allow_private=allow_private)
    await _check_url_policy(url, allow_private=allow_private)
    store = _store()
    try:
        record = store.create(
            name=payload.name,
            type=payload.type,
            scope=payload.scope,
            owner_id=user.id if payload.scope == "user" else None,
            color=payload.color,
            is_enabled=payload.is_enabled,
            base_url=url.root,
            bearer_token=raw_token or None,
            network_restricted=not allow_private,
        )
    except ProviderNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _to_response(record, user)


@router.put("/{provider_id}", response_model=ProviderResponse)
async def update_provider(
    provider_id: str, payload: ProviderUpdatePayload, user: UserProfile = Depends(get_current_user)
):
    store = _store()
    record = _visible_or_404(store, provider_id, user)
    if not _can_manage(record, user):
        raise HTTPException(status_code=403, detail="You are not allowed to modify this provider.")
    if record.scope == "user" and not settings.allow_user_providers:
        raise HTTPException(status_code=403, detail="Personal providers are disabled by the administrator.")

    new_url: str | None = None
    if payload.base_url is not None:
        allow_private = _is_admin(user) and not record.network_restricted
        url = _validate_url(payload.base_url, provider_type=record.type, allow_private=allow_private)
        await _check_url_policy(url, allow_private=allow_private)
        new_url = url.root
        old_host = normalize_base_url(record.base_url, provider_type=record.type).host if record.base_url else ""
        if (
            url.host != old_host
            and record.secret_enc
            and not payload.bearer_token
            and not payload.clear_bearer_token
        ):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "token_required_on_url_change",
                    "message": "The server host changed: supply the bearer token again or clear it.",
                },
            )

    if payload.is_enabled is False and record.scope == "system":
        refs = [r for r in find_references(record.id, store, settings) if r.kind != "user_override"]
        if refs:
            raise HTTPException(
                status_code=409,
                detail=ProviderDeleteConflict(
                    detail="This provider is used by system roles. Reassign them before disabling it.",
                    referenced_by=refs,
                ).model_dump(),
            )

    try:
        updated = store.update(
            provider_id,
            expected_version=payload.expected_version,
            name=payload.name,
            color=payload.color,
            is_enabled=payload.is_enabled,
            base_url=new_url,
            bearer_token=(payload.bearer_token or "").strip() or None,
            clear_bearer_token=payload.clear_bearer_token,
        )
    except ProviderNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ProviderVersionConflictError as exc:
        raise HTTPException(
            status_code=409, detail="This provider was changed elsewhere. Reload and try again."
        ) from exc
    except ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Provider not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    probe_service.invalidate(provider_id)
    return _to_response(updated, user)


@router.delete("/{provider_id}")
def delete_provider(provider_id: str, user: UserProfile = Depends(get_current_user)):
    store = _store()
    record = _visible_or_404(store, provider_id, user)
    if not _can_manage(record, user):
        raise HTTPException(status_code=403, detail="You are not allowed to delete this provider.")
    owner_scope = record.owner_id if record.scope == "user" else None
    refs = find_references(record.id, store, settings, owner_id=owner_scope)
    blocking = [r for r in refs if r.kind in ("system_role", "embedding")]
    if blocking:
        return JSONResponse(
            status_code=409,
            content=ProviderDeleteConflict(
                detail="This provider is used by system roles. Reassign them before deleting it.",
                referenced_by=blocking,
            ).model_dump(),
        )
    reset_users = clear_user_overrides(record.id, store, owner_id=owner_scope)
    store.delete(provider_id)
    probe_service.invalidate(provider_id)
    return {"status": "deleted", "id": provider_id, "reset_user_overrides": reset_users}


def _public_probe(resp: ProviderProbeResponse, *, privileged: bool) -> ProviderProbeResponse:
    return resp if privileged else resp.model_copy(update={"error": None})


@router.post("/{provider_id}/probe", response_model=ProviderProbeResponse)
async def probe_provider(
    provider_id: str,
    force: bool = Query(default=False),
    user: UserProfile = Depends(get_current_user),
) -> ProviderProbeResponse:
    store = _store()
    record = _visible_or_404(store, provider_id, user)
    if record.scope == "system" and not _is_admin(user):
        # Users only see the last server-side status; they cannot trigger connections to system providers.
        raise HTTPException(status_code=403, detail="Only administrators can check system providers.")
    if record.scope == "user" and visibility_problem(record, user.id):
        raise HTTPException(status_code=403, detail="Personal providers are disabled by the administrator.")
    if not _is_admin(user):
        try:
            probe_service.user_limiter.check(user.id)
        except ProbeRateLimited:
            return ProviderProbeResponse(
                provider_id=provider_id,
                reachable=False,
                error_code="rate_limited",
                config_version=record.version,
                probed_at="",
            )
    resp = await probe_service.probe(record, store, force=force)
    return _public_probe(resp, privileged=_can_manage(record, user))


@router.post("/probe-draft", response_model=ProviderProbeResponse)
async def probe_draft(draft: ProviderDraft, user: UserProfile = Depends(get_current_user)) -> ProviderProbeResponse:
    """Test an unsaved configuration (admins, or users when BYOP is on)."""
    if not _is_admin(user) and not settings.allow_user_providers:
        raise HTTPException(status_code=403, detail="Personal providers are disabled by the administrator.")
    if not _is_admin(user):
        try:
            probe_service.user_limiter.check(user.id)
        except ProbeRateLimited:
            return ProviderProbeResponse(reachable=False, error_code="rate_limited", probed_at="")
    store = _store()
    token = (draft.bearer_token or "").strip() or None
    restricted = not _is_admin(user)
    default_draft_url = (
        "https://openrouter.ai/api/v1"
        if draft.type == "openrouter"
        else ("https://oai.stablehorde.net/v1" if draft.type == "aihorde" else "")
    )
    draft_url = draft.base_url or default_draft_url
    try:
        url = normalize_base_url(draft_url, provider_type=draft.type)
    except UrlBlockedError as exc:
        return ProviderProbeResponse(
            provider_id=draft.provider_id, reachable=False, error_code="invalid_url", error=str(exc), probed_at=""
        )
    if draft.provider_id:
        record = _visible_or_404(store, draft.provider_id, user)
        if not _can_manage(record, user):
            raise HTTPException(status_code=403, detail="You are not allowed to test this provider.")
        restricted = restricted or record.network_restricted
        # Reuse the stored token only for the same host, never to a new destination.
        if token is None and record.secret_enc and url.host == normalize_base_url(record.base_url, provider_type=record.type).host:
            token = store.bearer_token(record)
    resp = await probe_service.probe_draft(draft.model_copy(update={"base_url": url.root}), store, restricted=restricted, token=token)
    return _public_probe(resp, privileged=True)
