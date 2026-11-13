"""Campaign full map bulk update and spatial synchronization."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from typing import Any
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
    CampaignMapUpdatePayload,
    CampaignRecord,
    CampaignStateBundle,
    ImprovisedLocationSpec,
)
from app.schemas.world import (
    OPPOSITE_COMPASS,
    LocationContainer,
    LocationEdge,
    LocationLoreNodeDraft,
    LocationNode,
    LoreNode,
    normalize_compass_direction,
)
from app.db.repos.base import (
    UNSET,
    _validate_world_artifact_lore_id,
    _compute_missing_embeddings,
    _location_lore_vector_fields,
    utc_now_iso,
)


class CampaignMapUpdateMixin:
    """Campaign full map bulk update and spatial synchronization."""

    def update_campaign_map(
        self,
        campaign_id: str,
        payload: CampaignMapUpdatePayload,
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Atomically persist turn-anchored spatial, cosmetic, container, and unvisited edits for a campaign."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn_id = campaign.active_leaf_turn_id
        branch_turns = self.get_branch_turn_chain(leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        leaf_turn = branch_turns[-1]

        current_world = self.get_world(
            campaign.world_id,
            valid_turn_ids=valid_turn_ids,
            campaign_id=campaign_id,
        )
        raw_world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        raw_conts = {c.id: c for c in raw_world.containers}
        raw_locs = {l.id: l for l in raw_world.locations}

        visited_ids = set(leaf_turn.world_snapshot.visited_location_ids or []) | {
            leaf_turn.world_snapshot.active_location_id
        }
        occupied_loc_ids = {
            st.current_location_id for st in leaf_turn.character_states.values()
        }
        active_loc_id = leaf_turn.world_snapshot.active_location_id

        orig_conts = {c.id: c for c in current_world.containers}
        orig_locs = {l.id: l for l in current_world.locations}
        orig_edges = {e.id: e for e in current_world.edges}

        def _ancestor_chain(
            start_cont_id: str | None, c_map: dict[str, LocationContainer]
        ) -> list[str]:
            chain: list[str] = []
            curr = start_cont_id
            seen: set[str] = set()
            while curr and curr in c_map and curr not in seen:
                seen.add(curr)
                chain.append(curr)
                curr = c_map[curr].parent_container_id
            return chain

        def _is_subsequence(old_seq: list[str], new_seq: list[str]) -> bool:
            idx = 0
            for item in new_seq:
                if idx < len(old_seq) and item == old_seq[idx]:
                    idx += 1
            return idx == len(old_seq)

        # Track visited container closure on original map
        conts_with_visited: set[str] = set()
        for v_lid in visited_ids:
            v_loc = orig_locs.get(v_lid)
            if v_loc and v_loc.container_id:
                conts_with_visited.update(_ancestor_chain(v_loc.container_id, orig_conts))

        # Validate & assign IDs for submitted containers
        cont_id_remap: dict[str, str] = {}
        payload_orig_cont_ids: set[str] = set()
        for c in payload.containers:
            if c.id in orig_conts and not c.id.startswith("new_"):
                if c.id in payload_orig_cont_ids:
                    raise ValueError(f"Duplicate container ID '{c.id}'.")
                payload_orig_cont_ids.add(c.id)
                cont_id_remap[c.id] = c.id
            else:
                if c.id in cont_id_remap:
                    raise ValueError(f"Duplicate draft container ID '{c.id}'.")
                cont_id_remap[c.id] = f"cont_{uuid.uuid4().hex[:10]}"

        for orig_cid, orig_c in orig_conts.items():
            if orig_cid not in payload_orig_cont_ids:
                if orig_cid in conts_with_visited:
                    raise ValueError(
                        f"Cannot remove container '{orig_c.name}' because it contains visited locations."
                    )
                if orig_c.created_at_turn_id != leaf_turn_id:
                    raise ValueError(
                        f"Saved container '{orig_c.name}' cannot be removed directly. Rewind to a turn before it existed to discard it."
                    )

        new_cont_map: dict[str, LocationContainer] = {}
        for c in payload.containers:
            mapped_id = cont_id_remap[c.id]
            mapped_parent = (
                cont_id_remap.get(c.parent_container_id)
                if c.parent_container_id
                else None
            )
            if c.id in orig_conts and c.depth != orig_conts[c.id].depth:
                raise ValueError(
                    f"Cannot change depth level of existing container '{c.name}'."
                )
            new_cont_map[mapped_id] = c.model_copy(
                update={
                    "id": mapped_id,
                    "world_id": campaign.world_id,
                    "parent_container_id": mapped_parent,
                }
            )

        # Validate & assign IDs for submitted locations
        loc_id_remap: dict[str, str] = {}
        payload_orig_loc_ids: set[str] = set()
        for loc in payload.locations:
            if loc.id in orig_locs and not loc.id.startswith("new_"):
                if loc.id in payload_orig_loc_ids:
                    raise ValueError(f"Duplicate location ID '{loc.id}'.")
                payload_orig_loc_ids.add(loc.id)
                loc_id_remap[loc.id] = loc.id
            else:
                if loc.id in loc_id_remap:
                    raise ValueError(f"Duplicate draft location ID '{loc.id}'.")
                if loc.is_starting_location:
                    raise ValueError(
                        "Cannot designate a new starting location mid-campaign."
                    )
                loc_id_remap[loc.id] = f"loc_{uuid.uuid4().hex[:10]}"

        deleted_loc_ids: list[str] = []
        for orig_lid, orig_loc in orig_locs.items():
            if orig_lid not in payload_orig_loc_ids:
                if orig_lid in visited_ids:
                    raise ValueError(
                        f"Cannot remove visited location '{orig_loc.name}'."
                    )
                if orig_loc.is_starting_location:
                    raise ValueError("Cannot remove the Starting Location.")
                if orig_lid == active_loc_id:
                    raise ValueError("Cannot remove the active turn location.")
                if orig_lid in occupied_loc_ids:
                    raise ValueError(
                        f"Cannot remove location '{orig_loc.name}' while characters are present there."
                    )
                deleted_loc_ids.append(orig_lid)

        new_locs: list[LocationNode] = []
        for loc in payload.locations:
            mapped_id = loc_id_remap[loc.id]
            mapped_cont = (
                cont_id_remap.get(loc.container_id) if loc.container_id else None
            )
            if loc.id in orig_locs:
                orig_loc = orig_locs[loc.id]
                if bool(loc.is_starting_location) != bool(orig_loc.is_starting_location):
                    raise ValueError(
                        f"Cannot change starting-location designation of '{orig_loc.name}' mid-campaign."
                    )
                if loc.id in visited_ids:
                    # 1. Visited ancestor-containment monotonicity
                    old_ancestors = _ancestor_chain(orig_loc.container_id, orig_conts)
                    new_ancestors = _ancestor_chain(mapped_cont, new_cont_map)
                    if not _is_subsequence(old_ancestors, new_ancestors):
                        raise ValueError(
                            f"Cannot remove visited location '{orig_loc.name}' from its existing container hierarchy."
                        )
                    # 2. Narrative field locks
                    narrative_changed = (
                        loc.name.strip() != orig_loc.name.strip()
                        or loc.summary != orig_loc.summary
                        or loc.description != orig_loc.description
                        or list(loc.environmental_tags) != list(orig_loc.environmental_tags)
                        or loc.starting_message != orig_loc.starting_message
                        or bool(loc.is_hub) != bool(orig_loc.is_hub)
                    )
                    if narrative_changed:
                        raise ValueError(
                            f"Cannot modify name, summary, description, tags, or hub role of visited location '{orig_loc.name}'."
                        )
            new_locs.append(
                loc.model_copy(
                    update={
                        "id": mapped_id,
                        "world_id": campaign.world_id,
                        "container_id": mapped_cont,
                    }
                )
            )

        now = utc_now_iso()
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE;")
            existing_leaf_override_keys = {
                (r["entity_type"], r["entity_id"])
                for r in conn.execute(
                    "SELECT entity_type, entity_id FROM campaign_spatial_overrides WHERE turn_id = ? AND campaign_id = ?",
                    (leaf_turn_id, campaign_id),
                ).fetchall()
            }

            # 1. Remove deletable active-leaf containers cleanly
            for orig_cid, orig_c in orig_conts.items():
                if orig_cid not in payload_orig_cont_ids:
                    conn.execute(
                        "DELETE FROM campaign_spatial_overrides WHERE campaign_id = ? AND entity_type = 'container' AND entity_id = ?",
                        (campaign_id, orig_cid),
                    )
                    conn.execute(
                        "DELETE FROM location_containers WHERE id = ? AND created_at_turn_id = ?",
                        (orig_cid, leaf_turn_id),
                    )

            # 2. Insert new containers ordered top-down (depth DESC) for parent FK safety
            new_conts_to_insert = [
                nc for cid, nc in new_cont_map.items() if cid not in orig_conts
            ]
            new_conts_to_insert.sort(key=lambda c: c.depth, reverse=True)
            for nc in new_conts_to_insert:
                conn.execute(
                    """
                    INSERT INTO location_containers (
                        id, world_id, created_at_turn_id, parent_container_id, depth,
                        name, description, environmental_tags_json, ui_x, ui_y, icon, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        nc.id,
                        campaign.world_id,
                        leaf_turn_id,
                        nc.parent_container_id,
                        nc.depth,
                        nc.name,
                        nc.description,
                        json.dumps(nc.environmental_tags),
                        nc.ui_x,
                        nc.ui_y,
                        nc.icon,
                        now,
                    ),
                )

            # 3. Update existing containers (direct on active-leaf creation, else campaign_spatial_overrides)
            for cid in payload_orig_cont_ids:
                nc = new_cont_map[cid]
                orig_c = orig_conts[cid]
                changed = (
                    nc.parent_container_id != orig_c.parent_container_id
                    or nc.name.strip() != orig_c.name.strip()
                    or nc.description != orig_c.description
                    or list(nc.environmental_tags) != list(orig_c.environmental_tags)
                    or nc.ui_x != orig_c.ui_x
                    or nc.ui_y != orig_c.ui_y
                    or nc.icon != orig_c.icon
                )
                if orig_c.created_at_turn_id == leaf_turn_id:
                    if changed:
                        conn.execute(
                            """
                            UPDATE location_containers
                            SET parent_container_id = ?, name = ?, description = ?,
                                environmental_tags_json = ?, ui_x = ?, ui_y = ?, icon = ?
                            WHERE id = ?
                            """,
                            (
                                nc.parent_container_id,
                                nc.name.strip(),
                                nc.description,
                                json.dumps(nc.environmental_tags),
                                nc.ui_x,
                                nc.ui_y,
                                nc.icon,
                                nc.id,
                            ),
                        )
                elif changed or ("container", cid) in existing_leaf_override_keys:
                    raw_c = raw_conts[cid]
                    meta_dict: dict[str, Any] = {}
                    if nc.name.strip() != raw_c.name.strip():
                        meta_dict["name"] = nc.name.strip()
                    if nc.description != raw_c.description:
                        meta_dict["description"] = nc.description
                    if list(nc.environmental_tags) != list(raw_c.environmental_tags):
                        meta_dict["environmental_tags"] = list(nc.environmental_tags)
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO campaign_spatial_overrides (
                            turn_id, campaign_id, entity_type, entity_id, parent_id,
                            is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                        )
                        VALUES (?, ?, 'container', ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            leaf_turn_id,
                            campaign_id,
                            nc.id,
                            nc.parent_container_id,
                            nc.ui_x,
                            nc.ui_y,
                            nc.icon,
                            json.dumps(meta_dict) if meta_dict else None,
                        ),
                    )

            # 4. Delete or supersede removed unvisited locations
            for del_lid in deleted_loc_ids:
                orig_loc = orig_locs[del_lid]
                if orig_loc.created_at_turn_id == leaf_turn_id:
                    conn.execute(
                        "DELETE FROM campaign_spatial_overrides WHERE campaign_id = ? AND entity_type = 'location' AND entity_id = ?",
                        (campaign_id, del_lid),
                    )
                    conn.execute(
                        "DELETE FROM location_edges WHERE world_id = ? AND (from_location_id = ? OR to_location_id = ?)",
                        (campaign.world_id, del_lid, del_lid),
                    )
                    conn.execute(
                        "DELETE FROM location_nodes WHERE id = ? AND created_at_turn_id = ?",
                        (del_lid, leaf_turn_id),
                    )
                else:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO campaign_spatial_overrides (
                            turn_id, campaign_id, entity_type, entity_id, parent_id,
                            is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                        )
                        VALUES (?, ?, 'location', ?, NULL, NULL, NULL, NULL, NULL, ?)
                        """,
                        (
                            leaf_turn_id,
                            campaign_id,
                            del_lid,
                            json.dumps({"superseded": True}),
                        ),
                    )

            # 5. Insert new locations & update existing locations
            for nloc in new_locs:
                if nloc.id not in orig_locs:
                    conn.execute(
                        """
                        INSERT INTO location_nodes (
                            id, world_id, created_at_turn_id, superseded_at_turn_id, container_id,
                            is_entry_exit, name, summary, description, environmental_tags_json,
                            is_starting_location, is_hub, starting_message, ui_x, ui_y, icon
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                        """,
                        (
                            nloc.id,
                            campaign.world_id,
                            leaf_turn_id,
                            nloc.container_id,
                            1 if nloc.is_entry_exit else 0,
                            nloc.name.strip(),
                            nloc.summary,
                            nloc.description,
                            json.dumps(nloc.environmental_tags),
                            1 if nloc.is_hub else 0,
                            nloc.starting_message,
                            nloc.ui_x,
                            nloc.ui_y,
                            nloc.icon,
                        ),
                    )
                else:
                    orig_loc = orig_locs[nloc.id]
                    changed = (
                        nloc.container_id != orig_loc.container_id
                        or bool(nloc.is_entry_exit) != bool(orig_loc.is_entry_exit)
                        or nloc.name.strip() != orig_loc.name.strip()
                        or nloc.summary != orig_loc.summary
                        or nloc.description != orig_loc.description
                        or list(nloc.environmental_tags) != list(orig_loc.environmental_tags)
                        or bool(nloc.is_hub) != bool(orig_loc.is_hub)
                        or nloc.starting_message != orig_loc.starting_message
                        or nloc.ui_x != orig_loc.ui_x
                        or nloc.ui_y != orig_loc.ui_y
                        or nloc.icon != orig_loc.icon
                    )
                    if orig_loc.created_at_turn_id == leaf_turn_id:
                        if changed:
                            conn.execute(
                                """
                                UPDATE location_nodes
                                SET container_id = ?, is_entry_exit = ?, name = ?, summary = ?,
                                    description = ?, environmental_tags_json = ?, is_hub = ?,
                                    starting_message = ?, ui_x = ?, ui_y = ?, icon = ?
                                WHERE id = ?
                                """,
                                (
                                    nloc.container_id,
                                    1 if nloc.is_entry_exit else 0,
                                    nloc.name.strip(),
                                    nloc.summary,
                                    nloc.description,
                                    json.dumps(nloc.environmental_tags),
                                    1 if nloc.is_hub else 0,
                                    nloc.starting_message,
                                    nloc.ui_x,
                                    nloc.ui_y,
                                    nloc.icon,
                                    nloc.id,
                                ),
                            )
                    elif changed or ("location", nloc.id) in existing_leaf_override_keys:
                        raw_loc = raw_locs[nloc.id]
                        meta_dict = {}
                        if nloc.name.strip() != raw_loc.name.strip():
                            meta_dict["name"] = nloc.name.strip()
                        if nloc.summary != raw_loc.summary:
                            meta_dict["summary"] = nloc.summary
                        if nloc.description != raw_loc.description:
                            meta_dict["description"] = nloc.description
                        if list(nloc.environmental_tags) != list(raw_loc.environmental_tags):
                            meta_dict["environmental_tags"] = list(nloc.environmental_tags)
                        if bool(nloc.is_hub) != bool(raw_loc.is_hub):
                            meta_dict["is_hub"] = bool(nloc.is_hub)
                        if nloc.starting_message != raw_loc.starting_message:
                            meta_dict["starting_message"] = nloc.starting_message
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO campaign_spatial_overrides (
                                turn_id, campaign_id, entity_type, entity_id, parent_id,
                                is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                            )
                            VALUES (?, ?, 'location', ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                leaf_turn_id,
                                campaign_id,
                                nloc.id,
                                nloc.container_id,
                                1 if nloc.is_entry_exit else 0,
                                nloc.ui_x,
                                nloc.ui_y,
                                nloc.icon,
                                json.dumps(meta_dict) if meta_dict else None,
                            ),
                        )

            # 6. Diff and apply edge mutations safely across branches
            valid_new_loc_ids = {l.id for l in new_locs}
            payload_edges_by_orig_id: dict[str, LocationEdge] = {}
            new_edges: list[LocationEdge] = []
            for e in payload.edges:
                mapped_from = loc_id_remap.get(e.from_location_id, e.from_location_id)
                mapped_to = loc_id_remap.get(e.to_location_id, e.to_location_id)
                if mapped_from not in valid_new_loc_ids or mapped_to not in valid_new_loc_ids:
                    continue
                if e.id in orig_edges and not e.id.startswith("new_"):
                    payload_edges_by_orig_id[e.id] = e.model_copy(
                        update={
                            "from_location_id": mapped_from,
                            "to_location_id": mapped_to,
                        }
                    )
                else:
                    new_edges.append(
                        e.model_copy(
                            update={
                                "from_location_id": mapped_from,
                                "to_location_id": mapped_to,
                            }
                        )
                    )

            for orig_eid, orig_e in orig_edges.items():
                if orig_eid not in payload_edges_by_orig_id:
                    if orig_e.created_at_turn_id == leaf_turn_id:
                        conn.execute("DELETE FROM location_edges WHERE id = ?", (orig_eid,))
                    else:
                        conn.execute(
                            "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                            (leaf_turn_id, orig_eid),
                        )
                else:
                    sub_e = payload_edges_by_orig_id[orig_eid]
                    sub_cdir = normalize_compass_direction(
                        sub_e.compass_direction, sub_e.direction_label
                    )
                    orig_cdir = normalize_compass_direction(
                        orig_e.compass_direction, orig_e.direction_label
                    )
                    edge_changed = (
                        sub_e.from_location_id != orig_e.from_location_id
                        or sub_e.to_location_id != orig_e.to_location_id
                        or sub_e.direction_label.strip() != orig_e.direction_label.strip()
                        or sub_cdir != orig_cdir
                        or int(sub_e.travel_minutes) != int(orig_e.travel_minutes)
                        or bool(sub_e.is_locked_or_hidden) != bool(orig_e.is_locked_or_hidden)
                    )
                    if edge_changed:
                        if orig_e.created_at_turn_id == leaf_turn_id:
                            conn.execute(
                                """
                                UPDATE location_edges
                                SET from_location_id = ?, to_location_id = ?, direction_label = ?,
                                    compass_direction = ?, travel_minutes = ?, is_locked_or_hidden = ?
                                WHERE id = ?
                                """,
                                (
                                    sub_e.from_location_id,
                                    sub_e.to_location_id,
                                    sub_e.direction_label.strip() or f"To {sub_e.to_location_id}",
                                    sub_cdir,
                                    max(0, int(sub_e.travel_minutes)),
                                    1 if sub_e.is_locked_or_hidden else 0,
                                    orig_eid,
                                ),
                            )
                        else:
                            conn.execute(
                                "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                                (leaf_turn_id, orig_eid),
                            )
                            new_edges.append(sub_e)

            for ne in new_edges:
                cdir = normalize_compass_direction(ne.compass_direction, ne.direction_label)
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id, direction_label,
                        compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"edge_{uuid.uuid4().hex[:10]}",
                        campaign.world_id,
                        ne.from_location_id,
                        ne.to_location_id,
                        ne.direction_label.strip() or "Passage",
                        cdir,
                        max(0, int(ne.travel_minutes)),
                        1 if ne.is_locked_or_hidden else 0,
                        leaf_turn_id,
                    ),
                )

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
