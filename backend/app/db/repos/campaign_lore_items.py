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
    LoreNode,
    WorldLoreNodeDraft,
    normalize_and_validate_entity_tags,
)
from app.db.repos.base import (
    UNSET,
    _validate_world_artifact_lore_id,
    _compute_missing_embeddings,
    _location_lore_vector_fields,
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
                if turn_actor and turn_actor not in ("__narrator__", "__arrival__", "__solo__")
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

    @staticmethod
    def _require_gm_lore_unlocked(campaign: CampaignRecord) -> None:
        if not campaign.world_settings.unlock_lore:
            raise PermissionError(
                "Unlock Lore & Secrets (GM Mode) must be enabled in World Settings to modify campaign lore or major events."
            )

    def _resolve_campaign_lore_target(
        self,
        campaign_id: str,
        scope_kind: Literal["world", "location", "container"],
        target_id: str | None,
        *,
        owner_id: str | None = None,
    ) -> tuple[CampaignRecord, str, str, set[str]]:
        """Validate ownership, branch visibility/depth, and return (campaign, entity_name, leaf_turn_id, valid_turn_ids)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn_id = campaign.active_leaf_turn_id
        branch_turns = self.get_branch_turn_chain(leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}

        if scope_kind == "world":
            return campaign, "", leaf_turn_id, valid_turn_ids

        if not target_id:
            raise KeyError(f"Missing target ID for '{scope_kind}' lore scope")

        if scope_kind == "location":
            loc = self.get_location(
                target_id, campaign_id=campaign_id, valid_turn_ids=valid_turn_ids
            )
            if loc.world_id != campaign.world_id:
                raise KeyError(
                    f"Location '{target_id}' does not belong to campaign '{campaign_id}'"
                )
            if loc.created_at_turn_id is not None and loc.created_at_turn_id not in valid_turn_ids:
                raise KeyError(
                    f"Location '{target_id}' is not visible on the active timeline branch"
                )
            return campaign, loc.name, leaf_turn_id, valid_turn_ids

        conn = self._connect()
        try:
            c_row = conn.execute(
                "SELECT id, world_id, name, depth, created_at_turn_id FROM location_containers WHERE id = ?",
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
        c_turn = c_row["created_at_turn_id"] if "created_at_turn_id" in c_row.keys() else None
        if c_turn is not None and c_turn not in valid_turn_ids:
            raise KeyError(
                f"Container '{target_id}' is not visible on the active timeline branch"
            )
        if int(c_row["depth"]) != 1:
            raise ValueError(
                f"Only Level 1 containers support scoped lore entries (container '{c_row['name']}' is depth {c_row['depth']})."
            )
        return campaign, c_row["name"], leaf_turn_id, valid_turn_ids

    @staticmethod
    def _lore_vector_fields_for_scope(
        scope_kind: Literal["world", "location", "container"],
        scope_name: str,
        title: str,
        entity_tags: list[str],
    ) -> tuple[str, list[str]]:
        if scope_kind == "world":
            return title, list(entity_tags)
        return _location_lore_vector_fields(scope_name, title, entity_tags)

    def _update_campaign_scoped_lore(
        self,
        campaign_id: str,
        scope_kind: Literal["world", "location", "container"],
        target_id: str | None,
        lore_nodes: list[LocationLoreNodeDraft] | list[WorldLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Persist branch-safe Copy-on-Write world, location, or Level 1 container lore changes anchored to active_leaf_turn_id."""
        campaign, scope_name, leaf_turn_id, valid_turn_ids = self._resolve_campaign_lore_target(
            campaign_id, scope_kind, target_id, owner_id=owner_id
        )
        if enforce_unlock:
            self._require_gm_lore_unlocked(campaign)

        source_type = (
            "lore"
            if scope_kind == "world"
            else ("location_lore" if scope_kind == "location" else "container_lore")
        )
        loc_val = target_id if scope_kind == "location" else None
        cont_val = target_id if scope_kind == "container" else None

        conn = self._connect()
        try:
            if scope_kind == "world":
                current_lore = self._resolve_world_lore_list(
                    conn,
                    campaign.world_id,
                    campaign_id=campaign_id,
                    valid_turn_ids=valid_turn_ids,
                )
                vec_rows = conn.execute(
                    """
                    SELECT title, content, keywords_json, embedding_blob
                    FROM vector_entries
                    WHERE world_id = ? AND source_type = 'lore'
                    """,
                    (campaign.world_id,),
                ).fetchall()
            elif scope_kind == "location":
                current_lore = self._resolve_location_lore_map(
                    conn,
                    [target_id or ""],
                    campaign_id=campaign_id,
                    valid_turn_ids=valid_turn_ids,
                ).get(target_id or "", [])
                vec_rows = conn.execute(
                    """
                    SELECT title, content, keywords_json, embedding_blob
                    FROM vector_entries
                    WHERE world_id = ? AND location_id = ? AND source_type = 'location_lore'
                    """,
                    (campaign.world_id, target_id),
                ).fetchall()
            else:
                current_lore = self._resolve_container_lore_map(
                    conn,
                    [target_id or ""],
                    campaign_id=campaign_id,
                    valid_turn_ids=valid_turn_ids,
                ).get(target_id or "", [])
                vec_rows = conn.execute(
                    """
                    SELECT title, content, keywords_json, embedding_blob
                    FROM vector_entries
                    WHERE world_id = ? AND container_id = ? AND source_type = 'container_lore'
                    """,
                    (campaign.world_id, target_id),
                ).fetchall()

            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }
            current_by_id: dict[str, LoreNode] = {ln.id: ln for ln in current_lore}
            taken_ids = {
                r["id"] for r in conn.execute("SELECT id FROM lore_nodes").fetchall()
            }

            def _upsert_lore_vector(
                entry_id: str,
                draft_item: LocationLoreNodeDraft | WorldLoreNodeDraft,
                anchor_turn: str | None,
            ) -> None:
                if draft_item.category == "secret":
                    conn.execute("DELETE FROM vector_entries WHERE id = ?", (entry_id,))
                    return
                vec_title, vec_keywords = self._lore_vector_fields_for_scope(
                    scope_kind, scope_name, draft_item.title, draft_item.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                blob_key = (vec_title, draft_item.content, vec_kw_json)
                if blob_key in existing_blobs:
                    conn.execute("DELETE FROM vector_entries WHERE id = ?", (entry_id,))
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, location_id, container_id, character_id, campaign_id,
                            anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            entry_id,
                            source_type,
                            campaign.world_id,
                            loc_val,
                            cont_val,
                            campaign_id,
                            anchor_turn,
                            vec_title,
                            draft_item.content,
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
                        entry_id=entry_id,
                        source_type=source_type,
                        world_id=campaign.world_id,
                        location_id=loc_val,
                        container_id=cont_val,
                        campaign_id=campaign_id,
                        anchor_turn_id=anchor_turn,
                        title=vec_title,
                        content=draft_item.content,
                        keywords=vec_keywords,
                        embedding=pre_vec,
                        conn=conn,
                    )

            matched_current_ids: set[str] = set()
            for item_lore in lore_nodes:
                existing = (
                    current_by_id.get(item_lore.id)
                    if getattr(item_lore, "id", None)
                    else None
                )
                if existing is not None and existing.id not in matched_current_ids:
                    matched_current_ids.add(existing.id)
                    unchanged = (
                        existing.title == item_lore.title
                        and existing.category == item_lore.category
                        and existing.content == item_lore.content
                        and list(existing.entity_tags) == list(item_lore.entity_tags)
                    )
                    if unchanged:
                        continue
                    tags_json = json.dumps(item_lore.entity_tags)
                    if (
                        existing.campaign_id == campaign_id
                        and existing.created_at_turn_id == leaf_turn_id
                    ):
                        conn.execute(
                            """
                            UPDATE lore_nodes
                            SET title = ?, category = ?, content = ?, entity_tags_json = ?
                            WHERE id = ?
                            """,
                            (
                                item_lore.title,
                                item_lore.category,
                                item_lore.content,
                                tags_json,
                                existing.id,
                            ),
                        )
                        _upsert_lore_vector(existing.id, item_lore, leaf_turn_id)
                    else:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO campaign_lore_tombstones (campaign_id, turn_id, lore_id)
                            VALUES (?, ?, ?)
                            """,
                            (campaign_id, leaf_turn_id, existing.id),
                        )
                        new_id = f"lore_{uuid.uuid4().hex[:10]}"
                        while new_id in taken_ids:
                            new_id = f"lore_{uuid.uuid4().hex[:10]}"
                        taken_ids.add(new_id)
                        origin_id = existing.origin_lore_id or existing.id
                        conn.execute(
                            """
                            INSERT INTO lore_nodes (
                                id, world_id, location_id, container_id, campaign_id,
                                created_at_turn_id, origin_lore_id, is_major_event,
                                title, category, content, entity_tags_json
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                new_id,
                                campaign.world_id,
                                loc_val,
                                cont_val,
                                campaign_id,
                                leaf_turn_id,
                                origin_id,
                                1 if existing.is_major_event else 0,
                                item_lore.title,
                                item_lore.category,
                                item_lore.content,
                                tags_json,
                            ),
                        )
                        _upsert_lore_vector(new_id, item_lore, leaf_turn_id)
                else:
                    new_id = f"lore_{uuid.uuid4().hex[:10]}"
                    while new_id in taken_ids:
                        new_id = f"lore_{uuid.uuid4().hex[:10]}"
                    taken_ids.add(new_id)
                    tags_json = json.dumps(item_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, container_id, campaign_id,
                            created_at_turn_id, origin_lore_id, is_major_event,
                            title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)
                        """,
                        (
                            new_id,
                            campaign.world_id,
                            loc_val,
                            cont_val,
                            campaign_id,
                            leaf_turn_id,
                            item_lore.title,
                            item_lore.category,
                            item_lore.content,
                            tags_json,
                        ),
                    )
                    _upsert_lore_vector(new_id, item_lore, leaf_turn_id)

            for old_item in current_lore:
                if old_item.id in matched_current_ids:
                    continue
                if (
                    old_item.campaign_id == campaign_id
                    and old_item.created_at_turn_id == leaf_turn_id
                ):
                    conn.execute("DELETE FROM lore_nodes WHERE id = ?", (old_item.id,))
                    conn.execute("DELETE FROM vector_entries WHERE id = ?", (old_item.id,))
                else:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO campaign_lore_tombstones (campaign_id, turn_id, lore_id)
                        VALUES (?, ?, ?)
                        """,
                        (campaign_id, leaf_turn_id, old_item.id),
                    )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    async def _aupdate_campaign_scoped_lore(
        self,
        campaign_id: str,
        scope_kind: Literal["world", "location", "container"],
        target_id: str | None,
        lore_nodes: list[LocationLoreNodeDraft] | list[WorldLoreNodeDraft],
        *,
        owner_id: str | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Validate ownership/GM unlock/branch visibility, pre-compute missing embeddings asynchronously, and save CoW diff."""
        campaign, scope_name, _, _ = self._resolve_campaign_lore_target(
            campaign_id, scope_kind, target_id, owner_id=owner_id
        )
        if enforce_unlock:
            self._require_gm_lore_unlocked(campaign)

        source_type = (
            "lore"
            if scope_kind == "world"
            else ("location_lore" if scope_kind == "location" else "container_lore")
        )

        conn = self._connect()
        try:
            if scope_kind == "world":
                vec_rows = conn.execute(
                    """
                    SELECT title, content, keywords_json, embedding_blob
                    FROM vector_entries
                    WHERE world_id = ? AND source_type = 'lore'
                    """,
                    (campaign.world_id,),
                ).fetchall()
            else:
                scope_col = "location_id" if scope_kind == "location" else "container_id"
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
            vec_title, vec_keywords = self._lore_vector_fields_for_scope(
                scope_kind, scope_name, item_lore.title, item_lore.entity_tags
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
            enforce_unlock=enforce_unlock,
        )

    def update_campaign_world_lore(
        self,
        campaign_id: str,
        lore_nodes: list[WorldLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Persist branch-safe Copy-on-Write world-level Codex lore scoped to a single campaign."""
        return self._update_campaign_scoped_lore(
            campaign_id,
            "world",
            None,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed_embeddings,
            enforce_unlock=enforce_unlock,
        )

    async def aupdate_campaign_world_lore(
        self,
        campaign_id: str,
        lore_nodes: list[WorldLoreNodeDraft],
        *,
        owner_id: str | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Pre-compute embeddings asynchronously and save branch-safe campaign World Codex lore."""
        return await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "world",
            None,
            lore_nodes,
            owner_id=owner_id,
            enforce_unlock=enforce_unlock,
        )

    def get_base_world_lore_ids(self, world_id: str) -> set[str]:
        """Return IDs of base-world authored World Codex entries (`campaign_id IS NULL`)."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT id FROM lore_nodes
                WHERE world_id = ? AND location_id IS NULL AND container_id IS NULL AND campaign_id IS NULL
                """,
                (world_id,),
            ).fetchall()
            return {str(r["id"]) for r in rows}
        finally:
            conn.close()

    async def aupsert_campaign_world_lore_entry(
        self,
        campaign_id: str,
        draft: WorldLoreNodeDraft,
        *,
        replace_lore_id: str | None = None,
        owner_id: str | None = None,
    ) -> tuple[CampaignStateBundle, str]:
        """Append or update a single branch-safe campaign World Codex entry (base-world overwrite requires GM Mode)."""
        bundle = self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
        base_world_ids = self.get_base_world_lore_ids(bundle.campaign.world_id)
        current_lore = list(bundle.world_lore_nodes)
        before_ids = {ln.id for ln in current_lore}

        next_drafts: list[WorldLoreNodeDraft] = []
        replaced = False
        for existing in current_lore:
            if replace_lore_id and existing.id == replace_lore_id:
                is_base_world = (
                    existing.campaign_id is None
                    or existing.id in base_world_ids
                    or (existing.origin_lore_id is not None and existing.origin_lore_id in base_world_ids)
                )
                if is_base_world and not bundle.campaign.world_settings.unlock_lore:
                    raise PermissionError(
                        "Unlock Lore & Secrets (GM Mode) is required to overwrite pre-existing base-world Codex entries."
                    )
                next_drafts.append(
                    WorldLoreNodeDraft(
                        id=existing.id,
                        title=draft.title,
                        category=draft.category,
                        content=draft.content,
                        entity_tags=list(draft.entity_tags),
                    )
                )
                replaced = True
            else:
                next_drafts.append(
                    WorldLoreNodeDraft(
                        id=existing.id,
                        title=existing.title,
                        category=existing.category,
                        content=existing.content,
                        entity_tags=list(existing.entity_tags),
                    )
                )

        if replace_lore_id and not replaced:
            raise KeyError(f"World Codex entry '{replace_lore_id}' not found on the active branch.")

        if not replace_lore_id:
            next_drafts.append(
                WorldLoreNodeDraft(
                    id=None,
                    title=draft.title,
                    category=draft.category,
                    content=draft.content,
                    entity_tags=list(draft.entity_tags),
                )
            )

        updated_bundle = await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "world",
            None,
            next_drafts,
            owner_id=owner_id,
            enforce_unlock=False,
        )

        new_ids = [ln.id for ln in updated_bundle.world_lore_nodes if ln.id not in before_ids]
        if new_ids:
            saved_lore_id = new_ids[-1]
        elif replace_lore_id:
            saved_lore_id = replace_lore_id
        else:
            matching = [ln.id for ln in updated_bundle.world_lore_nodes if ln.title == draft.title]
            saved_lore_id = matching[-1] if matching else ""

        return updated_bundle, saved_lore_id

    def update_campaign_location_lore(
        self,
        campaign_id: str,
        location_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Persist branch-safe Copy-on-Write location lore scoped strictly to a single campaign."""
        return self._update_campaign_scoped_lore(
            campaign_id,
            "location",
            location_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed_embeddings,
            enforce_unlock=enforce_unlock,
        )

    async def aupdate_campaign_location_lore(
        self,
        campaign_id: str,
        location_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Validate ownership/branch visibility, pre-compute missing embeddings asynchronously, and save override."""
        return await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "location",
            location_id,
            lore_nodes,
            owner_id=owner_id,
            enforce_unlock=enforce_unlock,
        )

    def update_campaign_container_lore(
        self,
        campaign_id: str,
        container_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Persist branch-safe Copy-on-Write Level 1 container lore scoped strictly to a single campaign."""
        return self._update_campaign_scoped_lore(
            campaign_id,
            "container",
            container_id,
            lore_nodes,
            owner_id=owner_id,
            precomputed_embeddings=precomputed_embeddings,
            enforce_unlock=enforce_unlock,
        )

    async def aupdate_campaign_container_lore(
        self,
        campaign_id: str,
        container_id: str,
        lore_nodes: list[LocationLoreNodeDraft],
        *,
        owner_id: str | None = None,
        enforce_unlock: bool = True,
    ) -> CampaignStateBundle:
        """Validate ownership/Level 1 container, pre-compute missing embeddings asynchronously, and save override."""
        return await self._aupdate_campaign_scoped_lore(
            campaign_id,
            "container",
            container_id,
            lore_nodes,
            owner_id=owner_id,
            enforce_unlock=enforce_unlock,
        )

    async def aadd_clerk_world_major_event_lore(
        self,
        *,
        campaign_id: str,
        world_id: str,
        turn_id: str,
        title: str,
        content: str,
        keywords: list[str],
    ) -> LoreNode:
        """Insert a branch-safe Phase 5 Clerk World Codex history Major Event and embed it."""
        clean_title = title.strip()[:120] or "Major World Event"
        clean_content = content.strip()[:2000] or clean_title
        clean_tags = normalize_and_validate_entity_tags(
            keywords,
            strict=False,
            fallback_title=clean_title,
            fallback_content=clean_content,
        )
        lore_id = f"lore_evt_{uuid.uuid4().hex[:10]}"
        vec_kw_json = json.dumps(clean_tags)
        precomputed = await _compute_missing_embeddings(
            [((clean_title, clean_content, vec_kw_json), combine_entry_text(clean_title, clean_content, clean_tags))],
            {},
        )
        pre_vec = precomputed.get((clean_title, clean_content, vec_kw_json))

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO lore_nodes (
                    id, world_id, location_id, container_id, campaign_id,
                    created_at_turn_id, origin_lore_id, is_major_event,
                    title, category, content, entity_tags_json
                )
                VALUES (?, ?, NULL, NULL, ?, ?, NULL, 1, ?, 'history', ?, ?)
                """,
                (
                    lore_id,
                    world_id,
                    campaign_id,
                    turn_id,
                    clean_title,
                    clean_content,
                    vec_kw_json,
                ),
            )
            self.vector_store.upsert_entry(
                entry_id=lore_id,
                source_type="lore",
                world_id=world_id,
                location_id=None,
                container_id=None,
                campaign_id=campaign_id,
                anchor_turn_id=turn_id,
                title=clean_title,
                content=clean_content,
                keywords=clean_tags,
                embedding=pre_vec,
                conn=conn,
            )
            conn.commit()
        finally:
            conn.close()

        return LoreNode(
            id=lore_id,
            world_id=world_id,
            location_id=None,
            container_id=None,
            campaign_id=campaign_id,
            created_at_turn_id=turn_id,
            origin_lore_id=None,
            is_major_event=True,
            title=clean_title,
            category="history",
            content=clean_content,
            entity_tags=clean_tags,
        )

    def toggle_campaign_lore_reveal(
        self,
        campaign_id: str,
        lore_id: str,
        *,
        revealed: bool,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Manually mark a location/container secret as revealed or hidden at the active leaf turn (GM Mode)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        self._require_gm_lore_unlocked(campaign)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")
        leaf_turn_id = campaign.active_leaf_turn_id

        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, world_id, campaign_id, category, origin_lore_id FROM lore_nodes WHERE id = ?",
                (lore_id,),
            ).fetchone()
            if not row or row["world_id"] != campaign.world_id:
                raise KeyError(f"Lore entry '{lore_id}' not found in campaign '{campaign_id}'")
            if row["campaign_id"] is not None and row["campaign_id"] != campaign_id:
                raise KeyError(f"Lore entry '{lore_id}' does not belong to campaign '{campaign_id}'")
            if row["category"] != "secret":
                raise ValueError("Only secret lore entries can be marked revealed or hidden.")

            canonical_id = row["origin_lore_id"] or row["id"]
            ws_row = conn.execute(
                "SELECT revealed_lore_ids_json FROM world_state_snapshots WHERE turn_id = ?",
                (leaf_turn_id,),
            ).fetchone()
            existing_revealed: list[str] = []
            if ws_row and ws_row["revealed_lore_ids_json"]:
                try:
                    existing_revealed = json.loads(ws_row["revealed_lore_ids_json"] or "[]")
                except Exception:
                    existing_revealed = []

            if revealed:
                next_revealed = list(dict.fromkeys([*existing_revealed, canonical_id]))
            else:
                drop_ids = {canonical_id, row["id"]}
                next_revealed = [rid for rid in existing_revealed if rid not in drop_ids]

            conn.execute(
                "UPDATE world_state_snapshots SET revealed_lore_ids_json = ? WHERE turn_id = ?",
                (json.dumps(next_revealed), leaf_turn_id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    async def aupdate_campaign_major_event(
        self,
        campaign_id: str,
        turn_id: str,
        *,
        title: str,
        summary: str,
        keywords: list[str],
        updated_description: str | None = None,
        environmental_tags: list[str] | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Edit a World or Location Major Event directly from the Story Major Events tab (GM Mode)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        self._require_gm_lore_unlocked(campaign)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")
        leaf_turn_id = campaign.active_leaf_turn_id
        branch_turns = self.get_branch_turn_chain(leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        if turn_id not in valid_turn_ids:
            raise KeyError(f"Turn '{turn_id}' is not on the active timeline branch")

        clean_title = title.strip()[:120]
        clean_summary = summary.strip()[:2000]
        if not clean_title or not clean_summary:
            raise ValueError("Major event title and summary cannot be empty.")
        clean_tags = normalize_and_validate_entity_tags(
            keywords,
            strict=False,
            fallback_title=clean_title,
            fallback_content=clean_summary,
        )

        # Find matching turn post_turn and/or active world major-event LoreNode
        target_turn = next(t for t in branch_turns if t.id == turn_id)
        post_turn = target_turn.post_turn
        existing_me = post_turn.major_event if post_turn else None

        # Check for an active world major-event LoreNode linked to this turn
        conn = self._connect()
        try:
            world_lore_list = self._resolve_world_lore_list(
                conn,
                campaign.world_id,
                campaign_id=campaign_id,
                valid_turn_ids=valid_turn_ids,
            )
        finally:
            conn.close()

        linked_lore = next(
            (
                ln
                for ln in world_lore_list
                if ln.is_major_event
                and (
                    (existing_me and existing_me.lore_node_id and (ln.id == existing_me.lore_node_id or ln.origin_lore_id == existing_me.lore_node_id))
                    or ln.created_at_turn_id == turn_id
                )
            ),
            None,
        )

        if existing_me is None and linked_lore is None:
            raise KeyError(f"No major event found on turn '{turn_id}'")

        # Precompute vector embedding if world lore will be updated
        precomputed: dict[tuple[str, str, str], np.ndarray] = {}
        if linked_lore is not None:
            kw_json = json.dumps(clean_tags)
            precomputed = await _compute_missing_embeddings(
                [((clean_title, clean_summary, kw_json), combine_entry_text(clean_title, clean_summary, clean_tags))],
                {},
            )

        updated_lore_id: str | None = linked_lore.id if linked_lore else None
        conn = self._connect()
        try:
            if linked_lore is not None:
                kw_json = json.dumps(clean_tags)
                pre_vec = precomputed.get((clean_title, clean_summary, kw_json))
                if (
                    linked_lore.campaign_id == campaign_id
                    and linked_lore.created_at_turn_id == leaf_turn_id
                ):
                    conn.execute(
                        """
                        UPDATE lore_nodes
                        SET title = ?, content = ?, entity_tags_json = ?
                        WHERE id = ?
                        """,
                        (clean_title, clean_summary, kw_json, linked_lore.id),
                    )
                    self.vector_store.upsert_entry(
                        entry_id=linked_lore.id,
                        source_type="lore",
                        world_id=campaign.world_id,
                        campaign_id=campaign_id,
                        anchor_turn_id=leaf_turn_id,
                        title=clean_title,
                        content=clean_summary,
                        keywords=clean_tags,
                        embedding=pre_vec,
                        conn=conn,
                    )
                else:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO campaign_lore_tombstones (campaign_id, turn_id, lore_id)
                        VALUES (?, ?, ?)
                        """,
                        (campaign_id, leaf_turn_id, linked_lore.id),
                    )
                    new_lore_id = f"lore_evt_{uuid.uuid4().hex[:10]}"
                    updated_lore_id = new_lore_id
                    origin_id = linked_lore.origin_lore_id or linked_lore.id
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, container_id, campaign_id,
                            created_at_turn_id, origin_lore_id, is_major_event,
                            title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, NULL, NULL, ?, ?, ?, 1, ?, 'history', ?, ?)
                        """,
                        (
                            new_lore_id,
                            campaign.world_id,
                            campaign_id,
                            leaf_turn_id,
                            origin_id,
                            clean_title,
                            clean_summary,
                            kw_json,
                        ),
                    )
                    self.vector_store.upsert_entry(
                        entry_id=new_lore_id,
                        source_type="lore",
                        world_id=campaign.world_id,
                        campaign_id=campaign_id,
                        anchor_turn_id=leaf_turn_id,
                        title=clean_title,
                        content=clean_summary,
                        keywords=clean_tags,
                        embedding=pre_vec,
                        conn=conn,
                    )

            if post_turn is not None and existing_me is not None:
                me_updates: dict[str, Any] = {
                    "title": clean_title,
                    "summary": clean_summary,
                    "keywords": clean_tags,
                }
                if updated_lore_id:
                    me_updates["lore_node_id"] = updated_lore_id

                if existing_me.scope == "location" and existing_me.location_id:
                    if updated_description is not None and updated_description.strip():
                        me_updates["updated_description"] = updated_description.strip()
                    ov_row = conn.execute(
                        """
                        SELECT parent_id, is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                        FROM campaign_spatial_overrides
                        WHERE turn_id = ? AND campaign_id = ? AND entity_type = 'location' AND entity_id = ?
                        """,
                        (turn_id, campaign_id, existing_me.location_id),
                    ).fetchone()
                    if ov_row is not None and (
                        updated_description is not None or environmental_tags is not None
                    ):
                        meta: dict[str, Any] = {}
                        if ov_row["metadata_override_json"]:
                            try:
                                parsed = json.loads(ov_row["metadata_override_json"])
                                if isinstance(parsed, dict):
                                    meta = dict(parsed)
                            except Exception:
                                meta = {}
                        if updated_description is not None and updated_description.strip():
                            meta["description"] = updated_description.strip()
                        if environmental_tags is not None:
                            clean_env = [t.strip()[:64] for t in environmental_tags if t and t.strip()]
                            meta["environmental_tags"] = list(dict.fromkeys(clean_env))
                        conn.execute(
                            """
                            UPDATE campaign_spatial_overrides
                            SET metadata_override_json = ?
                            WHERE turn_id = ? AND campaign_id = ? AND entity_type = 'location' AND entity_id = ?
                            """,
                            (json.dumps(meta), turn_id, campaign_id, existing_me.location_id),
                        )

                new_me = existing_me.model_copy(update=me_updates)
                new_post_turn = post_turn.model_copy(update={"major_event": new_me})
                conn.execute(
                    "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                    (new_post_turn.model_dump_json(), turn_id),
                )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def delete_campaign_major_event(
        self,
        campaign_id: str,
        turn_id: str,
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Delete a World Major Event (tombstoning its Codex lore) or delete & revert a Location Major Event (GM Mode)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        self._require_gm_lore_unlocked(campaign)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")
        leaf_turn_id = campaign.active_leaf_turn_id
        branch_turns = self.get_branch_turn_chain(leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        if turn_id not in valid_turn_ids:
            raise KeyError(f"Turn '{turn_id}' is not on the active timeline branch")

        target_turn = next(t for t in branch_turns if t.id == turn_id)
        post_turn = target_turn.post_turn
        existing_me = post_turn.major_event if post_turn else None

        conn = self._connect()
        try:
            world_lore_list = self._resolve_world_lore_list(
                conn,
                campaign.world_id,
                campaign_id=campaign_id,
                valid_turn_ids=valid_turn_ids,
            )
            linked_lore = next(
                (
                    ln
                    for ln in world_lore_list
                    if ln.is_major_event
                    and (
                        (existing_me and existing_me.lore_node_id and (ln.id == existing_me.lore_node_id or ln.origin_lore_id == existing_me.lore_node_id))
                        or ln.created_at_turn_id == turn_id
                    )
                ),
                None,
            )
            if existing_me is None and linked_lore is None:
                raise KeyError(f"No major event found on turn '{turn_id}'")

            if linked_lore is not None:
                if (
                    linked_lore.campaign_id == campaign_id
                    and linked_lore.created_at_turn_id == leaf_turn_id
                ):
                    conn.execute("DELETE FROM lore_nodes WHERE id = ?", (linked_lore.id,))
                    conn.execute("DELETE FROM vector_entries WHERE id = ?", (linked_lore.id,))
                else:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO campaign_lore_tombstones (campaign_id, turn_id, lore_id)
                        VALUES (?, ?, ?)
                        """,
                        (campaign_id, leaf_turn_id, linked_lore.id),
                    )

            if post_turn is not None and existing_me is not None:
                if existing_me.scope == "location" and existing_me.location_id:
                    # Revert description & environmental_tags override from that turn while preserving spatial layout
                    ov_row = conn.execute(
                        """
                        SELECT metadata_override_json
                        FROM campaign_spatial_overrides
                        WHERE turn_id = ? AND campaign_id = ? AND entity_type = 'location' AND entity_id = ?
                        """,
                        (turn_id, campaign_id, existing_me.location_id),
                    ).fetchone()
                    if ov_row and ov_row["metadata_override_json"]:
                        try:
                            meta = json.loads(ov_row["metadata_override_json"])
                        except Exception:
                            meta = {}
                        if isinstance(meta, dict):
                            meta.pop("description", None)
                            meta.pop("environmental_tags", None)
                            conn.execute(
                                """
                                UPDATE campaign_spatial_overrides
                                SET metadata_override_json = ?
                                WHERE turn_id = ? AND campaign_id = ? AND entity_type = 'location' AND entity_id = ?
                                """,
                                (
                                    json.dumps(meta) if meta else None,
                                    turn_id,
                                    campaign_id,
                                    existing_me.location_id,
                                ),
                            )

                new_me = existing_me.model_copy(update={"deleted": True})
                new_post_turn = post_turn.model_copy(update={"major_event": new_me})
                conn.execute(
                    "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                    (new_post_turn.model_dump_json(), turn_id),
                )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
