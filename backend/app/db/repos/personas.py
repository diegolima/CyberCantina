"""Player personas and dynamic campaign persona turn state."""

from __future__ import annotations

import json
import sqlite3
import uuid
from app.schemas.persona import (
    DEFAULT_PERSONA_ID,
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
from app.db.repos.base import utc_now_iso


class PersonasMixin:
    """Player personas and dynamic campaign persona turn state."""

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

    @classmethod
    def _ensure_default_persona_for_user_conn(cls, conn: sqlite3.Connection, user_id: str) -> PersonaRecord:
        """Ensure the deterministic default 'User' persona exists for the specified user."""
        def_id = default_persona_id_for_user(user_id)
        r = conn.execute("SELECT * FROM personas WHERE id = ?", (def_id,)).fetchone()
        if r:
            return cls._row_to_persona_record(r)

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
