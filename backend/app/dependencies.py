"""Shared dependency injection, configuration resolution, and media utilities."""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path

from fastapi import HTTPException, Request, Response
from PIL import Image

from app.auth import (
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TIMEOUT_SECONDS,
    generate_session_token,
)
from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.schemas.auth import AuthSessionResponse, UserProfile

logger = logging.getLogger("cybercantina.dependencies")


def get_repo() -> CantinaRepository:
    """Return a CantinaRepository instance configured with the active database and media paths."""
    return CantinaRepository(settings.db_path, media_dir=settings.media_dir)


def run_entity_pruner() -> dict[str, list[str]]:
    """Prune any characters and worlds marked pending_deletion that are no longer referenced by any campaign."""
    repo = get_repo()
    pruned_chars = repo.prune_pending_deletion_characters()
    pruned_worlds = repo.prune_pending_deletion_worlds()
    if pruned_chars or pruned_worlds:
        logger.info(
            "Pruned entities: %d characters, %d worlds",
            len(pruned_chars),
            len(pruned_worlds),
        )
    return {
        "pruned_characters": pruned_chars,
        "pruned_worlds": pruned_worlds,
    }


def get_effective_user_model_settings(
    user_id: str | None,
) -> tuple[ModelProfile, ModelProfile, int, bool, int]:
    """Resolve effective (actor_profile, clerk_profile, working_memory_turns, delegate_cognition_to_clerk, max_scene_flags) for a user."""
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


def issue_session_response(
    repo: CantinaRepository,
    user: UserProfile,
    request: Request,
    response: Response,
) -> AuthSessionResponse:
    """Issue a new session token, set the HttpOnly cookie, and return AuthSessionResponse."""
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


def safe_resolve_media_path(character_id: str, category: str, filename: str) -> Path:
    """Safely validate and resolve a media file path to prevent directory traversal."""
    if category not in ("portraits", "gallery"):
        raise HTTPException(status_code=400, detail="Invalid media category.")
    if not re.match(r"^[a-zA-Z0-9_-]+$", character_id):
        raise HTTPException(status_code=400, detail="Invalid character ID.")
    if not re.match(r"^[a-zA-Z0-9_.-]+$", filename) or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    base = Path(settings.media_dir).resolve()
    target = (base / "characters" / character_id / category / filename).resolve()
    if not target.is_relative_to(base):
        raise HTTPException(status_code=403, detail="Path traversal forbidden.")
    return target


def process_and_save_image(
    file_bytes: bytes, target_path: Path, square_crop: bool = False, max_size: int = 512
) -> None:
    """Validate, format-normalize to WebP, optionally square-crop, and write to disk."""
    if len(file_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image exceeds 20MB limit.")
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")

            if square_crop:
                w, h = img.size
                min_dim = min(w, h)
                left = (w - min_dim) // 2
                top = (h - min_dim) // 2
                img = img.crop((left, top, left + min_dim, top + min_dim))
                if min_dim > max_size:
                    img = img.resize((max_size, max_size), Image.Resampling.LANCZOS)
            else:
                w, h = img.size
                if w > max_size or h > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            target_path.parent.mkdir(parents=True, exist_ok=True)
            img.save(target_path, format="WEBP", quality=85)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Image processing failed: {exc}") from exc
