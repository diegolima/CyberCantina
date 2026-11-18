"""Pytest fixtures for isolating configuration, media paths, overrides, and database state."""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from app import config
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_public_showcase_media

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def isolate_settings_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests never read from or write to the repository's cantina_settings.json."""
    test_settings_file = tmp_path / "test_cantina_settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", test_settings_file)


@pytest.fixture(autouse=True)
def isolate_provider_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[None]:
    """Restore global settings, runtime paths, provider probes, and FastAPI overrides on every test."""
    from app.config import AppSettings
    from app.engine.llm_client import llm_client
    from app.providers.probe import probe_service

    defaults = AppSettings()
    for field_name in AppSettings.model_fields:
        if field_name in (
            "db_path",
            "media_dir",
            "actor_profile",
            "clerk_profile",
            "embedding_profile",
            "memory_config",
        ):
            continue
        monkeypatch.setattr(settings, field_name, getattr(defaults, field_name))

    for nested_name in ("actor_profile", "clerk_profile", "embedding_profile", "memory_config"):
        target = getattr(settings, nested_name)
        fresh = getattr(defaults, nested_name)
        for sub_field in type(fresh).model_fields:
            monkeypatch.setattr(target, sub_field, getattr(fresh, sub_field))

    default_media_dir = tmp_path / "media"
    default_media_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "default_test_cantina.db"))
    monkeypatch.setattr(settings, "media_dir", str(default_media_dir))

    llm_client._client = None
    probe_service._client = None
    probe_service._inflight.clear()
    probe_service._cache.clear()
    probe_service._semaphore = None

    try:
        yield
    finally:
        main_mod = sys.modules.get("app.main")
        if main_mod is not None and hasattr(main_mod, "app"):
            main_mod.app.dependency_overrides.clear()


@pytest.fixture
def empty_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    """Provide a cleanly initialized temporary repository without any scenario seed."""
    db_file = str(tmp_path / "test_cantina.db")
    media_dir = str(tmp_path / "media")
    Path(media_dir).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", media_dir)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file, media_dir=media_dir)
    repo.init_db()
    return repo


@pytest.fixture
def no_showcase_seeding(monkeypatch: pytest.MonkeyPatch) -> None:
    """Skip showcase cloning on auth account creation for tests unrelated to starter assets."""
    monkeypatch.setattr(
        "app.routers.auth.seed_showcase_for_user",
        lambda *_args, **_kwargs: {
            "restored_world": False,
            "restored_character": False,
            "skipped_world": False,
            "skipped_character": False,
        },
    )


@pytest.fixture
def api_env(
    empty_repo: CantinaRepository,
) -> tuple[TestClient, CantinaRepository, Path]:
    """Provide an isolated FastAPI TestClient, initialized repository, and media directory."""
    from fastapi.testclient import TestClient

    from app import main as main_module

    return TestClient(main_module.app), empty_repo, Path(empty_repo.media_dir)


@pytest.fixture
def showcase_api_env(
    api_env: tuple[TestClient, CantinaRepository, Path],
) -> tuple[TestClient, CantinaRepository, Path]:
    """Provide an isolated FastAPI TestClient/repository with public showcase media materialized."""
    client, repo, media_dir = api_env
    ensure_public_showcase_media(repo)
    return client, repo, media_dir


@pytest.fixture
def api_user_factory(
    empty_repo: CantinaRepository,
) -> Callable[..., tuple[dict[str, str], str, str]]:
    """Create authenticated users with Bearer tokens directly without Argon2 or showcase seeding."""
    from app.auth import generate_session_token

    def _make_user(
        username: str,
        *,
        role: str = "user",
        display_name: str | None = None,
    ) -> tuple[dict[str, str], str, str]:
        user = empty_repo.create_user(
            username=username,
            display_name=display_name or username,
            password_hash="test_password_hash",
            role=role,
        )
        raw_token, token_hash = generate_session_token()
        empty_repo.create_session(session_id_hash=token_hash, user_id=user.id)
        return {"Authorization": f"Bearer {raw_token}"}, user.id, raw_token

    return _make_user
