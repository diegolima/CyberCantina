"""Regression tests for FR-4, FR-6, FR-7, and FR-8 security hardening."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import time
import zipfile

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
import pytest

from app import auth as auth_module
from app import main as main_module
from app.db.repository import CantinaRepository
from app.dependencies import read_upload_bytes_bounded
from app.engine.llm_client import _public_referer_url
from app.housekeeping.purge_inactive import cleanup_stale_staging_files
from app.schemas.character import BaselinePsyche, CharacterWizardDraft
from app.security.media_path import safe_resolve_staging_dir
from app.security.rate_limit import SlidingWindowRateLimiter
from app.security.transport import resolve_client_ip
from app.services import import_export_service


def _minimal_zcc_bytes(label: str = "Empty Pack") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format_version": 1,
                    "generator": "CyberCantina",
                    "generator_version": "0.5.0",
                    "exported_at": "2026-11-20T00:00:00Z",
                    "description": label,
                }
            ),
        )
        zf.writestr("characters.json", "[]")
        zf.writestr("worlds.json", "[]")
        zf.writestr("personas.json", "[]")
    return buf.getvalue()


def test_resolve_client_ip_proxy_trust_and_spoof_resistance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-4: Only trusted proxy peers may supply forwarded client IP headers."""
    monkeypatch.setenv("CYBERCANTINA_TRUSTED_PROXY_HOPS", "1")
    monkeypatch.setenv("CYBERCANTINA_TRUST_CF_HEADERS", "false")

    # Trusted loopback proxy with 1 proxy hop strips rightmost trusted hop
    resolved_xff = resolve_client_ip(
        {"X-Forwarded-For": "198.51.100.1, 203.0.113.20, 127.0.0.1"},
        "127.0.0.1",
    )
    assert resolved_xff == "203.0.113.20"

    # CF-Connecting-IP ignored unless explicitly trusted
    resolved_no_cf = resolve_client_ip(
        {
            "CF-Connecting-IP": "198.51.100.77",
            "X-Forwarded-For": "203.0.113.44",
        },
        "172.18.0.2",
    )
    assert resolved_no_cf == "203.0.113.44"

    monkeypatch.setenv("CYBERCANTINA_TRUST_CF_HEADERS", "true")
    resolved_cf = resolve_client_ip(
        {
            "CF-Connecting-IP": "198.51.100.77",
            "X-Forwarded-For": "203.0.113.44",
        },
        "172.18.0.2",
    )
    assert resolved_cf == "198.51.100.77"

    # Untrusted public peer cannot spoof X-Forwarded-For or CF-Connecting-IP
    spoofed = resolve_client_ip(
        {
            "CF-Connecting-IP": "198.51.100.77",
            "X-Forwarded-For": "198.51.100.1",
        },
        "203.0.113.5",
    )
    assert spoofed == "203.0.113.5"


