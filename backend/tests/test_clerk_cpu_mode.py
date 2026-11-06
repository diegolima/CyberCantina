"""Tests for Clerk 'Run on CPU' (Ollama num_gpu=0) and model separation safety guards."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import httpx

from app.config import AppSettings, ModelProfile, settings
from app.dependencies import (
    is_separate_clerk_model,
    normalize_model_tag,
    resolve_effective_models,
)
from app.engine.llm_client import LLMClient, format_ollama_keep_alive
from app.providers.endpoint import ResolvedEndpoint


def test_format_ollama_keep_alive() -> None:
    assert format_ollama_keep_alive(30) == "30m"
    assert format_ollama_keep_alive(60) == "60m"
    assert format_ollama_keep_alive(0) == 0
    assert format_ollama_keep_alive(-1) == "-1"
    assert format_ollama_keep_alive(None) == "30m"


def test_normalize_model_tag() -> None:
    assert normalize_model_tag("llama3.1:8b") == "llama3.1:8b"
    assert normalize_model_tag("llama3.1:8b:latest") == "llama3.1:8b"
    assert normalize_model_tag("Qwen2.5:3B:LATEST") == "qwen2.5:3b"
    assert normalize_model_tag("  Mistral:Latest  ") == "mistral"
    assert normalize_model_tag("") == ""


def test_is_separate_clerk_model_mirroring() -> None:
    actor = ModelProfile(model="llama3.1:8b")
    clerk = ModelProfile(model="qwen2.5:3b")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=True) is False


def test_is_separate_clerk_model_same_model_and_host() -> None:
    actor = ModelProfile(model="llama3.1:8b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="llama3.1:8b:latest", base_url="http://127.0.0.1:11434/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is False


def test_is_separate_clerk_model_different_models() -> None:
    actor = ModelProfile(model="llama3.1:8b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11434/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is True


def test_is_separate_clerk_model_same_model_different_hosts() -> None:
    actor = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11435/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is True


def test_resolve_effective_models_safety_override(monkeypatch: pytest.MonkeyPatch) -> None:
    # 1. When clerk and actor are separate and run_on_cpu is requested -> preserved
    monkeypatch.setattr(settings.actor_profile, "model", "llama3.1:8b")
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.clerk_profile, "run_on_cpu", True)
    monkeypatch.setattr(settings, "clerk_mirrors_actor", False)

    eff = resolve_effective_models(None)
    assert eff.clerk.run_on_cpu is True

    # 2. When clerk shares the same model as actor -> safety override forces False
    monkeypatch.setattr(settings.clerk_profile, "model", "llama3.1:8b:latest")
    eff_same = resolve_effective_models(None)
    assert eff_same.clerk.run_on_cpu is False

    # 3. When clerk mirrors actor -> safety override forces False
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings, "clerk_mirrors_actor", True)
    eff_mirror = resolve_effective_models(None)
    assert eff_mirror.clerk.run_on_cpu is False


@pytest.mark.asyncio
async def test_llm_client_injects_num_gpu_on_cpu_profile() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="qwen2.5:3b",
        base_url="http://localhost:11434/v1",
        run_on_cpu=True,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        resp = httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )
        return resp

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert req_json["options"]["num_gpu"] == 0


@pytest.mark.asyncio
async def test_llm_client_omits_num_gpu_when_run_on_cpu_is_false() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="llama3.1:8b",
        base_url="http://localhost:11434/v1",
        run_on_cpu=False,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        resp = httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )
        return resp

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert "num_gpu" not in req_json["options"]


@pytest.mark.asyncio
async def test_llm_client_injects_keep_alive() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="qwen2.5:3b",
        base_url="http://localhost:11434/v1",
        keep_alive_minutes=45,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        return httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert req_json["keep_alive"] == "45m"


@pytest.mark.asyncio
async def test_llm_client_omits_keep_alive_for_openrouter() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="meta-llama/llama-3.1-8b-instruct",
        base_url="https://openrouter.ai/api/v1",
        keep_alive_minutes=30,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_or",
        type="openrouter",
        root_url="https://openrouter.ai/api",
        bearer_token="sk-or-test",
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        return httpx.Response(
            status_code=200,
            json={"choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", str(url)),
        )

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert "keep_alive" not in req_json
