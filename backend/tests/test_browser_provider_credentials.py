"""Tests for browser-stored provider credentials, 4-mode admin policy, purge, and relay routing."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.dependencies import resolve_effective_models
from app.engine.llm_client import LLMClient, build_call_target
from app.providers.local_relay import local_relay_hub, relay_tab_context
from app.providers.resolver import ProviderUnavailableError, resolve_endpoint


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = str(tmp_path / "browser_creds.db")
    settings_file = tmp_path / "cantina_settings.json"
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))
    monkeypatch.setattr("app.config.SETTINGS_FILE_PATH", settings_file)
    monkeypatch.setattr(settings, "allow_user_providers", True)
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)
    monkeypatch.setattr(settings, "provider_credential_store", "prefer_server")
    repo = CantinaRepository(db_file, media_dir=str(tmp_path / "media"))
    repo.init_db()
    client = TestClient(main_module.app)
    admin = client.post(
        "/api/auth/setup",
        json={"username": "admin_c", "password": "AdminPassword123!"},
    )
    assert admin.status_code == 200
    admin_h = {"Authorization": f"Bearer {admin.json()['token']}"}

    def make_user(name: str) -> tuple[dict[str, str], str, str]:
        res = client.post(
            "/api/auth/register",
            json={"username": name, "password": "UserPassword123!"},
        )
        assert res.status_code == 200
        tok = res.json()["token"]
        return {"Authorization": f"Bearer {tok}"}, res.json()["user"]["id"], tok

    return client, repo, admin_h, make_user


def _current_settings_payload(client: TestClient, admin_h: dict[str, str]) -> dict:
    res = client.get("/api/settings", headers=admin_h)
    assert res.status_code == 200
    return res.json()


def test_schema_migration_adds_credential_storage_column(tmp_path: Path) -> None:
    db_file = str(tmp_path / "legacy_providers.db")
    conn = sqlite3.connect(db_file)
    conn.execute(
        """
        CREATE TABLE providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            name_key TEXT NOT NULL,
            type TEXT NOT NULL,
            scope TEXT NOT NULL,
            owner_id TEXT NULL,
            color TEXT NOT NULL DEFAULT 'neutral',
            is_enabled INTEGER NOT NULL DEFAULT 1,
            settings_json TEXT NOT NULL,
            secret_enc BLOB NULL,
            network_restricted INTEGER NOT NULL DEFAULT 0,
            cached_models_json TEXT NULL,
            models_hash TEXT NULL,
            last_probed_at TEXT NULL,
            last_error_code TEXT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO providers (id, name, name_key, type, scope, owner_id, settings_json, created_at, updated_at)
        VALUES ('prov_legacy', 'Legacy', 'legacy', 'ollama', 'system', NULL, '{"base_url":"http://localhost:11434"}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(db_file, media_dir=str(tmp_path / "media"))
    repo.init_db()
    rec = repo.providers.get("prov_legacy")
    assert rec is not None
    assert rec.credential_storage == "server"


def test_browser_credential_creation_validation_and_client_probe(env) -> None:
    client, repo, _admin_h, make_user = env
    alice_h, alice_id, _ = make_user("alice")

    # System providers cannot use browser credential storage
    sys_bad = client.post(
        "/api/providers",
        headers=_admin_h,
        json={
            "name": "BadSysOR",
            "type": "openrouter",
            "scope": "system",
            "credential_storage": "browser",
            "settings": {"base_url": "https://openrouter.ai/api/v1"},
        },
    )
    assert sys_bad.status_code == 422

    # Browser-stored credentials cannot send bearer_token to the server
    leak_attempt = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "LeakedOR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {
                "base_url": "https://openrouter.ai/api/v1",
                "bearer_token": "sk-or-secret",
            },
        },
    )
    assert leak_attempt.status_code == 422

    # Valid browser-stored OpenRouter provider (no server token required)
    created = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Alice Browser OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {"base_url": "https://openrouter.ai/api/v1"},
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["credential_storage"] == "browser"
    assert body["has_bearer_token"] is False
    assert body["usable"] is True

    rec = repo.providers.get(body["id"])
    assert rec is not None
    assert rec.secret_enc is None
    assert rec.credential_storage == "browser"

    # Client probe persistence works for browser-credentialed providers
    probe_res = client.post(
        f"/api/providers/{body['id']}/client-probe",
        headers=alice_h,
        json={
            "reachable": True,
            "protocol": "openai_compat",
            "models": [{"name": "anthropic/claude-sonnet-4", "is_embedding": False}],
        },
    )
    assert probe_res.status_code == 200
    assert probe_res.json()["reachable"] is True
    assert probe_res.json()["chat_models"] == ["anthropic/claude-sonnet-4"]

    # Resolution returns credential_storage='browser' with no bearer_token
    endpoint = resolve_endpoint(
        ModelProfile(provider_id=body["id"], model="anthropic/claude-sonnet-4"),
        user_id=alice_id,
        role="actor",
        store=repo.providers,
    )
    assert endpoint is not None
    assert endpoint.credential_storage == "browser"
    assert endpoint.bearer_token is None


