"""Authentication, passkeys, user profiles, and admin user management router."""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth import (
    SESSION_COOKIE_NAME,
    create_passkey_authentication_challenge,
    create_passkey_registration_challenge,
    extract_raw_token,
    generate_random_password,
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
from app.db.seed import ensure_default_seed
from app.dependencies import get_repo, issue_session_response
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
    ProfileResetDataRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    UserProfile,
)

logger = logging.getLogger("cybercantina.routers.auth")
router = APIRouter(tags=["auth"])


@router.get("/api/auth/status", response_model=AuthStatusResponse)
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


@router.post("/api/auth/setup", response_model=AuthSessionResponse)
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
    logger.info("Initial setup completed for admin user '%s'", admin_user.username)
    return issue_session_response(repo, admin_user, request, response)


@router.post("/api/auth/login", response_model=AuthSessionResponse)
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
            return issue_session_response(repo, user, request, response)
        raise HTTPException(
            status_code=401,
            detail="Password login is not configured for this account. Use a passkey or contact an administrator.",
        )

    if not verify_password(req.password, pwd_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    return issue_session_response(repo, user, request, response)


@router.post("/api/auth/register", response_model=AuthSessionResponse)
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

    logger.info("Registered new user '%s'", user.username)
    return issue_session_response(repo, user, request, response)


@router.post("/api/auth/logout")
def logout_user(
    response: Response,
    raw_token: str | None = Depends(extract_raw_token),
) -> dict[str, str]:
    repo = get_repo()
    if raw_token:
        repo.delete_session(hash_session_token(raw_token))
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"status": "logged_out"}


@router.post("/api/auth/passkey/login/start", response_model=PasskeyLoginStartResponse)
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


@router.post("/api/auth/passkey/login/finish", response_model=AuthSessionResponse)
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
    return issue_session_response(repo, user, request, response)


@router.get("/api/profile", response_model=UserProfile)
def get_my_profile(
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    return current_user


@router.put("/api/profile", response_model=UserProfile)
def update_my_profile(
    req: ProfileUpdateRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    repo = get_repo()
    try:
        return repo.update_user_display_name(current_user.id, req.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/profile/password", response_model=AuthStatusResponse)
def change_my_password(
    req: ChangePasswordRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> AuthStatusResponse:
    repo = get_repo()
    existing_hash = repo.get_user_password_hash(current_user.id)

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


@router.post(
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


@router.post("/api/profile/passkeys/register/finish", response_model=UserProfile)
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


@router.post("/api/profile/passkeys/{credential_id}/delete", response_model=UserProfile)
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


@router.post("/api/profile/reset-data")
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
    logger.info("Reset all data for user '%s'", current_user.username)
    return {
        "status": "ok",
        "message": "All user data (characters, worlds, and campaigns) has been reset.",
    }


@router.delete("/api/profile")
@router.post("/api/profile/delete")
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
    logger.info("Deleted account for user '%s'", current_user.username)
    return {"status": "deleted"}


# ------------------------------------------------------------------
# Admin Area Endpoints
# ------------------------------------------------------------------


@router.get("/api/admin/users", response_model=list[UserProfile])
def admin_list_users(
    q: str | None = None,
    _admin: UserProfile = Depends(require_admin),
) -> list[UserProfile]:
    return get_repo().list_users(search_query=q)


@router.post("/api/admin/users", response_model=UserProfile)
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


@router.put("/api/admin/users/{user_id}/username", response_model=UserProfile)
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


@router.post(
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


@router.delete("/api/admin/users/{user_id}")
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
