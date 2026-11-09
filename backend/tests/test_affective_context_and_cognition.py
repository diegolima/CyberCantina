"""Milestone 3 tests: Idempotent clock projection, provisional previews, & Zone 4 lexical rendering."""

from __future__ import annotations

import re
from unittest.mock import patch
import pytest

from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    project_care_to_minute,
    seed_initial_care_state,
)
from app.engine.choices import (
    build_directed_cognition_schema,
    build_undirected_cognition_schema,
)
from app.engine.phase2_context import (
    TurnContextBundle,
    build_zone4_ephemeral_tail_frame,
    resolve_character_previous_state,
    resolve_phase2_turn_context,
)
from app.engine.phase3_cognition import (
    parse_cognition_xml,
    run_phase3_multi_cognition,
)
from app.schemas.affective import CategoricalFeelingImpulse
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    VoiceAnchor,
)
from app.schemas.turn import (
    ChoiceResolution,
    MechanicsTrigger,
    PreTurnAnalysis,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, WorldGlobalRules, WorldRecord

_FLOAT_TELEMETRY_RE = re.compile(r"[+-]?\d+\.\d+")


def _make_world_and_cast() -> tuple[WorldRecord, CharacterRecord, CharacterRecord, LocationNode]:
    world = WorldRecord(
        id="w_m3",
        owner_id="u_m3",
        name="Sector 7",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk Noir",
            tone="Atmospheric",
            setting_overview="Rain-slick orbital dockyards.",
            tech_or_magic_rules="Hard sci-fi cybernetics.",
            starting_timestamp="2088-11-02 22:00",
        ),
        created_at="2026-11-07T00:00:00Z",
    )
    vesper = CharacterRecord(
        id="char_vesper",
        world_id=world.id,
        name="Vesper Kael",
        tagline="Stoic security broker",
        physical_appearance="Tall, slate-gray trench coat scars along collarbone.",
        core_persona="Controlled, observant, slow to trust.",
        baseline_psyche=BaselinePsyche(
            mood_label="Observant and composed",
            valence=0.0,
            arousal=0.35,
            core_drive="Protect dockside safehouse",
            core_fear="Syndicate breach",
            default_want="Verify visitor credentials",
            default_plan="Watch the doorway",
            temperament="stoic",
        ),
        voice_anchors=[VoiceAnchor(context="Calm", snippet="State your business.")],
        equipped=[" Polymer coat"],
        inventory=["Encrypted pad"],
        created_at="2026-11-07T00:00:00Z",
    )
    jax = CharacterRecord(
        id="char_jax",
        world_id=world.id,
        name="Jax Mercer",
        tagline="Nervous courier",
        physical_appearance="Lean build, darting eyes.",
        core_persona="Anxious, talkative under pressure.",
        baseline_psyche=BaselinePsyche(
            mood_label="Jittery",
            valence=-0.1,
            arousal=0.5,
            core_drive="Survive the run",
            core_fear="Getting cornered",
            default_want="Deliver the drive",
            default_plan="Stay near exit",
            temperament="volatile",
        ),
        voice_anchors=[VoiceAnchor(context="Tense", snippet="We don't have much time!")],
        equipped=["Courier vest"],
        inventory=["Data drive"],
        created_at="2026-11-07T00:00:00Z",
    )
    loc = LocationNode(
        id="loc_dock",
        world_id=world.id,
        name="Docking Bay 4",
        summary="Cold cargo bay",
        description="Sodium lamps buzz above wet steel grating.",
        environmental_tags=["wet grating", "cargo crates"],
        is_starting_location=True,
    )
    return world, vesper, jax, loc


