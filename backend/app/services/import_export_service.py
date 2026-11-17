"""Service for packaging, inspecting, and ingesting CyberCantina archives (.zcc)."""

from __future__ import annotations

import io
import json
import logging
import re
import time
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.db.repository import CantinaRepository, _location_lore_vector_fields, utc_now_iso
from app.dependencies import (
    enforce_quota_and_write_webp,
    format_mb,
    get_user_media_lock,
    get_user_media_usage_bytes,
    get_user_quota_bytes,
    process_and_save_image,
    remove_character_media_dir,
    render_webp_bytes,
    safe_resolve_media_path,
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
)
from app.wizards.sillytavern_parser import extract_card_from_bytes

logger = logging.getLogger("cybercantina.import_export")

# Safety limits for ZIP decompression
MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_ZIP_ENTRIES = 250
STAGED_IMPORT_TTL_SECONDS = 1800  # 30 minutes


@dataclass
class StagedImport:
    token: str
    user_id: str
    format_type: str
    is_native: bool
    data_bytes: bytes
    created_at_epoch: float
    parsed_payload: dict[str, Any]


_staged_imports: dict[str, StagedImport] = {}


def _cleanup_expired_staged_imports() -> None:
    now = time.time()
    expired = [k for k, v in _staged_imports.items() if now - v.created_at_epoch > STAGED_IMPORT_TTL_SECONDS]
    for k in expired:
        _staged_imports.pop(k, None)


