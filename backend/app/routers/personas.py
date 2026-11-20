"""User personas REST router."""

from __future__ import annotations

import asyncio
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth import get_current_user
from app.db.repos.media_assets import build_asset_url, extract_asset_id_from_url
from app.db.repository import CantinaRepository, utc_now_iso
from app.dependencies import (
    enforce_quota_and_write_webp,
    enforce_upload_policy,
    get_repo,
    render_webp_bytes,
    safe_resolve_asset_path,
    safe_resolve_persona_media_path,
)
from app.routers.media import stage_and_commit_linked_video
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
    """Upload and square-crop the primary portrait for a non-default persona (immediate-delete replacement)."""
    enforce_upload_policy(current_user, "image")
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

    old_url = persona.portrait_url
    old_aid = extract_asset_id_from_url(old_url)
    old_asset = repo.get_media_asset(old_aid) if old_aid else None
    replaced_bytes = int(old_asset.get("byte_size") or 0) if old_asset else 0

    asset_id = f"por_{uuid.uuid4().hex[:10]}"
    filename = f"{asset_id}.webp"
    target_path = safe_resolve_asset_path("images", filename, media_dir=repo.media_dir)

    await asyncio.to_thread(
        enforce_quota_and_write_webp,
        repo,
        current_user,
        webp_bytes,
        target_path,
        replaced_bytes=replaced_bytes,
    )

    try:
        repo.register_media_asset(
            asset_id=asset_id,
            owner_id=current_user.id,
            entity_scope="persona",
            media_type="image",
            role="portrait",
            filename=filename,
            mime_type="image/webp",
            byte_size=len(webp_bytes),
        )
        updated = repo.update_persona_portrait(
            persona_id, build_asset_url(asset_id), owner_id=current_user.id
        )
    except Exception:
        target_path.unlink(missing_ok=True)
        repo.delete_media_asset(asset_id)
        raise

    if old_aid:
        repo.delete_media_asset(old_aid, owner_id=current_user.id)
    elif old_url:
        repo.unlink_persona_media_if_unreferenced(old_url)
    return updated


@router.delete("/{persona_id}/portrait", response_model=PersonaRecord)
def delete_persona_portrait(
    persona_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Clear the persona's primary portrait and immediately delete its private asset to reclaim quota."""
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
    old_aid = extract_asset_id_from_url(old_url)
    if old_aid:
        repo.delete_media_asset(old_aid, owner_id=current_user.id)
    elif old_url:
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
    enforce_upload_policy(current_user, "image")
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
    target_path = safe_resolve_asset_path("images", filename, media_dir=repo.media_dir)

    await asyncio.to_thread(
        enforce_quota_and_write_webp,
        repo,
        current_user,
        webp_bytes,
        target_path,
    )

    try:
        repo.register_media_asset(
            asset_id=img_id,
            owner_id=current_user.id,
            entity_scope="persona",
            media_type="image",
            role="album",
            filename=filename,
            mime_type="image/webp",
            byte_size=len(webp_bytes),
            label=caption.strip(),
        )
        item = GalleryImage(
            id=img_id,
            url=build_asset_url(img_id),
            caption=caption.strip(),
            created_at=utc_now_iso(),
        )
        new_gallery = list(persona.gallery) + [item]
        return repo.update_persona_gallery(persona_id, new_gallery, owner_id=current_user.id)
    except Exception:
        target_path.unlink(missing_ok=True)
        repo.delete_media_asset(img_id)
        raise


@router.get("/{persona_id}/gallery/{image_id}/impact")
def get_persona_gallery_image_impact(
    persona_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> dict[str, str | int | bool]:
    """Return active campaign snapshot count and linked video info before deleting a persona photo."""
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
    aid = extract_asset_id_from_url(matching_item.url) or image_id
    return repo.get_asset_campaign_impact(aid, owner_id=current_user.id)


@router.post("/{persona_id}/gallery/videos", response_model=PersonaRecord)
async def upload_persona_gallery_video(
    persona_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    linked_image_id: str | None = Form(None),
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Upload an MP4/WebM video linked to an existing persona photo or creating one from its first frame."""
    enforce_upload_policy(current_user, "video")
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

    clean_linked_id = (
        linked_image_id.strip()
        if isinstance(linked_image_id, str) and linked_image_id.strip()
        else None
    )
    if clean_linked_id is not None:
        matching_item = next((it for it in persona.gallery if it.id == clean_linked_id), None)
        if not matching_item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Gallery image '{clean_linked_id}' not found.",
            )
        if matching_item.is_public:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot attach a private video to built-in artwork.",
            )
        target_asset_id = extract_asset_id_from_url(matching_item.url) or matching_item.id
    else:
        target_asset_id = None

    stem = Path(file.filename or "").stem.strip()
    _probe, _vid_id, image_id, created_new_image = await stage_and_commit_linked_video(
        repo=repo,
        user=current_user,
        file=file,
        entity_scope="persona",
        target_owner_id=current_user.id,
        linked_image_id=target_asset_id,
        label_or_caption=caption,
        default_image_label=stem or "Video Frame",
    )
    if created_new_image:
        try:
            latest = repo.get_persona(persona_id, owner_id=current_user.id)
            assert latest is not None
            item = GalleryImage(
                id=image_id,
                url=build_asset_url(image_id),
                caption=caption.strip(),
                created_at=utc_now_iso(),
            )
            new_gallery = list(latest.gallery) + [item]
            return repo.update_persona_gallery(persona_id, new_gallery, owner_id=current_user.id)
        except Exception:
            repo.delete_media_asset(image_id)
            raise
    updated = repo.get_persona(persona_id, owner_id=current_user.id)
    assert updated is not None
    return updated


@router.delete("/{persona_id}/gallery/{image_id}/video", response_model=PersonaRecord)
def delete_persona_gallery_video(
    persona_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Delete only the linked video on a persona photo while keeping the image itself."""
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
    aid = extract_asset_id_from_url(matching_item.url) or image_id
    deleted = repo.delete_linked_video(aid, owner_id=current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No linked video found for image '{image_id}'.",
        )
    updated = repo.get_persona(persona_id, owner_id=current_user.id)
    assert updated is not None
    return updated


@router.delete("/{persona_id}/gallery/{image_id}", response_model=PersonaRecord)
def delete_persona_gallery_image(
    persona_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
    repo: CantinaRepository = Depends(get_repo),
) -> PersonaRecord:
    """Remove a photo from the persona's album and immediately delete its private image (+ linked video) to free quota."""
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
    aid = extract_asset_id_from_url(matching_item.url)
    if aid:
        repo.delete_media_asset(aid, owner_id=current_user.id)
    else:
        repo.unlink_persona_media_if_unreferenced(matching_item.url)
    return updated
