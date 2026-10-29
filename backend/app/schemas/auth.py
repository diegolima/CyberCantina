"""Pydantic schemas for Multi-User Authentication, WebAuthn Passkeys, Profile, and Admin."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config import ModelProfile

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


class ProfileModelSettingsResponse(BaseModel):
    allow_user_model_overrides: bool
    has_override: bool
    effective_actor_profile: ModelProfile
    effective_clerk_profile: ModelProfile
    effective_working_memory_turns: int
    effective_delegate_cognition_to_clerk: bool = False
    user_actor_profile: ModelProfile | None = None
    user_clerk_profile: ModelProfile | None = None
    user_working_memory_turns: int | None = None
    user_delegate_cognition_to_clerk: bool | None = None
    active_prompt_preset_id: str | None = None
    default_actor_profile: ModelProfile
    default_clerk_profile: ModelProfile
    default_working_memory_turns: int
    default_delegate_cognition_to_clerk: bool = False
