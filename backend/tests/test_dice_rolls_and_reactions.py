"""Tests for individual character dice rolls, 5 canonical outcome tiers, and character reactions."""

import pytest

from app.schemas.turn import (
    CanonicalOutcomeTier,
    CheckRole,
    CharacterCheckSpec,
    DiceMode,
    DiceRollResult,
    MechanicsTrigger,
    PreTurnAnalysis,
    TurnNodeRecord,
    TurnSubmitRequest,
    WorldStateSnapshot,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterStateSnapshot,
    CharacterWizardDraft,
    CognitionBlock,
    VoiceAnchor,
)
from app.engine.phase1_pre import (
    classify_outcome_tier,
    build_tier_directives,
    resolve_dice_check,
    resolve_character_dice_checks,
    run_phase1_pre_analysis,
)
from app.engine.character_agent import (
    ContestedItemCase,
    resolve_roll_for_character,
    _heuristic_arbitrate_case,
)
from app.engine.phase3_cognition import (
    heuristic_character_cognition,
)
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.main import _execute_turn_stream_events


def _make_dummy_character(cid: str, name: str) -> CharacterRecord:
    return CharacterRecord(
        id=cid,
        world_id="world_1",
        name=name,
        tagline="Test Character",
        physical_appearance="Athletic build, vigilant stance.",
        core_persona="Cautious and pragmatic operative.",
        baseline_psyche=BaselinePsyche(
            valence=0.0,
            arousal=0.5,
            mood_label="Vigilant",
            core_drive="Survival",
            core_fear="Failure",
            default_want="Survive the encounter",
            default_plan="Take cover behind the barricade",
        ),
        inventory=["Data Pad"],
        equipped=["Tactical Vest"],
        created_at="2026-11-02T00:00:00Z",
    )


def _make_dummy_state(cid: str) -> CharacterStateSnapshot:
    return CharacterStateSnapshot(
        turn_id="turn_root",
        character_id=cid,
        current_location_id="loc_1",
        mood_label="Vigilant",
        valence=0.0,
        arousal=0.5,
        active_want="Survive the encounter",
        active_plan="Take cover behind the barricade",
        relationship_notes={},
        equipped=["Tactical Vest"],
        inventory=["Data Pad"],
    )


# =========================================================================
# 1. Outcome Tier Classification and Natural Roll Precedence
# =========================================================================

def test_natural_1_precedence_over_dc():
    """Natural 1 must ALWAYS evaluate to Critical Failure, regardless of margin."""
    # DC 10, total 21 (margin +11), but d20 is natural 1
    assert classify_outcome_tier(d20_raw=1, total=21, difficulty_class=10) == "Critical Failure"
    assert classify_outcome_tier(d20_raw=1, total=1, difficulty_class=10) == "Critical Failure"


def test_natural_20_precedence_over_dc():
    """Natural 20 must ALWAYS evaluate to Critical Success, regardless of margin."""
    # DC 35, total 10 (margin -25), but d20 is natural 20
    assert classify_outcome_tier(d20_raw=20, total=10, difficulty_class=35) == "Critical Success"
    assert classify_outcome_tier(d20_raw=20, total=25, difficulty_class=15) == "Critical Success"


