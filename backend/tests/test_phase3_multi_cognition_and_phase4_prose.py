"""Tests for Phase 3 Multi-Character Cognition Swarm & Phase 4 Prose Generation."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch
import pytest

from app.db.repository import CantinaRepository
from app.engine.phase2_context import (
    build_zone1_ensemble_system_prompt,
    build_zone1_static_system_prompt,
    build_zone4_ephemeral_tail_frame,
    resolve_phase2_turn_context,
)
from app.engine.phase3_cognition import (
    PriorCognitionCue,
    heuristic_character_cognition,
    run_phase3_multi_cognition,
)
from app.engine.phase4_prose import stream_phase4_prose
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    VoiceAnchor,
)
from app.schemas.turn import (
    MechanicsTrigger,
    Phase3ProgressEvent,
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, NeighborLocationView, WorldGlobalRules, WorldRecord


@pytest.fixture()
def sample_world_and_characters() -> tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode]:
    world = WorldRecord(
        id="world_test",
        owner_id="user_test",
        name="Neon Undercity",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk Noir",
            tone="Grim and atmospheric",
            setting_overview="A high-tech low-life sprawling metropolis.",
            tech_or_magic_rules="Cybernetics and neural decks are common.",
            starting_timestamp="2026-11-02 00:00",
        ),
        created_at="2026-11-02T00:00:00Z",
    )
    kira = CharacterRecord(
        id="char_kira",
        world_id="world_test",
        name="Kira Vance",
        tagline="Disillusioned trauma surgeon",
        physical_appearance="Athletic build, silver ocular implant, sharp cheekbones.",
        core_persona="Cynical exterior hiding fierce protective instincts.",
        baseline_psyche=BaselinePsyche(
            valence=-0.1,
            arousal=0.6,
            mood_label="Guarded and alert",
            core_drive="Survival and autonomy",
            core_fear="Loss of medical agency",
            default_want="Keep the clinic secure",
            default_plan="Assess the threat",
        ),
        voice_anchors=[VoiceAnchor(context="Tense", snippet="Keep your hands where I can see them.")],
        equipped=["Reinforced medical coat"],
        inventory=["Trauma kit", "Neuro-scanner"],
        created_at="2026-11-02T00:00:00Z",
    )
    viktor = CharacterRecord(
        id="char_viktor",
        world_id="world_test",
        name="Viktor Chen",
        tagline="Mercenary quartermaster",
        physical_appearance="Broad shoulders, heavy mechanical arm, scarred jaw.",
        core_persona="Pragmatic, observant, loyal to contract.",
        baseline_psyche=BaselinePsyche(
            valence=0.0,
            arousal=0.5,
            mood_label="Measured caution",
            core_drive="Honor the contract",
            core_fear="Unprepared ambush",
            default_want="Hold defensive perimeter",
            default_plan="Check the security feeds",
        ),
        voice_anchors=[VoiceAnchor(context="Calm", snippet="Everything has a price, friend.")],
        equipped=["Tactical vest"],
        inventory=["Heavy slugthrower", "Lockpick"],
        created_at="2026-11-02T00:00:00Z",
    )
    location = LocationNode(
        id="loc_cantina",
        world_id="world_test",
        name="The Neon Cantina",
        summary="A bustling cyber-bar",
        description="Flickering holographic liquor signs illuminate the smoke-filled room.",
        environmental_tags=["smoky", "neon-lit", "crowded"],
        is_starting_location=True,
    )
    return world, kira, viktor, location


def test_zone1_ensemble_kv_cache_stability(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify that build_zone1_ensemble_system_prompt sorts characters canonically by id to preserve KV cache."""
    world, kira, viktor, _ = sample_world_and_characters

    # Present list in order [Kira, Viktor] vs [Viktor, Kira]
    prompt_order_a = build_zone1_ensemble_system_prompt(world, [kira, viktor])
    prompt_order_b = build_zone1_ensemble_system_prompt(world, [viktor, kira])

    assert prompt_order_a == prompt_order_b
    assert "=== CHARACTER: Kira Vance" in prompt_order_a
    assert "=== CHARACTER: Viktor Chen" in prompt_order_a
    assert prompt_order_a.index("Kira Vance") < prompt_order_a.index("Viktor Chen")


