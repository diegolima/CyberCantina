"""Tests for browser_ollama and webgpu providers, WebSocket relay, context clamping, and auto-provisioning."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app import main as main_module
from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.dependencies import resolve_effective_models
from app.engine.llm_client import LLMClient, build_call_target
from app.engine.phase2_context import resolve_actor_context_ceiling
from app.providers.endpoint import ResolvedEndpoint
from app.providers.local_relay import RelayRemoteError, RelayUnavailableError, local_relay_hub, relay_tab_context
from app.providers.seeder import SEED_META_KEY
from app.providers.webgpu_catalog import DEFAULT_WEBGPU_CONTEXT_SIZE, DEFAULT_WEBGPU_MODEL
from app.security.url_policy import UrlBlockedError, normalize_base_url


class _StructuredChoice(BaseModel):
    answer: str
    score: int


@pytest.fixture()
def env(api_env, api_user_factory):
    client, repo, _media_dir = api_env
    admin_h, _admin_id, _admin_tok = api_user_factory("admin_b", role="admin")

    def make_user(name: str) -> tuple[dict[str, str], str, str]:
        return api_user_factory(name)

    return client, repo, admin_h, make_user


def test_url_policy_for_browser_ollama_and_webgpu() -> None:
    assert normalize_base_url("http://localhost:11434/v1", provider_type="browser_ollama").root == "http://localhost:11434"
    assert normalize_base_url("http://127.0.0.1:11434", provider_type="browser_ollama").root == "http://127.0.0.1:11434"
    assert normalize_base_url("", provider_type="browser_ollama").root == "http://localhost:11434"
    assert normalize_base_url("", provider_type="webgpu").root == "webgpu://browser"

    for bad in ("http://192.168.1.50:11434", "https://remote.example.com", "http://10.0.0.2:11434"):
        with pytest.raises(UrlBlockedError):
            normalize_base_url(bad, provider_type="browser_ollama")


def test_browser_providers_crud_scope_and_client_probe(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _, _ = make_user("alice")
    bob_h, _, _ = make_user("bob")

    # Admins can create browser_ollama and webgpu as system-scope providers (non-admins get 403)
    for ptype in ("browser_ollama", "webgpu"):
        forbidden = client.post(
            "/api/providers",
            headers=alice_h,
            json={"type": ptype, "scope": "system", "settings": {}},
        )
        assert forbidden.status_code == 403
        sys_res = client.post(
            "/api/providers",
            headers=admin_h,
            json={"name": f"System {ptype}", "type": ptype, "scope": "system", "settings": {}},
        )
        assert sys_res.status_code == 201
        # Regular users cannot write client-probe results onto system providers
        assert (
            client.post(
                f"/api/providers/{sys_res.json()['id']}/client-probe",
                headers=alice_h,
                json={"reachable": True, "models": []},
            ).status_code
            == 403
        )

    # User creates browser_ollama targeting localhost (allowed unlike server-side ollama)
    lo = client.post(
        "/api/providers",
        headers=alice_h,
        json={"type": "browser_ollama", "scope": "user", "settings": {"base_url": "http://localhost:11434"}},
    )
    assert lo.status_code == 201
    lo_id = lo.json()["id"]
    assert lo.json()["name"] == "Local Ollama (Browser)"
    assert lo.json()["base_url"] == "http://localhost:11434"

    # Non-loopback rejected for browser_ollama
    bad_lo = client.post(
        "/api/providers",
        headers=alice_h,
        json={"type": "browser_ollama", "scope": "user", "settings": {"base_url": "http://192.168.1.10:11434"}},
    )
    assert bad_lo.status_code == 422

    # User creates webgpu provider (pre-seeded with curated catalog)
    wg = client.post(
        "/api/providers",
        headers=alice_h,
        json={"type": "webgpu", "scope": "user", "settings": {}},
    )
    assert wg.status_code == 201
    wg_body = wg.json()
    assert wg_body["name"] == "Browser WebGPU"
    assert wg_body["base_url"] == "webgpu://browser"
    assert any(m["name"] == DEFAULT_WEBGPU_MODEL for m in wg_body["cached_models"])

    # Client probe updates cached models for owner; cross-tenant gets 404
    probe_ok = client.post(
        f"/api/providers/{lo_id}/client-probe",
        headers=alice_h,
        json={
            "reachable": True,
            "protocol": "ollama_native",
            "models": [{"name": "mistral-nemo:12b", "size_mb": 7200, "is_embedding": False}],
        },
    )
    assert probe_ok.status_code == 200
    assert probe_ok.json()["chat_models"] == ["mistral-nemo:12b"]
    assert (
        client.post(
            f"/api/providers/{lo_id}/client-probe",
            headers=bob_h,
            json={"reachable": True, "models": []},
        ).status_code
        == 404
    )


def test_auto_provision_webgpu_for_new_users_when_no_global_providers(
    env,
    no_showcase_seeding: None,
) -> None:
    client, repo, admin_h, _make_user = env
    settings.allow_user_providers = True
    repo.providers.set_meta(SEED_META_KEY, "1")

    def _register_user(name: str) -> tuple[dict[str, str], str]:
        res = client.post("/api/auth/register", json={"username": name, "password": "UserPassword123!"})
        assert res.status_code == 200
        return {"Authorization": f"Bearer {res.json()['token']}"}, res.json()["user"]["id"]

    # 0 system providers -> new user gets Browser WebGPU + mirrored model settings
    alice_h, alice_id = _register_user("alice_auto")
    alice_providers = client.get("/api/providers", headers=alice_h).json()
    assert len(alice_providers) == 1
    assert alice_providers[0]["type"] == "webgpu"
    eff = resolve_effective_models(alice_id)
    assert eff.actor.provider_id == alice_providers[0]["id"]
    assert eff.actor.model == DEFAULT_WEBGPU_MODEL
    assert eff.actor.context_size == DEFAULT_WEBGPU_CONTEXT_SIZE
    assert eff.clerk_mirrors_actor is True
    assert eff.clerk.provider_id == eff.actor.provider_id

    # Once admin creates an enabled system provider, subsequent new users do NOT get auto-WebGPU
    sys_res = client.post(
        "/api/providers",
        headers=admin_h,
        json={"name": "Global Ollama", "type": "ollama", "scope": "system", "settings": {"base_url": "http://127.0.0.1:11434"}},
    )
    assert sys_res.status_code == 201
    bob_h, bob_id = _register_user("bob_no_auto")
    bob_providers = client.get("/api/providers", headers=bob_h).json()
    assert [p["name"] for p in bob_providers] == ["Global Ollama"]
    assert repo.get_user_model_settings(bob_id) is None


def test_webgpu_context_ceiling_is_clamped() -> None:
    endpoint = ResolvedEndpoint(
        provider_id="prov_wg",
        type="webgpu",
        root_url="webgpu://browser",
        owner_id="user_1",
    )
    prof_3b = ModelProfile(
        provider_id="prov_wg",
        model="Qwen2.5-3B-Instruct-q4f16_1-MLC",
        context_size=12288,
        max_tokens=1024,
        resolved=endpoint,
    )
    assert resolve_actor_context_ceiling(prof_3b) == (4096, 1024)

    prof_7b = ModelProfile(
        provider_id="prov_wg",
        model="Qwen2.5-7B-Instruct-q4f16_1-MLC",
        context_size=12288,
        max_tokens=1024,
        resolved=endpoint,
    )
    assert resolve_actor_context_ceiling(prof_7b) == (8192, 1024)


def test_ws_relay_auth_origin_and_status(env) -> None:
    client, _repo, _admin_h, make_user = env
    alice_h, _, alice_tok = make_user("alice_ws")

    # Bad Origin rejected
    with pytest.raises(Exception):
        with client.websocket_connect(
            "/api/local-relay/ws?tab_id=t1",
            headers={"Origin": "https://evil.example.com"},
        ):
            pass

    # Origin matching X-Forwarded-Host is accepted
    with client.websocket_connect(
        "/api/local-relay/ws?tab_id=t-xfh",
        headers={"Origin": "https://alpha.cybercantina.io", "X-Forwarded-Host": "alpha.cybercantina.io"},
    ) as ws:
        ws.send_json({"type": "relay.auth", "token": alice_tok})
        ws.send_json({"type": "relay.hello", "webgpu_supported": True})
        time.sleep(0.05)
        st = client.get("/api/local-relay/status", headers=alice_h)
        assert st.status_code == 200
        assert any(t["tab_id"] == "t-xfh" for t in st.json()["tabs"])

    # Unauthenticated WS (no cookies, bad relay.auth) closes with 4401
    anon_client = TestClient(main_module.app)
    with anon_client.websocket_connect("/api/local-relay/ws?tab_id=t1") as ws:
        ws.send_json({"type": "relay.auth", "token": "not-valid"})
        msg = ws.receive()
        assert msg["type"] == "websocket.close" and msg["code"] == 4401

    # Valid auth via relay.auth registers tab in /api/local-relay/status
    with anon_client.websocket_connect("/api/local-relay/ws?tab_id=tab-abc") as ws:
        ws.send_json({"type": "relay.auth", "token": alice_tok})
        ws.send_json({"type": "relay.hello", "webgpu_supported": True, "loaded_webgpu_model": DEFAULT_WEBGPU_MODEL})
        # Give server loop a brief moment to process hello
        time.sleep(0.05)
        st = client.get("/api/local-relay/status", headers=alice_h)
        assert st.status_code == 200
        body = st.json()
        assert body["connected"] is True
        assert body["tabs"][0]["tab_id"] == "tab-abc"
        assert body["tabs"][0]["webgpu_supported"] is True


async def test_llm_client_routes_browser_providers_over_relay_with_retry_and_stream() -> None:
    class _FakeWebSocket:
        def __init__(self, handler) -> None:
            self.handler = handler
            self.sent: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.sent.append(payload)
            asyncio.create_task(self.handler(payload))

        async def close(self, code: int = 1000) -> None:
            return None

    client = LLMClient()
    wg_endpoint = ResolvedEndpoint(
        provider_id="p-wg",
        type="webgpu",
        root_url="webgpu://browser",
        owner_id="u-relay",
    )
    wg_profile = ModelProfile(
        provider_id="p-wg",
        model="Qwen2.5-3B-Instruct-q4f16_1-MLC",
        context_size=12288,
        resolved=wg_endpoint,
    )

    # Offline relay raises RelayUnavailableError immediately (and complete_structured does not retry it)
    with pytest.raises(RelayUnavailableError):
        await client.complete_text([{"role": "user", "content": "hi"}], profile=wg_profile)
    complete_calls = 0
    orig_complete_text = client.complete_text

    async def counted_complete_text(*args, **kwargs):
        nonlocal complete_calls
        complete_calls += 1
        return await orig_complete_text(*args, **kwargs)

    client.complete_text = counted_complete_text  # type: ignore[method-assign]
    with pytest.raises(RelayUnavailableError):
        await client.complete_structured([{"role": "user", "content": "hi"}], _StructuredChoice, profile=wg_profile)
    assert complete_calls == 1
    client.complete_text = orig_complete_text  # type: ignore[method-assign]

    seen_requests: list[dict] = []

    async def fake_browser(payload: dict) -> None:
        if payload["type"] != "llm.request":
            return
        seen_requests.append(payload)
        req_id = payload["request_id"]
        if payload["mode"] == "stream":
            await local_relay_hub.handle_message(sess, {"type": "llm.chunk", "request_id": req_id, "delta": "Hello "})
            await local_relay_hub.handle_message(sess, {"type": "llm.chunk", "request_id": req_id, "delta": "world!"})
            await local_relay_hub.handle_message(sess, {"type": "llm.done", "request_id": req_id, "content": "Hello world!"})
            return
        # First structured call returns invalid JSON to exercise server-side complete_structured retry!
        if payload["options"]["json_schema"] is not None:
            await local_relay_hub.handle_message(sess, {"type": "llm.done", "request_id": req_id, "content": "not json"})
        else:
            await local_relay_hub.handle_message(
                sess,
                {"type": "llm.done", "request_id": req_id, "content": json.dumps({"answer": "ok", "score": 9})},
            )

    ws = _FakeWebSocket(fake_browser)
    sess = local_relay_hub.register("u-relay", "tab-1", ws)  # type: ignore[arg-type]
    token = relay_tab_context.set("tab-1")
    try:
        # 1. Structured completion + context clamping + retry
        parsed = await client.complete_structured(
            [{"role": "user", "content": "rate"}],
            _StructuredChoice,
            profile=wg_profile,
        )
        assert parsed == _StructuredChoice(answer="ok", score=9)
        assert len(seen_requests) == 2
        assert seen_requests[0]["driver"] == "webgpu"
        assert seen_requests[0]["options"]["context_size"] == 4096  # clamped from 12288!

        # 2. Streaming over browser_ollama
        bo_endpoint = ResolvedEndpoint(
            provider_id="p-bo",
            type="browser_ollama",
            root_url="http://localhost:11434/v1",
            owner_id="u-relay",
        )
        bo_profile = ModelProfile(
            provider_id="p-bo",
            model="llama3.1:8b",
            context_size=12288,
            resolved=bo_endpoint,
        )
        target = await build_call_target(bo_profile)
        assert target.root_url == "http://localhost:11434"
        chunks: list[str] = []
        async for d in client.stream_chat([{"role": "user", "content": "hi"}], profile=bo_profile):
            chunks.append(d)
        assert "".join(chunks) == "Hello world!"
        assert seen_requests[-1]["driver"] == "browser_ollama"
        assert seen_requests[-1]["options"]["context_size"] == 12288

        # 3. Remote driver error propagates cleanly
        async def fail_browser(payload: dict) -> None:
            if payload["type"] == "llm.request":
                await local_relay_hub.handle_message(
                    sess,
                    {
                        "type": "llm.error",
                        "request_id": payload["request_id"],
                        "code": "cors_or_network_error",
                        "message": "CORS blocked",
                    },
                )

        ws.handler = fail_browser
        with pytest.raises(RelayRemoteError) as exc_info:
            await client.complete_text([{"role": "user", "content": "x"}], profile=bo_profile)
        assert exc_info.value.code == "cors_or_network_error"
    finally:
        relay_tab_context.reset(token)
        local_relay_hub.unregister("u-relay", "tab-1", sess)


async def test_system_scoped_browser_provider_routes_to_calling_user_and_skips_server_probe(env) -> None:
    from app.providers.probe import probe_system_providers

    client, repo, admin_h, make_user = env
    alice_h, alice_id, _ = make_user("alice_sys_relay")
    sys_bo = client.post(
        "/api/providers",
        headers=admin_h,
        json={"name": "Sys Browser Ollama", "type": "browser_ollama", "scope": "system", "settings": {}},
    ).json()
    settings.actor_profile.provider_id = sys_bo["id"]
    settings.actor_profile.model = "qwen2.5:7b"

    # Server-side periodic probe skips browser-local system providers
    assert await probe_system_providers(repo.providers) == 0

    eff = resolve_effective_models(alice_id)
    assert eff.actor.resolved is not None
    assert eff.actor.resolved.owner_id is None
    assert eff.actor.resolved.caller_user_id == alice_id

    class _FakeWebSocket:
        async def send_json(self, payload: dict) -> None:
            if payload.get("type") == "llm.request":
                await local_relay_hub.handle_message(
                    sess,
                    {"type": "llm.done", "request_id": payload["request_id"], "content": "from alice browser"},
                )

        async def close(self, code: int = 1000) -> None:
            return None

    sess = local_relay_hub.register(alice_id, "alice-tab", _FakeWebSocket())  # type: ignore[arg-type]
    llm = LLMClient()
    try:
        out = await llm.complete_text([{"role": "user", "content": "hi"}], profile=eff.actor)
        assert out == "from alice browser"
    finally:
        local_relay_hub.unregister(alice_id, "alice-tab", sess)


async def test_first_boot_webgpu_default_when_server_ollama_unreachable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import config
    from app.config import AppSettings
    from app.providers.seeder import ensure_first_boot_webgpu_default, seed_providers

    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", tmp_path / "cs.json")
    monkeypatch.delenv("ACTOR_BASE_URL", raising=False)
    monkeypatch.delenv("CLERK_BASE_URL", raising=False)
    repo = CantinaRepository(str(tmp_path / "firstboot.db"))
    repo.init_db()
    app_settings = AppSettings(db_path=str(tmp_path / "firstboot.db"))
    report = seed_providers(repo.providers, app_settings, settings_path=config.SETTINGS_FILE_PATH)
    assert len(report.created) == 1

    async def unreachable() -> bool:
        return False

    changed = await ensure_first_boot_webgpu_default(
        repo.providers,
        app_settings,
        seed_report=report,
        settings_path=config.SETTINGS_FILE_PATH,
        probe_ollama=unreachable,
    )
    assert changed is True
    sys_provs = repo.providers.list_system()
    assert len(sys_provs) == 1 and sys_provs[0].type == "webgpu"
    assert app_settings.actor_profile.provider_id == sys_provs[0].id
    assert app_settings.actor_profile.model == DEFAULT_WEBGPU_MODEL
    assert app_settings.clerk_mirrors_actor is True
    assert app_settings.allow_user_providers is True

    # Idempotent on subsequent boots
    assert (
        await ensure_first_boot_webgpu_default(
            repo.providers,
            app_settings,
            seed_report=seed_providers(repo.providers, app_settings),
            settings_path=config.SETTINGS_FILE_PATH,
            probe_ollama=unreachable,
        )
        is False
    )


def test_world_wizard_draft_with_sole_webgpu_provider_and_new_user(env, monkeypatch: pytest.MonkeyPatch) -> None:
    """Reproduce: sole system WebGPU provider, clerk mirrors actor, BYOP on, new user drafts world over relay."""
    client, _repo, admin_h, make_user = env
    wg = client.post(
        "/api/providers",
        headers=admin_h,
        json={"name": "Browser WebGPU", "type": "webgpu", "scope": "system", "settings": {}},
    )
    assert wg.status_code == 201
    wg_id = wg.json()["id"]

    monkeypatch.setattr(settings, "allow_user_providers", True)
    monkeypatch.setattr(settings, "clerk_mirrors_actor", True)
    monkeypatch.setattr(settings, "allow_offline_fallback", False)
    monkeypatch.setattr(
        settings,
        "actor_profile",
        ModelProfile(provider_id=wg_id, model=DEFAULT_WEBGPU_MODEL, context_size=DEFAULT_WEBGPU_CONTEXT_SIZE),
    )

    alice_h, alice_id, _ = make_user("alice_world_wg")

    class _FakeWebSocket:
        async def send_json(self, payload: dict) -> None:
            if payload.get("type") == "llm.request":
                world_json = json.dumps(
                    {
                        "name": "Helios-7",
                        "global_rules": {
                            "genre": "Hard Sci-Fi",
                            "tone": "Claustrophobic",
                            "setting_overview": "A quarantined deep-space mining spindle.",
                            "tech_or_magic_rules": "Zero-G industrial tech.",
                            "starting_timestamp": "2094-11-14 21:00",
                        },
                        "locations": [
                            {
                                "key": "oxygen_garden",
                                "name": "The Oxygen Garden",
                                "summary": "Low-G hydroponics cantina.",
                                "description": "Humid air and dim amber grow lamps.",
                                "environmental_tags": ["hydroponics", "low-g"],
                                "is_starting_location": True,
                                "is_hub": True,
                                "starting_message": "Steam curls past the hydroponic trays.",
                            },
                            {
                                "key": "docking_ring",
                                "name": "Docking Ring",
                                "summary": "Pressurized airlock corridor.",
                                "description": "Heavy bulkheads line the ring.",
                                "environmental_tags": ["airlock"],
                                "is_starting_location": False,
                                "is_hub": False,
                            },
                        ],
                        "edges": [
                            {
                                "from_key": "oxygen_garden",
                                "to_key": "docking_ring",
                                "direction_label": "Bulkhead hatch",
                                "reverse_direction_label": "Back to cantina",
                                "compass_direction": "N",
                                "travel_minutes": 2,
                                "bidirectional": True,
                            }
                        ],
                        "lore_nodes": [],
                    }
                )
                await local_relay_hub.handle_message(
                    sess,
                    {"type": "llm.done", "request_id": payload["request_id"], "content": world_json},
                )

        async def close(self, code: int = 1000) -> None:
            return None

    sess = local_relay_hub.register(alice_id, "world-tab-1", _FakeWebSocket())  # type: ignore[arg-type]
    try:
        resp = client.post(
            "/api/wizards/world/draft",
            headers={**alice_h, "X-Cantina-Tab-Id": "world-tab-1"},
            json={
                "name": "Helios-7",
                "genre_and_tone": "Hard Sci-Fi",
                "core_premise": "Quarantined spindle.",
                "initial_hub_concept": "The Oxygen Garden",
                "location_count": 3,
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Helios-7"
        assert len(resp.json()["locations"]) == 2
    finally:
        local_relay_hub.unregister(alice_id, "world-tab-1", sess)


def test_nginx_conf_proxies_local_relay_websocket() -> None:
    nginx_conf = (Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    assert "location = /api/local-relay/ws" in nginx_conf
    assert "proxy_set_header Upgrade $http_upgrade;" in nginx_conf
    assert "proxy_set_header Connection $connection_upgrade;" in nginx_conf
