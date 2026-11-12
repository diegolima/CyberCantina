"""Branch-aware SQLite repository for Worlds, Characters, Spatial Graph, and Turn Trees."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
from typing import Any

import numpy as np

from app.config import ModelProfile
from app.db.provider_store import ProviderStore
from app.db.vector_store import VectorStore, combine_entry_text, embed_text
from app.prompts import BUILTIN_PRESETS, FACTORY_DEFAULT_PROMPTS
from app.schemas.auth import (
    PasskeyInfo,
    UserModelSettingsPayload,
    UserProfile,
    UserRole,
)
from app.schemas.note import (
    UserNoteCreatePayload,
    UserNoteRecord,
    UserNoteUpdatePayload,
)
from app.schemas.prompt import PromptPresetRecord
from app.schemas.persona import (
    DEFAULT_PERSONA_ID,
    DisclosureDetectionMode,
    PersonaCreatePayload,
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
    PersonaUpdatePayload,
    default_persona_id_for_user,
    get_default_persona,
    is_default_persona_id,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CharacterUpdatePayload,
    CharacterVersionSummary,
    CharacterWizardDraft,
    CognitionBlock,
    GalleryImage,
    ItemFlag,
    ItemInstance,
    MemoryShard,
    VALID_EMOTIONS,
    VALID_ITEM_FLAGS,
    VoiceAnchor,
    coerce_item_list,
    dump_items_json,
    normalize_item_key,
    strip_item_location_affixes,
)
from app.engine.affective_engine import seed_initial_care_state
from app.schemas.affective import AffectiveCareState
from app.security.log_sanitize import sanitize_log_value
from app.security.media_path import (
    safe_resolve_character_media_dir,
    validate_safe_character_id,
)

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
        "SELECT world_id, location_id, category FROM lore_nodes WHERE id = ?",
        (lore_id,),
    ).fetchone()
    if (
        not row
        or row["world_id"] != world_id
        or row["location_id"] is not None
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
from app.engine.mentions import CharacterWhisper
from app.schemas.turn import (
    CampaignRecord,
    CampaignStateBundle,
    EpisodicChunkRecord,
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import (
    COMPASS_DIRECTIONS,
    COMPASS_PASSAGE_NAMES,
    OPPOSITE_COMPASS,
    CompassDirection,
    LocationEdge,
    LocationLoreNodeDraft,
    LocationNode,
    LoreNode,
    NeighborLocationView,
    WorldGlobalRules,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
    normalize_and_validate_entity_tags,
    normalize_compass_direction,
    normalize_lore_category,
    pick_available_compass_direction,
)

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
            vec = await embed_text(text)
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


class CantinaRepository:
    """Data access layer with native turn-tree and spatial graph traversal."""

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

    @staticmethod
    def _migrate_lore_schema_and_legacy_rows(conn: sqlite3.Connection) -> None:
        """Atomically upgrade legacy lore_nodes schema & sanitize pre-existing categories/tags."""
        lore_ddl_row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='lore_nodes'"
        ).fetchone()
        if not lore_ddl_row:
            return
        ddl_sql = lore_ddl_row["sql"] or ""
        if (
            "campaign_id" in ddl_sql
            and "location_id" in ddl_sql
            and "json_array_length(entity_tags_json)" in ddl_sql
            and "'artifact'" in ddl_sql
        ):
            return

        existing_rows = conn.execute("SELECT * FROM lore_nodes").fetchall()
        valid_world_ids = {
            r["id"] for r in conn.execute("SELECT id FROM worlds").fetchall()
        }
        has_locs = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='location_nodes'"
        ).fetchone()
        valid_loc_ids = (
            {r["id"] for r in conn.execute("SELECT id FROM location_nodes").fetchall()}
            if has_locs
            else set()
        )
        has_camps = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='campaigns'"
        ).fetchone()
        valid_camp_ids = (
            {r["id"] for r in conn.execute("SELECT id FROM campaigns").fetchall()}
            if has_camps
            else set()
        )
        has_vec = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vector_entries'"
        ).fetchone()
        vec_cols = (
            {
                col["name"]
                for col in conn.execute("PRAGMA table_info(vector_entries)").fetchall()
            }
            if has_vec
            else set()
        )

        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        try:
            conn.execute("BEGIN IMMEDIATE;")
            conn.execute("DROP TABLE IF EXISTS lore_nodes_migrated;")
            conn.execute(
                """
                CREATE TABLE lore_nodes_migrated (
                    id TEXT PRIMARY KEY,
                    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                    location_id TEXT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
                    campaign_id TEXT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                    title TEXT NOT NULL CHECK(length(trim(title)) >= 1),
                    category TEXT NOT NULL CHECK(
                        category IN ('history', 'culture', 'faction', 'rumor', 'artifact', 'secret')
                        AND (location_id IS NULL OR category != 'artifact')
                        AND (location_id IS NOT NULL OR category != 'secret')
                        AND (campaign_id IS NULL OR location_id IS NOT NULL)
                    ),
                    content TEXT NOT NULL CHECK(length(trim(content)) >= 1),
                    entity_tags_json TEXT NOT NULL CHECK(
                        json_valid(entity_tags_json)
                        AND json_type(entity_tags_json) = 'array'
                        AND json_array_length(entity_tags_json) >= 1
                        AND entity_tags_json NOT LIKE '%""%'
                    )
                );
                """
            )
            for r in existing_rows:
                r_keys = r.keys()
                w_id = r["world_id"]
                if w_id not in valid_world_ids:
                    continue
                loc_id = r["location_id"] if "location_id" in r_keys else None
                if loc_id and loc_id not in valid_loc_ids:
                    continue
                camp_id = r["campaign_id"] if "campaign_id" in r_keys else None
                if camp_id and (not loc_id or camp_id not in valid_camp_ids):
                    camp_id = None

                clean_title = (r["title"] or "").strip()[:120] or "World Lore"
                clean_content = (r["content"] or "").strip()[:2000] or clean_title
                clean_cat = normalize_lore_category(
                    r["category"], allow_secret=bool(loc_id), strict=False
                )
                try:
                    parsed_tags = json.loads(r["entity_tags_json"] or "[]")
                except Exception:
                    parsed_tags = []
                clean_tags = normalize_and_validate_entity_tags(
                    parsed_tags,
                    strict=False,
                    fallback_title=clean_title,
                    fallback_content=clean_content,
                )
                clean_tags_json = json.dumps(clean_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes_migrated (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["id"],
                        w_id,
                        loc_id,
                        camp_id,
                        clean_title,
                        clean_cat,
                        clean_content,
                        clean_tags_json,
                    ),
                )
                if has_vec:
                    if "keywords_json" in vec_cols:
                        conn.execute(
                            "UPDATE vector_entries SET keywords_json = ?, title = ? WHERE id = ?",
                            (clean_tags_json, clean_title, r["id"]),
                        )
                    elif "entity_tags_json" in vec_cols:
                        conn.execute(
                            "UPDATE vector_entries SET entity_tags_json = ?, title = ? WHERE id = ?",
                            (clean_tags_json, clean_title, r["id"]),
                        )

            conn.execute("DROP TABLE lore_nodes;")
            conn.execute("ALTER TABLE lore_nodes_migrated RENAME TO lore_nodes;")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON;")

    def init_db(self) -> None:
        """Execute schema.sql to initialize all tables, indexes, and idempotent migrations."""
        schema_path = Path(__file__).resolve().parent / "schema.sql"
        sql = schema_path.read_text(encoding="utf-8")
        conn = self._connect()
        try:
            # Upgrade pre-existing lore_nodes and vector_entries before executescript creates new indexes
            self._migrate_lore_schema_and_legacy_rows(conn)
            vec_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vector_entries'"
            ).fetchone()
            if vec_table_exists:
                existing_vec_cols = {
                    r["name"]
                    for r in conn.execute("PRAGMA table_info(vector_entries)").fetchall()
                }
                if "location_id" not in existing_vec_cols:
                    conn.execute("ALTER TABLE vector_entries ADD COLUMN location_id TEXT NULL")
                    conn.commit()
                if "embedding_fingerprint" not in existing_vec_cols:
                    conn.execute("ALTER TABLE vector_entries ADD COLUMN embedding_fingerprint TEXT NULL")
                    conn.commit()

            camp_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='campaigns'"
            ).fetchone()
            if camp_table_exists:
                existing_camp_cols = {
                    r["name"]
                    for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()
                }
                if "persona_id" not in existing_camp_cols:
                    conn.execute(
                        "ALTER TABLE campaigns ADD COLUMN persona_id TEXT NULL REFERENCES personas(id) ON DELETE SET NULL"
                    )
                if "persona_snapshot_json" not in existing_camp_cols:
                    conn.execute(
                        "ALTER TABLE campaigns ADD COLUMN persona_snapshot_json TEXT NULL"
                    )
                conn.commit()

            conn.executescript(sql)
            # Idempotent migration for existing databases created before pending_deletion
            world_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(worlds)").fetchall()
            }
            if "pending_deletion" not in world_cols:
                conn.execute(
                    "ALTER TABLE worlds ADD COLUMN pending_deletion INTEGER NOT NULL DEFAULT 0"
                )
            if "owner_id" not in world_cols:
                conn.execute(
                    "ALTER TABLE worlds ADD COLUMN owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id)"
            )

            char_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(characters)").fetchall()
            }
            if "pending_deletion" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN pending_deletion INTEGER NOT NULL DEFAULT 0"
                )
            if "owner_id" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE"
                )
            if "tags_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "creator" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN creator TEXT NOT NULL DEFAULT ''"
                )
            if "creator_notes" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN creator_notes TEXT NOT NULL DEFAULT ''"
                )
            if "portraits_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN portraits_json TEXT NOT NULL DEFAULT '{}'"
                )
            if "gallery_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "version" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS character_versions (
                    id TEXT PRIMARY KEY,
                    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
                    version INTEGER NOT NULL,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE (character_id, version)
                );
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_char_versions_char ON character_versions(character_id, version DESC)"
            )

            # Backfill version 1 snapshot for existing characters if missing
            unversioned_chars = conn.execute(
                """
                SELECT c.* FROM characters c
                WHERE NOT EXISTS (
                    SELECT 1 FROM character_versions cv WHERE cv.character_id = c.id
                )
                """
            ).fetchall()
            for r in unversioned_chars:
                c_id = r["id"]
                r_keys = r.keys()
                shards = json.loads(r["memory_shards_json"] if "memory_shards_json" in r_keys else "[]")
                char_data = {
                    "id": c_id,
                    "world_id": r["world_id"],
                    "name": r["name"],
                    "tagline": r["tagline"],
                    "physical_appearance": r["physical_appearance"] if "physical_appearance" in r_keys else "",
                    "core_persona": r["core_persona"],
                    "initial_message": r["initial_message"] if "initial_message" in r_keys else "",
                    "equipped": json.loads(r["equipped_json"] if "equipped_json" in r_keys else "[]"),
                    "inventory": json.loads(r["inventory_json"] if "inventory_json" in r_keys else "[]"),
                    "voice_anchors": json.loads(r["voice_anchors_json"] if "voice_anchors_json" in r_keys else "[]"),
                    "baseline_psyche": json.loads(r["baseline_psyche_json"]),
                    "memory_shards": shards,
                    "tags": json.loads(r["tags_json"]) if "tags_json" in r_keys and r["tags_json"] else [],
                    "creator": r["creator"] if "creator" in r_keys and r["creator"] else "",
                    "creator_notes": r["creator_notes"] if "creator_notes" in r_keys and r["creator_notes"] else "",
                    "version": r["version"] if "version" in r_keys and r["version"] is not None else 1,
                    "pending_deletion": bool(r["pending_deletion"]) if "pending_deletion" in r_keys else False,
                    "created_at": r["created_at"],
                }
                cver_id = f"cver_{c_id}_{char_data['version']}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO character_versions (id, character_id, version, data_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (cver_id, c_id, char_data["version"], json.dumps(char_data), r["created_at"]),
                )

            camp_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()
            }
            if "owner_id" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE"
                )
            if "prompt_preset_id" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN prompt_preset_id TEXT NULL REFERENCES prompt_presets(id) ON DELETE SET NULL"
                )
            if "persona_id" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN persona_id TEXT NULL REFERENCES personas(id) ON DELETE SET NULL"
                )
            if "persona_snapshot_json" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN persona_snapshot_json TEXT NULL"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_campaigns_persona ON campaigns(persona_id)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS personas (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL CHECK(length(trim(name)) >= 1),
                    species TEXT NOT NULL DEFAULT 'Human',
                    age TEXT NULL,
                    age_is_secret INTEGER NOT NULL DEFAULT 1,
                    sex TEXT NOT NULL DEFAULT '',
                    pronouns TEXT NOT NULL DEFAULT '',
                    persona_bio TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    build_and_height TEXT NOT NULL DEFAULT '',
                    distinctive_features_json TEXT NOT NULL DEFAULT '[]',
                    physical_appearance TEXT NOT NULL DEFAULT '',
                    equipped_json TEXT NOT NULL DEFAULT '[]',
                    inventory_json TEXT NOT NULL DEFAULT '[]',
                    lore_entries_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_personas_owner ON personas(owner_id)")

            persona_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(personas)").fetchall()
            }
            if "species" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN species TEXT NOT NULL DEFAULT 'Human'")
            if "sex" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN sex TEXT NOT NULL DEFAULT ''")
            if "pronouns" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''")
            if "persona_bio" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN persona_bio TEXT NOT NULL DEFAULT ''")
            if "tags_json" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'")
            if "build_and_height" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN build_and_height TEXT NOT NULL DEFAULT ''")
            if "distinctive_features_json" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN distinctive_features_json TEXT NOT NULL DEFAULT '[]'")

            # Purge any invalid legacy persona rows without an owner
            conn.execute("DELETE FROM personas WHERE owner_id IS NULL")

            # Ensure each existing user has their own default persona
            user_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
            ).fetchone()
            if user_table_exists:
                user_rows = conn.execute("SELECT id FROM users").fetchall()
                for u in user_rows:
                    uid = u["id"]
                    def_persona = self._ensure_default_persona_for_user_conn(conn, uid)
                    # Backfill this user's legacy campaigns without a persona
                    conn.execute(
                        """
                        UPDATE campaigns
                        SET persona_id = ?,
                            persona_snapshot_json = ?
                        WHERE owner_id = ? AND (persona_id IS NULL OR persona_snapshot_json IS NULL)
                        """,
                        (def_persona.id, def_persona.model_dump_json(), uid),
                    )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS persona_turn_states (
                    turn_id TEXT PRIMARY KEY REFERENCES turn_nodes(id) ON DELETE CASCADE,
                    equipped_json TEXT NOT NULL DEFAULT '[]',
                    inventory_json TEXT NOT NULL DEFAULT '[]'
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS prompt_presets (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    is_builtin INTEGER NOT NULL DEFAULT 0,
                    prompts_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_prompt_presets_owner ON prompt_presets(owner_id)")

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_model_settings (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    actor_profile_json TEXT NULL,
                    clerk_profile_json TEXT NULL,
                    working_memory_turns INTEGER NULL,
                    active_prompt_preset_id TEXT NULL REFERENCES prompt_presets(id) ON DELETE SET NULL,
                    delegate_cognition_to_clerk INTEGER NULL,
                    max_scene_flags INTEGER NULL,
                    agent_dispatch_mode TEXT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            ums_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(user_model_settings)").fetchall()
            }
            if "active_prompt_preset_id" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN active_prompt_preset_id TEXT NULL REFERENCES prompt_presets(id) ON DELETE SET NULL"
                )
            if "delegate_cognition_to_clerk" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN delegate_cognition_to_clerk INTEGER NULL"
                )
            if "max_scene_flags" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN max_scene_flags INTEGER NULL"
                )
            if "agent_dispatch_mode" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN agent_dispatch_mode TEXT NULL"
                )
            if "clerk_mirrors_actor" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN clerk_mirrors_actor INTEGER NULL"
                )
            if "persona_disclosure_mode" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN persona_disclosure_mode TEXT NOT NULL DEFAULT 'llm_intent'"
                )

            # Seed / ensure built-in prompt presets
            now_iso = utc_now_iso()
            for p in BUILTIN_PRESETS:
                row = conn.execute("SELECT id FROM prompt_presets WHERE id = ?", (p["id"],)).fetchone()
                if not row:
                    conn.execute(
                        """
                        INSERT INTO prompt_presets (id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at)
                        VALUES (?, NULL, ?, ?, 1, ?, ?, ?)
                        """,
                        (p["id"], p["name"], p["description"], json.dumps(p["prompts"]), now_iso, now_iso),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE prompt_presets
                        SET prompts_json = ?, description = ?, updated_at = ?
                        WHERE id = ? AND is_builtin = 1
                        """,
                        (json.dumps(p["prompts"]), p["description"], now_iso, p["id"]),
                    )
            if "physical_appearance" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN physical_appearance TEXT NOT NULL DEFAULT ''"
                )
            if "initial_message" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN initial_message TEXT NOT NULL DEFAULT ''"
                )
            if "equipped_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN equipped_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "inventory_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN inventory_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "species" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN species TEXT NOT NULL DEFAULT 'Human'"
                )
            if "sex" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN sex TEXT NOT NULL DEFAULT ''"
                )
            if "pronouns" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN pronouns TEXT NOT NULL DEFAULT ''"
                )
            if "age" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN age TEXT NOT NULL DEFAULT ''"
                )
            if "character_bio" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN character_bio TEXT NOT NULL DEFAULT ''"
                )
            if "build_and_height" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN build_and_height TEXT NOT NULL DEFAULT ''"
                )
            if "distinctive_features_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN distinctive_features_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "posture" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN posture TEXT NOT NULL DEFAULT ''"
                )
            if "mannerisms_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN mannerisms_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "modifications_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN modifications_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "visual_aesthetic" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN visual_aesthetic TEXT NOT NULL DEFAULT ''"
                )
            if "personality_traits_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN personality_traits_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "moral_code_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN moral_code_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "quirks_flaws_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN quirks_flaws_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "communication_style_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN communication_style_json TEXT NOT NULL DEFAULT '[]'"
                )
            conn.execute(
                "UPDATE characters SET character_bio = physical_appearance WHERE character_bio = '' AND physical_appearance != ''"
            )

            tn_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(turn_nodes)").fetchall()
            }
            if "cognitions_json" not in tn_cols:
                conn.execute(
                    "ALTER TABLE turn_nodes ADD COLUMN cognitions_json TEXT NULL"
                )
            if "whispers_json" not in tn_cols:
                conn.execute(
                    "ALTER TABLE turn_nodes ADD COLUMN whispers_json TEXT NULL"
                )

            ws_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(world_state_snapshots)").fetchall()
            }
            if "campaign_elapsed_minutes" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN campaign_elapsed_minutes INTEGER NOT NULL DEFAULT 0"
                )

            cs_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(character_states)").fetchall()
            }
            if "equipped_json" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN equipped_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "inventory_json" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN inventory_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "unlocked_persona_keys_json" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN unlocked_persona_keys_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "persona_knowledge_provenance_json" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN persona_knowledge_provenance_json TEXT NOT NULL DEFAULT '{}'"
                )
            if "affective_state_json" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN affective_state_json TEXT NOT NULL DEFAULT '{}'"
                )

            loc_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(location_nodes)").fetchall()
            }
            if "is_hub" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN is_hub INTEGER NOT NULL DEFAULT 0"
                )
            if "starting_message" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN starting_message TEXT NOT NULL DEFAULT ''"
                )

            edge_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(location_edges)").fetchall()
            }
            if "compass_direction" not in edge_cols:
                conn.execute(
                    "ALTER TABLE location_edges ADD COLUMN compass_direction TEXT NULL"
                )
            if "superseded_at_turn_id" not in edge_cols:
                conn.execute(
                    "ALTER TABLE location_edges ADD COLUMN superseded_at_turn_id TEXT NULL"
                )

            vec_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(vector_entries)").fetchall()
            }
            if "superseded_at_turn_id" not in vec_cols:
                conn.execute(
                    "ALTER TABLE vector_entries ADD COLUMN superseded_at_turn_id TEXT NULL"
                )

            # Backfill compass_direction for any pre-existing location_edges missing it
            missing_dir_edges = conn.execute(
                "SELECT id, from_location_id, direction_label FROM location_edges WHERE compass_direction IS NULL"
            ).fetchall()
            if missing_dir_edges:
                occupied_by_from: dict[str, set[str]] = {}
                existing_dir_edges = conn.execute(
                    "SELECT from_location_id, compass_direction FROM location_edges WHERE compass_direction IS NOT NULL"
                ).fetchall()
                for er in existing_dir_edges:
                    occupied_by_from.setdefault(er["from_location_id"], set()).add(
                        er["compass_direction"]
                    )
                for er in missing_dir_edges:
                    f_id = er["from_location_id"]
                    occ = occupied_by_from.setdefault(f_id, set())
                    inferred = normalize_compass_direction(None, er["direction_label"])
                    assigned = pick_available_compass_direction(inferred, occ)
                    occ.add(assigned)
                    conn.execute(
                        "UPDATE location_edges SET compass_direction = ? WHERE id = ?",
                        (assigned, er["id"]),
                    )

            # Migrate legacy [Worn] items from inventory_json to equipped_json
            legacy_char_rows = conn.execute(
                "SELECT id, inventory_json, equipped_json FROM characters"
            ).fetchall()
            for row in legacy_char_rows:
                inv = json.loads(row["inventory_json"] or "[]")
                eq = json.loads(row["equipped_json"] or "[]")
                new_inv = []
                new_eq = list(eq)
                modified = False
                for item in inv:
                    item_name = (
                        item.get("name", "")
                        if isinstance(item, dict)
                        else (item if isinstance(item, str) else "")
                    )
                    if isinstance(item_name, str) and re.match(
                        r"^\[(?:worn|equipped)\]\s*", item_name, re.IGNORECASE
                    ):
                        clean_item = re.sub(
                            r"^\[(?:worn|equipped)\]\s*", "", item_name, flags=re.IGNORECASE
                        ).strip()
                        if clean_item:
                            existing_names = {
                                (
                                    e.get("name", "")
                                    if isinstance(e, dict)
                                    else str(e)
                                ).strip().lower()
                                for e in new_eq
                            }
                            if clean_item.lower() not in existing_names:
                                new_eq.append(
                                    {**item, "name": clean_item}
                                    if isinstance(item, dict)
                                    else clean_item
                                )
                        modified = True
                    else:
                        new_inv.append(item)
                if modified:
                    conn.execute(
                        "UPDATE characters SET equipped_json = ?, inventory_json = ? WHERE id = ?",
                        (json.dumps(new_eq), json.dumps(new_inv), row["id"]),
                    )

            legacy_cs_rows = conn.execute(
                "SELECT turn_id, character_id, inventory_json, equipped_json FROM character_states"
            ).fetchall()
            for row in legacy_cs_rows:
                inv = json.loads(row["inventory_json"] or "[]")
                eq = json.loads(row["equipped_json"] or "[]")
                new_inv = []
                new_eq = list(eq)
                modified = False
                for item in inv:
                    item_name = (
                        item.get("name", "")
                        if isinstance(item, dict)
                        else (item if isinstance(item, str) else "")
                    )
                    if isinstance(item_name, str) and re.match(
                        r"^\[(?:worn|equipped)\]\s*", item_name, re.IGNORECASE
                    ):
                        clean_item = re.sub(
                            r"^\[(?:worn|equipped)\]\s*", "", item_name, flags=re.IGNORECASE
                        ).strip()
                        if clean_item:
                            existing_names = {
                                (
                                    e.get("name", "")
                                    if isinstance(e, dict)
                                    else str(e)
                                ).strip().lower()
                                for e in new_eq
                            }
                            if clean_item.lower() not in existing_names:
                                new_eq.append(
                                    {**item, "name": clean_item}
                                    if isinstance(item, dict)
                                    else clean_item
                                )
                        modified = True
                    else:
                        new_inv.append(item)
                if modified:
                    conn.execute(
                        "UPDATE character_states SET equipped_json = ?, inventory_json = ? WHERE turn_id = ? AND character_id = ?",
                        (json.dumps(new_eq), json.dumps(new_inv), row["turn_id"], row["character_id"]),
                    )

            # Backfill default Kira Vance physical_appearance, initial_message, equipped, and inventory if upgrading an existing DB
            kira_row = conn.execute(
                "SELECT id, physical_appearance, initial_message, equipped_json, inventory_json FROM characters WHERE id = 'char_kira_vance'"
            ).fetchone()
            if kira_row:
                default_kira_appearance = (
                    "34-year-old woman with a lean, steady build, tired yet observant hazel eyes, and silver-streaked "
                    "dark hair tied back with a stainless-steel surgical clamp. Her left forearm is a brushed-chrome "
                    "cybernetic prosthetic with micro-scalpel articulation and fine servo seams along the wrist."
                )
                default_kira_msg = (
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
                default_kira_equipped = json.dumps(
                    [
                        "Dark charcoal utility tank top",
                        "Oil-stained leather ripperdoc apron",
                        "Heavy reinforced work boots",
                    ]
                )
                default_kira_inv = json.dumps(
                    [
                        "Diagnostic medical penlight",
                        "Concealed Vespera trauma med-injector",
                    ]
                )
                if not kira_row["physical_appearance"]:
                    conn.execute(
                        "UPDATE characters SET physical_appearance = ? WHERE id = 'char_kira_vance'",
                        (default_kira_appearance,),
                    )
                if not kira_row["initial_message"]:
                    conn.execute(
                        "UPDATE characters SET initial_message = ? WHERE id = 'char_kira_vance'",
                        (default_kira_msg,),
                    )
                if not kira_row["equipped_json"] or kira_row["equipped_json"] == "[]":
                    conn.execute(
                        "UPDATE characters SET equipped_json = ? WHERE id = 'char_kira_vance'",
                        (default_kira_equipped,),
                    )
                    conn.execute(
                        "UPDATE character_states SET equipped_json = ? WHERE character_id = 'char_kira_vance' AND (equipped_json IS NULL OR equipped_json = '[]')",
                        (default_kira_equipped,),
                    )
                if not kira_row["inventory_json"] or kira_row["inventory_json"] == "[]":
                    conn.execute(
                        "UPDATE characters SET inventory_json = ? WHERE id = 'char_kira_vance'",
                        (default_kira_inv,),
                    )
                    conn.execute(
                        "UPDATE character_states SET inventory_json = ? WHERE character_id = 'char_kira_vance' AND (inventory_json IS NULL OR inventory_json = '[]')",
                        (default_kira_inv,),
                    )

            # Backfill any other pre-existing characters missing physical_appearance or initial_message
            other_rows = conn.execute(
                "SELECT id, name, tagline, physical_appearance, initial_message FROM characters WHERE physical_appearance = '' OR initial_message = ''"
            ).fetchall()
            for r in other_rows:
                new_app = r["physical_appearance"] or (
                    f"{r['name']} has an observant, grounded physical presence shaped by their background ({r['tagline']})."
                )
                new_msg = r["initial_message"] or (
                    f"*{r['name']} stands inside {{location_name}}. {{location_description}}*\n\n"
                    f"\"You're late,\" *{r['name']} says quietly, eyes scanning the room.*"
                )
                conn.execute(
                    "UPDATE characters SET physical_appearance = ?, initial_message = ? WHERE id = ?",
                    (new_app, new_msg, r["id"]),
                )

            # Backfill campaign_characters for any existing campaigns & turn character states
            conn.execute(
                """
                INSERT OR IGNORE INTO campaign_characters (campaign_id, character_id, joined_at_turn_id, created_at)
                SELECT id, character_id, NULL, created_at FROM campaigns
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO campaign_characters (campaign_id, character_id, joined_at_turn_id, created_at)
                SELECT DISTINCT t.campaign_id, cs.character_id, t.id, t.created_at
                FROM character_states cs
                JOIN turn_nodes t ON t.id = cs.turn_id
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS staged_character_ownership (
                    character_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_staged_char_user ON staged_character_ownership(user_id)"
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS webauthn_challenges (
                    challenge_id TEXT PRIMARY KEY,
                    challenge_bytes BLOB NOT NULL,
                    rp_id TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    user_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE,
                    friendly_name TEXT NOT NULL DEFAULT '',
                    replace_credential_id TEXT NULL,
                    created_at_epoch REAL NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_epoch ON webauthn_challenges(created_at_epoch)"
            )
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Users, Passkeys & Sessions (Multi-Tenancy & RBAC)
    # ------------------------------------------------------------------

    def count_users(self) -> int:
        conn = self._connect()
        try:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
            return int(row["cnt"]) if row else 0
        finally:
            conn.close()

    def count_admin_users(self) -> int:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'"
            ).fetchone()
            return int(row["cnt"]) if row else 0
        finally:
            conn.close()

    def is_single_user_passwordless_mode(self) -> bool:
        """Return True if exactly 1 user exists, is an admin, and has no password set."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, role, password_hash FROM users"
            ).fetchall()
            if len(rows) != 1:
                return False
            only_user = rows[0]
            return only_user["role"] == "admin" and not only_user["password_hash"]
        finally:
            conn.close()

    def get_passwordless_admin(self) -> UserProfile | None:
        """Return the single passwordless admin UserProfile if single-user mode is active."""
        conn = self._connect()
        try:
            rows = conn.execute("SELECT id, role, password_hash FROM users").fetchall()
            if len(rows) != 1:
                return None
            only_user = rows[0]
            if only_user["role"] == "admin" and not only_user["password_hash"]:
                return self.get_user_by_id(only_user["id"])
            return None
        finally:
            conn.close()

    def create_user(
        self,
        *,
        username: str,
        display_name: str | None = None,
        password_hash: str | None = None,
        role: UserRole = "user",
        user_id: str | None = None,
    ) -> UserProfile:
        clean_username = username.strip()
        if not clean_username:
            raise ValueError("Username cannot be empty")
        clean_display = (display_name or clean_username).strip() or clean_username
        u_id = user_id or f"user_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()

        conn = self._connect()
        try:
            existing = conn.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                (clean_username,),
            ).fetchone()
            if existing:
                raise ValueError(f"Username '{clean_username}' is already taken")

            conn.execute(
                """
                INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (u_id, clean_username, clean_display, password_hash, role, now, now),
            )
            self._ensure_default_persona_for_user_conn(conn, u_id)
            conn.commit()
        finally:
            conn.close()

        return self.get_user_by_id(u_id)

    def get_user_by_id(self, user_id: str) -> UserProfile:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                raise KeyError(f"User '{user_id}' not found")
            pk_rows = conn.execute(
                "SELECT * FROM user_passkeys WHERE user_id = ? ORDER BY created_at ASC",
                (user_id,),
            ).fetchall()
        finally:
            conn.close()

        passkeys = [
            PasskeyInfo(
                id=pk["id"],
                friendly_name=pk["friendly_name"],
                transports=json.loads(pk["transports_json"] or "[]"),
                aaguid=pk["aaguid"] or "",
                created_at=pk["created_at"],
                last_used_at=pk["last_used_at"],
            )
            for pk in pk_rows
        ]
        role_val: UserRole = "admin" if row["role"] == "admin" else "user"
        return UserProfile(
            id=row["id"],
            username=row["username"],
            display_name=row["display_name"],
            role=role_val,
            has_password=bool(row["password_hash"]),
            passkeys=passkeys,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def get_user_by_username(self, username: str) -> UserProfile:
        clean = username.strip()
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
                (clean,),
            ).fetchone()
            if not row:
                raise KeyError(f"User '{clean}' not found")
            user_id = row["id"]
        finally:
            conn.close()
        return self.get_user_by_id(user_id)

    def get_user_password_hash(self, user_id: str) -> str | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT password_hash FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if not row:
                raise KeyError(f"User '{user_id}' not found")
            return row["password_hash"]
        finally:
            conn.close()

    def list_users(self, search_query: str | None = None) -> list[UserProfile]:
        conn = self._connect()
        try:
            if search_query and search_query.strip():
                q = f"%{search_query.strip()}%"
                rows = conn.execute(
                    """
                    SELECT id FROM users
                    WHERE username LIKE ? OR display_name LIKE ?
                    ORDER BY created_at ASC
                    """,
                    (q, q),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id FROM users ORDER BY created_at ASC"
                ).fetchall()
        finally:
            conn.close()
        return [self.get_user_by_id(r["id"]) for r in rows]

    def update_user_display_name(self, user_id: str, display_name: str) -> UserProfile:
        clean_name = display_name.strip()
        if not clean_name:
            raise ValueError("Display name cannot be empty")
        now = utc_now_iso()
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (clean_name, now, user_id),
            )
            if cur.rowcount == 0:
                raise KeyError(f"User '{user_id}' not found")
            conn.commit()
        finally:
            conn.close()
        return self.get_user_by_id(user_id)

    def update_user_username(self, user_id: str, new_username: str) -> UserProfile:
        clean_username = new_username.strip()
        if not clean_username:
            raise ValueError("Username cannot be empty")
        now = utc_now_iso()
        conn = self._connect()
        try:
            existing = conn.execute(
                "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?",
                (clean_username, user_id),
            ).fetchone()
            if existing:
                raise ValueError(f"Username '{clean_username}' is already taken")

            cur = conn.execute(
                "UPDATE users SET username = ?, updated_at = ? WHERE id = ?",
                (clean_username, now, user_id),
            )
            if cur.rowcount == 0:
                raise KeyError(f"User '{user_id}' not found")
            conn.commit()
        finally:
            conn.close()
        return self.get_user_by_id(user_id)

    def update_user_password_hash(
        self, user_id: str, password_hash: str | None
    ) -> UserProfile:
        now = utc_now_iso()
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT role FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if not row:
                raise KeyError(f"User '{user_id}' not found")

            if password_hash is None:
                if row["role"] != "admin":
                    raise ValueError("Standard user accounts cannot have a blank password")
                cnt_row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
                total_users = int(cnt_row["cnt"]) if cnt_row else 0
                if total_users > 1:
                    raise ValueError(
                        "Admin accounts cannot have a blank password while other users exist in the system"
                    )

            conn.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (password_hash, now, user_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_user_by_id(user_id)

    def claim_unowned_entities(self, user_id: str) -> None:
        """Assign any pre-existing worlds, characters, and campaigns with owner_id IS NULL to user_id."""
        conn = self._connect()
        try:
            def_persona = self._ensure_default_persona_for_user_conn(conn, user_id)
            conn.execute(
                "UPDATE worlds SET owner_id = ? WHERE owner_id IS NULL",
                (user_id,),
            )
            conn.execute(
                "UPDATE characters SET owner_id = ? WHERE owner_id IS NULL",
                (user_id,),
            )
            conn.execute(
                "UPDATE campaigns SET owner_id = ? WHERE owner_id IS NULL",
                (user_id,),
            )
            conn.execute(
                "UPDATE personas SET owner_id = ? WHERE owner_id IS NULL",
                (user_id,),
            )
            conn.execute(
                """
                UPDATE campaigns
                SET persona_id = ?,
                    persona_snapshot_json = ?
                WHERE owner_id = ? AND (persona_id IS NULL OR persona_snapshot_json IS NULL)
                """,
                (def_persona.id, def_persona.model_dump_json(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    def reset_user_data(self, user_id: str) -> None:
        """Permanently delete all user-owned data: campaigns, characters, and worlds (plus vector store entries and spatial graph)."""
        conn = self._connect()
        try:
            # 1. Delete user campaigns and their turn-improvised nodes/edges/vectors
            camp_rows = conn.execute(
                "SELECT id FROM campaigns WHERE owner_id = ?", (user_id,)
            ).fetchall()
            for r in camp_rows:
                c_id = r["id"]
                conn.execute(
                    "DELETE FROM vector_entries WHERE campaign_id = ?", (c_id,)
                )
                conn.execute(
                    """
                    DELETE FROM location_edges
                    WHERE created_at_turn_id IN (
                        SELECT id FROM turn_nodes WHERE campaign_id = ?
                    )
                    """,
                    (c_id,),
                )
                conn.execute(
                    """
                    DELETE FROM location_nodes
                    WHERE created_at_turn_id IN (
                        SELECT id FROM turn_nodes WHERE campaign_id = ?
                    )
                    """,
                    (c_id,),
                )
                conn.execute("DELETE FROM campaigns WHERE id = ?", (c_id,))

            # 2. Delete user characters, associated shard vectors, and disk media
            char_rows = conn.execute(
                "SELECT id FROM characters WHERE owner_id = ?", (user_id,)
            ).fetchall()
            for cr in char_rows:
                self._delete_character_media(cr["id"])

            conn.execute(
                """
                DELETE FROM vector_entries
                WHERE character_id IN (SELECT id FROM characters WHERE owner_id = ?)
                """,
                (user_id,),
            )
            conn.execute(
                """
                DELETE FROM campaign_characters
                WHERE character_id IN (SELECT id FROM characters WHERE owner_id = ?)
                """,
                (user_id,),
            )
            conn.execute(
                """
                DELETE FROM character_states
                WHERE character_id IN (SELECT id FROM characters WHERE owner_id = ?)
                """,
                (user_id,),
            )
            conn.execute("DELETE FROM characters WHERE owner_id = ?", (user_id,))

            # 3. Delete user worlds and associated lore vectors, nodes, and edges
            conn.execute(
                """
                DELETE FROM vector_entries
                WHERE world_id IN (SELECT id FROM worlds WHERE owner_id = ?)
                """,
                (user_id,),
            )
            world_rows = conn.execute(
                "SELECT id FROM worlds WHERE owner_id = ?", (user_id,)
            ).fetchall()
            for w in world_rows:
                w_id = w["id"]
                conn.execute("DELETE FROM location_edges WHERE world_id = ?", (w_id,))
                conn.execute("DELETE FROM location_nodes WHERE world_id = ?", (w_id,))
                conn.execute("DELETE FROM lore_nodes WHERE world_id = ?", (w_id,))
                conn.execute("DELETE FROM worlds WHERE id = ?", (w_id,))

            # 4. Delete user private notes and personas
            conn.execute("DELETE FROM user_notes WHERE owner_id = ?", (user_id,))
            conn.execute("DELETE FROM personas WHERE owner_id = ?", (user_id,))

            conn.commit()
        finally:
            conn.close()

    def delete_user(self, user_id: str) -> None:
        """Permanently delete a user account, credentials, passkeys, sessions, and all their user data."""
        # Ensure user exists (raises KeyError if not found)
        self.get_user_by_id(user_id)
        # 1. Wipe all user characters, worlds, campaigns, notes, and media
        self.reset_user_data(user_id)
        # 2. Remove prompt presets, sessions, passkeys, user model overrides, and user account record
        conn = self._connect()
        try:
            conn.execute("DELETE FROM prompt_presets WHERE owner_id = ?", (user_id,))
            conn.execute("DELETE FROM providers WHERE scope = 'user' AND owner_id = ?", (user_id,))
            conn.execute("DELETE FROM user_model_settings WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM user_passkeys WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    def get_user_model_settings(self, user_id: str) -> UserModelSettingsPayload | None:
        """Fetch per-user model settings overrides if present."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT actor_profile_json, clerk_profile_json, working_memory_turns, active_prompt_preset_id, delegate_cognition_to_clerk, max_scene_flags, agent_dispatch_mode, persona_disclosure_mode, clerk_mirrors_actor FROM user_model_settings WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if not row:
                return None
            actor = (
                ModelProfile.model_validate_json(row["actor_profile_json"])
                if row["actor_profile_json"]
                else None
            )
            clerk = (
                ModelProfile.model_validate_json(row["clerk_profile_json"])
                if row["clerk_profile_json"]
                else None
            )
            del_cog = (
                bool(row["delegate_cognition_to_clerk"])
                if row["delegate_cognition_to_clerk"] is not None
                else None
            )
            raw_dispatch = (
                row["agent_dispatch_mode"]
                if "agent_dispatch_mode" in row.keys()
                else None
            )
            dispatch_mode = (
                raw_dispatch if raw_dispatch in ("sequential", "parallel") else None
            )
            raw_pdm = (
                row["persona_disclosure_mode"]
                if "persona_disclosure_mode" in row.keys()
                else None
            )
            pdm = raw_pdm if raw_pdm in ("llm_intent", "token_matching", "hybrid") else "llm_intent"
            return UserModelSettingsPayload(
                actor_profile=actor,
                clerk_profile=clerk,
                working_memory_turns=row["working_memory_turns"],
                active_prompt_preset_id=row["active_prompt_preset_id"],
                delegate_cognition_to_clerk=del_cog,
                max_scene_flags=row["max_scene_flags"],
                agent_dispatch_mode=dispatch_mode,
                persona_disclosure_mode=pdm,
                clerk_mirrors_actor=(
                    bool(row["clerk_mirrors_actor"]) if row["clerk_mirrors_actor"] is not None else None
                ),
            )
        finally:
            conn.close()

    def save_user_model_settings(
        self, user_id: str, payload: UserModelSettingsPayload
    ) -> UserModelSettingsPayload:
        """Upsert per-user model settings overrides."""
        conn = self._connect()
        try:
            now = datetime.now(timezone.utc).isoformat()
            actor_json = (
                payload.actor_profile.model_dump_json()
                if payload.actor_profile
                else None
            )
            clerk_json = (
                payload.clerk_profile.model_dump_json()
                if payload.clerk_profile
                else None
            )
            del_cog_val = (
                1 if payload.delegate_cognition_to_clerk is True else (
                    0 if payload.delegate_cognition_to_clerk is False else None
                )
            )
            pdm_val = payload.persona_disclosure_mode or "llm_intent"
            mirror_val = (
                None if payload.clerk_mirrors_actor is None else (1 if payload.clerk_mirrors_actor else 0)
            )
            conn.execute(
                """
                INSERT INTO user_model_settings (user_id, actor_profile_json, clerk_profile_json, working_memory_turns, active_prompt_preset_id, delegate_cognition_to_clerk, max_scene_flags, agent_dispatch_mode, persona_disclosure_mode, clerk_mirrors_actor, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    actor_profile_json = excluded.actor_profile_json,
                    clerk_profile_json = excluded.clerk_profile_json,
                    working_memory_turns = excluded.working_memory_turns,
                    active_prompt_preset_id = excluded.active_prompt_preset_id,
                    delegate_cognition_to_clerk = excluded.delegate_cognition_to_clerk,
                    max_scene_flags = excluded.max_scene_flags,
                    agent_dispatch_mode = excluded.agent_dispatch_mode,
                    persona_disclosure_mode = excluded.persona_disclosure_mode,
                    clerk_mirrors_actor = excluded.clerk_mirrors_actor,
                    updated_at = excluded.updated_at
                """,
                (user_id, actor_json, clerk_json, payload.working_memory_turns, payload.active_prompt_preset_id, del_cog_val, payload.max_scene_flags, payload.agent_dispatch_mode, pdm_val, mirror_val, now),
            )
            conn.commit()
            return payload
        finally:
            conn.close()

    def delete_user_model_settings(self, user_id: str) -> None:
        """Remove per-user model settings overrides, reverting back to global defaults."""
        conn = self._connect()
        try:
            conn.execute("DELETE FROM user_model_settings WHERE user_id = ?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    def add_passkey(
        self,
        *,
        credential_id: str,
        user_id: str,
        friendly_name: str,
        public_key: bytes,
        sign_count: int = 0,
        transports: list[str] | None = None,
        aaguid: str = "",
        replace_credential_id: str | None = None,
    ) -> PasskeyInfo:
        now = utc_now_iso()
        clean_name = friendly_name.strip() or "Passkey"
        transports_json = json.dumps(transports or [])
        conn = self._connect()
        try:
            if replace_credential_id:
                conn.execute(
                    "DELETE FROM user_passkeys WHERE id = ? AND user_id = ?",
                    (replace_credential_id, user_id),
                )
            conn.execute(
                """
                INSERT OR REPLACE INTO user_passkeys (
                    id, user_id, friendly_name, public_key, sign_count,
                    transports_json, aaguid, created_at, last_used_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    credential_id,
                    user_id,
                    clean_name,
                    public_key,
                    sign_count,
                    transports_json,
                    aaguid,
                    now,
                    now,
                ),
            )
            conn.execute(
                "UPDATE users SET updated_at = ? WHERE id = ?",
                (now, user_id),
            )
            conn.commit()
        finally:
            conn.close()

        return PasskeyInfo(
            id=credential_id,
            friendly_name=clean_name,
            transports=transports or [],
            aaguid=aaguid,
            created_at=now,
            last_used_at=now,
        )

    def get_passkey_record(
        self, credential_id: str
    ) -> tuple[PasskeyInfo, str, bytes, int]:
        """Return (PasskeyInfo, user_id, public_key_bytes, sign_count) for credential_id."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM user_passkeys WHERE id = ?",
                (credential_id,),
            ).fetchone()
            if not row:
                raise KeyError(f"Passkey '{credential_id}' not found")
        finally:
            conn.close()

        info = PasskeyInfo(
            id=row["id"],
            friendly_name=row["friendly_name"],
            transports=json.loads(row["transports_json"] or "[]"),
            aaguid=row["aaguid"] or "",
            created_at=row["created_at"],
            last_used_at=row["last_used_at"],
        )
        return info, row["user_id"], bytes(row["public_key"]), int(row["sign_count"])

    def update_passkey_sign_count(
        self, credential_id: str, new_sign_count: int
    ) -> None:
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE user_passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?",
                (new_sign_count, now, credential_id),
            )
            conn.commit()
        finally:
            conn.close()

    def delete_passkey(self, user_id: str, credential_id: str) -> None:
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM user_passkeys WHERE id = ? AND user_id = ?",
                (credential_id, user_id),
            )
            if cur.rowcount == 0:
                raise KeyError(f"Passkey '{credential_id}' not found")
            conn.commit()
        finally:
            conn.close()

    def save_webauthn_challenge(
        self,
        *,
        challenge_id: str,
        challenge_bytes: bytes,
        rp_id: str,
        origin: str,
        user_id: str | None = None,
        friendly_name: str = "",
        replace_credential_id: str | None = None,
        created_at_epoch: float | None = None,
        ttl_seconds: int = WEBAUTHN_CHALLENGE_TTL_SECONDS,
    ) -> None:
        """Persist a WebAuthn challenge into SQLite so any worker can verify it."""
        now_epoch = created_at_epoch if created_at_epoch is not None else datetime.now(timezone.utc).timestamp()
        conn = self._connect()
        try:
            conn.execute(
                "DELETE FROM webauthn_challenges WHERE created_at_epoch < ?",
                (now_epoch - ttl_seconds,),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO webauthn_challenges
                (challenge_id, challenge_bytes, rp_id, origin, user_id, friendly_name, replace_credential_id, created_at_epoch)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    challenge_id,
                    challenge_bytes,
                    rp_id,
                    origin,
                    user_id,
                    friendly_name,
                    replace_credential_id,
                    now_epoch,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def pop_webauthn_challenge(
        self, challenge_id: str, ttl_seconds: int = WEBAUTHN_CHALLENGE_TTL_SECONDS
    ) -> dict[str, Any] | None:
        """Atomically pop (single-use) a non-expired WebAuthn challenge from SQLite."""
        now_epoch = datetime.now(timezone.utc).timestamp()
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "DELETE FROM webauthn_challenges WHERE created_at_epoch < ?",
                (now_epoch - ttl_seconds,),
            )
            row = conn.execute(
                "SELECT * FROM webauthn_challenges WHERE challenge_id = ?",
                (challenge_id,),
            ).fetchone()
            if row:
                conn.execute(
                    "DELETE FROM webauthn_challenges WHERE challenge_id = ?",
                    (challenge_id,),
                )
            conn.commit()
            return dict(row) if row else None
        finally:
            conn.close()

    def create_session(
        self,
        *,
        session_id_hash: str,
        user_id: str,
        user_agent: str = "",
        ip_address: str = "",
    ) -> None:
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        expires_iso = (now_dt + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO user_sessions (
                    id, user_id, user_agent, ip_address, created_at, last_active_at, expires_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id_hash,
                    user_id,
                    user_agent[:255],
                    ip_address[:64],
                    now_iso,
                    now_iso,
                    expires_iso,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_and_touch_session(
        self,
        session_id_hash: str,
        idle_timeout_seconds: int = 86400,
    ) -> UserProfile | None:
        """Validate session against 24h sliding inactivity window and update last_active_at."""
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM user_sessions WHERE id = ?",
                (session_id_hash,),
            ).fetchone()
            if not row:
                return None

            last_active_str = row["last_active_at"]
            try:
                last_active_dt = datetime.strptime(
                    last_active_str, "%Y-%m-%dT%H:%M:%SZ"
                ).replace(tzinfo=timezone.utc)
            except ValueError:
                last_active_dt = now_dt

            idle_seconds = (now_dt - last_active_dt).total_seconds()
            if idle_seconds > idle_timeout_seconds:
                conn.execute(
                    "DELETE FROM user_sessions WHERE id = ?", (session_id_hash,)
                )
                conn.commit()
                return None

            conn.execute(
                "UPDATE user_sessions SET last_active_at = ? WHERE id = ?",
                (now_iso, session_id_hash),
            )
            conn.commit()
            user_id = row["user_id"]
        finally:
            conn.close()

        try:
            return self.get_user_by_id(user_id)
        except KeyError:
            return None

    def delete_session(self, session_id_hash: str) -> None:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM user_sessions WHERE id = ?", (session_id_hash,))
            conn.commit()
        finally:
            conn.close()

    def delete_all_user_sessions(
        self, user_id: str, except_session_hash: str | None = None
    ) -> None:
        conn = self._connect()
        try:
            if except_session_hash:
                conn.execute(
                    "DELETE FROM user_sessions WHERE user_id = ? AND id != ?",
                    (user_id, except_session_hash),
                )
            else:
                conn.execute(
                    "DELETE FROM user_sessions WHERE user_id = ?",
                    (user_id,),
                )
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Worlds & Spatial Graph
    # ------------------------------------------------------------------

    def _resolve_location_lore_map(
        self,
        conn: sqlite3.Connection,
        location_ids: list[str] | set[str],
        campaign_id: str | None = None,
    ) -> dict[str, list[LoreNode]]:
        """Hydrate per-location LoreNodes with Copy-on-Write campaign override precedence."""
        loc_list = [lid for lid in location_ids if lid]
        if not loc_list:
            return {}

        placeholders = ",".join("?" for _ in loc_list)
        overridden_loc_ids: set[str] = set()
        if campaign_id:
            ov_rows = conn.execute(
                f"""
                SELECT location_id FROM campaign_location_lore_overrides
                WHERE campaign_id = ? AND location_id IN ({placeholders})
                """,
                [campaign_id, *loc_list],
            ).fetchall()
            overridden_loc_ids = {r["location_id"] for r in ov_rows}
            lore_rows = conn.execute(
                f"""
                SELECT * FROM lore_nodes
                WHERE location_id IN ({placeholders})
                  AND (campaign_id IS NULL OR campaign_id = ?)
                ORDER BY rowid ASC
                """,
                [*loc_list, campaign_id],
            ).fetchall()
        else:
            lore_rows = conn.execute(
                f"""
                SELECT * FROM lore_nodes
                WHERE location_id IN ({placeholders})
                  AND campaign_id IS NULL
                ORDER BY rowid ASC
                """,
                loc_list,
            ).fetchall()

        result: dict[str, list[LoreNode]] = {lid: [] for lid in loc_list}
        for r in lore_rows:
            lid = r["location_id"]
            if not lid or lid not in result:
                continue
            r_camp = r["campaign_id"]
            if lid in overridden_loc_ids:
                if r_camp == campaign_id:
                    result[lid].append(self._row_to_lore_node(r))
            else:
                if r_camp is None:
                    result[lid].append(self._row_to_lore_node(r))
        return result

    def create_world_from_draft(
        self,
        draft: WorldWizardDraft,
        world_id: str | None = None,
        lore_embeddings: list[np.ndarray] | None = None,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> WorldRecord:
        """Persist a WorldWizardDraft (rules, initial locations, edges, lore) and index lore vectors."""
        w_id = world_id or f"world_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (w_id, owner_id, draft.name, draft.global_rules.model_dump_json(), now),
            )

            has_start = any(loc.is_starting_location for loc in draft.locations)
            key_to_loc_id: dict[str, str] = {}
            for idx, loc in enumerate(draft.locations):
                loc_id = f"loc_{uuid.uuid4().hex[:10]}"
                key_to_loc_id[loc.key] = loc_id
                is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                is_hub = 1 if getattr(loc, "is_hub", False) else 0
                starting_msg = getattr(loc, "starting_message", "") or ""
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub, starting_message
                    )
                    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        loc_id,
                        w_id,
                        loc.name,
                        loc.summary,
                        loc.description,
                        json.dumps(loc.environmental_tags),
                        is_start,
                        is_hub,
                        starting_msg,
                    ),
                )
                for loc_lore in loc.lore_nodes:
                    loc_lore_id = f"lore_{uuid.uuid4().hex[:10]}"
                    loc_tags_json = json.dumps(loc_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            loc_lore_id,
                            w_id,
                            loc_id,
                            loc_lore.title,
                            loc_lore.category,
                            loc_lore.content,
                            loc_tags_json,
                        ),
                    )
                    if loc_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            loc.name, loc_lore.title, loc_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        pre_loc_vec = (
                            precomputed_embeddings.get((vec_title, loc_lore.content, vec_kw_json))
                            if precomputed_embeddings
                            else None
                        )
                        self.vector_store.upsert_entry(
                            entry_id=loc_lore_id,
                            source_type="location_lore",
                            world_id=w_id,
                            location_id=loc_id,
                            title=vec_title,
                            content=loc_lore.content,
                            keywords=vec_keywords,
                            embedding=pre_loc_vec,
                            conn=conn,
                        )

            occupied_from: dict[str, set[str]] = {}
            for edge in draft.edges:
                from_id = key_to_loc_id.get(edge.from_key)
                to_id = key_to_loc_id.get(edge.to_key)
                if not from_id or not to_id:
                    continue
                edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                from_occ = occupied_from.setdefault(from_id, set())
                preferred_dir = normalize_compass_direction(
                    edge.compass_direction, edge.direction_label
                )
                fwd_dir = pick_available_compass_direction(preferred_dir, from_occ)
                from_occ.add(fwd_dir)
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        edge_id,
                        w_id,
                        from_id,
                        to_id,
                        edge.direction_label,
                        fwd_dir,
                        edge.travel_minutes,
                        1 if edge.is_locked_or_hidden else 0,
                    ),
                )
                if edge.bidirectional:
                    rev_id = f"edge_{uuid.uuid4().hex[:10]}"
                    to_occ = occupied_from.setdefault(to_id, set())
                    rev_dir = pick_available_compass_direction(
                        OPPOSITE_COMPASS[fwd_dir], to_occ
                    )
                    to_occ.add(rev_dir)
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                        """,
                        (
                            rev_id,
                            w_id,
                            to_id,
                            from_id,
                            edge.reverse_direction_label or f"Return to {edge.from_key}",
                            rev_dir,
                            edge.travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                        ),
                    )

            for idx, lore in enumerate(draft.lore_nodes):
                lore_id = f"lore_{uuid.uuid4().hex[:10]}"
                tags_json = json.dumps(lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (
                        lore_id,
                        w_id,
                        lore.title,
                        lore.category,
                        lore.content,
                        tags_json,
                    ),
                )
                precomputed = (
                    lore_embeddings[idx]
                    if lore_embeddings is not None and idx < len(lore_embeddings)
                    else (
                        precomputed_embeddings.get((lore.title, lore.content, tags_json))
                        if precomputed_embeddings
                        else None
                    )
                )
                self.vector_store.upsert_entry(
                    entry_id=lore_id,
                    source_type="lore",
                    world_id=w_id,
                    title=lore.title,
                    content=lore.content,
                    keywords=lore.entity_tags,
                    embedding=precomputed,
                    conn=conn,
                )

            conn.commit()
        finally:
            conn.close()

        return self.get_world(w_id)

    async def acreate_world_from_draft(
        self,
        draft: WorldWizardDraft,
        world_id: str | None = None,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Asynchronously pre-compute world & non-secret location lore embeddings and persist WorldWizardDraft."""
        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for lore in draft.lore_nodes:
            tags_json = json.dumps(lore.entity_tags)
            items_to_embed.append(
                (
                    (lore.title, lore.content, tags_json),
                    combine_entry_text(lore.title, lore.content, lore.entity_tags),
                )
            )
        for loc in draft.locations:
            for loc_lore in loc.lore_nodes:
                if loc_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    loc.name, loc_lore.title, loc_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, loc_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, loc_lore.content, vec_keywords),
                    )
                )
        precomputed = await _compute_missing_embeddings(items_to_embed, {})
        return self.create_world_from_draft(
            draft,
            world_id=world_id,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

    def list_worlds(
        self,
        include_pending_deletion: bool = False,
        owner_id: str | None = None,
    ) -> list[WorldRecord]:
        conn = self._connect()
        try:
            if owner_id is not None:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE owner_id = ? ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE owner_id = ? AND pending_deletion = 0 ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
            else:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM worlds ORDER BY created_at DESC"
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE pending_deletion = 0 ORDER BY created_at DESC"
                    ).fetchall()
        finally:
            conn.close()
        return [self.get_world(r["id"], base_only=True) for r in rows]

    def get_world(
        self,
        world_id: str,
        valid_turn_ids: set[str] | None = None,
        base_only: bool = False,
        owner_id: str | None = None,
        campaign_id: str | None = None,
    ) -> WorldRecord:
        conn = self._connect()
        try:
            if owner_id is not None:
                w_row = conn.execute(
                    "SELECT * FROM worlds WHERE id = ? AND owner_id = ?",
                    (world_id, owner_id),
                ).fetchone()
            else:
                w_row = conn.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone()
            if not w_row:
                raise KeyError(f"World '{world_id}' not found")

            loc_rows = conn.execute(
                "SELECT * FROM location_nodes WHERE world_id = ?", (world_id,)
            ).fetchall()
            edge_rows = conn.execute(
                "SELECT * FROM location_edges WHERE world_id = ?", (world_id,)
            ).fetchall()
            lore_rows = conn.execute(
                """
                SELECT * FROM lore_nodes
                WHERE world_id = ? AND location_id IS NULL AND campaign_id IS NULL
                ORDER BY rowid ASC
                """,
                (world_id,),
            ).fetchall()

            locations: list[LocationNode] = []
            for r in loc_rows:
                c_turn = r["created_at_turn_id"]
                if base_only and c_turn is not None:
                    continue
                if valid_turn_ids is not None and c_turn is not None and c_turn not in valid_turn_ids:
                    continue
                locations.append(self._row_to_location(r))

            loc_lore_map = self._resolve_location_lore_map(
                conn,
                [loc.id for loc in locations],
                campaign_id=None if base_only else campaign_id,
            )
            for loc in locations:
                loc.lore_nodes = loc_lore_map.get(loc.id, [])
        finally:
            conn.close()

        visible_loc_ids = {loc.id for loc in locations}
        edges: list[LocationEdge] = []
        for r in edge_rows:
            c_turn = r["created_at_turn_id"]
            sup_turn = r["superseded_at_turn_id"] if "superseded_at_turn_id" in r.keys() else None
            if base_only and c_turn is not None:
                continue
            if valid_turn_ids is not None:
                if c_turn is not None and c_turn not in valid_turn_ids:
                    continue
                if sup_turn is not None and sup_turn in valid_turn_ids:
                    continue
            elif not base_only and sup_turn is not None:
                continue
            if r["from_location_id"] not in visible_loc_ids or r["to_location_id"] not in visible_loc_ids:
                continue
            edges.append(self._row_to_edge(r))

        lore_nodes = [self._row_to_lore_node(r) for r in lore_rows]

        return WorldRecord(
            id=w_row["id"],
            name=w_row["name"],
            global_rules=WorldGlobalRules.model_validate_json(w_row["global_rules_json"]),
            pending_deletion=bool(w_row["pending_deletion"]) if "pending_deletion" in w_row.keys() else False,
            created_at=w_row["created_at"],
            locations=locations,
            edges=edges,
            lore_nodes=lore_nodes,
        )

    def update_world(
        self,
        world_id: str,
        payload: WorldUpdatePayload,
        lore_embeddings: dict[int, np.ndarray] | None = None,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> WorldRecord:
        """Update a world in-place if unused, or silently fork a new Copy-on-Write version if used by campaigns."""
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        now = utc_now_iso()
        conn = self._connect()
        try:
            w_owner_row = conn.execute(
                "SELECT owner_id FROM worlds WHERE id = ?", (world_id,)
            ).fetchone()
            effective_owner_id = (
                w_owner_row["owner_id"]
                if w_owner_row and "owner_id" in w_owner_row.keys()
                else owner_id
            )

            usage_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0

            # Cache existing world & location lore vector blobs so unchanged lore nodes don't re-run embeddings
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND source_type IN ('lore', 'location_lore')
                  AND (campaign_id IS NULL OR campaign_id = '')
                """,
                (world_id,),
            ).fetchall()
            existing_lore_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }

            base_locations = [loc for loc in payload.locations if not loc.created_at_turn_id]
            if not base_locations:
                base_locations = orig.locations
            base_edges = [edge for edge in payload.edges if not edge.created_at_turn_id]

            has_start = any(loc.is_starting_location for loc in base_locations)

            if campaigns_using == 0:
                # In-place update (zero active campaigns reference this world)
                target_world_id = world_id
                conn.execute(
                    "UPDATE worlds SET name = ?, global_rules_json = ? WHERE id = ?",
                    (payload.name, payload.global_rules.model_dump_json(), target_world_id),
                )
                conn.execute(
                    "DELETE FROM location_edges WHERE world_id = ? AND created_at_turn_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM location_nodes WHERE world_id = ? AND created_at_turn_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM lore_nodes WHERE world_id = ? AND campaign_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    """
                    DELETE FROM vector_entries
                    WHERE world_id = ?
                      AND source_type IN ('lore', 'location_lore')
                      AND (campaign_id IS NULL OR campaign_id = '')
                    """,
                    (target_world_id,),
                )

                loc_id_map: dict[str, str] = {}
                for idx, loc in enumerate(base_locations):
                    new_loc_id = loc.id if loc.id and not loc.id.startswith("new_") else f"loc_{uuid.uuid4().hex[:10]}"
                    loc_id_map[loc.id] = new_loc_id
                    is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                    is_hub = 1 if getattr(loc, "is_hub", False) else 0
                    starting_msg = getattr(loc, "starting_message", "") or ""
                    conn.execute(
                        """
                        INSERT INTO location_nodes (
                            id, world_id, created_at_turn_id, name, summary,
                            description, environmental_tags_json, is_starting_location, is_hub, starting_message
                        )
                        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_loc_id,
                            target_world_id,
                            loc.name,
                            loc.summary,
                            loc.description,
                            json.dumps(loc.environmental_tags),
                            is_start,
                            is_hub,
                            starting_msg,
                        ),
                    )

                occupied_from: dict[str, set[str]] = {}
                for edge in base_edges:
                    from_id = loc_id_map.get(edge.from_location_id)
                    to_id = loc_id_map.get(edge.to_location_id)
                    if not from_id or not to_id:
                        continue
                    new_edge_id = edge.id if edge.id and not edge.id.startswith("new_") else f"edge_{uuid.uuid4().hex[:10]}"
                    occ = occupied_from.setdefault(from_id, set())
                    cdir = pick_available_compass_direction(
                        normalize_compass_direction(edge.compass_direction, edge.direction_label),
                        occ,
                    )
                    occ.add(cdir)
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                        """,
                        (
                            new_edge_id,
                            target_world_id,
                            from_id,
                            to_id,
                            edge.direction_label,
                            cdir,
                            edge.travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                        ),
                    )
            else:
                # Silent Copy-on-Write fork: freeze old world for running campaigns & mark pending_deletion = 1
                conn.execute(
                    "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                    (world_id,),
                )
                target_world_id = f"world_{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO worlds (id, owner_id, name, global_rules_json, pending_deletion, created_at)
                    VALUES (?, ?, ?, ?, 0, ?)
                    """,
                    (
                        target_world_id,
                        effective_owner_id,
                        payload.name,
                        payload.global_rules.model_dump_json(),
                        now,
                    ),
                )

                loc_id_map = {}
                for idx, loc in enumerate(base_locations):
                    new_loc_id = f"loc_{uuid.uuid4().hex[:10]}"
                    loc_id_map[loc.id] = new_loc_id
                    is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                    is_hub = 1 if getattr(loc, "is_hub", False) else 0
                    starting_msg = getattr(loc, "starting_message", "") or ""
                    conn.execute(
                        """
                        INSERT INTO location_nodes (
                            id, world_id, created_at_turn_id, name, summary,
                            description, environmental_tags_json, is_starting_location, is_hub, starting_message
                        )
                        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_loc_id,
                            target_world_id,
                            loc.name,
                            loc.summary,
                            loc.description,
                            json.dumps(loc.environmental_tags),
                            is_start,
                            is_hub,
                            starting_msg,
                        ),
                    )

                occupied_from = {}
                for edge in base_edges:
                    from_id = loc_id_map.get(edge.from_location_id)
                    to_id = loc_id_map.get(edge.to_location_id)
                    if not from_id or not to_id:
                        continue
                    new_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                    occ = occupied_from.setdefault(from_id, set())
                    cdir = pick_available_compass_direction(
                        normalize_compass_direction(edge.compass_direction, edge.direction_label),
                        occ,
                    )
                    occ.add(cdir)
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                        """,
                        (
                            new_edge_id,
                            target_world_id,
                            from_id,
                            to_id,
                            edge.direction_label,
                            cdir,
                            edge.travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                        ),
                    )

                # Repoint active (non-deleted) template characters to the new world version
                conn.execute(
                    "UPDATE characters SET world_id = ? WHERE world_id = ? AND pending_deletion = 0",
                    (target_world_id, world_id),
                )
                conn.execute(
                    "UPDATE vector_entries SET world_id = ? WHERE world_id = ? AND source_type = 'character_shard'",
                    (target_world_id, world_id),
                )

            existing_taken_lore_ids = {
                r["id"] for r in conn.execute("SELECT id FROM lore_nodes").fetchall()
            }

            # Insert world-level lore nodes & vector entries (reusing existing embedding blobs when unchanged)
            artifact_id_map: dict[str, str] = {}
            valid_new_artifact_ids: set[str] = set()
            for idx, lore in enumerate(payload.lore_nodes):
                can_reuse_id = (
                    campaigns_using == 0
                    and bool(lore.id)
                    and not lore.id.startswith("new_")
                    and lore.id not in existing_taken_lore_ids
                )
                lore_id = lore.id if can_reuse_id else f"lore_{uuid.uuid4().hex[:10]}"
                existing_taken_lore_ids.add(lore_id)
                if lore.category == "artifact":
                    valid_new_artifact_ids.add(lore_id)
                    if lore.id:
                        artifact_id_map[lore.id] = lore_id
                tags_json = json.dumps(lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (lore_id, target_world_id, lore.title, lore.category, lore.content, tags_json),
                )
                blob_key = (lore.title, lore.content, tags_json)
                if blob_key in existing_lore_blobs:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, location_id, character_id, campaign_id,
                            anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'lore', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (
                            lore_id,
                            target_world_id,
                            lore.title,
                            lore.content,
                            tags_json,
                            existing_lore_blobs[blob_key],
                        ),
                    )
                else:
                    precomputed = (
                        lore_embeddings.get(idx)
                        if lore_embeddings and idx in lore_embeddings
                        else (
                            precomputed_embeddings.get(blob_key)
                            if precomputed_embeddings
                            else None
                        )
                    )
                    self.vector_store.upsert_entry(
                        entry_id=lore_id,
                        source_type="lore",
                        world_id=target_world_id,
                        title=lore.title,
                        content=lore.content,
                        keywords=lore.entity_tags,
                        embedding=precomputed,
                        conn=conn,
                    )

            # Remap or clean ItemInstance.lore_id on active template characters in target_world_id
            world_char_rows = conn.execute(
                "SELECT id, equipped_json, inventory_json FROM characters WHERE world_id = ? AND pending_deletion = 0",
                (target_world_id,),
            ).fetchall()
            for wc in world_char_rows:
                remapped_eq, eq_changed = _remap_character_items_for_world_update(
                    wc["equipped_json"] or "[]",
                    artifact_id_map,
                    valid_new_artifact_ids,
                )
                remapped_inv, inv_changed = _remap_character_items_for_world_update(
                    wc["inventory_json"] or "[]",
                    artifact_id_map,
                    valid_new_artifact_ids,
                )
                if eq_changed or inv_changed:
                    conn.execute(
                        "UPDATE characters SET equipped_json = ?, inventory_json = ? WHERE id = ?",
                        (remapped_eq, remapped_inv, wc["id"]),
                    )

            # Insert base location-level lore nodes & non-secret location_lore vectors
            for loc in base_locations:
                mapped_loc_id = loc_id_map.get(loc.id)
                if not mapped_loc_id:
                    continue
                for loc_lore in loc.lore_nodes:
                    can_reuse_loc_lore_id = (
                        campaigns_using == 0
                        and bool(loc_lore.id)
                        and not loc_lore.id.startswith("new_")
                        and loc_lore.id not in existing_taken_lore_ids
                    )
                    loc_lore_id = (
                        loc_lore.id
                        if can_reuse_loc_lore_id
                        else f"lore_{uuid.uuid4().hex[:10]}"
                    )
                    existing_taken_lore_ids.add(loc_lore_id)
                    loc_tags_json = json.dumps(loc_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            loc_lore_id,
                            target_world_id,
                            mapped_loc_id,
                            loc_lore.title,
                            loc_lore.category,
                            loc_lore.content,
                            loc_tags_json,
                        ),
                    )
                    if loc_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            loc.name, loc_lore.title, loc_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        blob_key = (vec_title, loc_lore.content, vec_kw_json)
                        if blob_key in existing_lore_blobs:
                            conn.execute(
                                """
                                INSERT INTO vector_entries (
                                    id, source_type, world_id, location_id, character_id, campaign_id,
                                    anchor_turn_id, title, content, keywords_json, embedding_blob
                                )
                                VALUES (?, 'location_lore', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                                """,
                                (
                                    loc_lore_id,
                                    target_world_id,
                                    mapped_loc_id,
                                    vec_title,
                                    loc_lore.content,
                                    vec_kw_json,
                                    existing_lore_blobs[blob_key],
                                ),
                            )
                        else:
                            pre_vec = (
                                precomputed_embeddings.get(blob_key)
                                if precomputed_embeddings
                                else None
                            )
                            self.vector_store.upsert_entry(
                                entry_id=loc_lore_id,
                                source_type="location_lore",
                                world_id=target_world_id,
                                location_id=mapped_loc_id,
                                title=vec_title,
                                content=loc_lore.content,
                                keywords=vec_keywords,
                                embedding=pre_vec,
                                conn=conn,
                            )

            conn.commit()
        finally:
            conn.close()

        return self.get_world(target_world_id, base_only=True)

    async def aupdate_world(
        self,
        world_id: str,
        payload: WorldUpdatePayload,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Asynchronously pre-compute embeddings strictly for uncached world & non-secret location lore."""
        # Validate world existence & ownership first before incurring embedding I/O
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        try:
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND source_type IN ('lore', 'location_lore')
                  AND (campaign_id IS NULL OR campaign_id = '')
                """,
                (world_id,),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }
        finally:
            conn.close()

        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for lore in payload.lore_nodes:
            tags_json = json.dumps(lore.entity_tags)
            items_to_embed.append(
                (
                    (lore.title, lore.content, tags_json),
                    combine_entry_text(lore.title, lore.content, lore.entity_tags),
                )
            )

        base_locations = [loc for loc in payload.locations if not loc.created_at_turn_id]
        if not base_locations:
            base_locations = orig.locations
        for loc in base_locations:
            for loc_lore in loc.lore_nodes:
                if loc_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    loc.name, loc_lore.title, loc_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, loc_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, loc_lore.content, vec_keywords),
                    )
                )

        precomputed = await _compute_missing_embeddings(items_to_embed, existing_blobs)
        return self.update_world(
            world_id,
            payload,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

    def mark_world_pending_deletion(
        self, world_id: str, owner_id: str | None = None
    ) -> dict[str, int | str | bool]:
        """Soft-delete a world by marking pending_deletion = 1 and counting campaigns using it."""
        conn = self._connect()
        try:
            if owner_id is not None:
                row = conn.execute(
                    "SELECT id FROM worlds WHERE id = ? AND owner_id = ?",
                    (world_id, owner_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT id FROM worlds WHERE id = ?", (world_id,)
                ).fetchone()
            if not row:
                raise KeyError(f"World '{world_id}' not found")

            conn.execute(
                "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                (world_id,),
            )
            usage_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0
            conn.commit()
        finally:
            conn.close()

        return {
            "world_id": world_id,
            "pending_deletion": True,
            "campaigns_using": campaigns_using,
        }

    def prune_pending_deletion_worlds(self) -> list[str]:
        """Hard-delete worlds marked pending_deletion = 1 that are no longer referenced by any campaign."""
        conn = self._connect()
        pruned_ids: list[str] = []
        try:
            rows = conn.execute(
                """
                SELECT w.id
                FROM worlds w
                WHERE w.pending_deletion = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM campaigns camp WHERE camp.world_id = w.id
                  )
                """
            ).fetchall()

            for r in rows:
                w_id = r["id"]
                # Delete world & location lore vectors; preserve character backstory shards by detaching world_id
                conn.execute(
                    "DELETE FROM vector_entries WHERE world_id = ? AND source_type IN ('lore', 'location_lore')",
                    (w_id,),
                )
                conn.execute(
                    "UPDATE vector_entries SET world_id = NULL WHERE world_id = ? AND source_type = 'character_shard'",
                    (w_id,),
                )
                conn.execute("DELETE FROM worlds WHERE id = ?", (w_id,))
                pruned_ids.append(w_id)

            if pruned_ids:
                conn.commit()
        finally:
            conn.close()

        return pruned_ids

    def get_location(
        self,
        location_id: str,
        *,
        campaign_id: str | None = None,
    ) -> LocationNode:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM location_nodes WHERE id = ?", (location_id,)
            ).fetchone()
            if not row:
                raise KeyError(f"Location '{location_id}' not found")
            loc = self._row_to_location(row)
            loc.lore_nodes = self._resolve_location_lore_map(
                conn, [location_id], campaign_id=campaign_id
            ).get(location_id, [])
            return loc
        finally:
            conn.close()

    def get_neighbor_locations(
        self,
        world_id: str,
        active_location_id: str,
        valid_turn_ids: set[str] | None = None,
        *,
        campaign_id: str | None = None,
    ) -> list[NeighborLocationView]:
        """Return 1-hop connected locations visible on the current timeline branch."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT
                    e.id AS edge_id,
                    e.direction_label,
                    e.compass_direction,
                    e.travel_minutes,
                    e.is_locked_or_hidden,
                    e.created_at_turn_id AS edge_turn_id,
                    e.superseded_at_turn_id AS edge_superseded_turn_id,
                    loc.*
                FROM location_edges e
                JOIN location_nodes loc ON loc.id = e.to_location_id
                WHERE e.world_id = ? AND e.from_location_id = ?
                """,
                (world_id, active_location_id),
            ).fetchall()

            neighbors: list[NeighborLocationView] = []
            for r in rows:
                edge_turn = r["edge_turn_id"]
                edge_sup = r["edge_superseded_turn_id"]
                loc_turn = r["created_at_turn_id"]
                if valid_turn_ids is not None:
                    if edge_turn is not None and edge_turn not in valid_turn_ids:
                        continue
                    if edge_sup is not None and edge_sup in valid_turn_ids:
                        continue
                    if loc_turn is not None and loc_turn not in valid_turn_ids:
                        continue
                elif edge_sup is not None:
                    continue
                dest = self._row_to_location(r)
                cdir = normalize_compass_direction(r["compass_direction"], r["direction_label"])
                neighbors.append(
                    NeighborLocationView(
                        edge_id=r["edge_id"],
                        direction_label=r["direction_label"],
                        compass_direction=cdir,
                        travel_minutes=r["travel_minutes"],
                        is_locked_or_hidden=bool(r["is_locked_or_hidden"]),
                        destination=dest,
                    )
                )

            if neighbors:
                loc_lore_map = self._resolve_location_lore_map(
                    conn,
                    [n.destination.id for n in neighbors],
                    campaign_id=campaign_id,
                )
                for n in neighbors:
                    n.destination.lore_nodes = loc_lore_map.get(n.destination.id, [])
        finally:
            conn.close()

        return neighbors

    def add_improvised_location(
        self,
        *,
        world_id: str,
        from_location_id: str,
        created_at_turn_id: str,
        spec: ImprovisedLocationSpec,
        valid_turn_ids: set[str] | None = None,
    ) -> LocationNode:
        """Dynamically add a newly explored room to the Spatial Graph (capped at 8 neighbors per node, spawning a directional Passage Hub on the 9th)."""
        effective_turns: set[str] | None = None
        if valid_turn_ids is not None:
            effective_turns = set(valid_turn_ids) | {created_at_turn_id}
        else:
            try:
                chain = self.get_branch_turn_chain(created_at_turn_id)
                if chain:
                    effective_turns = {t.id for t in chain} | {created_at_turn_id}
            except Exception:
                effective_turns = None

        current_neighbors = self.get_neighbor_locations(
            world_id,
            from_location_id,
            valid_turn_ids=effective_turns,
        )
        distinct_dest_ids = {nb.destination.id for nb in current_neighbors}
        target_dir = normalize_compass_direction(
            spec.compass_direction,
            f"{spec.entry_direction_label} {spec.name}",
        )

        # If fewer than 8 adjacent nodes exist, connect directly in target_dir (or nearest free compass slot)
        if len(distinct_dest_ids) < 8:
            occupied_dirs = {
                nb.compass_direction
                for nb in current_neighbors
                if nb.compass_direction is not None
            }
            assigned_dir = pick_available_compass_direction(target_dir, occupied_dirs)
            rev_dir = OPPOSITE_COMPASS[assigned_dir]

            new_loc_id = f"loc_{uuid.uuid4().hex[:10]}"
            fwd_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
            rev_edge_id = f"edge_{uuid.uuid4().hex[:10]}"

            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
                    """,
                    (
                        new_loc_id,
                        world_id,
                        created_at_turn_id,
                        spec.name,
                        spec.summary,
                        spec.description,
                        json.dumps(spec.environmental_tags),
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        fwd_edge_id,
                        world_id,
                        from_location_id,
                        new_loc_id,
                        spec.entry_direction_label,
                        assigned_dir,
                        spec.travel_minutes,
                        created_at_turn_id,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        rev_edge_id,
                        world_id,
                        new_loc_id,
                        from_location_id,
                        spec.return_direction_label,
                        rev_dir,
                        spec.travel_minutes,
                        created_at_turn_id,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            return self.get_location(new_loc_id)

        # 9th+ neighbor overflow: find existing neighbor(s) in target_dir
        neighbors_in_dir = [
            nb for nb in current_neighbors if nb.compass_direction == target_dir
        ]
        if not neighbors_in_dir and current_neighbors:
            neighbors_in_dir = [current_neighbors[0]]
            if neighbors_in_dir[0].compass_direction:
                target_dir = neighbors_in_dir[0].compass_direction

        # If a Hub already exists in target_dir, delegate to it (recursively handling any overflow on that Hub)
        existing_hub = next(
            (nb.destination for nb in neighbors_in_dir if nb.destination.is_hub),
            None,
        )
        if existing_hub is not None:
            return self.add_improvised_location(
                world_id=world_id,
                from_location_id=existing_hub.id,
                created_at_turn_id=created_at_turn_id,
                spec=spec,
                valid_turn_ids=effective_turns,
            )

        # Create a new Passage Hub in target_dir and reconnect existing nodes in that direction to it
        from_loc = self.get_location(from_location_id)
        base_passage_name = COMPASS_PASSAGE_NAMES[target_dir]
        world_snapshot = self.get_world(world_id, valid_turn_ids=effective_turns)
        existing_names_lower = {loc.name.lower() for loc in world_snapshot.locations}
        hub_name = (
            base_passage_name
            if base_passage_name.lower() not in existing_names_lower
            else f"{from_loc.name} — {base_passage_name}"
        )

        hub_id = f"loc_{uuid.uuid4().hex[:10]}"
        new_loc_id = f"loc_{uuid.uuid4().hex[:10]}"
        hub_back_dir = OPPOSITE_COMPASS[target_dir]
        hub_occupied_dirs: set[str] = {hub_back_dir}

        conn = self._connect()
        try:
            # 1. Insert the new Hub node
            conn.execute(
                """
                INSERT INTO location_nodes (
                    id, world_id, created_at_turn_id, name, summary,
                    description, environmental_tags_json, is_starting_location, is_hub
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
                """,
                (
                    hub_id,
                    world_id,
                    created_at_turn_id,
                    hub_name,
                    f"Connecting passageway branching {target_dir} from {from_loc.name}.",
                    (
                        f"A connecting junction and passageway extending {target_dir} from {from_loc.name}, "
                        "linking multiple adjoining rooms and thresholds."
                    ),
                    json.dumps(["hub", "passageway", f"{target_dir.lower()} passage"]),
                ),
            )

            # 2. Connect from_location_id <-> Hub at target_dir
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
                """,
                (
                    f"edge_{uuid.uuid4().hex[:10]}",
                    world_id,
                    from_location_id,
                    hub_id,
                    f"Passage to {hub_name}",
                    target_dir,
                    created_at_turn_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)
                """,
                (
                    f"edge_{uuid.uuid4().hex[:10]}",
                    world_id,
                    hub_id,
                    from_location_id,
                    f"Back to {from_loc.name}",
                    hub_back_dir,
                    created_at_turn_id,
                ),
            )

            # 3. Reconnect existing neighbor(s) in target_dir to the Hub (superseding old direct edges for branch safety)
            reconnected_dest_ids: set[str] = set()
            for old_nb in neighbors_in_dir:
                old_dest_id = old_nb.destination.id
                if old_dest_id in reconnected_dest_ids:
                    continue
                reconnected_dest_ids.add(old_dest_id)

                # Mark direct edges between from_location_id and old_dest_id as superseded at created_at_turn_id
                conn.execute(
                    """
                    UPDATE location_edges
                    SET superseded_at_turn_id = ?
                    WHERE world_id = ?
                      AND superseded_at_turn_id IS NULL
                      AND (
                          (from_location_id = ? AND to_location_id = ?)
                          OR (from_location_id = ? AND to_location_id = ?)
                      )
                    """,
                    (
                        created_at_turn_id,
                        world_id,
                        from_location_id,
                        old_dest_id,
                        old_dest_id,
                        from_location_id,
                    ),
                )

                old_slot = pick_available_compass_direction(target_dir, hub_occupied_dirs)
                hub_occupied_dirs.add(old_slot)
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"edge_{uuid.uuid4().hex[:10]}",
                        world_id,
                        hub_id,
                        old_dest_id,
                        old_nb.direction_label,
                        old_slot,
                        old_nb.travel_minutes,
                        1 if old_nb.is_locked_or_hidden else 0,
                        created_at_turn_id,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"edge_{uuid.uuid4().hex[:10]}",
                        world_id,
                        old_dest_id,
                        hub_id,
                        f"Return to {hub_name}",
                        OPPOSITE_COMPASS[old_slot],
                        old_nb.travel_minutes,
                        1 if old_nb.is_locked_or_hidden else 0,
                        created_at_turn_id,
                    ),
                )

            # 4. Insert the newly explored 9th location and connect it to the Hub
            conn.execute(
                """
                INSERT INTO location_nodes (
                    id, world_id, created_at_turn_id, name, summary,
                    description, environmental_tags_json, is_starting_location, is_hub
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
                """,
                (
                    new_loc_id,
                    world_id,
                    created_at_turn_id,
                    spec.name,
                    spec.summary,
                    spec.description,
                    json.dumps(spec.environmental_tags),
                ),
            )
            new_slot = pick_available_compass_direction(target_dir, hub_occupied_dirs)
            hub_occupied_dirs.add(new_slot)
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    f"edge_{uuid.uuid4().hex[:10]}",
                    world_id,
                    hub_id,
                    new_loc_id,
                    spec.entry_direction_label,
                    new_slot,
                    spec.travel_minutes,
                    created_at_turn_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    f"edge_{uuid.uuid4().hex[:10]}",
                    world_id,
                    new_loc_id,
                    hub_id,
                    spec.return_direction_label,
                    OPPOSITE_COMPASS[new_slot],
                    spec.travel_minutes,
                    created_at_turn_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_location(new_loc_id)

    # ------------------------------------------------------------------
    # Characters & Memory Shards
    # ------------------------------------------------------------------

    def create_character_from_draft(
        self,
        draft: CharacterWizardDraft,
        world_id: str | None = None,
        character_id: str | None = None,
        shard_embeddings: list[np.ndarray] | None = None,
        owner_id: str | None = None,
    ) -> CharacterRecord:
        """Persist a CharacterWizardDraft and embed its backstory shards into the VectorStore."""
        c_id = (
            validate_safe_character_id(character_id)
            if character_id is not None
            else f"char_{uuid.uuid4().hex[:10]}"
        )
        now = utc_now_iso()
        clean_tags = [slugify_tag(t) for t in draft.tags if t and t.strip()]
        creator_str = draft.creator.strip()
        creator_notes_str = draft.creator_notes.strip()
        clean_portraits, clean_gallery = _sanitize_character_media(
            draft.portraits, draft.gallery
        )
        portraits_json = json.dumps(clean_portraits)
        gallery_json = json.dumps([img.model_dump() for img in clean_gallery])
        conn = self._connect()
        try:
            if character_id is not None:
                if conn.execute("SELECT 1 FROM characters WHERE id = ?", (c_id,)).fetchone():
                    raise ValueError(f"Character ID '{c_id}' already exists.")
                if owner_id is not None:
                    staged_row = conn.execute(
                        "SELECT user_id FROM staged_character_ownership WHERE character_id = ?",
                        (c_id,),
                    ).fetchone()
                    if staged_row and staged_row["user_id"] != owner_id:
                        raise ValueError("Access denied for staged character ID.")
            for it in [*draft.equipped, *draft.inventory]:
                if it.lore_id:
                    _validate_world_artifact_lore_id(conn, world_id, it.lore_id)
            equipped_json = dump_items_json(draft.equipped)
            inventory_json = dump_items_json(draft.inventory)
            distinctive_features_json = json.dumps(draft.distinctive_features)
            mannerisms_json = json.dumps(draft.mannerisms)
            modifications_json = json.dumps(draft.modifications)
            personality_traits_json = json.dumps(draft.personality_traits)
            moral_code_json = json.dumps(draft.moral_code)
            quirks_flaws_json = json.dumps(draft.quirks_flaws)
            communication_style_json = json.dumps(draft.communication_style)
            conn.execute(
                """
                INSERT INTO characters (
                    id, owner_id, world_id, name, tagline, species, sex, pronouns, age,
                    character_bio, physical_appearance, build_and_height, distinctive_features_json,
                    posture, mannerisms_json, modifications_json, visual_aesthetic,
                    personality_traits_json, core_persona, moral_code_json, quirks_flaws_json,
                    communication_style_json, initial_message, equipped_json, inventory_json,
                    voice_anchors_json, baseline_psyche_json, memory_shards_json, tags_json,
                    creator, creator_notes, portraits_json, gallery_json, version, created_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, 1, ?
                )
                """,
                (
                    c_id,
                    owner_id,
                    world_id,
                    draft.name,
                    draft.tagline,
                    draft.species,
                    draft.sex,
                    draft.pronouns,
                    draft.age,
                    draft.character_bio,
                    draft.physical_appearance,
                    draft.build_and_height,
                    distinctive_features_json,
                    draft.posture,
                    mannerisms_json,
                    modifications_json,
                    draft.visual_aesthetic,
                    personality_traits_json,
                    draft.core_persona,
                    moral_code_json,
                    quirks_flaws_json,
                    communication_style_json,
                    draft.initial_message,
                    equipped_json,
                    inventory_json,
                    json.dumps([v.model_dump() for v in draft.voice_anchors]),
                    draft.baseline_psyche.model_dump_json(),
                    json.dumps([m.model_dump() for m in draft.memory_shards]),
                    json.dumps(clean_tags),
                    creator_str,
                    creator_notes_str,
                    portraits_json,
                    gallery_json,
                    now,
                ),
            )

            version_snapshot = {
                "id": c_id,
                "world_id": world_id,
                "name": draft.name,
                "tagline": draft.tagline,
                "species": draft.species,
                "sex": draft.sex,
                "pronouns": draft.pronouns,
                "age": draft.age,
                "character_bio": draft.character_bio,
                "physical_appearance": draft.physical_appearance,
                "build_and_height": draft.build_and_height,
                "distinctive_features": list(draft.distinctive_features),
                "posture": draft.posture,
                "mannerisms": list(draft.mannerisms),
                "modifications": list(draft.modifications),
                "visual_aesthetic": draft.visual_aesthetic,
                "personality_traits": list(draft.personality_traits),
                "core_persona": draft.core_persona,
                "moral_code": list(draft.moral_code),
                "quirks_flaws": list(draft.quirks_flaws),
                "communication_style": list(draft.communication_style),
                "initial_message": draft.initial_message,
                "equipped": [it.model_dump() for it in draft.equipped],
                "inventory": [it.model_dump() for it in draft.inventory],
                "voice_anchors": [v.model_dump() for v in draft.voice_anchors],
                "baseline_psyche": json.loads(draft.baseline_psyche.model_dump_json()),
                "memory_shards": [m.model_dump() for m in draft.memory_shards],
                "tags": clean_tags,
                "creator": creator_str,
                "creator_notes": creator_notes_str,
                "version": 1,
                "pending_deletion": False,
                "created_at": now,
            }
            conn.execute(
                """
                INSERT INTO character_versions (id, character_id, version, data_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (f"cver_{c_id}_1", c_id, 1, json.dumps(version_snapshot), now),
            )

            for idx, shard in enumerate(draft.memory_shards):
                shard_id = f"shard_{c_id}_{idx}"
                precomputed = (
                    shard_embeddings[idx]
                    if shard_embeddings is not None and idx < len(shard_embeddings)
                    else None
                )
                self.vector_store.upsert_entry(
                    entry_id=shard_id,
                    source_type="character_shard",
                    character_id=c_id,
                    world_id=world_id,
                    title=shard.title,
                    content=shard.content,
                    keywords=shard.keywords,
                    embedding=precomputed,
                    conn=conn,
                )

            conn.execute("DELETE FROM staged_character_ownership WHERE character_id = ?", (c_id,))
            conn.commit()
        finally:
            conn.close()

        return self.get_character(c_id)

    async def acreate_character_from_draft(
        self,
        draft: CharacterWizardDraft,
        world_id: str | None = None,
        character_id: str | None = None,
        owner_id: str | None = None,
    ) -> CharacterRecord:
        """Asynchronously pre-compute shard embeddings using embed_text and persist CharacterWizardDraft."""
        if character_id is not None:
            validate_safe_character_id(character_id)
        embeddings: list[np.ndarray] = []
        if draft.memory_shards:
            embeddings = list(
                await asyncio.gather(
                    *(
                        embed_text(
                            combine_entry_text(shard.title, shard.content, shard.keywords)
                        )
                        for shard in draft.memory_shards
                    )
                )
            )
        return self.create_character_from_draft(
            draft,
            world_id=world_id,
            character_id=character_id,
            shard_embeddings=embeddings,
            owner_id=owner_id,
        )

    def list_characters(
        self,
        include_pending_deletion: bool = False,
        owner_id: str | None = None,
    ) -> list[CharacterRecord]:
        conn = self._connect()
        try:
            if owner_id is not None:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM characters WHERE owner_id = ? ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM characters WHERE owner_id = ? AND pending_deletion = 0 ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
            else:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM characters ORDER BY created_at DESC"
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM characters WHERE pending_deletion = 0 ORDER BY created_at DESC"
                    ).fetchall()
        finally:
            conn.close()
        return [self.get_character(r["id"]) for r in rows]

    @staticmethod
    def _is_shard_active_on_branch(
        shard: MemoryShard, valid_turn_ids: set[str] | None
    ) -> bool:
        """Return True if a memory shard is active on the branch defined by valid_turn_ids."""
        if valid_turn_ids is None:
            return True
        if shard.anchor_turn_id is not None and shard.anchor_turn_id not in valid_turn_ids:
            return False
        if (
            shard.superseded_at_turn_id is not None
            and shard.superseded_at_turn_id in valid_turn_ids
        ):
            return False
        return True

    def stage_character_media_ownership(self, user_id: str, character_id: str) -> None:
        """Register temporary media ownership for an uncommitted character draft (expires after a TTL)."""
        clean_id = validate_safe_character_id(character_id)
        conn = self._connect()
        try:
            self._prune_expired_staged_ownership(conn)
            conn.execute(
                """
                INSERT OR REPLACE INTO staged_character_ownership (character_id, user_id, created_at)
                VALUES (?, ?, ?)
                """,
                (clean_id, user_id, utc_now_iso()),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _staged_ownership_cutoff_iso() -> str:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS)
        return cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

    def _prune_expired_staged_ownership(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "DELETE FROM staged_character_ownership WHERE created_at < ?",
            (self._staged_ownership_cutoff_iso(),),
        )

    def user_can_access_character(self, user_id: str, character_id: str) -> bool:
        """Check whether a user has legitimate access to a character.

        Access is granted if:
        1. The user owns the character (characters.owner_id == user_id)
        2. The character is the primary character of a campaign owned by the user (campaigns.character_id == character_id)
        3. The character is a participant in a campaign owned by the user (campaign_characters.character_id == character_id)
        4. The user is currently staging an uncommitted draft with pre-assigned media assets
        """
        staged_cutoff = self._staged_ownership_cutoff_iso()
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT 1 FROM characters WHERE id = ? AND owner_id = ?
                UNION
                SELECT 1 FROM campaigns WHERE character_id = ? AND owner_id = ?
                UNION
                SELECT 1 FROM campaign_characters cc
                JOIN campaigns c ON cc.campaign_id = c.id
                WHERE cc.character_id = ? AND c.owner_id = ?
                UNION
                SELECT 1 FROM staged_character_ownership
                WHERE character_id = ? AND user_id = ? AND created_at >= ?
                LIMIT 1
                """,
                (
                    character_id, user_id,
                    character_id, user_id,
                    character_id, user_id,
                    character_id, user_id, staged_cutoff,
                ),
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def get_character(
        self,
        character_id: str,
        campaign_id: str | None = None,
        owner_id: str | None = None,
        valid_turn_ids: set[str] | None = None,
    ) -> CharacterRecord:
        conn = self._connect()
        try:
            if owner_id is not None:
                row = conn.execute(
                    "SELECT * FROM characters WHERE id = ? AND owner_id = ?",
                    (character_id, owner_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM characters WHERE id = ?", (character_id,)
                ).fetchone()
            if not row:
                raise KeyError(f"Character '{character_id}' not found")

            camp_mem_row = None
            if campaign_id:
                camp_mem_row = conn.execute(
                    "SELECT memory_shards_json FROM campaign_character_memories WHERE campaign_id = ? AND character_id = ?",
                    (campaign_id, character_id),
                ).fetchone()
        finally:
            conn.close()

        row_keys = row.keys()
        shards_json = (
            camp_mem_row["memory_shards_json"]
            if camp_mem_row
            else (row["memory_shards_json"] if "memory_shards_json" in row_keys else "[]")
        )
        parsed_shards: list[MemoryShard] = []
        for idx, m in enumerate(json.loads(shards_json or "[]")):
            shard = MemoryShard.model_validate(m)
            if not shard.id:
                shard.id = f"shard_{character_id}_{idx}"
            if self._is_shard_active_on_branch(shard, valid_turn_ids):
                parsed_shards.append(shard)

        return CharacterRecord(
            id=row["id"],
            world_id=row["world_id"],
            name=row["name"],
            tagline=row["tagline"],
            species=row["species"] if "species" in row_keys and row["species"] else "Human",
            sex=row["sex"] if "sex" in row_keys and row["sex"] else "",
            pronouns=row["pronouns"] if "pronouns" in row_keys and row["pronouns"] else "",
            age=row["age"] if "age" in row_keys and row["age"] else "",
            character_bio=(
                row["character_bio"]
                if "character_bio" in row_keys and row["character_bio"]
                else (row["physical_appearance"] if "physical_appearance" in row_keys else "")
            ),
            physical_appearance=row["physical_appearance"] if "physical_appearance" in row_keys else "",
            build_and_height=row["build_and_height"] if "build_and_height" in row_keys and row["build_and_height"] else "",
            distinctive_features=json.loads(row["distinctive_features_json"] or "[]") if "distinctive_features_json" in row_keys and row["distinctive_features_json"] else [],
            posture=row["posture"] if "posture" in row_keys and row["posture"] else "",
            mannerisms=json.loads(row["mannerisms_json"] or "[]") if "mannerisms_json" in row_keys and row["mannerisms_json"] else [],
            modifications=json.loads(row["modifications_json"] or "[]") if "modifications_json" in row_keys and row["modifications_json"] else [],
            visual_aesthetic=row["visual_aesthetic"] if "visual_aesthetic" in row_keys and row["visual_aesthetic"] else "",
            personality_traits=json.loads(row["personality_traits_json"] or "[]") if "personality_traits_json" in row_keys and row["personality_traits_json"] else [],
            core_persona=row["core_persona"],
            moral_code=json.loads(row["moral_code_json"] or "[]") if "moral_code_json" in row_keys and row["moral_code_json"] else [],
            quirks_flaws=json.loads(row["quirks_flaws_json"] or "[]") if "quirks_flaws_json" in row_keys and row["quirks_flaws_json"] else [],
            communication_style=json.loads(row["communication_style_json"] or "[]") if "communication_style_json" in row_keys and row["communication_style_json"] else [],
            initial_message=row["initial_message"] if "initial_message" in row_keys else "",
            equipped=json.loads(row["equipped_json"] or "[]") if "equipped_json" in row_keys else [],
            inventory=json.loads(row["inventory_json"] or "[]") if "inventory_json" in row_keys else [],
            voice_anchors=[
                VoiceAnchor.model_validate(v)
                for v in json.loads(row["voice_anchors_json"] or "[]")
            ],
            baseline_psyche=BaselinePsyche.model_validate_json(row["baseline_psyche_json"]),
            memory_shards=parsed_shards,
            tags=json.loads(row["tags_json"] or "[]") if "tags_json" in row_keys and row["tags_json"] else [],
            creator=row["creator"] if "creator" in row_keys and row["creator"] else "",
            creator_notes=row["creator_notes"] if "creator_notes" in row_keys and row["creator_notes"] else "",
            portraits=json.loads(row["portraits_json"] or "{}") if "portraits_json" in row_keys and row["portraits_json"] else {},
            gallery=[
                GalleryImage.model_validate(img)
                for img in json.loads(row["gallery_json"] or "[]")
            ] if "gallery_json" in row_keys and row["gallery_json"] else [],
            version=row["version"] if "version" in row_keys and row["version"] is not None else 1,
            pending_deletion=bool(row["pending_deletion"]) if "pending_deletion" in row_keys else False,
            created_at=row["created_at"],
        )

    def get_campaign_character_memories(
        self,
        campaign_id: str,
        character_id: str,
        valid_turn_ids: set[str] | None = None,
    ) -> list[MemoryShard] | None:
        """Return campaign-scoped memory shards for a character if customized, or None."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT memory_shards_json FROM campaign_character_memories WHERE campaign_id = ? AND character_id = ?",
                (campaign_id, character_id),
            ).fetchone()
            if not row:
                return None
            result: list[MemoryShard] = []
            for idx, m in enumerate(json.loads(row["memory_shards_json"] or "[]")):
                shard = MemoryShard.model_validate(m)
                if not shard.id:
                    shard.id = f"shard_{character_id}_{idx}"
                if self._is_shard_active_on_branch(shard, valid_turn_ids):
                    result.append(shard)
            return result
        finally:
            conn.close()

    def get_raw_campaign_character_memories(
        self, campaign_id: str, character_id: str
    ) -> list[MemoryShard]:
        """Return all stored campaign memory shards (across all branches), or initialized from base character."""
        existing = self.get_campaign_character_memories(
            campaign_id, character_id, valid_turn_ids=None
        )
        if existing is not None:
            return existing
        base_char = self.get_character(character_id)
        return [
            shard.model_copy(
                update={"id": shard.id or f"shard_{character_id}_{idx}"}
            )
            for idx, shard in enumerate(base_char.memory_shards)
        ]

    def update_campaign_character_memories(
        self,
        campaign_id: str,
        character_id: str,
        memory_shards: list[MemoryShard],
        shard_embeddings: dict[int, np.ndarray] | None = None,
        owner_id: str | None = None,
        preserve_other_branches: bool = True,
    ) -> CampaignStateBundle:
        """Persist campaign-scoped character memories and re-index vector entries for this campaign."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        # Ensure character exists
        self.get_character(character_id)
        now = utc_now_iso()

        final_shards: list[MemoryShard] = []
        for idx, s in enumerate(memory_shards):
            if not s.id:
                s = s.model_copy(update={"id": f"shard_{character_id}_{idx}"})
            final_shards.append(s)

        if preserve_other_branches and campaign.active_leaf_turn_id:
            branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
            valid_turn_ids = {t.id for t in branch_turns}
            raw_existing = self.get_campaign_character_memories(
                campaign_id, character_id, valid_turn_ids=None
            )
            if raw_existing:
                active_ids = {s.id for s in final_shards if s.id}
                for raw_shard in raw_existing:
                    if (
                        not self._is_shard_active_on_branch(raw_shard, valid_turn_ids)
                        and raw_shard.id not in active_ids
                    ):
                        final_shards.append(raw_shard)

        shards_json = json.dumps([m.model_dump() for m in final_shards])

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO campaign_character_memories (campaign_id, character_id, memory_shards_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(campaign_id, character_id) DO UPDATE SET
                    memory_shards_json = excluded.memory_shards_json,
                    updated_at = excluded.updated_at
                """,
                (campaign_id, character_id, shards_json, now),
            )
            # Remove existing campaign-scoped vector entries for this character
            conn.execute(
                """
                DELETE FROM vector_entries
                WHERE campaign_id = ? AND character_id = ? AND source_type = 'character_shard'
                """,
                (campaign_id, character_id),
            )
            # Re-index all shards for this campaign (preserving branch anchor and superseded metadata)
            for idx, shard in enumerate(final_shards):
                shard_id = f"shard_{campaign_id}_{character_id}_{idx}"
                precomputed = shard_embeddings.get(idx) if shard_embeddings else None
                self.vector_store.upsert_entry(
                    entry_id=shard_id,
                    source_type="character_shard",
                    character_id=character_id,
                    world_id=campaign.world_id,
                    campaign_id=campaign_id,
                    anchor_turn_id=shard.anchor_turn_id,
                    superseded_at_turn_id=shard.superseded_at_turn_id,
                    title=shard.title,
                    content=shard.content,
                    keywords=shard.keywords,
                    embedding=precomputed,
                    conn=conn,
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    async def aupdate_campaign_character_memories(
        self,
        campaign_id: str,
        character_id: str,
        memory_shards: list[MemoryShard],
        owner_id: str | None = None,
        preserve_other_branches: bool = True,
    ) -> CampaignStateBundle:
        """Asynchronously compute embeddings for campaign-scoped memory shards and update."""
        shard_embeddings: dict[int, np.ndarray] = {}
        if memory_shards:
            computed = await asyncio.gather(
                *(
                    embed_text(
                        combine_entry_text(shard.title, shard.content, shard.keywords)
                    )
                    for shard in memory_shards
                )
            )
            shard_embeddings = {idx: vec for idx, vec in enumerate(computed)}
        return self.update_campaign_character_memories(
            campaign_id=campaign_id,
            character_id=character_id,
            memory_shards=memory_shards,
            shard_embeddings=shard_embeddings,
            owner_id=owner_id,
            preserve_other_branches=preserve_other_branches,
        )

    def update_character(
        self,
        character_id: str,
        payload: CharacterUpdatePayload,
        shard_embeddings: dict[int, np.ndarray] | None = None,
        owner_id: str | None = None,
    ) -> CharacterRecord:
        """Update a character in-place if unused, or silently fork a new Copy-on-Write version if used by campaigns."""
        orig = self.get_character(character_id, owner_id=owner_id)
        now = utc_now_iso()
        target_world_id = payload.world_id if payload.world_id is not None else orig.world_id

        conn = self._connect()
        try:
            c_owner_row = conn.execute(
                "SELECT owner_id FROM characters WHERE id = ?", (character_id,)
            ).fetchone()
            effective_owner_id = (
                c_owner_row["owner_id"]
                if c_owner_row and "owner_id" in c_owner_row.keys()
                else owner_id
            )

            usage_row = conn.execute(
                """
                SELECT COUNT(DISTINCT campaign_id) AS cnt
                FROM (
                    SELECT campaign_id FROM campaign_characters WHERE character_id = ?
                    UNION
                    SELECT id AS campaign_id FROM campaigns WHERE character_id = ?
                )
                """,
                (character_id, character_id),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0

            # Cache existing shard vector blobs so unchanged memory shards don't re-run embeddings
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE character_id = ? AND source_type = 'character_shard'
                """,
                (character_id,),
            ).fetchall()
            existing_shard_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }

            orig_lore_ids = {
                it.lore_id
                for it in [*orig.equipped, *orig.inventory]
                if it.lore_id
            }

            def _sanitize_world_character_items(items: list[ItemInstance]) -> list[ItemInstance]:
                cleaned_list: list[ItemInstance] = []
                for it in items:
                    if it.lore_id:
                        if target_world_id != orig.world_id and it.lore_id in orig_lore_ids:
                            try:
                                _validate_world_artifact_lore_id(conn, target_world_id, it.lore_id)
                            except ValueError:
                                it = it.model_copy(
                                    update={
                                        "lore_id": None,
                                        "flags": [f for f in it.flags if f != "artifact"],
                                    }
                                )
                        else:
                            _validate_world_artifact_lore_id(conn, target_world_id, it.lore_id)
                    cleaned_list.append(it)
                return cleaned_list

            clean_equipped_items = _sanitize_world_character_items(payload.equipped)
            clean_inventory_items = _sanitize_world_character_items(payload.inventory)

            equipped_json = dump_items_json(clean_equipped_items)
            inventory_json = dump_items_json(clean_inventory_items)
            voice_json = json.dumps([v.model_dump() for v in payload.voice_anchors])
            psyche_json = payload.baseline_psyche.model_dump_json()
            shards_json = json.dumps([m.model_dump() for m in payload.memory_shards])
            clean_tags = [slugify_tag(t) for t in payload.tags if t and t.strip()]
            tags_json = json.dumps(clean_tags)
            creator_str = payload.creator.strip()
            creator_notes_str = payload.creator_notes.strip()
            portraits_dict = payload.portraits if payload.portraits else orig.portraits
            gallery_list = payload.gallery if payload.gallery else orig.gallery
            clean_p, clean_g = _sanitize_character_media(portraits_dict, gallery_list)
            portraits_json = json.dumps(clean_p)
            gallery_json = json.dumps([img.model_dump() for img in clean_g])

            max_ver_row = conn.execute(
                "SELECT COALESCE(MAX(version), 0) AS max_v FROM character_versions WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            highest_version = max(orig.version, max_ver_row["max_v"] if max_ver_row else 0)
            new_version = highest_version + 1

            distinctive_features_json = json.dumps(payload.distinctive_features)
            mannerisms_json = json.dumps(payload.mannerisms)
            modifications_json = json.dumps(payload.modifications)
            personality_traits_json = json.dumps(payload.personality_traits)
            moral_code_json = json.dumps(payload.moral_code)
            quirks_flaws_json = json.dumps(payload.quirks_flaws)
            communication_style_json = json.dumps(payload.communication_style)

            if campaigns_using == 0:
                # In-place update (zero active campaigns reference this character)
                target_char_id = character_id
                conn.execute(
                    """
                    UPDATE characters
                    SET world_id = ?, name = ?, tagline = ?, species = ?, sex = ?, pronouns = ?, age = ?,
                        character_bio = ?, physical_appearance = ?, build_and_height = ?, distinctive_features_json = ?,
                        posture = ?, mannerisms_json = ?, modifications_json = ?, visual_aesthetic = ?,
                        personality_traits_json = ?, core_persona = ?, moral_code_json = ?, quirks_flaws_json = ?,
                        communication_style_json = ?, initial_message = ?, equipped_json = ?, inventory_json = ?,
                        voice_anchors_json = ?, baseline_psyche_json = ?, memory_shards_json = ?,
                        tags_json = ?, creator = ?, creator_notes = ?,
                        portraits_json = ?, gallery_json = ?, version = ?
                    WHERE id = ?
                    """,
                    (
                        target_world_id,
                        payload.name,
                        payload.tagline,
                        payload.species,
                        payload.sex,
                        payload.pronouns,
                        payload.age,
                        payload.character_bio,
                        payload.physical_appearance,
                        payload.build_and_height,
                        distinctive_features_json,
                        payload.posture,
                        mannerisms_json,
                        modifications_json,
                        payload.visual_aesthetic,
                        personality_traits_json,
                        payload.core_persona,
                        moral_code_json,
                        quirks_flaws_json,
                        communication_style_json,
                        payload.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        tags_json,
                        creator_str,
                        creator_notes_str,
                        portraits_json,
                        gallery_json,
                        new_version,
                        target_char_id,
                    ),
                )
                conn.execute(
                    "DELETE FROM vector_entries WHERE character_id = ? AND source_type = 'character_shard'",
                    (target_char_id,),
                )

                version_snapshot = {
                    "id": target_char_id,
                    "world_id": target_world_id,
                    "name": payload.name,
                    "tagline": payload.tagline,
                    "species": payload.species,
                    "sex": payload.sex,
                    "pronouns": payload.pronouns,
                    "age": payload.age,
                    "character_bio": payload.character_bio,
                    "physical_appearance": payload.physical_appearance,
                    "build_and_height": payload.build_and_height,
                    "distinctive_features": list(payload.distinctive_features),
                    "posture": payload.posture,
                    "mannerisms": list(payload.mannerisms),
                    "modifications": list(payload.modifications),
                    "visual_aesthetic": payload.visual_aesthetic,
                    "personality_traits": list(payload.personality_traits),
                    "core_persona": payload.core_persona,
                    "moral_code": list(payload.moral_code),
                    "quirks_flaws": list(payload.quirks_flaws),
                    "communication_style": list(payload.communication_style),
                    "initial_message": payload.initial_message,
                    "equipped": [it.model_dump() for it in clean_equipped_items],
                    "inventory": [it.model_dump() for it in clean_inventory_items],
                    "voice_anchors": [v.model_dump() for v in payload.voice_anchors],
                    "baseline_psyche": json.loads(payload.baseline_psyche.model_dump_json()),
                    "memory_shards": [m.model_dump() for m in payload.memory_shards],
                    "tags": clean_tags,
                    "creator": creator_str,
                    "creator_notes": creator_notes_str,
                    "version": new_version,
                    "pending_deletion": False,
                    "created_at": now,
                }
                conn.execute(
                    """
                    INSERT INTO character_versions (id, character_id, version, data_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f"cver_{target_char_id}_{new_version}", target_char_id, new_version, json.dumps(version_snapshot), now),
                )
            else:
                # Silent Copy-on-Write fork: freeze old character for running campaigns & mark pending_deletion = 1
                conn.execute(
                    "UPDATE characters SET pending_deletion = 1 WHERE id = ?",
                    (character_id,),
                )
                target_char_id = f"char_{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO characters (
                        id, owner_id, world_id, name, tagline, species, sex, pronouns, age,
                        character_bio, physical_appearance, build_and_height, distinctive_features_json,
                        posture, mannerisms_json, modifications_json, visual_aesthetic,
                        personality_traits_json, core_persona, moral_code_json, quirks_flaws_json,
                        communication_style_json, initial_message, equipped_json, inventory_json,
                        voice_anchors_json, baseline_psyche_json, memory_shards_json,
                        tags_json, creator, creator_notes,
                        portraits_json, gallery_json, version,
                        pending_deletion, created_at
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        0, ?
                    )
                    """,
                    (
                        target_char_id,
                        effective_owner_id,
                        target_world_id,
                        payload.name,
                        payload.tagline,
                        payload.species,
                        payload.sex,
                        payload.pronouns,
                        payload.age,
                        payload.character_bio,
                        payload.physical_appearance,
                        payload.build_and_height,
                        distinctive_features_json,
                        payload.posture,
                        mannerisms_json,
                        modifications_json,
                        payload.visual_aesthetic,
                        personality_traits_json,
                        payload.core_persona,
                        moral_code_json,
                        quirks_flaws_json,
                        communication_style_json,
                        payload.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        tags_json,
                        creator_str,
                        creator_notes_str,
                        portraits_json,
                        gallery_json,
                        new_version,
                        now,
                    ),
                )

                # Copy media assets on disk if present
                self._copy_character_media(character_id, target_char_id)

                # Copy previous version snapshots into target_char_id so historical versions are accessible
                old_vers = conn.execute(
                    "SELECT version, data_json, created_at FROM character_versions WHERE character_id = ? ORDER BY version ASC",
                    (character_id,),
                ).fetchall()
                for ov in old_vers:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO character_versions (id, character_id, version, data_json, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (f"cver_{target_char_id}_{ov['version']}", target_char_id, ov["version"], ov["data_json"], ov["created_at"]),
                    )

                version_snapshot = {
                    "id": target_char_id,
                    "world_id": target_world_id,
                    "name": payload.name,
                    "tagline": payload.tagline,
                    "species": payload.species,
                    "sex": payload.sex,
                    "pronouns": payload.pronouns,
                    "age": payload.age,
                    "character_bio": payload.character_bio,
                    "physical_appearance": payload.physical_appearance,
                    "build_and_height": payload.build_and_height,
                    "distinctive_features": list(payload.distinctive_features),
                    "posture": payload.posture,
                    "mannerisms": list(payload.mannerisms),
                    "modifications": list(payload.modifications),
                    "visual_aesthetic": payload.visual_aesthetic,
                    "personality_traits": list(payload.personality_traits),
                    "core_persona": payload.core_persona,
                    "moral_code": list(payload.moral_code),
                    "quirks_flaws": list(payload.quirks_flaws),
                    "communication_style": list(payload.communication_style),
                    "initial_message": payload.initial_message,
                    "equipped": [it.model_dump() for it in clean_equipped_items],
                    "inventory": [it.model_dump() for it in clean_inventory_items],
                    "voice_anchors": [v.model_dump() for v in payload.voice_anchors],
                    "baseline_psyche": json.loads(payload.baseline_psyche.model_dump_json()),
                    "memory_shards": [m.model_dump() for m in payload.memory_shards],
                    "tags": clean_tags,
                    "creator": creator_str,
                    "creator_notes": creator_notes_str,
                    "version": new_version,
                    "pending_deletion": False,
                    "created_at": now,
                }
                conn.execute(
                    """
                    INSERT INTO character_versions (id, character_id, version, data_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (f"cver_{target_char_id}_{new_version}", target_char_id, new_version, json.dumps(version_snapshot), now),
                )

            for idx, shard in enumerate(payload.memory_shards):
                shard_id = f"shard_{target_char_id}_{idx}"
                kw_json = json.dumps(shard.keywords)
                blob_key = (shard.title, shard.content, kw_json)
                if blob_key in existing_shard_blobs:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, character_id, campaign_id,
                            anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'character_shard', ?, ?, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (
                            shard_id,
                            target_world_id,
                            target_char_id,
                            shard.title,
                            shard.content,
                            kw_json,
                            existing_shard_blobs[blob_key],
                        ),
                    )
                else:
                    precomputed = shard_embeddings.get(idx) if shard_embeddings else None
                    self.vector_store.upsert_entry(
                        entry_id=shard_id,
                        source_type="character_shard",
                        character_id=target_char_id,
                        world_id=target_world_id,
                        title=shard.title,
                        content=shard.content,
                        keywords=shard.keywords,
                        embedding=precomputed,
                        conn=conn,
                    )

            conn.commit()
        finally:
            conn.close()

        return self.get_character(target_char_id)

    async def aupdate_character(
        self,
        character_id: str,
        payload: CharacterUpdatePayload,
        owner_id: str | None = None,
    ) -> CharacterRecord:
        """Asynchronously pre-compute embeddings for new/modified memory shards and update character."""
        shard_embeddings: dict[int, np.ndarray] = {}
        if payload.memory_shards:
            computed = await asyncio.gather(
                *(
                    embed_text(
                        combine_entry_text(shard.title, shard.content, shard.keywords)
                    )
                    for shard in payload.memory_shards
                )
            )
            shard_embeddings = {idx: vec for idx, vec in enumerate(computed)}
        return self.update_character(
            character_id,
            payload,
            shard_embeddings=shard_embeddings,
            owner_id=owner_id,
        )

    def list_character_versions(
        self, character_id: str, owner_id: str | None = None
    ) -> list[CharacterVersionSummary]:
        """Return a list of all historical versions for the specified character, newest first."""
        self.get_character(character_id, owner_id=owner_id)
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, character_id, version, created_at
                FROM character_versions
                WHERE character_id = ?
                ORDER BY version DESC
                """,
                (character_id,),
            ).fetchall()
            return [
                CharacterVersionSummary(
                    id=r["id"],
                    character_id=r["character_id"],
                    version=r["version"],
                    created_at=r["created_at"],
                )
                for r in rows
            ]
        finally:
            conn.close()

    def get_character_version(
        self, character_id: str, version: int, owner_id: str | None = None
    ) -> CharacterRecord:
        """Return the complete CharacterRecord reconstructed from historical snapshot."""
        current_char = self.get_character(character_id, owner_id=owner_id)
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT data_json
                FROM character_versions
                WHERE character_id = ? AND version = ?
                """,
                (character_id, version),
            ).fetchone()
            if not row:
                raise KeyError(f"Version {version} for character '{character_id}' not found")
            data = json.loads(row["data_json"])
            # Keep media assets static to the character
            data["portraits"] = current_char.portraits
            data["gallery"] = [img.model_dump() for img in current_char.gallery]
            return CharacterRecord.model_validate(data)
        finally:
            conn.close()

    def restore_character_version(
        self, character_id: str, version: int, owner_id: str | None = None
    ) -> CharacterRecord:
        """Restore a historical snapshot by making it the active version without creating a new version entry."""
        snap = self.get_character_version(character_id, version, owner_id=owner_id)
        current_char = self.get_character(character_id, owner_id=owner_id)
        now = utc_now_iso()

        conn = self._connect()
        try:
            c_owner_row = conn.execute(
                "SELECT owner_id FROM characters WHERE id = ?", (character_id,)
            ).fetchone()
            effective_owner_id = (
                c_owner_row["owner_id"]
                if c_owner_row and "owner_id" in c_owner_row.keys()
                else owner_id
            )

            usage_row = conn.execute(
                """
                SELECT COUNT(DISTINCT campaign_id) AS cnt
                FROM (
                    SELECT campaign_id FROM campaign_characters WHERE character_id = ?
                    UNION
                    SELECT id AS campaign_id FROM campaigns WHERE character_id = ?
                )
                """,
                (character_id, character_id),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0

            # Prepare serialized fields from snap
            equipped_json = dump_items_json(snap.equipped)
            inventory_json = dump_items_json(snap.inventory)
            voice_json = json.dumps([v.model_dump() for v in snap.voice_anchors])
            psyche_json = snap.baseline_psyche.model_dump_json()
            shards_json = json.dumps([m.model_dump() for m in snap.memory_shards])
            clean_tags = [slugify_tag(t) for t in snap.tags if t and t.strip()]
            tags_json = json.dumps(clean_tags)
            distinctive_features_json = json.dumps(snap.distinctive_features)
            mannerisms_json = json.dumps(snap.mannerisms)
            modifications_json = json.dumps(snap.modifications)
            personality_traits_json = json.dumps(snap.personality_traits)
            moral_code_json = json.dumps(snap.moral_code)
            quirks_flaws_json = json.dumps(snap.quirks_flaws)
            communication_style_json = json.dumps(snap.communication_style)
            portraits_json = json.dumps(current_char.portraits)
            gallery_json = json.dumps([img.model_dump() for img in current_char.gallery])

            if campaigns_using == 0:
                target_char_id = character_id
                conn.execute(
                    """
                    UPDATE characters
                    SET world_id = ?, name = ?, tagline = ?, species = ?, sex = ?, pronouns = ?, age = ?,
                        character_bio = ?, physical_appearance = ?, build_and_height = ?, distinctive_features_json = ?,
                        posture = ?, mannerisms_json = ?, modifications_json = ?, visual_aesthetic = ?,
                        personality_traits_json = ?, core_persona = ?, moral_code_json = ?, quirks_flaws_json = ?,
                        communication_style_json = ?, initial_message = ?, equipped_json = ?, inventory_json = ?,
                        voice_anchors_json = ?, baseline_psyche_json = ?, memory_shards_json = ?,
                        tags_json = ?, creator = ?, creator_notes = ?,
                        portraits_json = ?, gallery_json = ?, version = ?
                    WHERE id = ?
                    """,
                    (
                        snap.world_id,
                        snap.name,
                        snap.tagline,
                        snap.species,
                        snap.sex,
                        snap.pronouns,
                        snap.age,
                        snap.character_bio,
                        snap.physical_appearance,
                        snap.build_and_height,
                        distinctive_features_json,
                        snap.posture,
                        mannerisms_json,
                        modifications_json,
                        snap.visual_aesthetic,
                        personality_traits_json,
                        snap.core_persona,
                        moral_code_json,
                        quirks_flaws_json,
                        communication_style_json,
                        snap.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        tags_json,
                        snap.creator,
                        snap.creator_notes,
                        portraits_json,
                        gallery_json,
                        snap.version,
                        target_char_id,
                    ),
                )
                conn.execute(
                    "DELETE FROM vector_entries WHERE character_id = ? AND source_type = 'character_shard'",
                    (target_char_id,),
                )
            else:
                # Copy-on-Write fork for running campaigns
                conn.execute(
                    "UPDATE characters SET pending_deletion = 1 WHERE id = ?",
                    (character_id,),
                )
                target_char_id = f"char_{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO characters (
                        id, owner_id, world_id, name, tagline, species, sex, pronouns, age,
                        character_bio, physical_appearance, build_and_height, distinctive_features_json,
                        posture, mannerisms_json, modifications_json, visual_aesthetic,
                        personality_traits_json, core_persona, moral_code_json, quirks_flaws_json,
                        communication_style_json, initial_message, equipped_json, inventory_json,
                        voice_anchors_json, baseline_psyche_json, memory_shards_json,
                        tags_json, creator, creator_notes,
                        portraits_json, gallery_json, version,
                        pending_deletion, created_at
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        ?, ?, ?,
                        0, ?
                    )
                    """,
                    (
                        target_char_id,
                        effective_owner_id,
                        snap.world_id,
                        snap.name,
                        snap.tagline,
                        snap.species,
                        snap.sex,
                        snap.pronouns,
                        snap.age,
                        snap.character_bio,
                        snap.physical_appearance,
                        snap.build_and_height,
                        distinctive_features_json,
                        snap.posture,
                        mannerisms_json,
                        modifications_json,
                        snap.visual_aesthetic,
                        personality_traits_json,
                        snap.core_persona,
                        moral_code_json,
                        quirks_flaws_json,
                        communication_style_json,
                        snap.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        tags_json,
                        snap.creator,
                        snap.creator_notes,
                        portraits_json,
                        gallery_json,
                        snap.version,
                        now,
                    ),
                )
                self._copy_character_media(character_id, target_char_id)

                # Copy all historical versions (including v3) to the new entity
                old_vers = conn.execute(
                    "SELECT version, data_json, created_at FROM character_versions WHERE character_id = ? ORDER BY version ASC",
                    (character_id,),
                ).fetchall()
                for ov in old_vers:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO character_versions (id, character_id, version, data_json, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (f"cver_{target_char_id}_{ov['version']}", target_char_id, ov["version"], ov["data_json"], ov["created_at"]),
                    )

            # Re-index vector entries for snap memory shards
            for idx, shard in enumerate(snap.memory_shards):
                shard_id = f"shard_{target_char_id}_{idx}"
                conn.execute(
                    """
                    INSERT INTO vector_entries (
                        id, source_type, world_id, character_id, campaign_id,
                        anchor_turn_id, title, content, keywords_json, embedding_blob
                    )
                    VALUES (?, 'character_shard', ?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (
                        shard_id,
                        snap.world_id,
                        target_char_id,
                        shard.title,
                        shard.content,
                        json.dumps(shard.keywords),
                        b"",
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_character(target_char_id, owner_id=owner_id)

    async def arestore_character_version(
        self, character_id: str, version: int, owner_id: str | None = None
    ) -> CharacterRecord:
        """Asynchronously restore a historical snapshot as active version."""
        return self.restore_character_version(character_id, version, owner_id=owner_id)

    def update_character_portraits(
        self, character_id: str, portraits: dict[str, str], owner_id: str | None = None
    ) -> CharacterRecord:
        """Update character portraits without bumping version."""
        self.get_character(character_id, owner_id=owner_id)
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE characters SET portraits_json = ? WHERE id = ?",
                (json.dumps(portraits), character_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_character(character_id, owner_id=owner_id)

    def update_character_gallery(
        self, character_id: str, gallery: list[GalleryImage], owner_id: str | None = None
    ) -> CharacterRecord:
        """Update character gallery list without bumping version."""
        self.get_character(character_id, owner_id=owner_id)
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE characters SET gallery_json = ? WHERE id = ?",
                (json.dumps([img.model_dump() for img in gallery]), character_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_character(character_id, owner_id=owner_id)

    def mark_character_pending_deletion(
        self, character_id: str, owner_id: str | None = None
    ) -> dict[str, int | str | bool]:
        """Soft-delete a character by marking pending_deletion = 1 and counting campaigns using it."""
        conn = self._connect()
        try:
            if owner_id is not None:
                row = conn.execute(
                    "SELECT id FROM characters WHERE id = ? AND owner_id = ?",
                    (character_id, owner_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT id FROM characters WHERE id = ?", (character_id,)
                ).fetchone()
            if not row:
                raise KeyError(f"Character '{character_id}' not found")

            conn.execute(
                "UPDATE characters SET pending_deletion = 1 WHERE id = ?",
                (character_id,),
            )
            usage_row = conn.execute(
                """
                SELECT COUNT(DISTINCT campaign_id) AS cnt
                FROM (
                    SELECT campaign_id FROM campaign_characters WHERE character_id = ?
                    UNION
                    SELECT id AS campaign_id FROM campaigns WHERE character_id = ?
                )
                """,
                (character_id, character_id),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0
            conn.commit()
        finally:
            conn.close()

        return {
            "character_id": character_id,
            "pending_deletion": True,
            "campaigns_using": campaigns_using,
        }

    def prune_pending_deletion_characters(self) -> list[str]:
        """Hard-delete characters marked pending_deletion = 1 that are no longer referenced by any campaign."""
        conn = self._connect()
        pruned_ids: list[str] = []
        try:
            rows = conn.execute(
                """
                SELECT c.id
                FROM characters c
                WHERE c.pending_deletion = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM campaign_characters cc WHERE cc.character_id = c.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM campaigns camp WHERE camp.character_id = c.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM character_states cs WHERE cs.character_id = c.id
                  )
                """
            ).fetchall()

            for r in rows:
                c_id = r["id"]
                conn.execute(
                    "DELETE FROM vector_entries WHERE character_id = ?",
                    (c_id,),
                )
                conn.execute("DELETE FROM characters WHERE id = ?", (c_id,))
                pruned_ids.append(c_id)
                self._delete_character_media(c_id)

            if pruned_ids:
                conn.commit()
        finally:
            conn.close()

        return pruned_ids

    # ------------------------------------------------------------------
    # Personas & Dynamic Player States
    # ------------------------------------------------------------------

    def create_persona(
        self,
        draft: PersonaCreatePayload,
        owner_id: str,
        persona_id: str | None = None,
    ) -> PersonaRecord:
        """Create a new user persona in the master gallery."""
        p_id = persona_id or f"persona_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        equipped_json = json.dumps([it.model_dump() for it in draft.equipped])
        inventory_json = json.dumps([it.model_dump() for it in draft.inventory])
        lore_json = json.dumps([entry.model_dump() for entry in draft.lore_entries])
        tags_json = json.dumps(draft.tags or [])
        features_json = json.dumps(draft.distinctive_features or [])

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO personas (
                    id, owner_id, name, species, age, age_is_secret, sex, pronouns,
                    persona_bio, tags_json, build_and_height, distinctive_features_json,
                    physical_appearance, equipped_json, inventory_json, lore_entries_json,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    p_id,
                    owner_id,
                    draft.name.strip(),
                    (draft.species or "Human").strip(),
                    draft.age.strip() if draft.age else None,
                    1 if draft.age_is_secret else 0,
                    (draft.sex or "").strip(),
                    (draft.pronouns or "").strip(),
                    (draft.persona_bio or "").strip(),
                    tags_json,
                    (draft.build_and_height or "").strip(),
                    features_json,
                    draft.physical_appearance.strip(),
                    equipped_json,
                    inventory_json,
                    lore_json,
                    now,
                    now,
                ),
            )
            conn.commit()
            created = self.get_persona(p_id, owner_id=owner_id)
            if not created:
                raise RuntimeError(f"Failed to retrieve created persona '{p_id}'")
            return created
        finally:
            conn.close()

    @staticmethod
    def _ensure_default_persona_for_user_conn(conn: sqlite3.Connection, user_id: str) -> PersonaRecord:
        """Ensure the deterministic default 'User' persona exists for the specified user."""
        def_id = default_persona_id_for_user(user_id)
        r = conn.execute("SELECT * FROM personas WHERE id = ?", (def_id,)).fetchone()
        if r:
            return CantinaRepository._row_to_persona_record(r)

        default_persona = get_default_persona(owner_id=user_id)
        conn.execute(
            """
            INSERT OR IGNORE INTO personas (
                id, owner_id, name, species, age, age_is_secret, sex, pronouns,
                persona_bio, tags_json, build_and_height, distinctive_features_json,
                physical_appearance, equipped_json, inventory_json, lore_entries_json,
                created_at, updated_at
            )
            VALUES (?, ?, ?, 'Human', NULL, 0, '', '', '', '[]', '', '[]', '', '[]', '[]', '[]', ?, ?)
            """,
            (
                def_id,
                user_id,
                default_persona.name,
                default_persona.created_at,
                default_persona.updated_at,
            ),
        )
        return default_persona

    def ensure_default_persona_for_user(self, user_id: str) -> PersonaRecord:
        """Public helper to retrieve or ensure a user's default persona."""
        conn = self._connect()
        try:
            p = self._ensure_default_persona_for_user_conn(conn, user_id)
            conn.commit()
            return p
        finally:
            conn.close()

    def get_persona(
        self,
        persona_id: str,
        owner_id: str | None = None,
    ) -> PersonaRecord | None:
        """Fetch a single persona by ID, enforcing ownership if provided."""
        conn = self._connect()
        try:
            if owner_id is not None:
                if persona_id == default_persona_id_for_user(owner_id) or persona_id == DEFAULT_PERSONA_ID:
                    p = self._ensure_default_persona_for_user_conn(conn, owner_id)
                    conn.commit()
                    return p
                r = conn.execute(
                    "SELECT * FROM personas WHERE id = ? AND owner_id = ?",
                    (persona_id, owner_id),
                ).fetchone()
            else:
                r = conn.execute(
                    "SELECT * FROM personas WHERE id = ?",
                    (persona_id,),
                ).fetchone()
            if not r:
                return None
            return self._row_to_persona_record(r)
        finally:
            conn.close()

    def list_personas(
        self,
        owner_id: str | None = None,
    ) -> list[PersonaRecord]:
        """List all personas, filtered by owner_id if supplied, always ensuring user's default persona exists."""
        conn = self._connect()
        try:
            if owner_id is not None:
                def_p = self._ensure_default_persona_for_user_conn(conn, owner_id)
                conn.commit()
                rows = conn.execute(
                    "SELECT * FROM personas WHERE owner_id = ? ORDER BY (CASE WHEN id = ? THEN 1 ELSE 0 END), created_at DESC",
                    (owner_id, def_p.id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM personas ORDER BY (CASE WHEN id LIKE 'persona_default_%' THEN 1 ELSE 0 END), created_at DESC"
                ).fetchall()
            return [self._row_to_persona_record(r) for r in rows]
        finally:
            conn.close()

    def update_persona(
        self,
        persona_id: str,
        payload: PersonaUpdatePayload,
        owner_id: str | None = None,
    ) -> PersonaRecord:
        """Update an existing master persona."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be modified.")
        existing = self.get_persona(persona_id, owner_id=owner_id)
        if not existing:
            raise KeyError(f"Persona '{persona_id}' not found")

        now = utc_now_iso()
        name = payload.name.strip() if payload.name is not None else existing.name
        species = (
            payload.species.strip()
            if payload.species is not None
            else getattr(existing, "species", "Human")
        )
        age = payload.age.strip() if payload.age is not None else existing.age
        age_is_secret = (
            (1 if payload.age_is_secret else 0)
            if payload.age_is_secret is not None
            else (1 if existing.age_is_secret else 0)
        )
        sex = (
            payload.sex.strip()
            if payload.sex is not None
            else getattr(existing, "sex", "")
        )
        pronouns = (
            payload.pronouns.strip()
            if payload.pronouns is not None
            else getattr(existing, "pronouns", "")
        )
        persona_bio = (
            payload.persona_bio.strip()
            if payload.persona_bio is not None
            else getattr(existing, "persona_bio", "")
        )
        tags = (
            payload.tags
            if payload.tags is not None
            else getattr(existing, "tags", [])
        )
        build_and_height = (
            payload.build_and_height.strip()
            if payload.build_and_height is not None
            else getattr(existing, "build_and_height", "")
        )
        distinctive_features = (
            payload.distinctive_features
            if payload.distinctive_features is not None
            else getattr(existing, "distinctive_features", [])
        )
        physical_appearance = (
            payload.physical_appearance.strip()
            if payload.physical_appearance is not None
            else existing.physical_appearance
        )
        equipped = (
            [it.model_dump() for it in payload.equipped]
            if payload.equipped is not None
            else [it.model_dump() for it in existing.equipped]
        )
        inventory = (
            [it.model_dump() for it in payload.inventory]
            if payload.inventory is not None
            else [it.model_dump() for it in existing.inventory]
        )
        lore = (
            [entry.model_dump() for entry in payload.lore_entries]
            if payload.lore_entries is not None
            else [entry.model_dump() for entry in existing.lore_entries]
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE personas
                SET name = ?, species = ?, age = ?, age_is_secret = ?, sex = ?, pronouns = ?,
                    persona_bio = ?, tags_json = ?, build_and_height = ?, distinctive_features_json = ?,
                    physical_appearance = ?, equipped_json = ?, inventory_json = ?, lore_entries_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    species,
                    age,
                    age_is_secret,
                    sex,
                    pronouns,
                    persona_bio,
                    json.dumps(tags),
                    build_and_height,
                    json.dumps(distinctive_features),
                    physical_appearance,
                    json.dumps(equipped),
                    json.dumps(inventory),
                    json.dumps(lore),
                    now,
                    persona_id,
                ),
            )
            conn.commit()
            updated = self.get_persona(persona_id, owner_id=owner_id)
            if not updated:
                raise RuntimeError(f"Failed to retrieve updated persona '{persona_id}'")
            return updated
        finally:
            conn.close()

    def delete_persona(
        self,
        persona_id: str,
        owner_id: str | None = None,
    ) -> bool:
        """Delete a persona from the master gallery. Campaigns retain their snapshots."""
        if is_default_persona_id(persona_id):
            raise ValueError("The default 'User' persona is hard-coded and cannot be deleted.")
        conn = self._connect()
        try:
            if owner_id is not None:
                res = conn.execute(
                    "DELETE FROM personas WHERE id = ? AND owner_id = ?",
                    (persona_id, owner_id),
                )
            else:
                res = conn.execute(
                    "DELETE FROM personas WHERE id = ?",
                    (persona_id,),
                )
            conn.commit()
            return res.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def _row_to_persona_record(r: sqlite3.Row) -> PersonaRecord:
        r_keys = r.keys()
        equipped_raw = json.loads(
            r["equipped_json"] if "equipped_json" in r_keys and r["equipped_json"] else "[]"
        )
        inventory_raw = json.loads(
            r["inventory_json"] if "inventory_json" in r_keys and r["inventory_json"] else "[]"
        )
        lore_raw = json.loads(
            r["lore_entries_json"] if "lore_entries_json" in r_keys and r["lore_entries_json"] else "[]"
        )
        tags_raw = json.loads(
            r["tags_json"] if "tags_json" in r_keys and r["tags_json"] else "[]"
        )
        features_raw = json.loads(
            r["distinctive_features_json"] if "distinctive_features_json" in r_keys and r["distinctive_features_json"] else "[]"
        )
        return PersonaRecord(
            id=r["id"],
            owner_id=r["owner_id"] if "owner_id" in r_keys else None,
            name=r["name"],
            species=r["species"] if "species" in r_keys and r["species"] else "Human",
            age=r["age"] if "age" in r_keys else None,
            age_is_secret=bool(r["age_is_secret"]) if "age_is_secret" in r_keys else True,
            sex=r["sex"] if "sex" in r_keys and r["sex"] else "",
            pronouns=r["pronouns"] if "pronouns" in r_keys and r["pronouns"] else "",
            persona_bio=r["persona_bio"] if "persona_bio" in r_keys and r["persona_bio"] else "",
            tags=[str(t) for t in tags_raw if str(t).strip()],
            build_and_height=r["build_and_height"] if "build_and_height" in r_keys and r["build_and_height"] else "",
            distinctive_features=[str(f) for f in features_raw if str(f).strip()],
            physical_appearance=r["physical_appearance"] if "physical_appearance" in r_keys else "",
            equipped=[PersonaItemInstance.model_validate(it) for it in equipped_raw],
            inventory=[PersonaItemInstance.model_validate(it) for it in inventory_raw],
            lore_entries=[PersonaLoreEntry.model_validate(entry) for entry in lore_raw],
            created_at=r["created_at"],
            updated_at=r["updated_at"] if "updated_at" in r_keys else r["created_at"],
        )

    def get_campaign_persona_turn_state(self, turn_id: str) -> PersonaTurnStateSnapshot | None:
        """Retrieve the player's dynamic inventory & equipped items for a turn."""
        conn = self._connect()
        try:
            r = conn.execute(
                "SELECT equipped_json, inventory_json FROM persona_turn_states WHERE turn_id = ?",
                (turn_id,),
            ).fetchone()
            if not r:
                return None
            equipped_raw = json.loads(r["equipped_json"] or "[]")
            inventory_raw = json.loads(r["inventory_json"] or "[]")
            return PersonaTurnStateSnapshot(
                turn_id=turn_id,
                equipped=[PersonaItemInstance.model_validate(it) for it in equipped_raw],
                inventory=[PersonaItemInstance.model_validate(it) for it in inventory_raw],
            )
        finally:
            conn.close()

    def save_campaign_persona_turn_state(
        self,
        turn_id: str,
        equipped: list[PersonaItemInstance],
        inventory: list[PersonaItemInstance],
    ) -> None:
        """Persist or update the player's turn-indexed dynamic inventory state."""
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                VALUES (?, ?, ?)
                ON CONFLICT(turn_id) DO UPDATE SET
                    equipped_json = excluded.equipped_json,
                    inventory_json = excluded.inventory_json
                """,
                (
                    turn_id,
                    json.dumps([it.model_dump() for it in equipped]),
                    json.dumps([it.model_dump() for it in inventory]),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Campaigns & Branching Turn Tree
    # ------------------------------------------------------------------

    def register_campaign_character(
        self,
        campaign_id: str,
        character_id: str,
        joined_at_turn_id: str | None = None,
    ) -> None:
        """Record that character_id has been used in campaign_id."""
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO campaign_characters (
                    campaign_id, character_id, joined_at_turn_id, created_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (campaign_id, character_id, joined_at_turn_id, now),
            )
            conn.commit()
        finally:
            conn.close()

    def create_campaign(
        self,
        *,
        name: str,
        world_id: str,
        character_id: str,
        character_ids: list[str] | None = None,
        character_locations: dict[str, str] | None = None,
        opening_prose: str | None = None,
        campaign_id: str | None = None,
        persona_id: str | None = None,
        prompt_preset_id: str | None = None,
        owner_id: str | None = None,
        actor_id: str | None = None,
        skip_turn_0_cognition: bool = True,
    ) -> CampaignRecord:
        """Create a new campaign and initialize Turn 0 (opening scene snapshot)."""
        camp_id = campaign_id or f"camp_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        world = self.get_world(world_id, owner_id=owner_id)
        character = self.get_character(character_id, owner_id=owner_id)

        persona: PersonaRecord | None = None
        persona_snapshot_json: str | None = None
        if persona_id:
            persona = self.get_persona(persona_id, owner_id=owner_id)
        if not persona:
            if owner_id:
                persona = self.ensure_default_persona_for_user(owner_id)
                persona_id = persona.id
            else:
                conn = self._connect()
                try:
                    first_user = conn.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").fetchone()
                finally:
                    conn.close()
                if first_user:
                    persona = self.ensure_default_persona_for_user(first_user["id"])
                    persona_id = persona.id
                else:
                    persona = get_default_persona(owner_id="default_user")
                    persona_id = None
        persona_snapshot_json = persona.model_dump_json() if persona else None

        all_char_ids: list[str] = [character_id]
        for cid in character_ids or []:
            if cid not in all_char_ids:
                all_char_ids.append(cid)

        extra_characters = [
            self.get_character(cid, owner_id=owner_id)
            for cid in all_char_ids
            if cid != character_id
        ]

        start_loc = next(
            (loc for loc in world.locations if loc.is_starting_location),
            world.locations[0],
        )
        loc_map = character_locations or {}
        primary_loc_id = loc_map.get(character.id, start_loc.id)

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO campaigns (id, owner_id, name, world_id, character_id, persona_id, persona_snapshot_json, active_leaf_turn_id, prompt_preset_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (camp_id, owner_id, name, world_id, character_id, persona_id, persona_snapshot_json, prompt_preset_id, now),
            )
            for cid in all_char_ids:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO campaign_characters (
                        campaign_id, character_id, joined_at_turn_id, created_at
                    )
                    VALUES (?, ?, NULL, ?)
                    """,
                    (camp_id, cid, now),
                )
            conn.commit()
        finally:
            conn.close()

        # Seed root turn (Turn 0) so every branch has a root state snapshot
        primary_loc = self.get_location(primary_loc_id)
        if opening_prose and opening_prose.strip():
            root_prose = opening_prose.strip()
        elif character.initial_message and character.initial_message.strip():
            root_prose = (
                character.initial_message.strip()
                .replace("{location_name}", primary_loc.name)
                .replace("{location_summary}", primary_loc.summary)
                .replace("{location_description}", primary_loc.description)
                .replace("{world_name}", world.name)
                .replace("{character_name}", character.name)
            )
        else:
            root_prose = (
                f"*{character.name} stands inside {primary_loc.name}. {primary_loc.description}*\n\n"
                f"\"You're late,\" {character.name} says quietly, eyes scanning the room."
            )

        root_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
        root_snapshot = WorldStateSnapshot(
            turn_id=root_turn_id,
            world_timestamp=world.global_rules.starting_timestamp,
            active_location_id=primary_loc_id,
            scene_flags=["Scene Opening"],
            campaign_elapsed_minutes=0,
        )
        root_care = seed_initial_care_state(
            character.baseline_psyche,
            initial_elapsed_minutes=0,
        )
        root_char_state = CharacterStateSnapshot(
            turn_id=root_turn_id,
            character_id=character.id,
            current_location_id=primary_loc_id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            equipped=list(character.equipped),
            inventory=list(character.inventory),
            care_state=root_care,
        )
        extra_states = [
            CharacterStateSnapshot(
                turn_id=root_turn_id,
                character_id=extra_char.id,
                current_location_id=loc_map.get(extra_char.id, start_loc.id),
                mood_label=extra_char.baseline_psyche.mood_label,
                valence=extra_char.baseline_psyche.valence,
                arousal=extra_char.baseline_psyche.arousal,
                active_want=extra_char.baseline_psyche.default_want,
                active_plan=extra_char.baseline_psyche.default_plan,
                relationship_notes={"user": "Acquaintance / Uncertain trust"},
                equipped=list(extra_char.equipped),
                inventory=list(extra_char.inventory),
                care_state=seed_initial_care_state(
                    extra_char.baseline_psyche,
                    initial_elapsed_minutes=0,
                ),
            )
            for extra_char in extra_characters
        ]

        if skip_turn_0_cognition:
            root_cognition = CognitionBlock(skipped=True)
            root_cognitions = {}
        else:
            root_cognition = CognitionBlock(
                recall=f"Standing in {primary_loc.name}, keeping watch.",
                feeling=character.baseline_psyche.mood_label,
                valence=character.baseline_psyche.valence,
                arousal=character.baseline_psyche.arousal,
                want=character.baseline_psyche.default_want,
                plan=character.baseline_psyche.default_plan,
            )
            root_cognitions = {character.id: root_cognition}
            for extra_char in extra_characters:
                if loc_map.get(extra_char.id, start_loc.id) == primary_loc_id:
                    root_cognitions[extra_char.id] = CognitionBlock(
                        recall=f"Standing in {primary_loc.name}, observing.",
                        feeling=extra_char.baseline_psyche.mood_label,
                        valence=extra_char.baseline_psyche.valence,
                        arousal=extra_char.baseline_psyche.arousal,
                        want=extra_char.baseline_psyche.default_want,
                        plan=extra_char.baseline_psyche.default_plan,
                    )

        cognition_names = {character.id: character.name, **{c.id: c.name for c in extra_characters}}
        effective_actor_id = actor_id or character.id
        speaker_list = [
            cid for cid in ([character.id] + [s.character_id for s in extra_states if s.current_location_id == primary_loc_id])
        ]

        self.save_turn_node(
            turn_id=root_turn_id,
            campaign_id=camp_id,
            parent_turn_id=None,
            depth_index=0,
            user_message="[Scene Start]",
            actor_id=effective_actor_id,
            raw_prose=root_prose,
            cognition=root_cognition,
            cognitions=root_cognitions,
            cognition_character_names=cognition_names,
            pre_turn=PreTurnAnalysis(
                active_speaker_id=character.id if effective_actor_id != "__narrator__" else (speaker_list[0] if speaker_list else character.id),
                speaker_order=speaker_list,
            ),
            world_snapshot=root_snapshot,
            character_state=root_char_state,
            extra_character_states=extra_states,
            recalled_items=[],
        )
        if persona:
            self.save_campaign_persona_turn_state(
                root_turn_id,
                persona.equipped,
                persona.inventory,
            )
        return self.get_campaign(camp_id)

    def add_character_to_campaign(
        self,
        campaign_id: str,
        character_id: str,
        location_id: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Register an additional character in an active campaign and initialize their state at the current leaf turn."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise RuntimeError(f"Campaign '{campaign_id}' has no active leaf turn")
        char = self.get_character(character_id, owner_id=owner_id)
        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        target_loc_id = location_id or leaf_turn.world_snapshot.active_location_id
        # Validate location exists
        self.get_location(target_loc_id)

        joined_care = seed_initial_care_state(
            char.baseline_psyche,
            initial_elapsed_minutes=leaf_turn.world_snapshot.campaign_elapsed_minutes,
        )
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO campaign_characters (
                    campaign_id, character_id, joined_at_turn_id, created_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (campaign_id, char.id, leaf_turn.id, now),
            )
            conn.execute(
                """
                INSERT INTO character_states (
                    turn_id, character_id, current_location_id, mood_label,
                    valence, arousal, active_want, active_plan, relationship_notes_json,
                    equipped_json, inventory_json, affective_state_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(turn_id, character_id) DO UPDATE SET
                    current_location_id = excluded.current_location_id
                """,
                (
                    leaf_turn.id,
                    char.id,
                    target_loc_id,
                    char.baseline_psyche.mood_label,
                    char.baseline_psyche.valence,
                    char.baseline_psyche.arousal,
                    char.baseline_psyche.default_want,
                    char.baseline_psyche.default_plan,
                    json.dumps({"user": "Acquaintance / Uncertain trust"}),
                    dump_items_json(char.equipped),
                    dump_items_json(char.inventory),
                    _dump_care_state_json(joined_care),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def list_campaigns(self, owner_id: str | None = None) -> list[CampaignRecord]:
        conn = self._connect()
        try:
            if owner_id is not None:
                rows = conn.execute(
                    "SELECT id FROM campaigns WHERE owner_id = ? ORDER BY created_at DESC",
                    (owner_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT id FROM campaigns ORDER BY created_at DESC").fetchall()
        finally:
            conn.close()
        return [self.get_campaign(r["id"]) for r in rows]

    def get_campaign(
        self, campaign_id: str, owner_id: str | None = None
    ) -> CampaignRecord:
        conn = self._connect()
        try:
            if owner_id is not None:
                r = conn.execute(
                    "SELECT * FROM campaigns WHERE id = ? AND owner_id = ?",
                    (campaign_id, owner_id),
                ).fetchone()
            else:
                r = conn.execute(
                    "SELECT * FROM campaigns WHERE id = ?", (campaign_id,)
                ).fetchone()
            if not r:
                raise KeyError(f"Campaign '{campaign_id}' not found")
            cc_rows = conn.execute(
                "SELECT character_id FROM campaign_characters WHERE campaign_id = ? ORDER BY created_at ASC",
                (campaign_id,),
            ).fetchall()
            participant_ids = [row["character_id"] for row in cc_rows]
            if r["character_id"] not in participant_ids:
                participant_ids.insert(0, r["character_id"])
            preset_id = r["prompt_preset_id"] if "prompt_preset_id" in r.keys() else None
            persona_id = r["persona_id"] if "persona_id" in r.keys() else None
            persona_snapshot = None
            if "persona_snapshot_json" in r.keys() and r["persona_snapshot_json"]:
                try:
                    persona_snapshot = PersonaRecord.model_validate_json(r["persona_snapshot_json"])
                except Exception:
                    pass
            if persona_snapshot is None:
                default_p = get_default_persona(owner_id=r["owner_id"] if "owner_id" in r.keys() and r["owner_id"] else "default_user")
                persona_snapshot = default_p
                if not persona_id:
                    persona_id = default_p.id
            return CampaignRecord(
                id=r["id"],
                name=r["name"],
                world_id=r["world_id"],
                character_id=r["character_id"],
                persona_id=persona_id,
                persona_snapshot=persona_snapshot,
                participant_character_ids=participant_ids,
                active_leaf_turn_id=r["active_leaf_turn_id"],
                prompt_preset_id=preset_id,
                created_at=r["created_at"],
            )
        finally:
            conn.close()

    def set_campaign_prompt_preset(
        self,
        campaign_id: str,
        prompt_preset_id: str | None,
        owner_id: str | None = None,
    ) -> CampaignRecord:
        """Assign or clear an active prompt preset on a specific campaign."""
        conn = self._connect()
        try:
            if owner_id is not None:
                r = conn.execute(
                    "SELECT id FROM campaigns WHERE id = ? AND owner_id = ?",
                    (campaign_id, owner_id),
                ).fetchone()
            else:
                r = conn.execute("SELECT id FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
            if not r:
                raise KeyError(f"Campaign '{campaign_id}' not found")
            conn.execute(
                "UPDATE campaigns SET prompt_preset_id = ? WHERE id = ?",
                (prompt_preset_id, campaign_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_campaign(campaign_id, owner_id=owner_id)

    # ------------------------------------------------------------------
    # Prompt Presets Management
    # ------------------------------------------------------------------

    def list_prompt_presets(self, user_id: str | None = None) -> list[PromptPresetRecord]:
        """List all available prompt presets (built-in system presets plus user-owned presets)."""
        conn = self._connect()
        try:
            if user_id:
                rows = conn.execute(
                    """
                    SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                    FROM prompt_presets
                    WHERE owner_id IS NULL OR owner_id = ?
                    ORDER BY is_builtin DESC, name ASC
                    """,
                    (user_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                    FROM prompt_presets
                    WHERE owner_id IS NULL
                    ORDER BY is_builtin DESC, name ASC
                    """
                ).fetchall()

            presets: list[PromptPresetRecord] = []
            for r in rows:
                p_dict = json.loads(r["prompts_json"] or "{}")
                merged = {**FACTORY_DEFAULT_PROMPTS, **p_dict}
                presets.append(
                    PromptPresetRecord(
                        id=r["id"],
                        owner_id=r["owner_id"],
                        name=r["name"],
                        description=r["description"] or "",
                        is_builtin=bool(r["is_builtin"]),
                        prompts=merged,
                        created_at=r["created_at"],
                        updated_at=r["updated_at"],
                    )
                )
            return presets
        finally:
            conn.close()

    def get_prompt_preset(self, preset_id: str) -> PromptPresetRecord | None:
        """Fetch a single prompt preset by ID, populated with merged fallback prompts."""
        conn = self._connect()
        try:
            r = conn.execute(
                """
                SELECT id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at
                FROM prompt_presets
                WHERE id = ?
                """,
                (preset_id,),
            ).fetchone()
            if not r:
                return None
            p_dict = json.loads(r["prompts_json"] or "{}")
            merged = {**FACTORY_DEFAULT_PROMPTS, **p_dict}
            return PromptPresetRecord(
                id=r["id"],
                owner_id=r["owner_id"],
                name=r["name"],
                description=r["description"] or "",
                is_builtin=bool(r["is_builtin"]),
                prompts=merged,
                created_at=r["created_at"],
                updated_at=r["updated_at"],
            )
        finally:
            conn.close()

    def create_prompt_preset(
        self,
        *,
        owner_id: str | None,
        name: str,
        description: str = "",
        prompts: dict[str, str] | None = None,
        is_builtin: bool = False,
        preset_id: str | None = None,
    ) -> PromptPresetRecord:
        """Create a new custom prompt preset."""
        pid = preset_id or f"preset_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        merged = {**FACTORY_DEFAULT_PROMPTS, **(prompts or {})}
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO prompt_presets (id, owner_id, name, description, is_builtin, prompts_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, owner_id, name, description, 1 if is_builtin else 0, json.dumps(merged), now, now),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=pid,
            owner_id=owner_id,
            name=name,
            description=description,
            is_builtin=is_builtin,
            prompts=merged,
            created_at=now,
            updated_at=now,
        )

    def update_prompt_preset(
        self,
        preset_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        prompts: dict[str, str] | None = None,
        user_id: str | None = None,
    ) -> PromptPresetRecord:
        """Update an existing prompt preset's metadata or prompt templates."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            raise KeyError(f"Preset '{preset_id}' not found")
        if existing.is_builtin:
            raise ValueError("Built-in presets cannot be edited directly. Clone or create a new custom preset instead.")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot modify a preset owned by another user.")

        new_name = name if name is not None else existing.name
        new_desc = description if description is not None else existing.description
        new_prompts = dict(existing.prompts)
        if prompts is not None:
            new_prompts.update(prompts)
        now = utc_now_iso()

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE prompt_presets
                SET name = ?, description = ?, prompts_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (new_name, new_desc, json.dumps(new_prompts), now, preset_id),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=preset_id,
            owner_id=existing.owner_id,
            name=new_name,
            description=new_desc,
            is_builtin=False,
            prompts=new_prompts,
            created_at=existing.created_at,
            updated_at=now,
        )

    def delete_prompt_preset(self, preset_id: str, user_id: str | None = None) -> bool:
        """Delete a custom prompt preset. Built-in presets are protected."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            return False
        if existing.is_builtin:
            raise ValueError("Built-in system presets cannot be deleted.")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot delete a preset owned by another user.")

        conn = self._connect()
        try:
            conn.execute("UPDATE user_model_settings SET active_prompt_preset_id = NULL WHERE active_prompt_preset_id = ?", (preset_id,))
            conn.execute("UPDATE campaigns SET prompt_preset_id = NULL WHERE prompt_preset_id = ?", (preset_id,))
            conn.execute("DELETE FROM prompt_presets WHERE id = ?", (preset_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    def set_user_active_prompt_preset(
        self, user_id: str, preset_id: str | None
    ) -> None:
        """Set or clear the active prompt preset for a user without modifying other settings."""
        conn = self._connect()
        try:
            now = utc_now_iso()
            conn.execute(
                """
                INSERT INTO user_model_settings (user_id, active_prompt_preset_id, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    active_prompt_preset_id = excluded.active_prompt_preset_id,
                    updated_at = excluded.updated_at
                """,
                (user_id, preset_id, now),
            )
            conn.commit()
        finally:
            conn.close()

    def reset_prompt_preset(self, preset_id: str, user_id: str | None = None) -> PromptPresetRecord:
        """Reset a custom prompt preset's templates back to the factory defaults."""
        existing = self.get_prompt_preset(preset_id)
        if not existing:
            raise KeyError(f"Preset '{preset_id}' not found")
        if user_id and existing.owner_id and existing.owner_id != user_id:
            raise PermissionError("Cannot reset a preset owned by another user.")

        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE prompt_presets
                SET prompts_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(FACTORY_DEFAULT_PROMPTS), now, preset_id),
            )
            conn.commit()
        finally:
            conn.close()

        return PromptPresetRecord(
            id=preset_id,
            owner_id=existing.owner_id,
            name=existing.name,
            description=existing.description,
            is_builtin=existing.is_builtin,
            prompts=dict(FACTORY_DEFAULT_PROMPTS),
            created_at=existing.created_at,
            updated_at=now,
        )

    def resolve_effective_prompts(
        self,
        user_id: str | None = None,
        campaign_id: str | None = None,
    ) -> dict[str, str]:
        """Resolve effective prompt templates for an inference call with guaranteed fallback."""
        preset_id: str | None = None

        # 1. Campaign-level override takes precedence
        if campaign_id:
            try:
                camp = self.get_campaign(campaign_id)
                if camp.prompt_preset_id:
                    preset_id = camp.prompt_preset_id
            except Exception:
                pass

        # 2. User active preset
        if not preset_id and user_id:
            try:
                ums = self.get_user_model_settings(user_id)
                if ums and ums.active_prompt_preset_id:
                    preset_id = ums.active_prompt_preset_id
            except Exception:
                pass

        # 3. Fallback to default
        if not preset_id:
            preset_id = "builtin-default"

        preset = self.get_prompt_preset(preset_id)
        if preset:
            return {**FACTORY_DEFAULT_PROMPTS, **preset.prompts}
        return dict(FACTORY_DEFAULT_PROMPTS)

    def delete_campaign(
        self, campaign_id: str, owner_id: str | None = None
    ) -> None:
        """Delete a campaign, its entire turn tree, episodic vectors, and campaign-improvised locations."""
        conn = self._connect()
        try:
            if owner_id is not None:
                row = conn.execute(
                    "SELECT id FROM campaigns WHERE id = ? AND owner_id = ?",
                    (campaign_id, owner_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT id FROM campaigns WHERE id = ?", (campaign_id,)
                ).fetchone()
            if not row:
                raise KeyError(f"Campaign '{campaign_id}' not found")

            # 1. Remove episodic & campaign-scoped vector entries (including improvised location lore vectors)
            conn.execute(
                "DELETE FROM vector_entries WHERE campaign_id = ?",
                (campaign_id,),
            )
            conn.execute(
                """
                DELETE FROM vector_entries
                WHERE location_id IN (
                    SELECT id FROM location_nodes
                    WHERE created_at_turn_id IN (
                        SELECT id FROM turn_nodes WHERE campaign_id = ?
                    )
                )
                """,
                (campaign_id,),
            )

            # 2. Remove improvised spatial edges and locations created during this campaign's turns
            conn.execute(
                """
                DELETE FROM location_edges
                WHERE created_at_turn_id IN (
                    SELECT id FROM turn_nodes WHERE campaign_id = ?
                )
                """,
                (campaign_id,),
            )
            conn.execute(
                """
                DELETE FROM location_nodes
                WHERE created_at_turn_id IN (
                    SELECT id FROM turn_nodes WHERE campaign_id = ?
                )
                """,
                (campaign_id,),
            )

            # 3. Delete campaign (cascades turn_nodes, world_state_snapshots, character_states, episodic_chunks, campaign_characters)
            conn.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
            conn.commit()
        finally:
            conn.close()

    def save_turn_node(
        self,
        *,
        turn_id: str,
        campaign_id: str,
        parent_turn_id: str | None,
        depth_index: int,
        user_message: str,
        actor_id: str,
        raw_prose: str,
        cognition: CognitionBlock,
        cognitions: dict[str, CognitionBlock] | None = None,
        cognition_character_names: dict[str, str] | None = None,
        whispers: list[CharacterWhisper] | None = None,
        pre_turn: PreTurnAnalysis,
        world_snapshot: WorldStateSnapshot,
        character_state: CharacterStateSnapshot,
        recalled_items: list[RecalledMemoryItem],
        post_turn: PostTurnStateDelta | None = None,
        extra_character_states: list[CharacterStateSnapshot] | None = None,
    ) -> TurnNodeRecord:
        """Persist a new turn node + snapshots and advance campaign active_leaf_turn_id."""
        now = utc_now_iso()
        eff_cognitions = cognitions if cognitions is not None else (
            {actor_id: cognition} if actor_id != "__narrator__" and not cognition.skipped else {}
        )
        cognitions_payload = {
            "cognitions": {cid: c.model_dump() for cid, c in eff_cognitions.items()},
            "character_names": cognition_character_names or {},
        }
        whispers_payload = (
            json.dumps([w.model_dump() for w in whispers])
            if whispers
            else None
        )
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO turn_nodes (
                    id, campaign_id, parent_turn_id, depth_index, user_message,
                    actor_id, raw_prose, cognition_json, cognitions_json, whispers_json, pre_turn_json,
                    post_turn_json, recalled_items_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    campaign_id,
                    parent_turn_id,
                    depth_index,
                    user_message,
                    actor_id,
                    raw_prose,
                    cognition.model_dump_json(),
                    json.dumps(cognitions_payload),
                    whispers_payload,
                    pre_turn.model_dump_json(),
                    post_turn.model_dump_json() if post_turn else None,
                    json.dumps([item.model_dump() for item in recalled_items]),
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO world_state_snapshots (
                    turn_id, world_timestamp, active_location_id, scene_flags_json, campaign_elapsed_minutes
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    world_snapshot.world_timestamp,
                    world_snapshot.active_location_id,
                    json.dumps(world_snapshot.scene_flags),
                    int(world_snapshot.campaign_elapsed_minutes),
                ),
            )

            states_by_char: dict[str, CharacterStateSnapshot] = {
                character_state.character_id: character_state
            }
            for st in extra_character_states or []:
                states_by_char[st.character_id] = st

            if parent_turn_id is not None:
                parent_pts = conn.execute(
                    "SELECT equipped_json, inventory_json FROM persona_turn_states WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchone()
                if parent_pts:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                        VALUES (?, ?, ?)
                        """,
                        (turn_id, parent_pts["equipped_json"], parent_pts["inventory_json"]),
                    )

                parent_cs_rows = conn.execute(
                    "SELECT * FROM character_states WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchall()
                for pcs in parent_cs_rows:
                    cid = pcs["character_id"]
                    if cid not in states_by_char:
                        pcs_keys = pcs.keys()
                        states_by_char[cid] = CharacterStateSnapshot(
                            turn_id=turn_id,
                            character_id=cid,
                            current_location_id=pcs["current_location_id"],
                            mood_label=pcs["mood_label"],
                            valence=pcs["valence"],
                            arousal=pcs["arousal"],
                            active_want=pcs["active_want"],
                            active_plan=pcs["active_plan"],
                            relationship_notes=json.loads(pcs["relationship_notes_json"] or "{}"),
                            equipped=json.loads(pcs["equipped_json"] or "[]")
                            if "equipped_json" in pcs_keys
                            else [],
                            inventory=json.loads(pcs["inventory_json"] or "[]")
                            if "inventory_json" in pcs_keys
                            else [],
                            unlocked_persona_keys=(
                                json.loads(pcs["unlocked_persona_keys_json"] or "[]")
                                if "unlocked_persona_keys_json" in pcs_keys
                                else []
                            ),
                            persona_knowledge_provenance=(
                                json.loads(pcs["persona_knowledge_provenance_json"] or "{}")
                                if "persona_knowledge_provenance_json" in pcs_keys
                                else {}
                            ),
                            care_state=_parse_care_state_json(
                                pcs["affective_state_json"]
                                if "affective_state_json" in pcs_keys
                                else None
                            ),
                        )

            for st in states_by_char.values():
                conn.execute(
                    """
                    INSERT INTO character_states (
                        turn_id, character_id, current_location_id, mood_label,
                        valence, arousal, active_want, active_plan, relationship_notes_json,
                        equipped_json, inventory_json, unlocked_persona_keys_json,
                        persona_knowledge_provenance_json, affective_state_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        turn_id,
                        st.character_id,
                        st.current_location_id,
                        st.mood_label,
                        st.valence,
                        st.arousal,
                        st.active_want,
                        st.active_plan,
                        json.dumps(st.relationship_notes),
                        dump_items_json(st.equipped),
                        dump_items_json(st.inventory),
                        json.dumps(st.unlocked_persona_keys),
                        _dump_provenance_json(st.persona_knowledge_provenance),
                        _dump_care_state_json(st.care_state),
                    ),
                )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO campaign_characters (
                        campaign_id, character_id, joined_at_turn_id, created_at
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    (campaign_id, st.character_id, turn_id, now),
                )

            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (turn_id, campaign_id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_turn_node(turn_id)

    def update_turn_post_clerk(
        self,
        *,
        turn_id: str,
        post_turn: PostTurnStateDelta,
        updated_world_snapshot: WorldStateSnapshot,
        updated_character_state: CharacterStateSnapshot,
        extra_character_states: list[CharacterStateSnapshot] | None = None,
        updated_persona_turn_state: PersonaTurnStateSnapshot | None = None,
    ) -> TurnNodeRecord:
        """Commit Phase 4 Post-Turn Clerk mutations (clock advance, spatial move, affect notes)."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE;")
            parent_exists = conn.execute(
                "SELECT 1 FROM turn_nodes WHERE id = ?",
                (turn_id,),
            ).fetchone()
            if not parent_exists:
                conn.rollback()
                raise KeyError(
                    f"Turn node '{turn_id}' was deleted before Phase 5 Clerk commit"
                )
            conn.execute(
                "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                (post_turn.model_dump_json(), turn_id),
            )
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET world_timestamp = ?, active_location_id = ?, scene_flags_json = ?, campaign_elapsed_minutes = ?
                WHERE turn_id = ?
                """,
                (
                    updated_world_snapshot.world_timestamp,
                    updated_world_snapshot.active_location_id,
                    json.dumps(updated_world_snapshot.scene_flags),
                    int(updated_world_snapshot.campaign_elapsed_minutes),
                    turn_id,
                ),
            )
            if updated_persona_turn_state is not None:
                conn.execute(
                    """
                    INSERT INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                    VALUES (?, ?, ?)
                    ON CONFLICT(turn_id) DO UPDATE SET
                        equipped_json = excluded.equipped_json,
                        inventory_json = excluded.inventory_json
                    """,
                    (
                        turn_id,
                        json.dumps([it.model_dump() for it in updated_persona_turn_state.equipped]),
                        json.dumps([it.model_dump() for it in updated_persona_turn_state.inventory]),
                    ),
                )
            for st in [updated_character_state, *(extra_character_states or [])]:
                live_row = conn.execute(
                    "SELECT equipped_json, inventory_json, affective_state_json FROM character_states WHERE turn_id = ? AND character_id = ?",
                    (turn_id, st.character_id),
                ).fetchone()
                eff_care = st.care_state
                if live_row:
                    live_eq = coerce_item_list(json.loads(live_row["equipped_json"] or "[]"))
                    live_inv = coerce_item_list(json.loads(live_row["inventory_json"] or "[]"))
                    merged_eq, merged_inv = _merge_live_clerk_state_items(
                        st.equipped, st.inventory, live_eq, live_inv
                    )
                    if eff_care is None and "affective_state_json" in live_row.keys():
                        eff_care = _parse_care_state_json(live_row["affective_state_json"])
                else:
                    merged_eq, merged_inv = list(st.equipped), list(st.inventory)

                conn.execute(
                    """
                    INSERT INTO character_states (
                        turn_id, character_id, current_location_id, mood_label,
                        valence, arousal, active_want, active_plan,
                        relationship_notes_json, equipped_json, inventory_json,
                        unlocked_persona_keys_json, persona_knowledge_provenance_json,
                        affective_state_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(turn_id, character_id) DO UPDATE SET
                        current_location_id = excluded.current_location_id,
                        mood_label = excluded.mood_label,
                        valence = excluded.valence,
                        arousal = excluded.arousal,
                        active_want = excluded.active_want,
                        active_plan = excluded.active_plan,
                        relationship_notes_json = excluded.relationship_notes_json,
                        equipped_json = excluded.equipped_json,
                        inventory_json = excluded.inventory_json,
                        unlocked_persona_keys_json = excluded.unlocked_persona_keys_json,
                        persona_knowledge_provenance_json = excluded.persona_knowledge_provenance_json,
                        affective_state_json = excluded.affective_state_json
                    """,
                    (
                        turn_id,
                        st.character_id,
                        st.current_location_id,
                        st.mood_label,
                        st.valence,
                        st.arousal,
                        st.active_want,
                        st.active_plan,
                        json.dumps(st.relationship_notes),
                        dump_items_json(merged_eq),
                        dump_items_json(merged_inv),
                        json.dumps(st.unlocked_persona_keys),
                        _dump_provenance_json(st.persona_knowledge_provenance),
                        _dump_care_state_json(eff_care),
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_turn_node(turn_id)

    def save_episodic_chunk(
        self,
        *,
        campaign_id: str,
        world_id: str,
        character_id: str,
        start_turn_depth: int,
        end_turn_depth: int,
        leaf_turn_id: str,
        summary_text: str,
        keywords: list[str] | None = None,
        embedding: np.ndarray | None = None,
    ) -> EpisodicChunkRecord:
        """Persist a compressed episodic summary and index it in the VectorStore with branch anchor."""
        chunk_id = f"ep_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO episodic_chunks (
                    id, campaign_id, start_turn_depth, end_turn_depth,
                    leaf_turn_id, summary_text, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    campaign_id,
                    start_turn_depth,
                    end_turn_depth,
                    leaf_turn_id,
                    summary_text,
                    now,
                ),
            )
            self.vector_store.upsert_entry(
                entry_id=chunk_id,
                source_type="episodic_chunk",
                world_id=world_id,
                character_id=character_id,
                campaign_id=campaign_id,
                anchor_turn_id=leaf_turn_id,
                title=f"Episode Turns {start_turn_depth}-{end_turn_depth}",
                content=summary_text,
                keywords=keywords or [],
                embedding=embedding,
                conn=conn,
            )
            conn.commit()
        finally:
            conn.close()

        return EpisodicChunkRecord(
            id=chunk_id,
            campaign_id=campaign_id,
            start_turn_depth=start_turn_depth,
            end_turn_depth=end_turn_depth,
            leaf_turn_id=leaf_turn_id,
            summary_text=summary_text,
            created_at=now,
        )

    async def asave_episodic_chunk(
        self,
        *,
        campaign_id: str,
        world_id: str,
        character_id: str,
        start_turn_depth: int,
        end_turn_depth: int,
        leaf_turn_id: str,
        summary_text: str,
        keywords: list[str] | None = None,
        embedding: np.ndarray | None = None,
    ) -> EpisodicChunkRecord:
        """Asynchronously compute the embedding using embed_text and persist the episodic chunk."""
        title = f"Episode Turns {start_turn_depth}-{end_turn_depth}"
        vec = (
            embedding
            if embedding is not None
            else await embed_text(combine_entry_text(title, summary_text, keywords))
        )
        return self.save_episodic_chunk(
            campaign_id=campaign_id,
            world_id=world_id,
            character_id=character_id,
            start_turn_depth=start_turn_depth,
            end_turn_depth=end_turn_depth,
            leaf_turn_id=leaf_turn_id,
            summary_text=summary_text,
            keywords=keywords,
            embedding=vec,
        )

    def get_branch_episodic_chunks(
        self,
        campaign_id: str,
        valid_turn_ids: set[str],
    ) -> list[EpisodicChunkRecord]:
        """Return all episodic chunks anchored to turns in the active branch ancestor chain."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT * FROM episodic_chunks
                WHERE campaign_id = ?
                ORDER BY start_turn_depth ASC, created_at ASC
                """,
                (campaign_id,),
            ).fetchall()
        finally:
            conn.close()

        chunks: list[EpisodicChunkRecord] = []
        for r in rows:
            if r["leaf_turn_id"] in valid_turn_ids:
                chunks.append(
                    EpisodicChunkRecord(
                        id=r["id"],
                        campaign_id=r["campaign_id"],
                        start_turn_depth=r["start_turn_depth"],
                        end_turn_depth=r["end_turn_depth"],
                        leaf_turn_id=r["leaf_turn_id"],
                        summary_text=r["summary_text"],
                        created_at=r["created_at"],
                    )
                )
        return chunks

    def _populate_turn_character_states(
        self,
        conn: sqlite3.Connection,
        turns: list[TurnNodeRecord],
    ) -> list[TurnNodeRecord]:
        """Batch-load all character_states rows for the given turn nodes."""
        if not turns:
            return turns
        placeholders = ",".join("?" for _ in turns)
        cs_rows = conn.execute(
            f"SELECT * FROM character_states WHERE turn_id IN ({placeholders})",
            [t.id for t in turns],
        ).fetchall()
        states_by_turn: dict[str, dict[str, CharacterStateSnapshot]] = {}
        for r in cs_rows:
            tid = r["turn_id"]
            cid = r["character_id"]
            r_keys = r.keys()
            states_by_turn.setdefault(tid, {})[cid] = CharacterStateSnapshot(
                turn_id=tid,
                character_id=cid,
                current_location_id=r["current_location_id"],
                mood_label=r["mood_label"],
                valence=r["valence"],
                arousal=r["arousal"],
                active_want=r["active_want"],
                active_plan=r["active_plan"],
                relationship_notes=json.loads(r["relationship_notes_json"] or "{}"),
                equipped=json.loads(r["equipped_json"] or "[]")
                if "equipped_json" in r_keys
                else [],
                inventory=json.loads(r["inventory_json"] or "[]")
                if "inventory_json" in r_keys
                else [],
                unlocked_persona_keys=(
                    json.loads(r["unlocked_persona_keys_json"] or "[]")
                    if "unlocked_persona_keys_json" in r_keys
                    else []
                ),
                persona_knowledge_provenance=(
                    json.loads(r["persona_knowledge_provenance_json"] or "{}")
                    if "persona_knowledge_provenance_json" in r_keys
                    else {}
                ),
                care_state=_parse_care_state_json(
                    r["affective_state_json"]
                    if "affective_state_json" in r_keys
                    else None
                ),
            )
        for t in turns:
            t.character_states = states_by_turn.get(
                t.id,
                {t.character_state.character_id: t.character_state},
            )
        return turns

    def get_turn_node(self, turn_id: str) -> TurnNodeRecord:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                WHERE t.id = ?
                """,
                (turn_id,),
            ).fetchone()
            if not row:
                raise KeyError(f"Turn node '{turn_id}' not found")
            node = self._row_to_turn_node(row)
            return self._populate_turn_character_states(conn, [node])[0]
        finally:
            conn.close()

    def get_branch_turn_chain(self, leaf_turn_id: str) -> list[TurnNodeRecord]:
        """Walk the conversation tree from root to leaf_turn_id using a recursive CTE."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                WITH RECURSIVE branch_path AS (
                    SELECT id, parent_turn_id, depth_index
                    FROM turn_nodes
                    WHERE id = ?
                    UNION ALL
                    SELECT t.id, t.parent_turn_id, t.depth_index
                    FROM turn_nodes t
                    JOIN branch_path bp ON t.id = bp.parent_turn_id
                )
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM branch_path bp
                JOIN turn_nodes t ON t.id = bp.id
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                ORDER BY t.depth_index ASC
                """,
                (leaf_turn_id,),
            ).fetchall()
            turns = [self._row_to_turn_node(r) for r in rows]
            return self._populate_turn_character_states(conn, turns)
        finally:
            conn.close()

    def list_campaign_turn_nodes(self, campaign_id: str) -> list[TurnNodeRecord]:
        """Return all turn nodes across all branches for the Branch Tree visualizer."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                WHERE t.campaign_id = ?
                ORDER BY t.depth_index ASC, t.created_at ASC, t.rowid ASC
                """,
                (campaign_id,),
            ).fetchall()
            turns = [self._row_to_turn_node(r) for r in rows]
            return self._populate_turn_character_states(conn, turns)
        finally:
            conn.close()

    def delete_last_turn(
        self,
        campaign_id: str,
        turn_id: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Delete the last user message turn on the active branch, including all generated swipes and their subtrees."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        if turn_id is not None and turn_id != leaf_turn.id:
            target_turn = self.get_turn_node(turn_id)
            if target_turn.campaign_id != campaign_id:
                raise ValueError(
                    f"Turn '{turn_id}' does not belong to campaign '{campaign_id}'"
                )
            if target_turn.parent_turn_id != leaf_turn.parent_turn_id:
                raise ValueError(
                    f"Turn '{turn_id}' is not the active last message turn of campaign '{campaign_id}'"
                )

        if leaf_turn.parent_turn_id is None or leaf_turn.depth_index == 0:
            raise ValueError("Cannot delete the root opening scene turn")

        parent_id = leaf_turn.parent_turn_id
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                WITH RECURSIVE to_delete AS (
                    SELECT id FROM turn_nodes
                    WHERE campaign_id = ? AND parent_turn_id = ?
                    UNION ALL
                    SELECT t.id FROM turn_nodes t
                    JOIN to_delete td ON t.parent_turn_id = td.id
                )
                SELECT id FROM to_delete
                """,
                (campaign_id, parent_id),
            ).fetchall()
            deleted_ids = [r["id"] for r in rows]
            if not deleted_ids:
                raise KeyError(f"No turns found to delete under parent '{parent_id}'")

            placeholders = ",".join("?" for _ in deleted_ids)

            # 1. Roll back active_leaf_turn_id to parent_id
            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (parent_id, campaign_id),
            )

            # 2. Delete vector entries anchored to any of the deleted turns
            conn.execute(
                f"DELETE FROM vector_entries WHERE campaign_id = ? AND anchor_turn_id IN ({placeholders})",
                [campaign_id, *deleted_ids],
            )

            # 3. Delete turn_nodes (cascades world_state_snapshots, character_states, episodic_chunks)
            conn.execute(
                f"DELETE FROM turn_nodes WHERE id IN ({placeholders})",
                deleted_ids,
            )

            # 4. Delete improvised spatial edges & locations created during the deleted turns, and restore superseded edges
            conn.execute(
                f"UPDATE location_edges SET superseded_at_turn_id = NULL WHERE world_id = ? AND superseded_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"DELETE FROM location_edges WHERE world_id = ? AND created_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"DELETE FROM location_nodes WHERE world_id = ? AND created_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )

            # 5. Clean up campaign_characters that joined on a deleted turn and have no remaining state
            conn.execute(
                f"""
                DELETE FROM campaign_characters
                WHERE campaign_id = ?
                  AND joined_at_turn_id IN ({placeholders})
                  AND character_id != ?
                  AND NOT EXISTS (
                      SELECT 1 FROM character_states cs
                      JOIN turn_nodes t ON t.id = cs.turn_id
                      WHERE t.campaign_id = ? AND cs.character_id = campaign_characters.character_id
                  )
                """,
                [campaign_id, *deleted_ids, campaign.character_id, campaign_id],
            )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def override_campaign_location(
        self,
        campaign_id: str,
        location_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Override the active location on the current leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        target_loc = self.get_location(location_id)
        if target_loc.world_id != campaign.world_id:
            raise ValueError(
                f"Location '{location_id}' does not belong to world '{campaign.world_id}'"
            )

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        old_loc_id = leaf_turn.world_snapshot.active_location_id
        old_loc_name = ""
        try:
            old_loc_name = self.get_location(old_loc_id).name
        except KeyError:
            pass

        new_flags: list[str] = [f"At {target_loc.name}"]

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET active_location_id = ?, scene_flags_json = ?
                WHERE turn_id = ?
                """,
                (target_loc.id, json.dumps(new_flags), leaf_turn.id),
            )
            # Move characters who were present at old_loc_id (plus primary actor) to target_loc.id
            conn.execute(
                """
                UPDATE character_states
                SET current_location_id = ?
                WHERE turn_id = ? AND (current_location_id = ? OR character_id = ?)
                """,
                (target_loc.id, leaf_turn.id, old_loc_id, leaf_turn.actor_id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def toggle_campaign_item_equip(
        self,
        campaign_id: str,
        *,
        item: str = "",
        item_id: str | None = None,
        action: str,  # "equip" | "unequip" | "remove" | "add" | "update"
        target: str | None = None,  # "equipped" | "inventory"
        character_id: str | None = None,
        new_name: str | None | Any = UNSET,
        note: str | None | Any = UNSET,
        flags: list[ItemFlag] | None | Any = UNSET,
        lore_id: str | None | Any = UNSET,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Equip, unequip, remove, add, or update an item on the active leaf turn (atomic BEGIN IMMEDIATE)."""
        if action not in ("equip", "unequip", "remove", "add", "update"):
            raise ValueError(
                f"Invalid item equip action '{action}'. Must be 'equip', 'unequip', 'remove', 'add', or 'update'."
            )

        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        clean_item_id = (item_id or "").strip() or None
        raw_item_low = (item or "").strip().lower()
        clean_target = strip_item_location_affixes(item)
        target_key = normalize_item_key(clean_target) if clean_target else ""

        if not clean_item_id and not clean_target:
            raise ValueError("An item name or item_id is required.")

        def _find_idx(items: list[ItemInstance]) -> int | None:
            if clean_item_id:
                for idx, it in enumerate(items):
                    if it.id == clean_item_id:
                        return idx
            if clean_target:
                for idx, it in enumerate(items):
                    if (
                        it.name.strip().lower() == raw_item_low
                        or normalize_item_key(it.name) == target_key
                    ):
                        return idx
            return None

        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE;")
            camp_row = conn.execute(
                "SELECT active_leaf_turn_id FROM campaigns WHERE id = ?",
                (campaign_id,),
            ).fetchone()
            leaf_turn_id = (
                camp_row["active_leaf_turn_id"]
                if camp_row
                else campaign.active_leaf_turn_id
            )
            if not leaf_turn_id:
                raise ValueError(f"Campaign '{campaign_id}' has no active turn")

            turn_row = conn.execute(
                "SELECT id, parent_turn_id, actor_id FROM turn_nodes WHERE id = ?",
                (leaf_turn_id,),
            ).fetchone()
            if not turn_row:
                raise KeyError(f"Turn '{leaf_turn_id}' not found")

            turn_actor = turn_row["actor_id"]
            default_actor = (
                turn_actor
                if turn_actor and turn_actor != "__narrator__"
                else campaign.character_id
            )
            target_char_id = character_id or default_actor or campaign.character_id

            cs_row = conn.execute(
                "SELECT equipped_json, inventory_json FROM character_states WHERE turn_id = ? AND character_id = ?",
                (leaf_turn_id, target_char_id),
            ).fetchone()
            if not cs_row:
                raise ValueError(
                    f"Character '{target_char_id}' has no state at active turn '{leaf_turn_id}'."
                )

            equipped = coerce_item_list(json.loads(cs_row["equipped_json"] or "[]"))
            inventory = coerce_item_list(json.loads(cs_row["inventory_json"] or "[]"))

            def _resolve_metadata(
                base_item: ItemInstance | None,
            ) -> tuple[str, list[ItemFlag], str | None]:
                base_note = base_item.note if base_item else ""
                base_flags: list[ItemFlag] = list(base_item.flags) if base_item else []
                base_lore = base_item.lore_id if base_item else None

                next_note = (
                    base_note
                    if note is UNSET
                    else re.sub(r"\s+", " ", (note or "").strip())[:300]
                )

                if flags is UNSET and lore_id is UNSET:
                    return next_note, base_flags, base_lore

                if flags is not UNSET:
                    dedup_flags: list[ItemFlag] = []
                    for f in flags or []:
                        if f in VALID_ITEM_FLAGS and f not in dedup_flags:
                            dedup_flags.append(f)
                    if "artifact" in dedup_flags:
                        eff_lore = (
                            ((lore_id or "").strip() or None)
                            if lore_id is not UNSET
                            else base_lore
                        )
                        if not eff_lore:
                            raise ValueError(
                                "Flag 'artifact' requires linking a valid world artifact lore entry."
                            )
                    else:
                        if lore_id is not UNSET and (lore_id or "").strip():
                            eff_lore = (lore_id or "").strip()
                            dedup_flags.append("artifact")
                        else:
                            eff_lore = None
                    next_flags = dedup_flags
                    next_lore = eff_lore
                else:
                    # flags is UNSET, lore_id was explicitly provided
                    eff_lore = (lore_id or "").strip() or None
                    next_flags = [f for f in base_flags if f != "artifact"]
                    if eff_lore:
                        next_flags.append("artifact")
                    next_lore = eff_lore

                if next_lore:
                    _validate_world_artifact_lore_id(conn, campaign.world_id, next_lore)
                return next_note, next_flags, next_lore

            parent_backfill_target: tuple[ItemInstance, ItemInstance] | None = None

            if action == "equip":
                idx = _find_idx(inventory)
                if idx is not None:
                    moved = inventory.pop(idx)
                    cleaned_label = strip_item_location_affixes(moved.name) or moved.name
                    moved_clean = moved.model_copy(update={"name": cleaned_label[:160]})
                    moved_key = normalize_item_key(moved_clean.name)
                    existing_eq_idx = next(
                        (
                            i
                            for i, eq in enumerate(equipped)
                            if eq.id == moved_clean.id
                            or normalize_item_key(eq.name) == moved_key
                        ),
                        None,
                    )
                    if existing_eq_idx is None:
                        equipped.append(moved_clean)
                    else:
                        ex = equipped[existing_eq_idx]
                        if (moved_clean.note or moved_clean.flags or moved_clean.lore_id) and not (
                            ex.note or ex.flags or ex.lore_id
                        ):
                            equipped[existing_eq_idx] = moved_clean
                elif clean_target:
                    if not any(
                        normalize_item_key(eq.name) == target_key for eq in equipped
                    ):
                        equipped.append(ItemInstance(name=clean_target[:160]))
            elif action == "unequip":
                idx = _find_idx(equipped)
                if idx is not None:
                    moved = equipped.pop(idx)
                    cleaned_label = strip_item_location_affixes(moved.name) or moved.name
                    moved_clean = moved.model_copy(update={"name": cleaned_label[:160]})
                    moved_key = normalize_item_key(moved_clean.name)
                    existing_inv_idx = next(
                        (
                            i
                            for i, inv in enumerate(inventory)
                            if inv.id == moved_clean.id
                            or normalize_item_key(inv.name) == moved_key
                        ),
                        None,
                    )
                    if existing_inv_idx is None:
                        inventory.append(moved_clean)
                    else:
                        ex = inventory[existing_inv_idx]
                        if (moved_clean.note or moved_clean.flags or moved_clean.lore_id) and not (
                            ex.note or ex.flags or ex.lore_id
                        ):
                            inventory[existing_inv_idx] = moved_clean
                elif clean_target:
                    if not any(
                        normalize_item_key(inv.name) == target_key for inv in inventory
                    ):
                        inventory.append(ItemInstance(name=clean_target[:160]))
            elif action == "remove":
                if clean_item_id:
                    new_eq = [eq for eq in equipped if eq.id != clean_item_id]
                    new_inv = [it for it in inventory if it.id != clean_item_id]
                    if len(new_eq) == len(equipped) and len(new_inv) == len(inventory) and clean_target:
                        equipped = [
                            eq
                            for eq in equipped
                            if normalize_item_key(eq.name) != target_key
                            and eq.name.strip().lower() != raw_item_low
                        ]
                        inventory = [
                            it
                            for it in inventory
                            if normalize_item_key(it.name) != target_key
                            and it.name.strip().lower() != raw_item_low
                        ]
                    else:
                        equipped = new_eq
                        inventory = new_inv
                else:
                    equipped = [
                        eq
                        for eq in equipped
                        if normalize_item_key(eq.name) != target_key
                        and eq.name.strip().lower() != raw_item_low
                    ]
                    inventory = [
                        it
                        for it in inventory
                        if normalize_item_key(it.name) != target_key
                        and it.name.strip().lower() != raw_item_low
                    ]
            elif action == "add":
                if not clean_target:
                    raise ValueError("Item name cannot be empty.")
                next_note, next_flags, next_lore = _resolve_metadata(None)
                new_inst = ItemInstance(
                    name=clean_target[:160],
                    note=next_note,
                    flags=next_flags,
                    lore_id=next_lore,
                )
                taken_ids = {x.id for x in [*equipped, *inventory]}
                if new_inst.id in taken_ids:
                    new_inst = new_inst.model_copy(
                        update={"id": f"{new_inst.id}_{uuid.uuid4().hex[:6]}"}
                    )
                if target == "equipped":
                    if not any(
                        normalize_item_key(eq.name) == target_key for eq in equipped
                    ):
                        equipped.append(new_inst)
                else:
                    if not any(
                        normalize_item_key(inv.name) == target_key for inv in inventory
                    ):
                        inventory.append(new_inst)
            elif action == "update":
                search_order = (
                    [(equipped, "equipped"), (inventory, "inventory")]
                    if target != "inventory"
                    else [(inventory, "inventory"), (equipped, "equipped")]
                )
                found_bucket: list[ItemInstance] | None = None
                found_idx: int | None = None
                for bucket, _ in search_order:
                    idx = _find_idx(bucket)
                    if idx is not None:
                        found_bucket = bucket
                        found_idx = idx
                        break
                if found_bucket is None or found_idx is None:
                    raise ValueError(
                        f"Item '{item or item_id}' not found on character '{target_char_id}'."
                    )
                base_item = found_bucket[found_idx]
                updated_label = base_item.name
                if new_name is not UNSET and new_name is not None:
                    cleaned_new = strip_item_location_affixes(str(new_name))[:160]
                    if not cleaned_new:
                        raise ValueError("Item name cannot be empty.")
                    updated_label = cleaned_new
                next_note, next_flags, next_lore = _resolve_metadata(base_item)
                updated_item = base_item.model_copy(
                    update={
                        "name": updated_label,
                        "note": next_note,
                        "flags": next_flags,
                        "lore_id": next_lore,
                    }
                )
                found_bucket[found_idx] = updated_item
                parent_backfill_target = (base_item, updated_item)

            conn.execute(
                """
                UPDATE character_states
                SET equipped_json = ?, inventory_json = ?
                WHERE turn_id = ? AND character_id = ?
                """,
                (
                    dump_items_json(equipped),
                    dump_items_json(inventory),
                    leaf_turn_id,
                    target_char_id,
                ),
            )

            # Immediate-parent blank-metadata backfill so Swipe / Delete-Last-Turn retains newly attached item metadata
            parent_turn_id = turn_row["parent_turn_id"]
            if (
                parent_backfill_target is not None
                and parent_turn_id
                and (
                    parent_backfill_target[1].note
                    or parent_backfill_target[1].flags
                    or parent_backfill_target[1].lore_id
                )
            ):
                orig_it, upd_it = parent_backfill_target
                p_row = conn.execute(
                    "SELECT equipped_json, inventory_json FROM character_states WHERE turn_id = ? AND character_id = ?",
                    (parent_turn_id, target_char_id),
                ).fetchone()
                if p_row:
                    p_eq = coerce_item_list(json.loads(p_row["equipped_json"] or "[]"))
                    p_inv = coerce_item_list(json.loads(p_row["inventory_json"] or "[]"))
                    orig_key = normalize_item_key(orig_it.name)
                    parent_changed = False
                    for p_bucket in (p_eq, p_inv):
                        for i, p_it in enumerate(p_bucket):
                            if p_it.id == orig_it.id or normalize_item_key(p_it.name) == orig_key:
                                if not p_it.note and not p_it.flags and p_it.lore_id is None:
                                    p_bucket[i] = p_it.model_copy(
                                        update={
                                            "id": upd_it.id,
                                            "note": upd_it.note,
                                            "flags": list(upd_it.flags),
                                            "lore_id": upd_it.lore_id,
                                        }
                                    )
                                    parent_changed = True
                                break
                        if parent_changed:
                            break
                    if parent_changed:
                        conn.execute(
                            """
                            UPDATE character_states
                            SET equipped_json = ?, inventory_json = ?
                            WHERE turn_id = ? AND character_id = ?
                            """,
                            (
                                dump_items_json(p_eq),
                                dump_items_json(p_inv),
                                parent_turn_id,
                                target_char_id,
                            ),
                        )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def create_linked_location(
        self,
        campaign_id: str,
        *,
        from_location_id: str,
        name: str,
        description: str,
        environmental_tags: list[str],
        compass_direction: str,
        travel_minutes: int,
        summary: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Manually create a new room linked to from_location_id, bound to the active leaf turn (branch-safe).

        Respects the 8-neighbor cap: if from_location_id is full, a directional Passage Hub is used.
        """
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")
        clean_name = name.strip()
        clean_desc = description.strip()
        if not clean_name:
            raise ValueError("Location name is required")
        if not clean_desc:
            raise ValueError("Sensory description is required")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        if from_location_id not in {loc.id for loc in world.locations}:
            raise ValueError(
                f"Location '{from_location_id}' is not visible on the active timeline of this campaign"
            )

        cdir = normalize_compass_direction(compass_direction)
        from_loc = self.get_location(from_location_id)
        tags = [t.strip() for t in environmental_tags if t.strip()]
        spec = ImprovisedLocationSpec(
            name=clean_name,
            summary=(summary or clean_desc.split(".")[0].strip() or clean_name)[:200],
            description=clean_desc,
            environmental_tags=tags,
            entry_direction_label=f"Passage to {clean_name}",
            return_direction_label=f"Back to {from_loc.name}",
            compass_direction=cdir,
            travel_minutes=max(1, min(240, travel_minutes)),
        )
        self.add_improvised_location(
            world_id=campaign.world_id,
            from_location_id=from_location_id,
            created_at_turn_id=campaign.active_leaf_turn_id,
            spec=spec,
            valid_turn_ids=valid_turn_ids,
        )
        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def connect_campaign_locations(
        self,
        campaign_id: str,
        *,
        from_location_id: str,
        to_location_id: str,
        compass_direction: str = "N",
        travel_minutes: int = 1,
        direction_label: str | None = None,
        bidirectional: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Connect two existing map locations on the campaign's active timeline."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        if from_location_id == to_location_id:
            raise ValueError("Cannot connect a location to itself")

        travel_minutes = max(1, min(240, int(travel_minutes)))
        cdir = normalize_compass_direction(compass_direction)

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        loc_ids = {loc.id for loc in world.locations}

        if from_location_id not in loc_ids:
            raise ValueError(
                f"Location '{from_location_id}' is not visible on the active timeline"
            )
        if to_location_id not in loc_ids:
            raise ValueError(
                f"Location '{to_location_id}' is not visible on the active timeline"
            )

        from_loc = next(loc for loc in world.locations if loc.id == from_location_id)
        to_loc = next(loc for loc in world.locations if loc.id == to_location_id)

        # Check if an edge already exists from from_location_id to to_location_id
        for e in world.edges:
            if e.from_location_id == from_location_id and e.to_location_id == to_location_id:
                raise ValueError(
                    f"A passage already exists from '{from_loc.name}' to '{to_loc.name}'"
                )

        fwd_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
        fwd_label = (
            direction_label.strip()
            if direction_label and direction_label.strip()
            else f"Passage to {to_loc.name}"
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes,
                    is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    fwd_edge_id,
                    campaign.world_id,
                    from_location_id,
                    to_location_id,
                    fwd_label,
                    cdir,
                    travel_minutes,
                    campaign.active_leaf_turn_id,
                ),
            )

            if bidirectional:
                has_rev = any(
                    e.from_location_id == to_location_id and e.to_location_id == from_location_id
                    for e in world.edges
                )
                if not has_rev:
                    rev_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                    rev_dir = OPPOSITE_COMPASS.get(cdir, "S")
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes,
                            is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                        """,
                        (
                            rev_edge_id,
                            campaign.world_id,
                            to_location_id,
                            from_location_id,
                            f"Return passage to {from_loc.name}",
                            rev_dir,
                            travel_minutes,
                            campaign.active_leaf_turn_id,
                        ),
                    )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def update_campaign_edge_distance(
        self,
        campaign_id: str,
        *,
        edge_id: str,
        travel_minutes: int,
        update_reciprocal: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Update distance (travel_minutes) of an existing edge on the active timeline."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        travel_minutes = max(1, min(240, int(travel_minutes)))

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)

        target_edge = next((e for e in world.edges if e.id == edge_id), None)
        if not target_edge:
            raise KeyError(f"Edge '{edge_id}' is not visible on the active timeline")

        edges_to_update = [target_edge]
        if update_reciprocal:
            for e in world.edges:
                if (
                    e.from_location_id == target_edge.to_location_id
                    and e.to_location_id == target_edge.from_location_id
                    and e.id != target_edge.id
                ):
                    edges_to_update.append(e)

        conn = self._connect()
        try:
            for edge in edges_to_update:
                if edge.created_at_turn_id == campaign.active_leaf_turn_id:
                    conn.execute(
                        "UPDATE location_edges SET travel_minutes = ? WHERE id = ?",
                        (travel_minutes, edge.id),
                    )
                else:
                    conn.execute(
                        "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                        (campaign.active_leaf_turn_id, edge.id),
                    )
                    new_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes,
                            is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_edge_id,
                            edge.world_id,
                            edge.from_location_id,
                            edge.to_location_id,
                            edge.direction_label,
                            edge.compass_direction,
                            travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                            campaign.active_leaf_turn_id,
                        ),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def remove_campaign_edge(
        self,
        campaign_id: str,
        *,
        edge_id: str,
        remove_reciprocal: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Remove a link on the active timeline, ensuring each location retains at least one connection."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)

        target_edge = next((e for e in world.edges if e.id == edge_id), None)
        if not target_edge:
            raise KeyError(f"Edge '{edge_id}' is not visible on the active timeline")

        edges_to_remove = [target_edge]
        if remove_reciprocal:
            for e in world.edges:
                if (
                    e.from_location_id == target_edge.to_location_id
                    and e.to_location_id == target_edge.from_location_id
                    and e.id != target_edge.id
                ):
                    edges_to_remove.append(e)

        remove_ids = {e.id for e in edges_to_remove}
        remaining_edges = [e for e in world.edges if e.id not in remove_ids]

        # Determine starting hub
        starting_hub = next(
            (loc for loc in world.locations if loc.is_starting_location),
            world.locations[0] if world.locations else None,
        )
        if not starting_hub:
            raise ValueError("No locations exist in this world")

        # Build adjacency graph of remaining edges (undirected spatial traversal)
        adj: dict[str, set[str]] = {}
        for e in remaining_edges:
            adj.setdefault(e.from_location_id, set()).add(e.to_location_id)
            adj.setdefault(e.to_location_id, set()).add(e.from_location_id)

        # BFS from starting hub to ensure no disconnected islands are formed
        reachable: set[str] = {starting_hub.id}
        queue = [starting_hub.id]
        while queue:
            curr = queue.pop(0)
            for neighbor_id in adj.get(curr, set()):
                if neighbor_id not in reachable:
                    reachable.add(neighbor_id)
                    queue.append(neighbor_id)

        # Both linked locations must retain a valid path to the starting hub
        if target_edge.from_location_id not in reachable or target_edge.to_location_id not in reachable:
            raise ValueError(
                "Cannot remove link: both locations must retain a valid path to the starting hub."
            )

        conn = self._connect()
        try:
            for edge in edges_to_remove:
                if edge.created_at_turn_id == campaign.active_leaf_turn_id:
                    conn.execute("DELETE FROM location_edges WHERE id = ?", (edge.id,))
                else:
                    conn.execute(
                        """
                        UPDATE location_edges
                        SET superseded_at_turn_id = ?
                        WHERE id = ?
                        """,
                        (campaign.active_leaf_turn_id, edge.id),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def update_campaign_location_lore(
        self,
        campaign_id: str,
        location_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> CampaignStateBundle:
        """Persist a Copy-on-Write location lore override scoped strictly to a single campaign."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}

        loc = self.get_location(location_id, campaign_id=campaign_id)
        if loc.world_id != campaign.world_id:
            raise KeyError(
                f"Location '{location_id}' does not belong to campaign '{campaign_id}'"
            )
        if loc.created_at_turn_id is not None and loc.created_at_turn_id not in valid_turn_ids:
            raise KeyError(
                f"Location '{location_id}' is not visible on the active timeline branch"
            )

        now = utc_now_iso()
        conn = self._connect()
        try:
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND location_id = ?
                  AND source_type = 'location_lore'
                """,
                (campaign.world_id, location_id),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }

            prev_camp_lore_ids = {
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM lore_nodes WHERE campaign_id = ? AND location_id = ?",
                    (campaign_id, location_id),
                ).fetchall()
            }

            conn.execute(
                """
                INSERT INTO campaign_location_lore_overrides (campaign_id, location_id, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(campaign_id, location_id) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (campaign_id, location_id, now),
            )
            conn.execute(
                "DELETE FROM lore_nodes WHERE campaign_id = ? AND location_id = ?",
                (campaign_id, location_id),
            )
            conn.execute(
                """
                DELETE FROM vector_entries
                WHERE campaign_id = ? AND location_id = ? AND source_type = 'location_lore'
                """,
                (campaign_id, location_id),
            )

            taken_ids = {
                r["id"] for r in conn.execute("SELECT id FROM lore_nodes").fetchall()
            }
            for loc_lore in lore_nodes:
                can_reuse_id = (
                    bool(loc_lore.id)
                    and loc_lore.id in prev_camp_lore_ids
                    and loc_lore.id not in taken_ids
                )
                lore_id = loc_lore.id if can_reuse_id else f"lore_{uuid.uuid4().hex[:10]}"
                taken_ids.add(lore_id)
                tags_json = json.dumps(loc_lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lore_id,
                        campaign.world_id,
                        location_id,
                        campaign_id,
                        loc_lore.title,
                        loc_lore.category,
                        loc_lore.content,
                        tags_json,
                    ),
                )
                if loc_lore.category != "secret":
                    vec_title, vec_keywords = _location_lore_vector_fields(
                        loc.name, loc_lore.title, loc_lore.entity_tags
                    )
                    vec_kw_json = json.dumps(vec_keywords)
                    blob_key = (vec_title, loc_lore.content, vec_kw_json)
                    if blob_key in existing_blobs:
                        conn.execute(
                            """
                            INSERT INTO vector_entries (
                                id, source_type, world_id, location_id, character_id, campaign_id,
                                anchor_turn_id, title, content, keywords_json, embedding_blob
                            )
                            VALUES (?, 'location_lore', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                lore_id,
                                campaign.world_id,
                                location_id,
                                campaign_id,
                                loc.created_at_turn_id,
                                vec_title,
                                loc_lore.content,
                                vec_kw_json,
                                existing_blobs[blob_key],
                            ),
                        )
                    else:
                        pre_vec = (
                            precomputed_embeddings.get(blob_key)
                            if precomputed_embeddings
                            else None
                        )
                        self.vector_store.upsert_entry(
                            entry_id=lore_id,
                            source_type="location_lore",
                            world_id=campaign.world_id,
                            location_id=location_id,
                            campaign_id=campaign_id,
                            anchor_turn_id=loc.created_at_turn_id,
                            title=vec_title,
                            content=loc_lore.content,
                            keywords=vec_keywords,
                            embedding=pre_vec,
                            conn=conn,
                        )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    async def aupdate_campaign_location_lore(
        self,
        campaign_id: str,
        location_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Validate ownership/branch visibility, pre-compute missing embeddings asynchronously, and save override."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        loc = self.get_location(location_id, campaign_id=campaign_id)
        if loc.world_id != campaign.world_id:
            raise KeyError(
                f"Location '{location_id}' does not belong to campaign '{campaign_id}'"
            )
        if loc.created_at_turn_id is not None and loc.created_at_turn_id not in valid_turn_ids:
            raise KeyError(
                f"Location '{location_id}' is not visible on the active timeline branch"
            )

        conn = self._connect()
        try:
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND location_id = ?
                  AND source_type = 'location_lore'
                """,
                (campaign.world_id, location_id),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }
        finally:
            conn.close()

        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for loc_lore in lore_nodes:
            if loc_lore.category == "secret":
                continue
            vec_title, vec_keywords = _location_lore_vector_fields(
                loc.name, loc_lore.title, loc_lore.entity_tags
            )
            vec_kw_json = json.dumps(vec_keywords)
            items_to_embed.append(
                (
                    (vec_title, loc_lore.content, vec_kw_json),
                    combine_entry_text(vec_title, loc_lore.content, vec_keywords),
                )
            )

        precomputed = await _compute_missing_embeddings(items_to_embed, existing_blobs)
        return self.update_campaign_location_lore(
            campaign_id,
            location_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

    def checkout_turn_branch(
        self,
        campaign_id: str,
        turn_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Switch the campaign's active_leaf_turn_id to any node in the tree, rolling back state."""
        self.get_campaign(campaign_id, owner_id=owner_id)
        turn = self.get_turn_node(turn_id)
        if turn.campaign_id != campaign_id:
            raise ValueError(f"Turn '{turn_id}' does not belong to campaign '{campaign_id}'")
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (turn_id, campaign_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def get_campaign_state_bundle(
        self,
        campaign_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Assemble the full live state bundle for the active branch."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise RuntimeError(f"Campaign '{campaign_id}' has no root turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        all_turns = self.list_campaign_turn_nodes(campaign_id)
        leaf_turn = branch_turns[-1]

        world_filtered = self.get_world(
            campaign.world_id,
            valid_turn_ids=valid_turn_ids,
            campaign_id=campaign_id,
        )
        active_loc = self.get_location(
            leaf_turn.world_snapshot.active_location_id,
            campaign_id=campaign_id,
        )
        neighbors = self.get_neighbor_locations(
            campaign.world_id,
            active_loc.id,
            valid_turn_ids=valid_turn_ids,
            campaign_id=campaign_id,
        )
        episodic_chunks = self.get_branch_episodic_chunks(campaign_id, valid_turn_ids)

        present_ids = [
            cid
            for cid, st in leaf_turn.character_states.items()
            if st.current_location_id == active_loc.id
        ]

        char_ids: list[str] = []
        if campaign.character_id and campaign.character_id not in char_ids:
            char_ids.append(campaign.character_id)
        for cid in campaign.participant_character_ids or []:
            if cid not in char_ids:
                char_ids.append(cid)
        for cid in leaf_turn.character_states.keys():
            if cid not in char_ids:
                char_ids.append(cid)

        char_records: dict[str, CharacterRecord] = {}
        for cid in char_ids:
            try:
                char_records[cid] = self.get_character(
                    cid, campaign_id=campaign_id, valid_turn_ids=valid_turn_ids
                )
            except KeyError:
                pass

        return CampaignStateBundle(
            campaign=campaign,
            active_branch_turns=branch_turns,
            all_turn_nodes=all_turns,
            current_world_snapshot=leaf_turn.world_snapshot,
            current_character_state=leaf_turn.character_state,
            character_states=leaf_turn.character_states,
            character_records=char_records,
            present_character_ids=present_ids,
            active_location=active_loc,
            neighbor_locations=neighbors,
            visible_locations=world_filtered.locations,
            visible_edges=world_filtered.edges,
            episodic_chunks=episodic_chunks,
        )

    # ------------------------------------------------------------------
    # Row Mappers
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_lore_node(r: sqlite3.Row) -> LoreNode:
        keys = r.keys()
        return LoreNode(
            id=r["id"],
            world_id=r["world_id"],
            location_id=r["location_id"] if "location_id" in keys else None,
            campaign_id=r["campaign_id"] if "campaign_id" in keys else None,
            title=r["title"],
            category=r["category"],
            content=r["content"],
            entity_tags=json.loads(r["entity_tags_json"] or "[]"),
        )

    @staticmethod
    def _row_to_location(r: sqlite3.Row) -> LocationNode:
        keys = r.keys()
        return LocationNode(
            id=r["id"],
            world_id=r["world_id"],
            created_at_turn_id=r["created_at_turn_id"],
            name=r["name"],
            summary=r["summary"],
            description=r["description"],
            environmental_tags=json.loads(r["environmental_tags_json"] or "[]"),
            is_starting_location=bool(r["is_starting_location"]),
            is_hub=bool(r["is_hub"]) if "is_hub" in keys else False,
            starting_message=r["starting_message"] if "starting_message" in keys and r["starting_message"] else "",
        )

    @staticmethod
    def _row_to_edge(r: sqlite3.Row) -> LocationEdge:
        keys = r.keys()
        raw_cdir = r["compass_direction"] if "compass_direction" in keys else None
        cdir = normalize_compass_direction(raw_cdir, r["direction_label"])
        return LocationEdge(
            id=r["id"],
            world_id=r["world_id"],
            from_location_id=r["from_location_id"],
            to_location_id=r["to_location_id"],
            direction_label=r["direction_label"],
            compass_direction=cdir,
            travel_minutes=r["travel_minutes"],
            is_locked_or_hidden=bool(r["is_locked_or_hidden"]),
            created_at_turn_id=r["created_at_turn_id"],
            superseded_at_turn_id=r["superseded_at_turn_id"] if "superseded_at_turn_id" in keys else None,
        )

    @staticmethod
    def _row_to_turn_node(r: sqlite3.Row) -> TurnNodeRecord:
        post_json = r["post_turn_json"]
        base_cog = CognitionBlock.model_validate_json(r["cognition_json"])
        cognitions_map: dict[str, CognitionBlock] = {}
        cognition_names: dict[str, str] = {}
        if "cognitions_json" in r.keys() and r["cognitions_json"]:
            try:
                parsed_cogs = json.loads(r["cognitions_json"])
                if isinstance(parsed_cogs, dict) and "cognitions" in parsed_cogs:
                    cognitions_map = {
                        cid: CognitionBlock.model_validate(cdata)
                        for cid, cdata in parsed_cogs["cognitions"].items()
                    }
                    cognition_names = dict(parsed_cogs.get("character_names") or {})
                elif isinstance(parsed_cogs, dict):
                    cognitions_map = {
                        cid: CognitionBlock.model_validate(cdata)
                        for cid, cdata in parsed_cogs.items()
                    }
            except Exception:
                pass
        if not cognitions_map and r["actor_id"] != "__narrator__" and not base_cog.skipped:
            cognitions_map = {r["actor_id"]: base_cog}

        whispers_list: list[CharacterWhisper] = []
        if "whispers_json" in r.keys() and r["whispers_json"]:
            try:
                whispers_list = [
                    CharacterWhisper.model_validate(w)
                    for w in json.loads(r["whispers_json"])
                ]
            except Exception:
                pass

        return TurnNodeRecord(
            id=r["id"],
            campaign_id=r["campaign_id"],
            parent_turn_id=r["parent_turn_id"],
            depth_index=r["depth_index"],
            user_message=r["user_message"],
            actor_id=r["actor_id"],
            raw_prose=r["raw_prose"],
            cognition=base_cog,
            cognitions=cognitions_map,
            cognition_character_names=cognition_names,
            whispers=whispers_list,
            pre_turn=PreTurnAnalysis.model_validate_json(r["pre_turn_json"]),
            post_turn=PostTurnStateDelta.model_validate_json(post_json) if post_json else None,
            world_snapshot=WorldStateSnapshot(
                turn_id=r["id"],
                world_timestamp=r["world_timestamp"],
                active_location_id=r["active_location_id"],
                scene_flags=json.loads(r["scene_flags_json"] or "[]"),
                campaign_elapsed_minutes=(
                    int(r["campaign_elapsed_minutes"] or 0)
                    if "campaign_elapsed_minutes" in r.keys()
                    else 0
                ),
            ),
            character_state=CharacterStateSnapshot(
                turn_id=r["id"],
                character_id=r["cs_character_id"],
                current_location_id=r["current_location_id"],
                mood_label=r["mood_label"],
                valence=r["valence"],
                arousal=r["arousal"],
                active_want=r["active_want"],
                active_plan=r["active_plan"],
                relationship_notes=json.loads(r["relationship_notes_json"] or "{}"),
                equipped=json.loads(r["equipped_json"] or "[]")
                if "equipped_json" in r.keys()
                else [],
                inventory=json.loads(r["inventory_json"] or "[]")
                if "inventory_json" in r.keys()
                else [],
                unlocked_persona_keys=(
                    json.loads(r["unlocked_persona_keys_json"] or "[]")
                    if "unlocked_persona_keys_json" in r.keys()
                    else []
                ),
                persona_knowledge_provenance=(
                    json.loads(r["persona_knowledge_provenance_json"] or "{}")
                    if "persona_knowledge_provenance_json" in r.keys()
                    else {}
                ),
                care_state=_parse_care_state_json(
                    r["affective_state_json"]
                    if "affective_state_json" in r.keys()
                    else None
                ),
            ),
            recalled_items=[
                RecalledMemoryItem.model_validate(item)
                for item in json.loads(r["recalled_items_json"] or "[]")
            ],
            created_at=r["created_at"],
        )

    # ------------------------------------------------------------------
    # User Notes
    # ------------------------------------------------------------------

    def _row_to_user_note(self, r: sqlite3.Row) -> UserNoteRecord:
        return UserNoteRecord(
            id=r["id"],
            owner_id=r["owner_id"],
            title=r["title"],
            content=r["content"],
            tags=json.loads(r["tags_json"] or "[]"),
            is_starred=bool(r["is_starred"]),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    def list_user_notes(self, owner_id: str) -> list[UserNoteRecord]:
        """List all notes belonging to the specified owner, including federated character creator notes."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id, owner_id, title, content, tags_json, is_starred, created_at, updated_at
                FROM user_notes
                WHERE owner_id = ?
                ORDER BY is_starred DESC, updated_at DESC
                """,
                (owner_id,),
            ).fetchall()
            user_notes = [self._row_to_user_note(r) for r in rows]

            # Model A: Federated virtual notes for characters with creator_notes
            char_rows = conn.execute(
                """
                SELECT id, name, creator_notes, tags_json, created_at
                FROM characters
                WHERE (owner_id = ? OR owner_id IS NULL)
                  AND creator_notes != ''
                  AND pending_deletion = 0
                ORDER BY created_at DESC
                """,
                (owner_id,),
            ).fetchall()

            virtual_notes: list[UserNoteRecord] = []
            for cr in char_rows:
                c_id = cr["id"]
                c_name = cr["name"]
                c_notes = cr["creator_notes"]
                char_tags = [
                    slugify_tag(t)
                    for t in (json.loads(cr["tags_json"] or "[]"))
                    if t and t.strip()
                ]
                norm_char_name = slugify_tag(c_name)
                note_tags = [norm_char_name, "creator-notes"]
                for t in char_tags:
                    if t not in note_tags:
                        note_tags.append(t)

                virtual_notes.append(
                    UserNoteRecord(
                        id=f"char_note_{c_id}",
                        owner_id=owner_id,
                        title=f"{c_name} — Creator Notes",
                        content=c_notes,
                        tags=note_tags,
                        is_starred=False,
                        is_character_note=True,
                        character_id=c_id,
                        created_at=cr["created_at"],
                        updated_at=cr["created_at"],
                    )
                )

            combined = user_notes + virtual_notes
            return sorted(
                combined,
                key=lambda n: (1 if n.is_starred else 0, n.updated_at),
                reverse=True,
            )
        finally:
            conn.close()

    def get_user_note(self, note_id: str, owner_id: str) -> UserNoteRecord | None:
        """Fetch a specific note if it belongs to the owner, supporting virtual character creator notes."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT id, name, creator_notes, tags_json, created_at
                    FROM characters
                    WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND pending_deletion = 0
                    """,
                    (char_id, owner_id),
                ).fetchone()
                if not row or not row["creator_notes"]:
                    return None
                c_name = row["name"]
                char_tags = [
                    slugify_tag(t)
                    for t in (json.loads(row["tags_json"] or "[]"))
                    if t and t.strip()
                ]
                norm_char_name = slugify_tag(c_name)
                note_tags = [norm_char_name, "creator-notes"]
                for t in char_tags:
                    if t not in note_tags:
                        note_tags.append(t)
                return UserNoteRecord(
                    id=note_id,
                    owner_id=owner_id,
                    title=f"{c_name} — Creator Notes",
                    content=row["creator_notes"],
                    tags=note_tags,
                    is_starred=False,
                    is_character_note=True,
                    character_id=char_id,
                    created_at=row["created_at"],
                    updated_at=row["created_at"],
                )
            finally:
                conn.close()

        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT id, owner_id, title, content, tags_json, is_starred, created_at, updated_at
                FROM user_notes
                WHERE id = ? AND owner_id = ?
                """,
                (note_id, owner_id),
            ).fetchone()
            return self._row_to_user_note(row) if row else None
        finally:
            conn.close()

    def create_user_note(
        self,
        *,
        owner_id: str,
        title: str = "",
        content: str = "",
        tags: list[str] | None = None,
        is_starred: bool = False,
        note_id: str | None = None,
    ) -> UserNoteRecord:
        """Create a new note for the specified owner."""
        nid = note_id or f"note_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        clean_tags = [t.strip().lstrip("#") for t in (tags or []) if t and t.strip()]
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO user_notes (id, owner_id, title, content, tags_json, is_starred, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    nid,
                    owner_id,
                    title.strip(),
                    content,
                    json.dumps(clean_tags),
                    1 if is_starred else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            return UserNoteRecord(
                id=nid,
                owner_id=owner_id,
                title=title.strip(),
                content=content,
                tags=clean_tags,
                is_starred=is_starred,
                created_at=now,
                updated_at=now,
            )
        finally:
            conn.close()

    def update_user_note(
        self,
        note_id: str,
        owner_id: str,
        *,
        title: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        is_starred: bool | None = None,
    ) -> UserNoteRecord | None:
        """Update an existing note belonging to the owner, supporting virtual character creator notes."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT id, creator_notes FROM characters WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND pending_deletion = 0",
                    (char_id, owner_id),
                ).fetchone()
                if not row:
                    return None
                new_content = row["creator_notes"] if content is None else content
                conn.execute(
                    "UPDATE characters SET creator_notes = ? WHERE id = ?",
                    (new_content, char_id),
                )
                conn.commit()
            finally:
                conn.close()
            return self.get_user_note(note_id, owner_id)

        existing = self.get_user_note(note_id, owner_id)
        if not existing:
            return None

        new_title = existing.title if title is None else title.strip()
        new_content = existing.content if content is None else content
        new_tags = (
            existing.tags
            if tags is None
            else [t.strip().lstrip("#") for t in tags if t and t.strip()]
        )
        new_starred = existing.is_starred if is_starred is None else is_starred
        now = utc_now_iso()

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE user_notes
                SET title = ?, content = ?, tags_json = ?, is_starred = ?, updated_at = ?
                WHERE id = ? AND owner_id = ?
                """,
                (
                    new_title,
                    new_content,
                    json.dumps(new_tags),
                    1 if new_starred else 0,
                    now,
                    note_id,
                    owner_id,
                ),
            )
            conn.commit()
            return UserNoteRecord(
                id=note_id,
                owner_id=owner_id,
                title=new_title,
                content=new_content,
                tags=new_tags,
                is_starred=new_starred,
                created_at=existing.created_at,
                updated_at=now,
            )
        finally:
            conn.close()

    def delete_user_note(self, note_id: str, owner_id: str) -> bool:
        """Delete an existing note belonging to the owner. Returns True if deleted, False if not found."""
        if note_id.startswith("char_note_"):
            char_id = note_id[len("char_note_") :]
            conn = self._connect()
            try:
                cursor = conn.execute(
                    "UPDATE characters SET creator_notes = '' WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)",
                    (char_id, owner_id),
                )
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

        conn = self._connect()
        try:
            cursor = conn.execute(
                "DELETE FROM user_notes WHERE id = ? AND owner_id = ?",
                (note_id, owner_id),
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

