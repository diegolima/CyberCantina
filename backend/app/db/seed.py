"""Default showcase scenario seeder ('The Green Lie' & 'Yulia Halim')."""

from __future__ import annotations

import json
import shutil
import threading
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from app.db.repos.base import _location_lore_vector_fields, utc_now_iso
from app.db.repository import CantinaRepository
from app.db.vector_store import combine_entry_text, current_embedding_fingerprint, embed_text_sync
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    GalleryImage,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.world import WorldGlobalRules, extract_edge_distance_meters
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_asset_file_path,
    safe_resolve_public_character_media_file_path,
    safe_resolve_world_media_file_path,
)

SHOWCASE_SEED_VERSION = 2
SHOWCASE_WORLD_SEED_KEY = "showcase:the_green_lie"
# Preserved as stable internal provenance/media keys for existing DB rows and immutable public media URLs.
SHOWCASE_CHARACTER_SEED_KEY = "showcase:kira_vance"

_SHOWCASE_DATA_DIR = Path(__file__).resolve().parent / "showcase_data" / "the_green_lie"
_SHOWCASE_MEDIA_DIR = _SHOWCASE_DATA_DIR / "media"

_PUBLIC_CHARACTER_SLUG = "kira_vance"
_PUBLIC_CHARACTER_VERSION_TAG = f"v{SHOWCASE_SEED_VERSION}"
_PUBLIC_CHARACTER_PORTRAIT_FILE = "default_0b97fa1a.webp"
_PUBLIC_CHARACTER_GALLERY_FILE = "img_59a7be04b1.webp"

_EMBED_CACHE_LOCK = threading.Lock()
_EMBED_CACHE_BY_FINGERPRINT: dict[str, dict[str, np.ndarray]] = {}