def test_margin_based_tier_classification():
    """Verify margin thresholds: <= -6, -5..-3, -2..-1, 0..4, >= 5."""
    dc = 15
    # Critical Failure (margin <= -6): total <= 9
    assert classify_outcome_tier(d20_raw=5, total=9, difficulty_class=dc) == "Critical Failure"
    assert classify_outcome_tier(d20_raw=3, total=7, difficulty_class=dc) == "Critical Failure"

    # Failure with Consequences (-5 <= margin <= -3): total 10, 11, 12
    assert classify_outcome_tier(d20_raw=10, total=10, difficulty_class=dc) == "Failure with Consequences"
    assert classify_outcome_tier(d20_raw=11, total=11, difficulty_class=dc) == "Failure with Consequences"
    assert classify_outcome_tier(d20_raw=12, total=12, difficulty_class=dc) == "Failure with Consequences"

    # Simple Failure (-2 <= margin <= -1): total 13, 14
    assert classify_outcome_tier(d20_raw=13, total=13, difficulty_class=dc) == "Simple Failure"
    assert classify_outcome_tier(d20_raw=14, total=14, difficulty_class=dc) == "Simple Failure"

    # Clean Success (0 <= margin <= 4): total 15, 16, 17, 18, 19
    assert classify_outcome_tier(d20_raw=15, total=15, difficulty_class=dc) == "Clean Success"
    assert classify_outcome_tier(d20_raw=16, total=17, difficulty_class=dc) == "Clean Success"
    assert classify_outcome_tier(d20_raw=18, total=19, difficulty_class=dc) == "Clean Success"

    # Critical Success (margin >= 5): total >= 20
    assert classify_outcome_tier(d20_raw=19, total=20, difficulty_class=dc) == "Critical Success"
    assert classify_outcome_tier(d20_raw=19, total=25, difficulty_class=dc) == "Critical Success"


# =========================================================================
# 2. Backward Compatibility & Pydantic Normalization
# =========================================================================

def test_legacy_tier_normalization():
    """Ensure older saved turns with 'Failure with Consequence' or 'Partial Success' deserialize cleanly."""
    res1 = DiceRollResult(
        action_description="Lockpicking backdoor",
        skill_or_approach="Agility",
        d20_raw=11,
        modifier=0,
        total=11,
        difficulty_class=15,
        narrative_directive="Lock gets jammed",
        outcome_tier="Failure with Consequence",  # type: ignore[arg-type]
    )
    assert res1.outcome_tier == "Failure with Consequences"

    res2 = DiceRollResult(
        action_description="Lockpicking backdoor",
        skill_or_approach="Agility",
        d20_raw=14,
        modifier=0,
        total=14,
        difficulty_class=15,
        narrative_directive="Lock does not budge",
        outcome_tier="Partial Success",  # type: ignore[arg-type]
    )
    assert res2.outcome_tier == "Simple Failure"


def test_pre_turn_analysis_backward_compatible_resolved_roll():
    """PreTurnAnalysis with character_rolls should automatically populate resolved_roll for legacy readers."""
    roll_a = DiceRollResult(
        action_description="Hacking",
        skill_or_approach="Hack",
        d20_raw=16,
        modifier=2,
        total=18,
        difficulty_class=12,
        narrative_directive="Hacks terminal cleanly",
        outcome_tier="Clean Success",
        character_id="char_a",
        character_name="Alice",
    )
    pre = PreTurnAnalysis(
        user_sentiment="focused",
        subtext_interpretation="Hacking console",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        character_rolls={"char_a": roll_a},
    )
    assert pre.resolved_roll is not None
    assert pre.resolved_roll.character_id == "char_a"
    assert pre.resolved_roll.total == 18
    assert pre.character_rolls["char_a"].outcome_tier == "Clean Success"


# =========================================================================
# 3. Directives Tailoring
# =========================================================================

def test_build_tier_directives_content():
    """Directives must contain explicit instructions matching the user's tier definitions."""
    p_crit_fail, n_crit_fail = build_tier_directives(
        outcome_tier="Critical Failure",
        action_description="lockpick",
        check_role="active_attempt",
    )
    assert "backfires" in p_crit_fail.lower() or "severe" in p_crit_fail.lower()
    assert "crisis" in n_crit_fail.lower() or "catastrophic" in n_crit_fail.lower()

    p_fail_conseq, n_fail_conseq = build_tier_directives(
        outcome_tier="Failure with Consequences",
        action_description="negotiate",
        check_role="active_attempt",
    )
    assert "consequence" in p_fail_conseq.lower() or "complication" in p_fail_conseq.lower()

    p_simple_fail, n_simple_fail = build_tier_directives(
        outcome_tier="Simple Failure",
        action_description="climb",
        check_role="active_attempt",
    )
    assert "no immediate" in p_simple_fail.lower() or "without extra" in p_simple_fail.lower()

    p_clean_succ, n_clean_succ = build_tier_directives(
        outcome_tier="Clean Success",
        action_description="shoot",
        check_role="active_attempt",
    )
    assert "cleanly" in p_clean_succ.lower() or "as intended" in p_clean_succ.lower()

    p_crit_succ, n_crit_succ = build_tier_directives(
        outcome_tier="Critical Success",
        action_description="persuade",
        check_role="active_attempt",
    )
    assert "outperform" in p_crit_succ.lower() or "decisive" in p_crit_succ.lower()


