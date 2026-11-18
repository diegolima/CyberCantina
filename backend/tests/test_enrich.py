"""Unit and integration tests for the AI Magic Wand enrichment endpoint."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from tests.factories import seed_minimal_scenario


@pytest.fixture()
def enrich_client(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> tuple[TestClient, CantinaRepository, dict[str, str], str]:
    client, repo, _media_dir = api_env
    headers, uid, _tok = api_user_factory("admin_enrich", role="admin")
    bundle = seed_minimal_scenario(repo, owner_id=uid)
    return client, repo, headers, bundle.campaign.id


def test_enrich_endpoint_requires_auth(
    enrich_client: tuple[TestClient, CantinaRepository, dict[str, str], str],
) -> None:
    client, _repo, _headers, camp_id = enrich_client
    res = client.post(
        "/api/enrich",
        json={
            "field_role": "player_turn_prompt",
            "current_text": "I enter the room",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": camp_id,
            },
        },
    )
    # Without auth header, should be 401 or setup
    assert res.status_code in (401, 403)


def test_enrich_endpoint_success(
    enrich_client: tuple[TestClient, CantinaRepository, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _repo, headers, camp_id = enrich_client

    # Mock llm_client.complete_text
    mock_complete = AsyncMock(return_value="*I step quietly into the room, scanning the neon shadows.*")
    monkeypatch.setattr(llm_client, "complete_text", mock_complete)

    res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "player_turn_prompt",
            "current_text": "I enter the room",
            "instruction": "polish",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": camp_id,
            },
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["enriched_text"] == "*I step quietly into the room, scanning the neon shadows.*"
    assert data["mode_applied"] == "enriched"
    assert "model_used" in data
