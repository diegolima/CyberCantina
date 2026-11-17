"""Default showcase scenario seeder ('The Green Lie' & 'Kira Vance') and legacy test-only seed."""

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
from app.schemas.affective import WorldviewProfile, temperament_config_for_archetype
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    GalleryImage,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    LoreNodeDraft,
    WorldGlobalRules,
    WorldWizardDraft,
)
from app.security.media_path import (
    safe_resolve_public_character_media_file_path,
    safe_resolve_world_media_file_path,
)

SHOWCASE_SEED_VERSION = 1
SHOWCASE_WORLD_SEED_KEY = "showcase:the_green_lie"
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


def _copy_if_needed(src: Path, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    src_size = src.stat().st_size
    if not dst.is_file() or dst.stat().st_size != src_size:
        shutil.copy2(src, dst)
    return src_size


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
    """Materialize immutable shared showcase media on disk and upsert public world_media rows.

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
    for item in world_data.get("media", []):
        orig_id = str(item["id"])
        pub_id = _public_world_media_id(orig_id)
        pub_filename = _public_world_media_filename(orig_id)
        src_name = Path(str(item.get("url") or f"{orig_id}.webp")).name
        dst = safe_resolve_world_media_file_path(repo.media_dir, "images", pub_filename)
        byte_size = _copy_if_needed(_SHOWCASE_MEDIA_DIR / src_name, dst)
        media_id_map[orig_id] = pub_id
        media_rows.append(
            (
                pub_id,
                pub_filename,
                str(item.get("label") or ""),
                str(item.get("mime_type") or "image/webp"),
                int(byte_size),
                str(item.get("created_at") or utc_now_iso()),
            )
        )

    conn = repo._connect()
    try:
        for pub_id, pub_filename, label, mime_type, byte_size, created_at in media_rows:
            conn.execute(
                """
                INSERT INTO world_media (
                    id, owner_id, media_type, filename, label, mime_type, byte_size,
                    is_public, seed_key, created_at
                )
                VALUES (?, NULL, 'image', ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    owner_id = NULL,
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
        conn.commit()
    finally:
        conn.close()

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
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes,
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
                    int(edge.get("travel_minutes") or 1),
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


def _seed_kira_vance_for_user(
    repo: CantinaRepository,
    user_id: str,
    target_world_id: str | None,
    world_id_remap: dict[str, str],
) -> str:
    """Insert a private clone of Kira Vance for user_id referencing public character media."""
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
        str(orig_gallery[0].get("caption") or "Kira Vance in The Neon Rust")
        if orig_gallery
        else "Kira Vance in The Neon Rust"
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
    """Seed private DB clones of The Green Lie and Kira Vance sharing immutable public media.

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
        _seed_kira_vance_for_user(repo, user_id, target_world_id, world_id_remap)
        restored_character = True

    return {
        "restored_world": restored_world,
        "restored_character": restored_character,
        "skipped_world": skipped_world,
        "skipped_character": skipped_character,
    }


# ---------------------------------------------------------------------------
# Legacy Test-Only Seed ('Midnight at the Neon Rust')
# TODO: Review retaining this legacy test seed vs. migrating legacy engine/spatial
#       tests to minimal per-test fixtures or 'The Green Lie' showcase seed.
# ---------------------------------------------------------------------------


def ensure_test_seed(
    repo: CantinaRepository, owner_id: str | None = None
) -> None:
    """Test-only helper seeding the compact Neon Rust world, Kira Vance, and default campaign."""
    if (
        repo.list_campaigns()
        or repo.list_worlds(include_pending_deletion=True)
        or repo.list_characters(include_pending_deletion=True)
    ):
        if owner_id:
            repo.claim_unowned_entities(owner_id)
        return

    world_draft = WorldWizardDraft(
        name="Sector 9: The Neon Rust Undercity",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk Noir / Grounded Sci-Fi",
            tone="Atmospheric, rain-drenched, tense, tactile sensory details, dry wit.",
            setting_overview=(
                "Sector 9 sits beneath the storm-drains of Neo-Veridia's corporate spires. "
                "Here, unlicensed cyber-clinics, smuggler bars, and syndicate enforcers operate "
                "under flickering holographic billboards and perpetual acid drizzle."
            ),
            tech_or_magic_rules=(
                "Cyberware requires anti-rejection suppressants ('calmers'). Direct neural ports "
                "can be hard-jacked only via physical cable; wireless hacking is short-range line-of-sight."
            ),
            starting_timestamp="2094-11-14 23:15",
        ),
        locations=[
            LocationNodeDraft(
                key="main_bar",
                name="The Neon Rust Main Floor",
                summary="A smoky, low-ceilinged dive bar humming with neon transformers and quiet synth-jazz.",
                description=(
                    "Amber light from a half-dead neon sign bathes the scarred zinc counter of The Neon Rust. "
                    "Condensation drips down rusted bulkhead walls while a vintage holo-jukebox plays distorted "
                    "tenor sax. The air smells of ozone, cheap synth-ale, and soldering flux."
                ),
                environmental_tags=[
                    "scarred zinc bar",
                    "flickering amber neon",
                    "holo-jukebox",
                    "rain beating on armored glass",
                ],
                is_starting_location=True,
            ),
            LocationNodeDraft(
                key="backroom_clinic",
                name="Backroom Ripperdoc Bay",
                summary="Kira's sterile-ish surgical room hidden behind the liquor shelves.",
                description=(
                    "Beyond a heavy lead-lined curtain lies a compact trauma bay. A hydraulic operating chair "
                    "sits beneath articulated surgical arms, surrounded by humming diagnostic monitors and "
                    "locked cryo-drawers stocked with contraband Vespera neural grafts."
                ),
                environmental_tags=[
                    "hydraulic surgical chair",
                    "locked cryo-drawers",
                    "antiseptic and copper scent",
                    "diagnostic terminals",
                ],
            ),
            LocationNodeDraft(
                key="cargo_alley",
                name="Rain-Slicked Cargo Alley",
                summary="Narrow service alley behind the cantina leading to the canal docks.",
                description=(
                    "Cold acid rain sheets off corrugated overheads into glowing oil puddles. Steam vents "
                    "hiss beside overflowing dumpsters, and a rusted security keypad guards the cantina's "
                    "reinforced rear service door."
                ),
                environmental_tags=[
                    "acid rain",
                    "hissing steam vents",
                    "keypad rear door",
                    "distant siren echoes",
                ],
            ),
            LocationNodeDraft(
                key="vip_mezzanine",
                name="Shadowed VIP Mezzanine",
                summary="Elevated steel catwalk with sound-dampened booths overlooking the bar.",
                description=(
                    "An iron spiral staircase leads up to three private booths wrapped in acoustic privacy "
                    "fields. From the railing, you have a clear sightline over the main floor and the front entrance."
                ),
                environmental_tags=[
                    "acoustic privacy field",
                    "overlook railing",
                    "encrypted datapad terminal",
                ],
            ),
            LocationNodeDraft(
                key="cooling_tunnels",
                name="Sub-Basement Cooling Tunnels",
                summary="Flooded maintenance conduits beneath the clinic used as a bolt-hole.",
                description=(
                    "Accessed through a floor hatch in the surgical bay, these concrete tunnels carry "
                    "massive municipal coolant pipes. Ankle-deep water reflects red emergency strips leading "
                    "toward the old subway network."
                ),
                environmental_tags=[
                    "coolant pipes",
                    "ankle-deep water",
                    "red emergency lighting",
                    "smuggler stash box",
                ],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="backroom_clinic",
                direction_label="Lead-lined curtain behind the bar",
                reverse_direction_label="Curtain back to the main bar",
                compass_direction="N",
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="vip_mezzanine",
                direction_label="Iron spiral stairs to the mezzanine",
                reverse_direction_label="Spiral stairs down to the main floor",
                compass_direction="E",
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="cargo_alley",
                direction_label="Heavy rear fire exit door",
                reverse_direction_label="Reinforced cantina rear door",
                compass_direction="W",
                travel_minutes=2,
            ),
            LocationEdgeDraft(
                from_key="backroom_clinic",
                to_key="cooling_tunnels",
                direction_label="Concealed floor hatch under the surgical tray",
                reverse_direction_label="Ladder up to the Ripperdoc bay",
                compass_direction="N",
                travel_minutes=3,
                is_locked_or_hidden=True,
            ),
        ],
        lore_nodes=[
            LoreNodeDraft(
                title="Vespera Biotech Syndicate",
                category="faction",
                content=(
                    "A ruthless orbital-tier megacorp controlling 80% of neural implant patents. "
                    "Their 'Hound' recovery squads hunt down anyone possessing unreturned prototype cyberware."
                ),
                entity_tags=["vespera", "syndicate", "hounds", "biotech", "corporation"],
            ),
            LoreNodeDraft(
                title="The Meridian Data Heist",
                category="history",
                content=(
                    "Six months ago, a botched run on Vespera's Meridian Lab left three crew members dead. "
                    "Kira patched up the sole survivor in secret, earning a permanent target on her back."
                ),
                entity_tags=["meridian", "heist", "lab", "crew", "survivor"],
            ),
            LoreNodeDraft(
                title="Project Chimera Rumors",
                category="rumor",
                content=(
                    "Whispers across the Undercity claim an experimental military-grade reflex and memory "
                    "program vanished during the Meridian Heist, burning out unshielded neural subjects."
                ),
                entity_tags=["chimera", "chip", "cortex", "implant", "prototype"],
            ),
            LoreNodeDraft(
                title="Sector 9 Peacekeepers",
                category="faction",
                content=(
                    "Privatized municipal police who rarely enter the Undercity unless bribed or escorting "
                    "corporate extraction teams."
                ),
                entity_tags=["peacekeepers", "cops", "police", "sector 9"],
            ),
        ],
    )
    world = repo.create_world_from_draft(
        world_draft, world_id="world_neon_rust", owner_id=owner_id
    )

    opening_prose = (
        "*Rain hammers against the armored glass of The Neon Rust, streaking the amber glow of the street signs "
        "into blurred ribbons. Inside, the cantina is nearly empty—just the low hum of the transformer and a slow "
        "tenor sax drifting from the corner holo-jukebox.*\n\n"
        "*Behind the scarred zinc bar, Kira Vance sets down a rag, the micro-servos in her chrome left fingers "
        "giving a faint, familiar whirr. Her hazel eyes flick past your shoulder toward the street camera monitor "
        "before settling on your face.*\n\n"
        "\"Door was supposed to be latched five minutes ago,\" *she says, sliding a clean tumbler across the counter "
        "without taking her eyes off you.* \"And you look like you just outran half of Sector 9. Talk to me—are we "
        "having a quiet drink, or do I need to warm up the surgical chair in the back?\""
    )

    char_draft = CharacterWizardDraft(
        name="Kira Vance",
        tagline="Sharp-tongued ex-corporate trauma surgeon running The Neon Rust cantina.",
        character_bio=(
            "Former Chief Trauma Surgeon at Vespera Biotech who fled Sector 2 after sabotaging records to "
            "stop a live neural harvest. Now runs The Neon Rust in Sector 9, tending a quiet bar by night "
            "while operating an off-the-books underground clinic in the backroom."
        ),
        species="Human",
        sex="Female",
        pronouns="she/her",
        age="34",
        build_and_height="170 cm",
        distinctive_features=[
            "Lean, steady build",
            "Tired yet observant hazel eyes",
            "Silver-streaked dark hair tied back with a surgical clamp",
            "Brushed-chrome cybernetic left forearm with micro-scalpel articulation",
            "Fine servo seams along left wrist",
        ],
        posture="Alert and upright behind the counter, never turning her back to the door.",
        mannerisms=[
            "Wipes down glasses in slow circles when assessing someone.",
            "Lets her chrome left fingers click softly near the under-counter shotgun when guarded.",
        ],
        visual_aesthetic="Utilitarian Sector 9 medic-wear in charcoal and oil-stained leather.",
        personality_traits=["cynical", "protective", "sharp-tongued", "observant"],
        core_persona=(
            "Kira Vance is the proprietor and resident underground medic of The Neon Rust. "
            "She speaks in clipped, dryly sardonic sentences, using medical precision to mask deep protective "
            "instincts toward her regulars."
        ),
        moral_code=[
            "Never turn away a wounded runner who pays straight",
            "Never sell a patient out to Vespera Biotech",
        ],
        quirks_flaws=[
            "Never sits with her back to an entrance",
            "Masks genuine concern behind blunt clinical sarcasm",
        ],
        communication_style=["clipped", "dryly sardonic", "medically precise"],
        initial_message=opening_prose,
        equipped=[
            "Dark charcoal utility tank top",
            "Oil-stained leather ripperdoc apron",
            "Heavy reinforced work boots",
        ],
        inventory=[
            "Diagnostic medical penlight",
            "Concealed Vespera trauma med-injector",
        ],
        tags=["medic", "cyberpunk", "ally", "ripperdoc"],
        creator="CyberCantina Team",
        creator_notes=(
            "Kira works best when the user is cautious but honest. She reacts poorly to empty threats "
            "or corporate arrogance, but will take genuine risks for wounded runners."
        ),
        voice_anchors=[
            VoiceAnchor(
                context="Calm / Dry Banter",
                snippet=(
                    "*Kira holds a chipped tumbler up to the amber neon, squinting at a smudge before pouring two fingers "
                    "of rust-gin.* \"Drink it slow. Last guy who downed that in one gulp tried to fistfight the jukebox.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Suspicious",
                snippet=(
                    "*The servos in her chrome left wrist click softly as her hand rests near the under-counter shotgun.* "
                    "\"You're asking Vespera questions on a Tuesday night. Give me one good reason I shouldn't lock the clinic door.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent Care",
                snippet=(
                    "*Her sarcasm drops instantly, replaced by the quiet, steady cadence of a trauma surgeon.* "
                    "\"Stop talking and look at my penlight. Your neural telemetry is spiking—sit down before you seize.\""
                ),
            ),
        ],
        baseline_psyche=BaselinePsyche(
            mood_label="Vigilant & dryly composed",
            valence=0.05,
            arousal=0.45,
            core_drive="Keep The Neon Rust independent and protect refugees hiding from Vespera Biotech.",
            core_fear="Vespera Hounds tracing the stolen Chimera cortex chip back to her clinic.",
            default_want="Find out why the user showed up after hours soaked in rain and whether they were followed.",
            default_plan="Pour them a warming drink to get them talking while subtly checking the street cameras.",
            initial_worldview=WorldviewProfile(benevolence=-0.15, belonging=0.45, agency=0.35),
            temperament=temperament_config_for_archetype("stoic"),
        ),
        memory_shards=[
            MemoryShard(
                title="Why Kira Left Vespera Biotech",
                content=(
                    "Three years ago, Kira was Chief Trauma Surgeon at Vespera Tower until she refused an order to "
                    "harvest a live test subject's neural cortex. She sabotaged the lab records, lost her medical license, "
                    "and fled to Sector 9."
                ),
                keywords=["vespera", "past", "surgeon", "tower", "license", "sabotage"],
                emotional_weight=0.9,
            ),
            MemoryShard(
                title="The Night of the Meridian Heist",
                content=(
                    "Six months ago, the user stumbled into Kira's backroom clinic bleeding from a gunshot wound after "
                    "the Meridian Heist. Kira extracted a tracer bullet and stabilized their Chimera chip without asking for eddies."
                ),
                keywords=["meridian", "heist", "bullet", "clinic", "saved", "chimera", "debt"],
                emotional_weight=0.95,
            ),
            MemoryShard(
                title="The Chrome Arm Debt",
                content=(
                    "Kira lost her organic left arm during a syndicate raid two years ago. Her custom surgical cyber-arm "
                    "was built by an old street tech named Old Man Viktor, whom she still supplies with free immunosuppressants."
                ),
                keywords=["arm", "chrome", "cyberware", "viktor", "scar", "raid"],
                emotional_weight=0.75,
            ),
            MemoryShard(
                title="The Sub-Basement Escape Hatch",
                content=(
                    "Kira keeps a packed go-bag and encrypted cred-chips inside a waterproof locker in the Sub-Basement "
                    "Cooling Tunnels in case Vespera Hounds ever breach the cantina."
                ),
                keywords=["hatch", "tunnels", "basement", "escape", "go-bag", "emergency"],
                emotional_weight=0.8,
            ),
        ],
    )
    character = repo.create_character_from_draft(
        char_draft,
        world_id=world.id,
        character_id="char_kira_vance",
        owner_id=owner_id,
    )

    repo.create_campaign(
        name="Midnight at the Neon Rust",
        world_id=world.id,
        character_id=character.id,
        opening_prose=opening_prose,
        campaign_id="camp_neon_rust_default",
        owner_id=owner_id,
    )


def ensure_default_seed(
    repo: CantinaRepository, owner_id: str | None = None
) -> None:
    """Backward-compatible test/bootstrap wrapper: materializes public media and optionally seeds owner_id."""
    ensure_public_showcase_media(repo)
    if owner_id:
        seed_showcase_for_user(repo, owner_id)
