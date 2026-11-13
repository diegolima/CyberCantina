"""Campaign location overrides, edges, spatial projections, and row mappers."""

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
from app.db.repos.campaign_map_update import CampaignMapUpdateMixin
from app.db.repos.campaign_lore_items import CampaignLoreItemsMixin


class CampaignMapOpsMixin(CampaignMapUpdateMixin, CampaignLoreItemsMixin):
    """Campaign location overrides, edges, spatial projections, and row mappers."""

    def override_campaign_location(
        self,
        campaign_id: str,
        location_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Override the active location on the current leaf turn (fixing Clerk hallucinations for the next turn or swipe)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        target_loc = self.get_location(location_id)
        if target_loc.world_id != campaign.world_id:
            raise ValueError(
                f"Location '{location_id}' does not belong to world '{campaign.world_id}'"
            )

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        old_loc_id = leaf_turn.world_snapshot.active_location_id
        old_loc_name = ""
        try:
            old_loc_name = self.get_location(old_loc_id).name
        except KeyError:
            pass

        new_flags: list[str] = [f"At {target_loc.name}"]
        merged_visited = list(
            dict.fromkeys(
                [*(leaf_turn.world_snapshot.visited_location_ids or []), target_loc.id]
            )
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET active_location_id = ?, scene_flags_json = ?, visited_location_ids_json = ?
                WHERE turn_id = ?
                """,
                (target_loc.id, json.dumps(new_flags), json.dumps(merged_visited), leaf_turn.id),
            )
            # Move characters who were present at old_loc_id (plus primary actor) to target_loc.id
            conn.execute(
                """
                UPDATE character_states
                SET current_location_id = ?
                WHERE turn_id = ? AND (current_location_id = ? OR character_id = ?)
                """,
                (target_loc.id, leaf_turn.id, old_loc_id, leaf_turn.actor_id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def create_linked_location(
        self,
        campaign_id: str,
        *,
        from_location_id: str,
        name: str,
        description: str,
        environmental_tags: list[str],
        compass_direction: str,
        travel_minutes: int,
        summary: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Manually create a new room linked to from_location_id, bound to the active leaf turn (branch-safe).

        Respects the 8-neighbor cap: if from_location_id is full, a directional Passage Hub is used.
        """
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")
        clean_name = name.strip()
        clean_desc = description.strip()
        if not clean_name:
            raise ValueError("Location name is required")
        if not clean_desc:
            raise ValueError("Sensory description is required")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        if from_location_id not in {loc.id for loc in world.locations}:
            raise ValueError(
                f"Location '{from_location_id}' is not visible on the active timeline of this campaign"
            )

        cdir = normalize_compass_direction(compass_direction)
        from_loc = self.get_location(from_location_id)
        tags = [t.strip() for t in environmental_tags if t.strip()]
        spec = ImprovisedLocationSpec(
            name=clean_name,
            summary=(summary or clean_desc.split(".")[0].strip() or clean_name)[:200],
            description=clean_desc,
            environmental_tags=tags,
            entry_direction_label=f"Passage to {clean_name}",
            return_direction_label=f"Back to {from_loc.name}",
            compass_direction=cdir,
            travel_minutes=max(1, min(240, travel_minutes)),
        )
        self.add_improvised_location(
            world_id=campaign.world_id,
            from_location_id=from_location_id,
            created_at_turn_id=campaign.active_leaf_turn_id,
            spec=spec,
            valid_turn_ids=valid_turn_ids,
        )
        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def connect_campaign_locations(
        self,
        campaign_id: str,
        *,
        from_location_id: str,
        to_location_id: str,
        compass_direction: str = "N",
        travel_minutes: int = 1,
        direction_label: str | None = None,
        bidirectional: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Connect two existing map locations on the campaign's active timeline."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        if from_location_id == to_location_id:
            raise ValueError("Cannot connect a location to itself")

        travel_minutes = max(1, min(240, int(travel_minutes)))
        cdir = normalize_compass_direction(compass_direction)

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        loc_ids = {loc.id for loc in world.locations}

        if from_location_id not in loc_ids:
            raise ValueError(
                f"Location '{from_location_id}' is not visible on the active timeline"
            )
        if to_location_id not in loc_ids:
            raise ValueError(
                f"Location '{to_location_id}' is not visible on the active timeline"
            )

        from_loc = next(loc for loc in world.locations if loc.id == from_location_id)
        to_loc = next(loc for loc in world.locations if loc.id == to_location_id)

        # Check if an edge already exists from from_location_id to to_location_id
        for e in world.edges:
            if e.from_location_id == from_location_id and e.to_location_id == to_location_id:
                raise ValueError(
                    f"A passage already exists from '{from_loc.name}' to '{to_loc.name}'"
                )

        fwd_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
        fwd_label = (
            direction_label.strip()
            if direction_label and direction_label.strip()
            else f"Passage to {to_loc.name}"
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO location_edges (
                    id, world_id, from_location_id, to_location_id,
                    direction_label, compass_direction, travel_minutes,
                    is_locked_or_hidden, created_at_turn_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    fwd_edge_id,
                    campaign.world_id,
                    from_location_id,
                    to_location_id,
                    fwd_label,
                    cdir,
                    travel_minutes,
                    campaign.active_leaf_turn_id,
                ),
            )

            if bidirectional:
                has_rev = any(
                    e.from_location_id == to_location_id and e.to_location_id == from_location_id
                    for e in world.edges
                )
                if not has_rev:
                    rev_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                    rev_dir = OPPOSITE_COMPASS.get(cdir, "S")
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes,
                            is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                        """,
                        (
                            rev_edge_id,
                            campaign.world_id,
                            to_location_id,
                            from_location_id,
                            f"Return passage to {from_loc.name}",
                            rev_dir,
                            travel_minutes,
                            campaign.active_leaf_turn_id,
                        ),
                    )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def update_campaign_edge_distance(
        self,
        campaign_id: str,
        *,
        edge_id: str,
        travel_minutes: int,
        update_reciprocal: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Update distance (travel_minutes) of an existing edge on the active timeline."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        travel_minutes = max(1, min(240, int(travel_minutes)))

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)

        target_edge = next((e for e in world.edges if e.id == edge_id), None)
        if not target_edge:
            raise KeyError(f"Edge '{edge_id}' is not visible on the active timeline")

        edges_to_update = [target_edge]
        if update_reciprocal:
            for e in world.edges:
                if (
                    e.from_location_id == target_edge.to_location_id
                    and e.to_location_id == target_edge.from_location_id
                    and e.id != target_edge.id
                ):
                    edges_to_update.append(e)

        conn = self._connect()
        try:
            for edge in edges_to_update:
                if edge.created_at_turn_id == campaign.active_leaf_turn_id:
                    conn.execute(
                        "UPDATE location_edges SET travel_minutes = ? WHERE id = ?",
                        (travel_minutes, edge.id),
                    )
                else:
                    conn.execute(
                        "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                        (campaign.active_leaf_turn_id, edge.id),
                    )
                    new_edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes,
                            is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            new_edge_id,
                            edge.world_id,
                            edge.from_location_id,
                            edge.to_location_id,
                            edge.direction_label,
                            edge.compass_direction,
                            travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                            campaign.active_leaf_turn_id,
                        ),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def remove_campaign_edge(
        self,
        campaign_id: str,
        *,
        edge_id: str,
        remove_reciprocal: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Remove a link on the active timeline, ensuring each location retains at least one connection."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)

        target_edge = next((e for e in world.edges if e.id == edge_id), None)
        if not target_edge:
            raise KeyError(f"Edge '{edge_id}' is not visible on the active timeline")

        edges_to_remove = [target_edge]
        if remove_reciprocal:
            for e in world.edges:
                if (
                    e.from_location_id == target_edge.to_location_id
                    and e.to_location_id == target_edge.from_location_id
                    and e.id != target_edge.id
                ):
                    edges_to_remove.append(e)

        remove_ids = {e.id for e in edges_to_remove}
        remaining_edges = [e for e in world.edges if e.id not in remove_ids]

        # Determine starting hub
        starting_hub = next(
            (loc for loc in world.locations if loc.is_starting_location),
            world.locations[0] if world.locations else None,
        )
        if not starting_hub:
            raise ValueError("No locations exist in this world")

        # Build adjacency graph of remaining edges (undirected spatial traversal)
        adj: dict[str, set[str]] = {}
        for e in remaining_edges:
            adj.setdefault(e.from_location_id, set()).add(e.to_location_id)
            adj.setdefault(e.to_location_id, set()).add(e.from_location_id)

        # BFS from starting hub to ensure no disconnected islands are formed
        reachable: set[str] = {starting_hub.id}
        queue = [starting_hub.id]
        while queue:
            curr = queue.pop(0)
            for neighbor_id in adj.get(curr, set()):
                if neighbor_id not in reachable:
                    reachable.add(neighbor_id)
                    queue.append(neighbor_id)

        # Both linked locations must retain a valid path to the starting hub
        if target_edge.from_location_id not in reachable or target_edge.to_location_id not in reachable:
            raise ValueError(
                "Cannot remove link: both locations must retain a valid path to the starting hub."
            )

        conn = self._connect()
        try:
            for edge in edges_to_remove:
                if edge.created_at_turn_id == campaign.active_leaf_turn_id:
                    conn.execute("DELETE FROM location_edges WHERE id = ?", (edge.id,))
                else:
                    conn.execute(
                        """
                        UPDATE location_edges
                        SET superseded_at_turn_id = ?
                        WHERE id = ?
                        """,
                        (campaign.active_leaf_turn_id, edge.id),
                    )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    @staticmethod
    def _apply_campaign_spatial_overrides(
        conn: sqlite3.Connection,
        *,
        campaign_id: str,
        valid_turn_ids: set[str] | None,
        containers: list[LocationContainer],
        locations: list[LocationNode],
    ) -> tuple[list[LocationContainer], list[LocationNode]]:
        """Overlay branch-scoped spatial, cosmetic, and unvisited-metadata overrides chronologically."""
        if valid_turn_ids is not None and not valid_turn_ids:
            return containers, locations
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='campaign_spatial_overrides'"
        ).fetchone()
        if not table_exists:
            return containers, locations

        rows = conn.execute(
            """
            SELECT o.*
            FROM campaign_spatial_overrides o
            JOIN turn_nodes t ON t.id = o.turn_id
            WHERE o.campaign_id = ?
            ORDER BY t.depth_index ASC, o.rowid ASC
            """,
            (campaign_id,),
        ).fetchall()
        if not rows:
            return containers, locations

        cont_by_id = {c.id: c for c in containers}
        loc_by_id = {loc.id: loc for loc in locations}
        superseded_loc_ids: set[str] = set()

        for r in rows:
            if valid_turn_ids is not None and r["turn_id"] not in valid_turn_ids:
                continue
            etype = r["entity_type"]
            eid = r["entity_id"]
            meta: dict[str, Any] = {}
            if r["metadata_override_json"]:
                try:
                    parsed = json.loads(r["metadata_override_json"])
                    if isinstance(parsed, dict):
                        meta = parsed
                except Exception:
                    meta = {}

            if etype == "container" and eid in cont_by_id:
                cont = cont_by_id[eid]
                cont.parent_container_id = r["parent_id"]
                cont.ui_x = r["ui_x"]
                cont.ui_y = r["ui_y"]
                cont.icon = r["icon"]
                if "name" in meta and isinstance(meta["name"], str) and meta["name"].strip():
                    cont.name = meta["name"].strip()
                if "description" in meta and isinstance(meta["description"], str):
                    cont.description = meta["description"]
                if "environmental_tags" in meta and isinstance(meta["environmental_tags"], list):
                    cont.environmental_tags = [
                        str(t) for t in meta["environmental_tags"] if str(t).strip()
                    ]
            elif etype == "location" and eid in loc_by_id:
                if meta.get("superseded"):
                    superseded_loc_ids.add(eid)
                    continue
                superseded_loc_ids.discard(eid)
                loc = loc_by_id[eid]
                loc.container_id = r["parent_id"]
                if r["is_entry_exit"] is not None:
                    loc.is_entry_exit = bool(r["is_entry_exit"])
                loc.ui_x = r["ui_x"]
                loc.ui_y = r["ui_y"]
                loc.icon = r["icon"]
                if "name" in meta and isinstance(meta["name"], str) and meta["name"].strip():
                    loc.name = meta["name"].strip()
                if "summary" in meta and isinstance(meta["summary"], str):
                    loc.summary = meta["summary"]
                if "description" in meta and isinstance(meta["description"], str):
                    loc.description = meta["description"]
                if "environmental_tags" in meta and isinstance(meta["environmental_tags"], list):
                    loc.environmental_tags = [
                        str(t) for t in meta["environmental_tags"] if str(t).strip()
                    ]
                if "is_hub" in meta:
                    loc.is_hub = bool(meta["is_hub"])
                if "starting_message" in meta and isinstance(meta["starting_message"], str):
                    loc.starting_message = meta["starting_message"]

        if superseded_loc_ids:
            locations = [loc for loc in locations if loc.id not in superseded_loc_ids]
        return containers, locations

    @staticmethod
    def _row_to_lore_node(r: sqlite3.Row) -> LoreNode:
        keys = r.keys()
        return LoreNode(
            id=r["id"],
            world_id=r["world_id"],
            location_id=r["location_id"] if "location_id" in keys else None,
            container_id=r["container_id"] if "container_id" in keys else None,
            campaign_id=r["campaign_id"] if "campaign_id" in keys else None,
            title=r["title"],
            category=r["category"],
            content=r["content"],
            entity_tags=json.loads(r["entity_tags_json"] or "[]"),
        )

    @staticmethod
    def _row_to_container(r: sqlite3.Row) -> LocationContainer:
        keys = r.keys()
        return LocationContainer(
            id=r["id"],
            world_id=r["world_id"],
            created_at_turn_id=r["created_at_turn_id"] if "created_at_turn_id" in keys else None,
            parent_container_id=r["parent_container_id"] if "parent_container_id" in keys else None,
            depth=r["depth"],
            name=r["name"],
            description=r["description"] if "description" in keys and r["description"] else "",
            environmental_tags=json.loads(r["environmental_tags_json"] or "[]"),
            ui_x=r["ui_x"] if "ui_x" in keys else None,
            ui_y=r["ui_y"] if "ui_y" in keys else None,
            icon=r["icon"] if "icon" in keys else None,
        )

    @staticmethod
    def _row_to_location(r: sqlite3.Row) -> LocationNode:
        keys = r.keys()
        return LocationNode(
            id=r["id"],
            world_id=r["world_id"],
            created_at_turn_id=r["created_at_turn_id"],
            superseded_at_turn_id=r["superseded_at_turn_id"] if "superseded_at_turn_id" in keys else None,
            container_id=r["container_id"] if "container_id" in keys else None,
            name=r["name"],
            summary=r["summary"],
            description=r["description"],
            environmental_tags=json.loads(r["environmental_tags_json"] or "[]"),
            is_starting_location=bool(r["is_starting_location"]),
            is_hub=bool(r["is_hub"]) if "is_hub" in keys else False,
            is_entry_exit=bool(r["is_entry_exit"]) if "is_entry_exit" in keys else False,
            starting_message=r["starting_message"] if "starting_message" in keys and r["starting_message"] else "",
            ui_x=r["ui_x"] if "ui_x" in keys else None,
            ui_y=r["ui_y"] if "ui_y" in keys else None,
            icon=r["icon"] if "icon" in keys else None,
        )

    @staticmethod
    def _row_to_edge(r: sqlite3.Row) -> LocationEdge:
        keys = r.keys()
        raw_cdir = r["compass_direction"] if "compass_direction" in keys else None
        cdir = normalize_compass_direction(raw_cdir, r["direction_label"])
        return LocationEdge(
            id=r["id"],
            world_id=r["world_id"],
            from_location_id=r["from_location_id"],
            to_location_id=r["to_location_id"],
            direction_label=r["direction_label"],
            compass_direction=cdir,
            travel_minutes=r["travel_minutes"],
            is_locked_or_hidden=bool(r["is_locked_or_hidden"]),
            created_at_turn_id=r["created_at_turn_id"],
            superseded_at_turn_id=r["superseded_at_turn_id"] if "superseded_at_turn_id" in keys else None,
        )
