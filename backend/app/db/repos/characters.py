"""Character creation, access checks, media staging, portraits/gallery, and soft-deletion."""

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
from app.db.repos.character_versions import CharacterVersionsMixin


class CharactersMixin(CharacterVersionsMixin):
    """Character creation, access checks, media staging, portraits/gallery, and soft-deletion."""

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
