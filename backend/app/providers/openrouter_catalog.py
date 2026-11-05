"""Global singleton in-memory cache for OpenRouter model catalog.

Complies with RFC 5861 directives (stale-while-revalidate and stale-if-error)
provided by OpenRouter's /api/v1/models Cache-Control header.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.schemas.provider import ProviderModelInfo

logger = logging.getLogger("cybercantina.openrouter_catalog")

DEFAULT_OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
EMBED_KEYWORDS = ("embed", "embedding")


def parse_cache_control_directives(header_value: str | None) -> dict[str, int]:
    """Extract numeric values from a Cache-Control header string."""
    directives: dict[str, int] = {}
    if not header_value:
        return directives
    for item in header_value.split(","):
        item = item.strip()
        if "=" in item:
            k, v = item.split("=", 1)
            k = k.strip().lower()
            try:
                directives[k] = int(v.strip())
            except ValueError:
                pass
    return directives


def parse_openrouter_models_payload(payload: dict[str, Any]) -> list[ProviderModelInfo]:
    """Parse OpenRouter /api/v1/models JSON into ProviderModelInfo instances."""
    models: list[ProviderModelInfo] = []
    items = payload.get("data", []) or []
    for item in items:
        model_id = item.get("id") or ""
        if not model_id:
            continue
        arch = item.get("architecture") or {}
        modality = str(arch.get("modality") or "")
        lowered_id = model_id.lower()
        is_embed = "embedding" in modality.lower() or any(k in lowered_id for k in EMBED_KEYWORDS)

        ctx = item.get("context_length")
        param_size = f"{ctx // 1000}k ctx" if isinstance(ctx, int) and ctx > 0 else ""

        family = model_id.split("/")[0] if "/" in model_id else ""

        models.append(
            ProviderModelInfo(
                name=model_id,
                size_mb=0,
                parameter_size=param_size,
                quantization_level="",
                family=family,
                is_embedding=is_embed,
            )
        )
    return models


class OpenRouterCatalogService:
    """Process-wide in-memory cache for OpenRouter's model catalog."""

    def __init__(self) -> None:
        self._cached_models: list[ProviderModelInfo] = []
        self._fetched_at: float = 0.0
        self._max_age: float = 120.0
        self._stale_while_revalidate: float = 3600.0
        self._stale_if_error: float = 3600.0
        self._lock = asyncio.Lock()
        self._inflight: asyncio.Task[list[ProviderModelInfo]] | None = None

    def get_cached_models_sync(self) -> list[ProviderModelInfo]:
        """Synchronous read of currently cached models (never blocks)."""
        return list(self._cached_models)

    def is_cached(self) -> bool:
        return bool(self._cached_models)

    def clear(self) -> None:
        """Reset cache state (primarily for tests)."""
        self._cached_models = []
        self._fetched_at = 0.0
        self._max_age = 120.0
        self._stale_while_revalidate = 3600.0
        self._stale_if_error = 3600.0
        if self._inflight and not self._inflight.done():
            self._inflight.cancel()
        self._inflight = None

    def _apply_cache_headers(self, headers: httpx.Headers) -> None:
        cc = headers.get("cache-control")
        directives = parse_cache_control_directives(cc)
        if "max-age" in directives:
            self._max_age = float(directives["max-age"])
        if "stale-while-revalidate" in directives:
            self._stale_while_revalidate = float(directives["stale-while-revalidate"])
        if "stale-if-error" in directives:
            self._stale_if_error = float(directives["stale-if-error"])

    async def _fetch_from_network(
        self,
        models_url: str = DEFAULT_OPENROUTER_MODELS_URL,
        client: httpx.AsyncClient | None = None,
    ) -> list[ProviderModelInfo]:
        """Perform the actual HTTP GET request and update the in-memory cache."""
        owns_client = False
        if client is None:
            client = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
            owns_client = True

        try:
            resp = await client.get(models_url, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            models = parse_openrouter_models_payload(data)
            self._apply_cache_headers(resp.headers)
            self._cached_models = models
            self._fetched_at = time.monotonic()
            return models
        finally:
            if owns_client:
                await client.aclose()

    async def _background_revalidate(
        self,
        models_url: str = DEFAULT_OPENROUTER_MODELS_URL,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        try:
            await self._fetch_from_network(models_url=models_url, client=client)
            logger.info("Background revalidation of OpenRouter catalog succeeded.")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Background revalidation of OpenRouter catalog failed: %s", exc)

    async def get_models(
        self,
        models_url: str = DEFAULT_OPENROUTER_MODELS_URL,
        client: httpx.AsyncClient | None = None,
        *,
        force: bool = False,
    ) -> list[ProviderModelInfo]:
        """Return the OpenRouter model catalog, honoring cache directives."""
        now = time.monotonic()
        age = now - self._fetched_at

        # 1. Fresh cache hit
        if self._cached_models and not force and age <= self._max_age:
            return list(self._cached_models)

        # 2. Stale-while-revalidate: return stale immediately, revalidate in background
        if (
            self._cached_models
            and not force
            and age <= (self._max_age + self._stale_while_revalidate)
        ):
            if self._inflight is None or self._inflight.done():
                self._inflight = asyncio.create_task(self._background_revalidate(models_url, client))
            return list(self._cached_models)

        # 3. Synchronous fetch needed (either no cache, forced, or past stale-while-revalidate)
        async with self._lock:
            # Recheck after acquiring lock in case another coroutine just updated it
            now = time.monotonic()
            age = now - self._fetched_at
            if self._cached_models and not force and age <= self._max_age:
                return list(self._cached_models)

            try:
                models = await self._fetch_from_network(models_url=models_url, client=client)
                return list(models)
            except Exception as exc:
                # 4. Stale-if-error: if network fails and we are within stale-if-error, serve stale cache
                if (
                    self._cached_models
                    and age <= (self._max_age + self._stale_if_error)
                ):
                    logger.warning(
                        "OpenRouter catalog fetch failed (%s); serving stale cache per stale-if-error directive.",
                        exc,
                    )
                    return list(self._cached_models)
                raise


openrouter_catalog_service = OpenRouterCatalogService()