def test_server_only_pauses_browser_providers_reversibly_and_exempts_local_compute(env) -> None:
    client, repo, admin_h, make_user = env
    alice_h, alice_id, _ = make_user("alice_s")

    # Create a browser-credentialed OpenRouter provider AND a local WebGPU provider under prefer_server
    or_res = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Alice OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {"base_url": "https://openrouter.ai/api/v1"},
        },
    )
    assert or_res.status_code == 201
    or_id = or_res.json()["id"]

    wgpu_res = client.post(
        "/api/providers",
        headers=alice_h,
        json={"name": "Alice WebGPU", "type": "webgpu", "scope": "user", "settings": {}},
    )
    assert wgpu_res.status_code == 201
    wgpu_id = wgpu_res.json()["id"]

    # Assign Alice's actor override to the browser-credentialed OpenRouter provider
    prof_res = client.put(
        "/api/profile/models",
        headers=alice_h,
        json={
            "actor_profile": {
                "provider_id": or_id,
                "model": "openai/gpt-4o-mini",
                "temperature": 0.7,
                "max_tokens": 512,
                "timeout_seconds": 30,
            }
        },
    )
    assert prof_res.status_code == 200

    # Admin switches policy to server_only (no purge prompt needed)
    cfg = _current_settings_payload(client, admin_h)
    cfg["provider_credential_store"] = "server_only"
    save_res = client.put("/api/settings", headers=admin_h, json=cfg)
    assert save_res.status_code == 200
    assert save_res.json()["provider_credential_store"] == "server_only"

    # Non-admin settings view reflects server_only
    user_cfg = client.get("/api/settings", headers=alice_h)
    assert user_cfg.status_code == 200
    assert user_cfg.json()["provider_credential_store"] == "server_only"

    # Alice's browser-stored OpenRouter is paused, while WebGPU remains usable!
    listed = {p["id"]: p for p in client.get("/api/providers", headers=alice_h).json()}
    assert listed[or_id]["usable"] is False
    assert listed[or_id]["unusable_reason"] == "browser_storage_disabled"
    assert listed[wgpu_id]["usable"] is True
    assert listed[wgpu_id]["unusable_reason"] is None

    # resolve_endpoint blocks it and resolve_effective_models falls back cleanly with warning
    with pytest.raises(ProviderUnavailableError) as exc_info:
        resolve_endpoint(
            ModelProfile(provider_id=or_id, model="openai/gpt-4o-mini"),
            user_id=alice_id,
            role="actor",
            store=repo.providers,
        )
    assert exc_info.value.code == "browser_storage_disabled"

    eff = resolve_effective_models(alice_id)
    assert any(w.code == "browser_storage_disabled" and w.role == "actor" for w in eff.warnings)

    # Metadata-only edits on the paused provider still succeed without forcing migration
    meta_edit = client.put(
        f"/api/providers/{or_id}",
        headers=alice_h,
        json={"expected_version": listed[or_id]["version"], "name": "Alice OR Renamed"},
    )
    assert meta_edit.status_code == 200
    assert meta_edit.json()["credential_storage"] == "browser"
    assert meta_edit.json()["unusable_reason"] == "browser_storage_disabled"

    # Creating new browser-stored providers is blocked under server_only
    blocked_create = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Blocked Browser OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {"base_url": "https://openrouter.ai/api/v1"},
        },
    )
    assert blocked_create.status_code == 422

    # Reverting back to prefer_browser immediately restores usability
    cfg2 = _current_settings_payload(client, admin_h)
    cfg2["provider_credential_store"] = "prefer_browser"
    assert client.put("/api/settings", headers=admin_h, json=cfg2).status_code == 200
    listed_after = {p["id"]: p for p in client.get("/api/providers", headers=alice_h).json()}
    assert listed_after[or_id]["usable"] is True
    assert listed_after[or_id]["unusable_reason"] is None


