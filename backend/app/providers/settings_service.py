"""Applying admin settings: reference validation, BYOP coupling, revision check, atomic persist."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException

from app.config import AppSettings, persist_settings, settings
from app.db.provider_store import ProviderStore
from app.db.vector_store import current_embedding_fingerprint
from app.schemas.provider import ProviderRecord

_APPLY_LOCK = threading.Lock()


@dataclass
class SettingsApplyResult:
    settings: AppSettings
    embedding_changed: bool


def _require_system_provider(store: ProviderStore, provider_id: str | None, role: str) -> ProviderRecord | None:
    if not provider_id:
        return None
    record = store.get(provider_id)
    if record is None or record.scope != "system":
        raise HTTPException(
            status_code=422,
            detail=f"The {role} provider must be an existing system provider.",
        )
    return record


def apply_settings(
    updated: AppSettings,
    store: ProviderStore,
    persist: Callable[[AppSettings], None] = persist_settings,
) -> SettingsApplyResult:
    """Validate and apply an admin settings update atomically. Raises HTTPException on invalid input."""
    with _APPLY_LOCK:
        if updated.settings_revision not in (0, settings.settings_revision):
            raise HTTPException(
                status_code=409,
                detail="Settings were changed by someone else. Reload and re-apply your edits.",
            )
        for role, profile in (
            ("Actor", updated.actor_profile),
            ("Clerk", updated.clerk_profile),
            ("embedding", updated.embedding_profile),
        ):
            _require_system_provider(store, profile.provider_id, role)

        before_fp = current_embedding_fingerprint()
        snapshot = settings.model_copy(deep=True)
        try:
            settings.actor_profile = updated.actor_profile
            settings.clerk_profile = updated.clerk_profile
            settings.embedding_profile = updated.embedding_profile
            settings.memory_config = updated.memory_config
            settings.allow_offline_fallback = updated.allow_offline_fallback
            settings.allow_user_providers = updated.allow_user_providers
            # BYOP coupling is enforced here (the model validator only runs on construction).
            settings.allow_user_model_overrides = (
                True if updated.allow_user_providers else updated.allow_user_model_overrides
            )
            settings.clerk_mirrors_actor = updated.clerk_mirrors_actor
            settings.delegate_cognition_to_clerk = updated.delegate_cognition_to_clerk
            settings.agent_dispatch_mode = updated.agent_dispatch_mode
            settings.settings_revision = settings.settings_revision + 1
            persist(settings)
        except Exception:
            # Roll the in-memory state back so memory and disk never disagree.
            for field_name in AppSettings.model_fields:
                if field_name not in ("db_path", "media_dir"):
                    setattr(settings, field_name, getattr(snapshot, field_name))
            raise
        return SettingsApplyResult(settings=settings, embedding_changed=before_fp != current_embedding_fingerprint())
