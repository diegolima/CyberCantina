"""Providers, BYOP governance, SSRF policy, secrets, migration, probing and embedding invalidation."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, main as main_module
from app.config import AppSettings, ModelProfile, persist_settings, settings
from app.db.provider_store import ProviderStore
from app.db.repository import CantinaRepository
from app.dependencies import resolve_effective_models
from app.engine.llm_client import build_call_target, llm_client
from app.providers.probe import ProbeService, probe_service
from app.providers.seeder import SEED_META_KEY, reconcile_settings_references, seed_providers
from app.security.secret_box import load_secret_box
from app.security.url_policy import (
    UrlBlockedError,
    assert_url_allowed,
    clear_dns_cache,
    normalize_base_url,
)

PUBLIC_URL = "http://93.184.216.34:11434"  # public IP literal: no DNS needed, passes the user policy


@pytest.fixture()
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = str(tmp_path / "providers.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    repo = CantinaRepository(db_file, media_dir=str(tmp_path / "media"))
    repo.init_db()
    client = TestClient(main_module.app)
    admin = client.post("/api/auth/setup", json={"username": "admin_p", "password": "AdminPassword123!"})
    assert admin.status_code == 200
    admin_h = {"Authorization": f"Bearer {admin.json()['token']}"}

    def make_user(name: str) -> tuple[dict[str, str], str]:
        res = client.post("/api/auth/register", json={"username": name, "password": "UserPassword123!"})
        assert res.status_code == 200
        return {"Authorization": f"Bearer {res.json()['token']}"}, res.json()["user"]["id"]

    return client, repo, admin_h, make_user


def _create(client, headers, **overrides):
    body = {
        "name": "Home",
        "type": "ollama",
        "scope": "system",
        "color": "cyan",
        "is_enabled": True,
        "settings": {"base_url": "http://127.0.0.1:11434"},
    }
    body.update(overrides)
    return client.post("/api/providers", headers=headers, json=body)


# ------------------------------------------------------------------ URL policy
def test_normalize_base_url_strips_suffixes_and_rejects_bad_input() -> None:
    assert normalize_base_url("http://localhost:11434/v1/").root == "http://localhost:11434"
    assert normalize_base_url("https://x.example.com/api").root == "https://x.example.com"
    for bad in ("ftp://x", "http://user:pw@x", "http://x?y=1", "http://x#f", "", "http://"):
        with pytest.raises(UrlBlockedError):
            normalize_base_url(bad)


async def test_url_policy_blocks_metadata_always_and_local_for_regular_users() -> None:
    clear_dns_cache()
    meta = normalize_base_url("http://169.254.169.254")
    for allow_private in (True, False):
        with pytest.raises(UrlBlockedError):
            await assert_url_allowed(meta, allow_private=allow_private)
    for raw in ("http://127.0.0.1:11434", "http://10.0.0.5", "http://192.168.1.2", "http://localhost:11434", "http://[::1]:11434"):
        url = normalize_base_url(raw)
        with pytest.raises(UrlBlockedError):
            await assert_url_allowed(url, allow_private=False)
        await assert_url_allowed(url, allow_private=True)  # admins may use local addresses
    await assert_url_allowed(normalize_base_url(PUBLIC_URL), allow_private=False)


async def test_url_policy_checks_every_resolved_address(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_dns_cache()

    async def fake_resolve(host: str) -> list[str]:
        return ["93.184.216.34", "10.1.2.3"]  # one public, one private (rebinding style)

    from app.security import url_policy

    monkeypatch.setattr(url_policy, "_resolve", fake_resolve)
    with pytest.raises(UrlBlockedError):
        await assert_url_allowed(normalize_base_url("http://rebind.example.com"), allow_private=False)


# ---------------------------------------------------------------------- secrets
def test_secret_box_roundtrip_and_key_file_permissions(tmp_path: Path) -> None:
    db = str(tmp_path / "x.db")
    box = load_secret_box(db)
    sealed = box.seal("tok-123")
    assert b"tok-123" not in sealed
    assert box.open(sealed) == "tok-123"
    key_file = tmp_path / ".cantina_secret.key"
    assert key_file.exists()
    assert oct(key_file.stat().st_mode & 0o777) == "0o600"


def test_token_encrypted_at_rest_and_never_in_repr(env) -> None:
    client, repo, admin_h, _ = env
    res = _create(client, admin_h, settings={"base_url": "http://127.0.0.1:11434", "bearer_token": "SUPER-SECRET"})
    assert res.status_code == 201
    raw = sqlite3.connect(settings.db_path).execute("SELECT settings_json, secret_enc FROM providers").fetchone()
    assert "SUPER-SECRET" not in raw[0]
    assert b"SUPER-SECRET" not in bytes(raw[1])
    record = repo.providers.get(res.json()["id"])
    assert record is not None and "SUPER-SECRET" not in repr(record)
    assert repo.providers.bearer_token(record) == "SUPER-SECRET"
    assert "SUPER-SECRET" not in res.text
    assert res.json()["has_bearer_token"] is True


# ------------------------------------------------------------------- governance
def test_byop_coupling_forces_model_overrides_on() -> None:
    assert AppSettings(allow_user_providers=True).allow_user_model_overrides is True


def test_put_settings_enforces_coupling_and_returns_coerced_values(env) -> None:
    client, _repo, admin_h, _ = env
    current = client.get("/api/settings", headers=admin_h).json()
    current["allow_user_providers"] = True
    current["allow_user_model_overrides"] = False
    res = client.put("/api/settings", headers=admin_h, json=current)
    assert res.status_code == 200
    assert res.json()["allow_user_providers"] is True
    assert res.json()["allow_user_model_overrides"] is True
    assert settings.allow_user_model_overrides is True


def test_settings_revision_conflict_and_provider_reference_validation(env) -> None:
    client, _repo, admin_h, make_user = env
    current = client.get("/api/settings", headers=admin_h).json()
    first = client.put("/api/settings", headers=admin_h, json=current)
    assert first.status_code == 200 and first.json()["settings_revision"] == 1
    stale = dict(current, settings_revision=5)
    assert client.put("/api/settings", headers=admin_h, json=stale).status_code == 409
    bogus = json.loads(json.dumps(first.json()))
    bogus["actor_profile"]["provider_id"] = "prov_missing"
    assert client.put("/api/settings", headers=admin_h, json=bogus).status_code == 422


def test_user_cannot_create_providers_until_byop_enabled(env) -> None:
    client, _repo, admin_h, make_user = env
    alice_h, _ = make_user("alice")
    body = {"scope": "user", "settings": {"base_url": PUBLIC_URL}}
    assert client.post("/api/providers", headers=alice_h, json=body).status_code == 403
    assert _create(client, alice_h).status_code == 403  # system scope: admin only
    settings.allow_user_providers = True
    assert client.post("/api/providers", headers=alice_h, json=body).status_code == 201


def test_user_provider_ssrf_policy_and_admin_exemption(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    for bad in ("http://127.0.0.1:11434", "http://localhost:11434", "http://192.168.0.10", "http://169.254.169.254"):
        res = client.post("/api/providers", headers=alice_h, json={"scope": "user", "settings": {"base_url": bad}})
        assert res.status_code == 422, bad
        assert res.json()["detail"]["code"] in ("blocked_by_policy", "invalid_url")
    assert _create(client, admin_h, settings={"base_url": "http://127.0.0.1:11434"}).status_code == 201
    meta = _create(client, admin_h, name="meta", settings={"base_url": "http://169.254.169.254"})
    assert meta.status_code == 422


def test_tenant_isolation_and_url_visibility(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    bob_h, _ = make_user("bob")
    sys_res = _create(client, admin_h, name="Cloud", settings={"base_url": "http://127.0.0.1:11434"})
    mine = client.post("/api/providers", headers=alice_h, json={"name": "Mine", "scope": "user", "settings": {"base_url": PUBLIC_URL}})
    assert mine.status_code == 201
    pid = mine.json()["id"]

    alice_list = client.get("/api/providers", headers=alice_h).json()
    assert {p["name"] for p in alice_list} == {"Cloud", "Mine"}
    assert {p["name"] for p in client.get("/api/providers", headers=bob_h).json()} == {"Cloud"}
    assert {p["name"] for p in client.get("/api/providers", headers=admin_h).json()} == {"Cloud"}

    sys_view = next(p for p in alice_list if p["name"] == "Cloud")
    assert sys_view["base_url"] is None and sys_view["scope"] == "system"
    assert next(p for p in alice_list if p["name"] == "Mine")["base_url"] == PUBLIC_URL

    # Cross-tenant access is a 404 (no existence leak), for users and admins alike.
    for headers in (bob_h, admin_h):
        assert client.put(f"/api/providers/{pid}", headers=headers, json={"expected_version": 1, "name": "x"}).status_code == 404
        assert client.delete(f"/api/providers/{pid}", headers=headers).status_code == 404
        assert client.post(f"/api/providers/{pid}/probe", headers=headers).status_code == 404
    # Users cannot edit system providers.
    sid = sys_res.json()["id"]
    assert client.put(f"/api/providers/{sid}", headers=alice_h, json={"expected_version": 1, "name": "x"}).status_code == 403
    assert client.delete(f"/api/providers/{sid}", headers=alice_h).status_code == 403


def test_name_uniqueness_rules(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    assert _create(client, admin_h, name="Home Ollama").status_code == 201
    assert _create(client, admin_h, name="  home   OLLAMA ").status_code == 409
    # Users may not shadow a system name...
    dup = client.post("/api/providers", headers=alice_h, json={"name": "home ollama", "scope": "user", "settings": {"base_url": PUBLIC_URL}})
    assert dup.status_code == 409
    # ...but an admin taking a name a user already uses must not leak that fact.
    assert client.post("/api/providers", headers=alice_h, json={"name": "Private", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).status_code == 201
    assert _create(client, admin_h, name="Private").status_code == 201
    # Default name follows the type and auto-suffixes.
    a = client.post("/api/providers", headers=alice_h, json={"scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()
    b = client.post("/api/providers", headers=alice_h, json={"scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()
    assert a["name"] == "Ollama" and b["name"] == "Ollama 2"


def test_update_rules_token_rebinding_version_conflict(env) -> None:
    client, _repo, admin_h, _ = env
    created = _create(client, admin_h, settings={"base_url": "http://127.0.0.1:11434", "bearer_token": "t0k"}).json()
    pid, ver = created["id"], created["version"]
    # Same host, no token supplied: token is kept.
    kept = client.put(f"/api/providers/{pid}", headers=admin_h, json={"expected_version": ver, "base_url": "http://127.0.0.1:11434/v1", "color": "purple"})
    assert kept.status_code == 200 and kept.json()["has_bearer_token"] is True
    ver = kept.json()["version"]
    # Host change without re-supplying/clearing the token is rejected (exfiltration guard).
    moved = client.put(f"/api/providers/{pid}", headers=admin_h, json={"expected_version": ver, "base_url": "http://127.0.0.2:11434"})
    assert moved.status_code == 422 and moved.json()["detail"]["code"] == "token_required_on_url_change"
    cleared = client.put(f"/api/providers/{pid}", headers=admin_h, json={"expected_version": ver, "base_url": "http://127.0.0.2:11434", "clear_bearer_token": True})
    assert cleared.status_code == 200 and cleared.json()["has_bearer_token"] is False
    # Stale version -> 409.
    stale = client.put(f"/api/providers/{pid}", headers=admin_h, json={"expected_version": ver, "name": "again"})
    assert stale.status_code == 409


def test_delete_and_disable_blocked_by_system_roles_but_user_overrides_reset(env) -> None:
    client, repo, admin_h, make_user = env
    alice_h, alice_id = make_user("alice")
    first = _create(client, admin_h, name="One").json()
    second = _create(client, admin_h, name="Two", settings={"base_url": "http://127.0.0.2:11434"}).json()
    settings.actor_profile.provider_id = first["id"]
    settings.clerk_profile.provider_id = first["id"]
    settings.allow_user_model_overrides = True

    blocked = client.delete(f"/api/providers/{first['id']}", headers=admin_h)
    assert blocked.status_code == 409
    assert {r["role"] for r in blocked.json()["referenced_by"]} == {"actor", "clerk"}
    disable = client.put(f"/api/providers/{first['id']}", headers=admin_h, json={"expected_version": first["version"], "is_enabled": False})
    assert disable.status_code == 409

    # Alice overrides her actor to provider Two; deleting Two clears her override instead of blocking.
    override = {"actor_profile": {"provider_id": second["id"], "model": "m1"}}
    assert client.put("/api/profile/models", headers=alice_h, json=override).status_code == 200
    deleted = client.delete(f"/api/providers/{second['id']}", headers=admin_h)
    assert deleted.status_code == 200 and deleted.json()["reset_user_overrides"] == 1
    assert repo.get_user_model_settings(alice_id).actor_profile is None


def test_idor_user_cannot_reference_another_users_provider(env) -> None:
    client, repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    bob_h, bob_id = make_user("bob")
    system = _create(client, admin_h, name="Sys").json()
    settings.actor_profile.provider_id = system["id"]
    mine = client.post("/api/providers", headers=alice_h, json={"name": "A", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()

    stolen = client.put("/api/profile/models", headers=bob_h, json={"actor_profile": {"provider_id": mine["id"], "model": "x"}})
    assert stolen.status_code == 422

    # Even a row injected straight into the DB is refused at resolution time (with a warning).
    conn = sqlite3.connect(settings.db_path)
    conn.execute(
        "INSERT INTO user_model_settings (user_id, actor_profile_json, persona_disclosure_mode, updated_at) VALUES (?, ?, 'llm_intent', 'now')",
        (bob_id, ModelProfile(provider_id=mine["id"], model="x").model_dump_json()),
    )
    conn.commit()
    conn.close()
    eff = resolve_effective_models(bob_id)
    assert eff.actor.provider_id == system["id"] and eff.actor.model != "x"
    assert [(w.role, w.code) for w in eff.warnings] == [("actor", "not_found")]


def test_byop_revoked_keeps_providers_but_falls_back_with_warning(env) -> None:
    client, repo, admin_h, make_user = env
    settings.allow_user_providers = True
    settings.allow_user_model_overrides = True
    alice_h, alice_id = make_user("alice")
    system = _create(client, admin_h, name="Sys").json()
    settings.actor_profile.provider_id = system["id"]
    mine = client.post("/api/providers", headers=alice_h, json={"name": "A", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()
    assert client.put("/api/profile/models", headers=alice_h, json={"actor_profile": {"provider_id": mine["id"], "model": "mine-model"}}).status_code == 200
    assert resolve_effective_models(alice_id).actor.model == "mine-model"

    settings.allow_user_providers = False  # admin revokes BYOP
    eff = resolve_effective_models(alice_id)
    assert eff.actor.provider_id == system["id"]
    assert [(w.role, w.code) for w in eff.warnings] == [("actor", "byop_disabled")]
    listed = next(p for p in client.get("/api/providers", headers=alice_h).json() if p["id"] == mine["id"])
    assert listed["usable"] is False and listed["unusable_reason"] == "byop_disabled"
    assert client.delete(f"/api/providers/{mine['id']}", headers=alice_h).status_code == 200  # still deletable

    # Re-enabling restores the previous state when the provider still exists.
    again = client.post("/api/providers", headers=alice_h, json={"name": "A", "scope": "user", "settings": {"base_url": PUBLIC_URL}})
    assert again.status_code == 403
    settings.allow_user_providers = True


def test_profile_override_sanitizes_connection_fields(env) -> None:
    client, repo, admin_h, make_user = env
    settings.allow_user_model_overrides = True
    alice_h, alice_id = make_user("alice")
    res = client.put(
        "/api/profile/models",
        headers=alice_h,
        json={"actor_profile": {"base_url": "http://169.254.169.254", "api_key": "stolen", "model": "m"}},
    )
    assert res.status_code == 200
    saved = repo.get_user_model_settings(alice_id).actor_profile
    assert saved is not None and "169.254" not in saved.base_url


def test_clerk_mirrors_actor_provider_and_model_but_keeps_sampling(env, monkeypatch) -> None:
    client, _repo, admin_h, _ = env
    system = _create(client, admin_h, name="Sys").json()
    other = _create(client, admin_h, name="Other", settings={"base_url": "http://127.0.0.2:11434"}).json()
    settings.actor_profile.provider_id = system["id"]
    settings.actor_profile.model = "actor-model"
    settings.clerk_profile.provider_id = other["id"]
    settings.clerk_profile.model = "clerk-model"
    settings.clerk_profile.temperature = 0.2
    settings.clerk_mirrors_actor = True
    eff = resolve_effective_models(None)
    assert eff.clerk.provider_id == system["id"] and eff.clerk.model == "actor-model"
    assert eff.clerk.temperature == 0.2
    assert eff.clerk.resolved is not None and eff.clerk.resolved.provider_id == system["id"]


def test_public_settings_redact_paths_and_urls(env) -> None:
    client, _repo, admin_h, make_user = env
    alice_h, _ = make_user("alice")
    public = client.get("/api/settings", headers=alice_h)
    assert public.status_code == 200
    body = public.json()
    assert body["db_path"] == "" and body["media_dir"] == ""
    assert body["actor_profile"]["base_url"] == ""
    assert "api_key" not in public.text
    admin_view = client.get("/api/settings", headers=admin_h).json()
    assert admin_view["db_path"] != ""


def test_user_deletion_removes_personal_providers(env) -> None:
    client, repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, alice_id = make_user("alice")
    client.post("/api/providers", headers=alice_h, json={"name": "A", "scope": "user", "settings": {"base_url": PUBLIC_URL}})
    assert repo.providers.list_for_owner(alice_id)
    repo.delete_user(alice_id)
    assert repo.providers.list_for_owner(alice_id) == []


def test_persist_settings_is_atomic_and_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "cantina_settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", target)
    persist_settings(settings)
    good = target.read_text()
    assert json.loads(good)["actor_profile"].get("api_key") is None  # tokens are never serialized

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(config.os, "replace", boom)
    with pytest.raises(OSError):
        persist_settings(settings)
    assert target.read_text() == good
    assert not list(tmp_path.glob(".cantina_settings.*.tmp"))


# ---------------------------------------------------------------------- seeder
def _legacy_settings(actor_url: str, clerk_url: str, key: str = "ollama") -> AppSettings:
    return AppSettings(
        actor_profile=ModelProfile(base_url=actor_url, api_key=key, model="a"),
        clerk_profile=ModelProfile(base_url=clerk_url, api_key=key, model="c"),
    )


def test_seeder_dedupes_roots_ignores_dummy_key_and_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", tmp_path / "cs.json")
    repo = CantinaRepository(str(tmp_path / "s.db"))
    repo.init_db()
    store = repo.providers
    app_settings = _legacy_settings("http://localhost:11434/v1", "http://localhost:11434")
    report = seed_providers(store, app_settings, settings_path=config.SETTINGS_FILE_PATH)
    assert len(report.created) == 1 and not report.skipped
    provider = store.list_system()[0]
    assert provider.name == "Local Ollama" and provider.base_url == "http://localhost:11434"
    assert provider.secret_enc is None  # dummy "ollama" key is not a bearer token
    assert app_settings.actor_profile.provider_id == app_settings.clerk_profile.provider_id == provider.id
    assert seed_providers(store, app_settings).skipped is True
    assert len(store.list_system()) == 1


def test_seeder_multiple_urls_real_token_and_user_override_mapping(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", tmp_path / "cs.json")
    repo = CantinaRepository(str(tmp_path / "s.db"))
    repo.init_db()
    user = repo.create_user(username="u1", display_name="U1", password_hash="x", role="user")
    store = repo.providers
    app_settings = _legacy_settings("http://localhost:11434/v1", "https://cloud.example.com/v1", key="real-key")
    app_settings.clerk_profile.api_key = "cloud-key"
    app_settings.actor_profile.api_key = "ollama"
    if user is not None:
        conn = sqlite3.connect(str(tmp_path / "s.db"))
        conn.execute(
            "INSERT INTO user_model_settings (user_id, actor_profile_json, clerk_profile_json, persona_disclosure_mode, updated_at) VALUES (?, ?, ?, 'llm_intent', 'now')",
            (
                user.id,
                json.dumps({"base_url": "http://localhost:11434/v1", "model": "m"}),
                json.dumps({"base_url": "http://elsewhere.example.org/v1", "model": "n"}),
            ),
        )
        conn.commit()
        conn.close()
    report = seed_providers(store, app_settings)
    assert len(report.created) == 2
    names = {p.name for p in store.list_system()}
    assert names == {"Local Ollama", "Ollama (cloud.example.com)"}
    cloud = next(p for p in store.list_system() if "cloud" in p.name)
    assert store.bearer_token(cloud) == "cloud-key"
    if user is not None:
        saved = repo.get_user_model_settings(user.id)
        assert saved.actor_profile.provider_id == app_settings.actor_profile.provider_id
        assert saved.clerk_profile.provider_id == app_settings.actor_profile.provider_id  # unmatched URL -> default
        assert report.discarded_overrides


def test_seeder_rolls_back_on_failure(tmp_path: Path, monkeypatch) -> None:
    repo = CantinaRepository(str(tmp_path / "s.db"))
    repo.init_db()
    store = repo.providers
    app_settings = _legacy_settings("http://localhost:11434/v1", "http://localhost:11434/v1")

    def boom(*_a, **_k):
        raise RuntimeError("crash mid-migration")

    monkeypatch.setattr(ProviderStore, "set_meta", boom)
    with pytest.raises(RuntimeError):
        seed_providers(store, app_settings)
    assert store.list_system() == []
    assert app_settings.actor_profile.provider_id is None


def test_reconcile_relinks_profiles_by_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", tmp_path / "cs.json")
    repo = CantinaRepository(str(tmp_path / "s.db"))
    repo.init_db()
    store = repo.providers
    rec = store.create(name="X", type="ollama", scope="system", owner_id=None, color="cyan", is_enabled=True, base_url="http://localhost:11434", bearer_token=None, network_restricted=False)
    app_settings = _legacy_settings("http://localhost:11434/v1", "http://localhost:11434/v1")
    findings = reconcile_settings_references(app_settings, store)
    assert app_settings.actor_profile.provider_id == rec.id and findings
    app_settings.clerk_profile.provider_id = "prov_gone"
    assert any("missing provider" in f for f in reconcile_settings_references(app_settings, store))


# ----------------------------------------------------------------------- probing
def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


TAGS = {"models": [{"name": "llama3:8b", "size": 5 * 1024 * 1024, "details": {"family": "llama"}}, {"name": "nomic-embed-text:latest", "size": 1024 * 1024, "details": {"family": "bert"}}]}


async def test_probe_single_flight_cache_bearer_and_persistence(tmp_path: Path) -> None:
    repo = CantinaRepository(str(tmp_path / "p.db"))
    repo.init_db()
    store = repo.providers
    rec = store.create(name="P", type="ollama", scope="system", owner_id=None, color="cyan", is_enabled=True, base_url="http://127.0.0.1:11434", bearer_token="tok", network_restricted=False)
    seen: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        await asyncio.sleep(0.05)
        return httpx.Response(200, json=TAGS)

    service = ProbeService()
    service._client = _mock_client(handler)
    results = await asyncio.gather(*(service.probe(rec, store) for _ in range(20)))
    assert len(seen) == 1  # single flight
    assert seen[0].headers["authorization"] == "Bearer tok"
    assert all(r.reachable and r.chat_models == ["llama3:8b"] and r.embedding_models == ["nomic-embed-text:latest"] for r in results)
    cached = await service.probe(rec, store)
    assert cached.from_cache and len(seen) == 1  # TTL cache
    stored = store.get(rec.id)
    assert [m.name for m in stored.cached_models] == ["llama3:8b", "nomic-embed-text:latest"]
    first_hash = stored.models_hash
    await service.probe(rec, store, force=True)
    assert store.get(rec.id).models_hash == first_hash  # unchanged catalog -> no rewrite
    await service.close()


async def test_probe_failure_keeps_cached_models_and_maps_error_codes(tmp_path: Path) -> None:
    repo = CantinaRepository(str(tmp_path / "p.db"))
    repo.init_db()
    store = repo.providers
    rec = store.create(name="P", type="ollama", scope="system", owner_id=None, color="cyan", is_enabled=True, base_url="http://127.0.0.1:11434", bearer_token=None, network_restricted=False)
    mode = {"v": "ok"}

    def handler(request: httpx.Request) -> httpx.Response:
        if mode["v"] == "ok":
            return httpx.Response(200, json=TAGS)
        if mode["v"] == "401":
            return httpx.Response(401, text="secret internal detail")
        if mode["v"] == "native404":
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"data": [{"id": "gpt-x"}]})
            return httpx.Response(404)
        raise httpx.ConnectTimeout("slow")

    service = ProbeService()
    service._client = _mock_client(handler)
    await service.probe(rec, store, force=True)
    for mode_name, code in (("401", "unauthorized"), ("timeout", "timeout")):
        mode["v"] = mode_name
        res = await service.probe(rec, store, force=True)
        assert res.reachable is False and res.error_code == code
        assert [m.name for m in store.get(rec.id).cached_models][0] == "llama3:8b"  # catalog survives
        assert store.get(rec.id).last_error_code == code
    mode["v"] = "native404"
    alt = await service.probe(rec, store, force=True)
    assert alt.reachable and alt.protocol == "openai_compat" and alt.chat_models == ["gpt-x"]
    await service.close()


async def test_probe_blocks_restricted_provider_pointing_at_private_network(tmp_path: Path) -> None:
    repo = CantinaRepository(str(tmp_path / "p.db"))
    repo.init_db()
    store = repo.providers
    rec = store.create(name="P", type="ollama", scope="system", owner_id=None, color="cyan", is_enabled=True, base_url="http://10.0.0.5:11434", bearer_token=None, network_restricted=True)
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json=TAGS)

    service = ProbeService()
    service._client = _mock_client(handler)
    res = await service.probe(rec, store, force=True)
    assert not res.reachable and res.error_code == "blocked_by_policy" and not called
    await service.close()


def test_probe_error_detail_only_for_managers(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    sys_prov = _create(client, admin_h, name="Sys").json()
    mine = client.post("/api/providers", headers=alice_h, json={"name": "Mine", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()

    probe_service._client = _mock_client(lambda request: httpx.Response(401, text="internal detail"))
    admin_res = client.post(f"/api/providers/{sys_prov['id']}/probe?force=true", headers=admin_h).json()
    owner_res = client.post(f"/api/providers/{mine['id']}/probe?force=true", headers=alice_h).json()
    assert admin_res["error_code"] == owner_res["error_code"] == "unauthorized"
    assert admin_res["error"] and owner_res["error"]  # managers get the detail
    # A non-manager can no longer probe at all (see test_non_admin_cannot_probe_or_manage_system_providers).


def test_probe_draft_reuses_token_only_for_same_host(env) -> None:
    client, _repo, admin_h, _ = env
    prov = _create(client, admin_h, name="Sys", settings={"base_url": "http://127.0.0.1:11434", "bearer_token": "stored"}).json()
    auth_seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        auth_seen.append(request.headers.get("authorization"))
        return httpx.Response(200, json=TAGS)

    probe_service._client = _mock_client(handler)
    same = client.post("/api/providers/probe-draft", headers=admin_h, json={"provider_id": prov["id"], "base_url": "http://127.0.0.1:11434/v1"})
    assert same.status_code == 200 and same.json()["reachable"] is True
    moved = client.post("/api/providers/probe-draft", headers=admin_h, json={"provider_id": prov["id"], "base_url": "http://127.0.0.2:11434"})
    assert moved.status_code == 200
    assert auth_seen == ["Bearer stored", None]  # stored token never follows a host change


def test_probe_rate_limit_for_regular_users(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    mine = client.post("/api/providers", headers=alice_h, json={"name": "Mine", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()
    probe_service._client = _mock_client(lambda request: httpx.Response(200, json=TAGS))
    probe_service.user_limiter.limit = 3
    codes = [client.post(f"/api/providers/{mine['id']}/probe?force=true", headers=alice_h).json().get("error_code") for _ in range(5)]
    assert codes[:3] == [None, None, None] and codes[3:] == ["rate_limited", "rate_limited"]


# ------------------------------------------------------------- llm_client auth
async def test_llm_client_sends_bearer_on_native_and_openai_paths(tmp_path: Path, monkeypatch) -> None:
    from app.providers.endpoint import ResolvedEndpoint

    endpoint = ResolvedEndpoint(provider_id="p", type="ollama", root_url="http://127.0.0.1:11434", bearer_token="cloud-tok")
    profile = ModelProfile(provider_id="p", model="m", resolved=endpoint)
    target = await build_call_target(profile)
    assert target.native_headers == {"Authorization": "Bearer cloud-tok"}
    assert target.openai_headers["Authorization"] == "Bearer cloud-tok"

    seen: list[tuple[str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, request.headers.get("authorization")))
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"message": {"content": "hi"}, "done": True})
        return httpx.Response(404)

    monkeypatch.setattr(llm_client, "_client", _mock_client(handler))
    assert await llm_client.complete_text([{"role": "user", "content": "x"}], profile=profile) == "hi"
    assert seen == [("/api/chat", "Bearer cloud-tok")]


async def test_llm_client_revalidates_restricted_endpoints(monkeypatch) -> None:
    from app.providers.endpoint import ResolvedEndpoint

    endpoint = ResolvedEndpoint(provider_id="p", type="ollama", root_url="http://10.0.0.9:11434", network_restricted=True)
    with pytest.raises(RuntimeError, match="blocked by network policy"):
        await build_call_target(ModelProfile(provider_id="p", resolved=endpoint))


# ------------------------------------------------------------ embedding space
async def test_embedding_fingerprint_marks_stale_filters_search_and_reindexes(tmp_path: Path, monkeypatch) -> None:
    repo = CantinaRepository(str(tmp_path / "v.db"))
    repo.init_db()
    store = repo.vector_store
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    monkeypatch.setattr(settings.embedding_profile, "dimensions", 384)
    store.upsert_entry(entry_id="e1", source_type="lore", world_id="w1", title="Dragon", content="A red dragon sleeps under the mountain", keywords=["dragon"])

    async def search() -> list:
        return await store.search_memories(queries=["dragon"], mentioned_entities=[], world_id="w1", character_id="c", campaign_id="camp", valid_branch_turn_ids=[], top_k=3)

    assert [r.id for r in await search()] == ["e1"]
    assert store.count_stale_entries() == 0

    monkeypatch.setattr(settings.embedding_profile, "dimensions", 128)  # new embedding space
    assert store.count_stale_entries() == 1
    assert await search() == []  # stale vectors are ignored, never garbage-scored

    assert await store.reindex() == 1
    assert store.count_stale_entries() == 0
    assert [r.id for r in await search()] == ["e1"]


def test_stamp_unstamped_entries_marks_legacy_rows_current(tmp_path: Path) -> None:
    repo = CantinaRepository(str(tmp_path / "v.db"))
    repo.init_db()
    store = repo.vector_store
    store.upsert_entry(entry_id="e1", source_type="lore", world_id="w1", title="t", content="c")
    conn = sqlite3.connect(str(tmp_path / "v.db"))
    conn.execute("UPDATE vector_entries SET embedding_fingerprint = NULL")
    conn.commit()
    conn.close()
    assert store.stamp_unstamped_entries() == 1
    assert store.count_stale_entries() == 0


def test_embedding_provider_must_be_system_scope(env) -> None:
    client, _repo, admin_h, make_user = env
    settings.allow_user_providers = True
    alice_h, _ = make_user("alice")
    mine = client.post("/api/providers", headers=alice_h, json={"name": "A", "scope": "user", "settings": {"base_url": PUBLIC_URL}}).json()
    current = client.get("/api/settings", headers=admin_h).json()
    current["embedding_profile"]["provider_id"] = mine["id"]
    assert client.put("/api/settings", headers=admin_h, json=current).status_code == 422


# ----------------------------------------------------------- UI/backend contract
def test_ui_limits_match_backend_bounds() -> None:
    """The slider hard bounds in the UI must equal the Pydantic constraints (or saves would 422)."""
    import re

    source = (Path(__file__).resolve().parents[2] / "frontend/src/components/models/modelLimits.ts").read_text()

    def const(name: str) -> float:
        match = re.search(rf"export const {name} = ([0-9.]+);", source)
        assert match, f"{name} not found in modelLimits.ts"
        return float(match.group(1))

    fields = ModelProfile.model_fields
    temp_meta = {type(m).__name__: m for m in fields["temperature"].metadata}
    tokens_meta = {type(m).__name__: m for m in fields["max_tokens"].metadata}
    assert const("TEMPERATURE_HARD_MIN") == temp_meta["Ge"].ge
    assert const("TEMPERATURE_HARD_MAX") == temp_meta["Le"].le
    assert const("MAX_TOKENS_HARD_MIN") == tokens_meta["Ge"].ge
    assert const("MAX_TOKENS_HARD_MAX") == tokens_meta["Le"].le


# ------------------------------------------------- system providers are read-only for users
def test_non_admin_cannot_probe_or_manage_system_providers(env) -> None:
    client, _repo, admin_h, make_user = env
    alice_h, _ = make_user("alice")
    prov = _create(client, admin_h, name="Sys").json()
    upstream = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        upstream["calls"] += 1
        return httpx.Response(200, json=TAGS)

    probe_service._client = _mock_client(handler)
    for force in ("", "?force=true"):
        res = client.post(f"/api/providers/{prov['id']}/probe{force}", headers=alice_h)
        assert res.status_code == 403
    assert upstream["calls"] == 0  # no connection was ever made on a user's request
    assert client.post("/api/providers/probe-draft", headers=alice_h, json={"provider_id": prov["id"], "base_url": "http://x"}).status_code == 403
    assert client.put(f"/api/providers/{prov['id']}", headers=alice_h, json={"expected_version": 1, "name": "x"}).status_code == 403
    assert client.delete(f"/api/providers/{prov['id']}", headers=alice_h).status_code == 403
    assert client.post(f"/api/providers/{prov['id']}/probe", headers=admin_h).status_code == 200


async def test_background_probe_keeps_last_status_visible_to_users(env) -> None:
    from app.providers.probe import probe_system_providers

    client, repo, admin_h, make_user = env
    alice_h, _ = make_user("alice")
    ok = _create(client, admin_h, name="Up").json()
    down = _create(client, admin_h, name="Down", settings={"base_url": "http://127.0.0.2:11434"}).json()
    off = _create(client, admin_h, name="Off", settings={"base_url": "http://127.0.0.3:11434"}, is_enabled=False).json()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "127.0.0.2":
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json=TAGS)

    service = ProbeService()
    service._client = _mock_client(handler)
    assert await probe_system_providers(repo.providers, service) == 2  # disabled providers are skipped
    await service.close()

    listed = {p["name"]: p for p in client.get("/api/providers", headers=alice_h).json()}
    assert listed["Up"]["last_probed_at"] and listed["Up"]["last_error_code"] is None
    assert listed["Down"]["last_probed_at"] and listed["Down"]["last_error_code"] == "connect_refused"
    assert listed["Off"]["last_probed_at"] is None
    assert listed["Up"]["base_url"] is None  # still no connection details for users
