"""Unit and integration tests for CyberCantina's 4-Phase Engine, Spatial Graph, and Branch Rollback."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from app.db import vector_store as vs_module
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine import phase4_clerk as p4_module
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.engine.phase2_context import assemble_four_zone_messages
from app.engine.phase3_actor import parse_cognition_xml
from app.engine.phase4_clerk import merge_inventory, merge_scene_flags
from app.main import _execute_turn_stream_events
from app.schemas.character import CharacterUpdatePayload, CharacterWizardSeed
from app.schemas.turn import ImprovisedLocationSpec, TurnSubmitRequest
from app.schemas.world import COMPASS_DIRECTIONS, WorldUpdatePayload, WorldWizardSeed
from app.wizards.character_wizard import generate_character_draft
from app.wizards.world_wizard import generate_world_draft


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_cantina.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


async def test_default_seed_and_hybrid_rag(temp_repo: CantinaRepository) -> None:
    """Verify default seeded campaign, spatial graph neighbors, and hybrid GraphRAG memory search."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    assert bundle.campaign.name == "Midnight at the Neon Rust"
    assert bundle.active_location.name == "The Neon Rust Main Floor"
    assert len(bundle.neighbor_locations) == 3  # Clinic, Mezzanine, Cargo Alley

    valid_turns = {t.id for t in bundle.active_branch_turns}
    recalled = await temp_repo.vector_store.search_memories(
        queries=["What happened during the Meridian Heist with the Chimera chip?"],
        mentioned_entities=["meridian", "chimera"],
        world_id=bundle.campaign.world_id,
        character_id=bundle.campaign.character_id,
        campaign_id=bundle.campaign.id,
        valid_branch_turn_ids=valid_turns,
        top_k=3,
    )
    assert len(recalled) >= 2
    titles = " ".join(r.title for r in recalled)
    assert "Meridian" in titles or "Chimera" in titles


async def test_phase1_rng_and_phase3_cognition_parser(temp_repo: CantinaRepository) -> None:
    """Verify Phase 1 triggers RNG checks on risky actions and Phase 3 parses <cognition> XML."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    char = temp_repo.get_character(bundle.campaign.character_id)

    pre = await run_phase1_pre_analysis(
        user_message="I try to hack the encrypted Vespera terminal before the patrol spots us.",
        character=char,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        known_entities=["Vespera", "Kira Vance"],
        manual_dice_override=19,
    )
    assert pre.mechanics_check.requires_roll is True
    assert pre.resolved_roll is not None
    assert pre.resolved_roll.d20_raw == 19
    assert "Success" in pre.resolved_roll.outcome_tier

    sample_xml = (
        "<cognition>\n"
        "  <recall>They survived the Meridian Heist six months ago.</recall>\n"
        "  <feeling valence=\"-0.35\" arousal=\"0.80\">Tense and protective.</feeling>\n"
        "  <want>Get them into the Backroom Ripperdoc Bay immediately.</want>\n"
        "  <plan>Motion toward the lead-lined curtain and lock the front door.</plan>\n"
        "</cognition>"
    )
    parsed = parse_cognition_xml(sample_xml, bundle.current_character_state)
    assert parsed.valence == -0.35
    assert parsed.arousal == 0.80
    assert "Meridian Heist" in parsed.recall
    assert "Ripperdoc Bay" in parsed.want


async def test_four_zone_prompt_layout_stability(temp_repo: CantinaRepository) -> None:
    """Verify Zone 1 static prefix stays identical across turns while Zone 4 holds dynamic context."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    world = temp_repo.get_world(bundle.campaign.world_id)
    char = temp_repo.get_character(bundle.campaign.character_id)

    msgs_1 = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=[],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=bundle.active_branch_turns[-1].pre_turn,
        user_message="First message",
    )
    msgs_2 = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=[],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=bundle.active_branch_turns[-1].pre_turn,
        user_message="Second message with different tail",
    )
    # Zone 1 Static Prefix must be 100% byte-identical for KV-cache hits
    assert msgs_1[0]["content"] == msgs_2[0]["content"]
    assert "<scene_context>" in msgs_2[-1]["content"]
    assert "Second message with different tail" in msgs_2[-1]["content"]


async def test_turn_pipeline_spatial_move_and_branch_rollback(
    temp_repo: CantinaRepository,
) -> None:
    """Verify full 4-phase turn execution, spatial movement, and git-like branch state rollback."""
    initial_bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    root_turn_id = initial_bundle.active_branch_turns[-1].id
    initial_clock = initial_bundle.current_world_snapshot.world_timestamp
    initial_loc_id = initial_bundle.active_location.id

    # Execute Turn 1: Move into the Backroom Ripperdoc Bay
    req_branch_a = TurnSubmitRequest(
        user_message="Let's head into the Backroom Ripperdoc Bay behind the curtain right now.",
        parent_turn_id=root_turn_id,
    )
    async for _ev in _execute_turn_stream_events("camp_neon_rust_default", req_branch_a):
        pass

    bundle_after_a = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    turn_1a_id = bundle_after_a.active_branch_turns[-1].id
    assert bundle_after_a.current_world_snapshot.world_timestamp != initial_clock
    assert bundle_after_a.active_location.name == "Backroom Ripperdoc Bay"

    # Now SWIPE / BRANCH from root_turn_id with a completely different action (staying at the bar)
    req_branch_b = TurnSubmitRequest(
        user_message="I stay right here at the main bar and ask about Vespera Biotech.",
        parent_turn_id=root_turn_id,
    )
    async for _ev in _execute_turn_stream_events("camp_neon_rust_default", req_branch_b):
        pass

    bundle_after_b = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    assert len(bundle_after_b.active_branch_turns) == 2
    assert bundle_after_b.active_location.id == initial_loc_id
    assert bundle_after_b.active_location.name == "The Neon Rust Main Floor"

    # Checkout Branch A again and verify state restores to Backroom Ripperdoc Bay
    restored_a = temp_repo.checkout_turn_branch("camp_neon_rust_default", turn_1a_id)
    assert restored_a.active_location.name == "Backroom Ripperdoc Bay"


