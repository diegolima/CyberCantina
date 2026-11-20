"""Pydantic schemas for Multi-User Authentication, WebAuthn Passkeys, Profile, and Admin."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.config import (
    AgentDispatchMode,
    EmbeddingProfile,
    ModelProfile,
    ProviderCredentialStoreMode,
)
from app.schemas.admin_messages import PublicAdminMessage

UserRole = Literal["user", "admin"]

MIN_USERNAME_LEN = 2
MAX_USERNAME_LEN = 32
USERNAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$"
_USERNAME_RE = re.compile(USERNAME_PATTERN)

MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128

MIN_DISPLAY_NAME_LEN = 1
MAX_DISPLAY_NAME_LEN = 64
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")


def validate_username_value(raw: str) -> str:
    """Validate and normalize a CyberCantina username (2-32 chars, safe ASCII identifier)."""
    cleaned = raw.strip()
    if not cleaned:
        raise ValueError("Username cannot be empty.")
    if (
        len(cleaned) < MIN_USERNAME_LEN
        or len(cleaned) > MAX_USERNAME_LEN
        or not _USERNAME_RE.fullmatch(cleaned)
    ):
        raise ValueError(
            "Username must be 2-32 characters using letters, numbers, '.', '_', or '-' "
            "(starting with a letter or digit)."
        )
    return cleaned


def validate_display_name_value(raw: str) -> str:
    """Validate and normalize a user display name (1-64 chars, no control characters)."""
    cleaned = raw.strip()
    if not cleaned:
        raise ValueError("Display name cannot be empty.")
    if len(cleaned) > MAX_DISPLAY_NAME_LEN or _CONTROL_CHAR_RE.search(cleaned):
        raise ValueError(
            "Display name must be 1-64 characters and cannot contain control characters."
        )
    return cleaned


def _validate_optional_display_name(raw: str | None) -> str | None:
    if raw is None:
        return None
    if not raw.strip():
        return None
    return validate_display_name_value(raw)


def validate_new_password_value(raw: str, *, allow_blank: bool = False) -> str:
    """Validate newly configured passwords (8-128 chars; blank allowed only where explicitly permitted)."""
    if "\x00" in raw:
        raise ValueError("Password cannot contain null bytes.")
    if raw == "" and allow_blank:
        return raw
    if len(raw) < MIN_PASSWORD_LEN or len(raw) > MAX_PASSWORD_LEN:
        raise ValueError(
            f"Password must be between {MIN_PASSWORD_LEN} and {MAX_PASSWORD_LEN} characters."
        )
    return raw


def validate_login_password_value(raw: str) -> str:
    """Bound verification passwords to MAX_PASSWORD_LEN without locking out legacy short passwords."""
    if "\x00" in raw:
        raise ValueError("Invalid password format.")
    if len(raw) > MAX_PASSWORD_LEN:
        raise ValueError(f"Password cannot exceed {MAX_PASSWORD_LEN} characters.")
    return raw


class PasskeyInfo(BaseModel):
    id: str
    friendly_name: str
    transports: list[str] = Field(default_factory=list)
    aaguid: str = ""
    created_at: str
    last_used_at: str


class UserProfile(BaseModel):
    id: str
    username: str
    display_name: str
    role: UserRole = "user"
    has_password: bool = False
    passkeys: list[PasskeyInfo] = Field(default_factory=list)
    created_at: str
    updated_at: str
    last_login_at: str | None = None
    last_active_at: str | None = None
    media_bytes_used: int | None = None
    media_quota_bytes: int | None = None


class AuthStatusResponse(BaseModel):
    setup_required: bool
    single_user_mode: bool
    authenticated: bool
    user: UserProfile | None = None
    allow_self_registration: bool = True
    inactive_user_purge_days: int | None = None
    login_messages: list[PublicAdminMessage] = Field(default_factory=list)


class InitialSetupRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str = ""
    confirm_blank_password: bool = False

    @field_validator("username")
    @classmethod
    def _val_username(cls, v: str) -> str:
        return validate_username_value(v)

    @field_validator("display_name")
    @classmethod
    def _val_display_name(cls, v: str | None) -> str | None:
        return _validate_optional_display_name(v)

    @field_validator("password")
    @classmethod
    def _val_password(cls, v: str) -> str:
        return validate_new_password_value(v, allow_blank=True)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = ""

    @field_validator("password")
    @classmethod
    def _val_password(cls, v: str) -> str:
        return validate_login_password_value(v)


class RegisterRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str

    @field_validator("username")
    @classmethod
    def _val_username(cls, v: str) -> str:
        return validate_username_value(v)

    @field_validator("display_name")
    @classmethod
    def _val_display_name(cls, v: str | None) -> str | None:
        return _validate_optional_display_name(v)

    @field_validator("password")
    @classmethod
    def _val_password(cls, v: str) -> str:
        return validate_new_password_value(v, allow_blank=False)


class AuthSessionResponse(BaseModel):
    token: str
    user: UserProfile
    single_user_mode: bool


class ProfileUpdateRequest(BaseModel):
    display_name: str

    @field_validator("display_name")
    @classmethod
    def _val_display_name(cls, v: str) -> str:
        return validate_display_name_value(v)


class ChangePasswordRequest(BaseModel):
    current_password: str = ""
    new_password: str = ""
    confirm_blank_password: bool = False

    @field_validator("current_password")
    @classmethod
    def _val_current_password(cls, v: str) -> str:
        return validate_login_password_value(v)

    @field_validator("new_password")
    @classmethod
    def _val_new_password(cls, v: str) -> str:
        return validate_new_password_value(v, allow_blank=True)


class PasskeyRegisterStartRequest(BaseModel):
    current_password: str = ""
    friendly_name: str = Field(default="Passkey", max_length=64)
    replace_credential_id: str | None = None

    @field_validator("current_password")
    @classmethod
    def _val_current_password(cls, v: str) -> str:
        return validate_login_password_value(v)


class PasskeyRegisterStartResponse(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class PasskeyRegisterFinishRequest(BaseModel):
    challenge_id: str
    credential: dict[str, Any]


class PasskeyDeleteRequest(BaseModel):
    current_password: str = ""

    @field_validator("current_password")
    @classmethod
    def _val_current_password(cls, v: str) -> str:
        return validate_login_password_value(v)


class PasskeyLoginStartRequest(BaseModel):
    username: str | None = Field(default=None, max_length=64)


class PasskeyLoginStartResponse(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class PasskeyLoginFinishRequest(BaseModel):
    challenge_id: str
    credential: dict[str, Any]


class AdminChangeUsernameRequest(BaseModel):
    username: str

    @field_validator("username")
    @classmethod
    def _val_username(cls, v: str) -> str:
        return validate_username_value(v)


class AdminResetPasswordResponse(BaseModel):
    user: UserProfile
    generated_password: str


class AdminCreateUserRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str
    role: UserRole = "user"

    @field_validator("username")
    @classmethod
    def _val_username(cls, v: str) -> str:
        return validate_username_value(v)

    @field_validator("display_name")
    @classmethod
    def _val_display_name(cls, v: str | None) -> str | None:
        return _validate_optional_display_name(v)

    @field_validator("password")
    @classmethod
    def _val_password(cls, v: str) -> str:
        return validate_new_password_value(v, allow_blank=False)


class ProfileResetDataRequest(BaseModel):
    current_password: str = ""

    @field_validator("current_password")
    @classmethod
    def _val_current_password(cls, v: str) -> str:
        return validate_login_password_value(v)


class RestoreDefaultsResponse(BaseModel):
    restored_world: bool = False
    restored_character: bool = False
    skipped_world: bool = False
    skipped_character: bool = False
    message: str


class ProfileDeleteAccountRequest(BaseModel):
    current_password: str = ""

    @field_validator("current_password")
    @classmethod
    def _val_current_password(cls, v: str) -> str:
        return validate_login_password_value(v)


class UserModelSettingsPayload(BaseModel):
    actor_profile: ModelProfile | None = None
    clerk_profile: ModelProfile | None = None
    working_memory_turns: int | None = Field(default=None, ge=4, le=64)
    active_prompt_preset_id: str | None = None
    delegate_cognition_to_clerk: bool | None = None
    max_scene_flags: int | None = Field(default=None, ge=1, le=50)
    agent_dispatch_mode: AgentDispatchMode | None = None
    persona_disclosure_mode: Literal["llm_intent", "token_matching", "hybrid"] | None = None
    clerk_mirrors_actor: bool | None = None
    min_working_memory_turns: int | None = Field(default=None, ge=1, le=32)
    lod_summary_chunks: int | None = Field(default=None, ge=1, le=32)
    lod_importance_bonus: int | None = Field(default=None, ge=0, le=10)
    zone2_budget_share_pct: int | None = Field(default=None, ge=10, le=80)
    recall_budget_prose_tokens: int | None = Field(default=None, ge=100, le=2000)
    recall_budget_cognition_tokens: int | None = Field(default=None, ge=60, le=1000)


class EffectiveWarning(BaseModel):
    """Why a user's saved override could not be honored (never silently hidden)."""

    role: Literal["actor", "clerk"]
    code: Literal[
        "not_found",
        "disabled",
        "byop_disabled",
        "browser_storage_disabled",
        "no_token",
        "missing_provider",
    ]
    provider_id: str | None = None


