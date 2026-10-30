"""FastAPI entrypoint and 4-Phase Turn Orchestrator for CyberCantina."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth import (
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TIMEOUT_SECONDS,
    create_passkey_authentication_challenge,
    create_passkey_registration_challenge,
    extract_raw_token,
    generate_random_password,
    generate_session_token,
    get_current_user,
    get_optional_user,
    hash_password,
    hash_session_token,
    require_admin,
    resolve_rp_id_and_origin,
    verify_passkey_authentication,
    verify_passkey_registration,
    verify_password,
)
from app.config import AppSettings, ModelProfile, persist_settings, settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.llm_client import (
    OllamaStatusResponse,
    auto_configure_ollama_models,
    query_ollama_status,
)
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import assemble_four_zone_messages, was_character_present_on_turn
from app.engine.phase3_actor import generate_clerk_cognition, stream_phase3_actor
from app.engine.phase4_clerk import run_phase4_post_turn_clerk
from app.prompts import FACTORY_DEFAULT_PROMPTS, PROMPTS_METADATA
from app.schemas.auth import (
    AdminChangeUsernameRequest,
    AdminCreateUserRequest,
    AdminResetPasswordResponse,
    AuthSessionResponse,
    AuthStatusResponse,
    ChangePasswordRequest,
    InitialSetupRequest,
    LoginRequest,
    PasskeyDeleteRequest,
    PasskeyLoginFinishRequest,
    PasskeyLoginStartRequest,
    PasskeyLoginStartResponse,
    PasskeyRegisterFinishRequest,
    PasskeyRegisterStartRequest,
    PasskeyRegisterStartResponse,
    ProfileDeleteAccountRequest,
    ProfileModelSettingsResponse,
    ProfileResetDataRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    UserModelSettingsPayload,
    UserProfile,
)
from app.schemas.note import (
    UserNoteCreatePayload,
    UserNoteRecord,
    UserNoteUpdatePayload,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    CharacterWizardSeed,
    CognitionBlock,
)
from app.schemas.prompt import (
    PromptDefaultsResponse,
    PromptMetadata,
    PromptPresetCreatePayload,
    PromptPresetRecord,
    PromptPresetUpdatePayload,
)
from app.schemas.turn import (
    CampaignCharacterMemoriesUpdateRequest,
    CampaignRecord,
    CampaignStateBundle,
    MechanicsTrigger,
    PreTurnAnalysis,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.schemas.world import (
    WorldMapDraft,
    WorldMapReimagineRequest,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
    WorldWizardSeed,
)
from app.wizards.character_wizard import generate_character_draft
from app.wizards.world_wizard import generate_world_draft, reimagine_world_map


def get_repo() -> CantinaRepository:
    return CantinaRepository(settings.db_path)


def run_entity_pruner() -> dict[str, list[str]]:
    """Prune any characters and worlds marked pending_deletion that are no longer referenced by any campaign."""
    repo = get_repo()
    return {
        "pruned_characters": repo.prune_pending_deletion_characters(),
        "pruned_worlds": repo.prune_pending_deletion_worlds(),
    }


async def _periodic_entity_pruner(interval_seconds: float = 60.0) -> None:
    """Background task that periodically prunes unreferenced soft-deleted characters and worlds."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            run_entity_pruner()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    repo = get_repo()
    repo.init_db()
    run_entity_pruner()
    ensure_default_seed(repo)
    users = repo.list_users()
    if users:
        admin = next((u for u in users if u.role == "admin"), users[0])
        repo.claim_unowned_entities(admin.id)
    await auto_configure_ollama_models()
    pruner_task = asyncio.create_task(_periodic_entity_pruner())
    try:
        yield
    finally:
        pruner_task.cancel()
        with suppress(asyncio.CancelledError):
            await pruner_task


