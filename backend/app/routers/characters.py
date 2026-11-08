"""Characters, versioning, SillyTavern importer, and character media router."""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any

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
from app.db.repository import utc_now_iso
from app.dependencies import (
    get_effective_user_model_settings,
    get_repo,
    process_and_save_image,
    run_entity_pruner,
    safe_resolve_media_path,
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
    effective_prompts = repo.resolve_effective_prompts(user_id=current_user.id)
    try:
        return await generate_character_draft(
            seed,
            world=world,
            profile=eff_actor,
            prompt_template=effective_prompts.get("wizard_character_system"),
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

    file_bytes = await file.read()
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

    # If raw PNG artwork is available, process and stage default portrait and gallery image
    if pkg.image_bytes:
        try:
            portrait_suffix = uuid.uuid4().hex[:8]
            portrait_filename = f"default_{portrait_suffix}.webp"
            portrait_path = safe_resolve_media_path(
                preassigned_id, "portraits", portrait_filename
            )
            await asyncio.to_thread(
                process_and_save_image,
                pkg.image_bytes,
                portrait_path,
                square_crop=True,
                max_size=512,
            )
            draft.portraits["default"] = (
                f"/api/media/characters/{preassigned_id}/portraits/{portrait_filename}"
            )

            gallery_id = f"img_{uuid.uuid4().hex[:10]}"
            gallery_filename = f"{gallery_id}.webp"
            gallery_path = safe_resolve_media_path(
                preassigned_id, "gallery", gallery_filename
            )
            await asyncio.to_thread(
                process_and_save_image,
                pkg.image_bytes,
                gallery_path,
                square_crop=False,
                max_size=1920,
            )
            gallery_item = GalleryImage(
                id=gallery_id,
                url=f"/api/media/characters/{preassigned_id}/gallery/{gallery_filename}",
                caption="Original Card Artwork",
                created_at=utc_now_iso(),
            )
            draft.gallery = [gallery_item]
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
    """Upload and square-crop a character portrait for a specific emotional expression."""
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

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    file_suffix = uuid.uuid4().hex[:8]
    filename = f"{clean_emotion}_{file_suffix}.webp"
    target_path = safe_resolve_media_path(character_id, "portraits", filename)

    # Delete existing portrait file for this emotion if present
    old_url = char.portraits.get(clean_emotion)
    if old_url:
        old_name = Path(old_url).name
        try:
            old_path = safe_resolve_media_path(character_id, "portraits", old_name)
            if old_path.is_file():
                old_path.unlink(missing_ok=True)
        except Exception:
            pass

    await asyncio.to_thread(process_and_save_image, file_bytes, target_path, square_crop=True, max_size=512)

    new_portraits = dict(char.portraits)
    new_portraits[clean_emotion] = f"/api/media/characters/{character_id}/portraits/{filename}"
    return repo.update_character_portraits(character_id, new_portraits, owner_id=current_user.id)


@router.delete("/api/characters/{character_id}/portraits/{emotion}", response_model=CharacterRecord)
def delete_character_portrait(
    character_id: str,
    emotion: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Delete a character portrait slot and clean up the image on disk."""
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
        old_url = char.portraits[clean_emotion]
        if old_url:
            old_name = Path(old_url).name
            try:
                old_path = safe_resolve_media_path(character_id, "portraits", old_name)
                if old_path.is_file():
                    old_path.unlink(missing_ok=True)
            except Exception:
                pass
        new_portraits = {k: v for k, v in char.portraits.items() if k != clean_emotion}
        return repo.update_character_portraits(character_id, new_portraits, owner_id=current_user.id)

    return char


@router.post("/api/characters/{character_id}/gallery", response_model=CharacterRecord)
async def upload_character_gallery_image(
    character_id: str,
    file: UploadFile = File(...),
    caption: str = Form(""),
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Upload an image to the character's photo album."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty upload payload.")

    img_id = f"img_{uuid.uuid4().hex[:10]}"
    filename = f"{img_id}.webp"
    target_path = safe_resolve_media_path(character_id, "gallery", filename)

    await asyncio.to_thread(process_and_save_image, file_bytes, target_path, square_crop=False, max_size=1920)

    item = GalleryImage(
        id=img_id,
        url=f"/api/media/characters/{character_id}/gallery/{filename}",
        caption=caption.strip(),
        created_at=utc_now_iso(),
    )
    new_gallery = list(char.gallery) + [item]
    return repo.update_character_gallery(character_id, new_gallery, owner_id=current_user.id)


@router.delete("/api/characters/{character_id}/gallery/{image_id}", response_model=CharacterRecord)
def delete_character_gallery_image(
    character_id: str,
    image_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> CharacterRecord:
    """Remove a photo from the character's photo album and delete the file on disk."""
    repo = get_repo()
    try:
        char = repo.get_character(character_id, owner_id=current_user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    matching_item = next((it for it in char.gallery if it.id == image_id), None)
    if not matching_item:
        raise HTTPException(status_code=404, detail=f"Gallery image '{image_id}' not found.")

    old_name = Path(matching_item.url).name
    try:
        old_path = safe_resolve_media_path(character_id, "gallery", old_name)
        if old_path.is_file():
            old_path.unlink(missing_ok=True)
    except Exception:
        pass

    new_gallery = [it for it in char.gallery if it.id != image_id]
    return repo.update_character_gallery(character_id, new_gallery, owner_id=current_user.id)
