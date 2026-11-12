"""Resolve a role profile's ``provider_id`` to a callable endpoint, enforcing visibility at call time."""

from __future__ import annotations

from typing import Literal

from app.config import ModelProfile, settings
from app.db.provider_store import ProviderStore
from app.providers.endpoint import ResolvedEndpoint
from app.schemas.provider import ProviderRecord
from app.security.secret_box import SecretDecryptionError

UnavailableCode = Literal["not_found", "not_visible", "disabled", "byop_disabled", "no_token"]


class ProviderUnavailableError(RuntimeError):
    """A role references a provider that cannot be used right now (never silently substituted)."""

    def __init__(self, code: UnavailableCode, *, role: str, provider_id: str | None, detail: str = "") -> None:
        self.code = code
        self.role = role
        self.provider_id = provider_id
        messages = {
            "not_found": "the provider no longer exists",
            "not_visible": "the provider is not available to this account",
            "disabled": "the provider is disabled",
            "byop_disabled": "personal providers are currently disabled by the administrator",
            "no_token": "the provider credential could not be decrypted",
        }
        super().__init__(
            f"The {role} model's provider is unavailable: {messages.get(code, code)}. {detail}".strip()
        )


def visibility_problem(record: ProviderRecord, user_id: str | None) -> UnavailableCode | None:
    """Return why ``record`` cannot be used by ``user_id`` (None => system-role context), or None."""
    if record.scope == "user":
        if user_id is None or record.owner_id != user_id:
            return "not_visible"
        if not settings.allow_user_providers:
            return "byop_disabled"
    if not record.is_enabled:
        return "disabled"
    return None


def resolve_endpoint(
    profile: ModelProfile,
    *,
    user_id: str | None,
    role: str,
    store: ProviderStore | None = None,
) -> ResolvedEndpoint | None:
    """Resolve ``profile.provider_id``. Returns None for legacy profiles without a provider."""
    if not profile.provider_id:
        return None
    active = store or ProviderStore(settings.db_path)
    record = active.get(profile.provider_id)
    if record is None:
        raise ProviderUnavailableError("not_found", role=role, provider_id=profile.provider_id)
    problem = visibility_problem(record, user_id)
    if problem:
        # Never reveal that another tenant's provider exists.
        raise ProviderUnavailableError(
            "not_found" if problem == "not_visible" else problem, role=role, provider_id=profile.provider_id
        )
    try:
        token = active.bearer_token(record)
    except SecretDecryptionError as exc:
        raise ProviderUnavailableError("no_token", role=role, provider_id=profile.provider_id) from exc
    return ResolvedEndpoint(
        provider_id=record.id,
        type=record.type,
        root_url=record.base_url,
        bearer_token=token,
        timeout_seconds=getattr(profile, "timeout_seconds", 15.0),
        network_restricted=record.network_restricted,
        owner_id=record.owner_id,
    )


def attach_endpoint(profile: ModelProfile, endpoint: ResolvedEndpoint | None) -> ModelProfile:
    """Return a copy of ``profile`` carrying its resolved endpoint (original left untouched)."""
    if endpoint is None:
        return profile
    return profile.model_copy(update={"resolved": endpoint})


def resolve_system_profile(profile: ModelProfile, role: str) -> ResolvedEndpoint | None:
    """Resolve a profile in system context (no user): only system-scope providers qualify."""
    return resolve_endpoint(profile, user_id=None, role=role)
