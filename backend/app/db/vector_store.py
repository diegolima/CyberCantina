"""Hybrid semantic vector store and branch-aware memory retrieval."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
import json
import sqlite3
from typing import Any

import numpy as np

from app.config import settings
from app.db.vector_math import (  # noqa: F401
    ScopedMemoryRecallBundle,
    _WORD_RE,
    _FASTEMBED_MODEL,
    _STOPWORDS,
    _tokenize,
    build_short_memory_content,
    compute_corpus_idf,
    extract_context_activations,
    mmr_select,
    fuse_rrf,
    compute_dynamic_max,
    compute_local_hash_embedding,
    current_embedding_fingerprint,
    embed_text,
    combine_entry_text,
    embed_text_sync,
)
from app.schemas.turn import RecalledMemoryItem


class VectorStore:
    """SQLite-backed hybrid vector + keyword memory store with branch-isolation."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def upsert_entry(
        self,
        *,
        entry_id: str,
        source_type: str,
        title: str,
        content: str,
        keywords: list[str] | None = None,
        world_id: str | None = None,
        location_id: str | None = None,
        container_id: str | None = None,
        character_id: str | None = None,
        campaign_id: str | None = None,
        anchor_turn_id: str | None = None,
        superseded_at_turn_id: str | None = None,
        embedding: np.ndarray | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """Insert or update a vector memory entry."""
        kw_list = keywords or []
        combined_text = combine_entry_text(title, content, kw_list)
        vec = embedding if embedding is not None else embed_text_sync(combined_text)
        blob = vec.astype(np.float32).tobytes()

        owns_conn = conn is None
        active_conn = conn or self._connect()
        try:
            active_conn.execute(
                """
                INSERT INTO vector_entries (
                    id, source_type, world_id, location_id, container_id, character_id, campaign_id,
                    anchor_turn_id, superseded_at_turn_id, title, content, keywords_json, embedding_blob,
                    embedding_fingerprint
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_type = excluded.source_type,
                    world_id = excluded.world_id,
                    location_id = excluded.location_id,
                    container_id = excluded.container_id,
                    campaign_id = excluded.campaign_id,
                    title = excluded.title,
                    content = excluded.content,
                    keywords_json = excluded.keywords_json,
                    embedding_blob = excluded.embedding_blob,
                    embedding_fingerprint = excluded.embedding_fingerprint,
                    anchor_turn_id = excluded.anchor_turn_id,
                    superseded_at_turn_id = excluded.superseded_at_turn_id
                """,
                (
                    entry_id,
                    source_type,
                    world_id,
                    location_id,
                    container_id,
                    character_id,
                    campaign_id,
                    anchor_turn_id,
                    superseded_at_turn_id,
                    title,
                    content,
                    json.dumps(kw_list),
                    blob,
                    current_embedding_fingerprint(),
                ),
            )
            if owns_conn:
                active_conn.commit()
        finally:
            if owns_conn:
                active_conn.close()

    async def aupsert_entry(
        self,
        *,
        entry_id: str,
        source_type: str,
        title: str,
        content: str,
        keywords: list[str] | None = None,
        world_id: str | None = None,
        location_id: str | None = None,
        container_id: str | None = None,
        character_id: str | None = None,
        campaign_id: str | None = None,
        anchor_turn_id: str | None = None,
        superseded_at_turn_id: str | None = None,
        embedding: np.ndarray | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """Asynchronously compute the embedding using embed_text and upsert a vector memory entry."""
        kw_list = keywords or []
        combined_text = combine_entry_text(title, content, kw_list)
        vec = embedding if embedding is not None else await embed_text(combined_text)
        self.upsert_entry(
            entry_id=entry_id,
            source_type=source_type,
            title=title,
            content=content,
            keywords=kw_list,
            world_id=world_id,
            location_id=location_id,
            container_id=container_id,
            character_id=character_id,
            campaign_id=campaign_id,
            anchor_turn_id=anchor_turn_id,
            superseded_at_turn_id=superseded_at_turn_id,
            embedding=vec,
            conn=conn,
        )

    def count_stale_entries(self) -> int:
        """Rows embedded under a fingerprint other than the active one (excludes legacy NULL rows)."""
        conn = self._connect()
        try:
            return int(
                conn.execute(
                    "SELECT COUNT(*) FROM vector_entries WHERE embedding_fingerprint IS NOT NULL AND embedding_fingerprint != ?",
                    (current_embedding_fingerprint(),),
                ).fetchone()[0]
            )
        finally:
            conn.close()

    def stamp_unstamped_entries(self) -> int:
        """One-shot migration: legacy NULL rows are assumed to belong to the active embedding space."""
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE vector_entries SET embedding_fingerprint = ? WHERE embedding_fingerprint IS NULL",
                (current_embedding_fingerprint(),),
            )
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()

    async def reindex(self, progress: "Callable[[int, int], None] | None" = None) -> int:
        """Re-embed every row not in the active embedding space. Returns the number of rows updated."""
        fingerprint = current_embedding_fingerprint()
        conn = self._connect()
        try:
            todo = conn.execute(
                """
                SELECT id, title, content, keywords_json FROM vector_entries
                WHERE embedding_fingerprint IS NULL OR embedding_fingerprint != ?
                """,
                (fingerprint,),
            ).fetchall()
        finally:
            conn.close()
        done = 0
        for row in todo:
            text = combine_entry_text(row["title"], row["content"], json.loads(row["keywords_json"] or "[]"))
            vec = await embed_text(text)
            write = self._connect()
            try:
                write.execute(
                    "UPDATE vector_entries SET embedding_blob = ?, embedding_fingerprint = ? WHERE id = ?",
                    (vec.astype(np.float32).tobytes(), fingerprint, row["id"]),
                )
                write.commit()
            finally:
                write.close()
            done += 1
            if progress is not None:
                progress(done, len(todo))
        return done

    @staticmethod
    def _load_overridden_location_ids(conn: sqlite3.Connection, campaign_id: str) -> set[str]:
        if not campaign_id:
            return set()
        try:
            rows = conn.execute(
                "SELECT location_id FROM campaign_location_lore_overrides WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
            return {r["location_id"] for r in rows}
        except sqlite3.OperationalError:
            return set()

    @staticmethod
    def _load_overridden_container_ids(conn: sqlite3.Connection, campaign_id: str) -> set[str]:
        if not campaign_id:
            return set()
        try:
            rows = conn.execute(
                "SELECT container_id FROM campaign_container_lore_overrides WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
            return {r["container_id"] for r in rows}
        except sqlite3.OperationalError:
            return set()

    @staticmethod
    def _is_scoped_lore_row_eligible(
        row: sqlite3.Row,
        *,
        row_keys: list[str] | Any,
        scope_column: str,
        exclude_scope_id: str | None,
        overridden_scope_ids: set[str],
        campaign_id: str,
    ) -> bool:
        """Check whether a location_lore or container_lore vector row applies to this query/branch."""
        row_scope_id = row[scope_column] if scope_column in row_keys else None
        row_camp = row["campaign_id"] or ""
        if exclude_scope_id and row_scope_id == exclude_scope_id:
            return False
        if row_scope_id in overridden_scope_ids:
            return row_camp == campaign_id
        return not row_camp or row_camp == campaign_id

    def _rank_candidate_rows_hybrid(
        self,
        candidate_rows: list[sqlite3.Row],
        *,
        query_text: str,
        query_vec: np.ndarray,
        queries: Sequence[str],
        mentioned_entities: Sequence[str],
        recent_turn_texts: Sequence[str] | None = None,
    ) -> tuple[list[tuple[RecalledMemoryItem, sqlite3.Row]], list[str], list[str], float]:
        """Rank pre-filtered SQLite candidate rows using BM25/IDF lexical scoring + MMR cosine diversity + RRF (k=60)."""
        if not candidate_rows:
            return [], [], [], 0.0

        token_weights, entity_phrases = extract_context_activations(
            queries, mentioned_entities, recent_turn_texts
        )
        # Ensure raw query tokens also participate even if stopword-heavy
        for qtok in _tokenize(query_text):
            if qtok not in token_weights and qtok not in _STOPWORDS:
                token_weights[qtok] = 1.0

        pre_scored: list[dict] = []
        for row in candidate_rows:
            stype = row["source_type"]
            vec = np.frombuffer(row["embedding_blob"], dtype=np.float32)
            if vec.shape == query_vec.shape:
                cosine_sim = float(np.dot(query_vec, vec))
            else:
                fallback_q = compute_local_hash_embedding(query_text, dims=vec.shape[0])
                cosine_sim = float(np.dot(fallback_q, vec))

            keywords: list[str] = json.loads(row["keywords_json"] or "[]")
            kw_lower = {k.lower() for k in keywords if isinstance(k, str)}
            title_str = row["title"] or ""
            content_str = row["content"] or ""
            kw_or_title_tokens = set(_tokenize(title_str)) | {
                tok for kw in keywords if isinstance(kw, str) for tok in _tokenize(kw)
            }
            doc_tokens = set(_tokenize(f"{title_str} {content_str}")) | kw_lower | kw_or_title_tokens

            entity_boost = 0.0
            title_low = title_str.lower()
            content_low = content_str.lower()
            for ent in entity_phrases:
                if ent in kw_lower or ent in title_low or ent in content_low:
                    entity_boost += 0.35

            overlap_count = len(set(token_weights.keys()) & doc_tokens)

            # Remote location/container lore is surfaced ONLY when brought up during conversation/interaction
            if (
                stype in ("location_lore", "container_lore")
                and entity_boost == 0.0
                and overlap_count == 0
                and cosine_sim < 0.35
            ):
                continue

            pre_scored.append(
                {
                    "id": row["id"],
                    "row": row,
                    "vec": vec,
                    "cosine_sim": cosine_sim,
                    "doc_tokens": doc_tokens,
                    "kw_or_title_tokens": kw_or_title_tokens,
                    "entity_boost": entity_boost,
                    "overlap_count": overlap_count,
                }
            )

        if not pre_scored:
            return [], [], [], 0.0

        idf_map = compute_corpus_idf([c["doc_tokens"] for c in pre_scored])

        for c in pre_scored:
            matched_tokens = c["doc_tokens"] & set(token_weights.keys())
            bm25_idf_sum = 0.0
            for tok in matched_tokens:
                w = token_weights[tok]
                tok_idf = max(0.35, idf_map.get(tok, 0.5))
                field_mult = 1.35 if tok in c["kw_or_title_tokens"] else 1.0
                bm25_idf_sum += w * tok_idf * field_mult
            c["bm25_idf_sum"] = bm25_idf_sum
            c["lexical_rank_score"] = bm25_idf_sum + (c["entity_boost"] * 4.0)

        # Ranker 1: BM25/IDF + Entity Match
        lexical_pool = [c for c in pre_scored if c["lexical_rank_score"] > 0.0]
        lexical_pool.sort(
            key=lambda c: (c["lexical_rank_score"], c["cosine_sim"]),
            reverse=True,
        )
        keyword_ranked = [c["id"] for c in lexical_pool]
        top_keyword_score = lexical_pool[0]["lexical_rank_score"] if lexical_pool else 0.0

        # Ranker 2: Cosine Similarity + MMR Diversity
        cosine_sorted = sorted(pre_scored, key=lambda c: c["cosine_sim"], reverse=True)
        mmr_pool_size = min(len(cosine_sorted), 16)
        mmr_target_k = min(mmr_pool_size, 10)
        mmr_selected = mmr_select(
            [(c["id"], c["cosine_sim"], c["vec"]) for c in cosine_sorted[:mmr_pool_size]],
            top_k=mmr_target_k,
            lambda_mult=0.7,
        )
        mmr_ids = [cid for cid, _sim in mmr_selected]
        mmr_seen = set(mmr_ids)
        embedding_ranked = mmr_ids + [
            c["id"] for c in cosine_sorted if c["id"] not in mmr_seen
        ]

        # Reciprocal Rank Fusion (k=60)
        fused_pairs = fuse_rrf(keyword_ranked, embedding_ranked, k=60)
        rrf_map = {cid: rrf_val for cid, rrf_val in fused_pairs}
        rrf_rank_map = {cid: idx for idx, (cid, _val) in enumerate(fused_pairs)}
        max_rrf = 2.0 / 61.0

        ordered_candidates = sorted(
            pre_scored,
            key=lambda c: (
                -rrf_rank_map.get(c["id"], 99999),
                c["lexical_rank_score"],
                c["cosine_sim"],
            ),
            reverse=True,
        )

        results: list[tuple[RecalledMemoryItem, sqlite3.Row]] = []
        prev_score: float | None = None
        for c in ordered_candidates:
            row = c["row"]
            rrf_norm = rrf_map.get(c["id"], 0.0) / max_rrf
            lexical_boost = min(0.30, c["bm25_idf_sum"] * 0.06 + c["overlap_count"] * 0.03)
            raw_score = (
                0.45 * c["cosine_sim"]
                + 0.55 * rrf_norm
                + c["entity_boost"]
                + lexical_boost
            )
            if prev_score is not None and raw_score >= prev_score:
                raw_score = max(0.0001, prev_score - 0.0001)
            final_score = round(raw_score, 4)
            prev_score = final_score

            item = RecalledMemoryItem(
                id=row["id"],
                source_type=row["source_type"],
                title=row["title"],
                content=row["content"],
                short_content=build_short_memory_content(row["title"], row["content"]),
                render_form="full",
                score=final_score,
            )
            results.append((item, row))

        return results, keyword_ranked, embedding_ranked, top_keyword_score

    async def search_memories(
        self,
        *,
        queries: list[str],
        mentioned_entities: list[str],
        world_id: str,
        character_id: str,
        campaign_id: str,
        valid_branch_turn_ids: Iterable[str],
        exclude_location_id: str | None = None,
        overridden_location_ids: set[str] | None = None,
        exclude_container_id: str | None = None,
        overridden_container_ids: set[str] | None = None,
        character_present_turn_ids: Iterable[str] | None = None,
        recent_turn_texts: Sequence[str] | None = None,
        use_dynamic_max: bool = False,
        top_k: int = 4,
    ) -> list[RecalledMemoryItem]:
        """Perform branch-safe hybrid BM25/IDF + MMR + RRF search across world, location, container, shard, and episodic scopes."""
        valid_turns = set(valid_branch_turn_ids)
        present_turns = (
            set(character_present_turn_ids)
            if character_present_turn_ids is not None
            else None
        )
        query_text = " ".join(q for q in queries if q.strip())
        if not query_text and mentioned_entities:
            query_text = " ".join(mentioned_entities)
        if not query_text:
            return []

        query_vec = await embed_text(query_text)

        conn = self._connect()
        try:
            overridden_locs = (
                overridden_location_ids
                if overridden_location_ids is not None
                else self._load_overridden_location_ids(conn, campaign_id)
            )
            overridden_conts = (
                overridden_container_ids
                if overridden_container_ids is not None
                else self._load_overridden_container_ids(conn, campaign_id)
            )
            has_campaign_shards = conn.execute(
                """
                SELECT 1 FROM vector_entries
                WHERE campaign_id = ? AND character_id = ? AND source_type = 'character_shard'
                LIMIT 1
                """,
                (campaign_id, character_id),
            ).fetchone() is not None

            if has_campaign_shards:
                char_clause = "(character_id = ? AND campaign_id = ? AND source_type = 'character_shard')"
                params = (
                    world_id,
                    world_id,
                    campaign_id,
                    world_id,
                    campaign_id,
                    character_id,
                    campaign_id,
                    campaign_id,
                )
            else:
                char_clause = "(character_id = ? AND (campaign_id IS NULL OR campaign_id = '') AND source_type = 'character_shard')"
                params = (
                    world_id,
                    world_id,
                    campaign_id,
                    world_id,
                    campaign_id,
                    character_id,
                    campaign_id,
                )

            rows = conn.execute(
                f"""
                SELECT id, source_type, location_id, container_id, character_id, campaign_id,
                       anchor_turn_id, superseded_at_turn_id, title, content, keywords_json,
                       embedding_blob, embedding_fingerprint
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR (world_id = ? AND source_type = 'location_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR (world_id = ? AND source_type = 'container_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR {char_clause}
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                params,
            ).fetchall()
        finally:
            conn.close()

        candidate_rows: list[sqlite3.Row] = []
        current_fp = current_embedding_fingerprint()
        for row in rows:
            row_fp = row["embedding_fingerprint"]
            if row_fp is not None and row_fp != current_fp:
                continue  # embedded in a different vector space: stale until reindexed, never garbage-scored
            anchor_turn = row["anchor_turn_id"]
            row_keys = row.keys()
            superseded_turn = (
                row["superseded_at_turn_id"]
                if "superseded_at_turn_id" in row_keys
                else None
            )
            # Enforce strict timeline branch isolation for turn-anchored or superseded memories
            if anchor_turn is not None and anchor_turn not in valid_turns:
                continue
            if superseded_turn is not None and superseded_turn in valid_turns:
                continue

            stype = row["source_type"]
            if stype == "location_lore":
                if not self._is_scoped_lore_row_eligible(
                    row,
                    row_keys=row_keys,
                    scope_column="location_id",
                    exclude_scope_id=exclude_location_id,
                    overridden_scope_ids=overridden_locs,
                    campaign_id=campaign_id,
                ):
                    continue
            elif stype == "container_lore":
                if not self._is_scoped_lore_row_eligible(
                    row,
                    row_keys=row_keys,
                    scope_column="container_id",
                    exclude_scope_id=exclude_container_id,
                    overridden_scope_ids=overridden_conts,
                    campaign_id=campaign_id,
                ):
                    continue

            # Enforce spatial room isolation when provided for episodic memories
            if (
                stype == "episodic_chunk"
                and anchor_turn is not None
                and present_turns is not None
                and anchor_turn not in present_turns
                and row["character_id"] != character_id
            ):
                continue

            candidate_rows.append(row)

        ranked_pairs, kw_ranked, emb_ranked, top_kw_score = self._rank_candidate_rows_hybrid(
            candidate_rows,
            query_text=query_text,
            query_vec=query_vec,
            queries=queries,
            mentioned_entities=mentioned_entities,
            recent_turn_texts=recent_turn_texts,
        )
        eff_limit = (
            compute_dynamic_max(kw_ranked, emb_ranked, top_k, top_kw_score)
            if use_dynamic_max
            else top_k
        )
        return [item for item, _row in ranked_pairs[:eff_limit]]

    async def search_memories_for_characters(
        self,
        *,
        queries: list[str],
        mentioned_entities: list[str],
        world_id: str,
        campaign_id: str,
        character_ids: list[str],
        valid_branch_turn_ids: Iterable[str],
        exclude_location_id: str | None = None,
        overridden_location_ids: set[str] | None = None,
        exclude_container_id: str | None = None,
        overridden_container_ids: set[str] | None = None,
        present_turn_ids_by_char: Mapping[str, set[str]] | None = None,
        character_witnessed_turn_ids: Mapping[str, set[str]] | None = None,
        recent_turn_texts: Sequence[str] | None = None,
        use_dynamic_max: bool = False,
        top_k: int = 4,
    ) -> ScopedMemoryRecallBundle:
        """
        Embed queries once, query SQLite once across all present characters,
        and partition memories strictly by character epistemic scope.
        """
        witnessed_by_char = (
            present_turn_ids_by_char
            if present_turn_ids_by_char is not None
            else (character_witnessed_turn_ids or {})
        )
        valid_turns = set(valid_branch_turn_ids)
        char_set = set(character_ids)
        query_text = " ".join(q for q in queries if q.strip())
        if not query_text and mentioned_entities:
            query_text = " ".join(mentioned_entities)
        if not query_text or not char_set:
            return ScopedMemoryRecallBundle(
                shared_scene_items=[],
                by_character={cid: [] for cid in character_ids},
            )

        query_vec = await embed_text(query_text)

        conn = self._connect()
        try:
            overridden_locs = (
                overridden_location_ids
                if overridden_location_ids is not None
                else self._load_overridden_location_ids(conn, campaign_id)
            )
            overridden_conts = (
                overridden_container_ids
                if overridden_container_ids is not None
                else self._load_overridden_container_ids(conn, campaign_id)
            )
            placeholders = ",".join("?" for _ in char_set)
            camp_shard_rows = conn.execute(
                f"""
                SELECT DISTINCT character_id FROM vector_entries
                WHERE campaign_id = ? AND source_type = 'character_shard' AND character_id IN ({placeholders})
                """,
                (campaign_id, *char_set),
            ).fetchall()
            chars_with_camp_shards = {r["character_id"] for r in camp_shard_rows}

            rows = conn.execute(
                f"""
                SELECT id, source_type, location_id, container_id, character_id, campaign_id,
                       anchor_turn_id, superseded_at_turn_id, title, content, keywords_json,
                       embedding_blob, embedding_fingerprint
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR (world_id = ? AND source_type = 'location_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR (world_id = ? AND source_type = 'container_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR (source_type = 'character_shard' AND character_id IN ({placeholders}))
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                (world_id, world_id, campaign_id, world_id, campaign_id, *char_set, campaign_id),
            ).fetchall()
        finally:
            conn.close()

        candidate_rows: list[sqlite3.Row] = []
        current_fp = current_embedding_fingerprint()
        for row in rows:
            row_fp = row["embedding_fingerprint"]
            if row_fp is not None and row_fp != current_fp:
                continue  # embedded in a different vector space: stale until reindexed, never garbage-scored
            anchor_turn = row["anchor_turn_id"]
            row_keys = row.keys()
            superseded_turn = (
                row["superseded_at_turn_id"]
                if "superseded_at_turn_id" in row_keys
                else None
            )
            if anchor_turn is not None and anchor_turn not in valid_turns:
                continue
            if superseded_turn is not None and superseded_turn in valid_turns:
                continue

            stype = row["source_type"]
            if stype == "location_lore":
                if not self._is_scoped_lore_row_eligible(
                    row,
                    row_keys=row_keys,
                    scope_column="location_id",
                    exclude_scope_id=exclude_location_id,
                    overridden_scope_ids=overridden_locs,
                    campaign_id=campaign_id,
                ):
                    continue
            elif stype == "container_lore":
                if not self._is_scoped_lore_row_eligible(
                    row,
                    row_keys=row_keys,
                    scope_column="container_id",
                    exclude_scope_id=exclude_container_id,
                    overridden_scope_ids=overridden_conts,
                    campaign_id=campaign_id,
                ):
                    continue
            elif stype == "character_shard":
                row_cid = row["character_id"]
                row_camp = row["campaign_id"] or ""
                if row_cid in chars_with_camp_shards:
                    if row_camp != campaign_id:
                        continue
                else:
                    if row_camp:
                        continue

            candidate_rows.append(row)

        scored_candidates, kw_ranked, emb_ranked, top_kw_score = self._rank_candidate_rows_hybrid(
            candidate_rows,
            query_text=query_text,
            query_vec=query_vec,
            queries=queries,
            mentioned_entities=mentioned_entities,
            recent_turn_texts=recent_turn_texts,
        )
        eff_limit = (
            compute_dynamic_max(kw_ranked, emb_ranked, top_k, top_kw_score)
            if use_dynamic_max
            else top_k
        )

        # 1. Shared scene items: world lore + referenced remote location/container lore + witnessed episodic chunks
        shared_scene_items: list[RecalledMemoryItem] = []
        all_present_turn_ids = set().union(*witnessed_by_char.values()) if witnessed_by_char else set()

        for item, row in scored_candidates:
            stype = row["source_type"]
            if stype in ("lore", "location_lore", "container_lore"):
                shared_scene_items.append(item)
            elif stype == "episodic_chunk":
                anchor_turn = row["anchor_turn_id"]
                if anchor_turn is None or anchor_turn in all_present_turn_ids:
                    shared_scene_items.append(item)
            if len(shared_scene_items) >= eff_limit:
                break

        # 2. Per-character items: strictly partitioned by character epistemic scope
        by_char: dict[str, list[RecalledMemoryItem]] = {cid: [] for cid in character_ids}
        for cid in character_ids:
            char_witnessed_turns = witnessed_by_char.get(cid, set())
            c_items: list[RecalledMemoryItem] = []
            for item, row in scored_candidates:
                stype = row["source_type"]
                row_cid = row["character_id"]
                if stype in ("lore", "location_lore", "container_lore"):
                    c_items.append(item)
                elif stype == "character_shard":
                    if row_cid == cid:
                        c_items.append(item)
                elif stype == "episodic_chunk":
                    anchor_turn = row["anchor_turn_id"]
                    if anchor_turn is None or anchor_turn in char_witnessed_turns or row_cid == cid:
                        c_items.append(item)
                if len(c_items) >= eff_limit:
                    break
            by_char[cid] = c_items

        return ScopedMemoryRecallBundle(
            shared_scene_items=shared_scene_items,
            by_character=by_char,
        )
