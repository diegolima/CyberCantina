"""Service for packaging, inspecting, and ingesting CyberCantina archives (.zcc)."""

from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException

from app.config import settings
from app.db.repos.media_assets import build_asset_url, extract_asset_id_from_url
from app.db.repository import CantinaRepository, _location_lore_vector_fields, utc_now_iso
from app.dependencies import (
    enforce_quota_and_commit_staged_files,
    enforce_quota_and_write_webp,
    format_mb,
    get_user_media_lock,
    get_user_media_usage_bytes,
    get_user_quota_bytes,
    render_webp_bytes,
    safe_resolve_asset_path,
    safe_resolve_media_path,
    safe_resolve_persona_media_path,
    safe_resolve_public_character_media_path,
    safe_resolve_world_media_path,
)
from app.schemas.character import (
    CANONICAL_CHARACTER_RECORD_KEYS,
    LEGACY_DEPRECATED_CHARACTER_KEYS,
    VALID_EMOTIONS,
    CharacterWizardDraft,
    GalleryImage,
    sanitize_unsupported_fields,
)
from app.schemas.import_export import (
    EntitySummary,
    ImportCommitRequest,
    ImportCommitResponse,
    ImportEntityConflict,
    ImportInspectResponse,
    ZccManifest,
    ZccManifestContents,
)
from app.schemas.persona import (
    CANONICAL_PERSONA_RECORD_KEYS,
    LEGACY_DEPRECATED_PERSONA_KEYS,
    PersonaCreatePayload,
    PersonaRecord,
    canonicalize_persona_legacy_fields,
)
from app.schemas.world import (
    CANONICAL_WORLD_GLOBAL_RULE_KEYS,
    CANONICAL_WORLD_RECORD_KEYS,
    WorldGlobalRules,
    WorldRecord,
    extract_world_unsupported_fields,
    find_nested_world_unsupported_keys,
    normalize_lore_category,
)
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import safe_resolve_staging_file_path
from app.security.zcc_crypto import (
    ZccCryptoFormatError,
    ZccDecryptionError,
    decrypt_zcc_enc_to_file,
    encrypt_file_to_zcc_enc,
    is_encrypted_zcc_bytes,
    is_encrypted_zcc_file,
)
from app.services.video_processor import (
    VideoProbeMetadata,
    cleanup_staging_paths,
    probe_video_file,
)
from app.services.zcc_campaign_io import (
    extract_campaign_export_bundle,
    ingest_campaigns_atomic,
)
from app.wizards.sillytavern_parser import extract_card_from_bytes

logger = logging.getLogger("cybercantina.import_export")

# Safety limits for ZIP decompression, upload staging, and memory bounds
MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024  # 1 GB decompression bomb ceiling
MAX_ZIP_ENTRIES = 500
STAGED_IMPORT_TTL_SECONDS = 1800  # 30 minutes
MAX_CARD_IMPORT_BYTES = 20 * 1024 * 1024  # 20 MB ceiling for non-ZIP SillyTavern cards
DEFAULT_MAX_IMPORT_UPLOAD_MB = 100
MAX_STAGED_IMPORTS_PER_USER = 3
MAX_STAGED_IMPORTS_GLOBAL = 20
MAX_STAGED_DISK_BYTES_GLOBAL = 256 * 1024 * 1024  # 256 MB total staged files across users
MAX_STAGED_RAM_BYTES_GLOBAL = 32 * 1024 * 1024  # 32 MB total in-RAM SillyTavern buffers


def get_max_import_upload_bytes() -> int:
    """Return compressed/raw upload byte ceiling for /api/import/inspect."""
    raw = os.environ.get("CYBERCANTINA_MAX_IMPORT_UPLOAD_MB", "").strip()
    if raw:
        try:
            mb = int(raw)
        except ValueError:
            mb = DEFAULT_MAX_IMPORT_UPLOAD_MB
    else:
        mb = DEFAULT_MAX_IMPORT_UPLOAD_MB
    clamped_mb = max(1, min(mb, 1024))
    return clamped_mb * 1024 * 1024


@dataclass
class StagedImport:
    token: str
    user_id: str
    format_type: str
    is_native: bool
    data_bytes: bytes | None
    created_at_epoch: float
    parsed_payload: dict[str, Any]
    staged_file_path: Path | None = None
    requires_password: bool = False
    decrypted_file_path: Path | None = None


_staged_imports: dict[str, StagedImport] = {}
_staged_imports_lock = threading.Lock()


def _staged_entry_disk_bytes(entry: StagedImport) -> int:
    total = 0
    for p in (entry.staged_file_path, entry.decrypted_file_path):
        if p is None:
            continue
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            continue
    return total


def _cleanup_staged_entry_paths(entry: StagedImport | None) -> None:
    if entry is None:
        return
    paths = [p for p in (entry.staged_file_path, entry.decrypted_file_path) if p is not None]
    if paths:
        cleanup_staging_paths(*paths)


def _staged_entry_ram_bytes(entry: StagedImport) -> int:
    return len(entry.data_bytes) if entry.data_bytes is not None else 0


def _cleanup_expired_staged_imports_locked(now: float | None = None) -> None:
    ts = now if now is not None else time.time()
    expired = [
        k for k, v in _staged_imports.items() if ts - v.created_at_epoch > STAGED_IMPORT_TTL_SECONDS
    ]
    for k in expired:
        entry = _staged_imports.pop(k, None)
        _cleanup_staged_entry_paths(entry)


def _cleanup_expired_staged_imports() -> None:
    with _staged_imports_lock:
        _cleanup_expired_staged_imports_locked()


def _register_staged_import(entry: StagedImport) -> None:
    """Store a staged import under per-user FIFO eviction and global disk/RAM caps."""
    incoming_disk = _staged_entry_disk_bytes(entry)
    incoming_ram = _staged_entry_ram_bytes(entry)
    with _staged_imports_lock:
        _cleanup_expired_staged_imports_locked()

        user_entries = sorted(
            (v for v in _staged_imports.values() if v.user_id == entry.user_id),
            key=lambda item: item.created_at_epoch,
        )
        while len(user_entries) >= MAX_STAGED_IMPORTS_PER_USER:
            oldest = user_entries.pop(0)
            popped = _staged_imports.pop(oldest.token, None)
            _cleanup_staged_entry_paths(popped)

        total_disk = sum(_staged_entry_disk_bytes(v) for v in _staged_imports.values()) + incoming_disk
        total_ram = sum(_staged_entry_ram_bytes(v) for v in _staged_imports.values()) + incoming_ram
        if (
            len(_staged_imports) >= MAX_STAGED_IMPORTS_GLOBAL
            or total_disk > MAX_STAGED_DISK_BYTES_GLOBAL
            or total_ram > MAX_STAGED_RAM_BYTES_GLOBAL
        ):
            _cleanup_staged_entry_paths(entry)
            raise HTTPException(
                status_code=503,
                detail="Too many pending import sessions are currently active. Please retry shortly.",
            )

        _staged_imports[entry.token] = entry


def clear_staged_imports() -> None:
    """Clear all staged imports and unlink any temporary staging files (for tests)."""
    with _staged_imports_lock:
        entries = list(_staged_imports.values())
        _staged_imports.clear()
    for entry in entries:
        if entry.staged_file_path:
            cleanup_staging_paths(entry.staged_file_path)


def _open_safe_zip(source: bytes | Path) -> zipfile.ZipFile:
    """Validate archive integrity, total size, entry count, and path traversal safety."""
    try:
        if isinstance(source, Path):
            zf = zipfile.ZipFile(source, "r")
        else:
            zf = zipfile.ZipFile(io.BytesIO(source), "r")
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive.") from exc

    infolist = zf.infolist()
    if len(infolist) > MAX_ZIP_ENTRIES:
        zf.close()
        raise HTTPException(
            status_code=400,
            detail=f"Archive contains too many entries ({len(infolist)} > {MAX_ZIP_ENTRIES}).",
        )

    total_size = sum(info.file_size for info in infolist)
    if total_size > MAX_TOTAL_UNCOMPRESSED_BYTES:
        zf.close()
        raise HTTPException(
            status_code=400,
            detail=f"Uncompressed archive exceeds size limit ({total_size} bytes > {MAX_TOTAL_UNCOMPRESSED_BYTES} bytes).",
        )

    for info in infolist:
        p = Path(info.filename)
        if p.is_absolute() or ".." in p.parts:
            zf.close()
            raise HTTPException(
                status_code=400,
                detail=f"Archive contains illegal path traversal member: '{info.filename}'.",
            )

    return zf


def _safe_zip_read(zip_bytes: bytes) -> zipfile.ZipFile:
    return _open_safe_zip(zip_bytes)


def _extract_character_unsupported_fields(
    char_dict: dict[str, Any],
    *,
    strict: bool = False,
) -> dict[str, Any]:
    """Collect unrecognized future keys and non-duplicate deprecated legacy keys into unsupported_fields."""
    raw_unsupported: dict[str, Any] = {}
    nested_unsupported = char_dict.get("unsupported_fields")
    if isinstance(nested_unsupported, dict):
        for k, v in nested_unsupported.items():
            if isinstance(k, str) and k not in CANONICAL_CHARACTER_RECORD_KEYS:
                raw_unsupported[k] = v

    for k, v in char_dict.items():
        if not isinstance(k, str):
            continue
        if k in CANONICAL_CHARACTER_RECORD_KEYS or k in LEGACY_DEPRECATED_CHARACTER_KEYS:
            continue
        raw_unsupported[k] = v

    bio_norm = char_dict.get("character_bio")
    bio_str = bio_norm.strip() if isinstance(bio_norm, str) else ""
    raw_phys = char_dict.get("physical_appearance")
    if isinstance(raw_phys, str) and raw_phys.strip() and raw_phys.strip() != bio_str:
        raw_unsupported["physical_appearance"] = raw_phys.strip()

    raw_mods = char_dict.get("modifications")
    if isinstance(raw_mods, list):
        clean_mods = [m.strip() for m in raw_mods if isinstance(m, str) and m.strip()]
        if clean_mods:
            raw_unsupported["modifications"] = clean_mods

    return sanitize_unsupported_fields(raw_unsupported, strict=strict)


def _extract_persona_unsupported_fields(
    persona_dict: dict[str, Any],
    *,
    strict: bool = False,
) -> dict[str, Any]:
    """Collect unrecognized future keys and distinct legacy physical_appearance into unsupported_fields."""
    raw_unsupported: dict[str, Any] = {}
    nested_unsupported = persona_dict.get("unsupported_fields")
    if isinstance(nested_unsupported, dict):
        for k, v in nested_unsupported.items():
            if isinstance(k, str) and k not in CANONICAL_PERSONA_RECORD_KEYS:
                raw_unsupported[k] = v

    for k, v in persona_dict.items():
        if not isinstance(k, str):
            continue
        if k in CANONICAL_PERSONA_RECORD_KEYS or k in LEGACY_DEPRECATED_PERSONA_KEYS:
            continue
        raw_unsupported[k] = v

    bio_norm = persona_dict.get("persona_bio")
    bio_str = bio_norm.strip() if isinstance(bio_norm, str) else ""
    raw_phys = persona_dict.get("physical_appearance")
    phys_str = raw_phys.strip() if isinstance(raw_phys, str) else ""
    if phys_str and phys_str != bio_str:
        raw_unsupported["physical_appearance"] = phys_str
    _, merged = canonicalize_persona_legacy_fields(
        persona_bio=bio_str,
        physical_appearance="",
        unsupported_fields=raw_unsupported,
        strict=strict,
    )
    return merged