async def test_character_and_world_wizards(temp_repo: CantinaRepository) -> None:
    """Verify 1.1 Character Wizard and 1.2 World Graph Wizard draft + commit flows."""
    w_seed = WorldWizardSeed(
        name="Aethelgard Clockwork Citadel",
        genre_and_tone="Steampunk Arcane Mystery",
        core_premise="A vertical brass metropolis powered by bound elemental engines.",
        initial_hub_concept="The Obsidian Gear Tavern",
        location_count=4,
    )
    w_draft = await generate_world_draft(w_seed)
    assert all(edge.compass_direction is not None for edge in w_draft.edges)
    assert all(loc.is_hub is False for loc in w_draft.locations)
    # Simulate editing the draft in the World Sheet before committing (e.g. changing starting location)
    w_draft.locations[0].is_starting_location = False
    w_draft.locations[1].is_starting_location = True
    created_world = temp_repo.create_world_from_draft(w_draft)
    assert len(created_world.locations) >= 3
    assert len(created_world.edges) >= 3
    starting_locs = [loc for loc in created_world.locations if loc.is_starting_location]
    assert len(starting_locs) == 1
    assert starting_locs[0].name == w_draft.locations[1].name
    assert starting_locs[0].is_hub is False

    c_seed = CharacterWizardSeed(
        name="Master Artificer Thorne",
        archetype="Disgraced clockwork investigator",
        role_in_story="Reluctant mentor",
        personality_keywords=["meticulous", "cynical", "loyal"],
        rough_notes="Carries a pocket watch that ticks backward near arcane anomalies.",
        world_id=created_world.id,
    )
    c_draft = await generate_character_draft(c_seed, world=created_world)
    created_char = temp_repo.create_character_from_draft(c_draft, world_id=created_world.id)
    assert created_char.name == "Master Artificer Thorne"
    assert len(created_char.memory_shards) >= 3


async def test_character_pending_deletion_and_campaign_pruning(
    temp_repo: CantinaRepository,
) -> None:
    """Verify soft-deleting an in-use character hides it from UI list, keeps campaign alive, and prunes after campaign deletion."""
    # Kira Vance is used by 'camp_neon_rust_default'
    camp = temp_repo.get_campaign("camp_neon_rust_default")
    assert "char_kira_vance" in camp.participant_character_ids

    res = temp_repo.mark_character_pending_deletion("char_kira_vance")
    assert res["pending_deletion"] is True
    assert res["campaigns_using"] == 1

    w_res = temp_repo.mark_world_pending_deletion("world_neon_rust")
    assert w_res["pending_deletion"] is True
    assert w_res["campaigns_using"] == 1

    # Hidden from standard UI character & world lists
    visible_chars = temp_repo.list_characters()
    assert all(c.id != "char_kira_vance" for c in visible_chars)
    visible_worlds = temp_repo.list_worlds()
    assert all(w.id != "world_neon_rust" for w in visible_worlds)

    # Pruner must NOT delete Kira or Neon Rust while the campaign still exists
    pruned_while_in_use = temp_repo.prune_pending_deletion_characters()
    assert "char_kira_vance" not in pruned_while_in_use
    pruned_worlds_while_in_use = temp_repo.prune_pending_deletion_worlds()
    assert "world_neon_rust" not in pruned_worlds_while_in_use

    # Campaign & direct lookup still have full access to Kira's & World's data
    still_alive = temp_repo.get_character("char_kira_vance")
    assert still_alive.pending_deletion is True
    still_alive_world = temp_repo.get_world("world_neon_rust")
    assert still_alive_world.pending_deletion is True
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    assert bundle.campaign.character_id == "char_kira_vance"

    # Now delete the campaign and run the pruners
    temp_repo.delete_campaign("camp_neon_rust_default")
    assert temp_repo.list_campaigns() == []

    pruned_after = temp_repo.prune_pending_deletion_characters()
    assert "char_kira_vance" in pruned_after
    pruned_worlds_after = temp_repo.prune_pending_deletion_worlds()
    assert "world_neon_rust" in pruned_worlds_after

    with pytest.raises(KeyError):
        temp_repo.get_character("char_kira_vance")
    with pytest.raises(KeyError):
        temp_repo.get_world("world_neon_rust")


