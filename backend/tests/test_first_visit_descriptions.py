"""Tests for v0.11.6 World Settings & Cosmetic First-Visit Arrival Descriptions."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import get_current_user
from app.db.repos.arrival_descriptions import (
    build_first_visit_arrival,
    is_meaningful_description,
)
from app.db.repository import CantinaRepository
from app.engine.phase2_context import (
    assemble_four_zone_messages,
    build_zone1_static_system_prompt,
)
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CognitionBlock,
)
from app.schemas.turn import (
    PreTurnAnalysis,
    WorldPostTurnDelta,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationContainer,
    LocationEdge,
    LocationNode,
    WorldGlobalRules,
    WorldUpdatePayload,
)


def _seed_nested_world_and_character(
    repo: CantinaRepository,
    *,
    owner_id: str | None = None,
    describe_default: bool = True,
    char_initial_message: str = "Welcome inside.",
    start_has_starting_message: bool = True,
):
    w_id = f"world_fv_{uuid.uuid4().hex[:8]}"
    c_id = f"char_fv_{uuid.uuid4().hex[:8]}"

    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
            (
                w_id,
                owner_id,
                "Mistport",
                WorldGlobalRules(
                    genre="Gothic Steampunk",
                    tone="Foggy mystery",
                    setting_overview="Gaslit harbor city beneath cliffside aqueducts.",
                    tech_or_magic_rules="Brass clockwork and alchemical lamps.",
                    describe_on_first_visit=describe_default,
                ).model_dump_json(),
            ),
        )
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, name, summary, description,
                environmental_tags_json, is_starting_location, is_hub, is_entry_exit, starting_message
            )
            VALUES (?, ?, NULL, 'Start Foyer', 'Warm brass foyer.', 'Lanterns flicker against riveted bronze walls.', '["foyer"]', 1, 0, 1, ?)
            """,
            (
                f"loc_start_{w_id}",
                w_id,
                "The gas lamps hum as fog curls under the threshold."
                if start_has_starting_message
                else "",
            ),
        )
        conn.commit()
    finally:
        conn.close()

    l2_old = LocationContainer(
        id="cont_old_ward",
        world_id=w_id,
        depth=2,
        name="Old Ward",
        description="Cobblestone lanes slicked with harbor mist.",
        environmental_tags=["cobbles"],
    )
    l1_tavern = LocationContainer(
        id="cont_tavern",
        world_id=w_id,
        parent_container_id=l2_old.id,
        depth=1,
        name="Anchor Tavern",
        description="Creaking ship timbers smell of salt and clove ale.",
        environmental_tags=["tavern"],
    )
    l2_new = LocationContainer(
        id="cont_undercroft",
        world_id=w_id,
        depth=2,
        name="Drowned Undercroft",
        description="A subterranean canal where brackish water laps granite arches.",
        environmental_tags=["canal"],
    )
    l1_vault = LocationContainer(
        id="cont_vault",
        world_id=w_id,
        parent_container_id=l2_new.id,
        depth=1,
        name="Tide Vault",
        description="Salt-crusted bronze doors guard flooded coffers.",
        environmental_tags=["vault"],
    )
    l1_stub = LocationContainer(
        id="cont_stub",
        world_id=w_id,
        depth=1,
        name="Empty Shed",
        description="A newly added structure.",  # Boilerplate -> filtered out!
        environmental_tags=[],
    )

    loc_start = LocationNode(
        id=f"loc_start_{w_id}",
        world_id=w_id,
        container_id=l1_tavern.id,
        is_entry_exit=True,
        name="Start Foyer",
        summary="Warm brass foyer.",
        description="Lanterns flicker against riveted bronze walls.",
        environmental_tags=["foyer"],
        is_starting_location=True,
        starting_message="The gas lamps hum as fog curls under the threshold."
        if start_has_starting_message
        else "",
    )
    loc_cellar = LocationNode(
        id=f"loc_cellar_{w_id}",
        world_id=w_id,
        container_id=l1_tavern.id,
        name="Cellar Room",
        summary="Oak casks.",
        description="Dusty casks line the damp stone alcove.",
        environmental_tags=["cellar"],
    )
    loc_vault_hall = LocationNode(
        id=f"loc_vault_hall_{w_id}",
        world_id=w_id,
        container_id=l1_vault.id,
        is_entry_exit=True,
        name="Ledger Chamber",
        summary="Ledgers and iron grates.",
        description="Verdigris stains every ledger lectern along the catwalk.",
        environmental_tags=["ledger"],
    )
    loc_stub_room = LocationNode(
        id=f"loc_stub_room_{w_id}",
        world_id=w_id,
        container_id=l1_stub.id,
        is_entry_exit=True,
        name="Stub Room",
        summary="Stub.",
        description="A newly connected location awaiting description.",
        environmental_tags=[],
    )

    edges = [
        LocationEdge(
            id=f"e1_{w_id}",
            world_id=w_id,
            from_location_id=loc_start.id,
            to_location_id=loc_cellar.id,
            direction_label="Down to Cellar",
            compass_direction="S",
            distance_meters=70,
        ),
        LocationEdge(
            id=f"e2_{w_id}",
            world_id=w_id,
            from_location_id=loc_cellar.id,
            to_location_id=loc_start.id,
            direction_label="Up to Foyer",
            compass_direction="N",
            distance_meters=70,
        ),
        LocationEdge(
            id=f"e3_{w_id}",
            world_id=w_id,
            from_location_id=loc_start.id,
            to_location_id=loc_vault_hall.id,
            direction_label="Into Tide Vault",
            compass_direction="E",
            distance_meters=280,
        ),
        LocationEdge(
            id=f"e4_{w_id}",
            world_id=w_id,
            from_location_id=loc_vault_hall.id,
            to_location_id=loc_start.id,
            direction_label="Back to Foyer",
            compass_direction="W",
            distance_meters=280,
        ),
        LocationEdge(
            id=f"e5_{w_id}",
            world_id=w_id,
            from_location_id=loc_start.id,
            to_location_id=loc_stub_room.id,
            direction_label="To Shed",
            compass_direction="W",
            distance_meters=70,
        ),
        LocationEdge(
            id=f"e6_{w_id}",
            world_id=w_id,
            from_location_id=loc_stub_room.id,
            to_location_id=loc_start.id,
            direction_label="Back",
            compass_direction="E",
            distance_meters=70,
        ),
    ]

    world = repo.update_world(
        w_id,
        WorldUpdatePayload(
            name="Mistport",
            global_rules=WorldGlobalRules(
                genre="Gothic Steampunk",
                tone="Foggy mystery",
                setting_overview="Gaslit harbor city beneath cliffside aqueducts.",
                tech_or_magic_rules="Brass clockwork and alchemical lamps.",
                describe_on_first_visit=describe_default,
            ),
            containers=[l2_old, l1_tavern, l2_new, l1_vault, l1_stub],
            locations=[loc_start, loc_cellar, loc_vault_hall, loc_stub_room],
            edges=edges,
            lore_nodes=[],
        ),
        owner_id=owner_id,
    )

    char_draft = CharacterWizardDraft(
        name="Corwin Brass",
        tagline="Harbor cartographer",
        core_persona="Methodical cartographer who notices every draft and lock.",
        baseline_psyche=BaselinePsyche(
            core_drive="Chart Mistport",
            core_fear="Drowning in the dark",
            default_want="Inspect the stonework",
            default_plan="Sketch exits carefully",
            mood_label="Vigilant",
        ),
        character_bio="Maps flooded tunnels under Mistport.",
        initial_message=char_initial_message,
    )
    char = repo.create_character_from_draft(
        char_draft, world_id=w_id, character_id=c_id, owner_id=owner_id
    )
    return world, char


