"""Campaign location overrides, edges, spatial projections, and row mappers."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any
from app.engine.parties import (
    apply_party_disband,
    create_npc_only_party,
    resolve_character_location_override,
    resolve_location_override_movement,
)
from app.schemas.character import CognitionBlock
from app.schemas.party import (
    USER_PARTY_MEMBER_ID,
    LocationOverrideMoveMode,
)
from app.schemas.turn import (
    CampaignStateBundle,
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    WorldStateSnapshot,
)
from app.db.repos.arrival_descriptions import build_first_visit_arrival_bundle
from app.schemas.world import (
    DEFAULT_EXTERIOR_DISTANCE_METERS,
    DEFAULT_FALLBACK_DISTANCE_METERS,
    DEFAULT_INTERIOR_DISTANCE_METERS,
    MAX_EDGE_DISTANCE_METERS,
    OPPOSITE_COMPASS,
    WALKING_METERS_PER_MINUTE,
    LocationContainer,
    LocationEdge,
    LocationNode,
    LoreNode,
    normalize_compass_direction,
)
from app.db.repos.campaign_map_update import CampaignMapUpdateMixin
from app.db.repos.campaign_lore_items import CampaignLoreItemsMixin


class CampaignMapOpsMixin(CampaignMapUpdateMixin, CampaignLoreItemsMixin):
    """Campaign location overrides, edges, spatial projections, and row mappers."""

    def _load_character_names(self, char_ids: list[str]) -> dict[str, str]:
        if not char_ids:
            return {}
        placeholders = ",".join("?" for _ in char_ids)
        conn = self._connect()
        try:
            rows = conn.execute(
                f"SELECT id, name FROM characters WHERE id IN ({placeholders})",
                char_ids,
            ).fetchall()
            return {r["id"]: r["name"] for r in rows}
        finally:
            conn.close()

    def override_campaign_location(
        self,
        campaign_id: str,
        location_id: str,
        *,
        move_mode: LocationOverrideMoveMode = "party",
        accompanying_character_ids: list[str] | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Override the active player location on the current leaf turn with party-aware movement."""
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

        all_prev_states = dict(leaf_turn.character_states or {})
        if leaf_turn.character_state.character_id not in all_prev_states:
            all_prev_states[leaf_turn.character_state.character_id] = leaf_turn.character_state
        all_char_locations = {
            cid: st.current_location_id for cid, st in all_prev_states.items()
        }
        name_map = self._load_character_names(list(all_char_locations.keys()))

        branch_turns = self.get_branch_turn_chain(leaf_turn.id)
        valid_turn_ids = {t.id for t in branch_turns}
        world = self.get_world(campaign.world_id, valid_turn_ids=valid_turn_ids)
        world_target = next((loc for loc in world.locations if loc.id == location_id), target_loc)

        new_flags: list[str] = [f"At {world_target.name}"]
        arrival_cards, arrival_media, merged_visited, merged_visited_containers = (
            build_first_visit_arrival_bundle(
                target_location=world_target,
                containers=world.containers,
                locations=world.locations,
                prev_visited_locations=leaf_turn.world_snapshot.visited_location_ids or [],
                prev_visited_containers=leaf_turn.world_snapshot.visited_container_ids or [],
                describe_on_first_visit=campaign.world_settings.describe_on_first_visit,
                emit_media=campaign.world_settings.describe_on_first_visit,
            )
        )

        arrival_turn_id = (
            f"turn_{uuid.uuid4().hex[:10]}" if (arrival_cards or arrival_media) else leaf_turn.id
        )
        reconciled_parties, updated_char_locs, moving_npcs = resolve_location_override_movement(
            prior_parties=leaf_turn.world_snapshot.parties,
            old_loc_id=old_loc_id,
            target_loc_id=world_target.id,
            all_char_locations=all_char_locations,
            move_mode=move_mode,
            accompanying_character_ids=accompanying_character_ids,
            turn_id=arrival_turn_id,
            name_map=name_map,
        )

        if arrival_cards or arrival_media:
            def _moved_state(st):
                new_loc = updated_char_locs.get(st.character_id, st.current_location_id)
                return st.model_copy(
                    update={
                        "turn_id": arrival_turn_id,
                        "current_location_id": new_loc,
                    }
                )

            primary_prev = (
                all_prev_states.get(campaign.character_id)
                or leaf_turn.character_state
            )
            moved_primary = _moved_state(primary_prev)
            moved_extras = [
                _moved_state(st)
                for cid, st in all_prev_states.items()
                if cid != moved_primary.character_id
            ]
            self.save_turn_node(
                turn_id=arrival_turn_id,
                campaign_id=campaign.id,
                parent_turn_id=leaf_turn.id,
                depth_index=leaf_turn.depth_index + 1,
                user_message="",
                actor_id="__arrival__",
                raw_prose="",
                cognition=CognitionBlock(skipped=True),
                pre_turn=PreTurnAnalysis(active_speaker_id="__arrival__", speaker_order=[]),
                world_snapshot=WorldStateSnapshot(
                    turn_id=arrival_turn_id,
                    world_timestamp=leaf_turn.world_snapshot.world_timestamp,
                    active_location_id=world_target.id,
                    scene_flags=new_flags,
                    campaign_elapsed_minutes=leaf_turn.world_snapshot.campaign_elapsed_minutes,
                    visited_location_ids=merged_visited,
                    visited_container_ids=merged_visited_containers,
                    parties=reconciled_parties,
                ),
                character_state=moved_primary,
                extra_character_states=moved_extras,
                recalled_items=[],
                post_turn=PostTurnStateDelta(
                    elapsed_minutes=0,
                    transition_type="move_existing",
                    target_location_id=world_target.id,
                    first_visit_cards=arrival_cards,
                    first_visit_media=arrival_media,
                ),
            )
            return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET active_location_id = ?, scene_flags_json = ?,
                    visited_location_ids_json = ?, visited_container_ids_json = ?,
                    parties_json = ?
                WHERE turn_id = ?
                """,
                (
                    world_target.id,
                    json.dumps(new_flags),
                    json.dumps(merged_visited),
                    json.dumps(merged_visited_containers),
                    json.dumps([p.model_dump() for p in reconciled_parties]),
                    leaf_turn.id,
                ),
            )
            for cid in moving_npcs:
                conn.execute(
                    """
                    UPDATE character_states
                    SET current_location_id = ?
                    WHERE turn_id = ? AND character_id = ?
                    """,
                    (world_target.id, leaf_turn.id, cid),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def override_character_location(
        self,
        campaign_id: str,
        character_id: str,
        location_id: str,
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Relocate a single campaign NPC in-place on the leaf turn without triggering arrival/visited side effects."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        target_loc = self.get_location(location_id)
        if target_loc.world_id != campaign.world_id:
            raise ValueError(
                f"Location '{location_id}' does not belong to world '{campaign.world_id}'"
            )

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        participant_set = set(campaign.participant_character_ids or [campaign.character_id]) | set(
            leaf_turn.character_states.keys()
        )
        if character_id not in participant_set:
            raise ValueError(
                f"Character '{character_id}' is not a participant in campaign '{campaign_id}'."
            )

        all_char_locations = {
            cid: st.current_location_id for cid, st in leaf_turn.character_states.items()
        }
        name_map = self._load_character_names(list(participant_set))
        reconciled_parties = resolve_character_location_override(
            prior_parties=leaf_turn.world_snapshot.parties,
            character_id=character_id,
            target_location_id=target_loc.id,
            active_location_id=leaf_turn.world_snapshot.active_location_id,
            all_char_locations=all_char_locations,
            turn_id=leaf_turn.id,
            name_map=name_map,
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE character_states
                SET current_location_id = ?
                WHERE turn_id = ? AND character_id = ?
                """,
                (target_loc.id, leaf_turn.id, character_id),
            )
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET parties_json = ?
                WHERE turn_id = ?
                """,
                (
                    json.dumps([p.model_dump() for p in reconciled_parties]),
                    leaf_turn.id,
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def create_npc_party(
        self,
        campaign_id: str,
        member_ids: list[str],
        *,
        name: str | None = None,
        shared_goal: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Create an NPC-only party in-place on the active leaf turn with a randomly elected leader."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        all_char_locations = {
            cid: st.current_location_id for cid, st in leaf_turn.character_states.items()
        }
        participant_ids = list(
            dict.fromkeys([campaign.character_id, *(campaign.participant_character_ids or []), *all_char_locations.keys()])
        )
        name_map = self._load_character_names(participant_ids)
        updated_parties, _created = create_npc_only_party(
            leaf_turn.world_snapshot.parties,
            member_ids=member_ids,
            member_locations=all_char_locations,
            name=name,
            shared_goal=shared_goal,
            turn_id=leaf_turn.id,
            name_map=name_map,
        )

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET parties_json = ?
                WHERE turn_id = ?
                """,
                (json.dumps([p.model_dump() for p in updated_parties]), leaf_turn.id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def disband_party(
        self,
        campaign_id: str,
        party_id: str,
        *,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Disband an NPC-only party in-place on the active leaf turn (player parties must disband via turn)."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        target = next(
            (p for p in leaf_turn.world_snapshot.parties if p.id == party_id),
            None,
        )
        if target is None:
            raise KeyError(f"Party '{party_id}' not found on current turn")
        if USER_PARTY_MEMBER_ID in target.member_ids:
            raise ValueError(
                "Player parties must be disbanded in-character via /party disband or the turn stream."
            )

        updated_parties, _delta = apply_party_disband(
            leaf_turn.world_snapshot.parties, party_id
        )
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET parties_json = ?
                WHERE turn_id = ?
                """,
                (json.dumps([p.model_dump() for p in updated_parties]), leaf_turn.id),
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
        distance_meters: int | None = None,
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
        default_meters = (
            DEFAULT_INTERIOR_DISTANCE_METERS
            if from_loc.container_id
            else DEFAULT_FALLBACK_DISTANCE_METERS
        )
        resolved_meters = (
            default_meters
            if distance_meters is None
            else max(1, min(MAX_EDGE_DISTANCE_METERS, int(distance_meters)))
        )
        spec = ImprovisedLocationSpec(
            name=clean_name,
            summary=(summary or clean_desc.split(".")[0].strip() or clean_name)[:200],
            description=clean_desc,
            environmental_tags=tags,
            entry_direction_label=f"Passage to {clean_name}",
            return_direction_label=f"Back to {from_loc.name}",
            compass_direction=cdir,
            distance_meters=resolved_meters,
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
        distance_meters: int | None = None,
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

        if distance_meters is None:
            if from_loc.container_id and from_loc.container_id == to_loc.container_id:
                resolved_meters = DEFAULT_INTERIOR_DISTANCE_METERS
            elif (
                from_loc.container_id != to_loc.container_id
                or from_loc.is_hub
                or to_loc.is_hub
            ):
                resolved_meters = DEFAULT_EXTERIOR_DISTANCE_METERS
            else:
                resolved_meters = DEFAULT_FALLBACK_DISTANCE_METERS
        else:
            resolved_meters = max(1, min(MAX_EDGE_DISTANCE_METERS, int(distance_meters)))

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
                    direction_label, compass_direction, distance_meters,
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
                    resolved_meters,
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
                            direction_label, compass_direction, distance_meters,
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
                            resolved_meters,
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
        distance_meters: int,
        update_reciprocal: bool = True,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Update distance (distance_meters) of an existing edge on the active timeline."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        distance_meters = max(1, min(MAX_EDGE_DISTANCE_METERS, int(distance_meters)))

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
                        "UPDATE location_edges SET distance_meters = ? WHERE id = ?",
                        (distance_meters, edge.id),
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
                            direction_label, compass_direction, distance_meters,
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
                            distance_meters,
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

    def apply_clerk_location_mutation(
        self,
        *,
        campaign_id: str,
        turn_id: str,
        location: LocationNode,
        updated_description: str | None = None,
        tags_added: list[str] | None = None,
        tags_removed: list[str] | None = None,
    ) -> tuple[str, list[str], list[str], list[str]]:
        """Persist a branch-safe Clerk physical mutation via campaign_spatial_overrides without clobbering spatial layout.

        Returns (final_description, final_tags, applied_added, applied_removed).
        """
        final_desc = (
            updated_description.strip()
            if updated_description and updated_description.strip()
            else location.description
        )
        remove_lower = {t.strip().lower() for t in (tags_removed or []) if t and t.strip()}
        applied_removed: list[str] = []
        final_tags: list[str] = []
        seen_lower: set[str] = set()
        for existing in location.environmental_tags or []:
            clean = existing.strip()
            if not clean:
                continue
            low = clean.lower()
            if low in remove_lower:
                applied_removed.append(clean)
                continue
            if low not in seen_lower:
                seen_lower.add(low)
                final_tags.append(clean)
        applied_added: list[str] = []
        for add_t in tags_added or []:
            clean = add_t.strip()[:64]
            if not clean:
                continue
            low = clean.lower()
            if low not in seen_lower:
                seen_lower.add(low)
                final_tags.append(clean)
                applied_added.append(clean)

        conn = self._connect()
        try:
            existing_row = conn.execute(
                """
                SELECT parent_id, is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                FROM campaign_spatial_overrides
                WHERE turn_id = ? AND campaign_id = ? AND entity_type = 'location' AND entity_id = ?
                """,
                (turn_id, campaign_id, location.id),
            ).fetchone()
            meta: dict[str, Any] = {}
            if existing_row and existing_row["metadata_override_json"]:
                try:
                    parsed = json.loads(existing_row["metadata_override_json"])
                    if isinstance(parsed, dict):
                        meta = dict(parsed)
                except Exception:
                    meta = {}

            parent_id = existing_row["parent_id"] if existing_row else location.container_id
            is_entry_exit = (
                existing_row["is_entry_exit"]
                if existing_row and existing_row["is_entry_exit"] is not None
                else (1 if location.is_entry_exit else 0)
            )
            ui_x = existing_row["ui_x"] if existing_row else location.ui_x
            ui_y = existing_row["ui_y"] if existing_row else location.ui_y
            icon = existing_row["icon"] if existing_row else location.icon

            meta["description"] = final_desc
            meta["environmental_tags"] = final_tags

            conn.execute(
                """
                INSERT OR REPLACE INTO campaign_spatial_overrides (
                    turn_id, campaign_id, entity_type, entity_id, parent_id,
                    is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                )
                VALUES (?, ?, 'location', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    campaign_id,
                    location.id,
                    parent_id,
                    is_entry_exit,
                    ui_x,
                    ui_y,
                    icon,
                    json.dumps(meta),
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return final_desc, final_tags, applied_added, applied_removed

    @staticmethod
    def _row_to_lore_node(r: sqlite3.Row) -> LoreNode:
        keys = r.keys()
        return LoreNode(
            id=r["id"],
            world_id=r["world_id"],
            location_id=r["location_id"] if "location_id" in keys else None,
            container_id=r["container_id"] if "container_id" in keys else None,
            campaign_id=r["campaign_id"] if "campaign_id" in keys else None,
            created_at_turn_id=r["created_at_turn_id"] if "created_at_turn_id" in keys else None,
            origin_lore_id=r["origin_lore_id"] if "origin_lore_id" in keys else None,
            is_major_event=bool(r["is_major_event"]) if "is_major_event" in keys else False,
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
            image_media_id=r["image_media_id"] if "image_media_id" in keys else None,
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
            image_media_id=r["image_media_id"] if "image_media_id" in keys else None,
        )

    @staticmethod
    def _row_to_edge(r: sqlite3.Row) -> LocationEdge:
        keys = r.keys()
        raw_cdir = r["compass_direction"] if "compass_direction" in keys else None
        cdir = normalize_compass_direction(raw_cdir, r["direction_label"])
        if "distance_meters" in keys and r["distance_meters"] is not None:
            distance_meters = max(1, min(MAX_EDGE_DISTANCE_METERS, int(r["distance_meters"])))
        elif "travel_minutes" in keys and r["travel_minutes"] is not None:
            distance_meters = max(
                1,
                min(
                    MAX_EDGE_DISTANCE_METERS,
                    int(r["travel_minutes"]) * WALKING_METERS_PER_MINUTE,
                ),
            )
        else:
            distance_meters = DEFAULT_FALLBACK_DISTANCE_METERS
        return LocationEdge(
            id=r["id"],
            world_id=r["world_id"],
            from_location_id=r["from_location_id"],
            to_location_id=r["to_location_id"],
            direction_label=r["direction_label"],
            compass_direction=cdir,
            distance_meters=distance_meters,
            is_locked_or_hidden=bool(r["is_locked_or_hidden"]),
            created_at_turn_id=r["created_at_turn_id"],
            superseded_at_turn_id=r["superseded_at_turn_id"] if "superseded_at_turn_id" in keys else None,
        )
