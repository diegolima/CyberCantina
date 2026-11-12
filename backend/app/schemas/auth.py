"""Pydantic schemas for Multi-User Authentication, WebAuthn Passkeys, Profile, and Admin."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config import AgentDispatchMode, EmbeddingProfile, ModelProfile

UserRole = Literal["user", "admin"]


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


class AuthStatusResponse(BaseModel):
    setup_required: bool
    single_user_mode: bool
    authenticated: bool
    user: UserProfile | None = None


class InitialSetupRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str = ""
    confirm_blank_password: bool = False


class LoginRequest(BaseModel):
    username: str
    password: str = ""


class RegisterRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str


class AuthSessionResponse(BaseModel):
    token: str
    user: UserProfile
    single_user_mode: bool


class ProfileUpdateRequest(BaseModel):
    display_name: str


class ChangePasswordRequest(BaseModel):
    current_password: str = ""
    new_password: str = ""
    confirm_blank_password: bool = False


class PasskeyRegisterStartRequest(BaseModel):
    current_password: str = ""
    friendly_name: str = "Passkey"
    replace_credential_id: str | None = None


class PasskeyRegisterStartResponse(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class PasskeyRegisterFinishRequest(BaseModel):
    challenge_id: str
    credential: dict[str, Any]


class PasskeyDeleteRequest(BaseModel):
    current_password: str = ""


class PasskeyLoginStartRequest(BaseModel):
    username: str | None = None


class PasskeyLoginStartResponse(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class PasskeyLoginFinishRequest(BaseModel):
    challenge_id: str
    credential: dict[str, Any]


class AdminChangeUsernameRequest(BaseModel):
    username: str


class AdminResetPasswordResponse(BaseModel):
    user: UserProfile
    generated_password: str


class AdminCreateUserRequest(BaseModel):
    username: str
    display_name: str | None = None
    password: str
    role: UserRole = "user"


class ProfileResetDataRequest(BaseModel):
    current_password: str = ""


class ProfileDeleteAccountRequest(BaseModel):
    current_password: str = ""


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
    code: Literal["not_found", "disabled", "byop_disabled", "no_token", "missing_provider"]
    provider_id: str | None = None


class ProfileModelSettingsResponse(BaseModel):
    allow_user_model_overrides: bool
    allow_user_providers: bool = False
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
