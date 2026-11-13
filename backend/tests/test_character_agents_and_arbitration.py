"""Tests for Per-Character Post-Turn State Agents, Dispatch Modes, and Two-Tier Item Arbitration."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import pytest

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.dependencies import (
    get_effective_agent_dispatch_mode,
    get_effective_user_model_settings,
)
from app.engine.character_agent import (
    apply_character_inventory_delta,
    detect_inventory_disputes,
    normalize_mood_label,
    normalize_stance_updates,
)
from app.engine.llm_client import llm_client
from app.engine.phase2_context import assemble_four_zone_messages
from app.engine.phase4_clerk import run_phase4_post_turn_clerk
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterWizardDraft,
    CognitionBlock,
    MemoryShard,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    DiceRollResult,
    DisputedItemDecision,
    ExtractedCharacterMemory,
    ImprovisedLocationSpec,
    InventoryArbitrationResult,
    Phase4ProgressEvent,
    PreTurnAnalysis,
    WorldPostTurnDelta,
)


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_char_agents.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings, "agent_dispatch_mode", "sequential")
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


def _create_extra_characters(
    repo: CantinaRepository, world_id: str = "world_neon_rust"
) -> tuple[CharacterRecord, CharacterRecord]:
    """Create Viktor Kroll (co-present bouncer) and Nyx Holloway (backroom ripperdoc)."""
    viktor = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Viktor Kroll",
            tagline="Chrome-knuckled cantina enforcer with an old soldier's code.",
            physical_appearance="Broad-shouldered cyborg with brushed steel jawplates.",
            core_persona="Stoic, territorial orbital marine veteran who speaks in clipped baritone sentences.",
            equipped=["Reinforced Duster", "Heavy Stun Baton"],
            inventory=["Flask of Synth-Rye"],
            baseline_psyche=BaselinePsyche(
                mood_label="Stoic, watchful calm",
                valence=0.05,
                arousal=0.30,
                default_want="Keep trouble away from the main bar.",
                default_plan="Watch every patron's hands near the door.",
                core_drive="Protect the few allies he still has.",
                core_fear="Losing another squad under his watch.",
            ),
            memory_shards=[
                MemoryShard(
                    title="Siege at Callisto Dock",
                    content="Viktor held the airlock alone for twenty minutes so the med-shuttle could clear.",
                    keywords=["Callisto", "airlock", "siege"],
                    emotional_weight=0.85,
                )
            ],
        ),
        world_id=world_id,
    )
    nyx = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Nyx Holloway",
            tagline="Sleep-deprived backroom ripperdoc who trusts diagnostics over words.",
            physical_appearance="Pale surgical tech wearing magnifying optic loupes.",
            core_persona="Clinical, dry-humored ripperdoc who speaks in fast medical jargon laced with sarcasm.",
            equipped=["Bloodstained Scrub Coat", "Optic Loupes"],
            inventory=["Laser Scalpel"],
            baseline_psyche=BaselinePsyche(
                mood_label="Detached clinical focus",
                valence=-0.05,
                arousal=0.40,
                default_want="Calibrate the neural splicer undisturbed.",
                default_plan="Organize surgical trays in the back bay.",
                core_drive="Keep black-market patients alive off the grid.",
                core_fear="Corporate asset recovery teams finding her clinic.",
            ),
            memory_shards=[
                MemoryShard(
                    title="Vespera Ward Walkout",
                    content="Nyx wiped her corporate credentials the night Vespera triaged by credit score.",
                    keywords=["Vespera", "ward", "credentials"],
                    emotional_weight=0.80,
                )
            ],
        ),
        world_id=world_id,
    )
    return viktor, nyx


async def test_mood_and_stance_normalization_and_zone4_rendering(
    temp_repo: CantinaRepository,
) -> None:
    """Verify 2-4 word mood normalization, canonical stance keys, and human-readable Zone 4 rendering."""
    # 1. Mood normalization enforces crisp 2-4 word evocative descriptions
    m1 = normalize_mood_label(
        "She feels guarded and coiled because Viktor just slammed the steel shutter (valence: -0.4, arousal: 0.8)"
    )
    assert 2 <= len(m1.split()) <= 4
    assert m1 == "Guarded and coiled"

    m2 = normalize_mood_label("Furious!")
    assert 2 <= len(m2.split()) <= 4
    assert "Furious" in m2

    m3 = normalize_mood_label("   ", fallback="Wary nocturnal focus")
    assert m3 == "Wary nocturnal focus"

    # 2. Stance normalization maps aliases/names to canonical IDs and strips self-references
    kira = temp_repo.get_character("char_kira_vance")
    viktor, nyx = _create_extra_characters(temp_repo)
    participants = [kira, viktor, nyx]

    norm_stances = normalize_stance_updates(
        {
            "The Player": "Suspects they are hiding a Syndicate tracker. Keep watching them.",
            "Viktor": "Grateful that he stepped between the bar and the door",
            "Nyx Holloway": "Trusts her surgical hands if things turn bloody.",
            "Kira Vance": "Should never store a stance toward herself.",
            kira.id: "Also ignored self ID.",
        },
        self_id=kira.id,
        self_name=kira.name,
        known_characters=participants,
    )
    assert set(norm_stances.keys()) == {"user", viktor.id, nyx.id}
    assert norm_stances["user"] == "Suspects they are hiding a Syndicate tracker."
    assert norm_stances[viktor.id] == "Grateful that he stepped between the bar and the door."
    assert kira.id not in norm_stances

    # 3. Zone 4 renders human-readable names instead of opaque char_* IDs
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    world = temp_repo.get_world(bundle.campaign.world_id)
    last_turn = bundle.active_branch_turns[-1]
    enriched_state = last_turn.character_state.model_copy(
        update={"relationship_notes": norm_stances}
    )
    mutated_root = last_turn.model_copy(
        update={
            "character_state": enriched_state,
            "character_states": {kira.id: enriched_state},
        }
    )
    msgs = assemble_four_zone_messages(
        world=world,
        character=kira,
        branch_turns=[mutated_root],
        episodic_chunks=[],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=last_turn.pre_turn,
        user_message="Anyone following us?",
        present_characters=[kira, viktor],
        character_name_map={c.id: c.name for c in participants},
    )
    zone4 = msgs[-1]["content"]
    assert "Stance toward Viktor Kroll:" in zone4
    assert "Grateful that he stepped between the bar and the door." in zone4
    # Absent Nyx (not in present_characters) is omitted from Zone 4 O(1) dyadic rendering
    assert "Nyx Holloway" not in zone4
    assert viktor.id not in zone4
    assert nyx.id not in zone4


def test_four_bucket_inventory_state_machine() -> None:
    """Verify 4-bucket transitions across equipped and carried inventory without item duplication."""
    existing_equipped = ["Armored Flight Jacket", "Sidearm Pistol"]
    existing_inventory = ["Trauma Medkit", "Encrypted Datashard", " brass Knuckles "]

    delta = CharacterAgentDelta(
        mood_label="Focused tactical readiness",
        items_equipped=["Brass Knuckles", "[Worn] Thermal Visor"],  # draws knuckles from inv + equips new visor
        items_unequipped=["Sidearm Pistol"],  # holsters pistol into carried inventory
        items_obtained=["Access Keycard"],  # pockets new keycard
        items_removed=["Trauma Medkit"],  # hands away medkit
    )

    new_eq, new_inv = apply_character_inventory_delta(
        existing_equipped=existing_equipped,
        existing_inventory=existing_inventory,
        delta=delta,
    )

    assert "Armored Flight Jacket" in new_eq
    assert "Brass Knuckles" in new_eq
    assert "Thermal Visor" in new_eq
    assert "Sidearm Pistol" not in new_eq

    # Sidearm Pistol moved to carried inventory; Brass Knuckles was NOT duplicated in carried inventory
    assert "Sidearm Pistol" in new_inv
    assert "Access Keycard" in new_inv
    assert "Encrypted Datashard" in new_inv
    assert not any("knuckles" in it.lower() for it in new_inv)
    assert not any("medkit" in it.lower() for it in new_inv)


async def test_multi_character_copresent_evolution_anchor_safety_and_spatial_isolation(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Verify co-present characters (speaker Kira + silent witness Viktor) both evolve mood, anchored
    valence/arousal, mutual stances, and character-specific memories, while absent Nyx stays untouched.
    """
    kira = temp_repo.get_character("char_kira_vance")
    viktor, nyx = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)
    ripper_bay = next(loc for loc in world.locations if loc.id != main_bar.id)

    camp = temp_repo.create_campaign(
        name="Three-Character Cantina Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id, nyx.id],
        character_locations={
            kira.id: main_bar.id,
            viktor.id: main_bar.id,
            nyx.id: ripper_bay.id,
        },
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    kira_pre = bundle0.character_states[kira.id]
    viktor_pre = bundle0.character_states[viktor.id]
    nyx_pre = bundle0.character_states[nyx.id]
    nyx_shards_pre = list(bundle0.character_records[nyx.id].memory_shards)

    # Note: save_turn_node writes Phase 3 cognition valence (-0.50) onto turn1.character_state BEFORE Phase 4 runs.
    # Phase 4 must anchor Kira's valence_delta (-0.30) to kira_pre.valence (Turn 0), NOT to -0.50!
    turn1 = temp_repo.save_turn_node(
        turn_id="turn_multi_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="I sold the courier route to Vespera Security, Kira. Viktor, back off.",
        actor_id=kira.id,
        raw_prose=(
            '*Kira recoils behind the neon counter while Viktor steps forward, steel jaw set.* '
            '"You sold us to Vespera?" Kira whispers.'
        ),
        cognition=CognitionBlock(
            recall="- Remembers the Meridian raid.",
            feeling="Cold shock and betrayal",
            valence=-0.50,
            arousal=0.82,
            want="Lock down the exits before Vespera arrives.",
            plan="- Signal Viktor to bar the front shutter.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="confrontational confession",
            subtext_interpretation="User confesses selling the route to Vespera Security",
            mentioned_entities=["Vespera", "Kira", "Viktor"],
            memory_search_queries=["Vespera route"],
            spatial_intent="stay",
        ),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_multi_1"}),
        character_state=kira_pre.model_copy(
            update={
                "turn_id": "turn_multi_1",
                "mood_label": "Cold shock and betrayal",
                "valence": -0.50,
                "arousal": 0.82,
            }
        ),
        extra_character_states=[
            viktor_pre.model_copy(update={"turn_id": "turn_multi_1"}),
            nyx_pre.model_copy(update={"turn_id": "turn_multi_1"}),
        ],
        recalled_items=[],
    )

    called_char_prompts: list[str] = []

    async def mock_complete_structured(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
    ) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=3,
                transition_type="stay",
                notable_event_summary="The player confessed selling the courier route to Vespera Security.",
                scene_flags_updated=["Vespera betrayal exposed"],
            )
        if response_model is CharacterAgentDelta:
            user_prompt = messages[-1]["content"]
            called_char_prompts.append(user_prompt)
            if f"- Name: {kira.name} (id='{kira.id}')" in user_prompt:
                return CharacterAgentDelta(
                    mood_label="Cold betrayed fury",
                    valence_delta=-0.30,
                    arousal_delta=0.25,
                    updated_want="Seal the cantina before Vespera strike teams arrive.",
                    stance_updates={
                        "Player": "Views them as a dangerous traitor who sold the route to Vespera.",
                        "Viktor": "Relies on him to hold the front door against incoming Mercs.",
                    },
                    new_memories=[
                        ExtractedCharacterMemory(
                            character_id=kira.id,
                            significance="betrayal",
                            title="Vespera Route Betrayal",
                            content="The player confessed to selling the Neon Rust courier route to Vespera Security.",
                            keywords=["Vespera", "betrayal", "route"],
                            emotional_weight=0.92,
                        )
                    ],
                )
            if f"- Name: {viktor.name} (id='{viktor.id}')" in user_prompt:
                return CharacterAgentDelta(
                    mood_label="Bristling protective hostility",
                    valence_delta=-0.25,
                    arousal_delta=0.35,
                    updated_want="Pin the informant if Kira gives the word.",
                    stance_updates={
                        "user": "Ready to drop them the second they reach for a weapon.",
                        "Kira Vance": "Watching her hand for the signal to lock the blast shutters.",
                    },
                    items_equipped=["Heavy Stun Baton"],
                    new_memories=[
                        ExtractedCharacterMemory(
                            character_id=viktor.id,
                            significance="betrayal",
                            title="Informant Exposed at the Bar",
                            content="Viktor witnessed the player admit selling Kira's courier route to Vespera.",
                            keywords=["Vespera", "informant", "Kira"],
                            emotional_weight=0.80,
                        )
                    ],
                )
            raise AssertionError(f"Unexpected CharacterAgentDelta call: {user_prompt[:120]}")
        raise AssertionError(f"Unexpected model {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", mock_complete_structured)

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn1,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],  # Nyx is in ripper_bay, NOT present
        all_participants=[kira, viktor, nyx],
        dispatch_mode="sequential",
    )

    # Exactly 2 Character Agents ran (Kira & Viktor); absent Nyx was never dispatched
    assert len(called_char_prompts) == 2
    assert not any(f"id='{nyx.id}'" in p for p in called_char_prompts)

    bundle1 = temp_repo.get_campaign_state_bundle(camp.id)
    kira_after = bundle1.character_states[kira.id]
    viktor_after = bundle1.character_states[viktor.id]
    nyx_after = bundle1.character_states[nyx.id]

    # Anchor safety: Kira's CARE Kalman-filtered valence drops from kira_pre.valence, NOT stacking onto -0.50!
    assert kira_after.valence < kira_pre.valence
    assert kira_after.valence > -0.75
    assert kira_after.arousal > kira_pre.arousal
    assert kira_after.mood_label == "Cold betrayed fury"
    assert kira_after.care_state is not None and kira_after.care_state.is_provisional is False
    assert "Views them as a dangerous traitor" in kira_after.relationship_notes["user"]
    assert "Relies on him to hold" in kira_after.relationship_notes[viktor.id]

    # Silent witness Viktor also evolved mood, valence/arousal, stances, and personal memory!
    assert viktor_after.valence < viktor_pre.valence
    assert viktor_after.arousal > viktor_pre.arousal
    assert viktor_after.mood_label == "Bristling protective hostility"
    assert viktor_after.care_state is not None and viktor_after.care_state.is_provisional is False
    assert "Ready to drop them" in viktor_after.relationship_notes["user"]
    assert "Watching her hand" in viktor_after.relationship_notes[kira.id]

    kira_ephem = [
        s for s in bundle1.character_records[kira.id].memory_shards if s.origin == "clerk_ephemeral"
    ]
    viktor_ephem = [
        s for s in bundle1.character_records[viktor.id].memory_shards if s.origin == "clerk_ephemeral"
    ]
    assert len(kira_ephem) == 1 and kira_ephem[0].title == "Vespera Route Betrayal"
    assert len(viktor_ephem) == 1 and viktor_ephem[0].title == "Informant Exposed at the Bar"

    # Absent Nyx's state and memories are 100% untouched
    assert nyx_after.current_location_id == ripper_bay.id
    assert nyx_after.mood_label == nyx_pre.mood_label
    assert nyx_after.valence == nyx_pre.valence
    assert nyx_after.arousal == nyx_pre.arousal
    assert nyx_after.relationship_notes == nyx_pre.relationship_notes
    assert len(bundle1.character_records[nyx.id].memory_shards) == len(nyx_shards_pre)


