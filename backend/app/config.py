"""Configuration management for CyberCantina LLM roles and memory settings."""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.providers.endpoint import ResolvedEndpoint

logger = logging.getLogger("cybercantina.config")

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parent.parent / "cantina_settings.json"
SETTINGS_FILE_PATH = Path(
    os.environ.get("CYBERCANTINA_SETTINGS_PATH", str(DEFAULT_SETTINGS_PATH))
)

AgentDispatchMode = Literal["sequential", "parallel"]


class ModelProfile(BaseModel):
    """Model role profile for Actor or Clerk: which provider + model, and sampling parameters.

    Connection details live on the referenced provider (``provider_id``). ``base_url`` and
    ``api_key`` are LEGACY fields kept only so that unmigrated installs and offline tests keep
    working; whenever ``provider_id`` is set the provider always wins and these are ignored.
    ``api_key`` is never serialized.
    """

    provider_id: str | None = Field(
        default=None,
        description="ID of the provider (see /api/providers) that serves this role.",
    )
    base_url: str = Field(
        default="http://localhost:11434/v1",
        description="LEGACY: ignored when provider_id is set.",
    )
    api_key: str = Field(
        default="ollama",
        exclude=True,
        repr=False,
        description="LEGACY and never persisted: tokens now live (encrypted) on the provider.",
    )
    resolved: ResolvedEndpoint | None = Field(
        default=None,
        exclude=True,
        repr=False,
        description="Runtime-only endpoint resolved from provider_id for the current request.",
    )
    model: str = Field(
        default="llama3.1:8b",
        description="Model identifier in Ollama (e.g. 'llama3.2:latest', 'qwen2.5:7b', 'mistral:latest').",
    )
    temperature: float = Field(default=0.75, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1024, ge=64, le=8192)
    timeout_seconds: float = Field(default=120.0, ge=5.0, le=600.0)


class EmbeddingProfile(BaseModel):
    """Configuration for semantic vector embeddings."""

    provider_id: str | None = Field(
        default=None,
        description="System-scope provider serving embeddings (mode 'openai_compat').",
    )
    mode: Literal["local_hash", "openai_compat", "fastembed"] = Field(
        default="local_hash",
        description=(
            "'local_hash' uses zero-dependency deterministic n-gram feature hashing; "
            "'openai_compat' calls Ollama /api/embed or /v1/embeddings; 'fastembed' uses local ONNX embeddings."
        ),
    )
    base_url: str = Field(default="http://localhost:11434/v1", description="LEGACY: ignored when provider_id is set.")
    api_key: str = Field(default="ollama", exclude=True, repr=False)
    model: str = Field(default="nomic-embed-text")
    dimensions: int = Field(default=384, ge=64, le=4096)


class MemoryTierConfig(BaseModel):
    """3-Tier context management thresholds."""

    working_memory_turns: int = Field(
        default=12,
        ge=4,
        le=64,
        description="Number of verbatim turns kept in Zone 3 Working Memory before compression.",
    )
    episodic_chunk_size: int = Field(
        default=6,
        ge=2,
        le=32,
        description="Number of oldest working memory turns compressed into a Zone 2 Episodic Summary.",
    )
    rag_top_k: int = Field(
        default=4,
        ge=1,
        le=15,
        description="Maximum recalled vector memories & lore entries injected into Zone 4.",
    )
    ephemeral_memory_lifespan_turns: int = Field(
        default=40,
        ge=4,
        le=200,
        description=(
            "Number of turns before unpromoted Clerk-extracted ephemeral character memories "
            "are compacted into a single permanent memory."
        ),
    )
    max_scene_flags: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of active scene flags kept in world snapshots via sliding FIFO.",
    )


