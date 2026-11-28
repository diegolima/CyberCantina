"""Player-triggered update and dismissal operations for seeded worlds and characters."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.db.repos.base import _location_lore_vector_fields, utc_now_iso
from app.db.repository import CantinaRepository
from app.db.seed import (
    _build_yulia_halim_draft,
    _load_showcase_world_json,
    _populate_green_lie_world_rows,
    _seed_yulia_halim_for_user,
    ensure_public_showcase_media,
)
from app.db.seed_catalog import (
    SHOWCASE_CHARACTER_SEED_KEY,
    SHOWCASE_CHARACTER_SEED_VERSION,
    SHOWCASE_WORLD_SEED_KEY,
    SHOWCASE_WORLD_SEED_VERSION,
    get_seed_spec,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterUpdatePayload,
    ItemInstance,
    dump_items_json,
)
from app.schemas.seed import SeedUpdateMode
from app.schemas.world import (
    WorldGlobalRules,
    WorldRecord,
    remap_ghost_coords_dict,
)


def _resolve_unique_copy_name(
    conn: Any,
    table: str,
    owner_id: str,
    base_name: str,
    requested_name: str | None,
) -> str:
    """Resolve an explicit copy name or generate a unique '<Name> (Custom Copy [N])'."""
    if table not in ("worlds", "characters"):
        raise ValueError(f"Unsupported table '{table}'")
    cleaned_req = (requested_name or "").strip()
    if cleaned_req:
        return cleaned_req[:160]

    clean_base = (base_name or "Asset").strip() or "Asset"
    rows = conn.execute(
        f"SELECT name FROM {table} WHERE owner_id = ? AND pending_deletion = 0",
        (owner_id,),
    ).fetchall()
    existing_lower = {str(r["name"] or "").strip().lower() for r in rows}

    candidate = f"{clean_base} (Custom Copy)"
    if candidate.lower() not in existing_lower:
        return candidate
    idx = 2
    while True:
        numbered = f"{clean_base} (Custom Copy {idx})"
        if numbered.lower() not in existing_lower:
            return numbered
        idx += 1


def _load_artifact_lore_maps(
    conn: Any,
    world_id: str,
) -> tuple[dict[str, str], dict[str, str]]:
    """Return ({lore_id: title}, {title_lower: lore_id}) for world-level artifact lore."""
    rows = conn.execute(
        """
        SELECT id, title FROM lore_nodes
        WHERE world_id = ? AND location_id IS NULL AND container_id IS NULL
          AND campaign_id IS NULL AND category = 'artifact'
        ORDER BY rowid ASC
        """,
        (world_id,),
    ).fetchall()
    by_id: dict[str, str] = {}
    by_title: dict[str, str] = {}
    for r in rows:
        lid = str(r["id"])
        title = str(r["title"] or "")
        by_id[lid] = title
        key = title.strip().lower()
        if key and key not in by_title:
            by_title[key] = lid
    return by_id, by_title


def _remap_items_json_by_title(
    raw_json: str,
    old_artifact_title_by_id: dict[str, str],
    new_artifact_id_by_title: dict[str, str],
) -> tuple[str, bool]:
    """Remap ItemInstance.lore_id values by artifact title and strip broken artifact flags."""
    try:
        items_raw = json.loads(raw_json or "[]")
    except Exception:
        return raw_json, False
    if not isinstance(items_raw, list):
        return raw_json, False

    items: list[ItemInstance] = []
    changed = False
    for raw in items_raw:
        item = ItemInstance.model_validate(raw)
        if item.lore_id:
            old_title = old_artifact_title_by_id.get(item.lore_id, "").strip().lower()
            mapped_id = new_artifact_id_by_title.get(old_title) if old_title else None
            if not mapped_id:
                item_title = item.name.strip().lower()
                mapped_id = new_artifact_id_by_title.get(item_title)
            if mapped_id != item.lore_id:
                changed = True
                if mapped_id:
                    item = item.model_copy(update={"lore_id": mapped_id})
                else:
                    item = item.model_copy(
                        update={
                            "lore_id": None,
                            "flags": [f for f in item.flags if f != "artifact"],
                        }
                    )
        items.append(item)

    if not changed:
        return raw_json, False
    return dump_items_json(items), True


def _remap_characters_for_updated_world(
    conn: Any,
    char_rows: list[Any],
    target_world_id: str,
    old_artifact_title_by_id: dict[str, str],
    new_artifact_id_by_title: dict[str, str],
) -> None:
    """Re-link characters to target_world_id and remap artifact lore_ids by title."""
    for cr in char_rows:
        cid = str(cr["id"])
        conn.execute(
            "UPDATE characters SET world_id = ? WHERE id = ?",
            (target_world_id, cid),
        )
        conn.execute(
            "UPDATE vector_entries SET world_id = ? WHERE character_id = ? AND source_type = 'character_shard'",
            (target_world_id, cid),
        )
        new_eq, eq_changed = _remap_items_json_by_title(
            cr["equipped_json"] or "[]",
            old_artifact_title_by_id,
            new_artifact_id_by_title,
        )
        new_inv, inv_changed = _remap_items_json_by_title(
            cr["inventory_json"] or "[]",
            old_artifact_title_by_id,
            new_artifact_id_by_title,
        )
        if eq_changed or inv_changed:
            conn.execute(
                "UPDATE characters SET equipped_json = ?, inventory_json = ? WHERE id = ?",
                (new_eq, new_inv, cid),
            )


def _clone_world_snapshot_for_copy(
    conn: Any,
    repo: CantinaRepository,
    orig_world: WorldRecord,
    new_world_id: str,
    new_name: str,
    owner_id: str,
    now: str,
) -> dict[str, str]:
    """Clone an existing modified world into a detached standalone copy (for CoW campaign safety)."""
    vec_rows = conn.execute(
        """
        SELECT title, content, keywords_json, embedding_blob
        FROM vector_entries
        WHERE world_id = ?
          AND source_type IN ('lore', 'location_lore', 'container_lore')
          AND (campaign_id IS NULL OR campaign_id = '')
        """,
        (orig_world.id,),
    ).fetchall()
    existing_blobs: dict[tuple[str, str, str], bytes] = {
        (r["title"], r["content"], r["keywords_json"]): bytes(r["embedding_blob"])
        for r in vec_rows
    }

    conn.execute(
        """
        INSERT INTO worlds (
            id, owner_id, name, global_rules_json, unsupported_fields_json,
            seed_key, seed_version, seed_modified, dismissed_seed_version,
            pending_deletion, created_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0, ?)
        """,
        (
            new_world_id,
            owner_id,
            new_name,
            orig_world.global_rules.model_dump_json(),
            json.dumps(orig_world.unsupported_fields or {}),
            now,
        ),
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO world_media_links (world_id, media_id, sort_order, label_override, created_at)
        SELECT ?, media_id, sort_order, label_override, created_at
        FROM world_media_links
        WHERE world_id = ?
        """,
        (new_world_id, orig_world.id),
    )

    id_remap: dict[str, str] = {}
    sorted_containers = sorted(orig_world.containers, key=lambda c: c.depth, reverse=True)
    for cont in sorted_containers:
        id_remap[cont.id] = f"cont_{uuid.uuid4().hex[:10]}"
    for loc in orig_world.locations:
        id_remap[loc.id] = f"loc_{uuid.uuid4().hex[:10]}"

    for cont in sorted_containers:
        new_cid = id_remap[cont.id]
        parent_id = id_remap.get(cont.parent_container_id) if cont.parent_container_id else None
        ghost_json = json.dumps(remap_ghost_coords_dict(cont.ghost_coords or {}, id_remap))
        conn.execute(
            """
            INSERT INTO location_containers (
                id, world_id, created_at_turn_id, parent_container_id, depth, name,
                description, environmental_tags_json, ui_x, ui_y, ghost_coords_json, icon, image_media_id, created_at
            )
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_cid,
                new_world_id,
                parent_id,
                cont.depth,
                cont.name,
                cont.description,
                json.dumps(cont.environmental_tags),
                cont.ui_x,
                cont.ui_y,
                ghost_json,
                cont.icon,
                cont.image_media_id,
                now,
            ),
        )
        for c_lore in cont.lore_nodes:
            new_cl_id = f"lore_{uuid.uuid4().hex[:10]}"
            tags_json = json.dumps(c_lore.entity_tags)
            conn.execute(
                """
                INSERT INTO lore_nodes (
                    id, world_id, location_id, container_id, campaign_id,
                    title, category, content, entity_tags_json
                )
                VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    new_cl_id,
                    new_world_id,
                    new_cid,
                    c_lore.title,
                    c_lore.category,
                    c_lore.content,
                    tags_json,
                ),
            )
            if c_lore.category != "secret":
                vt, vkw = _location_lore_vector_fields(cont.name, c_lore.title, c_lore.entity_tags)
                vkw_json = json.dumps(vkw)
                blob = existing_blobs.get((vt, c_lore.content, vkw_json))
                if blob is not None:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, location_id, container_id, character_id,
                            campaign_id, anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'container_lore', ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (new_cl_id, new_world_id, new_cid, vt, c_lore.content, vkw_json, blob),
                    )
                else:
                    repo.vector_store.upsert_entry(
                        entry_id=new_cl_id,
                        source_type="container_lore",
                        world_id=new_world_id,
                        container_id=new_cid,
                        title=vt,
                        content=c_lore.content,
                        keywords=vkw,
                        conn=conn,
                    )

    for loc in orig_world.locations:
        new_lid = id_remap[loc.id]
        cont_id = id_remap.get(loc.container_id) if loc.container_id else None
        anchor_id = id_remap.get(loc.anchor_location_id) if loc.anchor_location_id else None
        if anchor_id == new_lid:
            anchor_id = None
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, superseded_at_turn_id, container_id,
                is_entry_exit, name, summary, description, environmental_tags_json,
                is_starting_location, is_hub, starting_message, ui_x, ui_y, icon,
                anchor_location_id, image_media_id
            )
            VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_lid,
                new_world_id,
                cont_id,
                1 if loc.is_entry_exit else 0,
                loc.name,
                loc.summary,
                loc.description,
                json.dumps(loc.environmental_tags),
                1 if loc.is_starting_location else 0,
                1 if loc.is_hub else 0,
                loc.starting_message,
                loc.ui_x,
                loc.ui_y,
                loc.icon,
                anchor_id,
                loc.image_media_id,
            ),
        )
        for l_lore in loc.lore_nodes:
            new_ll_id = f"lore_{uuid.uuid4().hex[:10]}"
            tags_json = json.dumps(l_lore.entity_tags)
            conn.execute(
                """
                INSERT INTO lore_nodes (
                    id, world_id, location_id, container_id, campaign_id,
                    title, category, content, entity_tags_json
                )
                VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                """,
                (
                    new_ll_id,
                    new_world_id,
                    new_lid,
                    l_lore.title,
                    l_lore.category,
                    l_lore.content,
                    tags_json,
                ),
            )
            if l_lore.category != "secret":
                vt, vkw = _location_lore_vector_fields(loc.name, l_lore.title, l_lore.entity_tags)
                vkw_json = json.dumps(vkw)
                blob = existing_blobs.get((vt, l_lore.content, vkw_json))
                if blob is not None:
                    conn.execute(
                        """
                        INSERT INTO vector_entries (
                            id, source_type, world_id, location_id, container_id, character_id,
                            campaign_id, anchor_turn_id, title, content, keywords_json, embedding_blob
                        )
                        VALUES (?, 'location_lore', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                        """,
                        (new_ll_id, new_world_id, new_lid, vt, l_lore.content, vkw_json, blob),
                    )
                else:
                    repo.vector_store.upsert_entry(
                        entry_id=new_ll_id,
                        source_type="location_lore",
                        world_id=new_world_id,
                        location_id=new_lid,
                        title=vt,
                        content=l_lore.content,
                        keywords=vkw,
                        conn=conn,
                    )

    for w_lore in orig_world.lore_nodes:
        new_wl_id = f"lore_{uuid.uuid4().hex[:10]}"
        id_remap[w_lore.id] = new_wl_id
        tags_json = json.dumps(w_lore.entity_tags)
        conn.execute(
            """
            INSERT INTO lore_nodes (
                id, world_id, location_id, container_id, campaign_id,
                title, category, content, entity_tags_json
            )
            VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
            """,
            (
                new_wl_id,
                new_world_id,
                w_lore.title,
                w_lore.category,
                w_lore.content,
                tags_json,
            ),
        )
        blob = existing_blobs.get((w_lore.title, w_lore.content, tags_json))
        if blob is not None:
            conn.execute(
                """
                INSERT INTO vector_entries (
                    id, source_type, world_id, location_id, container_id, character_id,
                    campaign_id, anchor_turn_id, title, content, keywords_json, embedding_blob
                )
                VALUES (?, 'lore', ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
                """,
                (new_wl_id, new_world_id, w_lore.title, w_lore.content, tags_json, blob),
            )
        else:
            repo.vector_store.upsert_entry(
                entry_id=new_wl_id,
                source_type="lore",
                world_id=new_world_id,
                title=w_lore.title,
                content=w_lore.content,
                keywords=w_lore.entity_tags,
                conn=conn,
            )

    for loc in orig_world.locations:
        new_lid = id_remap[loc.id]
        for p_idx, prop in enumerate(loc.props or []):
            mapped_lore_id = id_remap.get(prop.lore_id) if prop.lore_id else None
            flags = list(prop.flags) if (mapped_lore_id or "artifact" not in prop.flags) else [
                f for f in prop.flags if f != "artifact"
            ]
            conn.execute(
                """
                INSERT INTO location_props (
                    id, world_id, location_id, campaign_id,
                    name, note, flags_json, lore_id, is_hidden, sort_order
                )
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"prop_{uuid.uuid4().hex[:10]}",
                    new_world_id,
                    new_lid,
                    prop.name,
                    prop.note,
                    json.dumps(flags),
                    mapped_lore_id,
                    1 if prop.is_hidden else 0,
                    p_idx,
                ),
            )

    for edge in orig_world.edges:
        from_id = id_remap.get(edge.from_location_id)
        to_id = id_remap.get(edge.to_location_id)
        if not from_id or not to_id:
            continue
        conn.execute(
            """
            INSERT INTO location_edges (
                id, world_id, from_location_id, to_location_id,
                direction_label, compass_direction, distance_meters,
                speed_modifier, travel_mode, obstacles_json,
                is_blocked, is_secret, distance_mode, is_vertical,
                created_at_turn_id, superseded_at_turn_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            """,
            (
                f"edge_{uuid.uuid4().hex[:10]}",
                new_world_id,
                from_id,
                to_id,
                edge.direction_label,
                edge.compass_direction,
                edge.distance_meters,
                edge.speed_modifier,
                edge.travel_mode,
                json.dumps(edge.obstacles),
                1 if edge.is_blocked else 0,
                1 if edge.is_secret else 0,
                edge.distance_mode,
                1 if edge.is_vertical else 0,
            ),
        )

    return id_remap


def update_seeded_world_for_user(
    repo: CantinaRepository,
    user_id: str,
    world_id: str,
    *,
    mode: SeedUpdateMode = "replace",
    copy_name: str | None = None,
) -> tuple[WorldRecord, WorldRecord | None]:
    """Update a library seeded world ('replace' or 'copy_and_update'), preserving active campaigns via CoW."""
    media_id_map = ensure_public_showcase_media(repo)
    w_data = _load_showcase_world_json()
    rules_json = WorldGlobalRules.model_validate(w_data["global_rules"]).model_dump_json()
    now = utc_now_iso()

    conn = repo._connect()
    orphan_media_rows: list[Any] = []
    preserved_copy_id: str | None = None
    target_world_id: str
    try:
        w_row = conn.execute(
            """
            SELECT id, owner_id, name, seed_key, seed_version, seed_modified, pending_deletion
            FROM worlds
            WHERE id = ? AND owner_id = ? AND pending_deletion = 0
            """,
            (world_id, user_id),
        ).fetchone()
        if not w_row:
            raise KeyError(f"World '{world_id}' not found")

        seed_key = w_row["seed_key"]
        spec = get_seed_spec(seed_key, entity_type="world")
        if spec is None or seed_key != SHOWCASE_WORLD_SEED_KEY:
            raise ValueError("Only built-in seeded worlds can be updated.")

        is_modified = bool(w_row["seed_modified"])
        if mode == "copy_and_update" and not is_modified:
            raise ValueError("Save Copy & Update is only available for modified seeded worlds.")

        usage_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM campaigns WHERE world_id = ?",
            (world_id,),
        ).fetchone()
        active_campaigns = int(usage_row["cnt"]) if usage_row else 0

        old_artifact_by_id, _ = _load_artifact_lore_maps(conn, world_id)
        linked_chars = conn.execute(
            """
            SELECT id, seed_key, seed_modified, equipped_json, inventory_json
            FROM characters
            WHERE world_id = ? AND pending_deletion = 0
            """,
            (world_id,),
        ).fetchall()

        if mode == "replace":
            if active_campaigns == 0:
                target_world_id = world_id
                conn.execute(
                    """
                    UPDATE worlds
                    SET name = ?, global_rules_json = ?, unsupported_fields_json = '{}',
                        seed_version = ?, seed_modified = 0, dismissed_seed_version = NULL
                    WHERE id = ?
                    """,
                    (
                        str(w_data["name"]),
                        rules_json,
                        SHOWCASE_WORLD_SEED_VERSION,
                        target_world_id,
                    ),
                )
                conn.execute(
                    "DELETE FROM location_edges WHERE world_id = ? AND created_at_turn_id IS NULL",
                    (target_world_id,),
                )
                conn.execute(
                    "DELETE FROM location_props WHERE world_id = ? AND campaign_id IS NULL",
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
                    "DELETE FROM world_media_links WHERE world_id = ?",
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
                orphan_media_rows = repo.gc_unreferenced_world_assets(conn)
            else:
                conn.execute(
                    "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                    (world_id,),
                )
                target_world_id = f"world_{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO worlds (
                        id, owner_id, name, global_rules_json, unsupported_fields_json,
                        seed_key, seed_version, seed_modified, dismissed_seed_version,
                        pending_deletion, created_at
                    )
                    VALUES (?, ?, ?, ?, '{}', ?, ?, 0, NULL, 0, ?)
                    """,
                    (
                        target_world_id,
                        user_id,
                        str(w_data["name"]),
                        rules_json,
                        SHOWCASE_WORLD_SEED_KEY,
                        SHOWCASE_WORLD_SEED_VERSION,
                        now,
                    ),
                )

            _populate_green_lie_world_rows(
                conn, repo, target_world_id, media_id_map, w_data, now
            )
            _, new_artifact_by_title = _load_artifact_lore_maps(conn, target_world_id)
            _remap_characters_for_updated_world(
                conn,
                linked_chars,
                target_world_id,
                old_artifact_by_id,
                new_artifact_by_title,
            )
        else:
            # mode == "copy_and_update"
            final_copy_name = _resolve_unique_copy_name(
                conn, "worlds", user_id, str(w_row["name"]), copy_name
            )
            custom_or_edited_chars = [
                c
                for c in linked_chars
                if not c["seed_key"] or bool(c["seed_modified"])
            ]
            unmodified_seeded_chars = [
                c
                for c in linked_chars
                if c["seed_key"] and not bool(c["seed_modified"])
            ]

            if active_campaigns == 0:
                preserved_copy_id = world_id
                conn.execute(
                    """
                    UPDATE worlds
                    SET name = ?, seed_key = NULL, seed_version = NULL,
                        seed_modified = 0, dismissed_seed_version = NULL
                    WHERE id = ?
                    """,
                    (final_copy_name, preserved_copy_id),
                )
            else:
                orig_world = repo.get_world(world_id, base_only=True, owner_id=user_id)
                preserved_copy_id = f"world_{uuid.uuid4().hex[:10]}"
                _clone_world_snapshot_for_copy(
                    conn, repo, orig_world, preserved_copy_id, final_copy_name, user_id, now
                )
                conn.execute(
                    "UPDATE worlds SET pending_deletion = 1 WHERE id = ?",
                    (world_id,),
                )
                _, copy_artifact_by_title = _load_artifact_lore_maps(conn, preserved_copy_id)
                _remap_characters_for_updated_world(
                    conn,
                    custom_or_edited_chars,
                    preserved_copy_id,
                    old_artifact_by_id,
                    copy_artifact_by_title,
                )

            target_world_id = f"world_{uuid.uuid4().hex[:10]}"
            conn.execute(
                """
                INSERT INTO worlds (
                    id, owner_id, name, global_rules_json, unsupported_fields_json,
                    seed_key, seed_version, seed_modified, dismissed_seed_version,
                    pending_deletion, created_at
                )
                VALUES (?, ?, ?, ?, '{}', ?, ?, 0, NULL, 0, ?)
                """,
                (
                    target_world_id,
                    user_id,
                    str(w_data["name"]),
                    rules_json,
                    SHOWCASE_WORLD_SEED_KEY,
                    SHOWCASE_WORLD_SEED_VERSION,
                    now,
                ),
            )
            _populate_green_lie_world_rows(
                conn, repo, target_world_id, media_id_map, w_data, now
            )
            _, new_artifact_by_title = _load_artifact_lore_maps(conn, target_world_id)
            _remap_characters_for_updated_world(
                conn,
                unmodified_seeded_chars,
                target_world_id,
                old_artifact_by_id,
                new_artifact_by_title,
            )

        conn.commit()
    finally:
        conn.close()

    for mr in orphan_media_rows:
        repo._unlink_asset_file(mr)

    updated_world = repo.get_world(target_world_id, base_only=True, owner_id=user_id)
    preserved_copy = (
        repo.get_world(preserved_copy_id, base_only=True, owner_id=user_id)
        if preserved_copy_id
        else None
    )
    return updated_world, preserved_copy


def _resolve_target_world_for_seeded_char(
    conn: Any,
    user_id: str,
    preferred_world_id: str | None,
    *,
    prefer_seeded_world: bool,
) -> str | None:
    """Resolve an active world_id for an updated or freshly seeded character."""
    if prefer_seeded_world:
        seeded_row = conn.execute(
            """
            SELECT id FROM worlds
            WHERE owner_id = ? AND seed_key = ? AND pending_deletion = 0
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, SHOWCASE_WORLD_SEED_KEY),
        ).fetchone()
        if seeded_row:
            return str(seeded_row["id"])

    if preferred_world_id:
        pref_row = conn.execute(
            "SELECT id FROM worlds WHERE id = ? AND owner_id = ? AND pending_deletion = 0",
            (preferred_world_id, user_id),
        ).fetchone()
        if pref_row:
            return str(pref_row["id"])

    if not prefer_seeded_world:
        seeded_row = conn.execute(
            """
            SELECT id FROM worlds
            WHERE owner_id = ? AND seed_key = ? AND pending_deletion = 0
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, SHOWCASE_WORLD_SEED_KEY),
        ).fetchone()
        if seeded_row:
            return str(seeded_row["id"])

    return None