async def test_sequential_vs_parallel_agent_dispatch_and_settings_endpoints(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify sequential concurrency == 1, parallel concurrency >= 3, and API settings persistence."""
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    camp = temp_repo.create_campaign(
        name="Dispatch Concurrency Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: main_bar.id, viktor.id: main_bar.id},
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    in_flight = 0
    max_observed_concurrency = 0

    async def instrumented_complete_structured(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
    ) -> Any:
        nonlocal in_flight, max_observed_concurrency
        in_flight += 1
        max_observed_concurrency = max(max_observed_concurrency, in_flight)
        try:
            await asyncio.sleep(0.03)
            if response_model is WorldPostTurnDelta:
                return WorldPostTurnDelta(elapsed_minutes=2, transition_type="stay")
            if response_model is CharacterAgentDelta:
                return CharacterAgentDelta(
                    mood_label="Alert shared focus",
                    valence_delta=0.05,
                    arousal_delta=0.05,
                    stance_updates={"user": "Keeping a steady eye on the newcomer."},
                )
            raise AssertionError(f"Unexpected schema {response_model}")
        finally:
            in_flight -= 1

    monkeypatch.setattr(llm_client, "complete_structured", instrumented_complete_structured)

    # 1. Sequential mode: strictly 1 LLM call in-flight at a time
    t_seq = temp_repo.save_turn_node(
        turn_id="turn_seq_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Quiet night at the bar.",
        actor_id=kira.id,
        raw_prose='*Kira polishes a glass while Viktor leans by the pillar.* "Quiet for now."',
        cognition=CognitionBlock(feeling="Calm", valence=0.1, arousal=0.3),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_seq_1"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_seq_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_seq_1"})
        ],
        recalled_items=[],
    )
    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t_seq,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
        dispatch_mode="sequential",
    )
    assert max_observed_concurrency == 1
    seq_states = temp_repo.get_campaign_state_bundle(camp.id).character_states

    # 2. Parallel mode (sibling branch from root_turn): World Clerk + 2 Character Agents run concurrently (>= 3)
    max_observed_concurrency = 0
    t_par = temp_repo.save_turn_node(
        turn_id="turn_par_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Quiet night at the bar.",
        actor_id=kira.id,
        raw_prose='*Kira polishes a glass while Viktor leans by the pillar.* "Quiet for now."',
        cognition=CognitionBlock(feeling="Calm", valence=0.1, arousal=0.3),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_par_1"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_par_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_par_1"})
        ],
        recalled_items=[],
    )
    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t_par,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
        dispatch_mode="parallel",
    )
    assert max_observed_concurrency >= 3
    par_states = temp_repo.get_campaign_state_bundle(camp.id).character_states

    for cid in (kira.id, viktor.id):
        assert par_states[cid].mood_label == seq_states[cid].mood_label
        assert par_states[cid].valence == seq_states[cid].valence
        assert par_states[cid].arousal == seq_states[cid].arousal
        assert par_states[cid].relationship_notes == seq_states[cid].relationship_notes

    # 3. Verify /api/settings and /api/profile/models round-trip for agent_dispatch_mode
    import app.routers.settings as settings_router

    monkeypatch.setattr(settings_router, "persist_settings", lambda *a, **kw: None)

    client = TestClient(main_module.app)
    boot_admin = client.post(
        "/api/auth/setup",
        json={"username": "admin_disp", "display_name": "Admin", "password": "password123"},
    )
    assert boot_admin.status_code == 200
    admin_token = boot_admin.json()["token"]
    admin_id = boot_admin.json()["user"]["id"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    reg_user = client.post(
        "/api/auth/register",
        json={"username": "player_disp", "display_name": "Player", "password": "password123"},
    )
    assert reg_user.status_code == 200
    user_token = reg_user.json()["token"]
    user_id = reg_user.json()["user"]["id"]
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # Default global dispatch mode is sequential
    curr_settings = client.get("/api/settings", headers=admin_headers).json()
    assert curr_settings["agent_dispatch_mode"] == "sequential"
    assert get_effective_agent_dispatch_mode(user_id) == "sequential"

    # Admin enables user overrides; keep global default sequential while user overrides to parallel
    curr_settings["allow_user_model_overrides"] = True
    put_global = client.put("/api/settings", headers=admin_headers, json=curr_settings)
    assert put_global.status_code == 200

    put_user = client.put(
        "/api/profile/models",
        headers=user_headers,
        json={
            "actor_profile": curr_settings["actor_profile"],
            "clerk_profile": curr_settings["clerk_profile"],
            "agent_dispatch_mode": "parallel",
        },
    )
    assert put_user.status_code == 200
    prof_body = put_user.json()
    assert prof_body["default_agent_dispatch_mode"] == "sequential"
    assert prof_body["user_agent_dispatch_mode"] == "parallel"
    assert prof_body["effective_agent_dispatch_mode"] == "parallel"
    assert get_effective_agent_dispatch_mode(user_id) == "parallel"
    assert get_effective_agent_dispatch_mode(admin_id) == "sequential"
    # Existing 5-tuple helper contract remains unbroken
    assert len(get_effective_user_model_settings(user_id)) == 5

    # Resetting user overrides restores global default
    del_res = client.delete("/api/profile/models", headers=user_headers)
    assert del_res.status_code == 200
    assert del_res.json()["effective_agent_dispatch_mode"] == "sequential"
    assert get_effective_agent_dispatch_mode(user_id) == "sequential"


async def test_two_tier_item_dispute_arbitration(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Verify Two-Tier Item Arbitration:
    - Tier 1 uncontested handoff triggers 0 Arbitrator LLM calls.
    - Tier 2 multi-claim dispute invokes Arbitrator LLM (and offline fallback) without duplicating items.
    - Tier 2 unrelinquished transfer removes from prior holder on transfer OR blocks thief on retention.
    """
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    camp = temp_repo.create_campaign(
        name="Item Arbitration Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: main_bar.id, viktor.id: main_bar.id},
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    # Seed Kira with a Trauma Medkit in inventory and a Plasma Torch in equipped
    kira_seed_state = bundle0.character_states[kira.id].model_copy(
        update={
            "equipped": ["Armored Jacket", "Plasma Torch"],
            "inventory": ["Trauma Medkit"],
        }
    )
    viktor_seed_state = bundle0.character_states[viktor.id]
    temp_repo.update_turn_post_clerk(
        turn_id=root_turn.id,
        post_turn=root_turn.post_turn
        or WorldPostTurnDelta(elapsed_minutes=0, transition_type="stay"),  # type: ignore[arg-type]
        updated_world_snapshot=root_turn.world_snapshot,
        updated_character_state=kira_seed_state,
        extra_character_states=[viktor_seed_state],
    ) if root_turn.post_turn else None

    # Save Turn 1 for Scenario A: Uncontested handoff (Kira removes Trauma Medkit, Viktor obtains Trauma Medkit)
    turn_a = temp_repo.save_turn_node(
        turn_id="turn_arb_a",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Kira, toss Viktor the medkit.",
        actor_id=kira.id,
        raw_prose='*Kira tosses the Trauma Medkit across the bar, and Viktor catches it cleanly.*',
        cognition=CognitionBlock(feeling=" Brisk focus", valence=0.1, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_arb_a"}),
        character_state=kira_seed_state.model_copy(update={"turn_id": "turn_arb_a"}),
        extra_character_states=[viktor_seed_state.model_copy(update={"turn_id": "turn_arb_a"})],
        recalled_items=[],
    )
    # Also persist kira_seed_state onto root_turn so prior_branch_turns has Trauma Medkit & Plasma Torch!
    from app.schemas.turn import PostTurnStateDelta

    temp_repo.update_turn_post_clerk(
        turn_id=root_turn.id,
        post_turn=PostTurnStateDelta(elapsed_minutes=0, transition_type="stay"),
        updated_world_snapshot=root_turn.world_snapshot,
        updated_character_state=kira_seed_state,
        extra_character_states=[viktor_seed_state],
    )

    arbitrator_calls = 0

    async def mock_handoff_llm(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
    ) -> Any:
        nonlocal arbitrator_calls
        if response_model is InventoryArbitrationResult:
            arbitrator_calls += 1
            return InventoryArbitrationResult(decisions=[])
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=1, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"- Name: {kira.name} (id='{kira.id}')" in prompt:
                return CharacterAgentDelta(
                    mood_label="Crisp cooperative focus",
                    items_removed=["Trauma Medkit"],
                )
            return CharacterAgentDelta(
                mood_label="Steady readiness",
                items_obtained=["Trauma Medkit"],
            )
        raise AssertionError(f"Unexpected {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", mock_handoff_llm)

    updated_a, _ = await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn_a,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )
    assert arbitrator_calls == 0
    assert updated_a.post_turn is not None
    assert updated_a.post_turn.arbitration_notes == []
    bundle_a = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Trauma Medkit" not in bundle_a.character_states[kira.id].inventory
    assert "Trauma Medkit" in bundle_a.character_states[viktor.id].inventory

    # Scenario B: Multi-claim dispute (both Kira and Viktor claim 'Encrypted Datashard' from the table)
    turn_b = temp_repo.save_turn_node(
        turn_id="turn_arb_b",
        campaign_id=camp.id,
        parent_turn_id="turn_arb_a",
        depth_index=2,
        user_message="I slide the Encrypted Datashard onto the table between them.",
        actor_id=kira.id,
        raw_prose=(
            '*Kira lunges for the shard, but Viktor intercepts it first and pockets the Encrypted Datashard.*'
        ),
        cognition=CognitionBlock(feeling="Sharp tension", valence=-0.1, arousal=0.7),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=updated_a.world_snapshot.model_copy(update={"turn_id": "turn_arb_b"}),
        character_state=bundle_a.character_states[kira.id].model_copy(update={"turn_id": "turn_arb_b"}),
        extra_character_states=[
            bundle_a.character_states[viktor.id].model_copy(update={"turn_id": "turn_arb_b"})
        ],
        recalled_items=[],
    )

    async def mock_multiclaim_llm(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
    ) -> Any:
        nonlocal arbitrator_calls
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=1, transition_type="stay")
        if response_model is CharacterAgentDelta:
            # Both agents optimistically claim the Encrypted Datashard!
            return CharacterAgentDelta(
                mood_label="Tense competitive edge",
                items_obtained=["Encrypted Datashard"],
            )
        if response_model is InventoryArbitrationResult:
            arbitrator_calls += 1
            return InventoryArbitrationResult(
                decisions=[
                    DisputedItemDecision(
                        item_name="Encrypted Datashard",
                        winner_id=viktor.id,
                        rationale="Viktor intercepted and pocketed the shard before Kira reached it.",
                    )
                ]
            )
        raise AssertionError(f"Unexpected {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", mock_multiclaim_llm)

    updated_b, _ = await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn_b,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )
    assert arbitrator_calls == 1
    assert updated_b.post_turn is not None
    assert len(updated_b.post_turn.arbitration_notes) == 1
    assert "Viktor Kroll" in updated_b.post_turn.arbitration_notes[0]

    bundle_b = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Encrypted Datashard" in bundle_b.character_states[viktor.id].inventory
    assert "Encrypted Datashard" not in bundle_b.character_states[kira.id].inventory
    assert "Encrypted Datashard" not in bundle_b.character_states[kira.id].equipped

    # Scenario C1: Unrelinquished transfer where Arbitrator awards Kira's 'Plasma Torch' to Viktor
    # (Kira forgot to list Plasma Torch in items_removed; Arbitrator must auto-remove it from Kira!)
    turn_c1 = temp_repo.save_turn_node(
        turn_id="turn_arb_c1",
        campaign_id=camp.id,
        parent_turn_id="turn_arb_b",
        depth_index=3,
        user_message="Viktor wrenches the Plasma Torch from Kira's grip to weld the hatch!",
        actor_id=kira.id,
        raw_prose='*Viktor wrenches the Plasma Torch from Kira and ignites the arc welder.*',
        cognition=CognitionBlock(feeling="Startled urgency", valence=-0.1, arousal=0.75),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=updated_b.world_snapshot.model_copy(update={"turn_id": "turn_arb_c1"}),
        character_state=bundle_b.character_states[kira.id].model_copy(update={"turn_id": "turn_arb_c1"}),
        extra_character_states=[
            bundle_b.character_states[viktor.id].model_copy(update={"turn_id": "turn_arb_c1"})
        ],
        recalled_items=[],
    )

    async def mock_unrelinquished_offline_arb(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
    ) -> Any:
        nonlocal arbitrator_calls
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=1, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"- Name: {kira.name} (id='{kira.id}')" in prompt:
                # Kira forgot to put Plasma Torch in items_removed!
                return CharacterAgentDelta(mood_label="Startled urgent focus")
            return CharacterAgentDelta(
                mood_label="Grim mechanical urgency",
                items_equipped=["Plasma Torch"],
            )
        if response_model is InventoryArbitrationResult:
            arbitrator_calls += 1
            # Exercise the offline deterministic referee fallback on prose ("Viktor wrenches the Plasma Torch")!
            raise ConnectionError("Simulated offline arbitrator")
        raise AssertionError(f"Unexpected {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", mock_unrelinquished_offline_arb)

    updated_c1, _ = await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn_c1,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )
    assert arbitrator_calls == 2
    bundle_c1 = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Plasma Torch" in bundle_c1.character_states[viktor.id].equipped
    assert "Plasma Torch" not in bundle_c1.character_states[kira.id].equipped
    assert "Plasma Torch" not in bundle_c1.character_states[kira.id].inventory

    # Scenario C2: Failed roll on unrelinquished disarm -> prior holder (Viktor) retains Heavy Stun Baton
    disputes = detect_inventory_disputes(
        scene_characters=[kira, viktor],
        prev_states_by_char=bundle_c1.character_states,
        character_deltas={
            kira.id: CharacterAgentDelta(
                mood_label="Desperate lunge",
                items_equipped=["Heavy Stun Baton"],
            ),
            viktor.id: CharacterAgentDelta(mood_label="Iron grip"),
        },
    )
    assert len(disputes) == 1
    assert disputes[0].reason == "unrelinquished_transfer"
    assert disputes[0].prior_holder_id == viktor.id

    failed_turn = turn_c1.model_copy(
        update={
            "raw_prose": "*Kira reaches for the baton, but Viktor steps back.*",
            "pre_turn": PreTurnAnalysis(
                spatial_intent="stay",
                resolved_roll=DiceRollResult(
                    action_description="Snatch Viktor's baton",
                    skill_or_approach="Reflex",
                    difficulty_class=16,
                    d20_raw=4,
                    modifier=0,
                    total=4,
                    outcome_tier="Failure with Consequence",
                    narrative_directive="The grab fails.",
                ),
            ),
        }
    )
    from app.engine.character_agent import arbitrate_inventory_disputes

    reconciled_c2, notes_c2 = await arbitrate_inventory_disputes(
        disputes=disputes,
        scene_characters=[kira, viktor],
        character_deltas={
            kira.id: CharacterAgentDelta(mood_label="Desperate lunge", items_equipped=["Heavy Stun Baton"]),
            viktor.id: CharacterAgentDelta(mood_label="Iron grip"),
        },
        completed_turn=failed_turn,
    )
    assert reconciled_c2[kira.id].items_equipped == []
    assert reconciled_c2[viktor.id].items_removed == []
    assert "Viktor Kroll" in notes_c2[0]


