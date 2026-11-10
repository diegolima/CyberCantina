"""Comprehensive test suite for User Personas and Epistemic Gating across all 5 milestones.

Covers:
1. Persona CRUD, repository persistence, and Snapshot Isolation (permanent freezing per campaign).
2. Zone 1 KV-cache prefix byte-level stability (immutable public traits only).
3. Persona disclosure detection strategies (token matching, LLM intent, hybrid) & solitary action guard.
4. Phase 3 epistemic isolation (per-character known persona projection).
5. Prose-verified gossip protocol (co-present NPCs sharing secrets via raw_prose).
6. Branch swiping and rollback (timeline isolation of persona turn states).
7. End-to-end API router integration.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.phase1_pre import (
    detect_persona_disclosures,
    detect_persona_disclosures_token_matching,
    run_phase1_pre_analysis,
)
from app.engine.phase2_context import (
    DiscoveredPersonaView,
    assemble_four_zone_messages,
    build_all_character_known_personas,
    build_zone1_ensemble_system_prompt,
    build_zone1_narrator_system_prompt,
    build_zone1_static_system_prompt,
    resolve_character_known_persona,
)
from app.engine.phase3_cognition import (
    heuristic_character_cognition,
    run_character_cognition_agent,
)
from app.engine.phase5_clerk import (
    apply_turn_persona_state_and_gossip,
    run_phase5_post_turn_clerk,
    verify_prose_gossip_exchanges,
)
from app.main import app
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
)
from app.schemas.persona import (
    DEFAULT_PERSONA_ID,
    PersonaCreatePayload,
    PersonaItemInstance,
    PersonaKnowledgeProvenance,
    PersonaLoreEntry,
    PersonaRecord,
    PersonaTurnStateSnapshot,
    PersonaUpdatePayload,
    get_default_persona,
)
from app.schemas.turn import (
    PersonaGossipEvent,
    PreTurnAnalysis,
    TurnNodeRecord,
    TurnSubmitRequest,
)


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


@pytest.fixture
def authed_client(temp_repo: CantinaRepository) -> tuple[TestClient, CantinaRepository]:
    """Authenticated FastAPI TestClient bound to temp_repo."""
    user = temp_repo.create_user(
        username="persona_tester",
        display_name="Persona Tester",
        role="admin",
        user_id="user_persona_tester",
    )
    temp_repo.claim_unowned_entities(user.id)
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    try:
        yield client, temp_repo
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _get_or_create_test_user(repo: CantinaRepository) -> str:
    users = repo.list_users()
    if users:
        return users[0].id
    u = repo.create_user(
        username="test_admin",
        display_name="Test Admin",
        role="admin",
        user_id="user_test_default",
    )
    repo.claim_unowned_entities(u.id)
    return u.id


def _sample_persona_payload() -> PersonaCreatePayload:
    return PersonaCreatePayload(
        name="Deckard Shaw",
        species="Cyborg",
        age="38",
        age_is_secret=True,
        sex="Male",
        pronouns="he/him",
        persona_bio="Disgraced corporate security consultant working as an independent problem-solver.",
        tags=["mercenary", "militech", "investigator"],
        build_and_height="185 cm, muscular cybernetic frame",
        distinctive_features=["sharp hazel eyes", "cyberware scar across left cheek"],
        physical_appearance="Weathered coat, sharp hazel eyes, visible cyberware scar across left cheek.",
        equipped=[
            PersonaItemInstance(
                id="item_trenchcoat",
                name="Reinforced Trenchcoat",
                note="Armored synth-leather coat with hidden pockets.",
                is_secret=False,
            )
        ],
        inventory=[
            PersonaItemInstance(
                id="item_cyberdeck",
                name="Militech Cyberdeck",
                note="Black-market military deck with illicit ICE breakers.",
                is_secret=True,
                trigger_keywords=["cyberdeck", "militech deck", "ice breaker"],
            ),
            PersonaItemInstance(
                id="item_medkit",
                name="Trauma Team Medkit",
                note="Emergency trauma syringe.",
                is_secret=True,
                trigger_keywords=["medkit", "trauma kit"],
            ),
        ],
        lore_entries=[
            PersonaLoreEntry(
                id="lore_arasaka_heist",
                title="Ex-Militech Operative",
                content="Deckard escaped after surviving the Arasaka tower infiltration.",
                is_secret=True,
                trigger_keywords=["arasaka tower", "ex-militech", "covert operative"],
            )
        ],
    )


def _sample_persona_record(persona_id: str = "persona_test") -> PersonaRecord:
    payload = _sample_persona_payload()
    return PersonaRecord(
        id=persona_id,
        owner_id="default_user",
        name=payload.name,
        species=payload.species,
        age=payload.age,
        age_is_secret=payload.age_is_secret,
        sex=payload.sex,
        pronouns=payload.pronouns,
        persona_bio=payload.persona_bio,
        tags=payload.tags,
        build_and_height=payload.build_and_height,
        distinctive_features=payload.distinctive_features,
        physical_appearance=payload.physical_appearance,
        equipped=payload.equipped,
        inventory=payload.inventory,
        lore_entries=payload.lore_entries,
        created_at="2026-11-03T00:00:00Z",
        updated_at="2026-11-03T00:00:00Z",
    )


def _make_dummy_character_state(
    cid: str = "char_soren",
    loc_id: str = "loc_cantina",
    turn_id: str = "turn_0",
    unlocked: list[str] | None = None,
) -> CharacterStateSnapshot:
    return CharacterStateSnapshot(
        character_id=cid,
        turn_id=turn_id,
        current_location_id=loc_id,
        mood_label="Alert",
        active_want="Observe surroundings",
        active_plan="Watch exits",
        unlocked_persona_keys=unlocked or [],
    )


def test_persona_crud_and_snapshot_isolation(temp_repo: CantinaRepository) -> None:
    """Milestone 1 & 2: Test Persona CRUD, campaign binding, and snapshot immutability."""
    owner_id = _get_or_create_test_user(temp_repo)

    # 1. Create Persona template
    payload = _sample_persona_payload()
    created = temp_repo.create_persona(payload, owner_id=owner_id)
    assert created.id.startswith("persona_")
    assert created.name == "Deckard Shaw"
    assert created.age_is_secret is True
    assert len(created.inventory) == 2
    assert len(created.lore_entries) == 1

    # 2. Read back
    fetched = temp_repo.get_persona(created.id)
    assert fetched is not None
    assert fetched.name == "Deckard Shaw"
    assert fetched.inventory[0].name == "Militech Cyberdeck"

    # 3. Create Campaign using this Persona
    camp = temp_repo.create_campaign(
        name="Deckard's Run",
        world_id="world_neon_rust",
        character_id="char_kira_vance",
        persona_id=created.id,
        owner_id=owner_id,
    )
    assert camp.persona_id == created.id
    assert camp.persona_snapshot is not None
    assert camp.persona_snapshot.name == "Deckard Shaw"
    assert camp.persona_snapshot.age == "38"
    assert camp.persona_snapshot.inventory[0].name == "Militech Cyberdeck"

    # Verify initial persona turn state for turn 0 was seeded
    t0 = temp_repo.get_turn_node(camp.active_leaf_turn_id)
    assert t0 is not None
    pts = temp_repo.get_campaign_persona_turn_state(t0.id)
    assert pts is not None
    assert len(pts.inventory) == 2
    assert len(pts.equipped) == 1

    # 4. MUTATE master Persona template (Snapshot Isolation check)
    temp_repo.update_persona(
        created.id,
        PersonaUpdatePayload(
            name="Deckard Shaw (Modified)",
            age="99",
            physical_appearance="Completely altered cyborg body.",
            inventory=[],  # Removed all inventory from master template
        ),
    )

    # Master template was updated
    master_updated = temp_repo.get_persona(created.id)
    assert master_updated is not None
    assert master_updated.name == "Deckard Shaw (Modified)"
    assert len(master_updated.inventory) == 0

    # Campaign's frozen snapshot MUST REMAIN UNTOUCHED
    camp_reloaded = temp_repo.get_campaign(camp.id)
    assert camp_reloaded is not None
    assert camp_reloaded.persona_snapshot is not None
    assert camp_reloaded.persona_snapshot.name == "Deckard Shaw"  # Pristine!
    assert camp_reloaded.persona_snapshot.age == "38"  # Pristine!
    assert camp_reloaded.persona_snapshot.physical_appearance == payload.physical_appearance
    assert len(camp_reloaded.persona_snapshot.inventory) == 2  # Pristine!

    # 5. DELETE master Persona template
    temp_repo.delete_persona(created.id)
    assert temp_repo.get_persona(created.id) is None

    # Campaign still has its snapshot and continues to operate smoothly
    camp_after_delete = temp_repo.get_campaign(camp.id)
    assert camp_after_delete is not None
    assert camp_after_delete.persona_snapshot is not None
    assert camp_after_delete.persona_snapshot.name == "Deckard Shaw"


def test_zone1_kv_cache_byte_stability(temp_repo: CantinaRepository) -> None:
    """Zone 1 KV-cache Invariant: static system prompts are byte-identical across turns."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    world = temp_repo.get_world(bundle.campaign.world_id)
    char = temp_repo.get_character(bundle.campaign.character_id)
    assert world is not None and char is not None

    persona = _sample_persona_record("persona_zone1_test")

    # Turn 0: Nothing unlocked
    p0 = build_zone1_static_system_prompt(world, char, persona_snapshot=persona)
    assert "Deckard Shaw" in p0
    assert "Cyborg" in p0
    assert "185 cm, muscular cybernetic frame" in p0
    assert "cyberware scar across left cheek" in p0
    # Dynamic secret attributes MUST NOT leak into Zone 1
    assert "Militech Cyberdeck" not in p0
    assert "Arasaka tower" not in p0

    # Turn 1: Simulating that secrets were disclosed in the campaign
    # Zone 1 only accepts `persona_snapshot` and never takes dynamic turn states
    p1 = build_zone1_static_system_prompt(world, char, persona_snapshot=persona)
    assert p0 == p1
    assert len(p0.encode("utf-8")) == len(p1.encode("utf-8"))

    # Also test narrator and ensemble static prompts
    narrator_p0 = build_zone1_narrator_system_prompt(world, persona_snapshot=persona)
    narrator_p1 = build_zone1_narrator_system_prompt(world, persona_snapshot=persona)
    assert narrator_p0 == narrator_p1
    assert "Deckard Shaw" in narrator_p0

    ensemble_p0 = build_zone1_ensemble_system_prompt(world, [char], persona_snapshot=persona)
    ensemble_p1 = build_zone1_ensemble_system_prompt(world, [char], persona_snapshot=persona)
    assert ensemble_p0 == ensemble_p1
    assert "Deckard Shaw" in ensemble_p0


