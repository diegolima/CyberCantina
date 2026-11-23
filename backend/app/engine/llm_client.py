"""Ollama-first & OpenAI-compatible LLM client with model discovery and grammar-constrained JSON."""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, Field

from app.config import ModelProfile, persist_settings, settings
from app.engine.telemetry import (
    active_telemetry_label,
    active_telemetry_phase,
    active_turn_telemetry,
)
from app.providers.local_relay import (
    RelayRemoteError,
    RelayStreamUsage,
    RelayUnavailableError,
    local_relay_hub,
    relay_user_context,
)
from app.providers.models import parse_aihorde_models, parse_ollama_tags
from app.providers.openai_compat import (
    DEFAULT_OPENAI_COMPAT_PROVIDER,
    OPENAI_COMPAT_PROVIDER_TYPES,
    get_openai_compat_provider,
    is_openai_compat_provider,
)
from app.providers.openrouter_catalog import openrouter_catalog_service
from app.providers.probe import bearer_headers, probe_service
from app.providers.resolver import ProviderUnavailableError, resolve_system_profile
from app.providers.webgpu_catalog import get_webgpu_max_context
from app.schemas.llm_tools import (
    LlmToolCall,
    LlmToolCompletionResult,
    LlmToolDefinition,
)
from app.schemas.provider import ProviderColor
from app.schemas.telemetry import LlmCallTelemetry
from app.security.url_policy import UrlBlockedError, assert_url_allowed, normalize_base_url

logger = logging.getLogger("cybercantina.llm")

T = TypeVar("T", bound=BaseModel)

_THINK_BLOCK_RE = re.compile(r"<(?:think|thought)>.*?</(?:think|thought)>", re.DOTALL | re.I)
_UNCLOSED_THINK_RE = re.compile(r"^.*?<(?:think|thought)>", re.DOTALL | re.I)
_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
_EMBED_MODEL_KEYWORDS = ("embed", "minilm", "bge-", "nomic-embed", "mxbai-embed", "arctic-embed")


def _estimate_text_tokens_local(text: str) -> int:
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 3.3))


def _estimate_messages_tokens_local(messages: list[dict[str, Any]]) -> int:
    total = 0
    for m in messages:
        total += _estimate_text_tokens_local(str(m.get("content") or ""))
        if m.get("tool_calls"):
            total += _estimate_text_tokens_local(json.dumps(m["tool_calls"]))
        total += 12
    return total


class ToolsUnsupportedError(RuntimeError):
    """Raised when the selected provider, model, or chat template does not support native tools."""


_TOOL_UNSUPPORTED_MARKERS = (
    "does not support tools",
    "support tool",
    "tools is not supported",
    "tools are not supported",
    "tool calling is not supported",
    "tool use is not supported",
    "function calling is not supported",
    "does not support function",
    "unknown field \"tools\"",
    "unrecognized request argument supplied: tools",
    "tool_choice",
)


def _is_tools_unsupported_error_text(err_lower: str) -> bool:
    return any(marker in (err_lower or "") for marker in _TOOL_UNSUPPORTED_MARKERS)


def _coerce_tool_arguments(raw_args: Any) -> dict[str, Any]:
    if isinstance(raw_args, dict):
        return dict(raw_args)
    if isinstance(raw_args, str):
        cleaned = raw_args.strip()
        if not cleaned:
            return {}
        try:
            parsed = json.loads(cleaned)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            try:
                parsed = extract_json_object(cleaned)
                return dict(parsed) if isinstance(parsed, dict) else {}
            except Exception:
                return {}
    return {}


def _parse_tool_calls(raw_calls: Any) -> list[LlmToolCall]:
    if not isinstance(raw_calls, list):
        return []
    parsed: list[LlmToolCall] = []
    for item in raw_calls:
        if not isinstance(item, dict):
            continue
        fn = item.get("function") if isinstance(item.get("function"), dict) else item
        name = str(fn.get("name") or "").strip()
        if not name:
            continue
        call_id = str(item.get("id") or "").strip() or f"call_{uuid.uuid4().hex[:10]}"
        args = _coerce_tool_arguments(fn.get("arguments"))
        parsed.append(LlmToolCall(id=call_id, name=name, arguments=args))
    return parsed


def _format_messages_for_ollama_tools(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for m in messages:
        role = str(m.get("role") or "user")
        if role == "assistant" and isinstance(m.get("tool_calls"), list):
            ollama_calls: list[dict[str, Any]] = []
            for tc in m["tool_calls"]:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
                name = str(fn.get("name") or "").strip()
                if not name:
                    continue
                ollama_calls.append(
                    {
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": _coerce_tool_arguments(fn.get("arguments")),
                        },
                    }
                )
            entry: dict[str, Any] = {
                "role": "assistant",
                "content": str(m.get("content") or ""),
            }
            if ollama_calls:
                entry["tool_calls"] = ollama_calls
            formatted.append(entry)
        elif role == "tool":
            tool_msg: dict[str, Any] = {
                "role": "tool",
                "content": str(m.get("content") or ""),
            }
            tool_name = m.get("tool_name") or m.get("name")
            if tool_name:
                tool_msg["tool_name"] = str(tool_name)
            formatted.append(tool_msg)
        else:
            formatted.append(
                {
                    "role": role,
                    "content": str(m.get("content") or ""),
                }
            )
    return formatted


