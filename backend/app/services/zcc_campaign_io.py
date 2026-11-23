"""Campaign export extraction, active-timeline pruning, and atomic import for .zcc v2 archives."""

from __future__ import annotations

import base64
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from app.db.repository import CantinaRepository, utc_now_iso
from app.db.vector_math import (
    combine_entry_text,
    current_embedding_fingerprint,
    embed_text_sync,
)
from app.schemas.world import normalize_lore_category
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.import_export.campaign")

SPECIAL_ACTOR_IDS = frozenset({"__solo__", "__narrator__", "__arrival__", "user"})


@dataclass
class ExtractedCampaignBundle:
    """Self-contained campaign payload plus referenced base entity IDs for .zcc v2 packaging."""

    campaign_payload: dict[str, Any]
    world_id: str
    character_ids: list[str]
    persona_id: str | None


def _compute_active_turn_chain(
    turn_rows: list[dict[str, Any]],
    active_leaf_turn_id: str | None,
) -> set[str]:
    """Walk parent_turn_id from active_leaf_turn_id back to Turn #0."""
    by_id = {str(r["id"]): r for r in turn_rows}
    if not active_leaf_turn_id or active_leaf_turn_id not in by_id:
        # Fallback: pick deepest turn if active_leaf_turn_id is missing
        if not turn_rows:
            return set()
        deepest = max(turn_rows, key=lambda r: (int(r.get("depth_index") or 0), str(r.get("created_at") or "")))
        active_leaf_turn_id = str(deepest["id"])

    chain: set[str] = set()
    curr: str | None = active_leaf_turn_id
    while curr and curr in by_id and curr not in chain:
        chain.add(curr)
        parent = by_id[curr].get("parent_turn_id")
        curr = str(parent) if parent else None
    return chain