async def test_independent_character_spatial_transitions(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Verify independent character movement:
    1. 'stay_here' vs 'follow_player' when player moves to an existing neighbor room.
    2. 'follow_player' when Global Clerk improvises a brand-new location.
    3. 'move_to_neighbor' when an NPC storms out into an adjacent room while the player stays put.
    """
    kira = temp_repo.get_character("char_kira_vance")
    viktor, nyx = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    camp = temp_repo.create_campaign(
        name="Spatial Independence Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id, nyx.id],
        character_locations={
            kira.id: main_bar.id,
            viktor.id: main_bar.id,
            nyx.id: main_bar.id,
        },
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]
    ripper_neighbor = bundle0.neighbor_locations[0].destination

    # Step 1: Player moves into ripper_neighbor; Kira & Nyx follow, Viktor stays behind in main_bar
    turn1 = temp_repo.save_turn_node(
        turn_id="turn_move_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message=f"Viktor, stay here and watch the door. Kira, Nyx, follow me into {ripper_neighbor.name}.",
        actor_id=kira.id,
        raw_prose=f'*Viktor nods by the bar while Kira and Nyx duck into {ripper_neighbor.name} with you.*',
        cognition=CognitionBlock(feeling="Urgent focus", valence=0.0, arousal=0.6),
        pre_turn=PreTurnAnalysis(
            spatial_intent="move_known",
            target_location_hint=ripper_neighbor.name,
        ),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_move_1"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_move_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_move_1"}),
            bundle0.character_states[nyx.id].model_copy(update={"turn_id": "turn_move_1"}),
        ],
        recalled_items=[],
    )

    async def mock_step1_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=2,
                transition_type="move_existing",
                target_location_id=ripper_neighbor.id,
            )
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"- Name: {viktor.name} (id='{viktor.id}')" in prompt:
                return CharacterAgentDelta(
                    mood_label="Vigilant door watch",
                    location_transition="stay_here",
                )
            return CharacterAgentDelta(
                mood_label="Brisk tactical focus",
                location_transition="follow_player",
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_step1_llm)

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn1,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor, nyx],
        all_participants=[kira, viktor, nyx],
    )

    bundle1 = temp_repo.get_campaign_state_bundle(camp.id)
    assert bundle1.active_location.id == ripper_neighbor.id
    assert bundle1.character_states[kira.id].current_location_id == ripper_neighbor.id
    assert bundle1.character_states[nyx.id].current_location_id == ripper_neighbor.id
    assert bundle1.character_states[viktor.id].current_location_id == main_bar.id
    assert set(bundle1.present_character_ids) == {kira.id, nyx.id}

    # Step 2: Player stays in ripper_neighbor while Nyx independently moves back to neighbor main_bar!
    turn2 = temp_repo.save_turn_node(
        turn_id="turn_move_2",
        campaign_id=camp.id,
        parent_turn_id="turn_move_1",
        depth_index=2,
        user_message="Nyx, go check on Viktor in the main bar while Kira and I inspect the splicer.",
        actor_id=kira.id,
        raw_prose='*Nyx rolls her eyes and slips back through the curtain toward the main floor.*',
        cognition=CognitionBlock(feeling="Focused", valence=0.1, arousal=0.5),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle1.current_world_snapshot.model_copy(update={"turn_id": "turn_move_2"}),
        character_state=bundle1.character_states[kira.id].model_copy(update={"turn_id": "turn_move_2"}),
        extra_character_states=[
            bundle1.character_states[viktor.id].model_copy(update={"turn_id": "turn_move_2"}),
            bundle1.character_states[nyx.id].model_copy(update={"turn_id": "turn_move_2"}),
        ],
        recalled_items=[],
    )

    async def mock_step2_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=2, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"- Name: {nyx.name} (id='{nyx.id}')" in prompt:
                return CharacterAgentDelta(
                    mood_label="Brisk annoyed compliance",
                    location_transition="move_to_neighbor",
                    target_location_id=main_bar.id,
                )
            return CharacterAgentDelta(
                mood_label="Quiet focused inspection",
                location_transition="stay_here",
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_step2_llm)

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn2,
        active_location=bundle1.active_location,
        neighbors=bundle1.neighbor_locations,
        present_characters=[kira, nyx],
        all_participants=[kira, viktor, nyx],
    )

    bundle2 = temp_repo.get_campaign_state_bundle(camp.id)
    assert bundle2.active_location.id == ripper_neighbor.id
    assert bundle2.character_states[kira.id].current_location_id == ripper_neighbor.id
    assert bundle2.character_states[nyx.id].current_location_id == main_bar.id
    assert bundle2.present_character_ids == [kira.id]

    # Step 3: Player & Kira climb into an improvised Sub-Basement Conduit ('follow_player' resolves new ID)
    turn3 = temp_repo.save_turn_node(
        turn_id="turn_move_3",
        campaign_id=camp.id,
        parent_turn_id="turn_move_2",
        depth_index=3,
        user_message="Let's pry open the floor grate and climb down into the cooling conduit.",
        actor_id=kira.id,
        raw_prose='*Kira drops her boots onto the wet catwalk of the sub-basement cooling conduit beside you.*',
        cognition=CognitionBlock(feeling="Alert", valence=0.05, arousal=0.65),
        pre_turn=PreTurnAnalysis(spatial_intent="explore_new", target_location_hint="cooling conduit"),
        world_snapshot=bundle2.current_world_snapshot.model_copy(update={"turn_id": "turn_move_3"}),
        character_state=bundle2.character_states[kira.id].model_copy(update={"turn_id": "turn_move_3"}),
        extra_character_states=[
            bundle2.character_states[viktor.id].model_copy(update={"turn_id": "turn_move_3"}),
            bundle2.character_states[nyx.id].model_copy(update={"turn_id": "turn_move_3"}),
        ],
        recalled_items=[],
    )

    async def mock_step3_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=4,
                transition_type="improvise_new",
                improvised_location=ImprovisedLocationSpec(
                    name="Sub-Basement Cooling Conduit",
                    summary="Condensation-slick maintenance tunnel humming with coolant pipes.",
                    description="Low concrete ceiling lined with sweating coolant manifolds and rusted grates.",
                    environmental_tags=["coolant mist", "rusted catwalk"],
                    direction_label="Down through the pried floor grate",
                    compass_direction="S",
                    travel_minutes=2,
                ),
            )
        if response_model is CharacterAgentDelta:
            return CharacterAgentDelta(
                mood_label="Tense subterranean vigilance",
                location_transition="follow_player",
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_step3_llm)

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn3,
        active_location=bundle2.active_location,
        neighbors=bundle2.neighbor_locations,
        present_characters=[kira],
        all_participants=[kira, viktor, nyx],
    )

    bundle3 = temp_repo.get_campaign_state_bundle(camp.id)
    assert bundle3.active_location.name == "Sub-Basement Cooling Conduit"
    assert bundle3.character_states[kira.id].current_location_id == bundle3.active_location.id
    assert bundle3.character_states[viktor.id].current_location_id == main_bar.id
    assert bundle3.character_states[nyx.id].current_location_id == main_bar.id


async def test_narrator_turn_emotional_anchor_and_branch_rewind_safety(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Verify:
    1. '__narrator__' turns skip Character Agent LLM calls and preserve all co-present emotional anchors.
    2. Branch rewind restores every character's prior mood, valence, stances, inventory, and location.
    """
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    camp = temp_repo.create_campaign(
        name="Narrator & Branch Rollback Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: main_bar.id, viktor.id: main_bar.id},
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    char_agent_calls = 0

    async def mock_narrator_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        nonlocal char_agent_calls
        if response_model is CharacterAgentDelta:
            char_agent_calls += 1
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=15,
                transition_type="stay",
                scene_flags_updated=["Acid rain drumming on roof"],
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_narrator_llm)

    narrator_turn = temp_repo.save_turn_node(
        turn_id="turn_narrator_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="[Advance 15 minutes]",
        actor_id="__narrator__",
        raw_prose="Heavy acid rain begins hammering the corrugated roof above the Neon Rust.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_narrator_1"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_narrator_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_narrator_1"})
        ],
        recalled_items=[],
    )

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=narrator_turn,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )

    assert char_agent_calls == 0
    bundle_nar = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Acid rain drumming on roof" in bundle_nar.current_world_snapshot.scene_flags
    for cid in (kira.id, viktor.id):
        assert bundle_nar.character_states[cid].mood_label == bundle0.character_states[cid].mood_label
        assert bundle_nar.character_states[cid].valence == bundle0.character_states[cid].valence
        assert bundle_nar.character_states[cid].arousal == bundle0.character_states[cid].arousal
        assert bundle_nar.character_states[cid].equipped == bundle0.character_states[cid].equipped

    # Turn 2: Mutate both characters heavily on a dramatic turn, then rewind to Turn 1!
    neighbor_dest = bundle_nar.neighbor_locations[0].destination

    async def mock_drama_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=5, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"- Name: {kira.name} (id='{kira.id}')" in prompt:
                return CharacterAgentDelta(
                    mood_label="Shaken furious resolve",
                    valence_delta=-0.45,
                    arousal_delta=0.40,
                    stance_updates={"user": "Furious over the reckless stunt."},
                    items_obtained=["Recovered Credstick"],
                )
            return CharacterAgentDelta(
                mood_label="Cold disgusted departure",
                valence_delta=-0.35,
                arousal_delta=0.20,
                stance_updates={"user": "Done listening to excuses."},
                location_transition="move_to_neighbor",
                target_location_id=neighbor_dest.id,
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_drama_llm)

    drama_turn = temp_repo.save_turn_node(
        turn_id="turn_drama_2",
        campaign_id=camp.id,
        parent_turn_id="turn_narrator_1",
        depth_index=2,
        user_message="I slam the stolen credstick onto the counter.",
        actor_id=kira.id,
        raw_prose='*Kira snatches the credstick while Viktor shakes his head and walks into the back corridor.*',
        cognition=CognitionBlock(feeling="Furious", valence=-0.4, arousal=0.8),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle_nar.current_world_snapshot.model_copy(update={"turn_id": "turn_drama_2"}),
        character_state=bundle_nar.character_states[kira.id].model_copy(update={"turn_id": "turn_drama_2"}),
        extra_character_states=[
            bundle_nar.character_states[viktor.id].model_copy(update={"turn_id": "turn_drama_2"})
        ],
        recalled_items=[],
    )

    await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=drama_turn,
        active_location=main_bar,
        neighbors=bundle_nar.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )

    bundle_drama = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Recovered Credstick" in bundle_drama.character_states[kira.id].inventory
    assert bundle_drama.character_states[viktor.id].current_location_id == neighbor_dest.id

    # Rewind back to turn_narrator_1 -> both characters' states, stances, inventories & locations roll back cleanly!
    rewound = temp_repo.checkout_turn_branch(camp.id, "turn_narrator_1")
    assert "Recovered Credstick" not in rewound.character_states[kira.id].inventory
    assert rewound.character_states[kira.id].mood_label == bundle0.character_states[kira.id].mood_label
    assert rewound.character_states[kira.id].relationship_notes == bundle0.character_states[kira.id].relationship_notes
    assert rewound.character_states[viktor.id].current_location_id == main_bar.id
    assert rewound.character_states[viktor.id].mood_label == bundle0.character_states[viktor.id].mood_label
    assert set(rewound.present_character_ids) == {kira.id, viktor.id}


@pytest.mark.asyncio
async def test_phase4_agent_progress_events_and_audit_ruling_metadata(
    temp_repo, monkeypatch
):
    """Verify that Phase 4 emits visual progress events (roster, agent start/complete, arbitration) and persists character_names and arbitration_rulings."""
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_extra_characters(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    camp = temp_repo.create_campaign(
        name="Audit Ops",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: main_bar.id, viktor.id: main_bar.id},
    )

    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)

    # Mock LLM to return world delta, character deltas with a dispute, and arbitration decision
    async def mock_llm(messages, response_model, **kwargs):
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=5,
                transition_type="stay",
                notable_event_summary="Data vault breached.",
                scene_flags_updated=["Alarm Blaring"],
            )
        if response_model is CharacterAgentDelta:
            user_prompt = messages[1]["content"]
            if kira.name in user_prompt:
                return CharacterAgentDelta(
                    mood_label="Focused and agile",
                    valence_delta=0.1,
                    arousal_delta=0.2,
                    updated_want="Extract the cipher drive.",
                    items_obtained=["Cipher Drive"],
                )
            return CharacterAgentDelta(
                mood_label="Frantic and alarmed",
                valence_delta=-0.3,
                arousal_delta=0.4,
                updated_want="Prevent the cipher theft.",
                items_obtained=["Cipher Drive"],
            )
        if response_model is InventoryArbitrationResult:
            return InventoryArbitrationResult(
                decisions=[
                    DisputedItemDecision(
                        item_name="Cipher Drive",
                        winner_id=kira.id,
                        rationale="Kira snatched the drive first from the console.",
                    )
                ]
            )
        raise AssertionError(f"Unexpected response_model: {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", mock_llm)

    events: list[Phase4ProgressEvent] = []

    async def progress_listener(ev: Phase4ProgressEvent):
        events.append(ev)

    turn1 = temp_repo.save_turn_node(
        turn_id="turn_progress_1",
        campaign_id=camp.id,
        parent_turn_id=bundle0.active_branch_turns[-1].id,
        depth_index=1,
        user_message="I signal Kira to grab the drive.",
        actor_id=kira.id,
        raw_prose="*Kira snatches the cipher drive as Viktor lunges for it.*",
        cognition=CognitionBlock(feeling="Determined", valence=0.2, arousal=0.7),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle0.current_world_snapshot.model_copy(update={"turn_id": "turn_progress_1"}),
        character_state=bundle0.current_character_state.model_copy(update={"turn_id": "turn_progress_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_progress_1"})
        ],
        recalled_items=[],
    )

    updated_turn, _ = await run_phase4_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn1,
        active_location=main_bar,
        neighbors=[],
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
        on_progress=progress_listener,
    )

    # 1. Verify progress event stream
    event_names = [e.event for e in events]
    assert "phase4_start" in event_names
    assert "phase4_agent_start" in event_names
    assert "phase4_agent_complete" in event_names
    assert "phase4_arbitration_start" in event_names

    start_ev = next(e for e in events if e.event == "phase4_start")
    roster_keys = [r.agent_key for r in start_ev.roster]
    assert roster_keys == ["clerk", kira.id, viktor.id]

    completed_agent_keys = [e.agent_key for e in events if e.event == "phase4_agent_complete"]
    assert set(completed_agent_keys) == {"clerk", kira.id, viktor.id}

    # 2. Verify PostTurnStateDelta metadata
    assert updated_turn.post_turn is not None
    assert updated_turn.post_turn.character_names == {kira.id: kira.name, viktor.id: viktor.name}
    assert len(updated_turn.post_turn.arbitration_rulings) == 1
    ruling = updated_turn.post_turn.arbitration_rulings[0]
    assert ruling.item_name == "Cipher Drive"
    assert ruling.winner_id == kira.id
    assert ruling.winner_label == kira.name
    assert "snatched the drive" in ruling.rationale
    assert set(ruling.claimant_ids) == {kira.id, viktor.id}

    # 3. Verify winner holds item in state, loser does not
    bundle1 = temp_repo.get_campaign_state_bundle(camp.id)
    assert "Cipher Drive" in bundle1.character_states[kira.id].inventory
    assert "Cipher Drive" not in bundle1.character_states[viktor.id].inventory
