"""Shared dependency injection, configuration resolution, and media utilities."""

from __future__ import annotations

import dataclasses
import io
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import HTTPException, Request, Response
from PIL import Image

from app.auth import (
    SESSION_COOKIE_NAME,
    SESSION_IDLE_TIMEOUT_SECONDS,
    generate_session_token,
)
from app.config import (
    DEFAULT_ACTOR_CONTEXT_SIZE,
    DEFAULT_CLERK_CONTEXT_SIZE,
    AgentDispatchMode,
    ModelProfile,
    settings,
)
from app.db.repository import CantinaRepository
from app.providers.resolver import ProviderUnavailableError, attach_endpoint, resolve_endpoint
from app.schemas.auth import AuthSessionResponse, EffectiveWarning, UserProfile
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_character_media_dir,
    safe_resolve_media_file_path,
)

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


@dataclass
class EffectiveModels:
    """Fully resolved model configuration for one user, plus reasons any override was not honored."""

    actor: ModelProfile
    clerk: ModelProfile
    working_memory_turns: int
    delegate_cognition_to_clerk: bool
    max_scene_flags: int
    clerk_mirrors_actor: bool
    warnings: list[EffectiveWarning] = field(default_factory=list)
    min_working_memory_turns: int = 4
    lod_summary_chunks: int = 6
    lod_importance_bonus: int = 2
    zone2_budget_share_pct: int = 45
    recall_budget_prose_tokens: int = 450
    recall_budget_cognition_tokens: int = 220


def _finalize_profile(
    profile: ModelProfile,
    role: str,
    *,
    user_id: str | None,
    from_user: bool,
    default: ModelProfile,
    warnings: list[EffectiveWarning],
) -> ModelProfile:
    """Attach the resolved endpoint. Invalid *user* overrides fall back to the system default
    (with a warning); invalid *system* defaults are left unresolved and fail loudly at call time
    rather than being silently re-pointed to another provider."""
    if from_user and not profile.provider_id and default.provider_id:
        warnings.append(EffectiveWarning(role=role, code="missing_provider"))  # type: ignore[arg-type]
        return _finalize_profile(default, role, user_id=None, from_user=False, default=default, warnings=warnings)
    try:
        endpoint = resolve_endpoint(profile, user_id=user_id if from_user else None, role=role)
        if endpoint is not None and user_id is not None and endpoint.caller_user_id is None:
            endpoint = dataclasses.replace(endpoint, caller_user_id=user_id)
        return attach_endpoint(profile, endpoint)
    except ProviderUnavailableError as exc:
        if not from_user:
            logger.warning("System %s provider unavailable: %s", role, exc)
            return profile
        warnings.append(EffectiveWarning(role=role, code=exc.code, provider_id=exc.provider_id))  # type: ignore[arg-type]
        return _finalize_profile(default, role, user_id=None, from_user=False, default=default, warnings=warnings)


def _normalize_host_url(url: str | None) -> str:
    """Normalize a base URL to scheme://host[:port] collapsing loopback aliases."""
    if not url:
        return ""
    cleaned = url.strip().lower().rstrip("/")
    for suffix in ("/v1", "/api"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)].rstrip("/")
    for prefix in ("http://", "https://"):
        if cleaned.startswith(prefix):
            scheme = prefix
            rest = cleaned[len(prefix) :]
            host_port = rest.split("/")[0]
            host = host_port.split(":")[0]
            port = (":" + host_port.split(":")[1]) if ":" in host_port else ""
            if host in ("127.0.0.1", "localhost", "0.0.0.0", "host.docker.internal"):
                return f"{scheme}localhost{port}"
            return f"{scheme}{host_port}"
    return cleaned


def normalize_model_tag(model_name: str) -> str:
    """Normalize an LLM model identifier for robust identity comparison (stripping tags like ':latest', whitespace, case)."""
    cleaned = (model_name or "").strip().lower()
    if cleaned.endswith(":latest"):
        cleaned = cleaned[: -len(":latest")].strip()
    return cleaned


def is_separate_clerk_model(
    actor: ModelProfile, clerk: ModelProfile, clerk_mirrors_actor: bool
) -> bool:
    """Verify whether Clerk and Actor use genuinely separate models on their resolved endpoints."""
    if clerk_mirrors_actor:
        return False

    actor_tag = normalize_model_tag(actor.model)
    clerk_tag = normalize_model_tag(clerk.model)
    if actor_tag != clerk_tag:
        return True

    actor_endpoint = actor.resolved.root_url if actor.resolved else (actor.base_url or "")
    clerk_endpoint = clerk.resolved.root_url if clerk.resolved else (clerk.base_url or "")
    actor_host = _normalize_host_url(actor_endpoint)
    clerk_host = _normalize_host_url(clerk_endpoint)

    if actor_host and clerk_host and actor_host != clerk_host:
        return True

    return False