async def test_character_and_world_silent_versioning(
    temp_repo: CantinaRepository,
) -> None:
    """Verify editing a referenced character/world forks a new version while freezing the campaign's snapshot."""
    orig_char = temp_repo.get_character("char_kira_vance")
    orig_world = temp_repo.get_world("world_neon_rust")

    # 1. Edit Kira Vance while referenced by 'camp_neon_rust_default' -> should fork a new character ID
    forked_char = temp_repo.update_character(
        "char_kira_vance",
        CharacterUpdatePayload(
            name="Kira Vance (Rebuilt)",
            tagline="Upgraded Street Doc",
            core_persona=orig_char.core_persona,
            voice_anchors=orig_char.voice_anchors,
            baseline_psyche=orig_char.baseline_psyche,
            memory_shards=orig_char.memory_shards,
            world_id=orig_char.world_id,
        ),
    )
    assert forked_char.id != "char_kira_vance"
    assert forked_char.name == "Kira Vance (Rebuilt)"

    # Old character remains untouched for the running campaign, but hidden from list_characters()
    frozen_char = temp_repo.get_character("char_kira_vance")
    assert frozen_char.name == "Kira Vance"
    assert frozen_char.pending_deletion is True
    visible_char_ids = [c.id for c in temp_repo.list_characters()]
    assert forked_char.id in visible_char_ids
    assert "char_kira_vance" not in visible_char_ids

    # 2. Edit Neon Rust while referenced by 'camp_neon_rust_default' -> should fork a new world ID
    forked_world = temp_repo.update_world(
        "world_neon_rust",
        WorldUpdatePayload(
            name="Sector 9: Neon Rust (v2)",
            global_rules=orig_world.global_rules,
            locations=orig_world.locations,
            edges=orig_world.edges,
            lore_nodes=orig_world.lore_nodes,
        ),
    )
    assert forked_world.id != "world_neon_rust"
    assert forked_world.name == "Sector 9: Neon Rust (v2)"

    # Old world remains untouched for the running campaign, while active characters repoint to forked_world
    frozen_world = temp_repo.get_world("world_neon_rust")
    assert frozen_world.name == orig_world.name
    assert frozen_world.pending_deletion is True
    assert temp_repo.get_character(forked_char.id).world_id == forked_world.id

    # 3. Editing the newly forked (unreferenced) character/world updates in-place without spawning another version
    inplace_char = temp_repo.update_character(
        forked_char.id,
        CharacterUpdatePayload(
            name="Kira Vance (Final)",
            tagline=forked_char.tagline,
            core_persona=forked_char.core_persona,
            voice_anchors=forked_char.voice_anchors,
            baseline_psyche=forked_char.baseline_psyche,
            memory_shards=forked_char.memory_shards,
            world_id=forked_world.id,
        ),
    )
    assert inplace_char.id == forked_char.id
    assert inplace_char.name == "Kira Vance (Final)"


async def test_scene_flags_merge_and_zone4_rendering(
    temp_repo: CantinaRepository,
) -> None:
    """Verify Fix D: scene_flags merge incrementally without overwriting, and render in Zone 4 with relationship_notes."""
    assert merge_scene_flags(
        ["Scene Opening", "Door Locked"],
        ["Alarm Armed", "-Door Locked", "Scene Opening"],
    ) == ["Scene Opening", "Alarm Armed"]
    assert merge_scene_flags(
        ["Scene Opening", "Temp Buff"],
        ["Keycard Acquired"],
        removed_flags=["temp buff"],
    ) == ["Scene Opening", "Keycard Acquired"]

    # Execute a turn that moves to Backroom Ripperdoc Bay -> should add a flag while preserving 'Scene Opening'
    req = TurnSubmitRequest(
        user_message="Let's head into the Backroom Ripperdoc Bay right now.",
    )
    async for _ev in _execute_turn_stream_events("camp_neon_rust_default", req):
        pass

    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    flags = bundle.current_world_snapshot.scene_flags
    assert "Scene Opening" in flags
    assert any("Backroom Ripperdoc Bay" in f for f in flags)

    world = temp_repo.get_world(bundle.campaign.world_id)
    char = temp_repo.get_character(bundle.campaign.character_id)
    msgs = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=bundle.active_branch_turns,
        episodic_chunks=bundle.episodic_chunks,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=bundle.active_branch_turns[-1].pre_turn,
        user_message="Check the surgical monitors.",
    )
    zone4_tail = msgs[-1]["content"]
    assert "<scene_flags>" in zone4_tail
    assert "Scene Opening" in zone4_tail
    assert "Relationship Notes:" in zone4_tail
    assert "Acquaintance / Uncertain trust" in zone4_tail


