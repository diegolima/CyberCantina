"""Comprehensive backend tests for Tracked Location Props & /search."""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine.clerk.heuristics import heuristic_world_post_turn_delta
from app.engine.gm_talk import build_gm_context_and_messages
from app.engine.llm_client import llm_client
from app.engine.phase2_context import assemble_four_zone_messages
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.engine.prop_spawn import (
    CritAutoSpawnPropLLMOutput,
    generate_crit_auto_spawn_prop,
    is_crit_auto_spawn_eligible,
)
from app.main import _execute_turn_stream_events
from app.prompts import FACTORY_DEFAULT_PROMPTS
from app.routers import import_export as import_export_router
from app.schemas.persona import PersonaCreatePayload
from app.schemas.turn import (
    SEARCH_COOLDOWN_TURNS,
    CampaignWorldSettings,
    CharacterAgentDelta,
    DiceRollResult,
    PreTurnAnalysis,
    PropClaim,
    TurnSubmitRequest,
    WorldPostTurnDelta,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationContainer,
    LocationEdgeDraft,
    LocationLoreNodeDraft,
    LocationNodeDraft,
    LocationProp,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldUpdatePayload,
)
from tests.factories import seed_character, seed_user, seed_world


@pytest.fixture
def authed_client(empty_repo: CantinaRepository) -> tuple[TestClient, CantinaRepository]:
    user = seed_user(empty_repo, username="prop_tester", role="admin", user_id="user_prop_tester")
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(main_module.app)
    try:
        yield client, empty_repo
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def _seed_prop_scenario(
    repo: CantinaRepository,
    *,
    owner_id: str = "user_prop_tester",
    auto_spawn_on_crit: bool = False,
):
    cont_l1 = LocationContainer(
        id="cont_cannery",
        world_id="",
        depth=1,
        name="Old Cannery",
        description="Rust-stained waterfront warehouse.",
        environmental_tags=["rust"],
    )
    world = seed_world(
        repo,
        owner_id=owner_id,
        name="Harbor Sector",
        containers=[cont_l1],
        global_rules=WorldGlobalRules(
            genre="Cyberpunk Noir",
            tone="Gritty",
            setting_overview="Rain-slicked orbital harbor.",
            tech_or_magic_rules="Low cybernetics and analog locks.",
            starting_timestamp="2094-11-14 23:00",
            describe_on_first_visit=False,
            auto_spawn_props_on_search_crit=auto_spawn_on_crit,
        ),
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Obsidian Seal",
                category="artifact",
                content="An ancient harbor guild signet.",
                entity_tags=["obsidian seal"],
            )
        ],
        locations=[
            LocationNodeDraft(
                key="office",
                container_id="cont_cannery",
                name="Foreman Office",
                summary="Cramped glass booth.",
                description="Greasy desk and flickering desk lamp.",
                environmental_tags=["desk", "lamp"],
                is_starting_location=True,
                is_hub=True,
                props=[
                    LocationProp(
                        id="prop_keycard",
                        name="Brass Keycard",
                        note="Stamped GATE-4 on a frayed lanyard.",
                        flags=["artifact"],
                        is_hidden=False,
                    ),
                    LocationProp(
                        id="prop_ledger",
                        name="Hidden Ledger",
                        note="Tucked under a loose drawer panel.",
                        flags=["permanent"],
                        is_hidden=True,
                    ),
                ],
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="Hidden Vault Wiring",
                        category="secret",
                        content="A concealed keypad sits behind the calendar.",
                        entity_tags=["keypad", "calendar"],
                    )
                ],
            ),
            LocationNodeDraft(
                key="empty_bay",
                container_id="cont_cannery",
                name="Empty Packing Bay",
                summary="Barren loading bay.",
                description="Concrete floor washed clean by rainwater.",
                environmental_tags=["concrete"],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="office",
                to_key="empty_bay",
                direction_label="Stairs to Packing Bay",
                reverse_direction_label="Stairs up to Foreman Office",
                compass_direction="E",
                reverse_compass_direction="W",
                distance_meters=40,
            )
        ],
    )
    office = next(l for l in world.locations if l.name == "Foreman Office")
    empty_bay = next(l for l in world.locations if l.name == "Empty Packing Bay")
    persona = repo.create_persona(
        PersonaCreatePayload(name="Kael Vance", tagline="Investigator"),
        owner_id=owner_id,
    )
    char = seed_character(repo, owner_id=owner_id, world_id=world.id, name="Yulia Halim")
    camp = repo.create_campaign(
        name="Harbor Investigation",
        world_id=world.id,
        character_id=char.id,
        persona_id=persona.id,
        owner_id=owner_id,
    )
    return world, office, empty_bay, persona, char, camp


