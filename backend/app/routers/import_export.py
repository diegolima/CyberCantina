"""FastAPI router for native CyberCantina archive (.zcc) export, auto-detect inspect, and commit."""

from __future__ import annotations

import logging
import re
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile

from app.auth import get_current_user
from app.dependencies import get_repo
from app.schemas.auth import UserProfile
from app.schemas.import_export import (
    ExportBundleRequest,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportInspectResponse,
)
from app.services.import_export_service import (
    build_zcc_export,
    commit_staged_import,
    inspect_uploaded_file,
)

logger = logging.getLogger("cybercantina.routers.import_export")
router = APIRouter(tags=["import_export"])


def _slugify_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w\-_.]", "_", name.strip())
    return cleaned or "cybercantina_export"


@router.post("/api/export/bundle")
async def export_bundle(
    req: ExportBundleRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> Response:
    """Bundle selected characters, worlds, and personas into a .zcc archive."""
    repo = get_repo()
    if not req.character_ids and not req.world_ids and not req.persona_ids:
        raise HTTPException(status_code=400, detail="At least one entity must be selected for export.")

    bundle_bytes = build_zcc_export(
        repo=repo,
        character_ids=req.character_ids,
        world_ids=req.world_ids,
        persona_ids=req.persona_ids,
        owner_id=current_user.id,
        description=f"Export bundle: {req.bundle_name}",
    )

    safe_name = _slugify_filename(req.bundle_name)
    if not safe_name.endswith(".zcc"):
        safe_name = f"{safe_name}.zcc"

    return Response(
        content=bundle_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Content-Type": "application/octet-stream",
        },
    )


@router.get("/api/export/character/{character_id}")
async def export_single_character(
    character_id: str,
    include_world: bool = Query(default=False),
    current_user: UserProfile = Depends(get_current_user),
) -> Response:
    """Export a single character as a .zcc archive, optionally bundling their associated world."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Character '{character_id}' not found.") from None

    world_ids = [char.world_id] if (include_world and char.world_id) else []

    bundle_bytes = build_zcc_export(
        repo=repo,
        character_ids=[character_id],
        world_ids=world_ids,
        persona_ids=[],
        owner_id=current_user.id,
        description=f"Character export: {char.name}",
    )

    safe_name = _slugify_filename(f"character_{char.name}")
    return Response(
        content=bundle_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.zcc"',
        },
    )


@router.get("/api/export/world/{world_id}")
async def export_single_world(
    world_id: str,
    include_characters: bool = Query(default=True),
    current_user: UserProfile = Depends(get_current_user),
) -> Response:
    """Export a single world as a .zcc archive, optionally bundling all resident characters."""
    repo = get_repo()
    try:
        world = repo.get_world(world_id, owner_id=current_user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"World '{world_id}' not found.") from None

    character_ids: list[str] = []
    if include_characters:
        all_chars = repo.list_characters(include_pending_deletion=False)
        character_ids = [c.id for c in all_chars if c.world_id == world_id]

    bundle_bytes = build_zcc_export(
        repo=repo,
        character_ids=character_ids,
        world_ids=[world_id],
        persona_ids=[],
        owner_id=current_user.id,
        description=f"World export: {world.name}",
    )

    safe_name = _slugify_filename(f"world_{world.name}")
    return Response(
        content=bundle_bytes,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.zcc"',
        },
    )


@router.post("/api/import/inspect", response_model=ImportInspectResponse)
async def inspect_import(
    file: UploadFile = File(...),
    current_user: UserProfile = Depends(get_current_user),
) -> ImportInspectResponse:
    """Upload and inspect a file (.zcc, .zip, .png, .json) to auto-detect its format and check conflicts."""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    repo = get_repo()
    return inspect_uploaded_file(
        repo=repo,
        file_bytes=file_bytes,
        filename=file.filename or "",
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