async def test_async_embedding_upsert_shares_active_profile(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Fix B: async upserts use embed_text so stored and queried vectors share the same embedding space."""
    import numpy as np

    embed_calls: list[str] = []

    async def fake_neural_embed(text: str) -> np.ndarray:
        embed_calls.append(text)
        vec = np.ones(768, dtype=np.float32)
        if "chimera" in text.lower() or "neural" in text.lower():
            vec[0] = 5.0
        vec /= float(np.linalg.norm(vec))
        return vec

    monkeypatch.setattr(vs_module, "embed_text", fake_neural_embed)
    monkeypatch.setattr("app.db.repository.embed_text", fake_neural_embed)

    await temp_repo.vector_store.aupsert_entry(
        entry_id="event_custom_768",
        source_type="episodic_chunk",
        world_id="world_neon_rust",
        character_id="char_kira_vance",
        campaign_id="camp_neon_rust_default",
        anchor_turn_id=None,
        title="Custom Neural Event",
        content="Calibrated the Chimera neural link in the trauma bay.",
        keywords=["chimera", "neural"],
    )
    assert len(embed_calls) >= 1

    # Verify stored blob has 768 float32 dimensions (3072 bytes), matching fake_neural_embed
    conn = temp_repo.vector_store._connect()
    try:
        row = conn.execute(
            "SELECT embedding_blob FROM vector_entries WHERE id = 'event_custom_768'"
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    stored_vec = np.frombuffer(row["embedding_blob"], dtype=np.float32)
    assert stored_vec.shape == (768,)

    recalled = await temp_repo.vector_store.search_memories(
        queries=["Chimera neural link calibration"],
        mentioned_entities=["chimera"],
        world_id="world_neon_rust",
        character_id="char_kira_vance",
        campaign_id="camp_neon_rust_default",
        valid_branch_turn_ids=set(),
        top_k=3,
    )
    assert any(item.id == "event_custom_768" for item in recalled)


async def test_phase4_concurrent_episodic_compression(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Fix A: Phase 4 runs state delta extraction and chunk summarization concurrently when threshold is exceeded."""
    monkeypatch.setattr(settings.memory_config, "working_memory_turns", 2)
    monkeypatch.setattr(settings.memory_config, "episodic_chunk_size", 2)

    summarize_called = False
    orig_summarize = p4_module.summarize_turn_chunk

    async def tracked_summarize(turns, character, *args, **kwargs):
        nonlocal summarize_called
        summarize_called = True
        return await orig_summarize(turns, character, *args, **kwargs)

    monkeypatch.setattr(p4_module, "summarize_turn_chunk", tracked_summarize)

    for i in range(3):
        req = TurnSubmitRequest(user_message=f"Turn exchange {i + 1} at the bar.")
        async for _ev in _execute_turn_stream_events("camp_neon_rust_default", req):
            pass

    assert summarize_called is True
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    assert len(bundle.episodic_chunks) >= 1


async def test_multi_character_turn_orchestration_and_spatial_room_isolation(
    temp_repo: CantinaRepository,
) -> None:
    """Verify Fix C: Multiple NPCs in the same room take turns/respond by name, while NPCs in another room don't eavesdrop."""
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)
    clinic = next(loc for loc in world.locations if "Ripperdoc" in loc.name)

    # Create a second character (Viktor, stationed in the Main Bar alongside Kira)
    viktor_draft = await generate_character_draft(
        CharacterWizardSeed(
            name="Viktor",
            archetype="Old cyberware street tech",
            role_in_story="Veteran mechanic",
            personality_keywords=["gruff", "technical"],
            world_id=world.id,
        ),
        world=world,
    )
    viktor = await temp_repo.acreate_character_from_draft(
        viktor_draft, world_id=world.id, character_id="char_viktor"
    )

    # Create a third character (Nyx, stationed in the Backroom Ripperdoc Bay)
    nyx_draft = await generate_character_draft(
        CharacterWizardSeed(
            name="Nyx",
            archetype="Shadow netrunner hiding in the clinic",
            role_in_story="Informant",
            personality_keywords=["cryptic", "alert"],
            world_id=world.id,
        ),
        world=world,
    )
    nyx = await temp_repo.acreate_character_from_draft(
        nyx_draft, world_id=world.id, character_id="char_nyx"
    )

    # Add Viktor to the Main Bar and Nyx to the Backroom Clinic
    temp_repo.add_character_to_campaign(
        "camp_neon_rust_default", viktor.id, location_id=main_bar.id
    )
    bundle = temp_repo.add_character_to_campaign(
        "camp_neon_rust_default", nyx.id, location_id=clinic.id
    )
    assert set(bundle.present_character_ids) == {"char_kira_vance", "char_viktor"}
    assert "char_nyx" not in bundle.present_character_ids

    # Turn 1 in Main Bar: Explicitly address Viktor -> Viktor should be selected as active_speaker_id, NOT Nyx
    req1 = TurnSubmitRequest(
        user_message="Viktor, can you inspect the servo wiring on this cyber-arm? Secret code word: ALPHA_BAR_ONLY."
    )
    async for _ev in _execute_turn_stream_events("camp_neon_rust_default", req1):
        pass

    bundle_after_1 = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    turn_1 = bundle_after_1.active_branch_turns[-1]
    assert turn_1.actor_id == "char_viktor"
    assert turn_1.pre_turn.active_speaker_id == "char_viktor"
    assert "char_nyx" not in turn_1.pre_turn.speaker_order

    # Verify that Nyx (stationed in the Clinic) does NOT see the Main Bar conversation in her Zone 3 Working Memory!
    nyx_messages = assemble_four_zone_messages(
        world=world,
        character=nyx,
        branch_turns=bundle_after_1.active_branch_turns,
        episodic_chunks=[],
        active_location=clinic,
        neighbors=[],
        recalled_items=[],
        pre_turn=turn_1.pre_turn,
        user_message="Nyx, did you hear anything from the bar?",
        present_characters=[nyx],
    )
    combined_nyx_prompt = "\n".join(m["content"] for m in nyx_messages)
    assert "ALPHA_BAR_ONLY" not in combined_nyx_prompt

    # Meanwhile, Kira (who WAS in the Main Bar during Turn 1) DOES see Turn 1 in her Zone 3 Working Memory!
    kira = temp_repo.get_character("char_kira_vance")
    kira_messages = assemble_four_zone_messages(
        world=world,
        character=kira,
        branch_turns=bundle_after_1.active_branch_turns,
        episodic_chunks=[],
        active_location=main_bar,
        neighbors=[],
        recalled_items=[],
        pre_turn=turn_1.pre_turn,
        user_message="Kira, what do you think of Viktor's assessment?",
        present_characters=[kira, viktor],
    )
    combined_kira_prompt = "\n".join(m["content"] for m in kira_messages)
    assert "ALPHA_BAR_ONLY" in combined_kira_prompt