def _safe_zip_read(zip_bytes: bytes) -> zipfile.ZipFile:
    """Validate archive integrity, total size, entry count, and path traversal safety."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive.") from exc

    infolist = zf.infolist()
    if len(infolist) > MAX_ZIP_ENTRIES:
        raise HTTPException(
            status_code=400,
            detail=f"Archive contains too many entries ({len(infolist)} > {MAX_ZIP_ENTRIES}).",
        )

    total_size = sum(info.file_size for info in infolist)
    if total_size > MAX_TOTAL_UNCOMPRESSED_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Uncompressed archive exceeds size limit ({total_size} bytes > {MAX_TOTAL_UNCOMPRESSED_BYTES} bytes).",
        )

    for info in infolist:
        p = Path(info.filename)
        if p.is_absolute() or ".." in p.parts:
            raise HTTPException(
                status_code=400,
                detail=f"Archive contains illegal path traversal member: '{info.filename}'.",
            )

    return zf


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


def _serialize_persona_for_zcc(persona: PersonaRecord) -> dict[str, Any]:
    """Serialize a PersonaRecord for .zcc export with top-level unsupported_fields re-emission."""
    persona_data = persona.model_dump()
    persona_data.pop("unsupported_fields", None)
    bio_norm = (persona.persona_bio or "").strip()
    phys_norm = str(persona_data.get("physical_appearance") or "").strip()
    if not phys_norm or phys_norm == bio_norm:
        persona_data.pop("physical_appearance", None)
    for ext_k, ext_v in (persona.unsupported_fields or {}).items():
        if ext_k in CANONICAL_PERSONA_RECORD_KEYS:
            continue
        if ext_k == "physical_appearance" and (
            not isinstance(ext_v, str) or not ext_v.strip() or ext_v.strip() == bio_norm
        ):
            continue
        persona_data[ext_k] = ext_v
    return persona_data


def _stage_world_media_for_export(
    repo: CantinaRepository,
    world_id: str,
    media_item: dict[str, Any],
    media_entries: dict[str, bytes],
) -> dict[str, Any]:
    """Resolve a world media asset on disk, stage it into the ZIP bundle, and rewrite url."""
    item_copy = dict(media_item)
    url = str(item_copy.get("url") or "")
    m = re.search(r"/api/media/worlds/(images|audio)/([^/?#]+)", url)
    if not m:
        return item_copy
    cat_dir, filename = m.group(1), m.group(2)
    try:
        fpath = safe_resolve_world_media_path(cat_dir, filename, media_dir=repo.media_dir)
        if fpath.is_file():
            rel_zip_path = f"media/worlds/{world_id}/{cat_dir}/{filename}"
            media_entries[rel_zip_path] = fpath.read_bytes()
            item_copy["url"] = rel_zip_path
    except Exception as exc:
        logger.warning("Failed staging world media '%s' for export: %s", filename, exc)
    return item_copy


def _serialize_world_for_zcc(
    world: WorldRecord,
    *,
    repo: CantinaRepository | None = None,
    media_entries: dict[str, bytes] | None = None,
    include_media: bool = True,
) -> dict[str, Any]:
    """Serialize a WorldRecord for .zcc export, restoring extension keys and optionally staging media."""
    world_data = world.model_dump()
    world_data.pop("unsupported_fields", None)
    if include_media and repo is not None and media_entries is not None:
        world_data["media"] = [
            _stage_world_media_for_export(repo, world.id, m_item, media_entries)
            for m_item in (world_data.get("media") or [])
        ]
    elif not include_media:
        world_data["media"] = []
        for cont in world_data.get("containers") or []:
            if isinstance(cont, dict):
                cont["image_media_id"] = None
                cont["image_url"] = None
                cont["image_label"] = None
        for loc in world_data.get("locations") or []:
            if isinstance(loc, dict):
                loc["image_media_id"] = None
                loc["image_url"] = None
                loc["image_label"] = None
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


def _stage_character_media_for_export(
    repo: CantinaRepository,
    char_id: str,
    url: str,
    category: str,
    media_entries: dict[str, bytes],
) -> str:
    """Resolve a character media asset on disk (private or shared public), stage it into the ZIP, and return relative path."""
    pub_m = re.search(
        rf"/api/media/public/(v\d+)/characters/([^/]+)/{category}/([^/?#]+)",
        url or "",
    )
    if pub_m:
        ver_tag, seed_slug, filename = pub_m.group(1), pub_m.group(2), pub_m.group(3)
        try:
            fpath = safe_resolve_public_character_media_path(
                ver_tag, seed_slug, category, filename, media_dir=repo.media_dir
            )
            if fpath.is_file():
                rel_zip_path = f"media/characters/{char_id}/{category}/{filename}"
                media_entries[rel_zip_path] = fpath.read_bytes()
                return rel_zip_path
        except Exception as exc:
            logger.warning("Failed staging public %s asset for export: %s", category, exc)
        return url

    m = re.search(rf"/api/media/characters/([^/]+)/{category}/([^/?#]+)", url or "")
    if not m:
        return url
    c_id, filename = m.group(1), m.group(2)
    try:
        fpath = safe_resolve_media_path(
            c_id, category, filename, media_dir=repo.media_dir
        )
        if not fpath.is_file() and c_id != char_id:
            fallback_path = safe_resolve_media_path(
                char_id, category, filename, media_dir=repo.media_dir
            )
            if fallback_path.is_file():
                fpath = fallback_path
        if fpath.is_file():
            rel_zip_path = f"media/characters/{char_id}/{category}/{filename}"
            media_entries[rel_zip_path] = fpath.read_bytes()
            return rel_zip_path
    except Exception as exc:
        logger.warning("Failed staging %s asset for export: %s", category, exc)
    return url

def build_zcc_export(
    repo: CantinaRepository,
    character_ids: list[str],
    world_ids: list[str],
    persona_ids: list[str],
    owner_id: str,
    description: str = "",
    include_world_media: bool = True,
) -> bytes:
    """Bundle selected characters, worlds, personas, and media into a .zcc ZIP archive."""
    worlds: list[WorldRecord] = []
    personas: list[PersonaRecord] = []

    # 1. Fetch worlds
    for wid in world_ids:
        try:
            worlds.append(repo.get_world(wid, owner_id=owner_id))
        except KeyError:
            continue

    exported_world_ids = {w.id for w in worlds}

    # 2. Fetch personas
    for pid in persona_ids:
        try:
            p = repo.get_persona(pid, owner_id=owner_id)
            if p:
                personas.append(p)
        except Exception:
            continue

    # 3. Fetch characters & process media
    media_entries: dict[str, bytes] = {}  # zip_rel_path -> raw_bytes
    exported_characters_json: list[dict[str, Any]] = []

    for cid in character_ids:
        try:
            char = repo.get_character(cid)
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

        # If the character's world is not included in the bundle, strip world and lore artifact links
        if char.world_id not in exported_world_ids:
            char_data["world_id"] = None
            for it in char_data.get("equipped", []):
                if it.get("lore_id"):
                    it["lore_id"] = None
            for it in char_data.get("inventory", []):
                if it.get("lore_id"):
                    it["lore_id"] = None

        # Relativize portrait media
        char_data["portraits"] = {
            emotion: _stage_character_media_for_export(
                repo, char.id, url, "portraits", media_entries
            )
            for emotion, url in char.portraits.items()
        }

        # Relativize gallery media
        rewritten_gallery: list[dict[str, Any]] = []
        for g_item in char_data.get("gallery", []):
            item_copy = dict(g_item)
            item_copy["url"] = _stage_character_media_for_export(
                repo, char.id, g_item.get("url", ""), "gallery", media_entries
            )
            rewritten_gallery.append(item_copy)
        char_data["gallery"] = rewritten_gallery

        exported_characters_json.append(char_data)

    exported_worlds_json = [
        _serialize_world_for_zcc(
            w,
            repo=repo,
            media_entries=media_entries,
            include_media=include_world_media,
        )
        for w in worlds
    ]
    exported_personas_json = [_serialize_persona_for_zcc(p) for p in personas]

    # 4. Build Manifest
    manifest = ZccManifest(
        format_version=1,
        generator="CyberCantina",
        generator_version="0.5.0",
        exported_at=utc_now_iso(),
        description=description or f"CyberCantina bundle exported by {owner_id}",
        contents=ZccManifestContents(
            characters_count=len(exported_characters_json),
            worlds_count=len(exported_worlds_json),
            personas_count=len(exported_personas_json),
            media_files_count=len(media_entries),
        ),
        dependencies={
            "worlds": list(exported_world_ids),
        },
    )

    # 5. Pack ZIP in-memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
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
        for rel_path, file_data in media_entries.items():
            zf.writestr(rel_path, file_data)

    return buf.getvalue()


# ---------------------------------------------------------------------------
# INSPECT / AUTO-DETECT IMPLEMENTATION
# ---------------------------------------------------------------------------

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

    # A) Check ZIP signature (PK\x03\x04)
    if file_bytes.startswith(b"PK\x03\x04"):
        zf = _safe_zip_read(file_bytes)
        manifest: ZccManifest | None = None
        characters_raw: list[dict[str, Any]] = []
        worlds_raw: list[dict[str, Any]] = []
        personas_raw: list[dict[str, Any]] = []

        if "manifest.json" in zf.namelist():
            try:
                manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
                manifest = ZccManifest.model_validate(manifest_data)
            except Exception as exc:
                logger.warning("Manifest parse failure: %s", exc)

        if "characters.json" in zf.namelist():
            try:
                characters_raw = json.loads(zf.read("characters.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("characters.json parse failure: %s", exc)

        if "worlds.json" in zf.namelist():
            try:
                worlds_raw = json.loads(zf.read("worlds.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("worlds.json parse failure: %s", exc)

        if "personas.json" in zf.namelist():
            try:
                personas_raw = json.loads(zf.read("personas.json").decode("utf-8"))
            except Exception as exc:
                logger.warning("personas.json parse failure: %s", exc)

        if not manifest and not characters_raw and not worlds_raw and not personas_raw:
            raise HTTPException(
                status_code=400,
                detail="Archive is not a valid CyberCantina package (no manifest or entity files found).",
            )

        # Fallback manifest synthesis if missing
        if not manifest:
            manifest = ZccManifest(
                format_version=1,
                generator="CyberCantina (Synthesized)",
                generator_version="0.5.0",
                exported_at=utc_now_iso(),
                contents=ZccManifestContents(
                    characters_count=len(characters_raw),
                    worlds_count=len(worlds_raw),
                    personas_count=len(personas_raw),
                ),
            )

        # Check conflicts against existing user entities
        conflicts: list[ImportEntityConflict] = []
        existing_chars = repo.list_characters(include_pending_deletion=False)
        user_chars = [c for c in existing_chars if getattr(c, "owner_id", None) == user_id or not getattr(c, "owner_id", None)]
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

        # Detect unsupported/future or deprecated fields across Characters, Worlds & Personas
        warnings: list[str] = []
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

        # Summaries for UI
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
                category="persona",
                extra_info={"equipped_count": len(p.get("equipped", []))},
            )
            for p in personas_raw
        ]

        _staged_imports[staged_token] = StagedImport(
            token=staged_token,
            user_id=user_id,
            format_type="zcc",
            is_native=True,
            data_bytes=file_bytes,
            created_at_epoch=time.time(),
            parsed_payload={
                "manifest": manifest.model_dump(),
                "characters": characters_raw,
                "worlds": worlds_raw,
                "personas": personas_raw,
            },
        )

        return ImportInspectResponse(
            is_native=True,
            format_type="zcc",
            staged_token=staged_token,
            manifest=manifest,
            characters=char_summaries,
            worlds=world_summaries,
            personas=persona_summaries,
            conflicts=conflicts,
            warnings=warnings,
        )

    # B) Check PNG or JSON SillyTavern card
    try:
        pkg = extract_card_from_bytes(file_bytes, filename=filename)
        _staged_imports[staged_token] = StagedImport(
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
    except Exception as exc:
        logger.debug("Not a SillyTavern card: %s", exc)

    raise HTTPException(
        status_code=400,
        detail="Unrecognized file format. Please upload a .zcc archive, .zip package, or SillyTavern character card (.png / .json).",
    )


# ---------------------------------------------------------------------------
# COMMIT IMPORT IMPLEMENTATION
# ---------------------------------------------------------------------------

async def commit_staged_import(
    repo: CantinaRepository,
    req: ImportCommitRequest,
    user_id: str,
) -> ImportCommitResponse:
    """Execute transactional ingestion of a staged native CyberCantina bundle."""
    _cleanup_expired_staged_imports()

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

    zf = _safe_zip_read(staged.data_bytes)
    characters_data: list[dict[str, Any]] = staged.parsed_payload.get("characters", [])
    worlds_data: list[dict[str, Any]] = staged.parsed_payload.get("worlds", [])
    personas_data: list[dict[str, Any]] = staged.parsed_payload.get("personas", [])

    try:
        actor_user = repo.get_user_by_id(user_id)
    except KeyError:
        actor_user = None
    quota_bytes = get_user_quota_bytes(actor_user) if actor_user is not None else None
    pre_rendered_media: dict[tuple[int, str, str], bytes] = {}
    pre_rendered_world_media: dict[tuple[int, int], bytes] = {}
    zip_names = set(zf.namelist())

    if quota_bytes is not None and actor_user is not None:
        total_media_bytes = 0
        for w_idx, w in enumerate(worlds_data):
            old_world_id = str(w.get("id") or "")
            w_name = str(w.get("name") or "Unnamed World").strip()
            w_strategy = (
                req.conflict_strategies.get(old_world_id)
                or req.conflict_strategies.get(w_name)
                or req.default_conflict_strategy
            )
            if w_strategy == "skip":
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

        for c_idx, c in enumerate(characters_data):
            old_c_id = str(c.get("id") or "")
            c_name = str(c.get("name") or "Unnamed Character").strip()
            strategy = (
                req.conflict_strategies.get(old_c_id)
                or req.conflict_strategies.get(c_name)
                or req.default_conflict_strategy
            )
            if strategy == "skip":
                continue
            for emotion, rel_path in (c.get("portraits") or {}).items():
                clean_emotion = str(emotion).strip().lower()
                zip_member = _resolve_zip_member(rel_path, zip_names)
                if zip_member and clean_emotion in VALID_EMOTIONS:
                    webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=True, max_size=512)
                    pre_rendered_media[(c_idx, "portrait", clean_emotion)] = webp_bytes
                    total_media_bytes += len(webp_bytes)
            for g_idx, g_item in enumerate(c.get("gallery") or []):
                zip_member = _resolve_zip_member(
                    g_item.get("url", "") if isinstance(g_item, dict) else "",
                    zip_names,
                )
                if zip_member:
                    webp_bytes = render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                    pre_rendered_media[(c_idx, "gallery", str(g_idx))] = webp_bytes
                    total_media_bytes += len(webp_bytes)

        if total_media_bytes > 0:
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
    skipped_entities: list[str] = []
    errors: list[str] = []

    # Map of old_id -> new_id across all entity types
    id_remap: dict[str, str] = {}

    # 1. Ingest Worlds
    for w_idx, w in enumerate(worlds_data):
        old_world_id = str(w.get("id") or "")
        w_name = str(w.get("name") or "Unnamed World").strip()
        strategy = (
            req.conflict_strategies.get(old_world_id)
            or req.conflict_strategies.get(w_name)
            or req.default_conflict_strategy
        )

        if strategy == "skip":
            skipped_entities.append(f"World: {w_name}")
            continue

        written_world_files: list[Path] = []
        try:
            new_world_id = f"world_{uuid.uuid4().hex[:10]}"
            id_remap[old_world_id] = new_world_id

            final_name = w_name
            if strategy == "copy":
                # Check collision
                existing = [ew for ew in repo.list_worlds(owner_id=user_id) if ew.name.strip().lower() == w_name.lower()]
                if existing:
                    final_name = f"{w_name} (Imported)"

            try:
                world_unsupported = extract_world_unsupported_fields(w, strict=True)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            canonical_rules = WorldGlobalRules.model_validate(w.get("global_rules") or {})

            # Prepare world media files & id_remap before inserting containers/locations
            imported_world_media_rows: list[tuple[str, str, str, str, str, int, int, str]] = []
            now = utc_now_iso()
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
                target_path = safe_resolve_world_media_path(
                    "images", filename, media_dir=repo.media_dir
                )
                pre = pre_rendered_world_media.get((w_idx, m_idx))
                if actor_user is not None:
                    webp_bytes = (
                        pre
                        if pre is not None
                        else render_webp_bytes(zf.read(zip_member), square_crop=False, max_size=1920)
                    )
                    enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                    written_world_files.append(target_path)
                    byte_sz = len(webp_bytes)
                else:
                    process_and_save_image(
                        zf.read(zip_member), target_path, square_crop=False, max_size=1920
                    )
                    written_world_files.append(target_path)
                    byte_sz = target_path.stat().st_size if target_path.is_file() else 0

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
                        INSERT INTO world_media (id, owner_id, media_type, filename, label, mime_type, byte_size, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

                # Containers (topological order: depth 4 down to 1 so parent_container_id FK always exists)
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
                                    c_lore.get("category", "history"),
                                    c_lore.get("content", ""),
                                    json.dumps(c_lore.get("entity_tags", [])),
                                ),
                            )
                            if c_lore.get("category") != "secret":
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

                # Locations
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

                    # Location Lore
                    for loc_lore in loc.get("lore_nodes", []):
                        old_ll_id = loc_lore.get("id")
                        new_ll_id = f"lore_{uuid.uuid4().hex[:10]}"
                        if old_ll_id:
                            id_remap[old_ll_id] = new_ll_id

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
                                loc_lore.get("category", "history"),
                                loc_lore.get("content", ""),
                                json.dumps(loc_lore.get("entity_tags", [])),
                            ),
                        )
                        # Index in VectorStore
                        if loc_lore.get("category") != "secret":
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

                # World-level lore
                for w_lore in w.get("lore_nodes", []):
                    old_wl_id = w_lore.get("id")
                    new_wl_id = f"lore_{uuid.uuid4().hex[:10]}"
                    if old_wl_id:
                        id_remap[old_wl_id] = new_wl_id

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
                            w_lore.get("category", "history"),
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

                # Edges (remap from & to)
                for edge in w.get("edges", []):
                    new_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
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
            logger.exception("Failed importing world '%s': %s", w_name, exc)
            errors.append(f"World '{w_name}': {exc}")

    # 2. Ingest Personas
    for p in personas_data:
        old_p_id = str(p.get("id") or "")
        p_name = str(p.get("name") or "Unnamed Persona").strip()
        strategy = (
            req.conflict_strategies.get(old_p_id)
            or req.conflict_strategies.get(p_name)
            or req.default_conflict_strategy
        )

        if strategy == "skip":
            skipped_entities.append(f"Persona: {p_name}")
            continue

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

            raw_age = p.get("age")
            persona_payload = PersonaCreatePayload(
                name=final_name,
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
                unsupported_fields=persona_unsupported,
            )
            repo.create_persona(persona_payload, owner_id=user_id, persona_id=new_p_id)
            imported_personas.append(final_name)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Failed importing persona '%s': %s", p_name, exc)
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

        if strategy == "skip":
            skipped_entities.append(f"Character: {c_name}")
            continue

        new_c_id = f"char_{uuid.uuid4().hex[:10]}"
        try:
            id_remap[old_c_id] = new_c_id
            final_name = c_name
            if strategy == "copy":
                existing = [
                    ec
                    for ec in repo.list_characters(
                        include_pending_deletion=False, owner_id=user_id
                    )
                    if ec.name.strip().lower() == c_name.lower()
                ]
                if existing:
                    final_name = f"{c_name} (Imported)"

            # Remap world_id
            raw_world_id = c.get("world_id")
            new_world_id = id_remap.get(raw_world_id) if raw_world_id else None

            # Unpack media and rewrite URLs
            new_portraits: dict[str, str] = {}
            for emotion, rel_path in (c.get("portraits") or {}).items():
                clean_emotion = str(emotion).strip().lower()
                zip_member = _resolve_zip_member(rel_path, zip_names)
                if zip_member and clean_emotion in VALID_EMOTIONS:
                    filename = f"{clean_emotion}_{uuid.uuid4().hex[:8]}.webp"
                    target_path = safe_resolve_media_path(
                        new_c_id, "portraits", filename, media_dir=repo.media_dir
                    )
                    pre = pre_rendered_media.get((c_idx, "portrait", clean_emotion))
                    if actor_user is not None:
                        webp_bytes = pre if pre is not None else render_webp_bytes(
                            zf.read(zip_member), square_crop=True, max_size=512
                        )
                        enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                    else:
                        process_and_save_image(zf.read(zip_member), target_path, square_crop=True, max_size=512)
                    new_portraits[clean_emotion] = f"/api/media/characters/{new_c_id}/portraits/{filename}"
                elif isinstance(rel_path, str):
                    new_portraits[clean_emotion] = rel_path

            new_gallery: list[GalleryImage] = []
            for g_idx, g_item in enumerate(c.get("gallery") or []):
                rel_path = g_item.get("url", "") if isinstance(g_item, dict) else ""
                zip_member = _resolve_zip_member(rel_path, zip_names)
                if zip_member:
                    g_id = f"img_{uuid.uuid4().hex[:10]}"
                    filename = f"{g_id}.webp"
                    target_path = safe_resolve_media_path(
                        new_c_id, "gallery", filename, media_dir=repo.media_dir
                    )
                    pre = pre_rendered_media.get((c_idx, "gallery", str(g_idx)))
                    if actor_user is not None:
                        webp_bytes = pre if pre is not None else render_webp_bytes(
                            zf.read(zip_member), square_crop=False, max_size=1920
                        )
                        enforce_quota_and_write_webp(repo, actor_user, webp_bytes, target_path)
                    else:
                        process_and_save_image(zf.read(zip_member), target_path, square_crop=False, max_size=1920)
                    new_gallery.append(
                        GalleryImage(
                            id=g_id,
                            url=f"/api/media/characters/{new_c_id}/gallery/{filename}",
                            caption=g_item.get("caption") or "",
                            created_at=g_item.get("created_at") or utc_now_iso(),
                        )
                    )
                else:
                    new_gallery.append(GalleryImage.model_validate(g_item))

            # Remap items lore_id
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

            # Extract unknown/future keys and distinct deprecated legacy fields into unsupported_fields
            try:
                unsupported_fields = _extract_character_unsupported_fields(c, strict=True)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            # Build CharacterWizardDraft
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
            imported_characters.append(final_name)

        except HTTPException:
            remove_character_media_dir(repo.media_dir, new_c_id)
            raise
        except Exception as exc:
            remove_character_media_dir(repo.media_dir, new_c_id)
            logger.exception("Failed importing character '%s': %s", c_name, exc)
            errors.append(f"Character '{c_name}': {exc}")

    # Clean up staged cache
    _staged_imports.pop(req.staged_token, None)

    msg = f"Import completed: {len(imported_characters)} characters, {len(imported_worlds)} worlds, {len(imported_personas)} personas."
    if skipped_entities:
        msg += f" Skipped {len(skipped_entities)} entities."
    if errors:
        msg += f" Encountered {len(errors)} error(s)."

    return ImportCommitResponse(
        success=len(errors) == 0,
        imported_characters=imported_characters,
        imported_worlds=imported_worlds,
        imported_personas=imported_personas,
        skipped_entities=skipped_entities,
        errors=errors,
        message=msg,
    )
