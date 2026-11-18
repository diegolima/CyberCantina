"""Unit and integration tests for the NanoGPT provider."""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import EmbeddingProfile, ModelProfile, settings
from app.db.provider_store import ProviderStore
from app.db.vector_math import embed_text
from app.engine.context.lore_scope import resolve_actor_context_ceiling
from app.engine.llm_client import (
    CallTarget,
    LLMClient,
    get_chat_completions_url,
)
from app.providers.endpoint import ResolvedEndpoint
from app.providers.models import parse_nanogpt_models
from app.providers.probe import _probe_once, probe_service
from app.security.url_policy import NANOGPT_DEFAULT_BASE_URL, normalize_base_url


SAMPLE_NANOGPT_CHAT_PAYLOAD = {
    "object": "list",
    "data": [
        {"id": "openai/gpt-5", "object": "model"},
        {"id": "deepseek/deepseek-r1:fast", "object": "model"},
    ],
}

SAMPLE_NANOGPT_EMBED_PAYLOAD = {
    "object": "list",
    "data": [
        {"id": "cohere/embed-5-fast", "object": "model"},
        {"id": "openai/text-embedding-3-small", "object": "model"},
    ],
}


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture()
def env(api_env, api_user_factory, monkeypatch: pytest.MonkeyPatch):
    client, repo, _media_dir = api_env
    monkeypatch.setattr(settings, "allow_user_providers", True)
    monkeypatch.setattr(settings, "provider_credential_store", "prefer_server")
    admin_h, _admin_id, _admin_tok = api_user_factory("admin_ng", role="admin")

    def make_user(name: str) -> tuple[dict[str, str], str]:
        headers, uid, _tok = api_user_factory(name)
        return headers, uid

    return client, repo, admin_h, make_user


def test_parse_nanogpt_models_merges_chat_and_embeddings() -> None:
    models = parse_nanogpt_models(SAMPLE_NANOGPT_CHAT_PAYLOAD, SAMPLE_NANOGPT_EMBED_PAYLOAD)
    assert [m.name for m in models] == [
        "openai/gpt-5",
        "deepseek/deepseek-r1:fast",
        "cohere/embed-5-fast",
        "openai/text-embedding-3-small",
    ]
    assert models[0].family == "openai"
    assert models[0].is_embedding is False
    assert models[1].family == "deepseek"
    assert models[1].is_embedding is False
    assert models[2].family == "cohere"
    assert models[2].is_embedding is True
    assert models[3].is_embedding is True


def test_normalize_base_url_nanogpt_preserves_api_v1() -> None:
    norm_empty = normalize_base_url("", provider_type="nanogpt")
    assert norm_empty.root == NANOGPT_DEFAULT_BASE_URL
    assert norm_empty.host == "nano-gpt.com"
    assert norm_empty.scheme == "https"

    norm_bare = normalize_base_url("https://api.nano-gpt.com", provider_type="nanogpt")
    assert norm_bare.root == "https://api.nano-gpt.com/api/v1"

    norm_full = normalize_base_url("https://nano-gpt.com/api/v1/", provider_type="nanogpt")
    assert norm_full.root == "https://nano-gpt.com/api/v1"


@pytest.mark.asyncio
async def test_probe_nanogpt_reachability_only_and_embedding_merge() -> None:
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.url.path == "/api/v1/models":
            return httpx.Response(200, json=SAMPLE_NANOGPT_CHAT_PAYLOAD)
        if request.url.path == "/api/v1/embedding-models":
            return httpx.Response(200, json=SAMPLE_NANOGPT_EMBED_PAYLOAD)
        return httpx.Response(404)

    async with _mock_client(handler) as client:
        # Reachability succeeds even without an API key (auth is not validated on probe)
        outcome = await _probe_once(
            NANOGPT_DEFAULT_BASE_URL,
            token=None,
            provider_type="nanogpt",
            restricted=False,
            client=client,
        )
    assert outcome.reachable is True
    assert outcome.protocol == "openai_compat"
    assert outcome.models is not None
    assert len(outcome.models) == 4
    assert [m.name for m in outcome.models if m.is_embedding] == [
        "cohere/embed-5-fast",
        "openai/text-embedding-3-small",
    ]
    assert seen_paths == ["/api/v1/models", "/api/v1/embedding-models"]