def test_disclosure_detection_and_solitary_guard() -> None:
    """Milestone 3: Test deterministic token matching & solitary monologue guard."""
    persona = _sample_persona_record("persona_detect_test")

    unlocked_keys: set[str] = set()

    # Case A: Exact keyword in conversation
    msg1 = "I tap the side of my Militech Cyberdeck to initiate a network ping."
    detected1 = detect_persona_disclosures_token_matching(
        user_message=msg1, persona_snapshot=persona, already_unlocked_keys=unlocked_keys
    )
    assert "item_cyberdeck" in detected1

    # Case B: Case insensitivity
    msg2 = "Don't worry, I have a TRAUMA KIT in my bag."
    detected2 = detect_persona_disclosures_token_matching(
        user_message=msg2, persona_snapshot=persona, already_unlocked_keys=unlocked_keys
    )
    assert "item_medkit" in detected2

    # Case C: Word boundary protection (substrings should not falsely match)
    msg3 = "I want to relax on the deckchair outside."  # Contains "deck" but is "deckchair"
    detected3 = detect_persona_disclosures_token_matching(
        user_message=msg3, persona_snapshot=persona, already_unlocked_keys=unlocked_keys
    )
    assert "item_cyberdeck" not in detected3

    # Case D: Already unlocked trait is not re-detected
    unlocked_keys.add("item_cyberdeck")
    detected4 = detect_persona_disclosures_token_matching(
        user_message=msg1, persona_snapshot=persona, already_unlocked_keys=unlocked_keys
    )
    assert "item_cyberdeck" not in detected4

    # Case E: Solitary Action Guard
    # If the user is speaking alone in the room (present_characters_count == 0),
    # no NPC can witness the revelation!
    msg5 = "I mutter to myself: 'I survived the Arasaka tower infiltration, I can survive this.'"
    # With present_characters_count == 0
    solitary_detected = detect_persona_disclosures(
        user_message=msg5,
        persona_snapshot=persona,
        already_unlocked_keys=set(),
        present_characters_count=0,
        mode="token_matching",
    )
    assert solitary_detected == []  # Blocked by solitary guard!

    # With present_characters_count > 0
    witnessed_detected = detect_persona_disclosures(
        user_message=msg5,
        persona_snapshot=persona,
        already_unlocked_keys=set(),
        present_characters_count=1,
        mode="token_matching",
    )
    assert "lore_arasaka_heist" in witnessed_detected