def test_narrator_advance_care_state_not_overwritten_by_rewind() -> None:
    """Verify resolve_character_previous_state preserves valid CARE decay on __narrator__ turns."""
    _, vesper, _, loc = _make_world_and_cast()
    pre = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Alert",
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    # Turn 1: Vesper is agitated and rattled after a firefight
    care_t1 = seed_initial_care_state(vesper.baseline_psyche, initial_elapsed_minutes=10).model_copy(
        update={
            "valence": -0.75,
            "arousal": 0.90,
            "dominance": -0.40,
            "composure": 0.25,
            "short_mood_label": "Cornered and hyper-vigilant",
        }
    )
    state_t1 = CharacterStateSnapshot(
        turn_id="t1",
        character_id=vesper.id,
        current_location_id=loc.id,
        mood_label=care_t1.short_mood_label,
        valence=care_t1.valence,
        arousal=care_t1.arousal,
        active_want="Hold the barricade",
        active_plan="Keep cover",
        care_state=care_t1,
    )
    t1 = TurnNodeRecord(
        id="t1",
        campaign_id="c1",
        parent_turn_id=None,
        depth_index=0,
        user_message="Take cover!",
        actor_id=vesper.id,
        raw_prose="*Vesper ducks behind crates.*",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:10",
            campaign_elapsed_minutes=10,
            active_location_id=loc.id,
        ),
        character_state=state_t1,
        character_states={vesper.id: state_t1},
        created_at="2026-11-07T00:00:00Z",
    )

    # Turn 2: Narrator 'advance' 480 minutes (8 hours sleep/rest) decays Vesper's CARE state
    care_t2 = project_care_to_minute(
        care_t1, target_elapsed_minutes=490, psyche=vesper.baseline_psyche
    )
    state_t2 = state_t1.model_copy(
        update={
            "turn_id": "t2",
            "mood_label": care_t2.short_mood_label,
            "valence": care_t2.valence,
            "arousal": care_t2.arousal,
            "care_state": care_t2,
        }
    )
    t2 = TurnNodeRecord(
        id="t2",
        campaign_id="c1",
        parent_turn_id="t1",
        depth_index=1,
        user_message="[Advance the story: 8 hours pass]",
        actor_id="__narrator__",
        raw_prose="*Eight quiet hours pass across the bay.*",
        cognition=CognitionBlock(feeling="Objective / Detached", skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t2",
            world_timestamp="2088-11-03 06:10",
            campaign_elapsed_minutes=490,
            active_location_id=loc.id,
        ),
        character_state=state_t2,
        character_states={vesper.id: state_t2},
        created_at="2026-11-07T00:01:00Z",
    )

    resolved = resolve_character_previous_state([t1, t2], vesper, loc.id)
    assert resolved.care_state is not None
    # Must preserve the 8-hour rested state from t2, NOT rewind to t1's panic!
    assert resolved.care_state.state_elapsed_minutes == 490
    assert resolved.care_state.composure > 0.75
    assert resolved.arousal < 0.45


@pytest.mark.asyncio()
async def test_phase2_lazy_off_screen_idle_catchup_is_idempotent(temp_repo=None) -> None:
    """Verify resolve_phase2_turn_context catches up off-screen NPC idle time idempotently."""
    world, vesper, jax, loc = _make_world_and_cast()
    pre = PreTurnAnalysis(
        user_sentiment="calm",
        subtext_interpretation="Checking in",
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    # Jax was left at state_elapsed_minutes=0 in high panic while campaign clock reached 360m
    jax_stale_care = seed_initial_care_state(jax.baseline_psyche, initial_elapsed_minutes=0).model_copy(
        update={"valence": -0.80, "arousal": 0.92, "composure": 0.20}
    )
    jax_stale_snap = CharacterStateSnapshot(
        turn_id="t5",
        character_id=jax.id,
        current_location_id=loc.id,
        mood_label="Panicked",
        valence=-0.80,
        arousal=0.92,
        active_want="Hide",
        active_plan="Wait",
        care_state=jax_stale_care,
    )
    leaf = TurnNodeRecord(
        id="t5",
        campaign_id="c1",
        parent_turn_id=None,
        depth_index=0,
        user_message="[Scene Start]",
        actor_id=vesper.id,
        raw_prose="Start.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t5",
            world_timestamp="2088-11-03 04:00",
            campaign_elapsed_minutes=360,
            active_location_id=loc.id,
        ),
        character_state=jax_stale_snap,
        character_states={jax.id: jax_stale_snap},
        created_at="2026-11-07T00:00:00Z",
    )

    class _DummyVec:
        async def search_memories_for_characters(self, **kwargs):
            class _Res:
                shared_scene_items = []
                by_character = {}
            return _Res()

    class _DummyRepo:
        vector_store = _DummyVec()

    bundle_a = await resolve_phase2_turn_context(
        repo=_DummyRepo(),
        campaign_id="c1",
        world=world,
        branch_turns=[leaf],
        pre_turn=pre,
        user_message="Hey Jax, coast is clear.",
        active_location=loc,
        neighbors=[],
        present_characters=[jax],
        character_name_map={jax.id: jax.name},
        episodic_chunks=[],
    )
    caught_up = bundle_a.all_character_states[jax.id]
    assert caught_up.care_state is not None
    assert caught_up.care_state.state_elapsed_minutes == 360
    assert caught_up.arousal < 0.60
    assert caught_up.care_state.composure > 0.55

    # Calling projection a second time at 360m must be bit-identical
    reprojected = project_care_to_minute(
        caught_up.care_state, target_elapsed_minutes=360, psyche=jax.baseline_psyche
    )
    assert reprojected == caught_up.care_state