@pytest.mark.asyncio
async def test_probe_nanogpt_degrades_when_embedding_catalog_unavailable_and_maps_errors() -> None:
    async def handler_no_embed(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/models":
            return httpx.Response(200, json=SAMPLE_NANOGPT_CHAT_PAYLOAD)
        return httpx.Response(404)

    async with _mock_client(handler_no_embed) as client:
        ok = await _probe_once(
            NANOGPT_DEFAULT_BASE_URL,
            token="ng-test",
            provider_type="nanogpt",
            restricted=False,
            client=client,
        )
    assert ok.reachable is True
    assert ok.models is not None and len(ok.models) == 2

    async def handler_bad_json(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    async with _mock_client(handler_bad_json) as client:
        bad = await _probe_once(
            NANOGPT_DEFAULT_BASE_URL,
            token="ng-test",
            provider_type="nanogpt",
            restricted=False,
            client=client,
        )
    assert bad.reachable is False
    assert bad.error_code == "bad_payload"

    async def handler_401(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    async with _mock_client(handler_401) as client:
        unauth = await _probe_once(
            NANOGPT_DEFAULT_BASE_URL,
            token="ng-bad",
            provider_type="nanogpt",
            restricted=False,
            client=client,
        )
    assert unauth.reachable is False
    assert unauth.error_code == "unauthorized"


def test_nanogpt_provider_crud_and_purge(env) -> None:
    client, repo, admin_h, make_user = env
    alice_h, _ = make_user("alice_ng")

    # 1. Server-stored NanoGPT requires an API key
    res_no_key = client.post(
        "/api/providers",
        headers=alice_h,
        json={"type": "nanogpt", "scope": "user", "settings": {}},
    )
    assert res_no_key.status_code == 422
    assert "API key" in res_no_key.text

    # 2. Creating server-stored NanoGPT defaults URL & display name
    res_ok = client.post(
        "/api/providers",
        headers=alice_h,
        json={"type": "nanogpt", "scope": "user", "settings": {"bearer_token": "ng-secret-123"}},
    )
    assert res_ok.status_code == 201
    created = res_ok.json()
    assert created["name"] == "NanoGPT"
    assert created["type"] == "nanogpt"
    assert created["base_url"] == "https://nano-gpt.com/api/v1"
    assert created["has_bearer_token"] is True

    # 3. Browser-stored NanoGPT allows null server token and purges server-stored NanoGPT secrets
    res_browser = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "NanoGPT Browser",
            "type": "nanogpt",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {"base_url": "https://api.nano-gpt.com/api/v1"},
        },
    )
    assert res_browser.status_code == 201
    assert res_browser.json()["credential_storage"] == "browser"
    assert res_browser.json()["base_url"] == "https://api.nano-gpt.com/api/v1"

    store = ProviderStore(repo.db_path)
    purged = store.purge_user_credentials()
    assert created["id"] in purged

    # 4. probe-draft accepts empty base_url and token (reachability-only)
    async def mock_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/models":
            return httpx.Response(200, json=SAMPLE_NANOGPT_CHAT_PAYLOAD)
        return httpx.Response(404)

    probe_service._client = _mock_client(mock_handler)
    draft_res = client.post(
        "/api/providers/probe-draft",
        headers=admin_h,
        json={"type": "nanogpt", "base_url": None, "bearer_token": None},
    )
    assert draft_res.status_code == 200
    assert draft_res.json()["reachable"] is True
    assert "openai/gpt-5" in draft_res.json()["chat_models"]


@pytest.mark.asyncio
async def test_nanogpt_inference_streaming_context_and_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    target = CallTarget(
        root_url="https://nano-gpt.com/api/v1",
        native_headers={},
        openai_headers={"Authorization": "Bearer ng-key", "Content-Type": "application/json"},
        provider_type="nanogpt",
    )
    assert get_chat_completions_url(target) == "https://nano-gpt.com/api/v1/chat/completions"

    recorded: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        recorded.append({"url": str(request.url), "json": body})
        if request.url.path == "/api/v1/chat/completions":
            if body.get("stream"):
                sse = (
                    b'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'
                    b'data: {"choices":[{"delta":{"content":"NanoGPT"}}]}\n\n'
                    b"data: [DONE]\n\n"
                )
                return httpx.Response(200, content=sse)
            if body.get("reasoning", {}).get("effort") == "none":
                return httpx.Response(400, json={"error": "reasoning cannot be disabled"})
            return httpx.Response(200, json={"choices": [{"message": {"content": "Complete OK"}}]})
        if request.url.path == "/api/v1/embeddings":
            return httpx.Response(200, json={"data": [{"embedding": [3.0, 4.0] + [0.0] * 62}]})
        return httpx.Response(404)

    llm = LLMClient()
    llm._client = _mock_client(handler)

    endpoint = ResolvedEndpoint(
        provider_id="p-ng",
        type="nanogpt",
        root_url="https://nano-gpt.com/api/v1",
        bearer_token="ng-key",
    )
    profile = ModelProfile(
        provider_id="p-ng",
        model="deepseek/deepseek-r1",
        context_size=16384,
        resolved=endpoint,
    )

    # Server-managed context ceiling should return (None, 0)
    assert resolve_actor_context_ceiling(profile) == (None, 0)

    # complete_text with disable_reasoning retries reasoning: {"exclude": True}
    completed = await llm.complete_text(
        [{"role": "user", "content": "hi"}],
        profile=profile,
        disable_reasoning=True,
    )
    assert completed == "Complete OK"
    assert recorded[0]["url"] == "https://nano-gpt.com/api/v1/chat/completions"
    assert recorded[0]["json"]["reasoning"] == {"effort": "none"}
    assert recorded[1]["json"]["reasoning"] == {"exclude": True}

    # stream_chat yields SSE tokens
    chunks: list[str] = []
    async for delta in llm.stream_chat([{"role": "user", "content": "hi"}], profile=profile):
        chunks.append(delta)
    assert "".join(chunks) == "Hello NanoGPT"

    # embed_text skips /api/embed and calls /api/v1/embeddings directly
    embed_profile = EmbeddingProfile(
        provider_id="p-ng",
        mode="openai_compat",
        model="cohere/embed-5-fast",
        dimensions=64,
    )
    monkeypatch.setattr(settings, "embedding_profile", embed_profile)
    monkeypatch.setattr("app.db.vector_math.resolve_system_profile", lambda _p, _r: endpoint)

    orig_async_client = httpx.AsyncClient

    class _PatchedAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            self._inner = orig_async_client(transport=httpx.MockTransport(handler))

        async def __aenter__(self):
            return self._inner

        async def __aexit__(self, *args):
            await self._inner.aclose()

    monkeypatch.setattr("app.db.vector_math.httpx.AsyncClient", _PatchedAsyncClient)
    vec = await embed_text("hello world")
    assert vec.tolist()[:2] == pytest.approx([0.6, 0.8], abs=1e-5)
    assert len(vec) == 64
    assert recorded[-1]["url"] == "https://nano-gpt.com/api/v1/embeddings"
