"""SQLite DDL initialization and legacy schema migrations."""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import uuid
from pathlib import Path
from app.prompts import BUILTIN_PRESETS
from app.schemas.world import (
    DEFAULT_EDGE_SPEED_MODIFIER,
    DEFAULT_FALLBACK_DISTANCE_METERS,
    WALKING_METERS_PER_MINUTE,
    normalize_and_validate_entity_tags,
    normalize_compass_direction,
    normalize_lore_category,
    pick_available_compass_direction,
)
from app.db.repos.base import utc_now_iso
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_asset_file_path,
    safe_resolve_media_file_path,
    safe_resolve_persona_media_file_path,
    safe_resolve_world_media_file_path,
)


class SchemaInitMixin:
    """SQLite DDL initialization and legacy schema migrations."""

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
            and "container_id" in ddl_sql
            and "created_at_turn_id" in ddl_sql
            and "origin_lore_id" in ddl_sql
            and "is_major_event" in ddl_sql
            and "json_array_length(entity_tags_json)" in ddl_sql
            and "'artifact'" in ddl_sql
            and "'figure'" in ddl_sql
            and "'threat'" in ddl_sql
            and "campaign_id IS NULL OR location_id IS NOT NULL OR container_id IS NOT NULL" not in ddl_sql
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
        has_containers = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='location_containers'"
        ).fetchone()
        valid_container_ids = (
            {r["id"] for r in conn.execute("SELECT id FROM location_containers").fetchall()}
            if has_containers
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
                    container_id TEXT NULL REFERENCES location_containers(id) ON DELETE CASCADE,
                    campaign_id TEXT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                    created_at_turn_id TEXT NULL,
                    origin_lore_id TEXT NULL,
                    is_major_event INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL CHECK(length(trim(title)) >= 1),
                    category TEXT NOT NULL CHECK(
                        category IN ('history', 'culture', 'faction', 'figure', 'rumor', 'threat', 'artifact', 'secret')
                        AND ((location_id IS NOT NULL OR container_id IS NOT NULL) OR category != 'secret')
                        AND (location_id IS NULL OR category NOT IN ('artifact', 'figure', 'threat'))
                        AND (container_id IS NULL OR category NOT IN ('artifact', 'figure', 'threat'))
                        AND (location_id IS NULL OR container_id IS NULL)
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
                cont_id = r["container_id"] if "container_id" in r_keys else None
                if cont_id and cont_id not in valid_container_ids:
                    continue
                if loc_id and cont_id:
                    cont_id = None
                camp_id = r["campaign_id"] if "campaign_id" in r_keys else None
                if camp_id and camp_id not in valid_camp_ids:
                    camp_id = None
                created_at_turn_id = (
                    r["created_at_turn_id"] if "created_at_turn_id" in r_keys else None
                )
                origin_lore_id = (
                    r["origin_lore_id"] if "origin_lore_id" in r_keys else None
                )
                is_major_event = (
                    int(bool(r["is_major_event"])) if "is_major_event" in r_keys else 0
                )

                clean_title = (r["title"] or "").strip()[:120] or "World Lore"
                clean_content = (r["content"] or "").strip()[:2000] or clean_title
                clean_cat = normalize_lore_category(
                    r["category"], allow_secret=bool(loc_id or cont_id), strict=False
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
                        id, world_id, location_id, container_id, campaign_id,
                        created_at_turn_id, origin_lore_id, is_major_event,
                        title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r["id"],
                        w_id,
                        loc_id,
                        cont_id,
                        camp_id,
                        created_at_turn_id,
                        origin_lore_id,
                        is_major_event,
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

    @staticmethod
    def _migrate_location_edges_to_distance_meters(conn: sqlite3.Connection) -> None:
        """Idempotently migrate legacy `location_edges.travel_minutes` (* 70) to `distance_meters`."""
        edge_cols = {
            r["name"]
            for r in conn.execute("PRAGMA table_info(location_edges)").fetchall()
        }
        if not edge_cols or ("distance_meters" in edge_cols and "travel_minutes" not in edge_cols):
            return

        has_distance = "distance_meters" in edge_cols
        has_minutes = "travel_minutes" in edge_cols

        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        try:
            conn.execute("BEGIN IMMEDIATE;")
            conn.execute("DROP TABLE IF EXISTS location_edges_migrated;")
            conn.execute(
                f"""
                CREATE TABLE location_edges_migrated (
                    id TEXT PRIMARY KEY,
                    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                    from_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
                    to_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
                    direction_label TEXT NOT NULL,
                    compass_direction TEXT NULL,
                    distance_meters INTEGER NOT NULL DEFAULT {DEFAULT_FALLBACK_DISTANCE_METERS},
                    is_locked_or_hidden INTEGER NOT NULL DEFAULT 0,
                    created_at_turn_id TEXT NULL,
                    superseded_at_turn_id TEXT NULL
                );
                """
            )
            if has_distance and has_minutes:
                distance_expr = (
                    f"MAX(1, COALESCE(distance_meters, COALESCE(travel_minutes, 1) * {WALKING_METERS_PER_MINUTE}))"
                )
            elif has_distance:
                distance_expr = f"MAX(1, COALESCE(distance_meters, {DEFAULT_FALLBACK_DISTANCE_METERS}))"
            elif has_minutes:
                distance_expr = (
                    f"MAX(1, COALESCE(travel_minutes, 1) * {WALKING_METERS_PER_MINUTE})"
                )
            else:
                distance_expr = str(DEFAULT_FALLBACK_DISTANCE_METERS)

            conn.execute(
                f"""
                INSERT INTO location_edges_migrated (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, distance_meters,
                    is_locked_or_hidden, created_at_turn_id, superseded_at_turn_id
                )
                SELECT
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, {distance_expr},
                    COALESCE(is_locked_or_hidden, 0), created_at_turn_id, superseded_at_turn_id
                FROM location_edges;
                """
            )
            conn.execute("DROP TABLE location_edges;")
            conn.execute("ALTER TABLE location_edges_migrated RENAME TO location_edges;")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_location_edges_from ON location_edges(from_location_id);"
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON;")

    @staticmethod
    def _migrate_location_edges_to_first_class_links(conn: sqlite3.Connection) -> None:
        """Idempotently replace legacy `is_locked_or_hidden` with speed/mode/obstacles/blocked/secret columns."""
        edge_cols = {
            r["name"]
            for r in conn.execute("PRAGMA table_info(location_edges)").fetchall()
        }
        required_cols = {
            "speed_modifier",
            "travel_mode",
            "obstacles_json",
            "is_blocked",
            "is_secret",
        }
        if not edge_cols or (required_cols <= edge_cols and "is_locked_or_hidden" not in edge_cols):
            return

        has_legacy_lock = "is_locked_or_hidden" in edge_cols
        has_blocked = "is_blocked" in edge_cols
        has_secret = "is_secret" in edge_cols
        has_speed = "speed_modifier" in edge_cols
        has_mode = "travel_mode" in edge_cols
        has_obstacles = "obstacles_json" in edge_cols

        speed_expr = (
            f"COALESCE(speed_modifier, {DEFAULT_EDGE_SPEED_MODIFIER})"
            if has_speed
            else str(DEFAULT_EDGE_SPEED_MODIFIER)
        )
        mode_expr = "travel_mode" if has_mode else "NULL"
        obstacles_expr = "COALESCE(obstacles_json, '[]')" if has_obstacles else "'[]'"
        if has_blocked and has_legacy_lock:
            blocked_expr = "COALESCE(is_blocked, COALESCE(is_locked_or_hidden, 0))"
        elif has_blocked:
            blocked_expr = "COALESCE(is_blocked, 0)"
        elif has_legacy_lock:
            blocked_expr = "COALESCE(is_locked_or_hidden, 0)"
        else:
            blocked_expr = "0"
        secret_expr = "COALESCE(is_secret, 0)" if has_secret else "0"

        conn.commit()
        conn.execute("PRAGMA foreign_keys = OFF;")
        try:
            conn.execute("BEGIN IMMEDIATE;")
            conn.execute("DROP TABLE IF EXISTS location_edges_migrated;")
            conn.execute(
                f"""
                CREATE TABLE location_edges_migrated (
                    id TEXT PRIMARY KEY,
                    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                    from_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
                    to_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
                    direction_label TEXT NOT NULL,
                    compass_direction TEXT NULL,
                    distance_meters INTEGER NOT NULL DEFAULT {DEFAULT_FALLBACK_DISTANCE_METERS},
                    speed_modifier REAL NOT NULL DEFAULT {DEFAULT_EDGE_SPEED_MODIFIER},
                    travel_mode TEXT NULL,
                    obstacles_json TEXT NOT NULL DEFAULT '[]',
                    is_blocked INTEGER NOT NULL DEFAULT 0,
                    is_secret INTEGER NOT NULL DEFAULT 0,
                    created_at_turn_id TEXT NULL,
                    superseded_at_turn_id TEXT NULL
                );
                """
            )
            conn.execute(
                f"""
                INSERT INTO location_edges_migrated (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, distance_meters,
                    speed_modifier, travel_mode, obstacles_json,
                    is_blocked, is_secret, created_at_turn_id, superseded_at_turn_id
                )
                SELECT
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction,
                    MAX(1, COALESCE(distance_meters, {DEFAULT_FALLBACK_DISTANCE_METERS})),
                    {speed_expr}, {mode_expr}, {obstacles_expr},
                    {blocked_expr}, {secret_expr}, created_at_turn_id, superseded_at_turn_id
                FROM location_edges;
                """
            )
            conn.execute("DROP TABLE location_edges;")
            conn.execute("ALTER TABLE location_edges_migrated RENAME TO location_edges;")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_location_edges_from ON location_edges(from_location_id);"
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON;")

    def init_db(self) -> None:
        """Execute schema.sql to initialize all tables, indexes, and idempotent migrations."""
        schema_path = Path(__file__).resolve().parent.parent / "schema.sql"
        sql = schema_path.read_text(encoding="utf-8")
        conn = self._connect()
        try:
            # Ensure location_containers exists on pre-existing DBs before migrating location_nodes/lore_nodes
            worlds_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='worlds'"
            ).fetchone()
            if worlds_table_exists:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS location_containers (
                        id TEXT PRIMARY KEY,
                        world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                        created_at_turn_id TEXT NULL,
                        parent_container_id TEXT NULL REFERENCES location_containers(id) ON DELETE CASCADE,
                        depth INTEGER NOT NULL CHECK(depth BETWEEN 1 AND 4),
                        name TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                        ui_x REAL NULL,
                        ui_y REAL NULL,
                        ghost_coords_json TEXT NOT NULL DEFAULT '{}',
                        icon TEXT NULL,
                        created_at TEXT NOT NULL DEFAULT ''
                    )
                    """
                )
                conn.commit()

            loc_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='location_nodes'"
            ).fetchone()
            if loc_table_exists:
                existing_loc_cols = {
                    r["name"]
                    for r in conn.execute("PRAGMA table_info(location_nodes)").fetchall()
                }
                if "container_id" not in existing_loc_cols:
                    conn.execute(
                        "ALTER TABLE location_nodes ADD COLUMN container_id TEXT NULL REFERENCES location_containers(id) ON DELETE SET NULL"
                    )
                if "is_entry_exit" not in existing_loc_cols:
                    conn.execute(
                        "ALTER TABLE location_nodes ADD COLUMN is_entry_exit INTEGER NOT NULL DEFAULT 0 CHECK(is_entry_exit IN (0, 1))"
                    )
                conn.commit()

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
                if "container_id" not in existing_vec_cols:
                    conn.execute("ALTER TABLE vector_entries ADD COLUMN container_id TEXT NULL")
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

            users_table_exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
            ).fetchone()
            if users_table_exists:
                existing_user_cols = {
                    r["name"]
                    for r in conn.execute("PRAGMA table_info(users)").fetchall()
                }
                if "last_login_at" not in existing_user_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN last_login_at TEXT NULL")
                    sessions_exists = conn.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_sessions'"
                    ).fetchone()
                    if sessions_exists:
                        conn.execute(
                            """
                            UPDATE users
                            SET last_login_at = (
                                SELECT MAX(s.created_at)
                                FROM user_sessions s
                                WHERE s.user_id = users.id
                            )
                            WHERE last_login_at IS NULL
                            """
                        )
                if "last_active_at" not in existing_user_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN last_active_at TEXT NULL")
                    sessions_exists = conn.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_sessions'"
                    ).fetchone()
                    if sessions_exists:
                        session_cols = {
                            r["name"]
                            for r in conn.execute("PRAGMA table_info(user_sessions)").fetchall()
                        }
                        activity_col = (
                            "last_active_at"
                            if "last_active_at" in session_cols
                            else ("last_seen_at" if "last_seen_at" in session_cols else "created_at")
                        )
                        conn.execute(
                            f"""
                            UPDATE users
                            SET last_active_at = COALESCE(
                                (SELECT MAX(s.{activity_col}) FROM user_sessions s WHERE s.user_id = users.id),
                                created_at
                            )
                            WHERE last_active_at IS NULL
                            """
                        )
                    else:
                        conn.execute(
                            "UPDATE users SET last_active_at = created_at WHERE last_active_at IS NULL"
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
            if "unsupported_fields_json" not in world_cols:
                conn.execute(
                    "ALTER TABLE worlds ADD COLUMN unsupported_fields_json TEXT NOT NULL DEFAULT '{}'"
                )
            if "seed_key" not in world_cols:
                conn.execute("ALTER TABLE worlds ADD COLUMN seed_key TEXT NULL")
            if "seed_version" not in world_cols:
                conn.execute("ALTER TABLE worlds ADD COLUMN seed_version INTEGER NULL")
            if "seed_modified" not in world_cols:
                conn.execute(
                    "ALTER TABLE worlds ADD COLUMN seed_modified INTEGER NOT NULL DEFAULT 0"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_worlds_owner_seed ON worlds(owner_id, seed_key, pending_deletion)"
            )

            wml_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(world_media_links)").fetchall()
            }
            if "label_override" not in wml_cols:
                conn.execute(
                    "ALTER TABLE world_media_links ADD COLUMN label_override TEXT NULL"
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
            if "seed_key" not in char_cols:
                conn.execute("ALTER TABLE characters ADD COLUMN seed_key TEXT NULL")
            if "seed_version" not in char_cols:
                conn.execute("ALTER TABLE characters ADD COLUMN seed_version INTEGER NULL")
            if "seed_modified" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN seed_modified INTEGER NOT NULL DEFAULT 0"
                )
            if "version" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_characters_owner_seed ON characters(owner_id, seed_key, pending_deletion)"
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
                    tagline TEXT NOT NULL DEFAULT '',
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
                    portrait_url TEXT NULL,
                    gallery_json TEXT NOT NULL DEFAULT '[]',
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
            if "tagline" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN tagline TEXT NOT NULL DEFAULT ''")
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
            if "portrait_url" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN portrait_url TEXT NULL")
            if "gallery_json" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]'")
            if "unsupported_fields_json" not in persona_cols:
                conn.execute("ALTER TABLE personas ADD COLUMN unsupported_fields_json TEXT NOT NULL DEFAULT '{}'")

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
                    inventory_json TEXT NOT NULL DEFAULT '[]',
                    physical_stance TEXT NOT NULL DEFAULT 'unspecified',
                    physical_context TEXT NOT NULL DEFAULT ''
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
            if "min_working_memory_turns" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN min_working_memory_turns INTEGER NULL"
                )
            if "lod_summary_chunks" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN lod_summary_chunks INTEGER NULL"
                )
            if "lod_importance_bonus" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN lod_importance_bonus INTEGER NULL"
                )
            if "zone2_budget_share_pct" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN zone2_budget_share_pct INTEGER NULL"
                )
            if "recall_budget_prose_tokens" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN recall_budget_prose_tokens INTEGER NULL"
                )
            if "recall_budget_cognition_tokens" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN recall_budget_cognition_tokens INTEGER NULL"
                )
            if "gm_model_role" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN gm_model_role TEXT NULL"
                )
            if "gm_temperature" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN gm_temperature REAL NULL"
                )
            if "gm_max_tokens" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN gm_max_tokens INTEGER NULL"
                )
            if "gm_tools_enabled" not in ums_cols:
                conn.execute(
                    "ALTER TABLE user_model_settings ADD COLUMN gm_tools_enabled INTEGER NULL"
                )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS gm_chat_messages (
                    id TEXT PRIMARY KEY,
                    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                    anchor_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    mentions_json TEXT NOT NULL DEFAULT '[]',
                    sources_json TEXT NOT NULL DEFAULT '[]',
                    proposals_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL
                )
                """
            )
            gm_msg_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(gm_chat_messages)").fetchall()
            }
            if "proposals_json" not in gm_msg_cols:
                conn.execute(
                    "ALTER TABLE gm_chat_messages ADD COLUMN proposals_json TEXT NOT NULL DEFAULT '[]'"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_gm_chat_messages_campaign ON gm_chat_messages(campaign_id, anchor_turn_id, created_at)"
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
            if "unsupported_fields_json" not in char_cols:
                conn.execute(
                    "ALTER TABLE characters ADD COLUMN unsupported_fields_json TEXT NOT NULL DEFAULT '{}'"
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
            if "telemetry_json" not in tn_cols:
                conn.execute(
                    "ALTER TABLE turn_nodes ADD COLUMN telemetry_json TEXT NULL"
                )
            if "is_bookmarked" not in tn_cols:
                conn.execute(
                    "ALTER TABLE turn_nodes ADD COLUMN is_bookmarked INTEGER NOT NULL DEFAULT 0"
                )
            if "user_note" not in tn_cols:
                conn.execute(
                    "ALTER TABLE turn_nodes ADD COLUMN user_note TEXT NULL"
                )

            ws_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(world_state_snapshots)").fetchall()
            }
            if "campaign_elapsed_minutes" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN campaign_elapsed_minutes INTEGER NOT NULL DEFAULT 0"
                )
            if "visited_location_ids_json" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN visited_location_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
                # One-shot backwards-compatibility backfill: mark all currently visible
                # locations in existing campaign snapshots as visited.
                existing_ws = conn.execute(
                    """
                    SELECT ws.turn_id, ws.active_location_id, t.campaign_id, c.world_id
                    FROM world_state_snapshots ws
                    JOIN turn_nodes t ON t.id = ws.turn_id
                    JOIN campaigns c ON c.id = t.campaign_id
                    """
                ).fetchall()
                if existing_ws:
                    all_turn_parents = {
                        r["id"]: r["parent_turn_id"]
                        for r in conn.execute("SELECT id, parent_turn_id FROM turn_nodes").fetchall()
                    }
                    world_locs_cache: dict[str, list[sqlite3.Row]] = {}
                    for ws_row in existing_ws:
                        w_id = ws_row["world_id"]
                        if w_id not in world_locs_cache:
                            world_locs_cache[w_id] = conn.execute(
                                "SELECT id, created_at_turn_id FROM location_nodes WHERE world_id = ?",
                                (w_id,),
                            ).fetchall()
                        branch_ids: set[str] = set()
                        curr_tid: str | None = ws_row["turn_id"]
                        while curr_tid and curr_tid not in branch_ids:
                            branch_ids.add(curr_tid)
                            curr_tid = all_turn_parents.get(curr_tid)
                        visited_ids: list[str] = []
                        seen_vis: set[str] = set()
                        for loc_r in world_locs_cache[w_id]:
                            c_tid = loc_r["created_at_turn_id"]
                            if c_tid is None or c_tid in branch_ids:
                                lid = loc_r["id"]
                                if lid not in seen_vis:
                                    seen_vis.add(lid)
                                    visited_ids.append(lid)
                        active_lid = ws_row["active_location_id"]
                        if active_lid and active_lid not in seen_vis:
                            visited_ids.append(active_lid)
                        conn.execute(
                            "UPDATE world_state_snapshots SET visited_location_ids_json = ? WHERE turn_id = ?",
                            (json.dumps(visited_ids), ws_row["turn_id"]),
                        )

            if "visited_container_ids_json" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN visited_container_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
                cont_parent_map = {
                    r["id"]: r["parent_container_id"]
                    for r in conn.execute("SELECT id, parent_container_id FROM location_containers").fetchall()
                }
                loc_cont_map = {
                    r["id"]: r["container_id"]
                    for r in conn.execute("SELECT id, container_id FROM location_nodes").fetchall()
                }
                for ws_row in conn.execute(
                    "SELECT turn_id, visited_location_ids_json, active_location_id FROM world_state_snapshots"
                ).fetchall():
                    try:
                        vis_locs = json.loads(ws_row["visited_location_ids_json"] or "[]")
                    except Exception:
                        vis_locs = []
                    if ws_row["active_location_id"] and ws_row["active_location_id"] not in vis_locs:
                        vis_locs.append(ws_row["active_location_id"])
                    vis_conts: list[str] = []
                    seen_conts: set[str] = set()
                    for lid in vis_locs:
                        cid = loc_cont_map.get(lid)
                        chain: list[str] = []
                        loop_guard: set[str] = set()
                        while cid and cid not in loop_guard:
                            loop_guard.add(cid)
                            chain.append(cid)
                            cid = cont_parent_map.get(cid)
                        for anc in reversed(chain):
                            if anc not in seen_conts:
                                seen_conts.add(anc)
                                vis_conts.append(anc)
                    if vis_conts:
                        conn.execute(
                            "UPDATE world_state_snapshots SET visited_container_ids_json = ? WHERE turn_id = ?",
                            (json.dumps(vis_conts), ws_row["turn_id"]),
                        )

            if "parties_json" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN parties_json TEXT NOT NULL DEFAULT '[]'"
                )

            if "revealed_lore_ids_json" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN revealed_lore_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "revealed_edge_ids_json" not in ws_cols:
                conn.execute(
                    "ALTER TABLE world_state_snapshots ADD COLUMN revealed_edge_ids_json TEXT NOT NULL DEFAULT '[]'"
                )

            camp_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()
            }
            if "world_settings_json" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN world_settings_json TEXT NOT NULL DEFAULT '{\"describe_on_first_visit\": true}'"
                )

            cont_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(location_containers)").fetchall()
            }
            if "created_at_turn_id" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN created_at_turn_id TEXT NULL"
                )
            if "ui_x" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN ui_x REAL NULL"
                )
            if "ui_y" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN ui_y REAL NULL"
                )
            if "icon" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN icon TEXT NULL"
                )
            if "image_media_id" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN image_media_id TEXT NULL REFERENCES media_assets(id) ON DELETE SET NULL"
                )
            if "ghost_coords_json" not in cont_cols:
                conn.execute(
                    "ALTER TABLE location_containers ADD COLUMN ghost_coords_json TEXT NOT NULL DEFAULT '{}'"
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
            if "physical_stance" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN physical_stance TEXT NOT NULL DEFAULT 'unspecified'"
                )
            if "physical_context" not in cs_cols:
                conn.execute(
                    "ALTER TABLE character_states ADD COLUMN physical_context TEXT NOT NULL DEFAULT ''"
                )

            pts_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(persona_turn_states)").fetchall()
            }
            if "physical_stance" not in pts_cols:
                conn.execute(
                    "ALTER TABLE persona_turn_states ADD COLUMN physical_stance TEXT NOT NULL DEFAULT 'unspecified'"
                )
            if "physical_context" not in pts_cols:
                conn.execute(
                    "ALTER TABLE persona_turn_states ADD COLUMN physical_context TEXT NOT NULL DEFAULT ''"
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
            if "superseded_at_turn_id" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN superseded_at_turn_id TEXT NULL"
                )
            if "ui_x" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN ui_x REAL NULL"
                )
            if "ui_y" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN ui_y REAL NULL"
                )
            if "icon" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN icon TEXT NULL"
                )
            if "image_media_id" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN image_media_id TEXT NULL REFERENCES media_assets(id) ON DELETE SET NULL"
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
            self._migrate_location_edges_to_distance_meters(conn)
            self._migrate_location_edges_to_first_class_links(conn)

            vec_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(vector_entries)").fetchall()
            }
            if "superseded_at_turn_id" not in vec_cols:
                conn.execute(
                    "ALTER TABLE vector_entries ADD COLUMN superseded_at_turn_id TEXT NULL"
                )

            ep_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(episodic_chunks)").fetchall()
            }
            if "title" not in ep_cols:
                conn.execute(
                    "ALTER TABLE episodic_chunks ADD COLUMN title TEXT NOT NULL DEFAULT ''"
                )
            if "synopsis_text" not in ep_cols:
                conn.execute(
                    "ALTER TABLE episodic_chunks ADD COLUMN synopsis_text TEXT NOT NULL DEFAULT ''"
                )
            if "keywords_json" not in ep_cols:
                conn.execute(
                    "ALTER TABLE episodic_chunks ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "witness_character_ids_json" not in ep_cols:
                conn.execute(
                    "ALTER TABLE episodic_chunks ADD COLUMN witness_character_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "salience_score" not in ep_cols:
                conn.execute(
                    "ALTER TABLE episodic_chunks ADD COLUMN salience_score INTEGER NOT NULL DEFAULT 5"
                )

            prov_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(providers)").fetchall()
            }
            if prov_cols and "credential_storage" not in prov_cols:
                conn.execute(
                    "ALTER TABLE providers ADD COLUMN credential_storage TEXT NOT NULL DEFAULT 'server' CHECK (credential_storage IN ('server', 'browser'))"
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

            # Backfill default Kira Vance initial_message, equipped, and inventory if upgrading an existing DB
            kira_row = conn.execute(
                "SELECT id, initial_message, equipped_json, inventory_json FROM characters WHERE id = 'char_kira_vance'"
            ).fetchone()
            if kira_row:
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

            # Backfill any other pre-existing characters missing both character_bio and physical_appearance, or initial_message
            other_rows = conn.execute(
                "SELECT id, name, tagline, character_bio, physical_appearance, initial_message "
                "FROM characters WHERE (character_bio = '' AND physical_appearance = '') OR initial_message = ''"
            ).fetchall()
            for r in other_rows:
                new_bio = r["character_bio"] or r["physical_appearance"] or (
                    f"{r['name']} has an observant, grounded presence shaped by their background ({r['tagline']})."
                )
                new_msg = r["initial_message"] or (
                    f"*{r['name']} stands inside {{location_name}}. {{location_description}}*\n\n"
                    f"\"You're late,\" *{r['name']} says quietly, eyes scanning the room.*"
                )
                conn.execute(
                    "UPDATE characters SET character_bio = ?, initial_message = ? WHERE id = ?",
                    (new_bio, new_msg, r["id"]),
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
            self._migrate_to_unified_media_assets(conn)
        finally:
            conn.close()

    def _migrate_to_unified_media_assets(self, conn: sqlite3.Connection) -> None:
        """Idempotently migrate legacy world_media and per-entity character/persona media into media_assets."""
        has_world_media = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='world_media'"
        ).fetchone()
        if has_world_media:
            wm_cols = {
                r["name"] for r in conn.execute("PRAGMA table_info(world_media)").fetchall()
            }
            is_pub_expr = "is_public" if "is_public" in wm_cols else "0"
            seed_expr = "seed_key" if "seed_key" in wm_cols else "NULL"
            wm_rows = conn.execute(
                f"""
                SELECT id, owner_id, media_type, filename, label, mime_type, byte_size,
                       {is_pub_expr} AS is_public, {seed_expr} AS seed_key, created_at
                FROM world_media
                """
            ).fetchall()

            conn.commit()
            conn.execute("PRAGMA foreign_keys = OFF;")
            try:
                conn.execute("BEGIN IMMEDIATE;")
                for r in wm_rows:
                    m_type = str(r["media_type"] or "image")
                    fname = str(r["filename"])
                    is_pub = int(r["is_public"] or 0)
                    byte_sz = int(r["byte_size"] or 0)
                    if not is_pub:
                        cat = "audio" if m_type == "audio" else "images"
                        try:
                            src = safe_resolve_world_media_file_path(self.media_dir, cat, fname)
                            dst = safe_resolve_asset_file_path(self.media_dir, cat, fname)
                            if src.is_file() and not dst.is_file():
                                dst.parent.mkdir(parents=True, exist_ok=True)
                                shutil.copy2(src, dst)
                            if dst.is_file():
                                byte_sz = dst.stat().st_size
                                if src.is_file() and src != dst:
                                    src.unlink(missing_ok=True)
                        except (PathTraversalError, ValueError, OSError):
                            pass

                    conn.execute(
                        """
                        INSERT OR IGNORE INTO media_assets (
                            id, owner_id, entity_scope, media_type, role, filename, label,
                            mime_type, byte_size, is_public, seed_key, parent_image_id,
                            duration_ms, width, height, created_at
                        )
                        VALUES (?, ?, 'world', ?, 'world_scene', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
                        """,
                        (
                            r["id"],
                            r["owner_id"],
                            m_type,
                            fname,
                            r["label"] or "",
                            r["mime_type"] or "image/webp",
                            byte_sz,
                            is_pub,
                            r["seed_key"],
                            r["created_at"] or utc_now_iso(),
                        ),
                    )

                for tbl_name, create_sql, copy_cols in (
                    (
                        "world_media_links",
                        """
                        CREATE TABLE world_media_links_migrated (
                            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                            media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
                            sort_order INTEGER NOT NULL DEFAULT 0,
                            label_override TEXT NULL,
                            created_at TEXT NOT NULL,
                            PRIMARY KEY (world_id, media_id)
                        )
                        """,
                        "world_id, media_id, sort_order, label_override, created_at",
                    ),
                    (
                        "location_containers",
                        """
                        CREATE TABLE location_containers_migrated (
                            id TEXT PRIMARY KEY,
                            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                            created_at_turn_id TEXT NULL,
                            parent_container_id TEXT NULL REFERENCES location_containers(id) ON DELETE CASCADE,
                            depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 4),
                            name TEXT NOT NULL,
                            description TEXT NOT NULL DEFAULT '',
                            environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                            ui_x REAL NULL,
                            ui_y REAL NULL,
                            ghost_coords_json TEXT NOT NULL DEFAULT '{}',
                            icon TEXT NULL,
                            image_media_id TEXT NULL REFERENCES media_assets(id) ON DELETE SET NULL,
                            created_at TEXT NOT NULL
                        )
                        """,
                        "id, world_id, created_at_turn_id, parent_container_id, depth, name, description, environmental_tags_json, ui_x, ui_y, ghost_coords_json, icon, image_media_id, created_at",
                    ),
                    (
                        "location_nodes",
                        """
                        CREATE TABLE location_nodes_migrated (
                            id TEXT PRIMARY KEY,
                            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                            created_at_turn_id TEXT NULL,
                            superseded_at_turn_id TEXT NULL,
                            container_id TEXT NULL REFERENCES location_containers(id) ON DELETE SET NULL,
                            is_entry_exit INTEGER NOT NULL DEFAULT 0,
                            name TEXT NOT NULL,
                            summary TEXT NOT NULL,
                            description TEXT NOT NULL,
                            environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                            is_starting_location INTEGER NOT NULL DEFAULT 0,
                            is_hub INTEGER NOT NULL DEFAULT 0,
                            starting_message TEXT NOT NULL DEFAULT '',
                            ui_x REAL NULL,
                            ui_y REAL NULL,
                            icon TEXT NULL,
                            image_media_id TEXT NULL REFERENCES media_assets(id) ON DELETE SET NULL
                        )
                        """,
                        "id, world_id, created_at_turn_id, superseded_at_turn_id, container_id, is_entry_exit, name, summary, description, environmental_tags_json, is_starting_location, is_hub, starting_message, ui_x, ui_y, icon, image_media_id",
                    ),
                ):
                    ddl_row = conn.execute(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                        (tbl_name,),
                    ).fetchone()
                    if ddl_row and "world_media" in (ddl_row["sql"] or ""):
                        mig_tbl = f"{tbl_name}_migrated"
                        conn.execute(f"DROP TABLE IF EXISTS {mig_tbl}")
                        conn.execute(create_sql)
                        conn.execute(
                            f"INSERT INTO {mig_tbl} ({copy_cols}) SELECT {copy_cols} FROM {tbl_name}"
                        )
                        conn.execute(f"DROP TABLE {tbl_name}")
                        conn.execute(f"ALTER TABLE {mig_tbl} RENAME TO {tbl_name}")
                        if tbl_name == "world_media_links":
                            conn.execute(
                                "CREATE INDEX IF NOT EXISTS idx_world_media_links_media ON world_media_links(media_id)"
                            )
                        elif tbl_name == "location_containers":
                            conn.execute(
                                "CREATE INDEX IF NOT EXISTS idx_location_containers_world ON location_containers(world_id)"
                            )
                            conn.execute(
                                "CREATE INDEX IF NOT EXISTS idx_location_containers_parent ON location_containers(parent_container_id)"
                            )
                        elif tbl_name == "location_nodes":
                            conn.execute(
                                "CREATE INDEX IF NOT EXISTS idx_location_nodes_world ON location_nodes(world_id)"
                            )
                            conn.execute(
                                "CREATE INDEX IF NOT EXISTS idx_location_nodes_container ON location_nodes(world_id, container_id)"
                            )

                conn.execute("DROP TABLE IF EXISTS world_media")
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.execute("PRAGMA foreign_keys = ON;")

        # Migrate legacy private character & persona URLs into media_assets once
        char_url_re = re.compile(
            r"^/api/media/characters/([a-zA-Z0-9_-]+)/(portraits|gallery)/([a-zA-Z0-9_.-]+)$"
        )
        persona_url_re = re.compile(
            r"^/api/media/personas/([a-zA-Z0-9_-]+)/(portraits|gallery)/([a-zA-Z0-9_.-]+)$"
        )
        migrated_cache: dict[tuple[str, str, str, str], str] = {}
        sources_to_unlink: list[tuple[Path, Path]] = []
        now = utc_now_iso()

        def _migrate_legacy_file(
            *,
            scope: str,
            owner_id: str | None,
            entity_id: str,
            cat: str,
            fname: str,
            preferred_id: str | None = None,
        ) -> str | None:
            cache_key = (scope, entity_id, cat, fname)
            if cache_key in migrated_cache:
                return migrated_cache[cache_key]
            try:
                if scope == "character":
                    src = safe_resolve_media_file_path(self.media_dir, entity_id, cat, fname)
                else:
                    src = safe_resolve_persona_media_file_path(self.media_dir, entity_id, cat, fname)
            except (PathTraversalError, ValueError):
                return None
            if not src.is_file():
                return None

            stem_id = preferred_id or Path(fname).stem
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", stem_id):
                stem_id = f"{'por' if cat == 'portraits' else 'img'}_{uuid.uuid4().hex[:10]}"
            existing = conn.execute(
                "SELECT id FROM media_assets WHERE id = ?", (stem_id,)
            ).fetchone()
            asset_id = (
                f"{'por' if cat == 'portraits' else 'img'}_{uuid.uuid4().hex[:10]}"
                if existing
                else stem_id
            )
            dst_fname = f"{asset_id}.webp"
            dst = safe_resolve_asset_file_path(self.media_dir, "images", dst_fname)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            sources_to_unlink.append((src, dst))
            byte_sz = dst.stat().st_size
            role = "portrait" if cat == "portraits" else "album"
            conn.execute(
                """
                INSERT INTO media_assets (
                    id, owner_id, entity_scope, media_type, role, filename, label,
                    mime_type, byte_size, is_public, seed_key, parent_image_id,
                    duration_ms, width, height, created_at
                )
                VALUES (?, ?, ?, 'image', ?, ?, '', 'image/webp', ?, 0, NULL, NULL, NULL, NULL, NULL, ?)
                """,
                (asset_id, owner_id, scope, role, dst_fname, byte_sz, now),
            )
            new_url = f"/api/media/assets/{asset_id}"
            migrated_cache[cache_key] = new_url
            return new_url

        for cr in conn.execute(
            "SELECT id, owner_id, portraits_json, gallery_json FROM characters"
        ).fetchall():
            changed = False
            p_map = json.loads(cr["portraits_json"] or "{}")
            if isinstance(p_map, dict):
                for emo, raw_u in list(p_map.items()):
                    m = char_url_re.fullmatch(str(raw_u or "").strip())
                    if m:
                        new_u = _migrate_legacy_file(
                            scope="character",
                            owner_id=cr["owner_id"],
                            entity_id=m.group(1),
                            cat=m.group(2),
                            fname=m.group(3),
                        )
                        if new_u:
                            p_map[emo] = new_u
                            changed = True
            g_list = json.loads(cr["gallery_json"] or "[]")
            if isinstance(g_list, list):
                for item in g_list:
                    if not isinstance(item, dict):
                        continue
                    m = char_url_re.fullmatch(str(item.get("url") or "").strip())
                    if m:
                        new_u = _migrate_legacy_file(
                            scope="character",
                            owner_id=cr["owner_id"],
                            entity_id=m.group(1),
                            cat=m.group(2),
                            fname=m.group(3),
                            preferred_id=str(item.get("id") or "") or None,
                        )
                        if new_u:
                            item["url"] = new_u
                            item["id"] = new_u.rsplit("/", 1)[-1]
                            changed = True
            if changed:
                conn.execute(
                    "UPDATE characters SET portraits_json = ?, gallery_json = ? WHERE id = ?",
                    (json.dumps(p_map), json.dumps(g_list), cr["id"]),
                )

        for pr in conn.execute(
            "SELECT id, owner_id, portrait_url, gallery_json FROM personas"
        ).fetchall():
            changed = False
            p_url = pr["portrait_url"]
            m_p = persona_url_re.fullmatch(str(p_url or "").strip())
            if m_p:
                new_u = _migrate_legacy_file(
                    scope="persona",
                    owner_id=pr["owner_id"],
                    entity_id=m_p.group(1),
                    cat=m_p.group(2),
                    fname=m_p.group(3),
                )
                if new_u:
                    p_url = new_u
                    changed = True
            g_list = json.loads(pr["gallery_json"] or "[]")
            if isinstance(g_list, list):
                for item in g_list:
                    if not isinstance(item, dict):
                        continue
                    m = persona_url_re.fullmatch(str(item.get("url") or "").strip())
                    if m:
                        new_u = _migrate_legacy_file(
                            scope="persona",
                            owner_id=pr["owner_id"],
                            entity_id=m.group(1),
                            cat=m.group(2),
                            fname=m.group(3),
                            preferred_id=str(item.get("id") or "") or None,
                        )
                        if new_u:
                            item["url"] = new_u
                            item["id"] = new_u.rsplit("/", 1)[-1]
                            changed = True
            if changed:
                conn.execute(
                    "UPDATE personas SET portrait_url = ?, gallery_json = ? WHERE id = ?",
                    (p_url, json.dumps(g_list), pr["id"]),
                )

        for camp_r in conn.execute(
            "SELECT id, owner_id, persona_snapshot_json FROM campaigns WHERE persona_snapshot_json IS NOT NULL"
        ).fetchall():
            try:
                snap = json.loads(camp_r["persona_snapshot_json"])
            except Exception:
                continue
            if not isinstance(snap, dict):
                continue
            changed = False
            m_p = persona_url_re.fullmatch(str(snap.get("portrait_url") or "").strip())
            if m_p:
                new_u = _migrate_legacy_file(
                    scope="persona",
                    owner_id=camp_r["owner_id"],
                    entity_id=m_p.group(1),
                    cat=m_p.group(2),
                    fname=m_p.group(3),
                )
                if new_u:
                    snap["portrait_url"] = new_u
                    changed = True
            if isinstance(snap.get("gallery"), list):
                for item in snap["gallery"]:
                    if not isinstance(item, dict):
                        continue
                    m = persona_url_re.fullmatch(str(item.get("url") or "").strip())
                    if m:
                        new_u = _migrate_legacy_file(
                            scope="persona",
                            owner_id=camp_r["owner_id"],
                            entity_id=m.group(1),
                            cat=m.group(2),
                            fname=m.group(3),
                            preferred_id=str(item.get("id") or "") or None,
                        )
                        if new_u:
                            item["url"] = new_u
                            item["id"] = new_u.rsplit("/", 1)[-1]
                            changed = True
            if changed:
                conn.execute(
                    "UPDATE campaigns SET persona_snapshot_json = ? WHERE id = ?",
                    (json.dumps(snap), camp_r["id"]),
                )
        conn.commit()
        for src, dst in sources_to_unlink:
            try:
                if src.is_file() and src != dst:
                    src.unlink(missing_ok=True)
            except OSError:
                pass