def test_sliding_window_rate_limiter_bounds_and_http_enforcement(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-4: Enforce bounded sliding-window rate limits with Retry-After across auth and import routes."""
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=0.05, max_keys=2)
    assert limiter.check("k1") == (True, 0)
    assert limiter.check("k1") == (True, 0)
    allowed, retry_after = limiter.check("k1")
    assert allowed is False
    assert retry_after >= 1

    # Bounded key eviction keeps dictionary <= max_keys
    limiter.check("k2")
    limiter.check("k3")
    assert len(limiter._hits) <= 2

    time.sleep(0.06)
    assert limiter.check("k1") == (True, 0)

    _client, repo, _media_dir = api_env
    # Seed admin first so self-registration & normal login flow are active
    api_user_factory("rl_admin", role="admin")
    repo.create_user(
        username="alice_rl",
        display_name="Alice RL",
        password_hash=auth_module.hash_password("ValidPass123!"),
        role="user",
    )
    trusted = TestClient(main_module.app, client=("127.0.0.1", 50000))

    # 1. Per-username failure counter clears on successful login, locks on 10 consecutive failures
    for i in range(8):
        res = trusted.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": f"198.51.100.{10 + i}"},
            json={"username": "alice_rl", "password": "WrongPassword99"},
        )
        assert res.status_code == 401

    ok_login = trusted.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.19"},
        json={"username": "alice_rl", "password": "ValidPass123!"},
    )
    assert ok_login.status_code == 200
    alice_headers = {"Authorization": f"Bearer {ok_login.json()['token']}"}

    for i in range(10):
        res = trusted.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": f"198.51.100.{30 + i}"},
            json={"username": "alice_rl", "password": "WrongPassword99"},
        )
        assert res.status_code == 401

    locked_user = trusted.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.90"},
        json={"username": "alice_rl", "password": "ValidPass123!"},
    )
    assert locked_user.status_code == 429
    assert int(locked_user.headers["Retry-After"]) >= 1

    # 2. Per-IP login bucket (15 attempts / window)
    for i in range(15):
        r = trusted.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": "198.51.100.99"},
            json={"username": f"ghost_user_{i}", "password": "WrongPassword99"},
        )
        assert r.status_code == 401

    ip_limited = trusted.post(
        "/api/auth/login",
        headers={"X-Forwarded-For": "198.51.100.99"},
        json={"username": "ghost_user_final", "password": "WrongPassword99"},
    )
    assert ip_limited.status_code == 429
    assert int(ip_limited.headers["Retry-After"]) >= 1

    # 3. Registration rate limit (5 / IP)
    for i in range(5):
        reg = trusted.post(
            "/api/auth/register",
            headers={"X-Forwarded-For": "198.51.100.77"},
            json={"username": f"reg_user_{i}", "password": "ValidPassword123!"},
        )
        assert reg.status_code == 200

    reg_blocked = trusted.post(
        "/api/auth/register",
        headers={"X-Forwarded-For": "198.51.100.77"},
        json={"username": "reg_user_overflow", "password": "ValidPassword123!"},
    )
    assert reg_blocked.status_code == 429
    assert int(reg_blocked.headers["Retry-After"]) >= 1

    # 4. Import inspect per-user rate limit (15 / user)
    zcc_bytes = _minimal_zcc_bytes("Rate Limit Pack")
    for _ in range(15):
        insp = trusted.post(
            "/api/import/inspect",
            headers=alice_headers,
            files={"file": ("pack.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert insp.status_code == 200

    insp_blocked = trusted.post(
        "/api/import/inspect",
        headers=alice_headers,
        files={"file": ("pack.zcc", zcc_bytes, "application/octet-stream")},
    )
    assert insp_blocked.status_code == 429
    assert int(insp_blocked.headers["Retry-After"]) >= 1

    # 5. Disabling rate limits bypasses active lockouts
    monkeypatch.setenv("CYBERCANTINA_RATE_LIMIT_ENABLED", "false")
    bypass_res = trusted.post(
        "/api/import/inspect",
        headers=alice_headers,
        files={"file": ("pack.zcc", zcc_bytes, "application/octet-stream")},
    )
    assert bypass_res.status_code == 200


def test_bounded_uploads_staged_import_caps_and_cleanup(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-6: Enforce non-ZIP card cap, per-user FIFO eviction, global staging caps, bounded reads, and cleanup."""
    monkeypatch.setenv("CYBERCANTINA_RATE_LIMIT_ENABLED", "false")
    client, repo, media_dir = api_env
    headers_a, user_a_id, _ = api_user_factory("cap_user_a")
    headers_b, _user_b_id, _ = api_user_factory("cap_user_b")

    staging_dir = safe_resolve_staging_dir(media_dir)

    # 1. Oversized non-ZIP card upload rejected with 413 without leaving .part files
    monkeypatch.setattr(import_export_service, "MAX_CARD_IMPORT_BYTES", 256)
    big_card = b"\x89PNG\r\n\x1a\n" + (b"A" * 512)
    card_res = client.post(
        "/api/import/inspect",
        headers=headers_a,
        files={"file": ("big_card.png", big_card, "image/png")},
    )
    assert card_res.status_code == 413
    assert list(staging_dir.glob("import_*.part")) == []

    # 2. Per-user FIFO eviction at >3 staged imports
    zcc_bytes = _minimal_zcc_bytes("Staged Pack")
    tokens: list[str] = []
    for i in range(4):
        resp = client.post(
            "/api/import/inspect",
            headers=headers_a,
            files={"file": (f"pack_{i}.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert resp.status_code == 200
        tokens.append(resp.json()["staged_token"])

    assert len(list(staging_dir.glob("import_*.part"))) == 3
    oldest_commit = client.post(
        "/api/import/commit",
        headers=headers_a,
        json={"staged_token": tokens[0], "default_conflict_strategy": "copy"},
    )
    assert oldest_commit.status_code == 404

    newest_commit = client.post(
        "/api/import/commit",
        headers=headers_a,
        json={"staged_token": tokens[-1], "default_conflict_strategy": "copy"},
    )
    assert newest_commit.status_code == 200

    # 3. Global cap enforcement (count and disk bytes) returns 503 with zero leaked files
    import_export_service.clear_staged_imports()
    monkeypatch.setattr(import_export_service, "MAX_STAGED_IMPORTS_GLOBAL", 2)
    for _ in range(2):
        ok_resp = client.post(
            "/api/import/inspect",
            headers=headers_a,
            files={"file": ("ok.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert ok_resp.status_code == 200

    overflow_resp = client.post(
        "/api/import/inspect",
        headers=headers_b,
        files={"file": ("overflow.zcc", zcc_bytes, "application/octet-stream")},
    )
    assert overflow_resp.status_code == 503
    assert len(list(staging_dir.glob("import_*.part"))) == 2

    # 4. Bounded UploadFile reader & image endpoint 413 guard
    fake_upload = UploadFile(filename="too_big.png", file=io.BytesIO(b"X" * 256))
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(read_upload_bytes_bounded(fake_upload, 100))
    assert exc_info.value.status_code == 413

    char_a = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Upload Guard Char",
            tagline="Guard",
            core_persona="Careful.",
            baseline_psyche=BaselinePsyche(
                core_drive="A.",
                core_fear="B.",
                default_want="C.",
                default_plan="D.",
            ),
        ),
        owner_id=user_a_id,
    )
    huge_img = b"\x00" * (20 * 1024 * 1024 + 128)
    portrait_res = client.post(
        f"/api/characters/{char_a.id}/portraits/default",
        headers=headers_a,
        files={"file": ("huge.png", huge_img, "image/png")},
    )
    assert portrait_res.status_code == 413

    # 5. Stale staging cleanup removes old import_*.part / export_*.zcc only
    import_export_service.clear_staged_imports()
    old_part = staging_dir / "import_old_test.part"
    old_export = staging_dir / "export_old_test.zcc"
    fresh_part = staging_dir / "import_fresh_test.part"
    keep_other = staging_dir / "keep_me.txt"
    for p in (old_part, old_export, fresh_part, keep_other):
        p.write_bytes(b"data")

    stale_mtime = time.time() - 3600
    os.utime(old_part, (stale_mtime, stale_mtime))
    os.utime(old_export, (stale_mtime, stale_mtime))

    removed = cleanup_stale_staging_files(media_dir)
    assert removed == 2
    assert not old_part.exists()
    assert not old_export.exists()
    assert fresh_part.exists()
    assert keep_other.exists()


def test_api_docs_gating_security_headers_hsts_and_referer(
    api_env: tuple[TestClient, CantinaRepository, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-7: Docs disabled by default, baseline security headers always set, HSTS conditional on HTTPS+opt-in."""
    default_client, _repo, _media_dir = api_env

    # Default app hides docs/openapi endpoints
    assert default_client.get("/docs").status_code == 404
    assert default_client.get("/redoc").status_code == 404
    assert default_client.get("/openapi.json").status_code == 404

    # Opting in exposes docs/openapi
    monkeypatch.setenv("CYBERCANTINA_ENABLE_API_DOCS", "true")
    docs_app = main_module.create_app()
    docs_client = TestClient(docs_app)
    assert docs_client.get("/docs").status_code == 200
    assert docs_client.get("/openapi.json").status_code == 200

    # Baseline security headers present; HSTS absent by default
    status_res = default_client.get("/api/auth/status")
    assert status_res.status_code == 200
    assert status_res.headers.get("x-content-type-options") == "nosniff"
    assert status_res.headers.get("x-frame-options") == "SAMEORIGIN"
    assert status_res.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert status_res.headers.get("permissions-policy") == "loopback-network=(self)"
    assert "strict-transport-security" not in status_res.headers

    # HSTS emitted only when explicitly enabled AND request arrives over trusted HTTPS
    monkeypatch.setenv("CYBERCANTINA_ENABLE_HSTS", "true")
    assert (
        "strict-transport-security"
        not in default_client.get("/api/auth/status").headers
    )

    untrusted_spoof = TestClient(main_module.app, client=("203.0.113.5", 50000)).get(
        "/api/auth/status", headers={"X-Forwarded-Proto": "https"}
    )
    assert "strict-transport-security" not in untrusted_spoof.headers

    trusted_https = TestClient(main_module.app, client=("127.0.0.1", 50000)).get(
        "/api/auth/status", headers={"X-Forwarded-Proto": "https"}
    )
    assert (
        trusted_https.headers.get("strict-transport-security")
        == "max-age=31536000; includeSubDomains"
    )

    # Public Referer resolution defaults safely without localhost leakage
    monkeypatch.delenv("CYBERCANTINA_PUBLIC_URL", raising=False)
    assert _public_referer_url() == "https://cybercantina.io"
    monkeypatch.setenv("CYBERCANTINA_PUBLIC_URL", "https://alpha.example.com")
    assert _public_referer_url() == "https://alpha.example.com"


def test_session_touch_throttle_skips_frequent_writes(
    empty_repo: CantinaRepository,
) -> None:
    """FR-8: get_and_touch_session skips SQLite writes when last_active_at is younger than 300s."""
    user = empty_repo.create_user(username="throttle_user", display_name="Throttle")
    raw_token, token_hash = auth_module.generate_session_token()
    assert raw_token
    empty_repo.create_session(session_id_hash=token_hash, user_id=user.id)

    now_dt = datetime.now(timezone.utc)
    recent_iso = (now_dt - timedelta(seconds=120)).strftime("%Y-%m-%dT%H:%M:%SZ")
    stale_iso = (now_dt - timedelta(seconds=360)).strftime("%Y-%m-%dT%H:%M:%SZ")

    conn = empty_repo._connect()
    try:
        conn.execute(
            "UPDATE user_sessions SET last_active_at = ? WHERE id = ?",
            (recent_iso, token_hash),
        )
        conn.commit()
    finally:
        conn.close()

    # Recent (<300s) activity must NOT rewrite last_active_at
    assert empty_repo.get_and_touch_session(token_hash) is not None
    conn = empty_repo._connect()
    try:
        row_recent = conn.execute(
            "SELECT last_active_at FROM user_sessions WHERE id = ?",
            (token_hash,),
        ).fetchone()
        assert row_recent["last_active_at"] == recent_iso

        conn.execute(
            "UPDATE user_sessions SET last_active_at = ? WHERE id = ?",
            (stale_iso, token_hash),
        )
        conn.commit()
    finally:
        conn.close()

    # Activity >= 300s must advance last_active_at
    assert empty_repo.get_and_touch_session(token_hash) is not None
    conn = empty_repo._connect()
    try:
        row_refreshed = conn.execute(
            "SELECT last_active_at FROM user_sessions WHERE id = ?",
            (token_hash,),
        ).fetchone()
        assert row_refreshed["last_active_at"] > stale_iso
    finally:
        conn.close()
