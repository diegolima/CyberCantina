"""Ollama-first & OpenAI-compatible LLM client with model discovery and grammar-constrained JSON."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, Field

from app.config import ModelProfile, persist_settings, settings
from app.providers.models import parse_aihorde_models, parse_ollama_tags
from app.providers.probe import bearer_headers
from app.providers.resolver import ProviderUnavailableError, resolve_system_profile
from app.security.url_policy import UrlBlockedError, assert_url_allowed, normalize_base_url

logger = logging.getLogger("cybercantina.llm")

T = TypeVar("T", bound=BaseModel)

_THINK_BLOCK_RE = re.compile(r"<(?:think|thought)>.*?</(?:think|thought)>", re.DOTALL | re.I)
_UNCLOSED_THINK_RE = re.compile(r"^.*?<(?:think|thought)>", re.DOTALL | re.I)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_EMBED_MODEL_KEYWORDS = ("embed", "minilm", "bge-", "nomic-embed", "mxbai-embed", "arctic-embed")
_AIHORDE_ANON_SEMAPHORE = asyncio.Semaphore(1)


async def _get_aihorde_fallback_model(
    client: httpx.AsyncClient, root_url: str, headers: dict[str, str], exclude_model: str
) -> str | None:
    """Fetch active models from AI Horde and return the top-ranked alternative model."""
    try:
        models_url = f"{root_url.rstrip('/')}/models"
        resp = await client.get(models_url, headers=headers, timeout=5.0)
        if resp.status_code == 200:
            parsed = parse_aihorde_models(resp.json())
            for m in parsed:
                if m.name != exclude_model:
                    return m.name
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch AI Horde fallback models: %s", exc)
    return None


class OllamaModelInfo(BaseModel):
    """Metadata for a locally installed Ollama model from /api/tags."""

    name: str
    size_mb: int = 0
    parameter_size: str = ""
    quantization_level: str = ""
    family: str = ""
    is_embedding: bool = False


class OllamaStatusResponse(BaseModel):
    """Live connection status and available models from the Ollama server."""

    reachable: bool
    ollama_root_url: str
    error: str | None = None
    models: list[OllamaModelInfo] = Field(default_factory=list)
    chat_models: list[str] = Field(default_factory=list)
    embedding_models: list[str] = Field(default_factory=list)
    active_actor_model: str
    active_clerk_model: str


def get_ollama_root_url(base_url: str) -> str:
    """Normalize 'http://localhost:11434/v1' or 'http://localhost:11434/' to 'http://localhost:11434'."""
    cleaned = base_url.strip().rstrip("/")
    if cleaned.endswith("/v1"):
        cleaned = cleaned[: -len("/v1")].rstrip("/")
    if cleaned.endswith("/api"):
        cleaned = cleaned[: -len("/api")].rstrip("/")
    return cleaned


def get_openai_v1_url(base_url: str) -> str:
    """Normalize a base URL so it ends with '/v1' for OpenAI-compatible routes."""
    cleaned = base_url.strip().rstrip("/")
    if not cleaned.endswith("/v1"):
        cleaned = f"{cleaned}/v1"
    return cleaned


@dataclass(frozen=True)
class CallTarget:
    """Everything needed to call one role's endpoint, with auth applied on every request."""

    root_url: str
    native_headers: dict[str, str]
    openai_headers: dict[str, str]
    provider_type: str = "ollama"


def get_chat_completions_url(target: CallTarget) -> str:
    if target.provider_type in ("openrouter", "aihorde"):
        return f"{target.root_url.rstrip('/')}/chat/completions"
    return f"{get_openai_v1_url(target.root_url)}/chat/completions"


