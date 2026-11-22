"""Tests for Turn Bookmarks, Personal Notes retention, Clerk single-turn summarization, and zero-context-injection."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import pytest

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.engine import phase5_clerk as phase5_module
from app.engine.llm_client import llm_client
from app.engine.phase2_context import assemble_four_zone_messages
from app.prompts import (
    ALL_PROMPT_KEYS,
    BUILTIN_PRESETS,
    FACTORY_DEFAULT_PROMPTS,
    PROMPT_KEY_CLERK_BOOKMARK_SUMMARY,
    PROMPTS_METADATA,
)
from app.schemas.character import CognitionBlock
from app.schemas.turn import PreTurnAnalysis
from tests.factories import seed_campaign, seed_character, seed_world


def _seed_turn_tree(
    repo: CantinaRepository,
    owner_id: str,
) -> tuple[str, str, str, str, str]:
    """Create world, char, campaign, Turn #0, Turn #1, and Turn #2."""
    world = seed_world(repo, owner_id=owner_id)
    char = seed_character(repo, owner_id=owner_id, world_id=world.id)
    campaign = seed_campaign(
        repo,
        owner_id=owner_id,
        world_id=world.id,
        character_id=char.id,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    root = bundle.active_branch_turns[0]

    turn1 = repo.save_turn_node(
        turn_id="turn_bm_1",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Ask Kira about the encrypted ledger.",
        actor_id=char.id,
        raw_prose='*Kira glances toward the booth.* "The ledger is hidden beneath the zinc counter."',
        cognition=CognitionBlock(
            recall="Ledger hidden beneath the zinc counter.",
            feeling="Guarded",
            valence=-0.1,
            arousal=0.4,
            want="Keep the ledger safe",
            plan="Test the user's discretion",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="curious",
            subtext_interpretation="Searching for the ledger",
            mentioned_entities=["Kira", "ledger"],
            memory_search_queries=["encrypted ledger"],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_bm_1"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_bm_1"}),
        recalled_items=[],
    )

    turn2 = repo.save_turn_node(
        turn_id="turn_bm_2",
        campaign_id=campaign.id,
        parent_turn_id=turn1.id,
        depth_index=2,
        user_message="Reach behind it and pull the package out.",
        actor_id=char.id,
        raw_prose='*She grabs your wrist before your fingers touch the cold metal.* "Not here. Wait until the shift changes."',
        cognition=CognitionBlock(
            recall="Just revealed the hiding spot.",
            feeling="Alert",
            valence=-0.2,
            arousal=0.6,
            want="Prevent exposure in public",
            plan="Stop the player from drawing attention",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="decisive",
            subtext_interpretation="Retrieving the hidden item immediately",
            mentioned_entities=["package"],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=turn1.world_snapshot.model_copy(update={"turn_id": "turn_bm_2"}),
        character_state=turn1.character_state.model_copy(update={"turn_id": "turn_bm_2"}),
        recalled_items=[],
    )
    return campaign.id, world.id, char.id, root.id, turn1.id, turn2.id


def test_legacy_turn_nodes_migration_adds_bookmark_columns(tmp_path: Path) -> None:
    """Verify init_db cleanly migrates older turn_nodes schemas missing is_bookmarked and user_note."""
    db_file = str(tmp_path / "legacy_bookmarks.db")
    repo = CantinaRepository(db_file)
    repo.init_db()

    conn = repo._connect()
    try:
        conn.execute("ALTER TABLE turn_nodes DROP COLUMN user_note")
        conn.execute("ALTER TABLE turn_nodes DROP COLUMN is_bookmarked")
        conn.commit()
        pre_cols = {r["name"] for r in conn.execute("PRAGMA table_info(turn_nodes)").fetchall()}
        assert "is_bookmarked" not in pre_cols
        assert "user_note" not in pre_cols
    finally:
        conn.close()

    repo.init_db()
    conn = repo._connect()
    try:
        post_cols = {r["name"] for r in conn.execute("PRAGMA table_info(turn_nodes)").fetchall()}
        assert "is_bookmarked" in post_cols
        assert "user_note" in post_cols
    finally:
        conn.close()


def test_bookmark_prompt_registered_in_defaults_presets_and_metadata() -> None:
    """Verify clerk_turn_bookmark_summary_system is registered across defaults, presets, and metadata."""
    assert PROMPT_KEY_CLERK_BOOKMARK_SUMMARY in ALL_PROMPT_KEYS
    assert PROMPT_KEY_CLERK_BOOKMARK_SUMMARY in FACTORY_DEFAULT_PROMPTS
    assert any(m["key"] == PROMPT_KEY_CLERK_BOOKMARK_SUMMARY for m in PROMPTS_METADATA)
    for preset in BUILTIN_PRESETS:
        assert PROMPT_KEY_CLERK_BOOKMARK_SUMMARY in preset["prompts"]


def test_bookmark_api_toggle_note_retention_exclusions_and_isolation(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    """Verify toggle, note editing/retention on un-bookmark, Turn 0 / __arrival__ HTTP 400, and owner isolation."""
    client, repo, _ = api_env
    headers_u1, user_1_id, _ = api_user_factory("bm_user_1")
    headers_u2, _, _ = api_user_factory("bm_user_2")

    camp_id, _world_id, _char_id, root_id, turn1_id, turn2_id = _seed_turn_tree(
        repo, user_1_id
    )

    # Create a map-move __arrival__ turn to verify exclusion
    t2_rec = repo.get_turn_node(turn2_id)
    arrival_turn = repo.save_turn_node(
        turn_id="turn_bm_arrival",
        campaign_id=camp_id,
        parent_turn_id=turn2_id,
        depth_index=3,
        user_message="[Arrived at Cargo Alley]",
        actor_id="__arrival__",
        raw_prose="*You step into the rain-slicked alley.*",
        cognition=CognitionBlock(
            recall="", feeling="Neutral", valence=0.0, arousal=0.2, want="", plan="", skipped=True
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="neutral",
            subtext_interpretation="",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=t2_rec.world_snapshot.model_copy(update={"turn_id": "turn_bm_arrival"}),
        character_state=t2_rec.character_state.model_copy(update={"turn_id": "turn_bm_arrival"}),
        recalled_items=[],
    )

    # 1. Turn #0 and __arrival__ cannot be bookmarked
    res_root = client.patch(
        f"/api/campaigns/{camp_id}/turns/{root_id}/bookmark",
        json={"is_bookmarked": True},
        headers=headers_u1,
    )
    assert res_root.status_code == 400
    assert "Turn #0" in res_root.json()["detail"]

    res_arrival = client.patch(
        f"/api/campaigns/{camp_id}/turns/{arrival_turn.id}/bookmark",
        json={"is_bookmarked": True},
        headers=headers_u1,
    )
    assert res_arrival.status_code == 400
    assert "Map-move" in res_arrival.json()["detail"]

    # 2. Other user receives 404
    res_other = client.patch(
        f"/api/campaigns/{camp_id}/turns/{turn1_id}/bookmark",
        json={"is_bookmarked": True},
        headers=headers_u2,
    )
    assert res_other.status_code == 404

    # 3. Bookmark Turn #1 and attach note
    res_on = client.patch(
        f"/api/campaigns/{camp_id}/turns/{turn1_id}/bookmark",
        json={"is_bookmarked": True, "user_note": "  Ledger is under the zinc counter  "},
        headers=headers_u1,
    )
    assert res_on.status_code == 200
    data_on = res_on.json()
    assert data_on["is_bookmarked"] is True
    assert data_on["user_note"] == "Ledger is under the zinc counter"

    # 4. Un-bookmark omits user_note -> preserves user_note in SQLite
    res_off = client.patch(
        f"/api/campaigns/{camp_id}/turns/{turn1_id}/bookmark",
        json={"is_bookmarked": False},
        headers=headers_u1,
    )
    assert res_off.status_code == 200
    data_off = res_off.json()
    assert data_off["is_bookmarked"] is False
    assert data_off["user_note"] == "Ledger is under the zinc counter"

    # 5. Re-bookmark -> saved note comes right back
    res_re = client.patch(
        f"/api/campaigns/{camp_id}/turns/{turn1_id}/bookmark",
        json={"is_bookmarked": True},
        headers=headers_u1,
    )
    assert res_re.status_code == 200
    assert res_re.json()["is_bookmarked"] is True
    assert res_re.json()["user_note"] == "Ledger is under the zinc counter"

    # 6. Clearing note via null or whitespace resets user_note to None while staying bookmarked
    res_clear = client.patch(
        f"/api/campaigns/{camp_id}/turns/{turn1_id}/bookmark",
        json={"user_note": "   "},
        headers=headers_u1,
    )
    assert res_clear.status_code == 200
    assert res_clear.json()["is_bookmarked"] is True
    assert res_clear.json()["user_note"] is None


def test_delete_last_turn_preserves_bookmarked_sibling_swipe(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    """Deleting an unbookmarked v2 swipe must NOT delete a bookmarked v1 sibling swipe."""
    client, repo, _ = api_env
    headers_u1, user_1_id, _ = api_user_factory("bm_swipe_user")

    world = seed_world(repo, owner_id=user_1_id)
    char = seed_character(repo, owner_id=user_1_id, world_id=world.id)
    campaign = seed_campaign(repo, owner_id=user_1_id, world_id=world.id, character_id=char.id)
    root = repo.get_campaign_state_bundle(campaign.id, owner_id=user_1_id).active_branch_turns[0]

    shared_prompt = "Check the terminal logs."
    t1_v1 = repo.save_turn_node(
        turn_id="turn_sw_v1",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message=shared_prompt,
        actor_id=char.id,
        raw_prose="*Kira pulls up an encrypted manifest.*",
        cognition=root.cognition,
        pre_turn=root.pre_turn,
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_sw_v1"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_sw_v1"}),
        recalled_items=[],
    )
    repo.update_turn_bookmark(
        campaign.id,
        t1_v1.id,
        is_bookmarked=True,
        user_note="Keep this manifest swipe",
        owner_id=user_1_id,
    )

    t1_v2 = repo.save_turn_node(
        turn_id="turn_sw_v2",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message=shared_prompt,
        actor_id=char.id,
        raw_prose="*The terminal spits out a generic error.*",
        cognition=root.cognition,
        pre_turn=root.pre_turn,
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_sw_v2"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_sw_v2"}),
        recalled_items=[],
    )

    res_del = client.delete(
        f"/api/campaigns/{campaign.id}/turns/last",
        headers=headers_u1,
    )
    assert res_del.status_code == 200
    bundle_after = res_del.json()
    remaining_ids = {t["id"] for t in bundle_after["all_turn_nodes"]}
    assert t1_v2.id not in remaining_ids
    assert t1_v1.id in remaining_ids
    surviving_v1 = next(t for t in bundle_after["all_turn_nodes"] if t["id"] == t1_v1.id)
    assert surviving_v1["is_bookmarked"] is True
    assert surviving_v1["user_note"] == "Keep this manifest swipe"