def test_hybrid_and_llm_disclosure_detection() -> None:
    """Test LLM intent analysis and hybrid disclosure detection fallback."""
    persona = _sample_persona_record("persona_detect_test")

    # Simulated clerk pre-turn output returning a semantic revelation
    clerk_output = PreTurnAnalysis(
        intent_summary="Player subtly revealed their age and background.",
        revealed_persona_keys=["age", "lore_arasaka_heist"],
    )

    # 1. Mode: llm_intent
    disclosed_llm = detect_persona_disclosures(
        user_message="I've been running gigs for nearly four decades.",
        persona_snapshot=persona,
        already_unlocked_keys=set(),
        present_characters_count=1,
        mode="llm_intent",
        llm_revealed_keys=clerk_output.revealed_persona_keys,
    )
    assert "age" in disclosed_llm
    assert "lore_arasaka_heist" in disclosed_llm

    # 2. Mode: hybrid (combines token match from prompt + LLM intent)
    # Prompt contains token keyword "medkit"
    disclosed_hybrid = detect_persona_disclosures(
        user_message="Pass me that medkit before I bleed out.",
        persona_snapshot=persona,
        already_unlocked_keys=set(),
        present_characters_count=1,
        mode="hybrid",
        llm_revealed_keys=clerk_output.revealed_persona_keys,
    )
    # Token matching caught item_medkit, and clerk caught age & lore
    assert "item_medkit" in disclosed_hybrid
    assert "age" in disclosed_hybrid
    assert "lore_arasaka_heist" in disclosed_hybrid