def _format_messages_for_openai_tools(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for m in messages:
        role = str(m.get("role") or "user")
        if role == "assistant" and isinstance(m.get("tool_calls"), list):
            oai_calls: list[dict[str, Any]] = []
            for tc in m["tool_calls"]:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
                name = str(fn.get("name") or "").strip()
                if not name:
                    continue
                raw_args = fn.get("arguments")
                arg_str = (
                    raw_args
                    if isinstance(raw_args, str)
                    else json.dumps(_coerce_tool_arguments(raw_args))
                )
                oai_calls.append(
                    {
                        "id": str(tc.get("id") or f"call_{uuid.uuid4().hex[:10]}"),
                        "type": "function",
                        "function": {"name": name, "arguments": arg_str},
                    }
                )
            entry: dict[str, Any] = {
                "role": "assistant",
                "content": m.get("content") if m.get("content") is not None else "",
            }
            if oai_calls:
                entry["tool_calls"] = oai_calls
            formatted.append(entry)
        elif role == "tool":
            tool_msg: dict[str, Any] = {
                "role": "tool",
                "tool_call_id": str(m.get("tool_call_id") or ""),
                "content": str(m.get("content") or ""),
            }
            tool_name = m.get("name") or m.get("tool_name")
            if tool_name:
                tool_msg["name"] = str(tool_name)
            formatted.append(tool_msg)
        else:
            formatted.append(
                {
                    "role": role,
                    "content": str(m.get("content") or ""),
                }
            )
    return formatted


_VALID_PROVIDER_COLORS: frozenset[str] = frozenset({"neutral", "cyan", "purple", "indigo", "bronze"})


def _coerce_nonneg_int(val: Any) -> int | None:
    if isinstance(val, bool) or val is None:
        return None
    if isinstance(val, int) and val >= 0:
        return val
    return None


def _coerce_provider_color(raw: Any) -> ProviderColor | None:
    if isinstance(raw, str) and raw in _VALID_PROVIDER_COLORS:
        return raw  # type: ignore[return-value]
    return None


def _ns_to_ms(raw_ns: Any) -> int | None:
    if isinstance(raw_ns, bool) or raw_ns is None:
        return None
    if isinstance(raw_ns, (int, float)):
        val = float(raw_ns)
        if math.isfinite(val) and val > 0.0:
            return max(1, round(val / 1_000_000.0))
    return None


def _coerce_opt_cost_usd(raw: Any) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        val = float(raw)
        if math.isfinite(val) and val >= 0.0:
            return val
    return None


def _normalize_finish_reason(raw: Any) -> str:
    if not raw:
        return "unknown"
    s = str(raw).strip().lower()
    if s in ("stop", "end_turn", "eos"):
        return "stop"
    if s in ("length", "max_tokens"):
        return "length"
    if s in ("error", "content_filter"):
        return s
    return s


def _resolve_telemetry_context_ceiling(
    profile: ModelProfile,
    provider_type: str,
    provider_id: str | None,
    *,
    model_name: str | None = None,
) -> int | None:
    effective_model = model_name or profile.model
    ctx = getattr(profile, "context_size", None)
    if provider_type == "webgpu":
        wgpu_max = get_webgpu_max_context(effective_model)
        if ctx is not None and int(ctx) > 0:
            return min(int(ctx), wgpu_max)
        return wgpu_max
    if provider_type in ("ollama", "browser_ollama"):
        if ctx is not None and int(ctx) > 0:
            return int(ctx)
        return None
    if provider_type == "openrouter":
        for m in openrouter_catalog_service.get_cached_models_sync():
            if m.name == effective_model and m.context_length and m.context_length > 0:
                return m.context_length
    return probe_service.get_cached_model_context_length(provider_id, effective_model)


def _record_llm_telemetry(
    *,
    messages: list[dict[str, Any]],
    output_text: str,
    profile: ModelProfile,
    provider_type: str,
    provider_id: str | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    finish_reason: Any,
    started_at: float,
    retries: int = 0,
    error: str | None = None,
    model_override: str | None = None,
    provider_name: str | None = None,
    provider_color: str | None = None,
    ttft_ms: int | None = None,
    eval_duration_ms: int | None = None,
    cost_usd: float | None = None,
) -> None:
    collector = active_turn_telemetry.get()
    phase = active_telemetry_phase.get()
    if collector is None or phase is None:
        return
    effective_model = model_override or profile.model
    exact_prompt = _coerce_nonneg_int(prompt_tokens)
    exact_completion = _coerce_nonneg_int(completion_tokens)
    if exact_prompt is not None and exact_completion is not None:
        usage_source = "exact"
        p_tok = exact_prompt
        c_tok = exact_completion
    else:
        usage_source = "estimated"
        p_tok = exact_prompt if exact_prompt is not None else _estimate_messages_tokens_local(messages)
        c_tok = exact_completion if exact_completion is not None else _estimate_text_tokens_local(output_text)

    label = active_telemetry_label.get() or phase
    duration_ms = max(0, int((time.monotonic() - started_at) * 1000))
    collector.record_call(
        LlmCallTelemetry(
            phase=phase,
            label=label,
            model=effective_model,
            provider_type=provider_type,
            provider_id=provider_id,
            provider_name=provider_name,
            provider_color=_coerce_provider_color(provider_color),
            prompt_tokens=p_tok,
            completion_tokens=c_tok,
            usage_source=usage_source,
            context_ceiling=_resolve_telemetry_context_ceiling(
                profile,
                provider_type,
                provider_id,
                model_name=effective_model,
            ),
            finish_reason=_normalize_finish_reason(finish_reason),
            retries=retries,
            duration_ms=duration_ms,
            ttft_ms=_coerce_nonneg_int(ttft_ms),
            eval_duration_ms=_coerce_nonneg_int(eval_duration_ms),
            cost_usd=_coerce_opt_cost_usd(cost_usd),
            error=error,
        )
    )


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


def format_ollama_keep_alive(minutes: int | None) -> str | int:
    """Format minutes into Ollama's keep_alive format ('30m', '-1', or 0)."""
    if minutes is None:
        return "30m"
    if minutes < 0:
        return "-1"
    if minutes == 0:
        return 0
    return f"{minutes}m"


def _build_ollama_options(
    profile: ModelProfile,
    *,
    temperature: float,
    num_predict: int,
) -> dict[str, Any]:
    """Build native Ollama options dict, injecting num_ctx and num_gpu when configured."""
    opts: dict[str, Any] = {
        "temperature": temperature,
        "num_predict": num_predict,
    }
    ctx = getattr(profile, "context_size", None)
    if ctx is not None:
        opts["num_ctx"] = int(ctx)
    if getattr(profile, "run_on_cpu", False):
        opts["num_gpu"] = 0
    return opts


@dataclass(frozen=True)
class CallTarget:
    """Everything needed to call one role's endpoint, with auth applied on every request."""

    root_url: str
    native_headers: dict[str, str]
    openai_headers: dict[str, str]
    provider_type: str = "ollama"
    owner_id: str | None = None
    caller_user_id: str | None = None
    provider_id: str | None = None
    credential_storage: str = "server"
    provider_name: str | None = None
    provider_color: str | None = None


_CLOUD_OPENAI_PROVIDER_TYPES = OPENAI_COMPAT_PROVIDER_TYPES


def get_chat_completions_url(target: CallTarget) -> str:
    adapter = get_openai_compat_provider(target.provider_type)
    if adapter is not None:
        return adapter.chat_completions_url(target.root_url)
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
        if ptype in ("browser_ollama", "webgpu") or endpoint.credential_storage == "browser":
            root = get_ollama_root_url(endpoint.root_url) if ptype in ("browser_ollama", "ollama") else endpoint.root_url
            return CallTarget(
                root,
                {},
                {},
                provider_type=ptype,
                owner_id=endpoint.owner_id,
                caller_user_id=endpoint.caller_user_id,
                provider_id=endpoint.provider_id,
                credential_storage=endpoint.credential_storage,
                provider_name=endpoint.provider_name,
                provider_color=endpoint.provider_color,
            )
        if endpoint.network_restricted:
            try:
                await assert_url_allowed(normalize_base_url(endpoint.root_url, provider_type=ptype), allow_private=False)
            except UrlBlockedError as exc:
                raise RuntimeError(f"Provider endpoint blocked by network policy: {exc}") from exc
        adapter = get_openai_compat_provider(ptype)
        if adapter is not None:
            oai = adapter.build_chat_headers(endpoint.bearer_token, referer_url=_public_referer_url())
            return CallTarget(
                endpoint.root_url,
                {},
                oai,
                provider_type=ptype,
                provider_id=endpoint.provider_id,
                provider_name=endpoint.provider_name,
                provider_color=endpoint.provider_color,
            )

        native = bearer_headers(endpoint.bearer_token)
        oai = {"Authorization": f"Bearer {endpoint.bearer_token or 'ollama'}", "Content-Type": "application/json"}
        return CallTarget(
            get_ollama_root_url(endpoint.root_url),
            native,
            oai,
            provider_type="ollama",
            provider_id=endpoint.provider_id,
            provider_name=endpoint.provider_name,
            provider_color=endpoint.provider_color,
        )
    legacy_token = profile.api_key if profile.api_key not in ("", "ollama") else None
    return CallTarget(
        get_ollama_root_url(profile.base_url),
        bearer_headers(legacy_token),
        {"Authorization": f"Bearer {profile.api_key}", "Content-Type": "application/json"},
        provider_type="ollama",
        provider_color="neutral",
    )


def _public_referer_url() -> str:
    """Return configured public referer URL for external cloud LLM providers."""
    return (
        os.environ.get("CYBERCANTINA_PUBLIC_URL", "https://cybercantina.io").strip()
        or "https://cybercantina.io"
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
        if endpoint.type != "ollama":
            return None
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


def _inline_json_schema_defs(schema: dict[str, Any]) -> dict[str, Any]:
    """Recursively inline Pydantic `$defs`/`$ref` blocks for fast llama.cpp/Ollama GBNF compilation."""
    defs = schema.get("$defs")
    if not isinstance(defs, dict) or not defs:
        out = dict(schema)
        out.pop("$defs", None)
        return out

    def _resolve(node: Any, seen: frozenset[str]) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                def_name = ref[len("#/$defs/") :]
                if def_name in defs and def_name not in seen:
                    resolved = _resolve(dict(defs[def_name]), seen | {def_name})
                    for k, v in node.items():
                        if k != "$ref" and k not in resolved:
                            resolved[k] = _resolve(v, seen)
                    return resolved
            return {
                k: _resolve(v, seen)
                for k, v in node.items()
                if k != "$defs"
            }
        if isinstance(node, list):
            return [_resolve(item, seen) for item in node]
        return node

    return _resolve(schema, frozenset())


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
        started_at = time.monotonic()

        target = await build_call_target(active_profile)

        if target.provider_type in ("browser_ollama", "webgpu") or target.credential_storage == "browser":
            ctx = getattr(active_profile, "context_size", None)
            if target.provider_type == "webgpu" and ctx is not None:
                ctx = min(int(ctx), get_webgpu_max_context(active_profile.model))
            res = await local_relay_hub.complete(
                user_id=target.owner_id or target.caller_user_id or relay_user_context.get(),
                driver=target.provider_type,  # type: ignore[arg-type]
                base_url=target.root_url,
                model=active_profile.model,
                messages=messages,
                temperature=temp,
                max_tokens=max_tok,
                context_size=int(ctx) if ctx is not None else None,
                keep_alive=format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                json_mode=json_mode,
                json_schema=json_schema,
                disable_reasoning=disable_reasoning,
                timeout=active_profile.timeout_seconds,
                provider_id=target.provider_id,
            )
            content = (res.content or "").strip()
            thinking_text = (res.thinking or "").strip()
            final_text = content or (thinking_text if thinking_text and "{" in thinking_text else content)
            _record_llm_telemetry(
                messages=messages,
                output_text=final_text,
                profile=active_profile,
                provider_type=target.provider_type,
                provider_id=target.provider_id,
                provider_name=target.provider_name,
                provider_color=target.provider_color,
                prompt_tokens=res.prompt_tokens,
                completion_tokens=res.completion_tokens,
                finish_reason=res.done_reason,
                started_at=started_at,
                eval_duration_ms=res.eval_duration_ms,
                cost_usd=res.cost_usd,
            )
            return final_text

        client = await self.get_http_client(timeout=active_profile.timeout_seconds)

        # 1. Try native Ollama /api/chat first (only for Ollama providers)
        if not is_openai_compat_provider(target.provider_type):
            ollama_root = target.root_url
            ollama_chat_url = f"{ollama_root}/api/chat"
            ollama_opts = _build_ollama_options(
                active_profile, temperature=temp, num_predict=max_tok
            )
            ollama_payload: dict[str, Any] = {
                "model": active_profile.model,
                "messages": messages,
                "stream": False,
                "think": False,
                "keep_alive": format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                "options": ollama_opts,
            }
            if json_schema is not None:
                ollama_payload["format"] = json_schema
            elif json_mode:
                ollama_payload["format"] = "json"

            try:
                ollama_retries = 0
                resp = await client.post(ollama_chat_url, headers=target.native_headers, json=ollama_payload, timeout=active_profile.timeout_seconds)
                if resp.status_code == 400:
                    ollama_retries += 1
                    retry_payload = {k: v for k, v in ollama_payload.items() if k != "think"}
                    retry_payload["options"] = _build_ollama_options(
                        active_profile, temperature=temp, num_predict=max(max_tok * 3, 4096)
                    )
                    resp = await client.post(ollama_chat_url, headers=target.native_headers, json=retry_payload, timeout=active_profile.timeout_seconds)

                if resp.status_code == 200:
                    data = resp.json()
                    msg = data.get("message") or {}
                    content = (msg.get("content") or "").strip()
                    if content:
                        _record_llm_telemetry(
                            messages=messages,
                            output_text=content,
                            profile=active_profile,
                            provider_type=target.provider_type,
                            provider_id=target.provider_id,
                            provider_name=target.provider_name,
                            provider_color=target.provider_color,
                            prompt_tokens=data.get("prompt_eval_count"),
                            completion_tokens=data.get("eval_count"),
                            finish_reason=data.get("done_reason"),
                            started_at=started_at,
                            retries=ollama_retries,
                            eval_duration_ms=_ns_to_ms(data.get("eval_duration")),
                        )
                        return content

                    if json_schema is not None or data.get("done_reason") == "length":
                        ollama_retries += 1
                        fallback_payload = dict(ollama_payload)
                        if json_schema is not None:
                            fallback_payload["format"] = "json"
                        fallback_payload["options"] = _build_ollama_options(
                            active_profile, temperature=temp, num_predict=max(max_tok * 3, 4096)
                        )
                        retry_resp = await client.post(ollama_chat_url, headers=target.native_headers, json=fallback_payload, timeout=active_profile.timeout_seconds)
                        if retry_resp.status_code == 200:
                            retry_data = retry_resp.json()
                            retry_msg = retry_data.get("message") or {}
                            retry_content = (retry_msg.get("content") or "").strip()
                            if retry_content:
                                _record_llm_telemetry(
                                    messages=messages,
                                    output_text=retry_content,
                                    profile=active_profile,
                                    provider_type=target.provider_type,
                                    provider_id=target.provider_id,
                                    provider_name=target.provider_name,
                                    provider_color=target.provider_color,
                                    prompt_tokens=retry_data.get("prompt_eval_count"),
                                    completion_tokens=retry_data.get("eval_count"),
                                    finish_reason=retry_data.get("done_reason"),
                                    started_at=started_at,
                                    retries=ollama_retries,
                                    eval_duration_ms=_ns_to_ms(retry_data.get("eval_duration")),
                                )
                                return retry_content
                            thinking_fallback = (retry_msg.get("thinking") or "").strip()
                            if thinking_fallback and "{" in thinking_fallback:
                                _record_llm_telemetry(
                                    messages=messages,
                                    output_text=thinking_fallback,
                                    profile=active_profile,
                                    provider_type=target.provider_type,
                                    provider_id=target.provider_id,
                                    provider_name=target.provider_name,
                                    provider_color=target.provider_color,
                                    prompt_tokens=retry_data.get("prompt_eval_count"),
                                    completion_tokens=retry_data.get("eval_count"),
                                    finish_reason=retry_data.get("done_reason"),
                                    started_at=started_at,
                                    retries=ollama_retries,
                                    eval_duration_ms=_ns_to_ms(retry_data.get("eval_duration")),
                                )
                                return thinking_fallback

                    thinking_text = (msg.get("thinking") or "").strip()
                    if thinking_text and "{" in thinking_text:
                        _record_llm_telemetry(
                            messages=messages,
                            output_text=thinking_text,
                            profile=active_profile,
                            provider_type=target.provider_type,
                            provider_id=target.provider_id,
                            provider_name=target.provider_name,
                            provider_color=target.provider_color,
                            prompt_tokens=data.get("prompt_eval_count"),
                            completion_tokens=data.get("eval_count"),
                            finish_reason=data.get("done_reason"),
                            started_at=started_at,
                            retries=ollama_retries,
                            eval_duration_ms=_ns_to_ms(data.get("eval_duration")),
                        )
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

        # 2. OpenAI-compatible (/chat/completions) via adapter hierarchy
        adapter = get_openai_compat_provider(target.provider_type) or DEFAULT_OPENAI_COMPAT_PROVIDER
        v1_url = get_chat_completions_url(target)
        headers = target.openai_headers
        oai_payload = adapter.build_chat_payload(
            model=active_profile.model,
            messages=messages,
            temperature=temp,
            max_tokens=max_tok,
            stream=False,
            json_mode=json_mode,
            json_schema=json_schema,
            disable_reasoning=disable_reasoning,
        )

        async with adapter.request_semaphore(headers):
            active_payload = dict(oai_payload)
            resp = await client.post(v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds)
            attempt = 0
            while resp.status_code == 400:
                retry_payload = adapter.next_bad_request_payload(active_payload, resp.text.lower(), attempt)
                if retry_payload is None:
                    break
                active_payload = retry_payload
                attempt += 1
                resp = await client.post(v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds)

            fallback, fatal_err = await adapter.resolve_model_fallback(
                client, target.root_url, headers, active_profile.model, resp.status_code, resp.text
            )
            if fallback:
                logger.warning("%s model '%s' offline; attempting fallback to '%s'", adapter.display_name, active_profile.model, fallback)
                fallback_payload = dict(active_payload)
                fallback_payload["model"] = fallback
                fallback_resp = await client.post(v1_url, headers=headers, json=fallback_payload, timeout=active_profile.timeout_seconds)
                if fallback_resp.status_code == 200:
                    active_payload = fallback_payload
                    resp = fallback_resp
                else:
                    raise RuntimeError(
                        f"{adapter.display_name} model '{active_profile.model}' is offline, and automatic fallback to '{fallback}' failed (HTTP {fallback_resp.status_code}: {fallback_resp.text}). Please choose an active model in Settings."
                    )
            elif fatal_err:
                raise RuntimeError(fatal_err)

            if resp.status_code == 404 and "model" in resp.text.lower():
                raise RuntimeError(
                    f"Model '{active_profile.model}' not found at {v1_url}: {resp.text}"
                )
            resp.raise_for_status()
        data = resp.json()
        choice0 = data["choices"][0]
        choice_msg = choice0["message"]
        usage = data.get("usage") or {}
        final_text = (
            choice_msg.get("content")
            or choice_msg.get("reasoning_content")
            or choice_msg.get("reasoning")
            or ""
        )
        _record_llm_telemetry(
            messages=messages,
            output_text=final_text,
            profile=active_profile,
            provider_type=target.provider_type,
            provider_id=target.provider_id,
            provider_name=target.provider_name,
            provider_color=target.provider_color,
            model_override=str(active_payload.get("model") or active_profile.model),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            finish_reason=choice0.get("finish_reason"),
            started_at=started_at,
            retries=attempt,
            cost_usd=_coerce_opt_cost_usd(usage.get("cost")),
        )
        return final_text

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
        effective_schema = _inline_json_schema_defs(
            dict(json_schema) if json_schema is not None else schema_cls.model_json_schema()
        )
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
        except (RelayUnavailableError, ProviderUnavailableError):
            raise
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
                    f"(do not wrap in markdown or include extra keys):\n{json.dumps(effective_schema)}"
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

    async def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[LlmToolDefinition],
        *,
        profile: ModelProfile | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        disable_reasoning: bool = True,
    ) -> LlmToolCompletionResult:
        """Execute one non-streaming chat turn with function tools across Ollama, OpenAI-compat, or Relay."""
        active_profile = profile or settings.clerk_profile
        temp = temperature if temperature is not None else active_profile.temperature
        max_tok = max_tokens if max_tokens is not None else active_profile.max_tokens
        started_at = time.monotonic()

        target = await build_call_target(active_profile)
        if target.provider_type in ("webgpu", "aihorde"):
            raise ToolsUnsupportedError(
                f"Provider '{target.provider_type}' does not support native tool calling."
            )

        tool_dicts = [t.to_openai_tool() for t in tools]

        if target.provider_type == "browser_ollama" or target.credential_storage == "browser":
            ctx = getattr(active_profile, "context_size", None)
            is_ollama_wire = target.provider_type in ("browser_ollama", "ollama")
            wire_msgs = (
                _format_messages_for_ollama_tools(messages)
                if is_ollama_wire
                else _format_messages_for_openai_tools(messages)
            )
            try:
                res = await local_relay_hub.complete(
                    user_id=target.owner_id or target.caller_user_id or relay_user_context.get(),
                    driver=target.provider_type,  # type: ignore[arg-type]
                    base_url=target.root_url,
                    model=active_profile.model,
                    messages=wire_msgs,
                    temperature=temp,
                    max_tokens=max_tok,
                    context_size=int(ctx) if ctx is not None else None,
                    keep_alive=format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                    json_mode=False,
                    json_schema=None,
                    disable_reasoning=disable_reasoning,
                    timeout=active_profile.timeout_seconds,
                    provider_id=target.provider_id,
                    tools=tool_dicts,
                )
            except RelayRemoteError as exc:
                if exc.code == "tools_unsupported" or _is_tools_unsupported_error_text(str(exc).lower()):
                    raise ToolsUnsupportedError(
                        f"Model '{active_profile.model}' rejected native tools."
                    ) from exc
                raise

            parsed_calls = _parse_tool_calls(res.tool_calls)
            content = (res.content or "").strip()
            _record_llm_telemetry(
                messages=wire_msgs,
                output_text=content or json.dumps([c.model_dump() for c in parsed_calls]),
                profile=active_profile,
                provider_type=target.provider_type,
                provider_id=target.provider_id,
                provider_name=target.provider_name,
                provider_color=target.provider_color,
                prompt_tokens=res.prompt_tokens,
                completion_tokens=res.completion_tokens,
                finish_reason=res.done_reason,
                started_at=started_at,
                eval_duration_ms=res.eval_duration_ms,
                cost_usd=res.cost_usd,
            )
            return LlmToolCompletionResult(
                content=content,
                thinking=(res.thinking or "").strip(),
                tool_calls=parsed_calls,
                done_reason=res.done_reason,
                prompt_tokens=res.prompt_tokens,
                completion_tokens=res.completion_tokens,
            )

        client = await self.get_http_client(timeout=active_profile.timeout_seconds)

        # 1. Native Ollama /api/chat
        if not is_openai_compat_provider(target.provider_type):
            ollama_msgs = _format_messages_for_ollama_tools(messages)
            ollama_chat_url = f"{target.root_url}/api/chat"
            ollama_opts = _build_ollama_options(
                active_profile, temperature=temp, num_predict=max_tok
            )
            ollama_payload: dict[str, Any] = {
                "model": active_profile.model,
                "messages": ollama_msgs,
                "stream": False,
                "keep_alive": format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                "options": ollama_opts,
                "tools": tool_dicts,
            }
            if disable_reasoning:
                ollama_payload["think"] = False

            try:
                ollama_retries = 0
                resp = await client.post(
                    ollama_chat_url,
                    headers=target.native_headers,
                    json=ollama_payload,
                    timeout=active_profile.timeout_seconds,
                )
                if resp.status_code == 400:
                    err_lower = resp.text.lower()
                    if _is_tools_unsupported_error_text(err_lower):
                        raise ToolsUnsupportedError(
                            f"Ollama model '{active_profile.model}' does not support tools."
                        )
                    if "think" in ollama_payload:
                        ollama_retries += 1
                        retry_payload = {k: v for k, v in ollama_payload.items() if k != "think"}
                        resp = await client.post(
                            ollama_chat_url,
                            headers=target.native_headers,
                            json=retry_payload,
                            timeout=active_profile.timeout_seconds,
                        )
                        if resp.status_code == 400 and _is_tools_unsupported_error_text(resp.text.lower()):
                            raise ToolsUnsupportedError(
                                f"Ollama model '{active_profile.model}' does not support tools."
                            )

                if resp.status_code == 200:
                    data = resp.json()
                    msg = data.get("message") or {}
                    content = (msg.get("content") or "").strip()
                    parsed_calls = _parse_tool_calls(msg.get("tool_calls"))
                    _record_llm_telemetry(
                        messages=ollama_msgs,
                        output_text=content or json.dumps([c.model_dump() for c in parsed_calls]),
                        profile=active_profile,
                        provider_type=target.provider_type,
                        provider_id=target.provider_id,
                        provider_name=target.provider_name,
                        provider_color=target.provider_color,
                        prompt_tokens=data.get("prompt_eval_count"),
                        completion_tokens=data.get("eval_count"),
                        finish_reason=data.get("done_reason"),
                        started_at=started_at,
                        retries=ollama_retries,
                        eval_duration_ms=_ns_to_ms(data.get("eval_duration")),
                    )
                    return LlmToolCompletionResult(
                        content=content,
                        thinking=(msg.get("thinking") or "").strip(),
                        tool_calls=parsed_calls,
                        done_reason=data.get("done_reason"),
                        prompt_tokens=data.get("prompt_eval_count"),
                        completion_tokens=data.get("eval_count"),
                    )
                if resp.status_code == 404:
                    err_body = resp.text
                    if "model" in err_body.lower() and "not found" in err_body.lower():
                        raise RuntimeError(
                            f"Ollama model '{active_profile.model}' is not installed. "
                            f"Run `ollama pull {active_profile.model}` or select an installed model in Settings."
                        )
            except (ToolsUnsupportedError, RuntimeError):
                raise
            except httpx.HTTPError:
                pass

        # 2. OpenAI-compatible (/chat/completions)
        adapter = get_openai_compat_provider(target.provider_type) or DEFAULT_OPENAI_COMPAT_PROVIDER
        v1_url = get_chat_completions_url(target)
        headers = target.openai_headers
        oai_msgs = _format_messages_for_openai_tools(messages)
        oai_payload = adapter.build_chat_payload(
            model=active_profile.model,
            messages=oai_msgs,
            temperature=temp,
            max_tokens=max_tok,
            stream=False,
            disable_reasoning=disable_reasoning,
            tools=tool_dicts,
            tool_choice="auto",
        )

        async with adapter.request_semaphore(headers):
            active_payload = dict(oai_payload)
            resp = await client.post(
                v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds
            )
            attempt = 0
            while resp.status_code == 400:
                err_lower = resp.text.lower()
                if _is_tools_unsupported_error_text(err_lower):
                    raise ToolsUnsupportedError(
                        f"{adapter.display_name} model '{active_profile.model}' does not support tools."
                    )
                retry_payload = adapter.next_bad_request_payload(active_payload, err_lower, attempt)
                if retry_payload is None:
                    break
                active_payload = retry_payload
                attempt += 1
                resp = await client.post(
                    v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds
                )

            if resp.status_code in (400, 422) and _is_tools_unsupported_error_text(resp.text.lower()):
                raise ToolsUnsupportedError(
                    f"{adapter.display_name} model '{active_profile.model}' does not support tools."
                )

            fallback, fatal_err = await adapter.resolve_model_fallback(
                client, target.root_url, headers, active_profile.model, resp.status_code, resp.text
            )
            if fallback:
                fallback_payload = dict(active_payload)
                fallback_payload["model"] = fallback
                fallback_resp = await client.post(
                    v1_url, headers=headers, json=fallback_payload, timeout=active_profile.timeout_seconds
                )
                if fallback_resp.status_code == 200:
                    active_payload = fallback_payload
                    resp = fallback_resp
                elif fallback_resp.status_code in (400, 422) and _is_tools_unsupported_error_text(
                    fallback_resp.text.lower()
                ):
                    raise ToolsUnsupportedError(
                        f"{adapter.display_name} fallback model '{fallback}' does not support tools."
                    )
                else:
                    raise RuntimeError(
                        f"{adapter.display_name} model '{active_profile.model}' failed during tool call (HTTP {fallback_resp.status_code})."
                    )
            elif fatal_err:
                raise RuntimeError(fatal_err)

            if resp.status_code == 404 and "model" in resp.text.lower():
                raise RuntimeError(
                    f"Model '{active_profile.model}' not found at {v1_url}: {resp.text}"
                )
            resp.raise_for_status()

        data = resp.json()
        choice0 = data["choices"][0]
        choice_msg = choice0["message"]
        usage = data.get("usage") or {}
        parsed_calls = _parse_tool_calls(choice_msg.get("tool_calls"))
        final_text = (
            choice_msg.get("content")
            or choice_msg.get("reasoning_content")
            or choice_msg.get("reasoning")
            or ""
        ).strip()
        _record_llm_telemetry(
            messages=oai_msgs,
            output_text=final_text or json.dumps([c.model_dump() for c in parsed_calls]),
            profile=active_profile,
            provider_type=target.provider_type,
            provider_id=target.provider_id,
            provider_name=target.provider_name,
            provider_color=target.provider_color,
            model_override=str(active_payload.get("model") or active_profile.model),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            finish_reason=choice0.get("finish_reason"),
            started_at=started_at,
            retries=attempt,
            cost_usd=_coerce_opt_cost_usd(usage.get("cost")),
        )
        return LlmToolCompletionResult(
            content=final_text,
            tool_calls=parsed_calls,
            done_reason=choice0.get("finish_reason"),
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
        )

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        profile: ModelProfile | None = None,
        disable_reasoning: bool = False,
    ) -> AsyncIterator[str]:
        """Stream token deltas from Ollama (/api/chat or /v1/chat/completions) or OpenRouter."""
        active_profile = profile or settings.actor_profile
        started_at = time.monotonic()
        target = await build_call_target(active_profile)

        if target.provider_type in ("browser_ollama", "webgpu") or target.credential_storage == "browser":
            ctx = getattr(active_profile, "context_size", None)
            if target.provider_type == "webgpu" and ctx is not None:
                ctx = min(int(ctx), get_webgpu_max_context(active_profile.model))
            usage_out: list[RelayStreamUsage] = []
            output_parts: list[str] = []
            first_token_at: float | None = None
            try:
                async for delta in local_relay_hub.stream(
                    user_id=target.owner_id or target.caller_user_id or relay_user_context.get(),
                    driver=target.provider_type,  # type: ignore[arg-type]
                    base_url=target.root_url,
                    model=active_profile.model,
                    messages=messages,
                    temperature=active_profile.temperature,
                    max_tokens=active_profile.max_tokens,
                    context_size=int(ctx) if ctx is not None else None,
                    keep_alive=format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                    disable_reasoning=disable_reasoning,
                    timeout=active_profile.timeout_seconds,
                    provider_id=target.provider_id,
                    usage_out=usage_out,
                ):
                    if delta and first_token_at is None:
                        first_token_at = time.monotonic()
                    output_parts.append(delta)
                    yield delta
            finally:
                u = usage_out[-1] if usage_out else None
                _record_llm_telemetry(
                    messages=messages,
                    output_text="".join(output_parts),
                    profile=active_profile,
                    provider_type=target.provider_type,
                    provider_id=target.provider_id,
                    provider_name=target.provider_name,
                    provider_color=target.provider_color,
                    prompt_tokens=u.prompt_tokens if u else None,
                    completion_tokens=u.completion_tokens if u else None,
                    finish_reason=u.done_reason if u else None,
                    started_at=started_at,
                    ttft_ms=(
                        max(0, int((first_token_at - started_at) * 1000))
                        if first_token_at is not None
                        else None
                    ),
                    eval_duration_ms=u.eval_duration_ms if u else None,
                    cost_usd=u.cost_usd if u else None,
                )
            return

        client = await self.get_http_client(timeout=active_profile.timeout_seconds)

        # 1. Prefer native Ollama streaming on /api/chat (only for Ollama providers)
        if not is_openai_compat_provider(target.provider_type):
            ollama_root = target.root_url
            ollama_chat_url = f"{ollama_root}/api/chat"
            stream_opts = _build_ollama_options(
                active_profile,
                temperature=active_profile.temperature,
                num_predict=active_profile.max_tokens,
            )
            ollama_payload: dict[str, Any] = {
                "model": active_profile.model,
                "messages": messages,
                "stream": True,
                "think": False,
                "keep_alive": format_ollama_keep_alive(getattr(active_profile, "keep_alive_minutes", 30)),
                "options": stream_opts,
            }
            try:
                need_retry_without_think = False
                ollama_stream_parts: list[str] = []
                ollama_prompt_tok: int | None = None
                ollama_comp_tok: int | None = None
                ollama_done_reason: Any = None
                ollama_eval_duration_ns: Any = None
                first_token_at: float | None = None
                async with client.stream("POST", ollama_chat_url, headers=target.native_headers, json=ollama_payload, timeout=active_profile.timeout_seconds) as resp:
                    if resp.status_code == 200:
                        try:
                            async for line in resp.aiter_lines():
                                if not line.strip():
                                    continue
                                try:
                                    chunk = json.loads(line)
                                    delta = chunk.get("message", {}).get("content")
                                    if delta:
                                        if first_token_at is None:
                                            first_token_at = time.monotonic()
                                        ollama_stream_parts.append(delta)
                                        yield delta
                                    if chunk.get("done"):
                                        ollama_prompt_tok = chunk.get("prompt_eval_count")
                                        ollama_comp_tok = chunk.get("eval_count")
                                        ollama_done_reason = chunk.get("done_reason")
                                        ollama_eval_duration_ns = chunk.get("eval_duration")
                                        return
                                except json.JSONDecodeError:
                                    continue
                            return
                        finally:
                            _record_llm_telemetry(
                                messages=messages,
                                output_text="".join(ollama_stream_parts),
                                profile=active_profile,
                                provider_type=target.provider_type,
                                provider_id=target.provider_id,
                                provider_name=target.provider_name,
                                provider_color=target.provider_color,
                                prompt_tokens=ollama_prompt_tok,
                                completion_tokens=ollama_comp_tok,
                                finish_reason=ollama_done_reason,
                                started_at=started_at,
                                ttft_ms=(
                                    max(0, int((first_token_at - started_at) * 1000))
                                    if first_token_at is not None
                                    else None
                                ),
                                eval_duration_ms=_ns_to_ms(ollama_eval_duration_ns),
                            )
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
                    ollama_stream_parts = []
                    ollama_prompt_tok = None
                    ollama_comp_tok = None
                    ollama_done_reason = None
                    ollama_eval_duration_ns = None
                    first_token_at = None
                    async with client.stream("POST", ollama_chat_url, headers=target.native_headers, json=retry_stream_payload, timeout=active_profile.timeout_seconds) as resp:
                        if resp.status_code == 200:
                            try:
                                async for line in resp.aiter_lines():
                                    if not line.strip():
                                        continue
                                    try:
                                        chunk = json.loads(line)
                                        delta = chunk.get("message", {}).get("content")
                                        if delta:
                                            if first_token_at is None:
                                                first_token_at = time.monotonic()
                                            ollama_stream_parts.append(delta)
                                            yield delta
                                        if chunk.get("done"):
                                            ollama_prompt_tok = chunk.get("prompt_eval_count")
                                            ollama_comp_tok = chunk.get("eval_count")
                                            ollama_done_reason = chunk.get("done_reason")
                                            ollama_eval_duration_ns = chunk.get("eval_duration")
                                            return
                                    except json.JSONDecodeError:
                                        continue
                                return
                            finally:
                                _record_llm_telemetry(
                                    messages=messages,
                                    output_text="".join(ollama_stream_parts),
                                    profile=active_profile,
                                    provider_type=target.provider_type,
                                    provider_id=target.provider_id,
                                    provider_name=target.provider_name,
                                    provider_color=target.provider_color,
                                    prompt_tokens=ollama_prompt_tok,
                                    completion_tokens=ollama_comp_tok,
                                    finish_reason=ollama_done_reason,
                                    started_at=started_at,
                                    retries=1,
                                    ttft_ms=(
                                        max(0, int((first_token_at - started_at) * 1000))
                                        if first_token_at is not None
                                        else None
                                    ),
                                    eval_duration_ms=_ns_to_ms(ollama_eval_duration_ns),
                                )
            except RuntimeError:
                raise
            except httpx.HTTPError:
                pass

        # 2. Direct OpenAI-compatible SSE streaming (/chat/completions) via adapter hierarchy
        adapter = get_openai_compat_provider(target.provider_type) or DEFAULT_OPENAI_COMPAT_PROVIDER
        v1_url = get_chat_completions_url(target)
        headers = target.openai_headers
        oai_payload = adapter.build_chat_payload(
            model=active_profile.model,
            messages=messages,
            temperature=active_profile.temperature,
            max_tokens=active_profile.max_tokens,
            stream=True,
            disable_reasoning=disable_reasoning,
        )

        async with adapter.request_semaphore(headers):
            active_payload = dict(oai_payload)
            if target.provider_type != "aihorde":
                active_payload["stream_options"] = {"include_usage": True}
            bad_request_attempt = 0
            oai_stream_parts: list[str] = []
            oai_prompt_tok: int | None = None
            oai_comp_tok: int | None = None
            oai_finish_reason: Any = None
            for attempt in range(4):
                try:
                    stream_ok = False
                    async with client.stream("POST", v1_url, headers=headers, json=active_payload, timeout=active_profile.timeout_seconds) as resp:
                        if resp.status_code == 400:
                            err_bytes = await resp.aread()
                            err_text = err_bytes.decode("utf-8", errors="ignore").lower()
                            if "stream_options" in active_payload and "stream_options" in err_text:
                                active_payload = {k: v for k, v in active_payload.items() if k != "stream_options"}
                                continue
                            retry_payload = adapter.next_bad_request_payload(
                                active_payload, err_text, bad_request_attempt
                            )
                            if retry_payload is not None:
                                active_payload = retry_payload
                                bad_request_attempt += 1
                                continue

                        if resp.status_code in (403, 404):
                            err_bytes = await resp.aread()
                            err_text = err_bytes.decode("utf-8", errors="ignore")
                            fallback, fatal_err = await adapter.resolve_model_fallback(
                                client,
                                target.root_url,
                                headers,
                                str(active_payload["model"]),
                                resp.status_code,
                                err_text,
                            )
                            if fallback and fallback != active_payload["model"]:
                                logger.warning(
                                    "%s streaming model '%s' offline; attempting fallback to '%s'",
                                    adapter.display_name,
                                    active_payload["model"],
                                    fallback,
                                )
                                active_payload["model"] = fallback
                                continue
                            if fatal_err:
                                raise RuntimeError(fatal_err)

                        resp.raise_for_status()
                        stream_ok = True
                        oai_stream_parts = []
                        oai_prompt_tok = None
                        oai_comp_tok = None
                        oai_finish_reason = None
                        oai_cost_usd: float | None = None
                        first_token_at: float | None = None
                        try:
                            async for line in resp.aiter_lines():
                                if not line or not line.startswith("data:"):
                                    continue
                                data_str = line[len("data:") :].strip()
                                if data_str == "[DONE]":
                                    break
                                try:
                                    chunk = json.loads(data_str)
                                    chunk_usage = chunk.get("usage")
                                    if isinstance(chunk_usage, dict):
                                        if chunk_usage.get("prompt_tokens") is not None:
                                            oai_prompt_tok = chunk_usage.get("prompt_tokens")
                                        if chunk_usage.get("completion_tokens") is not None:
                                            oai_comp_tok = chunk_usage.get("completion_tokens")
                                        if chunk_usage.get("cost") is not None:
                                            parsed_cost = _coerce_opt_cost_usd(chunk_usage.get("cost"))
                                            if parsed_cost is not None:
                                                oai_cost_usd = parsed_cost
                                    choices = chunk.get("choices", [])
                                    if choices:
                                        if choices[0].get("finish_reason"):
                                            oai_finish_reason = choices[0].get("finish_reason")
                                        delta = choices[0].get("delta", {})
                                        content = delta.get("content")
                                        if content:
                                            if first_token_at is None:
                                                first_token_at = time.monotonic()
                                            oai_stream_parts.append(content)
                                            yield content
                                except json.JSONDecodeError:
                                    continue
                        finally:
                            _record_llm_telemetry(
                                messages=messages,
                                output_text="".join(oai_stream_parts),
                                profile=active_profile,
                                provider_type=target.provider_type,
                                provider_id=target.provider_id,
                                provider_name=target.provider_name,
                                provider_color=target.provider_color,
                                model_override=str(active_payload.get("model") or active_profile.model),
                                prompt_tokens=oai_prompt_tok,
                                completion_tokens=oai_comp_tok,
                                finish_reason=oai_finish_reason,
                                started_at=started_at,
                                retries=bad_request_attempt,
                                ttft_ms=(
                                    max(0, int((first_token_at - started_at) * 1000))
                                    if first_token_at is not None
                                    else None
                                ),
                                cost_usd=oai_cost_usd,
                            )
                    if stream_ok:
                        break
                except Exception:
                    if attempt == 3 or not is_openai_compat_provider(target.provider_type):
                        raise


llm_client = LLMClient()
