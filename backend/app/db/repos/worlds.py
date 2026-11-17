"""World CRUD, scoped lore helpers, and pending-deletion pruning."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any
import numpy as np
from app.db.vector_store import combine_entry_text
from app.schemas.world import (
    OPPOSITE_COMPASS,
    LocationContainer,
    LocationEdge,
    LocationNode,
    LoreNode,
    WorldGlobalRules,
    WorldMediaItem,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardCommitPayload,
    WorldWizardDraft,
    extract_world_unsupported_fields,
    normalize_compass_direction,
    pick_available_compass_direction,
    sanitize_world_unsupported_fields,
)
from app.db.repos.base import (
    _remap_character_items_for_world_update,
    _compute_missing_embeddings,
    _location_lore_vector_fields,
    build_world_media_url,
    utc_now_iso,
)


class WorldsMixin:
    """World CRUD, scoped lore helpers, and pending-deletion pruning."""

    def _resolve_scoped_lore_map(
        self,
        conn: sqlite3.Connection,
        scope_col: str,
        scope_ids: list[str] | set[str],
        override_table: str,
        campaign_id: str | None = None,
    ) -> dict[str, list[LoreNode]]:
        """Hydrate per-entity LoreNodes (location_id or container_id) with Copy-on-Write campaign override precedence."""
        clean_ids = [sid for sid in scope_ids if sid]
        if not clean_ids:
            return {}

        placeholders = ",".join("?" for _ in clean_ids)
        overridden_ids: set[str] = set()
        if campaign_id:
            ov_rows = conn.execute(
                f"""
                SELECT {scope_col} FROM {override_table}
                WHERE campaign_id = ? AND {scope_col} IN ({placeholders})
                """,
                [campaign_id, *clean_ids],
            ).fetchall()
            overridden_ids = {r[scope_col] for r in ov_rows}
            lore_rows = conn.execute(
                f"""
                SELECT * FROM lore_nodes
                WHERE {scope_col} IN ({placeholders})
                  AND (campaign_id IS NULL OR campaign_id = ?)
                ORDER BY rowid ASC
                """,
                [*clean_ids, campaign_id],
            ).fetchall()
        else:
            lore_rows = conn.execute(
                f"""
                SELECT * FROM lore_nodes
                WHERE {scope_col} IN ({placeholders})
                  AND campaign_id IS NULL
                ORDER BY rowid ASC
                """,
                clean_ids,
            ).fetchall()

        result: dict[str, list[LoreNode]] = {sid: [] for sid in clean_ids}
        for r in lore_rows:
            sid = r[scope_col]
            if not sid or sid not in result:
                continue
            r_camp = r["campaign_id"]
            if sid in overridden_ids:
                if r_camp == campaign_id:
                    result[sid].append(self._row_to_lore_node(r))
            else:
                if r_camp is None:
                    result[sid].append(self._row_to_lore_node(r))
        return result

    def _resolve_location_lore_map(
        self,
        conn: sqlite3.Connection,
        location_ids: list[str] | set[str],
        campaign_id: str | None = None,
    ) -> dict[str, list[LoreNode]]:
        """Hydrate per-location LoreNodes with Copy-on-Write campaign override precedence."""
        return self._resolve_scoped_lore_map(
            conn,
            "location_id",
            location_ids,
            "campaign_location_lore_overrides",
            campaign_id=campaign_id,
        )

    def _resolve_container_lore_map(
        self,
        conn: sqlite3.Connection,
        container_ids: list[str] | set[str],
        campaign_id: str | None = None,
    ) -> dict[str, list[LoreNode]]:
        """Hydrate per-container LoreNodes with Copy-on-Write campaign override precedence."""
        return self._resolve_scoped_lore_map(
            conn,
            "container_id",
            container_ids,
            "campaign_container_lore_overrides",
            campaign_id=campaign_id,
        )

    def create_world_from_draft(
        self,
        draft: WorldWizardDraft | WorldWizardCommitPayload,
        world_id: str | None = None,
        lore_embeddings: list[np.ndarray] | None = None,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
        unsupported_fields: dict[str, Any] | None = None,
    ) -> WorldRecord:
        """Persist a WorldWizardDraft (rules, containers, locations, edges, lore) and index lore vectors."""
        w_id = world_id or f"world_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        containers = list(getattr(draft, "containers", None) or [])
        # Insert macro containers first (higher depth first) so parent rows exist before children.
        sorted_containers = sorted(containers, key=lambda c: (-c.depth, c.name))
        clean_unsupported = sanitize_world_unsupported_fields(unsupported_fields or {}, strict=True)
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO worlds (id, owner_id, name, global_rules_json, unsupported_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    w_id,
                    owner_id,
                    draft.name,
                    draft.global_rules.model_dump_json(),
                    json.dumps(clean_unsupported),
                    now,
                ),
            )

            cont_id_map: dict[str, str] = {}
            for cont in sorted_containers:
                new_cont_id = f"cont_{uuid.uuid4().hex[:10]}"
                cont_id_map[cont.id] = new_cont_id
                mapped_parent_id: str | None = None
                if cont.parent_container_id:
                    mapped_parent_id = cont_id_map.get(cont.parent_container_id)
                    if not mapped_parent_id:
                        raise ValueError(
                            f"Container '{cont.name}' references missing parent '{cont.parent_container_id}'."
                        )
                conn.execute(
                    """
                    INSERT INTO location_containers (
                        id, world_id, created_at_turn_id, parent_container_id, depth, name,
                        description, environmental_tags_json, ui_x, ui_y, icon, created_at
                    )
                    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_cont_id,
                        w_id,
                        mapped_parent_id,
                        cont.depth,
                        cont.name,
                        cont.description,
                        json.dumps(cont.environmental_tags),
                        cont.ui_x,
                        cont.ui_y,
                        cont.icon,
                        now,
                    ),
                )

            has_start = any(loc.is_starting_location for loc in draft.locations)
            key_to_loc_id: dict[str, str] = {}
            key_to_loc_name: dict[str, str] = {}
            for idx, loc in enumerate(draft.locations):
                loc_id = f"loc_{uuid.uuid4().hex[:10]}"
                key_to_loc_id[loc.key] = loc_id
                key_to_loc_name[loc.key] = loc.name
                is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                is_hub = 1 if getattr(loc, "is_hub", False) else 0
                raw_cont_id = getattr(loc, "container_id", None)
                mapped_loc_cont = cont_id_map.get(raw_cont_id) if raw_cont_id else None
                if raw_cont_id and not mapped_loc_cont:
                    raise ValueError(
                        f"Location '{loc.name}' references missing container '{raw_cont_id}'."
                    )
                is_portal = (
                    1
                    if (mapped_loc_cont is not None and getattr(loc, "is_entry_exit", False))
                    else 0
                )
                starting_msg = getattr(loc, "starting_message", "") or ""
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, superseded_at_turn_id, container_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub,
                        is_entry_exit, starting_message, ui_x, ui_y, icon
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        loc_id,
                        w_id,
                        mapped_loc_cont,
                        loc.name,
                        loc.summary,
                        loc.description,
                        json.dumps(loc.environmental_tags),
                        is_start,
                        is_hub,
                        is_portal,
                        starting_msg,
                        getattr(loc, "ui_x", None),
                        getattr(loc, "ui_y", None),
                        getattr(loc, "icon", None),
                    ),
                )
                for loc_lore in loc.lore_nodes:
                    loc_lore_id = f"lore_{uuid.uuid4().hex[:10]}"
                    loc_tags_json = json.dumps(loc_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            loc_lore_id,
                            w_id,
                            loc_id,
                            loc_lore.title,
                            loc_lore.category,
                            loc_lore.content,
                            loc_tags_json,
                        ),
                    )
                    if loc_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            loc.name, loc_lore.title, loc_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        pre_loc_vec = (
                            precomputed_embeddings.get((vec_title, loc_lore.content, vec_kw_json))
                            if precomputed_embeddings
                            else None
                        )
                        self.vector_store.upsert_entry(
                            entry_id=loc_lore_id,
                            source_type="location_lore",
                            world_id=w_id,
                            location_id=loc_id,
                            title=vec_title,
                            content=loc_lore.content,
                            keywords=vec_keywords,
                            embedding=pre_loc_vec,
                            conn=conn,
                        )

            occupied_from: dict[str, set[str]] = {}
            for edge in draft.edges:
                from_id = key_to_loc_id.get(edge.from_key)
                to_id = key_to_loc_id.get(edge.to_key)
                if not from_id or not to_id:
                    continue
                edge_id = f"edge_{uuid.uuid4().hex[:10]}"
                from_occ = occupied_from.setdefault(from_id, set())
                preferred_dir = normalize_compass_direction(
                    edge.compass_direction, edge.direction_label
                )
                fwd_dir = pick_available_compass_direction(preferred_dir, from_occ)
                from_occ.add(fwd_dir)
                fwd_label = (
                    edge.direction_label.strip()
                    or f"Passage to {key_to_loc_name.get(edge.to_key, edge.to_key)}"
                )
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        edge_id,
                        w_id,
                        from_id,
                        to_id,
                        fwd_label,
                        fwd_dir,
                        edge.travel_minutes,
                        1 if edge.is_locked_or_hidden else 0,
                    ),
                )
                if edge.bidirectional:
                    rev_id = f"edge_{uuid.uuid4().hex[:10]}"
                    to_occ = occupied_from.setdefault(to_id, set())
                    rev_dir = pick_available_compass_direction(
                        OPPOSITE_COMPASS[fwd_dir], to_occ
                    )
                    to_occ.add(rev_dir)
                    rev_label = (
                        edge.reverse_direction_label.strip()
                        or f"Return to {key_to_loc_name.get(edge.from_key, edge.from_key)}"
                    )
                    conn.execute(
                        """
                        INSERT INTO location_edges (
                            id, world_id, from_location_id, to_location_id,
                            direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                        """,
                        (
                            rev_id,
                            w_id,
                            to_id,
                            from_id,
                            rev_label,
                            rev_dir,
                            edge.travel_minutes,
                            1 if edge.is_locked_or_hidden else 0,
                        ),
                    )

            for idx, lore in enumerate(draft.lore_nodes):
                lore_id = f"lore_{uuid.uuid4().hex[:10]}"
                tags_json = json.dumps(lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (
                        lore_id,
                        w_id,
                        lore.title,
                        lore.category,
                        lore.content,
                        tags_json,
                    ),
                )
                precomputed = (
                    lore_embeddings[idx]
                    if lore_embeddings is not None and idx < len(lore_embeddings)
                    else (
                        precomputed_embeddings.get((lore.title, lore.content, tags_json))
                        if precomputed_embeddings
                        else None
                    )
                )
                self.vector_store.upsert_entry(
                    entry_id=lore_id,
                    source_type="lore",
                    world_id=w_id,
                    title=lore.title,
                    content=lore.content,
                    keywords=lore.entity_tags,
                    embedding=precomputed,
                    conn=conn,
                )

            for cont in sorted_containers:
                if cont.depth != 1:
                    continue
                mapped_cont_id = cont_id_map.get(cont.id)
                if not mapped_cont_id:
                    continue
                for cont_lore in getattr(cont, "lore_nodes", None) or []:
                    cont_lore_id = f"lore_{uuid.uuid4().hex[:10]}"
                    cont_tags_json = json.dumps(cont_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, container_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            cont_lore_id,
                            w_id,
                            mapped_cont_id,
                            cont_lore.title,
                            cont_lore.category,
                            cont_lore.content,
                            cont_tags_json,
                        ),
                    )
                    if cont_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            cont.name, cont_lore.title, cont_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        pre_cont_vec = (
                            precomputed_embeddings.get((vec_title, cont_lore.content, vec_kw_json))
                            if precomputed_embeddings
                            else None
                        )
                        self.vector_store.upsert_entry(
                            entry_id=cont_lore_id,
                            source_type="container_lore",
                            world_id=w_id,
                            container_id=mapped_cont_id,
                            title=vec_title,
                            content=cont_lore.content,
                            keywords=vec_keywords,
                            embedding=pre_cont_vec,
                            conn=conn,
                        )

            conn.commit()
        finally:
            conn.close()

        return self.get_world(w_id)

    async def acreate_world_from_draft(
        self,
        draft: WorldWizardDraft | WorldWizardCommitPayload,
        world_id: str | None = None,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Asynchronously pre-compute world, location, & L1 container lore embeddings and persist draft."""
        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for lore in draft.lore_nodes:
            tags_json = json.dumps(lore.entity_tags)
            items_to_embed.append(
                (
                    (lore.title, lore.content, tags_json),
                    combine_entry_text(lore.title, lore.content, lore.entity_tags),
                )
            )
        for loc in draft.locations:
            for loc_lore in loc.lore_nodes:
                if loc_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    loc.name, loc_lore.title, loc_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, loc_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, loc_lore.content, vec_keywords),
                    )
                )
        for cont in getattr(draft, "containers", None) or []:
            if cont.depth != 1:
                continue
            for cont_lore in getattr(cont, "lore_nodes", None) or []:
                if cont_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    cont.name, cont_lore.title, cont_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, cont_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, cont_lore.content, vec_keywords),
                    )
                )
        precomputed = await _compute_missing_embeddings(items_to_embed, {})
        return self.create_world_from_draft(
            draft,
            world_id=world_id,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

    def list_worlds(
        self,
        include_pending_deletion: bool = False,
        owner_id: str | None = None,
    ) -> list[WorldRecord]:
        conn = self._connect()
        try:
            if owner_id is not None:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE owner_id = ? ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE owner_id = ? AND pending_deletion = 0 ORDER BY created_at DESC",
                        (owner_id,),
                    ).fetchall()
            else:
                if include_pending_deletion:
                    rows = conn.execute(
                        "SELECT id FROM worlds ORDER BY created_at DESC"
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT id FROM worlds WHERE pending_deletion = 0 ORDER BY created_at DESC"
                    ).fetchall()
        finally:
            conn.close()
        return [self.get_world(r["id"], base_only=True) for r in rows]

    def get_world(
        self,
        world_id: str,
        valid_turn_ids: set[str] | None = None,
        base_only: bool = False,
        owner_id: str | None = None,
        campaign_id: str | None = None,
    ) -> WorldRecord:
        conn = self._connect()
        try:
            if owner_id is not None:
                w_row = conn.execute(
                    "SELECT * FROM worlds WHERE id = ? AND owner_id = ?",
                    (world_id, owner_id),
                ).fetchone()
            else:
                w_row = conn.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone()
            if not w_row:
                raise KeyError(f"World '{world_id}' not found")

            container_rows = conn.execute(
                """
                SELECT * FROM location_containers
                WHERE world_id = ?
                ORDER BY depth DESC, rowid ASC
                """,
                (world_id,),
            ).fetchall()
            loc_rows = conn.execute(
                "SELECT * FROM location_nodes WHERE world_id = ?", (world_id,)
            ).fetchall()
            edge_rows = conn.execute(
                "SELECT * FROM location_edges WHERE world_id = ?", (world_id,)
            ).fetchall()
            lore_rows = conn.execute(
                """
                SELECT * FROM lore_nodes
                WHERE world_id = ? AND location_id IS NULL AND container_id IS NULL AND campaign_id IS NULL
                ORDER BY rowid ASC
                """,
                (world_id,),
            ).fetchall()

            containers: list[LocationContainer] = []
            for r in container_rows:
                c_turn = r["created_at_turn_id"] if "created_at_turn_id" in r.keys() else None
                if base_only and c_turn is not None:
                    continue
                if valid_turn_ids is not None and c_turn is not None and c_turn not in valid_turn_ids:
                    continue
                containers.append(self._row_to_container(r))

            locations: list[LocationNode] = []
            for r in loc_rows:
                c_turn = r["created_at_turn_id"]
                sup_turn = r["superseded_at_turn_id"] if "superseded_at_turn_id" in r.keys() else None
                if base_only and c_turn is not None:
                    continue
                if valid_turn_ids is not None:
                    if c_turn is not None and c_turn not in valid_turn_ids:
                        continue
                    if sup_turn is not None and sup_turn in valid_turn_ids:
                        continue
                elif not base_only and sup_turn is not None:
                    continue
                locations.append(self._row_to_location(r))

            if not base_only and campaign_id:
                containers, locations = self._apply_campaign_spatial_overrides(
                    conn,
                    campaign_id=campaign_id,
                    valid_turn_ids=valid_turn_ids,
                    containers=containers,
                    locations=locations,
                )

            cont_lore_map = self._resolve_container_lore_map(
                conn,
                [c.id for c in containers if c.depth == 1],
                campaign_id=None if base_only else campaign_id,
            )
            for c in containers:
                if c.depth == 1:
                    c.lore_nodes = cont_lore_map.get(c.id, [])

            loc_lore_map = self._resolve_location_lore_map(
                conn,
                [loc.id for loc in locations],
                campaign_id=None if base_only else campaign_id,
            )
            for loc in locations:
                loc.lore_nodes = loc_lore_map.get(loc.id, [])

            media_items = self._resolve_world_media_items(conn, world_id)
            media_by_id = {m.id: m for m in media_items}
            self._hydrate_entities_media(containers, media_by_id)
            self._hydrate_entities_media(locations, media_by_id)
        finally:
            conn.close()

        visible_loc_ids = {loc.id for loc in locations}
        edges: list[LocationEdge] = []
        for r in edge_rows:
            c_turn = r["created_at_turn_id"]
            sup_turn = r["superseded_at_turn_id"] if "superseded_at_turn_id" in r.keys() else None
            if base_only and c_turn is not None:
                continue
            if valid_turn_ids is not None:
                if c_turn is not None and c_turn not in valid_turn_ids:
                    continue
                if sup_turn is not None and sup_turn in valid_turn_ids:
                    continue
            elif not base_only and sup_turn is not None:
                continue
            if r["from_location_id"] not in visible_loc_ids or r["to_location_id"] not in visible_loc_ids:
                continue
            edges.append(self._row_to_edge(r))

        lore_nodes = [self._row_to_lore_node(r) for r in lore_rows]

        w_keys = w_row.keys()
        raw_rules_dict = json.loads(w_row["global_rules_json"] or "{}")
        stored_unsupported = json.loads(
            w_row["unsupported_fields_json"]
            if "unsupported_fields_json" in w_keys and w_row["unsupported_fields_json"]
            else "{}"
        )
        unsupported_fields = extract_world_unsupported_fields(
            {
                "global_rules": raw_rules_dict if isinstance(raw_rules_dict, dict) else {},
                "unsupported_fields": stored_unsupported if isinstance(stored_unsupported, dict) else {},
            }
        )
        return WorldRecord(
            id=w_row["id"],
            name=w_row["name"],
            global_rules=WorldGlobalRules.model_validate(raw_rules_dict),
            pending_deletion=bool(w_row["pending_deletion"]) if "pending_deletion" in w_keys else False,
            created_at=w_row["created_at"],
            containers=containers,
            locations=locations,
            edges=edges,
            lore_nodes=lore_nodes,
            media=media_items,
            unsupported_fields=unsupported_fields,
        )

    def update_world(
        self,
        world_id: str,
        payload: WorldUpdatePayload,
        lore_embeddings: dict[int, np.ndarray] | None = None,
        owner_id: str | None = None,
        precomputed_embeddings: dict[tuple[str, str, str], np.ndarray] | None = None,
    ) -> WorldRecord:
        """Update a world in-place if unused, or silently fork a new Copy-on-Write version if used by campaigns."""
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        now = utc_now_iso()
        conn = self._connect()
        try:
            w_owner_row = conn.execute(
                "SELECT owner_id FROM worlds WHERE id = ?", (world_id,)
            ).fetchone()
            effective_owner_id = (
                w_owner_row["owner_id"]
                if w_owner_row and "owner_id" in w_owner_row.keys()
                else owner_id
            )

            usage_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0

            # Cache existing world, location, and container lore vector blobs so unchanged lore nodes don't re-run embeddings
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND source_type IN ('lore', 'location_lore', 'container_lore')
                  AND (campaign_id IS NULL OR campaign_id = '')
                """,
                (world_id,),
            ).fetchall()
            existing_lore_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }

            base_locations = [loc for loc in payload.locations if not loc.created_at_turn_id]
            if not base_locations:
                base_locations = orig.locations
            base_edges = [edge for edge in payload.edges if not edge.created_at_turn_id]
            sorted_containers = sorted(
                payload.containers,
                key=lambda c: c.depth,
                reverse=True,
            )

            has_start = any(loc.is_starting_location for loc in base_locations)
            reuse_ids = campaigns_using == 0
            effective_unsupported = sanitize_world_unsupported_fields(
                orig.unsupported_fields if payload.unsupported_fields is None else payload.unsupported_fields,
                strict=True,
            )
            unsupported_json = json.dumps(effective_unsupported)

            if reuse_ids:
                # In-place update (zero active campaigns reference this world)
                target_world_id = world_id
                conn.execute(
                    "UPDATE worlds SET name = ?, global_rules_json = ?, unsupported_fields_json = ? WHERE id = ?",
                    (payload.name, payload.global_rules.model_dump_json(), unsupported_json, target_world_id),
                )
                conn.execute(
                    "DELETE FROM location_edges WHERE world_id = ? AND created_at_turn_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM location_nodes WHERE world_id = ? AND created_at_turn_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM lore_nodes WHERE world_id = ? AND campaign_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM location_containers WHERE world_id = ?",
                    (target_world_id,),
                )
                conn.execute(
                    """
                    DELETE FROM vector_entries
                    WHERE world_id = ?
                      AND source_type IN ('lore', 'location_lore', 'container_lore')
                      AND (campaign_id IS NULL OR campaign_id = '')
                    """,
                    (target_world_id,),
                )
            else:
                # Silent Copy-on-Write fork: freeze old world for running campaigns & mark pending_deletion = 1
                conn.execute(
                    "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                    (world_id,),
                )
                target_world_id = f"world_{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO worlds (id, owner_id, name, global_rules_json, unsupported_fields_json, pending_deletion, created_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        target_world_id,
                        effective_owner_id,
                        payload.name,
                        payload.global_rules.model_dump_json(),
                        unsupported_json,
                        now,
                    ),
                )

            existing_taken_cont_ids = {
                r["id"] for r in conn.execute("SELECT id FROM location_containers").fetchall()
            }
            valid_image_media_ids = {
                r["media_id"]
                for r in conn.execute(
                    """
                    SELECT wml.media_id
                    FROM world_media_links wml
                    JOIN world_media wm ON wm.id = wml.media_id
                    WHERE wml.world_id = ? AND wm.media_type = 'image'
                    """,
                    (world_id,),
                ).fetchall()
            }
            if not reuse_ids:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO world_media_links (world_id, media_id, sort_order, created_at)
                    SELECT ?, media_id, sort_order, created_at
                    FROM world_media_links
                    WHERE world_id = ?
                    """,
                    (target_world_id, world_id),
                )

            cont_id_map: dict[str, str] = {}
            for cont in sorted_containers:
                can_reuse_cont = (
                    reuse_ids
                    and bool(cont.id)
                    and not cont.id.startswith("new_")
                    and cont.id not in existing_taken_cont_ids
                )
                new_cont_id = cont.id if can_reuse_cont else f"cont_{uuid.uuid4().hex[:10]}"
                existing_taken_cont_ids.add(new_cont_id)
                cont_id_map[cont.id] = new_cont_id
                mapped_parent_id = (
                    cont_id_map.get(cont.parent_container_id)
                    if cont.parent_container_id
                    else None
                )
                cont_media_id = (
                    cont.image_media_id
                    if cont.image_media_id and cont.image_media_id in valid_image_media_ids
                    else None
                )
                conn.execute(
                    """
                    INSERT INTO location_containers (
                        id, world_id, created_at_turn_id, parent_container_id, depth, name,
                        description, environmental_tags_json, ui_x, ui_y, icon, image_media_id, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_cont_id,
                        target_world_id,
                        cont.created_at_turn_id if can_reuse_cont else None,
                        mapped_parent_id,
                        cont.depth,
                        cont.name,
                        cont.description,
                        json.dumps(cont.environmental_tags),
                        cont.ui_x,
                        cont.ui_y,
                        cont.icon,
                        cont_media_id,
                        now,
                    ),
                )

            existing_taken_loc_ids = {
                r["id"] for r in conn.execute("SELECT id FROM location_nodes").fetchall()
            }
            loc_id_map: dict[str, str] = {}
            for idx, loc in enumerate(base_locations):
                can_reuse_loc = (
                    reuse_ids
                    and bool(loc.id)
                    and not loc.id.startswith("new_")
                    and loc.id not in existing_taken_loc_ids
                )
                new_loc_id = loc.id if can_reuse_loc else f"loc_{uuid.uuid4().hex[:10]}"
                existing_taken_loc_ids.add(new_loc_id)
                loc_id_map[loc.id] = new_loc_id
                is_start = 1 if (loc.is_starting_location or (not has_start and idx == 0)) else 0
                is_hub = 1 if getattr(loc, "is_hub", False) else 0
                is_portal = 1 if getattr(loc, "is_entry_exit", False) else 0
                starting_msg = getattr(loc, "starting_message", "") or ""
                mapped_loc_cont = (
                    cont_id_map.get(loc.container_id) if loc.container_id else None
                )
                loc_media_id = (
                    loc.image_media_id
                    if loc.image_media_id and loc.image_media_id in valid_image_media_ids
                    else None
                )
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, superseded_at_turn_id, container_id, name, summary,
                        description, environmental_tags_json, is_starting_location, is_hub,
                        is_entry_exit, starting_message, ui_x, ui_y, icon, image_media_id
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_loc_id,
                        target_world_id,
                        mapped_loc_cont,
                        loc.name,
                        loc.summary,
                        loc.description,
                        json.dumps(loc.environmental_tags),
                        is_start,
                        is_hub,
                        is_portal,
                        starting_msg,
                        loc.ui_x,
                        loc.ui_y,
                        loc.icon,
                        loc_media_id,
                    ),
                )

            existing_taken_edge_ids = {
                r["id"] for r in conn.execute("SELECT id FROM location_edges").fetchall()
            }
            occupied_from: dict[str, set[str]] = {}
            for edge in base_edges:
                from_id = loc_id_map.get(edge.from_location_id)
                to_id = loc_id_map.get(edge.to_location_id)
                if not from_id or not to_id:
                    continue
                can_reuse_edge = (
                    reuse_ids
                    and bool(edge.id)
                    and not edge.id.startswith("new_")
                    and edge.id not in existing_taken_edge_ids
                )
                new_edge_id = edge.id if can_reuse_edge else f"edge_{uuid.uuid4().hex[:10]}"
                existing_taken_edge_ids.add(new_edge_id)
                occ = occupied_from.setdefault(from_id, set())
                cdir = pick_available_compass_direction(
                    normalize_compass_direction(edge.compass_direction, edge.direction_label),
                    occ,
                )
                occ.add(cdir)
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes, is_locked_or_hidden, created_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        new_edge_id,
                        target_world_id,
                        from_id,
                        to_id,
                        edge.direction_label,
                        cdir,
                        edge.travel_minutes,
                        1 if edge.is_locked_or_hidden else 0,
                    ),
                )

            if not reuse_ids:
                # Repoint active (non-deleted) template characters to the new world version
                conn.execute(
                    "UPDATE characters SET world_id = ? WHERE world_id = ? AND pending_deletion = 0",
                    (target_world_id, world_id),
                )
                conn.execute(
                    "UPDATE vector_entries SET world_id = ? WHERE world_id = ? AND source_type = 'character_shard'",
                    (target_world_id, world_id),
                )

            existing_taken_lore_ids = {
                r["id"] for r in conn.execute("SELECT id FROM lore_nodes").fetchall()
            }

            # Insert world-level lore nodes & vector entries (reusing existing embedding blobs when unchanged)
            artifact_id_map: dict[str, str] = {}
            valid_new_artifact_ids: set[str] = set()
            for idx, lore in enumerate(payload.lore_nodes):
                can_reuse_id = (
                    campaigns_using == 0
                    and bool(lore.id)
                    and not lore.id.startswith("new_")
                    and lore.id not in existing_taken_lore_ids
                )
                lore_id = lore.id if can_reuse_id else f"lore_{uuid.uuid4().hex[:10]}"
                existing_taken_lore_ids.add(lore_id)
                if lore.category == "artifact":
                    valid_new_artifact_ids.add(lore_id)
                    if lore.id:
                        artifact_id_map[lore.id] = lore_id
                tags_json = json.dumps(lore.entity_tags)
                conn.execute(
                    """
                    INSERT INTO lore_nodes (
                        id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                    )
                    VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)
                    """,
                    (lore_id, target_world_id, lore.title, lore.category, lore.content, tags_json),
                )
                blob_key = (lore.title, lore.content, tags_json)
                if blob_key in existing_lore_blobs:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, location_id, character_id, campaign_id,
                            anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'lore', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (
                            lore_id,
                            target_world_id,
                            lore.title,
                            lore.content,
                            tags_json,
                            existing_lore_blobs[blob_key],
                        ),
                    )
                else:
                    precomputed = (
                        lore_embeddings.get(idx)
                        if lore_embeddings and idx in lore_embeddings
                        else (
                            precomputed_embeddings.get(blob_key)
                            if precomputed_embeddings
                            else None
                        )
                    )
                    self.vector_store.upsert_entry(
                        entry_id=lore_id,
                        source_type="lore",
                        world_id=target_world_id,
                        title=lore.title,
                        content=lore.content,
                        keywords=lore.entity_tags,
                        embedding=precomputed,
                        conn=conn,
                    )

            # Remap or clean ItemInstance.lore_id on active template characters in target_world_id
            world_char_rows = conn.execute(
                "SELECT id, equipped_json, inventory_json FROM characters WHERE world_id = ? AND pending_deletion = 0",
                (target_world_id,),
            ).fetchall()
            for wc in world_char_rows:
                remapped_eq, eq_changed = _remap_character_items_for_world_update(
                    wc["equipped_json"] or "[]",
                    artifact_id_map,
                    valid_new_artifact_ids,
                )
                remapped_inv, inv_changed = _remap_character_items_for_world_update(
                    wc["inventory_json"] or "[]",
                    artifact_id_map,
                    valid_new_artifact_ids,
                )
                if eq_changed or inv_changed:
                    conn.execute(
                        "UPDATE characters SET equipped_json = ?, inventory_json = ? WHERE id = ?",
                        (remapped_eq, remapped_inv, wc["id"]),
                    )

            # Insert base location-level lore nodes & non-secret location_lore vectors
            for loc in base_locations:
                mapped_loc_id = loc_id_map.get(loc.id)
                if not mapped_loc_id:
                    continue
                for loc_lore in loc.lore_nodes:
                    can_reuse_loc_lore_id = (
                        campaigns_using == 0
                        and bool(loc_lore.id)
                        and not loc_lore.id.startswith("new_")
                        and loc_lore.id not in existing_taken_lore_ids
                    )
                    loc_lore_id = (
                        loc_lore.id
                        if can_reuse_loc_lore_id
                        else f"lore_{uuid.uuid4().hex[:10]}"
                    )
                    existing_taken_lore_ids.add(loc_lore_id)
                    loc_tags_json = json.dumps(loc_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            loc_lore_id,
                            target_world_id,
                            mapped_loc_id,
                            loc_lore.title,
                            loc_lore.category,
                            loc_lore.content,
                            loc_tags_json,
                        ),
                    )
                    if loc_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            loc.name, loc_lore.title, loc_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        blob_key = (vec_title, loc_lore.content, vec_kw_json)
                        if blob_key in existing_lore_blobs:
                            conn.execute(
                                """
                                INSERT INTO vector_entries (
                                    id, source_type, world_id, location_id, character_id, campaign_id,
                                    anchor_turn_id, title, content, keywords_json, embedding_blob
                                )
                                VALUES (?, 'location_lore', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                                """,
                                (
                                    loc_lore_id,
                                    target_world_id,
                                    mapped_loc_id,
                                    vec_title,
                                    loc_lore.content,
                                    vec_kw_json,
                                    existing_lore_blobs[blob_key],
                                ),
                            )
                        else:
                            pre_vec = (
                                precomputed_embeddings.get(blob_key)
                                if precomputed_embeddings
                                else None
                            )
                            self.vector_store.upsert_entry(
                                entry_id=loc_lore_id,
                                source_type="location_lore",
                                world_id=target_world_id,
                                location_id=mapped_loc_id,
                                title=vec_title,
                                content=loc_lore.content,
                                keywords=vec_keywords,
                                embedding=pre_vec,
                                conn=conn,
                            )

            # Insert base Level 1 container-level lore nodes & non-secret container_lore vectors
            for cont in sorted_containers:
                if cont.depth != 1:
                    continue
                mapped_cont_id = cont_id_map.get(cont.id)
                if not mapped_cont_id:
                    continue
                for cont_lore in cont.lore_nodes:
                    can_reuse_cont_lore_id = (
                        reuse_ids
                        and bool(cont_lore.id)
                        and not cont_lore.id.startswith("new_")
                        and cont_lore.id not in existing_taken_lore_ids
                    )
                    cont_lore_id = (
                        cont_lore.id
                        if can_reuse_cont_lore_id
                        else f"lore_{uuid.uuid4().hex[:10]}"
                    )
                    existing_taken_lore_ids.add(cont_lore_id)
                    cont_tags_json = json.dumps(cont_lore.entity_tags)
                    conn.execute(
                        """
                        INSERT INTO lore_nodes (
                            id, world_id, location_id, container_id, campaign_id, title, category, content, entity_tags_json
                        )
                        VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)
                        """,
                        (
                            cont_lore_id,
                            target_world_id,
                            mapped_cont_id,
                            cont_lore.title,
                            cont_lore.category,
                            cont_lore.content,
                            cont_tags_json,
                        ),
                    )
                    if cont_lore.category != "secret":
                        vec_title, vec_keywords = _location_lore_vector_fields(
                            cont.name, cont_lore.title, cont_lore.entity_tags
                        )
                        vec_kw_json = json.dumps(vec_keywords)
                        blob_key = (vec_title, cont_lore.content, vec_kw_json)
                        if blob_key in existing_lore_blobs:
                            conn.execute(
                                """
                                INSERT INTO vector_entries (
                                    id, source_type, world_id, location_id, container_id, character_id, campaign_id,
                                    anchor_turn_id, title, content, keywords_json, embedding_blob
                                )
                                VALUES (?, 'container_lore', ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                                """,
                                (
                                    cont_lore_id,
                                    target_world_id,
                                    mapped_cont_id,
                                    vec_title,
                                    cont_lore.content,
                                    vec_kw_json,
                                    existing_lore_blobs[blob_key],
                                ),
                            )
                        else:
                            pre_vec = (
                                precomputed_embeddings.get(blob_key)
                                if precomputed_embeddings
                                else None
                            )
                            self.vector_store.upsert_entry(
                                entry_id=cont_lore_id,
                                source_type="container_lore",
                                world_id=target_world_id,
                                container_id=mapped_cont_id,
                                title=vec_title,
                                content=cont_lore.content,
                                keywords=vec_keywords,
                                embedding=pre_vec,
                                conn=conn,
                            )

            conn.commit()
        finally:
            conn.close()

        return self.get_world(target_world_id, base_only=True)

    async def aupdate_world(
        self,
        world_id: str,
        payload: WorldUpdatePayload,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Asynchronously pre-compute embeddings strictly for uncached world, location, and container lore."""
        # Validate world existence & ownership first before incurring embedding I/O
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        try:
            vec_rows = conn.execute(
                """
                SELECT title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE world_id = ?
                  AND source_type IN ('lore', 'location_lore', 'container_lore')
                  AND (campaign_id IS NULL OR campaign_id = '')
                """,
                (world_id,),
            ).fetchall()
            existing_blobs: dict[tuple[str, str, str], bytes] = {
                (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
                for r in vec_rows
            }
        finally:
            conn.close()

        items_to_embed: list[tuple[tuple[str, str, str], str]] = []
        for lore in payload.lore_nodes:
            tags_json = json.dumps(lore.entity_tags)
            items_to_embed.append(
                (
                    (lore.title, lore.content, tags_json),
                    combine_entry_text(lore.title, lore.content, lore.entity_tags),
                )
            )

        base_locations = [loc for loc in payload.locations if not loc.created_at_turn_id]
        if not base_locations:
            base_locations = orig.locations
        for loc in base_locations:
            for loc_lore in loc.lore_nodes:
                if loc_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    loc.name, loc_lore.title, loc_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, loc_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, loc_lore.content, vec_keywords),
                    )
                )

        for cont in payload.containers:
            if cont.depth != 1:
                continue
            for cont_lore in cont.lore_nodes:
                if cont_lore.category == "secret":
                    continue
                vec_title, vec_keywords = _location_lore_vector_fields(
                    cont.name, cont_lore.title, cont_lore.entity_tags
                )
                vec_kw_json = json.dumps(vec_keywords)
                items_to_embed.append(
                    (
                        (vec_title, cont_lore.content, vec_kw_json),
                        combine_entry_text(vec_title, cont_lore.content, vec_keywords),
                    )
                )

        precomputed = await _compute_missing_embeddings(items_to_embed, existing_blobs)
        return self.update_world(
            world_id,
            payload,
            owner_id=owner_id,
            precomputed_embeddings=precomputed,
        )

    def mark_world_pending_deletion(
        self, world_id: str, owner_id: str | None = None
    ) -> dict[str, int | str | bool]:
        """Soft-delete a world by marking pending_deletion = 1 and counting campaigns using it."""
        conn = self._connect()
        try:
            if owner_id is not None:
                row = conn.execute(
                    "SELECT id FROM worlds WHERE id = ? AND owner_id = ?",
                    (world_id, owner_id),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT id FROM worlds WHERE id = ?", (world_id,)
                ).fetchone()
            if not row:
                raise KeyError(f"World '{world_id}' not found")

            conn.execute(
                "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                (world_id,),
            )
            usage_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0
            conn.commit()
        finally:
            conn.close()

        return {
            "world_id": world_id,
            "pending_deletion": True,
            "campaigns_using": campaigns_using,
        }

    def prune_pending_deletion_worlds(self) -> list[str]:
        """Hard-delete worlds marked pending_deletion = 1 that are no longer referenced by any campaign."""
        conn = self._connect()
        pruned_ids: list[str] = []
        try:
            rows = conn.execute(
                """
                SELECT w.id
                FROM worlds w
                WHERE w.pending_deletion = 1
                  AND NOT EXISTS (
                      SELECT 1 FROM campaigns camp WHERE camp.world_id = w.id
                  )
                """
            ).fetchall()

            for r in rows:
                w_id = r["id"]
                # Delete world, location & container lore vectors; preserve character backstory shards by detaching world_id
                conn.execute(
                    "DELETE FROM vector_entries WHERE world_id = ? AND source_type IN ('lore', 'location_lore', 'container_lore')",
                    (w_id,),
                )
                conn.execute(
                    "UPDATE vector_entries SET world_id = NULL WHERE world_id = ? AND source_type = 'character_shard'",
                    (w_id,),
                )
                conn.execute("DELETE FROM worlds WHERE id = ?", (w_id,))
                pruned_ids.append(w_id)

            orphan_media_rows = []
            if pruned_ids:
                orphan_media_rows = conn.execute(
                    """
                    SELECT wm.id, wm.media_type, wm.filename
                    FROM world_media wm
                    WHERE NOT EXISTS (
                        SELECT 1 FROM world_media_links wml WHERE wml.media_id = wm.id
                    )
                    """
                ).fetchall()
                for mr in orphan_media_rows:
                    conn.execute("DELETE FROM world_media WHERE id = ?", (mr["id"],))
                conn.commit()
        finally:
            conn.close()

        for mr in orphan_media_rows:
            self._delete_world_media_file(mr["media_type"], mr["filename"])

        return pruned_ids

    def _resolve_world_media_items(
        self, conn: sqlite3.Connection, world_id: str
    ) -> list[WorldMediaItem]:
        """Return ordered WorldMediaItems linked to world_id whose files exist on disk."""
        rows = conn.execute(
            """
            SELECT wm.id, wm.media_type, wm.filename, wm.label, wm.mime_type,
                   wm.byte_size, wm.created_at, wml.sort_order
            FROM world_media_links wml
            JOIN world_media wm ON wm.id = wml.media_id
            WHERE wml.world_id = ?
            ORDER BY wml.sort_order ASC, wm.created_at ASC
            """,
            (world_id,),
        ).fetchall()
        items: list[WorldMediaItem] = []
        for r in rows:
            m_type = r["media_type"]
            fname = r["filename"]
            if not self._world_media_file_exists(m_type, fname):
                continue
            items.append(
                WorldMediaItem(
                    id=r["id"],
                    media_type=m_type,
                    url=build_world_media_url(m_type, fname),
                    label=r["label"] or "",
                    mime_type=r["mime_type"] or "image/webp",
                    byte_size=int(r["byte_size"] or 0),
                    sort_order=int(r["sort_order"] or 0),
                    created_at=r["created_at"] or "",
                )
            )
        return items

    @staticmethod
    def _hydrate_entities_media(
        entities: list[Any],
        media_by_id: dict[str, WorldMediaItem],
    ) -> None:
        """Populate image_url/image_label on containers or locations, clearing missing media refs."""
        for ent in entities:
            mid = getattr(ent, "image_media_id", None)
            if not mid:
                ent.image_url = None
                ent.image_label = None
                continue
            item = media_by_id.get(mid)
            if item is None or item.media_type != "image":
                ent.image_media_id = None
                ent.image_url = None
                ent.image_label = None
                continue
            ent.image_url = item.url
            ent.image_label = item.label

    def _ensure_writable_world_id(
        self, world_id: str, owner_id: str | None = None
    ) -> str:
        """Return world_id if unused by campaigns, or CoW-fork first so running campaigns stay isolated."""
        orig = self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        try:
            usage_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            campaigns_using = int(usage_row["cnt"]) if usage_row else 0
        finally:
            conn.close()
        if campaigns_using == 0:
            return world_id
        forked = self.update_world(
            world_id,
            WorldUpdatePayload(
                name=orig.name,
                global_rules=orig.global_rules,
                containers=orig.containers,
                locations=orig.locations,
                edges=orig.edges,
                lore_nodes=orig.lore_nodes,
                unsupported_fields=orig.unsupported_fields,
            ),
            owner_id=owner_id,
        )
        return forked.id

    def list_user_world_media_files(self, user_id: str) -> list[tuple[str, str]]:
        """Return deduplicated (category_dir, filename) pairs for world media owned by user_id."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT media_type, filename FROM world_media WHERE owner_id = ?",
                (user_id,),
            ).fetchall()
            return [
                ("audio" if r["media_type"] == "audio" else "images", r["filename"])
                for r in rows
            ]
        finally:
            conn.close()

    def list_active_world_media_filenames(self, category: str = "images") -> set[str]:
        """Return all persisted world media filenames for the given category directory."""
        m_type = "audio" if category == "audio" else "image"
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT filename FROM world_media WHERE media_type = ?",
                (m_type,),
            ).fetchall()
            return {r["filename"] for r in rows}
        finally:
            conn.close()

    def user_can_access_world_media(
        self, user_id: str, category: str, filename: str
    ) -> bool:
        """Return True if user_id owns the world media asset or has a world/campaign referencing it."""
        m_type = "audio" if category == "audio" else "image"
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT 1
                FROM world_media wm
                WHERE wm.media_type = ? AND wm.filename = ? AND wm.owner_id = ?
                UNION
                SELECT 1
                FROM world_media wm
                JOIN world_media_links wml ON wml.media_id = wm.id
                JOIN worlds w ON w.id = wml.world_id
                WHERE wm.media_type = ? AND wm.filename = ? AND w.owner_id = ?
                UNION
                SELECT 1
                FROM world_media wm
                JOIN world_media_links wml ON wml.media_id = wm.id
                JOIN campaigns c ON c.world_id = wml.world_id
                WHERE wm.media_type = ? AND wm.filename = ? AND c.owner_id = ?
                LIMIT 1
                """,
                (
                    m_type, filename, user_id,
                    m_type, filename, user_id,
                    m_type, filename, user_id,
                ),
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def add_world_media(
        self,
        world_id: str,
        *,
        media_id: str,
        filename: str,
        label: str,
        mime_type: str,
        byte_size: int,
        media_type: str = "image",
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Attach a newly uploaded world media asset to world_id (CoW-forking if campaigns exist)."""
        target_world_id = self._ensure_writable_world_id(world_id, owner_id=owner_id)
        now = utc_now_iso()
        clean_label = label.strip()
        conn = self._connect()
        try:
            w_row = conn.execute(
                "SELECT owner_id FROM worlds WHERE id = ?",
                (target_world_id,),
            ).fetchone()
            eff_owner_id = w_row["owner_id"] if w_row else owner_id
            max_sort_row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) AS max_s FROM world_media_links WHERE world_id = ?",
                (target_world_id,),
            ).fetchone()
            next_sort = int(max_sort_row["max_s"]) + 1 if max_sort_row else 0
            conn.execute(
                """
                INSERT INTO world_media (id, owner_id, media_type, filename, label, mime_type, byte_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    media_id,
                    eff_owner_id,
                    media_type,
                    filename,
                    clean_label,
                    mime_type,
                    int(byte_size),
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO world_media_links (world_id, media_id, sort_order, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (target_world_id, media_id, next_sort, now),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_world(target_world_id, base_only=True, owner_id=owner_id)

    def update_world_media_label(
        self,
        world_id: str,
        media_id: str,
        label: str,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Update a world media item's display label (CoW-forking if campaigns reference world_id)."""
        target_world_id = self._ensure_writable_world_id(world_id, owner_id=owner_id)
        conn = self._connect()
        try:
            link = conn.execute(
                "SELECT 1 FROM world_media_links WHERE world_id = ? AND media_id = ?",
                (target_world_id, media_id),
            ).fetchone()
            if not link:
                raise KeyError(f"Media '{media_id}' not found on world '{target_world_id}'")
            conn.execute(
                "UPDATE world_media SET label = ? WHERE id = ?",
                (label.strip(), media_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_world(target_world_id, base_only=True, owner_id=owner_id)

    def reorder_world_media(
        self,
        world_id: str,
        ordered_media_ids: list[str],
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Update sort_order of media items on world_id (CoW-forking if campaigns reference world_id)."""
        target_world_id = self._ensure_writable_world_id(world_id, owner_id=owner_id)
        conn = self._connect()
        try:
            existing_rows = conn.execute(
                """
                SELECT media_id
                FROM world_media_links
                WHERE world_id = ?
                ORDER BY sort_order ASC, created_at ASC
                """,
                (target_world_id,),
            ).fetchall()
            existing_ids = [r["media_id"] for r in existing_rows]
            existing_set = set(existing_ids)
            ordered_clean: list[str] = []
            seen: set[str] = set()
            for mid in ordered_media_ids:
                if mid in existing_set and mid not in seen:
                    seen.add(mid)
                    ordered_clean.append(mid)
            for mid in existing_ids:
                if mid not in seen:
                    seen.add(mid)
                    ordered_clean.append(mid)
            for idx, mid in enumerate(ordered_clean):
                conn.execute(
                    "UPDATE world_media_links SET sort_order = ? WHERE world_id = ? AND media_id = ?",
                    (idx, target_world_id, mid),
                )
            conn.commit()
        finally:
            conn.close()
        return self.get_world(target_world_id, base_only=True, owner_id=owner_id)

    def get_world_media_usage_summary(
        self,
        world_id: str,
        media_id: str,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        """Count all active campaigns (including sibling CoW forks) referencing media_id."""
        self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        try:
            link = conn.execute(
                "SELECT 1 FROM world_media_links WHERE world_id = ? AND media_id = ?",
                (world_id, media_id),
            ).fetchone()
            if not link:
                raise KeyError(f"Media '{media_id}' not found on world '{world_id}'")
            row = conn.execute(
                """
                SELECT COUNT(DISTINCT camp.id) AS cnt
                FROM campaigns camp
                JOIN world_media_links wml ON wml.world_id = camp.world_id
                WHERE wml.media_id = ?
                """,
                (media_id,),
            ).fetchone()
            campaigns_using = int(row["cnt"]) if row else 0
            return {
                "world_id": world_id,
                "media_id": media_id,
                "campaigns_using": campaigns_using,
            }
        finally:
            conn.close()

    def get_world_delete_impact(
        self, world_id: str, owner_id: str | None = None
    ) -> dict[str, Any]:
        """Return direct campaign count and sibling CoW-fork campaigns sharing this world's media."""
        self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        try:
            direct_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            sibling_row = conn.execute(
                """
                SELECT COUNT(DISTINCT camp.id) AS cnt
                FROM campaigns camp
                JOIN world_media_links wml_other ON wml_other.world_id = camp.world_id
                JOIN world_media_links wml_self ON wml_self.media_id = wml_other.media_id
                WHERE wml_self.world_id = ? AND camp.world_id != ?
                """,
                (world_id, world_id),
            ).fetchone()
            media_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM world_media_links WHERE world_id = ?",
                (world_id,),
            ).fetchone()
            return {
                "world_id": world_id,
                "campaigns_using": int(direct_row["cnt"]) if direct_row else 0,
                "sibling_campaigns_sharing_media": int(sibling_row["cnt"]) if sibling_row else 0,
                "media_count": int(media_row["cnt"]) if media_row else 0,
            }
        finally:
            conn.close()

    def delete_world_media(
        self,
        world_id: str,
        media_id: str,
        owner_id: str | None = None,
    ) -> WorldRecord:
        """Hard-delete a world media asset (DB row + disk file) to reclaim quota immediately."""
        self.get_world(world_id, base_only=True, owner_id=owner_id)
        conn = self._connect()
        media_type = "image"
        filename = ""
        try:
            row = conn.execute(
                """
                SELECT wm.media_type, wm.filename
                FROM world_media wm
                JOIN world_media_links wml ON wml.media_id = wm.id
                WHERE wml.world_id = ? AND wm.id = ?
                """,
                (world_id, media_id),
            ).fetchone()
            if not row:
                raise KeyError(f"Media '{media_id}' not found on world '{world_id}'")
            media_type = row["media_type"]
            filename = row["filename"]
            # Clear explicit references on location_nodes / location_containers, then remove world_media row
            conn.execute(
                "UPDATE location_nodes SET image_media_id = NULL WHERE image_media_id = ?",
                (media_id,),
            )
            conn.execute(
                "UPDATE location_containers SET image_media_id = NULL WHERE image_media_id = ?",
                (media_id,),
            )
            conn.execute("DELETE FROM world_media WHERE id = ?", (media_id,))
            conn.commit()
        finally:
            conn.close()

        if filename:
            self._delete_world_media_file(media_type, filename)

        return self.get_world(world_id, base_only=True, owner_id=owner_id)
