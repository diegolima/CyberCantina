"""Characters, versioning, SillyTavern importer, and character media router."""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth import get_current_user
from app.config import settings
from app.db.repos.base import is_public_character_media_url
from app.db.repos.media_assets import build_asset_url, extract_asset_id_from_url
from app.db.repository import utc_now_iso
from app.dependencies import (
    enforce_quota_and_write_webp,
    enforce_upload_policy,
    format_mb,
    get_effective_user_model_settings,
    get_repo,
    get_user_media_lock,
    get_user_media_usage_bytes,
    get_user_quota_bytes,
    read_upload_bytes_bounded,
    render_webp_bytes,
    run_entity_pruner,
    safe_resolve_asset_path,
    safe_resolve_media_path,
)
from app.routers.media import stage_and_commit_linked_video
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_public_character_media_file_path,
)
from app.schemas.auth import UserProfile
from app.schemas.character import (
    VALID_EMOTIONS,
    CharacterFeatureExtractionRequest,
    CharacterFeatureExtractionResponse,
    CharacterPersonaExtractionRequest,
    CharacterPersonaExtractionResponse,
    CharacterQuirksExtractionRequest,
    CharacterQuirksExtractionResponse,
    CharacterRecord,
    CharacterUpdatePayload,
    CharacterVersionSummary,
    CharacterWizardDraft,
    CharacterWizardSeed,
    GalleryImage,
)
from app.schemas.world import WorldRecord, WorldWizardDraft
from app.wizards.character_extractor import (
    extract_features_from_bio,
    extract_persona_traits_from_demeanor,
    extract_quirks_from_demeanor,
)
from app.wizards.character_wizard import generate_character_draft
from app.wizards.sillytavern_distiller import (
    distill_sillytavern_card,
    synthesize_world_seed_from_sillytavern,
)
from app.wizards.sillytavern_parser import extract_card_from_bytes
from app.wizards.world_wizard import generate_world_draft

logger = logging.getLogger("cybercantina.routers.characters")
router = APIRouter(tags=["characters"])


class CharacterCommitRequest(BaseModel):
    draft: CharacterWizardDraft
    world_id: str | None = None
    character_id: str | None = None


class SillyTavernImportResponse(BaseModel):
    draft: CharacterWizardDraft
    preassigned_character_id: str
    auto_generated_world: WorldWizardDraft | None = None
    media_warning: str | None = None


@router.get("/api/characters", response_model=list[CharacterRecord])
def list_characters(
    current_user: UserProfile = Depends(get_current_user),
) -> list[CharacterRecord]:
    return get_repo().list_characters(owner_id=current_user.id)


