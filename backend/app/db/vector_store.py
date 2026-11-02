"""Hybrid semantic vector store and branch-aware memory retrieval."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Iterable, Mapping

import httpx
import numpy as np

from app.config import settings
from app.schemas.turn import RecalledMemoryItem


@dataclass(frozen=True)
class ScopedMemoryRecallBundle:
    """Scoped memory retrieval results partitioned between shared room items and private character memories."""

    shared_scene_items: list[RecalledMemoryItem]
    by_character: dict[str, list[RecalledMemoryItem]]


_WORD_RE = re.compile(r"[a-z0-9_']+", re.IGNORECASE)
_FASTEMBED_MODEL = None


def _tokenize(text: str) -> list[str]:
    return [tok.lower() for tok in _WORD_RE.findall(text)]


def compute_local_hash_embedding(text: str, dims: int = 384) -> np.ndarray:
    """Compute a normalized n-gram + word feature-hashed embedding vector."""
    vec = np.zeros(dims, dtype=np.float32)
    tokens = _tokenize(text)
    if not tokens:
        return vec

    # Unigrams, bigrams, and character 4-grams for morphological resilience
    features: list[tuple[str, float]] = []
    for i, tok in enumerate(tokens):
        features.append((f"w:{tok}", 1.5))
        if i + 1 < len(tokens):
            features.append((f"bi:{tok}_{tokens[i + 1]}", 1.2))
        if len(tok) >= 4:
            for j in range(len(tok) - 3):
                features.append((f"c4:{tok[j : j + 4]}", 0.5))

    for feat, weight in features:
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "little") % dims
        sign = 1.0 if (digest[4] & 1) == 0 else -1.0
        vec[idx] += sign * weight

    norm = float(np.linalg.norm(vec))
    if norm > 1e-8:
        vec /= norm
    return vec


async def embed_text(text: str) -> np.ndarray:
    """Generate a normalized float32 embedding according to the active EmbeddingProfile."""
    profile = settings.embedding_profile
    dims = profile.dimensions

    if profile.mode == "openai_compat":
        try:
            base = profile.base_url.rstrip("/")
            root_url = base[: -len("/v1")].rstrip("/") if base.endswith("/v1") else base
            v1_url = base if base.endswith("/v1") else f"{base}/v1"
            headers = {"Authorization": f"Bearer {profile.api_key}"}
            async with httpx.AsyncClient(timeout=15.0) as client:
                # 1. Try native Ollama /api/embed
                ollama_resp = await client.post(
                    f"{root_url}/api/embed",
                    json={"model": profile.model, "input": text},
                )
                if ollama_resp.status_code == 200:
                    data = ollama_resp.json()
                    embeddings = data.get("embeddings") or []
                    if embeddings:
                        arr = np.asarray(embeddings[0], dtype=np.float32)
                        norm = float(np.linalg.norm(arr))
                        if norm > 1e-8:
                            arr /= norm
                        return arr

                # 2. Fallback to OpenAI-compatible /v1/embeddings
                resp = await client.post(
                    f"{v1_url}/embeddings",
                    headers=headers,
                    json={"model": profile.model, "input": text},
                )
                resp.raise_for_status()
                data = resp.json()
                raw = data["data"][0]["embedding"]
                arr = np.asarray(raw, dtype=np.float32)
                norm = float(np.linalg.norm(arr))
                if norm > 1e-8:
                    arr /= norm
                return arr
        except Exception:
            # Graceful fallback to local hash embedding if embedding model is not pulled yet
            return compute_local_hash_embedding(text, dims=dims)

    if profile.mode == "fastembed":
        global _FASTEMBED_MODEL
        try:
            if _FASTEMBED_MODEL is None:
                from fastembed import TextEmbedding  # type: ignore

                _FASTEMBED_MODEL = TextEmbedding()
            emb_list = list(_FASTEMBED_MODEL.embed([text]))
            arr = np.asarray(emb_list[0], dtype=np.float32)
            norm = float(np.linalg.norm(arr))
            if norm > 1e-8:
                arr /= norm
            return arr
        except Exception:
            return compute_local_hash_embedding(text, dims=dims)

    return compute_local_hash_embedding(text, dims=dims)


def combine_entry_text(title: str, content: str, keywords: list[str] | None = None) -> str:
    """Format entry fields into the canonical text string used for vector embedding."""
    kw_list = keywords or []
    return f"{title}. {content}. {' '.join(kw_list)}"


def embed_text_sync(text: str) -> np.ndarray:
    """Synchronous embedding helper respecting the active EmbeddingProfile."""
    profile = settings.embedding_profile
    if profile.mode == "local_hash":
        return compute_local_hash_embedding(text, dims=profile.dimensions)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(lambda: asyncio.run(embed_text(text))).result()
    return asyncio.run(embed_text(text))


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
                    id, source_type, world_id, character_id, campaign_id,
                    anchor_turn_id, superseded_at_turn_id, title, content, keywords_json, embedding_blob
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    keywords_json = excluded.keywords_json,
                    embedding_blob = excluded.embedding_blob,
                    anchor_turn_id = excluded.anchor_turn_id,
                    superseded_at_turn_id = excluded.superseded_at_turn_id
                """,
                (
                    entry_id,
                    source_type,
                    world_id,
                    character_id,
                    campaign_id,
                    anchor_turn_id,
                    superseded_at_turn_id,
                    title,
                    content,
                    json.dumps(kw_list),
                    blob,
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
            character_id=character_id,
            campaign_id=campaign_id,
            anchor_turn_id=anchor_turn_id,
            superseded_at_turn_id=superseded_at_turn_id,
            embedding=vec,
            conn=conn,
        )

    async def search_memories(
        self,
        *,
        queries: list[str],
        mentioned_entities: list[str],
        world_id: str,
        character_id: str,
        campaign_id: str,
        valid_branch_turn_ids: Iterable[str],
        character_present_turn_ids: Iterable[str] | None = None,
        top_k: int = 4,
    ) -> list[RecalledMemoryItem]:
        """Perform branch-safe hybrid semantic + entity-tag search across all 3 memory scopes."""
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
        query_tokens = set(_tokenize(query_text))
        entity_tokens = {e.lower().strip() for e in mentioned_entities if e.strip()}

        conn = self._connect()
        try:
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
                params = (world_id, character_id, campaign_id, campaign_id)
            else:
                char_clause = "(character_id = ? AND (campaign_id IS NULL OR campaign_id = '') AND source_type = 'character_shard')"
                params = (world_id, character_id, campaign_id)

            rows = conn.execute(
                f"""
                SELECT id, source_type, character_id, anchor_turn_id, superseded_at_turn_id,
                       title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR {char_clause}
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                params,
            ).fetchall()
        finally:
            conn.close()

        scored: list[RecalledMemoryItem] = []
        for row in rows:
            anchor_turn = row["anchor_turn_id"]
            superseded_turn = (
                row["superseded_at_turn_id"]
                if "superseded_at_turn_id" in row.keys()
                else None
            )
            # Enforce strict timeline branch isolation for turn-anchored or superseded memories
            if anchor_turn is not None and anchor_turn not in valid_turns:
                continue
            if superseded_turn is not None and superseded_turn in valid_turns:
                continue
            # Enforce spatial room isolation when provided for episodic memories
            if (
                row["source_type"] == "episodic_chunk"
                and anchor_turn is not None
                and present_turns is not None
                and anchor_turn not in present_turns
                and row["character_id"] != character_id
            ):
                continue

            vec = np.frombuffer(row["embedding_blob"], dtype=np.float32)
            if vec.shape == query_vec.shape:
                cosine_sim = float(np.dot(query_vec, vec))
            else:
                # Dimension mismatch fallback if embedding profile changed mid-campaign
                fallback_q = compute_local_hash_embedding(query_text, dims=vec.shape[0])
                cosine_sim = float(np.dot(fallback_q, vec))

            keywords: list[str] = json.loads(row["keywords_json"] or "[]")
            kw_lower = {k.lower() for k in keywords}
            doc_tokens = set(_tokenize(f"{row['title']} {row['content']}")) | kw_lower

            # Hybrid entity & keyword boost (GraphRAG link matching)
            entity_boost = 0.0
            for ent in entity_tokens:
                if ent in kw_lower or ent in row["title"].lower() or ent in row["content"].lower():
                    entity_boost += 0.35

            overlap_count = len(query_tokens & doc_tokens)
            lexical_boost = min(0.25, overlap_count * 0.05)

            total_score = round(cosine_sim + entity_boost + lexical_boost, 4)
            scored.append(
                RecalledMemoryItem(
                    id=row["id"],
                    source_type=row["source_type"],
                    title=row["title"],
                    content=row["content"],
                    score=total_score,
                )
            )

        scored.sort(key=lambda item: item.score, reverse=True)
        return scored[:top_k]

    async def search_memories_for_characters(
        self,
        *,
        queries: list[str],
        mentioned_entities: list[str],
        world_id: str,
        campaign_id: str,
        character_ids: list[str],
        valid_branch_turn_ids: Iterable[str],
        present_turn_ids_by_char: Mapping[str, set[str]] | None = None,
        character_witnessed_turn_ids: Mapping[str, set[str]] | None = None,
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
        query_tokens = set(_tokenize(query_text))
        entity_tokens = {e.lower().strip() for e in mentioned_entities if e.strip()}

        conn = self._connect()
        try:
            placeholders = ",".join("?" for _ in char_set)
            rows = conn.execute(
                f"""
                SELECT id, source_type, character_id, campaign_id, anchor_turn_id, superseded_at_turn_id,
                       title, content, keywords_json, embedding_blob
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR (source_type = 'character_shard' AND character_id IN ({placeholders}))
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                (world_id, *char_set, campaign_id),
            ).fetchall()
        finally:
            conn.close()

        # Score all candidates once
        scored_candidates: list[tuple[RecalledMemoryItem, sqlite3.Row]] = []
        for row in rows:
            anchor_turn = row["anchor_turn_id"]
            superseded_turn = (
                row["superseded_at_turn_id"]
                if "superseded_at_turn_id" in row.keys()
                else None
            )
            if anchor_turn is not None and anchor_turn not in valid_turns:
                continue
            if superseded_turn is not None and superseded_turn in valid_turns:
                continue

            vec = np.frombuffer(row["embedding_blob"], dtype=np.float32)
            if vec.shape == query_vec.shape:
                cosine_sim = float(np.dot(query_vec, vec))
            else:
                fallback_q = compute_local_hash_embedding(query_text, dims=vec.shape[0])
                cosine_sim = float(np.dot(fallback_q, vec))

            keywords: list[str] = json.loads(row["keywords_json"] or "[]")
            kw_lower = {k.lower() for k in keywords}
            doc_tokens = set(_tokenize(f"{row['title']} {row['content']}")) | kw_lower

            entity_boost = 0.0
            for ent in entity_tokens:
                if ent in kw_lower or ent in row["title"].lower() or ent in row["content"].lower():
                    entity_boost += 0.35

            overlap_count = len(query_tokens & doc_tokens)
            lexical_boost = min(0.25, overlap_count * 0.05)
            total_score = round(cosine_sim + entity_boost + lexical_boost, 4)

            item = RecalledMemoryItem(
                id=row["id"],
                source_type=row["source_type"],
                title=row["title"],
                content=row["content"],
                score=total_score,
            )
            scored_candidates.append((item, row))

        scored_candidates.sort(key=lambda pair: pair[0].score, reverse=True)

        # 1. Shared scene items: world lore + episodic chunks witnessed by any character present in room
        shared_scene_items: list[RecalledMemoryItem] = []
        all_present_turn_ids = set().union(*witnessed_by_char.values()) if witnessed_by_char else set()

        for item, row in scored_candidates:
            stype = row["source_type"]
            if stype == "lore":
                shared_scene_items.append(item)
            elif stype == "episodic_chunk":
                anchor_turn = row["anchor_turn_id"]
                if anchor_turn is None or anchor_turn in all_present_turn_ids:
                    shared_scene_items.append(item)
            if len(shared_scene_items) >= top_k:
                break

        # 2. Per-character items: strictly partitioned by character epistemic scope
        by_char: dict[str, list[RecalledMemoryItem]] = {cid: [] for cid in character_ids}
        for cid in character_ids:
            char_witnessed_turns = witnessed_by_char.get(cid, set())
            c_items: list[RecalledMemoryItem] = []
            for item, row in scored_candidates:
                stype = row["source_type"]
                row_cid = row["character_id"]
                row_camp = row["campaign_id"]
                if stype == "lore":
                    c_items.append(item)
                elif stype == "character_shard":
                    # Character shards belong strictly to this character (prefer campaign-attached if available)
                    if row_cid == cid:
                        c_items.append(item)
                elif stype == "episodic_chunk":
                    anchor_turn = row["anchor_turn_id"]
                    if anchor_turn is None or anchor_turn in char_witnessed_turns or row_cid == cid:
                        c_items.append(item)
                if len(c_items) >= top_k:
                    break
            by_char[cid] = c_items

        return ScopedMemoryRecallBundle(
            shared_scene_items=shared_scene_items,
            by_character=by_char,
        )
