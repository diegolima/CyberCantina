"""Ollama-first & OpenAI-compatible LLM client with model discovery and grammar-constrained JSON."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, Field

from app.config import ModelProfile, persist_settings, settings

logger = logging.getLogger("cybercantina.llm")

T = TypeVar("T", bound=BaseModel)

_THINK_BLOCK_RE = re.compile(r"<(?:think|thought)>.*?</(?:think|thought)>", re.DOTALL | re.I)
_UNCLOSED_THINK_RE = re.compile(r"^.*?<(?:think|thought)>", re.DOTALL | re.I)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_EMBED_MODEL_KEYWORDS = ("embed", "minilm", "bge-", "nomic-embed", "mxbai-embed", "arctic-embed")


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


async def query_ollama_status(base_url: str | None = None) -> OllamaStatusResponse:
    """Query Ollama's /api/tags endpoint to list installed models and verify connectivity."""
    target_url = base_url or settings.actor_profile.base_url
    root_url = get_ollama_root_url(target_url)
    tags_url = f"{root_url}/api/tags"

    try:
        client = await llm_client.get_http_client(timeout=5.0)
        resp = await client.get(tags_url, timeout=5.0)
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

    raw_models = payload.get("models", [])
    models: list[OllamaModelInfo] = []
    chat_models: list[str] = []
    embedding_models: list[str] = []

    for item in raw_models:
        name = item.get("name") or item.get("model") or ""
        if not name:
            continue
        size_bytes = int(item.get("size") or 0)
        details = item.get("details") or {}
        family = str(details.get("family") or "")
        param_size = str(details.get("parameter_size") or "")
        quant = str(details.get("quantization_level") or "")

        name_lower = name.lower()
        is_embed = any(k in name_lower for k in _EMBED_MODEL_KEYWORDS) or "bert" in family.lower()

        info = OllamaModelInfo(
            name=name,
            size_mb=round(size_bytes / (1024 * 1024)),
            parameter_size=param_size,
            quantization_level=quant,
            family=family,
            is_embedding=is_embed,
        )
        models.append(info)
        if is_embed:
            embedding_models.append(name)
        else:
            chat_models.append(name)

    return OllamaStatusResponse(
        reachable=True,
        ollama_root_url=root_url,
        models=models,
        chat_models=chat_models,
        embedding_models=embedding_models,
        active_actor_model=settings.actor_profile.model,
        active_clerk_model=settings.clerk_profile.model,
    )


