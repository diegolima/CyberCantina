"""Campaign creation, membership, and prompt preset assignment."""

from __future__ import annotations

import json
import uuid
from app.engine.affective_engine import seed_initial_care_state
from app.schemas.character import CharacterStateSnapshot, CognitionBlock, dump_items_json
from app.schemas.persona import PersonaRecord, get_default_persona
from app.schemas.turn import (
    CampaignRecord,
    CampaignStateBundle,
    PreTurnAnalysis,
    WorldStateSnapshot,
)
from app.db.repos.base import _dump_care_state_json, utc_now_iso


class CampaignsMixin:
    """Campaign creation, membership, and prompt preset assignment."""

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
        world = self.get_world(world_id, base_only=True, owner_id=owner_id)
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
        root_visited_ids = list(
            dict.fromkeys(
                [primary_loc_id, *[loc_map.get(ec.id, start_loc.id) for ec in extra_characters]]
            )
        )
        root_snapshot = WorldStateSnapshot(
            turn_id=root_turn_id,
            world_timestamp=world.global_rules.starting_timestamp,
            active_location_id=primary_loc_id,
            scene_flags=["Scene Opening"],
            campaign_elapsed_minutes=0,
            visited_location_ids=root_visited_ids,
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
