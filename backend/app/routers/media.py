"""Unified media asset serving, shared video upload staging helpers, and admin media purge routes."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.auth import get_current_user, require_admin
from app.config import settings
from app.db.repository import CantinaRepository
from app.dependencies import (
    enforce_quota_and_commit_staged_files,
    enforce_upload_policy,
    get_repo,
    safe_resolve_asset_path,
)
from app.schemas.auth import UserProfile
from app.schemas.housekeeping import (
    AdminMediaPurgePreviewResponse,
    AdminMediaPurgeRequest,
    AdminMediaPurgeResponse,
)
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_staging_file_path,
    validate_safe_asset_id,
)
from app.services.video_processor import (
    VideoProbeMetadata,
    cleanup_staging_paths,
    extract_first_frame_webp,
    probe_video_file,
    stream_upload_to_staging,
)

logger = logging.getLogger("cybercantina.routers.media")
router = APIRouter(tags=["media"])


@router.get("/api/media/assets/{asset_id}")
def get_unified_media_asset(
    asset_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> FileResponse:
    """Serve an authorized image, video, or audio asset by asset_id with Range support."""
    try:
        clean_id = validate_safe_asset_id(asset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    asset = repo.get_media_asset(clean_id)
    if not asset or not repo.user_can_access_asset(current_user.id, clean_id):
        raise HTTPException(status_code=404, detail="Media asset not found.")

    try:
        target = repo.resolve_asset_disk_path(asset)
    except PathTraversalError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media asset not found.")

    mime_type = str(asset.get("mime_type") or "application/octet-stream")
    return FileResponse(
        target,
        media_type=mime_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/api/admin/media/purge-preview", response_model=AdminMediaPurgePreviewResponse)
def admin_media_purge_preview(
    images: bool = Query(default=False),
    videos: bool = Query(default=False),
    _admin: UserProfile = Depends(require_admin),
    repo: CantinaRepository = Depends(get_repo),
) -> AdminMediaPurgePreviewResponse:
    """Preview counts and total byte size of non-built-in media eligible for purge."""
    summary = repo.preview_admin_media_purge(purge_images=images, purge_videos=videos)
    return AdminMediaPurgePreviewResponse.model_validate(summary)


@router.post("/api/admin/media/purge", response_model=AdminMediaPurgeResponse)
def admin_media_purge(
    req: AdminMediaPurgeRequest,
    admin: UserProfile = Depends(require_admin),
    repo: CantinaRepository = Depends(get_repo),
) -> AdminMediaPurgeResponse:
    """Purge all non-built-in images and/or videos from disk and DB (images cascade to linked videos)."""
    if not req.purge_images and not req.purge_videos:
        raise HTTPException(
            status_code=400,
            detail="Select at least one media category (images or videos) to purge.",
        )
    result = repo.execute_admin_media_purge(
        purge_images=req.purge_images,
        purge_videos=req.purge_videos,
    )
    logger.info(
        "Admin '%s' purged non-built-in media (images=%d, videos=%d, bytes=%d)",
        sanitize_log_value(admin.username),
        result["images_deleted"],
        result["videos_deleted"],
        result["bytes_reclaimed"],
    )
    return AdminMediaPurgeResponse.model_validate(result)


async def stage_and_commit_linked_video(
    *,
    repo: CantinaRepository,
    user: UserProfile,
    file: UploadFile,
    entity_scope: str,
    target_owner_id: str,
    linked_image_id: str | None,
    label_or_caption: str,
    default_image_label: str,
) -> tuple[VideoProbeMetadata, str, str, bool]:
    """Stream, probe, optionally extract first-frame WebP, quota-commit files, and return (probe, video_id, image_id, created_new_image).

    Guarantees zero partial files remain in .staging/ or assets/ on error or cancellation.
    The caller persists entity DB state and calls ``finalize_or_rollback_video_commit``.
    """
    enforce_upload_policy(user, "video")
    max_video_bytes = int(round(float(settings.max_video_upload_mb) * 1024 * 1024))

    clean_linked_id: str | None = (
        linked_image_id.strip() if isinstance(linked_image_id, str) and linked_image_id.strip() else None
    )
    replaced_bytes = 0
    if clean_linked_id is not None:
        existing_vid = repo.get_linked_video_for_image(clean_linked_id)
        if existing_vid:
            replaced_bytes = int(existing_vid.get("byte_size") or 0)

    staged_video_path: Path | None = None
    staged_image_path: Path | None = None
    committed_targets: list[Path] = []
    try:
        staged_video_path = await stream_upload_to_staging(
            file,
            media_dir=repo.media_dir,
            max_bytes=max_video_bytes,
        )
        probe = await asyncio.to_thread(probe_video_file, staged_video_path)

        video_id = f"vid_{uuid.uuid4().hex[:10]}"
        video_filename = f"{video_id}{probe.extension}"
        target_video_path = safe_resolve_asset_path(
            "videos", video_filename, media_dir=repo.media_dir
        )

        staged_moves: list[tuple[Path, Path]] = [(staged_video_path, target_video_path)]
        created_new_image = clean_linked_id is None
        if created_new_image:
            image_id = (
                f"wmed_{uuid.uuid4().hex[:10]}"
                if entity_scope == "world"
                else f"img_{uuid.uuid4().hex[:10]}"
            )
            webp_bytes = await asyncio.to_thread(
                extract_first_frame_webp,
                staged_video_path,
                media_dir=repo.media_dir,
                max_size=1920,
            )
            staged_image_path = safe_resolve_staging_file_path(
                repo.media_dir, f"poster_{uuid.uuid4().hex}.webp"
            )
            staged_image_path.parent.mkdir(parents=True, exist_ok=True)
            staged_image_path.write_bytes(webp_bytes)
            image_filename = f"{image_id}.webp"
            target_image_path = safe_resolve_asset_path(
                "images", image_filename, media_dir=repo.media_dir
            )
            staged_moves.append((staged_image_path, target_image_path))
        else:
            image_id = clean_linked_id  # type: ignore[assignment]
            target_image_path = None

        await asyncio.to_thread(
            enforce_quota_and_commit_staged_files,
            repo,
            user,
            staged_moves,
            replaced_bytes=replaced_bytes,
        )
        for _, dst in staged_moves:
            committed_targets.append(dst)

        # Register image + video assets in unified media_assets store
        replaced_video: dict[str, Any] | None = None
        try:
            if created_new_image:
                assert target_image_path is not None
                role = "world_scene" if entity_scope == "world" else "album"
                eff_label = label_or_caption.strip() or default_image_label
                repo.register_media_asset(
                    asset_id=image_id,
                    owner_id=target_owner_id,
                    entity_scope=entity_scope,
                    media_type="image",
                    role=role,
                    filename=f"{image_id}.webp",
                    mime_type="image/webp",
                    byte_size=target_image_path.stat().st_size,
                    label=eff_label,
                )
            replaced_video = repo.attach_or_replace_linked_video(
                image_id,
                video_id=video_id,
                owner_id=target_owner_id,
                entity_scope=entity_scope,
                filename=video_filename,
                mime_type=probe.mime_type,
                byte_size=probe.byte_size,
                duration_ms=probe.duration_ms,
                width=probe.width,
                height=probe.height,
                label=label_or_caption.strip(),
            )
        except Exception:
            if created_new_image:
                repo.delete_media_asset(image_id)
            for t in committed_targets:
                cleanup_staging_paths(t)
            raise

        if replaced_video is not None:
            repo._unlink_asset_file(replaced_video)

        return probe, video_id, image_id, created_new_image
    except BaseException:
        for t in committed_targets:
            cleanup_staging_paths(t)
        raise
    finally:
        cleanup_staging_paths(staged_video_path, staged_image_path)


def safe_unlink_file(path: Path) -> None:
    """BackgroundTask helper to delete temporary export archives cleanly."""
    try:
        if path.is_file():
            os.unlink(path)
    except OSError:
        pass
