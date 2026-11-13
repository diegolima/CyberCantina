"""Users, passkeys, sessions, and per-user model settings persistence."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from app.config import ModelProfile
from app.schemas.auth import PasskeyInfo, UserModelSettingsPayload, UserProfile, UserRole
from app.db.repos.base import _delete_campaign_rows, utc_now_iso, WEBAUTHN_CHALLENGE_TTL_SECONDS


class AuthUsersMixin:
    """Users, passkeys, sessions, and per-user model settings persistence."""

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
                INSERT INTO users (
                    id, username, display_name, password_hash, role,
                    created_at, updated_at, last_login_at, last_active_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (u_id, clean_username, clean_display, password_hash, role, now, now, None, now),
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
            last_login_at=row["last_login_at"] if "last_login_at" in row.keys() else None,
            last_active_at=row["last_active_at"] if "last_active_at" in row.keys() else None,
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
                _delete_campaign_rows(conn, r["id"])

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
        # 2. Remove staged draft media, prompt presets, sessions, passkeys, model overrides, and user record
        conn = self._connect()
        try:
            staged_rows = conn.execute(
                "SELECT character_id FROM staged_character_ownership WHERE user_id = ?",
                (user_id,),
            ).fetchall()
            for sr in staged_rows:
                self._delete_character_media(sr["character_id"])
            conn.execute("DELETE FROM staged_character_ownership WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM prompt_presets WHERE owner_id = ?", (user_id,))
            conn.execute("DELETE FROM providers WHERE scope = 'user' AND owner_id = ?", (user_id,))
            conn.execute("DELETE FROM user_model_settings WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM user_passkeys WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
        finally:
            conn.close()

    def touch_user_login(self, user_id: str) -> None:
        """Record an explicit authentication event on both last_login_at and last_active_at."""
        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE users SET last_login_at = ?, last_active_at = ? WHERE id = ?",
                (now, now, user_id),
            )
            conn.commit()
        finally:
            conn.close()

    def list_inactive_purge_candidates(
        self, cutoff_iso: str, *, exclude_user_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Return standard ('user') accounts whose effective last activity predates ``cutoff_iso``."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.created_at,
                    u.last_login_at,
                    u.last_active_at,
                    COALESCE(u.last_active_at, u.created_at) AS effective_last_active_at,
                    (SELECT COUNT(*) FROM characters c WHERE c.owner_id = u.id) AS character_count,
                    (SELECT COUNT(*) FROM worlds w WHERE w.owner_id = u.id) AS world_count,
                    (SELECT COUNT(*) FROM campaigns camp WHERE camp.owner_id = u.id) AS campaign_count
                FROM users u
                WHERE u.role = 'user'
                  AND COALESCE(u.last_active_at, u.created_at) < ?
                ORDER BY effective_last_active_at ASC
                """,
                (cutoff_iso,),
            ).fetchall()
            candidates: list[dict[str, Any]] = []
            for r in rows:
                uid = r["id"]
                if exclude_user_id and uid == exclude_user_id:
                    continue
                char_rows = conn.execute(
                    """
                    SELECT id AS character_id FROM characters WHERE owner_id = ?
                    UNION
                    SELECT character_id FROM staged_character_ownership WHERE user_id = ?
                    """,
                    (uid, uid),
                ).fetchall()
                candidates.append(
                    {
                        "user_id": uid,
                        "username": r["username"],
                        "display_name": r["display_name"],
                        "created_at": r["created_at"],
                        "last_login_at": r["last_login_at"],
                        "last_active_at": r["last_active_at"],
                        "effective_last_active_at": r["effective_last_active_at"],
                        "character_count": int(r["character_count"]),
                        "world_count": int(r["world_count"]),
                        "campaign_count": int(r["campaign_count"]),
                        "character_ids": [cr["character_id"] for cr in char_rows],
                    }
                )
            return candidates
        finally:
            conn.close()

    def get_user_model_settings(self, user_id: str) -> UserModelSettingsPayload | None:
        """Fetch per-user model settings overrides if present."""
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT actor_profile_json, clerk_profile_json, working_memory_turns,
                       active_prompt_preset_id, delegate_cognition_to_clerk, max_scene_flags,
                       agent_dispatch_mode, persona_disclosure_mode, clerk_mirrors_actor,
                       min_working_memory_turns, lod_summary_chunks, lod_importance_bonus,
                       zone2_budget_share_pct, recall_budget_prose_tokens, recall_budget_cognition_tokens
                FROM user_model_settings WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
            if not row:
                return None
            rkeys = row.keys()
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
                if "agent_dispatch_mode" in rkeys
                else None
            )
            dispatch_mode = (
                raw_dispatch if raw_dispatch in ("sequential", "parallel") else None
            )
            raw_pdm = (
                row["persona_disclosure_mode"]
                if "persona_disclosure_mode" in rkeys
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
                min_working_memory_turns=row["min_working_memory_turns"] if "min_working_memory_turns" in rkeys else None,
                lod_summary_chunks=row["lod_summary_chunks"] if "lod_summary_chunks" in rkeys else None,
                lod_importance_bonus=row["lod_importance_bonus"] if "lod_importance_bonus" in rkeys else None,
                zone2_budget_share_pct=row["zone2_budget_share_pct"] if "zone2_budget_share_pct" in rkeys else None,
                recall_budget_prose_tokens=row["recall_budget_prose_tokens"] if "recall_budget_prose_tokens" in rkeys else None,
                recall_budget_cognition_tokens=row["recall_budget_cognition_tokens"] if "recall_budget_cognition_tokens" in rkeys else None,
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
                INSERT INTO user_model_settings (
                    user_id, actor_profile_json, clerk_profile_json, working_memory_turns,
                    active_prompt_preset_id, delegate_cognition_to_clerk, max_scene_flags,
                    agent_dispatch_mode, persona_disclosure_mode, clerk_mirrors_actor,
                    min_working_memory_turns, lod_summary_chunks, lod_importance_bonus,
                    zone2_budget_share_pct, recall_budget_prose_tokens, recall_budget_cognition_tokens,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    min_working_memory_turns = excluded.min_working_memory_turns,
                    lod_summary_chunks = excluded.lod_summary_chunks,
                    lod_importance_bonus = excluded.lod_importance_bonus,
                    zone2_budget_share_pct = excluded.zone2_budget_share_pct,
                    recall_budget_prose_tokens = excluded.recall_budget_prose_tokens,
                    recall_budget_cognition_tokens = excluded.recall_budget_cognition_tokens,
                    updated_at = excluded.updated_at
                """,
                (
                    user_id,
                    actor_json,
                    clerk_json,
                    payload.working_memory_turns,
                    payload.active_prompt_preset_id,
                    del_cog_val,
                    payload.max_scene_flags,
                    payload.agent_dispatch_mode,
                    pdm_val,
                    mirror_val,
                    payload.min_working_memory_turns,
                    payload.lod_summary_chunks,
                    payload.lod_importance_bonus,
                    payload.zone2_budget_share_pct,
                    payload.recall_budget_prose_tokens,
                    payload.recall_budget_cognition_tokens,
                    now,
                ),
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
            user_id = row["user_id"]
            user_row = conn.execute(
                "SELECT last_active_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            should_touch_user = True
            if user_row and user_row["last_active_at"]:
                try:
                    prev_user_dt = datetime.strptime(
                        user_row["last_active_at"], "%Y-%m-%dT%H:%M:%SZ"
                    ).replace(tzinfo=timezone.utc)
                    if (now_dt - prev_user_dt).total_seconds() < 1800:
                        should_touch_user = False
                except ValueError:
                    should_touch_user = True
            if should_touch_user:
                conn.execute(
                    "UPDATE users SET last_active_at = ? WHERE id = ?",
                    (now_iso, user_id),
                )
            conn.commit()
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