def resolve_effective_models(user_id: str | None) -> EffectiveModels:
    """Resolve effective models for a user: overrides (when allowed), clerk mirroring, endpoints."""
    default_actor = settings.actor_profile
    default_clerk = settings.clerk_profile
    wm_turns = settings.memory_config.working_memory_turns
    delegate = settings.delegate_cognition_to_clerk
    max_flags = settings.memory_config.max_scene_flags
    mirror = settings.clerk_mirrors_actor
    min_wm_turns = settings.memory_config.min_working_memory_turns
    lod_chunks = settings.memory_config.lod_summary_chunks
    lod_bonus = settings.memory_config.lod_importance_bonus
    z2_share = settings.memory_config.zone2_budget_share_pct
    recall_prose = settings.memory_config.recall_budget_prose_tokens
    recall_cog = settings.memory_config.recall_budget_cognition_tokens

    user_settings = (
        get_repo().get_user_model_settings(user_id)
        if ((settings.allow_user_model_overrides or settings.allow_user_providers) and user_id)
        else None
    )
    actor_src, clerk_src = default_actor, default_clerk
    actor_from_user = clerk_from_user = False
    if user_settings:
        if user_settings.actor_profile is not None:
            actor_src, actor_from_user = user_settings.actor_profile, True
        if user_settings.clerk_profile is not None:
            clerk_src, clerk_from_user = user_settings.clerk_profile, True
        if user_settings.working_memory_turns is not None:
            wm_turns = user_settings.working_memory_turns
        if user_settings.delegate_cognition_to_clerk is not None:
            delegate = user_settings.delegate_cognition_to_clerk
        if user_settings.max_scene_flags is not None:
            max_flags = user_settings.max_scene_flags
        if user_settings.clerk_mirrors_actor is not None:
            mirror = user_settings.clerk_mirrors_actor
        if user_settings.min_working_memory_turns is not None:
            min_wm_turns = user_settings.min_working_memory_turns
        if user_settings.lod_summary_chunks is not None:
            lod_chunks = user_settings.lod_summary_chunks
        if user_settings.lod_importance_bonus is not None:
            lod_bonus = user_settings.lod_importance_bonus
        if user_settings.zone2_budget_share_pct is not None:
            z2_share = user_settings.zone2_budget_share_pct
        if user_settings.recall_budget_prose_tokens is not None:
            recall_prose = user_settings.recall_budget_prose_tokens
        if user_settings.recall_budget_cognition_tokens is not None:
            recall_cog = user_settings.recall_budget_cognition_tokens

    warnings: list[EffectiveWarning] = []
    actor = _finalize_profile(
        actor_src, "actor", user_id=user_id, from_user=actor_from_user, default=default_actor, warnings=warnings
    )
    default_actor_ctx = default_actor.context_size or DEFAULT_ACTOR_CONTEXT_SIZE
    if actor.context_size is None:
        actor = actor.model_copy(update={"context_size": default_actor_ctx})

    if mirror:
        # Mirroring shares provider, model, and Ollama context window to avoid runner reload thrashing.
        clerk = clerk_src.model_copy(
            update={
                "provider_id": actor.provider_id,
                "model": actor.model,
                "base_url": actor.base_url,
                "api_key": actor.api_key,
                "resolved": actor.resolved,
                "run_on_cpu": False,
                "context_size": actor.context_size,
            }
        )
    else:
        clerk = _finalize_profile(
            clerk_src, "clerk", user_id=user_id, from_user=clerk_from_user, default=default_clerk, warnings=warnings
        )
        default_clerk_ctx = default_clerk.context_size or DEFAULT_CLERK_CONTEXT_SIZE
        if clerk.context_size is None:
            clerk = clerk.model_copy(update={"context_size": default_clerk_ctx})
        if not is_separate_clerk_model(actor, clerk, mirror):
            clerk = clerk.model_copy(
                update={
                    "run_on_cpu": False,
                    "context_size": actor.context_size,
                }
            )
    return EffectiveModels(
        actor,
        clerk,
        wm_turns,
        delegate,
        max_flags,
        mirror,
        warnings,
        min_working_memory_turns=min_wm_turns,
        lod_summary_chunks=lod_chunks,
        lod_importance_bonus=lod_bonus,
        zone2_budget_share_pct=z2_share,
        recall_budget_prose_tokens=recall_prose,
        recall_budget_cognition_tokens=recall_cog,
    )


def get_effective_user_model_settings(
    user_id: str | None,
) -> tuple[ModelProfile, ModelProfile, int, bool, int]:
    """Resolve effective (actor_profile, clerk_profile, working_memory_turns, delegate_cognition_to_clerk, max_scene_flags) for a user.

    Thin adapter over :func:`resolve_effective_models` kept for existing call sites. Profiles
    returned here carry their resolved provider endpoint (when provider-backed).
    """
    eff = resolve_effective_models(user_id)
    return eff.actor, eff.clerk, eff.working_memory_turns, eff.delegate_cognition_to_clerk, eff.max_scene_flags


def get_effective_agent_dispatch_mode(user_id: str | None) -> AgentDispatchMode:
    """Resolve effective agent_dispatch_mode ('sequential' or 'parallel') for a user."""
    default_mode = settings.agent_dispatch_mode
    if not settings.allow_user_model_overrides or not user_id:
        return default_mode
    user_settings = get_repo().get_user_model_settings(user_id)
    if user_settings and user_settings.agent_dispatch_mode in ("sequential", "parallel"):
        return user_settings.agent_dispatch_mode
    return default_mode