async def _collect_turn(
    *,
    campaign_id: str,
    req: TurnSubmitRequest,
) -> list[dict]:
    packets = []
    async for pkt in _execute_turn_stream_events(campaign_id=campaign_id, req=req):
        packets.append(pkt)
    return packets


def test_schema_migrations_and_world_prop_crud_and_codex_exclusion(
    empty_repo: CantinaRepository,
) -> None:
    user = seed_user(empty_repo, user_id="user_prop_tester")
    world = seed_world(
        empty_repo,
        owner_id=user.id,
        name="Solo Harbor",
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Obsidian Seal",
                category="artifact",
                content="Ancient guild signet.",
                entity_tags=["obsidian seal"],
            )
        ],
        locations=[
            LocationNodeDraft(
                key="office",
                name="Foreman Office",
                summary="Cramped glass booth.",
                description="Greasy desk and flickering desk lamp.",
                environmental_tags=["desk", "lamp"],
                is_starting_location=True,
                is_hub=True,
                props=[
                    LocationProp(
                        id="prop_keycard",
                        name="Brass Keycard",
                        note="Stamped GATE-4.",
                        flags=["artifact"],
                        is_hidden=False,
                    ),
                    LocationProp(
                        id="prop_ledger",
                        name="Hidden Ledger",
                        note="Tucked under drawer.",
                        flags=["permanent"],
                        is_hidden=True,
                    ),
                ],
            )
        ],
    )
    office = world.locations[0]

    conn = sqlite3.connect(empty_repo.db_path)
    try:
        lp_cols = {r[1] for r in conn.execute("PRAGMA table_info(location_props)").fetchall()}
        assert {"id", "world_id", "location_id", "name", "note", "flags_json", "lore_id", "is_hidden", "sort_order"}.issubset(lp_cols)
        snap_cols = {r[1] for r in conn.execute("PRAGMA table_info(world_state_snapshots)").fetchall()}
        assert {
            "revealed_prop_ids_json",
            "claimed_prop_ids_json",
            "spawned_props_json",
            "location_search_last_turn_depth_json",
            "auto_spawned_prop_location_ids_json",
        }.issubset(snap_cols)
    finally:
        conn.close()

    # Re-running initialization is idempotent
    CantinaRepository(db_path=empty_repo.db_path, media_dir=empty_repo.media_dir)

    # Codex and vector RAG must NEVER include props
    assert [ln.title for ln in world.lore_nodes] == ["Obsidian Seal"]
    conn2 = sqlite3.connect(empty_repo.db_path)
    try:
        vec_rows = conn2.execute(
            "SELECT title, content FROM vector_entries WHERE world_id = ?",
            (world.id,),
        ).fetchall()
    finally:
        conn2.close()
    assert all(
        "Brass Keycard" not in f"{r[0]} {r[1]}" and "Hidden Ledger" not in f"{r[0]} {r[1]}"
        for r in vec_rows
    )

    # World update (unattached base world) preserves prop IDs and allows edit + delete
    art_id = world.lore_nodes[0].id
    edited_locs = [
        loc.model_copy(
            update={
                "props": [
                    LocationProp(
                        id="prop_keycard",
                        name="Brass Keycard MkII",
                        note="Linked to Obsidian Seal.",
                        flags=["artifact", "permanent"],
                        lore_id=art_id,
                        is_hidden=False,
                    )
                ]
            }
        )
        if loc.id == office.id
        else loc
        for loc in world.locations
    ]
    updated_world = empty_repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=world.name,
            global_rules=world.global_rules,
            containers=world.containers,
            locations=edited_locs,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id=user.id,
    )
    updated_office = next(l for l in updated_world.locations if l.name == "Foreman Office")
    assert len(updated_office.props) == 1
    assert updated_office.props[0].id == "prop_keycard"
    assert updated_office.props[0].name == "Brass Keycard MkII"
    assert updated_office.props[0].lore_id == art_id
    char = seed_character(empty_repo, owner_id=user.id, world_id=world.id)
    camp = empty_repo.create_campaign(
        name="Check Defaults",
        world_id=updated_world.id,
        character_id=char.id,
        owner_id=user.id,
    )
    assert camp.world_settings.auto_spawn_props_on_search_crit is False


