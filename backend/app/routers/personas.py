"""User personas REST router."""

from __future__ import annotations

import asyncio
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth import get_current_user
from app.db.repository import CantinaRepository, utc_now_iso
from app.dependencies import (
    enforce_quota_and_write_webp,
    get_repo,
    render_webp_bytes,
    safe_resolve_persona_media_path,
)
from app.schemas.auth import UserProfile
from app.schemas.character import GalleryImage
from app.schemas.persona import (
    PersonaCreatePayload,
    PersonaRecord,
    PersonaUpdatePayload,
    is_default_persona_id,
)

router = APIRouter(prefix="/api/personas", tags=["personas"])
media_router = APIRouter(tags=["personas"])


@router.get("", response_model=list[PersonaRecord])
async def list_user_personas(
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> list[PersonaRecord]:
    """List all personas owned by the current user."""
    return repo.list_personas(owner_id=user.id)


@router.post("", response_model=PersonaRecord, status_code=status.HTTP_201_CREATED)
async def create_persona(
    payload: PersonaCreatePayload,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Create a new persona in the master gallery."""
    if not payload.name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Persona name cannot be empty.",
        )
    return repo.create_persona(draft=payload, owner_id=user.id)


@router.get("/{persona_id}", response_model=PersonaRecord)
async def get_persona(
    persona_id: str,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Fetch a single persona by ID."""
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    return persona


@router.put("/{persona_id}", response_model=PersonaRecord)
async def update_persona(
    persona_id: str,
    payload: PersonaUpdatePayload,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Update persona fields and secret/public toggles."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    try:
        return repo.update_persona(persona_id, payload, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.delete("/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(
    persona_id: str,
    user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> None:
    """Delete a persona from the master gallery. Campaigns keep their snapshots."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be deleted.",
        )
    persona = repo.get_persona(persona_id, owner_id=user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )
    try:
        repo.delete_persona(persona_id, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@media_router.get("/api/media/personas/{persona_id}/{category}/{filename}")
def get_persona_media(
    persona_id: str,
    category: str,
    filename: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> FileResponse:
    """Serve a persisted persona portrait or photo album image."""
    target = safe_resolve_persona_media_path(
        persona_id, category, filename, media_dir=repo.media_dir
    )
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media asset not found.")
    if not repo.user_can_access_persona_media(
        current_user.id, persona_id, category, filename
    ):
        raise HTTPException(status_code=404, detail="Media asset not found.")
    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.post("/{persona_id}/portrait", response_model=PersonaRecord)
async def upload_persona_portrait(
    persona_id: str,
    file: UploadFile = File(...),
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Upload and square-crop the primary portrait for a non-default persona."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=current_user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    webp_bytes = await asyncio.to_thread(
        render_webp_bytes, file_bytes, square_crop=True, max_size=512
    )

    filename = f"default_{uuid.uuid4().hex[:8]}.webp"
    target_path = safe_resolve_persona_media_path(
        persona_id, "portraits", filename, media_dir=repo.media_dir
    )

    old_url = persona.portrait_url
    old_path: Path | None = None
    can_unlink_old = False
    if (
        old_url
        and f"/api/media/personas/{persona_id}/portraits/" in old_url
        and not repo.is_persona_media_url_referenced_by_campaigns(old_url)
    ):
        old_name = Path(old_url).name
        try:
            old_path = safe_resolve_persona_media_path(
                persona_id, "portraits", old_name, media_dir=repo.media_dir
            )
            can_unlink_old = True
        except HTTPException:
            old_path = None

    await asyncio.to_thread(
        enforce_quota_and_write_webp,
        repo,
        current_user,
        webp_bytes,
        target_path,
        replacing_path=old_path if can_unlink_old else None,
    )

    if can_unlink_old and old_path is not None and old_path != target_path and old_path.is_file():
        try:
            old_path.unlink(missing_ok=True)
        except Exception:
            pass

    new_url = f"/api/media/personas/{persona_id}/portraits/{filename}"
    return repo.update_persona_portrait(persona_id, new_url, owner_id=current_user.id)


@router.delete("/{persona_id}/portrait", response_model=PersonaRecord)
def delete_persona_portrait(
    persona_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Clear the persona's primary portrait, retaining the disk file if referenced by a campaign snapshot."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=current_user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )

    old_url = persona.portrait_url
    updated = repo.update_persona_portrait(persona_id, None, owner_id=current_user.id)
    if old_url:
        repo.unlink_persona_media_if_unreferenced(old_url)
    return updated


@router.post("/{persona_id}/gallery", response_model=PersonaRecord)
async def upload_persona_gallery_image(
    persona_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Upload a photo album image for a non-default persona."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=current_user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    webp_bytes = await asyncio.to_thread(
        render_webp_bytes, file_bytes, square_crop=False, max_size=1920
    )

    img_id = f"img_{uuid.uuid4().hex[:10]}"
    filename = f"{img_id}.webp"
    target_path = safe_resolve_persona_media_path(
        persona_id, "gallery", filename, media_dir=repo.media_dir
    )

    await asyncio.to_thread(
        enforce_quota_and_write_webp,
        repo,
        current_user,
        webp_bytes,
        target_path,
    )

    item = GalleryImage(
        id=img_id,
        url=f"/api/media/personas/{persona_id}/gallery/{filename}",
        caption=caption.strip(),
        created_at=utc_now_iso(),
    )
    new_gallery = list(persona.gallery) + [item]
    return repo.update_persona_gallery(persona_id, new_gallery, owner_id=current_user.id)


@router.delete("/{persona_id}/gallery/{image_id}", response_model=PersonaRecord)
def delete_persona_gallery_image(
    persona_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Remove a photo from the persona's album, retaining the file if referenced by a campaign snapshot."""
    if is_default_persona_id(persona_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The default 'User' persona is hard-coded and cannot be modified.",
        )
    persona = repo.get_persona(persona_id, owner_id=current_user.id)
    if not persona:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Persona '{persona_id}' not found.",
        )

    matching_item = next((it for it in persona.gallery if it.id == image_id), None)
    if not matching_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Gallery image '{image_id}' not found.",
        )

    new_gallery = [it for it in persona.gallery if it.id != image_id]
    updated = repo.update_persona_gallery(persona_id, new_gallery, owner_id=current_user.id)
    repo.unlink_persona_media_if_unreferenced(matching_item.url)
    return updated