def update_seeded_character_for_user(
    repo: CantinaRepository,
    user_id: str,
    character_id: str,
    *,
    mode: SeedUpdateMode = "replace",
    copy_name: str | None = None,
) -> tuple[CharacterRecord, CharacterRecord | None]:
    """Update a library seeded character ('replace' or 'copy_and_update'), preserving active campaigns via CoW."""
    ensure_public_showcase_media(repo)

    conn = repo._connect()
    try:
        c_row = conn.execute(
            """
            SELECT id, owner_id, world_id, name, seed_key, seed_version, seed_modified, pending_deletion
            FROM characters
            WHERE id = ? AND owner_id = ? AND pending_deletion = 0
            """,
            (character_id, user_id),
        ).fetchone()
        if not c_row:
            raise KeyError(f"Character '{character_id}' not found")

        seed_key = c_row["seed_key"]
        spec = get_seed_spec(seed_key, entity_type="character")
        if spec is None or seed_key != SHOWCASE_CHARACTER_SEED_KEY:
            raise ValueError("Only built-in seeded characters can be updated.")

        is_modified = bool(c_row["seed_modified"])
        if mode == "copy_and_update" and not is_modified:
            raise ValueError("Save Copy & Update is only available for modified seeded characters.")

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
        active_campaigns = int(usage_row["cnt"]) if usage_row else 0

        target_world_id = _resolve_target_world_for_seeded_char(
            conn,
            user_id,
            c_row["world_id"],
            prefer_seeded_world=(mode == "copy_and_update"),
        )
        final_copy_name = (
            _resolve_unique_copy_name(conn, "characters", user_id, str(c_row["name"]), copy_name)
            if mode == "copy_and_update"
            else ""
        )
    finally:
        conn.close()

    if mode == "replace":
        draft, shard_embeddings = _build_yulia_halim_draft(repo, target_world_id, {})
        payload = CharacterUpdatePayload.model_validate(
            {
                **draft.model_dump(),
                "world_id": target_world_id,
            }
        )
        updated = repo.update_character(
            character_id,
            payload,
            shard_embeddings=shard_embeddings,
            owner_id=user_id,
        )
        conn = repo._connect()
        try:
            conn.execute(
                """
                UPDATE characters
                SET seed_key = ?, seed_version = ?, seed_modified = 0, dismissed_seed_version = NULL
                WHERE id = ?
                """,
                (SHOWCASE_CHARACTER_SEED_KEY, SHOWCASE_CHARACTER_SEED_VERSION, updated.id),
            )
            conn.commit()
        finally:
            conn.close()
        return repo.get_character(updated.id, owner_id=user_id), None

    # mode == "copy_and_update"
    orig = repo.get_character(character_id, owner_id=user_id)
    if active_campaigns == 0:
        preserved_copy_id = character_id
        conn = repo._connect()
        try:
            conn.execute(
                """
                UPDATE characters
                SET name = ?, seed_key = NULL, seed_version = NULL,
                    seed_modified = 0, dismissed_seed_version = NULL
                WHERE id = ?
                """,
                (final_copy_name, preserved_copy_id),
            )
            conn.commit()
        finally:
            conn.close()
    else:
        copy_payload = CharacterUpdatePayload.model_validate(
            {
                **orig.model_dump(
                    exclude={"id", "pending_deletion", "version", "created_at", "seed_update"}
                ),
                "name": final_copy_name,
            }
        )
        forked = repo.update_character(
            character_id,
            copy_payload,
            owner_id=user_id,
        )
        preserved_copy_id = forked.id
        conn = repo._connect()
        try:
            conn.execute(
                """
                UPDATE characters
                SET seed_key = NULL, seed_version = NULL,
                    seed_modified = 0, dismissed_seed_version = NULL
                WHERE id = ?
                """,
                (preserved_copy_id,),
            )
            conn.commit()
        finally:
            conn.close()

    new_char_id = _seed_yulia_halim_for_user(repo, user_id, target_world_id, {})
    return (
        repo.get_character(new_char_id, owner_id=user_id),
        repo.get_character(preserved_copy_id, owner_id=user_id),
    )