async def test_look_vs_search_dc12_discovery_and_freeform_parity(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(empty_repo, user_id="user_prop_tester")
    _world, office, bay, _persona, _char, camp = _seed_prop_scenario(empty_repo, owner_id=user.id)

    captured_prompts: list[list[dict[str, str]]] = []
    orig_assemble = assemble_four_zone_messages

    def _cap(*args, **kwargs):
        msgs = orig_assemble(*args, **kwargs)
        captured_prompts.append(msgs)
        return msgs

    monkeypatch.setattr(
        "app.routers.campaign_routes.turn_streaming.assemble_four_zone_messages",
        _cap,
    )

    # 1. /look remains strictly ambient, dice-free, and highlights visible props only
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="[Describe the current scene]",
            narrative_mode="describe",
            dice_mode="auto",
        ),
    )
    b1 = empty_repo.get_campaign_state_bundle(camp.id)
    look_turn = b1.active_branch_turns[-1]
    assert look_turn.pre_turn.resolved_roll is None
    joined_look = "\n".join(m["content"] for m in captured_prompts[-1])
    assert "Brass Keycard" in joined_look
    assert "Hidden Ledger" not in joined_look

    # 2. /search in Empty Packing Bay (0 props, dice_mode="disabled") promotes to forced DC 12
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="/search",
            search_action=True,
            dice_mode="disabled",
            override_location_id=bay.id,
        ),
    )
    b2 = empty_repo.get_campaign_state_bundle(camp.id)
    bay_search_turn = b2.active_branch_turns[-1]
    assert bay_search_turn.pre_turn.is_search_action is True
    assert bay_search_turn.pre_turn.dice_mode == "forced"
    assert bay_search_turn.pre_turn.dice_mode_promoted is True
    assert bay_search_turn.pre_turn.resolved_roll is not None
    assert bay_search_turn.pre_turn.resolved_roll.difficulty_class == 12
    assert b2.current_world_snapshot.spawned_props == []

    # 3. Returning to Foreman Office with freeform Clean Success discovery unlocks hidden prop
    empty_repo.override_campaign_location(camp.id, office.id, owner_id=user.id)
    # Bundle still hides prop_ledger before roll
    assert [p.id for p in empty_repo.get_campaign_state_bundle(camp.id).active_location.props] == ["prop_keycard"]

    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I pry open the desk drawers and search carefully.",
            dice_mode="forced",
            manual_dice_override=15,
        ),
    )
    b3 = empty_repo.get_campaign_state_bundle(camp.id)
    assert "prop_ledger" in b3.current_world_snapshot.revealed_prop_ids
    assert {p.id for p in b3.active_location.props} == {"prop_keycard", "prop_ledger"}