# =========================================================================
# 4. Individual Rolls vs Manual Override & Bystander Skipping
# =========================================================================

def test_resolve_character_dice_checks_independent_and_bystanders():
    """Without manual override, each active character gets an independent roll; uninvolved bystanders are skipped."""
    alice = _make_dummy_character("alice", "Alice")
    bob = _make_dummy_character("bob", "Bob")
    char_specs = [
        CharacterCheckSpec(
            character_id="alice",
            character_name="Alice",
            requires_roll=True,
            action_description="Slicing terminal",
            skill_or_approach="Hacking",
            difficulty_class=14,
            relevant_modifier=2,
            check_role="active_attempt",
        ),
        CharacterCheckSpec(
            character_id="bob",
            character_name="Bob",
            requires_roll=False,  # Uninvolved bystander!
            action_description="Standing guard quietly",
            skill_or_approach="Vigilance",
            difficulty_class=10,
            relevant_modifier=0,
            check_role="co_present_bystander",
        ),
    ]

    results = resolve_character_dice_checks(
        [alice, bob],
        character_checks=char_specs,
        fallback_trigger=MechanicsTrigger(requires_roll=False),
        user_message="Alice slices terminal while Bob stands guard.",
        manual_override=None,
    )
    # Alice rolled, Bob was skipped
    assert "alice" in results
    assert "bob" not in results
    assert results["alice"].is_manual_override is False
    assert 1 <= results["alice"].d20_raw <= 20
    assert results["alice"].modifier == 2
    assert results["alice"].plan_directive != ""


def test_resolve_character_dice_checks_manual_override_adopted_by_all():
    """When user specifies manual_dice_override, all characters adopt it (including bystanders)."""
    alice = _make_dummy_character("alice", "Alice")
    bob = _make_dummy_character("bob", "Bob")
    char_specs = [
        CharacterCheckSpec(
            character_id="alice",
            character_name="Alice",
            requires_roll=True,
            action_description="Slicing terminal",
            skill_or_approach="Hacking",
            difficulty_class=14,
            relevant_modifier=2,
            check_role="active_attempt",
        ),
        CharacterCheckSpec(
            character_id="bob",
            character_name="Bob",
            requires_roll=False,
            action_description="Watching the corridor",
            skill_or_approach="Observation",
            difficulty_class=12,
            relevant_modifier=1,
            check_role="co_present_bystander",
        ),
    ]

    results = resolve_character_dice_checks(
        [alice, bob],
        character_checks=char_specs,
        fallback_trigger=MechanicsTrigger(requires_roll=False),
        user_message="Alice slices terminal while Bob watches.",
        manual_override=19,
    )
    # Both Alice and Bob adopt 19!
    assert "alice" in results
    assert "bob" in results
    assert results["alice"].d20_raw == 19
    assert results["alice"].is_manual_override is True
    assert results["alice"].total == 21  # 19 + 2
    assert results["alice"].outcome_tier == "Critical Success"

    assert results["bob"].d20_raw == 19
    assert results["bob"].is_manual_override is True
    assert results["bob"].total == 20  # 19 + 1
    assert results["bob"].outcome_tier == "Critical Success"