def dismiss_seeded_world_update(
    repo: CantinaRepository,
    user_id: str,
    world_id: str,
) -> WorldRecord:
    """Record dismissed_seed_version = latest_version on a seeded world row."""
    conn = repo._connect()
    try:
        row = conn.execute(
            """
            SELECT id, seed_key FROM worlds
            WHERE id = ? AND owner_id = ? AND pending_deletion = 0
            """,
            (world_id, user_id),
        ).fetchone()
        if not row:
            raise KeyError(f"World '{world_id}' not found")
        spec = get_seed_spec(row["seed_key"], entity_type="world")
        if spec is None:
            raise ValueError("Only built-in seeded worlds can dismiss seed updates.")
        conn.execute(
            "UPDATE worlds SET dismissed_seed_version = ? WHERE id = ?",
            (spec.latest_version, world_id),
        )
        conn.commit()
    finally:
        conn.close()
    return repo.get_world(world_id, base_only=True, owner_id=user_id)


def dismiss_seeded_character_update(
    repo: CantinaRepository,
    user_id: str,
    character_id: str,
) -> CharacterRecord:
    """Record dismissed_seed_version = latest_version on a seeded character row."""
    conn = repo._connect()
    try:
        row = conn.execute(
            """
            SELECT id, seed_key FROM characters
            WHERE id = ? AND owner_id = ? AND pending_deletion = 0
            """,
            (character_id, user_id),
        ).fetchone()
        if not row:
            raise KeyError(f"Character '{character_id}' not found")
        spec = get_seed_spec(row["seed_key"], entity_type="character")
        if spec is None:
            raise ValueError("Only built-in seeded characters can dismiss seed updates.")
        conn.execute(
            "UPDATE characters SET dismissed_seed_version = ? WHERE id = ?",
            (spec.latest_version, character_id),
        )
        conn.commit()
    finally:
        conn.close()
    return repo.get_character(character_id, owner_id=user_id)
