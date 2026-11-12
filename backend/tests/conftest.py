"""Pytest fixtures for isolating configuration and database state during testing."""

from __future__ import annotations

import pytest
from pathlib import Path

from app import config
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed


@pytest.fixture(autouse=True)
def isolate_settings_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests never read from or write to the repository's cantina_settings.json."""
    test_settings_file = tmp_path / "test_cantina_settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", test_settings_file)


@pytest.fixture(autouse=True)
def isolate_provider_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Restore global settings and provider probes to factory defaults on every test."""
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

    llm_client._client = None
    probe_service._client = None
    probe_service._inflight.clear()
    probe_service._cache.clear()
    probe_service._semaphore = None


@pytest.fixture
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    """Provide a cleanly initialized temporary repository with default seeds."""
    db_file = str(tmp_path / "test_cantina.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo
