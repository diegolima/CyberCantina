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


def test_enrich_cross_user_isolation(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-1: Enrich must isolate character_field, world_location without world_id, and campaign_turn parent_turn_id."""
    client, repo, _media_dir = api_env
    headers_a, user_a_id, _ = api_user_factory("enrich_owner_a")
    headers_b, user_b_id, _ = api_user_factory("enrich_attacker_b")

    bundle_a = seed_minimal_scenario(
        repo,
        owner_id=user_a_id,
        location_names=("Victim Citadel Secret",),
        character_name="Victim Private Operative",
    )
    # Give victim location a distinct secret description
    victim_loc = bundle_a.locations[0]
    secret_marker = "CLASSIFIED_VAULT_COORDINATES_9942"
    conn = repo._connect()
    try:
        conn.execute(
            "UPDATE location_nodes SET description = ? WHERE id = ?",
            (f"Contains {secret_marker} beneath the reactor.", victim_loc.id),
        )
        conn.commit()
    finally:
        conn.close()
    bundle_b = seed_minimal_scenario(repo, owner_id=user_b_id, character_name="Attacker Char")

    captured_prompts: list[str] = []

    async def _fake_complete_text(messages, **_kwargs):
        captured_prompts.append(str(messages))
        return "Safe enriched response."

    monkeypatch.setattr(llm_client, "complete_text", AsyncMock(side_effect=_fake_complete_text))

    # 1. character_field IDOR targeting User A's character -> 404
    char_res = client.post(
        "/api/enrich",
        headers=headers_b,
        json={
            "field_role": "character_persona",
            "current_text": "Stubborn pilot.",
            "instruction": "polish",
            "context_ref": {
                "scope": "character_field",
                "character_id": bundle_a.character.id,
            },
        },
    )
    assert char_res.status_code == 404

    # 2. world_location with victim's location_id and omitted world_id must NOT inject victim's description
    captured_prompts.clear()
    loc_res = client.post(
        "/api/enrich",
        headers=headers_b,
        json={
            "field_role": "location_description",
            "current_text": "A quiet room.",
            "instruction": "expand",
            "context_ref": {
                "scope": "world_location",
                "location_id": victim_loc.id,
            },
        },
    )
    assert loc_res.status_code == 200
    assert len(captured_prompts) == 1
    assert secret_marker not in captured_prompts[0]
    assert "Victim Citadel Secret" not in captured_prompts[0]

    # 3. campaign_turn passing User B's campaign_id with User A's parent_turn_id -> 404
    assert bundle_a.campaign.active_leaf_turn_id is not None
    turn_res = client.post(
        "/api/enrich",
        headers=headers_b,
        json={
            "field_role": "player_turn_prompt",
            "current_text": "Look around.",
            "instruction": "polish",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": bundle_b.campaign.id,
                "parent_turn_id": bundle_a.campaign.active_leaf_turn_id,
            },
        },
    )
    assert turn_res.status_code == 404
