"""Authentication, Password Hashing (Argon2id), WebAuthn Passkeys, and 24h Sliding Sessions."""

from __future__ import annotations

import hashlib
import secrets
import string
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, Header, HTTPException, Request
import webauthn
from webauthn.helpers import (
    base64url_to_bytes,
    bytes_to_base64url,
    options_to_json_dict,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import settings
from app.db.repository import CantinaRepository
from app.providers.local_relay import relay_user_context
from app.schemas.auth import UserProfile

SESSION_COOKIE_NAME = "cantina_session"
SESSION_IDLE_TIMEOUT_SECONDS = 24 * 60 * 60  # 24 hours of inactivity
CHALLENGE_TTL_SECONDS = 300  # 5 minutes for WebAuthn challenges

_ph = PasswordHasher()


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password using Argon2id."""
    return _ph.hash(plain_password)


def verify_password(plain_password: str, password_hash: str | None) -> bool:
    """Verify a plaintext password against a stored Argon2id hash."""
    if not password_hash:
        return False
    try:
        return _ph.verify(password_hash, plain_password)
    except (VerifyMismatchError, Exception):
        return False


def generate_session_token() -> tuple[str, str]:
    """Generate a cryptographically random raw session token and its SHA-256 hex digest."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_session_token(raw_token)
    return raw_token, token_hash


def hash_session_token(raw_token: str) -> str:
    """Compute SHA-256 hex digest of a raw session token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def generate_random_password(length: int = 16) -> str:
    """Generate a strong, readable random password for admin password resets."""
    alphabet = string.ascii_letters + string.digits + "!@#$%&*"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in pwd)
            and any(c.isupper() for c in pwd)
            and any(c.isdigit() for c in pwd)
            and any(c in "!@#$%&*" for c in pwd)
        ):
            return pwd


@dataclass
class PendingWebAuthnChallenge:
    challenge_id: str
    challenge_bytes: bytes
    rp_id: str
    origin: str
    user_id: str | None
    friendly_name: str
    replace_credential_id: str | None
    created_at_epoch: float


def _store_challenge(pending: PendingWebAuthnChallenge) -> None:
    """Persist a pending challenge to SQLite (single source of truth shared by all workers)."""
    CantinaRepository(settings.db_path).save_webauthn_challenge(
        challenge_id=pending.challenge_id,
        challenge_bytes=pending.challenge_bytes,
        rp_id=pending.rp_id,
        origin=pending.origin,
        user_id=pending.user_id,
        friendly_name=pending.friendly_name,
        replace_credential_id=pending.replace_credential_id,
        created_at_epoch=pending.created_at_epoch,
        ttl_seconds=CHALLENGE_TTL_SECONDS,
    )


def _consume_challenge(challenge_id: str) -> PendingWebAuthnChallenge | None:
    """Atomically fetch and delete a pending challenge (single use). Returns None if missing or expired."""
    row = CantinaRepository(settings.db_path).pop_webauthn_challenge(
        challenge_id, ttl_seconds=CHALLENGE_TTL_SECONDS
    )
    if not row:
        return None
    return PendingWebAuthnChallenge(
        challenge_id=row["challenge_id"],
        challenge_bytes=row["challenge_bytes"],
        rp_id=row["rp_id"],
        origin=row["origin"],
        user_id=row["user_id"],
        friendly_name=row["friendly_name"],
        replace_credential_id=row["replace_credential_id"],
        created_at_epoch=row["created_at_epoch"],
    )


def resolve_rp_id_and_origin(request: Request) -> tuple[str, str]:
    """Extract WebAuthn Relying Party ID (hostname) and Origin from the HTTP request."""
    origin = request.headers.get("origin")
    if origin:
        parsed = urlparse(origin)
        rp_id = parsed.hostname or "localhost"
        return rp_id, origin

    host_header = request.headers.get("host", "localhost:5173")
    hostname = host_header.split(":")[0] or "localhost"
    scheme = request.url.scheme or "http"
    return hostname, f"{scheme}://{host_header}"


def create_passkey_registration_challenge(
    *,
    user: UserProfile,
    rp_id: str,
    origin: str,
    friendly_name: str = "Passkey",
    replace_credential_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Create WebAuthn PublicKeyCredentialCreationOptions and store challenge."""
    exclude_creds: list[PublicKeyCredentialDescriptor] = []
    for pk in user.passkeys:
        if replace_credential_id and pk.id == replace_credential_id:
            # Allow re-registering/renewing on the same authenticator if desired
            continue
        try:
            exclude_creds.append(
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(pk.id))
            )
        except Exception:
            continue

    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name="CyberCantina",
        user_id=user.id.encode("utf-8"),
        user_name=user.username,
        user_display_name=user.display_name or user.username,
        exclude_credentials=exclude_creds,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )

    challenge_id = f"chal_{secrets.token_urlsafe(16)}"
    pending = PendingWebAuthnChallenge(
        challenge_id=challenge_id,
        challenge_bytes=options.challenge,
        rp_id=rp_id,
        origin=origin,
        user_id=user.id,
        friendly_name=friendly_name.strip() or "Passkey",
        replace_credential_id=replace_credential_id,
        created_at_epoch=time.time(),
    )
    _store_challenge(pending)

    return challenge_id, options_to_json_dict(options)


