"""Pytest fixtures for isolating configuration and database state during testing."""

from __future__ import annotations

import pytest
from pathlib import Path

from app import config


@pytest.fixture(autouse=True)
def isolate_settings_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure tests never read from or write to the repository's cantina_settings.json."""
    test_settings_file = tmp_path / "test_cantina_settings.json"
    monkeypatch.setattr(config, "SETTINGS_FILE_PATH", test_settings_file)
