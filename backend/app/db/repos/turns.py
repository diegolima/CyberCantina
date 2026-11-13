"""Turn tree persistence, episodic chunks, branch checkout, and state bundles."""

from __future__ import annotations

import json
import sqlite3
import uuid
import numpy as np
from app.db.vector_store import combine_entry_text, embed_text
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    coerce_item_list,
    dump_items_json,
)
from app.schemas.persona import PersonaTurnStateSnapshot
from app.schemas.turn import (
    CampaignStateBundle,
    CharacterWhisper,
    EpisodicChunkRecord,
    PostTurnStateDelta,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.db.repos.base import (
    _parse_care_state_json,
    _dump_care_state_json,
    _dump_provenance_json,
    _merge_live_clerk_state_items,
    utc_now_iso,
)


class TurnsBranchesMixin:
    """Turn tree persistence, episodic chunks, branch checkout, and state bundles."""

    def save_turn_node(
        self,
        *,
        turn_id: str,
        campaign_id: str,
        parent_turn_id: str | None,
        depth_index: int,
        user_message: str,
        actor_id: str,
        raw_prose: str,
        cognition: CognitionBlock,
        cognitions: dict[str, CognitionBlock] | None = None,
        cognition_character_names: dict[str, str] | None = None,
        whispers: list[CharacterWhisper] | None = None,
        pre_turn: PreTurnAnalysis,
        world_snapshot: WorldStateSnapshot,
        character_state: CharacterStateSnapshot,
        recalled_items: list[RecalledMemoryItem],
        post_turn: PostTurnStateDelta | None = None,
        extra_character_states: list[CharacterStateSnapshot] | None = None,
    ) -> TurnNodeRecord:
        """Persist a new turn node + snapshots and advance campaign active_leaf_turn_id."""
        now = utc_now_iso()
        eff_cognitions = cognitions if cognitions is not None else (
            {actor_id: cognition} if actor_id != "__narrator__" and not cognition.skipped else {}
        )
        cognitions_payload = {
            "cognitions": {cid: c.model_dump() for cid, c in eff_cognitions.items()},
            "character_names": cognition_character_names or {},
        }
        whispers_payload = (
            json.dumps([w.model_dump() for w in whispers])
            if whispers
            else None
        )
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO turn_nodes (
                    id, campaign_id, parent_turn_id, depth_index, user_message,
                    actor_id, raw_prose, cognition_json, cognitions_json, whispers_json, pre_turn_json,
                    post_turn_json, recalled_items_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    campaign_id,
                    parent_turn_id,
                    depth_index,
                    user_message,
                    actor_id,
                    raw_prose,
                    cognition.model_dump_json(),
                    json.dumps(cognitions_payload),
                    whispers_payload,
                    pre_turn.model_dump_json(),
                    post_turn.model_dump_json() if post_turn else None,
                    json.dumps([item.model_dump() for item in recalled_items]),
                    now,
                ),
            )
            visited_ids = list(
                dict.fromkeys(
                    [
                        *(world_snapshot.visited_location_ids or []),
                        *(
                            [world_snapshot.active_location_id]
                            if world_snapshot.active_location_id
                            else []
                        ),
                    ]
                )
            )
            if not world_snapshot.visited_location_ids and parent_turn_id is not None:
                parent_ws = conn.execute(
                    "SELECT visited_location_ids_json FROM world_state_snapshots WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchone()
                if parent_ws and parent_ws["visited_location_ids_json"]:
                    try:
                        parent_visited = json.loads(parent_ws["visited_location_ids_json"] or "[]")
                    except Exception:
                        parent_visited = []
                    visited_ids = list(dict.fromkeys([*parent_visited, *visited_ids]))

            conn.execute(
                """
                INSERT INTO world_state_snapshots (
                    turn_id, world_timestamp, active_location_id, scene_flags_json,
                    campaign_elapsed_minutes, visited_location_ids_json
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    turn_id,
                    world_snapshot.world_timestamp,
                    world_snapshot.active_location_id,
                    json.dumps(world_snapshot.scene_flags),
                    int(world_snapshot.campaign_elapsed_minutes),
                    json.dumps(visited_ids),
                ),
            )

            states_by_char: dict[str, CharacterStateSnapshot] = {
                character_state.character_id: character_state
            }
            for st in extra_character_states or []:
                states_by_char[st.character_id] = st

            if parent_turn_id is not None:
                parent_pts = conn.execute(
                    "SELECT equipped_json, inventory_json FROM persona_turn_states WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchone()
                if parent_pts:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                        VALUES (?, ?, ?)
                        """,
                        (turn_id, parent_pts["equipped_json"], parent_pts["inventory_json"]),
                    )

                parent_cs_rows = conn.execute(
                    "SELECT * FROM character_states WHERE turn_id = ?",
                    (parent_turn_id,),
                ).fetchall()
                for pcs in parent_cs_rows:
                    cid = pcs["character_id"]
                    if cid not in states_by_char:
                        pcs_keys = pcs.keys()
                        states_by_char[cid] = CharacterStateSnapshot(
                            turn_id=turn_id,
                            character_id=cid,
                            current_location_id=pcs["current_location_id"],
                            mood_label=pcs["mood_label"],
                            valence=pcs["valence"],
                            arousal=pcs["arousal"],
                            active_want=pcs["active_want"],
                            active_plan=pcs["active_plan"],
                            relationship_notes=json.loads(pcs["relationship_notes_json"] or "{}"),
                            equipped=json.loads(pcs["equipped_json"] or "[]")
                            if "equipped_json" in pcs_keys
                            else [],
                            inventory=json.loads(pcs["inventory_json"] or "[]")
                            if "inventory_json" in pcs_keys
                            else [],
                            unlocked_persona_keys=(
                                json.loads(pcs["unlocked_persona_keys_json"] or "[]")
                                if "unlocked_persona_keys_json" in pcs_keys
                                else []
                            ),
                            persona_knowledge_provenance=(
                                json.loads(pcs["persona_knowledge_provenance_json"] or "{}")
                                if "persona_knowledge_provenance_json" in pcs_keys
                                else {}
                            ),
                            care_state=_parse_care_state_json(
                                pcs["affective_state_json"]
                                if "affective_state_json" in pcs_keys
                                else None
                            ),
                        )

            for st in states_by_char.values():
                conn.execute(
                    """
                    INSERT INTO character_states (
                        turn_id, character_id, current_location_id, mood_label,
                        valence, arousal, active_want, active_plan, relationship_notes_json,
                        equipped_json, inventory_json, unlocked_persona_keys_json,
                        persona_knowledge_provenance_json, affective_state_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        turn_id,
                        st.character_id,
                        st.current_location_id,
                        st.mood_label,
                        st.valence,
                        st.arousal,
                        st.active_want,
                        st.active_plan,
                        json.dumps(st.relationship_notes),
                        dump_items_json(st.equipped),
                        dump_items_json(st.inventory),
                        json.dumps(st.unlocked_persona_keys),
                        _dump_provenance_json(st.persona_knowledge_provenance),
                        _dump_care_state_json(st.care_state),
                    ),
                )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO campaign_characters (
                        campaign_id, character_id, joined_at_turn_id, created_at
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    (campaign_id, st.character_id, turn_id, now),
                )

            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (turn_id, campaign_id),
            )
            conn.commit()
        finally:
            conn.close()

        return self.get_turn_node(turn_id)

    def update_turn_post_clerk(
        self,
        *,
        turn_id: str,
        post_turn: PostTurnStateDelta,
        updated_world_snapshot: WorldStateSnapshot,
        updated_character_state: CharacterStateSnapshot,
        extra_character_states: list[CharacterStateSnapshot] | None = None,
        updated_persona_turn_state: PersonaTurnStateSnapshot | None = None,
    ) -> TurnNodeRecord:
        """Commit Phase 4 Post-Turn Clerk mutations (clock advance, spatial move, affect notes)."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE;")
            parent_exists = conn.execute(
                "SELECT 1 FROM turn_nodes WHERE id = ?",
                (turn_id,),
            ).fetchone()
            if not parent_exists:
                conn.rollback()
                raise KeyError(
                    f"Turn node '{turn_id}' was deleted before Phase 5 Clerk commit"
                )
            conn.execute(
                "UPDATE turn_nodes SET post_turn_json = ? WHERE id = ?",
                (post_turn.model_dump_json(), turn_id),
            )
            existing_ws = conn.execute(
                "SELECT visited_location_ids_json FROM world_state_snapshots WHERE turn_id = ?",
                (turn_id,),
            ).fetchone()
            existing_visited: list[str] = []
            if existing_ws and existing_ws["visited_location_ids_json"]:
                try:
                    existing_visited = json.loads(existing_ws["visited_location_ids_json"] or "[]")
                except Exception:
                    existing_visited = []
            merged_visited = list(
                dict.fromkeys(
                    [
                        *existing_visited,
                        *(updated_world_snapshot.visited_location_ids or []),
                        *(
                            [updated_world_snapshot.active_location_id]
                            if updated_world_snapshot.active_location_id
                            else []
                        ),
                    ]
                )
            )
            conn.execute(
                """
                UPDATE world_state_snapshots
                SET world_timestamp = ?, active_location_id = ?, scene_flags_json = ?,
                    campaign_elapsed_minutes = ?, visited_location_ids_json = ?
                WHERE turn_id = ?
                """,
                (
                    updated_world_snapshot.world_timestamp,
                    updated_world_snapshot.active_location_id,
                    json.dumps(updated_world_snapshot.scene_flags),
                    int(updated_world_snapshot.campaign_elapsed_minutes),
                    json.dumps(merged_visited),
                    turn_id,
                ),
            )
            if updated_persona_turn_state is not None:
                conn.execute(
                    """
                    INSERT INTO persona_turn_states (turn_id, equipped_json, inventory_json)
                    VALUES (?, ?, ?)
                    ON CONFLICT(turn_id) DO UPDATE SET
                        equipped_json = excluded.equipped_json,
                        inventory_json = excluded.inventory_json
                    """,
                    (
                        turn_id,
                        json.dumps([it.model_dump() for it in updated_persona_turn_state.equipped]),
                        json.dumps([it.model_dump() for it in updated_persona_turn_state.inventory]),
                    ),
                )
            for st in [updated_character_state, *(extra_character_states or [])]:
                live_row = conn.execute(
                    "SELECT equipped_json, inventory_json, affective_state_json FROM character_states WHERE turn_id = ? AND character_id = ?",
                    (turn_id, st.character_id),
                ).fetchone()
                eff_care = st.care_state
                if live_row:
                    live_eq = coerce_item_list(json.loads(live_row["equipped_json"] or "[]"))
                    live_inv = coerce_item_list(json.loads(live_row["inventory_json"] or "[]"))
                    merged_eq, merged_inv = _merge_live_clerk_state_items(
                        st.equipped, st.inventory, live_eq, live_inv
                    )
                    if eff_care is None and "affective_state_json" in live_row.keys():
                        eff_care = _parse_care_state_json(live_row["affective_state_json"])
                else:
                    merged_eq, merged_inv = list(st.equipped), list(st.inventory)

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
                    ON CONFLICT(turn_id, character_id) DO UPDATE SET
                        current_location_id = excluded.current_location_id,
                        mood_label = excluded.mood_label,
                        valence = excluded.valence,
                        arousal = excluded.arousal,
                        active_want = excluded.active_want,
                        active_plan = excluded.active_plan,
                        relationship_notes_json = excluded.relationship_notes_json,
                        equipped_json = excluded.equipped_json,
                        inventory_json = excluded.inventory_json,
                        unlocked_persona_keys_json = excluded.unlocked_persona_keys_json,
                        persona_knowledge_provenance_json = excluded.persona_knowledge_provenance_json,
                        affective_state_json = excluded.affective_state_json
                    """,
                    (
                        turn_id,
                        st.character_id,
                        st.current_location_id,
                        st.mood_label,
                        st.valence,
                        st.arousal,
                        st.active_want,
                        st.active_plan,
                        json.dumps(st.relationship_notes),
                        dump_items_json(merged_eq),
                        dump_items_json(merged_inv),
                        json.dumps(st.unlocked_persona_keys),
                        _dump_provenance_json(st.persona_knowledge_provenance),
                        _dump_care_state_json(eff_care),
                    ),
                )
            conn.commit()
        finally:
            conn.close()

        return self.get_turn_node(turn_id)

    def save_episodic_chunk(
        self,
        *,
        campaign_id: str,
        world_id: str,
        character_id: str,
        start_turn_depth: int,
        end_turn_depth: int,
        leaf_turn_id: str,
        summary_text: str,
        title: str = "",
        synopsis_text: str = "",
        keywords: list[str] | None = None,
        witness_character_ids: list[str] | None = None,
        salience_score: int = 5,
        embedding: np.ndarray | None = None,
    ) -> EpisodicChunkRecord:
        """Persist a compressed episodic summary and index it in the VectorStore with branch anchor."""
        chunk_id = f"ep_{uuid.uuid4().hex[:10]}"
        now = utc_now_iso()
        clean_title = " ".join((title or "").replace("\r", " ").replace("\n", " ").split()).strip()
        clean_synopsis = " ".join((synopsis_text or "").replace("\r", " ").replace("\n", " ").split()).strip()
        if not clean_synopsis and summary_text:
            first_sent = summary_text.strip().split(". ")[0].strip()
            if first_sent and not first_sent.endswith((".", "!", "?")):
                first_sent += "."
            clean_synopsis = first_sent[:220]
        kw_list = [k.strip() for k in (keywords or []) if isinstance(k, str) and k.strip()]
        witness_list = [w.strip() for w in (witness_character_ids or []) if isinstance(w, str) and w.strip()]
        clamped_salience = max(1, min(10, int(salience_score or 5)))
        vec_title = f"Episode Turns {start_turn_depth}-{end_turn_depth}"
        if clean_title and not clean_title.lower().startswith("episode turns"):
            vec_title = f"Episode Turns {start_turn_depth}-{end_turn_depth} — {clean_title}"

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO episodic_chunks (
                    id, campaign_id, start_turn_depth, end_turn_depth,
                    leaf_turn_id, title, synopsis_text, summary_text,
                    keywords_json, witness_character_ids_json, salience_score, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    campaign_id,
                    start_turn_depth,
                    end_turn_depth,
                    leaf_turn_id,
                    clean_title,
                    clean_synopsis,
                    summary_text,
                    json.dumps(kw_list),
                    json.dumps(witness_list),
                    clamped_salience,
                    now,
                ),
            )
            self.vector_store.upsert_entry(
                entry_id=chunk_id,
                source_type="episodic_chunk",
                world_id=world_id,
                character_id=character_id,
                campaign_id=campaign_id,
                anchor_turn_id=leaf_turn_id,
                title=vec_title,
                content=summary_text,
                keywords=kw_list,
                embedding=embedding,
                conn=conn,
            )
            conn.commit()
        finally:
            conn.close()

        return EpisodicChunkRecord(
            id=chunk_id,
            campaign_id=campaign_id,
            start_turn_depth=start_turn_depth,
            end_turn_depth=end_turn_depth,
            leaf_turn_id=leaf_turn_id,
            title=clean_title,
            synopsis_text=clean_synopsis,
            summary_text=summary_text,
            keywords=kw_list,
            witness_character_ids=witness_list,
            salience_score=clamped_salience,
            created_at=now,
        )

    async def asave_episodic_chunk(
        self,
        *,
        campaign_id: str,
        world_id: str,
        character_id: str,
        start_turn_depth: int,
        end_turn_depth: int,
        leaf_turn_id: str,
        summary_text: str,
        title: str = "",
        synopsis_text: str = "",
        keywords: list[str] | None = None,
        witness_character_ids: list[str] | None = None,
        salience_score: int = 5,
        embedding: np.ndarray | None = None,
    ) -> EpisodicChunkRecord:
        """Asynchronously compute the embedding using embed_text and persist the episodic chunk."""
        clean_title = " ".join((title or "").replace("\r", " ").replace("\n", " ").split()).strip()
        vec_title = f"Episode Turns {start_turn_depth}-{end_turn_depth}"
        if clean_title and not clean_title.lower().startswith("episode turns"):
            vec_title = f"Episode Turns {start_turn_depth}-{end_turn_depth} — {clean_title}"
        vec = (
            embedding
            if embedding is not None
            else await embed_text(combine_entry_text(vec_title, summary_text, keywords))
        )
        return self.save_episodic_chunk(
            campaign_id=campaign_id,
            world_id=world_id,
            character_id=character_id,
            start_turn_depth=start_turn_depth,
            end_turn_depth=end_turn_depth,
            leaf_turn_id=leaf_turn_id,
            summary_text=summary_text,
            title=clean_title,
            synopsis_text=synopsis_text,
            keywords=keywords,
            witness_character_ids=witness_character_ids,
            salience_score=salience_score,
            embedding=vec,
        )

    def get_branch_episodic_chunks(
        self,
        campaign_id: str,
        valid_turn_ids: set[str],
    ) -> list[EpisodicChunkRecord]:
        """Return all episodic chunks anchored to turns in the active branch ancestor chain."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT * FROM episodic_chunks
                WHERE campaign_id = ?
                ORDER BY start_turn_depth ASC, created_at ASC
                """,
                (campaign_id,),
            ).fetchall()
        finally:
            conn.close()

        chunks: list[EpisodicChunkRecord] = []
        for r in rows:
            if r["leaf_turn_id"] in valid_turn_ids:
                rkeys = r.keys()
                raw_kw = r["keywords_json"] if "keywords_json" in rkeys and r["keywords_json"] else "[]"
                raw_wit = (
                    r["witness_character_ids_json"]
                    if "witness_character_ids_json" in rkeys and r["witness_character_ids_json"]
                    else "[]"
                )
                try:
                    kw_list = [str(k) for k in json.loads(raw_kw) if k]
                except Exception:
                    kw_list = []
                try:
                    wit_list = [str(w) for w in json.loads(raw_wit) if w]
                except Exception:
                    wit_list = []
                raw_salience = r["salience_score"] if "salience_score" in rkeys and r["salience_score"] is not None else 5
                chunks.append(
                    EpisodicChunkRecord(
                        id=r["id"],
                        campaign_id=r["campaign_id"],
                        start_turn_depth=r["start_turn_depth"],
                        end_turn_depth=r["end_turn_depth"],
                        leaf_turn_id=r["leaf_turn_id"],
                        title=r["title"] if "title" in rkeys and r["title"] else "",
                        synopsis_text=r["synopsis_text"] if "synopsis_text" in rkeys and r["synopsis_text"] else "",
                        summary_text=r["summary_text"],
                        keywords=kw_list,
                        witness_character_ids=wit_list,
                        salience_score=max(1, min(10, int(raw_salience))),
                        created_at=r["created_at"],
                    )
                )
        return chunks

    def _populate_turn_character_states(
        self,
        conn: sqlite3.Connection,
        turns: list[TurnNodeRecord],
    ) -> list[TurnNodeRecord]:
        """Batch-load all character_states rows for the given turn nodes."""
        if not turns:
            return turns
        placeholders = ",".join("?" for _ in turns)
        cs_rows = conn.execute(
            f"SELECT * FROM character_states WHERE turn_id IN ({placeholders})",
            [t.id for t in turns],
        ).fetchall()
        states_by_turn: dict[str, dict[str, CharacterStateSnapshot]] = {}
        for r in cs_rows:
            tid = r["turn_id"]
            cid = r["character_id"]
            r_keys = r.keys()
            states_by_turn.setdefault(tid, {})[cid] = CharacterStateSnapshot(
                turn_id=tid,
                character_id=cid,
                current_location_id=r["current_location_id"],
                mood_label=r["mood_label"],
                valence=r["valence"],
                arousal=r["arousal"],
                active_want=r["active_want"],
                active_plan=r["active_plan"],
                relationship_notes=json.loads(r["relationship_notes_json"] or "{}"),
                equipped=json.loads(r["equipped_json"] or "[]")
                if "equipped_json" in r_keys
                else [],
                inventory=json.loads(r["inventory_json"] or "[]")
                if "inventory_json" in r_keys
                else [],
                unlocked_persona_keys=(
                    json.loads(r["unlocked_persona_keys_json"] or "[]")
                    if "unlocked_persona_keys_json" in r_keys
                    else []
                ),
                persona_knowledge_provenance=(
                    json.loads(r["persona_knowledge_provenance_json"] or "{}")
                    if "persona_knowledge_provenance_json" in r_keys
                    else {}
                ),
                care_state=_parse_care_state_json(
                    r["affective_state_json"]
                    if "affective_state_json" in r_keys
                    else None
                ),
            )
        for t in turns:
            t.character_states = states_by_turn.get(
                t.id,
                {t.character_state.character_id: t.character_state},
            )
        return turns

    def get_turn_node(self, turn_id: str) -> TurnNodeRecord:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    ws.visited_location_ids_json,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                WHERE t.id = ?
                """,
                (turn_id,),
            ).fetchone()
            if not row:
                raise KeyError(f"Turn node '{turn_id}' not found")
            node = self._row_to_turn_node(row)
            return self._populate_turn_character_states(conn, [node])[0]
        finally:
            conn.close()

    def get_branch_turn_chain(self, leaf_turn_id: str) -> list[TurnNodeRecord]:
        """Walk the conversation tree from root to leaf_turn_id using a recursive CTE."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                WITH RECURSIVE branch_path AS (
                    SELECT id, parent_turn_id, depth_index
                    FROM turn_nodes
                    WHERE id = ?
                    UNION ALL
                    SELECT t.id, t.parent_turn_id, t.depth_index
                    FROM turn_nodes t
                    JOIN branch_path bp ON t.id = bp.parent_turn_id
                )
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    ws.visited_location_ids_json,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM branch_path bp
                JOIN turn_nodes t ON t.id = bp.id
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                ORDER BY t.depth_index ASC
                """,
                (leaf_turn_id,),
            ).fetchall()
            turns = [self._row_to_turn_node(r) for r in rows]
            return self._populate_turn_character_states(conn, turns)
        finally:
            conn.close()

    def list_campaign_turn_nodes(self, campaign_id: str) -> list[TurnNodeRecord]:
        """Return all turn nodes across all branches for the Branch Tree visualizer."""
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT
                    t.*,
                    ws.world_timestamp,
                    ws.active_location_id,
                    ws.scene_flags_json,
                    ws.campaign_elapsed_minutes,
                    ws.visited_location_ids_json,
                    cs.character_id AS cs_character_id,
                    cs.current_location_id,
                    cs.mood_label,
                    cs.valence,
                    cs.arousal,
                    cs.active_want,
                    cs.active_plan,
                    cs.relationship_notes_json,
                    cs.equipped_json,
                    cs.inventory_json,
                    cs.unlocked_persona_keys_json,
                    cs.persona_knowledge_provenance_json,
                    cs.affective_state_json
                FROM turn_nodes t
                JOIN world_state_snapshots ws ON ws.turn_id = t.id
                JOIN character_states cs ON cs.turn_id = t.id AND cs.character_id = (
                    CASE WHEN t.actor_id = '__narrator__' THEN (SELECT character_id FROM campaigns WHERE id = t.campaign_id)
                    ELSE t.actor_id END
                )
                WHERE t.campaign_id = ?
                ORDER BY t.depth_index ASC, t.created_at ASC, t.rowid ASC
                """,
                (campaign_id,),
            ).fetchall()
            turns = [self._row_to_turn_node(r) for r in rows]
            return self._populate_turn_character_states(conn, turns)
        finally:
            conn.close()

    def delete_last_turn(
        self,
        campaign_id: str,
        turn_id: str | None = None,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Delete the last user message turn on the active branch, including all generated swipes and their subtrees."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise ValueError(f"Campaign '{campaign_id}' has no active turn")

        leaf_turn = self.get_turn_node(campaign.active_leaf_turn_id)
        if turn_id is not None and turn_id != leaf_turn.id:
            target_turn = self.get_turn_node(turn_id)
            if target_turn.campaign_id != campaign_id:
                raise ValueError(
                    f"Turn '{turn_id}' does not belong to campaign '{campaign_id}'"
                )
            if target_turn.parent_turn_id != leaf_turn.parent_turn_id:
                raise ValueError(
                    f"Turn '{turn_id}' is not the active last message turn of campaign '{campaign_id}'"
                )

        if leaf_turn.parent_turn_id is None or leaf_turn.depth_index == 0:
            raise ValueError("Cannot delete the root opening scene turn")

        parent_id = leaf_turn.parent_turn_id
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                WITH RECURSIVE to_delete AS (
                    SELECT id FROM turn_nodes
                    WHERE campaign_id = ? AND parent_turn_id = ?
                    UNION ALL
                    SELECT t.id FROM turn_nodes t
                    JOIN to_delete td ON t.parent_turn_id = td.id
                )
                SELECT id FROM to_delete
                """,
                (campaign_id, parent_id),
            ).fetchall()
            deleted_ids = [r["id"] for r in rows]
            if not deleted_ids:
                raise KeyError(f"No turns found to delete under parent '{parent_id}'")

            placeholders = ",".join("?" for _ in deleted_ids)

            # 1. Roll back active_leaf_turn_id to parent_id
            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (parent_id, campaign_id),
            )

            # 2. Delete vector entries anchored to any of the deleted turns
            conn.execute(
                f"DELETE FROM vector_entries WHERE campaign_id = ? AND anchor_turn_id IN ({placeholders})",
                [campaign_id, *deleted_ids],
            )

            # 3. Delete turn_nodes (cascades world_state_snapshots, character_states, episodic_chunks)
            conn.execute(
                f"DELETE FROM turn_nodes WHERE id IN ({placeholders})",
                deleted_ids,
            )

            # 4. Delete improvised spatial edges, locations, & containers created during the deleted turns, and restore superseded rows
            conn.execute(
                f"UPDATE location_edges SET superseded_at_turn_id = NULL WHERE world_id = ? AND superseded_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"UPDATE location_nodes SET superseded_at_turn_id = NULL WHERE world_id = ? AND superseded_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"DELETE FROM location_edges WHERE world_id = ? AND created_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"DELETE FROM location_nodes WHERE world_id = ? AND created_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )
            conn.execute(
                f"DELETE FROM location_containers WHERE world_id = ? AND created_at_turn_id IN ({placeholders})",
                [campaign.world_id, *deleted_ids],
            )

            # 5. Clean up campaign_characters that joined on a deleted turn and have no remaining state
            conn.execute(
                f"""
                DELETE FROM campaign_characters
                WHERE campaign_id = ?
                  AND joined_at_turn_id IN ({placeholders})
                  AND character_id != ?
                  AND NOT EXISTS (
                      SELECT 1 FROM character_states cs
                      JOIN turn_nodes t ON t.id = cs.turn_id
                      WHERE t.campaign_id = ? AND cs.character_id = campaign_characters.character_id
                  )
                """,
                [campaign_id, *deleted_ids, campaign.character_id, campaign_id],
            )

            conn.commit()
        finally:
            conn.close()

        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def checkout_turn_branch(
        self,
        campaign_id: str,
        turn_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Switch the campaign's active_leaf_turn_id to any node in the tree, rolling back state."""
        self.get_campaign(campaign_id, owner_id=owner_id)
        turn = self.get_turn_node(turn_id)
        if turn.campaign_id != campaign_id:
            raise ValueError(f"Turn '{turn_id}' does not belong to campaign '{campaign_id}'")
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
                (turn_id, campaign_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_campaign_state_bundle(campaign_id, owner_id=owner_id)

    def get_campaign_state_bundle(
        self,
        campaign_id: str,
        owner_id: str | None = None,
    ) -> CampaignStateBundle:
        """Assemble the full live state bundle for the active branch."""
        campaign = self.get_campaign(campaign_id, owner_id=owner_id)
        if not campaign.active_leaf_turn_id:
            raise RuntimeError(f"Campaign '{campaign_id}' has no root turn")

        branch_turns = self.get_branch_turn_chain(campaign.active_leaf_turn_id)
        valid_turn_ids = {t.id for t in branch_turns}
        all_turns = self.list_campaign_turn_nodes(campaign_id)
        leaf_turn = branch_turns[-1]

        world_filtered = self.get_world(
            campaign.world_id,
            valid_turn_ids=valid_turn_ids,
            campaign_id=campaign_id,
        )
        visited_set = set(leaf_turn.world_snapshot.visited_location_ids or []) | {
            leaf_turn.world_snapshot.active_location_id
        }
        loc_by_id = {loc.id: loc for loc in world_filtered.locations}
        for loc in world_filtered.locations:
            loc.is_visited = loc.id in visited_set

        active_loc = self.get_location(
            leaf_turn.world_snapshot.active_location_id,
            campaign_id=campaign_id,
        )
        if active_loc.id in loc_by_id:
            ov_active = loc_by_id[active_loc.id]
            active_loc = ov_active.model_copy(
                update={"lore_nodes": active_loc.lore_nodes, "is_visited": True}
            )
        else:
            active_loc.is_visited = True

        neighbors = self.get_neighbor_locations(
            campaign.world_id,
            active_loc.id,
            valid_turn_ids=valid_turn_ids,
            campaign_id=campaign_id,
        )
        for nb in neighbors:
            if nb.destination.id in loc_by_id:
                ov_dest = loc_by_id[nb.destination.id]
                nb.destination = ov_dest.model_copy(
                    update={"lore_nodes": nb.destination.lore_nodes}
                )
            else:
                nb.destination.is_visited = nb.destination.id in visited_set
        episodic_chunks = self.get_branch_episodic_chunks(campaign_id, valid_turn_ids)

        present_ids = [
            cid
            for cid, st in leaf_turn.character_states.items()
            if st.current_location_id == active_loc.id
        ]

        char_ids: list[str] = []
        if campaign.character_id and campaign.character_id not in char_ids:
            char_ids.append(campaign.character_id)
        for cid in campaign.participant_character_ids or []:
            if cid not in char_ids:
                char_ids.append(cid)
        for cid in leaf_turn.character_states.keys():
            if cid not in char_ids:
                char_ids.append(cid)

        char_records: dict[str, CharacterRecord] = {}
        for cid in char_ids:
            try:
                char_records[cid] = self.get_character(
                    cid, campaign_id=campaign_id, valid_turn_ids=valid_turn_ids
                )
            except KeyError:
                pass

        # Evaluate effective branch-level portal flags dynamically across active branch edges
        loc_container_by_id = {loc.id: loc.container_id for loc in world_filtered.locations}
        cross_boundary_loc_ids: set[str] = set()
        for edge in world_filtered.edges:
            if (
                edge.from_location_id in loc_container_by_id
                and edge.to_location_id in loc_container_by_id
                and loc_container_by_id[edge.from_location_id] != loc_container_by_id[edge.to_location_id]
            ):
                cross_boundary_loc_ids.add(edge.from_location_id)
                cross_boundary_loc_ids.add(edge.to_location_id)

        for loc in world_filtered.locations:
            if loc.container_id is not None and loc.id in cross_boundary_loc_ids:
                loc.is_entry_exit = True
        if active_loc.container_id is not None and active_loc.id in cross_boundary_loc_ids:
            active_loc.is_entry_exit = True
        for nb in neighbors:
            if nb.destination.container_id is not None and nb.destination.id in cross_boundary_loc_ids:
                nb.destination.is_entry_exit = True

        return CampaignStateBundle(
            campaign=campaign,
            active_branch_turns=branch_turns,
            all_turn_nodes=all_turns,
            current_world_snapshot=leaf_turn.world_snapshot,
            current_character_state=leaf_turn.character_state,
            character_states=leaf_turn.character_states,
            character_records=char_records,
            present_character_ids=present_ids,
            active_location=active_loc,
            neighbor_locations=neighbors,
            containers=world_filtered.containers,
            visible_locations=world_filtered.locations,
            visible_edges=world_filtered.edges,
            episodic_chunks=episodic_chunks,
        )

    @staticmethod
    def _row_to_turn_node(r: sqlite3.Row) -> TurnNodeRecord:
        post_json = r["post_turn_json"]
        base_cog = CognitionBlock.model_validate_json(r["cognition_json"])
        cognitions_map: dict[str, CognitionBlock] = {}
        cognition_names: dict[str, str] = {}
        if "cognitions_json" in r.keys() and r["cognitions_json"]:
            try:
                parsed_cogs = json.loads(r["cognitions_json"])
                if isinstance(parsed_cogs, dict) and "cognitions" in parsed_cogs:
                    cognitions_map = {
                        cid: CognitionBlock.model_validate(cdata)
                        for cid, cdata in parsed_cogs["cognitions"].items()
                    }
                    cognition_names = dict(parsed_cogs.get("character_names") or {})
                elif isinstance(parsed_cogs, dict):
                    cognitions_map = {
                        cid: CognitionBlock.model_validate(cdata)
                        for cid, cdata in parsed_cogs.items()
                    }
            except Exception:
                pass
        if not cognitions_map and r["actor_id"] != "__narrator__" and not base_cog.skipped:
            cognitions_map = {r["actor_id"]: base_cog}

        whispers_list: list[CharacterWhisper] = []
        if "whispers_json" in r.keys() and r["whispers_json"]:
            try:
                whispers_list = [
                    CharacterWhisper.model_validate(w)
                    for w in json.loads(r["whispers_json"])
                ]
            except Exception:
                pass

        return TurnNodeRecord(
            id=r["id"],
            campaign_id=r["campaign_id"],
            parent_turn_id=r["parent_turn_id"],
            depth_index=r["depth_index"],
            user_message=r["user_message"],
            actor_id=r["actor_id"],
            raw_prose=r["raw_prose"],
            cognition=base_cog,
            cognitions=cognitions_map,
            cognition_character_names=cognition_names,
            whispers=whispers_list,
            pre_turn=PreTurnAnalysis.model_validate_json(r["pre_turn_json"]),
            post_turn=PostTurnStateDelta.model_validate_json(post_json) if post_json else None,
            world_snapshot=WorldStateSnapshot(
                turn_id=r["id"],
                world_timestamp=r["world_timestamp"],
                active_location_id=r["active_location_id"],
                scene_flags=json.loads(r["scene_flags_json"] or "[]"),
                campaign_elapsed_minutes=(
                    int(r["campaign_elapsed_minutes"] or 0)
                    if "campaign_elapsed_minutes" in r.keys()
                    else 0
                ),
                visited_location_ids=(
                    json.loads(r["visited_location_ids_json"] or "[]")
                    if "visited_location_ids_json" in r.keys()
                    else []
                ),
            ),
            character_state=CharacterStateSnapshot(
                turn_id=r["id"],
                character_id=r["cs_character_id"],
                current_location_id=r["current_location_id"],
                mood_label=r["mood_label"],
                valence=r["valence"],
                arousal=r["arousal"],
                active_want=r["active_want"],
                active_plan=r["active_plan"],
                relationship_notes=json.loads(r["relationship_notes_json"] or "{}"),
                equipped=json.loads(r["equipped_json"] or "[]")
                if "equipped_json" in r.keys()
                else [],
                inventory=json.loads(r["inventory_json"] or "[]")
                if "inventory_json" in r.keys()
                else [],
                unlocked_persona_keys=(
                    json.loads(r["unlocked_persona_keys_json"] or "[]")
                    if "unlocked_persona_keys_json" in r.keys()
                    else []
                ),
                persona_knowledge_provenance=(
                    json.loads(r["persona_knowledge_provenance_json"] or "{}")
                    if "persona_knowledge_provenance_json" in r.keys()
                    else {}
                ),
                care_state=_parse_care_state_json(
                    r["affective_state_json"]
                    if "affective_state_json" in r.keys()
                    else None
                ),
            ),
            recalled_items=[
                RecalledMemoryItem.model_validate(item)
                for item in json.loads(r["recalled_items_json"] or "[]")
            ],
            created_at=r["created_at"],
        )