def verify_passkey_registration(
    *,
    challenge_id: str,
    credential_payload: dict[str, Any],
) -> tuple[PendingWebAuthnChallenge, str, bytes, int, str, list[str]]:
    """Verify WebAuthn registration response and return (challenge, cred_id_b64, pubkey, sign_count, aaguid, transports)."""
    pending = _consume_challenge(challenge_id)
    if not pending or not pending.user_id:
        raise ValueError("Passkey registration challenge expired or invalid")

    verified = webauthn.verify_registration_response(
        credential=credential_payload,
        expected_challenge=pending.challenge_bytes,
        expected_rp_id=pending.rp_id,
        expected_origin=pending.origin,
        require_user_verification=False,
    )

    cred_id_b64 = bytes_to_base64url(verified.credential_id)
    transports: list[str] = []
    resp_obj = credential_payload.get("response")
    if isinstance(resp_obj, dict) and isinstance(resp_obj.get("transports"), list):
        transports = [str(t) for t in resp_obj["transports"]]

    return (
        pending,
        cred_id_b64,
        verified.credential_public_key,
        verified.sign_count,
        verified.aaguid or "",
        transports,
    )


def create_passkey_authentication_challenge(
    *,
    rp_id: str,
    origin: str,
    allowed_credential_ids: list[str] | None = None,
    user_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Create WebAuthn PublicKeyCredentialRequestOptions and store challenge."""
    allow_creds: list[PublicKeyCredentialDescriptor] | None = None
    if allowed_credential_ids:
        allow_creds = []
        for cid in allowed_credential_ids:
            try:
                allow_creds.append(
                    PublicKeyCredentialDescriptor(id=base64url_to_bytes(cid))
                )
            except Exception:
                continue

    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=allow_creds,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    challenge_id = f"chal_{secrets.token_urlsafe(16)}"
    pending = PendingWebAuthnChallenge(
        challenge_id=challenge_id,
        challenge_bytes=options.challenge,
        rp_id=rp_id,
        origin=origin,
        user_id=user_id,
        friendly_name="",
        replace_credential_id=None,
        created_at_epoch=time.time(),
    )
    _store_challenge(pending)

    return challenge_id, options_to_json_dict(options)


def verify_passkey_authentication(
    *,
    challenge_id: str,
    credential_payload: dict[str, Any],
    credential_public_key: bytes,
    credential_current_sign_count: int,
) -> int:
    """Verify WebAuthn assertion signature and return the updated sign_count."""
    pending = _consume_challenge(challenge_id)
    if not pending:
        raise ValueError("Passkey login challenge expired or invalid")

    verified = webauthn.verify_authentication_response(
        credential=credential_payload,
        expected_challenge=pending.challenge_bytes,
        expected_rp_id=pending.rp_id,
        expected_origin=pending.origin,
        credential_public_key=credential_public_key,
        credential_current_sign_count=credential_current_sign_count,
        require_user_verification=False,
    )
    return verified.new_sign_count


def extract_raw_token(
    authorization: str | None = Header(default=None),
    cantina_session: str | None = Cookie(default=None),
) -> str | None:
    """Extract raw session token from Authorization Bearer header or HttpOnly cookie."""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    if cantina_session:
        return cantina_session.strip()
    return None


def resolve_optional_user(
    repo: CantinaRepository,
    raw_token: str | None,
) -> UserProfile | None:
    """Resolve authenticated user from session token or single-user passwordless mode."""
    if raw_token:
        token_hash = hash_session_token(raw_token)
        user = repo.get_and_touch_session(
            token_hash,
            idle_timeout_seconds=SESSION_IDLE_TIMEOUT_SECONDS,
        )
        if user is not None:
            return user

    # If in single-user passwordless mode (1 admin user with no password), auto-authenticate
    if repo.is_single_user_passwordless_mode():
        return repo.get_passwordless_admin()

    return None


def get_optional_user(
    raw_token: str | None = Depends(extract_raw_token),
) -> UserProfile | None:
    repo = CantinaRepository(settings.db_path)
    user = resolve_optional_user(repo, raw_token)
    if user is not None:
        relay_user_context.set(user.id)
    return user


def get_current_user(
    raw_token: str | None = Depends(extract_raw_token),
) -> UserProfile:
    repo = CantinaRepository(settings.db_path)
    user = resolve_optional_user(repo, raw_token)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required or session expired after 24 hours of inactivity.",
        )
    relay_user_context.set(user.id)
    return user


def require_admin(
    user: UserProfile = Depends(get_current_user),
) -> UserProfile:
    if user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required.",
        )
    return user
