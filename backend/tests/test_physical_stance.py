"""Comprehensive tests for v0.41.0 Physical Stance & Motion Continuity Tracking."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from fastapi.testclient import TestClient
import pytest

import app.main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine.char_agent import agent as char_agent_module
from app.engine.clerk import pipeline as clerk_pipeline_module
from app.engine.cognition import runner as cognition_runner_module
from app.engine.context.zone1_static import (
    build_zone1_ensemble_system_prompt,
    build_zone1_static_system_prompt,
)
from app.engine.context.zone4_ephemeral import build_zone4_ephemeral_tail_frame
from app.engine.gm_talk import _compute_branch_visibility, _serialize_pinned_mention
from app.engine.gm_tools import execute_gm_tool
from app.engine.llm_client import LlmToolCall, llm_client
from app.routers import import_export as import_export_router
from app.routers.campaign_routes import crud_and_state as campaign_crud_router
from app.schemas.character import CognitionBlock
from app.schemas.gm import GmMentionRef
from app.schemas.persona import PersonaCreatePayload, PersonaItemInstance, PersonaTurnStateSnapshot
from app.schemas.physical import (
    MAX_PHYSICAL_CONTEXT_LENGTH,
    PHYSICAL_STANCE_VALUES,
    format_physical_state_prompt_value,
    normalize_physical_stance,
    resolve_post_turn_physical_state,
    sanitize_physical_context,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    PreTurnAnalysis,
    WorldPostTurnDelta,
)
from app.schemas.world import LocationEdgeDraft, LocationNodeDraft
from tests.factories import seed_campaign, seed_character, seed_user, seed_world


def _authed_client(
    repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
    user_id: str,
) -> TestClient:
    profile = repo.get_user_by_id(user_id)
    monkeypatch.setattr(main_module, "get_repo", lambda: repo)
    monkeypatch.setattr(import_export_router, "get_repo", lambda: repo)
    monkeypatch.setattr(campaign_crud_router, "get_repo", lambda: repo)
    main_module.app.dependency_overrides[get_current_user] = lambda: profile
    return TestClient(main_module.app)


def test_normalize_physical_stance_and_sanitize_context() -> None:
    for val in PHYSICAL_STANCE_VALUES:
        assert normalize_physical_stance(val) == val

    assert normalize_physical_stance("PRONE") == "lying_down"
    assert normalize_physical_stance("supine") == "lying_down"
    assert normalize_physical_stance("Seated") == "sitting"
    assert normalize_physical_stance("walking") == "moving"
    assert normalize_physical_stance("handcuffed") == "restrained"
    assert normalize_physical_stance("knocked out") == "incapacitated"
    assert normalize_physical_stance("on-feet") == "standing"
    assert normalize_physical_stance("garbage_value", fallback="standing") == "standing"
    assert normalize_physical_stance(None) == "unspecified"

    # CoT + strict HTML tag stripping preserves '< 30' math operators and collapses whitespace
    raw_ctx = (
        "<think>internal note</think> <i>on stomach</i> behind crate, "
        "distance < 30 cm\nwith pistol drawn"
    )
    cleaned = sanitize_physical_context(raw_ctx)
    assert "<think>" not in cleaned
    assert "<i>" not in cleaned
    assert "on stomach behind crate, distance < 30 cm with pistol drawn" == cleaned

    # Length cap truncates cleanly on word boundaries
    long_ctx = " ".join(["crouched"] * 30)
    capped = sanitize_physical_context(long_ctx)
    assert len(capped) <= MAX_PHYSICAL_CONTEXT_LENGTH
    assert not capped.endswith(" ")


def test_resolve_post_turn_physical_state_smart_staleness_and_exceptions() -> None:
    # 1. Location changed & Clerk left stance/context verbatim unchanged -> standing + ""
    s, c, reason = resolve_post_turn_physical_state(
        "sitting",
        "in corner booth",
        "sitting",
        "In Corner Booth",
        location_changed=True,
        time_elapsed_minutes=5,
    )
    assert (s, c, reason) == ("standing", "", "location_changed")

    # 2. Location changed & Clerk explicitly captured arrival pose -> keep Clerk's pose
    s, c, reason = resolve_post_turn_physical_state(
        "sitting",
        "in corner booth",
        "leaning",
        "against the alley wall",
        location_changed=True,
        time_elapsed_minutes=5,
    )
    assert (s, c, reason) == ("leaning", "against the alley wall", None)

    # 3. Time skip >= 30 min & verbatim unchanged -> unspecified + ""
    s, c, reason = resolve_post_turn_physical_state(
        "kneeling",
        "by the fire",
        "kneeling",
        "by the fire",
        location_changed=False,
        time_elapsed_minutes=30,
    )
    assert (s, c, reason) == ("unspecified", "", "time_skip")

    # 4. Short turn (< 30 min) in same room -> preserved
    s, c, reason = resolve_post_turn_physical_state(
        "lying_down",
        "on stomach under table",
        "lying_down",
        "on stomach under table",
        location_changed=False,
        time_elapsed_minutes=12,
    )
    assert (s, c, reason) == ("lying_down", "on stomach under table", None)

    # 5. Restrained / incapacitated preserved across location change (clears room micro-context) & time skips
    s, c, reason = resolve_post_turn_physical_state(
        "restrained",
        "zip-tied to steel chair",
        "restrained",
        "zip-tied to steel chair",
        location_changed=True,
        time_elapsed_minutes=10,
    )
    assert (s, c, reason) == ("restrained", "", "location_changed")

    s, c, reason = resolve_post_turn_physical_state(
        "incapacitated",
        "unconscious on cot",
        "incapacitated",
        "unconscious on cot",
        location_changed=False,
        time_elapsed_minutes=120,
    )
    assert (s, c, reason) == ("incapacitated", "unconscious on cot", None)


def test_required_json_schema_properties_for_clerks() -> None:
    world_req = set(WorldPostTurnDelta.model_json_schema().get("required", []))
    assert "player_physical_stance" in world_req
    assert "player_physical_context" in world_req

    char_req = set(CharacterAgentDelta.model_json_schema().get("required", []))
    assert "physical_stance" in char_req
    assert "physical_context" in char_req


def test_zone1_habitual_bearing_and_zone4_injection_silent_omission_and_solo(
    empty_repo: CantinaRepository,
) -> None:
    user = seed_user(empty_repo)
    world = seed_world(empty_repo, owner_id=user.id)
    kira = seed_character(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        name="Kira Vance",
    ).model_copy(update={"posture": "Coiled, alert military bearing"})
    viktor = seed_character(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        name="Viktor Kroll",
    ).model_copy(update={"posture": "Broad, immovable stance"})
    camp = seed_campaign(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
    )
    bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)

    # Zone 1 relabels static posture to Habitual Bearing (single + ensemble)
    z1_single = build_zone1_static_system_prompt(world, kira)
    assert "- Habitual Bearing: Coiled, alert military bearing" in z1_single
    assert "- Posture:" not in z1_single

    z1_ens = build_zone1_ensemble_system_prompt(world, [kira, viktor])
    assert "Habitual Bearing: Coiled, alert military bearing" in z1_ens
    assert "Habitual Bearing: Broad, immovable stance" in z1_ens

    # Unestablished physical states are silently omitted in Zone 4
    pre_turn = PreTurnAnalysis(active_speaker_id=kira.id, speaker_order=[kira.id])
    unestablished_z4 = build_zone4_ephemeral_tail_frame(
        user_message="Hey Kira.",
        character=kira,
        world_snapshot=bundle.current_world_snapshot,
        character_state=bundle.character_states[kira.id],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=pre_turn,
        present_characters=[kira, viktor],
        all_character_states=bundle.character_states,
        persona_snapshot=None,
        current_player_state=PersonaTurnStateSnapshot(
            turn_id=bundle.current_world_snapshot.turn_id,
            physical_stance="unspecified",
            physical_context="",
        ),
    )
    assert "Starting Physical State:" not in unestablished_z4
    assert "<player_physical_state" not in unestablished_z4

    # Established states inject into Zone 4 for speaker, co-present NPC, and persona-less Player
    est_kira = bundle.character_states[kira.id].model_copy(
        update={
            "physical_stance": "lying_down",
            "physical_context": "on stomach behind steel bar",
        }
    )
    est_viktor = bundle.character_states[viktor.id].model_copy(
        update={
            "physical_stance": "crouching",
            "physical_context": "beside cargo crate",
        }
    )
    est_z4 = build_zone4_ephemeral_tail_frame(
        user_message="Cover me!",
        character=kira,
        world_snapshot=bundle.current_world_snapshot,
        character_state=est_kira,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=pre_turn,
        present_characters=[kira, viktor],
        all_character_states={kira.id: est_kira, viktor.id: est_viktor},
        persona_snapshot=None,
        current_player_state=PersonaTurnStateSnapshot(
            turn_id=bundle.current_world_snapshot.turn_id,
            physical_stance="kneeling",
            physical_context="behind overturned booth",
        ),
    )
    assert "Starting Physical State: [lying_down] on stomach behind steel bar" in est_z4
    assert "Starting Physical State: [crouching] beside cargo crate" in est_z4
    assert '<player_physical_state player="Player">' in est_z4
    assert "Starting Physical State: [kneeling] behind overturned booth" in est_z4
    assert "Physical Continuity:" in est_z4

    # Solo empty room with persona-less player physical state
    solo_z4 = build_zone4_ephemeral_tail_frame(
        user_message="I peer over the crate.",
        character=kira,
        world_snapshot=bundle.current_world_snapshot,
        character_state=est_kira,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=pre_turn,
        present_characters=[],
        all_character_states={},
        is_solo=True,
        persona_snapshot=None,
        current_player_state=PersonaTurnStateSnapshot(
            turn_id=bundle.current_world_snapshot.turn_id,
            physical_stance="crouching",
            physical_context="behind supply crate",
        ),
    )
    assert '<player_physical_state player="Player">' in solo_z4
    assert "Starting Physical State: [crouching] behind supply crate" in solo_z4
    assert "Treat any Starting Physical State below" in solo_z4


async def test_phase3_cognition_receives_starting_physical_states(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(empty_repo)
    world = seed_world(empty_repo, owner_id=user.id)
    kira = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Kira Vance")
    viktor = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Viktor Kroll")
    camp = seed_campaign(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
    )
    bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)

    captured_prompts: list[str] = []

    async def fake_complete_structured(messages: list[dict[str, str]], *_args: Any, **_kwargs: Any) -> CognitionBlock:
        captured_prompts.append(messages[-1]["content"])
        return CognitionBlock(
            recall="- Lying on stomach.",
            feeling="Tense alertness",
            feeling_tone="guarded",
            feeling_intensity="moderate",
            feeling_agency="steady",
            want="Get upright safely.",
            plan="- Push off the floor and rise behind cover.",
        )

    monkeypatch.setattr(cognition_runner_module.llm_client, "complete_structured", fake_complete_structured)

    kira_state = bundle.character_states[kira.id].model_copy(
        update={"physical_stance": "lying_down", "physical_context": "on stomach by door"}
    )
    viktor_state = bundle.character_states[viktor.id].model_copy(
        update={"physical_stance": "restrained", "physical_context": "cuffed to pipe"}
    )
    player_state = PersonaTurnStateSnapshot(
        turn_id=bundle.current_world_snapshot.turn_id,
        physical_stance="crouching",
        physical_context="behind bar counter",
    )

    await cognition_runner_module.run_character_cognition_agent(
        user_message="Stay low!",
        character=kira,
        world=world,
        role="primary_speaker",
        previous_state=kira_state,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        shared_scene_items=[],
        character_recalled_items=[],
        pre_turn=PreTurnAnalysis(active_speaker_id=kira.id, speaker_order=[kira.id]),
        co_present_characters=[viktor],
        all_character_states={kira.id: kira_state, viktor.id: viktor_state},
        current_player_state=player_state,
        known_persona=None,
    )
    assert len(captured_prompts) == 1
    prompt = captured_prompts[0]
    assert "Starting Physical State: [lying_down] on stomach by door" in prompt
    assert "[Starting Physical State: [restrained] cuffed to pipe]" in prompt
    assert "Starting Physical State: [crouching] behind bar counter" in prompt


async def test_phase5_clerk_updates_carry_forward_and_staleness_resets(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(empty_repo)
    world = seed_world(
        empty_repo,
        owner_id=user.id,
        locations=[
            LocationNodeDraft(
                key="bar",
                name="Cantina Bar",
                summary="Main hall.",
                description="Dim lights over booths.",
                is_starting_location=True,
                starting_message="Quiet evening.",
            ),
            LocationNodeDraft(
                key="alley",
                name="Back Alley",
                summary="Rain-slick alley.",
                description="Narrow brick passage.",
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="bar",
                to_key="alley",
                direction_label="Rear Door",
                reverse_direction_label="Inside",
                compass_direction="N",
                distance_meters=20,
            )
        ],
    )
    bar_loc = next(loc for loc in world.locations if loc.name == "Cantina Bar")
    alley_loc = next(loc for loc in world.locations if loc.name == "Back Alley")
    kira = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Kira Vance")
    camp = seed_campaign(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=kira.id,
    )

    # Helper to create and reconcile turns sequentially
    def _save_raw_turn(parent_id: str, depth: int, user_msg: str, prose: str, actor: str = kira.id):
        b = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
        prev_st = b.character_states[kira.id]
        tid = f"turn_test_{depth}"
        return empty_repo.save_turn_node(
            turn_id=tid,
            campaign_id=camp.id,
            parent_turn_id=parent_id,
            depth_index=depth,
            user_message=user_msg,
            actor_id=actor,
            raw_prose=prose,
            cognition=CognitionBlock(skipped=True),
            pre_turn=PreTurnAnalysis(active_speaker_id=actor, speaker_order=[] if actor.startswith("__") else [actor]),
            world_snapshot=b.current_world_snapshot.model_copy(update={"turn_id": tid}),
            character_state=prev_st.model_copy(update={"turn_id": tid}),
            recalled_items=[],
        )

    # Turn 1: Establish prone on stomach for Kira and kneeling for Player
    t1 = _save_raw_turn(camp.active_leaf_turn_id or "", 1, "I drop to my knees behind the table.", "Kira dives flat onto her stomach behind the overturned booth.")

    async def clerk_turn1(messages: list[dict[str, str]], response_model: type[Any], **_kw: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=2,
                transition_type="stay",
                player_physical_stance="kneeling",
                player_physical_context="behind the steel table",
            )
        return CharacterAgentDelta(
            mood_label="Alert under fire",
            physical_stance="lying_down",
            physical_context="on stomach behind overturned booth",
        )

    monkeypatch.setattr(llm_client, "complete_structured", clerk_turn1)
    bar_neighbors = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id).neighbor_locations
    await clerk_pipeline_module.run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t1,
        active_location=bar_loc,
        neighbors=bar_neighbors,
        present_characters=[kira],
        all_participants=[kira],
        current_player_state=empty_repo.get_campaign_persona_turn_state(t1.id),
        dispatch_mode="sequential",
    )
    b1 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert b1.character_states[kira.id].physical_stance == "lying_down"
    assert b1.character_states[kira.id].physical_context == "on stomach behind overturned booth"
    assert b1.current_persona_turn_state is not None
    assert b1.current_persona_turn_state.physical_stance == "kneeling"
    assert b1.current_persona_turn_state.physical_context == "behind the steel table"

    # Turn 2: Pure static [Describe] narrator turn preserves both states untouched
    t2 = _save_raw_turn(t1.id, 2, "[Describe the room]", "Neon flickers across cracked vinyl booths.", actor="__narrator__")

    async def clerk_turn2(messages: list[dict[str, str]], response_model: type[Any], **_kw: Any) -> Any:
        assert response_model is WorldPostTurnDelta
        return WorldPostTurnDelta(elapsed_minutes=5, transition_type="stay", player_physical_stance="standing")

    monkeypatch.setattr(llm_client, "complete_structured", clerk_turn2)
    await clerk_pipeline_module.run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t2,
        active_location=bar_loc,
        neighbors=bar_neighbors,
        present_characters=[kira],
        all_participants=[kira],
        current_player_state=b1.current_persona_turn_state,
        dispatch_mode="sequential",
    )
    b2 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert b2.character_states[kira.id].physical_stance == "lying_down"
    assert b2.current_persona_turn_state is not None
    assert b2.current_persona_turn_state.physical_stance == "kneeling"

    # Turn 3: Move to alley; Clerk leaves Player unchanged (triggers smart reset -> standing)
    # while Kira follows player and Clerk explicitly sets her new alley pose ('leaning').
    t3 = _save_raw_turn(t2.id, 3, "Let's slip into the back alley.", "You head out the rear door; Kira follows and leans against the brick.")

    async def clerk_turn3(messages: list[dict[str, str]], response_model: type[Any], **_kw: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=3,
                transition_type="move_existing",
                target_location_id=alley_loc.id,
                player_physical_stance="kneeling",
                player_physical_context="behind the steel table",
            )
        return CharacterAgentDelta(
            mood_label="Wary watch",
            location_transition="follow_player",
            physical_stance="leaning",
            physical_context="against the wet brick wall",
        )

    monkeypatch.setattr(llm_client, "complete_structured", clerk_turn3)
    await clerk_pipeline_module.run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t3,
        active_location=bar_loc,
        neighbors=bar_neighbors,
        present_characters=[kira],
        all_participants=[kira],
        current_player_state=b2.current_persona_turn_state,
        dispatch_mode="sequential",
    )
    b3 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert b3.active_location.id == alley_loc.id
    assert b3.current_persona_turn_state is not None
    assert b3.current_persona_turn_state.physical_stance == "standing"
    assert b3.current_persona_turn_state.physical_context == ""
    assert b3.character_states[kira.id].physical_stance == "leaning"
    assert b3.character_states[kira.id].physical_context == "against the wet brick wall"
    last_post = b3.active_branch_turns[-1].post_turn
    assert last_post is not None
    assert last_post.previous_player_physical_stance == "kneeling"
    assert last_post.player_physical_stance == "standing"
    assert last_post.physical_state_reset_reasons.get("user") == "location_changed"

    # Turn 4: Offline heuristic fallback updates stances when provider fails
    t4 = _save_raw_turn(t3.id, 4, "I sit down on a crate.", "Kira drops to one knee beside the drain.")

    async def clerk_offline(*_args: Any, **_kw: Any) -> Any:
        raise RuntimeError("offline")

    monkeypatch.setattr(llm_client, "complete_structured", clerk_offline)
    monkeypatch.setattr(char_agent_module.llm_client, "complete_structured", clerk_offline)
    await clerk_pipeline_module.run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t4,
        active_location=alley_loc,
        neighbors=b3.neighbor_locations,
        present_characters=[kira],
        all_participants=[kira],
        current_player_state=b3.current_persona_turn_state,
        dispatch_mode="sequential",
    )
    b4 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert b4.current_persona_turn_state is not None
    assert b4.current_persona_turn_state.physical_stance == "sitting"
    assert b4.character_states[kira.id].physical_stance == "kneeling"


async def test_manual_overrides_gm_tools_and_zcc_roundtrip_and_legacy_import(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    u1 = seed_user(empty_repo, username="owner_phys")
    u2 = seed_user(empty_repo, username="importer_phys")
    world = seed_world(
        empty_repo,
        owner_id=u1.id,
        locations=[
            LocationNodeDraft(
                key="hub",
                name="Hub Room",
                summary="Main hub.",
                description="Steel floor.",
                is_starting_location=True,
            ),
            LocationNodeDraft(
                key="vault",
                name="Vault",
                summary="Locked vault.",
                description="Reinforced steel vault.",
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="hub",
                to_key="vault",
                direction_label="Vault Door",
                reverse_direction_label="Hub",
                compass_direction="E",
                distance_meters=15,
            )
        ],
    )
    vault_loc = next(l for l in world.locations if l.name == "Vault")
    kira = seed_character(empty_repo, owner_id=u1.id, world_id=world.id, name="Kira Vance")
    persona = empty_repo.create_persona(
        PersonaCreatePayload(
            name="Jax Mercer",
            tagline="Smuggler",
            persona_bio="Quick on his feet.",
            equipped=[PersonaItemInstance(name="Leather Coat", is_secret=False)],
        ),
        owner_id=u1.id,
    )
    camp = empty_repo.create_campaign(
        name="Phys Roundtrip",
        world_id=world.id,
        character_id=kira.id,
        owner_id=u1.id,
        persona_id=persona.id,
        opening_prose="*A tense hush falls over the room.*",
    )

    try:
        client1 = _authed_client(empty_repo, monkeypatch, u1.id)

        # Manual override endpoints (NPC + Player)
        r_npc = client1.post(
            f"/api/campaigns/{camp.id}/characters/{kira.id}/physical-state-override",
            json={"physical_stance": "prone", "physical_context": "<i>on stomach</i> under table"},
        )
        assert r_npc.status_code == 200
        b_after_npc = r_npc.json()
        assert b_after_npc["character_states"][kira.id]["physical_stance"] == "lying_down"
        assert b_after_npc["character_states"][kira.id]["physical_context"] == "on stomach under table"

        r_player = client1.post(
            f"/api/campaigns/{camp.id}/player-physical-state-override",
            json={"physical_stance": "restrained", "physical_context": "handcuffed to railing"},
        )
        assert r_player.status_code == 200
        b_after_player = r_player.json()
        assert b_after_player["current_persona_turn_state"]["physical_stance"] == "restrained"
        assert b_after_player["current_persona_turn_state"]["physical_context"] == "handcuffed to railing"

        # GM Tools & GM Talk mention formatting read updated physical state
        live_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u1.id)
        vis = _compute_branch_visibility(live_bundle)
        char_tool_out, _, _ = await execute_gm_tool(
            empty_repo,
            bundle=live_bundle,
            vis=vis,
            base_world_ids=set(),
            call=LlmToolCall(
                id="tc_char",
                name="get_campaign_entity",
                arguments={"kind": "character", "query": "Kira"},
            ),
            emitted_proposals=[],
        )
        assert char_tool_out["physical_stance"] == "lying_down"
        assert "Physical State: [lying_down] on stomach under table" in char_tool_out["summary"]

        persona_tool_out, _, _ = await execute_gm_tool(
            empty_repo,
            bundle=live_bundle,
            vis=vis,
            base_world_ids=set(),
            call=LlmToolCall(
                id="tc_pers",
                name="get_campaign_entity",
                arguments={"kind": "persona", "query": "Jax"},
            ),
            emitted_proposals=[],
        )
        assert persona_tool_out["physical_stance"] == "restrained"
        assert persona_tool_out["physical_context"] == "handcuffed to railing"

        pinned_persona = _serialize_pinned_mention(
            GmMentionRef(kind="persona", id=persona.id, label=persona.name),
            vis,
        )
        assert pinned_persona is not None
        assert "Physical State: [restrained] handcuffed to railing" in pinned_persona[0]

        # .zcc export & re-import round-trip preserves physical states
        exp_res = client1.post(
            f"/api/export/campaign/{camp.id}",
            json={"timeline_scope": "full"},
        )
        assert exp_res.status_code == 200
        zcc_bytes = exp_res.content

        client2 = _authed_client(empty_repo, monkeypatch, u2.id)
        ins_res = client2.post(
            "/api/import/inspect",
            files={"file": ("phys_roundtrip.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert ins_res.status_code == 200
        com_res = client2.post(
            "/api/import/commit",
            json={
                "staged_token": ins_res.json()["staged_token"],
                "import_campaign_assets_as_standalone": True,
            },
        )
        assert com_res.status_code == 200

        u2_camps = empty_repo.list_campaigns(owner_id=u2.id)
        imported_bundle = empty_repo.get_campaign_state_bundle(u2_camps[0].id, owner_id=u2.id)
        imported_kira_state = next(iter(imported_bundle.character_states.values()))
        assert imported_kira_state.physical_stance == "lying_down"
        assert imported_kira_state.physical_context == "on stomach under table"
        assert imported_bundle.current_persona_turn_state is not None
        assert imported_bundle.current_persona_turn_state.physical_stance == "restrained"
        assert imported_bundle.current_persona_turn_state.physical_context == "handcuffed to railing"

        # Legacy .zcc import (without physical_* keys) defaults safely to unspecified/""
        with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as src_zf:
            entries = {n: src_zf.read(n) for n in src_zf.namelist()}
        camps_payload = json.loads(entries["campaigns.json"])
        for camp_payload in camps_payload:
            for cs in camp_payload.get("character_states") or []:
                cs.pop("physical_stance", None)
                cs.pop("physical_context", None)
            for pts in camp_payload.get("persona_turn_states") or []:
                pts.pop("physical_stance", None)
                pts.pop("physical_context", None)
        entries["campaigns.json"] = json.dumps(camps_payload).encode("utf-8")

        legacy_buf = io.BytesIO()
        with zipfile.ZipFile(legacy_buf, "w", zipfile.ZIP_DEFLATED) as out_zf:
            for name, raw_b in entries.items():
                out_zf.writestr(name, raw_b)
        legacy_ins = client2.post(
            "/api/import/inspect",
            files={"file": ("phys_legacy.zcc", legacy_buf.getvalue(), "application/octet-stream")},
        )
        assert legacy_ins.status_code == 200
        legacy_com = client2.post(
            "/api/import/commit",
            json={
                "staged_token": legacy_ins.json()["staged_token"],
                "import_campaign_assets_as_standalone": True,
            },
        )
        assert legacy_com.status_code == 200
        legacy_camp = [c for c in empty_repo.list_campaigns(owner_id=u2.id) if c.id != u2_camps[0].id][0]
        legacy_bundle = empty_repo.get_campaign_state_bundle(legacy_camp.id, owner_id=u2.id)
        legacy_kira_state = next(iter(legacy_bundle.character_states.values()))
        assert legacy_kira_state.physical_stance == "unspecified"
        assert legacy_kira_state.physical_context == ""
        assert legacy_bundle.current_persona_turn_state is not None
        assert legacy_bundle.current_persona_turn_state.physical_stance == "unspecified"

        # Location override staleness reset on u1's campaign:
        # Kira is not in player's party, so she stays in Hub Room (retaining lying_down);
        # Player moves to Vault -> restrained stays restrained, room context cleared.
        client1 = _authed_client(empty_repo, monkeypatch, u1.id)
        reloc_res = client1.post(
            f"/api/campaigns/{camp.id}/location-override",
            json={"location_id": vault_loc.id, "move_mode": "party"},
        )
        assert reloc_res.status_code == 200
        b_reloc = reloc_res.json()
        assert b_reloc["character_states"][kira.id]["physical_stance"] == "lying_down"
        assert b_reloc["character_states"][kira.id]["physical_context"] == "on stomach under table"
        assert b_reloc["current_persona_turn_state"]["physical_stance"] == "restrained"
        assert b_reloc["current_persona_turn_state"]["physical_context"] == ""

        # Individual character location override moves Kira to Vault and resets her stale pose -> standing
        npc_reloc_res = client1.post(
            f"/api/campaigns/{camp.id}/characters/{kira.id}/location-override",
            json={"location_id": vault_loc.id},
        )
        assert npc_reloc_res.status_code == 200
        b_npc_reloc = npc_reloc_res.json()
        assert b_npc_reloc["character_states"][kira.id]["physical_stance"] == "standing"
        assert b_npc_reloc["character_states"][kira.id]["physical_context"] == ""
    finally:
        main_module.app.dependency_overrides.clear()


def test_format_physical_state_prompt_value_edge_cases() -> None:
    assert format_physical_state_prompt_value("unspecified", "") == ""
    assert format_physical_state_prompt_value("standing", "") == "[standing]"
    assert format_physical_state_prompt_value("unspecified", "holding rail") == "holding rail"
    assert format_physical_state_prompt_value("kneeling", "by the door") == "[kneeling] by the door"