# =========================================================================
# 5. Inventory Arbitration with Character-Specific Rolls
# =========================================================================

def test_inventory_arbitration_blocks_on_failure():
    """If claimant's specific roll is a Simple Failure or Critical Failure, transfer must be denied."""
    roll_fail = DiceRollResult(
        action_description="Pickpocket attempt",
        skill_or_approach="Agility",
        d20_raw=8,
        modifier=0,
        total=8,
        difficulty_class=12,
        narrative_directive="Hands fumble",
        outcome_tier="Simple Failure",
        character_id="thief_1",
    )
    pre_turn = PreTurnAnalysis(
        user_sentiment="stealthy",
        subtext_interpretation="Attempting pickpocket",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        character_rolls={"thief_1": roll_fail},
    )

    char_victim = _make_dummy_character("victim_1", "Victim")
    char_thief = _make_dummy_character("thief_1", "Thief")
    state_thief = _make_dummy_state("thief_1")

    turn = TurnNodeRecord(
        id="turn_pickpocket",
        campaign_id="camp_1",
        depth_index=1,
        actor_id="thief_1",
        user_message="I try to pickpocket the Data Pad.",
        raw_prose="The thief reached out towards the datapad.",
        cognition=CognitionBlock(skipped=True),
        character_state=state_thief,
        created_at="2026-11-02T00:00:00Z",
        pre_turn=pre_turn,
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_pickpocket",
            active_location_id="loc_1",
            world_timestamp="Night",
        ),
    )

    case = ContestedItemCase(
        norm_key="datapad",
        display_name="Data Pad",
        claimant_ids=["thief_1"],
        prior_holder_id="victim_1",
        reason="unrelinquished_transfer",
    )

    winner_id, rationale = _heuristic_arbitrate_case(
        case,
        completed_turn=turn,
        chars_by_id={"victim_1": char_victim, "thief_1": char_thief},
    )
    # Transfer denied! Victim retains custody
    assert winner_id == "victim_1"
    assert "failure" in rationale.lower()


def test_inventory_arbitration_resolves_roll_for_specific_character():
    """resolve_roll_for_character retrieves claimant's roll, not an arbitrary character's roll."""
    roll_active = DiceRollResult(
        action_description="Speech",
        skill_or_approach="Speech",
        d20_raw=20,
        modifier=0,
        total=20,
        difficulty_class=10,
        narrative_directive="Captivates the crowd",
        outcome_tier="Critical Success",
        character_id="speaker_1",
    )
    roll_claimant = DiceRollResult(
        action_description="Grab",
        skill_or_approach="Sleight of Hand",
        d20_raw=2,
        modifier=0,
        total=2,
        difficulty_class=15,
        narrative_directive="Snatches clumsily",
        outcome_tier="Critical Failure",
        character_id="grabber_1",
    )
    pre_turn = PreTurnAnalysis(
        user_sentiment="chaotic",
        subtext_interpretation="Speaker talks while Grabber snatches",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        character_rolls={
            "speaker_1": roll_active,
            "grabber_1": roll_claimant,
        },
    )

    claimant_roll = resolve_roll_for_character(pre_turn, "grabber_1")
    assert claimant_roll is not None
    assert claimant_roll.outcome_tier == "Critical Failure"
    assert claimant_roll.character_id == "grabber_1"


# =========================================================================
# 6. Phase 5 Multi-Character Plan Persistence
# =========================================================================

