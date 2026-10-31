"""Tests for SQLite-backed WebAuthn challenges and staged character media ownership."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import auth as auth_module
from app.config import settings
from app.db.repository import STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS, CantinaRepository


@pytest.fixture()
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "ephemeral.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    r = CantinaRepository(db_file)
    r.init_db()
    return r


def _make_user(repo: CantinaRepository) -> str:
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO users (id, username, display_name, role, created_at, updated_at) "
            "VALUES ('u1', 'alice', 'Alice', 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        conn.commit()
    finally:
        conn.close()
    return "u1"


def _pending(challenge_id: str = "chal_x", created: float | None = None) -> auth_module.PendingWebAuthnChallenge:
    import time

    return auth_module.PendingWebAuthnChallenge(
        challenge_id=challenge_id,
        challenge_bytes=b"abc",
        rp_id="localhost",
        origin="http://localhost",
        user_id=None,
        friendly_name="",
        replace_credential_id=None,
        created_at_epoch=created if created is not None else time.time(),
    )


def test_challenge_is_single_use(repo: CantinaRepository) -> None:
    auth_module._store_challenge(_pending())
    first = auth_module._consume_challenge("chal_x")
    assert first is not None and first.challenge_bytes == b"abc"
    # Second consumption (e.g. replay on another worker) must fail
    assert auth_module._consume_challenge("chal_x") is None


def test_expired_challenge_is_rejected(repo: CantinaRepository) -> None:
    import time

    old = time.time() - auth_module.CHALLENGE_TTL_SECONDS - 5
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO webauthn_challenges (challenge_id, challenge_bytes, rp_id, origin, created_at_epoch) "
            "VALUES ('chal_old', x'00', 'localhost', 'http://localhost', ?)",
            (old,),
        )
        conn.commit()
    finally:
        conn.close()
    assert auth_module._consume_challenge("chal_old") is None


def test_challenge_store_failure_is_not_swallowed(
    repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_a: object, **_k: object) -> None:
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(CantinaRepository, "save_webauthn_challenge", boom)
    with pytest.raises(sqlite3.OperationalError):
        auth_module._store_challenge(_pending())


def test_staged_ownership_expires(repo: CantinaRepository) -> None:
    uid = _make_user(repo)
    repo.stage_character_media_ownership(uid, "char_a")
    assert repo.user_can_access_character(uid, "char_a")

    from datetime import datetime, timedelta, timezone

    stale = (
        datetime.now(timezone.utc) - timedelta(seconds=STAGED_CHARACTER_OWNERSHIP_TTL_SECONDS + 60)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = repo._connect()
    try:
        conn.execute("UPDATE staged_character_ownership SET created_at = ?", (stale,))
        conn.commit()
    finally:
        conn.close()
    assert not repo.user_can_access_character(uid, "char_a")

    # Expired rows are pruned on the next staging call
    repo.stage_character_media_ownership(uid, "char_b")
    conn = repo._connect()
    try:
        ids = [r[0] for r in conn.execute("SELECT character_id FROM staged_character_ownership")]
    finally:
        conn.close()
    assert ids == ["char_b"]