class ProfileModelSettingsResponse(BaseModel):
    allow_user_model_overrides: bool
    allow_user_providers: bool = False
    provider_credential_store: ProviderCredentialStoreMode = "prefer_server"
    warnings: list[EffectiveWarning] = Field(default_factory=list)
    effective_clerk_mirrors_actor: bool = False
    user_clerk_mirrors_actor: bool | None = None
    default_clerk_mirrors_actor: bool = False
    has_override: bool
    effective_actor_profile: ModelProfile
    effective_clerk_profile: ModelProfile
    effective_working_memory_turns: int
    effective_delegate_cognition_to_clerk: bool = False
    effective_max_scene_flags: int = 10
    effective_agent_dispatch_mode: AgentDispatchMode = "sequential"
    effective_persona_disclosure_mode: str = "llm_intent"
    effective_min_working_memory_turns: int = 4
    effective_lod_summary_chunks: int = 6
    effective_lod_importance_bonus: int = 2
    effective_zone2_budget_share_pct: int = 45
    effective_recall_budget_prose_tokens: int = 450
    effective_recall_budget_cognition_tokens: int = 220
    user_actor_profile: ModelProfile | None = None
    user_clerk_profile: ModelProfile | None = None
    user_working_memory_turns: int | None = None
    user_delegate_cognition_to_clerk: bool | None = None
    user_max_scene_flags: int | None = None
    user_agent_dispatch_mode: AgentDispatchMode | None = None
    user_persona_disclosure_mode: str | None = None
    user_min_working_memory_turns: int | None = None
    user_lod_summary_chunks: int | None = None
    user_lod_importance_bonus: int | None = None
    user_zone2_budget_share_pct: int | None = None
    user_recall_budget_prose_tokens: int | None = None
    user_recall_budget_cognition_tokens: int | None = None
    active_prompt_preset_id: str | None = None
    default_actor_profile: ModelProfile
    default_clerk_profile: ModelProfile
    default_working_memory_turns: int
    default_delegate_cognition_to_clerk: bool = False
    default_max_scene_flags: int = 10
    default_agent_dispatch_mode: AgentDispatchMode = "sequential"
    default_persona_disclosure_mode: str = "llm_intent"
    default_min_working_memory_turns: int = 4
    default_lod_summary_chunks: int = 6
    default_lod_importance_bonus: int = 2
    default_zone2_budget_share_pct: int = 45
    default_recall_budget_prose_tokens: int = 450
    default_recall_budget_cognition_tokens: int = 220
    default_embedding_profile: EmbeddingProfile | None = None