def test_phase3_epistemic_isolation() -> None:
    """Milestone 3: Epistemic Isolation - each character only sees their discovered facts."""
    persona = _sample_persona_record("persona_epistemic_test")

    # Character A has unlocked age and cyberdeck
    st_a = _make_dummy_character_state(
        cid="char_soren",
        unlocked=["age", "item_cyberdeck"],
    )

    # Character B has unlocked NOTHING
    st_b = _make_dummy_character_state(
        cid="char_nyx",
        unlocked=[],
    )

    # Resolve views
    view_a = resolve_character_known_persona(persona, None, st_a.unlocked_persona_keys)
    view_b = resolve_character_known_persona(persona, None, st_b.unlocked_persona_keys)

    assert view_a is not None
    assert view_a.name == "Deckard Shaw"
    assert view_a.revealed_age == "38"  # Character A knows age!
    assert len(view_a.known_inventory) == 1
    assert view_a.known_inventory[0].name == "Militech Cyberdeck"
    assert len(view_a.known_lore) == 0  # Not unlocked yet

    assert view_b is not None
    assert view_b.name == "Deckard Shaw"
    assert view_b.revealed_age is None  # Character B DOES NOT know age!
    assert len(view_b.known_inventory) == 0  # Character B DOES NOT know inventory!
    assert len(view_b.known_lore) == 0

    # Test dictionary map builder
    char_dict = {"char_soren": st_a, "char_nyx": st_b}
    views_map = build_all_character_known_personas(persona, None, char_dict)
    assert views_map["char_soren"].revealed_age == "38"
    assert views_map["char_nyx"].revealed_age is None

    # Test Cognition recall memory generation for Character A (with unlocked secrets)
    char_a_rec = CharacterRecord(
        id="char_soren",
        name="Soren Kael",
        world_id="world_1",
        tagline="Investigator",
        core_persona="Cynical",
        baseline_psyche=BaselinePsyche(
            core_drive="Truth",
            core_fear="Ignorance",
            default_want="Watch",
            default_plan="Observe",
            mood_label="Attentive",
        ),
        created_at="2026-11-03T00:00:00Z",
    )
    cognition_res_a = heuristic_character_cognition(
        user_message="Hello there",
        character=char_a_rec,
        previous_state=st_a,
        pre_turn=PreTurnAnalysis(intent_summary="Test"),
        known_persona=view_a,
    )
    assert "38" in cognition_res_a.recall
    assert "Militech Cyberdeck" in cognition_res_a.recall

    # Test Cognition recall memory generation for Character B (with zero unlocked secrets)
    char_b_rec = CharacterRecord(
        id="char_nyx",
        name="Nyx Vane",
        world_id="world_1",
        tagline="Fixer",
        core_persona="Sharp",
        baseline_psyche=BaselinePsyche(
            core_drive="Wealth",
            core_fear="Failure",
            default_want="Make deal",
            default_plan="Listen",
            mood_label="Cool",
        ),
        created_at="2026-11-03T00:00:00Z",
    )
    cognition_res_b = heuristic_character_cognition(
        user_message="Hello there",
        character=char_b_rec,
        previous_state=st_b,
        pre_turn=PreTurnAnalysis(intent_summary="Test"),
        known_persona=view_b,
    )
    # Cognition completed; verify that no secret traits leaked to Character B
    assert "38" not in cognition_res_b.recall
    assert "Militech Cyberdeck" not in cognition_res_b.recall


