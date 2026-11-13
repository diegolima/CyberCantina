"""Embedding helpers, lexical TF-IDF activations, MMR, and RRF math."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping, Sequence
import hashlib
import json
import math
import re
import sqlite3
from dataclasses import dataclass

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

_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
        "any", "are", "as", "at", "be", "because", "been", "before", "being", "below",
        "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing",
        "down", "during", "each", "few", "for", "from", "further", "had", "has", "have",
        "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how",
        "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more",
        "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
        "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same",
        "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs",
        "them", "themselves", "then", "there", "these", "they", "this", "those", "through",
        "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when",
        "where", "which", "while", "who", "whom", "why", "will", "with", "would", "you",
        "your", "yours", "yourself", "yourselves",
    }
)


def _tokenize(text: str) -> list[str]:
    return [tok.lower() for tok in _WORD_RE.findall(text)]


def build_short_memory_content(title: str, content: str, max_chars: int = 140) -> str:
    """Extract a compact 1-line synopsis from memory content for two-form budget packing."""
    cleaned = " ".join((content or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not cleaned:
        return (title or "").strip()[:max_chars]
    first_sent = cleaned.split(". ")[0].strip()
    if first_sent and not first_sent.endswith((".", "!", "?")):
        first_sent += "."
    candidate = first_sent if first_sent else cleaned
    if len(candidate) <= max_chars:
        return candidate
    return candidate[: max_chars - 1].rstrip() + "…"


def compute_corpus_idf(doc_token_sets: Sequence[set[str]]) -> dict[str, float]:
    """Compute BM25-style inverse document frequency across candidate documents."""
    n_docs = len(doc_token_sets)
    if n_docs == 0:
        return {}
    df_counts: dict[str, int] = {}
    for tok_set in doc_token_sets:
        for tok in tok_set:
            df_counts[tok] = df_counts.get(tok, 0) + 1
    idf: dict[str, float] = {}
    for tok, df in df_counts.items():
        idf[tok] = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
    return idf


def extract_context_activations(
    queries: Sequence[str],
    mentioned_entities: Sequence[str],
    recent_turn_texts: Sequence[str] | None = None,
) -> tuple[dict[str, float], set[str]]:
    """Build recency-graded lexical activation weights across entities, queries, and recent turns.

    Weights:
    - Mentioned entities: 1.5
    - Explicit search queries & current user message: 1.0
    - Recent 2 turns: 0.65
    - Older working window turns: 0.25
    """
    token_weights: dict[str, float] = {}
    entity_phrases: set[str] = set()

    def _add_tokens(text: str, weight: float, allow_stopwords: bool = False) -> None:
        for tok in _tokenize(text):
            if len(tok) < 2:
                continue
            if not allow_stopwords and tok in _STOPWORDS:
                continue
            if weight > token_weights.get(tok, 0.0):
                token_weights[tok] = weight

    for ent in mentioned_entities:
        clean_ent = ent.strip().lower()
        if not clean_ent:
            continue
        entity_phrases.add(clean_ent)
        _add_tokens(clean_ent, 1.5, allow_stopwords=False)

    for q in queries:
        if q and q.strip():
            _add_tokens(q, 1.0, allow_stopwords=False)

    if recent_turn_texts:
        older_turns = recent_turn_texts[:-2]
        recent_two = recent_turn_texts[-2:]
        for txt in older_turns:
            if txt:
                _add_tokens(txt, 0.25, allow_stopwords=False)
        for txt in recent_two:
            if txt:
                _add_tokens(txt, 0.65, allow_stopwords=False)

    return token_weights, entity_phrases


def mmr_select(
    pool: Sequence[tuple[str, float, np.ndarray]],
    top_k: int,
    lambda_mult: float = 0.7,
) -> list[tuple[str, float]]:
    """Greedy Maximal Marginal Relevance (MMR) selection over (entry_id, cosine_sim, unit_vec).

    Always seeds with the top-1 cosine similarity item so the strongest semantic match is never lost.
    """
    if not pool or top_k <= 0:
        return []
    ordered_pool = sorted(pool, key=lambda x: x[1], reverse=True)
    selected: list[tuple[str, float, np.ndarray]] = [ordered_pool[0]]
    remaining = list(ordered_pool[1:])

    while remaining and len(selected) < top_k:
        best_idx = 0
        best_mmr = -1e9
        for idx, (_cid, cos_sim, vec) in enumerate(remaining):
            max_sim_to_selected = 0.0
            for _scid, _scos, svec in selected:
                if vec.shape == svec.shape:
                    sim = float(np.dot(vec, svec))
                    if sim > max_sim_to_selected:
                        max_sim_to_selected = sim
            mmr_val = lambda_mult * cos_sim - (1.0 - lambda_mult) * max_sim_to_selected
            if mmr_val > best_mmr:
                best_mmr = mmr_val
                best_idx = idx
        selected.append(remaining.pop(best_idx))

    return [(cid, cos_sim) for cid, cos_sim, _vec in selected]


def fuse_rrf(
    keyword_ranked: Sequence[str],
    embedding_ranked: Sequence[str],
    k: int = 60,
    kw_weight: float = 1.0,
    emb_weight: float = 1.0,
) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion (RRF) combining lexical and semantic rank lists without weight-tuning brittleness."""
    scores: dict[str, float] = {}
    first_rank: dict[str, int] = {}

    for rank_idx, doc_id in enumerate(keyword_ranked, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + kw_weight / float(k + rank_idx)
        first_rank[doc_id] = min(first_rank.get(doc_id, rank_idx), rank_idx)

    for rank_idx, doc_id in enumerate(embedding_ranked, start=1):
        scores[doc_id] = scores.get(doc_id, 0.0) + emb_weight / float(k + rank_idx)
        first_rank[doc_id] = min(first_rank.get(doc_id, rank_idx), rank_idx)

    fused = sorted(
        scores.items(),
        key=lambda pair: (pair[1], -first_rank.get(pair[0], 9999)),
        reverse=True,
    )
    return fused


def compute_dynamic_max(
    keyword_ranked: Sequence[str],
    embedding_ranked: Sequence[str],
    base_top_k: int,
    top_keyword_score: float,
) -> int:
    """Consensus-driven recall ceiling based on agreement between lexical and embedding rankers."""
    if base_top_k <= 0:
        return 0
    if not keyword_ranked and not embedding_ranked:
        return base_top_k

    if (
        keyword_ranked
        and embedding_ranked
        and keyword_ranked[0] == embedding_ranked[0]
        and top_keyword_score >= 3.0
    ):
        return min(base_top_k + 2, 10)

    kw_top3 = set(keyword_ranked[:3])
    emb_top3 = set(embedding_ranked[:3])
    overlap_top3 = len(kw_top3 & emb_top3)
    if overlap_top3 >= 2:
        return min(base_top_k + 1, 8)

    if top_keyword_score < 1.2 and overlap_top3 == 0 and base_top_k > 2:
        return max(2, base_top_k - 1)

    return base_top_k


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