@lru_cache(maxsize=1)
def _load_showcase_world_json() -> dict[str, Any]:
    return json.loads((_SHOWCASE_DATA_DIR / "world.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_showcase_character_json() -> dict[str, Any]:
    return json.loads((_SHOWCASE_DATA_DIR / "character.json").read_text(encoding="utf-8"))


def _public_world_media_id(orig_media_id: str) -> str:
    return f"pub_v{SHOWCASE_SEED_VERSION}_{orig_media_id}"


def _public_world_media_filename(orig_media_id: str) -> str:
    return f"pub_v{SHOWCASE_SEED_VERSION}_{orig_media_id}.webp"


def _public_world_video_id(orig_video_id: str) -> str:
    return f"pub_v{SHOWCASE_SEED_VERSION}_{orig_video_id}"


def _public_world_video_filename(orig_video_id: str, ext: str = ".mp4") -> str:
    clean_ext = ext if ext.startswith(".") else f".{ext}"
    return f"pub_v{SHOWCASE_SEED_VERSION}_{orig_video_id}{clean_ext}"


def _copy_if_needed(src: Path, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    src_size = src.stat().st_size
    if not dst.is_file() or dst.stat().st_size != src_size:
        shutil.copy2(src, dst)
    return src_size


def _migrate_v1_showcase_to_v2(
    conn: Any,
    world_data: dict[str, Any],
) -> None:
    """Idempotently migrate v1 showcase DB references (pub_v1_* / public/v1/) to current version."""
    v1_to_v2_media: dict[str, str] = {}
    for item in world_data.get("media", []):
        orig_id = str(item.get("id") or "").strip()
        if not orig_id:
            continue
        v1_id = f"pub_v1_{orig_id}"
        v2_id = _public_world_media_id(orig_id)
        if v1_id != v2_id:
            v1_to_v2_media[v1_id] = v2_id

    if not v1_to_v2_media:
        return

    old_char_prefix = f"/api/media/public/v1/characters/{_PUBLIC_CHARACTER_SLUG}/"
    new_char_prefix = f"/api/media/public/{_PUBLIC_CHARACTER_VERSION_TAG}/characters/{_PUBLIC_CHARACTER_SLUG}/"

    v1_ids = list(v1_to_v2_media.keys())
    ph = ",".join("?" for _ in v1_ids)
    has_v1_assets = conn.execute(
        f"SELECT 1 FROM media_assets WHERE id IN ({ph}) LIMIT 1",
        v1_ids,
    ).fetchone()
    has_v1_worlds = conn.execute(
        "SELECT 1 FROM worlds WHERE seed_key = ? AND COALESCE(seed_version, 0) < ? LIMIT 1",
        (SHOWCASE_WORLD_SEED_KEY, SHOWCASE_SEED_VERSION),
    ).fetchone()
    has_v1_chars = conn.execute(
        """
        SELECT 1 FROM characters
        WHERE (seed_key = ? AND COALESCE(seed_version, 0) < ?)
           OR portraits_json LIKE ? OR gallery_json LIKE ?
        LIMIT 1
        """,
        (
            SHOWCASE_CHARACTER_SEED_KEY,
            SHOWCASE_SEED_VERSION,
            f"%{old_char_prefix}%",
            f"%{old_char_prefix}%",
        ),
    ).fetchone()
    has_v1_char_vers = conn.execute(
        "SELECT 1 FROM character_versions WHERE data_json LIKE ? LIMIT 1",
        (f"%{old_char_prefix}%",),
    ).fetchone()
    has_v1_turns = conn.execute(
        "SELECT 1 FROM turn_nodes WHERE post_turn_json LIKE '%pub_v1_%' LIMIT 1"
    ).fetchone()

    if not (has_v1_assets or has_v1_worlds or has_v1_chars or has_v1_char_vers or has_v1_turns):
        return

    for old_id, new_id in v1_to_v2_media.items():
        conn.execute(
            """
            DELETE FROM world_media_links
            WHERE media_id = ?
              AND world_id IN (SELECT world_id FROM world_media_links WHERE media_id = ?)
            """,
            (old_id, new_id),
        )
        conn.execute(
            "UPDATE world_media_links SET media_id = ? WHERE media_id = ?",
            (new_id, old_id),
        )
        conn.execute(
            "UPDATE location_containers SET image_media_id = ? WHERE image_media_id = ?",
            (new_id, old_id),
        )
        conn.execute(
            "UPDATE location_nodes SET image_media_id = ? WHERE image_media_id = ?",
            (new_id, old_id),
        )

    if has_v1_turns:
        turn_rows = conn.execute(
            "SELECT id, post_turn_json FROM turn_nodes WHERE post_turn_json LIKE '%pub_v1_%'"
        ).fetchall()
        for t_row in turn_rows:
            raw_post = t_row["post_turn_json"]
            if not raw_post:
                continue
            try:
                post_data = json.loads(raw_post)
            except Exception:
                continue
            if not isinstance(post_data, dict):
                continue
            fvm = post_data.get("first_visit_media")
            if not isinstance(fvm, list):
                continue
            changed = False
            for m_entry in fvm:
                if not isinstance(m_entry, dict):
                    continue
                old_mid = str(m_entry.get("media_id") or "")
                new_mid = v1_to_v2_media.get(old_mid)
                if new_mid:
                    m_entry["media_id"] = new_mid
                    m_entry["image_url"] = f"/api/media/worlds/images/{new_mid}.webp"
                    changed = True
            if changed:
                conn.execute(
                    "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                    (json.dumps(post_data), t_row["id"]),
                )

    conn.execute(
        """
        UPDATE worlds
        SET seed_version = ?
        WHERE seed_key = ? AND COALESCE(seed_version, 0) < ?
        """,
        (SHOWCASE_SEED_VERSION, SHOWCASE_WORLD_SEED_KEY, SHOWCASE_SEED_VERSION),
    )

    if old_char_prefix != new_char_prefix:
        c_rows = conn.execute(
            """
            SELECT id, portraits_json, gallery_json
            FROM characters
            WHERE portraits_json LIKE ? OR gallery_json LIKE ?
            """,
            (f"%{old_char_prefix}%", f"%{old_char_prefix}%"),
        ).fetchall()
        for cr in c_rows:
            new_p = str(cr["portraits_json"] or "{}").replace(old_char_prefix, new_char_prefix)
            new_g = str(cr["gallery_json"] or "[]").replace(old_char_prefix, new_char_prefix)
            conn.execute(
                "UPDATE characters SET portraits_json = ?, gallery_json = ? WHERE id = ?",
                (new_p, new_g, cr["id"]),
            )
        conn.execute(
            """
            UPDATE characters
            SET seed_version = ?
            WHERE seed_key = ? AND COALESCE(seed_version, 0) < ?
            """,
            (SHOWCASE_SEED_VERSION, SHOWCASE_CHARACTER_SEED_KEY, SHOWCASE_SEED_VERSION),
        )

        cv_rows = conn.execute(
            "SELECT id, data_json FROM character_versions WHERE data_json LIKE ?",
            (f"%{old_char_prefix}%",),
        ).fetchall()
        for cv in cv_rows:
            new_data_json = str(cv["data_json"] or "{}").replace(old_char_prefix, new_char_prefix)
            conn.execute(
                "UPDATE character_versions SET data_json = ? WHERE id = ?",
                (new_data_json, cv["id"]),
            )

    conn.execute(
        f"DELETE FROM media_assets WHERE id IN ({ph}) AND is_public = 1 AND seed_key = ?",
        (*v1_ids, SHOWCASE_WORLD_SEED_KEY),
    )


def _cleanup_legacy_v1_showcase_files(
    repo: CantinaRepository,
    world_data: dict[str, Any],
) -> None:
    """Best-effort removal of superseded v1 showcase media files on disk."""
    if SHOWCASE_SEED_VERSION <= 1:
        return
    for item in world_data.get("media", []):
        orig_id = str(item.get("id") or "").strip()
        if not orig_id:
            continue
        try:
            old_img = safe_resolve_world_media_file_path(
                repo.media_dir, "images", f"pub_v1_{orig_id}.webp"
            )
            old_img.unlink(missing_ok=True)
        except (PathTraversalError, ValueError, OSError):
            pass

    for cat, fname in (
        ("portraits", _PUBLIC_CHARACTER_PORTRAIT_FILE),
        ("gallery", _PUBLIC_CHARACTER_GALLERY_FILE),
    ):
        try:
            old_char_file = safe_resolve_public_character_media_file_path(
                repo.media_dir, "v1", _PUBLIC_CHARACTER_SLUG, cat, fname
            )
            old_char_file.unlink(missing_ok=True)
            # Clean empty directories up to public/v1
            for parent in (old_char_file.parent, old_char_file.parent.parent, old_char_file.parent.parent.parent):
                if parent.is_dir():
                    try:
                        parent.rmdir()
                    except OSError:
                        break
        except (PathTraversalError, ValueError, OSError):
            pass


def _get_cached_showcase_embedding(cache_key: str, text: str) -> np.ndarray:
    fp = current_embedding_fingerprint()
    with _EMBED_CACHE_LOCK:
        fp_cache = _EMBED_CACHE_BY_FINGERPRINT.setdefault(fp, {})
        existing = fp_cache.get(cache_key)
        if existing is not None:
            return existing
    vec = embed_text_sync(text)
    with _EMBED_CACHE_LOCK:
        fp_cache = _EMBED_CACHE_BY_FINGERPRINT.setdefault(fp, {})
        fp_cache[cache_key] = vec
    return vec


def ensure_public_showcase_media(repo: CantinaRepository) -> dict[str, str]:
    """Materialize immutable shared showcase media (images & linked videos) on disk and upsert media_assets rows.

    Returns a mapping from original bundle world media ID -> public DB media ID.
    """
    world_data = _load_showcase_world_json()

    portrait_dst = safe_resolve_public_character_media_file_path(
        repo.media_dir,
        _PUBLIC_CHARACTER_VERSION_TAG,
        _PUBLIC_CHARACTER_SLUG,
        "portraits",
        _PUBLIC_CHARACTER_PORTRAIT_FILE,
    )
    _copy_if_needed(_SHOWCASE_MEDIA_DIR / _PUBLIC_CHARACTER_PORTRAIT_FILE, portrait_dst)

    gallery_dst = safe_resolve_public_character_media_file_path(
        repo.media_dir,
        _PUBLIC_CHARACTER_VERSION_TAG,
        _PUBLIC_CHARACTER_SLUG,
        "gallery",
        _PUBLIC_CHARACTER_GALLERY_FILE,
    )
    _copy_if_needed(_SHOWCASE_MEDIA_DIR / _PUBLIC_CHARACTER_GALLERY_FILE, gallery_dst)

    media_id_map: dict[str, str] = {}
    media_rows: list[tuple[str, str, str, str, int, str]] = []
    video_rows: list[
        tuple[str, str, str, str, int, str, int | None, int | None, int | None, str]
    ] = []
    for item in world_data.get("media", []):
        orig_id = str(item["id"])
        pub_id = _public_world_media_id(orig_id)
        pub_filename = _public_world_media_filename(orig_id)
        src_name = Path(str(item.get("url") or f"{orig_id}.webp")).name
        dst = safe_resolve_world_media_file_path(repo.media_dir, "images", pub_filename)
        byte_size = _copy_if_needed(_SHOWCASE_MEDIA_DIR / src_name, dst)
        media_id_map[orig_id] = pub_id
        created_at = str(item.get("created_at") or utc_now_iso())
        label = str(item.get("label") or "")
        media_rows.append(
            (
                pub_id,
                pub_filename,
                label,
                str(item.get("mime_type") or "image/webp"),
                int(byte_size),
                created_at,
            )
        )

        raw_vid_url = str(item.get("video_url") or "").strip()
        raw_vid_id = str(item.get("video_asset_id") or "").strip()
        if raw_vid_url and raw_vid_id:
            vid_src_name = Path(raw_vid_url).name
            vid_ext = Path(vid_src_name).suffix or ".mp4"
            pub_vid_id = _public_world_video_id(raw_vid_id)
            pub_vid_filename = _public_world_video_filename(raw_vid_id, vid_ext)
            vid_dst = safe_resolve_asset_file_path(repo.media_dir, "videos", pub_vid_filename)
            vid_bytes = _copy_if_needed(_SHOWCASE_MEDIA_DIR / vid_src_name, vid_dst)
            video_rows.append(
                (
                    pub_vid_id,
                    pub_vid_filename,
                    label,
                    str(item.get("video_mime_type") or "video/mp4"),
                    int(vid_bytes),
                    pub_id,
                    int(item["video_duration_ms"]) if item.get("video_duration_ms") is not None else None,
                    int(item["video_width"]) if item.get("video_width") is not None else None,
                    int(item["video_height"]) if item.get("video_height") is not None else None,
                    created_at,
                )
            )

    conn = repo._connect()
    try:
        for pub_id, pub_filename, label, mime_type, byte_size, created_at in media_rows:
            conn.execute(
                """
                INSERT INTO media_assets (
                    id, owner_id, entity_scope, media_type, role, filename, label,
                    mime_type, byte_size, is_public, seed_key, parent_image_id, created_at
                )
                VALUES (?, NULL, 'world', 'image', 'world_scene', ?, ?, ?, ?, 1, ?, NULL, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_id = NULL,
                    entity_scope = 'world',
                    role = 'world_scene',
                    filename = excluded.filename,
                    label = excluded.label,
                    mime_type = excluded.mime_type,
                    byte_size = excluded.byte_size,
                    is_public = 1,
                    seed_key = excluded.seed_key
                """,
                (
                    pub_id,
                    pub_filename,
                    label,
                    mime_type,
                    byte_size,
                    SHOWCASE_WORLD_SEED_KEY,
                    created_at,
                ),
            )

        for (
            pub_vid_id,
            pub_vid_filename,
            label,
            vid_mime_type,
            vid_bytes,
            parent_image_id,
            duration_ms,
            width,
            height,
            created_at,
        ) in video_rows:
            conn.execute(
                "DELETE FROM media_assets WHERE parent_image_id = ? AND id != ?",
                (parent_image_id, pub_vid_id),
            )
            conn.execute(
                """
                INSERT INTO media_assets (
                    id, owner_id, entity_scope, media_type, role, filename, label,
                    mime_type, byte_size, is_public, seed_key, parent_image_id,
                    duration_ms, width, height, created_at
                )
                VALUES (?, NULL, 'world', 'video', 'linked_video', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_id = NULL,
                    entity_scope = 'world',
                    role = 'linked_video',
                    filename = excluded.filename,
                    label = excluded.label,
                    mime_type = excluded.mime_type,
                    byte_size = excluded.byte_size,
                    is_public = 1,
                    seed_key = excluded.seed_key,
                    parent_image_id = excluded.parent_image_id,
                    duration_ms = excluded.duration_ms,
                    width = excluded.width,
                    height = excluded.height
                """,
                (
                    pub_vid_id,
                    pub_vid_filename,
                    label,
                    vid_mime_type,
                    vid_bytes,
                    SHOWCASE_WORLD_SEED_KEY,
                    parent_image_id,
                    duration_ms,
                    width,
                    height,
                    created_at,
                ),
            )

        _migrate_v1_showcase_to_v2(conn, world_data)
        conn.commit()
    finally:
        conn.close()

    _cleanup_legacy_v1_showcase_files(repo, world_data)
    return media_id_map


def _seed_green_lie_world_for_user(
    repo: CantinaRepository,
    user_id: str,
    media_id_map: dict[str, str],
) -> tuple[str, dict[str, str]]:
    """Insert a private clone of The Green Lie for user_id sharing public world_media."""
    w_data = _load_showcase_world_json()
    now = utc_now_iso()
    new_world_id = f"world_{uuid.uuid4().hex[:10]}"
    id_remap: dict[str, str] = {}

    rules_json = WorldGlobalRules.model_validate(w_data["global_rules"]).model_dump_json()

    conn = repo._connect()
    try:
        conn.execute(
            """
            INSERT INTO worlds (
                id, owner_id, name, global_rules_json, unsupported_fields_json,
                seed_key, seed_version, seed_modified, pending_deletion, created_at
            )
            VALUES (?, ?, ?, ?, '{}', ?, ?, 0, 0, ?)
            """,
            (
                new_world_id,
                user_id,
                str(w_data["name"]),
                rules_json,
                SHOWCASE_WORLD_SEED_KEY,
                SHOWCASE_SEED_VERSION,
                now,
            ),
        )

        # Link shared public world media
        for idx, m_item in enumerate(w_data.get("media", [])):
            pub_media_id = media_id_map.get(str(m_item["id"]))
            if not pub_media_id:
                continue
            conn.execute(
                """
                INSERT INTO world_media_links (world_id, media_id, sort_order, label_override, created_at)
                VALUES (?, ?, ?, NULL, ?)
                """,
                (new_world_id, pub_media_id, int(m_item.get("sort_order", idx)), now),
            )

        # Insert containers ordered highest depth -> lowest so parents exist first
        containers = sorted(
            w_data.get("containers", []),
            key=lambda c: (-int(c.get("depth", 1)), str(c.get("name", ""))),
        )
        for cont in containers:
            old_c_id = str(cont["id"])
            new_c_id = f"cont_{uuid.uuid4().hex[:10]}"
            id_remap[old_c_id] = new_c_id

        for cont in containers:
            old_c_id = str(cont["id"])
            new_c_id = id_remap[old_c_id]
            parent_id = (
                id_remap.get(str(cont["parent_container_id"]))
                if cont.get("parent_container_id")
                else None
            )
            img_id = (
                media_id_map.get(str(cont["image_media_id"]))
                if cont.get("image_media_id")
                else None
            )
            conn.execute(
                """
                INSERT INTO location_containers (
                    id, world_id, created_at_turn_id, parent_container_id, depth, name,
                    description, environmental_tags_json, ui_x, ui_y, icon, image_media_id, created_at
                )
                VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_c_id,
                    new_world_id,
                    parent_id,
                    int(cont["depth"]),
                    str(cont["name"]),
                    str(cont.get("description") or ""),
                    json.dumps(cont.get("environmental_tags") or []),
                    cont.get("ui_x"),
                    cont.get("ui_y"),
                    cont.get("icon"),
                    img_id,
                    now,
                ),
            )
            for c_lore in cont.get("lore_nodes") or []:
                old_cl_id = str(c_lore.get("id") or "")
                new_cl_id = f"lore_{uuid.uuid4().hex[:10]}"
                if old_cl_id:
                    id_remap[old_cl_id] = new_cl_id
                tags = list(c_lore.get("entity_tags") or [])
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
                        new_c_id,
                        str(c_lore["title"]),
                        str(c_lore["category"]),
                        str(c_lore["content"]),
                        json.dumps(tags),
                    ),
                )
                if str(c_lore["category"]) != "secret":
                    vec_title, vec_keywords = _location_lore_vector_fields(
                        str(cont["name"]), str(c_lore["title"]), tags
                    )
                    vec = _get_cached_showcase_embedding(
                        f"cont_lore:{old_cl_id or new_cl_id}",
                        combine_entry_text(vec_title, str(c_lore["content"]), vec_keywords),
                    )
                    repo.vector_store.upsert_entry(
                        entry_id=f"lore_{new_cl_id}",
                        source_type="container_lore",
                        world_id=new_world_id,
                        container_id=new_c_id,
                        title=vec_title,
                        content=str(c_lore["content"]),
                        keywords=vec_keywords,
                        embedding=vec,
                        conn=conn,
                    )

        # Insert locations + location-scoped lore
        for loc in w_data.get("locations", []):
            old_loc_id = str(loc["id"])
            new_loc_id = f"loc_{uuid.uuid4().hex[:10]}"
            id_remap[old_loc_id] = new_loc_id
            cont_id = (
                id_remap.get(str(loc["container_id"]))
                if loc.get("container_id")
                else None
            )
            img_id = (
                media_id_map.get(str(loc["image_media_id"]))
                if loc.get("image_media_id")
                else None
            )
            conn.execute(
                """
                INSERT INTO location_nodes (
                    id, world_id, created_at_turn_id, superseded_at_turn_id, container_id,
                    is_entry_exit, name, summary, description, environmental_tags_json,
                    is_starting_location, is_hub, starting_message, ui_x, ui_y, icon, image_media_id
                )
                VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_loc_id,
                    new_world_id,
                    cont_id,
                    1 if loc.get("is_entry_exit") else 0,
                    str(loc["name"]),
                    str(loc.get("summary") or ""),
                    str(loc.get("description") or ""),
                    json.dumps(loc.get("environmental_tags") or []),
                    1 if loc.get("is_starting_location") else 0,
                    1 if loc.get("is_hub") else 0,
                    str(loc.get("starting_message") or ""),
                    loc.get("ui_x"),
                    loc.get("ui_y"),
                    loc.get("icon"),
                    img_id,
                ),
            )
            for l_lore in loc.get("lore_nodes") or []:
                old_ll_id = str(l_lore.get("id") or "")
                new_ll_id = f"lore_{uuid.uuid4().hex[:10]}"
                if old_ll_id:
                    id_remap[old_ll_id] = new_ll_id
                tags = list(l_lore.get("entity_tags") or [])
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, container_id, campaign_id,
                        title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (
                        new_ll_id,
                        new_world_id,
                        new_loc_id,
                        str(l_lore["title"]),
                        str(l_lore["category"]),
                        str(l_lore["content"]),
                        json.dumps(tags),
                    ),
                )
                if str(l_lore["category"]) != "secret":
                    vec_title, vec_keywords = _location_lore_vector_fields(
                        str(loc["name"]), str(l_lore["title"]), tags
                    )
                    vec = _get_cached_showcase_embedding(
                        f"loc_lore:{old_ll_id or new_ll_id}",
                        combine_entry_text(vec_title, str(l_lore["content"]), vec_keywords),
                    )
                    repo.vector_store.upsert_entry(
                        entry_id=f"lore_{new_ll_id}",
                        source_type="location_lore",
                        world_id=new_world_id,
                        location_id=new_loc_id,
                        title=vec_title,
                        content=str(l_lore["content"]),
                        keywords=vec_keywords,
                        embedding=vec,
                        conn=conn,
                    )

        # World-level lore nodes
        for w_lore in w_data.get("lore_nodes", []):
            old_wl_id = str(w_lore.get("id") or "")
            new_wl_id = f"lore_{uuid.uuid4().hex[:10]}"
            if old_wl_id:
                id_remap[old_wl_id] = new_wl_id
            tags = list(w_lore.get("entity_tags") or [])
            conn.execute(
                """
                INSERT INTO lore_nodes (
                    id, world_id, location_id, container_id, campaign_id,
                    title, category, content, entity_tags_json
                )
                VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                """,
                (
                    new_wl_id,
                    new_world_id,
                    str(w_lore["title"]),
                    str(w_lore["category"]),
                    str(w_lore["content"]),
                    json.dumps(tags),
                ),
            )
            vec = _get_cached_showcase_embedding(
                f"world_lore:{old_wl_id or new_wl_id}",
                combine_entry_text(str(w_lore["title"]), str(w_lore["content"]), tags),
            )
            repo.vector_store.upsert_entry(
                entry_id=f"lore_{new_wl_id}",
                source_type="lore",
                world_id=new_world_id,
                title=str(w_lore["title"]),
                content=str(w_lore["content"]),
                keywords=tags,
                embedding=vec,
                conn=conn,
            )

        # Edges
        for edge in w_data.get("edges", []):
            from_id = id_remap.get(str(edge["from_location_id"]))
            to_id = id_remap.get(str(edge["to_location_id"]))
            if not from_id or not to_id:
                continue
            distance_meters = extract_edge_distance_meters(edge)
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, distance_meters,
                    is_locked_or_hidden, created_at_turn_id, superseded_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                """,
                (
                    f"edge_{uuid.uuid4().hex[:10]}",
                    new_world_id,
                    from_id,
                    to_id,
                    str(edge.get("direction_label") or "forward"),
                    edge.get("compass_direction"),
                    distance_meters,
                    1 if edge.get("is_locked_or_hidden") else 0,
                ),
            )

        conn.commit()
    finally:
        conn.close()

    return new_world_id, id_remap


def _resolve_existing_artifact_lore_id(
    repo: CantinaRepository,
    world_id: str | None,
    orig_lore_id: str | None,
    id_remap: dict[str, str],
) -> str | None:
    if not orig_lore_id or not world_id:
        return None
    if orig_lore_id in id_remap:
        return id_remap[orig_lore_id]
    # World already existed (possibly edited): resolve matching artifact lore on that world
    w_data = _load_showcase_world_json()
    orig_title = next(
        (
            str(ln.get("title") or "")
            for ln in w_data.get("lore_nodes", [])
            if ln.get("id") == orig_lore_id
        ),
        "",
    )
    conn = repo._connect()
    try:
        if orig_title:
            row = conn.execute(
                """
                SELECT id FROM lore_nodes
                WHERE world_id = ? AND location_id IS NULL AND container_id IS NULL
                  AND campaign_id IS NULL AND category = 'artifact' AND title = ?
                LIMIT 1
                """,
                (world_id, orig_title),
            ).fetchone()
            if row:
                return str(row["id"])
        return None
    finally:
        conn.close()


def _seed_yulia_halim_for_user(
    repo: CantinaRepository,
    user_id: str,
    target_world_id: str | None,
    world_id_remap: dict[str, str],
) -> str:
    """Insert a private clone of Yulia Halim for user_id referencing public character media."""
    c_data = _load_showcase_character_json()
    new_char_id = f"char_{uuid.uuid4().hex[:10]}"

    def _remap_items(raw_items: list[dict[str, Any]]) -> list[ItemInstance]:
        out: list[ItemInstance] = []
        for raw in raw_items:
            item_copy = dict(raw)
            orig_lore_id = item_copy.get("lore_id")
            if orig_lore_id:
                resolved_lore = _resolve_existing_artifact_lore_id(
                    repo, target_world_id, str(orig_lore_id), world_id_remap
                )
                item_copy["lore_id"] = resolved_lore
                if not resolved_lore:
                    item_copy["flags"] = [
                        f for f in (item_copy.get("flags") or []) if f != "artifact"
                    ]
            out.append(ItemInstance.model_validate(item_copy))
        return out

    equipped_items = _remap_items(c_data.get("equipped") or [])
    inventory_items = _remap_items(c_data.get("inventory") or [])

    shards = [MemoryShard.model_validate(m) for m in (c_data.get("memory_shards") or [])]
    shard_embeddings = [
        _get_cached_showcase_embedding(
            f"char_shard:{idx}:{shard.title}",
            combine_entry_text(shard.title, shard.content, shard.keywords),
        )
        for idx, shard in enumerate(shards)
    ]

    public_portrait_url = (
        f"/api/media/public/{_PUBLIC_CHARACTER_VERSION_TAG}/characters/"
        f"{_PUBLIC_CHARACTER_SLUG}/portraits/{_PUBLIC_CHARACTER_PORTRAIT_FILE}"
    )
    public_gallery_url = (
        f"/api/media/public/{_PUBLIC_CHARACTER_VERSION_TAG}/characters/"
        f"{_PUBLIC_CHARACTER_SLUG}/gallery/{_PUBLIC_CHARACTER_GALLERY_FILE}"
    )
    orig_gallery = c_data.get("gallery") or []
    gallery_caption = (
        str(orig_gallery[0].get("caption") or "Yulia Halim in The Neon Rust")
        if orig_gallery
        else "Yulia Halim in The Neon Rust"
    )
    gallery_created_at = (
        str(orig_gallery[0].get("created_at") or utc_now_iso())
        if orig_gallery
        else utc_now_iso()
    )

    unsupported_fields: dict[str, Any] = {}
    if "low_token_initial_message" in c_data:
        unsupported_fields["low_token_initial_message"] = c_data["low_token_initial_message"]

    draft = CharacterWizardDraft(
        name=str(c_data["name"]),
        tagline=str(c_data["tagline"]),
        character_bio=str(c_data.get("character_bio") or ""),
        species=str(c_data.get("species") or "Human"),
        sex=str(c_data.get("sex") or ""),
        pronouns=str(c_data.get("pronouns") or ""),
        age=str(c_data.get("age") or ""),
        build_and_height=str(c_data.get("build_and_height") or ""),
        distinctive_features=list(c_data.get("distinctive_features") or []),
        posture=str(c_data.get("posture") or ""),
        mannerisms=list(c_data.get("mannerisms") or []),
        visual_aesthetic=str(c_data.get("visual_aesthetic") or ""),
        personality_traits=list(c_data.get("personality_traits") or []),
        core_persona=str(c_data["core_persona"]),
        moral_code=list(c_data.get("moral_code") or []),
        quirks_flaws=list(c_data.get("quirks_flaws") or []),
        communication_style=list(c_data.get("communication_style") or []),
        initial_message=str(c_data.get("initial_message") or ""),
        equipped=equipped_items,
        inventory=inventory_items,
        tags=list(c_data.get("tags") or []),
        creator=str(c_data.get("creator") or "CyberCantina Team"),
        creator_notes=str(c_data.get("creator_notes") or ""),
        voice_anchors=[
            VoiceAnchor.model_validate(va) for va in (c_data.get("voice_anchors") or [])
        ],
        baseline_psyche=BaselinePsyche.model_validate(c_data["baseline_psyche"]),
        memory_shards=shards,
        portraits={"default": public_portrait_url},
        gallery=[
            GalleryImage(
                id="img_59a7be04b1",
                url=public_gallery_url,
                caption=gallery_caption,
                created_at=gallery_created_at,
            )
        ],
        unsupported_fields=unsupported_fields,
    )

    repo.create_character_from_draft(
        draft,
        world_id=target_world_id,
        character_id=new_char_id,
        shard_embeddings=shard_embeddings,
        owner_id=user_id,
    )

    conn = repo._connect()
    try:
        conn.execute(
            """
            UPDATE characters
            SET seed_key = ?, seed_version = ?, seed_modified = 0
            WHERE id = ?
            """,
            (SHOWCASE_CHARACTER_SEED_KEY, SHOWCASE_SEED_VERSION, new_char_id),
        )
        conn.commit()
    finally:
        conn.close()

    return new_char_id


def seed_showcase_for_user(
    repo: CantinaRepository,
    user_id: str,
    *,
    restore_missing_only: bool = False,
) -> dict[str, bool]:
    """Seed private DB clones of The Green Lie and Yulia Halim sharing immutable public media.

    Creates zero campaigns so players explore world- vs. character-focused campaign starts.
    When ``restore_missing_only`` is True (or on re-entrant calls), existing non-deleted
    seeded assets (including user-edited versions) are preserved untouched.
    """
    media_id_map = ensure_public_showcase_media(repo)

    conn = repo._connect()
    try:
        existing_world_row = conn.execute(
            """
            SELECT id FROM worlds
            WHERE owner_id = ? AND seed_key = ? AND pending_deletion = 0
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, SHOWCASE_WORLD_SEED_KEY),
        ).fetchone()
        existing_char_row = conn.execute(
            """
            SELECT id FROM characters
            WHERE owner_id = ? AND seed_key = ? AND pending_deletion = 0
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, SHOWCASE_CHARACTER_SEED_KEY),
        ).fetchone()
    finally:
        conn.close()

    existing_world_id = str(existing_world_row["id"]) if existing_world_row else None
    existing_char_id = str(existing_char_row["id"]) if existing_char_row else None

    restored_world = False
    restored_character = False
    skipped_world = existing_world_id is not None
    skipped_character = existing_char_id is not None

    world_id_remap: dict[str, str] = {}
    target_world_id = existing_world_id
    if existing_world_id is None:
        target_world_id, world_id_remap = _seed_green_lie_world_for_user(
            repo, user_id, media_id_map
        )
        restored_world = True

    if existing_char_id is None:
        _seed_yulia_halim_for_user(repo, user_id, target_world_id, world_id_remap)
        restored_character = True

    return {
        "restored_world": restored_world,
        "restored_character": restored_character,
        "skipped_world": skipped_world,
        "skipped_character": skipped_character,
    }



def ensure_default_seed(
    repo: CantinaRepository, owner_id: str | None = None
) -> None:
    """Backward-compatible test/bootstrap wrapper: materializes public media and optionally seeds owner_id."""
    ensure_public_showcase_media(repo)
    if owner_id:
        seed_showcase_for_user(repo, owner_id)
