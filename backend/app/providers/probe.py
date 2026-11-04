"""Provider health probing: bounded, single-flight, cached, SSRF-checked, secret-safe."""

from __future__ import annotations

import asyncio
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.db.provider_store import ProviderStore
from app.providers.models import parse_ollama_tags, parse_openai_models
from app.schemas.provider import (
    ProbeErrorCode,
    ProviderDraft,
    ProviderModelInfo,
    ProviderProbeResponse,
    ProviderRecord,
)
from app.security.secret_box import SecretDecryptionError
from app.security.url_policy import UrlBlockedError, assert_url_allowed, normalize_base_url

PROBE_TIMEOUT_SECONDS = 3.0
PROBE_CACHE_TTL_SECONDS = 10.0
MAX_CONCURRENT_PROBES = 8
USER_PROBES_PER_MINUTE = 30


def bearer_headers(token: str | None) -> dict[str, str]:
    """The single place that turns a token into request headers (never set on shared clients)."""
    return {"Authorization": f"Bearer {token}"} if token else {}


class ProbeRateLimited(RuntimeError):
    pass


class TokenBucket:
    """Tiny sliding-window limiter keyed by user id."""

    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        if len(hits) >= self.limit:
            self._hits[key] = hits
            raise ProbeRateLimited(key)
        hits.append(now)
        self._hits[key] = hits


@dataclass
class _Outcome:
    reachable: bool
    protocol: str | None = None
    models: list[ProviderModelInfo] | None = None
    error_code: ProbeErrorCode | None = None
    error: str | None = None


def _classify_exception(exc: Exception) -> tuple[ProbeErrorCode, str]:
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


async def _probe_once(root_url: str, token: str | None, *, restricted: bool, client: httpx.AsyncClient) -> _Outcome:
    try:
        url = normalize_base_url(root_url)
        await assert_url_allowed(url, allow_private=not restricted)
    except UrlBlockedError as exc:
        return _Outcome(False, error_code=exc.code if exc.code in ("dns_failure", "invalid_url") else "blocked_by_policy", error=str(exc))  # type: ignore[arg-type]
    headers = bearer_headers(token)
    try:
        resp = await client.get(f"{url.root}/api/tags", headers=headers, timeout=PROBE_TIMEOUT_SECONDS)
        if resp.status_code == 200:
            try:
                return _Outcome(True, "ollama_native", parse_ollama_tags(resp.json()))
            except ValueError:
                return _Outcome(False, error_code="bad_payload", error="Server returned a non-JSON model list.")
        if resp.status_code == 401:
            return _Outcome(False, error_code="unauthorized", error="HTTP 401: the server rejected the credentials.")
        if resp.status_code == 403:
            return _Outcome(False, error_code="forbidden", error="HTTP 403: access denied by the server.")
        if resp.status_code == 404:
            # Not native Ollama: try the OpenAI-compatible catalog before declaring failure.
            alt = await client.get(f"{url.root}/v1/models", headers=headers, timeout=PROBE_TIMEOUT_SECONDS)
            if alt.status_code == 200:
                try:
                    return _Outcome(True, "openai_compat", parse_openai_models(alt.json()))
                except ValueError:
                    return _Outcome(False, error_code="bad_payload", error="Server returned a non-JSON model list.")
            if alt.status_code in (401, 403):
                code: ProbeErrorCode = "unauthorized" if alt.status_code == 401 else "forbidden"
                return _Outcome(False, error_code=code, error=f"HTTP {alt.status_code}")
            return _Outcome(False, error_code="not_found", error="Neither /api/tags nor /v1/models was found.")
        return _Outcome(False, error_code="unknown", error=f"HTTP {resp.status_code}")
    except Exception as exc:  # noqa: BLE001 - mapped to a closed set of codes
        code, text = _classify_exception(exc)
        return _Outcome(False, error_code=code, error=text)


