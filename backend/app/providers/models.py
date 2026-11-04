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
    """Parse an OpenAI-compatible ``/v1/models`` payload."""
    models: list[ProviderModelInfo] = []
    for item in payload.get("data", []) or []:
        name = item.get("id") or ""
        if not name:
            continue
        lowered = name.lower()
        models.append(
            ProviderModelInfo(name=name, is_embedding=any(k in lowered for k in EMBED_MODEL_KEYWORDS))
        )
    return models
