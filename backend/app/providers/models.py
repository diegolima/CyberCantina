"""Model catalog parsing shared by probes and the legacy Ollama status call."""

from __future__ import annotations

from typing import Any

from app.schemas.provider import ProviderModelInfo

EMBED_MODEL_KEYWORDS = ("embed", "minilm", "bge-", "nomic-embed", "mxbai-embed", "arctic-embed")


def parse_ollama_tags(payload: dict[str, Any]) -> list[ProviderModelInfo]:
    """Parse an Ollama ``/api/tags`` payload; embedding models are detected by name/family heuristic."""
    models: list[ProviderModelInfo] = []
    for item in payload.get("models", []) or []:
        name = item.get("name") or item.get("model") or ""
        if not name:
            continue
        details = item.get("details") or {}
        family = str(details.get("family") or "")
        lowered = name.lower()
        is_embed = any(k in lowered for k in EMBED_MODEL_KEYWORDS) or "bert" in family.lower()
        models.append(
            ProviderModelInfo(
                name=name,
                size_mb=round(int(item.get("size") or 0) / (1024 * 1024)),
                parameter_size=str(details.get("parameter_size") or ""),
                quantization_level=str(details.get("quantization_level") or ""),
                family=family,
                is_embedding=is_embed,
            )
        )
    return models


def parse_openai_models(payload: dict[str, Any]) -> list[ProviderModelInfo]:
    """Parse an OpenAI-compatible ``/models`` payload."""
    models: list[ProviderModelInfo] = []
    seen_names: set[str] = set()
    for item in payload.get("data", []) or []:
        name = str(item.get("id") or "").strip()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        lowered = name.lower()
        family = name.split("/", 1)[0] if "/" in name else ""
        models.append(
            ProviderModelInfo(
                name=name,
                family=family,
                is_embedding=any(k in lowered for k in EMBED_MODEL_KEYWORDS),
            )
        )
    return models


def parse_aihorde_models(payload: dict[str, Any]) -> list[ProviderModelInfo]:
    """Parse an AI Horde OpenAI-compatible ``/v1/models`` payload and sort by Option A capacity score."""
    models: list[ProviderModelInfo] = []
    items = payload.get("data", []) or []
    for item in items:
        name = item.get("id") or ""
        if not name:
            continue
        family = name.split("/")[0] if "/" in name else ""
        ctx = item.get("context_length")
        x_horde = item.get("x_horde") or {}
        workers = int(x_horde.get("workers") or 0)
        queued = float(x_horde.get("queued") or 0.0)
        supported_params = [str(p) for p in (item.get("supported_parameters") or [])]

        ctx_part = f"{ctx // 1000}k ctx" if isinstance(ctx, int) and ctx > 0 else ""
        worker_part = f"{workers}w" if workers > 0 else "0w"
        param_size = f"{ctx_part} • {worker_part}".strip(" •")

        models.append(
            ProviderModelInfo(
                name=name,
                size_mb=0,
                parameter_size=param_size,
                quantization_level="",
                family=family,
                is_embedding=False,
                workers=workers,
                queued=queued,
                supported_parameters=supported_params,
            )
        )
    # Option A: workers descending, queued ascending
    models.sort(key=lambda m: (m.workers * 1000 - m.queued), reverse=True)
    return models


def parse_nanogpt_models(
    chat_payload: dict[str, Any],
    embedding_payload: dict[str, Any] | None = None,
) -> list[ProviderModelInfo]:
    """Parse NanoGPT ``/api/v1/models`` and optional ``/api/v1/embedding-models`` payloads."""
    models: list[ProviderModelInfo] = []
    seen_names: set[str] = set()

    for item in chat_payload.get("data", []) or []:
        name = str(item.get("id") or "").strip()
        if not name or name in seen_names:
            continue
        seen_names.add(name)
        family = name.split("/", 1)[0] if "/" in name else ""
        models.append(
            ProviderModelInfo(
                name=name,
                family=family,
                is_embedding=any(k in name.lower() for k in EMBED_MODEL_KEYWORDS),
            )
        )

    if embedding_payload:
        for item in embedding_payload.get("data", []) or []:
            name = str(item.get("id") or "").strip()
            if not name or name in seen_names:
                continue
            seen_names.add(name)
            family = name.split("/", 1)[0] if "/" in name else ""
            models.append(
                ProviderModelInfo(
                    name=name,
                    family=family,
                    is_embedding=True,
                )
            )

    return models
