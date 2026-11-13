"""Campaign item equip toggles and location/container lore overrides."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, Literal
import numpy as np
from app.db.vector_store import combine_entry_text
from app.schemas.character import (
    ItemFlag,
    ItemInstance,
    VALID_ITEM_FLAGS,
    coerce_item_list,
    dump_items_json,
    normalize_item_key,
    strip_item_location_affixes,
)
from app.schemas.turn import (
    CampaignRecord,
    CampaignStateBundle,
)
from app.schemas.world import (
    LocationLoreNodeDraft,
)
from app.db.repos.base import (
    UNSET,
    _validate_world_artifact_lore_id,
    _compute_missing_embeddings,
    _location_lore_vector_fields,
    utc_now_iso,
)


class CampaignLoreItemsMixin:
    """Campaign item equip toggles and location/container lore overrides."""

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

    def _resolve_campaign_lore_target(
        self,
        campaign_id: str,
        scope_kind: Literal["location", "container"],
        target_id: str,
        *,
        owner_id: str | None = None,
    ) -> tuple[CampaignRecord, str, str | None]:
        """Validate ownership, branch visibility/depth, and return (campaign, entity_name, anchor_turn_id)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}

        if scope_kind == "location":
            loc = self.get_location(target_id, campaign_id=campaign_id)
            if loc.world_id != campaign.world_id:
                raise KeyError(
                    f"Location '{target_id}' does not belong to campaign '{campaign_id}'"
                )
            if loc.created_at_turn_id is not None and loc.created_at_turn_id not in valid_turn_ids:
                raise KeyError(
                    f"Location '{target_id}' is not visible on the active timeline branch"
                )
            return campaign, loc.name, loc.created_at_turn_id

        conn = self._connect()
        try:
            c_row = conn.execute(
                "SELECT id, world_id, name, depth FROM location_containers WHERE id = ?",
                (target_id,),
            ).fetchone()
        finally:
            conn.close()
        if not c_row:
            raise KeyError(f"Container '{target_id}' not found")
        if c_row["world_id"] != campaign.world_id:
            raise KeyError(
                f"Container '{target_id}' does not belong to campaign '{campaign_id}'"
            )
        if int(c_row["depth"]) != 1:
            raise ValueError(
                f"Only Level 1 containers support scoped lore entries (container '{c_row['name']}' is depth {c_row['depth']})."
            )
        return campaign, c_row["name"], None

    def _update_campaign_scoped_lore(
        self,
        campaign_id: str,
        scope_kind: Literal["location", "container"],
        target_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> CampaignStateBundle:
        """Persist a Copy-on-Write location or Level 1 container lore override scoped to one campaign."""
        campaign, scope_name, anchor_turn_id = self._resolve_campaign_lore_target(
            campaign_id, scope_kind, target_id, owner_id=owner_id
        )
        scope_col = "location_id" if scope_kind == "location" else "container_id"
        override_table = (
            "campaign_location_lore_overrides"
            if scope_kind == "location"
            else "campaign_container_lore_overrides"
        )
        source_type = "location_lore" if scope_kind == "location" else "container_lore"

        now = utc_now_iso()
        conn = self._connect()
        try:
            vec_rows = conn.execute(
                f"""
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND {scope_col} = ?
                  AND source_type = ?
                """,
                (campaign.world_id, target_id, source_type),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }

            prev_camp_lore_ids = {
                r["id"]
                for r in conn.execute(
                    f"SELECT id FROM lore_nodes WHERE campaign_id = ? AND {scope_col} = ?",
                    (campaign_id, target_id),
                ).fetchall()
            }

            conn.execute(
                f"""
                INSERT INTO {override_table} (campaign_id, {scope_col}, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(campaign_id, {scope_col}) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (campaign_id, target_id, now),
            )
            conn.execute(
                f"DELETE FROM lore_nodes WHERE campaign_id = ? AND {scope_col} = ?",
                (campaign_id, target_id),
            )
            conn.execute(
                f"""
                DELETE FROM vector_entries
                WHERE campaign_id = ? AND {scope_col} = ? AND source_type = ?
                """,
                (campaign_id, target_id, source_type),
            )

            taken_ids = {
                r["id"] for r in conn.execute("SELECT id FROM lore_nodes").fetchall()
            }
            for item_lore in lore_nodes:
                can_reuse_id = (
                    bool(item_lore.id)
                    and item_lore.id in prev_camp_lore_ids
                    and item_lore.id not in taken_ids
                )
                lore_id = item_lore.id if can_reuse_id else f"lore_{uuid.uuid4().hex[:10]}"
                taken_ids.add(lore_id)
                tags_json = json.dumps(item_lore.entity_tags)
                loc_val = target_id if scope_kind == "location" else None
                cont_val = target_id if scope_kind == "container" else None
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, container_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        lore_id,
                        campaign.world_id,
                        loc_val,
                        cont_val,
                        campaign_id,
                        item_lore.title,
                        item_lore.category,
                        item_lore.content,
                        tags_json,
                    ),
                )
                if item_lore.category != "secret":
                    vec_title, vec_keywords = _location_lore_vector_fields(
                        scope_name, item_lore.title, item_lore.entity_tags
                    )
                    vec_kw_json = json.dumps(vec_keywords)
                    blob_key = (vec_title, item_lore.content, vec_kw_json)
                    if blob_key in existing_blobs:
                        conn.execute(
                            """
                            INSERT INTO vector_entries (
                                id, source_type, world_id, location_id, container_id, character_id, campaign_id,
                                anchor_turn_id, title, content, keywords_json, embedding_blob
                            )
                            VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                lore_id,
                                source_type,
                                campaign.world_id,
                                loc_val,
                                cont_val,
                                campaign_id,
                                anchor_turn_id,
                                vec_title,
                                item_lore.content,
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
                            source_type=source_type,
                            world_id=campaign.world_id,
                            location_id=loc_val,
                            container_id=cont_val,
                            campaign_id=campaign_id,
                            anchor_turn_id=anchor_turn_id,
                            title=vec_title,
                            content=item_lore.content,
                            keywords=vec_keywords,
                            embedding=pre_vec,
                            conn=conn,
                        )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    async def _aupdate_campaign_scoped_lore(
        self,
        campaign_id: str,
        scope_kind: Literal["location", "container"],
        target_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Validate ownership/branch visibility, pre-compute missing embeddings asynchronously, and save override."""
        campaign, scope_name, _ = self._resolve_campaign_lore_target(
            campaign_id, scope_kind, target_id, owner_id=owner_id
        )
        scope_col = "location_id" if scope_kind == "location" else "container_id"
        source_type = "location_lore" if scope_kind == "location" else "container_lore"

        conn = self._connect()
        try:
            vec_rows = conn.execute(
                f"""
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND {scope_col} = ?
                  AND source_type = ?
                """,
                (campaign.world_id, target_id, source_type),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }
        finally:
            conn.close()

        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for item_lore in lore_nodes:
            if item_lore.category == "secret":
                continue
            vec_title, vec_keywords = _location_lore_vector_fields(
                scope_name, item_lore.title, item_lore.entity_tags
            )
            vec_kw_json = json.dumps(vec_keywords)
            items_to_embed.append(
                (
                    (vec_title, item_lore.content, vec_kw_json),
                    combine_entry_text(vec_title, item_lore.content, vec_keywords),
                )
            )

        precomputed = await _compute_missing_embeddings(items_to_embed, existing_blobs)
        return self._update_campaign_scoped_lore(
            campaign_id,
            scope_kind,
            target_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

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
        return self._update_campaign_scoped_lore(
            campaign_id,
            "location",
            location_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed_embeddings,
        )

    async def aupdate_campaign_location_lore(
        self,
        campaign_id: str,
        location_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Validate ownership/branch visibility, pre-compute missing embeddings asynchronously, and save override."""
        return await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "location",
            location_id,
            lore_nodes,
            owner_id=owner_id,
        )

    def update_campaign_container_lore(
        self,
        campaign_id: str,
        container_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> CampaignStateBundle:
        """Persist a Copy-on-Write Level 1 container lore override scoped strictly to a single campaign."""
        return self._update_campaign_scoped_lore(
            campaign_id,
            "container",
            container_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed_embeddings,
        )

    async def aupdate_campaign_container_lore(
        self,
        campaign_id: str,
        container_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Validate ownership/Level 1 container, pre-compute missing embeddings asynchronously, and save override."""
        return await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "container",
            container_id,
            lore_nodes,
            owner_id=owner_id,
        )