async def build_call_target(profile: ModelProfile, role: str = "model") -> CallTarget:
    """Resolve a profile to a call target.

    Provider-backed profiles use the resolved endpoint (bearer token applied to native AND
    OpenAI-compatible calls); legacy profiles keep the previous behavior. Provider-backed endpoints
    owned by non-admin users are re-validated against the SSRF policy right before use.
    """
    endpoint = profile.resolved or (resolve_system_profile(profile, role) if profile.provider_id else None)
    if endpoint is not None:
        ptype = endpoint.type
        if endpoint.network_restricted:
            try:
                await assert_url_allowed(normalize_base_url(endpoint.root_url, provider_type=ptype), allow_private=False)
            except UrlBlockedError as exc:
                raise RuntimeError(f"Provider endpoint blocked by network policy: {exc}") from exc
        if ptype == "openrouter":
            oai = {
                "Authorization": f"Bearer {endpoint.bearer_token or ''}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Cybercantina",
            }
            return CallTarget(endpoint.root_url, {}, oai, provider_type="openrouter")

        if ptype == "aihorde":
            token = (endpoint.bearer_token or "").strip() or "0000000000"
            oai = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Cybercantina",
            }
            return CallTarget(endpoint.root_url, {}, oai, provider_type="aihorde")

        native = bearer_headers(endpoint.bearer_token)
        oai = {"Authorization": f"Bearer {endpoint.bearer_token or 'ollama'}", "Content-Type": "application/json"}
        return CallTarget(get_ollama_root_url(endpoint.root_url), native, oai, provider_type="ollama")
    legacy_token = profile.api_key if profile.api_key not in ("", "ollama") else None
    return CallTarget(
        get_ollama_root_url(profile.base_url),
        bearer_headers(legacy_token),
        {"Authorization": f"Bearer {profile.api_key}", "Content-Type": "application/json"},
        provider_type="ollama",
    )


def extract_json_object(raw_text: str) -> dict[str, Any]:
    """Robustly extract a JSON object from LLM output, stripping <think>/<thought> blocks and markdown fences."""
    cleaned = _THINK_BLOCK_RE.sub("", raw_text or "").strip()
    match = _JSON_BLOCK_RE.search(cleaned)
    if match:
        cleaned = match.group(1).strip()
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]
    if not cleaned:
        raise ValueError(
            "LLM returned an empty response instead of JSON (thinking tokens may have exhausted max_tokens)."
        )
    return json.loads(cleaned)


async def query_ollama_status(
    base_url: str | None = None, *, bearer_token: str | None = None
) -> OllamaStatusResponse:
    """Query Ollama's /api/tags endpoint to list installed models and verify connectivity (legacy path)."""
    target_url = base_url or settings.actor_profile.base_url
    root_url = get_ollama_root_url(target_url)
    tags_url = f"{root_url}/api/tags"

    try:
        client = await llm_client.get_http_client(timeout=5.0)
        resp = await client.get(tags_url, headers=bearer_headers(bearer_token), timeout=5.0)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        return OllamaStatusResponse(
            reachable=False,
            ollama_root_url=root_url,
            error=str(exc),
            active_actor_model=settings.actor_profile.model,
            active_clerk_model=settings.clerk_profile.model,
        )

    parsed = parse_ollama_tags(payload)
    models = [OllamaModelInfo(**m.model_dump()) for m in parsed]
    return OllamaStatusResponse(
        reachable=True,
        ollama_root_url=root_url,
        models=models,
        chat_models=[m.name for m in parsed if not m.is_embedding],
        embedding_models=[m.name for m in parsed if m.is_embedding],
        active_actor_model=settings.actor_profile.model,
        active_clerk_model=settings.clerk_profile.model,
    )


async def _status_for_profile(profile: ModelProfile, role: str) -> OllamaStatusResponse | None:
    """Status for the endpoint serving ``profile`` (provider-backed or legacy); None if unresolvable."""
    try:
        endpoint = resolve_system_profile(profile, role) if profile.provider_id else None
    except ProviderUnavailableError as exc:
        logger.warning("Skipping model auto-configuration for %s: %s", role, exc)
        return None
    if endpoint is not None:
        return await query_ollama_status(endpoint.root_url, bearer_token=endpoint.bearer_token)
    return await query_ollama_status(profile.base_url)