def test_browser_only_requires_confirmation_and_purges_only_user_scoped_secrets(env) -> None:
    client, repo, admin_h, make_user = env
    alice_h, _, _ = make_user("alice_p")
    bob_h, _, _ = make_user("bob_p")

    # System provider with server secret (must stay untouched)
    sys_res = client.post(
        "/api/providers",
        headers=admin_h,
        json={
            "name": "Shared Sys OR",
            "type": "openrouter",
            "scope": "system",
            "settings": {
                "base_url": "https://openrouter.ai/api/v1",
                "bearer_token": "sk-system-keep",
            },
        },
    )
    assert sys_res.status_code == 201
    sys_id = sys_res.json()["id"]

    # Two user-scoped providers with server secrets
    alice_prov = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Alice Server OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "server",
            "settings": {
                "base_url": "https://openrouter.ai/api/v1",
                "bearer_token": "sk-alice-purge",
            },
        },
    )
    assert alice_prov.status_code == 201
    alice_pid = alice_prov.json()["id"]

    bob_prov = client.post(
        "/api/providers",
        headers=bob_h,
        json={
            "name": "Bob Server Horde",
            "type": "aihorde",
            "scope": "user",
            "credential_storage": "server",
            "settings": {
                "base_url": "https://oai.stablehorde.net/v1",
                "bearer_token": "horde-bob-purge",
            },
        },
    )
    assert bob_prov.status_code == 201
    bob_pid = bob_prov.json()["id"]

    # Switching to browser_only without confirm returns 409 with exact counts
    cfg = _current_settings_payload(client, admin_h)
    cfg["provider_credential_store"] = "browser_only"
    unconfirmed = client.put("/api/settings", headers=admin_h, json=cfg)
    assert unconfirmed.status_code == 409
    detail = unconfirmed.json()["detail"]
    assert detail["code"] == "user_credentials_purge_required"
    assert detail["affected_providers"] == 2
    assert detail["affected_users"] == 2
    assert settings.provider_credential_store == "prefer_server"
    assert repo.providers.get(alice_pid).secret_enc is not None

    # Confirming purges user secrets, converts to browser, bumps version, and preserves system secret
    confirmed = client.put(
        "/api/settings?confirm_credential_purge=true",
        headers=admin_h,
        json=cfg,
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["provider_credential_store"] == "browser_only"
    assert settings.provider_credential_store == "browser_only"

    sys_rec = repo.providers.get(sys_id)
    alice_rec = repo.providers.get(alice_pid)
    bob_rec = repo.providers.get(bob_pid)
    assert sys_rec is not None and sys_rec.secret_enc is not None and sys_rec.credential_storage == "server"
    assert alice_rec is not None and alice_rec.secret_enc is None and alice_rec.credential_storage == "browser"
    assert alice_rec.version == 2
    assert bob_rec is not None and bob_rec.secret_enc is None and bob_rec.credential_storage == "browser"
    assert bob_rec.version == 2

    # Subsequent server-token creation or probe-draft with token is rejected under browser_only
    bad_create = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Alice New Server OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "server",
            "settings": {
                "base_url": "https://openrouter.ai/api/v1",
                "bearer_token": "sk-forbidden",
            },
        },
    )
    assert bad_create.status_code == 422

    bad_probe_draft = client.post(
        "/api/providers/probe-draft",
        headers=alice_h,
        json={
            "type": "openrouter",
            "base_url": "https://openrouter.ai/api/v1",
            "bearer_token": "sk-forbidden",
        },
    )
    assert bad_probe_draft.status_code == 422


def test_browser_credentialed_provider_routes_through_local_relay_without_tokens(env) -> None:
    client, repo, _admin_h, make_user = env
    alice_h, alice_id, alice_tok = make_user("alice_relay")

    created = client.post(
        "/api/providers",
        headers=alice_h,
        json={
            "name": "Alice Relay OR",
            "type": "openrouter",
            "scope": "user",
            "credential_storage": "browser",
            "settings": {"base_url": "https://openrouter.ai/api/v1"},
        },
    )
    assert created.status_code == 201
    prov_id = created.json()["id"]

    endpoint = resolve_endpoint(
        ModelProfile(provider_id=prov_id, model="openai/gpt-4o-mini"),
        user_id=alice_id,
        role="actor",
        store=repo.providers,
    )
    profile = ModelProfile(
        provider_id=prov_id,
        model="openai/gpt-4o-mini",
        resolved=endpoint,
    )

    tab_id = "tab-browser-creds"
    with client.websocket_connect(f"/api/local-relay/ws?tab_id={tab_id}") as ws:
        ws.send_json({"type": "relay.auth", "token": alice_tok})
        ws.send_json({"type": "relay.hello", "webgpu_supported": False})
        # Wait briefly for registration
        for _ in range(20):
            if local_relay_hub.get_status(alice_id)["connected"]:
                break

        async def _run_complete():
            tok = relay_tab_context.set(tab_id)
            try:
                target = await build_call_target(profile)
                assert target.credential_storage == "browser"
                assert target.provider_id == prov_id
                llm = LLMClient()
                try:
                    return await llm.complete_text(
                        [{"role": "user", "content": "Hello"}],
                        profile=profile,
                    )
                finally:
                    await llm.close()
            finally:
                relay_tab_context.reset(tok)

        async def _drive():
            task = asyncio.create_task(_run_complete())
            raw_req = await asyncio.to_thread(ws.receive_json)
            assert raw_req["type"] == "llm.request"
            assert raw_req["driver"] == "openrouter"
            assert raw_req["provider_id"] == prov_id
            assert "bearer_token" not in json.dumps(raw_req)
            await asyncio.to_thread(
                ws.send_json,
                {
                    "type": "llm.done",
                    "request_id": raw_req["request_id"],
                    "content": "Relayed from browser!",
                },
            )
            return await task

        # Test via websocket thread-safe helper using hub dispatch directly in event loop
        result = asyncio.run(_drive())
        assert result == "Relayed from browser!"