def test_prose_verified_gossip_protocol() -> None:
    """Milestone 3 & 5: Prose-Verified Gossip Protocol between co-present NPCs."""
    persona = _sample_persona_record("persona_gossip_test")

    char_a = CharacterRecord(
        id="char_a",
        name="Soren Kael",
        world_id="world_1",
        tagline="Inquisitive investigator",
        core_persona="Cynical",
        baseline_psyche=BaselinePsyche(
            core_drive="Truth",
            core_fear="Ignorance",
            default_want="Observe",
            default_plan="Ask questions",
            mood_label="Attentive",
        ),
        created_at="2026-11-03T00:00:00Z",
    )
    char_b = CharacterRecord(
        id="char_b",
        name="Nyx Vane",
        world_id="world_1",
        tagline="Underground fixer",
        core_persona="Pragmatic",
        baseline_psyche=BaselinePsyche(
            core_drive="Profit",
            core_fear="Poverty",
            default_want="Find leverage",
            default_plan="Evaluate goods",
            mood_label="Calculating",
        ),
        created_at="2026-11-03T00:00:00Z",
    )

    # Character A knows the secret Militech Cyberdeck
    st_a = _make_dummy_character_state(
        cid="char_a",
        unlocked=["item_cyberdeck"],
    )
    st_a.persona_knowledge_provenance = {
        "item_cyberdeck": PersonaKnowledgeProvenance(
            unlocked_at_turn_id="turn_1",
            learned_from="player",
        )
    }

    # Character B is co-present in loc_cantina, but does NOT know the secret yet
    st_b = _make_dummy_character_state(
        cid="char_b",
        unlocked=[],
    )

    # Subcase 1: Character A tells Character B in the raw prose
    # The secret keyword "militech deck" is verbalized in raw prose dialogue
    prose_with_gossip = (
        'Soren leaned across the scarred table toward Nyx. "Keep your voice down," he warned. '
        '"I saw what Deckard is carrying. It\'s a black-market Militech deck with military-grade ICE breakers." '
        'Nyx’s eyes flared with interest.'
    )

    gossip_events = verify_prose_gossip_exchanges(
        raw_prose=prose_with_gossip,
        present_characters=[char_a, char_b],
        all_character_states={"char_a": st_a, "char_b": st_b},
        persona_snapshot=persona,
    )
    assert len(gossip_events) == 1
    gev = gossip_events[0]
    assert gev.source_character_id == "char_a"
    assert gev.recipient_character_id == "char_b"
    assert gev.trait_key == "item_cyberdeck"
    assert "militech deck" in gev.verbatim_reference.lower()

    # Now apply gossip to character snapshots for Turn N+1
    char_states = {"char_a": st_a.model_copy(deep=True), "char_b": st_b.model_copy(deep=True)}
    player_state = PersonaTurnStateSnapshot(
        turn_id="turn_gossip_1",
        unlocked_traits=["item_cyberdeck"],
        current_inventory=persona.inventory,
        current_equipped=persona.equipped,
    )

    updated_states, updated_player_st = apply_turn_persona_state_and_gossip(
        turn_id="turn_gossip_1",
        present_characters=[char_a, char_b],
        character_states=char_states,
        current_player_state=player_state,
        player_revealed_keys=[],
        verified_gossip_events=gossip_events,
    )

    # Character B now has the trait unlocked via gossip!
    updated_b = updated_states["char_b"]
    assert "item_cyberdeck" in updated_b.unlocked_persona_keys
    prov_b = updated_b.persona_knowledge_provenance["item_cyberdeck"]
    assert prov_b.learned_from == "char_a"
    assert prov_b.unlocked_at_turn_id == "turn_gossip_1"

    # Subcase 2: Character A does NOT verbalize the secret in prose
    prose_without_gossip = (
        'Soren glanced at Nyx and shrugged. "Just ordering another round of synth-whiskey," he lied smoothly.'
    )
    no_gossip_events = verify_prose_gossip_exchanges(
        raw_prose=prose_without_gossip,
        present_characters=[char_a, char_b],
        all_character_states={"char_a": st_a, "char_b": st_b},
        persona_snapshot=persona,
    )
    # Verification fails because the keyword was never spoken in prose!
    assert len(no_gossip_events) == 0


