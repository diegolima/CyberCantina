"""Campaign full map bulk update and spatial synchronization."""

from __future__ import annotations

import json
import uuid
from typing import Any
from app.schemas.turn import (
    CampaignMapUpdatePayload,
    CampaignStateBundle,
)
from app.schemas.world import (
    MAX_EDGE_DISTANCE_METERS,
    LocationContainer,
    LocationEdge,
    LocationNode,
    is_edge_revealed,
    normalize_compass_direction,
    normalize_edge_distance_mode,
    normalize_edge_is_vertical,
    normalize_edge_obstacles,
    normalize_edge_speed_modifier,
    normalize_edge_travel_mode,
    parse_ghost_coords_json,
    remap_ghost_coords_dict,
    sanitize_location_anchors,
    validate_world_reachability,
)
from app.db.repos.base import (
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
        gm_unlocked = bool(campaign.world_settings.unlock_lore)
        revealed_ids, revealed_pairs = self._resolve_revealed_edge_state(
            campaign.world_id,
            leaf_turn.world_snapshot.revealed_edge_ids,
        )
        hidden_secret_orig_edge_ids = {
            eid
            for eid, e in orig_edges.items()
            if e.is_secret
            and not is_edge_revealed(
                e.id,
                e.from_location_id,
                e.to_location_id,
                revealed_ids,
                revealed_pairs,
            )
        }

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
                    # 2. Narrative field locks (GM Mode unlocks name, summary, description, environmental_tags)
                    gm_unlocked = bool(campaign.world_settings.unlock_lore)
                    gm_editable_changed = (
                        loc.name.strip() != orig_loc.name.strip()
                        or loc.summary != orig_loc.summary
                        or loc.description != orig_loc.description
                        or list(loc.environmental_tags) != list(orig_loc.environmental_tags)
                    )
                    structural_narrative_changed = (
                        loc.starting_message != orig_loc.starting_message
                        or bool(loc.is_hub) != bool(orig_loc.is_hub)
                    )
                    if structural_narrative_changed or (gm_editable_changed and not gm_unlocked):
                        raise ValueError(
                            f"Cannot modify name, summary, description, tags, or hub role of visited location '{orig_loc.name}'."
                        )
            raw_anchor = getattr(loc, "anchor_location_id", None)
            mapped_anchor = (
                loc_id_remap.get(raw_anchor, raw_anchor)
                if isinstance(raw_anchor, str) and raw_anchor.strip()
                else None
            )
            new_locs.append(
                loc.model_copy(
                    update={
                        "id": mapped_id,
                        "world_id": campaign.world_id,
                        "container_id": mapped_cont,
                        "anchor_location_id": mapped_anchor,
                    }
                )
            )

        sanitize_location_anchors(list(new_cont_map.values()), new_locs)

        valid_mapped_loc_ids = {l.id for l in new_locs}
        for cid, nc in list(new_cont_map.items()):
            remapped_ghost = parse_ghost_coords_json(
                remap_ghost_coords_dict(
                    nc.ghost_coords,
                    loc_id_remap,
                    valid_ids=valid_mapped_loc_ids,
                )
            )
            if remapped_ghost != nc.ghost_coords:
                new_cont_map[cid] = nc.model_copy(update={"ghost_coords": remapped_ghost})

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
                ghost_coords_json = json.dumps(
                    {k: {"x": v.x, "y": v.y} for k, v in nc.ghost_coords.items()}
                )
                conn.execute(
                    """
                    INSERT INTO location_containers (
                        id, world_id, created_at_turn_id, parent_container_id, depth,
                        name, description, environmental_tags_json, ui_x, ui_y, ghost_coords_json, icon, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        ghost_coords_json,
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
                    or nc.ghost_coords != orig_c.ghost_coords
                    or nc.icon != orig_c.icon
                )
                if orig_c.created_at_turn_id == leaf_turn_id:
                    if changed:
                        ghost_coords_json = json.dumps(
                            {k: {"x": v.x, "y": v.y} for k, v in nc.ghost_coords.items()}
                        )
                        conn.execute(
                            """
                            UPDATE location_containers
                            SET parent_container_id = ?, name = ?, description = ?,
                                environmental_tags_json = ?, ui_x = ?, ui_y = ?,
                                ghost_coords_json = ?, icon = ?
                            WHERE id = ?
                            """,
                            (
                                nc.parent_container_id,
                                nc.name.strip(),
                                nc.description,
                                json.dumps(nc.environmental_tags),
                                nc.ui_x,
                                nc.ui_y,
                                ghost_coords_json,
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
                    if nc.ghost_coords != raw_c.ghost_coords or orig_c.ghost_coords != raw_c.ghost_coords:
                        meta_dict["ghost_coords"] = {
                            k: {"x": v.x, "y": v.y} for k, v in nc.ghost_coords.items()
                        }
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
                        "DELETE FROM location_props WHERE location_id = ? AND campaign_id = ?",
                        (del_lid, campaign_id),
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
                            is_starting_location, is_hub, starting_message, ui_x, ui_y, icon, anchor_location_id
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
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
                            nloc.anchor_location_id,
                        ),
                    )
                    for p_idx, prop in enumerate(getattr(nloc, "props", None) or []):
                        if not gm_unlocked and prop.is_hidden:
                            continue
                        prop_id = prop.id if prop.id and not prop.id.startswith("new_") else f"prop_{uuid.uuid4().hex[:10]}"
                        conn.execute(
                            """
                            INSERT INTO location_props (
                                id, world_id, location_id, campaign_id, name, note, flags_json, lore_id, is_hidden, sort_order
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                prop_id,
                                campaign.world_id,
                                nloc.id,
                                campaign_id,
                                prop.name,
                                prop.note,
                                json.dumps(list(prop.flags)),
                                prop.lore_id,
                                1 if prop.is_hidden else 0,
                                p_idx,
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
                        or nloc.anchor_location_id != orig_loc.anchor_location_id
                    )
                    if orig_loc.created_at_turn_id == leaf_turn_id:
                        if changed:
                            conn.execute(
                                """
                                UPDATE location_nodes
                                SET container_id = ?, is_entry_exit = ?, name = ?, summary = ?,
                                    description = ?, environmental_tags_json = ?, is_hub = ?,
                                    starting_message = ?, ui_x = ?, ui_y = ?, icon = ?,
                                    anchor_location_id = ?
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
                                    nloc.anchor_location_id,
                                    nloc.id,
                                ),
                            )
                    elif changed or ("location", nloc.id) in existing_leaf_override_keys:
                        raw_loc = raw_locs[nloc.id]
                        meta_dict: dict[str, Any] = {}
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
                        if nloc.anchor_location_id != raw_loc.anchor_location_id:
                            meta_dict["anchor_location_id"] = nloc.anchor_location_id
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
                    orig_e = orig_edges[e.id]
                    if not gm_unlocked:
                        if e.id in hidden_secret_orig_edge_ids:
                            raise PermissionError(
                                "Unlock Lore & Secrets (GM Mode) is required to edit undiscovered secret links."
                            )
                        if bool(e.is_secret) != bool(orig_e.is_secret):
                            raise PermissionError(
                                "Unlock Lore & Secrets (GM Mode) is required to change a link's Secret status."
                            )
                    payload_edges_by_orig_id[e.id] = e.model_copy(
                        update={
                            "from_location_id": mapped_from,
                            "to_location_id": mapped_to,
                        }
                    )
                else:
                    if not gm_unlocked and bool(e.is_secret):
                        raise PermissionError(
                            "Unlock Lore & Secrets (GM Mode) is required to create secret links."
                        )
                    new_edges.append(
                        e.model_copy(
                            update={
                                "from_location_id": mapped_from,
                                "to_location_id": mapped_to,
                            }
                        )
                    )

            # Validate full graph reachability after preserving omitted undiscovered secret links
            effective_edges_for_reach: list[LocationEdge] = [
                *payload_edges_by_orig_id.values(),
                *new_edges,
            ]
            if not gm_unlocked:
                for hidden_eid in hidden_secret_orig_edge_ids:
                    if hidden_eid not in payload_edges_by_orig_id:
                        orig_hidden = orig_edges[hidden_eid]
                        m_from = loc_id_remap.get(
                            orig_hidden.from_location_id, orig_hidden.from_location_id
                        )
                        m_to = loc_id_remap.get(
                            orig_hidden.to_location_id, orig_hidden.to_location_id
                        )
                        if m_from in valid_new_loc_ids and m_to in valid_new_loc_ids:
                            effective_edges_for_reach.append(
                                orig_hidden.model_copy(
                                    update={
                                        "from_location_id": m_from,
                                        "to_location_id": m_to,
                                    }
                                )
                            )
            validate_world_reachability(
                locations=new_locs,
                edges=effective_edges_for_reach,
            )

            remapped_revealed_edges: list[tuple[str, str]] = []
            for orig_eid, orig_e in orig_edges.items():
                if orig_eid not in payload_edges_by_orig_id:
                    if not gm_unlocked and orig_eid in hidden_secret_orig_edge_ids:
                        # Player-mode bundles omit undiscovered secret links; preserve them intact.
                        continue
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
                    sub_speed = normalize_edge_speed_modifier(sub_e.speed_modifier)
                    orig_speed = normalize_edge_speed_modifier(orig_e.speed_modifier)
                    sub_mode = normalize_edge_travel_mode(sub_e.travel_mode)
                    orig_mode = normalize_edge_travel_mode(orig_e.travel_mode)
                    sub_obs = normalize_edge_obstacles(sub_e.obstacles)
                    orig_obs = normalize_edge_obstacles(orig_e.obstacles)
                    sub_dist_mode = normalize_edge_distance_mode(
                        getattr(sub_e, "distance_mode", "flexible")
                    )
                    orig_dist_mode = normalize_edge_distance_mode(
                        getattr(orig_e, "distance_mode", "flexible")
                    )
                    sub_vertical = normalize_edge_is_vertical(
                        getattr(sub_e, "is_vertical", False)
                    )
                    orig_vertical = normalize_edge_is_vertical(
                        getattr(orig_e, "is_vertical", False)
                    )
                    edge_changed = (
                        sub_e.from_location_id != orig_e.from_location_id
                        or sub_e.to_location_id != orig_e.to_location_id
                        or sub_e.direction_label.strip() != orig_e.direction_label.strip()
                        or sub_cdir != orig_cdir
                        or int(sub_e.distance_meters) != int(orig_e.distance_meters)
                        or abs(sub_speed - orig_speed) > 1e-6
                        or sub_mode != orig_mode
                        or sub_obs != orig_obs
                        or bool(sub_e.is_blocked) != bool(orig_e.is_blocked)
                        or bool(sub_e.is_secret) != bool(orig_e.is_secret)
                        or sub_dist_mode != orig_dist_mode
                        or sub_vertical != orig_vertical
                    )
                    if edge_changed:
                        if orig_e.created_at_turn_id == leaf_turn_id:
                            conn.execute(
                                """
                                UPDATE location_edges
                                SET from_location_id = ?, to_location_id = ?, direction_label = ?,
                                    compass_direction = ?, distance_meters = ?, speed_modifier = ?,
                                    travel_mode = ?, obstacles_json = ?, is_blocked = ?, is_secret = ?,
                                    distance_mode = ?, is_vertical = ?
                                WHERE id = ?
                                """,
                                (
                                    sub_e.from_location_id,
                                    sub_e.to_location_id,
                                    sub_e.direction_label.strip() or f"To {sub_e.to_location_id}",
                                    sub_cdir,
                                    max(1, min(MAX_EDGE_DISTANCE_METERS, int(sub_e.distance_meters))),
                                    sub_speed,
                                    sub_mode,
                                    json.dumps(sub_obs),
                                    1 if sub_e.is_blocked else 0,
                                    1 if sub_e.is_secret else 0,
                                    sub_dist_mode,
                                    1 if sub_vertical else 0,
                                    orig_eid,
                                ),
                            )
                        else:
                            conn.execute(
                                "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                                (leaf_turn_id, orig_eid),
                            )
                            new_eid = f"edge_{uuid.uuid4().hex[:10]}"
                            remapped_revealed_edges.append((orig_eid, new_eid))
                            new_edges.append(sub_e.model_copy(update={"id": new_eid}))

            for ne in new_edges:
                cdir = normalize_compass_direction(ne.compass_direction, ne.direction_label)
                ins_eid = (
                    ne.id
                    if ne.id and ne.id.startswith("edge_") and ne.id not in orig_edges
                    else f"edge_{uuid.uuid4().hex[:10]}"
                )
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id, direction_label,
                        compass_direction, distance_meters, speed_modifier, travel_mode,
                        obstacles_json, is_blocked, is_secret, distance_mode, is_vertical, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ins_eid,
                        campaign.world_id,
                        ne.from_location_id,
                        ne.to_location_id,
                        ne.direction_label.strip() or "Passage",
                        cdir,
                        max(1, min(MAX_EDGE_DISTANCE_METERS, int(ne.distance_meters))),
                        normalize_edge_speed_modifier(ne.speed_modifier),
                        normalize_edge_travel_mode(ne.travel_mode),
                        json.dumps(normalize_edge_obstacles(ne.obstacles)),
                        1 if ne.is_blocked else 0,
                        1 if ne.is_secret else 0,
                        normalize_edge_distance_mode(getattr(ne, "distance_mode", "flexible")),
                        1 if normalize_edge_is_vertical(getattr(ne, "is_vertical", False)) else 0,
                        leaf_turn_id,
                    ),
                )

            self._remap_revealed_edge_ids_in_snapshot(
                conn,
                turn_id=leaf_turn_id,
                world_id=campaign.world_id,
                remapped_edges=remapped_revealed_edges,
            )
            if gm_unlocked:
                for nloc in new_locs:
                    if nloc.id in orig_locs:
                        orig_loc = orig_locs[nloc.id]
                        if list(getattr(nloc, "props", None) or []) != list(getattr(orig_loc, "props", None) or []):
                            self._apply_location_props_diff_to_snapshot_conn(
                                conn,
                                leaf_turn_id=leaf_turn_id,
                                location_id=nloc.id,
                                base_props=list(getattr(orig_loc, "props", None) or []),
                                next_props=list(getattr(nloc, "props", None) or []),
                                world_id=campaign.world_id,
                            )

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)
