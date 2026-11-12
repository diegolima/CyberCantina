"""Curated WebGPU (WebLLM) model catalog and context ceilings."""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.provider import ProviderModelInfo

DEFAULT_WEBGPU_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC"
DEFAULT_WEBGPU_CONTEXT_SIZE = 4096


@dataclass(frozen=True)
class WebGpuModelSpec:
    """Metadata for one curated WebLLM prebuilt model."""

    name: str
    size_mb: int
    parameter_size: str
    quantization_level: str
    family: str
    max_context_tokens: int


WEBGPU_CURATED_CATALOG: tuple[WebGpuModelSpec, ...] = (
    WebGpuModelSpec(
        name="Qwen2.5-3B-Instruct-q4f16_1-MLC",
        size_mb=2505,
        parameter_size="3B",
        quantization_level="q4f16_1",
        family="qwen2",
        max_context_tokens=4096,
    ),
    WebGpuModelSpec(
        name="Llama-3.2-3B-Instruct-q4f16_1-MLC",
        size_mb=2264,
        parameter_size="3B",
        quantization_level="q4f16_1",
        family="llama",
        max_context_tokens=4096,
    ),
    WebGpuModelSpec(
        name="Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
        size_mb=2264,
        parameter_size="3B",
        quantization_level="q4f16_1",
        family="llama",
        max_context_tokens=4096,
    ),
    WebGpuModelSpec(
        name="Qwen3-4B-q4f16_1-MLC",
        size_mb=3432,
        parameter_size="4B",
        quantization_level="q4f16_1",
        family="qwen3",
        max_context_tokens=8192,
    ),
    WebGpuModelSpec(
        name="Qwen2.5-7B-Instruct-q4f16_1-MLC",
        size_mb=5107,
        parameter_size="7B",
        quantization_level="q4f16_1",
        family="qwen2",
        max_context_tokens=8192,
    ),
    WebGpuModelSpec(
        name="Llama-3.1-8B-Instruct-q4f16_1-MLC",
        size_mb=5001,
        parameter_size="8B",
        quantization_level="q4f16_1",
        family="llama",
        max_context_tokens=8192,
    ),
    WebGpuModelSpec(
        name="Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
        size_mb=4876,
        parameter_size="8B",
        quantization_level="q4f16_1",
        family="llama",
        max_context_tokens=8192,
    ),
    WebGpuModelSpec(
        name="Qwen3-8B-q4f16_1-MLC",
        size_mb=5696,
        parameter_size="8B",
        quantization_level="q4f16_1",
        family="qwen3",
        max_context_tokens=8192,
    ),
    WebGpuModelSpec(
        name="SmolLM2-1.7B-Instruct-q4f16_1-MLC",
        size_mb=1774,
        parameter_size="1.7B",
        quantization_level="q4f16_1",
        family="llama",
        max_context_tokens=4096,
    ),
    WebGpuModelSpec(
        name="gemma-2-2b-it-q4f16_1-MLC",
        size_mb=1895,
        parameter_size="2B",
        quantization_level="q4f16_1",
        family="gemma2",
        max_context_tokens=4096,
    ),
)

WEBGPU_MAX_CONTEXT_BY_MODEL: dict[str, int] = {
    spec.name: spec.max_context_tokens for spec in WEBGPU_CURATED_CATALOG
}


def get_webgpu_model_infos() -> list[ProviderModelInfo]:
    """Return the curated WebGPU models formatted for provider catalog caching."""
    return [
        ProviderModelInfo(
            name=spec.name,
            size_mb=spec.size_mb,
            parameter_size=spec.parameter_size,
            quantization_level=spec.quantization_level,
            family=spec.family,
            is_embedding=False,
        )
        for spec in WEBGPU_CURATED_CATALOG
    ]


def get_webgpu_max_context(model_name: str | None) -> int:
    """Return the safe browser VRAM context cap for a WebGPU model."""
    if not model_name:
        return DEFAULT_WEBGPU_CONTEXT_SIZE
    return WEBGPU_MAX_CONTEXT_BY_MODEL.get(model_name, DEFAULT_WEBGPU_CONTEXT_SIZE)
