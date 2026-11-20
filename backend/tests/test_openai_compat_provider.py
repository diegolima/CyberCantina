"""Unit and integration tests for the generic OpenAI-compatible provider and adapter hierarchy."""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import EmbeddingProfile, ModelProfile, settings
from app.db.vector_math import embed_text
from app.engine.context.lore_scope import resolve_actor_context_ceiling
from app.engine.llm_client import (
    LLMClient,
    build_call_target,
    get_chat_completions_url,
)
from app.providers.endpoint import ResolvedEndpoint
from app.providers.openai_compat import (
    AIHordeProvider,
    NanoGPTProvider,
    OpenAICompatProvider,
    OpenRouterProvider,
    get_openai_compat_provider,
    is_openai_compat_provider,
)
from app.providers.probe import _probe_once
from app.security.url_policy import UrlBlockedError, normalize_base_url


SAMPLE_OPENAI_MODELS_PAYLOAD = {
    "object": "list",
    "data": [
        {"id": "gpt-4o-mini", "object": "model"},
        {"id": "meta-llama/llama-3.3-70b-instruct", "object": "model"},
        {"id": "text-embedding-3-small", "object": "model"},
    ],
}


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture()
def env(api_env, api_user_factory, monkeypatch: pytest.MonkeyPatch):
    client, repo, _media_dir = api_env
    monkeypatch.setattr(settings, "allow_user_providers", True)
    monkeypatch.setattr(settings, "provider_credential_store", "prefer_server")
    admin_h, _admin_id, _admin_tok = api_user_factory("admin_oai", role="admin")

    def make_user(name: str) -> tuple[dict[str, str], str]:
        headers, uid, _tok = api_user_factory(name)
        return headers, uid

    return client, repo, admin_h, make_user


def test_provider_adapter_inheritance_hierarchy() -> None:
    """Specialized OpenAI-compatible providers extend the generic OpenAICompatProvider base."""
    assert issubclass(OpenRouterProvider, OpenAICompatProvider)
    assert issubclass(NanoGPTProvider, OpenAICompatProvider)
    assert issubclass(AIHordeProvider, OpenAICompatProvider)

    for ptype in ("openai_compat", "openrouter", "nanogpt", "aihorde"):
        assert is_openai_compat_provider(ptype)
        assert isinstance(get_openai_compat_provider(ptype), OpenAICompatProvider)

    assert not is_openai_compat_provider("ollama")
    assert not is_openai_compat_provider("browser_ollama")
    assert not is_openai_compat_provider("webgpu")


def test_normalize_base_url_openai_compat_paths() -> None:
    # Empty URL is rejected (no hardcoded cloud default for generic provider)
    with pytest.raises(UrlBlockedError):
        normalize_base_url("", provider_type="openai_compat")

    # Bare host appends /v1
    norm_bare = normalize_base_url("https://api.openai.com", provider_type="openai_compat")
    assert norm_bare.root == "https://api.openai.com/v1"

    norm_local = normalize_base_url("http://localhost:1234", provider_type="openai_compat")
    assert norm_local.root == "http://localhost:1234/v1"

    # Explicit paths are preserved (stripping only trailing slashes)
    assert normalize_base_url("https://api.openai.com/v1/", provider_type="openai_compat").root == (
        "https://api.openai.com/v1"
    )
    assert normalize_base_url("https://api.groq.com/openai/v1/", provider_type="openai_compat").root == (
        "https://api.groq.com/openai/v1"
    )
    assert (
        normalize_base_url(
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            provider_type="openai_compat",
        ).root
        == "https://generativelanguage.googleapis.com/v1beta/openai"
    )