@pytest.mark.asyncio
async def test_phase5_persists_plans_for_all_co_present_characters(temp_repo):
    """Phase 5 post-turn clerk must update active_want and active_plan for ALL characters in turn.cognitions."""
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)
    kira = temp_repo.get_character("char_kira_vance")

    bob = temp_repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Bob",
            tagline="Bodyguard",
            physical_appearance="Burly frame",
            core_persona="Loyal and vigilant protector.",
            baseline_psyche=BaselinePsyche(
                valence=0.0,
                arousal=0.5,
                mood_label="Alert",
                core_drive="Protect",
                core_fear="Harm",
                default_want="Watch the door",
                default_plan="Cover the doorway",
            ),
        ),
        world_id=world.id,
    )

    camp = temp_repo.create_campaign(
        name="Co-present Plan Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, bob.id],
        character_locations={
            kira.id: main_bar.id,
            bob.id: main_bar.id,
        },
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    cog_kira = CognitionBlock(
        recall="Remembered security codes",
        feeling="High tension",
        want="Access main terminal",
        plan="Bypass the secondary firewall",
        valence=0.2,
        arousal=0.8,
    )
    cog_bob = CognitionBlock(
        recall="Noticed guard rotation",
        feeling="Hyper-alert",
        want="Cover Kira's flank",
        plan="Draw weapon and aim at service entrance",
        valence=-0.1,
        arousal=0.9,
    )

    turn1 = temp_repo.save_turn_node(
        turn_id="turn_cog_plans_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Kira hacks while Bob watches the door.",
        actor_id=kira.id,
        raw_prose="Kira typed furiously. Bob kept his blaster raised.",
        cognition=cog_kira,
        cognitions={kira.id: cog_kira, bob.id: cog_bob},
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_cog_plans_1"}),
        extra_character_states=[
            bundle0.character_states[bob.id].model_copy(update={"turn_id": "turn_cog_plans_1"})
        ],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(
            user_sentiment="tactical",
            subtext_interpretation="Infiltration",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_cog_plans_1"}),
    )

    await run_phase5_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn1,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, bob],
    )

    updated_bundle = temp_repo.get_campaign_state_bundle(camp.id)
    kira_state = updated_bundle.character_states[kira.id]
    bob_state = updated_bundle.character_states[bob.id]

    # Both characters must have their active_want and active_plan updated from turn.cognitions!
    assert kira_state.active_want == "Access main terminal"
    assert kira_state.active_plan == "Bypass the secondary firewall"

    assert bob_state.active_want == "Cover Kira's flank"
    assert bob_state.active_plan == "Draw weapon and aim at service entrance"


# =========================================================================
# 7. Cognition Agent Reacts to Tier Directives
# =========================================================================

def test_heuristic_character_cognition_incorporates_roll_tier():
    """Verify that heuristic cognition adapts feeling, want, and plan according to outcome tier."""
    char = _make_dummy_character("char_a", "Alice")
    state = _make_dummy_state("char_a")

    # Critical Failure
    roll_crit_fail = DiceRollResult(
        action_description="Hacking",
        skill_or_approach="Hacking",
        d20_raw=1,
        modifier=0,
        total=1,
        difficulty_class=12,
        narrative_directive="Catastrophic failure: terminal locked, alarm sounding",
        outcome_tier="Critical Failure",
        plan_directive="Severe backfire: terminal locked, alarm sounding",
        character_id="char_a",
    )
    pre_turn_crit_fail = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Slice terminal",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        character_rolls={"char_a": roll_crit_fail},
    )
    cog_crit_fail = heuristic_character_cognition(
        user_message="I try to slice the terminal",
        character=char,
        previous_state=state,
        pre_turn=pre_turn_crit_fail,
    )
    assert cog_crit_fail.valence < 0.0  # Emotional collapse/crisis
    assert "severe" in cog_crit_fail.plan.lower() or "backfire" in cog_crit_fail.plan.lower()

    # Critical Success
    roll_crit_succ = DiceRollResult(
        action_description="Hacking",
        skill_or_approach="Hacking",
        d20_raw=20,
        modifier=2,
        total=22,
        difficulty_class=12,
        narrative_directive="Flawless execution: full root privileges gained",
        outcome_tier="Critical Success",
        plan_directive="Flawless execution: full root privileges gained",
        character_id="char_a",
    )
    pre_turn_crit_succ = PreTurnAnalysis(
        user_sentiment="confident",
        subtext_interpretation="Slice terminal",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        character_rolls={"char_a": roll_crit_succ},
    )
    cog_crit_succ = heuristic_character_cognition(
        user_message="I try to slice the terminal",
        character=char,
        previous_state=state,
        pre_turn=pre_turn_crit_succ,
    )
    assert cog_crit_succ.valence > 0.3  # Elation / surge
    assert "flawless" in cog_crit_succ.plan.lower() or "decisive" in cog_crit_succ.plan.lower()