def test_timeline_branching_and_rollback(temp_repo: CantinaRepository) -> None:
    """Milestone 3 & 5: Branch swiping and rollback preserves pristine turn persona states."""
    owner_id = _get_or_create_test_user(temp_repo)

    # Create persona & campaign
    p = temp_repo.create_persona(_sample_persona_payload(), owner_id=owner_id)
    camp = temp_repo.create_campaign(
        name="Branch Test Campaign",
        world_id="world_neon_rust",
        character_id="char_kira_vance",
        persona_id=p.id,
        owner_id=owner_id,
    )

    t0_id = camp.active_leaf_turn_id
    t0 = temp_repo.get_turn_node(t0_id)
    assert t0 is not None
    t0_pts = temp_repo.get_campaign_persona_turn_state(t0_id)
    assert t0_pts is not None
    loc_id = t0.character_state.current_location_id

    # Turn 1 on Branch A: Player reveals age
    st_nyx_t1 = _make_dummy_character_state(
        cid="char_kira_vance",
        loc_id=loc_id,
        turn_id="turn_branch_a_1",
        unlocked=["age"],
    )
    temp_repo.save_turn_node(
        turn_id="turn_branch_a_1",
        campaign_id=camp.id,
        parent_turn_id=t0_id,
        depth_index=1,
        user_message="I am thirty-eight years old.",
        actor_id="char_kira_vance",
        raw_prose="Kira nodded.",
        cognition=CognitionBlock(),
        pre_turn=PreTurnAnalysis(intent_summary="test"),
        world_snapshot=t0.world_snapshot,
        character_state=st_nyx_t1,
        recalled_items=[],
    )
    temp_repo.save_campaign_persona_turn_state(
        turn_id="turn_branch_a_1",
        equipped=p.equipped,
        inventory=p.inventory,
    )

    # Check Turn 1 has 2 items in inventory and character unlocked 'age'
    pts_read_t1 = temp_repo.get_campaign_persona_turn_state("turn_branch_a_1")
    assert pts_read_t1 is not None
    assert len(pts_read_t1.inventory) == 2
    turn_a1_node = temp_repo.get_turn_node("turn_branch_a_1")
    assert turn_a1_node.character_state.unlocked_persona_keys == ["age"]

    # Fork/Rewind to Turn 0 (Branch B)
    # Turn 0's state must remain 100% pristine!
    pts_t0_reloaded = temp_repo.get_campaign_persona_turn_state(t0_id)
    assert pts_t0_reloaded is not None
    assert t0.character_state.unlocked_persona_keys == []

    # Advance Turn 1 on Branch B: Player drops cyberdeck, only keeps medkit
    branch_b_inv = [it for it in p.inventory if it.id == "item_medkit"]
    st_nyx_t1b = _make_dummy_character_state(
        cid="char_kira_vance",
        loc_id=loc_id,
        turn_id="turn_branch_b_1",
        unlocked=["item_medkit"],
    )
    temp_repo.save_turn_node(
        turn_id="turn_branch_b_1",
        campaign_id=camp.id,
        parent_turn_id=t0_id,
        depth_index=1,
        user_message="I have a medkit here.",
        actor_id="char_kira_vance",
        raw_prose="Kira observed the medkit.",
        cognition=CognitionBlock(),
        pre_turn=PreTurnAnalysis(intent_summary="test"),
        world_snapshot=t0.world_snapshot,
        character_state=st_nyx_t1b,
        recalled_items=[],
    )
    temp_repo.save_campaign_persona_turn_state(
        turn_id="turn_branch_b_1",
        equipped=p.equipped,
        inventory=branch_b_inv,
    )

    # Branch A Turn 1 still has 2 items and 'age'
    pts_a1_check = temp_repo.get_campaign_persona_turn_state("turn_branch_a_1")
    assert pts_a1_check is not None
    assert len(pts_a1_check.inventory) == 2
    assert temp_repo.get_turn_node("turn_branch_a_1").character_state.unlocked_persona_keys == ["age"]

    # Branch B Turn 1 has 1 item and 'item_medkit' (NOT 'age')
    pts_b1_check = temp_repo.get_campaign_persona_turn_state("turn_branch_b_1")
    assert pts_b1_check is not None
    assert len(pts_b1_check.inventory) == 1
    assert temp_repo.get_turn_node("turn_branch_b_1").character_state.unlocked_persona_keys == ["item_medkit"]


def test_personas_api_endpoints(authed_client: tuple[TestClient, CantinaRepository]) -> None:
    """Milestone 2 & 4: REST Router endpoints for Persona management."""
    client, repo = authed_client

    # 1. List personas
    res_list = client.get("/api/personas")
    assert res_list.status_code == 200
    initial_count = len(res_list.json())

    # 2. Create persona
    payload = {
        "name": "Valerie Wells",
        "age": "29",
        "age_is_secret": True,
        "physical_appearance": "Neon cybernetic braids, chrome aviator glasses.",
        "equipped": [
            {
                "item_template_id": "aviators",
                "name": "Chrome Aviators",
                "description": "HUD display sunglasses.",
                "is_secret": False,
                "trigger_keywords": [],
            }
        ],
        "inventory": [
            {
                "item_template_id": "datashard",
                "name": "Encrypted Datashard",
                "description": "Contains stolen coordinates.",
                "is_secret": True,
                "trigger_keywords": ["datashard", "stolen coordinates"],
            }
        ],
        "lore_entries": [],
    }
    res_create = client.post("/api/personas", json=payload)
    assert res_create.status_code == 201
    created_data = res_create.json()
    assert created_data["name"] == "Valerie Wells"
    pid = created_data["id"]

    # 3. Get persona
    res_get = client.get(f"/api/personas/{pid}")
    assert res_get.status_code == 200
    assert res_get.json()["age"] == "29"

    # 4. Update persona
    res_update = client.put(f"/api/personas/{pid}", json={"name": "Valerie Wells (Upgraded)"})
    assert res_update.status_code == 200
    assert res_update.json()["name"] == "Valerie Wells (Upgraded)"

    # 5. Create campaign with this persona
    res_camp = client.post(
        "/api/campaigns",
        json={
            "name": "Valerie's Neon Night",
            "world_id": "world_neon_rust",
            "character_id": "char_kira_vance",
            "persona_id": pid,
        },
    )
    assert res_camp.status_code == 200
    camp_bundle = res_camp.json()
    assert camp_bundle["campaign"]["persona_id"] == pid
    assert camp_bundle["campaign"]["persona_snapshot"]["name"] == "Valerie Wells (Upgraded)"

    # 6. Delete persona
    res_del = client.delete(f"/api/personas/{pid}")
    assert res_del.status_code == 204

    # Verification: deleted persona returns 404 on get
    res_get_del = client.get(f"/api/personas/{pid}")
    assert res_get_del.status_code == 404