@pytest.mark.asyncio
async def test_probe_openai_compat_success_with_and_without_token() -> None:
    seen_auth: list[str | None] = []
    seen_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        seen_auth.append(request.headers.get("Authorization"))
        if request.url.path == "/openai/v1/models":
            return httpx.Response(200, json=SAMPLE_OPENAI_MODELS_PAYLOAD)
        return httpx.Response(404)

    async with _mock_client(handler) as client:
        # With API key
        outcome_authed = await _probe_once(
            "https://api.groq.com/openai/v1",
            token="gsk_test_key",
            provider_type="openai_compat",
            restricted=False,
            client=client,
        )
        # Without API key (e.g. local vLLM / LM Studio / llama.cpp)
        outcome_noauth = await _probe_once(
            "https://api.groq.com/openai/v1",
            token=None,
            provider_type="openai_compat",
            restricted=False,
            client=client,
        )

    assert outcome_authed.reachable is True
    assert outcome_authed.protocol == "openai_compat"
    assert outcome_authed.models is not None
    assert [m.name for m in outcome_authed.models if not m.is_embedding] == [
        "gpt-4o-mini",
        "meta-llama/llama-3.3-70b-instruct",
    ]
    assert [m.name for m in outcome_authed.models if m.is_embedding] == ["text-embedding-3-small"]
    assert outcome_authed.models[1].family == "meta-llama"

    assert outcome_noauth.reachable is True
    assert seen_paths == ["/openai/v1/models", "/openai/v1/models"]
    assert seen_auth == ["Bearer gsk_test_key", None]


@pytest.mark.asyncio
async def test_probe_openai_compat_error_codes() -> None:
    for status_code, expected_code in (
        (401, "unauthorized"),
        (403, "forbidden"),
        (404, "not_found"),
        (502, "connect_refused"),
    ):
        async with _mock_client(lambda _req, sc=status_code: httpx.Response(sc)) as client:
            outcome = await _probe_once(
                "https://api.openai.com/v1",
                token="bad-key",
                provider_type="openai_compat",
                restricted=False,
                client=client,
            )
        assert outcome.reachable is False
        assert outcome.error_code == expected_code

    # Bad payload (non-dict or missing data list)
    async with _mock_client(lambda _req: httpx.Response(200, json={"unexpected": True})) as client:
        outcome = await _probe_once(
            "https://api.openai.com/v1",
            token="ok",
            provider_type="openai_compat",
            restricted=False,
            client=client,
        )
    assert outcome.reachable is False
    assert outcome.error_code == "bad_payload"


@pytest.mark.asyncio
async def test_llm_client_openai_compat_complete_and_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_requests: list[tuple[str, dict[str, str], dict]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        seen_requests.append((str(request.url), dict(request.headers), body))
        if body.get("stream"):
            sse = (
                'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n'
                'data: {"choices":[{"delta":{"content":"OpenAI"}}]}\n\n'
                "data: [DONE]\n\n"
            )
            return httpx.Response(200, text=sse, headers={"Content-Type": "text/event-stream"})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok": true}'}}]},
        )

    client = LLMClient()
    mock_http = _mock_client(handler)

    async def _get_http(timeout: float | None = None) -> httpx.AsyncClient:
        return mock_http

    monkeypatch.setattr(client, "get_http_client", _get_http)

    # Profile with no API key (e.g., local LM Studio / llama.cpp)
    ep_noauth = ResolvedEndpoint(
        provider_id="prov_oai_local",
        type="openai_compat",
        root_url="http://localhost:1234/v1",
        bearer_token=None,
    )
    profile_noauth = ModelProfile(
        provider_id="prov_oai_local",
        model="local-model",
        temperature=0.5,
        max_tokens=256,
        resolved=ep_noauth,
    )
    target = await build_call_target(profile_noauth)
    assert get_chat_completions_url(target) == "http://localhost:1234/v1/chat/completions"
    assert "Authorization" not in target.openai_headers
    assert "HTTP-Referer" not in target.openai_headers
    assert "X-Title" not in target.openai_headers

    out = await client.complete_text(
        [{"role": "user", "content": "hi"}],
        profile=profile_noauth,
        json_mode=True,
        disable_reasoning=True,
    )
    assert out == '{"ok": true}'

    # Streaming with API key
    ep_authed = ResolvedEndpoint(
        provider_id="prov_oai_cloud",
        type="openai_compat",
        root_url="https://api.openai.com/v1",
        bearer_token="sk-live-test",
    )
    profile_authed = ModelProfile(
        provider_id="prov_oai_cloud",
        model="gpt-4o-mini",
        temperature=0.7,
        max_tokens=256,
        resolved=ep_authed,
    )
    chunks = [
        delta
        async for delta in client.stream_chat(
            [{"role": "user", "content": "stream"}],
            profile=profile_authed,
            disable_reasoning=True,
        )
    ]
    assert "".join(chunks) == "Hello OpenAI"
    await mock_http.aclose()

    assert len(seen_requests) == 2
    # 1. Non-streaming call: no /api/chat attempt, no reasoning field, has response_format, no auth header
    assert seen_requests[0][0] == "http://localhost:1234/v1/chat/completions"
    assert "authorization" not in {k.lower() for k in seen_requests[0][1]}
    assert seen_requests[0][2]["response_format"] == {"type": "json_object"}
    assert "reasoning" not in seen_requests[0][2]
    assert "reasoning_effort" not in seen_requests[0][2]

    # 2. Streaming call: has Bearer token, no non-standard reasoning params
    assert seen_requests[1][0] == "https://api.openai.com/v1/chat/completions"
    assert seen_requests[1][1].get("authorization") == "Bearer sk-live-test"
    assert "reasoning" not in seen_requests[1][2]
    assert "reasoning_effort" not in seen_requests[1][2]