# =========================================================================
# 8. Dice Mode Toggle & Narrator Dice Suppression
# =========================================================================

def test_dice_mode_disabled_suppresses_all_rolls():
    """In disabled mode, rolls are NEVER performed even if actions are risky or flagged."""
    alice = _make_dummy_character("alice", "Alice")
    specs = [
        CharacterCheckSpec(
            character_id="alice",
            character_name="Alice",
            requires_roll=True,
            action_description="Defusing a live bomb",
            skill_or_approach="Demolitions",
            difficulty_class=18,
            relevant_modifier=2,
            check_role="active_attempt",
        )
    ]
    results = resolve_character_dice_checks(
        [alice],
        character_checks=specs,
        fallback_trigger=MechanicsTrigger(requires_roll=True),
        user_message="I defuse the bomb",
        dice_mode="disabled",
    )
    assert results == {}


def test_dice_mode_forced_random_guarantees_roll():
    """In forced mode with no manual override, a random roll is guaranteed for the active character."""
    alice = _make_dummy_character("alice", "Alice")
    bob = _make_dummy_character("bob", "Bob")
    # Neither flagged as requiring roll:
    specs = [
        CharacterCheckSpec(
            character_id="alice",
            character_name="Alice",
            requires_roll=False,
            action_description="Standing by",
            skill_or_approach="Observation",
            difficulty_class=10,
            relevant_modifier=0,
            check_role="active_attempt",
        ),
        CharacterCheckSpec(
            character_id="bob",
            character_name="Bob",
            requires_roll=False,
            action_description="Watching the door",
            skill_or_approach="Observation",
            difficulty_class=10,
            relevant_modifier=0,
            check_role="co_present_bystander",
        ),
    ]
    results = resolve_character_dice_checks(
        [alice, bob],
        character_checks=specs,
        fallback_trigger=MechanicsTrigger(requires_roll=False),
        user_message="Alice looks around while Bob watches.",
        dice_mode="forced",
        manual_override=None,
        active_speaker_id="alice",
    )
    # Alice (active speaker) must be forced to roll
    assert "alice" in results
    assert results["alice"].is_manual_override is False
    assert 1 <= results["alice"].d20_raw <= 20
    # Bystander Bob should not be rolled in forced random
    assert "bob" not in results


def test_dice_mode_forced_pinned_override():
    """In forced mode with manual override value, all characters adopt it."""
    alice = _make_dummy_character("alice", "Alice")
    bob = _make_dummy_character("bob", "Bob")
    specs = [
        CharacterCheckSpec(
            character_id="alice",
            character_name="Alice",
            requires_roll=True,
            action_description="Negotiating terms",
            skill_or_approach="Charm",
            difficulty_class=15,
            relevant_modifier=3,
            check_role="active_attempt",
        )
    ]
    results = resolve_character_dice_checks(
        [alice, bob],
        character_checks=specs,
        fallback_trigger=MechanicsTrigger(requires_roll=False),
        user_message="Alice negotiates while Bob listens.",
        dice_mode="forced",
        manual_override=18,
        active_speaker_id="alice",
    )
    assert "alice" in results
    assert results["alice"].d20_raw == 18
    assert results["alice"].is_manual_override is True
    assert results["alice"].modifier == 3

    assert "bob" in results
    assert results["bob"].d20_raw == 18
    assert results["bob"].is_manual_override is True
    assert results["bob"].check_role == "co_present_bystander"