async def test_character_appearance_initial_message_and_dynamic_inventory(
    temp_repo: CantinaRepository,
) -> None:
    """Verify physical_appearance in Zone 1, editable initial_message seeding Turn 0, and Clerk dynamic inventory with branch rollback."""
    # 1. Verify merge_inventory handles exact, tag-stripped, and substring removals cleanly
    initial_inv = [
        "[Worn] Dark charcoal utility tank top",
        "[Worn] Oil-stained leather ripperdoc apron",
        "Diagnostic medical penlight",
    ]
    merged = merge_inventory(
        initial_inv,
        added_items=["[Worn] Thermal stealth cloak", "Encrypted bio-drive"],
        removed_items=["ripperdoc apron", "Diagnostic medical penlight"],
    )
    assert "[Worn] Dark charcoal utility tank top" in merged
    assert "[Worn] Thermal stealth cloak" in merged
    assert "Encrypted bio-drive" in merged
    assert all("apron" not in item.lower() for item in merged)
    assert all("penlight" not in item.lower() for item in merged)

    # 2. Verify Wizard generates physical_appearance, initial_message, equipped, and inventory, and editing updates them
    world = temp_repo.get_world("world_neon_rust")
    draft = await generate_character_draft(
        CharacterWizardSeed(
            name="kael_test",
            archetype="Cybernetic courier",
            role_in_story="Smuggler contact",
            personality_keywords=["sharp", "wary"],
            rough_notes="Carries a silver neural key.",
            world_id=world.id,
        ),
        world=world,
    )
    assert draft.physical_appearance.strip() != ""
    assert draft.initial_message.strip() != ""
    assert len(draft.equipped) >= 1 or len(draft.inventory) >= 1

    created = temp_repo.create_character_from_draft(draft, world_id=world.id)
    updated = temp_repo.update_character(
        created.id,
        CharacterUpdatePayload(
            name="Kaelen Vex",
            tagline=created.tagline,
            physical_appearance="Tall, lean courier with a silver ocular implant and a jagged scar across his left cheek.",
            core_persona=created.core_persona,
            initial_message="*Inside {location_name}, Kaelen checks his chronometer.*\n\n\"You brought the package?\"",
            equipped=["Armored synth-leather jacket", "Cargo trousers"],
            inventory=["Silver neural key"],
            voice_anchors=created.voice_anchors,
            baseline_psyche=created.baseline_psyche,
            memory_shards=created.memory_shards,
            world_id=world.id,
        ),
    )
    assert "silver ocular implant" in updated.physical_appearance
    assert "You brought the package?" in updated.initial_message
    assert "Armored synth-leather jacket" in updated.equipped
    assert "Silver neural key" in updated.inventory

    # 3. Launching a campaign uses character.initial_message (with {location_name} resolved) and seeds Turn 0 equipped & inventory
    camp = temp_repo.create_campaign(
        name="Kaelen Courier Run",
        world_id=world.id,
        character_id=updated.id,
    )
    bundle_0 = temp_repo.get_campaign_state_bundle(camp.id)
    turn_0 = bundle_0.active_branch_turns[0]
    assert "The Neon Rust Main Floor" in turn_0.raw_prose
    assert "You brought the package?" in turn_0.raw_prose
    assert bundle_0.current_character_state.equipped == [
        "Armored synth-leather jacket",
        "Cargo trousers",
    ]
    assert bundle_0.current_character_state.inventory == [
        "Silver neural key",
    ]

    # Test interactive equipping & unequipping via toggle_campaign_item_equip
    toggled = temp_repo.toggle_campaign_item_equip(
        camp.id,
        item="Silver neural key",
        action="equip",
    )
    assert "Silver neural key" in toggled.current_character_state.equipped
    assert "Silver neural key" not in toggled.current_character_state.inventory

    toggled_back = temp_repo.toggle_campaign_item_equip(
        camp.id,
        item="Silver neural key",
        action="unequip",
    )
    assert "Silver neural key" in toggled_back.current_character_state.inventory
    assert "Silver neural key" not in toggled_back.current_character_state.equipped

    # 4. Execute Turn 1 where Kaelen takes off his jacket and receives an encrypted datapad
    req_turn_1 = TurnSubmitRequest(
        user_message="Take off your synth-leather jacket so you blend in, and I hand you an encrypted datapad.",
    )
    async for _ev in _execute_turn_stream_events(camp.id, req_turn_1):
        pass

    bundle_1 = temp_repo.get_campaign_state_bundle(camp.id)
    inv_1 = bundle_1.current_character_state.inventory
    eq_1 = bundle_1.current_character_state.equipped
    assert any("datapad" in item.lower() for item in inv_1)
    assert all("jacket" not in item.lower() for item in eq_1)
    assert "Silver neural key" in inv_1

    # 5. Verify Zone 1 static prompt remains 100% identical between Turn 0 and Turn 1 while Zone 4 reflects new inventory
    msgs_t0 = assemble_four_zone_messages(
        world=world,
        character=updated,
        branch_turns=[turn_0],
        episodic_chunks=[],
        active_location=bundle_0.active_location,
        neighbors=bundle_0.neighbor_locations,
        recalled_items=[],
        pre_turn=turn_0.pre_turn,
        user_message="Check gear.",
    )
    msgs_t1 = assemble_four_zone_messages(
        world=world,
        character=updated,
        branch_turns=bundle_1.active_branch_turns,
        episodic_chunks=[],
        active_location=bundle_1.active_location,
        neighbors=bundle_1.neighbor_locations,
        recalled_items=[],
        pre_turn=bundle_1.active_branch_turns[-1].pre_turn,
        user_message="Check gear again.",
    )
    assert msgs_t0[0]["content"] == msgs_t1[0]["content"]
    assert "silver ocular implant" in msgs_t0[0]["content"]
    assert "Encrypted datapad" in msgs_t1[-1]["content"]
    assert "Armored synth-leather jacket" not in msgs_t1[-1]["content"]

    # 6. Checkout Turn 0 branch -> inventory rolls back to Turn 0 snapshot (jacket restored, datapad gone)
    rolled_back = temp_repo.checkout_turn_branch(camp.id, turn_0.id)
    assert "Armored synth-leather jacket" in rolled_back.current_character_state.equipped
    assert all("datapad" not in item.lower() for item in rolled_back.current_character_state.inventory)