def test_dual_feeling_xml_parser_and_flat_cognition_json_schema() -> None:
    """Verify parse_cognition_xml supports both categorical attributes and legacy float fallback."""
    _, vesper, _, loc = _make_world_and_cast()
    fallback = CharacterStateSnapshot(
        turn_id="t0",
        character_id=vesper.id,
        current_location_id=loc.id,
        mood_label="Observant",
        valence=0.0,
        arousal=0.35,
        active_want="Watch door",
        active_plan="Stand ready",
    )

    # 1. Categorical XML attributes
    cat_xml = (
        "<cognition>\n"
        "  <recall>- Remembered the ambush.</recall>\n"
        '  <feeling tone="hostile" intensity="high" agency="commanding" threat="high" coping="mastery">'
        "Cold tactical fury; ready to disarm the intruder."
        "</feeling>\n"
        "  <want>Disarm the intruder.</want>\n"
        "  <plan>- Step into the light.</plan>\n"
        "</cognition>"
    )
    cog_cat = parse_cognition_xml(cat_xml, fallback)
    assert cog_cat.feeling_tone == "hostile"
    assert cog_cat.feeling_intensity == "high"
    assert cog_cat.feeling_agency == "commanding"
    assert cog_cat.scene_threat == "high"
    assert cog_cat.scene_coping == "mastery"
    assert cog_cat.feeling_impulse is not None
    assert cog_cat.feeling_impulse.used_legacy_float_fallback is False
    assert cog_cat.valence < -0.70
    assert cog_cat.arousal >= 0.70

    # 2. Legacy float XML attributes (custom PromptPreset compatibility)
    leg_xml = (
        "<cognition>\n"
        "  <recall>- Old note.</recall>\n"
        '  <feeling valence="-0.65" arousal="0.82">Bitter and tense.</feeling>\n'
        "  <want>Hold position.</want>\n"
        "  <plan>- Wait.</plan>\n"
        "</cognition>"
    )
    cog_leg = parse_cognition_xml(leg_xml, fallback)
    assert cog_leg.valence == -0.65
    assert cog_leg.arousal == 0.82
    assert cog_leg.feeling_impulse is not None
    assert cog_leg.feeling_impulse.used_legacy_float_fallback is True
    assert cog_leg.feeling_tone == "bitter"
    assert cog_leg.feeling_intensity == "high"

    # 3. Verify Phase 3 structured JSON schemas have ZERO $defs and ZERO float fields
    undirected = build_undirected_cognition_schema()
    assert "$defs" not in undirected
    assert "valence" not in undirected["properties"]
    assert "arousal" not in undirected["properties"]
    assert "feeling_impulse" not in undirected["properties"]
    assert "feeling_tone" in undirected["properties"]

    directed = build_directed_cognition_schema(
        ChoiceResolution(character_id=vesper.id, status="mandatory", allowed=["Draw weapon"])
    )
    assert "$defs" not in directed
    assert "valence" not in directed["properties"]
    assert "arousal" not in directed["properties"]
    assert "selected_choice" in directed["properties"]

    # 4. Roll outcome attribute parsing
    ro_xml = (
        '<character_active_cognition character="Vesper" roll_outcome="Critical Failure">\n'
        '  <feeling tone="anguished" intensity="extreme" agency="pressured">Disaster struck.</feeling>\n'
        '  <want>Survive.</want>\n'
        '  <plan>- Scramble.</plan>\n'
        '</character_active_cognition>'
    )
    cog_ro = parse_cognition_xml(ro_xml, fallback)
    assert cog_ro.roll_outcome_tier == "Critical Failure"
    assert cog_ro.feeling_tone == "anguished"
    assert cog_ro.feeling_agency == "pressured"


