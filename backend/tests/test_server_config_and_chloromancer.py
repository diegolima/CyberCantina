"""Integration tests for Server Configuration, Chloromancer housekeeping, activity tracking, and media quotas."""

from __future__ import annotations

import io
import json
import os
import sqlite3
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.schemas.character import BaselinePsyche, CharacterWizardDraft


def _minimal_char_draft(name: str = "Test Char", persona: str = "Test") -> dict:
    return {
        "name": name,
        "tagline": "Test tagline",
        "physical_appearance": "Average build.",
        "core_persona": persona,
        "initial_message": "Hello there.",
        "baseline_psyche": {
            "core_drive": "Survival",
            "core_fear": "Isolation",
            "default_want": "Answers",
            "default_plan": "Listen carefully",
        },
    }


def _make_png_bytes(width: int = 256, height: int = 256, noise: bool = True) -> bytes:
    """Create valid PNG bytes; high-entropy RGB pixels produce large WebP payloads when needed."""
    if noise:
        raw = os.urandom(width * height * 3)
        img = Image.frombytes("RGB", (width, height), raw)
    else:
        img = Image.new("RGB", (width, height), color=(24, 48, 72))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _embed_sillytavern_chara_png(png_bytes: bytes, char_name: str = "Nova") -> bytes:
    """Attach a minimal SillyTavern V2 'chara' tEXt chunk onto PNG bytes."""
    import base64
    from PIL import PngImagePlugin

    payload = {
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name": char_name,
            "description": "Sharp-eyed orbital courier.",
            "personality": "Guarded, resourceful",
            "scenario": "Docking ring 9",
            "first_mes": "Docking clamps are locked.",
            "mes_example": "",
            "tags": ["scifi"],
            "creator": "test",
            "creator_notes": "",
        },
    }
    encoded = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    meta = PngImagePlugin.PngInfo()
    meta.add_text("chara", encoded)
    with Image.open(io.BytesIO(png_bytes)) as im:
        out = io.BytesIO()
        im.save(out, format="PNG", pnginfo=meta)
        return out.getvalue()


@pytest.fixture()
def server_cfg_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, CantinaRepository, Path]:
    db_file = str(tmp_path / "server_cfg.db")
    media_dir = tmp_path / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    settings_file = tmp_path / "runtime_settings.json"

    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", str(media_dir))
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings, "allow_self_registration", True)
    monkeypatch.setattr(settings, "inactive_user_purge_days", None)
    monkeypatch.setattr(settings, "user_media_quota_mb", None)
    monkeypatch.setattr(settings, "chloromancer_interval_minutes", 60)
    monkeypatch.setattr("app.config.SETTINGS_FILE_PATH", settings_file)

    repo = CantinaRepository(db_file, media_dir=str(media_dir))
    repo.init_db()
    ensure_default_seed(repo)

    client = TestClient(main_module.app)
    setup_res = client.post(
        "/api/auth/setup",
        json={
            "username": "AdminRoot",
            "display_name": "Root Admin",
            "password": "AdminPassword123!",
        },
    )
    assert setup_res.status_code == 200
    return client, repo, media_dir