def test_turn_0_start_focus_and_location_description_rules(
    empty_repo: CantinaRepository,
) -> None:
    """Turn 0 respects world vs character start focus and {location_description} template suppression."""
    world, char_custom = _seed_nested_world_and_character(
        empty_repo, char_initial_message="Welcome to our corner table."
    )
    char_tpl_world, char_with_tpl = _seed_nested_world_and_character(
        empty_repo,
        char_initial_message="Rain drums overhead. {location_description} Ready?",
    )
    blank_world, char_blank = _seed_nested_world_and_character(
        empty_repo, char_initial_message=""
    )

    # 1. World-focused start -> zero Turn 0 arrival cards, starter containers still marked visited
    camp_world_focus = empty_repo.create_campaign(
        name="World Focus",
        world_id=world.id,
        character_id=char_custom.id,
        actor_id="__narrator__",
        start_focus="world",
        opening_prose="The gas lamps hum as fog curls under the threshold.",
    )
    b_world = empty_repo.get_campaign_state_bundle(camp_world_focus.id)
    assert b_world.active_branch_turns[0].post_turn is None
    assert set(b_world.current_world_snapshot.visited_container_ids) == {
        "cont_old_ward",
        "cont_tavern",
    }

    # 2. Character-focused start (no {location_description}) -> L2 + L1 + L0 cards in outer -> inner order
    camp_char_focus = empty_repo.create_campaign(
        name="Char Focus",
        world_id=world.id,
        character_id=char_custom.id,
        start_focus="character",
    )
    b_char = empty_repo.get_campaign_state_bundle(camp_char_focus.id)
    cards = b_char.active_branch_turns[0].post_turn.first_visit_cards
    assert [(c.entity_type, c.title, c.depth) for c in cards] == [
        ("container", "Old Ward", 2),
        ("container", "Anchor Tavern", 1),
        ("location", "Start Foyer", 0),
    ]

    # 3. Character greeting with {location_description} -> skips Turn 0 location card, keeps containers
    camp_tpl = empty_repo.create_campaign(
        name="Tpl Focus",
        world_id=char_tpl_world.id,
        character_id=char_with_tpl.id,
        start_focus="character",
    )
    b_tpl = empty_repo.get_campaign_state_bundle(camp_tpl.id)
    tpl_cards = b_tpl.active_branch_turns[0].post_turn.first_visit_cards
    assert [c.title for c in tpl_cards] == ["Old Ward", "Anchor Tavern"]

    # 4. Blank initial_message fallback embeds location.description -> skips location card, keeps containers
    camp_blank = empty_repo.create_campaign(
        name="Blank Greeting",
        world_id=blank_world.id,
        character_id=char_blank.id,
        start_focus="character",
    )
    b_blank = empty_repo.get_campaign_state_bundle(camp_blank.id)
    blank_cards = b_blank.active_branch_turns[0].post_turn.first_visit_cards
    assert [c.title for c in blank_cards] == ["Old Ward", "Anchor Tavern"]


