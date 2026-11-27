"""Unit and integration tests for the AI Magic Wand enrichment endpoint."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.routers.enrich import LocationTagsEnrichOutput
from tests.factories import (
    seed_campaign,
    seed_character,
    seed_linear_world,
    seed_minimal_scenario,
    seed_user,
)


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


def test_enrich_tightened_spatial_prompts_tags_and_lore(
    enrich_client: tuple[TestClient, CantinaRepository, dict[str, str], str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify location_description, location_summary, lore_content, and location_tags tightening & sanitization."""
    client, _repo, headers, _camp_id = enrich_client

    calls: list[dict[str, object]] = []

    async def fake_complete_text(messages, *, temperature=0.7, max_tokens=300, **_kwargs):
        calls.append({"messages": messages, "temperature": temperature, "max_tokens": max_tokens})
        return '"A corroded hatch sits at the end of a service alley.\n\nOil slicks pool beneath peeling paint."'

    monkeypatch.setattr(llm_client, "complete_text", fake_complete_text)

    # 1. location_description enforces 2-3 sentence static prompt, parent_container_name, thinking-safe max_tokens, and single-paragraph cleanup
    desc_res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_description",
            "current_text": "",
            "max_words": 55,
            "context_ref": {
                "scope": "world_location",
                "world_name": "Lower Wards",
                "genre": "Biopunk Noir",
                "tone": "Gritty",
                "parent_container_name": "The Neon Rust",
                "location_name": "Service Hatch",
                "location_summary": "A corroded alley hatch.",
            },
        },
    )
    assert desc_res.status_code == 200, desc_res.text
    assert desc_res.json()["enriched_text"] == (
        "A corroded hatch sits at the end of a service alley. Oil slicks pool beneath peeling paint."
    )
    sys_prompt = calls[-1]["messages"][0]["content"]
    usr_prompt = calls[-1]["messages"][1]["content"]
    assert "2-3 sentences" in sys_prompt
    assert "Do NOT include characters, spoken dialogue" in sys_prompt
    assert "Parent area / landmark: The Neon Rust" in usr_prompt
    assert "scene context" not in usr_prompt.lower()
    assert calls[-1]["max_tokens"] >= 320
    assert calls[-1]["temperature"] == 0.55

    # 2. location_summary enforces 1-sentence exit preview and floors max_tokens for thinking models
    sum_res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_summary",
            "current_text": "",
            "single_line": True,
            "max_words": 20,
            "context_ref": {
                "scope": "world_location",
                "world_name": "Lower Wards",
                "genre": "High Fantasy",
                "tone": "Earthy",
                "location_name": "Stone Well",
            },
        },
    )
    assert sum_res.status_code == 200, sum_res.text
    sum_sys = calls[-1]["messages"][0]["content"]
    assert "single concise sentence" in sum_sys
    assert calls[-1]["max_tokens"] >= 320

    # 3. lore_content injects lore metadata for both location & macro world scope
    lore_res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "lore_content",
            "current_text": "",
            "max_words": 80,
            "context_ref": {
                "scope": "world_location",
                "world_name": "Sunspire",
                "genre": "Bronze Age Myth",
                "tone": "Solemn",
                "lore_title": "The Salt Pact",
                "lore_category": "history",
                "lore_tags": ["salt", "treaty"],
            },
        },
    )
    assert lore_res.status_code == 200, lore_res.text
    lore_usr = calls[-1]["messages"][1]["content"]
    assert "Lore title: The Salt Pact" in lore_usr
    assert "Lore category: history" in lore_usr
    assert "Trigger keywords: salt, treaty" in lore_usr

    # 4. location_tags removes cyberpunk examples, deduplicates existing tags, and caps at 6 concise tags
    tag_calls: list[list[dict[str, str]]] = []

    async def fake_tags(messages, *, schema_cls=None, **_kwargs):
        tag_calls.append(messages)
        return LocationTagsEnrichOutput(
            tags=[
                "Damp Moss",
                "damp moss",
                "Iron Grate",
                "This is an overly long sentence masquerading as a tag",
                "Oil Sheen",
                "Distant Drip",
                "Salt Crust",
                "Cold Draft",
                "Seventh Tag Ignored",
            ]
        )

    monkeypatch.setattr(llm_client, "complete_structured", fake_tags)
    tags_res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_tags",
            "current_text": "Damp Moss",
            "context_ref": {
                "scope": "world_location",
                "world_name": "Lower Wards",
                "genre": "Low Fantasy",
                "tone": "Grounded",
                "location_name": "Cistern Gate",
                "existing_tags": ["Damp Moss"],
            },
        },
    )
    assert tags_res.status_code == 200, tags_res.text
    assert tags_res.json()["enriched_text"] == (
        "Damp Moss, Iron Grate, Oil Sheen, Distant Drip, Salt Crust, Cold Draft"
    )
    tag_sys = tag_calls[-1][0]["content"]
    tag_usr = tag_calls[-1][1]["content"]
    assert "Flickering Neon" not in tag_sys
    assert "Existing environmental tags:" not in tag_usr
    assert "=== EXISTING TAGS ===" in tag_usr