async def test_search_cooldown_survives_travel_resets_on_branch_and_bypasses_in_gm(
    empty_repo: CantinaRepository,
) -> None:
    user = seed_user(empty_repo, user_id="user_prop_tester")
    _world, office, bay, _persona, _char, camp = _seed_prop_scenario(empty_repo, owner_id=user.id)

    # Depth 1: /search in Foreman Office
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="/search",
            search_action=True,
            dice_mode="forced",
            manual_dice_override=15,
        ),
    )
    b1 = empty_repo.get_campaign_state_bundle(camp.id)
    t1_id = b1.active_branch_turns[-1].id
    root_id = b1.active_branch_turns[0].id
    assert b1.current_world_snapshot.location_search_last_turn_depth[office.id] == 1

    # Immediate re-search in Foreman Office raises 409 with 4 turns remaining
    with pytest.raises(HTTPException) as exc_info:
        await _collect_turn(
            campaign_id=camp.id,
            req=TurnSubmitRequest(user_message="/search", search_action=True),
        )
    assert exc_info.value.status_code == 409
    assert "4 turns remaining" in str(exc_info.value.detail)

    # Traveling to Empty Packing Bay allows /search there immediately & does NOT reset Office cooldown
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="/search floor",
            search_action=True,
            search_focus="floor",
            override_location_id=bay.id,
            dice_mode="forced",
            manual_dice_override=10,
        ),
    )
    with pytest.raises(HTTPException) as exc_office_again:
        await _collect_turn(
            campaign_id=camp.id,
            req=TurnSubmitRequest(
                user_message="/search",
                search_action=True,
                override_location_id=office.id,
            ),
        )
    assert exc_office_again.value.status_code == 409
    assert "3 turns remaining" in str(exc_office_again.value.detail)

    # Branching back to Turn #0 clears cooldown completely
    empty_repo.checkout_turn_branch(camp.id, root_id, owner_id=user.id)
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(user_message="/search", search_action=True, dice_mode="forced", manual_dice_override=14),
    )
    b_branched = empty_repo.get_campaign_state_bundle(camp.id)
    assert b_branched.current_world_snapshot.location_search_last_turn_depth[office.id] == 1

    # Advance to t1_id branch + 3 more turns -> total depth 5 -> wait cooldown expires at depth 6
    empty_repo.checkout_turn_branch(camp.id, t1_id, owner_id=user.id)
    # Enable GM Mode bypasses cooldown immediately
    empty_repo.update_campaign_world_settings(
        camp.id,
        CampaignWorldSettings(describe_on_first_visit=False, unlock_lore=True),
        owner_id=user.id,
    )
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(user_message="/search desk", search_action=True, dice_mode="forced", manual_dice_override=13),
    )
    assert SEARCH_COOLDOWN_TURNS == 5