async def test_edit_last_message_swipe_and_delete_last_turn_with_swipes(
    temp_repo: CantinaRepository,
) -> None:
    """Verify editing the last message creates a new swipe preserving original swipes, and deleting removes the last message and all its swipes."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    root_turn_id = bundle_0.active_branch_turns[-1].id

    # Root turn cannot be deleted
    with pytest.raises(ValueError, match="Cannot delete the root opening scene turn"):
        temp_repo.delete_last_turn(camp_id)

    # 1. Submit initial Turn 1 (Swipe v1)
    orig_msg = "I order a glass of cheap synth-rye and ask about the rain."
    req_v1 = TurnSubmitRequest(user_message=orig_msg, parent_turn_id=root_turn_id)
    async for _ev in _execute_turn_stream_events(camp_id, req_v1):
        pass

    bundle_v1 = temp_repo.get_campaign_state_bundle(camp_id)
    turn_v1 = bundle_v1.active_branch_turns[-1]
    assert turn_v1.depth_index == 1
    assert turn_v1.parent_turn_id == root_turn_id
    assert turn_v1.user_message == orig_msg

    # 2. Edit the last message -> generates a new swipe (v2) with edited text while v1 keeps original text
    edited_msg = "I slide a Vespera credit chip across the zinc bar and ask to use the Backroom Ripperdoc Bay."
    req_v2 = TurnSubmitRequest(
        user_message=edited_msg,
        parent_turn_id=turn_v1.parent_turn_id,
    )
    async for _ev in _execute_turn_stream_events(camp_id, req_v2):
        pass

    bundle_v2 = temp_repo.get_campaign_state_bundle(camp_id)
    turn_v2 = bundle_v2.active_branch_turns[-1]
    assert turn_v2.id != turn_v1.id
    assert turn_v2.depth_index == 1
    assert turn_v2.parent_turn_id == root_turn_id
    assert turn_v2.user_message == edited_msg

    # Both swipes exist under root_turn_id in creation order, with v1 retaining its original text
    siblings = [t for t in bundle_v2.all_turn_nodes if t.parent_turn_id == root_turn_id]
    assert [s.id for s in siblings] == [turn_v1.id, turn_v2.id]
    assert siblings[0].user_message == orig_msg
    assert siblings[1].user_message == edited_msg

    # Checking out v1 restores the original user message on the active branch
    checked_v1 = temp_repo.checkout_turn_branch(camp_id, turn_v1.id)
    assert checked_v1.active_branch_turns[-1].user_message == orig_msg

    # Checking out v2 restores the edited user message on the active branch
    checked_v2 = temp_repo.checkout_turn_branch(camp_id, turn_v2.id)
    assert checked_v2.active_branch_turns[-1].user_message == edited_msg

    # 3. Advance to Turn 2 from v2, generate a swipe on Turn 2, then delete Turn 2 (and its swipes)
    req_t2_a = TurnSubmitRequest(
        user_message="I inspect the surgical tray in the bay.",
        parent_turn_id=turn_v2.id,
    )
    async for _ev in _execute_turn_stream_events(camp_id, req_t2_a):
        pass
    bundle_t2_a = temp_repo.get_campaign_state_bundle(camp_id)
    turn_2a = bundle_t2_a.active_branch_turns[-1]

    req_t2_b = TurnSubmitRequest(
        user_message="I open the concealed storage locker inside the bay.",
        parent_turn_id=turn_2a.parent_turn_id,
    )
    async for _ev in _execute_turn_stream_events(camp_id, req_t2_b):
        pass
    bundle_t2_b = temp_repo.get_campaign_state_bundle(camp_id)
    turn_2b = bundle_t2_b.active_branch_turns[-1]
    assert len([t for t in bundle_t2_b.all_turn_nodes if t.parent_turn_id == turn_v2.id]) == 2

    # Delete last message (Turn 2): removes both turn_2a and turn_2b, rolling active leaf back to turn_v2
    after_del_t2 = temp_repo.delete_last_turn(camp_id)
    assert after_del_t2.campaign.active_leaf_turn_id == turn_v2.id
    assert len(after_del_t2.active_branch_turns) == 2
    assert all(t.id not in {turn_2a.id, turn_2b.id} for t in after_del_t2.all_turn_nodes)
    # Turn 1 swipes (v1 and v2) are still intact
    assert [t.id for t in after_del_t2.all_turn_nodes if t.parent_turn_id == root_turn_id] == [
        turn_v1.id,
        turn_v2.id,
    ]

    # 4. Now delete last message again (at Turn 1): removes both turn_v1 and turn_v2, rolling back to Turn 0
    after_del_t1 = temp_repo.delete_last_turn(camp_id)
    assert after_del_t1.campaign.active_leaf_turn_id == root_turn_id
    assert [t.id for t in after_del_t1.active_branch_turns] == [root_turn_id]
    assert [t.id for t in after_del_t1.all_turn_nodes] == [root_turn_id]


async def test_max_eight_neighbors_and_passage_hub_reconnection(
    temp_repo: CantinaRepository,
) -> None:
    """Verify a node is capped at 8 neighbors (N..NW) and a 9th spawns a directional Passage Hub that reconnects nodes in that direction safely across branches."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    world_id = bundle_0.campaign.world_id
    main_bar_id = bundle_0.active_location.id
    root_turn_id = bundle_0.active_branch_turns[-1].id

    # Initially Main Floor has 3 neighbors: Backroom Ripperdoc Bay (N), VIP Mezzanine (E), Cargo Alley (W)
    initial_nbs = temp_repo.get_neighbor_locations(
        world_id, main_bar_id, valid_turn_ids={root_turn_id}
    )
    assert len(initial_nbs) == 3

    # Add 5 more improvised locations on root_turn_id so Main Floor reaches the maximum of 8 adjacent nodes
    extra_dirs = ["NE", "SE", "S", "SW", "NW"]
    for idx, cdir in enumerate(extra_dirs):
        temp_repo.add_improvised_location(
            world_id=world_id,
            from_location_id=main_bar_id,
            created_at_turn_id=root_turn_id,
            spec=ImprovisedLocationSpec(
                name=f"Sector Room {idx + 4}",
                summary=f"Adjoining room {idx + 4}.",
                description=f"Room {idx + 4} branching {cdir} from the main floor.",
                compass_direction=cdir,  # type: ignore[arg-type]
                entry_direction_label=f"{cdir} Doorway {idx + 4}",
                return_direction_label="Back to Main Floor",
                travel_minutes=1,
            ),
            valid_turn_ids={root_turn_id},
        )

    nbs_at_8 = temp_repo.get_neighbor_locations(
        world_id, main_bar_id, valid_turn_ids={root_turn_id}
    )
    assert len(nbs_at_8) == 8
    assert {nb.compass_direction for nb in nbs_at_8} == set(COMPASS_DIRECTIONS)
    assert all(not nb.destination.is_hub for nb in nbs_at_8)

    # Create a new turn (Turn 1) so we can also test branch rollback of the 9th-node Hub rewiring
    req_t1 = TurnSubmitRequest(
        user_message="I stay at the bar and look around the room.",
        parent_turn_id=root_turn_id,
    )
    async for _ev in _execute_turn_stream_events(camp_id, req_t1):
        pass
    bundle_t1 = temp_repo.get_campaign_state_bundle(camp_id)
    turn_1_id = bundle_t1.active_branch_turns[-1].id
    branch_turn_ids = {root_turn_id, turn_1_id}

    # Now create a 9th neighbor from Main Floor in the North ('N') direction on Turn 1
    ninth_loc = temp_repo.add_improvised_location(
        world_id=world_id,
        from_location_id=main_bar_id,
        created_at_turn_id=turn_1_id,
        spec=ImprovisedLocationSpec(
            name="Northern Smuggler Vault",
            summary="Hidden vault to the north.",
            description="An armored vault concealed behind the north bulkhead.",
            compass_direction="N",
            entry_direction_label="Armored North Bulkhead",
            return_direction_label="Vault Door South",
            travel_minutes=2,
        ),
        valid_turn_ids=branch_turn_ids,
    )
    assert ninth_loc.name == "Northern Smuggler Vault"
    assert ninth_loc.is_hub is False

    # Main Floor must still have exactly 8 neighbors, and its 'N' neighbor is now 'North Passage' (is_hub=True)
    nbs_after_9 = temp_repo.get_neighbor_locations(
        world_id, main_bar_id, valid_turn_ids=branch_turn_ids
    )
    assert len(nbs_after_9) == 8
    north_nb = next(nb for nb in nbs_after_9 if nb.compass_direction == "N")
    assert north_nb.destination.is_hub is True
    assert "North Passage" in north_nb.destination.name

    # Both the original North neighbor ('Backroom Ripperdoc Bay') and the 9th node ('Northern Smuggler Vault')
    # are now connected to the North Passage hub!
    hub_nbs = temp_repo.get_neighbor_locations(
        world_id, north_nb.destination.id, valid_turn_ids=branch_turn_ids
    )
    hub_dest_names = {nb.destination.name for nb in hub_nbs}
    assert "The Neon Rust Main Floor" in hub_dest_names
    assert "Backroom Ripperdoc Bay" in hub_dest_names
    assert "Northern Smuggler Vault" in hub_dest_names

    # Adding a 10th node in 'N' from Main Floor attaches to the existing North Passage hub without exceeding 8 on Main Floor
    tenth_loc = temp_repo.add_improvised_location(
        world_id=world_id,
        from_location_id=main_bar_id,
        created_at_turn_id=turn_1_id,
        spec=ImprovisedLocationSpec(
            name="North Generator Alcove",
            summary="Generator room off the north passage.",
            description="Humming auxiliary generator alcove.",
            compass_direction="N",
            entry_direction_label="Grated Generator Door",
            return_direction_label="Back to North Passage",
            travel_minutes=1,
        ),
        valid_turn_ids=branch_turn_ids,
    )
    assert tenth_loc.name == "North Generator Alcove"
    nbs_after_10 = temp_repo.get_neighbor_locations(
        world_id, main_bar_id, valid_turn_ids=branch_turn_ids
    )
    assert len(nbs_after_10) == 8
    hub_nbs_after_10 = temp_repo.get_neighbor_locations(
        world_id, north_nb.destination.id, valid_turn_ids=branch_turn_ids
    )
    assert "North Generator Alcove" in {nb.destination.name for nb in hub_nbs_after_10}

    # Checking out Turn 0 (before the 9th node was created) sees the original direct connection to Backroom Ripperdoc Bay!
    nbs_on_root_branch = temp_repo.get_neighbor_locations(
        world_id, main_bar_id, valid_turn_ids={root_turn_id}
    )
    assert len(nbs_on_root_branch) == 8
    root_north_nb = next(nb for nb in nbs_on_root_branch if nb.compass_direction == "N")
    assert root_north_nb.destination.name == "Backroom Ripperdoc Bay"
    assert root_north_nb.destination.is_hub is False


