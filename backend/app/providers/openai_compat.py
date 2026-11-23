"""Generic OpenAI-compatible provider adapter and provider-specific extensions."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import ssl
from dataclasses import dataclass
from typing import Any

import httpx

from app.providers.models import (
    parse_aihorde_models,
    parse_nanogpt_models,
    parse_openai_models,
)
from app.providers.openrouter_catalog import openrouter_catalog_service
from app.schemas.provider import ProbeErrorCode, ProviderModelInfo
from app.security.url_policy import (
    AIHORDE_DEFAULT_BASE_URL,
    NANOGPT_DEFAULT_BASE_URL,
    OPENROUTER_DEFAULT_BASE_URL,
)

logger = logging.getLogger("cybercantina.providers.openai_compat")

_AIHORDE_ANON_TOKEN = "0000000000"
_AIHORDE_ANON_SEMAPHORE = asyncio.Semaphore(1)


def bearer_headers(token: str | None) -> dict[str, str]:
    """Turn an optional bearer token into request headers (never set on shared clients)."""
    cleaned = (token or "").strip()
    return {"Authorization": f"Bearer {cleaned}"} if cleaned else {}


@dataclass
class ProbeOutcome:
    """Normalized result of a single provider probe attempt."""

    reachable: bool
    protocol: str | None = None
    models: list[ProviderModelInfo] | None = None
    error_code: ProbeErrorCode | None = None
    error: str | None = None


def classify_probe_exception(exc: Exception) -> tuple[ProbeErrorCode, str]:
    """Map httpx / asyncio network exceptions to a closed set of ProbeErrorCode values."""
    text = str(exc) or exc.__class__.__name__
    if isinstance(exc, (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout, asyncio.TimeoutError)):
        return "timeout", text
    if isinstance(exc, httpx.ConnectError):
        cause = exc.__cause__ or exc.__context__
        if isinstance(cause, ssl.SSLError) or "ssl" in text.lower() or "certificate" in text.lower():
            return "tls_error", text
        lowered = text.lower()
        if "name or service not known" in lowered or "nodename nor servname" in lowered or "getaddrinfo" in lowered:
            return "dns_failure", text
        return "connect_refused", text
    return "unknown", text


class OpenAICompatProvider:
    """Base adapter for any OpenAI-compatible HTTP API (/models, /chat/completions, /embeddings)."""

    provider_type: str = "openai_compat"
    display_name: str = "OpenAI API"
    default_base_url: str | None = None
    requires_server_api_key: bool = False
    persist_probed_models: bool = True
    min_max_tokens: int | None = None
    include_referer_headers: bool = False
    probe_timeout_seconds: float = 5.0

    def effective_token(self, token: str | None) -> str | None:
        cleaned = (token or "").strip()
        return cleaned or None

    def models_url(self, root_url: str) -> str:
        return f"{root_url.rstrip('/')}/models"

    def chat_completions_url(self, root_url: str) -> str:
        return f"{root_url.rstrip('/')}/chat/completions"

    def embeddings_url(self, root_url: str) -> str:
        return f"{root_url.rstrip('/')}/embeddings"

    def build_probe_headers(self, token: str | None) -> dict[str, str]:
        return bearer_headers(self.effective_token(token))

    def build_chat_headers(self, token: str | None, *, referer_url: str) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        eff = self.effective_token(token)
        if eff:
            headers["Authorization"] = f"Bearer {eff}"
        if self.include_referer_headers:
            headers["HTTP-Referer"] = referer_url
            headers["X-Title"] = "Cybercantina"
        return headers

    def parse_models(self, payload: dict[str, Any]) -> list[ProviderModelInfo]:
        return parse_openai_models(payload)

    def _map_probe_http_error(self, status_code: int) -> ProbeOutcome:
        if status_code == 401:
            return ProbeOutcome(False, error_code="unauthorized", error=f"Invalid {self.display_name} API key.")
        if status_code == 403:
            return ProbeOutcome(False, error_code="forbidden", error=f"{self.display_name} access forbidden.")
        if status_code == 404:
            return ProbeOutcome(False, error_code="not_found", error=f"{self.display_name} /models endpoint was not found.")
        if status_code == 502:
            return ProbeOutcome(False, error_code="connect_refused", error=f"{self.display_name} gateway unavailable (502).")
        return ProbeOutcome(False, error_code="unknown", error=f"HTTP {status_code}")

    async def probe(
        self,
        root_url: str,
        token: str | None,
        *,
        client: httpx.AsyncClient,
    ) -> ProbeOutcome:
        """Probe an OpenAI-compatible server via GET {root_url}/models."""
        headers = self.build_probe_headers(token)
        try:
            resp = await client.get(
                self.models_url(root_url),
                headers=headers,
                timeout=self.probe_timeout_seconds,
            )
            if resp.status_code == 200:
                try:
                    payload = resp.json()
                except ValueError:
                    return ProbeOutcome(
                        False,
                        error_code="bad_payload",
                        error=f"{self.display_name} returned a non-JSON model list.",
                    )
                if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                    return ProbeOutcome(
                        False,
                        error_code="bad_payload",
                        error=f"{self.display_name} returned an unexpected model list.",
                    )
                try:
                    models = self.parse_models(payload)
                except (ValueError, KeyError):
                    return ProbeOutcome(
                        False,
                        error_code="bad_payload",
                        error=f"{self.display_name} returned a malformed model list.",
                    )
                return ProbeOutcome(True, "openai_compat", models)
            return self._map_probe_http_error(resp.status_code)
        except Exception as exc:  # noqa: BLE001
            code, text = classify_probe_exception(exc)
            return ProbeOutcome(False, error_code=code, error=text)

    def build_chat_payload(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float,
        max_tokens: int,
        stream: bool,
        json_mode: bool = False,
        json_schema: dict[str, Any] | None = None,
        disable_reasoning: bool = False,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
    ) -> dict[str, Any]:
        eff_max_tokens = max(max_tokens, self.min_max_tokens) if self.min_max_tokens else max_tokens
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": eff_max_tokens,
            "stream": stream,
        }
        if not stream and (json_mode or json_schema is not None):
            payload["response_format"] = {"type": "json_object"}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice or "auto"
        if disable_reasoning:
            self.apply_disable_reasoning(payload)
        return payload

    def apply_disable_reasoning(self, payload: dict[str, Any]) -> None:
        """Hook for providers with reasoning-suppression fields (no-op on generic OpenAI APIs)."""
        return None

    def next_bad_request_payload(
        self,
        payload: dict[str, Any],
        error_text_lower: str,
        attempt: int,
    ) -> dict[str, Any] | None:
        """Return an adjusted payload to retry on HTTP 400, or None to stop retrying."""
        return None

    def request_semaphore(self, headers: dict[str, str]) -> contextlib.AbstractAsyncContextManager[Any]:
        return contextlib.nullcontext()

    async def resolve_model_fallback(
        self,
        client: httpx.AsyncClient,
        root_url: str,
        headers: dict[str, str],
        current_model: str,
        status_code: int,
        error_text: str,
    ) -> tuple[str | None, str | None]:
        """Optional hook for providers that can substitute an offline model.

        Returns ``(fallback_model, fatal_error_message)``.
        """
        return None, None


class _ReasoningObjectOpenAICompatProvider(OpenAICompatProvider):
    """Shared reasoning-object suppression behavior for OpenRouter and NanoGPT."""

    include_referer_headers: bool = True
    requires_server_api_key: bool = True

    def apply_disable_reasoning(self, payload: dict[str, Any]) -> None:
        payload["reasoning"] = {"effort": "none"}

    def next_bad_request_payload(
        self,
        payload: dict[str, Any],
        error_text_lower: str,
        attempt: int,
    ) -> dict[str, Any] | None:
        if "reasoning" not in payload or "reasoning" not in error_text_lower:
            return None
        retry = dict(payload)
        if attempt == 0:
            retry["reasoning"] = {"exclude": True}
            return retry
        if attempt == 1:
            retry.pop("reasoning", None)
            return retry
        return None


class OpenRouterProvider(_ReasoningObjectOpenAICompatProvider):
    """OpenRouter cloud API extension: /auth/key probe + shared catalog cache."""

    provider_type: str = "openrouter"
    display_name: str = "OpenRouter"
    default_base_url: str | None = OPENROUTER_DEFAULT_BASE_URL
    persist_probed_models: bool = False

    async def probe(
        self,
        root_url: str,
        token: str | None,
        *,
        client: httpx.AsyncClient,
    ) -> ProbeOutcome:
        if not self.effective_token(token):
            return ProbeOutcome(False, error_code="unauthorized", error="OpenRouter API key is required.")
        auth_url = f"{root_url.rstrip('/')}/auth/key"
        try:
            resp = await client.get(
                auth_url,
                headers=self.build_probe_headers(token),
                timeout=self.probe_timeout_seconds,
            )
            if resp.status_code == 200:
                try:
                    models = await openrouter_catalog_service.get_models(client=client)
                except Exception:  # noqa: BLE001
                    models = openrouter_catalog_service.get_cached_models_sync()
                return ProbeOutcome(True, "openai_compat", models)
            if resp.status_code == 401:
                return ProbeOutcome(False, error_code="unauthorized", error="Invalid OpenRouter API key.")
            if resp.status_code == 403:
                return ProbeOutcome(False, error_code="forbidden", error="OpenRouter API key forbidden or restricted.")
            return ProbeOutcome(False, error_code="unknown", error=f"HTTP {resp.status_code}")
        except Exception as exc:  # noqa: BLE001
            code, text = classify_probe_exception(exc)
            return ProbeOutcome(False, error_code=code, error=text)


class NanoGPTProvider(_ReasoningObjectOpenAICompatProvider):
    """NanoGPT cloud API extension: /models + supplemental /embedding-models catalog."""

    provider_type: str = "nanogpt"
    display_name: str = "NanoGPT"
    default_base_url: str | None = NANOGPT_DEFAULT_BASE_URL

    async def probe(
        self,
        root_url: str,
        token: str | None,
        *,
        client: httpx.AsyncClient,
    ) -> ProbeOutcome:
        root = root_url.rstrip("/")
        headers = self.build_probe_headers(token)
        try:
            resp = await client.get(
                self.models_url(root),
                headers=headers,
                timeout=self.probe_timeout_seconds,
            )
            if resp.status_code == 200:
                try:
                    chat_payload = resp.json()
                except ValueError:
                    return ProbeOutcome(False, error_code="bad_payload", error="NanoGPT returned a non-JSON model list.")
                if not isinstance(chat_payload, dict) or not isinstance(chat_payload.get("data"), list):
                    return ProbeOutcome(False, error_code="bad_payload", error="NanoGPT returned an unexpected model list.")
                embed_payload: dict[str, Any] | None = None
                try:
                    embed_resp = await client.get(f"{root}/embedding-models", headers=headers, timeout=3.0)
                    if embed_resp.status_code == 200:
                        candidate = embed_resp.json()
                        if isinstance(candidate, dict) and isinstance(candidate.get("data"), list):
                            embed_payload = candidate
                except Exception:  # noqa: BLE001 - embedding catalog is supplemental to chat models
                    embed_payload = None
                return ProbeOutcome(True, "openai_compat", parse_nanogpt_models(chat_payload, embed_payload))
            return self._map_probe_http_error(resp.status_code)
        except Exception as exc:  # noqa: BLE001
            code, text = classify_probe_exception(exc)
            return ProbeOutcome(False, error_code=code, error=text)


class AIHordeProvider(OpenAICompatProvider):
    """AI Horde crowdsourced gateway extension: anonymous key fallback, capacity sorting, offline model fallback."""

    provider_type: str = "aihorde"
    display_name: str = "AI Horde"
    default_base_url: str | None = AIHORDE_DEFAULT_BASE_URL
    requires_server_api_key: bool = False
    min_max_tokens: int | None = 16
    include_referer_headers: bool = True

    def effective_token(self, token: str | None) -> str | None:
        return (token or "").strip() or _AIHORDE_ANON_TOKEN

    def parse_models(self, payload: dict[str, Any]) -> list[ProviderModelInfo]:
        return parse_aihorde_models(payload)

    def apply_disable_reasoning(self, payload: dict[str, Any]) -> None:
        payload["reasoning_effort"] = "none"

    def next_bad_request_payload(
        self,
        payload: dict[str, Any],
        error_text_lower: str,
        attempt: int,
    ) -> dict[str, Any] | None:
        if "reasoning_effort" not in payload:
            return None
        retry = dict(payload)
        retry.pop("reasoning_effort", None)
        return retry

    def request_semaphore(self, headers: dict[str, str]) -> contextlib.AbstractAsyncContextManager[Any]:
        if _AIHORDE_ANON_TOKEN in headers.get("Authorization", ""):
            return _AIHORDE_ANON_SEMAPHORE
        return contextlib.nullcontext()

    async def resolve_model_fallback(
        self,
        client: httpx.AsyncClient,
        root_url: str,
        headers: dict[str, str],
        current_model: str,
        status_code: int,
        error_text: str,
    ) -> tuple[str | None, str | None]:
        lowered = error_text.lower()
        if status_code not in (403, 404) or not (
            "unknownchatmodel" in lowered or "noeligibleworker" in lowered or "model" in lowered
        ):
            return None, None
        try:
            resp = await client.get(self.models_url(root_url), headers=headers, timeout=5.0)
            if resp.status_code == 200:
                parsed = parse_aihorde_models(resp.json())
                for model_info in parsed:
                    if model_info.name != current_model:
                        return model_info.name, None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to fetch AI Horde fallback models: %s", exc)
        return (
            None,
            f"AI Horde model '{current_model}' is currently offline on the network (no workers available). "
            "Please choose an active model in Settings.",
        )


DEFAULT_OPENAI_COMPAT_PROVIDER = OpenAICompatProvider()

OPENAI_COMPAT_PROVIDERS: dict[str, OpenAICompatProvider] = {
    adapter.provider_type: adapter
    for adapter in (
        DEFAULT_OPENAI_COMPAT_PROVIDER,
        OpenRouterProvider(),
        NanoGPTProvider(),
        AIHordeProvider(),
    )
}

OPENAI_COMPAT_PROVIDER_TYPES: tuple[str, ...] = tuple(OPENAI_COMPAT_PROVIDERS.keys())


def get_openai_compat_provider(provider_type: str) -> OpenAICompatProvider | None:
    """Return the OpenAI-compatible adapter for ``provider_type``, or None for non-OpenAI-compat types."""
    return OPENAI_COMPAT_PROVIDERS.get(provider_type)


def is_openai_compat_provider(provider_type: str) -> bool:
    """Return True if ``provider_type`` is handled by the OpenAI-compatible adapter hierarchy."""
    return provider_type in OPENAI_COMPAT_PROVIDERS