async def auto_configure_ollama_models() -> OllamaStatusResponse:
    """On startup, inspect each role's own provider and auto-select installed models if the saved ones are missing.

    Only startup defaults are touched (never user overrides), a role whose provider cannot be
    resolved or reached is left alone, and nothing is persisted unless a model really changed.
    """
    actor_status = await _status_for_profile(settings.actor_profile, "actor")
    if actor_status is None:
        actor_status = OllamaStatusResponse(
            reachable=False,
            ollama_root_url="",
            error="Actor provider is unavailable.",
            active_actor_model=settings.actor_profile.model,
            active_clerk_model=settings.clerk_profile.model,
        )
    clerk_status = (
        actor_status
        if settings.clerk_profile.provider_id == settings.actor_profile.provider_id
        and settings.clerk_profile.base_url == settings.actor_profile.base_url
        else await _status_for_profile(settings.clerk_profile, "clerk")
    )

    def _is_installed(installed: set[str], model_name: str) -> bool:
        # Also allow matching without ':latest' suffix
        return model_name in installed or f"{model_name}:latest" in installed

    changed = False
    for role, profile, status in (
        ("Actor", settings.actor_profile, actor_status),
        ("Auxiliary Clerk", settings.clerk_profile, clerk_status),
    ):
        if status is None or not status.reachable:
            if status is not None:
                logger.warning(
                    "Ollama not reachable at %s (%s). Configure the provider in Admin > Providers or start `ollama serve`.",
                    status.ollama_root_url,
                    status.error,
                )
            continue
        if not status.chat_models:
            continue
        if not _is_installed(set(status.chat_models), profile.model):
            old = profile.model
            profile.model = status.chat_models[0]
            logger.info(
                "Auto-selected installed Ollama model '%s' for %s (previous '%s' was not installed).",
                profile.model,
                role,
                old,
            )
            changed = True

    embedding = settings.embedding_profile
    if embedding.mode == "openai_compat":
        try:
            emb_endpoint = resolve_system_profile(embedding, "embedding") if embedding.provider_id else None  # type: ignore[arg-type]
        except ProviderUnavailableError:
            emb_endpoint = None
        if emb_endpoint is not None:
            emb_status = await query_ollama_status(emb_endpoint.root_url, bearer_token=emb_endpoint.bearer_token)
        else:
            emb_status = actor_status if actor_status.reachable else None
        if emb_status and emb_status.reachable and emb_status.embedding_models and embedding.model not in emb_status.embedding_models:
            embedding.model = emb_status.embedding_models[0]
            logger.warning(
                "Embedding model auto-selected as '%s'; existing memories embedded with another model "
                "will be ignored until reindexed (Admin > Models).",
                embedding.model,
            )
            changed = True

    if changed:
        try:
            persist_settings(settings)
        except OSError as exc:
            logger.error("Could not persist auto-configured models: %s", exc)
        actor_status.active_actor_model = settings.actor_profile.model
        actor_status.active_clerk_model = settings.clerk_profile.model

    return actor_status