def test_zone4_multi_cognition_rendering(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify Zone 4 tail renders <character_active_cognition> blocks for all present characters."""
    world, kira, viktor, loc = sample_world_and_characters
    char_state = CharacterStateSnapshot(
        turn_id="t1",
        character_id=kira.id,
        current_location_id=loc.id,
        mood_label="Wary",
        valence=-0.1,
        arousal=0.6,
        active_want="Secure room",
        active_plan="Draw sidearm",
        relationship_notes={},
        equipped=list(kira.equipped),
        inventory=list(kira.inventory),
    )
    pre = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Seeking shelter",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        active_speaker_id=kira.id,
        speaker_order=[kira.id, viktor.id],
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    cogs = {
        kira.id: CognitionBlock(
            recall="- Remembering Syndicate raid.",
            feeling="Tense vigilance",
            valence=-0.2,
            arousal=0.7,
            want="Protect the patient",
            plan="- Order the door sealed.",
            skipped=False,
        ),
        viktor.id: CognitionBlock(
            recall="- Checking ammo count.",
            feeling="Steady focus",
            valence=0.0,
            arousal=0.5,
            want="Cover the rear exit",
            plan="- Position near bulkhead.",
            skipped=False,
        ),
    }

    zone4 = build_zone4_ephemeral_tail_frame(
        user_message="They're outside!",
        character=kira,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1", world_timestamp="2026-11-02 00:00", active_location_id=loc.id
        ),
        character_state=char_state,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre,
        present_characters=[kira, viktor],
        established_cognitions=cogs,
    )

    assert f'character="Kira Vance" character_id="{kira.id}" role="primary_speaker"' in zone4
    assert f'character="Viktor Chen" character_id="{viktor.id}" role="co_present"' in zone4
    assert "Tense vigilance" in zone4
    assert "Steady focus" in zone4
    assert "Order the door sealed." in zone4
    assert "Position near bulkhead." in zone4
    assert "CRITICAL: Internal thoughts, emotional feelings, and tactical plans" in zone4


@pytest.mark.asyncio()
async def test_sequential_mode_passes_prior_cues_and_emits_events(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify that in sequential dispatch mode, second character receives observable cue from first character."""
    world, kira, viktor, loc = sample_world_and_characters

    pre = PreTurnAnalysis(
        user_sentiment="urgent",
        subtext_interpretation="Emergency arrival",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        active_speaker_id=kira.id,
        speaker_order=[kira.id, viktor.id],
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    root_turn = TurnNodeRecord(
        id="t0",
        campaign_id="c1",
        parent_turn_id=None,
        depth_index=0,
        user_message="[Scene Start]",
        actor_id=kira.id,
        raw_prose="Opening scene.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t0", world_timestamp="2026-11-02 00:00", active_location_id=loc.id
        ),
        character_state=CharacterStateSnapshot(
            turn_id="t0",
            character_id=kira.id,
            current_location_id=loc.id,
            mood_label="Alert",
            valence=0.0,
            arousal=0.5,
            active_want="Open clinic",
            active_plan="Prep gear",
            relationship_notes={},
            equipped=[],
            inventory=[],
        ),
        recalled_items=[],
        created_at="2026-11-02T00:00:00Z",
    )

    from app.engine.phase2_context import TurnContextBundle

    context = TurnContextBundle(
        world=world,
        branch_turns=[root_turn],
        leaf_turn=root_turn,
        active_location=loc,
        neighbors=[],
        present_characters=[kira, viktor],
        pre_turn=pre,
        user_message="Someone help me!",
        episodic_chunks=[],
        shared_scene_items=[],
        per_character_recalled_items={kira.id: [], viktor.id: []},
        all_character_states={
            kira.id: root_turn.character_state,
            viktor.id: CharacterStateSnapshot(
                turn_id="t0",
                character_id=viktor.id,
                current_location_id=loc.id,
                mood_label="Watchful",
                valence=0.0,
                arousal=0.4,
                active_want="Monitor door",
                active_plan="Stand guard",
                relationship_notes={},
                equipped=[],
                inventory=[],
            ),
        },
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
    )

    events: list[Phase3ProgressEvent] = []

    async def on_progress(ev: Phase3ProgressEvent) -> None:
        events.append(ev)

    # Mock structured completion for both agents
    mock_kira_cog = CognitionBlock(
        recall="- Patient needs instant stabilization.",
        feeling="Sharp medical adrenaline",
        valence=0.1,
        arousal=0.8,
        want="Clear the gurney immediately",
        plan="- Signal the player to bring them in.\n- Prep the suture gun.",
        skipped=False,
    )
    mock_viktor_cog = CognitionBlock(
        recall="- Tracking corridor motion sensors.",
        feeling="Guarded anticipation",
        valence=-0.1,
        arousal=0.6,
        want="Barricade the entryway",
        plan="- Move behind Kira to secure the door.\n- Check weapon safety.",
        skipped=False,
    )

    called_prompts: list[str] = []

    async def mock_complete(messages, *args, **kwargs):
        user_content = messages[-1]["content"]
        called_prompts.append(user_content)
        if "Character: Kira Vance" in user_content:
            return mock_kira_cog
        return mock_viktor_cog

    with patch("app.engine.phase3_cognition.llm_client.complete_structured", side_effect=mock_complete):
        results = await run_phase3_multi_cognition(
            context=context,
            dispatch_mode="sequential",
            on_progress=on_progress,
        )

    assert kira.id in results
    assert viktor.id in results
    assert results[kira.id].feeling == "Sharp medical adrenaline"
    assert results[viktor.id].feeling == "Guarded anticipation"

    # Verify Viktor received Kira's composure-masked outward posture/cue in prompt,
    # NOT Kira's raw private feeling or private recall (CARE §4.2.C epistemic isolation!)
    viktor_prompt = called_prompts[1]
    assert "Observable Co-Present Character Actions & Postures this turn:" in viktor_prompt
    assert "Outwardly" in viktor_prompt
    assert "Sharp medical adrenaline" not in viktor_prompt
    assert "Clear the gurney immediately" in viktor_prompt
    assert "Patient needs instant stabilization" not in viktor_prompt  # Epistemic isolation!

    # Verify SSE lifecycle events
    event_names = [e.event for e in events]
    assert event_names == [
        "phase3_start",
        "phase3_agent_start",
        "phase3_agent_complete",
        "phase3_agent_start",
        "phase3_agent_complete",
        "phase3_complete",
    ]
    assert events[0].roster[0].character_id == kira.id
    assert events[0].roster[0].role == "primary_speaker"
    assert events[0].roster[1].character_id == viktor.id
    assert events[0].roster[1].role == "co_present"


@pytest.mark.asyncio()
async def test_parallel_mode_dispatches_concurrently(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify that in parallel mode, both agents run concurrently without prior cues."""
    world, kira, viktor, loc = sample_world_and_characters

    pre = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Danger",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        active_speaker_id=kira.id,
        speaker_order=[kira.id, viktor.id],
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    root_turn = TurnNodeRecord(
        id="t0",
        campaign_id="c1",
        parent_turn_id=None,
        depth_index=0,
        user_message="[Scene Start]",
        actor_id=kira.id,
        raw_prose="Opening scene.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t0", world_timestamp="2026-11-02 00:00", active_location_id=loc.id
        ),
        character_state=CharacterStateSnapshot(
            turn_id="t0",
            character_id=kira.id,
            current_location_id=loc.id,
            mood_label="Alert",
            valence=0.0,
            arousal=0.5,
            active_want="Open clinic",
            active_plan="Prep gear",
            relationship_notes={},
            equipped=[],
            inventory=[],
        ),
        recalled_items=[],
        created_at="2026-11-02T00:00:00Z",
    )

    from app.engine.phase2_context import TurnContextBundle

    context = TurnContextBundle(
        world=world,
        branch_turns=[root_turn],
        leaf_turn=root_turn,
        active_location=loc,
        neighbors=[],
        present_characters=[kira, viktor],
        pre_turn=pre,
        user_message="Hostiles spotted!",
        episodic_chunks=[],
        shared_scene_items=[],
        per_character_recalled_items={kira.id: [], viktor.id: []},
        all_character_states={
            kira.id: root_turn.character_state,
            viktor.id: root_turn.character_state.model_copy(update={"character_id": viktor.id}),
        },
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
    )

    events: list[Phase3ProgressEvent] = []

    async def on_progress(ev: Phase3ProgressEvent) -> None:
        events.append(ev)

    with patch(
        "app.engine.phase3_cognition.llm_client.complete_structured",
        side_effect=Exception("Simulated offline"),
    ):
        results = await run_phase3_multi_cognition(
            context=context,
            dispatch_mode="parallel",
            on_progress=on_progress,
        )

    assert kira.id in results
    assert viktor.id in results
    assert len(results) == 2
    assert any(e.event == "phase3_complete" for e in events)


@pytest.mark.asyncio()
async def test_phase4_leading_tag_guard(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify that stream_phase4_prose strips rogue <cognition>...</cognition> or <think> tags."""
    world, kira, _, loc = sample_world_and_characters
    char_state = CharacterStateSnapshot(
        turn_id="t0",
        character_id=kira.id,
        current_location_id=loc.id,
        mood_label="Guarded",
        valence=0.0,
        arousal=0.5,
        active_want="Defend",
        active_plan="Aim sidearm",
        relationship_notes={},
        equipped=[],
        inventory=[],
    )
    pre = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Alarm",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        active_speaker_id=kira.id,
        speaker_order=[kira.id],
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    established_cogs = {
        kira.id: CognitionBlock(
            recall="Already established",
            feeling="Guarded",
            valence=0.0,
            arousal=0.5,
            want="Defend",
            plan="Aim sidearm",
            skipped=False,
        )
    }

    # Model rogue stream begins with <cognition> block despite instructions
    async def mock_rogue_stream(*args, **kwargs):
        chunks = [
            "<cognition>",
            "\n  <recall>Rogue recall</recall>\n",
            "  <feeling>Rogue feeling</feeling>\n",
            "</cognition>\n\n",
            "*Kira raises her sidearm* ",
            "\"Stay behind me!\"",
        ]
        for c in chunks:
            yield c

    with patch("app.engine.phase4_prose.llm_client.stream_chat", side_effect=mock_rogue_stream):
        stream_events = []
        async for ev in stream_phase4_prose(
            messages=[{"role": "user", "content": "Look out!"}],
            user_message="Look out!",
            character=kira,
            previous_state=char_state,
            active_location=loc,
            neighbors=[],
            recalled_items=[],
            pre_turn=pre,
            established_cognitions=established_cogs,
        ):
            stream_events.append(ev)

        prose_deltas = [e["data"]["delta"] for e in stream_events if e["event"] == "prose_delta"]
        complete_prose = "".join(prose_deltas).strip()

        # Leading <cognition> block must be completely absent from prose!
        assert "<cognition>" not in complete_prose
        assert "Rogue recall" not in complete_prose
        assert "*Kira raises her sidearm*" in complete_prose
        assert "\"Stay behind me!\"" in complete_prose


@pytest.mark.asyncio()
async def test_full_turn_node_persists_multi_cognitions(
    temp_repo: CantinaRepository,
) -> None:
    """Verify that save_turn_node persists cognitions_json and exposes it on TurnNodeRecord."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    parent_turn = bundle.active_branch_turns[-1]
    kira_id = bundle.campaign.character_id

    cogs_payload = {
        kira_id: CognitionBlock(
            recall="- Remembering old debt.",
            feeling="Cold concentration",
            valence=-0.1,
            arousal=0.7,
            want="Secure the perimeter",
            plan="- Close blast doors.",
            skipped=False,
        )
    }

    turn = temp_repo.save_turn_node(
        turn_id="turn_test_multi_cogs",
        campaign_id=bundle.campaign.id,
        parent_turn_id=parent_turn.id,
        depth_index=parent_turn.depth_index + 1,
        user_message="Lock it down!",
        actor_id=kira_id,
        raw_prose="*Kira punches the emergency lockdown button.* \"Doors sealed.\"",
        cognition=cogs_payload[kira_id],
        cognitions=cogs_payload,
        cognition_character_names={kira_id: "Kira Vance"},
        pre_turn=parent_turn.pre_turn,
        world_snapshot=parent_turn.world_snapshot.model_copy(update={"turn_id": "turn_test_multi_cogs"}),
        character_state=parent_turn.character_state.model_copy(update={"turn_id": "turn_test_multi_cogs"}),
        recalled_items=[],
    )

    assert turn.cognitions is not None
    assert kira_id in turn.cognitions
    assert turn.cognitions[kira_id].feeling == "Cold concentration"
    assert turn.cognition_character_names.get(kira_id) == "Kira Vance"

    # Reload directly from SQLite to test deserialization
    reloaded = temp_repo.get_turn_node("turn_test_multi_cogs")
    assert reloaded.cognitions is not None
    assert kira_id in reloaded.cognitions
    assert reloaded.cognitions[kira_id].want == "Secure the perimeter"
    assert reloaded.cognition_character_names.get(kira_id) == "Kira Vance"


@pytest.mark.asyncio()
async def test_multi_cognition_roll_outcome_and_zone4_prose_flow(
    sample_world_and_characters: tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode],
) -> None:
    """Verify roll_outcome_tier propagates through multi-cognition into Zone 4 and Phase 4 stream."""
    world, kira, malor, loc = sample_world_and_characters
    from app.schemas.turn import DiceRollResult
    from app.engine.phase2_context import TurnContextBundle

    roll = DiceRollResult(
        character_id=kira.id,
        action_description="Hack the security sub-relay",
        skill_or_approach="Tech",
        difficulty_class=12,
        total=17,
        d20_raw=14,
        modifier=3,
        outcome_tier="Clean Success",
        plan_directive="Bypass the secondary firewall cleanly.",
        narrative_directive="Narrate the terminal lighting green on success.",
    )

    pre = PreTurnAnalysis(
        user_sentiment="cooperative",
        subtext_interpretation="Assisting the team",
        active_speaker_id=kira.id,
        speaker_order=[kira.id, malor.id],
        resolved_roll=roll,
        character_rolls={kira.id: roll},
        mechanics_check=MechanicsTrigger(requires_roll=True),
    )

    kira_state = CharacterStateSnapshot(
        turn_id="t0",
        character_id=kira.id,
        current_location_id=loc.id,
        mood_label="Focused",
        valence=0.1,
        arousal=0.4,
        active_want="Slice the terminal",
        active_plan="Jack into the deck",
    )
    malor_state = CharacterStateSnapshot(
        turn_id="t0",
        character_id=malor.id,
        current_location_id=loc.id,
        mood_label="Vigilant",
        valence=0.0,
        arousal=0.3,
        active_want="Cover the hallway",
        active_plan="Watch the corridor",
    )

    leaf = TurnNodeRecord(
        id="t0",
        campaign_id="c_test",
        parent_turn_id=None,
        depth_index=0,
        user_message="Slice it now!",
        actor_id=kira.id,
        raw_prose="Waiting.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t0",
            world_timestamp="2026-11-02 00:00",
            campaign_elapsed_minutes=0,
            active_location_id=loc.id,
        ),
        character_state=kira_state,
        character_states={kira.id: kira_state, malor.id: malor_state},
        created_at="2026-11-02T00:00:00Z",
    )

    ctx = TurnContextBundle(
        world=world,
        branch_turns=[leaf],
        leaf_turn=leaf,
        active_location=loc,
        neighbors=[],
        present_characters=[kira, malor],
        pre_turn=pre,
        user_message="Slice it now!",
        episodic_chunks=[],
        shared_scene_items=[],
        per_character_recalled_items={kira.id: [], malor.id: []},
        all_character_states={kira.id: kira_state, malor.id: malor_state},
        character_name_map={kira.id: kira.name, malor.id: malor.name},
    )

    # Run multi-cognition (fallback heuristic or mock)
    with patch("app.engine.phase3_cognition.llm_client.complete_structured", side_effect=RuntimeError("Fast heuristic")):
        cogs = await run_phase3_multi_cognition(context=ctx, dispatch_mode="sequential")
    assert kira.id in cogs
    assert cogs[kira.id].roll_outcome_tier == "Clean Success"

    # Assemble Zone 4
    zone4 = build_zone4_ephemeral_tail_frame(
        user_message="Slice it now!",
        character=kira,
        world_snapshot=leaf.world_snapshot,
        character_state=kira_state,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre,
        present_characters=[kira, malor],
        all_character_states={kira.id: kira_state, malor.id: malor_state},
        established_cognitions=cogs,
    )

    assert 'roll_outcome="Clean Success"' in zone4
    assert '<feeling tone="' in zone4
    assert 'agency="' in zone4

    # Test Phase 4 stream receives primary cognition with roll outcome
    async def mock_stream(*args, **kwargs):
        yield "*Kira's cyberdeck pulses cyan as the security grid unlocks.* \"We're in.\""

    with patch("app.engine.phase4_prose.llm_client.stream_chat", side_effect=mock_stream):
        stream_events = []
        async for ev in stream_phase4_prose(
            messages=[{"role": "user", "content": "Slice it now!"}],
            user_message="Slice it now!",
            character=kira,
            previous_state=kira_state,
            active_location=loc,
            neighbors=[],
            recalled_items=[],
            pre_turn=pre,
            established_cognitions=cogs,
        ):
            stream_events.append(ev)

        cog_ev = next(e for e in stream_events if e["event"] == "cognition_complete")
        assert cog_ev["data"]["roll_outcome_tier"] == "Clean Success"


def test_format_cognition_bullets_caps_and_word_limits() -> None:
    """Verify that _format_cognition_bullets enforces max_bullets and max_words_per_bullet."""
    from app.engine.phase3_cognition import _format_cognition_bullets

    verbose_text = (
        "- First bullet: The Syndicate had compromised our security codes three cycles ago during the raid on Neo-Vegas.\n"
        "- Second bullet: Remembering how Marcus slipped through the checkpoint by bribing the dock master with illicit neuro-chips.\n"
        "- Third bullet: An unnecessary third recollection that should be pruned entirely to save token budget.\n"
        "- Fourth bullet: Another excessive bullet point."
    )

    formatted = _format_cognition_bullets(verbose_text, max_bullets=2, max_words_per_bullet=10)
    lines = formatted.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("- First bullet: The Syndicate had compromised our security codes three...")
    assert lines[1].startswith("- Second bullet: Remembering how Marcus slipped through the checkpoint by...")
    assert "Third bullet" not in formatted
    assert "Fourth bullet" not in formatted

    # Test 3-bullet cap with 12 words
    formatted_3 = _format_cognition_bullets(verbose_text, max_bullets=3, max_words_per_bullet=12)
    lines_3 = formatted_3.splitlines()
    assert len(lines_3) == 3
    assert "Third bullet" in formatted_3
    assert "Fourth bullet" not in formatted_3

    # Backward-compatible unconstrained formatting
    unconstrained = _format_cognition_bullets(verbose_text)
    assert len(unconstrained.splitlines()) == 4


def test_cognition_block_schema_and_prompt_relevance_constraints() -> None:
    """Verify that CognitionBlock schema descriptions and DEFAULT_CHARACTER_COGNITION_SYSTEM contain strict boundaries."""
    from app.schemas.character import CognitionBlock
    from app.prompts.defaults import DEFAULT_CHARACTER_COGNITION_SYSTEM

    schema = CognitionBlock.model_json_schema()
    props = schema["properties"]

    assert "strictly under 12 words per bullet" in props["recall"]["description"]
    assert "Up to 2-3 concise bullet points" in props["recall"]["description"]
    assert "never pad with filler" in props["recall"]["description"]
    assert "under 20 words" in props["feeling"]["description"]
    assert "under 20 words" in props["want"]["description"]
    assert "under 15 words" in props["plan"]["description"]

    # Verify prompt guidelines
    assert "=== 4-STEP COGNITIVE PROTOCOL ===" in DEFAULT_CHARACTER_COGNITION_SYSTEM
    assert "Up to 2-3 concise bullet points" in DEFAULT_CHARACTER_COGNITION_SYSTEM
    assert "strictly under 12 words per bullet point" in DEFAULT_CHARACTER_COGNITION_SYSTEM
    assert "never pad with filler" in DEFAULT_CHARACTER_COGNITION_SYSTEM
    assert "=== PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY ===" in DEFAULT_CHARACTER_COGNITION_SYSTEM


def test_sanitize_cognition_text_strips_echoed_instructions_and_malformed_prefixes() -> None:
    """Verify that _sanitize_cognition_text cleans prompt instruction echoes, XML tags, and malformed plan= prefixes."""
    from app.engine.phase3_cognition import _sanitize_cognition_text

    # 1. Echoed instruction in recall
    echoed_recall = (
        "- Strictly 1-2 ultra-concise bullet points (maximum 15-20 words per bullet). "
        "- State ONLY the single immediate trigger or memory directly impacting this turn from Yva's perspective. "
        "- CRITICAL NEGATIVE CONSTRAINT:..."
    )
    cleaned_recall = _sanitize_cognition_text(echoed_recall, field_type="recall", location_id="loc_test")
    assert cleaned_recall == "- Sizing up the interaction in loc_test."
    assert "Strictly 1-2" not in cleaned_recall

    # 2. Tag prefix & template instruction in want
    echoed_want = (
        "want>1 singular sentence defining Yva's immediate objective in this scene. "
        "Yva wants to gather information about the user's intentions and assess the room's layout without appearing confrontational."
    )
    cleaned_want = _sanitize_cognition_text(echoed_want, field_type="want")
    assert cleaned_want == "Yva wants to gather information about the user's intentions and assess the room's layout without appearing confrontational."
    assert "want>" not in cleaned_want
    assert "1 singular sentence" not in cleaned_want

    # 3. Malformed plan= / - plan= prefix
    garbage_plan = "- plan="
    cleaned_plan = _sanitize_cognition_text(garbage_plan, field_type="plan")
    assert cleaned_plan == ""

    valid_plan = "- plan=\"I will stand firm, mirroring the user's posture and stance.\""
    cleaned_valid = _sanitize_cognition_text(valid_plan, field_type="plan")
    assert "I will stand firm" in cleaned_valid
    assert not cleaned_valid.startswith("- plan=")