@pytest.mark.asyncio()
async def test_composure_masking_and_zero_floats_in_phase3_and_zone4() -> None:
    """Verify composure masking in co-present cues/Zone 4 and zero floats in affective blocks."""
    world, vesper, jax, loc = _make_world_and_cast()
    pre = PreTurnAnalysis(
        user_sentiment="threatening",
        subtext_interpretation="Intimidation",
        active_speaker_id=vesper.id,
        speaker_order=[vesper.id, jax.id],
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    # Vesper has high composure (0.88) despite hidden hostility; Jax has shattered composure (0.15)
    vesper_care = seed_initial_care_state(vesper.baseline_psyche).model_copy(
        update={"valence": -0.70, "arousal": 0.78, "dominance": 0.50, "composure": 0.88}
    )
    jax_care = seed_initial_care_state(jax.baseline_psyche).model_copy(
        update={
            "valence": -0.75,
            "arousal": 0.85,
            "dominance": -0.65,
            "composure": 0.15,
            "outward_demeanor": "Visibly shaken—breathing shallow, eyes darting with unmasked strain",
        }
    )

    vesper_snap = CharacterStateSnapshot(
        turn_id="t1",
        character_id=vesper.id,
        current_location_id=loc.id,
        mood_label="Furious",
        valence=-0.70,
        arousal=0.78,
        active_want="Control room",
        active_plan="Watch user",
        care_state=vesper_care,
    )
    jax_snap = CharacterStateSnapshot(
        turn_id="t1",
        character_id=jax.id,
        current_location_id=loc.id,
        mood_label="Panicked",
        valence=-0.75,
        arousal=0.85,
        active_want="Escape",
        active_plan="Back away",
        care_state=jax_care,
    )

    # Provisional preview must set is_provisional=True and preserve committed variance/clock/relations
    prov = compute_provisional_cognition_preview(
        vesper_care,
        CategoricalFeelingImpulse(
            tone="hostile", intensity="high", agency="commanding", threat="high", coping="mastery"
        ),
    )
    assert prov.is_provisional is True
    assert prov.mood_variance == vesper_care.mood_variance
    assert prov.relations == vesper_care.relations
    assert prov.state_elapsed_minutes == vesper_care.state_elapsed_minutes

    # Render Zone 4 from Vesper's perspective (observing shattered-composure Jax) and vice versa
    cogs = {
        vesper.id: CognitionBlock(
            recall="- Stay icy.",
            feeling="Secretly livid at the threat",
            feeling_tone="hostile",
            feeling_intensity="high",
            feeling_agency="commanding",
            scene_threat="moderate",
            scene_coping="mastery",
            want="Call the bluff",
            plan="- Keep voice flat.",
        ),
        jax.id: CognitionBlock(
            recall="- Trapped.",
            feeling="Terrified of gunfire",
            feeling_tone="anguished",
            feeling_intensity="extreme",
            feeling_agency="helpless",
            scene_threat="high",
            scene_coping="overwhelmed",
            want="Duck behind crates",
            plan="- Step backward.",
        ),
    }

    zone4_for_jax = build_zone4_ephemeral_tail_frame(
        user_message="Nobody leaves this bay.",
        character=jax,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:05",
            campaign_elapsed_minutes=5,
            active_location_id=loc.id,
        ),
        character_state=jax_snap,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre,
        present_characters=[vesper, jax],
        all_character_states={vesper.id: vesper_snap, jax.id: jax_snap},
        established_cognitions=cogs,
    )
    # Vesper's composure is intact -> <other_characters_in_room> shows masked outward demeanor, NOT raw 'Furious'
    other_room_match = re.search(
        r"<other_characters_in_room>(.*?)</other_characters_in_room>", zone4_for_jax, re.DOTALL
    )
    assert other_room_match is not None
    assert "Demeanor: Outwardly" in other_room_match.group(1)
    assert "[Mood: Furious]" not in other_room_match.group(1)

    # Zero raw floats inside <internal_affective_state> and <character_active_cognition>
    aff_match = re.search(
        r"<internal_affective_state[^>]*>(.*?)</internal_affective_state>", zone4_for_jax, re.DOTALL
    )
    assert aff_match is not None
    assert _FLOAT_TELEMETRY_RE.search(aff_match.group(1)) is None
    assert "valence=" not in zone4_for_jax
    assert "arousal=" not in zone4_for_jax

    # Also verify Phase 3 user_prompt contains zero raw float telemetry
    captured_p3_prompts: list[str] = []

    async def _mock_p3(messages, *args, **kwargs):
        captured_p3_prompts.append(messages[-1]["content"])
        return cogs[vesper.id] if "Vesper Kael" in messages[-1]["content"] else cogs[jax.id]

    leaf = TurnNodeRecord(
        id="t1",
        campaign_id="c1",
        parent_turn_id=None,
        depth_index=0,
        user_message="Init",
        actor_id=vesper.id,
        raw_prose="Init",
        cognition=CognitionBlock(skipped=True),
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:05",
            campaign_elapsed_minutes=5,
            active_location_id=loc.id,
        ),
        character_state=vesper_snap,
        character_states={vesper.id: vesper_snap, jax.id: jax_snap},
        created_at="2026-11-07T00:00:00Z",
    )
    ctx = TurnContextBundle(
        world=world,
        branch_turns=[leaf],
        leaf_turn=leaf,
        active_location=loc,
        neighbors=[],
        present_characters=[vesper, jax],
        pre_turn=pre,
        user_message="Nobody leaves.",
        episodic_chunks=[],
        shared_scene_items=[],
        per_character_recalled_items={vesper.id: [], jax.id: []},
        all_character_states={vesper.id: vesper_snap, jax.id: jax_snap},
        character_name_map={vesper.id: vesper.name, jax.id: jax.name},
    )

    with patch("app.engine.phase3_cognition.llm_client.complete_structured", side_effect=_mock_p3):
        await run_phase3_multi_cognition(context=ctx, dispatch_mode="sequential")

    assert len(captured_p3_prompts) == 2
    for prompt_text in captured_p3_prompts:
        assert "Valence:" not in prompt_text
        assert "Arousal:" not in prompt_text
    # Jax (second in sequence) must NOT see Vesper's secret feeling ("Secretly livid at the threat")
    assert "Secretly livid at the threat" not in captured_p3_prompts[1]
    assert "Outwardly" in captured_p3_prompts[1]