app = FastAPI(
    title="CyberCantina Agentic Roleplay API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CampaignCreateRequest(BaseModel):
    name: str
    world_id: str
    character_id: str
    character_ids: list[str] | None = None
    character_locations: dict[str, str] | None = None
    opening_prose: str | None = None


class CampaignAddCharacterRequest(BaseModel):
    character_id: str
    location_id: str | None = None


class BranchCheckoutRequest(BaseModel):
    turn_id: str


class LocationOverrideRequest(BaseModel):
    location_id: str


class ItemEquipToggleRequest(BaseModel):
    item: str
    action: Literal["equip", "unequip", "remove", "add"]
    target: Literal["equipped", "inventory"] | None = None
    character_id: str | None = None


class LinkedLocationCreateRequest(BaseModel):
    from_location_id: str
    name: str
    compass_direction: str
    travel_minutes: int = 2
    description: str
    environmental_tags: list[str] = []


class CharacterCommitRequest(BaseModel):
    draft: CharacterWizardDraft
    world_id: str | None = None


def _issue_session_response(
    repo: CantinaRepository,
    user: UserProfile,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    raw_token, token_hash = generate_session_token()
    ua = request.headers.get("user-agent", "")
    ip = request.client.host if request.client else ""
    repo.create_session(
        session_id_hash=token_hash,
        user_id=user.id,
        user_agent=ua,
        ip_address=ip,
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_IDLE_TIMEOUT_SECONDS * 30,
        path="/",
    )
    return AuthSessionResponse(
        token=raw_token,
        user=user,
        single_user_mode=repo.is_single_user_passwordless_mode(),
    )


# ------------------------------------------------------------------
# Authentication, Setup, Passkeys, Profile & Admin
# ------------------------------------------------------------------


@app.get("/api/auth/status", response_model=AuthStatusResponse)
def get_auth_status(
    current_user: UserProfile | None = Depends(get_optional_user),
) -> AuthStatusResponse:
    repo = get_repo()
    user_count = repo.count_users()
    setup_required = user_count == 0
    single_user_mode = repo.is_single_user_passwordless_mode()
    return AuthStatusResponse(
        setup_required=setup_required,
        single_user_mode=single_user_mode,
        authenticated=current_user is not None,
        user=current_user,
    )


@app.post("/api/auth/setup", response_model=AuthSessionResponse)
def initial_setup(
    req: InitialSetupRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    repo = get_repo()
    if repo.count_users() > 0:
        raise HTTPException(
            status_code=403,
            detail="Initial setup has already been completed.",
        )

    clean_username = req.username.strip()
    if not clean_username:
        raise HTTPException(status_code=400, detail="Username is required.")

    if not req.password and not req.confirm_blank_password:
        raise HTTPException(
            status_code=400,
            detail=(
                "Leaving the admin user's password blank will disable multi-user support. "
                "Please confirm to proceed."
            ),
        )

    pwd_hash = hash_password(req.password) if req.password else None
    try:
        admin_user = repo.create_user(
            username=clean_username,
            display_name=req.display_name or clean_username,
            password_hash=pwd_hash,
            role="admin",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ensure_default_seed(repo, owner_id=admin_user.id)
    repo.claim_unowned_entities(admin_user.id)
    return _issue_session_response(repo, admin_user, request, response)


@app.post("/api/auth/login", response_model=AuthSessionResponse)
def login_with_password(
    req: LoginRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    repo = get_repo()
    try:
        user = repo.get_user_by_username(req.username)
    except KeyError as exc:
        raise HTTPException(
            status_code=401, detail="Invalid username or password."
        ) from exc

    pwd_hash = repo.get_user_password_hash(user.id)
    if pwd_hash is None:
        if repo.is_single_user_passwordless_mode():
            return _issue_session_response(repo, user, request, response)
        raise HTTPException(
            status_code=401,
            detail="Password login is not configured for this account. Use a passkey or contact an administrator.",
        )

    if not verify_password(req.password, pwd_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    return _issue_session_response(repo, user, request, response)


@app.post("/api/auth/register", response_model=AuthSessionResponse)
def register_user(
    req: RegisterRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    repo = get_repo()
    if repo.count_users() == 0:
        raise HTTPException(
            status_code=400,
            detail="Complete initial administrator setup before registering accounts.",
        )
    if repo.is_single_user_passwordless_mode():
        raise HTTPException(
            status_code=403,
            detail="Multi-user support is disabled while the admin account has no password.",
        )
    if not req.password:
        raise HTTPException(
            status_code=400,
            detail="A password is required for new user accounts.",
        )

    pwd_hash = hash_password(req.password)
    try:
        user = repo.create_user(
            username=req.username,
            display_name=req.display_name or req.username,
            password_hash=pwd_hash,
            role="user",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _issue_session_response(repo, user, request, response)


@app.post("/api/auth/logout")
def logout_user(
    response: Response,
    raw_token: str | None = Depends(extract_raw_token),
) -> dict[str, str]:
    repo = get_repo()
    if raw_token:
        repo.delete_session(hash_session_token(raw_token))
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@app.post("/api/auth/passkey/login/start", response_model=PasskeyLoginStartResponse)
def start_passkey_login(
    req: PasskeyLoginStartRequest,
    request: Request,
) -> PasskeyLoginStartResponse:
    repo = get_repo()
    rp_id, origin = resolve_rp_id_and_origin(request)
    allowed_ids: list[str] | None = None
    target_user_id: str | None = None

    if req.username and req.username.strip():
        try:
            user = repo.get_user_by_username(req.username.strip())
        except KeyError as exc:
            raise HTTPException(
                status_code=404, detail=f"User '{req.username.strip()}' not found."
            ) from exc
        if not user.passkeys:
            raise HTTPException(
                status_code=400,
                detail=f"User '{user.username}' has no registered passkeys.",
            )
        allowed_ids = [pk.id for pk in user.passkeys]
        target_user_id = user.id

    challenge_id, options = create_passkey_authentication_challenge(
        rp_id=rp_id,
        origin=origin,
        allowed_credential_ids=allowed_ids,
        user_id=target_user_id,
    )
    return PasskeyLoginStartResponse(challenge_id=challenge_id, options=options)


@app.post("/api/auth/passkey/login/finish", response_model=AuthSessionResponse)
def finish_passkey_login(
    req: PasskeyLoginFinishRequest,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    repo = get_repo()
    cred_id = str(req.credential.get("id", "")).strip()
    if not cred_id:
        raise HTTPException(status_code=400, detail="Missing credential ID in assertion.")

    try:
        _pk_info, user_id, pub_key_bytes, sign_count = repo.get_passkey_record(cred_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=401, detail="Passkey credential not recognized."
        ) from exc

    try:
        new_sign_count = verify_passkey_authentication(
            challenge_id=req.challenge_id,
            credential_payload=req.credential,
            credential_public_key=pub_key_bytes,
            credential_current_sign_count=sign_count,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=401, detail=f"Passkey verification failed: {exc}"
        ) from exc

    repo.update_passkey_sign_count(cred_id, new_sign_count)
    user = repo.get_user_by_id(user_id)
    return _issue_session_response(repo, user, request, response)


# ------------------------------------------------------------------
# User Profile & Passkey Management
# ------------------------------------------------------------------


@app.get("/api/profile", response_model=UserProfile)
def get_my_profile(
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    return current_user


@app.put("/api/profile", response_model=UserProfile)
def update_my_profile(
    req: ProfileUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    repo = get_repo()
    try:
        return repo.update_user_display_name(current_user.id, req.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/profile/password", response_model=AuthStatusResponse)
def change_my_password(
    req: ChangePasswordRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> AuthStatusResponse:
    repo = get_repo()
    existing_hash = repo.get_user_password_hash(current_user.id)

    # Confirm current password before password changes are made (if account already has a password)
    if existing_hash is not None:
        if not verify_password(req.current_password, existing_hash):
            raise HTTPException(
                status_code=400,
                detail="Current password confirmation failed.",
            )

    if not req.new_password:
        if current_user.role != "admin":
            raise HTTPException(
                status_code=400,
                detail="Standard user accounts cannot have a blank password.",
            )
        if repo.count_users() > 1:
            raise HTTPException(
                status_code=400,
                detail="Admin accounts cannot have a blank password while other users exist in the system.",
            )
        if not req.confirm_blank_password:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Leaving the admin user's password blank will disable multi-user support. "
                    "Please confirm to proceed."
                ),
            )
        new_hash = None
    else:
        new_hash = hash_password(req.new_password)

    try:
        updated_user = repo.update_user_password_hash(current_user.id, new_hash)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AuthStatusResponse(
        setup_required=False,
        single_user_mode=repo.is_single_user_passwordless_mode(),
        authenticated=True,
        user=updated_user,
    )


@app.post(
    "/api/profile/passkeys/register/start",
    response_model=PasskeyRegisterStartResponse,
)
def start_passkey_registration(
    req: PasskeyRegisterStartRequest,
    request: Request,
    current_user: UserProfile = Depends(get_current_user),
) -> PasskeyRegisterStartResponse:
    repo = get_repo()
    existing_hash = repo.get_user_password_hash(current_user.id)
    if existing_hash is None:
        raise HTTPException(
            status_code=400,
            detail="Set an account password before registering or renewing passkeys.",
        )
    if not verify_password(req.current_password, existing_hash):
        raise HTTPException(
            status_code=400,
            detail="Current password confirmation failed.",
        )

    if req.replace_credential_id:
        owned_ids = {pk.id for pk in current_user.passkeys}
        if req.replace_credential_id not in owned_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Passkey '{req.replace_credential_id}' not found on your account.",
            )

    rp_id, origin = resolve_rp_id_and_origin(request)
    challenge_id, options = create_passkey_registration_challenge(
        user=current_user,
        rp_id=rp_id,
        origin=origin,
        friendly_name=req.friendly_name,
        replace_credential_id=req.replace_credential_id,
    )
    return PasskeyRegisterStartResponse(challenge_id=challenge_id, options=options)


@app.post("/api/profile/passkeys/register/finish", response_model=UserProfile)
def finish_passkey_registration(
    req: PasskeyRegisterFinishRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    repo = get_repo()
    try:
        (
            pending,
            cred_id_b64,
            pub_key_bytes,
            sign_count,
            aaguid,
            transports,
        ) = verify_passkey_registration(
            challenge_id=req.challenge_id,
            credential_payload=req.credential,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Passkey registration verification failed: {exc}",
        ) from exc

    if pending.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Passkey challenge user mismatch.")

    repo.add_passkey(
        credential_id=cred_id_b64,
        user_id=current_user.id,
        friendly_name=pending.friendly_name,
        public_key=pub_key_bytes,
        sign_count=sign_count,
        transports=transports,
        aaguid=aaguid,
        replace_credential_id=pending.replace_credential_id,
    )
    return repo.get_user_by_id(current_user.id)


@app.post("/api/profile/passkeys/{credential_id}/delete", response_model=UserProfile)
def delete_my_passkey(
    credential_id: str,
    req: PasskeyDeleteRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    repo = get_repo()
    existing_hash = repo.get_user_password_hash(current_user.id)
    if existing_hash is not None and not verify_password(
        req.current_password, existing_hash
    ):
        raise HTTPException(
            status_code=400,
            detail="Current password confirmation failed.",
        )
    try:
        repo.delete_passkey(current_user.id, credential_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return repo.get_user_by_id(current_user.id)


@app.post("/api/profile/reset-data")
def reset_my_data(
    req: ProfileResetDataRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str]:
    repo = get_repo()
    pwd_hash = repo.get_user_password_hash(current_user.id)
    if pwd_hash is not None and not verify_password(req.current_password, pwd_hash):
        raise HTTPException(
            status_code=400,
            detail="Current password confirmation failed.",
        )
    repo.reset_user_data(current_user.id)
    return {
        "status": "ok",
        "message": "All user data (characters, worlds, and campaigns) has been reset.",
    }


@app.delete("/api/profile")
@app.post("/api/profile/delete")
def delete_my_account(
    req: ProfileDeleteAccountRequest,
    response: Response,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str]:
    repo = get_repo()
    if current_user.role == "admin":
        if repo.count_admin_users() <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the only remaining administrator account. At least 1 admin user must remain in the system.",
            )
    pwd_hash = repo.get_user_password_hash(current_user.id)
    if pwd_hash is not None and not verify_password(req.current_password, pwd_hash):
        raise HTTPException(
            status_code=400,
            detail="Current password confirmation failed.",
        )
    repo.delete_user(current_user.id)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "deleted"}


# ------------------------------------------------------------------
# Per-User Model Overrides & Effective Settings Resolution
# ------------------------------------------------------------------


def get_effective_user_model_settings(
    user_id: str | None,
) -> tuple[ModelProfile, ModelProfile, int, bool, int]:
    """Resolve effective (actor_profile, clerk_profile, working_memory_turns, delegate_cognition_to_clerk, max_scene_flags) for a user.

    If overrides are enabled in system settings and the user has saved custom settings,
    those take precedence. Otherwise, defaults from AppSettings are returned.
    """
    default_actor = settings.actor_profile
    default_clerk = settings.clerk_profile
    default_wm_turns = settings.memory_config.working_memory_turns
    default_delegate = settings.delegate_cognition_to_clerk
    default_max_flags = settings.memory_config.max_scene_flags

    if not settings.allow_user_model_overrides or not user_id:
        return default_actor, default_clerk, default_wm_turns, default_delegate, default_max_flags

    user_settings = get_repo().get_user_model_settings(user_id)
    if not user_settings:
        return default_actor, default_clerk, default_wm_turns, default_delegate, default_max_flags

    effective_actor = user_settings.actor_profile or default_actor
    effective_clerk = user_settings.clerk_profile or default_clerk
    effective_wm_turns = (
        user_settings.working_memory_turns
        if user_settings.working_memory_turns is not None
        else default_wm_turns
    )
    effective_delegate = (
        user_settings.delegate_cognition_to_clerk
        if user_settings.delegate_cognition_to_clerk is not None
        else default_delegate
    )
    effective_max_flags = (
        user_settings.max_scene_flags
        if user_settings.max_scene_flags is not None
        else default_max_flags
    )
    return effective_actor, effective_clerk, effective_wm_turns, effective_delegate, effective_max_flags


@app.get("/api/profile/models", response_model=ProfileModelSettingsResponse)
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


@app.put("/api/profile/models", response_model=ProfileModelSettingsResponse)
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
    repo.save_user_model_settings(current_user.id, payload)
    return get_profile_models(current_user=current_user)


@app.delete("/api/profile/models", response_model=ProfileModelSettingsResponse)
def reset_profile_models(
    current_user: UserProfile = Depends(get_current_user),
) -> ProfileModelSettingsResponse:
    repo = get_repo()
    repo.delete_user_model_settings(current_user.id)
    return get_profile_models(current_user=current_user)


# ------------------------------------------------------------------
# Prompt Presets & Template Customization Endpoints
# ------------------------------------------------------------------


class SetCampaignPresetRequest(BaseModel):
    preset_id: str | None = None


@app.get("/api/prompts/defaults", response_model=PromptDefaultsResponse)
def get_prompt_defaults(
    current_user: UserProfile | None = Depends(get_optional_user),
) -> PromptDefaultsResponse:
    """Return factory defaults, template documentation/variables, and available presets."""
    repo = get_repo()
    presets = repo.list_prompt_presets(user_id=current_user.id if current_user else None)
    return PromptDefaultsResponse(
        presets=presets,
        defaults=dict(FACTORY_DEFAULT_PROMPTS),
        metadata=[PromptMetadata.model_validate(m) for m in PROMPTS_METADATA],
    )


@app.get("/api/prompts/presets", response_model=list[PromptPresetRecord])
def list_prompt_presets(
    current_user: UserProfile | None = Depends(get_optional_user),
) -> list[PromptPresetRecord]:
    """List all presets accessible to the current user (built-in + owned)."""
    repo = get_repo()
    return repo.list_prompt_presets(user_id=current_user.id if current_user else None)


@app.get("/api/prompts/presets/{preset_id}", response_model=PromptPresetRecord)
def get_prompt_preset(
    preset_id: str,
    current_user: UserProfile | None = Depends(get_optional_user),
) -> PromptPresetRecord:
    """Fetch details of a single prompt preset."""
    repo = get_repo()
    preset = repo.get_prompt_preset(preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
    return preset


@app.post("/api/prompts/presets", response_model=PromptPresetRecord)
def create_prompt_preset(
    payload: PromptPresetCreatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Create a new custom prompt preset (optionally cloned from an existing preset)."""
    repo = get_repo()
    base_prompts: dict[str, str] = {}
    if payload.base_preset_id:
        base = repo.get_prompt_preset(payload.base_preset_id)
        if base:
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


@app.put("/api/prompts/presets/{preset_id}", response_model=PromptPresetRecord)
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
            user_id=current_user.id if current_user.role != "admin" else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.delete("/api/prompts/presets/{preset_id}")
def delete_prompt_preset(
    preset_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete a custom prompt preset."""
    repo = get_repo()
    try:
        deleted = repo.delete_prompt_preset(
            preset_id,
            user_id=current_user.id if current_user.role != "admin" else None,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Preset '{preset_id}' not found")
        return {"status": "deleted", "id": preset_id}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/api/prompts/presets/{preset_id}/reset", response_model=PromptPresetRecord)
def reset_prompt_preset(
    preset_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> PromptPresetRecord:
    """Reset a custom prompt preset back to factory default prompt templates."""
    repo = get_repo()
    try:
        return repo.reset_prompt_preset(
            preset_id,
            user_id=current_user.id if current_user.role != "admin" else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.put("/api/campaigns/{campaign_id}/prompt-preset", response_model=CampaignRecord)
def set_campaign_prompt_preset(
    campaign_id: str,
    payload: SetCampaignPresetRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignRecord:
    """Assign or clear an active prompt preset on a specific campaign."""
    repo = get_repo()
    try:
        return repo.set_campaign_prompt_preset(
            campaign_id,
            payload.preset_id,
            owner_id=current_user.id if current_user.role != "admin" else None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ------------------------------------------------------------------
# User Notes (Private Player Scratchpad)
# ------------------------------------------------------------------


@app.get("/api/notes", response_model=list[UserNoteRecord])
def list_my_notes(
    current_user: UserProfile = Depends(get_current_user),
) -> list[UserNoteRecord]:
    """List all private notes created by the current user, ordered by starred first, then updated_at."""
    repo = get_repo()
    return repo.list_user_notes(current_user.id)


@app.post("/api/notes", response_model=UserNoteRecord)
def create_my_note(
    payload: UserNoteCreatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Create a new private note for the current user."""
    repo = get_repo()
    return repo.create_user_note(
        owner_id=current_user.id,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        is_starred=payload.is_starred,
    )


@app.get("/api/notes/{note_id}", response_model=UserNoteRecord)
def get_my_note(
    note_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Get a single private note."""
    repo = get_repo()
    note = repo.get_user_note(note_id, current_user.id)
    if not note:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return note


@app.put("/api/notes/{note_id}", response_model=UserNoteRecord)
def update_my_note(
    note_id: str,
    payload: UserNoteUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> UserNoteRecord:
    """Update title, content, tags, or starred status of a private note."""
    repo = get_repo()
    updated = repo.update_user_note(
        note_id=note_id,
        owner_id=current_user.id,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
        is_starred=payload.is_starred,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return updated


@app.delete("/api/notes/{note_id}")
def delete_my_note(
    note_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, Any]:
    """Delete a private note."""
    repo = get_repo()
    deleted = repo.delete_user_note(note_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Note '{note_id}' not found")
    return {"status": "deleted", "id": note_id}


# ------------------------------------------------------------------
# Admin Area Endpoints
# ------------------------------------------------------------------


@app.get("/api/admin/users", response_model=list[UserProfile])
def admin_list_users(
    q: str | None = None,
    _admin: UserProfile = Depends(require_admin),
) -> list[UserProfile]:
    return get_repo().list_users(search_query=q)


@app.post("/api/admin/users", response_model=UserProfile)
def admin_create_user(
    req: AdminCreateUserRequest,
    _admin: UserProfile = Depends(require_admin),
) -> UserProfile:
    repo = get_repo()
    if repo.is_single_user_passwordless_mode():
        raise HTTPException(
            status_code=403,
            detail="Cannot create additional users while the admin account has a blank password.",
        )
    if not req.password:
        raise HTTPException(
            status_code=400,
            detail="A password is required when creating a user account.",
        )
    pwd_hash = hash_password(req.password)
    try:
        return repo.create_user(
            username=req.username,
            display_name=req.display_name or req.username,
            password_hash=pwd_hash,
            role=req.role,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/admin/users/{user_id}/username", response_model=UserProfile)
def admin_change_username(
    user_id: str,
    req: AdminChangeUsernameRequest,
    _admin: UserProfile = Depends(require_admin),
) -> UserProfile:
    repo = get_repo()
    try:
        return repo.update_user_username(user_id, req.username)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post(
    "/api/admin/users/{user_id}/reset-password",
    response_model=AdminResetPasswordResponse,
)
def admin_reset_user_password(
    user_id: str,
    admin_user: UserProfile = Depends(require_admin),
    raw_token: str | None = Depends(extract_raw_token),
) -> AdminResetPasswordResponse:
    repo = get_repo()
    generated_pwd = generate_random_password(16)
    pwd_hash = hash_password(generated_pwd)
    try:
        updated = repo.update_user_password_hash(user_id, pwd_hash)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    keep_hash = (
        hash_session_token(raw_token)
        if (raw_token and user_id == admin_user.id)
        else None
    )
    repo.delete_all_user_sessions(user_id, except_session_hash=keep_hash)
    return AdminResetPasswordResponse(
        user=updated,
        generated_password=generated_pwd,
    )


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: str,
    response: Response,
    admin_user: UserProfile = Depends(require_admin),
) -> dict[str, str]:
    repo = get_repo()
    try:
        target_user = repo.get_user_by_id(user_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if target_user.role == "admin":
        if repo.count_admin_users() <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the only remaining administrator account. At least 1 admin user must remain in the system.",
            )

    repo.delete_user(user_id)
    if user_id == admin_user.id:
        response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "deleted", "user_id": user_id}


# ------------------------------------------------------------------
# Settings & Health
# ------------------------------------------------------------------


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "cybercantina-backend"}


@app.get("/api/ollama/status", response_model=OllamaStatusResponse)
async def get_ollama_status(base_url: str | None = None) -> OllamaStatusResponse:
    return await query_ollama_status(base_url)


@app.get("/api/settings", response_model=AppSettings)
def get_settings(
    _user: UserProfile = Depends(get_current_user),
) -> AppSettings:
    return settings


@app.put("/api/settings", response_model=AppSettings)
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
    return settings


# ------------------------------------------------------------------
# Worlds & 1.2 World Creation Wizard
# ------------------------------------------------------------------


@app.get("/api/worlds", response_model=list[WorldRecord])
def list_worlds(
    current_user: UserProfile = Depends(get_current_user),
) -> list[WorldRecord]:
    return get_repo().list_worlds(owner_id=current_user.id)


@app.get("/api/worlds/{world_id}", response_model=WorldRecord)
def get_world(
    world_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    try:
        return get_repo().get_world(world_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/wizards/world/draft", response_model=WorldWizardDraft)
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


@app.post("/api/wizards/world/reimagine-map", response_model=WorldMapDraft)
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


@app.post("/api/wizards/world/commit", response_model=WorldRecord)
async def wizard_commit_world(
    draft: WorldWizardDraft,
    current_user: UserProfile = Depends(get_current_user),
) -> WorldRecord:
    return await get_repo().acreate_world_from_draft(draft, owner_id=current_user.id)


@app.put("/api/worlds/{world_id}", response_model=WorldRecord)
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


@app.delete("/api/worlds/{world_id}")
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


# ------------------------------------------------------------------
# Characters & 1.1 Character Creation Wizard
# ------------------------------------------------------------------


@app.get("/api/characters", response_model=list[CharacterRecord])
def list_characters(
    current_user: UserProfile = Depends(get_current_user),
) -> list[CharacterRecord]:
    return get_repo().list_characters(owner_id=current_user.id)


@app.get("/api/characters/{character_id}", response_model=CharacterRecord)
def get_character(
    character_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    try:
        return get_repo().get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/wizards/character/draft", response_model=CharacterWizardDraft)
async def wizard_draft_character(
    seed: CharacterWizardSeed,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterWizardDraft:
    repo = get_repo()
    world = None
    if seed.world_id:
        try:
            world = repo.get_world(seed.world_id, owner_id=current_user.id)
        except KeyError:
            world = None
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    effective_prompts = repo.resolve_effective_prompts(user_id=current_user.id)
    try:
        return await generate_character_draft(
            seed,
            world=world,
            profile=eff_actor,
            prompt_template=effective_prompts.get("wizard_character_system"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/wizards/character/commit", response_model=CharacterRecord)
async def wizard_commit_character(
    req: CharacterCommitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    return await get_repo().acreate_character_from_draft(
        req.draft, world_id=req.world_id, owner_id=current_user.id
    )


@app.put("/api/characters/{character_id}", response_model=CharacterRecord)
async def update_character(
    character_id: str,
    payload: CharacterUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Update a character in-place if unused, or silently fork a new version if used by campaigns."""
    try:
        return await get_repo().aupdate_character(
            character_id, payload, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/characters/{character_id}")
def delete_character(
    character_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, int | str | bool]:
    """Mark a character as pending deletion (hiding it from the UI) and trigger background pruning."""
    repo = get_repo()
    try:
        result = repo.mark_character_pending_deletion(
            character_id, owner_id=current_user.id
        )
        background_tasks.add_task(run_entity_pruner)
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ------------------------------------------------------------------
# Campaigns & Branching Turn Tree
# ------------------------------------------------------------------


@app.get("/api/campaigns", response_model=list[CampaignRecord])
def list_campaigns(
    current_user: UserProfile = Depends(get_current_user),
) -> list[CampaignRecord]:
    return get_repo().list_campaigns(owner_id=current_user.id)


@app.post("/api/campaigns", response_model=CampaignStateBundle)
def create_campaign(
    req: CampaignCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    repo = get_repo()
    try:
        camp = repo.create_campaign(
            name=req.name,
            world_id=req.world_id,
            character_id=req.character_id,
            character_ids=req.character_ids,
            character_locations=req.character_locations,
            opening_prose=req.opening_prose,
            owner_id=current_user.id,
        )
        return repo.get_campaign_state_bundle(camp.id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/characters", response_model=CampaignStateBundle)
def add_campaign_character(
    campaign_id: str,
    req: CampaignAddCharacterRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Add an additional character to a campaign (optionally stationed at a specific location_id)."""
    repo = get_repo()
    try:
        return repo.add_character_to_campaign(
            campaign_id=campaign_id,
            character_id=req.character_id,
            location_id=req.location_id,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str]:
    """Delete a campaign and its entire timeline, then prune any unreferenced pending_deletion characters and worlds."""
    repo = get_repo()
    try:
        repo.delete_campaign(campaign_id, owner_id=current_user.id)
        background_tasks.add_task(run_entity_pruner)
        return {"status": "deleted", "campaign_id": campaign_id}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/campaigns/{campaign_id}/state", response_model=CampaignStateBundle)
def get_campaign_state(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    try:
        return get_repo().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/checkout", response_model=CampaignStateBundle)
def checkout_campaign_branch(
    campaign_id: str,
    req: BranchCheckoutRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    try:
        return get_repo().checkout_turn_branch(
            campaign_id, req.turn_id, owner_id=current_user.id
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/locations", response_model=CampaignStateBundle)
def create_campaign_linked_location(
    campaign_id: str,
    req: LinkedLocationCreateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Manually create a new location linked to an existing one (bound to the active timeline)."""
    try:
        return get_repo().create_linked_location(
            campaign_id,
            from_location_id=req.from_location_id,
            name=req.name,
            description=req.description,
            environmental_tags=req.environmental_tags,
            compass_direction=req.compass_direction,
            travel_minutes=req.travel_minutes,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/location-override", response_model=CampaignStateBundle)
def override_campaign_location(
    campaign_id: str,
    req: LocationOverrideRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Override the current active location on the leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
    try:
        return get_repo().override_campaign_location(
            campaign_id, req.location_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/item-equip", response_model=CampaignStateBundle)
def toggle_campaign_item_equip(
    campaign_id: str,
    req: ItemEquipToggleRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Equip, unequip, remove, or add an item for a character on the active leaf turn (applies next turn)."""
    try:
        return get_repo().toggle_campaign_item_equip(
            campaign_id,
            item=req.item,
            action=req.action,
            target=req.target,
            character_id=req.character_id,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/campaigns/{campaign_id}/characters/{character_id}/memories", response_model=CampaignStateBundle)
async def update_campaign_character_memories(
    campaign_id: str,
    character_id: str,
    req: CampaignCharacterMemoriesUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Update campaign-scoped memory shards for a character (applies from next turn onwards)."""
    try:
        return await get_repo().aupdate_campaign_character_memories(
            campaign_id,
            character_id,
            memory_shards=req.memory_shards,
            owner_id=current_user.id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}/turns/last", response_model=CampaignStateBundle)
def delete_campaign_last_turn(
    campaign_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the last user message turn on the active branch, including all generated swipes."""
    try:
        return get_repo().delete_last_turn(campaign_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/campaigns/{campaign_id}/turns/{turn_id}", response_model=CampaignStateBundle)
def delete_campaign_turn(
    campaign_id: str,
    turn_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Delete the specified last user message turn (and its sibling swipes) from the campaign."""
    try:
        return get_repo().delete_last_turn(
            campaign_id, turn_id=turn_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ------------------------------------------------------------------
# 4-Phase Turn Execution Pipeline (SSE Stream & Sync REST)
# ------------------------------------------------------------------


async def _execute_turn_stream_events(
    campaign_id: str,
    req: TurnSubmitRequest,
    owner_id: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Orchestrate Phases 1, 2, 3, and 4 for a single turn, yielding structured events."""
    repo = get_repo()
    campaign = repo.get_campaign(campaign_id, owner_id=owner_id)
    parent_id = req.parent_turn_id or campaign.active_leaf_turn_id
    if not parent_id:
        raise RuntimeError(f"Campaign '{campaign_id}' has no parent turn node")

    # Resolve parent branch chain (allows instantaneous swipe/branch from any node!)
    branch_turns = repo.get_branch_turn_chain(parent_id)
    valid_turn_ids = {t.id for t in branch_turns}
    parent_turn = branch_turns[-1]

    world = repo.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
    primary_character = repo.get_character(
        campaign.character_id, campaign_id=campaign.id, valid_turn_ids=valid_turn_ids
    )
    participant_ids = campaign.participant_character_ids or [campaign.character_id]
    participants: list[CharacterRecord] = []
    for cid in participant_ids:
        try:
            participants.append(
                repo.get_character(
                    cid, campaign_id=campaign.id, valid_turn_ids=valid_turn_ids
                )
            )
        except KeyError:
            continue
    if not participants:
        participants = [primary_character]
    participants_by_id = {c.id: c for c in participants}

    parent_active_loc_id = parent_turn.world_snapshot.active_location_id
    if req.override_location_id:
        override_loc = repo.get_location(req.override_location_id)
        if override_loc.world_id == world.id:
            active_location = override_loc
            if active_location.created_at_turn_id:
                valid_turn_ids = set(valid_turn_ids) | {active_location.created_at_turn_id}
            parent_turn.world_snapshot.active_location_id = active_location.id
            for st in parent_turn.character_states.values():
                if st.current_location_id == parent_active_loc_id:
                    st.current_location_id = active_location.id
            if parent_turn.character_state.current_location_id == parent_active_loc_id:
                parent_turn.character_state.current_location_id = active_location.id
        else:
            active_location = repo.get_location(parent_active_loc_id)
    else:
        active_location = repo.get_location(parent_active_loc_id)

    neighbors = repo.get_neighbor_locations(
        world.id,
        active_location.id,
        valid_turn_ids=valid_turn_ids,
    )
    episodic_chunks = repo.get_branch_episodic_chunks(campaign.id, valid_turn_ids)

    # Filter characters physically present in active_location (room-level spatial isolation)
    present_characters = [
        c
        for c in participants
        if parent_turn.character_states.get(c.id, parent_turn.character_state).current_location_id
        == active_location.id
    ]
    if not present_characters:
        present_characters = [primary_character]

    # Collect known entity tags from lore and present characters' shards for Phase 1
    known_entities: list[str] = [c.name for c in present_characters]
    for lore in world.lore_nodes:
        known_entities.append(lore.title)
        known_entities.extend(lore.entity_tags)
    for c in present_characters:
        for shard in c.memory_shards:
            known_entities.extend(shard.keywords)
    for loc in world.locations:
        known_entities.append(loc.name)

    eff_actor, eff_clerk, eff_wm_turns, eff_delegate_cognition, eff_max_flags = get_effective_user_model_settings(owner_id)
    effective_prompts = repo.resolve_effective_prompts(user_id=owner_id, campaign_id=campaign.id)

    effective_user_message = req.user_message.strip()

    # Defense-in-depth: Auto-detect narrator mode if client omitted narrative_mode or swiped a narrator turn
    if req.narrative_mode == "standard" and effective_user_message:
        lower_msg = effective_user_message.lower()
        if lower_msg.startswith("[describe the current scene"):
            req.narrative_mode = "describe"
        elif lower_msg.startswith("[advance the story") or (
            lower_msg.startswith("[") and ("wait for" in lower_msg or "minutes elapse" in lower_msg)
        ):
            req.narrative_mode = "advance"
            if not req.duration_minutes:
                m = re.search(r"(\d+)\s*minutes?", lower_msg)
                if m:
                    req.duration_minutes = int(m.group(1))
        elif lower_msg.startswith("[introduce a complication") or lower_msg.startswith("[introduce an unexpected complication"):
            req.narrative_mode = "complication"
            dir_match = re.search(r"^\[introduce a complication:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
        elif lower_msg.startswith("[perception check") or lower_msg.startswith("[examine the scene"):
            req.narrative_mode = "perception"
            dir_match = re.search(r"^\[perception check:\s*(.*?)\]$", effective_user_message, re.IGNORECASE)
            if dir_match and not req.narrator_directive:
                req.narrator_directive = dir_match.group(1).strip()
        elif req.parent_turn_id and campaign.active_leaf_turn_id:
            try:
                active_leaf = repo.get_turn_node(campaign.active_leaf_turn_id)
                if (
                    active_leaf.parent_turn_id == req.parent_turn_id
                    and active_leaf.actor_id == "__narrator__"
                    and active_leaf.user_message.strip() == effective_user_message
                ):
                    req.narrative_mode = "custom"
                    req.narrator_directive = effective_user_message
            except KeyError:
                pass

    is_narrator = req.narrative_mode in ("describe", "advance", "complication", "perception", "custom")
    if not effective_user_message:
        if req.narrative_mode == "describe":
            effective_user_message = "[Describe the current scene]"
        elif req.narrative_mode == "advance":
            if req.duration_minutes:
                effective_user_message = f"[Advance the story: wait for {req.duration_minutes} minutes]"
            elif req.narrator_directive:
                effective_user_message = f"[Advance the story: {req.narrator_directive}]"
            else:
                effective_user_message = "[Advance the story without player action]"
        elif req.narrative_mode == "complication":
            effective_user_message = (
                f"[Introduce a complication: {req.narrator_directive}]"
                if req.narrator_directive
                else "[Introduce an unexpected complication or external event]"
            )
        elif req.narrative_mode == "perception":
            effective_user_message = (
                f"[Perception check: {req.narrator_directive}]"
                if req.narrator_directive
                else "[Examine the scene for subtle details and lore]"
            )
        elif req.narrative_mode == "custom":
            effective_user_message = req.narrator_directive or "[Director request]"
        else:
            raise HTTPException(status_code=400, detail="User message cannot be empty")

    # PHASE 1: Auxiliary Pre-Turn Analysis, Multi-Character Speaker Orchestration & RNG Mechanics
    if is_narrator:
        if req.narrative_mode == "complication":
            subtext = "Introduce an unexpected external complication or inciting incident"
            queries = [active_location.name, "hazard", "threat", "complication"] + (
                [req.narrator_directive] if req.narrator_directive else []
            )
        elif req.narrative_mode == "perception":
            subtext = "Analyze subtle perceptual markers, sensory nuances, and historical lore tied to this space"
            queries = [active_location.name, active_location.summary] + (
                [req.narrator_directive] if req.narrator_directive else []
            )
        elif req.narrative_mode == "advance":
            subtext = (
                f"Depict the passage of time ({req.duration_minutes} minutes)"
                if req.duration_minutes
                else "Depict the passage of time and shifting ambient conditions"
            )
            queries = [active_location.name, "time", "routine"]
        else:
            subtext = (
                f"Narrator direction: {req.narrator_directive}"
                if req.narrator_directive
                else "Environmental narration without player character action"
            )
            queries = [active_location.name] + ([req.narrator_directive] if req.narrator_directive else [])

        pre_turn = PreTurnAnalysis(
            user_sentiment="objective, observational",
            subtext_interpretation=subtext,
            mentioned_entities=[active_location.name],
            memory_search_queries=queries,
            spatial_intent="stay",
            active_speaker_id="__narrator__",
            speaker_order=["__narrator__"],
            mechanics_check=MechanicsTrigger(requires_roll=False),
            resolved_roll=None,
        )
        character = primary_character
        actor_id = "__narrator__"
        prev_char_state = parent_turn.character_states.get(
            primary_character.id,
            parent_turn.character_state,
        )
    else:
        pre_turn = await run_phase1_pre_analysis(
            user_message=effective_user_message,
            character=present_characters[0],
            active_location=active_location,
            neighbors=neighbors,
            known_entities=known_entities,
            manual_dice_override=req.manual_dice_override,
            present_characters=present_characters,
            previous_speaker_id=parent_turn.actor_id,
            profile=eff_clerk,
            prompt_template=effective_prompts.get("clerk_pre_turn_system"),
        )
        # Resolve active speaker selected by Phase 1 from characters present in the room
        character = (
            participants_by_id.get(pre_turn.active_speaker_id or "")
            if pre_turn.active_speaker_id in {c.id for c in present_characters}
            else None
        ) or present_characters[0]
        actor_id = character.id
        prev_char_state = parent_turn.character_states.get(
            character.id,
            CharacterStateSnapshot(
                turn_id=parent_turn.id,
                character_id=character.id,
                current_location_id=active_location.id,
                mood_label=character.baseline_psyche.mood_label,
                valence=character.baseline_psyche.valence,
                arousal=character.baseline_psyche.arousal,
                active_want=character.baseline_psyche.default_want,
                active_plan=character.baseline_psyche.default_plan,
                relationship_notes={"user": "Acquaintance / Uncertain trust"},
                equipped=list(character.equipped),
                inventory=list(character.inventory),
            ),
        )

    # Hybrid GraphRAG Memory Retrieval (filtered by valid_turn_ids & character room presence)
    character_present_turn_ids = {
        t.id for t in branch_turns if was_character_present_on_turn(t, character.id)
    }
    recalled_items = await repo.vector_store.search_memories(
        queries=pre_turn.memory_search_queries,
        mentioned_entities=pre_turn.mentioned_entities,
        world_id=world.id,
        character_id=character.id,
        campaign_id=campaign.id,
        valid_branch_turn_ids=valid_turn_ids,
        character_present_turn_ids=character_present_turn_ids,
        top_k=settings.memory_config.rag_top_k,
    )

    yield {
        "event": "phase1_complete",
        "data": {
            "pre_turn": pre_turn.model_dump(),
            "recalled_items": [m.model_dump() for m in recalled_items],
        },
    }

    # Phase 2.5: Optional Clerk-Delegated Character Cognition
    pregenerated_cognition: CognitionBlock | None = None
    if eff_delegate_cognition and not is_narrator:
        pregenerated_cognition = await generate_clerk_cognition(
            user_message=effective_user_message,
            character=character,
            previous_state=prev_char_state,
            active_location=active_location,
            neighbors=neighbors,
            recalled_items=recalled_items,
            pre_turn=pre_turn,
            profile=eff_clerk,
        )

    # PHASE 2: 4-Zone KV-Cache-Preserving Context Assembly
    messages = assemble_four_zone_messages(
        world=world,
        character=character,
        branch_turns=branch_turns,
        episodic_chunks=episodic_chunks,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        user_message=effective_user_message,
        present_characters=present_characters,
        character_name_map={c.id: c.name for c in participants},
        working_memory_turns=eff_wm_turns,
        actor_system_prompt_template=(
            effective_prompts.get("narrator_zone1_system")
            if is_narrator
            else effective_prompts.get("actor_zone1_system")
        ),
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        established_cognition=pregenerated_cognition,
    )

    # PHASE 3: Guided Single-Pass <cognition> + Narrative Prose Streaming
    final_cognition = (
        CognitionBlock(
            recall=f"Observing {active_location.name}",
            feeling="Objective / Detached",
            valence=0.0,
            arousal=0.0,
            want="Depict environment and world state neutrally",
            plan=req.narrator_directive
            or (
                "Describe scene environment"
                if req.narrative_mode == "describe"
                else (
                    "Depict unexpected complication"
                    if req.narrative_mode == "complication"
                    else (
                        "Detail subtle perceptual clues"
                        if req.narrative_mode == "perception"
                        else "Depict passage of time"
                    )
                )
            ),
        )
        if is_narrator
        else (
            pregenerated_cognition
            if pregenerated_cognition is not None
            else CognitionBlock(
                recall="",
                feeling=prev_char_state.mood_label,
                valence=prev_char_state.valence,
                arousal=prev_char_state.arousal,
                want=prev_char_state.active_want,
                plan=prev_char_state.active_plan,
                skipped=True,
            )
        )
    )
    final_prose = ""

    async for item in stream_phase3_actor(
        messages=messages,
        user_message=effective_user_message,
        character=character,
        previous_state=prev_char_state,
        active_location=active_location,
        neighbors=neighbors,
        recalled_items=recalled_items,
        pre_turn=pre_turn,
        profile=eff_actor,
        is_narrator=is_narrator,
        narrative_mode=req.narrative_mode if is_narrator else None,
        narrator_directive=req.narrator_directive if is_narrator else None,
        pregenerated_cognition=pregenerated_cognition,
    ):
        if item["event"] == "actor_finished":
            final_cognition = CognitionBlock.model_validate(item["data"]["cognition"])
            final_prose = item["data"]["raw_prose"]
        else:
            yield item

    # Persist initial Turn Node prior to Phase 4 Clerk
    new_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
    new_depth = parent_turn.depth_index + 1
    initial_world_snapshot = WorldStateSnapshot(
        turn_id=new_turn_id,
        world_timestamp=parent_turn.world_snapshot.world_timestamp,
        active_location_id=active_location.id,
        scene_flags=parent_turn.world_snapshot.scene_flags,
    )
    initial_char_state = CharacterStateSnapshot(
        turn_id=new_turn_id,
        character_id=character.id,
        current_location_id=active_location.id,
        mood_label=prev_char_state.mood_label if is_narrator else (final_cognition.feeling[:80] or prev_char_state.mood_label),
        valence=prev_char_state.valence if is_narrator else final_cognition.valence,
        arousal=prev_char_state.arousal if is_narrator else final_cognition.arousal,
        active_want=prev_char_state.active_want if is_narrator else (final_cognition.want or prev_char_state.active_want),
        active_plan=prev_char_state.active_plan if is_narrator else (final_cognition.plan or prev_char_state.active_plan),
        relationship_notes=prev_char_state.relationship_notes,
        equipped=list(prev_char_state.equipped),
        inventory=list(prev_char_state.inventory),
    )

    saved_turn = repo.save_turn_node(
        turn_id=new_turn_id,
        campaign_id=campaign.id,
        parent_turn_id=parent_turn.id,
        depth_index=new_depth,
        user_message=effective_user_message,
        actor_id=actor_id,
        raw_prose=final_prose,
        cognition=final_cognition,
        pre_turn=pre_turn,
        world_snapshot=initial_world_snapshot,
        character_state=initial_char_state,
        recalled_items=recalled_items,
    )

    yield {"event": "turn_saved", "data": saved_turn.model_dump()}

    # PHASE 4: Post-Turn Clerk (Clock, Spatial Graph Transitions, Per-Character Memories, Episodic Summarizer)
    updated_turn, _chunks = await run_phase4_post_turn_clerk(
        repo=repo,
        campaign_id=campaign.id,
        world_id=world.id,
        character=character,
        completed_turn=saved_turn,
        active_location=active_location,
        neighbors=neighbors,
        present_characters=present_characters,
        profile=eff_clerk,
        working_memory_turns=eff_wm_turns,
        max_scene_flags=eff_max_flags,
        post_turn_prompt_template=effective_prompts.get("clerk_post_turn_system"),
        summary_prompt_template=effective_prompts.get("clerk_episodic_summary_system"),
    )
    bundle = repo.get_campaign_state_bundle(campaign.id)
    yield {
        "event": "phase4_complete",
        "data": {
            "turn": updated_turn.model_dump(),
            "state_bundle": bundle.model_dump(),
        },
    }


@app.post("/api/campaigns/{campaign_id}/turns/stream")
async def stream_campaign_turn(
    campaign_id: str,
    req: TurnSubmitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> StreamingResponse:
    """SSE endpoint streaming Phase 1, Phase 3 (<cognition> + prose), and Phase 4 updates."""

    async def _sse_generator() -> AsyncIterator[str]:
        try:
            async for packet in _execute_turn_stream_events(
                campaign_id, req, owner_id=current_user.id
            ):
                ev_name = packet["event"]
                payload = json.dumps(packet["data"])
                yield f"event: {ev_name}\ndata: {payload}\n\n"
        except Exception as exc:
            err_payload = json.dumps({"error": str(exc)})
            yield f"event: error\ndata: {err_payload}\n\n"

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/campaigns/{campaign_id}/turns", response_model=CampaignStateBundle)
async def submit_campaign_turn_sync(
    campaign_id: str,
    req: TurnSubmitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CampaignStateBundle:
    """Execute all 4 phases synchronously and return the updated CampaignStateBundle."""
    try:
        final_bundle: dict[str, Any] | None = None
        async for packet in _execute_turn_stream_events(
            campaign_id, req, owner_id=current_user.id
        ):
            if packet["event"] == "phase4_complete":
                final_bundle = packet["data"]["state_bundle"]
        if final_bundle is not None:
            return CampaignStateBundle.model_validate(final_bundle)
        return get_repo().get_campaign_state_bundle(
            campaign_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