async def test_crit_auto_spawn_eligibility_bounds_fallback_and_single_cap(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(empty_repo, user_id="user_prop_tester")
    world, office, bay, _persona, _char, camp = _seed_prop_scenario(
        empty_repo,
        owner_id=user.id,
        auto_spawn_on_crit=True,
    )

    # Forbidden item regex & validator bounds
    with pytest.raises(ValueError, match="power-boundary"):
        CritAutoSpawnPropLLMOutput(
            name="Plasma Rifle",
            note="Heavy energy firearm.",
            tier="improvised_aid",
        )
    with pytest.raises(ValueError, match="power-boundary"):
        CritAutoSpawnPropLLMOutput(
            name="Brass Key",
            note="Acts as a master key for every lock.",
            tier="mundane_tool",
        )

    crit_roll = DiceRollResult(
        action_description="Search the room carefully",
        skill_or_approach="Perception / Investigation",
        d20_raw=20,
        modifier=2,
        total=22,
        difficulty_class=12,
        outcome_tier="Critical Success",
        narrative_directive="Crit!",
    )
    pre_unpinned_search = PreTurnAnalysis(
        user_sentiment="curious",
        subtext_interpretation="Searching",
        spatial_intent="stay",
        is_search_action=True,
        roll_was_pinned=False,
        resolved_roll=crit_roll,
    )

    # Gate checks
    assert is_crit_auto_spawn_eligible(
        world_settings=CampaignWorldSettings(auto_spawn_props_on_search_crit=False),
        pre_turn=pre_unpinned_search,
        effective_unclaimed_props=[],
        world_snapshot=WorldStateSnapshot(turn_id="t0", world_timestamp="t", active_location_id=bay.id),
        active_location_id=bay.id,
    ) is False
    assert is_crit_auto_spawn_eligible(
        world_settings=CampaignWorldSettings(auto_spawn_props_on_search_crit=True, unlock_lore=False),
        pre_turn=pre_unpinned_search.model_copy(update={"roll_was_pinned": True}),
        effective_unclaimed_props=[],
        world_snapshot=WorldStateSnapshot(turn_id="t0", world_timestamp="t", active_location_id=bay.id),
        active_location_id=bay.id,
    ) is False
    # Pinned crit allowed when GM Mode (unlock_lore=True)
    assert is_crit_auto_spawn_eligible(
        world_settings=CampaignWorldSettings(auto_spawn_props_on_search_crit=True, unlock_lore=True),
        pre_turn=pre_unpinned_search.model_copy(update={"roll_was_pinned": True}),
        effective_unclaimed_props=[],
        world_snapshot=WorldStateSnapshot(turn_id="t0", world_timestamp="t", active_location_id=bay.id),
        active_location_id=bay.id,
    ) is True
    # Room already has props -> blocked
    assert is_crit_auto_spawn_eligible(
        world_settings=CampaignWorldSettings(auto_spawn_props_on_search_crit=True),
        pre_turn=pre_unpinned_search,
        effective_unclaimed_props=office.props,
        world_snapshot=WorldStateSnapshot(turn_id="t0", world_timestamp="t", active_location_id=office.id),
        active_location_id=office.id,
    ) is False

    # LLM fallback generates bounded genre-adapted prop
    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        AsyncMock(side_effect=RuntimeError("offline")),
    )
    generated = await generate_crit_auto_spawn_prop(
        active_location=bay,
        world=world,
        recent_turns=[],
        search_focus="behind the drain grate",
    )
    assert generated.auto_spawned is True
    assert generated.is_hidden is False
    assert generated.location_id == bay.id
    assert generated.note.startswith(("[Clue]", "[Tool]", "[Consumable]", "[Aid]"))

    # Full end-to-end /search Critical Success in Empty Packing Bay (unpinned auto nat 20)
    empty_repo.override_campaign_location(camp.id, bay.id, owner_id=user.id)
    monkeypatch.setattr("app.engine.phase1_pre.random.randint", lambda _a, _b: 20)
    await _collect_turn(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="/search drain grate",
            search_action=True,
            search_focus="drain grate",
            dice_mode="forced",
        ),
    )
    b_spawned = empty_repo.get_campaign_state_bundle(camp.id)
    assert len(b_spawned.current_world_snapshot.spawned_props) == 1
    assert bay.id in b_spawned.current_world_snapshot.auto_spawned_prop_location_ids
    assert len(b_spawned.active_location.props) == 1

    # Once claimed later, room must remain blocked from spawning a second prop
    spawned_id = b_spawned.active_location.props[0].id
    assert is_crit_auto_spawn_eligible(
        world_settings=b_spawned.campaign.world_settings,
        pre_turn=pre_unpinned_search,
        effective_unclaimed_props=[],
        world_snapshot=b_spawned.current_world_snapshot.model_copy(
            update={"claimed_prop_ids": [spawned_id]}
        ),
        active_location_id=bay.id,
    ) is False


