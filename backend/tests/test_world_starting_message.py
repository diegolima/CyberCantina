"""Tests for World Starting Message, Clerk Turn 0 Staging, and Campaign Creation."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.clerk_placement import (
    build_fallback_placement_prose,
    generate_clerk_starting_placement,
)
from app.routers.campaigns import CampaignCreateRequest, create_campaign
from app.schemas.auth import UserProfile
from app.schemas.world import (
    LocationNode,
    LocationNodeDraft,
    WorldGlobalRules,
    WorldRecord,
    WorldUpdatePayload,
    WorldWizardDraft,
)


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_cantina_world_start.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


@pytest.fixture()
def test_user(temp_repo: CantinaRepository) -> UserProfile:
    user = temp_repo.create_user(
        user_id="usr_test_world_start",
        username="adventurer",
        display_name="Adventurer",
        role="user",
    )
    temp_repo.claim_unowned_entities(user.id)
    return user


def test_location_node_starting_message_db_persistence(temp_repo: CantinaRepository, test_user: UserProfile) -> None:
    """Verify that starting_message is persisted and read back from location_nodes SQLite table."""
    draft = WorldWizardDraft(
        name="Sunken Citadel",
        global_rules=WorldGlobalRules(
            genre="Dark Fantasy",
            tone="Grim, foreboding, atmospheric",
            setting_overview="A fortress submerged in black brackish waters.",
            tech_or_magic_rules="Runic sorcery.",
            starting_timestamp="1402-04-10 12:00",
        ),
        locations=[
            LocationNodeDraft(
                key="flooded_vestibule",
                name="Flooded Vestibule",
                summary="The entrance chamber where water laps at crumbling stonework.",
                description="Cold black water rises to mid-calf. Torches sputter in iron sconces.",
                environmental_tags=["water", "torches", "stone"],
                is_starting_location=True,
                is_hub=False,
                starting_message="*Water ripples against your boots as you step into the submerged rotunda. Damp air smells of moss and old iron.*",
            )
        ],
        edges=[],
        lore_nodes=[],
    )
    saved_world = temp_repo.create_world_from_draft(draft, owner_id=test_user.id)
    reloaded_world = temp_repo.get_world(saved_world.id, owner_id=test_user.id)

    assert len(reloaded_world.locations) == 1
    loc = reloaded_world.locations[0]
    assert loc.name == "Flooded Vestibule"
    assert loc.is_starting_location is True
    assert loc.starting_message == "*Water ripples against your boots as you step into the submerged rotunda. Damp air smells of moss and old iron.*"


def test_build_fallback_placement_prose() -> None:
    """Verify deterministic fallback format for staging present characters."""
    char_a = AsyncMock(name="Silas")
    char_a.name = "Silas"
    char_b = AsyncMock(name="Mara")
    char_b.name = "Mara"

    assert build_fallback_placement_prose([]) == ""
    fallback = build_fallback_placement_prose([char_a, char_b])
    assert fallback == "\n\nYou see Silas nearby.\nYou see Mara nearby."


@pytest.mark.asyncio
async def test_generate_clerk_starting_placement_success(temp_repo: CantinaRepository, test_user: UserProfile) -> None:
    """Verify that successful Clerk LLM output is stripped and prefixed with double newline."""
    world = temp_repo.get_world("world_neon_rust", owner_id=None)
    loc = world.locations[0]
    char_1 = temp_repo.get_character("char_kira_vance", owner_id=None)

    mock_llm_client = AsyncMock()
    mock_llm_client.complete_text.return_value = (
        "Kira sits hunched at the scarred copper bar, nursing a half-empty glass of synthetic whiskey."
    )

    profile = ModelProfile(
        provider="ollama",
        model="qwen2.5:7b",
        temperature=0.5,
        max_tokens=256,
    )

    prose = await generate_clerk_starting_placement(
        world=world,
        location=loc,
        participant_characters=[char_1],
        profile=profile,
        llm_client=mock_llm_client,
        timeout_seconds=5.0,
    )

    assert prose == "\n\nKira sits hunched at the scarred copper bar, nursing a half-empty glass of synthetic whiskey."
    mock_llm_client.complete_text.assert_awaited_once()


@pytest.mark.asyncio
async def test_generate_clerk_starting_placement_timeout_fallback(temp_repo: CantinaRepository) -> None:
    """Verify that timeout triggers deterministic fallback without raising an unhandled exception."""
    world = temp_repo.get_world("world_neon_rust", owner_id=None)
    loc = world.locations[0]
    char_1 = temp_repo.get_character("char_kira_vance", owner_id=None)

    async def slow_complete(*args, **kwargs):
        await asyncio.sleep(2.0)
        return "Too late"

    mock_llm_client = AsyncMock()
    mock_llm_client.complete_text.side_effect = slow_complete

    profile = ModelProfile(provider="ollama", model="qwen2.5:7b")

    prose = await generate_clerk_starting_placement(
        world=world,
        location=loc,
        participant_characters=[char_1],
        profile=profile,
        llm_client=mock_llm_client,
        timeout_seconds=0.05,  # Short timeout to trigger fallback quickly
    )

    assert prose == "\n\nYou see Kira Vance nearby."


@pytest.mark.asyncio
async def test_generate_clerk_starting_placement_zero_npcs() -> None:
    """Verify that zero participant NPCs immediately returns empty string with 0 LLM calls."""
    world = AsyncMock()
    loc = AsyncMock()
    profile = ModelProfile(provider="ollama", model="qwen2.5:7b")
    mock_llm = AsyncMock()

    prose = await generate_clerk_starting_placement(
        world=world,
        location=loc,
        participant_characters=[],
        profile=profile,
        llm_client=mock_llm,
    )

    assert prose == ""
    mock_llm.complete_text.assert_not_called()


@pytest.mark.asyncio
async def test_create_campaign_world_focus_flow(temp_repo: CantinaRepository, test_user: UserProfile, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test full create_campaign route with start_focus='world'."""
    monkeypatch.setattr("app.routers.campaigns.get_repo", lambda: temp_repo)

    # Attach starting_message to starting location
    world = temp_repo.get_world("world_neon_rust", owner_id=None)
    start_loc = next(loc for loc in world.locations if loc.is_starting_location)
    start_loc.starting_message = "*Rain drumrolls against the reinforced plexiglass skylight of the dive bar.*"
    updated_world = temp_repo.update_world(
        world.id,
        payload=WorldUpdatePayload(
            name=world.name,
            global_rules=world.global_rules,
            locations=world.locations,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
    )

    char = temp_repo.get_character("char_kira_vance", owner_id=None)

    # Mock the clerk staging call
    with patch("app.routers.campaigns.generate_clerk_starting_placement", new_callable=AsyncMock) as mock_clerk:
        mock_clerk.return_value = "\n\nKira sits in the corner booth with her eyes on the exit."

        bundle = await create_campaign(
            req=CampaignCreateRequest(
                name="Tales from Neon Rust",
                world_id=updated_world.id,
                character_id=char.id,
                character_ids=[char.id],
                start_focus="world",
            ),
            current_user=test_user,
        )

        assert bundle.campaign.name == "Tales from Neon Rust"
        root_turn = bundle.active_branch_turns[0]
        assert root_turn.depth_index == 0
        assert root_turn.actor_id == "__narrator__"
        assert "*Rain drumrolls against the reinforced plexiglass skylight of the dive bar.*" in root_turn.raw_prose
        assert "Kira sits in the corner booth with her eyes on the exit." in root_turn.raw_prose
        # Verify Turn 0 cognition is skipped
        assert root_turn.cognition.skipped is True
        assert root_turn.cognitions == {}
        # But baseline character state is preserved
        assert root_turn.character_state.character_id == char.id
        assert root_turn.character_state.mood_label == char.baseline_psyche.mood_label


@pytest.mark.asyncio
async def test_create_campaign_character_focus_flow(temp_repo: CantinaRepository, test_user: UserProfile, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test create_campaign route with start_focus='character' (preserves character greeting)."""
    monkeypatch.setattr("app.routers.campaigns.get_repo", lambda: temp_repo)
    world = temp_repo.get_world("world_neon_rust", owner_id=None)
    char = temp_repo.get_character("char_kira_vance", owner_id=None)

    bundle = await create_campaign(
        req=CampaignCreateRequest(
            name="Shadows of Vance",
            world_id=world.id,
            character_id=char.id,
            character_ids=[char.id],
            start_focus="character",
            focus_character_id=char.id,
        ),
        current_user=test_user,
    )

    root_turn = bundle.active_branch_turns[0]
    assert root_turn.depth_index == 0
    assert root_turn.actor_id == char.id
    assert root_turn.cognition.skipped is True