def test_self_registration_toggle_and_admin_manual_create(
    server_cfg_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    admin_client, _repo, _media_dir = server_cfg_env

    # Default allows self-registration
    status_open = admin_client.get("/api/auth/status").json()
    assert status_open["allow_self_registration"] is True

    # Disable self-registration via settings
    cfg = admin_client.get("/api/settings").json()
    cfg["allow_self_registration"] = False
    save_res = admin_client.put("/api/settings", json=cfg)
    assert save_res.status_code == 200
    assert save_res.json()["allow_self_registration"] is False

    anon_client = TestClient(main_module.app)
    status_closed = anon_client.get("/api/auth/status").json()
    assert status_closed["allow_self_registration"] is False

    reg_res = anon_client.post(
        "/api/auth/register",
        json={"username": "BlockedUser", "password": "Password123!"},
    )
    assert reg_res.status_code == 403
    assert "disabled" in reg_res.json()["detail"].lower()

    # Admin can still create a user explicitly
    admin_create = admin_client.post(
        "/api/admin/users",
        json={"username": "InvitedUser", "password": "Password123!", "role": "user"},
    )
    assert admin_create.status_code == 200
    assert admin_create.json()["username"] == "InvitedUser"


def test_user_activity_tracking_and_legacy_db_migration(tmp_path: Path) -> None:
    # Build a legacy SQLite DB without last_login_at/last_active_at or chloromancer_runs
    db_file = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(db_file))
    conn.executescript(
        """
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE user_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_agent TEXT NOT NULL DEFAULT '',
            ip_address TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            last_active_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at)
        VALUES ('user_old', 'LegacyUser', 'Legacy', NULL, 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO user_sessions (id, user_id, created_at, last_active_at, expires_at)
        VALUES ('hash1', 'user_old', '2026-02-01T00:00:00Z', '2026-02-10T12:00:00Z', '2027-01-01T00:00:00Z');
        """
    )
    conn.close()

    repo = CantinaRepository(str(db_file), media_dir=str(tmp_path / "media"))
    repo.init_db()

    migrated = repo.get_user_by_id("user_old")
    assert migrated.last_login_at == "2026-02-01T00:00:00Z"
    assert migrated.last_active_at == "2026-02-10T12:00:00Z"

    # Throttled touch_session updates last_active_at when older than 1800s without changing last_login_at
    token_hash = "hash_active_session"
    future_iso = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    stale_iso = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = repo._connect()
    try:
        conn.execute(
            """
            INSERT INTO user_sessions (id, user_id, created_at, last_active_at, expires_at)
            VALUES (?, 'user_old', ?, ?, ?)
            """,
            (token_hash, stale_iso, stale_iso, future_iso),
        )
        conn.commit()
    finally:
        conn.close()

    touched = repo.get_and_touch_session(token_hash, idle_timeout_seconds=86400)
    assert touched is not None
    assert touched.last_login_at == "2026-02-01T00:00:00Z"
    assert touched.last_active_at != "2026-02-10T12:00:00Z"