class AppSettings(BaseModel):
    """Global runtime settings for CyberCantina."""

    db_path: str = Field(
        default_factory=lambda: os.environ.get(
            "CYBERCANTINA_DB_PATH",
            str(Path(__file__).resolve().parent.parent / "cybercantina.db"),
        )
    )
    media_dir: str = Field(
        default_factory=lambda: os.environ.get(
            "CYBERCANTINA_MEDIA_DIR",
            str(Path(__file__).resolve().parent.parent / "data" / "media"),
        )
    )
    actor_profile: ModelProfile = Field(
        default_factory=lambda: ModelProfile(
            base_url=os.environ.get("ACTOR_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.environ.get("ACTOR_API_KEY", "ollama"),
            model=os.environ.get("ACTOR_MODEL", "llama3.1:8b"),
            temperature=0.8,
            max_tokens=1024,
        )
    )
    clerk_profile: ModelProfile = Field(
        default_factory=lambda: ModelProfile(
            base_url=os.environ.get("CLERK_BASE_URL", "http://localhost:11434/v1"),
            api_key=os.environ.get("CLERK_API_KEY", "ollama"),
            model=os.environ.get("CLERK_MODEL", "llama3.1:8b"),
            temperature=0.2,
            max_tokens=768,
        )
    )
    embedding_profile: EmbeddingProfile = Field(default_factory=EmbeddingProfile)
    memory_config: MemoryTierConfig = Field(default_factory=MemoryTierConfig)
    allow_offline_fallback: bool = Field(
        default=False,
        description="When True, falls back to built-in heuristic simulation if the LLM endpoint is unreachable.",
    )
    allow_user_model_overrides: bool = Field(
        default=False,
        description="When True, users can customize their own Actor and Clerk models in their Profile.",
    )
    allow_user_providers: bool = Field(
        default=False,
        description=(
            "When True (BYOP), users can register their own private providers. Forces "
            "allow_user_model_overrides to True."
        ),
    )
    clerk_mirrors_actor: bool = Field(
        default=False,
        description="When True, the Clerk uses the Actor's provider and model (sampling stays separate).",
    )
    settings_revision: int = Field(
        default=0,
        ge=0,
        description="Monotonic counter bumped on every admin save, for optimistic concurrency.",
    )
    delegate_cognition_to_clerk: bool = Field(
        default=False,
        description="When True, the analytical Clerk model generates character cognition (<cognition> block) before the Actor writes narrative prose.",
    )
    agent_dispatch_mode: AgentDispatchMode = Field(
        default="sequential",
        description=(
            "Execution mode for per-character agents: 'sequential' runs one agent at a time "
            "(safe for single-GPU local servers like Ollama), while 'parallel' dispatches "
            "agents concurrently via asyncio.gather (fast on cloud APIs or multi-slot vLLM)."
        ),
    )

    @model_validator(mode="after")
    def enforce_byop_coupling(self) -> "AppSettings":
        """BYOP implies per-user model overrides (a provider is useless without selectable models)."""
        if self.allow_user_providers and not self.allow_user_model_overrides:
            self.allow_user_model_overrides = True
        return self


def load_initial_settings() -> AppSettings:
    """Load persisted settings from cantina_settings.json if available, else defaults."""
    default_db_path = os.environ.get(
        "CYBERCANTINA_DB_PATH",
        str(Path(__file__).resolve().parent.parent / "cybercantina.db"),
    )
    default_media_dir = os.environ.get(
        "CYBERCANTINA_MEDIA_DIR",
        str(Path(__file__).resolve().parent.parent / "data" / "media"),
    )
    if SETTINGS_FILE_PATH.exists():
        try:
            raw = json.loads(SETTINGS_FILE_PATH.read_text(encoding="utf-8"))
            raw.pop("db_path", None)
            raw.pop("media_dir", None)
            loaded = AppSettings.model_validate(raw)
            loaded.db_path = default_db_path
            loaded.media_dir = default_media_dir
            return loaded
        except Exception:
            pass
    return AppSettings(db_path=default_db_path, media_dir=default_media_dir)


def persist_settings(current: AppSettings) -> None:
    """Atomically persist runtime settings to cantina_settings.json.

    Writes to a temp file in the same directory and ``os.replace``s it, so a crash can never leave
    a truncated file (which ``load_initial_settings`` would silently discard). Raises ``OSError``
    on failure instead of swallowing it.
    """
    target = Path(SETTINGS_FILE_PATH)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = current.model_dump_json(exclude={"db_path", "media_dir"}, indent=2)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=".cantina_settings.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


settings = load_initial_settings()
