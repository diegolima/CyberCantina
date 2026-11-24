"""Integration and unit tests for Phase 1 Empty / Solo Room Support (`actor_id = '__solo__'`)."""

from __future__ import annotations

import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import assemble_four_zone_messages
from app.main import _execute_turn_stream_events
from app.schemas.character import ItemInstance
from app.schemas.persona import PersonaCreatePayload, PersonaItemInstance
from app.schemas.turn import TurnSubmitRequest
from app.schemas.world import (
    LocationEdgeDraft,
    LocationLoreNodeDraft,
    LocationNodeDraft,
    WorldLoreNodeDraft,
)
from tests.factories import seed_character, seed_user, seed_world


def _seed_solo_test_scenario(empty_repo: CantinaRepository):
    """Seed a multi-room world with location secret lore and a persona for solo-room testing."""
    user = seed_user(empty_repo, role="admin")
    persona = empty_repo.create_persona(
        PersonaCreatePayload(
            name="Alex Mercer",
            inventory=[
                PersonaItemInstance(
                    name="Silver Flask",
                    note="Monogrammed steel hip flask.",
                    is_secret=True,
                    trigger_keywords=["silver flask"],
                )
            ],
        ),
        owner_id=user.id,
    )
    world = seed_world(
        empty_repo,
        owner_id=user.id,
        name="Sector Seven",
        locations=[
            LocationNodeDraft(
                key="main",
                name="Main Floor",
                summary="Bustling ground floor lounge.",
                description="Neon tubes buzz over scuffed booths and a scarred steel counter.",
                environmental_tags=["neon", "counter"],
                is_starting_location=True,
                is_hub=True,
            ),
            LocationNodeDraft(
                key="clinic",
                name="Backroom Clinic",
                summary="Abandoned triage annex behind the lounge.",
                description="Flickering surgical lamps cast pale light across rusted diagnostic trays.",
                environmental_tags=["surgical lamp", "lock", "trays"],
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="Clinic Triage Outage",
                        category="history",
                        content="The Backroom Clinic was abandoned after a substation blackout.",
                        entity_tags=["clinic", "triage", "blackout"],
                    ),
                    LocationLoreNodeDraft(
                        title="Hidden Keypad Bypass",
                        category="secret",
                        content="Behind the rusted maintenance plate sits a hidden keypad wired to the vault.",
                        entity_tags=["keypad", "maintenance plate", "lock"],
                    ),
                ],
            ),
            LocationNodeDraft(
                key="tunnels",
                name="Cooling Tunnels",
                summary="Sub-level coolant conduits.",
                description="Mist rises from insulated brine pipes along concrete walkways.",
                environmental_tags=["coolant", "pipes"],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="main",
                to_key="clinic",
                direction_label="Door to Backroom Clinic",
                reverse_direction_label="Door to Main Floor",
                compass_direction="E",
                reverse_compass_direction="W",
                distance_meters=140,
            ),
            LocationEdgeDraft(
                from_key="clinic",
                to_key="tunnels",
                direction_label="Hatch to Cooling Tunnels",
                reverse_direction_label="Ladder to Backroom Clinic",
                compass_direction="N",
                reverse_compass_direction="S",
                distance_meters=210,
            ),
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Syndicate Quarantine Protocol",
                category="faction",
                content="Orbital Syndicate sweepers sealed Sector Seven clinics during lockdown.",
                entity_tags=["syndicate", "quarantine", "clinic", "lockdown"],
            )
        ],
    )
    loc_by_name = {loc.name: loc for loc in world.locations}
    primary = seed_character(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        name="Vesper Operative",
        inventory=[
            ItemInstance(
                name="Medkit Syringe",
                note="Emergency stim dose.",
                flags=[],
            )
        ],
    )
    secondary = seed_character(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        name="Viktor Kestrel",
    )
    camp = empty_repo.create_campaign(
        name="Solo Room Test Campaign",
        world_id=world.id,
        character_id=primary.id,
        character_ids=[primary.id, secondary.id],
        character_locations={
            primary.id: loc_by_name["Main Floor"].id,
            secondary.id: loc_by_name["Cooling Tunnels"].id,
        },
        persona_id=persona.id,
        owner_id=user.id,
    )
    return user, persona, world, loc_by_name, primary, secondary, camp