class LLMClient:
    """Async client supporting both native Ollama (/api/chat) and OpenAI-compatible (/v1/chat/completions)."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def get_http_client(self, timeout: float | None = None) -> httpx.AsyncClient:
        """Return a persistent AsyncClient connection pool, recreating if closed."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
                timeout=timeout or 120.0,
            )
        return self._client

    async def close(self) -> None:
        """Gracefully close the HTTP client connection pool on app shutdown."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def complete_text(
        self,
        messages: list[dict[str, str]],
        *,
        profile: ModelProfile | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
        json_schema: dict[str, Any] | None = None,
        disable_reasoning: bool = False,
    ) -> str:
        """Execute a non-streaming chat completion call against Ollama or OpenAI-compatible server."""
        active_profile = profile or settings.clerk_profile
        temp = temperature if temperature is not None else active_profile.temperature
        max_tok = max_tokens if max_tokens is not None else active_profile.max_tokens

        target = await build_call_target(active_profile)
        client = await self.get_http_client(timeout=active_profile.timeout_seconds)

        # 1. Try native Ollama /api/chat first (only for Ollama providers)
        if target.provider_type not in ("openrouter", "aihorde"):
            ollama_root = target.root_url
            ollama_chat_url = f"{ollama_root}/api/chat"
            ollama_opts: dict[str, Any] = {
                "temperature": temp,
                "num_predict": max_tok,
            }
            if getattr(active_profile, "run_on_cpu", False):
                ollama_opts["num_gpu"] = 0
            ollama_payload: dict[str, Any] = {
                "model": active_profile.model,
                "messages": messages,
                "stream": False,
                "think": False,
                "options": ollama_opts,
            }
            if json_schema is not None:
                ollama_payload["format"] = json_schema
            elif json_mode:
                ollama_payload["format"] = "json"

            try:
                resp = await client.post(ollama_chat_url, headers=target.native_headers, json=ollama_payload, timeout=active_profile.timeout_seconds)
                if resp.status_code == 400:
                    retry_payload = {k: v for k, v in ollama_payload.items() if k != "think"}
                    retry_opts = {
                        "temperature": temp,
                        "num_predict": max(max_tok * 3, 4096),
                    }
                    if getattr(active_profile, "run_on_cpu", False):
                        retry_opts["num_gpu"] = 0
                    retry_payload["options"] = retry_opts
                    resp = await client.post(ollama_chat_url, headers=target.native_headers, json=retry_payload, timeout=active_profile.timeout_seconds)

                if resp.status_code == 200:
                    data = resp.json()
                    msg = data.get("message") or {}
                    content = (msg.get("content") or "").strip()
                    if content:
                        return content

                    if json_schema is not None or data.get("done_reason") == "length":
                        fallback_payload = dict(ollama_payload)
                        if json_schema is not None:
                            fallback_payload["format"] = "json"
                        fb_opts = {
                            "temperature": temp,
                            "num_predict": max(max_tok * 3, 4096),
                        }
                        if getattr(active_profile, "run_on_cpu", False):
                            fb_opts["num_gpu"] = 0
                        fallback_payload["options"] = fb_opts
                        retry_resp = await client.post(ollama_chat_url, headers=target.native_headers, json=fallback_payload, timeout=active_profile.timeout_seconds)
                        if retry_resp.status_code == 200:
                            retry_data = retry_resp.json()
                            retry_msg = retry_data.get("message") or {}
                            retry_content = (retry_msg.get("content") or "").strip()
                            if retry_content:
                                return retry_content
                            thinking_fallback = (retry_msg.get("thinking") or "").strip()
                            if thinking_fallback and "{" in thinking_fallback:
                                return thinking_fallback

                    thinking_text = (msg.get("thinking") or "").strip()
                    if thinking_text and "{" in thinking_text:
                        return thinking_text
                elif resp.status_code == 404:
                    err_body = resp.text
                    if "model" in err_body.lower() and "not found" in err_body.lower():
                        raise RuntimeError(
                            f"Ollama model '{active_profile.model}' is not installed. "
                            f"Run `ollama pull {active_profile.model}` or select an installed model in Settings."
                        )
            except RuntimeError:
                raise
            except httpx.HTTPError:
                pass

        # 2. OpenAI-compatible / OpenRouter / AI Horde /chat/completions endpoint
        v1_url = get_chat_completions_url(target)
        headers = target.openai_headers
        if target.provider_type == "aihorde":
            max_tok = max(max_tok, 16)
        oai_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "temperature": temp,
            "max_tokens": max_tok,
            "stream": False,
        }
        if json_mode or json_schema is not None:
            oai_payload["response_format"] = {"type": "json_object"}
        if target.provider_type == "openrouter" and disable_reasoning:
            oai_payload["reasoning"] = {"effort": "none"}
        elif target.provider_type == "aihorde" and disable_reasoning:
            oai_payload["reasoning_effort"] = "none"

        is_horde_anon = target.provider_type == "aihorde" and "0000000000" in headers.get("Authorization", "")
        sem = _AIHORDE_ANON_SEMAPHORE if is_horde_anon else contextlib.nullcontext()

        async with sem:
            resp = await client.post(v1_url, headers=headers, json=oai_payload, timeout=active_profile.timeout_seconds)
            if resp.status_code == 400 and target.provider_type == "openrouter" and disable_reasoning and "reasoning" in resp.text.lower():
                # If the model enforces reasoning (e.g. DeepSeek R1), retry with exclude: True to omit CoT
                retry_oai = dict(oai_payload)
                retry_oai["reasoning"] = {"exclude": True}
                resp = await client.post(v1_url, headers=headers, json=retry_oai, timeout=active_profile.timeout_seconds)
                if resp.status_code == 400 and "reasoning" in resp.text.lower():
                    retry_oai.pop("reasoning", None)
                    resp = await client.post(v1_url, headers=headers, json=retry_oai, timeout=active_profile.timeout_seconds)
            elif resp.status_code == 400 and target.provider_type == "aihorde" and "reasoning_effort" in oai_payload:
                retry_oai = dict(oai_payload)
                retry_oai.pop("reasoning_effort", None)
                resp = await client.post(v1_url, headers=headers, json=retry_oai, timeout=active_profile.timeout_seconds)

            if target.provider_type == "aihorde" and resp.status_code in (404, 403) and ("unknownchatmodel" in resp.text.lower() or "noeligibleworker" in resp.text.lower() or "model" in resp.text.lower()):
                fallback = await _get_aihorde_fallback_model(client, target.root_url, headers, active_profile.model)
                if fallback:
                    logger.warning("AI Horde model '%s' offline; attempting fallback to '%s'", active_profile.model, fallback)
                    fallback_payload = dict(oai_payload)
                    fallback_payload["model"] = fallback
                    fallback_resp = await client.post(v1_url, headers=headers, json=fallback_payload, timeout=active_profile.timeout_seconds)
                    if fallback_resp.status_code == 200:
                        resp = fallback_resp
                    else:
                        raise RuntimeError(
                            f"AI Horde model '{active_profile.model}' is offline, and automatic fallback to '{fallback}' failed (HTTP {fallback_resp.status_code}: {fallback_resp.text}). Please choose an active model in Settings."
                        )
                else:
                    raise RuntimeError(
                        f"AI Horde model '{active_profile.model}' is currently offline on the network (no workers available). Please choose an active model in Settings."
                    )

            if resp.status_code == 404 and "model" in resp.text.lower():
                raise RuntimeError(
                    f"Model '{active_profile.model}' not found at {v1_url}: {resp.text}"
                )
            resp.raise_for_status()
        data = resp.json()
        choice_msg = data["choices"][0]["message"]
        return (
            choice_msg.get("content")
            or choice_msg.get("reasoning_content")
            or choice_msg.get("reasoning")
            or ""
        )

    async def complete_structured(
        self,
        messages: list[dict[str, str]],
        schema_cls: type[T],
        *,
        profile: ModelProfile | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        required_properties: list[str] | None = None,
        json_schema: dict[str, Any] | None = None,
    ) -> T:
        """Call Ollama with native JSON Schema grammar enforcement and validate into a Pydantic model."""
        active_profile = profile or settings.clerk_profile
        effective_max_tokens = max(max_tokens or active_profile.max_tokens, 2048)
        effective_schema = dict(json_schema) if json_schema is not None else schema_cls.model_json_schema()
        if required_properties is not None:
            effective_schema["required"] = required_properties
        try:
            raw = await self.complete_text(
                messages,
                profile=active_profile,
                max_tokens=effective_max_tokens,
                temperature=temperature,
                json_mode=True,
                json_schema=effective_schema,
            )
            parsed = extract_json_object(raw)
            return schema_cls.model_validate(parsed)
        except Exception as first_exc:
            logger.warning(
                "Structured JSON schema call for %s failed (%s); retrying with json_mode.",
                schema_cls.__name__,
                first_exc,
            )
            schema_hint_msg = {
                "role": "system",
                "content": (
                    "Output ONLY a valid JSON object conforming strictly to this JSON Schema "
                    f"(do not wrap in markdown or include extra keys):\n{json.dumps(json_schema)}"
                ),
            }
            raw_retry = await self.complete_text(
                [*messages, schema_hint_msg],
                profile=active_profile,
                max_tokens=max(effective_max_tokens, 4096),
                temperature=temperature,
                json_mode=True,
                json_schema=None,
            )
            parsed_retry = extract_json_object(raw_retry)
            return schema_cls.model_validate(parsed_retry)

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        profile: ModelProfile | None = None,
        disable_reasoning: bool = False,
    ) -> AsyncIterator[str]:
        """Stream token deltas from Ollama (/api/chat or /v1/chat/completions) or OpenRouter."""
        active_profile = profile or settings.actor_profile
        target = await build_call_target(active_profile)
        client = await self.get_http_client(timeout=active_profile.timeout_seconds)

        # 1. Prefer native Ollama streaming on /api/chat (only for Ollama providers)
        if target.provider_type not in ("openrouter", "aihorde"):
            ollama_root = target.root_url
            ollama_chat_url = f"{ollama_root}/api/chat"
            stream_opts: dict[str, Any] = {
                "temperature": active_profile.temperature,
                "num_predict": active_profile.max_tokens,
            }
            if getattr(active_profile, "run_on_cpu", False):
                stream_opts["num_gpu"] = 0
            ollama_payload: dict[str, Any] = {
                "model": active_profile.model,
                "messages": messages,
                "stream": True,
                "think": False,
                "options": stream_opts,
            }
            try:
                need_retry_without_think = False
                async with client.stream("POST", ollama_chat_url, headers=target.native_headers, json=ollama_payload, timeout=active_profile.timeout_seconds) as resp:
                    if resp.status_code == 200:
                        async for line in resp.aiter_lines():
                            if not line.strip():
                                continue
                            try:
                                chunk = json.loads(line)
                                delta = chunk.get("message", {}).get("content")
                                if delta:
                                    yield delta
                                if chunk.get("done"):
                                    return
                            except json.JSONDecodeError:
                                continue
                        return
                    elif resp.status_code == 400:
                        need_retry_without_think = True
                    elif resp.status_code == 404:
                        err_bytes = await resp.aread()
                        err_text = err_bytes.decode("utf-8", errors="ignore")
                        if "model" in err_text.lower() and "not found" in err_text.lower():
                            raise RuntimeError(
                                f"Ollama model '{active_profile.model}' is not installed. "
                                f"Run `ollama pull {active_profile.model}` or select an installed model in Settings."
                            )

                if need_retry_without_think:
                    retry_stream_payload = {k: v for k, v in ollama_payload.items() if k != "think"}
                    async with client.stream("POST", ollama_chat_url, headers=target.native_headers, json=retry_stream_payload, timeout=active_profile.timeout_seconds) as resp:
                        if resp.status_code == 200:
                            async for line in resp.aiter_lines():
                                if not line.strip():
                                    continue
                                try:
                                    chunk = json.loads(line)
                                    delta = chunk.get("message", {}).get("content")
                                    if delta:
                                        yield delta
                                    if chunk.get("done"):
                                        return
                                except json.JSONDecodeError:
                                    continue
                            return
            except RuntimeError:
                raise
            except httpx.HTTPError:
                pass

        # 2. Direct OpenAI-compatible / OpenRouter / AI Horde SSE streaming (/chat/completions)
        v1_url = get_chat_completions_url(target)
        headers = target.openai_headers
        stream_tokens = active_profile.max_tokens
        if target.provider_type == "aihorde":
            stream_tokens = max(stream_tokens, 16)
        oai_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "temperature": active_profile.temperature,
            "max_tokens": stream_tokens,
            "stream": True,
        }
        if target.provider_type == "openrouter" and disable_reasoning:
            oai_payload["reasoning"] = {"effort": "none"}
        elif target.provider_type == "aihorde" and disable_reasoning:
            oai_payload["reasoning_effort"] = "none"

        is_horde_anon = target.provider_type == "aihorde" and "0000000000" in headers.get("Authorization", "")
        sem = _AIHORDE_ANON_SEMAPHORE if is_horde_anon else contextlib.nullcontext()

        async with sem:
            active_payload = dict(oai_payload)
            for attempt in range(3):
                try:
                    stream_ok = False
                    async with client.stream("POST", v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds) as resp:
                        if resp.status_code == 400:
                            err_bytes = await resp.aread()
                            err_text = err_bytes.decode("utf-8", errors="ignore").lower()
                            if target.provider_type == "openrouter" and "reasoning" in active_payload:
                                if "reasoning" in err_text:
                                    if attempt == 0:
                                        active_payload["reasoning"] = {"exclude": True}
                                        continue
                                    elif attempt == 1:
                                        active_payload.pop("reasoning", None)
                                        continue
                            elif target.provider_type == "aihorde" and "reasoning_effort" in active_payload:
                                active_payload.pop("reasoning_effort", None)
                                continue

                        if target.provider_type == "aihorde" and resp.status_code in (404, 403):
                            err_bytes = await resp.aread()
                            err_text = err_bytes.decode("utf-8", errors="ignore").lower()
                            if "unknownchatmodel" in err_text or "noeligibleworker" in err_text or "model" in err_text:
                                fallback = await _get_aihorde_fallback_model(client, target.root_url, headers, active_payload["model"])
                                if fallback and fallback != active_payload["model"]:
                                    logger.warning("AI Horde streaming model '%s' offline; attempting fallback to '%s'", active_payload["model"], fallback)
                                    active_payload["model"] = fallback
                                    continue
                                raise RuntimeError(
                                    f"AI Horde model '{active_profile.model}' is currently offline on the network (no workers available). Please choose an active model in Settings."
                                )

                        resp.raise_for_status()
                        stream_ok = True
                        async for line in resp.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            data_str = line[len("data:") :].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        yield content
                            except json.JSONDecodeError:
                                continue
                    if stream_ok:
                        break
                except Exception:
                    if attempt == 2 or target.provider_type not in ("openrouter", "aihorde"):
                        raise


llm_client = LLMClient()