@pytest.mark.asyncio
async def test_embed_text_and_context_ceiling_for_openai_compat(monkeypatch: pytest.MonkeyPatch) -> None:
    # Context ceiling should be server-managed (None, 0)
    ep = ResolvedEndpoint(
        provider_id="prov_oai_ctx",
        type="openai_compat",
        root_url="https://api.openai.com/v1",
        bearer_token="sk-ctx",
    )
    actor = ModelProfile(
        provider_id="prov_oai_ctx",
        model="gpt-4o",
        context_size=12288,
        max_tokens=1024,
        resolved=ep,
    )
    assert resolve_actor_context_ceiling(actor) == (None, 0)

    # Embeddings should skip /api/embed and call {root}/embeddings directly
    seen_urls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, json={"data": [{"embedding": [1.0, 0.0, 0.0]}]})

    real_async_client = httpx.AsyncClient

    def _patched_client(*args, **kwargs):
        return real_async_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr("app.db.vector_math.httpx.AsyncClient", _patched_client)
    monkeypatch.setattr(
        "app.db.vector_math.resolve_system_profile",
        lambda _profile, _role: ep,
    )
    monkeypatch.setattr(
        settings,
        "embedding_profile",
        EmbeddingProfile(
            provider_id="prov_oai_ctx",
            mode="openai_compat",
            model="text-embedding-3-small",
            dimensions=64,
        ),
    )

    vec = await embed_text("hello world")
    assert vec.shape == (3,)
    assert seen_urls == ["https://api.openai.com/v1/embeddings"]


def test_openai_compat_provider_crud_and_purge(env, monkeypatch: pytest.MonkeyPatch) -> None:
    client, repo, admin_h, make_user = env
    user_h, _user_id = make_user("alice_oai")

    async def _allow_dns(_url, *, allow_private: bool) -> None:
        return None

    monkeypatch.setattr("app.routers.providers.assert_url_allowed", _allow_dns)

    # Admin creates a system OpenAI-compatible provider without an API key (e.g. local LM Studio)
    r_sys = client.post(
        "/api/providers",
        headers=admin_h,
        json={
            "type": "openai_compat",
            "scope": "system",
            "color": "cyan",
            "is_enabled": True,
            "settings": {"base_url": "http://localhost:1234", "bearer_token": None},
        },
    )
    assert r_sys.status_code == 201, r_sys.text
    body_sys = r_sys.json()
    assert body_sys["type"] == "openai_compat"
    assert body_sys["name"] == "OpenAI API"
    assert body_sys["base_url"] == "http://localhost:1234/v1"
    assert body_sys["has_bearer_token"] is False

    # User creates a personal OpenAI-compatible provider with a server-stored key
    r_user = client.post(
        "/api/providers",
        headers=user_h,
        json={
            "name": "My Groq",
            "type": "openai_compat",
            "scope": "user",
            "color": "indigo",
            "is_enabled": True,
            "credential_storage": "server",
            "settings": {
                "base_url": "https://api.groq.com/openai/v1",
                "bearer_token": "gsk_user_secret",
            },
        },
    )
    assert r_user.status_code == 201, r_user.text
    body_user = r_user.json()
    assert body_user["name"] == "My Groq"
    assert body_user["base_url"] == "https://api.groq.com/openai/v1"
    assert body_user["has_bearer_token"] is True

    # Purging user credentials converts personal openai_compat to browser storage and clears secret
    purged_ids = repo.providers.purge_user_credentials()
    assert body_user["id"] in purged_ids
    reloaded = repo.providers.get(body_user["id"])
    assert reloaded is not None
    assert reloaded.secret_enc is None
    assert reloaded.credential_storage == "browser"
