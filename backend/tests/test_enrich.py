"""Unit and integration tests for the AI Magic Wand enrichment endpoint."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.llm_client import llm_client


@pytest.fixture()
def enrich_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, CantinaRepository]:
    db_file = str(tmp_path / "test_enrich_cantina.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)

    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)

    client = TestClient(main_module.app)
    return client, repo


def test_enrich_endpoint_requires_auth(enrich_client: tuple[TestClient, CantinaRepository]) -> None:
    client, _repo = enrich_client
    res = client.post(
        "/api/enrich",
        json={
            "field_role": "player_turn_prompt",
            "current_text": "I enter the room",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": "camp_neon_rust_default",
            },
        },
    )
    # Without auth header, should be 401 or setup
    assert res.status_code in (401, 403)


def test_enrich_endpoint_success(
    enrich_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo = enrich_client

    # 1. Login as default user or create token
    from app.auth import generate_session_token
    admin_user = repo.create_user(username="admin_enrich", display_name="Admin Enrich", role="admin")
    repo.claim_unowned_entities(admin_user.id)
    raw_token, token_hash = generate_session_token()
    repo.create_session(session_id_hash=token_hash, user_id=admin_user.id)
    token = raw_token

    # 2. Mock llm_client.complete_text
    mock_complete = AsyncMock(return_value="*I step quietly into the room, scanning the neon shadows.*")
    monkeypatch.setattr(llm_client, "complete_text", mock_complete)

    res = client.post(
        "/api/enrich",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "field_role": "player_turn_prompt",
            "current_text": "I enter the room",
            "instruction": "polish",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": "camp_neon_rust_default",
            },
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["enriched_text"] == "*I step quietly into the room, scanning the neon shadows.*"
    assert data["mode_applied"] == "enriched"
    assert "model_used" in data
