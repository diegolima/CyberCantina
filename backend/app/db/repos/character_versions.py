"""Character updates, version history snapshots/restores, and campaign memory edits."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
import numpy as np
from app.db.vector_store import combine_entry_text, embed_text
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterUpdatePayload,
    CharacterVersionSummary,
    CharacterWizardDraft,
    GalleryImage,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
    dump_items_json,
)
from app.schemas.turn import CampaignStateBundle
from app.security.media_path import validate_safe_character_id
from app.db.repos.base import (
    _validate_world_artifact_lore_id,
    _sanitize_character_media,
    slugify_tag,
    utc_now_iso,
    STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS,
)


class CharacterVersionsMixin:
    """Character updates, version history snapshots/restores, and campaign memory edits."""

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
