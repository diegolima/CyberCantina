"""FastAPI router for native CyberCantina archive (.zcc) export, auto-detect inspect, and commit."""

from __future__ import annotations

import logging
import re
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.auth import get_current_user
from app.dependencies import get_repo
from app.routers.media import safe_unlink_file
from app.schemas.auth import UserProfile
from app.schemas.import_export import (
    ExportBundleRequest,
    ExportCampaignRequest,
    ExportCharacterOptions,
    ExportWorldOptions,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportInspectResponse,
    ImportUnlockRequest,
)
from app.security.media_path import safe_resolve_staging_file_path
from app.security.rate_limit import enforce_rate_limit
from app.services.import_export_service import (
    build_campaign_zcc_export_to_file,
    build_zcc_export_to_file,
    commit_staged_import,
    get_max_import_upload_bytes,
    inspect_uploaded_path,
    unlock_staged_import,
)
from app.services.video_processor import cleanup_staging_paths

logger = logging.getLogger("cybercantina.routers.import_export")
router = APIRouter(tags=["import_export"])


def _slugify_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w\-_.]", "_", name.strip())
    return cleaned or "cybercantina_export"


@router.post("/api/export/bundle")
async def export_bundle(
    req: ExportBundleRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Bundle selected characters, worlds, and personas into a .zcc archive."""
    repo = get_repo()
    if not req.character_ids and not req.world_ids and not req.persona_ids:
        raise HTTPException(status_code=400, detail="At least one entity must be selected for export.")

    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=req.character_ids,
        world_ids=req.world_ids,
        persona_ids=req.persona_ids,
        owner_id=current_user.id,
        description=f"Export bundle: {req.bundle_name}",
        include_world_media=req.include_world_media,
        include_videos=req.include_videos,
        selected_video_ids=req.selected_video_ids,
        password=req.password,
    )

    safe_name = _slugify_filename(req.bundle_name)
    if not safe_name.endswith(".zcc"):
        safe_name = f"{safe_name}.zcc"

    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=safe_name,
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.get("/api/export/character/{character_id}")
async def export_single_character(
    character_id: str,
    include_world: bool = Query(default=False),
    include_videos: bool = Query(default=False),
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Export a single character as a .zcc archive, optionally bundling their associated world."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Character '{character_id}' not found.") from None

    world_ids = [char.world_id] if (include_world and char.world_id) else []

    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=[character_id],
        world_ids=world_ids,
        persona_ids=[],
        owner_id=current_user.id,
        description=f"Character export: {char.name}",
        include_videos=include_videos,
    )

    safe_name = _slugify_filename(f"character_{char.name}")
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"{safe_name}.zcc",
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.get("/api/export/world/{world_id}")
async def export_single_world(
    world_id: str,
    include_characters: bool = Query(default=True),
    include_media: bool = Query(default=True),
    include_videos: bool = Query(default=False),
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Export a single world as a .zcc archive, optionally bundling resident characters and media."""
    repo = get_repo()
    try:
        world = repo.get_world(world_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"World '{world_id}' not found.") from None

    character_ids: list[str] = []
    if include_characters:
        all_chars = repo.list_characters(
            include_pending_deletion=False, owner_id=current_user.id
        )
        character_ids = [c.id for c in all_chars if c.world_id == world_id]

    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=character_ids,
        world_ids=[world_id],
        persona_ids=[],
        owner_id=current_user.id,
        description=f"World export: {world.name}",
        include_world_media=include_media,
        include_videos=include_videos,
    )

    safe_name = _slugify_filename(f"world_{world.name}")
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"{safe_name}.zcc",
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.post("/api/export/character/{character_id}")
async def export_single_character_post(
    character_id: str,
    req: ExportCharacterOptions,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Export a single character as a .zcc archive (supports optional password encryption in JSON body)."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Character '{character_id}' not found.") from None

    world_ids = [char.world_id] if (req.include_world and char.world_id) else []
    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=[character_id],
        world_ids=world_ids,
        persona_ids=[],
        owner_id=current_user.id,
        description=f"Character export: {char.name}",
        include_videos=req.include_videos,
        password=req.password,
    )

    safe_name = _slugify_filename(f"character_{char.name}")
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"{safe_name}.zcc",
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.post("/api/export/world/{world_id}")
async def export_single_world_post(
    world_id: str,
    req: ExportWorldOptions,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Export a single world as a .zcc archive (supports optional password encryption in JSON body)."""
    repo = get_repo()
    try:
        world = repo.get_world(world_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"World '{world_id}' not found.") from None

    character_ids: list[str] = []
    if req.include_characters:
        all_chars = repo.list_characters(
            include_pending_deletion=False, owner_id=current_user.id
        )
        character_ids = [c.id for c in all_chars if c.world_id == world_id]

    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=character_ids,
        world_ids=[world_id],
        persona_ids=[],
        owner_id=current_user.id,
        description=f"World export: {world.name}",
        include_world_media=req.include_media,
        include_videos=req.include_videos,
        password=req.password,
    )

    safe_name = _slugify_filename(f"world_{world.name}")
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"{safe_name}.zcc",
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.post("/api/export/campaign/{campaign_id}")
async def export_campaign(
    campaign_id: str,
    req: ExportCampaignRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Export a running campaign (with base world, cast, persona, timelines, CARE, memories) as .zcc v2."""
    repo = get_repo()
    try:
        tmp_path, camp_name = build_campaign_zcc_export_to_file(
            repo=repo,
            campaign_id=campaign_id,
            owner_id=current_user.id,
            timeline_scope=req.timeline_scope,
            strip_bookmark_comments=req.strip_bookmark_comments,
            include_world_media=req.include_world_media,
            include_videos=req.include_videos,
            include_gm_chat=req.include_gm_chat,
            selected_video_ids=req.selected_video_ids,
            password=req.password,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Campaign '{campaign_id}' not found.") from None

    safe_name = _slugify_filename(f"campaign_{camp_name}")
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=f"{safe_name}.zcc",
        background=BackgroundTask(safe_unlink_file, tmp_path),
    )


@router.post("/api/import/inspect", response_model=ImportInspectResponse)
async def inspect_import(
    file: UploadFile = File(...),
    current_user: UserProfile = Depends(get_current_user),
) -> ImportInspectResponse:
    """Stream-stage and inspect an uploaded file (.zcc, .zip, .png, .json) to auto-detect its format."""
    enforce_rate_limit(
        "import_inspect_user",
        current_user.id,
        detail="Too many import inspections in a short period. Please wait and try again.",
    )
    repo = get_repo()
    max_upload_bytes = get_max_import_upload_bytes()
    staged_path = safe_resolve_staging_file_path(
        repo.media_dir, f"import_{uuid.uuid4().hex}.part"
    )
    staged_path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with staged_path.open("wb") as out_f:
            while True:
                chunk = await file.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail="Uploaded import package exceeds maximum allowed size.",
                    )
                out_f.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        return inspect_uploaded_path(
            repo=repo,
            staged_path=staged_path,
            filename=file.filename or "",
            user_id=current_user.id,
        )
    except BaseException:
        cleanup_staging_paths(staged_path)
        raise


@router.post("/api/import/unlock", response_model=ImportInspectResponse)
async def unlock_import(
    req: ImportUnlockRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> ImportInspectResponse:
    """Decrypt and inspect a password-protected staged .zcc archive."""
    enforce_rate_limit(
        "import_unlock_user",
        current_user.id,
        detail="Too many archive unlock attempts. Please wait and try again.",
    )
    enforce_rate_limit(
        "import_unlock_token",
        f"{current_user.id}:{req.staged_token}",
        detail="Too many unlock attempts for this archive. Please wait and try again.",
    )
    repo = get_repo()
    return unlock_staged_import(
        repo=repo,
        staged_token=req.staged_token,
        password=req.password,
        user_id=current_user.id,
    )


@router.post("/api/import/commit", response_model=ImportCommitResponse)
async def commit_import(
    req: ImportCommitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> ImportCommitResponse:
    """Commit a staged native CyberCantina import bundle with specified conflict strategies."""
    repo = get_repo()
    return await commit_staged_import(
        repo=repo,
        req=req,
        user_id=current_user.id,
    )
