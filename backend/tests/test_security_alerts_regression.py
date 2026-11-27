"""Regression tests for CodeQL security alert fixes."""

from __future__ import annotations

import contextlib
import json
import logging
import time

import pytest

from app.config import ModelProfile
from app.engine import llm_client as llm_mod
from app.engine.llm_client import CallTarget, LLMClient
from app.routers.campaign_routes.turn_streaming import _parse_search_slash_command


def test_parse_search_slash_command_parity_and_boundaries():
    assert _parse_search_slash_command("/search") == (True, None)
    assert _parse_search_slash_command("/SEARCH") == (True, None)
    assert _parse_search_slash_command("/investigate") == (True, None)
    assert _parse_search_slash_command("/inspect") == (True, None)
    assert _parse_search_slash_command("/search   ") == (True, None)
    assert _parse_search_slash_command("/search   behind the bar  ") == (
        True,
        "behind the bar",
    )
    assert _parse_search_slash_command("/inspect\tunder desk") == (True, "under desk")

    long_focus = "x" * 300
    matched, focus = _parse_search_slash_command(f"/search {long_focus}")
    assert matched is True
    assert focus == "x" * 240

    # Non-delimiter continuations and plain text must not match
    assert _parse_search_slash_command("") == (False, None)
    assert _parse_search_slash_command("/searchfoo") == (False, None)
    assert _parse_search_slash_command("/inspector gadget") == (False, None)
    assert _parse_search_slash_command("search the desk") == (False, None)

    # Multi-line messages must not match (preserving single-line `.` regex semantics)
    assert _parse_search_slash_command("/search desk\nnext line") == (False, None)
    assert _parse_search_slash_command("/search desk\r\nnext") == (False, None)


def test_parse_search_slash_command_redos_linear_time():
    adversarial = "/search" + (" " * 50000) + "a\nb"
    start = time.perf_counter()
    result = _parse_search_slash_command(adversarial)
    elapsed = time.perf_counter() - start
    assert result == (False, None)
    assert elapsed < 0.05


@pytest.mark.asyncio
async def test_stream_chat_fallback_sanitizes_logged_model_and_avoids_payload_leak(
    monkeypatch, caplog
):
    secret_sentinel = "SENSITIVE_PROMPT_SEX_MARKER"
    calls: list[dict] = []

    class _FakeResp:
        def __init__(self, status_code: int, lines: list[str] | None = None):
            self.status_code = status_code
            self._lines = lines or []

        async def aread(self) -> bytes:
            return b"model offline"

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        async def aiter_lines(self):
            for line in self._lines:
                yield line

    class _FakeClient:
        @contextlib.asynccontextmanager
        async def stream(self, method, url, headers=None, json=None, timeout=None):
            calls.append(dict(json or {}))
            if len(calls) == 1:
                yield _FakeResp(404)
            else:
                payload_line = (
                    "data: "
                    + json_mod.dumps({"choices": [{"delta": {"content": "ok"}}]})
                )
                yield _FakeResp(200, [payload_line, "data: [DONE]"])

    json_mod = json

    class _FakeAdapter:
        display_name = "OpenRouter"

        @staticmethod
        def build_chat_payload(
            *, model, messages, temperature, max_tokens, stream, disable_reasoning=False
        ):
            return {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": stream,
            }

        @staticmethod
        @contextlib.asynccontextmanager
        async def request_semaphore(headers):
            yield

        @staticmethod
        def next_bad_request_payload(payload, err_text, attempt):
            return None

        @staticmethod
        async def resolve_model_fallback(
            client, root_url, headers, current_model, status_code, err_text
        ):
            return ("fallback-model\r\nINJECTED_LOG", None)

        @staticmethod
        def chat_completions_url(root_url):
            return f"{root_url}/chat/completions"

    async def _fake_build_target(profile, role="model"):
        return CallTarget(
            root_url="https://openrouter.ai/api/v1",
            native_headers={},
            openai_headers={"Authorization": "Bearer test"},
            provider_type="openrouter",
            provider_name="OpenRouter",
        )

    client = LLMClient()
    monkeypatch.setattr(llm_mod, "build_call_target", _fake_build_target)
    monkeypatch.setattr(llm_mod, "get_openai_compat_provider", lambda _pt: _FakeAdapter())
    monkeypatch.setattr(llm_mod, "is_openai_compat_provider", lambda _pt: True)

    async def _fake_get_http_client(timeout=None):
        return _FakeClient()

    monkeypatch.setattr(client, "get_http_client", _fake_get_http_client)

    profile = ModelProfile(model="primary-model\nCR_TEST", base_url="https://openrouter.ai/api/v1")
    messages = [{"role": "user", "content": f"Sex: {secret_sentinel}"}]

    with caplog.at_level(logging.WARNING, logger="cybercantina.llm"):
        chunks = [
            chunk
            async for chunk in client.stream_chat(messages, profile=profile)
        ]

    assert chunks == ["ok"]
    assert len(calls) == 2
    assert calls[1]["model"] == "fallback-model\r\nINJECTED_LOG"

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "primary-model CR_TEST" in warnings[0]
    assert "fallback-model INJECTED_LOG" in warnings[0]
    assert "\n" not in warnings[0]
    assert "\r" not in warnings[0]
    assert secret_sentinel not in warnings[0]
