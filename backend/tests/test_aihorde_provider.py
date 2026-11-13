"""Unit tests for AI Horde provider integration."""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest

from app.config import ModelProfile
from app.engine.llm_client import (
    CallTarget,
    get_chat_completions_url,
    llm_client,
)
from app.providers.models import parse_aihorde_models
from app.providers.probe import _probe_once
from app.security.url_policy import AIHORDE_DEFAULT_BASE_URL, normalize_base_url


SAMPLE_AIHORDE_MODELS_PAYLOAD = {
    "object": "list",
    "data": [
        {
            "id": "koboldcpp/Slow-LowWorker-Model",
            "context_length": 4096,
            "architecture": {"modality": "text->text"},
            "x_horde": {"workers": 1, "queued": 500.0},
            "supported_parameters": ["max_tokens", "temperature"],
        },
        {
            "id": "koboldcpp/Fast-HighWorker-Model",
            "context_length": 8192,
            "architecture": {"modality": "text->text"},
            "x_horde": {"workers": 3, "queued": 50.0},
            "supported_parameters": ["max_tokens", "temperature", "reasoning_effort"],
        },
        {
            "id": "koboldcpp/MediumWorker-Model",
            "context_length": 16384,
            "architecture": {"modality": "text->text"},
            "x_horde": {"workers": 2, "queued": 10.0},
            "supported_parameters": ["max_tokens", "temperature", "response_format"],
        },
    ],
}


def test_parse_aihorde_models_option_a_ordering() -> None:
    models = parse_aihorde_models(SAMPLE_AIHORDE_MODELS_PAYLOAD)
    assert len(models) == 3

    # Option A capacity score: (workers * 1000) - queued
    # Fast: (3 * 1000) - 50 = 2950
    # Medium: (2 * 1000) - 10 = 1990
    # Slow: (1 * 1000) - 500 = 500
    assert models[0].name == "koboldcpp/Fast-HighWorker-Model"
    assert models[0].workers == 3
    assert models[0].queued == 50.0
    assert "8k ctx" in models[0].parameter_size
    assert "3w" in models[0].parameter_size
    assert "reasoning_effort" in models[0].supported_parameters
    assert models[0].is_embedding is False

    assert models[1].name == "koboldcpp/MediumWorker-Model"
    assert models[2].name == "koboldcpp/Slow-LowWorker-Model"


def test_normalize_base_url_aihorde_defaults() -> None:
    # Empty string should resolve to AIHORDE_DEFAULT_BASE_URL
    norm = normalize_base_url("", provider_type="aihorde")
    assert norm.root == AIHORDE_DEFAULT_BASE_URL
    assert norm.host == "oai.stablehorde.net"
    assert norm.scheme == "https"

    # URL without /v1 should automatically append /v1
    norm2 = normalize_base_url("https://oai.stablehorde.net", provider_type="aihorde")
    assert norm2.root == "https://oai.stablehorde.net/v1"

    # URL already with /v1
    norm3 = normalize_base_url("https://oai.stablehorde.net/v1", provider_type="aihorde")
    assert norm3.root == "https://oai.stablehorde.net/v1"


@pytest.mark.asyncio
async def test_probe_aihorde_success_and_anonymous_fallback() -> None:
    async def mock_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        # Should have received Bearer 0000000000 since token was empty
        assert request.headers["Authorization"] == "Bearer 0000000000"
        return httpx.Response(200, json=SAMPLE_AIHORDE_MODELS_PAYLOAD)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        outcome = await _probe_once(
            AIHORDE_DEFAULT_BASE_URL,
            token=None,  # Empty token
            provider_type="aihorde",
            restricted=False,
            client=client,
        )
        assert outcome.reachable is True
        assert outcome.protocol == "openai_compat"
        assert outcome.models is not None
        assert len(outcome.models) == 3
        assert outcome.models[0].name == "koboldcpp/Fast-HighWorker-Model"


@pytest.mark.asyncio
async def test_probe_aihorde_error_codes() -> None:
    async def mock_401(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Invalid key"})

    transport = httpx.MockTransport(mock_401)
    async with httpx.AsyncClient(transport=transport) as client:
        outcome = await _probe_once(
            AIHORDE_DEFAULT_BASE_URL,
            token="invalid_key",
            provider_type="aihorde",
            restricted=False,
            client=client,
        )
        assert outcome.reachable is False
        assert outcome.error_code == "unauthorized"


def test_aihorde_call_target_and_url() -> None:
    target = CallTarget(
        root_url="https://oai.stablehorde.net/v1",
        native_headers={},
        openai_headers={"Authorization": "Bearer 0000000000"},
        provider_type="aihorde",
    )
    url = get_chat_completions_url(target)
    assert url == "https://oai.stablehorde.net/v1/chat/completions"


@pytest.mark.asyncio
async def test_aihorde_complete_text_clamps_tokens_and_reasoning(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payloads = []

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        import json
        payload = json.loads(request.content)
        captured_payloads.append(payload)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello from Horde!"}}],
            },
        )

    transport = httpx.MockTransport(mock_handler)
    mock_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr(llm_client, "get_http_client", AsyncMock(return_value=mock_client))

    target = CallTarget(
        root_url="https://oai.stablehorde.net/v1",
        native_headers={},
        openai_headers={"Authorization": "Bearer 0000000000"},
        provider_type="aihorde",
    )
    monkeypatch.setattr("app.engine.llm_client.build_call_target", AsyncMock(return_value=target))

    profile = ModelProfile(model="koboldcpp/Fast-HighWorker-Model", max_tokens=100)
    resp = await llm_client.complete_text(
        messages=[{"role": "user", "content": "Hi"}],
        profile=profile,
        max_tokens=8,  # < 16 tokens passed explicitly!
        disable_reasoning=True,
    )
    assert resp == "Hello from Horde!"
    assert len(captured_payloads) == 1
    # Check max_tokens was clamped to 16
    assert captured_payloads[0]["max_tokens"] == 16
    # Check reasoning_effort was set to "none"
    assert captured_payloads[0]["reasoning_effort"] == "none"


@pytest.mark.asyncio
async def test_aihorde_offline_model_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    # First request with offline model returns 404 UnknownChatModel
    # Second request to /v1/models returns catalog
    # Third request with fallback model succeeds
    call_count = 0

    async def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json=SAMPLE_AIHORDE_MODELS_PAYLOAD)

        import json
        payload = json.loads(request.content)
        if payload["model"] == "offline_model":
            return httpx.Response(
                404,
                json={"error": {"code": "UnknownChatModel", "message": "The model offline_model is not known"}},
            )
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-fallback",
                "object": "chat.completion",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "Fallback success!"}}],
            },
        )

    transport = httpx.MockTransport(mock_handler)
    mock_client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr(llm_client, "get_http_client", AsyncMock(return_value=mock_client))

    target = CallTarget(
        root_url="https://oai.stablehorde.net/v1",
        native_headers={},
        openai_headers={"Authorization": "Bearer 0000000000"},
        provider_type="aihorde",
    )
    monkeypatch.setattr("app.engine.llm_client.build_call_target", AsyncMock(return_value=target))

    profile = ModelProfile(model="offline_model", max_tokens=100)
    resp = await llm_client.complete_text(
        messages=[{"role": "user", "content": "Hi"}],
        profile=profile,
    )
    assert resp == "Fallback success!"