def _topological_sort_turns(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order turn rows so every parent_turn_id appears before its children."""
    by_id = {str(t["id"]): t for t in turns}
    ordered: list[dict[str, Any]] = []
    visited: set[str] = set()

    def visit(tid: str) -> None:
        if tid in visited:
            return
        row = by_id.get(tid)
        if row is None:
            return
        parent = row.get("parent_turn_id")
        if parent and str(parent) in by_id and str(parent) != tid:
            visit(str(parent))
        if tid not in visited:
            visited.add(tid)
            ordered.append(row)

    # Sort deterministically by depth_index, created_at, id before DFS
    for t in sorted(
        turns,
        key=lambda r: (
            int(r.get("depth_index") or 0),
            str(r.get("created_at") or ""),
            str(r.get("id") or ""),
        ),
    ):
        visit(str(t["id"]))
    return ordered


def extract_campaign_export_bundle(
    repo: CantinaRepository,
    campaign_id: str,
    owner_id: str,
    *,
    timeline_scope: Literal["full", "active"] = "full",
    strip_bookmark_comments: bool = False,
    include_gm_chat: bool = False,
) -> ExtractedCampaignBundle:
    """Extract a running campaign and all branch-consistent runtime tables for .zcc v2 export."""
    campaign = repo.get_campaign(campaign_id, owner_id=owner_id)

    conn = repo._connect()
    try:
        camp_row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ? AND owner_id = ?",
            (campaign_id, owner_id),
        ).fetchone()
        if not camp_row:
            raise KeyError(f"Campaign '{campaign_id}' not found")

        all_turn_rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM turn_nodes WHERE campaign_id = ? ORDER BY depth_index ASC, created_at ASC, id ASC",
                (campaign_id,),
            ).fetchall()
        ]
        if timeline_scope == "active":
            exported_turn_ids = _compute_active_turn_chain(
                all_turn_rows, camp_row["active_leaf_turn_id"]
            )
            exported_turns = [t for t in all_turn_rows if str(t["id"]) in exported_turn_ids]
        else:
            exported_turns = all_turn_rows
            exported_turn_ids = {str(t["id"]) for t in exported_turns}

        exported_turns = _topological_sort_turns(exported_turns)
        if strip_bookmark_comments:
            for t in exported_turns:
                # Preserve is_bookmarked pin; strip only player-added user_note
                t["user_note"] = None

        # Campaign characters (filter branch-only late joiners in active mode)
        cc_rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM campaign_characters WHERE campaign_id = ? ORDER BY created_at ASC",
                (campaign_id,),
            ).fetchall()
        ]
        primary_char_id = str(camp_row["character_id"])
        filtered_cc: list[dict[str, Any]] = []
        included_char_ids: list[str] = []
        for row in cc_rows:
            cid = str(row["character_id"])
            joined_turn = row.get("joined_at_turn_id")
            if (
                timeline_scope == "active"
                and cid != primary_char_id
                and joined_turn
                and str(joined_turn) not in exported_turn_ids
            ):
                continue
            filtered_cc.append(row)
            if cid not in included_char_ids:
                included_char_ids.append(cid)
        if primary_char_id not in included_char_ids:
            included_char_ids.insert(0, primary_char_id)

        included_char_set = set(included_char_ids)

        # Campaign character memories (campaign-scoped per character)
        char_mem_rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM campaign_character_memories WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
            if str(r["character_id"]) in included_char_set
        ]

        # Per-turn state snapshots
        if exported_turn_ids:
            placeholders = ",".join("?" for _ in exported_turn_ids)
            turn_params = tuple(exported_turn_ids)

            world_snapshots = [
                dict(r)
                for r in conn.execute(
                    f"SELECT * FROM world_state_snapshots WHERE turn_id IN ({placeholders})",
                    turn_params,
                ).fetchall()
            ]
            char_states = [
                dict(r)
                for r in conn.execute(
                    f"SELECT * FROM character_states WHERE turn_id IN ({placeholders})",
                    turn_params,
                ).fetchall()
                if str(r["character_id"]) in included_char_set
            ]
            persona_turn_states = [
                dict(r)
                for r in conn.execute(
                    f"SELECT * FROM persona_turn_states WHERE turn_id IN ({placeholders})",
                    turn_params,
                ).fetchall()
            ]
            spatial_overrides = [
                dict(r)
                for r in conn.execute(
                    f"SELECT * FROM campaign_spatial_overrides WHERE campaign_id = ? AND turn_id IN ({placeholders})",
                    (campaign_id, *turn_params),
                ).fetchall()
            ]
            episodic_chunks = [
                dict(r)
                for r in conn.execute(
                    f"""
                    SELECT * FROM episodic_chunks
                    WHERE campaign_id = ? AND leaf_turn_id IN ({placeholders})
                    ORDER BY start_turn_depth ASC, created_at ASC
                    """,
                    (campaign_id, *turn_params),
                ).fetchall()
            ]

            # Improvised map deltas belonging strictly to exported_turn_ids
            world_id = str(camp_row["world_id"])
            imp_containers = [
                dict(r)
                for r in conn.execute(
                    f"""
                    SELECT * FROM location_containers
                    WHERE world_id = ? AND created_at_turn_id IN ({placeholders})
                    ORDER BY depth DESC, id ASC
                    """,
                    (world_id, *turn_params),
                ).fetchall()
            ]
            imp_locations = [
                dict(r)
                for r in conn.execute(
                    f"""
                    SELECT * FROM location_nodes
                    WHERE world_id = ? AND created_at_turn_id IN ({placeholders})
                    """,
                    (world_id, *turn_params),
                ).fetchall()
            ]
            for loc in imp_locations:
                sup = loc.get("superseded_at_turn_id")
                if sup and str(sup) not in exported_turn_ids:
                    loc["superseded_at_turn_id"] = None

            imp_edges = [
                dict(r)
                for r in conn.execute(
                    f"""
                    SELECT * FROM location_edges
                    WHERE world_id = ? AND created_at_turn_id IN ({placeholders})
                    """,
                    (world_id, *turn_params),
                ).fetchall()
            ]
            for edge in imp_edges:
                sup = edge.get("superseded_at_turn_id")
                if sup and str(sup) not in exported_turn_ids:
                    edge["superseded_at_turn_id"] = None

            # Base-world nodes/edges superseded at an exported turn
            superseded_base_locations = [
                {
                    "id": r["id"],
                    "superseded_at_turn_id": r["superseded_at_turn_id"],
                }
                for r in conn.execute(
                    f"""
                    SELECT id, superseded_at_turn_id FROM location_nodes
                    WHERE world_id = ? AND created_at_turn_id IS NULL
                      AND superseded_at_turn_id IN ({placeholders})
                    """,
                    (world_id, *turn_params),
                ).fetchall()
            ]
            superseded_base_edges = [
                {
                    "id": r["id"],
                    "superseded_at_turn_id": r["superseded_at_turn_id"],
                }
                for r in conn.execute(
                    f"""
                    SELECT id, superseded_at_turn_id FROM location_edges
                    WHERE world_id = ? AND created_at_turn_id IS NULL
                      AND superseded_at_turn_id IN ({placeholders})
                    """,
                    (world_id, *turn_params),
                ).fetchall()
            ]
        else:
            world_snapshots = []
            char_states = []
            persona_turn_states = []
            spatial_overrides = []
            episodic_chunks = []
            imp_containers = []
            imp_locations = []
            imp_edges = []
            superseded_base_locations = []
            superseded_base_edges = []

        # Campaign-scoped lore nodes, tombstones & legacy overrides
        raw_campaign_lore = conn.execute(
            "SELECT * FROM lore_nodes WHERE campaign_id = ?",
            (campaign_id,),
        ).fetchall()
        campaign_lore_nodes = [
            dict(r)
            for r in raw_campaign_lore
            if not (
                "created_at_turn_id" in r.keys()
                and r["created_at_turn_id"]
                and str(r["created_at_turn_id"]) not in exported_turn_ids
            )
        ]
        try:
            lore_tombstones = (
                [
                    dict(r)
                    for r in conn.execute(
                        f"SELECT * FROM campaign_lore_tombstones WHERE campaign_id = ? AND turn_id IN ({placeholders})",
                        (campaign_id, *exported_turn_ids),
                    ).fetchall()
                ]
                if exported_turn_ids
                else []
            )
        except Exception:
            lore_tombstones = []
        loc_lore_overrides = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM campaign_location_lore_overrides WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
        ]
        cont_lore_overrides = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM campaign_container_lore_overrides WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
        ]

        # Campaign-scoped vector entries (filtered to exported_turn_ids when anchor_turn_id is set)
        raw_vectors = conn.execute(
            "SELECT * FROM vector_entries WHERE campaign_id = ?",
            (campaign_id,),
        ).fetchall()
        exported_vectors: list[dict[str, Any]] = []
        for vr in raw_vectors:
            anchor = vr["anchor_turn_id"]
            if anchor and str(anchor) not in exported_turn_ids:
                continue
            sup = vr["superseded_at_turn_id"]
            if sup and str(sup) not in exported_turn_ids:
                sup = None
            blob = vr["embedding_blob"]
            blob_b64 = (
                base64.b64encode(bytes(blob)).decode("ascii")
                if blob is not None and len(blob) > 0
                else None
            )
            exported_vectors.append(
                {
                    "id": vr["id"],
                    "source_type": vr["source_type"],
                    "world_id": vr["world_id"],
                    "location_id": vr["location_id"],
                    "container_id": vr["container_id"],
                    "character_id": vr["character_id"],
                    "anchor_turn_id": anchor,
                    "superseded_at_turn_id": sup,
                    "title": vr["title"],
                    "content": vr["content"],
                    "keywords_json": vr["keywords_json"],
                    "embedding_blob_b64": blob_b64,
                    "embedding_fingerprint": vr["embedding_fingerprint"],
                }
            )

        gm_chat_messages: list[dict[str, Any]] = []
        if include_gm_chat:
            raw_gm = conn.execute(
                """
                SELECT id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, proposals_json, created_at
                FROM gm_chat_messages
                WHERE campaign_id = ?
                ORDER BY created_at ASC, rowid ASC
                """,
                (campaign_id,),
            ).fetchall()
            for gr in raw_gm:
                anchor = gr["anchor_turn_id"]
                if timeline_scope == "active" and anchor and str(anchor) not in exported_turn_ids:
                    continue
                gm_chat_messages.append(dict(gr))
    finally:
        conn.close()

    # Validate referenced persona existence
    persona_id = str(camp_row["persona_id"]) if camp_row["persona_id"] else None
    if persona_id:
        try:
            existing_p = repo.get_persona(persona_id, owner_id=owner_id)
            if not existing_p:
                persona_id = None
        except Exception:
            persona_id = None

    campaign_payload: dict[str, Any] = {
        "id": str(camp_row["id"]),
        "name": str(camp_row["name"]),
        "world_id": str(camp_row["world_id"]),
        "world_name": campaign.world_name,
        "character_id": primary_char_id,
        "character_name": campaign.character_name,
        "persona_id": persona_id,
        "persona_snapshot_json": camp_row["persona_snapshot_json"],
        "active_leaf_turn_id": camp_row["active_leaf_turn_id"],
        "world_settings_json": camp_row["world_settings_json"],
        "created_at": camp_row["created_at"],
        "timeline_scope": timeline_scope,
        "strip_bookmark_comments": strip_bookmark_comments,
        "campaign_characters": filtered_cc,
        "campaign_character_memories": char_mem_rows,
        "turns": exported_turns,
        "world_state_snapshots": world_snapshots,
        "character_states": char_states,
        "persona_turn_states": persona_turn_states,
        "spatial_deltas": {
            "containers": imp_containers,
            "locations": imp_locations,
            "edges": imp_edges,
            "overrides": spatial_overrides,
            "superseded_base_locations": superseded_base_locations,
            "superseded_base_edges": superseded_base_edges,
        },
        "lore_deltas": {
            "lore_nodes": campaign_lore_nodes,
            "lore_tombstones": lore_tombstones,
            "location_lore_overrides": loc_lore_overrides,
            "container_lore_overrides": cont_lore_overrides,
        },
        "episodic_chunks": episodic_chunks,
        "vector_entries": exported_vectors,
        "gm_chat_messages": gm_chat_messages,
    }

    return ExtractedCampaignBundle(
        campaign_payload=campaign_payload,
        world_id=str(camp_row["world_id"]),
        character_ids=included_char_ids,
        persona_id=persona_id,
    )


def _remap_id(val: Any, id_remap: dict[str, str]) -> Any:
    if not isinstance(val, str) or not val:
        return val
    if val in SPECIAL_ACTOR_IDS:
        return val
    return id_remap.get(val, val)


def _remap_post_turn_json(raw_json: Any, id_remap: dict[str, str]) -> Any:
    if not raw_json or not isinstance(raw_json, str):
        return raw_json
    try:
        parsed = json.loads(raw_json)
    except Exception:
        return raw_json
    if not isinstance(parsed, dict):
        return raw_json
    changed = False
    rev = parsed.get("revealed_secret_lore_ids")
    if isinstance(rev, list) and rev:
        parsed["revealed_secret_lore_ids"] = [
            str(_remap_id(str(x), id_remap)) for x in rev
        ]
        changed = True
    me = parsed.get("major_event")
    if isinstance(me, dict):
        for key in ("turn_id", "lore_node_id", "location_id"):
            if me.get(key):
                me[key] = str(_remap_id(str(me[key]), id_remap))
        if me.get("turn_id"):
            me["id"] = f"me_{me['turn_id']}"
        changed = True
    return json.dumps(parsed) if changed else raw_json


def _remap_gm_refs_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return json.dumps(parsed)
    remapped: list[Any] = []
    for item in parsed:
        if isinstance(item, dict) and item.get("id"):
            copy_item = dict(item)
            copy_item["id"] = str(_remap_id(str(item["id"]), id_remap))
            remapped.append(copy_item)
        else:
            remapped.append(item)
    return json.dumps(remapped)


def _remap_gm_proposals_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return "[]"
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return "[]"
    remapped: list[Any] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        copy_item = dict(item)
        copy_item["id"] = f"prop_{uuid.uuid4().hex[:12]}"
        if copy_item.get("replace_lore_id"):
            copy_item["replace_lore_id"] = _remap_id(str(copy_item["replace_lore_id"]), id_remap)
        if copy_item.get("saved_lore_id"):
            copy_item["saved_lore_id"] = _remap_id(str(copy_item["saved_lore_id"]), id_remap)
        draft_obj = copy_item.get("draft")
        if isinstance(draft_obj, dict) and draft_obj.get("id"):
            draft_copy = dict(draft_obj)
            draft_copy["id"] = _remap_id(str(draft_obj["id"]), id_remap)
            copy_item["draft"] = draft_copy
        dupes = copy_item.get("duplicate_matches")
        if isinstance(dupes, list):
            new_dupes: list[Any] = []
            for d in dupes:
                if isinstance(d, dict) and d.get("id"):
                    d_copy = dict(d)
                    d_copy["id"] = str(_remap_id(str(d["id"]), id_remap))
                    new_dupes.append(d_copy)
                else:
                    new_dupes.append(d)
            copy_item["duplicate_matches"] = new_dupes
        remapped.append(copy_item)
    return json.dumps(remapped)


def _remap_id_list_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return json.dumps(parsed)
    remapped = [_remap_id(item, id_remap) for item in parsed]
    return json.dumps(remapped)


def _remap_parties_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return json.dumps(parsed)
    out: list[Any] = []
    for party in parsed:
        if not isinstance(party, dict):
            out.append(party)
            continue
        p_copy = dict(party)
        if isinstance(p_copy.get("member_ids"), list):
            p_copy["member_ids"] = [_remap_id(mid, id_remap) for mid in p_copy["member_ids"]]
        if isinstance(p_copy.get("leader_id"), str):
            p_copy["leader_id"] = _remap_id(p_copy["leader_id"], id_remap)
        if isinstance(p_copy.get("location_id"), str):
            p_copy["location_id"] = _remap_id(p_copy["location_id"], id_remap)
        out.append(p_copy)
    return json.dumps(out)


def _remap_items_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return json.dumps(parsed)
    out: list[Any] = []
    for item in parsed:
        if isinstance(item, dict):
            it_copy = dict(item)
            if it_copy.get("lore_id"):
                it_copy["lore_id"] = id_remap.get(str(it_copy["lore_id"]), it_copy["lore_id"])
            out.append(it_copy)
        else:
            out.append(item)
    return json.dumps(out)


def _remap_dict_keys_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, dict):
        parsed = raw_json
    else:
        return "{}"
    if not isinstance(parsed, dict):
        return json.dumps(parsed)
    remapped = {str(_remap_id(k, id_remap)): v for k, v in parsed.items()}
    return json.dumps(remapped)


def _remap_affective_state_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, dict):
        parsed = raw_json
    else:
        return "{}"
    if not isinstance(parsed, dict):
        return json.dumps(parsed)
    out = dict(parsed)
    if isinstance(out.get("relationships"), dict):
        out["relationships"] = {
            str(_remap_id(k, id_remap)): v for k, v in out["relationships"].items()
        }
    if isinstance(out.get("edges"), dict):
        out["edges"] = {
            str(_remap_id(k, id_remap)): v for k, v in out["edges"].items()
        }
    return json.dumps(out)


def _remap_recalled_items_json(raw_json: Any, id_remap: dict[str, str]) -> str:
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, list):
        parsed = raw_json
    else:
        return "[]"
    if not isinstance(parsed, list):
        return json.dumps(parsed)
    out: list[Any] = []
    for item in parsed:
        if isinstance(item, dict):
            it_copy = dict(item)
            for key in ("id", "chunk_id", "character_id", "location_id", "container_id", "world_id", "anchor_turn_id"):
                if isinstance(it_copy.get(key), str):
                    it_copy[key] = _remap_id(it_copy[key], id_remap)
            out.append(it_copy)
        else:
            out.append(item)
    return json.dumps(out)


def _remap_cognitions_json(raw_json: Any, id_remap: dict[str, str]) -> str | None:
    if raw_json is None:
        return None
    if isinstance(raw_json, str):
        try:
            parsed = json.loads(raw_json)
        except Exception:
            return raw_json
    elif isinstance(raw_json, dict):
        parsed = raw_json
    else:
        return None
    if not isinstance(parsed, dict):
        return json.dumps(parsed)
    return json.dumps({str(_remap_id(k, id_remap)): v for k, v in parsed.items()})


def _resolve_embedding_blob(
    *,
    title: str,
    content: str,
    keywords_json: str,
    embedding_blob_b64: str | None,
    embedding_fingerprint: str | None,
    current_fp: str,
) -> tuple[bytes, str]:
    """Reuse embedding_blob when fingerprint matches; otherwise re-embed with current embedder."""
    if embedding_blob_b64 and embedding_fingerprint == current_fp:
        try:
            decoded = base64.b64decode(embedding_blob_b64.encode("ascii"), validate=True)
            if decoded and len(decoded) % 4 == 0:
                return decoded, current_fp
        except Exception:
            pass

    try:
        kws = json.loads(keywords_json) if isinstance(keywords_json, str) else []
        if not isinstance(kws, list):
            kws = []
    except Exception:
        kws = []
    combined = combine_entry_text(title, content, [str(k) for k in kws])
    vec = embed_text_sync(combined)
    return np.asarray(vec, dtype=np.float32).tobytes(), current_fp


def ingest_campaigns_atomic(
    repo: CantinaRepository,
    *,
    campaigns_data: list[dict[str, Any]],
    user_id: str,
    id_remap: dict[str, str],
    import_as_standalone: bool,
    campaign_private_world_ids: set[str],
    campaign_private_char_ids: set[str],
) -> tuple[list[str], list[str]]:
    """Atomically insert imported campaigns, turn trees, states, vectors, and pending_deletion flags."""
    imported_campaigns: list[str] = []
    errors: list[str] = []
    current_fp = current_embedding_fingerprint()
    now = utc_now_iso()

    existing_camp_names = {
        c.name.strip().lower() for c in repo.list_campaigns(owner_id=user_id)
    }

    conn = repo._connect()
    try:
        for camp in campaigns_data:
            if not isinstance(camp, dict):
                continue
            raw_name = str(camp.get("name") or "Imported Campaign").strip() or "Imported Campaign"
            final_name = raw_name
            if final_name.lower() in existing_camp_names:
                final_name = f"{raw_name} (Imported)"
            existing_camp_names.add(final_name.lower())

            old_world_id = str(camp.get("world_id") or "")
            old_char_id = str(camp.get("character_id") or "")
            new_world_id = id_remap.get(old_world_id)
            new_char_id = id_remap.get(old_char_id)
            if not new_world_id or not new_char_id:
                raise ValueError(
                    f"Campaign '{raw_name}' is missing required base world or primary character."
                )

            new_camp_id = f"camp_{uuid.uuid4().hex[:10]}"
            old_camp_id = str(camp.get("id") or "")
            if old_camp_id:
                id_remap[old_camp_id] = new_camp_id

            # Persona binding: standalone links to imported persona; campaign-private keeps persona_id = NULL
            old_persona_id = camp.get("persona_id")
            new_persona_id = (
                id_remap.get(str(old_persona_id))
                if (import_as_standalone and old_persona_id)
                else None
            )
            persona_snapshot_json = camp.get("persona_snapshot_json")
            if new_persona_id and isinstance(persona_snapshot_json, str) and persona_snapshot_json:
                try:
                    snap_obj = json.loads(persona_snapshot_json)
                    if isinstance(snap_obj, dict):
                        snap_obj["id"] = new_persona_id
                        # Sync imported persona avatar/gallery if available
                        imported_p = repo.get_persona(new_persona_id, owner_id=user_id)
                        if imported_p:
                            snap_obj["avatar_url"] = imported_p.avatar_url
                            snap_obj["gallery"] = [g.model_dump() for g in imported_p.gallery]
                        persona_snapshot_json = json.dumps(snap_obj)
                except Exception:
                    pass

            # Pre-allocate remapped IDs for all turns, episodic chunks, improvised spatial entities, and campaign lore
            raw_turns = _topological_sort_turns(
                [t for t in (camp.get("turns") or []) if isinstance(t, dict)]
            )
            for t in raw_turns:
                old_tid = str(t.get("id") or "")
                if old_tid:
                    id_remap[old_tid] = f"turn_{uuid.uuid4().hex[:10]}"

            spatial_deltas = camp.get("spatial_deltas") or {}
            imp_containers = sorted(
                [c for c in (spatial_deltas.get("containers") or []) if isinstance(c, dict)],
                key=lambda c: int(c.get("depth") or 1),
                reverse=True,
            )
            for cont in imp_containers:
                old_cid = str(cont.get("id") or "")
                if old_cid:
                    id_remap[old_cid] = f"cont_{uuid.uuid4().hex[:10]}"

            imp_locations = [
                loc for loc in (spatial_deltas.get("locations") or []) if isinstance(loc, dict)
            ]
            for loc in imp_locations:
                old_lid = str(loc.get("id") or "")
                if old_lid:
                    id_remap[old_lid] = f"loc_{uuid.uuid4().hex[:10]}"

            lore_deltas = camp.get("lore_deltas") or {}
            camp_lore_nodes = [
                ln for ln in (lore_deltas.get("lore_nodes") or []) if isinstance(ln, dict)
            ]
            for ln in camp_lore_nodes:
                old_ln_id = str(ln.get("id") or "")
                if old_ln_id:
                    id_remap[old_ln_id] = f"lore_{uuid.uuid4().hex[:10]}"

            raw_chunks = [
                ch for ch in (camp.get("episodic_chunks") or []) if isinstance(ch, dict)
            ]
            for ch in raw_chunks:
                old_ch_id = str(ch.get("id") or "")
                if old_ch_id:
                    id_remap[old_ch_id] = f"ep_{uuid.uuid4().hex[:10]}"

            old_active_leaf = camp.get("active_leaf_turn_id")
            new_active_leaf = id_remap.get(str(old_active_leaf)) if old_active_leaf else None

            world_settings_json = camp.get("world_settings_json") or '{"describe_on_first_visit": true}'
            if not isinstance(world_settings_json, str):
                world_settings_json = json.dumps(world_settings_json)

            # 1. Insert campaign row
            conn.execute(
                """
                INSERT INTO campaigns (
                    id, owner_id, name, world_id, character_id, persona_id,
                    persona_snapshot_json, active_leaf_turn_id, prompt_preset_id,
                    world_settings_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    new_camp_id,
                    user_id,
                    final_name,
                    new_world_id,
                    new_char_id,
                    new_persona_id,
                    persona_snapshot_json,
                    new_active_leaf,
                    world_settings_json,
                    str(camp.get("created_at") or now),
                ),
            )

            # 2. Insert campaign_characters
            seen_cc: set[str] = set()
            for cc in camp.get("campaign_characters") or []:
                if not isinstance(cc, dict):
                    continue
                mapped_cid = id_remap.get(str(cc.get("character_id") or ""))
                if not mapped_cid or mapped_cid in seen_cc:
                    continue
                seen_cc.add(mapped_cid)
                old_joined = cc.get("joined_at_turn_id")
                mapped_joined = id_remap.get(str(old_joined)) if old_joined else None
                conn.execute(
                    """
                    INSERT INTO campaign_characters (campaign_id, character_id, joined_at_turn_id, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (new_camp_id, mapped_cid, mapped_joined, str(cc.get("created_at") or now)),
                )
            if new_char_id not in seen_cc:
                conn.execute(
                    """
                    INSERT INTO campaign_characters (campaign_id, character_id, joined_at_turn_id, created_at)
                    VALUES (?, ?, NULL, ?)
                    """,
                    (new_camp_id, new_char_id, now),
                )

            # 3. Insert campaign_character_memories
            for mem in camp.get("campaign_character_memories") or []:
                if not isinstance(mem, dict):
                    continue
                mapped_cid = id_remap.get(str(mem.get("character_id") or ""))
                if not mapped_cid:
                    continue
                shards_json = mem.get("memory_shards_json")
                if not isinstance(shards_json, str):
                    shards_json = json.dumps(shards_json or [])
                conn.execute(
                    """
                    INSERT INTO campaign_character_memories (campaign_id, character_id, memory_shards_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (new_camp_id, mapped_cid, shards_json, str(mem.get("updated_at") or now)),
                )

            # 4. Insert turn_nodes (topologically sorted so parent_turn_id FKs succeed)
            for t in raw_turns:
                old_tid = str(t.get("id") or "")
                new_tid = id_remap[old_tid]
                old_parent = t.get("parent_turn_id")
                new_parent = id_remap.get(str(old_parent)) if old_parent else None
                mapped_actor = str(_remap_id(str(t.get("actor_id") or new_char_id), id_remap))
                recalled_json = _remap_recalled_items_json(t.get("recalled_items_json"), id_remap)
                cognitions_json = _remap_cognitions_json(t.get("cognitions_json"), id_remap)
                post_turn_json = _remap_post_turn_json(t.get("post_turn_json"), id_remap)
                conn.execute(
                    """
                    INSERT INTO turn_nodes (
                        id, campaign_id, parent_turn_id, depth_index, user_message, actor_id,
                        raw_prose, cognition_json, cognitions_json, whispers_json,
                        pre_turn_json, post_turn_json, recalled_items_json, telemetry_json,
                        is_bookmarked, user_note, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_tid,
                        new_camp_id,
                        new_parent,
                        int(t.get("depth_index") or 0),
                        str(t.get("user_message") or ""),
                        mapped_actor,
                        str(t.get("raw_prose") or ""),
                        str(t.get("cognition_json") or "{}"),
                        cognitions_json,
                        t.get("whispers_json"),
                        str(t.get("pre_turn_json") or "{}"),
                        post_turn_json,
                        recalled_json,
                        t.get("telemetry_json"),
                        1 if t.get("is_bookmarked") else 0,
                        t.get("user_note"),
                        str(t.get("created_at") or now),
                    ),
                )

            # 5. Insert improvised spatial containers, locations, edges, and base-world supersedures
            for cont in imp_containers:
                new_cont_id = id_remap[str(cont["id"])]
                old_parent_c = cont.get("parent_container_id")
                mapped_parent_c = id_remap.get(str(old_parent_c)) if old_parent_c else None
                old_ct = cont.get("created_at_turn_id")
                mapped_ct = id_remap.get(str(old_ct)) if old_ct else None
                old_img = cont.get("image_media_id")
                mapped_img = id_remap.get(str(old_img)) if old_img else None
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
                        new_world_id,
                        mapped_ct,
                        mapped_parent_c,
                        int(cont.get("depth") or 1),
                        str(cont.get("name") or "Area"),
                        str(cont.get("description") or ""),
                        str(cont.get("environmental_tags_json") or "[]"),
                        cont.get("ui_x"),
                        cont.get("ui_y"),
                        cont.get("icon"),
                        mapped_img,
                        str(cont.get("created_at") or now),
                    ),
                )

            for loc in imp_locations:
                new_loc_id = id_remap[str(loc["id"])]
                old_cont_id = loc.get("container_id")
                mapped_cont_id = id_remap.get(str(old_cont_id)) if old_cont_id else None
                old_ct = loc.get("created_at_turn_id")
                mapped_ct = id_remap.get(str(old_ct)) if old_ct else None
                old_sup = loc.get("superseded_at_turn_id")
                mapped_sup = id_remap.get(str(old_sup)) if old_sup else None
                old_img = loc.get("image_media_id")
                mapped_img = id_remap.get(str(old_img)) if old_img else None
                conn.execute(
                    """
                    INSERT INTO location_nodes (
                        id, world_id, created_at_turn_id, superseded_at_turn_id, container_id,
                        is_entry_exit, name, summary, description, environmental_tags_json,
                        is_starting_location, is_hub, starting_message, ui_x, ui_y, icon, image_media_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_loc_id,
                        new_world_id,
                        mapped_ct,
                        mapped_sup,
                        mapped_cont_id,
                        1 if loc.get("is_entry_exit") else 0,
                        str(loc.get("name") or "Location"),
                        str(loc.get("summary") or ""),
                        str(loc.get("description") or ""),
                        str(loc.get("environmental_tags_json") or "[]"),
                        1 if loc.get("is_starting_location") else 0,
                        1 if loc.get("is_hub") else 0,
                        str(loc.get("starting_message") or ""),
                        loc.get("ui_x"),
                        loc.get("ui_y"),
                        loc.get("icon"),
                        mapped_img,
                    ),
                )

            for edge in spatial_deltas.get("edges") or []:
                if not isinstance(edge, dict):
                    continue
                from_id = id_remap.get(str(edge.get("from_location_id") or ""))
                to_id = id_remap.get(str(edge.get("to_location_id") or ""))
                if not from_id or not to_id:
                    continue
                old_ct = edge.get("created_at_turn_id")
                mapped_ct = id_remap.get(str(old_ct)) if old_ct else None
                old_sup = edge.get("superseded_at_turn_id")
                mapped_sup = id_remap.get(str(old_sup)) if old_sup else None
                conn.execute(
                    """
                    INSERT INTO location_edges (
                        id, world_id, from_location_id, to_location_id,
                        direction_label, compass_direction, travel_minutes,
                        is_locked_or_hidden, created_at_turn_id, superseded_at_turn_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"edge_{uuid.uuid4().hex[:10]}",
                        new_world_id,
                        from_id,
                        to_id,
                        str(edge.get("direction_label") or "forward"),
                        edge.get("compass_direction"),
                        int(edge.get("travel_minutes") or 1),
                        1 if edge.get("is_locked_or_hidden") else 0,
                        mapped_ct,
                        mapped_sup,
                    ),
                )

            for sup_loc in spatial_deltas.get("superseded_base_locations") or []:
                if isinstance(sup_loc, dict):
                    mapped_lid = id_remap.get(str(sup_loc.get("id") or ""))
                    mapped_sup = id_remap.get(str(sup_loc.get("superseded_at_turn_id") or ""))
                    if mapped_lid and mapped_sup:
                        conn.execute(
                            "UPDATE location_nodes SET superseded_at_turn_id = ? WHERE id = ?",
                            (mapped_sup, mapped_lid),
                        )

            for sup_edge in spatial_deltas.get("superseded_base_edges") or []:
                if isinstance(sup_edge, dict):
                    mapped_eid = id_remap.get(str(sup_edge.get("id") or ""))
                    mapped_sup = id_remap.get(str(sup_edge.get("superseded_at_turn_id") or ""))
                    if mapped_eid and mapped_sup:
                        conn.execute(
                            "UPDATE location_edges SET superseded_at_turn_id = ? WHERE id = ?",
                            (mapped_sup, mapped_eid),
                        )

            for ov in spatial_deltas.get("overrides") or []:
                if not isinstance(ov, dict):
                    continue
                mapped_tid = id_remap.get(str(ov.get("turn_id") or ""))
                mapped_eid = id_remap.get(str(ov.get("entity_id") or ""))
                if not mapped_tid or not mapped_eid:
                    continue
                old_pid = ov.get("parent_id")
                mapped_pid = id_remap.get(str(old_pid)) if old_pid else None
                conn.execute(
                    """
                    INSERT INTO campaign_spatial_overrides (
                        turn_id, campaign_id, entity_type, entity_id, parent_id,
                        is_entry_exit, ui_x, ui_y, icon, metadata_override_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        mapped_tid,
                        new_camp_id,
                        str(ov.get("entity_type") or "location"),
                        mapped_eid,
                        mapped_pid,
                        ov.get("is_entry_exit"),
                        ov.get("ui_x"),
                        ov.get("ui_y"),
                        ov.get("icon"),
                        ov.get("metadata_override_json"),
                    ),
                )

            # 6. Insert campaign-scoped lore_nodes, tombstones & legacy lore overrides
            for ln in camp_lore_nodes:
                new_ln_id = id_remap[str(ln["id"])]
                old_lid = ln.get("location_id")
                old_cid = ln.get("container_id")
                mapped_lid = id_remap.get(str(old_lid)) if old_lid else None
                mapped_cid = id_remap.get(str(old_cid)) if old_cid else None
                if old_lid and not mapped_lid:
                    continue
                if old_cid and not mapped_cid:
                    continue
                is_scoped = bool(mapped_lid or mapped_cid)
                clean_cat = normalize_lore_category(
                    str(ln.get("category") or "rumor"),
                    allow_secret=is_scoped,
                    allow_artifact=not is_scoped,
                    strict=False,
                )
                old_ct = ln.get("created_at_turn_id")
                mapped_ct = id_remap.get(str(old_ct)) if old_ct else None
                old_orig = ln.get("origin_lore_id")
                mapped_orig = str(_remap_id(str(old_orig), id_remap)) if old_orig else None
                is_me = 1 if ln.get("is_major_event") else 0
                tags_json = str(ln.get("entity_tags_json") or '["lore"]')
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
                        new_ln_id,
                        new_world_id,
                        mapped_lid,
                        mapped_cid,
                        new_camp_id,
                        mapped_ct,
                        mapped_orig,
                        is_me,
                        str(ln.get("title") or "Lore"),
                        clean_cat,
                        str(ln.get("content") or "Details"),
                        tags_json,
                    ),
                )

            for tomb in lore_deltas.get("lore_tombstones") or []:
                if isinstance(tomb, dict):
                    mapped_tid = id_remap.get(str(tomb.get("turn_id") or ""))
                    raw_lore_id = str(tomb.get("lore_id") or "")
                    mapped_lore_id = str(_remap_id(raw_lore_id, id_remap)) if raw_lore_id else ""
                    if mapped_tid and mapped_lore_id:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO campaign_lore_tombstones (campaign_id, turn_id, lore_id)
                            VALUES (?, ?, ?)
                            """,
                            (new_camp_id, mapped_tid, mapped_lore_id),
                        )

            for lo in lore_deltas.get("location_lore_overrides") or []:
                if isinstance(lo, dict):
                    mapped_lid = id_remap.get(str(lo.get("location_id") or ""))
                    if mapped_lid:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO campaign_location_lore_overrides (campaign_id, location_id, updated_at)
                            VALUES (?, ?, ?)
                            """,
                            (new_camp_id, mapped_lid, str(lo.get("updated_at") or now)),
                        )

            for co in lore_deltas.get("container_lore_overrides") or []:
                if isinstance(co, dict):
                    mapped_cid = id_remap.get(str(co.get("container_id") or ""))
                    if mapped_cid:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO campaign_container_lore_overrides (campaign_id, container_id, updated_at)
                            VALUES (?, ?, ?)
                            """,
                            (new_camp_id, mapped_cid, str(co.get("updated_at") or now)),
                        )

            # 7. Insert world_state_snapshots
            for snap in camp.get("world_state_snapshots") or []:
                if not isinstance(snap, dict):
                    continue
                mapped_tid = id_remap.get(str(snap.get("turn_id") or ""))
                mapped_loc = id_remap.get(str(snap.get("active_location_id") or ""))
                if not mapped_tid or not mapped_loc:
                    continue
                conn.execute(
                    """
                    INSERT INTO world_state_snapshots (
                        turn_id, world_timestamp, active_location_id, scene_flags_json,
                        campaign_elapsed_minutes, visited_location_ids_json,
                        visited_container_ids_json, revealed_lore_ids_json, parties_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        mapped_tid,
                        str(snap.get("world_timestamp") or ""),
                        mapped_loc,
                        str(snap.get("scene_flags_json") or "[]"),
                        int(snap.get("campaign_elapsed_minutes") or 0),
                        _remap_id_list_json(snap.get("visited_location_ids_json"), id_remap),
                        _remap_id_list_json(snap.get("visited_container_ids_json"), id_remap),
                        _remap_id_list_json(snap.get("revealed_lore_ids_json") or "[]", id_remap),
                        _remap_parties_json(snap.get("parties_json"), id_remap),
                    ),
                )

            # 8. Insert character_states (preserving CARE, mood, want/plan, relationships, inventory)
            for cs in camp.get("character_states") or []:
                if not isinstance(cs, dict):
                    continue
                mapped_tid = id_remap.get(str(cs.get("turn_id") or ""))
                mapped_cid = id_remap.get(str(cs.get("character_id") or ""))
                mapped_loc = id_remap.get(str(cs.get("current_location_id") or ""))
                if not mapped_tid or not mapped_cid or not mapped_loc:
                    continue
                conn.execute(
                    """
                    INSERT INTO character_states (
                        turn_id, character_id, current_location_id, mood_label,
                        valence, arousal, active_want, active_plan,
                        relationship_notes_json, equipped_json, inventory_json,
                        unlocked_persona_keys_json, persona_knowledge_provenance_json,
                        affective_state_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        mapped_tid,
                        mapped_cid,
                        mapped_loc,
                        str(cs.get("mood_label") or "Neutral"),
                        float(cs.get("valence") or 0.0),
                        float(cs.get("arousal") or 0.4),
                        str(cs.get("active_want") or ""),
                        str(cs.get("active_plan") or ""),
                        _remap_dict_keys_json(cs.get("relationship_notes_json"), id_remap),
                        _remap_items_json(cs.get("equipped_json"), id_remap),
                        _remap_items_json(cs.get("inventory_json"), id_remap),
                        str(cs.get("unlocked_persona_keys_json") or "[]"),
                        str(cs.get("persona_knowledge_provenance_json") or "{}"),
                        _remap_affective_state_json(cs.get("affective_state_json"), id_remap),
                    ),
                )

            # 9. Insert persona_turn_states
            for pts in camp.get("persona_turn_states") or []:
                if not isinstance(pts, dict):
                    continue
                mapped_tid = id_remap.get(str(pts.get("turn_id") or ""))
                if not mapped_tid:
                    continue
                conn.execute(
                    """
                    INSERT INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                    VALUES (?, ?, ?)
                    """,
                    (
                        mapped_tid,
                        _remap_items_json(pts.get("equipped_json"), id_remap),
                        _remap_items_json(pts.get("inventory_json"), id_remap),
                    ),
                )

            # 10. Insert episodic_chunks
            for ch in raw_chunks:
                new_ch_id = id_remap[str(ch["id"])]
                mapped_leaf = id_remap.get(str(ch.get("leaf_turn_id") or ""))
                if not mapped_leaf:
                    continue
                conn.execute(
                    """
                    INSERT INTO episodic_chunks (
                        id, campaign_id, start_turn_depth, end_turn_depth, leaf_turn_id,
                        title, synopsis_text, summary_text, keywords_json,
                        witness_character_ids_json, salience_score, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_ch_id,
                        new_camp_id,
                        int(ch.get("start_turn_depth") or 0),
                        int(ch.get("end_turn_depth") or 0),
                        mapped_leaf,
                        str(ch.get("title") or ""),
                        str(ch.get("synopsis_text") or ""),
                        str(ch.get("summary_text") or ""),
                        str(ch.get("keywords_json") or "[]"),
                        _remap_id_list_json(ch.get("witness_character_ids_json"), id_remap),
                        int(ch.get("salience_score") or 5),
                        str(ch.get("created_at") or now),
                    ),
                )

            # 11. Insert campaign vector_entries (reuse matching fingerprint or re-embed)
            for ve in camp.get("vector_entries") or []:
                if not isinstance(ve, dict):
                    continue
                new_ve_id = f"vec_{uuid.uuid4().hex[:12]}"
                old_wid = ve.get("world_id")
                old_lid = ve.get("location_id")
                old_cont = ve.get("container_id")
                old_cid = ve.get("character_id")
                old_anchor = ve.get("anchor_turn_id")
                old_sup = ve.get("superseded_at_turn_id")
                title = str(ve.get("title") or "")
                content = str(ve.get("content") or "")
                keywords_json = str(ve.get("keywords_json") or "[]")
                emb_blob, emb_fp = _resolve_embedding_blob(
                    title=title,
                    content=content,
                    keywords_json=keywords_json,
                    embedding_blob_b64=ve.get("embedding_blob_b64"),
                    embedding_fingerprint=ve.get("embedding_fingerprint"),
                    current_fp=current_fp,
                )
                conn.execute(
                    """
                    INSERT INTO vector_entries (
                        id, source_type, world_id, location_id, container_id, character_id,
                        campaign_id, anchor_turn_id, superseded_at_turn_id,
                        title, content, keywords_json, embedding_blob, embedding_fingerprint
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_ve_id,
                        str(ve.get("source_type") or "episodic_chunk"),
                        id_remap.get(str(old_wid)) if old_wid else None,
                        id_remap.get(str(old_lid)) if old_lid else None,
                        id_remap.get(str(old_cont)) if old_cont else None,
                        id_remap.get(str(old_cid)) if old_cid else None,
                        new_camp_id,
                        id_remap.get(str(old_anchor)) if old_anchor else None,
                        id_remap.get(str(old_sup)) if old_sup else None,
                        title,
                        content,
                        keywords_json,
                        emb_blob,
                        emb_fp,
                    ),
                )

            # 12. Insert optional GM Talk messages (remapping anchor_turn_id & mention/source IDs)
            for gm_row in camp.get("gm_chat_messages") or []:
                if not isinstance(gm_row, dict):
                    continue
                old_anchor = gm_row.get("anchor_turn_id")
                mapped_anchor: str | None = None
                if old_anchor:
                    mapped_anchor = id_remap.get(str(old_anchor))
                    if not mapped_anchor:
                        continue
                gm_role = str(gm_row.get("role") or "")
                if gm_role not in ("user", "assistant"):
                    continue
                conn.execute(
                    """
                    INSERT INTO gm_chat_messages (
                        id, campaign_id, anchor_turn_id, role, content, mentions_json, sources_json, proposals_json, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"gm_{uuid.uuid4().hex[:12]}",
                        new_camp_id,
                        mapped_anchor,
                        gm_role,
                        str(gm_row.get("content") or ""),
                        _remap_gm_refs_json(gm_row.get("mentions_json"), id_remap),
                        _remap_gm_refs_json(gm_row.get("sources_json"), id_remap),
                        _remap_gm_proposals_json(gm_row.get("proposals_json"), id_remap),
                        str(gm_row.get("created_at") or now),
                    ),
                )

            imported_campaigns.append(final_name)

        # Atomically mark campaign-private worlds & characters as pending_deletion = 1
        # inside the same commit as the campaign rows so housekeeping can never prune them early.
        for pw_id in campaign_private_world_ids:
            conn.execute("UPDATE worlds SET pending_deletion = 1 WHERE id = ?", (pw_id,))
        for pc_id in campaign_private_char_ids:
            conn.execute("UPDATE characters SET pending_deletion = 1 WHERE id = ?", (pc_id,))

        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.exception("Failed importing campaigns: %s", sanitize_log_value(exc))
        errors.append(f"Campaign import failed: {exc}")
        # Clean up any campaign-private base entities created prior to this atomic commit
        for pc_id in campaign_private_char_ids:
            try:
                repo.mark_character_pending_deletion(pc_id, owner_id=user_id)
            except Exception:
                pass
        for pw_id in campaign_private_world_ids:
            try:
                repo.mark_world_pending_deletion(pw_id, owner_id=user_id)
            except Exception:
                pass
        try:
            repo.prune_pending_deletion_characters()
            repo.prune_pending_deletion_worlds()
        except Exception:
            pass
    finally:
        conn.close()

    return imported_campaigns, errors
