"""Pydantic schemas and domain records for LLM providers."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

ProviderType = Literal["ollama"]
ProviderScope = Literal["system", "user"]
ProviderColor = Literal["neutral", "cyan", "purple", "indigo", "bronze"]
ProbeErrorCode = Literal[
    "dns_failure",
    "connect_refused",
    "timeout",
    "tls_error",
    "unauthorized",
    "forbidden",
    "not_found",
    "bad_payload",
    "blocked_by_policy",
    "invalid_url",
    "rate_limited",
    "unknown",
]
UnusableReason = Literal["disabled", "byop_disabled"]

MAX_PROVIDER_NAME_LENGTH = 60


def normalize_provider_name(raw: str) -> str:
    """Trim, collapse whitespace and reject control characters. Raises ValueError when empty/invalid."""
    cleaned = " ".join((raw or "").split())
    if not cleaned:
        raise ValueError("Provider name must not be empty.")
    if len(cleaned) > MAX_PROVIDER_NAME_LENGTH:
        raise ValueError(f"Provider name must be at most {MAX_PROVIDER_NAME_LENGTH} characters.")
    if any(unicodedata.category(ch).startswith("C") for ch in cleaned):
        raise ValueError("Provider name must not contain control characters.")
    return cleaned


def provider_name_key(name: str) -> str:
    """Uniqueness key: NFKC-normalized, casefolded, whitespace-collapsed."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


class ProviderModelInfo(BaseModel):
    """Model metadata discovered by a probe and cached on the provider."""

    name: str
    size_mb: int = 0
    parameter_size: str = ""
    quantization_level: str = ""
    family: str = ""
    is_embedding: bool = False


class OllamaProviderSettings(BaseModel):
    base_url: str = Field(..., description="Mandatory server URL, e.g. http://localhost:11434")
    bearer_token: str | None = Field(default=None, description="Optional bearer token for hosted endpoints.")


class ProviderCreatePayload(BaseModel):
    name: str | None = Field(default=None, description="Defaults to the provider type.")
    type: ProviderType = "ollama"
    scope: ProviderScope = "user"
    color: ProviderColor = "neutral"
    is_enabled: bool = True
    settings: OllamaProviderSettings


class ProviderUpdatePayload(BaseModel):
    expected_version: int
    name: str | None = None
    color: ProviderColor | None = None
    is_enabled: bool | None = None
    base_url: str | None = None
    bearer_token: str | None = Field(default=None, description="Set or rotate the token.")
    clear_bearer_token: bool = False


class ProviderDraft(BaseModel):
    """Unsaved provider configuration to test before saving."""

    provider_id: str | None = None
    type: ProviderType = "ollama"
    base_url: str
    bearer_token: str | None = None


class ProviderResponse(BaseModel):
    id: str
    name: str
    type: ProviderType
    scope: ProviderScope
    owner_id: str | None = None
    color: ProviderColor
    is_enabled: bool
    base_url: str | None = None
    has_bearer_token: bool
    usable: bool = True
    unusable_reason: UnusableReason | None = None
    cached_models: list[ProviderModelInfo] = Field(default_factory=list)
    last_probed_at: str | None = None
    last_error_code: ProbeErrorCode | None = None
    version: int
    created_at: str
    updated_at: str


class ProviderProbeResponse(BaseModel):
    provider_id: str | None = None
    reachable: bool
    protocol: Literal["ollama_native", "openai_compat"] | None = None
    models: list[ProviderModelInfo] = Field(default_factory=list)
    chat_models: list[str] = Field(default_factory=list)
    embedding_models: list[str] = Field(default_factory=list)
    error_code: ProbeErrorCode | None = None
    error: str | None = Field(default=None, description="Detailed error text; only for admins and owners.")
    config_version: int = 0
    probed_at: str
    from_cache: bool = False


class ProviderReference(BaseModel):
    kind: Literal["system_role", "user_override", "embedding"]
    role: str | None = None
    user_count: int = 0


class ProviderDeleteConflict(BaseModel):
    detail: str
    referenced_by: list[ProviderReference]


@dataclass
class ProviderRecord:
    """Internal row representation. Never serialize directly: it carries the sealed secret."""

    id: str
    name: str
    name_key: str
    type: str
    scope: str
    owner_id: str | None
    color: str
    is_enabled: bool
    base_url: str
    secret_enc: bytes | None = field(default=None, repr=False)
    network_restricted: bool = False
    cached_models: list[ProviderModelInfo] = field(default_factory=list)
    models_hash: str | None = None
    last_probed_at: str | None = None
    last_error_code: str | None = None
    version: int = 1
    created_at: str = ""
    updated_at: str = ""