async def auto_configure_ollama_models() -> OllamaStatusResponse:
    """On startup, inspect Ollama and auto-select installed models if current defaults are missing."""
    status = await query_ollama_status(settings.actor_profile.base_url)
    if not status.reachable or not status.chat_models:
        if not status.reachable:
            logger.warning(
                "Ollama not reachable at %s (%s). Configure endpoint in Settings or start `ollama serve`.",
                status.ollama_root_url,
                status.error,
            )
        return status

    changed = False
    installed_set = set(status.chat_models)

    #Also allow matching without ':latest' suffix
    def _is_installed(model_name: str) -> bool:
        if model_name in installed_set:
            return True
        if f"{model_name}:latest" in installed_set:
            return True
        return False

    if not _is_installed(settings.actor_profile.model):
        old_actor = settings.actor_profile.model
        settings.actor_profile.model = status.chat_models[0]
        logger.info(
            "Auto-selected installed Ollama model '%s' for Actor (previous '%s' was not installed).",
            settings.actor_profile.model,
            old_actor,
        )
        changed = True

    if not _is_installed(settings.clerk_profile.model):
        old_clerk = settings.clerk_profile.model
        settings.clerk_profile.model = status.chat_models[0]
        logger.info(
            "Auto-selected installed Ollama model '%s' for Auxiliary Clerk (previous '%s' was not installed).",
            settings.clerk_profile.model,
            old_clerk,
        )
        changed = True

    if status.embedding_models and settings.embedding_profile.model not in status.embedding_models:
        settings.embedding_profile.model = status.embedding_models[0]
        changed = True

    if changed:
        persist_settings(settings)
        status.active_actor_model = settings.actor_profile.model
        status.active_clerk_model = settings.clerk_profile.model

    return status


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
    ) -> str:
        """Execute a non-streaming chat completion call against Ollama or OpenAI-compatible server."""
        active_profile = profile or settings.clerk_profile
        temp = temperature if temperature is not None else active_profile.temperature
        max_tok = max_tokens if max_tokens is not None else active_profile.max_tokens

        # 1. Try native Ollama /api/chat first (supports grammar-enforced JSON schema in `format`)
        # Disable separate thinking stream (`think: False`) so reasoning models (e.g. gemma4, qwen3,
        # deepseek-r1) do not exhaust `num_predict` inside `message.thinking` and return empty `content`.
        ollama_root = get_ollama_root_url(active_profile.base_url)
        ollama_chat_url = f"{ollama_root}/api/chat"
        ollama_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "stream": False,
            "think": False,
            "options": {
                "temperature": temp,
                "num_predict": max_tok,
            },
        }
        if json_schema is not None:
            ollama_payload["format"] = json_schema
        elif json_mode:
            ollama_payload["format"] = "json"

        client = await self.get_http_client(timeout=active_profile.timeout_seconds)
        try:
            resp = await client.post(ollama_chat_url, json=ollama_payload, timeout=active_profile.timeout_seconds)
            if resp.status_code == 400:
                # Fallback if model or older Ollama server does not accept `think: False`
                retry_payload = {k: v for k, v in ollama_payload.items() if k != "think"}
                retry_payload["options"] = {
                    "temperature": temp,
                    "num_predict": max(max_tok * 3, 4096),
                }
                resp = await client.post(ollama_chat_url, json=retry_payload, timeout=active_profile.timeout_seconds)

            if resp.status_code == 200:
                data = resp.json()
                msg = data.get("message") or {}
                content = (msg.get("content") or "").strip()
                if content:
                    return content

                # If `format: json_schema` or token budget produced empty content on /api/chat,
                # retry with plain `format: "json"` and expanded token budget before giving up.
                if json_schema is not None or data.get("done_reason") == "length":
                    fallback_payload = dict(ollama_payload)
                    if json_schema is not None:
                        fallback_payload["format"] = "json"
                    fallback_payload["options"] = {
                        "temperature": temp,
                        "num_predict": max(max_tok * 3, 4096),
                    }
                    retry_resp = await client.post(ollama_chat_url, json=fallback_payload, timeout=active_profile.timeout_seconds)
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
                # Could be model not found in Ollama OR non-Ollama OpenAI server
                err_body = resp.text
                if "model" in err_body.lower() and "not found" in err_body.lower():
                    raise RuntimeError(
                        f"Ollama model '{active_profile.model}' is not installed. "
                        f"Run `ollama pull {active_profile.model}` or select an installed model in Settings."
                    )
        except RuntimeError:
            raise
        except httpx.HTTPError:
            # Fall through to OpenAI-compatible /v1/chat/completions endpoint
            pass

        # 2. OpenAI-compatible /v1/chat/completions endpoint
        v1_url = f"{get_openai_v1_url(active_profile.base_url)}/chat/completions"
        headers = {
            "Authorization": f"Bearer {active_profile.api_key}",
            "Content-Type": "application/json",
        }
        oai_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "temperature": temp,
            "max_tokens": max_tok,
            "stream": False,
        }
        if json_mode or json_schema is not None:
            oai_payload["response_format"] = {"type": "json_object"}

        resp = await client.post(v1_url, headers=headers, json=oai_payload, timeout=active_profile.timeout_seconds)
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
    ) -> T:
        """Call Ollama with native JSON Schema grammar enforcement and validate into a Pydantic model."""
        active_profile = profile or settings.clerk_profile
        effective_max_tokens = max(max_tokens or active_profile.max_tokens, 2048)
        json_schema = schema_cls.model_json_schema()
        if required_properties is not None:
            json_schema["required"] = required_properties
        try:
            raw = await self.complete_text(
                messages,
                profile=active_profile,
                max_tokens=effective_max_tokens,
                temperature=temperature,
                json_mode=True,
                json_schema=json_schema,
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
    ) -> AsyncIterator[str]:
        """Stream token deltas from Ollama (/api/chat or /v1/chat/completions)."""
        active_profile = profile or settings.actor_profile
        ollama_root = get_ollama_root_url(active_profile.base_url)
        ollama_chat_url = f"{ollama_root}/api/chat"

        ollama_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "stream": True,
            "think": False,
            "options": {
                "temperature": active_profile.temperature,
                "num_predict": active_profile.max_tokens,
            },
        }

        client = await self.get_http_client(timeout=active_profile.timeout_seconds)
        # Prefer native Ollama streaming on /api/chat
        try:
            need_retry_without_think = False
            async with client.stream("POST", ollama_chat_url, json=ollama_payload, timeout=active_profile.timeout_seconds) as resp:
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
                async with client.stream("POST", ollama_chat_url, json=retry_stream_payload, timeout=active_profile.timeout_seconds) as resp:
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

        # Fallback to OpenAI-compatible SSE streaming (/v1/chat/completions)
        v1_url = f"{get_openai_v1_url(active_profile.base_url)}/chat/completions"
        headers = {
            "Authorization": f"Bearer {active_profile.api_key}",
            "Content-Type": "application/json",
        }
        oai_payload: dict[str, Any] = {
            "model": active_profile.model,
            "messages": messages,
            "temperature": active_profile.temperature,
            "max_tokens": active_profile.max_tokens,
            "stream": True,
        }
        async with client.stream("POST", v1_url, headers=headers, json=oai_payload, timeout=active_profile.timeout_seconds) as resp:
            resp.raise_for_status()
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
                        delta = choices[0].get("delta", {}).get("content")
                        if delta:
                            yield delta
                except json.JSONDecodeError:
                    continue


llm_client = LLMClient()