def _resolve_local_media_disk_path(
    repo: CantinaRepository,
    url: str,
    *,
    entity_scope: str,
    entity_id: str,
    category: str,
    owner_id: str | None = None,
) -> Path | None:
    """Resolve an authorized unified, public, or legacy local media URL to an existing file on disk."""
    aid = extract_asset_id_from_url(url)
    if aid:
        asset = repo.get_media_asset(aid)
        if asset:
            if owner_id is not None:
                asset_owner = asset.get("owner_id")
                if not bool(asset.get("is_public")) and asset_owner not in (None, owner_id):
                    return None
                if not repo.user_can_access_asset(owner_id, aid):
                    return None
            p = repo.resolve_asset_disk_path(asset)
            if p.is_file():
                return p
    if entity_scope == "character":
        pub_m = re.search(
            rf"/api/media/public/(v\d+)/characters/([^/]+)/{category}/([^/?#]+)",
            url or "",
        )
        if pub_m:
            p = safe_resolve_public_character_media_path(
                pub_m.group(1), pub_m.group(2), category, pub_m.group(3), media_dir=repo.media_dir
            )
            if p.is_file():
                return p
        m = re.search(rf"/api/media/characters/([^/]+)/{category}/([^/?#]+)", url or "")
        if m:
            c_id, fname = m.group(1), m.group(2)
            if owner_id is not None and not repo.user_can_access_character(owner_id, c_id):
                if c_id != entity_id and repo.user_can_access_character(owner_id, entity_id):
                    alt = safe_resolve_media_path(entity_id, category, fname, media_dir=repo.media_dir)
                    if alt.is_file():
                        return alt
                return None
            p = safe_resolve_media_path(c_id, category, fname, media_dir=repo.media_dir)
            if not p.is_file() and c_id != entity_id:
                if owner_id is None or repo.user_can_access_character(owner_id, entity_id):
                    alt = safe_resolve_media_path(entity_id, category, fname, media_dir=repo.media_dir)
                    if alt.is_file():
                        p = alt
            if p.is_file():
                return p
    elif entity_scope == "persona":
        m = re.search(rf"/api/media/personas/([^/]+)/{category}/([^/?#]+)", url or "")
        if m:
            p_id, fname = m.group(1), m.group(2)
            if owner_id is not None and not repo.user_can_access_persona_media(
                owner_id, p_id, category, fname
            ):
                if p_id != entity_id and repo.user_can_access_persona_media(
                    owner_id, entity_id, category, fname
                ):
                    alt = safe_resolve_persona_media_path(
                        entity_id, category, fname, media_dir=repo.media_dir
                    )
                    if alt.is_file():
                        return alt
                return None
            p = safe_resolve_persona_media_path(p_id, category, fname, media_dir=repo.media_dir)
            if not p.is_file() and p_id != entity_id:
                if owner_id is None or repo.user_can_access_persona_media(
                    owner_id, entity_id, category, fname
                ):
                    alt = safe_resolve_persona_media_path(
                        entity_id, category, fname, media_dir=repo.media_dir
                    )
                    if alt.is_file():
                        p = alt
            if p.is_file():
                return p
    elif entity_scope == "world":
        m = re.search(r"/api/media/worlds/(images|audio)/([^/?#]+)", url or "")
        if m:
            if owner_id is not None and not repo.user_can_access_world_media(
                owner_id, m.group(1), m.group(2)
            ):
                return None
            p = safe_resolve_world_media_path(m.group(1), m.group(2), media_dir=repo.media_dir)
            if p.is_file():
                return p
    return None


def _stage_entity_image_and_optional_video(
    repo: CantinaRepository,
    *,
    entity_scope: str,
    entity_id: str,
    image_url: str,
    image_category: str,
    item_copy: dict[str, Any] | None,
    media_sources: dict[str, Path],
    include_videos: bool,
    selected_video_ids: set[str] | None,
    owner_id: str | None = None,
) -> str:
    """Stage image (and optionally linked video on item_copy) into media_sources; return relative image ZIP path."""
    scope_dir = "characters" if entity_scope == "character" else ("personas" if entity_scope == "persona" else "worlds")
    staged_img_url = image_url
    try:
        fpath = _resolve_local_media_disk_path(
            repo,
            image_url,
            entity_scope=entity_scope,
            entity_id=entity_id,
            category=image_category,
            owner_id=owner_id,
        )
        if fpath is not None and fpath.is_file():
            rel_zip_path = f"media/{scope_dir}/{entity_id}/{image_category}/{fpath.name}"
            media_sources[rel_zip_path] = fpath
            staged_img_url = rel_zip_path
    except Exception as exc:
        logger.warning("Failed staging %s %s asset for export: %s", entity_scope, image_category, sanitize_log_value(exc))

    if item_copy is not None:
        vid_id = str(item_copy.get("video_asset_id") or "").strip()
        vid_url = str(item_copy.get("video_url") or "").strip()
        should_stage_vid = (
            include_videos
            and bool(vid_url)
            and (selected_video_ids is None or (vid_id and vid_id in selected_video_ids))
        )
        staged_vid_path: str | None = None
        if should_stage_vid:
            try:
                vfpath = _resolve_local_media_disk_path(
                    repo,
                    vid_url,
                    entity_scope=entity_scope,
                    entity_id=entity_id,
                    category="videos",
                    owner_id=owner_id,
                )
                if vfpath is not None and vfpath.is_file():
                    rel_vid_zip = f"media/{scope_dir}/{entity_id}/videos/{vfpath.name}"
                    media_sources[rel_vid_zip] = vfpath
                    staged_vid_path = rel_vid_zip
            except Exception as exc:
                logger.warning("Failed staging %s video asset for export: %s", entity_scope, sanitize_log_value(exc))
        if staged_vid_path:
            item_copy["video_url"] = staged_vid_path
        else:
            item_copy.pop("video_url", None)
            item_copy.pop("video_mime_type", None)
        item_copy.pop("video_asset_id", None)
        item_copy.pop("video_byte_size", None)
    return staged_img_url


def _serialize_persona_for_zcc(
    persona: PersonaRecord,
    *,
    repo: CantinaRepository | None = None,
    media_sources: dict[str, Path] | None = None,
    include_videos: bool = False,
    selected_video_ids: set[str] | None = None,
    owner_id: str | None = None,
) -> dict[str, Any]:
    """Serialize a PersonaRecord for .zcc export with top-level unsupported_fields re-emission."""
    persona_data = persona.model_dump()
    persona_data.pop("unsupported_fields", None)
    bio_norm = (persona.persona_bio or "").strip()
    phys_norm = str(persona_data.get("physical_appearance") or "").strip()
    if not phys_norm or phys_norm == bio_norm:
        persona_data.pop("physical_appearance", None)
    if repo is not None and media_sources is not None:
        if persona.portrait_url:
            persona_data["portrait_url"] = _stage_entity_image_and_optional_video(
                repo,
                entity_scope="persona",
                entity_id=persona.id,
                image_url=persona.portrait_url,
                image_category="portraits",
                item_copy=None,
                media_sources=media_sources,
                include_videos=False,
                selected_video_ids=None,
                owner_id=owner_id,
            )
        rewritten_gallery: list[dict[str, Any]] = []
        for g_item in persona_data.get("gallery", []):
            item_copy = dict(g_item)
            item_copy["url"] = _stage_entity_image_and_optional_video(
                repo,
                entity_scope="persona",
                entity_id=persona.id,
                image_url=str(g_item.get("url") or ""),
                image_category="gallery",
                item_copy=item_copy,
                media_sources=media_sources,
                include_videos=include_videos,
                selected_video_ids=selected_video_ids,
                owner_id=owner_id,
            )
            rewritten_gallery.append(item_copy)
        persona_data["gallery"] = rewritten_gallery
    for ext_k, ext_v in (persona.unsupported_fields or {}).items():
        if ext_k in CANONICAL_PERSONA_RECORD_KEYS:
            continue
        if ext_k == "physical_appearance" and (
            not isinstance(ext_v, str) or not ext_v.strip() or ext_v.strip() == bio_norm
        ):
            continue
        persona_data[ext_k] = ext_v
    return persona_data


def _serialize_world_for_zcc(
    world: WorldRecord,
    *,
    repo: CantinaRepository | None = None,
    media_sources: dict[str, Path] | None = None,
    include_media: bool = True,
    include_videos: bool = False,
    selected_video_ids: set[str] | None = None,
    owner_id: str | None = None,
) -> dict[str, Any]:
    """Serialize a WorldRecord for .zcc export, restoring extension keys and optionally staging media."""
    world_data = world.model_dump()
    world_data.pop("unsupported_fields", None)
    if include_media and repo is not None and media_sources is not None:
        staged_media: list[dict[str, Any]] = []
        for m_item in (world_data.get("media") or []):
            item_copy = dict(m_item)
            cat_dir = "audio" if item_copy.get("media_type") == "audio" else "images"
            item_copy["url"] = _stage_entity_image_and_optional_video(
                repo,
                entity_scope="world",
                entity_id=world.id,
                image_url=str(item_copy.get("url") or ""),
                image_category=cat_dir,
                item_copy=item_copy,
                media_sources=media_sources,
                include_videos=include_videos,
                selected_video_ids=selected_video_ids,
                owner_id=owner_id,
            )
            staged_media.append(item_copy)
        world_data["media"] = staged_media
    elif not include_media:
        world_data["media"] = []
        for cont in world_data.get("containers") or []:
            if isinstance(cont, dict):
                cont["image_media_id"] = None
                cont["image_url"] = None
                cont["image_label"] = None
                cont.pop("video_url", None)
                cont.pop("video_mime_type", None)
        for loc in world_data.get("locations") or []:
            if isinstance(loc, dict):
                loc["image_media_id"] = None
                loc["image_url"] = None
                loc["image_label"] = None
                loc.pop("video_url", None)
                loc.pop("video_mime_type", None)
    else:
        for cont in world_data.get("containers") or []:
            if isinstance(cont, dict) and not include_videos:
                cont.pop("video_url", None)
                cont.pop("video_mime_type", None)
        for loc in world_data.get("locations") or []:
            if isinstance(loc, dict) and not include_videos:
                loc.pop("video_url", None)
                loc.pop("video_mime_type", None)
    rules_dict = world_data.get("global_rules")
    if not isinstance(rules_dict, dict):
        rules_dict = {}
        world_data["global_rules"] = rules_dict
    for ext_k, ext_v in (world.unsupported_fields or {}).items():
        if ext_k.startswith("global_rules."):
            sub_k = ext_k[len("global_rules."):]
            if not sub_k or sub_k in CANONICAL_WORLD_GLOBAL_RULE_KEYS:
                continue
            rules_dict[sub_k] = ext_v
        else:
            if ext_k in CANONICAL_WORLD_RECORD_KEYS:
                continue
            world_data[ext_k] = ext_v
    return world_data


def _format_unsupported_fields_warning(
    entity_label: str,
    entity_name: str,
    keys_list: list[str],
) -> str:
    """Format a non-blocking import inspect warning for unsupported/deprecated fields."""
    preview = ", ".join(keys_list[:5])
    suffix = f" (+{len(keys_list) - 5} more)" if len(keys_list) > 5 else ""
    return (
        f"{entity_label} '{entity_name}' contains unsupported or deprecated fields ({preview}{suffix}). "
        "They will be preserved read-only under the Unsupported tab and excluded from AI roleplay context."
    )


# ---------------------------------------------------------------------------
# EXPORT IMPLEMENTATION
# ---------------------------------------------------------------------------