def test_map_moves_nested_containers_boilerplate_rewind_and_settings_isolation(
    empty_repo: CantinaRepository,
) -> None:
    """Map travel creates standalone __arrival__ rows, filters boilerplate, rewinds cleanly, and isolates settings."""
    user = empty_repo.create_user(username="fv_admin", display_name="FV", role="admin")
    world, char = _seed_nested_world_and_character(
        empty_repo, owner_id=user.id, char_initial_message="Pull up a stool."
    )
    camp = empty_repo.create_campaign(
        name="Mist Run",
        world_id=world.id,
        character_id=char.id,
        start_focus="world",
        opening_prose="Opening threshold prose.",
        owner_id=user.id,
    )
    turn_0_id = camp.active_leaf_turn_id
    assert turn_0_id is not None

    # Moving to sibling Cellar Room inside already-visited Tavern emits ONLY Cellar Room (no Tavern/Old Ward repeat)
    b_cellar = empty_repo.override_campaign_location(camp.id, f"loc_cellar_{world.id}", owner_id=user.id)
    assert len(b_cellar.active_branch_turns) == 2
    arrival_turn = b_cellar.active_branch_turns[-1]
    assert arrival_turn.actor_id == "__arrival__"
    assert [c.title for c in arrival_turn.post_turn.first_visit_cards] == ["Cellar Room"]

    # Moving across unvisited L2 -> L1 -> L0 emits 3 ordered cards in a single standalone turn
    b_vault = empty_repo.override_campaign_location(camp.id, f"loc_vault_hall_{world.id}", owner_id=user.id)
    assert len(b_vault.active_branch_turns) == 3
    vault_cards = b_vault.active_branch_turns[-1].post_turn.first_visit_cards
    assert [c.title for c in vault_cards] == [
        "Drowned Undercroft",
        "Tide Vault",
        "Ledger Chamber",
    ]
    vault_turn_id = b_vault.campaign.active_leaf_turn_id

    # Returning to Start Foyer (revisit) emits zero cards and does NOT append another arrival row
    b_back = empty_repo.override_campaign_location(camp.id, f"loc_start_{world.id}", owner_id=user.id)
    assert len(b_back.active_branch_turns) == 3

    # Moving to boilerplate stub shed & room emits zero cards (filtered)
    assert is_meaningful_description("A newly connected location awaiting description.") is False
    b_stub = empty_repo.override_campaign_location(camp.id, f"loc_stub_room_{world.id}", owner_id=user.id)
    assert len(b_stub.active_branch_turns) == 3

    # Zone 3 LLM prompt & Zone 1 static prompt completely exclude __arrival__ rows & arrival card text
    msgs = assemble_four_zone_messages(
        character=char,
        branch_turns=b_vault.active_branch_turns,
        episodic_chunks=[],
        active_location=b_vault.active_location,
        neighbors=b_vault.neighbor_locations,
        recalled_items=[],
        pre_turn=PreTurnAnalysis(active_speaker_id=char.id, speaker_order=[char.id]),
        world=world,
        user_message="What is on the table?",
    )
    assistant_content = "\n".join(m["content"] for m in msgs if m["role"] == "assistant")
    assert "Drowned Undercroft" not in assistant_content
    assert "Salt-crusted bronze doors" not in assistant_content
    assert "Verdigris stains" not in assistant_content
    zone1 = build_zone1_static_system_prompt(character=char, world=world)
    assert "describe_on_first_visit" not in zone1

    # Branch rewind back to Turn 0 restores unvisited state so Ledger Chamber triggers fresh again
    empty_repo.checkout_turn_branch(camp.id, turn_0_id, owner_id=user.id)
    b_rewound_vault = empty_repo.override_campaign_location(
        camp.id, f"loc_vault_hall_{world.id}", owner_id=user.id
    )
    assert b_rewound_vault.campaign.active_leaf_turn_id != vault_turn_id
    assert len(b_rewound_vault.active_branch_turns) == 2
    assert [c.title for c in b_rewound_vault.active_branch_turns[-1].post_turn.first_visit_cards] == [
        "Drowned Undercroft",
        "Tide Vault",
        "Ledger Chamber",
    ]

    # Toggling campaign World Settings via API applies forward-only without touching base world
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(main_module.app)
        resp = client.patch(
            f"/api/campaigns/{camp.id}/world-settings",
            json={"describe_on_first_visit": False},
        )
        assert resp.status_code == 200
        patched_bundle = resp.json()
        assert patched_bundle["campaign"]["world_settings"]["describe_on_first_visit"] is False
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)

    # Base world untouched (still True), and past branch arrival card stays intact while future visits emit nothing
    assert empty_repo.get_world(world.id, owner_id=user.id).global_rules.describe_on_first_visit is True
    b_no_cards = empty_repo.override_campaign_location(camp.id, f"loc_cellar_{world.id}", owner_id=user.id)
    assert len(b_no_cards.active_branch_turns) == 2
    assert b_no_cards.active_branch_turns[-1].post_turn.first_visit_cards[0].title == "Drowned Undercroft"