def test_clerk_bookmark_summary_uses_parent_context_prompt_and_sanitization(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify POST bookmark-summary uses Clerk profile, dedicated prompt, parent-turn context, sanitization, and fallback."""
    client, repo, _ = api_env
    headers_u1, user_1_id, _ = api_user_factory("bm_clerk_user")
    camp_id, _world_id, _char_id, root_id, _turn1_id, turn2_id = _seed_turn_tree(
        repo, user_1_id
    )

    # Verify Turn #0 summary rejected with 400
    res_root = client.post(
        f"/api/campaigns/{camp_id}/turns/{root_id}/bookmark-summary",
        headers=headers_u1,
    )
    assert res_root.status_code == 400

    # Configure custom prompt preset on campaign to confirm campaign_id resolution
    custom_preset = repo.create_prompt_preset(
        owner_id=user_1_id,
        name="Custom Bookmark Clerk",
        prompts={
            PROMPT_KEY_CLERK_BOOKMARK_SUMMARY: "CUSTOM_CLERK_BOOKMARK_PROMPT: summarize target turn in 1 sentence."
        },
    )
    conn = repo._connect()
    try:
        conn.execute(
            "UPDATE campaigns SET prompt_preset_id = ? WHERE id = ?",
            (custom_preset.id, camp_id),
        )
        conn.commit()
    finally:
        conn.close()

    captured: dict[str, Any] = {}

    async def fake_complete_text(
        messages: list[dict[str, str]],
        profile: ModelProfile | None = None,
        temperature: float = 0.2,
        max_tokens: int = 120,
    ) -> str:
        captured["messages"] = messages
        captured["profile"] = profile
        captured["temperature"] = temperature
        return (
            '<think>Internal reasoning about the ledger.</think>\n'
            '- "Kira stops the protagonist from <i>grabbing</i> the hidden ledger before shift change."'
        )

    monkeypatch.setattr(llm_client, "complete_text", fake_complete_text)

    res_sum = client.post(
        f"/api/campaigns/{camp_id}/turns/{turn2_id}/bookmark-summary",
        headers=headers_u1,
    )
    assert res_sum.status_code == 200
    assert (
        res_sum.json()["summary"]
        == "Kira stops the protagonist from grabbing the hidden ledger before shift change."
    )
    assert "CUSTOM_CLERK_BOOKMARK_PROMPT" in captured["messages"][0]["content"]
    assert "<previous_turn_context>" in captured["messages"][1]["content"]
    assert "zinc counter" in captured["messages"][1]["content"]
    assert "<target_turn>" in captured["messages"][1]["content"]
    assert "Shift" in captured["messages"][1]["content"] or "shift changes" in captured["messages"][1]["content"]

    # Verify offline fallback when LLM raises
    async def failing_complete_text(*_args: Any, **_kwargs: Any) -> str:
        raise RuntimeError("clerk offline")

    monkeypatch.setattr(llm_client, "complete_text", failing_complete_text)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)

    res_fb = client.post(
        f"/api/campaigns/{camp_id}/turns/{turn2_id}/bookmark-summary",
        headers=headers_u1,
    )
    assert res_fb.status_code == 200
    assert len(res_fb.json()["summary"]) > 0
    assert "grabs your wrist" in res_fb.json()["summary"]


@pytest.mark.asyncio
async def test_bookmark_notes_never_injected_into_llm_context_or_episodic_summaries(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Confirm user_note and is_bookmarked are strictly excluded from Phase 2 Zone 1-4 and Phase 5 episodic compaction."""
    user = empty_repo.create_user(username="ooc_guard_user", display_name="Guard")
    camp_id, world_id, char_id, _root_id, turn1_id, _turn2_id = _seed_turn_tree(
        empty_repo, user.id
    )

    sentinel = "OOC_NEVER_INJECT_SENTINEL_777"
    empty_repo.update_turn_bookmark(
        camp_id,
        turn1_id,
        is_bookmarked=True,
        user_note=sentinel,
        owner_id=user.id,
    )

    bundle = empty_repo.get_campaign_state_bundle(camp_id, owner_id=user.id)
    world = empty_repo.get_world(world_id, owner_id=user.id)
    char = bundle.character_records[char_id]

    msgs = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=[],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=bundle.active_branch_turns[-1].pre_turn,
        user_message="Let us move on.",
    )
    joined_ctx = "\n".join(m["content"] for m in msgs)
    assert sentinel not in joined_ctx

    captured_ep_prompts: list[str] = []

    async def fake_ep_text(messages: list[dict[str, str]], **_kwargs: Any) -> str:
        captured_ep_prompts.extend(m["content"] for m in messages)
        return "They agreed to wait until shift change before retrieving the ledger."

    monkeypatch.setattr(llm_client, "complete_text", fake_ep_text)
    summary = await phase5_module.summarize_turn_chunk(
        bundle.active_branch_turns[1:],
        char,
    )
    assert sentinel not in summary
    assert all(sentinel not in p for p in captured_ep_prompts)