async def test_phase5_clerk_prop_claims_arbitration_and_heuristics(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = seed_user(empty_repo, user_id="user_prop_tester")
    world, office, _bay, _persona, char, camp = _seed_prop_scenario(empty_repo, owner_id=user.id)
    b0 = empty_repo.get_campaign_state_bundle(camp.id)
    root = b0.active_branch_turns[0]

    # Heuristic fallback catches explicit pickup of visible unclaimed prop
    h_delta = heuristic_world_post_turn_delta(
        user_message="I grab the Brass Keycard from the desk.",
        raw_prose="Kael picks up the Brass Keycard from the desk and slips it into his coat.",
        pre_turn=PreTurnAnalysis(
            user_sentiment="decisive",
            subtext_interpretation="Taking keycard",
            spatial_intent="stay",
        ),
        active_location=office,
        neighbors=[],
        visible_location_props=[p for p in office.props if not p.is_hidden],
        present_characters=[char],
    )
    assert h_delta.claimed_props == [PropClaim(prop_id="prop_keycard", holder_id="player")]

    t1 = empty_repo.save_turn_node(
        turn_id="turn_pickup_1",
        campaign_id=camp.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="I grab the Brass Keycard and toss nothing aside.",
        actor_id=char.id,
        raw_prose='Kael snatches the Brass Keycard. Yulia watches quietly.',
        cognition=root.cognition,
        pre_turn=PreTurnAnalysis(
            user_sentiment="decisive",
            subtext_interpretation="Taking keycard",
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_pickup_1"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_pickup_1"}),
        recalled_items=[],
    )

    # Clerk emits valid claim for visible prop_keycard -> player + invalid claim for unrevealed prop_ledger
    # + duplicate claim for prop_keycard -> NPC + redundant items_obtained string that should be stripped
    async def _fake_complete_structured(messages, response_model, **_kwargs):
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=2,
                transition_type="stay",
                claimed_props=[
                    PropClaim(prop_id="prop_keycard", holder_id="player"),
                    PropClaim(prop_id="prop_keycard", holder_id=char.id),
                    PropClaim(prop_id="prop_ledger", holder_id=char.id),
                    PropClaim(prop_id="nonexistent_prop", holder_id="player"),
                ],
            )
        if response_model is CharacterAgentDelta:
            return CharacterAgentDelta(
                mood_label="Alert",
                valence_delta=0.0,
                arousal_delta=0.0,
                stance_updates={},
                items_equipped=[],
                items_unequipped=[],
                items_obtained=["Brass Keycard"],
                items_removed=[],
                location_transition="stay_here",
                new_memories=[],
            )
        raise AssertionError(f"Unexpected schema {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", _fake_complete_structured)

    await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t1,
        active_location=office,
        neighbors=[],
        present_characters=[char],
        all_participants=[char],
    )

    b_after = empty_repo.get_campaign_state_bundle(camp.id)
    # Single-owner deduplicated: prop_keycard claimed by player, unrevealed prop_ledger NOT claimed
    assert b_after.current_world_snapshot.claimed_prop_ids == ["prop_keycard"]
    player_inv_names = [it.name for it in (b_after.current_persona_turn_state.inventory if b_after.current_persona_turn_state else [])]
    assert "Brass Keycard" in player_inv_names
    # Stripped overlapping items_obtained from NPC
    npc_inv_names = [it.name for it in b_after.character_states[char.id].inventory]
    assert "Brass Keycard" not in npc_inv_names
    assert [p.id for p in b_after.active_location.props] == []


