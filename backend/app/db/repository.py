"""Branch-aware SQLite repository for Worlds, Characters, Spatial Graph, and Turn Trees."""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from app.config import ModelProfile
from app.db.vector_store import VectorStore, combine_entry_text, embed_text
from app.schemas.auth import (
    PasskeyInfo,
    UserModelSettingsPayload,
    UserProfile,
    UserRole,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    CognitionBlock,
    MemoryShard,
    VoiceAnchor,
)
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
    LocationNode,
    LoreNode,
    NeighborLocationView,
    WorldGlobalRules,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
    normalize_compass_direction,
    pick_available_compass_direction,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class CantinaRepository:
    """Data access layer with native turn-tree and spatial graph traversal."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.vector_store = VectorStore(db_path)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def init_db(self) -> None:
        """Execute schema.sql to initialize all tables, indexes, and idempotent migrations."""
        schema_path = Path(__file__).resolve().parent / "schema.sql"
        sql = schema_path.read_text(encoding="utf-8")
        conn = self._connect()
        try:
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
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id)"
            )

            camp_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()
            }
            if "owner_id" not in camp_cols:
                conn.execute(
                    "ALTER TABLE campaigns ADD COLUMN owner_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE"
                )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_id)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS user_model_settings (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    actor_profile_json TEXT NULL,
                    clerk_profile_json TEXT NULL,
                    working_memory_turns INTEGER NULL,
                    updated_at TEXT NOT NULL
                )
                """
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

            loc_cols = {
                r["name"]
                for r in conn.execute("PRAGMA table_info(location_nodes)").fetchall()
            }
            if "is_hub" not in loc_cols:
                conn.execute(
                    "ALTER TABLE location_nodes ADD COLUMN is_hub INTEGER NOT NULL DEFAULT 0"
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
                    if re.match(r"^\[(?:worn|equipped)\]\s*", item, re.IGNORECASE):
                        clean_item = re.sub(r"^\[(?:worn|equipped)\]\s*", "", item, flags=re.IGNORECASE).strip()
                        if clean_item and clean_item not in new_eq:
                            new_eq.append(clean_item)
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
                    if re.match(r"^\[(?:worn|equipped)\]\s*", item, re.IGNORECASE):
                        clean_item = re.sub(r"^\[(?:worn|equipped)\]\s*", "", item, flags=re.IGNORECASE).strip()
                        if clean_item and clean_item not in new_eq:
                            new_eq.append(clean_item)
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

            # 2. Delete user characters and associated shard vectors
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

            conn.commit()
        finally:
            conn.close()

    def delete_user(self, user_id: str) -> None:
        """Permanently delete a user account, credentials, passkeys, sessions, and all their user data."""
        # Ensure user exists (raises KeyError if not found)
        self.get_user_by_id(user_id)
        # 1. Wipe all user characters, worlds, and campaigns
        self.reset_user_data(user_id)
        # 2. Remove sessions, passkeys, user model overrides, and user account record
        conn = self._connect()
        try:
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
                "SELECT actor_profile_json, clerk_profile_json, working_memory_turns FROM user_model_settings WHERE user_id = ?",
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
            return UserModelSettingsPayload(
                actor_profile=actor,
                clerk_profile=clerk,
                working_memory_turns=row["working_memory_turns"],
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
            conn.execute(
                """
                INSERT INTO user_model_settings (user_id, actor_profile_json, clerk_profile_json, working_memory_turns, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    actor_profile_json = excluded.actor_profile_json,
                    clerk_profile_json = excluded.clerk_profile_json,
                    working_memory_turns = excluded.working_memory_turns,
                    updated_at = excluded.updated_at
                """,
                (user_id, actor_json, clerk_json, payload.working_memory_turns, now),
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

    def create_world_from_draft(
        self,
        draft: WorldWizardDraft,
        world_id: str | None = None,
        lore_embeddings: list[np.ndarray] | None = None,
        owner_id: str | None = None,
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

            key_to_loc_id: dict[str, str] = {}
            for idx, loc in enumerate(draft.locations):
                loc_id = f"loc_{uuid.uuid4().hex[:10]}"
                key_to_loc_id[loc.key] = loc_id
                is_start = 1 if (loc.is_starting_location or idx == 0) else 0
                is_hub = 1 if getattr(loc, "is_hub", False) else 0
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub
                    )
                    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
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
                    ),
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
                conn.execute(
                    """
                    INSERT INTO lore_nodes (id, world_id, title, category, content, entity_tags_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lore_id,
                        w_id,
                        lore.title,
                        lore.category,
                        lore.content,
                        json.dumps(lore.entity_tags),
                    ),
                )
                precomputed = (
                    lore_embeddings[idx]
                    if lore_embeddings is not None and idx < len(lore_embeddings)
                    else None
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
        """Asynchronously pre-compute lore embeddings using embed_text and persist WorldWizardDraft."""
        embeddings: list[np.ndarray] = []
        if draft.lore_nodes:
            embeddings = list(
                await asyncio.gather(
                    *(
                        embed_text(
                            combine_entry_text(lore.title, lore.content, lore.entity_tags)
                        )
                        for lore in draft.lore_nodes
                    )
                )
            )
        return self.create_world_from_draft(
            draft,
            world_id=world_id,
            lore_embeddings=embeddings,
            owner_id=owner_id,
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
                "SELECT * FROM lore_nodes WHERE world_id = ?", (world_id,)
            ).fetchall()
        finally:
            conn.close()

        locations: list[LocationNode] = []
        for r in loc_rows:
            c_turn = r["created_at_turn_id"]
            if base_only and c_turn is not None:
                continue
            if valid_turn_ids is not None and c_turn is not None and c_turn not in valid_turn_ids:
                continue
            locations.append(self._row_to_location(r))

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

        lore_nodes = [
            LoreNode(
                id=r["id"],
                world_id=r["world_id"],
                title=r["title"],
                category=r["category"],
                content=r["content"],
                entity_tags=json.loads(r["entity_tags_json"] or "[]"),
            )
            for r in lore_rows
        ]

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

            # Cache existing lore vector blobs so unchanged lore nodes don't re-run embeddings
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ? AND source_type = 'lore'
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
                conn.execute("DELETE FROM lore_nodes WHERE world_id = ?", (target_world_id,))
                conn.execute(
                    "DELETE FROM vector_entries WHERE world_id = ? AND source_type = 'lore'",
                    (target_world_id,),
                )

                loc_id_map: dict[str, str] = {}
                for idx, loc in enumerate(base_locations):
                    new_loc_id = loc.id if loc.id and not loc.id.startswith("new_") else f"loc_{uuid.uuid4().hex[:10]}"
                    loc_id_map[loc.id] = new_loc_id
                    is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                    is_hub = 1 if getattr(loc, "is_hub", False) else 0
                    conn.execute(
                        """
                        INSERT INTO location_nodes (
                            id, world_id, created_at_turn_id, name, summary,
                            description, environmental_tags_json, is_starting_location, is_hub
                        )
                        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
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
                    conn.execute(
                        """
                        INSERT INTO location_nodes (
                            id, world_id, created_at_turn_id, name, summary,
                            description, environmental_tags_json, is_starting_location, is_hub
                        )
                        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
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

            # Insert lore nodes & vector entries (reusing existing embedding blobs when unchanged)
            for idx, lore in enumerate(payload.lore_nodes):
                lore_id = (
                    lore.id
                    if (campaigns_using == 0 and lore.id and not lore.id.startswith("new_"))
                    else f"lore_{uuid.uuid4().hex[:10]}"
                )
                tags_json = json.dumps(lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (id, world_id, title, category, content, entity_tags_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (lore_id, target_world_id, lore.title, lore.category, lore.content, tags_json),
                )
                blob_key = (lore.title, lore.content, tags_json)
                if blob_key in existing_lore_blobs:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, character_id, campaign_id,
                            anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'lore', ?, NULL, NULL, NULL, ?, ?, ?, ?)
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
                    precomputed = lore_embeddings.get(idx) if lore_embeddings else None
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
        """Asynchronously pre-compute embeddings for new/modified lore nodes and update world."""
        lore_embeddings: dict[int, np.ndarray] = {}
        if payload.lore_nodes:
            computed = await asyncio.gather(
                *(
                    embed_text(
                        combine_entry_text(lore.title, lore.content, lore.entity_tags)
                    )
                    for lore in payload.lore_nodes
                )
            )
            lore_embeddings = {idx: vec for idx, vec in enumerate(computed)}
        return self.update_world(
            world_id, payload, lore_embeddings=lore_embeddings, owner_id=owner_id
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
                # Delete only world lore vectors; preserve character backstory shards by detaching world_id
                conn.execute(
                    "DELETE FROM vector_entries WHERE world_id = ? AND source_type = 'lore'",
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

    def get_location(self, location_id: str) -> LocationNode:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM location_nodes WHERE id = ?", (location_id,)
            ).fetchone()
            if not row:
                raise KeyError(f"Location '{location_id}' not found")
            return self._row_to_location(row)
        finally:
            conn.close()

    def get_neighbor_locations(
        self,
        world_id: str,
        active_location_id: str,
        valid_turn_ids: set[str] | None = None,
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
        finally:
            conn.close()

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
        c_id = character_id or f"char_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO characters (
                    id, owner_id, world_id, name, tagline, physical_appearance, core_persona,
                    initial_message, equipped_json, inventory_json, voice_anchors_json,
                    baseline_psyche_json, memory_shards_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    c_id,
                    owner_id,
                    world_id,
                    draft.name,
                    draft.tagline,
                    draft.physical_appearance,
                    draft.core_persona,
                    draft.initial_message,
                    json.dumps(draft.equipped),
                    json.dumps(draft.inventory),
                    json.dumps([v.model_dump() for v in draft.voice_anchors]),
                    draft.baseline_psyche.model_dump_json(),
                    json.dumps([m.model_dump() for m in draft.memory_shards]),
                    now,
                ),
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

    def get_character(
        self,
        character_id: str,
        owner_id: str | None = None,
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
        finally:
            conn.close()

        row_keys = row.keys()
        return CharacterRecord(
            id=row["id"],
            world_id=row["world_id"],
            name=row["name"],
            tagline=row["tagline"],
            physical_appearance=row["physical_appearance"] if "physical_appearance" in row_keys else "",
            core_persona=row["core_persona"],
            initial_message=row["initial_message"] if "initial_message" in row_keys else "",
            equipped=json.loads(row["equipped_json"] or "[]") if "equipped_json" in row_keys else [],
            inventory=json.loads(row["inventory_json"] or "[]") if "inventory_json" in row_keys else [],
            voice_anchors=[
                VoiceAnchor.model_validate(v)
                for v in json.loads(row["voice_anchors_json"] or "[]")
            ],
            baseline_psyche=BaselinePsyche.model_validate_json(row["baseline_psyche_json"]),
            memory_shards=[
                MemoryShard.model_validate(m)
                for m in json.loads(row["memory_shards_json"] or "[]")
            ],
            pending_deletion=bool(row["pending_deletion"]) if "pending_deletion" in row_keys else False,
            created_at=row["created_at"],
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

            equipped_json = json.dumps(payload.equipped)
            inventory_json = json.dumps(payload.inventory)
            voice_json = json.dumps([v.model_dump() for v in payload.voice_anchors])
            psyche_json = payload.baseline_psyche.model_dump_json()
            shards_json = json.dumps([m.model_dump() for m in payload.memory_shards])

            if campaigns_using == 0:
                # In-place update (zero active campaigns reference this character)
                target_char_id = character_id
                conn.execute(
                    """
                    UPDATE characters
                    SET world_id = ?, name = ?, tagline = ?, physical_appearance = ?,
                        core_persona = ?, initial_message = ?, equipped_json = ?, inventory_json = ?,
                        voice_anchors_json = ?, baseline_psyche_json = ?, memory_shards_json = ?
                    WHERE id = ?
                    """,
                    (
                        target_world_id,
                        payload.name,
                        payload.tagline,
                        payload.physical_appearance,
                        payload.core_persona,
                        payload.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        target_char_id,
                    ),
                )
                conn.execute(
                    "DELETE FROM vector_entries WHERE character_id = ? AND source_type = 'character_shard'",
                    (target_char_id,),
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
                        id, owner_id, world_id, name, tagline, physical_appearance, core_persona,
                        initial_message, equipped_json, inventory_json, voice_anchors_json,
                        baseline_psyche_json, memory_shards_json,
                        pending_deletion, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        target_char_id,
                        effective_owner_id,
                        target_world_id,
                        payload.name,
                        payload.tagline,
                        payload.physical_appearance,
                        payload.core_persona,
                        payload.initial_message,
                        equipped_json,
                        inventory_json,
                        voice_json,
                        psyche_json,
                        shards_json,
                        now,
                    ),
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

            if pruned_ids:
                conn.commit()
        finally:
            conn.close()

        return pruned_ids

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
        owner_id: str | None = None,
    ) -> CampaignRecord:
        """Create a new campaign and initialize Turn 0 (opening scene snapshot)."""
        camp_id = campaign_id or f"camp_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        world = self.get_world(world_id, owner_id=owner_id)
        character = self.get_character(character_id, owner_id=owner_id)

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
                INSERT INTO campaigns (id, owner_id, name, world_id, character_id, active_leaf_turn_id, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?)
                """,
                (camp_id, owner_id, name, world_id, character_id, now),
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
        root_cognition = CognitionBlock(
            recall=f"Standing in {primary_loc.name}, keeping watch.",
            feeling=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            want=character.baseline_psyche.default_want,
            plan=character.baseline_psyche.default_plan,
        )
        root_turn_id = f"turn_{uuid.uuid4().hex[:10]}"
        root_snapshot = WorldStateSnapshot(
            turn_id=root_turn_id,
            world_timestamp=world.global_rules.starting_timestamp,
            active_location_id=primary_loc_id,
            scene_flags=["Scene Opening"],
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
            )
            for extra_char in extra_characters
        ]

        self.save_turn_node(
            turn_id=root_turn_id,
            campaign_id=camp_id,
            parent_turn_id=None,
            depth_index=0,
            user_message="[Scene Start]",
            actor_id=character.id,
            raw_prose=root_prose,
            cognition=root_cognition,
            pre_turn=PreTurnAnalysis(
                active_speaker_id=character.id,
                speaker_order=[character.id] + [
                    s.character_id for s in extra_states if s.current_location_id == primary_loc_id
                ],
            ),
            world_snapshot=root_snapshot,
            character_state=root_char_state,
            extra_character_states=extra_states,
            recalled_items=[],
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
                    valence, arousal, active_want, active_plan, relationship_notes_json, equipped_json, inventory_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    json.dumps(char.equipped),
                    json.dumps(char.inventory),
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
            return CampaignRecord(
                id=r["id"],
                name=r["name"],
                world_id=r["world_id"],
                character_id=r["character_id"],
                participant_character_ids=participant_ids,
                active_leaf_turn_id=r["active_leaf_turn_id"],
                created_at=r["created_at"],
            )
        finally:
            conn.close()

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

            # 1. Remove episodic vector entries for this campaign
            conn.execute(
                "DELETE FROM vector_entries WHERE campaign_id = ?",
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
        pre_turn: PreTurnAnalysis,
        world_snapshot: WorldStateSnapshot,
        character_state: CharacterStateSnapshot,
        recalled_items: list[RecalledMemoryItem],
        post_turn: PostTurnStateDelta | None = None,
        extra_character_states: list[CharacterStateSnapshot] | None = None,
    ) -> TurnNodeRecord:
        """Persist a new turn node + snapshots and advance campaign active_leaf_turn_id."""
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO turn_nodes (
                    id, campaign_id, parent_turn_id, depth_index, user_message,
                    actor_id, raw_prose, cognition_json, pre_turn_json,
                    post_turn_json, recalled_items_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    pre_turn.model_dump_json(),
                    post_turn.model_dump_json() if post_turn else None,
                    json.dumps([item.model_dump() for item in recalled_items]),
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO world_state_snapshots (
                    turn_id, world_timestamp, active_location_id, scene_flags_json
                )
                VALUES (?, ?, ?, ?)
                """,
                (
                    turn_id,
                    world_snapshot.world_timestamp,
                    world_snapshot.active_location_id,
                    json.dumps(world_snapshot.scene_flags),
                ),
            )

            states_by_char: dict[str, CharacterStateSnapshot] = {
                character_state.character_id: character_state
            }
            for st in extra_character_states or []:
                states_by_char[st.character_id] = st

            if parent_turn_id is not None:
                parent_cs_rows = conn.execute(
                    "SELECT * FROM character_states WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchall()
                for pcs in parent_cs_rows:
                    cid = pcs["character_id"]
                    if cid not in states_by_char:
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
                            if "equipped_json" in pcs.keys()
                            else [],
                            inventory=json.loads(pcs["inventory_json"] or "[]")
                            if "inventory_json" in pcs.keys()
                            else [],
                        )

            for st in states_by_char.values():
                conn.execute(
                    """
                    INSERT INTO character_states (
                        turn_id, character_id, current_location_id, mood_label,
                        valence, arousal, active_want, active_plan, relationship_notes_json, equipped_json, inventory_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        json.dumps(st.equipped),
                        json.dumps(st.inventory),
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
    ) -> TurnNodeRecord:
        """Commit Phase 4 Post-Turn Clerk mutations (clock advance, spatial move, affect notes)."""
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                (post_turn.model_dump_json(), turn_id),
            )
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET world_timestamp = ?, active_location_id = ?, scene_flags_json = ?
                WHERE turn_id = ?
                """,
                (
                    updated_world_snapshot.world_timestamp,
                    updated_world_snapshot.active_location_id,
                    json.dumps(updated_world_snapshot.scene_flags),
                    turn_id,
                ),
            )
            for st in [updated_character_state, *(extra_character_states or [])]:
                conn.execute(
                    """
                    UPDATE character_states
                    SET current_location_id = ?, mood_label = ?, valence = ?, arousal = ?,
                        active_want = ?, active_plan = ?, relationship_notes_json = ?, equipped_json = ?, inventory_json = ?
                    WHERE turn_id = ? AND character_id = ?
                    """,
                    (
                        st.current_location_id,
                        st.mood_label,
                        st.valence,
                        st.arousal,
                        st.active_want,
                        st.active_plan,
                        json.dumps(st.relationship_notes),
                        json.dumps(st.equipped),
                        json.dumps(st.inventory),
                        turn_id,
                        st.character_id,
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
                if "equipped_json" in r.keys()
                else [],
                inventory=json.loads(r["inventory_json"] or "[]")
                if "inventory_json" in r.keys()
                else [],
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
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = t.actor_id
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
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json
                FROM branch_path bp
                JOIN turn_nodes t ON t.id = bp.id
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = t.actor_id
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
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = t.actor_id
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

        new_flags: list[str] = []
        for f in leaf_turn.world_snapshot.scene_flags:
            if old_loc_name and f.strip().lower() == f"at {old_loc_name.lower()}":
                continue
            new_flags.append(f)
        at_target = f"At {target_loc.name}"
        if all(f.strip().lower() != at_target.lower() for f in new_flags):
            new_flags.append(at_target)

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
        item: str,
        action: str,  # "equip" | "unequip"
        character_id: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Move an item between inventory and equipped on the active leaf turn (applies from next turn)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        target_char_id = character_id or leaf_turn.actor_id or campaign.character_id
        target_state = leaf_turn.character_states.get(target_char_id, leaf_turn.character_state)
        if target_state.character_id != target_char_id and leaf_turn.actor_id == target_char_id:
            target_state = leaf_turn.character_state

        def _clean(raw: str) -> str:
            s = raw.strip()
            s = re.sub(r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*", "", s, flags=re.IGNORECASE)
            s = re.sub(r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$", "", s, flags=re.IGNORECASE)
            return s.strip()

        clean_target = _clean(item)
        target_low = clean_target.lower()
        equipped = list(target_state.equipped)
        inventory = list(target_state.inventory)

        if action == "equip":
            # Remove matching item from inventory, add to equipped
            removed_label: str | None = None
            new_inv: list[str] = []
            for it in inventory:
                it_clean = _clean(it)
                if removed_label is None and (it.strip().lower() == item.strip().lower() or it_clean.lower() == target_low):
                    removed_label = it_clean
                else:
                    new_inv.append(it)
            final_item = removed_label or clean_target
            if final_item and not any(_clean(eq).lower() == final_item.lower() for eq in equipped):
                equipped.append(final_item)
            inventory = new_inv
        elif action == "unequip":
            # Remove matching item from equipped, add to inventory
            removed_label = None
            new_eq: list[str] = []
            for eq in equipped:
                eq_clean = _clean(eq)
                if removed_label is None and (eq.strip().lower() == item.strip().lower() or eq_clean.lower() == target_low):
                    removed_label = eq_clean
                else:
                    new_eq.append(eq)
            final_item = removed_label or clean_target
            if final_item and not any(_clean(inv).lower() == final_item.lower() for inv in inventory):
                inventory.append(final_item)
            equipped = new_eq
        else:
            raise ValueError(f"Invalid item equip action '{action}'. Must be 'equip' or 'unequip'.")

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE character_states
                SET equipped_json = ?, inventory_json = ?
                WHERE turn_id = ? AND character_id = ?
                """,
                (json.dumps(equipped), json.dumps(inventory), leaf_turn.id, target_char_id),
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

        world_filtered = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        active_loc = self.get_location(leaf_turn.world_snapshot.active_location_id)
        neighbors = self.get_neighbor_locations(
            campaign.world_id,
            active_loc.id,
            valid_turn_ids=valid_turn_ids,
        )
        episodic_chunks = self.get_branch_episodic_chunks(campaign_id, valid_turn_ids)

        present_ids = [
            cid
            for cid, st in leaf_turn.character_states.items()
            if st.current_location_id == active_loc.id
        ]

        return CampaignStateBundle(
            campaign=campaign,
            active_branch_turns=branch_turns,
            all_turn_nodes=all_turns,
            current_world_snapshot=leaf_turn.world_snapshot,
            current_character_state=leaf_turn.character_state,
            character_states=leaf_turn.character_states,
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
        return TurnNodeRecord(
            id=r["id"],
            campaign_id=r["campaign_id"],
            parent_turn_id=r["parent_turn_id"],
            depth_index=r["depth_index"],
            user_message=r["user_message"],
            actor_id=r["actor_id"],
            raw_prose=r["raw_prose"],
            cognition=CognitionBlock.model_validate_json(r["cognition_json"]),
            pre_turn=PreTurnAnalysis.model_validate_json(r["pre_turn_json"]),
            post_turn=PostTurnStateDelta.model_validate_json(post_json) if post_json else None,
            world_snapshot=WorldStateSnapshot(
                turn_id=r["id"],
                world_timestamp=r["world_timestamp"],
                active_location_id=r["active_location_id"],
                scene_flags=json.loads(r["scene_flags_json"] or "[]"),
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
            ),
            recalled_items=[
                RecalledMemoryItem.model_validate(item)
                for item in json.loads(r["recalled_items_json"] or "[]")
            ],
            created_at=r["created_at"],
        )