def test_chloromancer_purge_preview_execution_orphan_grace_and_vacuum(
    server_cfg_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    admin_client, repo, media_dir = server_cfg_env

    # Register two standard users
    user_active_client = TestClient(main_module.app)
    res_active = user_active_client.post(
        "/api/auth/register",
        json={"username": "ActivePlayer", "password": "Password123!"},
    )
    assert res_active.status_code == 200
    active_uid = res_active.json()["user"]["id"]

    user_stale_client = TestClient(main_module.app)
    res_stale = user_stale_client.post(
        "/api/auth/register",
        json={"username": "StalePlayer", "password": "Password123!"},
    )
    assert res_stale.status_code == 200
    stale_uid = res_stale.json()["user"]["id"]

    # Give stale player a world, character, and portrait media
    world_res = user_stale_client.post(
        "/api/wizards/world/commit",
        json={
            "name": "Old World",
            "global_rules": {
                "genre": "scifi",
                "tone": "gritty",
                "setting_overview": "An old orbital station.",
                "narrative_style": "third person",
                "sensory_profile": "cool recycled air",
                "taboos_and_limits": "none",
            },
            "locations": [
                {
                    "key": "loc_bay",
                    "name": "Docking Bay",
                    "summary": "Outer ring dock",
                    "description": "Metal catwalks over docking clamps.",
                    "environmental_tags": ["metal"],
                    "is_starting_location": True,
                    "lore_nodes": [],
                }
            ],
            "edges": [],
            "lore_nodes": [],
        },
    )
    assert world_res.status_code == 200
    char_res = user_stale_client.post(
        "/api/wizards/character/commit",
        json={
            "draft": _minimal_char_draft("Old Char", "Forgotten spacer"),
            "world_id": world_res.json()["id"],
        },
    )
    assert char_res.status_code == 200
    stale_char_id = char_res.json()["id"]
    upload_res = user_stale_client.post(
        f"/api/characters/{stale_char_id}/portraits/default",
        files={"file": ("avatar.png", _make_png_bytes(64, 64), "image/png")},
    )
    assert upload_res.status_code == 200
    stale_media_dir = media_dir / "characters" / stale_char_id
    assert stale_media_dir.is_dir()

    # Backdate BOTH admin (to prove admin exemption) and stale user by 20 days
    old_ts = (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    admin_uid = admin_client.get("/api/profile").json()["id"]
    conn = repo._connect()
    try:
        conn.execute(
            "UPDATE users SET last_active_at = ?, last_login_at = ? WHERE id IN (?, ?)",
            (old_ts, old_ts, admin_uid, stale_uid),
        )
        conn.commit()
    finally:
        conn.close()

    # Create 2 orphan directories: one older than 24h (should be swept), one fresh (should stay)
    old_orphan = media_dir / "characters" / "char_old_orphan"
    (old_orphan / "portraits").mkdir(parents=True)
    old_file = old_orphan / "portraits" / "dead.webp"
    old_file.write_bytes(b"old")
    past_mtime = time.time() - (26 * 3600)
    os.utime(old_orphan, (past_mtime, past_mtime))
    os.utime(old_file, (past_mtime, past_mtime))

    fresh_orphan = media_dir / "characters" / "char_fresh_orphan"
    (fresh_orphan / "portraits").mkdir(parents=True)
    (fresh_orphan / "portraits" / "fresh.webp").write_bytes(b"fresh")

    # Standard user cannot access Chloromancer admin endpoints
    assert user_active_client.get("/api/admin/chloromancer/status").status_code == 403

    # Manual trigger when disabled logs 'skipped'
    skipped_run = admin_client.post("/api/admin/chloromancer/run/purge_inactive_users")
    assert skipped_run.status_code == 200
    assert skipped_run.json()["status"] == "skipped"

    # Unknown job -> 404
    assert admin_client.post("/api/admin/chloromancer/run/does_not_exist").status_code == 404

    # Dry-run preview with 14 days override shows StalePlayer only (not admin, not active user)
    preview = admin_client.get("/api/admin/chloromancer/purge-preview?days=14")
    assert preview.status_code == 200
    preview_data = preview.json()
    assert preview_data["total_users"] == 1
    assert preview_data["candidates"][0]["username"] == "StalePlayer"
    assert preview_data["candidates"][0]["character_count"] == 1
    assert preview_data["candidates"][0]["world_count"] == 1
    assert preview_data["candidates"][0]["media_bytes"] > 0

    # StalePlayer still exists after dry-run preview
    assert repo.get_user_by_id(stale_uid).username == "StalePlayer"

    # Enable inactive_user_purge_days = 14 and run cleanup
    cfg = admin_client.get("/api/settings").json()
    cfg["inactive_user_purge_days"] = 14
    assert admin_client.put("/api/settings", json=cfg).status_code == 200

    run_res = admin_client.post("/api/admin/chloromancer/run/purge_inactive_users")
    assert run_res.status_code == 200
    run_data = run_res.json()
    assert run_data["status"] == "ok"
    assert run_data["items_affected"] == 1
    assert run_data["details"]["purged_usernames"] == ["StalePlayer"]
    assert run_data["details"]["orphan_media_dirs_removed"] >= 1
    assert run_data["details"]["vacuum_ran"] is True

    # Stale user and media are gone; admin and active user intact; fresh orphan preserved
    with pytest.raises(KeyError):
        repo.get_user_by_id(stale_uid)
    assert not stale_media_dir.exists()
    assert not old_orphan.exists()
    assert fresh_orphan.exists()
    assert repo.get_user_by_id(admin_uid).username == "AdminRoot"
    assert repo.get_user_by_id(active_uid).username == "ActivePlayer"

    status = admin_client.get("/api/admin/chloromancer/status").json()
    assert len(status["recent_runs"]) >= 2


def test_media_quota_enforcement_and_admin_exemption(
    server_cfg_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    admin_client, _repo, media_dir = server_cfg_env

    player_client = TestClient(main_module.app)
    assert (
        player_client.post(
            "/api/auth/register",
            json={"username": "QuotaUser", "password": "Password123!"},
        ).status_code
        == 200
    )

    # Set minimum API quota (0.5 MB = 524,288 bytes) so small solid PNG passes (~300B)
    # and high-entropy 512x512 portrait (~600KB+) / 1200x1200 gallery (~2MB+) exceeds quota.
    cfg = admin_client.get("/api/settings").json()
    cfg["user_media_quota_mb"] = 0.5
    assert admin_client.put("/api/settings", json=cfg).status_code == 200

    # Create character for player
    c_res = player_client.post(
        "/api/wizards/character/commit",
        json={"draft": _minimal_char_draft("Quota Char", "Test")},
    )
    assert c_res.status_code == 200
    cid = c_res.json()["id"]

    # Small flat image succeeds
    small_png = _make_png_bytes(32, 32, noise=False)
    ok_upload = player_client.post(
        f"/api/characters/{cid}/portraits/default",
        files={"file": ("small.png", small_png, "image/png")},
    )
    assert ok_upload.status_code == 200
    old_portrait_url = ok_upload.json()["portraits"]["default"]
    old_filename = Path(old_portrait_url).name
    old_file_path = media_dir / "characters" / cid / "portraits" / old_filename
    assert old_file_path.is_file()

    # Fill most of the 0.5 MB quota with heavy 512x512 slots before replacing default
    big_portrait_png = _make_png_bytes(512, 512, noise=True)
    for slot in ("happy", "sad", "angry", "surprised"):
        res = player_client.post(
            f"/api/characters/{cid}/portraits/{slot}",
            files={"file": (f"{slot}.png", big_portrait_png, "image/png")},
        )
        if res.status_code == 413:
            break

    # Replacing default slot with a heavy 512x512 portrait exceeds 0.5 MB quota -> 413 AND existing portrait stays intact!
    fail_upload = player_client.post(
        f"/api/characters/{cid}/portraits/default",
        files={"file": ("big.png", big_portrait_png, "image/png")},
    )
    assert fail_upload.status_code == 413
    assert "quota" in fail_upload.json()["detail"].lower()
    assert old_file_path.is_file()

    # High-entropy gallery upload exceeding quota also returns 413
    big_gallery_png = _make_png_bytes(1024, 1024, noise=True)
    fail_gallery = player_client.post(
        f"/api/characters/{cid}/gallery",
        files={"file": ("big_gal.png", big_gallery_png, "image/png")},
        data={"caption": "Too heavy"},
    )
    assert fail_gallery.status_code == 413

    # Admin user is completely exempt from quota
    admin_c_res = admin_client.post(
        "/api/wizards/character/commit",
        json={"draft": _minimal_char_draft("Admin Char", "Unlimited")},
    )
    assert admin_c_res.status_code == 200
    admin_cid = admin_c_res.json()["id"]
    admin_upload = admin_client.post(
        f"/api/characters/{admin_cid}/portraits/default",
        files={"file": ("big_admin.png", big_portrait_png, "image/png")},
    )
    assert admin_upload.status_code == 200

    # Profile reports media usage + quota for user, null quota for admin
    user_profile = player_client.get("/api/profile").json()
    assert user_profile["media_bytes_used"] > 0
    assert user_profile["media_quota_bytes"] > 0
    admin_profile = admin_client.get("/api/profile").json()
    assert admin_profile["media_quota_bytes"] is None


def test_sillytavern_text_only_warning_and_zcc_atomic_quota_rollback(
    server_cfg_env: tuple[TestClient, CantinaRepository, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_client, repo, media_dir = server_cfg_env

    player_client = TestClient(main_module.app)
    assert (
        player_client.post(
            "/api/auth/register",
            json={"username": "ImportPlayer", "password": "Password123!"},
        ).status_code
        == 200
    )

    cfg = admin_client.get("/api/settings").json()
    cfg["user_media_quota_mb"] = 0.5
    assert admin_client.put("/api/settings", json=cfg).status_code == 200

    async def _fake_distill(*_args, **_kwargs) -> CharacterWizardDraft:
        return CharacterWizardDraft(
            name="Nova",
            tagline="Orbital courier",
            physical_appearance="Lean spacer build.",
            core_persona="Orbital courier distilled from card.",
            initial_message="Docking clamps locked.",
            baseline_psyche=BaselinePsyche(
                core_drive="Survival",
                core_fear="Betrayal",
                default_want="Safe harbor",
                default_plan="Watch the airlocks",
            ),
        )

    monkeypatch.setattr("app.routers.characters.distill_sillytavern_card", _fake_distill)

    heavy_png = _make_png_bytes(1024, 1024, noise=True)
    card_png = _embed_sillytavern_chara_png(heavy_png, "Nova")
    st_res = player_client.post(
        "/api/wizards/character/import-sillytavern",
        files={"file": ("nova.png", card_png, "image/png")},
        data={"auto_generate_world": "false"},
    )
    assert st_res.status_code == 200
    st_data = st_res.json()
    assert st_data["draft"]["name"] == "Nova"
    assert st_data["draft"]["core_persona"] == "Orbital courier distilled from card."
    assert st_data["draft"]["portraits"] == {}
    assert st_data["draft"]["gallery"] == []
    assert st_data["media_warning"] is not None
    assert "quota" in st_data["media_warning"].lower()

    # Now craft a .zcc archive containing an oversized gallery image and verify 413 + zero leftover media
    zcc_buf = io.BytesIO()
    manifest = {
        "format": "cybercantina_archive",
        "version": 1,
        "exported_at": "2026-11-14T00:00:00Z",
        "contents": {"characters": 1, "worlds": 0, "personas": 0},
    }
    chars_payload = [
        {
            "id": "char_src_1",
            "name": "Heavy Character",
            "core_persona": "Heavy payload",
            "portraits": {},
            "gallery": [{"id": "img_1", "url": "media/heavy.png", "caption": "Heavy", "created_at": "2026-11-14T00:00:00Z"}],
            "equipped": [],
            "inventory": [],
            "tags": [],
        }
    ]
    with zipfile.ZipFile(zcc_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("characters.json", json.dumps(chars_payload))
        zf.writestr("worlds.json", "[]")
        zf.writestr("personas.json", "[]")
        zf.writestr("media/heavy.png", heavy_png)

    inspect_res = player_client.post(
        "/api/import/inspect",
        files={"file": ("heavy.zcc", zcc_buf.getvalue(), "application/octet-stream")},
    )
    assert inspect_res.status_code == 200
    staged_token = inspect_res.json()["staged_token"]

    existing_dirs = set((media_dir / "characters").iterdir()) if (media_dir / "characters").exists() else set()
    commit_res = player_client.post(
        "/api/import/commit",
        json={"staged_token": staged_token, "default_conflict_strategy": "copy"},
    )
    assert commit_res.status_code == 413
    after_dirs = set((media_dir / "characters").iterdir()) if (media_dir / "characters").exists() else set()
    assert after_dirs == existing_dirs
    player_uid = player_client.get("/api/profile").json()["id"]
    assert repo.list_characters(owner_id=player_uid) == []