def _to_response(
    outcome: _Outcome, *, provider_id: str | None, version: int, from_cache: bool, probed_at: str
) -> ProviderProbeResponse:
    models = outcome.models or []
    return ProviderProbeResponse(
        provider_id=provider_id,
        reachable=outcome.reachable,
        protocol=outcome.protocol,  # type: ignore[arg-type]
        models=models,
        chat_models=[m.name for m in models if not m.is_embedding],
        embedding_models=[m.name for m in models if m.is_embedding],
        error_code=outcome.error_code,
        error=outcome.error,
        config_version=version,
        probed_at=probed_at,
        from_cache=from_cache,
    )


class ProbeService:
    """Process-wide probe coordinator (single process assumption, see implementation plan C6)."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._inflight: dict[tuple[str, int], asyncio.Task[ProviderProbeResponse]] = {}
        self._cache: dict[tuple[str, int], tuple[float, ProviderProbeResponse]] = {}
        self._semaphore: asyncio.Semaphore | None = None
        self.user_limiter = TokenBucket(USER_PROBES_PER_MINUTE)

    def _http(self) -> httpx.AsyncClient:
        # Dedicated pool so a hung provider can never starve generation traffic (and vice versa).
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                follow_redirects=False,
                timeout=PROBE_TIMEOUT_SECONDS,
                limits=httpx.Limits(max_connections=MAX_CONCURRENT_PROBES * 2, max_keepalive_connections=4),
            )
        return self._client

    def _sem(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_PROBES)
        return self._semaphore

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    def invalidate(self, provider_id: str) -> None:
        for key in [k for k in self._cache if k[0] == provider_id]:
            self._cache.pop(key, None)

    async def probe(
        self, record: ProviderRecord, store: ProviderStore, *, force: bool = False
    ) -> ProviderProbeResponse:
        key = (record.id, record.version)
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached and not force and now - cached[0] < PROBE_CACHE_TTL_SECONDS:
            return cached[1].model_copy(update={"from_cache": True})
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._run(record, store))
            self._inflight[key] = task
            task.add_done_callback(lambda _t, k=key: self._inflight.pop(k, None))
        # shield: one caller cancelling must not cancel the shared probe for the others
        return await asyncio.shield(task)

    async def _run(self, record: ProviderRecord, store: ProviderStore) -> ProviderProbeResponse:
        try:
            token = store.bearer_token(record)
        except SecretDecryptionError as exc:
            outcome = _Outcome(False, error_code="unauthorized", error=str(exc))
        else:
            async with self._sem():
                outcome = await _probe_once(
                    record.base_url, token, restricted=record.network_restricted, client=self._http()
                )
        probed_at = datetime.now(timezone.utc).isoformat()
        response = _to_response(
            outcome, provider_id=record.id, version=record.version, from_cache=False, probed_at=probed_at
        )
        self._cache[(record.id, record.version)] = (time.monotonic(), response)
        # Persist off the event loop (sync sqlite); only the catalog changes cause row writes.
        await asyncio.to_thread(
            store.record_probe,
            record.id,
            models=outcome.models if outcome.reachable else None,
            error_code=None if outcome.reachable else outcome.error_code,
            probed_at=probed_at,
        )
        return response

    async def probe_draft(
        self, draft: ProviderDraft, store: ProviderStore, *, restricted: bool, token: str | None
    ) -> ProviderProbeResponse:
        """Test an unsaved configuration. ``token`` is resolved by the caller (stored token reuse rules)."""
        async with self._sem():
            outcome = await _probe_once(draft.base_url, token, restricted=restricted, client=self._http())
        return _to_response(
            outcome,
            provider_id=draft.provider_id,
            version=0,
            from_cache=False,
            probed_at=datetime.now(timezone.utc).isoformat(),
        )


probe_service = ProbeService()


async def probe_system_providers(store: ProviderStore, service: ProbeService | None = None) -> int:
    """Probe every enabled system provider (sequentially, bounded by the probe timeout).

    Keeps the persisted status fresh so users can see the last known state of system providers
    without being able to trigger connections themselves. Returns the number of providers probed.
    """
    active = service or probe_service
    probed = 0
    for record in store.list_system():
        if record.is_enabled:
            await active.probe(record, store, force=True)
            probed += 1
    return probed