async def test_location_override_affects_next_turn_and_swipe(
    temp_repo: CantinaRepository,
) -> None:
    """Verify overriding the current location updates the active turn state and injects the overridden location on the next turn or swipe."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    world = temp_repo.get_world(bundle_0.campaign.world_id)
    mezzanine = next(loc for loc in world.locations if "Mezzanine" in loc.name)
    cooling_tunnels = next(loc for loc in world.locations if "Cooling Tunnels" in loc.name)

    # 1. Execute Turn 1 (stays in Main Floor)
    req_t1 = TurnSubmitRequest(user_message="I look around the room.")
    async for _ev in _execute_turn_stream_events(camp_id, req_t1):
        pass
    bundle_t1 = temp_repo.get_campaign_state_bundle(camp_id)
    turn_1 = bundle_t1.active_branch_turns[-1]
    assert bundle_t1.active_location.name == "The Neon Rust Main Floor"

    # 2. Player overrides current location to 'Shadowed VIP Mezzanine'
    overridden_bundle = temp_repo.override_campaign_location(camp_id, mezzanine.id)
    assert overridden_bundle.active_location.id == mezzanine.id
    assert overridden_bundle.active_location.name == "Shadowed VIP Mezzanine"
    assert overridden_bundle.current_character_state.current_location_id == mezzanine.id
    assert "char_kira_vance" in overridden_bundle.present_character_ids

    # 3. Next Turn (Turn 2) automatically starts in 'Shadowed VIP Mezzanine'
    req_t2 = TurnSubmitRequest(user_message="I lean over the railing and watch the entrance.")
    async for _ev in _execute_turn_stream_events(camp_id, req_t2):
        pass
    bundle_t2 = temp_repo.get_campaign_state_bundle(camp_id)
    assert bundle_t2.active_location.id == mezzanine.id

    # 4. Now override location to 'Sub-Basement Cooling Tunnels' and SWIPE Turn 2 (branching from Turn 1 with override_location_id)
    temp_repo.override_campaign_location(camp_id, cooling_tunnels.id)
    turn_2 = bundle_t2.active_branch_turns[-1]
    req_swipe_t2 = TurnSubmitRequest(
        user_message=turn_2.user_message,
        parent_turn_id=turn_2.parent_turn_id,
        override_location_id=cooling_tunnels.id,
    )
    async for _ev in _execute_turn_stream_events(camp_id, req_swipe_t2):
        pass
    bundle_swipe = temp_repo.get_campaign_state_bundle(camp_id)
    assert bundle_swipe.active_location.id == cooling_tunnels.id
    assert bundle_swipe.active_location.name == "Sub-Basement Cooling Tunnels"
    assert bundle_swipe.current_character_state.current_location_id == cooling_tunnels.id


async def test_item_equip_toggle_applies_from_next_turn(
    temp_repo: CantinaRepository,
) -> None:
    """Verify equipping or unequipping an item via toggle_campaign_item_equip updates leaf turn and persists across subsequent turns."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    # Kira Vance starts with equipped clothes and carried items
    assert "Diagnostic medical penlight" in bundle_0.current_character_state.inventory
    assert "Diagnostic medical penlight" not in bundle_0.current_character_state.equipped

    # 1. Player equips the penlight
    eq_bundle = temp_repo.toggle_campaign_item_equip(
        camp_id,
        item="Diagnostic medical penlight",
        action="equip",
    )
    assert "Diagnostic medical penlight" in eq_bundle.current_character_state.equipped
    assert "Diagnostic medical penlight" not in eq_bundle.current_character_state.inventory

    # 2. Advance to Turn 1 - penlight should remain equipped in Turn 1 character state
    req_t1 = TurnSubmitRequest(user_message="Do you have that diagnostic penlight handy?")
    async for _ev in _execute_turn_stream_events(camp_id, req_t1):
        pass

    bundle_t1 = temp_repo.get_campaign_state_bundle(camp_id)
    assert "Diagnostic medical penlight" in bundle_t1.current_character_state.equipped
    assert "Diagnostic medical penlight" not in bundle_t1.current_character_state.inventory

    # 3. Unequip the penlight on Turn 1
    uneq_bundle = temp_repo.toggle_campaign_item_equip(
        camp_id,
        item="Diagnostic medical penlight",
        action="unequip",
    )
    assert "Diagnostic medical penlight" in uneq_bundle.current_character_state.inventory
    assert "Diagnostic medical penlight" not in uneq_bundle.current_character_state.equipped

    # 4. Advance to Turn 2 - penlight remains unequipped in inventory
    req_t2 = TurnSubmitRequest(user_message="Put it back in your kit.")
    async for _ev in _execute_turn_stream_events(camp_id, req_t2):
        pass

    bundle_t2 = temp_repo.get_campaign_state_bundle(camp_id)
    assert "Diagnostic medical penlight" in bundle_t2.current_character_state.inventory
    assert "Diagnostic medical penlight" not in bundle_t2.current_character_state.equipped