def test_enrich_player_turn_resolves_copresent_npcs_and_solo_rooms(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify player_turn_prompt resolves co-present NPCs at target_loc_id and handles solo rooms cleanly."""
    client, repo, _media_dir = api_env
    headers, uid, _ = api_user_factory("enrich_copresence")
    _ = seed_user  # ensure factory import stays clean
    world, locs = seed_linear_world(
        repo,
        owner_id=uid,
        names=("Atrium", "Medbay", "Empty Roof"),
    )
    loc_atrium, loc_medbay, loc_roof = locs
    npc_lead = seed_character(repo, owner_id=uid, world_id=world.id, name="Lead Ranger")
    npc_medic = seed_character(repo, owner_id=uid, world_id=world.id, name="Dr. Sato")
    campaign = seed_campaign(
        repo,
        owner_id=uid,
        world_id=world.id,
        character_id=npc_lead.id,
        character_ids=[npc_lead.id, npc_medic.id],
    )
    # Move Dr. Sato to Medbay while Lead Ranger remains in Atrium
    repo.override_character_location(campaign.id, npc_medic.id, loc_medbay.id, owner_id=uid)

    captured: list[list[dict[str, str]]] = []

    async def fake_complete(messages, **_kwargs):
        captured.append(messages)
        return '*I step inside.* "Anything left on the shelf?"'

    monkeypatch.setattr(llm_client, "complete_text", fake_complete)

    # Override to Medbay: only Dr. Sato is present, NOT Lead Ranger
    res_med = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "player_turn_prompt",
            "current_text": "I ask Sato about the sample.",
            "instruction": "auto",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": campaign.id,
                "override_location_id": loc_medbay.id,
            },
        },
    )
    assert res_med.status_code == 200, res_med.text
    med_sys = captured[-1][0]["content"]
    med_usr = captured[-1][1]["content"]
    assert "Dr. Sato" in med_sys
    assert "Lead Ranger" not in med_sys
    assert "Dr. Sato" in med_usr
    assert "Lead Ranger" not in med_usr
    assert "Preserve the player's exact intent" in med_sys
    assert "Refine clarity, grounding, and style" in med_usr

    # Override to Empty Roof: zero NPCs present
    res_solo = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "player_turn_prompt",
            "current_text": "",
            "context_ref": {
                "scope": "campaign_turn",
                "campaign_id": campaign.id,
                "override_location_id": loc_roof.id,
            },
        },
    )
    assert res_solo.status_code == 200, res_solo.text
    solo_sys = captured[-1][0]["content"]
    solo_usr = captured[-1][1]["content"]
    assert "player is alone here" in solo_sys
    assert "None (the player is alone at this location)" in solo_usr
    assert "Lead Ranger" not in solo_usr
    assert "Dr. Sato" not in solo_usr
    assert loc_atrium.id != loc_roof.id
