"""Hybrid semantic vector store and branch-aware memory retrieval."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Callable, Iterable, Mapping

import httpx
import numpy as np

from app.config import settings
from app.providers.probe import bearer_headers
from app.providers.resolver import resolve_system_profile
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


def current_embedding_fingerprint() -> str:
    """Identify the active embedding space; vectors from different fingerprints are not comparable."""
    profile = settings.embedding_profile
    if profile.mode == "local_hash":
        return f"local_hash|{profile.dimensions}"
    if profile.mode == "fastembed":
        return "fastembed|default"
    return f"openai_compat|{profile.provider_id or profile.base_url}|{profile.model}"


async def embed_text(text: str) -> np.ndarray:
    """Generate a normalized float32 embedding according to the active EmbeddingProfile."""
    profile = settings.embedding_profile
    dims = profile.dimensions

    if profile.mode == "openai_compat":
        try:
            endpoint = resolve_system_profile(profile, "embedding") if profile.provider_id else None  # type: ignore[arg-type]
            if endpoint is not None:
                base = endpoint.root_url.rstrip("/")
                token = endpoint.bearer_token
            else:
                base = profile.base_url.rstrip("/")
                token = profile.api_key if profile.api_key not in ("", "ollama") else None
            is_remote_v1 = endpoint is not None and endpoint.type in ("openrouter", "aihorde")
            if is_remote_v1:
                v1_url = endpoint.root_url.rstrip("/")
                root_url = v1_url
            else:
                root_url = base[: -len("/v1")].rstrip("/") if base.endswith("/v1") else base
                v1_url = base if base.endswith("/v1") else f"{base}/v1"
            native_headers = bearer_headers(token)
            headers = {"Authorization": f"Bearer {token or 'ollama'}"}
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
                # 1. Try native Ollama /api/embed (skip for openrouter and aihorde)
                if not is_remote_v1:
                    ollama_resp = await client.post(
                        f"{root_url}/api/embed",
                        headers=native_headers,
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
        location_id: str | None = None,
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
                    id, source_type, world_id, location_id, character_id, campaign_id,
                    anchor_turn_id, superseded_at_turn_id, title, content, keywords_json, embedding_blob,
                    embedding_fingerprint
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_type = excluded.source_type,
                    world_id = excluded.world_id,
                    location_id = excluded.location_id,
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
        character_present_turn_ids: Iterable[str] | None = None,
        top_k: int = 4,
    ) -> list[RecalledMemoryItem]:
        """Perform branch-safe hybrid semantic + entity-tag search across world, location, shard, and episodic scopes."""
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
            overridden_locs = (
                overridden_location_ids
                if overridden_location_ids is not None
                else self._load_overridden_location_ids(conn, campaign_id)
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
                params = (world_id, world_id, campaign_id, character_id, campaign_id, campaign_id)
            else:
                char_clause = "(character_id = ? AND (campaign_id IS NULL OR campaign_id = '') AND source_type = 'character_shard')"
                params = (world_id, world_id, campaign_id, character_id, campaign_id)

            rows = conn.execute(
                f"""
                SELECT id, source_type, location_id, character_id, campaign_id, anchor_turn_id, superseded_at_turn_id,
                       title, content, keywords_json, embedding_blob, embedding_fingerprint
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR (world_id = ? AND source_type = 'location_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR {char_clause}
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                params,
            ).fetchall()
        finally:
            conn.close()

        scored: list[RecalledMemoryItem] = []
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
                row_loc_id = row["location_id"] if "location_id" in row_keys else None
                row_camp = row["campaign_id"] or ""
                # Active room lore is deterministically injected in <active_location>; never double-inject
                if exclude_location_id and row_loc_id == exclude_location_id:
                    continue
                if row_loc_id in overridden_locs:
                    if row_camp != campaign_id:
                        continue
                else:
                    if row_camp and row_camp != campaign_id:
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

            # Remote location lore is surfaced ONLY when brought up during conversation/interaction
            if stype == "location_lore" and entity_boost == 0.0 and overlap_count == 0 and cosine_sim < 0.35:
                continue

            total_score = round(cosine_sim + entity_boost + lexical_boost, 4)
            scored.append(
                RecalledMemoryItem(
                    id=row["id"],
                    source_type=stype,
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
        exclude_location_id: str | None = None,
        overridden_location_ids: set[str] | None = None,
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
            overridden_locs = (
                overridden_location_ids
                if overridden_location_ids is not None
                else self._load_overridden_location_ids(conn, campaign_id)
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
                SELECT id, source_type, location_id, character_id, campaign_id, anchor_turn_id, superseded_at_turn_id,
                       title, content, keywords_json, embedding_blob, embedding_fingerprint
                FROM vector_entries
                WHERE (world_id = ? AND source_type = 'lore')
                   OR (world_id = ? AND source_type = 'location_lore' AND (campaign_id IS NULL OR campaign_id = '' OR campaign_id = ?))
                   OR (source_type = 'character_shard' AND character_id IN ({placeholders}))
                   OR (campaign_id = ? AND source_type = 'episodic_chunk')
                """,
                (world_id, world_id, campaign_id, *char_set, campaign_id),
            ).fetchall()
        finally:
            conn.close()

        # Score all candidates once
        scored_candidates: list[tuple[RecalledMemoryItem, sqlite3.Row]] = []
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
                row_loc_id = row["location_id"] if "location_id" in row_keys else None
                row_camp = row["campaign_id"] or ""
                if exclude_location_id and row_loc_id == exclude_location_id:
                    continue
                if row_loc_id in overridden_locs:
                    if row_camp != campaign_id:
                        continue
                else:
                    if row_camp and row_camp != campaign_id:
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

            if stype == "location_lore" and entity_boost == 0.0 and overlap_count == 0 and cosine_sim < 0.35:
                continue

            total_score = round(cosine_sim + entity_boost + lexical_boost, 4)

            item = RecalledMemoryItem(
                id=row["id"],
                source_type=stype,
                title=row["title"],
                content=row["content"],
                score=total_score,
            )
            scored_candidates.append((item, row))

        scored_candidates.sort(key=lambda pair: pair[0].score, reverse=True)

        # 1. Shared scene items: world lore + referenced remote location lore + witnessed episodic chunks
        shared_scene_items: list[RecalledMemoryItem] = []
        all_present_turn_ids = set().union(*witnessed_by_char.values()) if witnessed_by_char else set()

        for item, row in scored_candidates:
            stype = row["source_type"]
            if stype in ("lore", "location_lore"):
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
                if stype in ("lore", "location_lore"):
                    c_items.append(item)
                elif stype == "character_shard":
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
