"""Location containers, neighbors, and improvised location creation."""

from __future__ import annotations

import json
from typing import Literal
import uuid
from app.schemas.turn import ImprovisedLocationSpec
from app.schemas.world import (
    COMPASS_PASSAGE_NAMES,
    OPPOSITE_COMPASS,
    LocationContainer,
    LocationNode,
    NeighborLocationView,
    WorldRecord,
    WorldUpdatePayload,
    normalize_compass_direction,
    pick_available_compass_direction,
)


class WorldLocationsMixin:
    """Location containers, neighbors, and improvised location creation."""

    def delete_location_container(
        self,
        world_id: str,
        container_id: str,
        *,
        reassign_to_container_id: str | None = None,
        unparent_children: bool = False,
        lore_disposal: Literal["delete", "reassign", "promote_to_world"] = "delete",
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Delete a container, enforcing child reassignment/unparenting and Level 1 lore disposal rules."""
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        cont_by_id = {c.id: c for c in orig.containers}
        target = cont_by_id.get(container_id)
        if not target:
            raise KeyError(f"Container '{container_id}' not found in world '{world_id}'")

        child_containers = [c for c in orig.containers if c.parent_container_id == container_id]
        child_locations = [loc for loc in orig.locations if loc.container_id == container_id]

        dest_container: LocationContainer | None = None
        if reassign_to_container_id is not None:
            if reassign_to_container_id == container_id:
                raise ValueError("Cannot reassign children to the container being deleted.")
            dest_container = cont_by_id.get(reassign_to_container_id)
            if not dest_container:
                raise ValueError(
                    f"Target container '{reassign_to_container_id}' does not exist in world '{world_id}'."
                )

        if (child_containers or child_locations) and not dest_container and not unparent_children:
            raise ValueError(
                f"Container '{target.name}' contains child nodes; specify reassign_to_container_id or confirm unparent_children."
            )

        if dest_container:
            for cc in child_containers:
                if cc.depth >= dest_container.depth:
                    raise ValueError(
                        f"Child container '{cc.name}' (depth {cc.depth}) cannot be reassigned into '{dest_container.name}' (depth {dest_container.depth})."
                    )

        new_parent_for_children = dest_container.id if dest_container else None
        remaining_containers: list[LocationContainer] = []
        for c in orig.containers:
            if c.id == container_id:
                continue
            updated_c = c.model_copy(deep=True)
            if updated_c.parent_container_id == container_id:
                updated_c.parent_container_id = new_parent_for_children
            remaining_containers.append(updated_c)

        updated_locations: list[LocationNode] = []
        for loc in orig.locations:
            updated_loc = loc.model_copy(deep=True)
            if updated_loc.container_id == container_id:
                updated_loc.container_id = new_parent_for_children
                if new_parent_for_children is None:
                    updated_loc.is_entry_exit = False
            updated_locations.append(updated_loc)

        updated_world_lore = list(orig.lore_nodes)
        if target.depth == 1 and target.lore_nodes:
            if lore_disposal == "reassign":
                if not dest_container or dest_container.depth != 1:
                    raise ValueError(
                        "Level 1 container lore can only be reassigned to a target container of depth 1."
                    )
                for rc in remaining_containers:
                    if rc.id == dest_container.id:
                        rc.lore_nodes = [
                            *rc.lore_nodes,
                            *[
                                ln.model_copy(
                                    update={"id": "", "container_id": dest_container.id, "location_id": None}
                                )
                                for ln in target.lore_nodes
                            ],
                        ]
                        break
            elif lore_disposal == "promote_to_world":
                for ln in target.lore_nodes:
                    if ln.category == "secret":
                        continue
                    updated_world_lore.append(
                        ln.model_copy(update={"id": "", "location_id": None, "container_id": None})
                    )
            elif lore_disposal != "delete":
                raise ValueError(f"Unsupported lore_disposal mode '{lore_disposal}'.")

        payload = WorldUpdatePayload(
            name=orig.name,
            global_rules=orig.global_rules,
            containers=remaining_containers,
            locations=updated_locations,
            edges=orig.edges,
            lore_nodes=updated_world_lore,
        )
        return self.update_world(world_id, payload, owner_id=owner_id)

    def convert_location_to_container(
        self,
        world_id: str,
        location_id: str,
        *,
        container_name: str | None = None,
        portal_name: str | None = None,
        migrate_lore: bool = True,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Wrap an existing Level 0 location inside a new Level 1 container (World Sheet Editor operation)."""
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        cont_by_id = {c.id: c for c in orig.containers}
        target_loc = next((loc for loc in orig.locations if loc.id == location_id), None)
        if not target_loc:
            raise KeyError(f"Location '{location_id}' not found in world '{world_id}'")

        parent_cont = cont_by_id.get(target_loc.container_id) if target_loc.container_id else None
        if parent_cont and parent_cont.depth <= 1:
            raise ValueError(
                f"Cannot wrap '{target_loc.name}' into a Level 1 container because its parent '{parent_cont.name}' is already depth {parent_cont.depth}."
            )

        new_cont_id = f"cont_{uuid.uuid4().hex[:10]}"
        migrated_lore = (
            [
                ln.model_copy(update={"id": "", "location_id": None, "container_id": new_cont_id})
                for ln in target_loc.lore_nodes
            ]
            if migrate_lore
            else []
        )
        new_container = LocationContainer(
            id=new_cont_id,
            world_id=world_id,
            parent_container_id=target_loc.container_id,
            depth=1,
            name=(container_name or target_loc.name).strip(),
            description=target_loc.description or target_loc.summary,
            environmental_tags=list(target_loc.environmental_tags),
            lore_nodes=migrated_lore,
        )

        updated_locations: list[LocationNode] = []
        for loc in orig.locations:
            copied = loc.model_copy(deep=True)
            if copied.id == location_id:
                copied.container_id = new_cont_id
                copied.is_entry_exit = True
                if portal_name and portal_name.strip():
                    copied.name = portal_name.strip()
                if migrate_lore:
                    copied.lore_nodes = []
            updated_locations.append(copied)

        payload = WorldUpdatePayload(
            name=orig.name,
            global_rules=orig.global_rules,
            containers=[*orig.containers, new_container],
            locations=updated_locations,
            edges=orig.edges,
            lore_nodes=orig.lore_nodes,
        )
        return self.update_world(world_id, payload, owner_id=owner_id)

    def get_location(
        self,
        location_id: str,
        *,
        campaign_id: str | None = None,
    ) -> LocationNode:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM location_nodes WHERE id = ?", (location_id,)
            ).fetchone()
            if not row:
                raise KeyError(f"Location '{location_id}' not found")
            loc = self._row_to_location(row)
            loc.lore_nodes = self._resolve_location_lore_map(
                conn, [location_id], campaign_id=campaign_id
            ).get(location_id, [])
            return loc
        finally:
            conn.close()

    def get_neighbor_locations(
        self,
        world_id: str,
        active_location_id: str,
        valid_turn_ids: set[str] | None = None,
        *,
        campaign_id: str | None = None,
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

            neighbors: list[NeighborLocationView] = []
            for r in rows:
                edge_turn = r["edge_turn_id"]
                edge_sup = r["edge_superseded_turn_id"]
                loc_turn = r["created_at_turn_id"]
                loc_sup = r["superseded_at_turn_id"] if "superseded_at_turn_id" in r.keys() else None
                if valid_turn_ids is not None:
                    if edge_turn is not None and edge_turn not in valid_turn_ids:
                        continue
                    if edge_sup is not None and edge_sup in valid_turn_ids:
                        continue
                    if loc_turn is not None and loc_turn not in valid_turn_ids:
                        continue
                    if loc_sup is not None and loc_sup in valid_turn_ids:
                        continue
                elif edge_sup is not None or loc_sup is not None:
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

            if campaign_id and neighbors:
                _, overridden_dests = self._apply_campaign_spatial_overrides(
                    conn,
                    campaign_id=campaign_id,
                    valid_turn_ids=valid_turn_ids,
                    containers=[],
                    locations=[n.destination for n in neighbors],
                )
                dest_by_id = {d.id: d for d in overridden_dests}
                kept_neighbors: list[NeighborLocationView] = []
                for n in neighbors:
                    ov_dest = dest_by_id.get(n.destination.id)
                    if ov_dest is None:
                        continue
                    n.destination = ov_dest
                    kept_neighbors.append(n)
                neighbors = kept_neighbors

            if neighbors:
                loc_lore_map = self._resolve_location_lore_map(
                    conn,
                    [n.destination.id for n in neighbors],
                    campaign_id=campaign_id,
                )
                for n in neighbors:
                    n.destination.lore_nodes = loc_lore_map.get(n.destination.id, [])
        finally:
            conn.close()

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
        from_loc = self.get_location(from_location_id)
        distinct_dest_ids = {nb.destination.id for nb in current_neighbors}
        target_dir = normalize_compass_direction(
            spec.compass_direction,
            f"{spec.entry_direction_label} {spec.name}",
        )

        # Resolve container inheritance (climb one level only if exiting via an active portal)
        from_is_portal = bool(from_loc.is_entry_exit) or any(
            nb.destination.container_id != from_loc.container_id
            for nb in current_neighbors
        )
        new_container_id: str | None = from_loc.container_id
        if from_loc.container_id and from_is_portal and getattr(spec, "is_exterior", False):
            conn_cont = self._connect()
            try:
                c_row = conn_cont.execute(
                    "SELECT parent_container_id FROM location_containers WHERE id = ?",
                    (from_loc.container_id,),
                ).fetchone()
                new_container_id = c_row["parent_container_id"] if c_row else None
            finally:
                conn_cont.close()

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
                        id, world_id, created_at_turn_id, container_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub, is_entry_exit
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
                    """,
                    (
                        new_loc_id,
                        world_id,
                        created_at_turn_id,
                        new_container_id,
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
        hub_crosses_boundary = from_loc.container_id is not None and (
            any(nb.destination.container_id != from_loc.container_id for nb in neighbors_in_dir)
            or new_container_id != from_loc.container_id
        )

        conn = self._connect()
        try:
            # 1. Insert the new Hub node
            conn.execute(
                """
                INSERT INTO location_nodes (
                    id, world_id, created_at_turn_id, container_id, name, summary,
                    description, environmental_tags_json, is_starting_location, is_hub, is_entry_exit
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
                """,
                (
                    hub_id,
                    world_id,
                    created_at_turn_id,
                    from_loc.container_id,
                    hub_name,
                    f"Connecting passageway branching {target_dir} from {from_loc.name}.",
                    (
                        f"A connecting junction and passageway extending {target_dir} from {from_loc.name}, "
                        "linking multiple adjoining rooms and thresholds."
                    ),
                    json.dumps(["hub", "passageway", f"{target_dir.lower()} passage"]),
                    1 if hub_crosses_boundary else 0,
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
                    id, world_id, created_at_turn_id, container_id, name, summary,
                    description, environmental_tags_json, is_starting_location, is_hub, is_entry_exit
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
                """,
                (
                    new_loc_id,
                    world_id,
                    created_at_turn_id,
                    new_container_id,
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