def test_turn_submit_request_dice_mode_reconciliation():
    """TurnSubmitRequest reconciles manual override and disabled mode cleanly."""
    # manual override promotes to forced
    req1 = TurnSubmitRequest(user_message="Hello", manual_dice_override=12)
    assert req1.dice_mode == "forced"
    assert req1.manual_dice_override == 12

    # disabled mode clears manual override
    req2 = TurnSubmitRequest(user_message="Hello", dice_mode="disabled", manual_dice_override=12)
    assert req2.dice_mode == "disabled"
    assert req2.manual_dice_override is None

    # default is auto
    req3 = TurnSubmitRequest(user_message="Hello")
    assert req3.dice_mode == "auto"
    assert req3.manual_dice_override is None


def test_pre_turn_analysis_legacy_deserialization_and_dice_mode_invariants():
    """PreTurnAnalysis validates dice_mode invariants and deserializes legacy turns properly."""
    # Deserializing legacy turn with manual override in resolved_roll
    legacy_data = {
        "user_sentiment": "neutral",
        "subtext_interpretation": "action",
        "mentioned_entities": [],
        "memory_search_queries": [],
        "spatial_intent": "stay",
        "resolved_roll": {
            "action_description": "legacy action",
            "skill_or_approach": "test",
            "d20_raw": 14,
            "modifier": 0,
            "total": 14,
            "difficulty_class": 10,
            "narrative_directive": "done",
            "outcome_tier": "Clean Success",
            "is_manual_override": True,
        },
    }
    analysis = PreTurnAnalysis.model_validate(legacy_data)
    assert analysis.dice_mode == "forced"
    assert analysis.manual_dice_value == 14

    # Disabled mode must enforce empty rolls
    roll = DiceRollResult(
        action_description="test",
        skill_or_approach="test",
        d20_raw=10,
        modifier=0,
        total=10,
        difficulty_class=10,
        narrative_directive="test",
        outcome_tier="Clean Success",
    )
    analysis_disabled = PreTurnAnalysis(
        user_sentiment="neutral",
        subtext_interpretation="action",
        mentioned_entities=[],
        memory_search_queries=[],
        spatial_intent="stay",
        dice_mode="disabled",
        resolved_roll=roll,
        character_rolls={"c1": roll},
    )
    assert analysis_disabled.dice_mode == "disabled"
    assert analysis_disabled.resolved_roll is None
    assert analysis_disabled.character_rolls == {}
    assert analysis_disabled.mechanics_check.requires_roll is False


async def test_narrator_mode_never_rolls_dice_under_any_circumstance(temp_repo):
    """In narrator mode, dice should NEVER be rolled under any circumstance."""
    camp_id = "camp_neon_rust_default"

    # 1. Narrator describe
    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="describe",
            manual_dice_override=19,  # Even if an override were provided, narrator mode disables it
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]
    pre_turn = saved_turn["pre_turn"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert pre_turn["dice_mode"] == "disabled"
    assert pre_turn["resolved_roll"] is None
    assert pre_turn.get("character_rolls") in (None, {})
    assert pre_turn["mechanics_check"]["requires_roll"] is False

    # 2. Narrator perception check
    events_perc = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="Check for hidden bugs in the wiring",
            narrative_mode="perception",
            narrator_directive="Check for hidden bugs in the wiring",
        ),
    ):
        events_perc.append(packet)

    turn_saved_perc = next(e for e in events_perc if e["event"] == "turn_saved")
    saved_turn_perc = turn_saved_perc["data"]
    pre_turn_perc = saved_turn_perc["pre_turn"]

    assert saved_turn_perc["actor_id"] == "__narrator__"
    assert pre_turn_perc["dice_mode"] == "disabled"
    assert pre_turn_perc["resolved_roll"] is None
    assert pre_turn_perc.get("character_rolls") in (None, {})
    assert pre_turn_perc["mechanics_check"]["requires_roll"] is False