@router.get("/api/characters/{character_id}", response_model=CharacterRecord)
def get_character(
    character_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    try:
        return get_repo().get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/api/characters/{character_id}/versions",
    response_model=list[CharacterVersionSummary],
)
def list_character_versions(
    character_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> list[CharacterVersionSummary]:
    try:
        return get_repo().list_character_versions(
            character_id, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get(
    "/api/characters/{character_id}/versions/{version}",
    response_model=CharacterRecord,
)
def get_character_version(
    character_id: str,
    version: int,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    try:
        return get_repo().get_character_version(
            character_id, version, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/api/characters/{character_id}/versions/{version}/restore",
    response_model=CharacterRecord,
)
async def restore_character_version(
    character_id: str,
    version: int,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Restore a historical version snapshot as the latest version of the character."""
    repo = get_repo()
    try:
        return await repo.arestore_character_version(
            character_id, version, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/wizards/character/draft", response_model=CharacterWizardDraft)
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
    try:
        return await generate_character_draft(
            seed,
            world=world,
            profile=eff_actor,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post(
    "/api/wizards/character/import-sillytavern",
    response_model=SillyTavernImportResponse,
)
async def wizard_import_sillytavern_card(
    file: UploadFile = File(...),
    auto_generate_world: bool = Form(True),
    world_id: str | None = Form(None),
    current_user: UserProfile = Depends(get_current_user),
) -> SillyTavernImportResponse:
    repo = get_repo()
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    effective_prompts = repo.resolve_effective_prompts(user_id=current_user.id)

    file_bytes = await read_upload_bytes_bounded(file, 20 * 1024 * 1024)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        pkg = extract_card_from_bytes(file_bytes, filename=file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    preassigned_id = f"char_{uuid.uuid4().hex[:10]}"
    repo.stage_character_media_ownership(current_user.id, preassigned_id)

    target_world: WorldRecord | None = None
    if world_id and world_id.strip():
        try:
            target_world = repo.get_world(world_id.strip(), owner_id=current_user.id)
        except KeyError:
            pass

    try:
        draft = await distill_sillytavern_card(
            pkg.card,
            world=target_world,
            profile=eff_actor,
            prompt_template=effective_prompts.get("wizard_character_sillytavern_system"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Card distillation failed: {exc}") from exc

    media_warning: str | None = None
    # If raw PNG artwork is available, process and stage default portrait and gallery image
    if pkg.image_bytes:
        if current_user.role != "admin" and not settings.allow_image_uploads:
            media_warning = (
                "Card artwork was omitted because image uploads are currently disabled by the server administrator. "
                "Character text fields were imported successfully."
            )
        else:
            try:
                portrait_webp = await asyncio.to_thread(
                    render_webp_bytes,
                    pkg.image_bytes,
                    square_crop=True,
                    max_size=512,
                )
                gallery_webp = await asyncio.to_thread(
                    render_webp_bytes,
                    pkg.image_bytes,
                    square_crop=False,
                    max_size=1920,
                )

                def _stage_card_media() -> str | None:
                    portrait_id = f"por_{uuid.uuid4().hex[:10]}"
                    portrait_filename = f"{portrait_id}.webp"
                    portrait_path = safe_resolve_asset_path(
                        "images", portrait_filename, media_dir=repo.media_dir
                    )
                    gallery_id = f"img_{uuid.uuid4().hex[:10]}"
                    gallery_filename = f"{gallery_id}.webp"
                    gallery_path = safe_resolve_asset_path(
                        "images", gallery_filename, media_dir=repo.media_dir
                    )
                    needed_bytes = len(portrait_webp) + len(gallery_webp)
                    with get_user_media_lock(current_user.id):
                        quota = get_user_quota_bytes(current_user)
                        if quota is not None:
                            used = get_user_media_usage_bytes(repo, current_user.id)
                            if used + needed_bytes > quota:
                                return (
                                    f"Card artwork was omitted because staging its media ({format_mb(needed_bytes)}) "
                                    f"exceeds your storage quota ({format_mb(used)} / {format_mb(quota)} used). "
                                    "Character text fields were imported successfully."
                                )
                        portrait_path.parent.mkdir(parents=True, exist_ok=True)
                        portrait_path.write_bytes(portrait_webp)
                        gallery_path.parent.mkdir(parents=True, exist_ok=True)
                        gallery_path.write_bytes(gallery_webp)

                    try:
                        repo.register_media_asset(
                            asset_id=portrait_id,
                            owner_id=current_user.id,
                            entity_scope="character",
                            media_type="image",
                            role="portrait",
                            filename=portrait_filename,
                            mime_type="image/webp",
                            byte_size=len(portrait_webp),
                        )
                        repo.register_media_asset(
                            asset_id=gallery_id,
                            owner_id=current_user.id,
                            entity_scope="character",
                            media_type="image",
                            role="album",
                            filename=gallery_filename,
                            mime_type="image/webp",
                            byte_size=len(gallery_webp),
                            label="Original Card Artwork",
                        )
                    except Exception:
                        portrait_path.unlink(missing_ok=True)
                        gallery_path.unlink(missing_ok=True)
                        raise

                    draft.portraits["default"] = build_asset_url(portrait_id)
                    draft.gallery = [
                        GalleryImage(
                            id=gallery_id,
                            url=build_asset_url(gallery_id),
                            caption="Original Card Artwork",
                            created_at=utc_now_iso(),
                        )
                    ]
                    return None

                media_warning = await asyncio.to_thread(_stage_card_media)
            except Exception as exc:
                logger.warning("Failed staging card media artwork: %s", exc)

    auto_world_draft: WorldWizardDraft | None = None
    if auto_generate_world:
        try:
            world_seed = synthesize_world_seed_from_sillytavern(pkg.card)
            auto_world_draft = await generate_world_draft(
                world_seed,
                profile=eff_actor,
                prompt_template=effective_prompts.get("wizard_world_system"),
            )
        except Exception as exc:
            logger.warning("Failed auto-generating world seed: %s", exc)

    return SillyTavernImportResponse(
        draft=draft,
        preassigned_character_id=preassigned_id,
        auto_generated_world=auto_world_draft,
        media_warning=media_warning,
    )


@router.post("/api/wizards/character/commit", response_model=CharacterRecord)
async def wizard_commit_character(
    req: CharacterCommitRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    repo = get_repo()
    if req.world_id:
        try:
            repo.get_world(
                req.world_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"World '{req.world_id}' not found or access denied.",
            ) from exc
    try:
        return await repo.acreate_character_from_draft(
            req.draft,
            world_id=req.world_id,
            character_id=req.character_id,
            owner_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/api/wizards/character/extract-features",
    response_model=CharacterFeatureExtractionResponse,
)
async def extract_character_features(
    req: CharacterFeatureExtractionRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterFeatureExtractionResponse:
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    features, rewritten = await extract_features_from_bio(
        character_bio=req.character_bio,
        existing_features=req.existing_features,
        profile=eff_actor,
    )
    return CharacterFeatureExtractionResponse(
        extracted_features=features,
        rewritten_bio=rewritten,
    )


@router.post(
    "/api/wizards/character/extract-persona-traits",
    response_model=CharacterPersonaExtractionResponse,
)
async def extract_character_persona_traits(
    req: CharacterPersonaExtractionRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterPersonaExtractionResponse:
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    code, quirks, rewritten = await extract_persona_traits_from_demeanor(
        core_persona=req.core_persona,
        existing_moral_code=req.existing_moral_code,
        existing_quirks_flaws=req.existing_quirks_flaws,
        profile=eff_actor,
    )
    return CharacterPersonaExtractionResponse(
        extracted_moral_code=code,
        extracted_quirks_flaws=quirks,
        rewritten_core_persona=rewritten,
    )


@router.post(
    "/api/wizards/character/extract-quirks",
    response_model=CharacterQuirksExtractionResponse,
)
async def extract_character_quirks(
    req: CharacterQuirksExtractionRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterQuirksExtractionResponse:
    eff_actor, *_ = get_effective_user_model_settings(current_user.id)
    quirks, rewritten = await extract_quirks_from_demeanor(
        core_persona=req.core_persona,
        existing_quirks=req.existing_quirks,
        profile=eff_actor,
    )
    return CharacterQuirksExtractionResponse(
        extracted_quirks=quirks,
        rewritten_core_persona=rewritten,
    )


@router.put("/api/characters/{character_id}", response_model=CharacterRecord)
async def update_character(
    character_id: str,
    payload: CharacterUpdatePayload,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Update a character in-place if unused, or silently fork a new version if used by campaigns."""
    repo = get_repo()
    if payload.world_id:
        try:
            repo.get_world(
                payload.world_id,
                owner_id=current_user.id,
            )
        except KeyError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"World '{payload.world_id}' not found or access denied.",
            ) from exc
    try:
        return await repo.aupdate_character(
            character_id, payload, owner_id=current_user.id
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/api/characters/{character_id}")
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
# Character Media (Portraits & Photo Album)
# ------------------------------------------------------------------


@router.get("/api/media/public/{version_tag}/characters/{seed_slug}/{category}/{filename}")
def get_public_character_media(
    version_tag: str,
    seed_slug: str,
    category: str,
    filename: str,
    _current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Serve an immutable shared public character portrait or gallery image."""
    try:
        target = safe_resolve_public_character_media_file_path(
            settings.media_dir, version_tag, seed_slug, category, filename
        )
    except PathTraversalError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media asset not found.")

    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.get("/api/media/characters/{character_id}/{category}/{filename}")
def get_character_media(
    character_id: str,
    category: str,
    filename: str,
    current_user: UserProfile = Depends(get_current_user),
) -> FileResponse:
    """Serve a cached static character portrait or photo album image."""
    target = safe_resolve_media_path(character_id, category, filename)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Media asset not found.")

    repo = get_repo()
    if not repo.user_can_access_character(current_user.id, character_id):
        raise HTTPException(status_code=404, detail="Media asset not found.")

    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.post("/api/characters/{character_id}/portraits/{emotion}", response_model=CharacterRecord)
async def upload_character_portrait(
    character_id: str,
    emotion: str,
    file: UploadFile = File(...),
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Upload and square-crop a character portrait (shared non-duplicated asset, CoW-forking metadata if campaigns exist)."""
    enforce_upload_policy(current_user, "image")
    clean_emotion = emotion.strip().lower()
    if clean_emotion not in VALID_EMOTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid emotion '{emotion}'. Must be one of: {', '.join(VALID_EMOTIONS)}.",
        )

    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    file_bytes = await read_upload_bytes_bounded(file, 20 * 1024 * 1024)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    webp_bytes = await asyncio.to_thread(
        render_webp_bytes, file_bytes, square_crop=True, max_size=512
    )

    target_char_id = repo._ensure_writable_character_id(
        character_id, owner_id=current_user.id
    )
    char = repo.get_character(target_char_id, owner_id=current_user.id)

    old_url = char.portraits.get(clean_emotion)
    old_aid = (
        extract_asset_id_from_url(old_url)
        if (old_url and not is_public_character_media_url(old_url))
        else None
    )
    old_asset = repo.get_media_asset(old_aid) if old_aid else None
    replaced_bytes = int(old_asset.get("byte_size") or 0) if (old_asset and not old_asset.get("is_public")) else 0

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
            entity_scope="character",
            media_type="image",
            role="portrait",
            filename=filename,
            mime_type="image/webp",
            byte_size=len(webp_bytes),
        )
        new_portraits = dict(char.portraits)
        new_portraits[clean_emotion] = build_asset_url(asset_id)
        updated = repo.update_character_portraits(target_char_id, new_portraits, owner_id=current_user.id)
    except Exception:
        target_path.unlink(missing_ok=True)
        repo.delete_media_asset(asset_id)
        raise

    if old_aid and old_asset and not old_asset.get("is_public"):
        repo.delete_media_asset(old_aid, owner_id=current_user.id)
    elif old_url and target_char_id == character_id and not is_public_character_media_url(old_url) and f"/api/media/characters/{target_char_id}/" in old_url:
        try:
            old_path = safe_resolve_media_path(target_char_id, "portraits", Path(old_url).name)
            if old_path.is_file():
                old_path.unlink(missing_ok=True)
        except Exception:
            pass

    return updated


@router.delete("/api/characters/{character_id}/portraits/{emotion}", response_model=CharacterRecord)
def delete_character_portrait(
    character_id: str,
    emotion: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Delete a character portrait slot (immediately freeing private asset quota; never unlinking public files)."""
    clean_emotion = emotion.strip().lower()
    if clean_emotion not in VALID_EMOTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid emotion '{emotion}'. Must be one of: {', '.join(VALID_EMOTIONS)}.",
        )

    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if clean_emotion in char.portraits:
        old_url = char.portraits.get(clean_emotion)
        target_char_id = repo._ensure_writable_character_id(
            character_id, owner_id=current_user.id
        )
        char = repo.get_character(target_char_id, owner_id=current_user.id)
        new_portraits = {k: v for k, v in char.portraits.items() if k != clean_emotion}
        updated = repo.update_character_portraits(target_char_id, new_portraits, owner_id=current_user.id)
        old_aid = extract_asset_id_from_url(old_url)
        if old_aid:
            repo.delete_media_asset(old_aid, owner_id=current_user.id)
        elif old_url and target_char_id == character_id and not is_public_character_media_url(old_url) and f"/api/media/characters/{target_char_id}/" in old_url:
            try:
                old_path = safe_resolve_media_path(target_char_id, "portraits", Path(old_url).name)
                if old_path.is_file():
                    old_path.unlink(missing_ok=True)
            except Exception:
                pass
        return updated

    return char


@router.post("/api/characters/{character_id}/gallery", response_model=CharacterRecord)
async def upload_character_gallery_image(
    character_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Upload an image to the character's photo album."""
    enforce_upload_policy(current_user, "image")
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    file_bytes = await read_upload_bytes_bounded(file, 20 * 1024 * 1024)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    webp_bytes = await asyncio.to_thread(
        render_webp_bytes, file_bytes, square_crop=False, max_size=1920
    )

    target_char_id = repo._ensure_writable_character_id(
        character_id, owner_id=current_user.id
    )
    char = repo.get_character(target_char_id, owner_id=current_user.id)

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
            entity_scope="character",
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
        new_gallery = list(char.gallery) + [item]
        return repo.update_character_gallery(target_char_id, new_gallery, owner_id=current_user.id)
    except Exception:
        target_path.unlink(missing_ok=True)
        repo.delete_media_asset(img_id)
        raise


@router.get("/api/characters/{character_id}/gallery/{image_id}/impact")
def get_character_gallery_image_impact(
    character_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> dict[str, str | int | bool]:
    """Return active campaign count and linked video info before deleting a character gallery image."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    matching_item = next((it for it in char.gallery if it.id == image_id), None)
    if not matching_item:
        raise HTTPException(status_code=404, detail=f"Gallery image '{image_id}' not found.")

    aid = extract_asset_id_from_url(matching_item.url) or image_id
    impact = repo.get_asset_campaign_impact(aid, owner_id=current_user.id)
    if is_public_character_media_url(matching_item.url):
        impact["is_public"] = True
    return impact


@router.post("/api/characters/{character_id}/gallery/videos", response_model=CharacterRecord)
async def upload_character_gallery_video(
    character_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    linked_image_id: str | None = Form(None),
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Upload an MP4/WebM video linked to an existing album image or creating one from its first frame."""
    enforce_upload_policy(current_user, "video")
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    clean_linked_id = (
        linked_image_id.strip()
        if isinstance(linked_image_id, str) and linked_image_id.strip()
        else None
    )
    if clean_linked_id is not None:
        matching_item = next((it for it in char.gallery if it.id == clean_linked_id), None)
        if not matching_item:
            raise HTTPException(status_code=404, detail=f"Gallery image '{clean_linked_id}' not found.")
        if matching_item.is_public or is_public_character_media_url(matching_item.url):
            raise HTTPException(
                status_code=400,
                detail="Cannot attach a private video to shared built-in artwork; upload the video standalone to create a new album photo.",
            )
        target_asset_id = extract_asset_id_from_url(matching_item.url) or matching_item.id
    else:
        target_asset_id = None

    stem = Path(file.filename or "").stem.strip()
    _probe, _vid_id, image_id, created_new_image = await stage_and_commit_linked_video(
        repo=repo,
        user=current_user,
        file=file,
        entity_scope="character",
        target_owner_id=current_user.id,
        linked_image_id=target_asset_id,
        label_or_caption=caption,
        default_image_label=stem or "Video Frame",
    )
    if created_new_image:
        try:
            target_char_id = repo._ensure_writable_character_id(
                character_id, owner_id=current_user.id
            )
            writable_char = repo.get_character(target_char_id, owner_id=current_user.id)
            item = GalleryImage(
                id=image_id,
                url=build_asset_url(image_id),
                caption=caption.strip(),
                created_at=utc_now_iso(),
            )
            new_gallery = list(writable_char.gallery) + [item]
            return repo.update_character_gallery(target_char_id, new_gallery, owner_id=current_user.id)
        except Exception:
            repo.delete_media_asset(image_id)
            raise
    return repo.get_character(character_id, owner_id=current_user.id)


@router.delete("/api/characters/{character_id}/gallery/{image_id}/video", response_model=CharacterRecord)
def delete_character_gallery_video(
    character_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Delete only the linked video on a character gallery image while keeping the image itself."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    matching_item = next((it for it in char.gallery if it.id == image_id), None)
    if not matching_item:
        raise HTTPException(status_code=404, detail=f"Gallery image '{image_id}' not found.")

    aid = extract_asset_id_from_url(matching_item.url) or image_id
    deleted = repo.delete_linked_video(aid, owner_id=current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No linked video found for image '{image_id}'.")
    return repo.get_character(character_id, owner_id=current_user.id)


@router.delete("/api/characters/{character_id}/gallery/{image_id}", response_model=CharacterRecord)
def delete_character_gallery_image(
    character_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Remove a photo from the character's album (immediately deleting private image + linked video to free quota)."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    matching_item = next((it for it in char.gallery if it.id == image_id), None)
    if not matching_item:
        raise HTTPException(status_code=404, detail=f"Gallery image '{image_id}' not found.")

    target_char_id = repo._ensure_writable_character_id(
        character_id, owner_id=current_user.id
    )
    char = repo.get_character(target_char_id, owner_id=current_user.id)

    new_gallery = [it for it in char.gallery if it.id != image_id]
    updated = repo.update_character_gallery(target_char_id, new_gallery, owner_id=current_user.id)

    aid = extract_asset_id_from_url(matching_item.url)
    if aid and not is_public_character_media_url(matching_item.url):
        repo.delete_media_asset(aid, owner_id=current_user.id)
    elif (
        target_char_id == character_id
        and not is_public_character_media_url(matching_item.url)
        and f"/api/media/characters/{target_char_id}/" in matching_item.url
    ):
        try:
            old_path = safe_resolve_media_path(target_char_id, "gallery", Path(matching_item.url).name)
            if old_path.is_file():
                old_path.unlink(missing_ok=True)
        except Exception:
            pass

    return updated