async def test_solo_departure_and_full_solo_pipeline(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Moving alone leaves NPC behind and executes subsequent actions as '__solo__' without inventing or teleporting NPCs."""
    _user, persona, world, locs, primary, secondary, camp = _seed_solo_test_scenario(empty_repo)
    main_floor = locs["Main Floor"]
    clinic = locs["Backroom Clinic"]
    tunnels = locs["Cooling Tunnels"]

    # Turn 1: Move alone into empty Backroom Clinic
    t1_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I leave Vesper Operative at the counter and walk into the Backroom Clinic alone.",
            narrative_mode="standard",
        ),
    ):
        t1_events.append(packet)

    bundle1 = empty_repo.get_campaign_state_bundle(camp.id)
    assert bundle1.active_location.id == clinic.id
    assert bundle1.present_character_ids == []
    assert bundle1.character_states[primary.id].current_location_id == main_floor.id
    assert bundle1.character_states[secondary.id].current_location_id == tunnels.id

    # Capture assembled 4-zone prompt during solo Turn 2
    captured_messages: list[list[dict[str, str]]] = []
    original_assemble = assemble_four_zone_messages

    def _capture_assemble(*args, **kwargs):
        msgs = original_assemble(*args, **kwargs)
        captured_messages.append(msgs)
        return msgs

    monkeypatch.setattr(
        "app.routers.campaign_routes.turn_streaming.assemble_four_zone_messages",
        _capture_assemble,
    )

    # Turn 2: Act inside empty Backroom Clinic with forced critical success discovery roll + secret persona keyword
    t2_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I inspect the lock and search the clinic bench while checking my silver flask.",
            narrative_mode="standard",
            dice_mode="forced",
            manual_dice_override=19,
        ),
    ):
        t2_events.append(packet)

    event_names = [e["event"] for e in t2_events]
    assert "phase1_complete" in event_names
    assert "phase3_start" in event_names
    assert "phase3_complete" in event_names
    assert "cognition_complete" in event_names
    assert "turn_saved" in event_names
    assert "phase5_complete" in event_names

    p1_data = next(e["data"] for e in t2_events if e["event"] == "phase1_complete")
    p3_start = next(e["data"] for e in t2_events if e["event"] == "phase3_start")
    p3_done = next(e["data"] for e in t2_events if e["event"] == "phase3_complete")
    saved_turn = next(e["data"] for e in t2_events if e["event"] == "turn_saved")

    # Phase 1 solo sentinel, Solitary Action Guard, and solo roll fidelity
    assert p1_data["pre_turn"]["active_speaker_id"] == "__solo__"
    assert p1_data["pre_turn"]["speaker_order"] == []
    assert p1_data["pre_turn"]["character_rolls"] == {}
    assert p1_data["pre_turn"]["revealed_persona_keys"] == []
    solo_roll = p1_data["pre_turn"]["resolved_roll"]
    assert solo_roll is not None
    assert solo_roll["character_id"] == "__solo__"
    assert solo_roll["character_name"] == persona.name
    assert solo_roll["outcome_tier"] == "Critical Success"
    assert any(item["source_type"] in ("lore", "location_lore") for item in p1_data["recalled_items"])

    # Phase 3 cleanly skipped with empty roster
    assert p3_start["roster"] == []
    assert p3_done["cognitions"] == {}

    # Turn persisted under '__solo__' without leaking absent character name into prose
    assert saved_turn["actor_id"] == "__solo__"
    assert primary.name not in saved_turn["raw_prose"]
    assert secondary.name not in saved_turn["raw_prose"]

    # Prompt inspection: Solo directive + unlocked location secret + zero absent NPC states
    assert len(captured_messages) == 1
    sys_prompt = captured_messages[0][0]["content"]
    tail_prompt = captured_messages[0][-1]["content"]
    assert "SOLO SCENE PROTOCOL" in sys_prompt
    assert "<solo_scene_directive>" in tail_prompt
    assert "<other_characters_in_room>\n    - None (you are alone in this location)" in tail_prompt
    assert "<mechanics_outcome>" in tail_prompt
    assert "Hidden Keypad Bypass" in tail_prompt
    assert "<internal_affective_state" not in tail_prompt
    assert "<character_equipment_and_goals" not in tail_prompt

    # SQLite reload retains resolved_roll, keeps present_character_ids == [], and never teleports NPCs
    bundle2 = empty_repo.get_campaign_state_bundle(camp.id)
    leaf2 = bundle2.active_branch_turns[-1]
    assert leaf2.actor_id == "__solo__"
    assert leaf2.pre_turn.resolved_roll is not None
    assert leaf2.pre_turn.resolved_roll.character_id == "__solo__"
    assert leaf2.pre_turn.resolved_roll.character_name == persona.name
    assert leaf2.cognitions == {}
    assert bundle2.present_character_ids == []
    assert bundle2.character_states[primary.id].current_location_id == main_floor.id
    assert bundle2.character_states[secondary.id].current_location_id == tunnels.id


async def test_solo_auto_dice_vector_store_and_branch_item_operations(
    empty_repo: CantinaRepository,
) -> None:
    """Verify auto dice rolls, empty-char GraphRAG recall, and swipe/edit/checkout/delete/item operations on '__solo__' turns."""
    _user, persona, world, locs, primary, _secondary, camp = _seed_solo_test_scenario(empty_repo)
    main_floor = locs["Main Floor"]
    clinic = locs["Backroom Clinic"]

    # Move primary character alone into Backroom Clinic? First move player alone via Turn 1
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I walk into the Backroom Clinic alone.",
            narrative_mode="standard",
        ),
    ):
        pass

    # 1. Direct Phase 1 unit test with present_characters=[] in auto dice mode
    pre_auto = await run_phase1_pre_analysis(
        user_message="I pry open the jammed steel locker.",
        character=primary,
        active_location=clinic,
        neighbors=empty_repo.get_neighbor_locations(world.id, clinic.id),
        known_entities=["locker"],
        dice_mode="auto",
        present_characters=[],
        persona_snapshot=persona,
    )
    assert pre_auto.active_speaker_id == "__solo__"
    assert pre_auto.speaker_order == []
    assert pre_auto.character_rolls == {}
    assert pre_auto.revealed_persona_keys == []
    assert pre_auto.resolved_roll is not None
    assert pre_auto.resolved_roll.character_id == "__solo__"
    assert pre_auto.resolved_roll.character_name == persona.name

    # 2. Direct VectorStore test with character_ids=[] retrieves world/location lore & chunks without IN () SQL errors
    bundle_pre = empty_repo.get_campaign_state_bundle(camp.id)
    branch_ids = {t.id for t in bundle_pre.active_branch_turns}
    await empty_repo.vector_store.aupsert_entry(
        entry_id="shard_private_primary",
        source_type="character_shard",
        world_id=world.id,
        character_id=primary.id,
        title="Private Operative Secret",
        content="Only Vesper knows the hidden syndication passcode for Backroom Clinic.",
        keywords=["passcode", "clinic"],
    )
    empty_repo.save_episodic_chunk(
        campaign_id=camp.id,
        world_id=world.id,
        character_id=None,
        start_turn_depth=0,
        end_turn_depth=1,
        leaf_turn_id=bundle_pre.active_branch_turns[-1].id,
        title="Quiet Arrival at Clinic",
        summary_text="The protagonist stepped alone into the quiet Backroom Clinic.",
        keywords=["clinic", "quiet"],
    )
    recall = await empty_repo.vector_store.search_memories_for_characters(
        queries=["Syndicate clinic quarantine blackout passcode"],
        mentioned_entities=["Backroom Clinic"],
        world_id=world.id,
        character_ids=[],
        campaign_id=camp.id,
        valid_branch_turn_ids=branch_ids,
        character_witnessed_turn_ids={},
        exclude_location_id=clinic.id,
    )
    assert recall.by_character == {}
    recalled_types = {item.source_type for item in recall.shared_scene_items}
    assert "character_shard" not in recalled_types
    assert "lore" in recalled_types or "episodic_chunk" in recalled_types

    # 3. Execute solo turn v1 (with auto risky action), then swipe v2, edit, checkout, toggle item, and delete last turn
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I hack into the broken wall terminal.",
            narrative_mode="standard",
            dice_mode="auto",
        ),
    ):
        pass
    bundle_v1 = empty_repo.get_campaign_state_bundle(camp.id)
    t_v1 = bundle_v1.active_branch_turns[-1]
    assert t_v1.actor_id == "__solo__"
    assert t_v1.pre_turn.resolved_roll is not None
    assert len(empty_repo.list_campaign_turn_nodes(camp.id)) >= 3

    # Swipe v2 off parent of t_v1 with forced roll
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message=t_v1.user_message,
            parent_turn_id=t_v1.parent_turn_id,
            narrative_mode="standard",
            dice_mode="forced",
            manual_dice_override=15,
        ),
    ):
        pass
    bundle_v2 = empty_repo.get_campaign_state_bundle(camp.id)
    t_v2 = bundle_v2.active_branch_turns[-1]
    assert t_v2.id != t_v1.id
    assert t_v2.actor_id == "__solo__"
    assert t_v2.pre_turn.resolved_roll is not None
    assert t_v2.pre_turn.resolved_roll.d20_raw == 15

    # Checkout v1 and inspect get_turn_node directly
    checked_v1 = empty_repo.checkout_turn_branch(camp.id, t_v1.id)
    assert checked_v1.active_branch_turns[-1].id == t_v1.id
    reloaded_v1 = empty_repo.get_turn_node(t_v1.id)
    assert reloaded_v1.actor_id == "__solo__"
    assert reloaded_v1.pre_turn.resolved_roll is not None
    assert checked_v1.character_states[primary.id].current_location_id == main_floor.id

    # Toggle campaign item while active leaf turn is '__solo__'
    toggled = empty_repo.toggle_campaign_item_equip(
        camp.id,
        character_id=primary.id,
        item="Medkit Syringe",
        action="equip",
    )
    assert any(it.name == "Medkit Syringe" for it in toggled.character_states[primary.id].equipped)

    # Delete last '__solo__' turn cleanly
    after_delete = empty_repo.delete_last_turn(camp.id)
    assert after_delete.active_branch_turns[-1].id == t_v1.parent_turn_id
    assert after_delete.character_states[primary.id].current_location_id == main_floor.id


async def test_solo_room_remote_comms_and_narrator_preserve_absent_npc_locations(
    empty_repo: CantinaRepository,
) -> None:
    """Narrator turns and remote '@Name:' comms whispers inside an empty room never move off-site NPCs."""
    _user, _persona, _world, locs, primary, secondary, camp = _seed_solo_test_scenario(empty_repo)
    main_floor = locs["Main Floor"]
    clinic = locs["Backroom Clinic"]
    tunnels = locs["Cooling Tunnels"]

    # Step 1: Player moves alone to Backroom Clinic
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I head to the Backroom Clinic alone.",
            narrative_mode="standard",
        ),
    ):
        pass

    # Step 2: Narrator Describe (/look) & Advance (/wait 15m) inside empty Backroom Clinic
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(user_message="", narrative_mode="describe"),
    ):
        pass
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(user_message="", narrative_mode="advance", duration_minutes=15),
    ):
        pass

    bundle_narr = empty_repo.get_campaign_state_bundle(camp.id)
    assert bundle_narr.active_location.id == clinic.id
    assert bundle_narr.present_character_ids == []
    assert bundle_narr.active_branch_turns[-1].actor_id == "__narrator__"
    assert bundle_narr.character_states[primary.id].current_location_id == main_floor.id
    assert bundle_narr.character_states[secondary.id].current_location_id == tunnels.id

    # Step 3: Send remote comms whisper to off-site Vesper Operative from empty Backroom Clinic
    primary_before = bundle_narr.character_states[primary.id]
    prev_elapsed = primary_before.care_state.state_elapsed_minutes if primary_before.care_state else 0
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message='@Vesper Operative: "Clinic terminal is dark, stay at the counter and watch the front."',
            narrative_mode="standard",
        ),
    ):
        pass

    bundle_comms = empty_repo.get_campaign_state_bundle(camp.id)
    last_comms_turn = bundle_comms.active_branch_turns[-1]
    assert last_comms_turn.actor_id == "__solo__"
    assert bundle_comms.present_character_ids == []
    assert bundle_comms.character_states[primary.id].current_location_id == main_floor.id
    assert bundle_comms.character_states[secondary.id].current_location_id == tunnels.id
    primary_after = bundle_comms.character_states[primary.id]
    assert primary_after.care_state is not None
    assert primary_after.care_state.state_elapsed_minutes >= prev_elapsed


async def test_episodic_chunk_across_solo_turns_excludes_sentinels_and_npc_vector_ids(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Episodic summarization across '__solo__' turns excludes sentinels from witnesses and avoids absent NPC vector tags."""
    _user, _persona, _world, locs, primary, _secondary, camp = _seed_solo_test_scenario(empty_repo)
    clinic = locs["Backroom Clinic"]

    # Force episodic summarization quickly and keep Clerk on offline fallback
    monkeypatch.setattr(settings.memory_config, "working_memory_turns", 2)
    monkeypatch.setattr(settings.memory_config, "episodic_chunk_size", 2)
    monkeypatch.setattr(llm_client, "complete_structured", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("offline")))

    # Turn 1: Move player alone to Backroom Clinic
    async for _ in _execute_turn_stream_events(
        campaign_id=camp.id,
        req=TurnSubmitRequest(
            user_message="I head to the Backroom Clinic alone.",
            narrative_mode="standard",
        ),
    ):
        pass

    # Turns 2..5: Purely solo turns in Backroom Clinic so at least one chunk covers ONLY '__solo__' turns
    for msg in (
        "I examine the surgical trays for serial numbers.",
        "I check the ventilation slats near the ceiling.",
        "I test the emergency bypass breaker behind the panel.",
        "I catalog the dusty logbooks left on the cart.",
    ):
        async for _ in _execute_turn_stream_events(
            campaign_id=camp.id,
            req=TurnSubmitRequest(user_message=msg, narrative_mode="standard"),
        ):
            pass

    bundle = empty_repo.get_campaign_state_bundle(camp.id)
    assert bundle.active_location.id == clinic.id
    assert bundle.present_character_ids == []
    assert len(bundle.episodic_chunks) >= 2
    for chunk in bundle.episodic_chunks:
        assert "__solo__" not in chunk.witness_character_ids
        assert "__narrator__" not in chunk.witness_character_ids
        assert "__arrival__" not in chunk.witness_character_ids

    # Any chunk composed strictly of solo turns (>= Turn 2) must have zero witnesses & NULL vector character_id
    pure_solo_chunks = [c for c in bundle.episodic_chunks if c.start_turn_depth >= 2]
    assert len(pure_solo_chunks) >= 1
    assert all(c.witness_character_ids == [] for c in pure_solo_chunks)

    solo_turn_ids = [
        t.id for t in bundle.active_branch_turns if t.actor_id == "__solo__"
    ]
    assert len(solo_turn_ids) >= 4
    conn = empty_repo._connect()
    try:
        ev_ids = [f"event_{tid}" for tid in solo_turn_ids]
        ev_placeholders = ",".join("?" for _ in ev_ids)
        ev_rows = conn.execute(
            f"SELECT id, character_id FROM vector_entries WHERE id IN ({ev_placeholders})",
            ev_ids,
        ).fetchall()
        chunk_placeholders = ",".join("?" for _ in pure_solo_chunks)
        chunk_rows = conn.execute(
            f"SELECT id, character_id FROM vector_entries WHERE id IN ({chunk_placeholders})",
            [c.id for c in pure_solo_chunks],
        ).fetchall()
    finally:
        conn.close()
    assert ev_rows
    for r in ev_rows:
        assert r["character_id"] is None
    assert chunk_rows
    for r in chunk_rows:
        assert r["character_id"] is None
