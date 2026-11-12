"""In-memory WebSocket relay hub bridging backend LLM calls to browser-local drivers."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import WebSocket

from app.schemas.provider import ProbeErrorCode, ProviderModelInfo, ProviderProbeResponse
from app.security.log_sanitize import sanitize_log_value

logger = logging.getLogger("cybercantina.local_relay")

# Set per HTTP request from X-Cantina-Tab-Id so nested engine calls route to the originating tab.
relay_tab_context: ContextVar[str | None] = ContextVar("relay_tab_context", default=None)
# Set per authenticated request so system-scoped browser providers route to the calling user.
relay_user_context: ContextVar[str | None] = ContextVar("relay_user_context", default=None)

BrowserDriver = Literal["browser_ollama", "webgpu"]


class RelayUnavailableError(RuntimeError):
    """Raised when no active browser relay session is connected for the provider's owner."""


class RelayRemoteError(RuntimeError):
    """Raised when the browser driver returns an explicit execution error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RelayCompletionResult:
    content: str
    thinking: str = ""
    done_reason: str | None = None


@dataclass
class RelayCapabilities:
    webgpu_supported: bool = False
    loaded_webgpu_model: str | None = None
    webgpu_error: str | None = None


@dataclass
class _RelaySession:
    user_id: str
    tab_id: str
    websocket: WebSocket
    connected_at: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)
    capabilities: RelayCapabilities = field(default_factory=RelayCapabilities)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send_json(self, payload: dict[str, Any]) -> None:
        async with self.send_lock:
            await self.websocket.send_json(payload)


@dataclass
class _PendingRequest:
    request_id: str
    user_id: str
    tab_id: str
    kind: Literal["complete", "stream", "probe"]
    future: asyncio.Future[Any] | None = None
    queue: asyncio.Queue[str | BaseException | None] | None = None


class LocalRelayHub:
    """Single-process hub managing user browser WebSocket relays and RPC futures."""

    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, _RelaySession]] = {}
        self._pending: dict[str, _PendingRequest] = {}

    def register(self, user_id: str, tab_id: str, websocket: WebSocket) -> _RelaySession:
        user_tabs = self._sessions.setdefault(user_id, {})
        existing = user_tabs.get(tab_id)
        if existing is not None and existing.websocket is not websocket:
            self._fail_tab_requests(user_id, tab_id, "Replaced by newer browser connection.")
        session = _RelaySession(user_id=user_id, tab_id=tab_id, websocket=websocket)
        user_tabs[tab_id] = session
        logger.info(
            "Local relay connected: user=%s tab=%s",
            sanitize_log_value(user_id),
            sanitize_log_value(tab_id),
        )
        return session

    def unregister(self, user_id: str, tab_id: str, session: _RelaySession) -> None:
        user_tabs = self._sessions.get(user_id)
        if not user_tabs:
            return
        if user_tabs.get(tab_id) is session:
            user_tabs.pop(tab_id, None)
            if not user_tabs:
                self._sessions.pop(user_id, None)
            self._fail_tab_requests(user_id, tab_id, "Browser relay disconnected before generation finished.")
            logger.info(
                "Local relay disconnected: user=%s tab=%s",
                sanitize_log_value(user_id),
                sanitize_log_value(tab_id),
            )

    def _fail_tab_requests(self, user_id: str, tab_id: str, reason: str) -> None:
        to_fail = [
            req_id
            for req_id, pend in self._pending.items()
            if pend.user_id == user_id and pend.tab_id == tab_id
        ]
        for req_id in to_fail:
            pend = self._pending.pop(req_id, None)
            if pend is None:
                continue
            err = RelayUnavailableError(reason)
            if pend.future is not None and not pend.future.done():
                pend.future.set_exception(err)
            if pend.queue is not None:
                pend.queue.put_nowait(err)

    def get_status(self, user_id: str) -> dict[str, Any]:
        user_tabs = self._sessions.get(user_id, {})
        tabs = [
            {
                "tab_id": tab_id,
                "webgpu_supported": sess.capabilities.webgpu_supported,
                "loaded_webgpu_model": sess.capabilities.loaded_webgpu_model,
                "webgpu_error": sess.capabilities.webgpu_error,
            }
            for tab_id, sess in user_tabs.items()
        ]
        return {"connected": bool(tabs), "tabs": tabs}

    def _pick_session(self, user_id: str | None, preferred_tab_id: str | None) -> _RelaySession:
        if not user_id:
            raise RelayUnavailableError("Local browser relay requires an authenticated provider owner.")
        user_tabs = self._sessions.get(user_id)
        if not user_tabs:
            raise RelayUnavailableError(
                "Browser inference relay is offline. Keep CyberCantina open in your browser tab."
            )
        if preferred_tab_id and preferred_tab_id in user_tabs:
            return user_tabs[preferred_tab_id]
        # Fall back to the most recently active tab for this user.
        return max(user_tabs.values(), key=lambda s: s.last_seen)

    async def handle_message(self, session: _RelaySession, raw: dict[str, Any]) -> None:
        session.last_seen = time.monotonic()
        msg_type = raw.get("type")

        if msg_type == "relay.hello":
            session.capabilities = RelayCapabilities(
                webgpu_supported=bool(raw.get("webgpu_supported", False)),
                loaded_webgpu_model=(str(raw["loaded_webgpu_model"]) if raw.get("loaded_webgpu_model") else None),
                webgpu_error=(str(raw["webgpu_error"]) if raw.get("webgpu_error") else None),
            )
            return

        if msg_type == "relay.pong":
            return

        req_id = str(raw.get("request_id") or "")
        pend = self._pending.get(req_id)
        if pend is None:
            return

        if msg_type == "llm.chunk":
            delta = raw.get("delta")
            if isinstance(delta, str) and delta and pend.queue is not None:
                pend.queue.put_nowait(delta)
            return

        if msg_type == "llm.done":
            self._pending.pop(req_id, None)
            if pend.kind == "stream" and pend.queue is not None:
                pend.queue.put_nowait(None)
            elif pend.future is not None and not pend.future.done():
                pend.future.set_result(
                    RelayCompletionResult(
                        content=str(raw.get("content") or ""),
                        thinking=str(raw.get("thinking") or ""),
                        done_reason=(str(raw["done_reason"]) if raw.get("done_reason") else None),
                    )
                )
            return

        if msg_type == "llm.error":
            self._pending.pop(req_id, None)
            code = str(raw.get("code") or "unknown")
            message = str(raw.get("message") or "Browser inference failed.")
            err = RelayRemoteError(code, message)
            if pend.future is not None and not pend.future.done():
                pend.future.set_exception(err)
            if pend.queue is not None:
                pend.queue.put_nowait(err)
            return

        if msg_type == "probe.result":
            self._pending.pop(req_id, None)
            if pend.future is not None and not pend.future.done():
                pend.future.set_result(raw)

    async def _send_cancel(self, session: _RelaySession, request_id: str) -> None:
        with contextlib.suppress(Exception):
            await session.send_json({"type": "llm.cancel", "request_id": request_id})

    async def complete(
        self,
        *,
        user_id: str | None,
        driver: BrowserDriver,
        base_url: str,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        context_size: int | None,
        keep_alive: str | int,
        json_mode: bool,
        json_schema: dict[str, Any] | None,
        disable_reasoning: bool,
        timeout: float,
    ) -> RelayCompletionResult:
        session = self._pick_session(user_id, relay_tab_context.get())
        request_id = f"req_{uuid.uuid4().hex}"
        loop = asyncio.get_running_loop()
        future: asyncio.Future[RelayCompletionResult] = loop.create_future()
        self._pending[request_id] = _PendingRequest(
            request_id=request_id,
            user_id=session.user_id,
            tab_id=session.tab_id,
            kind="complete",
            future=future,
        )
        payload = {
            "type": "llm.request",
            "request_id": request_id,
            "driver": driver,
            "mode": "complete",
            "base_url": base_url,
            "model": model,
            "messages": messages,
            "options": {
                "temperature": temperature,
                "max_tokens": max_tokens,
                "context_size": context_size,
                "keep_alive": keep_alive,
                "json_mode": json_mode,
                "json_schema": json_schema,
                "disable_reasoning": disable_reasoning,
            },
        }
        try:
            await session.send_json(payload)
            return await asyncio.wait_for(future, timeout=timeout)
        except Exception:
            if self._pending.pop(request_id, None) is not None:
                await self._send_cancel(session, request_id)
            raise

    async def stream(
        self,
        *,
        user_id: str | None,
        driver: BrowserDriver,
        base_url: str,
        model: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        context_size: int | None,
        keep_alive: str | int,
        disable_reasoning: bool,
        timeout: float,
    ) -> AsyncIterator[str]:
        session = self._pick_session(user_id, relay_tab_context.get())
        request_id = f"req_{uuid.uuid4().hex}"
        queue: asyncio.Queue[str | BaseException | None] = asyncio.Queue()
        self._pending[request_id] = _PendingRequest(
            request_id=request_id,
            user_id=session.user_id,
            tab_id=session.tab_id,
            kind="stream",
            queue=queue,
        )
        payload = {
            "type": "llm.request",
            "request_id": request_id,
            "driver": driver,
            "mode": "stream",
            "base_url": base_url,
            "model": model,
            "messages": messages,
            "options": {
                "temperature": temperature,
                "max_tokens": max_tokens,
                "context_size": context_size,
                "keep_alive": keep_alive,
                "json_mode": False,
                "json_schema": None,
                "disable_reasoning": disable_reasoning,
            },
        }
        completed = False
        try:
            await session.send_json(payload)
            while True:
                item = await asyncio.wait_for(queue.get(), timeout=timeout)
                if item is None:
                    completed = True
                    return
                if isinstance(item, BaseException):
                    completed = True
                    raise item
                yield item
        finally:
            if not completed and self._pending.pop(request_id, None) is not None:
                await self._send_cancel(session, request_id)

    async def probe(
        self,
        *,
        user_id: str,
        provider_id: str | None,
        driver: BrowserDriver,
        base_url: str,
        config_version: int,
        probed_at: str,
        timeout: float = 8.0,
    ) -> ProviderProbeResponse:
        try:
            session = self._pick_session(user_id, relay_tab_context.get())
        except RelayUnavailableError as exc:
            return ProviderProbeResponse(
                provider_id=provider_id,
                reachable=False,
                error_code="relay_offline",
                error=str(exc),
                config_version=config_version,
                probed_at=probed_at,
            )

        request_id = f"probe_{uuid.uuid4().hex}"
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[request_id] = _PendingRequest(
            request_id=request_id,
            user_id=session.user_id,
            tab_id=session.tab_id,
            kind="probe",
            future=future,
        )
        try:
            await session.send_json(
                {
                    "type": "probe.request",
                    "request_id": request_id,
                    "driver": driver,
                    "base_url": base_url,
                }
            )
            raw = await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(request_id, None)
            return ProviderProbeResponse(
                provider_id=provider_id,
                reachable=False,
                error_code="timeout",
                error="Browser probe timed out.",
                config_version=config_version,
                probed_at=probed_at,
            )
        except Exception as exc:  # noqa: BLE001
            self._pending.pop(request_id, None)
            return ProviderProbeResponse(
                provider_id=provider_id,
                reachable=False,
                error_code="unknown",
                error=str(exc),
                config_version=config_version,
                probed_at=probed_at,
            )

        models = [ProviderModelInfo.model_validate(m) for m in (raw.get("models") or [])]
        reachable = bool(raw.get("reachable", False))
        protocol = raw.get("protocol")
        if protocol not in ("ollama_native", "openai_compat"):
            protocol = None
        err_code_raw = raw.get("error_code")
        err_code: ProbeErrorCode | None = err_code_raw if isinstance(err_code_raw, str) else None  # type: ignore[assignment]
        return ProviderProbeResponse(
            provider_id=provider_id,
            reachable=reachable,
            protocol=protocol,
            models=models,
            chat_models=[m.name for m in models if not m.is_embedding],
            embedding_models=[m.name for m in models if m.is_embedding],
            error_code=None if reachable else (err_code or "unknown"),
            error=None if reachable else (str(raw.get("error") or "") or None),
            config_version=config_version,
            probed_at=probed_at,
        )

    async def close_all(self) -> None:
        sessions = [
            sess
            for user_tabs in self._sessions.values()
            for sess in user_tabs.values()
        ]
        self._sessions.clear()
        for pend in list(self._pending.values()):
            err = RelayUnavailableError("Server shutting down.")
            if pend.future is not None and not pend.future.done():
                pend.future.set_exception(err)
            if pend.queue is not None:
                pend.queue.put_nowait(err)
        self._pending.clear()
        for sess in sessions:
            with contextlib.suppress(Exception):
                await sess.websocket.close(code=1001)


local_relay_hub = LocalRelayHub()