def _resolve_zip_member(rel_path: Any, zip_names: set[str]) -> str | None:
    """Resolve a JSON media reference against ZIP archive entry names."""
    if not isinstance(rel_path, str) or not rel_path:
        return None
    if rel_path in zip_names:
        return rel_path
    normalized = rel_path.replace("\\", "/").lstrip("/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized in zip_names:
        return normalized
    return None


def build_zcc_export_to_file(
    repo: CantinaRepository,
    character_ids: list[str],
    world_ids: list[str],
    persona_ids: list[str],
    owner_id: str,
    description: str = "",
    include_world_media: bool = True,
    include_videos: bool = False,
    selected_video_ids: list[str] | None = None,
    campaigns_json: list[dict[str, Any]] | None = None,
    base_only_worlds: bool = False,
    password: str | None = None,
) -> Path:
    """Stream selected characters, worlds, personas, optional campaigns, and media into a .zcc file on disk."""
    worlds: list[WorldRecord] = []
    personas: list[PersonaRecord] = []
    video_filter = set(selected_video_ids) if selected_video_ids is not None else None

    for wid in world_ids:
        try:
            worlds.append(repo.get_world(wid, base_only=base_only_worlds, owner_id=owner_id))
        except KeyError:
            continue

    exported_world_ids = {w.id for w in worlds}

    for pid in persona_ids:
        try:
            p = repo.get_persona(pid, owner_id=owner_id)
            if p:
                personas.append(p)
        except Exception:
            continue

    media_sources: dict[str, Path] = {}
    exported_characters_json: list[dict[str, Any]] = []

    for cid in character_ids:
        try:
            char = repo.get_character(cid, owner_id=owner_id)
        except KeyError:
            continue

        char_data = char.model_dump()
        char_data.pop("unsupported_fields", None)
        bio_norm = (char.character_bio or "").strip()
        phys_norm = str(char_data.get("physical_appearance") or "").strip()
        if not phys_norm or phys_norm == bio_norm:
            char_data.pop("physical_appearance", None)
        if not char_data.get("modifications"):
            char_data.pop("modifications", None)

        for ext_k, ext_v in (char.unsupported_fields or {}).items():
            if ext_k in CANONICAL_CHARACTER_RECORD_KEYS:
                continue
            if ext_k == "physical_appearance" and (
                not isinstance(ext_v, str) or not ext_v.strip() or ext_v.strip() == bio_norm
            ):
                continue
            if ext_k == "modifications" and (not isinstance(ext_v, list) or len(ext_v) == 0):
                continue
            char_data[ext_k] = ext_v

        if char.world_id not in exported_world_ids:
            char_data["world_id"] = None
            for it in char_data.get("equipped", []):
                if it.get("lore_id"):
                    it["lore_id"] = None
            for it in char_data.get("inventory", []):
                if it.get("lore_id"):
                    it["lore_id"] = None

        char_data["portraits"] = {
            emotion: _stage_entity_image_and_optional_video(
                repo,
                entity_scope="character",
                entity_id=char.id,
                image_url=url,
                image_category="portraits",
                item_copy=None,
                media_sources=media_sources,
                include_videos=False,
                selected_video_ids=None,
                owner_id=owner_id,
            )
            for emotion, url in char.portraits.items()
        }

        rewritten_gallery: list[dict[str, Any]] = []
        for g_item in char_data.get("gallery", []):
            item_copy = dict(g_item)
            item_copy["url"] = _stage_entity_image_and_optional_video(
                repo,
                entity_scope="character",
                entity_id=char.id,
                image_url=str(g_item.get("url") or ""),
                image_category="gallery",
                item_copy=item_copy,
                media_sources=media_sources,
                include_videos=include_videos,
                selected_video_ids=video_filter,
                owner_id=owner_id,
            )
            rewritten_gallery.append(item_copy)
        char_data["gallery"] = rewritten_gallery

        exported_characters_json.append(char_data)

    exported_worlds_json = [
        _serialize_world_for_zcc(
            w,
            repo=repo,
            media_sources=media_sources,
            include_media=include_world_media,
            include_videos=include_videos,
            selected_video_ids=video_filter,
            owner_id=owner_id,
        )
        for w in worlds
    ]
    exported_personas_json = [
        _serialize_persona_for_zcc(
            p,
            repo=repo,
            media_sources=media_sources,
            include_videos=include_videos,
            selected_video_ids=video_filter,
            owner_id=owner_id,
        )
        for p in personas
    ]

    exported_campaigns_json = list(campaigns_json or [])
    videos_count = sum(1 for p in media_sources if "/videos/" in p)
    images_count = len(media_sources) - videos_count
    manifest = ZccManifest(
        format_version=2 if exported_campaigns_json else 1,
        generator="CyberCantina",
        generator_version="0.30.0" if exported_campaigns_json else "0.5.0",
        exported_at=utc_now_iso(),
        description=description or f"CyberCantina bundle exported by {owner_id}",
        contents=ZccManifestContents(
            characters_count=len(exported_characters_json),
            worlds_count=len(exported_worlds_json),
            personas_count=len(exported_personas_json),
            campaigns_count=len(exported_campaigns_json),
            media_files_count=len(media_sources),
            images_count=images_count,
            videos_count=videos_count,
        ),
        dependencies={
            "worlds": list(exported_world_ids),
        },
    )

    out_path = safe_resolve_staging_file_path(
        repo.media_dir, f"export_{uuid.uuid4().hex}.zcc"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", manifest.model_dump_json(indent=2))
            if exported_characters_json:
                zf.writestr(
                    "characters.json",
                    json.dumps(exported_characters_json, indent=2, ensure_ascii=False),
                )
            if exported_worlds_json:
                zf.writestr(
                    "worlds.json",
                    json.dumps(exported_worlds_json, indent=2, ensure_ascii=False),
                )
            if exported_personas_json:
                zf.writestr(
                    "personas.json",
                    json.dumps(exported_personas_json, indent=2, ensure_ascii=False),
                )
            if exported_campaigns_json:
                zf.writestr(
                    "campaigns.json",
                    json.dumps(exported_campaigns_json, indent=2, ensure_ascii=False),
                )
            for rel_path, disk_path in media_sources.items():
                if disk_path.is_file():
                    zf.write(disk_path, arcname=rel_path, compress_type=zipfile.ZIP_STORED)

        if password:
            enc_path = safe_resolve_staging_file_path(
                repo.media_dir, f"export_{uuid.uuid4().hex}.zcc"
            )
            try:
                encrypt_file_to_zcc_enc(out_path, enc_path, password)
            finally:
                cleanup_staging_paths(out_path)
            return enc_path
        return out_path
    except Exception:
        cleanup_staging_paths(out_path)
        raise


def build_campaign_zcc_export_to_file(
    repo: CantinaRepository,
    campaign_id: str,
    owner_id: str,
    *,
    timeline_scope: Literal["full", "active"] = "full",
    strip_bookmark_comments: bool = False,
    include_world_media: bool = True,
    include_videos: bool = False,
    include_gm_chat: bool = False,
    selected_video_ids: list[str] | None = None,
    password: str | None = None,
) -> tuple[Path, str]:
    """Export a running campaign (and its base world, characters, persona, and state) into a .zcc v2 file."""
    extracted = extract_campaign_export_bundle(
        repo=repo,
        campaign_id=campaign_id,
        owner_id=owner_id,
        timeline_scope=timeline_scope,
        strip_bookmark_comments=strip_bookmark_comments,
        include_gm_chat=include_gm_chat,
    )
    camp_name = str(extracted.campaign_payload.get("name") or "campaign")
    out_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=extracted.character_ids,
        world_ids=[extracted.world_id],
        persona_ids=[extracted.persona_id] if extracted.persona_id else [],
        owner_id=owner_id,
        description=f"Campaign export ({timeline_scope} timeline): {camp_name}",
        include_world_media=include_world_media,
        include_videos=include_videos,
        selected_video_ids=selected_video_ids,
        campaigns_json=[extracted.campaign_payload],
        base_only_worlds=True,
        password=password,
    )
    return out_path, camp_name


def build_zcc_export(
    repo: CantinaRepository,
    character_ids: list[str],
    world_ids: list[str],
    persona_ids: list[str],
    owner_id: str,
    description: str = "",
    include_world_media: bool = True,
    include_videos: bool = False,
    selected_video_ids: list[str] | None = None,
    password: str | None = None,
) -> bytes:
    """Bundle selected characters, worlds, personas, and media into .zcc bytes (for tests and callers)."""
    tmp_path = build_zcc_export_to_file(
        repo=repo,
        character_ids=character_ids,
        world_ids=world_ids,
        persona_ids=persona_ids,
        owner_id=owner_id,
        description=description,
        include_world_media=include_world_media,
        include_videos=include_videos,
        selected_video_ids=selected_video_ids,
        password=password,
    )
    try:
        return tmp_path.read_bytes()
    finally:
        cleanup_staging_paths(tmp_path)


# ---------------------------------------------------------------------------
# INSPECT / AUTO-DETECT IMPLEMENTATION
# ---------------------------------------------------------------------------

def _count_zcc_media(
    zf: zipfile.ZipFile,
    characters_raw: list[dict[str, Any]],
    worlds_raw: list[dict[str, Any]],
    personas_raw: list[dict[str, Any]],
) -> tuple[int, int, int, int]:
    """Count unique image and video entries referenced in a .zcc archive and sum uncompressed sizes."""
    zip_names = set(zf.namelist())
    image_members: set[str] = set()
    video_members: set[str] = set()

    for w in worlds_raw:
        if not isinstance(w, dict):
            continue
        for m in w.get("media") or []:
            if not isinstance(m, dict):
                continue
            im = _resolve_zip_member(m.get("url", ""), zip_names)
            if im:
                image_members.add(im)
            vm = _resolve_zip_member(m.get("video_url", ""), zip_names)
            if vm:
                video_members.add(vm)

    for p in personas_raw:
        if not isinstance(p, dict):
            continue
        pm = _resolve_zip_member(p.get("portrait_url", ""), zip_names)
        if pm:
            image_members.add(pm)
        for g in p.get("gallery") or []:
            if not isinstance(g, dict):
                continue
            gm = _resolve_zip_member(g.get("url", ""), zip_names)
            if gm:
                image_members.add(gm)
            vm = _resolve_zip_member(g.get("video_url", ""), zip_names)
            if vm:
                video_members.add(vm)

    for c in characters_raw:
        if not isinstance(c, dict):
            continue
        for rel in (c.get("portraits") or {}).values():
            pm = _resolve_zip_member(rel, zip_names)
            if pm:
                image_members.add(pm)
        for g in c.get("gallery") or []:
            if not isinstance(g, dict):
                continue
            gm = _resolve_zip_member(g.get("url", ""), zip_names)
            if gm:
                image_members.add(gm)
            vm = _resolve_zip_member(g.get("video_url", ""), zip_names)
            if vm:
                video_members.add(vm)

    def _sum_members(members: set[str]) -> int:
        tot = 0
        for name in members:
            try:
                tot += int(zf.getinfo(name).file_size or 0)
            except KeyError:
                pass
        return tot

    return len(image_members), _sum_members(image_members), len(video_members), _sum_members(video_members)


def _inspect_zcc_archive(
    repo: CantinaRepository,
    *,
    source: bytes | Path,
    user_id: str,
    staged_token: str,
    register_entry: bool = True,
    existing_encrypted_path: Path | None = None,
) -> ImportInspectResponse:
    zf = _open_safe_zip(source)
    try:
        manifest: ZccManifest | None = None
        characters_raw: list[dict[str, Any]] = []
        worlds_raw: list[dict[str, Any]] = []
        personas_raw: list[dict[str, Any]] = []
        campaigns_raw: list[dict[str, Any]] = []

        if "manifest.json" in zf.namelist():
            try:
                manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
                manifest = ZccManifest.model_validate(manifest_data)
            except Exception as exc:
                logger.warning("Manifest parse failure: %s", sanitize_log_value(exc))

        if "characters.json" in zf.namelist():
            try:
                characters_raw = json.loads(zf.read("characters.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("characters.json parse failure: %s", sanitize_log_value(exc))

        if "worlds.json" in zf.namelist():
            try:
                worlds_raw = json.loads(zf.read("worlds.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("worlds.json parse failure: %s", sanitize_log_value(exc))

        if "personas.json" in zf.namelist():
            try:
                personas_raw = json.loads(zf.read("personas.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("personas.json parse failure: %s", sanitize_log_value(exc))

        if "campaigns.json" in zf.namelist():
            try:
                campaigns_raw = json.loads(zf.read("campaigns.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("campaigns.json parse failure: %s", sanitize_log_value(exc))

        if (
            not manifest
            and not characters_raw
            and not worlds_raw
            and not personas_raw
            and not campaigns_raw
        ):
            raise HTTPException(
                status_code=400,
                detail="Archive is not a valid CyberCantina package (no manifest or entity files found).",
            )

        images_count, images_bytes, videos_count, videos_bytes = _count_zcc_media(
            zf, characters_raw, worlds_raw, personas_raw
        )

        if not manifest:
            manifest = ZccManifest(
                format_version=2 if campaigns_raw else 1,
                generator="CyberCantina (Synthesized)",
                generator_version="0.30.0" if campaigns_raw else "0.5.0",
                exported_at=utc_now_iso(),
                contents=ZccManifestContents(
                    characters_count=len(characters_raw),
                    worlds_count=len(worlds_raw),
                    personas_count=len(personas_raw),
                    campaigns_count=len(campaigns_raw),
                    media_files_count=images_count + videos_count,
                    images_count=images_count,
                    videos_count=videos_count,
                ),
            )

        conflicts: list[ImportEntityConflict] = []
        user_chars = repo.list_characters(include_pending_deletion=False, owner_id=user_id)
        user_char_names = {c.name.strip().lower(): c.id for c in user_chars}

        for c in characters_raw:
            c_name = str(c.get("name") or "").strip()
            if c_name.lower() in user_char_names:
                conflicts.append(
                    ImportEntityConflict(
                        category="character",
                        incoming_id=str(c.get("id") or ""),
                        name=c_name,
                        existing_id=user_char_names[c_name.lower()],
                    )
                )

        existing_worlds = repo.list_worlds(include_pending_deletion=False, owner_id=user_id)
        user_world_names = {w.name.strip().lower(): w.id for w in existing_worlds}

        for w in worlds_raw:
            w_name = str(w.get("name") or "").strip()
            if w_name.lower() in user_world_names:
                conflicts.append(
                    ImportEntityConflict(
                        category="world",
                        incoming_id=str(w.get("id") or ""),
                        name=w_name,
                        existing_id=user_world_names[w_name.lower()],
                    )
                )

        existing_personas = repo.list_personas(owner_id=user_id)
        user_persona_names = {p.name.strip().lower(): p.id for p in existing_personas}

        for p in personas_raw:
            p_name = str(p.get("name") or "").strip()
            if p_name.lower() in user_persona_names:
                conflicts.append(
                    ImportEntityConflict(
                        category="persona",
                        incoming_id=str(p.get("id") or ""),
                        name=p_name,
                        existing_id=user_persona_names[p_name.lower()],
                    )
                )

        warnings: list[str] = []
        try:
            actor_user = repo.get_user_by_id(user_id)
        except KeyError:
            actor_user = None
        is_admin = actor_user is not None and actor_user.role == "admin"
        if not is_admin:
            if images_count > 0 and not settings.allow_image_uploads:
                warnings.append(
                    "Image uploads are currently disabled by the server administrator. "
                    "Allowed entities will import without images (and linked videos will be skipped)."
                )
            elif videos_count > 0 and not settings.allow_video_uploads:
                warnings.append(
                    "Video uploads are currently disabled by the server administrator. "
                    "Entities and images can still import, but videos will be skipped."
                )

        for c in characters_raw:
            if not isinstance(c, dict):
                continue
            c_name = str(c.get("name") or "Unnamed Character").strip() or "Unnamed Character"
            ext_fields = _extract_character_unsupported_fields(c, strict=False)
            if ext_fields:
                warnings.append(
                    _format_unsupported_fields_warning("Character", c_name, list(ext_fields.keys()))
                )

        for w in worlds_raw:
            if not isinstance(w, dict):
                continue
            w_name = str(w.get("name") or "Unnamed World").strip() or "Unnamed World"
            ext_fields = extract_world_unsupported_fields(w, strict=False)
            if ext_fields:
                warnings.append(
                    _format_unsupported_fields_warning("World", w_name, list(ext_fields.keys()))
                )
            nested_keys = find_nested_world_unsupported_keys(w)
            if nested_keys:
                preview = ", ".join(nested_keys[:5])
                suffix = f" (+{len(nested_keys) - 5} more)" if len(nested_keys) > 5 else ""
                warnings.append(
                    f"World '{w_name}' contains unrecognized keys on nested map entities ({preview}{suffix}) "
                    "which cannot be preserved in this version."
                )

        for p in personas_raw:
            if not isinstance(p, dict):
                continue
            p_name = str(p.get("name") or "Unnamed Persona").strip() or "Unnamed Persona"
            ext_fields = _extract_persona_unsupported_fields(p, strict=False)
            if ext_fields:
                warnings.append(
                    _format_unsupported_fields_warning("Persona", p_name, list(ext_fields.keys()))
                )

        char_summaries = [
            EntitySummary(
                id=str(c.get("id") or ""),
                name=str(c.get("name") or "Unnamed Character"),
                tagline=str(c.get("tagline") or ""),
                category="character",
                extra_info={"tags": c.get("tags", []), "has_portraits": bool(c.get("portraits"))},
            )
            for c in characters_raw
        ]
        world_summaries = [
            EntitySummary(
                id=str(w.get("id") or ""),
                name=str(w.get("name") or "Unnamed World"),
                category="world",
                extra_info={
                    "containers_count": len(w.get("containers", [])),
                    "locations_count": len(w.get("locations", [])),
                    "lore_count": len(w.get("lore_nodes", [])),
                },
            )
            for w in worlds_raw
        ]
        persona_summaries = [
            EntitySummary(
                id=str(p.get("id") or ""),
                name=str(p.get("name") or "Unnamed Persona"),
                tagline=str(p.get("tagline") or ""),
                category="persona",
                extra_info={"equipped_count": len(p.get("equipped", []))},
            )
            for p in personas_raw
        ]
        campaign_summaries: list[EntitySummary] = []
        for camp in campaigns_raw:
            if not isinstance(camp, dict):
                continue
            camp_turns = camp.get("turns") or []
            camp_chunks = camp.get("episodic_chunks") or []
            bookmarked_count = sum(1 for t in camp_turns if isinstance(t, dict) and t.get("is_bookmarked"))
            campaign_summaries.append(
                EntitySummary(
                    id=str(camp.get("id") or ""),
                    name=str(camp.get("name") or "Imported Campaign"),
                    tagline=f"{camp.get('world_name') or 'World'} • {camp.get('character_name') or 'Companion'}",
                    category="campaign",
                    extra_info={
                        "turns_count": len(camp_turns),
                        "summaries_count": len(camp_chunks),
                        "bookmarks_count": bookmarked_count,
                        "timeline_scope": str(camp.get("timeline_scope") or "full"),
                        "world_name": camp.get("world_name"),
                        "character_name": camp.get("character_name"),
                    },
                )
            )

        parsed_payload = {
            "manifest": manifest.model_dump(),
            "characters": characters_raw,
            "worlds": worlds_raw,
            "personas": personas_raw,
            "campaigns": campaigns_raw,
            "images_count": images_count,
            "videos_count": videos_count,
        }

        if register_entry:
            _register_staged_import(
                StagedImport(
                    token=staged_token,
                    user_id=user_id,
                    format_type="zcc",
                    is_native=True,
                    data_bytes=source if isinstance(source, bytes) else None,
                    staged_file_path=existing_encrypted_path or (source if isinstance(source, Path) else None),
                    decrypted_file_path=(source if (existing_encrypted_path and isinstance(source, Path)) else None),
                    requires_password=False,
                    created_at_epoch=time.time(),
                    parsed_payload=parsed_payload,
                )
            )
        else:
            with _staged_imports_lock:
                existing = _staged_imports.get(staged_token)
                if existing is not None:
                    existing.requires_password = False
                    existing.decrypted_file_path = source if isinstance(source, Path) else None
                    existing.parsed_payload = parsed_payload

        return ImportInspectResponse(
            is_native=True,
            format_type="zcc",
            staged_token=staged_token,
            requires_password=False,
            manifest=manifest,
            characters=char_summaries,
            worlds=world_summaries,
            personas=persona_summaries,
            campaigns=campaign_summaries,
            conflicts=conflicts,
            warnings=warnings,
            images_count=images_count,
            images_bytes=images_bytes,
            videos_count=videos_count,
            videos_bytes=videos_bytes,
        )
    finally:
        zf.close()


def inspect_uploaded_path(
    repo: CantinaRepository,
    staged_path: Path,
    filename: str,
    user_id: str,
) -> ImportInspectResponse:
    """Inspect a streamed file stored in .staging/, keeping large .zcc archives on disk."""
    _cleanup_expired_staged_imports()
    if not staged_path.is_file() or staged_path.stat().st_size == 0:
        cleanup_staging_paths(staged_path)
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    staged_token = f"stg_{uuid.uuid4().hex[:12]}"
    if is_encrypted_zcc_file(staged_path):
        _register_staged_import(
            StagedImport(
                token=staged_token,
                user_id=user_id,
                format_type="zcc",
                is_native=True,
                data_bytes=None,
                staged_file_path=staged_path,
                requires_password=True,
                created_at_epoch=time.time(),
                parsed_payload={},
            )
        )
        return ImportInspectResponse(
            is_native=True,
            format_type="zcc",
            staged_token=staged_token,
            requires_password=True,
        )

    with staged_path.open("rb") as f:
        lead = f.read(4)

    if lead.startswith(b"PK\x03\x04"):
        try:
            return _inspect_zcc_archive(
                repo, source=staged_path, user_id=user_id, staged_token=staged_token
            )
        except Exception:
            cleanup_staging_paths(staged_path)
            raise

    # SillyTavern PNG/JSON card: enforce strict RAM guard before reading into memory
    try:
        file_size = staged_path.stat().st_size
        if file_size > MAX_CARD_IMPORT_BYTES:
            max_mb = MAX_CARD_IMPORT_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"Uploaded character card exceeds maximum allowed size ({max_mb} MB).",
            )
        file_bytes = staged_path.read_bytes()
    finally:
        cleanup_staging_paths(staged_path)
    return inspect_uploaded_file(repo, file_bytes, filename, user_id)


def unlock_staged_import(
    repo: CantinaRepository,
    *,
    staged_token: str,
    password: str,
    user_id: str,
) -> ImportInspectResponse:
    """Decrypt a password-protected staged .zcc archive and inspect its contents."""
    with _staged_imports_lock:
        _cleanup_expired_staged_imports_locked()
        staged = _staged_imports.get(staged_token)
    if not staged:
        raise HTTPException(status_code=404, detail="Staged import session expired or not found.")
    if staged.user_id != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to staged import session.")
    if not staged.requires_password:
        raise HTTPException(status_code=400, detail="Staged import is not password-protected or is already unlocked.")

    src_path = staged.staged_file_path
    temp_enc_path: Path | None = None
    if src_path is None:
        if staged.data_bytes is None:
            raise HTTPException(status_code=404, detail="Encrypted archive payload is no longer available.")
        temp_enc_path = safe_resolve_staging_file_path(
            repo.media_dir, f"import_{uuid.uuid4().hex}.part"
        )
        temp_enc_path.parent.mkdir(parents=True, exist_ok=True)
        temp_enc_path.write_bytes(staged.data_bytes)
        src_path = temp_enc_path

    decrypted_path = safe_resolve_staging_file_path(
        repo.media_dir, f"unlock_{uuid.uuid4().hex}.zcc"
    )
    try:
        try:
            decrypt_zcc_enc_to_file(
                src_path,
                decrypted_path,
                password,
                max_output_bytes=MAX_TOTAL_UNCOMPRESSED_BYTES,
            )
        except ZccDecryptionError:
            cleanup_staging_paths(decrypted_path)
            raise HTTPException(
                status_code=401,
                detail="Incorrect password or corrupted encrypted archive.",
            ) from None
        except ZccCryptoFormatError as exc:
            cleanup_staging_paths(decrypted_path)
            raise HTTPException(status_code=400, detail=str(exc)) from None

        try:
            return _inspect_zcc_archive(
                repo,
                source=decrypted_path,
                user_id=user_id,
                staged_token=staged_token,
                register_entry=False,
            )
        except Exception:
            cleanup_staging_paths(decrypted_path)
            raise
    finally:
        if temp_enc_path is not None:
            cleanup_staging_paths(temp_enc_path)


def inspect_uploaded_file(
    repo: CantinaRepository,
    file_bytes: bytes,
    filename: str,
    user_id: str,
) -> ImportInspectResponse:
    """Inspect and stage an uploaded file, detecting whether it is a .zcc archive or a SillyTavern card."""
    _cleanup_expired_staged_imports()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    staged_token = f"stg_{uuid.uuid4().hex[:12]}"

    # A0) Check ZCCENC01 encrypted archive header
    if is_encrypted_zcc_bytes(file_bytes):
        staged_path = safe_resolve_staging_file_path(
            repo.media_dir, f"import_{uuid.uuid4().hex}.part"
        )
        staged_path.parent.mkdir(parents=True, exist_ok=True)
        staged_path.write_bytes(file_bytes)
        _register_staged_import(
            StagedImport(
                token=staged_token,
                user_id=user_id,
                format_type="zcc",
                is_native=True,
                data_bytes=None,
                staged_file_path=staged_path,
                requires_password=True,
                created_at_epoch=time.time(),
                parsed_payload={},
            )
        )
        return ImportInspectResponse(
            is_native=True,
            format_type="zcc",
            staged_token=staged_token,
            requires_password=True,
        )

    # A) Check ZIP signature (PK\x03\x04)
    if file_bytes.startswith(b"PK\x03\x04"):
        return _inspect_zcc_archive(
            repo, source=file_bytes, user_id=user_id, staged_token=staged_token
        )

    if len(file_bytes) > MAX_CARD_IMPORT_BYTES:
        max_mb = MAX_CARD_IMPORT_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Uploaded character card exceeds maximum allowed size ({max_mb} MB).",
        )

    # B) Check PNG or JSON SillyTavern card
    try:
        pkg = extract_card_from_bytes(file_bytes, filename=filename)
        _register_staged_import(
            StagedImport(
                token=staged_token,
                user_id=user_id,
                format_type="sillytavern_png" if file_bytes.startswith(b"\x89PNG") else "sillytavern_json",
                is_native=False,
                data_bytes=file_bytes,
                created_at_epoch=time.time(),
                parsed_payload={
                    "name": pkg.card.name,
                    "description": pkg.card.description,
                    "creator_notes": pkg.card.creator_notes,
                },
            )
        )
        return ImportInspectResponse(
            is_native=False,
            format_type="sillytavern_png" if file_bytes.startswith(b"\x89PNG") else "sillytavern_json",
            staged_token=staged_token,
            characters=[
                EntitySummary(
                    id="draft_st",
                    name=pkg.card.name or "SillyTavern Character",
                    tagline=pkg.card.creator_notes or pkg.card.description[:80],
                    category="character",
                )
            ],
            manifest=None,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.debug("Not a SillyTavern card: %s", sanitize_log_value(exc))

    raise HTTPException(
        status_code=400,
        detail="Unrecognized file format. Please upload a .zcc archive, .zip package, or SillyTavern character card (.png / .json).",
    )


# ---------------------------------------------------------------------------
# COMMIT IMPORT IMPLEMENTATION
# ---------------------------------------------------------------------------

def _extract_zip_video_to_staging(
    zf: zipfile.ZipFile,
    member_name: str,
    *,
    media_dir: str | Path,
    max_bytes: int,
) -> tuple[Path, VideoProbeMetadata]:
    """Stream a .zcc video entry in 64 KB chunks to .staging/, enforce max_bytes, and probe."""
    info = zf.getinfo(member_name)
    max_mb = max_bytes / (1024 * 1024)
    if int(info.file_size or 0) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Imported video '{Path(member_name).name}' exceeds the maximum allowed upload size ({max_mb:.1f} MB).",
        )
    staged_path = safe_resolve_staging_file_path(
        media_dir, f"zcc_vid_{uuid.uuid4().hex}.part"
    )
    staged_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with zf.open(info, "r") as src_f, staged_path.open("wb") as dst_f:
            while True:
                chunk = src_f.read(65536)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Imported video '{Path(member_name).name}' exceeds the maximum allowed upload size ({max_mb:.1f} MB).",
                    )
                dst_f.write(chunk)
        probe = probe_video_file(staged_path)
        return staged_path, probe
    except BaseException:
        cleanup_staging_paths(staged_path)
        raise


async def commit_staged_import(
    repo: CantinaRepository,
    req: ImportCommitRequest,
    user_id: str,
) -> ImportCommitResponse:
    """Execute transactional ingestion of a staged native CyberCantina bundle."""
    with _staged_imports_lock:
        _cleanup_expired_staged_imports_locked()
        staged = _staged_imports.get(req.staged_token)
    if not staged:
        raise HTTPException(status_code=404, detail="Staged import session expired or not found.")

    if staged.user_id != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized access to staged import session.")

    if not staged.is_native:
        raise HTTPException(
            status_code=400,
            detail="Staged file is a SillyTavern card. SillyTavern cards must be committed via the Character Creation Wizard.",
        )

    if staged.requires_password:
        raise HTTPException(
            status_code=400,
            detail="Archive is password-protected and must be unlocked before importing.",
        )

    zip_source: bytes | Path = (
        staged.decrypted_file_path
        if staged.decrypted_file_path is not None
        else (
            staged.staged_file_path
            if staged.staged_file_path is not None
            else (staged.data_bytes or b"")
        )
    )
    zf = _open_safe_zip(zip_source)
    characters_data: list[dict[str, Any]] = staged.parsed_payload.get("characters", [])
    worlds_data: list[dict[str, Any]] = staged.parsed_payload.get("worlds", [])
    personas_data: list[dict[str, Any]] = staged.parsed_payload.get("personas", [])
    campaigns_data: list[dict[str, Any]] = staged.parsed_payload.get("campaigns", [])

    has_campaigns = len(campaigns_data) > 0
    standalone_campaign_assets = bool(req.import_campaign_assets_as_standalone)
    campaign_world_ids: set[str] = {
        str(c.get("world_id") or "") for c in campaigns_data if isinstance(c, dict) and c.get("world_id")
    }
    campaign_char_ids: set[str] = set()
    campaign_persona_ids: set[str] = set()
    for camp_item in campaigns_data:
        if not isinstance(camp_item, dict):
            continue
        if camp_item.get("character_id"):
            campaign_char_ids.add(str(camp_item["character_id"]))
        for cc in camp_item.get("campaign_characters") or []:
            if isinstance(cc, dict) and cc.get("character_id"):
                campaign_char_ids.add(str(cc["character_id"]))
        if camp_item.get("persona_id"):
            campaign_persona_ids.add(str(camp_item["persona_id"]))

    try:
        actor_user = repo.get_user_by_id(user_id)
    except KeyError:
        actor_user = None
    is_admin = actor_user is not None and actor_user.role == "admin"
    quota_bytes = get_user_quota_bytes(actor_user) if actor_user is not None else None

    eff_images = bool(req.import_images) and (is_admin or bool(settings.allow_image_uploads))
    eff_videos = bool(req.import_videos) and eff_images and (is_admin or bool(settings.allow_video_uploads))

    commit_warnings: list[str] = []
    archive_images_count = int(staged.parsed_payload.get("images_count") or 0)
    archive_videos_count = int(staged.parsed_payload.get("videos_count") or 0)
    if req.import_images and not eff_images and archive_images_count > 0:
        commit_warnings.append(
            "Image uploads are disabled by the server administrator; archive images (and linked videos) were skipped."
        )
    elif req.import_videos and not eff_videos and archive_videos_count > 0:
        if not eff_images:
            commit_warnings.append(
                "Videos require importing their parent images; archive videos were skipped."
            )
        else:
            commit_warnings.append(
                "Video uploads are disabled by the server administrator; archive videos were skipped."
            )

    pre_rendered_media: dict[tuple[int, str, str], bytes] = {}
    pre_rendered_world_media: dict[tuple[int, int], bytes] = {}
    pre_rendered_persona_media: dict[tuple[int, str, str], bytes] = {}
    staged_videos: dict[tuple[str, int, int], tuple[Path, VideoProbeMetadata]] = {}
    temp_staging_files: list[Path] = []
    zip_names = set(zf.namelist())
    max_video_bytes = int(round(float(settings.max_video_upload_mb) * 1024 * 1024))

    try:
        total_media_bytes = 0
        if eff_images:
            for p_idx, p in enumerate(personas_data):
                old_p_id = str(p.get("id") or "")
                p_name = str(p.get("name") or "Unnamed Persona").strip()
                p_strategy = (
                    req.conflict_strategies.get(old_p_id)
                    or req.conflict_strategies.get(p_name)
                    or req.default_conflict_strategy
                )
                if p_strategy == "skip":
                    continue
                raw_portrait = p.get("portrait_url")
                if isinstance(raw_portrait, str) and raw_portrait.strip():
                    zip_member = _resolve_zip_member(raw_portrait, zip_names)
                    if zip_member:
                        webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=True, max_size=512)
                        pre_rendered_persona_media[(p_idx, "portrait", "default")] = webp_bytes
                        total_media_bytes += len(webp_bytes)
                for g_idx, g_item in enumerate(p.get("gallery") or []):
                    if not isinstance(g_item, dict):
                        continue
                    zip_member = _resolve_zip_member(g_item.get("url", ""), zip_names)
                    if zip_member:
                        webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                        pre_rendered_persona_media[(p_idx, "gallery", str(g_idx))] = webp_bytes
                        total_media_bytes += len(webp_bytes)
                        if eff_videos:
                            v_member = _resolve_zip_member(g_item.get("video_url", ""), zip_names)
                            if v_member:
                                v_path, v_probe = _extract_zip_video_to_staging(
                                    zf, v_member, media_dir=repo.media_dir, max_bytes=max_video_bytes
                                )
                                temp_staging_files.append(v_path)
                                staged_videos[("persona", p_idx, g_idx)] = (v_path, v_probe)
                                total_media_bytes += v_probe.byte_size

            for w_idx, w in enumerate(worlds_data):
                old_world_id = str(w.get("id") or "")
                w_name = str(w.get("name") or "Unnamed World").strip()
                w_strategy = (
                    req.conflict_strategies.get(old_world_id)
                    or req.conflict_strategies.get(w_name)
                    or req.default_conflict_strategy
                )
                if w_strategy == "skip" and old_world_id not in campaign_world_ids:
                    continue
                for m_idx, m_item in enumerate(w.get("media") or []):
                    if not isinstance(m_item, dict):
                        continue
                    if str(m_item.get("media_type") or "image") != "image":
                        continue
                    zip_member = _resolve_zip_member(m_item.get("url", ""), zip_names)
                    if zip_member:
                        webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                        pre_rendered_world_media[(w_idx, m_idx)] = webp_bytes
                        total_media_bytes += len(webp_bytes)
                        if eff_videos:
                            v_member = _resolve_zip_member(m_item.get("video_url", ""), zip_names)
                            if v_member:
                                v_path, v_probe = _extract_zip_video_to_staging(
                                    zf, v_member, media_dir=repo.media_dir, max_bytes=max_video_bytes
                                )
                                temp_staging_files.append(v_path)
                                staged_videos[("world", w_idx, m_idx)] = (v_path, v_probe)
                                total_media_bytes += v_probe.byte_size

            for c_idx, c in enumerate(characters_data):
                old_c_id = str(c.get("id") or "")
                c_name = str(c.get("name") or "Unnamed Character").strip()
                strategy = (
                    req.conflict_strategies.get(old_c_id)
                    or req.conflict_strategies.get(c_name)
                    or req.default_conflict_strategy
                )
                if strategy == "skip" and old_c_id not in campaign_char_ids:
                    continue
                for emotion, rel_path in (c.get("portraits") or {}).items():
                    clean_emotion = str(emotion).strip().lower()
                    zip_member = _resolve_zip_member(rel_path, zip_names)
                    if zip_member and clean_emotion in VALID_EMOTIONS:
                        webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=True, max_size=512)
                        pre_rendered_media[(c_idx, "portrait", clean_emotion)] = webp_bytes
                        total_media_bytes += len(webp_bytes)
                for g_idx, g_item in enumerate(c.get("gallery") or []):
                    if not isinstance(g_item, dict):
                        continue
                    zip_member = _resolve_zip_member(g_item.get("url", ""), zip_names)
                    if zip_member:
                        webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                        pre_rendered_media[(c_idx, "gallery", str(g_idx))] = webp_bytes
                        total_media_bytes += len(webp_bytes)
                        if eff_videos:
                            v_member = _resolve_zip_member(g_item.get("video_url", ""), zip_names)
                            if v_member:
                                v_path, v_probe = _extract_zip_video_to_staging(
                                    zf, v_member, media_dir=repo.media_dir, max_bytes=max_video_bytes
                                )
                                temp_staging_files.append(v_path)
                                staged_videos[("character", c_idx, g_idx)] = (v_path, v_probe)
                                total_media_bytes += v_probe.byte_size

        if quota_bytes is not None and actor_user is not None and total_media_bytes > 0:
            with get_user_media_lock(actor_user.id):
                used_bytes = get_user_media_usage_bytes(repo, actor_user.id)
                if used_bytes + total_media_bytes > quota_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Import media ({format_mb(total_media_bytes)}) exceeds your remaining "
                            f"media quota ({format_mb(used_bytes)} / {format_mb(quota_bytes)} used)."
                        ),
                    )

        imported_characters: list[str] = []
        imported_worlds: list[str] = []
        imported_personas: list[str] = []
        imported_campaigns: list[str] = []
        skipped_entities: list[str] = []
        errors: list[str] = []

        id_remap: dict[str, str] = {}
        campaign_private_world_ids: set[str] = set()
        campaign_private_char_ids: set[str] = set()

        # 1. Ingest Worlds
        for w_idx, w in enumerate(worlds_data):
            old_world_id = str(w.get("id") or "")
            w_name = str(w.get("name") or "Unnamed World").strip()
            strategy = (
                req.conflict_strategies.get(old_world_id)
                or req.conflict_strategies.get(w_name)
                or req.default_conflict_strategy
            )

            is_camp_world = has_campaigns and old_world_id in campaign_world_ids
            is_campaign_private_world = False
            if is_camp_world and not standalone_campaign_assets:
                is_campaign_private_world = True
            elif strategy == "skip":
                skipped_entities.append(f"World: {w_name}")
                if is_camp_world:
                    # Keep a campaign-private snapshot so the imported campaign still runs intact
                    is_campaign_private_world = True
                else:
                    continue

            written_world_files: list[Path] = []
            try:
                new_world_id = f"world_{uuid.uuid4().hex[:10]}"
                id_remap[old_world_id] = new_world_id

                final_name = w_name
                if not is_campaign_private_world and strategy == "copy":
                    existing = [ew for ew in repo.list_worlds(owner_id=user_id) if ew.name.strip().lower() == w_name.lower()]
                    if existing:
                        final_name = f"{w_name} (Imported)"

                try:
                    world_unsupported = extract_world_unsupported_fields(w, strict=True)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc
                canonical_rules = WorldGlobalRules.model_validate(w.get("global_rules") or {})

                imported_world_media_rows: list[tuple[str, str, str, str, str, int, int, str]] = []
                imported_world_videos: list[tuple[str, str, str, str, int, int | None, int | None, int | None, str, str]] = []
                now = utc_now_iso()
                if eff_images:
                    for m_idx, m_item in enumerate(w.get("media") or []):
                        if not isinstance(m_item, dict):
                            continue
                        if str(m_item.get("media_type") or "image") != "image":
                            continue
                        zip_member = _resolve_zip_member(m_item.get("url", ""), zip_names)
                        if not zip_member:
                            continue
                        old_media_id = str(m_item.get("id") or "")
                        new_media_id = f"wmed_{uuid.uuid4().hex[:10]}"
                        if old_media_id:
                            id_remap[old_media_id] = new_media_id
                        filename = f"{new_media_id}.webp"
                        target_path = safe_resolve_asset_path(
                            "images", filename, media_dir=repo.media_dir
                        )
                        pre = pre_rendered_world_media.get((w_idx, m_idx))
                        webp_bytes = (
                            pre
                            if pre is not None
                            else render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                        )
                        if actor_user is not None:
                            enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                        else:
                            target_path.parent.mkdir(parents=True, exist_ok=True)
                            target_path.write_bytes(webp_bytes)
                        written_world_files.append(target_path)
                        byte_sz = len(webp_bytes)

                        sort_ord = int(m_item.get("sort_order") if m_item.get("sort_order") is not None else len(imported_world_media_rows))
                        imported_world_media_rows.append(
                            (
                                new_media_id,
                                "image",
                                filename,
                                str(m_item.get("label") or "").strip(),
                                "image/webp",
                                byte_sz,
                                sort_ord,
                                str(m_item.get("created_at") or now),
                            )
                        )
                        staged_v = staged_videos.get(("world", w_idx, m_idx))
                        if staged_v is not None:
                            v_src, v_probe = staged_v
                            vid_id = f"vid_{uuid.uuid4().hex[:10]}"
                            vid_fname = f"{vid_id}{v_probe.extension}"
                            vid_dst = safe_resolve_asset_path(
                                "videos", vid_fname, media_dir=repo.media_dir
                            )
                            if actor_user is not None:
                                enforce_quota_and_commit_staged_files(repo, actor_user, [(v_src, vid_dst)])
                            else:
                                vid_dst.parent.mkdir(parents=True, exist_ok=True)
                                os.replace(v_src, vid_dst)
                            written_world_files.append(vid_dst)
                            imported_world_videos.append(
                                (
                                    vid_id,
                                    vid_fname,
                                    v_probe.mime_type,
                                    str(m_item.get("label") or "").strip(),
                                    v_probe.byte_size,
                                    v_probe.duration_ms,
                                    v_probe.width,
                                    v_probe.height,
                                    new_media_id,
                                    now,
                                )
                            )

                conn = repo._connect()
                try:
                    conn.execute(
                        "INSERT INTO worlds (id, owner_id, name, global_rules_json, unsupported_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (
                            new_world_id,
                            user_id,
                            final_name,
                            canonical_rules.model_dump_json(),
                            json.dumps(world_unsupported),
                            now,
                        ),
                    )

                    valid_imported_media_ids: set[str] = set()
                    for (
                        m_id,
                        m_type,
                        m_fname,
                        m_label,
                        m_mime,
                        m_bytes,
                        m_sort,
                        m_created,
                    ) in imported_world_media_rows:
                        valid_imported_media_ids.add(m_id)
                        conn.execute(
                            """
                            INSERT INTO media_assets (
                                id, owner_id, entity_scope, media_type, role, filename, label,
                                mime_type, byte_size, is_public, seed_key, parent_image_id, created_at
                            )
                            VALUES (?, ?, 'world', ?, 'world_scene', ?, ?, ?, ?, 0, NULL, NULL, ?)
                            """,
                            (m_id, user_id, m_type, m_fname, m_label, m_mime, m_bytes, m_created),
                        )
                        conn.execute(
                            """
                            INSERT INTO world_media_links (world_id, media_id, sort_order, created_at)
                            VALUES (?, ?, ?, ?)
                            """,
                            (new_world_id, m_id, m_sort, now),
                        )

                    for (
                        vid_id,
                        vid_fname,
                        vid_mime,
                        vid_label,
                        vid_bytes,
                        vid_dur,
                        vid_w,
                        vid_h,
                        parent_img_id,
                        vid_created,
                    ) in imported_world_videos:
                        conn.execute(
                            """
                            INSERT INTO media_assets (
                                id, owner_id, entity_scope, media_type, role, filename, label,
                                mime_type, byte_size, is_public, seed_key, parent_image_id,
                                duration_ms, width, height, created_at
                            )
                            VALUES (?, ?, 'world', 'video', 'linked_video', ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)
                            """,
                            (vid_id, user_id, vid_fname, vid_label, vid_mime, vid_bytes, parent_img_id, vid_dur, vid_w, vid_h, vid_created),
                        )

                    raw_containers = sorted(
                        w.get("containers", []),
                        key=lambda c: int(c.get("depth", 1)),
                        reverse=True,
                    )
                    for cont in raw_containers:
                        old_cont_id = cont.get("id")
                        new_cont_id = f"cont_{uuid.uuid4().hex[:10]}"
                        if old_cont_id:
                            id_remap[old_cont_id] = new_cont_id
                        old_parent_id = cont.get("parent_container_id")
                        mapped_parent_id = (
                            id_remap.get(old_parent_id) if old_parent_id else None
                        )
                        old_cont_media = cont.get("image_media_id")
                        mapped_cont_media = (
                            id_remap.get(old_cont_media)
                            if old_cont_media and id_remap.get(old_cont_media) in valid_imported_media_ids
                            else None
                        )
                        c_depth = int(cont.get("depth", 1))
                        conn.execute(
                            """
                            INSERT INTO location_containers (
                                id, world_id, created_at_turn_id, parent_container_id, depth, name,
                                description, environmental_tags_json, ui_x, ui_y, icon, image_media_id, created_at
                            )
                            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                new_cont_id,
                                new_world_id,
                                mapped_parent_id,
                                c_depth,
                                cont.get("name", "Unnamed Container"),
                                cont.get("description", ""),
                                json.dumps(cont.get("environmental_tags", [])),
                                cont.get("ui_x"),
                                cont.get("ui_y"),
                                cont.get("icon"),
                                mapped_cont_media,
                                cont.get("created_at") or now,
                            ),
                        )
                        if c_depth == 1:
                            for c_lore in cont.get("lore_nodes", []):
                                old_cl_id = c_lore.get("id")
                                new_cl_id = f"lore_{uuid.uuid4().hex[:10]}"
                                if old_cl_id:
                                    id_remap[old_cl_id] = new_cl_id
                                clean_c_cat = normalize_lore_category(
                                    c_lore.get("category", "history"),
                                    allow_secret=True,
                                    allow_artifact=False,
                                    strict=False,
                                )
                                conn.execute(
                                    """
                                    INSERT INTO lore_nodes (
                                        id, world_id, location_id, container_id, campaign_id,
                                        title, category, content, entity_tags_json
                                    )
                                    VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)
                                    """,
                                    (
                                        new_cl_id,
                                        new_world_id,
                                        new_cont_id,
                                        c_lore.get("title", "Container Lore"),
                                        clean_c_cat,
                                        c_lore.get("content", ""),
                                        json.dumps(c_lore.get("entity_tags", [])),
                                    ),
                                )
                                if clean_c_cat != "secret":
                                    vec_title, vec_kws = _location_lore_vector_fields(
                                        cont.get("name", ""),
                                        c_lore.get("title", ""),
                                        c_lore.get("entity_tags", []),
                                    )
                                    repo.vector_store.upsert_entry(
                                        entry_id=new_cl_id,
                                        source_type="container_lore",
                                        world_id=new_world_id,
                                        container_id=new_cont_id,
                                        title=vec_title,
                                        content=c_lore.get("content", ""),
                                        keywords=vec_kws,
                                        embedding=None,
                                        conn=conn,
                                    )

                    for loc in w.get("locations", []):
                        old_loc_id = loc.get("id")
                        new_loc_id = f"loc_{uuid.uuid4().hex[:10]}"
                        if old_loc_id:
                            id_remap[old_loc_id] = new_loc_id
                        old_loc_cont_id = loc.get("container_id")
                        mapped_loc_cont_id = (
                            id_remap.get(old_loc_cont_id) if old_loc_cont_id else None
                        )
                        old_loc_media = loc.get("image_media_id")
                        mapped_loc_media = (
                            id_remap.get(old_loc_media)
                            if old_loc_media and id_remap.get(old_loc_media) in valid_imported_media_ids
                            else None
                        )
                        conn.execute(
                            """
                            INSERT INTO location_nodes (
                                id, world_id, created_at_turn_id, superseded_at_turn_id, container_id,
                                name, summary, description, environmental_tags_json,
                                is_starting_location, is_hub, is_entry_exit, starting_message,
                                ui_x, ui_y, icon, image_media_id
                            )
                            VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                new_loc_id,
                                new_world_id,
                                mapped_loc_cont_id,
                                loc.get("name", "Unnamed Location"),
                                loc.get("summary", ""),
                                loc.get("description", ""),
                                json.dumps(loc.get("environmental_tags", [])),
                                1 if loc.get("is_starting_location") else 0,
                                1 if loc.get("is_hub") else 0,
                                1 if loc.get("is_entry_exit") else 0,
                                loc.get("starting_message", "") or "",
                                loc.get("ui_x"),
                                loc.get("ui_y"),
                                loc.get("icon"),
                                mapped_loc_media,
                            ),
                        )

                        for loc_lore in loc.get("lore_nodes", []):
                            old_ll_id = loc_lore.get("id")
                            new_ll_id = f"lore_{uuid.uuid4().hex[:10]}"
                            if old_ll_id:
                                id_remap[old_ll_id] = new_ll_id
                            clean_ll_cat = normalize_lore_category(
                                loc_lore.get("category", "history"),
                                allow_secret=True,
                                allow_artifact=False,
                                strict=False,
                            )
                            conn.execute(
                                """
                                INSERT INTO lore_nodes (
                                    id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                                )
                                VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                                """,
                                (
                                    new_ll_id,
                                    new_world_id,
                                    new_loc_id,
                                    loc_lore.get("title", "Lore"),
                                    clean_ll_cat,
                                    loc_lore.get("content", ""),
                                    json.dumps(loc_lore.get("entity_tags", [])),
                                ),
                            )
                            if clean_ll_cat != "secret":
                                vec_title, vec_kws = _location_lore_vector_fields(
                                    loc.get("name", ""),
                                    loc_lore.get("title", ""),
                                    loc_lore.get("entity_tags", []),
                                )
                                repo.vector_store.upsert_entry(
                                    entry_id=f"lore_{new_ll_id}",
                                    source_type="location_lore",
                                    world_id=new_world_id,
                                    location_id=new_loc_id,
                                    title=vec_title,
                                    content=loc_lore.get("content", ""),
                                    keywords=vec_kws,
                                    embedding=None,
                                    conn=conn,
                                )

                    for w_lore in w.get("lore_nodes", []):
                        old_wl_id = w_lore.get("id")
                        new_wl_id = f"lore_{uuid.uuid4().hex[:10]}"
                        if old_wl_id:
                            id_remap[old_wl_id] = new_wl_id
                        clean_wl_cat = normalize_lore_category(
                            w_lore.get("category", "history"),
                            allow_secret=False,
                            allow_artifact=True,
                            strict=False,
                        )
                        conn.execute(
                            """
                            INSERT INTO lore_nodes (
                                id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                            )
                            VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
                            """,
                            (
                                new_wl_id,
                                new_world_id,
                                w_lore.get("title", "World Lore"),
                                clean_wl_cat,
                                w_lore.get("content", ""),
                                json.dumps(w_lore.get("entity_tags", [])),
                            ),
                        )
                        repo.vector_store.upsert_entry(
                            entry_id=f"lore_{new_wl_id}",
                            source_type="lore",
                            world_id=new_world_id,
                            title=w_lore.get("title", "World Lore"),
                            content=w_lore.get("content", ""),
                            keywords=w_lore.get("entity_tags", []),
                            embedding=None,
                            conn=conn,
                        )

                    for edge in w.get("edges", []):
                        old_edge_id = edge.get("id")
                        new_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                        if old_edge_id:
                            id_remap[str(old_edge_id)] = new_edge_id
                        from_id = id_remap.get(edge.get("from_location_id", ""), edge.get("from_location_id"))
                        to_id = id_remap.get(edge.get("to_location_id", ""), edge.get("to_location_id"))
                        conn.execute(
                            """
                            INSERT INTO location_edges (
                                id, world_id, from_location_id, to_location_id,
                                direction_label, compass_direction, travel_minutes, is_locked_or_hidden,
                                created_at_turn_id, superseded_at_turn_id
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                            """,
                            (
                                new_edge_id,
                                new_world_id,
                                from_id,
                                to_id,
                                edge.get("direction_label", "forward"),
                                edge.get("compass_direction"),
                                edge.get("travel_minutes", 1),
                                1 if edge.get("is_locked_or_hidden") else 0,
                            ),
                        )

                    conn.commit()
                    if is_campaign_private_world:
                        campaign_private_world_ids.add(new_world_id)
                    else:
                        imported_worlds.append(final_name)
                finally:
                    conn.close()

            except HTTPException:
                for wf in written_world_files:
                    wf.unlink(missing_ok=True)
                raise
            except Exception as exc:
                for wf in written_world_files:
                    wf.unlink(missing_ok=True)
                logger.exception("Failed importing world '%s': %s", sanitize_log_value(w_name), sanitize_log_value(exc))
                errors.append(f"World '{w_name}': {exc}")

        # 2. Ingest Personas
        for p_idx, p in enumerate(personas_data):
            old_p_id = str(p.get("id") or "")
            p_name = str(p.get("name") or "Unnamed Persona").strip()
            if has_campaigns and old_p_id in campaign_persona_ids and not standalone_campaign_assets:
                # Campaign runs from persona_snapshot_json with persona_id = NULL
                continue
            strategy = (
                req.conflict_strategies.get(old_p_id)
                or req.conflict_strategies.get(p_name)
                or req.default_conflict_strategy
            )

            if strategy == "skip":
                skipped_entities.append(f"Persona: {p_name}")
                continue

            registered_persona_asset_ids: list[str] = []
            written_persona_files: list[Path] = []
            try:
                new_p_id = f"persona_{uuid.uuid4().hex[:10]}"
                id_remap[old_p_id] = new_p_id
                final_name = p_name
                if strategy == "copy":
                    existing = [ep for ep in repo.list_personas(owner_id=user_id) if ep.name.strip().lower() == p_name.lower()]
                    if existing:
                        final_name = f"{p_name} (Imported)"

                try:
                    persona_unsupported = _extract_persona_unsupported_fields(p, strict=True)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc

                new_portrait_url: str | None = None
                if eff_images:
                    raw_portrait = p.get("portrait_url")
                    if isinstance(raw_portrait, str) and raw_portrait.strip():
                        zip_member = _resolve_zip_member(raw_portrait, zip_names)
                        if zip_member:
                            p_asset_id = f"por_{uuid.uuid4().hex[:10]}"
                            filename = f"{p_asset_id}.webp"
                            target_path = safe_resolve_asset_path(
                                "images", filename, media_dir=repo.media_dir
                            )
                            pre = pre_rendered_persona_media.get((p_idx, "portrait", "default"))
                            webp_bytes = pre if pre is not None else render_webp_bytes(
                                zf.read(zip_member), square_crop=True, max_size=512
                            )
                            if actor_user is not None:
                                enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                            else:
                                target_path.parent.mkdir(parents=True, exist_ok=True)
                                target_path.write_bytes(webp_bytes)
                            written_persona_files.append(target_path)
                            repo.register_media_asset(
                                asset_id=p_asset_id,
                                owner_id=user_id,
                                entity_scope="persona",
                                media_type="image",
                                role="portrait",
                                filename=filename,
                                mime_type="image/webp",
                                byte_size=len(webp_bytes),
                            )
                            registered_persona_asset_ids.append(p_asset_id)
                            new_portrait_url = build_asset_url(p_asset_id)
                        elif raw_portrait.strip().startswith(("http://", "https://")):
                            new_portrait_url = raw_portrait.strip()

                new_persona_gallery: list[GalleryImage] = []
                if eff_images:
                    for g_idx, g_item in enumerate(p.get("gallery") or []):
                        if not isinstance(g_item, dict):
                            continue
                        rel_path = str(g_item.get("url") or "").strip()
                        zip_member = _resolve_zip_member(rel_path, zip_names)
                        if zip_member:
                            g_id = f"img_{uuid.uuid4().hex[:10]}"
                            filename = f"{g_id}.webp"
                            target_path = safe_resolve_asset_path(
                                "images", filename, media_dir=repo.media_dir
                            )
                            pre = pre_rendered_persona_media.get((p_idx, "gallery", str(g_idx)))
                            webp_bytes = pre if pre is not None else render_webp_bytes(
                                zf.read(zip_member), square_crop=False, max_size=1920
                            )
                            if actor_user is not None:
                                enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                            else:
                                target_path.parent.mkdir(parents=True, exist_ok=True)
                                target_path.write_bytes(webp_bytes)
                            written_persona_files.append(target_path)
                            caption_str = str(g_item.get("caption") or "")
                            repo.register_media_asset(
                                asset_id=g_id,
                                owner_id=user_id,
                                entity_scope="persona",
                                media_type="image",
                                role="album",
                                filename=filename,
                                mime_type="image/webp",
                                byte_size=len(webp_bytes),
                                label=caption_str,
                            )
                            registered_persona_asset_ids.append(g_id)
                            staged_v = staged_videos.get(("persona", p_idx, g_idx))
                            if staged_v is not None:
                                v_src, v_probe = staged_v
                                vid_id = f"vid_{uuid.uuid4().hex[:10]}"
                                vid_fname = f"{vid_id}{v_probe.extension}"
                                vid_dst = safe_resolve_asset_path(
                                    "videos", vid_fname, media_dir=repo.media_dir
                                )
                                if actor_user is not None:
                                    enforce_quota_and_commit_staged_files(repo, actor_user, [(v_src, vid_dst)])
                                else:
                                    vid_dst.parent.mkdir(parents=True, exist_ok=True)
                                    os.replace(v_src, vid_dst)
                                written_persona_files.append(vid_dst)
                                repo.attach_or_replace_linked_video(
                                    g_id,
                                    video_id=vid_id,
                                    owner_id=user_id,
                                    entity_scope="persona",
                                    filename=vid_fname,
                                    mime_type=v_probe.mime_type,
                                    byte_size=v_probe.byte_size,
                                    duration_ms=v_probe.duration_ms,
                                    width=v_probe.width,
                                    height=v_probe.height,
                                    label=caption_str,
                                )
                            new_persona_gallery.append(
                                GalleryImage(
                                    id=g_id,
                                    url=build_asset_url(g_id),
                                    caption=caption_str,
                                    created_at=str(g_item.get("created_at") or utc_now_iso()),
                                )
                            )
                        elif rel_path.startswith(("http://", "https://")):
                            new_persona_gallery.append(GalleryImage.model_validate(g_item))

                raw_age = p.get("age")
                persona_payload = PersonaCreatePayload(
                    name=final_name,
                    tagline=str(p.get("tagline") or ""),
                    species=p.get("species") or "Human",
                    age=str(raw_age) if raw_age is not None else None,
                    age_is_secret=True if p.get("age_is_secret") is None else bool(p.get("age_is_secret")),
                    sex=p.get("sex") or "",
                    pronouns=p.get("pronouns") or "",
                    persona_bio=p.get("persona_bio") or "",
                    tags=p.get("tags") or [],
                    build_and_height=p.get("build_and_height") or "",
                    distinctive_features=p.get("distinctive_features") or [],
                    physical_appearance="",
                    equipped=p.get("equipped") or [],
                    inventory=p.get("inventory") or [],
                    lore_entries=p.get("lore_entries") or [],
                    portrait_url=new_portrait_url,
                    gallery=new_persona_gallery,
                    unsupported_fields=persona_unsupported,
                )
                repo.create_persona(persona_payload, owner_id=user_id, persona_id=new_p_id)
                imported_personas.append(final_name)
            except HTTPException:
                for aid in registered_persona_asset_ids:
                    repo.delete_media_asset(aid)
                for pf in written_persona_files:
                    pf.unlink(missing_ok=True)
                raise
            except Exception as exc:
                for aid in registered_persona_asset_ids:
                    repo.delete_media_asset(aid)
                for pf in written_persona_files:
                    pf.unlink(missing_ok=True)
                logger.exception("Failed importing persona '%s': %s", sanitize_log_value(p_name), sanitize_log_value(exc))
                errors.append(f"Persona '{p_name}': {exc}")

        # 3. Ingest Characters
        for c_idx, c in enumerate(characters_data):
            old_c_id = str(c.get("id") or "")
            c_name = str(c.get("name") or "Unnamed Character").strip()
            strategy = (
                req.conflict_strategies.get(old_c_id)
                or req.conflict_strategies.get(c_name)
                or req.default_conflict_strategy
            )

            is_camp_char = has_campaigns and old_c_id in campaign_char_ids
            is_campaign_private_char = False
            if is_camp_char and not standalone_campaign_assets:
                is_campaign_private_char = True
            elif strategy == "skip":
                skipped_entities.append(f"Character: {c_name}")
                if is_camp_char:
                    is_campaign_private_char = True
                else:
                    continue

            new_c_id = f"char_{uuid.uuid4().hex[:10]}"
            registered_char_asset_ids: list[str] = []
            written_char_files: list[Path] = []
            try:
                id_remap[old_c_id] = new_c_id
                final_name = c_name
                if not is_campaign_private_char and strategy == "copy":
                    existing = [
                        ec
                        for ec in repo.list_characters(
                            include_pending_deletion=False, owner_id=user_id
                        )
                        if ec.name.strip().lower() == c_name.lower()
                    ]
                    if existing:
                        final_name = f"{c_name} (Imported)"

                raw_world_id = c.get("world_id")
                new_world_id = id_remap.get(raw_world_id) if raw_world_id else None

                new_portraits: dict[str, str] = {}
                new_gallery: list[GalleryImage] = []
                if eff_images:
                    for emotion, rel_path in (c.get("portraits") or {}).items():
                        clean_emotion = str(emotion).strip().lower()
                        zip_member = _resolve_zip_member(rel_path, zip_names)
                        if zip_member and clean_emotion in VALID_EMOTIONS:
                            p_asset_id = f"por_{uuid.uuid4().hex[:10]}"
                            filename = f"{p_asset_id}.webp"
                            target_path = safe_resolve_asset_path(
                                "images", filename, media_dir=repo.media_dir
                            )
                            pre = pre_rendered_media.get((c_idx, "portrait", clean_emotion))
                            webp_bytes = pre if pre is not None else render_webp_bytes(
                                zf.read(zip_member), square_crop=True, max_size=512
                            )
                            if actor_user is not None:
                                enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                            else:
                                target_path.parent.mkdir(parents=True, exist_ok=True)
                                target_path.write_bytes(webp_bytes)
                            written_char_files.append(target_path)
                            repo.register_media_asset(
                                asset_id=p_asset_id,
                                owner_id=user_id,
                                entity_scope="character",
                                media_type="image",
                                role="portrait",
                                filename=filename,
                                mime_type="image/webp",
                                byte_size=len(webp_bytes),
                            )
                            registered_char_asset_ids.append(p_asset_id)
                            new_portraits[clean_emotion] = build_asset_url(p_asset_id)
                        elif isinstance(rel_path, str) and rel_path.startswith(("http://", "https://")):
                            new_portraits[clean_emotion] = rel_path

                    for g_idx, g_item in enumerate(c.get("gallery") or []):
                        if not isinstance(g_item, dict):
                            continue
                        rel_path = str(g_item.get("url") or "").strip()
                        zip_member = _resolve_zip_member(rel_path, zip_names)
                        if zip_member:
                            g_id = f"img_{uuid.uuid4().hex[:10]}"
                            filename = f"{g_id}.webp"
                            target_path = safe_resolve_asset_path(
                                "images", filename, media_dir=repo.media_dir
                            )
                            pre = pre_rendered_media.get((c_idx, "gallery", str(g_idx)))
                            webp_bytes = pre if pre is not None else render_webp_bytes(
                                zf.read(zip_member), square_crop=False, max_size=1920
                            )
                            if actor_user is not None:
                                enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                            else:
                                target_path.parent.mkdir(parents=True, exist_ok=True)
                                target_path.write_bytes(webp_bytes)
                            written_char_files.append(target_path)
                            caption_str = str(g_item.get("caption") or "")
                            repo.register_media_asset(
                                asset_id=g_id,
                                owner_id=user_id,
                                entity_scope="character",
                                media_type="image",
                                role="album",
                                filename=filename,
                                mime_type="image/webp",
                                byte_size=len(webp_bytes),
                                label=caption_str,
                            )
                            registered_char_asset_ids.append(g_id)
                            staged_v = staged_videos.get(("character", c_idx, g_idx))
                            if staged_v is not None:
                                v_src, v_probe = staged_v
                                vid_id = f"vid_{uuid.uuid4().hex[:10]}"
                                vid_fname = f"{vid_id}{v_probe.extension}"
                                vid_dst = safe_resolve_asset_path(
                                    "videos", vid_fname, media_dir=repo.media_dir
                                )
                                if actor_user is not None:
                                    enforce_quota_and_commit_staged_files(repo, actor_user, [(v_src, vid_dst)])
                                else:
                                    vid_dst.parent.mkdir(parents=True, exist_ok=True)
                                    os.replace(v_src, vid_dst)
                                written_char_files.append(vid_dst)
                                repo.attach_or_replace_linked_video(
                                    g_id,
                                    video_id=vid_id,
                                    owner_id=user_id,
                                    entity_scope="character",
                                    filename=vid_fname,
                                    mime_type=v_probe.mime_type,
                                    byte_size=v_probe.byte_size,
                                    duration_ms=v_probe.duration_ms,
                                    width=v_probe.width,
                                    height=v_probe.height,
                                    label=caption_str,
                                )
                            new_gallery.append(
                                GalleryImage(
                                    id=g_id,
                                    url=build_asset_url(g_id),
                                    caption=caption_str,
                                    created_at=str(g_item.get("created_at") or utc_now_iso()),
                                )
                            )
                        elif rel_path.startswith(("http://", "https://")):
                            new_gallery.append(GalleryImage.model_validate(g_item))

                clean_equipped = []
                for it in c.get("equipped", []):
                    it_copy = dict(it) if isinstance(it, dict) else {"name": str(it)}
                    if it_copy.get("lore_id"):
                        it_copy["lore_id"] = id_remap.get(it_copy["lore_id"])
                    clean_equipped.append(it_copy)

                clean_inventory = []
                for it in c.get("inventory", []):
                    it_copy = dict(it) if isinstance(it, dict) else {"name": str(it)}
                    if it_copy.get("lore_id"):
                        it_copy["lore_id"] = id_remap.get(it_copy["lore_id"])
                    clean_inventory.append(it_copy)

                try:
                    unsupported_fields = _extract_character_unsupported_fields(c, strict=True)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc

                raw_char_age = c.get("age")
                draft = CharacterWizardDraft(
                    name=final_name,
                    tagline=c.get("tagline") or "",
                    character_bio=c.get("character_bio") or "",
                    physical_appearance="",
                    species=c.get("species") or "Human",
                    sex=c.get("sex") or "",
                    pronouns=c.get("pronouns") or "",
                    age=str(raw_char_age) if raw_char_age is not None else "",
                    build_and_height=c.get("build_and_height") or "",
                    distinctive_features=c.get("distinctive_features") or [],
                    posture=c.get("posture") or "",
                    mannerisms=c.get("mannerisms") or [],
                    modifications=[],
                    visual_aesthetic=c.get("visual_aesthetic") or "",
                    personality_traits=c.get("personality_traits") or [],
                    core_persona=c.get("core_persona") or "",
                    moral_code=c.get("moral_code") or [],
                    quirks_flaws=c.get("quirks_flaws") or [],
                    communication_style=c.get("communication_style") or [],
                    initial_message=c.get("initial_message") or "",
                    equipped=clean_equipped,
                    inventory=clean_inventory,
                    voice_anchors=c.get("voice_anchors") or [],
                    baseline_psyche=c.get("baseline_psyche") or {},
                    memory_shards=c.get("memory_shards") or [],
                    tags=c.get("tags") or [],
                    creator=c.get("creator") or "",
                    creator_notes=c.get("creator_notes") or "",
                    portraits=new_portraits,
                    gallery=new_gallery,
                    unsupported_fields=unsupported_fields,
                )

                repo.create_character_from_draft(
                    draft=draft,
                    world_id=new_world_id,
                    character_id=new_c_id,
                    owner_id=user_id,
                )
                if is_campaign_private_char:
                    campaign_private_char_ids.add(new_c_id)
                else:
                    imported_characters.append(final_name)

            except HTTPException:
                for aid in registered_char_asset_ids:
                    repo.delete_media_asset(aid)
                for cf in written_char_files:
                    cf.unlink(missing_ok=True)
                raise
            except Exception as exc:
                for aid in registered_char_asset_ids:
                    repo.delete_media_asset(aid)
                for cf in written_char_files:
                    cf.unlink(missing_ok=True)
                logger.exception("Failed importing character '%s': %s", sanitize_log_value(c_name), sanitize_log_value(exc))
                errors.append(f"Character '{c_name}': {exc}")

        # 4. Ingest Campaigns (atomic SQLite commit + pending_deletion flags)
        if campaigns_data:
            camp_names, camp_errors = ingest_campaigns_atomic(
                repo,
                campaigns_data=campaigns_data,
                user_id=user_id,
                id_remap=id_remap,
                import_as_standalone=standalone_campaign_assets,
                campaign_private_world_ids=campaign_private_world_ids,
                campaign_private_char_ids=campaign_private_char_ids,
            )
            imported_campaigns.extend(camp_names)
            errors.extend(camp_errors)

        with _staged_imports_lock:
            popped = _staged_imports.pop(req.staged_token, None)
        _cleanup_staged_entry_paths(popped)

        parts = [
            f"{len(imported_characters)} characters",
            f"{len(imported_worlds)} worlds",
            f"{len(imported_personas)} personas",
        ]
        if imported_campaigns:
            parts.append(f"{len(imported_campaigns)} campaign(s)")
        msg = f"Import completed: {', '.join(parts)}."
        if skipped_entities:
            msg += f" Skipped {len(skipped_entities)} entities."
        if commit_warnings:
            msg += f" {len(commit_warnings)} media warning(s)."
        if errors:
            msg += f" Encountered {len(errors)} error(s)."

        return ImportCommitResponse(
            success=len(errors) == 0,
            imported_characters=imported_characters,
            imported_worlds=imported_worlds,
            imported_personas=imported_personas,
            imported_campaigns=imported_campaigns,
            skipped_entities=skipped_entities,
            errors=errors,
            warnings=commit_warnings,
            message=msg,
        )
    finally:
        cleanup_staging_paths(*temp_staging_files)
        zf.close()
