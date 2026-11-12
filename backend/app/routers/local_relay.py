"""WebSocket endpoint and status API for the browser-local inference relay."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.auth import SESSION_COOKIE_NAME, get_current_user, resolve_optional_user
from app.dependencies import get_repo
from app.providers.local_relay import local_relay_hub
from app.schemas.auth import UserProfile
from app.security.log_sanitize import sanitize_log_value

router = APIRouter(prefix="/api/local-relay", tags=["local-relay"])

_HEARTBEAT_SECONDS = 25.0
_AUTH_TIMEOUT_SECONDS = 5.0


def _allowed_ws_origins(websocket: WebSocket) -> set[str]:
    allowed: set[str] = set()
    env_origins = os.environ.get("CYBERCANTINA_ALLOWED_ORIGINS")
    if env_origins:
        allowed.update(o.strip().rstrip("/") for o in env_origins.split(",") if o.strip())
    else:
        allowed.update(
            {
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8000",
                "http://127.0.0.1:8000",
                "http://testserver",
            }
        )
    host = (websocket.headers.get("host") or "").strip()
    if host:
        allowed.add(f"http://{host}")
        allowed.add(f"https://{host}")
    return allowed


def _is_origin_allowed(websocket: WebSocket) -> bool:
    origin = (websocket.headers.get("origin") or "").strip().rstrip("/")
    if not origin:
        return True
    parsed = urlparse(origin)
    normalized = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return normalized in _allowed_ws_origins(websocket)


def _extract_ws_token(websocket: WebSocket) -> str | None:
    auth_header = websocket.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        tok = auth_header[7:].strip()
        if tok:
            return tok
    cookie_tok = websocket.cookies.get(SESSION_COOKIE_NAME)
    if cookie_tok:
        return cookie_tok.strip()
    return None


@router.get("/status")
def get_local_relay_status(user: UserProfile = Depends(get_current_user)) -> dict[str, object]:
    """Return active browser relay tabs and WebGPU status for the authenticated user."""
    return local_relay_hub.get_status(user.id)


@router.websocket("/ws")
async def local_relay_ws(websocket: WebSocket) -> None:
    """Persistent bidirectional WebSocket connecting a user's browser drivers to LocalRelayHub."""
    if not _is_origin_allowed(websocket):
        await websocket.close(code=4403)
        return

    repo = get_repo()
    user = resolve_optional_user(repo, _extract_ws_token(websocket))
    await websocket.accept()

    if user is None:
        # Support bearer-only clients sending a first-frame relay.auth payload (never in URL query).
        try:
            first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=_AUTH_TIMEOUT_SECONDS)
            first_msg = json.loads(first_raw)
            if isinstance(first_msg, dict) and first_msg.get("type") == "relay.auth":
                token = str(first_msg.get("token") or "").strip() or None
                user = resolve_optional_user(repo, token)
        except Exception:
            user = None
        if user is None:
            await websocket.close(code=4401)
            return

    raw_tab = websocket.query_params.get("tab_id") or "default"
    tab_id = sanitize_log_value(raw_tab).strip()[:64] or "default"
    session = local_relay_hub.register(user.id, tab_id, websocket)

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_SECONDS)
            await session.send_json({"type": "relay.ping", "ts": time.time()})

    hb_task = asyncio.create_task(_heartbeat())
    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await local_relay_hub.handle_message(session, msg)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hb_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hb_task
        local_relay_hub.unregister(user.id, tab_id, session)