def test_default_hardcoded_user_persona(temp_repo: CantinaRepository, authed_client: tuple[TestClient, CantinaRepository]) -> None:
    """Test that default 'User' persona always exists per-user with blank attributes and cannot be altered or deleted."""
    client, repo = authed_client

    # 1. Default persona exists in list
    res = client.get("/api/personas")
    assert res.status_code == 200
    personas = res.json()
    assert any(p["name"] == "User" and p["id"].startswith("persona_default_") for p in personas)

    default_p = next(p for p in personas if p["name"] == "User")
    assert default_p["id"] == "persona_default_user_persona_tester"
    assert default_p["owner_id"] == "user_persona_tester"
    assert default_p["age"] is None
    assert default_p["physical_appearance"] == ""
    assert default_p["equipped"] == []
    assert default_p["inventory"] == []
    assert default_p["lore_entries"] == []

    # 2. Direct GET on default persona (both user-specific ID and generic alias)
    res_get = client.get(f"/api/personas/{default_p['id']}")
    assert res_get.status_code == 200
    assert res_get.json()["name"] == "User"

    res_get_alias = client.get(f"/api/personas/{DEFAULT_PERSONA_ID}")
    assert res_get_alias.status_code == 200
    assert res_get_alias.json()["id"] == default_p["id"]

    # 3. PUT on default persona is rejected with 400
    res_put = client.put(f"/api/personas/{default_p['id']}", json={"name": "Overwritten"})
    assert res_put.status_code == 400
    assert "cannot be modified" in res_put.json()["detail"]

    # 4. DELETE on default persona is rejected with 400
    res_del = client.delete(f"/api/personas/{default_p['id']}")
    assert res_del.status_code == 400
    assert "cannot be deleted" in res_del.json()["detail"]


