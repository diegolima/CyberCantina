"""Core SQLite connection, media helpers, and vector/provider bindings."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import numpy as np
from app.db.provider_store import ProviderStore
from app.db.vector_store import VectorStore
from app.schemas.affective import AffectiveCareState
from app.schemas.character import (
    GalleryImage,
    ItemInstance,
    VALID_EMOTIONS,
    coerce_item_list,
    dump_items_json,
    normalize_item_key,
)
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import safe_resolve_character_media_dir


logger = logging.getLogger("cybercantina.db.repository")

UNSET: Any = object()

def _parse_care_state_json(raw_json: str | None) -> AffectiveCareState | None:
    """Deserialize affective_state_json column, returning None for empty/legacy '{}' rows."""
    if not raw_json:
        return None
    stripped = raw_json.strip()
    if not stripped or stripped == "{}":
        return None
    try:
        return AffectiveCareState.model_validate_json(stripped)
    except Exception:
        return None

def _dump_care_state_json(care_state: AffectiveCareState | None) -> str:
    """Serialize optional AffectiveCareState for SQLite persistence."""
    if care_state is None:
        return "{}"
    return care_state.model_dump_json()

def _dump_provenance_json(prov: dict[str, Any] | None) -> str:
    """Serialize persona knowledge provenance dict for SQLite persistence."""
    if not prov:
        return "{}"
    serializable: dict[str, Any] = {}
    for k, v in prov.items():
        if hasattr(v, "model_dump"):
            serializable[k] = v.model_dump()
        elif hasattr(v, "dict"):
            serializable[k] = v.dict()
        else:
            serializable[k] = v
    return json.dumps(serializable)

def _validate_world_artifact_lore_id(
    conn: sqlite3.Connection,
    world_id: str | None,
    lore_id: str | None,
) -> None:
    """Ensure lore_id points to a world-level 'artifact' LoreNode belonging to world_id."""
    if not lore_id:
        return
    if not world_id:
        raise ValueError(
            "Cannot link a world artifact lore entry to a character without an assigned world."
        )
    row = conn.execute(
        "SELECT world_id, location_id, container_id, category FROM lore_nodes WHERE id = ?",
        (lore_id,),
    ).fetchone()
    if (
        not row
        or row["world_id"] != world_id
        or row["location_id"] is not None
        or row["container_id"] is not None
        or row["category"] != "artifact"
    ):
        raise ValueError(
            f"Lore entry '{lore_id}' is not a valid world-level 'artifact' lore entry for world '{world_id}'."
        )

def _remap_character_items_for_world_update(
    raw_json: str,
    artifact_id_map: dict[str, str],
    valid_artifact_ids: set[str],
) -> tuple[str, bool]:
    """Remap or clear ItemInstance.lore_id after an in-place world edit or Copy-on-Write world fork."""
    items = coerce_item_list(json.loads(raw_json or "[]"))
    changed = False
    updated: list[ItemInstance] = []
    for it in items:
        if it.lore_id:
            if it.lore_id in artifact_id_map:
                mapped = artifact_id_map[it.lore_id]
                if mapped != it.lore_id:
                    it = it.model_copy(update={"lore_id": mapped})
                    changed = True
            elif it.lore_id not in valid_artifact_ids:
                next_flags = [f for f in it.flags if f != "artifact"]
                it = it.model_copy(update={"lore_id": None, "flags": next_flags})
                changed = True
        updated.append(it)
    return dump_items_json(updated), changed

def _merge_live_clerk_state_items(
    clerk_equipped: list[ItemInstance],
    clerk_inventory: list[ItemInstance],
    live_equipped: list[ItemInstance],
    live_inventory: list[ItemInstance],
) -> tuple[list[ItemInstance], list[ItemInstance]]:
    """Overlay live manual metadata edits and preserve live permanent items during Phase 5 post-clerk commit."""
    clerk_equipped = coerce_item_list(list(clerk_equipped))
    clerk_inventory = coerce_item_list(list(clerk_inventory))
    live_equipped = coerce_item_list(list(live_equipped))
    live_inventory = coerce_item_list(list(live_inventory))
    live_by_id: dict[str, ItemInstance] = {}
    live_by_key: dict[str, ItemInstance] = {}
    for li in [*live_equipped, *live_inventory]:
        live_by_id[li.id] = li
        k = normalize_item_key(li.name)
        if k and k not in live_by_key:
            live_by_key[k] = li

    def _overlay(items: list[ItemInstance]) -> list[ItemInstance]:
        out: list[ItemInstance] = []
        for it in items:
            live = live_by_id.get(it.id) or live_by_key.get(normalize_item_key(it.name))
            if live is not None:
                it = it.model_copy(
                    update={
                        "id": live.id,
                        "note": live.note,
                        "flags": list(live.flags),
                        "lore_id": live.lore_id,
                    }
                )
            out.append(it)
        return out

    merged_eq = _overlay(clerk_equipped)
    merged_inv = _overlay(clerk_inventory)

    present_ids = {x.id for x in [*merged_eq, *merged_inv]}
    present_keys = {normalize_item_key(x.name) for x in [*merged_eq, *merged_inv]}

    for li in live_equipped:
        k = normalize_item_key(li.name)
        if "permanent" in li.flags and li.id not in present_ids and k not in present_keys:
            merged_eq.append(li)
            present_ids.add(li.id)
            present_keys.add(k)
    for li in live_inventory:
        k = normalize_item_key(li.name)
        if "permanent" in li.flags and li.id not in present_ids and k not in present_keys:
            merged_inv.append(li)
            present_ids.add(li.id)
            present_keys.add(k)

    return merged_eq, merged_inv

def _sanitize_character_media(
    portraits: dict[str, str] | None, gallery: list[GalleryImage] | None
) -> tuple[dict[str, str], list[GalleryImage]]:
    """Filter out hallucinated LLM keys and ensure only valid emotion keys and media URLs persist."""
    clean_portraits: dict[str, str] = {}
    if portraits and isinstance(portraits, dict):
        for emotion, url in portraits.items():
            clean_emotion = str(emotion).strip().lower()
            if clean_emotion in VALID_EMOTIONS and isinstance(url, str):
                u = url.strip()
                if (
                    u.startswith("/api/media/")
                    or u.startswith("http://")
                    or u.startswith("https://")
                ):
                    clean_portraits[clean_emotion] = u

    clean_gallery: list[GalleryImage] = []
    if gallery and isinstance(gallery, list):
        for img in gallery:
            if isinstance(img, GalleryImage) and isinstance(img.url, str):
                u = img.url.strip()
                if (
                    u.startswith("/api/media/")
                    or u.startswith("http://")
                    or u.startswith("https://")
                ):
                    clean_gallery.append(img)
            elif isinstance(img, dict) and isinstance(img.get("url"), str):
                u = str(img["url"]).strip()
                if (
                    u.startswith("/api/media/")
                    or u.startswith("http://")
                    or u.startswith("https://")
                ):
                    clean_gallery.append(GalleryImage(**img))

    return clean_portraits, clean_gallery

def slugify_tag(text: str) -> str:
    """Normalize tag string to lowercase kebab-case matching frontend slugifyTag."""
    cleaned = re.sub(r"[^\w\s-]", "", text.strip().lower())
    return re.sub(r"\s+", "-", cleaned)

_EMBED_SEMAPHORE = asyncio.Semaphore(8)

async def _compute_missing_embeddings(
    items: list[tuple[tuple[str, str, str], str]],
    existing_blobs: dict[tuple[str, str, str], bytes],
) -> dict[tuple[str, str, str], np.ndarray]:
    """Compute embeddings with bounded concurrency strictly for uncached (title, content, keywords_json) keys."""
    unique_missing: dict[tuple[str, str, str], str] = {}
    for cache_key, combined_text in items:
        if cache_key not in existing_blobs and cache_key not in unique_missing:
            unique_missing[cache_key] = combined_text
    if not unique_missing:
        return {}

    async def _embed_one(key: tuple[str, str, str], text: str) -> tuple[tuple[str, str, str], np.ndarray]:
        async with _EMBED_SEMAPHORE:
            import app.db.repository as repo_mod

            vec = await repo_mod.embed_text(text)
            return key, vec

    pairs = await asyncio.gather(*(_embed_one(k, txt) for k, txt in unique_missing.items()))
    return dict(pairs)

def _location_lore_vector_fields(
    location_name: str, lore_title: str, entity_tags: list[str]
) -> tuple[str, list[str]]:
    """Build disambiguated vector title and keyword list including the location name."""
    vec_title = f"{location_name} — {lore_title}"
    seen_low: set[str] = set()
    vec_keywords: list[str] = []
    for kw in [location_name, *entity_tags]:
        cleaned = kw.strip()
        if cleaned and cleaned.lower() not in seen_low:
            seen_low.add(cleaned.lower())
            vec_keywords.append(cleaned)
    return vec_title, vec_keywords

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS = 3600  # 1 hour for uncommitted character drafts

WEBAUTHN_CHALLENGE_TTL_SECONDS = 300  # 5 minutes


class RepositoryBase:
    """Core SQLite connection, media helpers, and vector/provider bindings."""

    def __init__(self, db_path: str, media_dir: str | None = None) -> None:
        self.db_path = db_path
        self.media_dir = media_dir or str(Path(db_path).resolve().parent / "data" / "media")
        self.vector_store = VectorStore(db_path)

    def _copy_character_media(self, src_character_id: str, dst_character_id: str) -> None:
        """Safely copy static character media directory when forking a character."""
        try:
            old_media = safe_resolve_character_media_dir(self.media_dir, src_character_id)
            new_media = safe_resolve_character_media_dir(self.media_dir, dst_character_id)
            if old_media.exists() and not new_media.exists():
                shutil.copytree(old_media, new_media)
        except Exception as exc:
            logger.warning(
                "Skipped copying character media from '%s' to '%s': %s",
                sanitize_log_value(src_character_id),
                sanitize_log_value(dst_character_id),
                sanitize_log_value(exc),
            )

    def _delete_character_media(self, character_id: str) -> None:
        """Safely remove a character's static media directory from disk."""
        try:
            c_media = safe_resolve_character_media_dir(self.media_dir, character_id)
            if c_media.exists():
                shutil.rmtree(c_media, ignore_errors=True)
        except Exception as exc:
            logger.warning(
                "Skipped deleting character media for '%s': %s",
                sanitize_log_value(character_id),
                sanitize_log_value(exc),
            )

    @property
    def providers(self) -> "ProviderStore":
        """Provider persistence bound to this repository's database."""
        return ProviderStore(self.db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        return conn