@pytest.mark.asyncio
async def test_gm_endpoints_redaction_gm_talk_and_zcc_roundtrip(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo = authed_client
    monkeypatch.setattr(import_export_router, "get_repo", lambda: repo)
    world, office, bay, _persona, char, camp = _seed_prop_scenario(repo, auto_spawn_on_crit=True)

    # 1. GM endpoints reject when unlock_lore=False
    assert (
        client.put(
            f"/api/campaigns/{camp.id}/locations/{office.id}/props",
            json={"props": []},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/campaigns/{camp.id}/props/prop_ledger/reveal",
            json={"revealed": True},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/campaigns/{camp.id}/props/prop_keycard/transfer",
            json={"holder_id": "player"},
        ).status_code
        == 403
    )

    # 2. GM Talk redacts hidden props when unlock_lore=False, exposes when unlock_lore=True
    prep_safe = await build_gm_context_and_messages(
        repo,
        campaign_id=camp.id,
        owner_id="user_prop_tester",
        user_message="What items are in this room?",
        mentions=[],
        working_memory_turns=8,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
    )
    safe_ctx = "\n".join(m["content"] for m in prep_safe.messages)
    assert "Brass Keycard" in safe_ctx
    assert "Hidden Ledger" not in safe_ctx

    # Enable GM Mode
    client.patch(f"/api/campaigns/{camp.id}/world-settings", json={"unlock_lore": True})
    prep_gm = await build_gm_context_and_messages(
        repo,
        campaign_id=camp.id,
        owner_id="user_prop_tester",
        user_message="What items are in this room?",
        mentions=[],
        working_memory_turns=8,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
    )
    gm_ctx = "\n".join(m["content"] for m in prep_gm.messages)
    assert "Brass Keycard" in gm_ctx
    assert "Hidden Ledger" in gm_ctx

    # 3. GM Reveal, Location Props CRUD & Transfer
    rev_res = client.post(
        f"/api/campaigns/{camp.id}/props/prop_ledger/reveal",
        json={"revealed": True},
    )
    assert rev_res.status_code == 200
    assert "prop_ledger" in rev_res.json()["current_world_snapshot"]["revealed_prop_ids"]

    tr_res = client.post(
        f"/api/campaigns/{camp.id}/props/prop_keycard/transfer",
        json={"holder_id": char.id},
    )
    assert tr_res.status_code == 200
    npc_inv = [it["name"] for it in tr_res.json()["character_states"][char.id]["inventory"]]
    assert "Brass Keycard" in npc_inv

    crud_res = client.put(
        f"/api/campaigns/{camp.id}/locations/{bay.id}/props",
        json={
            "props": [
                {
                    "id": "prop_gm_flare",
                    "name": "Signal Flare",
                    "note": "Red distress flare.",
                    "flags": [],
                    "is_hidden": False,
                }
            ]
        },
    )
    assert crud_res.status_code == 200
    assert repo.get_world(world.id, base_only=True).locations[1].props == []

    # 4. World + Campaign .zcc round-trip preserves props & snapshot fields
    w_exp = client.get(f"/api/export/world/{world.id}?include_characters=false&include_media=false")
    assert w_exp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(w_exp.content), "r") as zf:
        worlds_raw = json.loads(zf.read("worlds.json"))
        assert worlds_raw[0]["global_rules"]["auto_spawn_props_on_search_crit"] is True

    c_exp = client.post(
        f"/api/export/campaign/{camp.id}",
        json={"timeline_scope": "full", "strip_bookmark_comments": False},
    )
    assert c_exp.status_code == 200
    ins = client.post(
        "/api/import/inspect",
        files={"file": ("harbor.zcc", c_exp.content, "application/octet-stream")},
    )
    assert ins.status_code == 200
    commit = client.post(
        "/api/import/commit",
        json={
            "staged_token": ins.json()["staged_token"],
            "import_campaign_assets_as_standalone": False,
        },
    )
    assert commit.status_code == 200, commit.text
    imported_camp = next(
        c for c in repo.list_campaigns(owner_id="user_prop_tester") if c.id != camp.id
    )
    imported_bundle = repo.get_campaign_state_bundle(
        imported_camp.id, owner_id="user_prop_tester"
    )
    assert imported_bundle.campaign.world_settings.auto_spawn_props_on_search_crit is True
    imported_office = next(l for l in imported_bundle.visible_locations if l.name == "Foreman Office")
    imported_ledger = next(p for p in imported_office.props if p.name == "Hidden Ledger")
    assert imported_ledger.id in imported_bundle.current_world_snapshot.revealed_prop_ids
    assert len(imported_bundle.current_world_snapshot.claimed_prop_ids) == 1
    assert all(p.name != "Brass Keycard" for p in imported_office.props)
    imported_bay = next(l for l in imported_bundle.visible_locations if l.name == "Empty Packing Bay")
    assert [p.name for p in imported_bay.props] == ["Signal Flare"]

    # 5. Legacy .zcc archive missing all new prop/cooldown/setting keys imports cleanly
    legacy_buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(c_exp.content), "r") as zin, zipfile.ZipFile(legacy_buf, "w") as zout:
        for item in zin.infolist():
            raw = zin.read(item.filename)
            if item.filename == "worlds.json":
                w_data = json.loads(raw)
                for w_obj in w_data:
                    w_obj.get("global_rules", {}).pop("auto_spawn_props_on_search_crit", None)
                    for l_obj in w_obj.get("locations", []):
                        l_obj.pop("props", None)
                raw = json.dumps(w_data).encode("utf-8")
            elif item.filename == "campaigns.json":
                c_data = json.loads(raw)
                for c_obj in c_data:
                    if isinstance(c_obj.get("world_settings_json"), str):
                        ws_settings = json.loads(c_obj["world_settings_json"])
                        ws_settings.pop("auto_spawn_props_on_search_crit", None)
                        c_obj["world_settings_json"] = json.dumps(ws_settings)
                    if isinstance(c_obj.get("campaign"), dict):
                        c_obj["campaign"].get("world_settings", {}).pop(
                            "auto_spawn_props_on_search_crit", None
                        )
                    c_obj.get("world_settings", {}).pop("auto_spawn_props_on_search_crit", None)
                    for t_obj in c_obj.get("turn_nodes", c_obj.get("turns", [])):
                        ws = t_obj.get("world_snapshot", {})
                        for k in (
                            "revealed_prop_ids",
                            "claimed_prop_ids",
                            "spawned_props",
                            "location_search_last_turn_depth",
                            "auto_spawned_prop_location_ids",
                        ):
                            ws.pop(k, None)
                    for s_obj in c_obj.get("world_state_snapshots", []):
                        for k in (
                            "revealed_prop_ids_json",
                            "claimed_prop_ids_json",
                            "spawned_props_json",
                            "location_search_last_turn_depth_json",
                            "auto_spawned_prop_location_ids_json",
                        ):
                            s_obj.pop(k, None)
                raw = json.dumps(c_data).encode("utf-8")
            zout.writestr(item.filename, raw)

    legacy_ins = client.post(
        "/api/import/inspect",
        files={"file": ("legacy.zcc", legacy_buf.getvalue(), "application/octet-stream")},
    )
    assert legacy_ins.status_code == 200
    legacy_commit = client.post(
        "/api/import/commit",
        json={
            "staged_token": legacy_ins.json()["staged_token"],
            "import_campaign_assets_as_standalone": False,
        },
    )
    assert legacy_commit.status_code == 200, legacy_commit.text
    legacy_camp = next(
        c
        for c in repo.list_campaigns(owner_id="user_prop_tester")
        if c.id not in (camp.id, imported_camp.id)
    )
    legacy_bundle = repo.get_campaign_state_bundle(legacy_camp.id, owner_id="user_prop_tester")
    assert legacy_bundle.campaign.world_settings.auto_spawn_props_on_search_crit is False
    assert legacy_bundle.current_world_snapshot.revealed_prop_ids == []
    assert legacy_bundle.current_world_snapshot.claimed_prop_ids == []
    assert legacy_bundle.current_world_snapshot.spawned_props == []
    assert legacy_bundle.current_world_snapshot.location_search_last_turn_depth == {}
    assert legacy_bundle.current_world_snapshot.auto_spawned_prop_location_ids == []
