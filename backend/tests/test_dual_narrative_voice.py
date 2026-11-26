"""Tests for Dual Narrative Voice (1st-Person In-Character & 3rd-Person Storyteller)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.context.assembler import assemble_four_zone_messages
from app.engine.context.zone1_static import (
    build_zone1_ensemble_system_prompt,
    build_zone1_storyteller_system_prompt,
)
from app.prompts import (
    ALL_PROMPT_KEYS,
    BUILTIN_PRESETS,
    FACTORY_DEFAULT_PROMPTS,
    PROMPT_KEY_ACTOR_STORYTELLER_ZONE1,
    PROMPT_KEY_ACTOR_ZONE1,
    PROMPTS_METADATA,
)
from app.schemas.character import CognitionBlock
from app.schemas.turn import PreTurnAnalysis
from app.schemas.world import LocationNodeDraft
from tests.factories import seed_character, seed_linear_world, seed_user, seed_world


def test_storyteller_prompt_key_and_presets_configured() -> None:
    """Verify actor_zone1_storyteller_system is registered across all presets and metadata."""
    assert PROMPT_KEY_ACTOR_STORYTELLER_ZONE1 in ALL_PROMPT_KEYS
    assert PROMPT_KEY_ACTOR_STORYTELLER_ZONE1 in FACTORY_DEFAULT_PROMPTS
    meta = next(
        (m for m in PROMPTS_METADATA if m["key"] == PROMPT_KEY_ACTOR_STORYTELLER_ZONE1),
        None,
    )
    assert meta is not None
    assert meta["required_tags"] == []

    for preset in BUILTIN_PRESETS:
        prompts = preset["prompts"]
        assert PROMPT_KEY_ACTOR_STORYTELLER_ZONE1 in prompts
        assert PROMPT_KEY_ACTOR_ZONE1 in prompts
        assert '2nd person ("you")' in prompts[PROMPT_KEY_ACTOR_ZONE1]
        assert '2nd person ("you")' in prompts[PROMPT_KEY_ACTOR_STORYTELLER_ZONE1]

    default_st = FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_STORYTELLER_ZONE1]
    assert "=== AFFECTIVE MASKING & COMPOSURE DIRECTIVE ===" in default_st
    assert "=== HIGH-INTENSITY & INTIMATE INTERACTION DIRECTIVE ===" in default_st
    assert "=== PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY ===" in default_st
    assert "<world_clock>" in default_st


def test_campaign_creation_narrative_voice_defaults_and_immutability(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    """Verify default resolution on launch, manual override, and post-launch immutability."""
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("voice_user", role="admin")
    client.headers.update(headers)

    world = seed_world(
        repo,
        owner_id=user_id,
        locations=[
            LocationNodeDraft(
                key="hub",
                name="Hub Room",
                summary="Quiet hub.",
                description="Reinforced steel table.",
                is_starting_location=True,
                is_hub=True,
                starting_message="Rain taps the glass.",
            )
        ],
    )
    c1 = seed_character(repo, world_id=world.id, owner_id=user_id, name="Kira")
    c2 = seed_character(repo, world_id=world.id, owner_id=user_id, name="Vex")

    # 1. 1 character + character focus -> first_person
    r1 = client.post(
        "/api/campaigns",
        json={
            "name": "Solo Char Start",
            "world_id": world.id,
            "character_id": c1.id,
            "character_ids": [c1.id],
            "start_focus": "character",
        },
    )
    assert r1.status_code == 200
    assert r1.json()["campaign"]["world_settings"]["narrative_voice"] == "first_person"

    # 2. 1 character + world focus -> storyteller
    r2 = client.post(
        "/api/campaigns",
        json={
            "name": "Solo World Start",
            "world_id": world.id,
            "character_id": c1.id,
            "character_ids": [c1.id],
            "start_focus": "world",
        },
    )
    assert r2.status_code == 200
    assert r2.json()["campaign"]["world_settings"]["narrative_voice"] == "storyteller"

    # 3. 2 characters + character focus -> storyteller
    r3 = client.post(
        "/api/campaigns",
        json={
            "name": "Multi Char Start",
            "world_id": world.id,
            "character_id": c1.id,
            "character_ids": [c1.id, c2.id],
            "start_focus": "character",
        },
    )
    assert r3.status_code == 200
    camp3_id = r3.json()["campaign"]["id"]
    assert r3.json()["campaign"]["world_settings"]["narrative_voice"] == "storyteller"

    # 4. Explicit override on 2 characters + character focus -> first_person
    r4 = client.post(
        "/api/campaigns",
        json={
            "name": "Forced 1st Person Multi",
            "world_id": world.id,
            "character_id": c1.id,
            "character_ids": [c1.id, c2.id],
            "start_focus": "character",
            "narrative_voice": "first_person",
        },
    )
    assert r4.status_code == 200
    assert r4.json()["campaign"]["world_settings"]["narrative_voice"] == "first_person"

    # 5. Patching world settings never mutates or clears narrative_voice
    patch_res = client.patch(
        f"/api/campaigns/{camp3_id}/world-settings",
        json={
            "describe_on_first_visit": False,
            "unlock_lore": True,
            "narrative_voice": "first_person",
        },
    )
    assert patch_res.status_code == 200
    patched_ws = patch_res.json()["campaign"]["world_settings"]
    assert patched_ws["describe_on_first_visit"] is False
    assert patched_ws["unlock_lore"] is True
    assert patched_ws["narrative_voice"] == "storyteller"


def test_legacy_campaign_narrative_voice_inference(tmp_path: Path) -> None:
    """Legacy campaigns lacking narrative_voice in world_settings_json infer accurately."""
    repo = CantinaRepository(str(tmp_path / "legacy_voice.db"))
    repo.init_db()
    user = seed_user(repo)
    world = seed_world(
        repo,
        owner_id=user.id,
        locations=[
            LocationNodeDraft(
                key="hub",
                name="Hub Room",
                summary="Quiet hub.",
                description="Reinforced steel table.",
                is_starting_location=True,
                is_hub=True,
                starting_message="Rain taps the glass.",
            )
        ],
    )
    c1 = seed_character(repo, world_id=world.id, owner_id=user.id, name="Kira")
    c2 = seed_character(repo, world_id=world.id, owner_id=user.id, name="Vex")

    camp_1v1 = repo.create_campaign(
        name="Legacy 1v1",
        world_id=world.id,
        character_id=c1.id,
        character_ids=[c1.id],
        start_focus="character",
        owner_id=user.id,
    )
    camp_multi = repo.create_campaign(
        name="Legacy Multi",
        world_id=world.id,
        character_id=c1.id,
        character_ids=[c1.id, c2.id],
        start_focus="character",
        owner_id=user.id,
    )
    camp_world = repo.create_campaign(
        name="Legacy World",
        world_id=world.id,
        character_id=c1.id,
        character_ids=[c1.id],
        actor_id="__narrator__",
        start_focus="world",
        owner_id=user.id,
    )

    # Strip narrative_voice from world_settings_json to simulate legacy DB rows
    conn = repo._connect()
    try:
        for cid in (camp_1v1.id, camp_multi.id, camp_world.id):
            conn.execute(
                "UPDATE campaigns SET world_settings_json = ? WHERE id = ?",
                (json.dumps({"describe_on_first_visit": True}), cid),
            )
        conn.commit()
    finally:
        conn.close()

    assert repo.get_campaign(camp_1v1.id).world_settings.narrative_voice == "first_person"
    assert repo.get_campaign(camp_multi.id).world_settings.narrative_voice == "storyteller"
    assert repo.get_campaign(camp_world.id).world_settings.narrative_voice == "storyteller"


def test_zone1_and_zone4_prompt_routing_by_narrative_voice(tmp_path: Path) -> None:
    """Verify Storyteller (1 or N NPCs) and 1st-person multi-NPC anchoring."""
    repo = CantinaRepository(str(tmp_path / "zone_routing.db"))
    repo.init_db()
    user = seed_user(repo)
    world, locs = seed_linear_world(repo, owner_id=user.id)
    kira = seed_character(repo, world_id=world.id, owner_id=user.id, name="Kira")
    vex = seed_character(repo, world_id=world.id, owner_id=user.id, name="Vex")

    camp = repo.create_campaign(
        name="Voice Routing",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, vex.id],
        owner_id=user.id,
        narrative_voice="storyteller",
    )
    bundle = repo.get_campaign_state_bundle(camp.id, owner_id=user.id)

    # Storyteller with 1 NPC still uses Storyteller prompt (not 1st-person "roleplaying as")
    msgs_st_single = assemble_four_zone_messages(
        world=world,
        character=kira,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=[],
        active_location=locs[0],
        neighbors=[],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(active_speaker_id=kira.id, speaker_order=[kira.id]),
        user_message="Hello Kira.",
        present_characters=[kira],
        narrative_voice="storyteller",
        established_cognition=CognitionBlock(
            recall="Saw you enter.",
            feeling="Measured",
            valence=0.1,
            arousal=0.3,
            want="Assess your intent",
            plan="- Nod slowly",
        ),
    )
    assert "third-person narrative Storyteller" in msgs_st_single[0]["content"]
    assert "You are roleplaying as" not in msgs_st_single[0]["content"]
    assert "3rd-person Storyteller prose" in msgs_st_single[-1]["content"]

    # Storyteller canonical sorting matches ensemble helper
    assert build_zone1_storyteller_system_prompt(world, [kira, vex]) == build_zone1_ensemble_system_prompt(world, [vex, kira])

    # 1st-person multi-NPC anchors to focus character and forbids telepathy
    msgs_fp_multi = assemble_four_zone_messages(
        world=world,
        character=kira,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=[],
        active_location=locs[0],
        neighbors=[],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(active_speaker_id=vex.id, speaker_order=[vex.id, kira.id]),
        user_message="Vex, what do you think?",
        present_characters=[kira, vex],
        narrative_voice="first_person",
        established_cognitions={
            kira.id: CognitionBlock(
                recall="Vex is tense.",
                feeling="Alert",
                valence=0.0,
                arousal=0.4,
                want="Watch Vex's reaction",
                plan="- Keep silent",
            ),
            vex.id: CognitionBlock(
                recall="Player asked me directly.",
                feeling="Guarded",
                valence=-0.1,
                arousal=0.5,
                want="Deflect",
                plan="- Cross arms and answer sharply",
            ),
        },
    )
    z1_fp = msgs_fp_multi[0]["content"]
    assert f"You are roleplaying as {kira.name}" in z1_fp
    assert "CO-PRESENT CHARACTERS & 1ST-PERSON POV ANCHOR" in z1_fp
    assert f"=== CHARACTER: {vex.name}" in z1_fp
    assert "Write strictly from Kira's 1st-person" in msgs_fp_multi[-1]["content"]
    assert "observable outward behavior" in msgs_fp_multi[-1]["content"]


def test_first_person_multi_npc_anchoring_and_absent_fallback_streaming(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify turn streaming anchors actor_id in 1st-person rooms and falls back to Storyteller when focus char is absent."""
    client, repo, _ = api_env
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    headers, user_id, _ = api_user_factory("stream_voice_user", role="admin")
    client.headers.update(headers)

    world, locs = seed_linear_world(repo, owner_id=user_id)
    kira = seed_character(repo, world_id=world.id, owner_id=user_id, name="Kira")
    vex = seed_character(repo, world_id=world.id, owner_id=user_id, name="Vex")

    # Force first_person campaign with Kira as focus character and Vex also present in loc[0]
    camp_res = client.post(
        "/api/campaigns",
        json={
            "name": "Anchored 1st Person",
            "world_id": world.id,
            "character_id": kira.id,
            "character_ids": [kira.id, vex.id],
            "start_focus": "character",
            "narrative_voice": "first_person",
        },
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]

    # Force Phase 1 to nominate Vex as active_speaker_id while Kira is present
    from app.routers import campaigns as campaigns_facade

    captured_prompts: list[str] = []
    orig_assemble = None

    import app.routers.campaign_routes.turn_streaming as ts_mod

    orig_assemble = ts_mod.assemble_four_zone_messages

    def _spy_assemble(*args, **kwargs):
        msgs = orig_assemble(*args, **kwargs)
        captured_prompts.append(msgs[0]["content"])
        return msgs

    monkeypatch.setattr(ts_mod, "assemble_four_zone_messages", _spy_assemble)

    async def _fake_phase1(*args, **kwargs):
        present = kwargs.get("present_characters") or []
        speaker = vex.id if any(c.id == vex.id for c in present) else (present[0].id if present else "__solo__")
        return PreTurnAnalysis(
            user_sentiment="direct",
            subtext_interpretation="addressing vex",
            active_speaker_id=speaker,
            speaker_order=[speaker],
        )

    monkeypatch.setattr(campaigns_facade, "run_phase1_pre_analysis", _fake_phase1)

    with client.stream(
        "POST",
        f"/api/campaigns/{camp_id}/turns/stream",
        json={"user_message": "Vex, hand me that keycard."},
    ) as resp:
        assert resp.status_code == 200
        _ = resp.read()

    bundle_after_t1 = repo.get_campaign_state_bundle(camp_id, owner_id=user_id)
    turn1 = bundle_after_t1.active_branch_turns[-1]
    assert turn1.actor_id == vex.id
    assert f"You are roleplaying as {kira.name}" in captured_prompts[-1]
    assert "CO-PRESENT CHARACTERS & 1ST-PERSON POV ANCHOR" in captured_prompts[-1]

    # Move Vex + player to locs[1] while leaving Kira behind in locs[0]
    move_vex = client.post(
        f"/api/campaigns/{camp_id}/characters/{vex.id}/location-override",
        json={"location_id": locs[1].id},
    )
    assert move_vex.status_code == 200
    move_player = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        json={"location_id": locs[1].id, "move_mode": "alone"},
    )
    assert move_player.status_code == 200

    with client.stream(
        "POST",
        f"/api/campaigns/{camp_id}/turns/stream",
        json={"user_message": "Just us here now, Vex."},
    ) as resp:
        assert resp.status_code == 200
        _ = resp.read()

    bundle_after_t2 = repo.get_campaign_state_bundle(camp_id, owner_id=user_id)
    turn2 = bundle_after_t2.active_branch_turns[-1]
    assert turn2.actor_id == vex.id
    assert "third-person narrative Storyteller" in captured_prompts[-1]
    assert f"=== CHARACTER: {vex.name}" in captured_prompts[-1]