def test_legacy_campaign_persona_backfill(tmp_path: Path) -> None:
    """Test that pre-existing databases without persona columns migrate cleanly and backfill to default persona."""
    import sqlite3

    db_path = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(db_path)
    # Simulate legacy schema before personas were introduced
    conn.execute(
        """
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE worlds (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            global_rules_json TEXT NOT NULL DEFAULT '{}',
            pending_deletion INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE characters (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            world_id TEXT NULL,
            name TEXT NOT NULL,
            tagline TEXT NOT NULL,
            physical_appearance TEXT NOT NULL DEFAULT '',
            core_persona TEXT NOT NULL,
            initial_message TEXT NOT NULL DEFAULT '',
            equipped_json TEXT NOT NULL DEFAULT '[]',
            inventory_json TEXT NOT NULL DEFAULT '[]',
            voice_anchors_json TEXT NOT NULL DEFAULT '[]',
            baseline_psyche_json TEXT NOT NULL DEFAULT '{}',
            memory_shards_json TEXT NOT NULL DEFAULT '[]',
            pending_deletion INTEGER NOT NULL DEFAULT 0,
            tags_json TEXT NOT NULL DEFAULT '[]',
            creator TEXT NOT NULL DEFAULT '',
            creator_notes TEXT NOT NULL DEFAULT '',
            portraits_json TEXT NOT NULL DEFAULT '{}',
            gallery_json TEXT NOT NULL DEFAULT '[]',
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        """
    )
    # Crucial: campaigns table has NO persona_id or persona_snapshot_json column!
    conn.execute(
        """
        CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            world_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            active_leaf_turn_id TEXT NULL,
            prompt_preset_id TEXT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        INSERT INTO users VALUES ('u_legacy', 'legacy_admin', 'Admin', 'hash', 'admin', '2024-01-01', '2024-01-01');
        """
    )
    world_rules = '{"genre": "Cyberpunk Noir", "setting_overview": "Neo-Veridia", "tone": "Dark", "tech_or_magic_rules": "Chrome", "starting_timestamp": "2094-11-14 23:15"}'
    conn.execute(
        f"""
        INSERT INTO worlds VALUES ('w_legacy', 'u_legacy', 'Legacy World', '{world_rules}', 0, '2024-01-01');
        """
    )
    psyche_json = '{"core_drive": "Freedom", "core_fear": "Enslavement", "default_want": "Credits", "default_plan": "Smuggle"}'
    conn.execute(
        f"""
        INSERT INTO characters VALUES ('c_legacy', 'u_legacy', 'w_legacy', 'Kira', 'Smuggler', '', 'Core', '', '[]', '[]', '[]', '{psyche_json}', '[]', 0, '[]', '', '', '{{}}', '[]', 1, '2024-01-01');
        """
    )
    conn.execute(
        """
        INSERT INTO campaigns VALUES ('camp_old', 'u_legacy', 'Old Campaign', 'w_legacy', 'c_legacy', NULL, NULL, '2024-01-01');
        """
    )
    conn.commit()
    conn.close()

    # Initializing CantinaRepository on this legacy DB must NOT crash with "no such column: persona_id"
    repo = CantinaRepository(db_path)
    repo.init_db()

    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO location_nodes (id, world_id, name, summary, description, is_starting_location)
        VALUES ('loc_start', 'w_legacy', 'Starting Alley', 'Alley', 'Rainy alley.', 1);
        """
    )
    conn.commit()
    conn.close()

    # Legacy campaign must be backfilled to default 'User' persona
    camp = repo.get_campaign("camp_old")
    assert camp.persona_id == "persona_default_u_legacy"
    assert camp.persona_snapshot is not None
    assert camp.persona_snapshot.name == "User"
    assert camp.persona_snapshot.owner_id == "u_legacy"
    assert camp.persona_snapshot.physical_appearance == ""
    assert camp.persona_snapshot.equipped == []
    assert camp.persona_snapshot.inventory == []
    assert camp.persona_snapshot.lore_entries == []

    # Creating a new campaign with persona_id=None must also default to 'User' persona
    new_camp = repo.create_campaign(
        name="New Camp Without Persona",
        world_id="w_legacy",
        character_id="c_legacy",
        persona_id=None,
    )
    assert new_camp.persona_id == "persona_default_u_legacy"
    assert new_camp.persona_snapshot is not None
    assert new_camp.persona_snapshot.name == "User"
    assert new_camp.persona_snapshot.owner_id == "u_legacy"


def test_per_user_default_persona_isolation(temp_repo: CantinaRepository) -> None:
    """Verify that default personas are strictly per-user and enforce ownership requirements without relaxation."""
    u_a = temp_repo.create_user(username="user_alice", display_name="Alice", role="user", user_id="user_alice")
    u_b = temp_repo.create_user(username="user_bob", display_name="Bob", role="user", user_id="user_bob")

    p_a = temp_repo.get_persona(f"persona_default_user_alice", owner_id=u_a.id)
    p_b = temp_repo.get_persona(f"persona_default_user_bob", owner_id=u_b.id)

    assert p_a is not None
    assert p_a.id == "persona_default_user_alice"
    assert p_a.owner_id == "user_alice"
    assert p_a.name == "User"

    assert p_b is not None
    assert p_b.id == "persona_default_user_bob"
    assert p_b.owner_id == "user_bob"
    assert p_b.name == "User"

    # Alice cannot access Bob's default persona
    assert temp_repo.get_persona(p_b.id, owner_id=u_a.id) is None

    # Bob cannot access Alice's default persona
    assert temp_repo.get_persona(p_a.id, owner_id=u_b.id) is None

    # Alice's persona list only contains Alice's personas
    alice_list = temp_repo.list_personas(owner_id=u_a.id)
    assert any(p.id == p_a.id for p in alice_list)
    assert not any(p.id == p_b.id for p in alice_list)

    # Bob's persona list only contains Bob's personas
    bob_list = temp_repo.list_personas(owner_id=u_b.id)
    assert any(p.id == p_b.id for p in bob_list)
    assert not any(p.id == p_a.id for p in bob_list)


def test_persona_knowledge_provenance_sqlite_serialization(temp_repo: CantinaRepository) -> None:
    """Verify that PersonaKnowledgeProvenance objects serialize cleanly to SQLite without JSON error."""
    import json
    from app.schemas.persona import PersonaKnowledgeProvenance
    from app.db.repository import _dump_provenance_json
    from app.schemas.character import CharacterStateSnapshot

    prov_dict = {
        "item_deck": PersonaKnowledgeProvenance(
            unlocked_at_turn_id="turn_1",
            learned_from="player",
        )
    }

    # 1. Direct helper test
    dumped = _dump_provenance_json(prov_dict)
    loaded = json.loads(dumped)
    assert loaded["item_deck"]["unlocked_at_turn_id"] == "turn_1"
    assert loaded["item_deck"]["learned_from"] == "player"

    # 2. Dump via _dump_provenance_json test
    st = CharacterStateSnapshot(
        turn_id="turn_1",
        character_id="char_test",
        current_location_id="loc_test",
        mood_label="Alert",
        valence=0.0,
        arousal=0.5,
        active_want="Watch",
        active_plan="Observe",
        persona_knowledge_provenance=prov_dict,
    )
    dumped_from_st = _dump_provenance_json(st.persona_knowledge_provenance)
    assert "item_deck" in dumped_from_st
    loaded_from_st = json.loads(dumped_from_st)
    assert loaded_from_st["item_deck"]["learned_from"] == "player"