async def test_manual_linked_location_creation_is_branch_bound(
    temp_repo: CantinaRepository,
) -> None:
    """Verify manually created linked rooms appear with the chosen direction/distance and roll back with their turn."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    clinic = next(l for l in bundle_0.visible_locations if "Ripperdoc" in l.name)

    req = TurnSubmitRequest(user_message="I look around the room.")
    async for _ev in _execute_turn_stream_events(camp_id, req):
        pass

    bundle = temp_repo.create_linked_location(
        camp_id,
        from_location_id=clinic.id,
        name="Hidden Pharmacy",
        description="Shelves of contraband suppressants behind a false wall.",
        environmental_tags=["shelves", "cold light"],
        compass_direction="E",
        travel_minutes=5,
    )
    new_loc = next(l for l in bundle.visible_locations if l.name == "Hidden Pharmacy")
    assert new_loc.environmental_tags == ["shelves", "cold light"]
    edge = next(
        e for e in bundle.visible_edges
        if e.from_location_id == clinic.id and e.to_location_id == new_loc.id
    )
    assert edge.compass_direction == "E"
    assert edge.travel_minutes == 5
    assert any(
        e.from_location_id == new_loc.id and e.to_location_id == clinic.id
        for e in bundle.visible_edges
    )

    # Deleting the turn the room was bound to removes it
    after = temp_repo.delete_last_turn(camp_id)
    assert all(l.name != "Hidden Pharmacy" for l in after.visible_locations)