def get_effective_persona_disclosure_mode(user_id: str | None) -> str:
    """Resolve effective persona_disclosure_mode ('llm_intent' or 'token_matching') for a user."""
    default_mode = "llm_intent"
    if not settings.allow_user_model_overrides or not user_id:
        return default_mode
    user_settings = get_repo().get_user_model_settings(user_id)
    if user_settings and user_settings.persona_disclosure_mode in ("llm_intent", "token_matching", "hybrid"):
        return user_settings.persona_disclosure_mode
    return default_mode


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
    repo.touch_user_login(user.id)
    refreshed_user = attach_user_media_stats(repo, repo.get_user_by_id(user.id))
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
        user=refreshed_user,
        single_user_mode=repo.is_single_user_passwordless_mode(),
    )


def safe_resolve_media_path(character_id: str, category: str, filename: str) -> Path:
    """Safely validate and resolve a media file path to prevent directory traversal."""
    try:
        return safe_resolve_media_file_path(settings.media_dir, character_id, category, filename)
    except PathTraversalError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


_USER_MEDIA_LOCKS: dict[str, threading.Lock] = {}
_USER_MEDIA_LOCKS_GUARD = threading.Lock()


def get_user_media_lock(user_id: str) -> threading.Lock:
    """Return a per-user mutex serializing media quota checks and disk writes."""
    with _USER_MEDIA_LOCKS_GUARD:
        lock = _USER_MEDIA_LOCKS.get(user_id)
        if lock is None:
            lock = threading.Lock()
            _USER_MEDIA_LOCKS[user_id] = lock
        return lock


def get_character_media_bytes(media_dir: str, character_id: str) -> int:
    """Sum persisted file bytes inside a character's confined media directory."""
    try:
        c_dir = safe_resolve_character_media_dir(media_dir, character_id)
    except (PathTraversalError, ValueError):
        return 0
    if not c_dir.is_dir():
        return 0
    total = 0
    for item in c_dir.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def get_user_media_usage_bytes(repo: CantinaRepository, user_id: str) -> int:
    """Compute total persisted media bytes across all characters owned or staged by ``user_id``."""
    total = 0
    for cid in repo.list_user_media_character_ids(user_id):
        total += get_character_media_bytes(repo.media_dir, cid)
    return total


def get_user_quota_bytes(user: UserProfile) -> int | None:
    """Return the active media byte limit for ``user``, or None when unlimited / exempt (admin)."""
    if user.role == "admin":
        return None
    quota_mb = settings.user_media_quota_mb
    if quota_mb is None or quota_mb <= 0:
        return None
    return int(round(float(quota_mb) * 1024 * 1024))


def attach_user_media_stats(repo: CantinaRepository, user: UserProfile) -> UserProfile:
    """Return a copy of ``user`` enriched with current media usage and quota bytes."""
    used = get_user_media_usage_bytes(repo, user.id)
    quota = get_user_quota_bytes(user)
    return user.model_copy(update={"media_bytes_used": used, "media_quota_bytes": quota})


def render_webp_bytes(
    file_bytes: bytes, square_crop: bool = False, max_size: int = 512
) -> bytes:
    """Validate, format-normalize to WebP, optionally square-crop, and return encoded bytes."""
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

            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=85)
            return buf.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {exc}") from exc


def format_mb(num_bytes: int) -> str:
    return f"{num_bytes / (1024 * 1024):.2f} MB"


def remove_character_media_dir(media_dir: str, character_id: str) -> None:
    """Safely remove all persisted media files for a character directory."""
    import shutil

    try:
        c_dir = safe_resolve_character_media_dir(media_dir, character_id)
    except (PathTraversalError, ValueError):
        return
    if c_dir.is_dir():
        shutil.rmtree(c_dir, ignore_errors=True)


def enforce_quota_and_write_webp(
    repo: CantinaRepository,
    user: UserProfile,
    webp_bytes: bytes,
    target_path: Path,
    *,
    replacing_path: Path | None = None,
) -> None:
    """Enforce per-user media storage quota atomically and write WebP bytes to ``target_path``."""
    with get_user_media_lock(user.id):
        quota = get_user_quota_bytes(user)
        if quota is not None:
            used = get_user_media_usage_bytes(repo, user.id)
            replaced = (
                replacing_path.stat().st_size
                if (replacing_path is not None and replacing_path.is_file())
                else 0
            )
            net_added = len(webp_bytes) - replaced
            if net_added > 0 and (used + net_added) > quota:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        f"Media storage quota exceeded ({format_mb(used)} / {format_mb(quota)} used). "
                        "Delete existing portraits or gallery images to free space."
                    ),
                )
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(webp_bytes)


def process_and_save_image(
    file_bytes: bytes, target_path: Path, square_crop: bool = False, max_size: int = 512
) -> None:
    """Validate, format-normalize to WebP, optionally square-crop, and write to disk."""
    webp_bytes = render_webp_bytes(file_bytes, square_crop=square_crop, max_size=max_size)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(webp_bytes)