def test_zone4_categorical_serialization_and_dynamic_behavioral_anchors() -> None:
    """Verify Zone 4 preserves categorical appraisal attributes, roll_outcome, and composure-aware anchors."""
    world, vesper, jax, loc = _make_world_and_cast()

    # 1. High composure anchor test
    vesper_high_care = seed_initial_care_state(vesper.baseline_psyche).model_copy(
        update={"composure": 0.85, "valence": -0.2, "arousal": 0.3}
    )
    vesper_high_snap = CharacterStateSnapshot(
        turn_id="t1",
        character_id=vesper.id,
        current_location_id=loc.id,
        mood_label="Disciplined",
        valence=-0.2,
        arousal=0.3,
        active_want="Observe",
        active_plan="Watch",
        care_state=vesper_high_care,
    )

    pre_normal = PreTurnAnalysis(
        user_sentiment="neutral",
        subtext_interpretation="Casual greeting",
        active_speaker_id=vesper.id,
        mechanics_check=MechanicsTrigger(requires_roll=False),
    )

    cog_vesper = CognitionBlock(
        recall="- Clear sightlines.",
        feeling="Steady and watchful.",
        feeling_tone="guarded",
        feeling_intensity="moderate",
        feeling_agency="commanding",
        scene_threat="none",
        scene_coping="adequate",
        want="Determine intentions",
        plan="- Await approach.",
    )

    z4_high = build_zone4_ephemeral_tail_frame(
        user_message="Hello.",
        character=vesper,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:00",
            campaign_elapsed_minutes=0,
            active_location_id=loc.id,
        ),
        character_state=vesper_high_snap,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre_normal,
        present_characters=[vesper],
        all_character_states={vesper.id: vesper_high_snap},
        established_cognition=cog_vesper,
    )

    assert "Behavioral Anchor: Composure is [DISCIPLINED/HIGH]" in z4_high
    assert '<feeling tone="guarded" intensity="moderate" agency="commanding" threat="none" coping="adequate">Steady and watchful.</feeling>' in z4_high

    # 2. Shattered composure anchor test with Critical Failure roll
    from app.schemas.turn import DiceRollResult
    from app.schemas.affective import RelationalEdge

    jax_shattered_care = seed_initial_care_state(jax.baseline_psyche).model_copy(
        update={
            "composure": 0.20,
            "valence": -0.7,
            "arousal": 0.9,
            "relations": {
                "user": RelationalEdge(target_id="user", warmth=-0.4, trust=-0.5, episodic_note="Deeply suspicious"),
                vesper.id: RelationalEdge(target_id=vesper.id, warmth=0.6, trust=0.6, respect=0.7),
            },
        }
    )
    jax_shattered_snap = CharacterStateSnapshot(
        turn_id="t1",
        character_id=jax.id,
        current_location_id=loc.id,
        mood_label="Panicking",
        valence=-0.7,
        arousal=0.9,
        active_want="Flee",
        active_plan="Run",
        care_state=jax_shattered_care,
    )

    crit_fail_roll = DiceRollResult(
        character_id=jax.id,
        action_description="Slick dash to exit",
        skill_or_approach="Agility",
        difficulty_class=15,
        total=4,
        d20_raw=2,
        modifier=2,
        outcome_tier="Critical Failure",
        narrative_directive="Trip over the hydraulic hose.",
    )
    pre_crit = PreTurnAnalysis(
        user_sentiment="hostile",
        subtext_interpretation="Attack",
        active_speaker_id=jax.id,
        resolved_roll=crit_fail_roll,
        character_rolls={jax.id: crit_fail_roll},
        mechanics_check=MechanicsTrigger(requires_roll=True),
    )

    cog_jax = CognitionBlock(
        recall="- Exit blocked.",
        feeling="Desperation spiking.",
        feeling_tone="anguished",
        feeling_intensity="extreme",
        feeling_agency="helpless",
        scene_threat="critical",
        scene_coping="overwhelmed",
        want="Avoid getting grabbed",
        plan="- Stumble forward.",
        roll_outcome_tier="Critical Failure",
    )

    z4_crit = build_zone4_ephemeral_tail_frame(
        user_message="Halt!",
        character=jax,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:00",
            campaign_elapsed_minutes=0,
            active_location_id=loc.id,
        ),
        character_state=jax_shattered_snap,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre_crit,
        present_characters=[jax, vesper],
        all_character_states={jax.id: jax_shattered_snap, vesper.id: vesper_high_snap},
        established_cognitions={jax.id: cog_jax, vesper.id: cog_vesper},
    )

    # Roll outcome takes highest priority in anchor when critical
    assert "Behavioral Anchor: This turn resulted in a [Critical Failure]" in z4_crit
    assert 'roll_outcome="Critical Failure"' in z4_crit
    assert '<feeling tone="anguished" intensity="extreme" agency="helpless" threat="critical" coping="overwhelmed">Desperation spiking.</feeling>' in z4_crit

    # 3. Verify co-present characters show dyadic stance from Vesper's perspective observing Jax
    z4_vesper_view = build_zone4_ephemeral_tail_frame(
        user_message="Halt!",
        character=vesper,
        world_snapshot=WorldStateSnapshot(
            turn_id="t1",
            world_timestamp="2088-11-02 22:00",
            campaign_elapsed_minutes=0,
            active_location_id=loc.id,
        ),
        character_state=vesper_high_snap,
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre_crit,
        present_characters=[vesper, jax],
        all_character_states={jax.id: jax_shattered_snap, vesper.id: vesper_high_snap},
        established_cognitions={jax.id: cog_jax, vesper.id: cog_vesper},
    )

    assert "Stance toward Player: Cold & Distrustful (Trust: Deep Distrust)" in z4_vesper_view
    assert f"Stance toward {vesper.name}: Warm & Trusting & Respectful" in z4_vesper_view