@pytest.mark.asyncio
async def test_clerk_move_attaches_first_visit_cards_to_triggering_turn(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Clerk movement attaches first_visit_cards to completed_turn post_turn_json without adding a separate turn row."""
    from app.engine.llm_client import llm_client

    world, char = _seed_nested_world_and_character(
        empty_repo, char_initial_message="Pull up a stool."
    )
    camp = empty_repo.create_campaign(
        name="Clerk Run",
        world_id=world.id,
        character_id=char.id,
        start_focus="world",
        opening_prose="Opening prose.",
    )
    bundle0 = empty_repo.get_campaign_state_bundle(camp.id)
    t0 = bundle0.active_branch_turns[0]
    vault_id = f"loc_vault_hall_{world.id}"

    # Seed Turn 1 user/prose turn before running Clerk
    saved_t1 = empty_repo.save_turn_node(
        turn_id="turn_clerk_1",
        campaign_id=camp.id,
        parent_turn_id=t0.id,
        depth_index=1,
        user_message="I head east into the Tide Vault.",
        actor_id=char.id,
        raw_prose="We descend into the flooded passage together.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(active_speaker_id=char.id, speaker_order=[char.id]),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_clerk_1",
            world_timestamp=t0.world_snapshot.world_timestamp,
            active_location_id=t0.world_snapshot.active_location_id,
            scene_flags=[],
            visited_location_ids=t0.world_snapshot.visited_location_ids,
            visited_container_ids=t0.world_snapshot.visited_container_ids,
        ),
        character_state=t0.character_state.model_copy(update={"turn_id": "turn_clerk_1"}),
        recalled_items=[],
    )

    async def _fake_structured(messages, schema_cls, **kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=4,
                transition_type="move_existing",
                target_location_id=vault_id,
            )
        raise AssertionError(f"Unexpected schema {schema_cls}")

    monkeypatch.setattr(llm_client, "complete_structured", _fake_structured)
    updated_turn, _chunks = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=saved_t1,
        active_location=bundle0.active_location,
        neighbors=bundle0.neighbor_locations,
        present_characters=[char],
        all_participants=[char],
        dispatch_mode="sequential",
    )

    assert [c.title for c in updated_turn.post_turn.first_visit_cards] == [
        "Drowned Undercroft",
        "Tide Vault",
        "Ledger Chamber",
    ]
    bundle_after = empty_repo.get_campaign_state_bundle(camp.id)
    assert len(bundle_after.active_branch_turns) == 2
    assert bundle_after.active_branch_turns[-1].id == saved_t1.id
    assert "cont_vault" in bundle_after.current_world_snapshot.visited_container_ids


def test_build_first_visit_arrival_legacy_backfill() -> None:
    """Legacy snapshots with populated visited_location_ids and empty visited_container_ids do not re-trigger visited ancestors."""
    c2 = LocationContainer(id="c2", world_id="w", depth=2, name="Ward", description="Old stone.")
    c1 = LocationContainer(
        id="c1", world_id="w", parent_container_id="c2", depth=1, name="Inn", description="Warm hearth."
    )
    room1 = LocationNode(
        id="r1", world_id="w", container_id="c1", name="Taproom", summary="s", description="Ale."
    )
    room2 = LocationNode(
        id="r2", world_id="w", container_id="c1", name="Loft", summary="s", description="Haylofts."
    )
    cards, locs, conts = build_first_visit_arrival(
        target_location=room2,
        containers=[c2, c1],
        locations=[room1, room2],
        prev_visited_locations=["r1"],
        prev_visited_containers=[],  # Legacy pre-migration state
        describe_on_first_visit=True,
    )
    assert [c.title for c in cards] == ["Loft"]
    assert set(locs) == {"r1", "r2"}
    assert set(conts) == {"c2", "c1"}
