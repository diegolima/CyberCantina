"""Tests for Multi-Scene Arc Objectives & Phase 3 Cognition Context Bridge."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed_catalog import SHOWCASE_CHARACTER_SEED_VERSION
from app.engine.clerk.memories import _extract_heuristic_character_memories
from app.engine.gm_talk import _compute_branch_visibility, _format_character_detail
from app.engine.gm_tools import LlmToolCall, execute_gm_tool
from app.engine.llm_client import llm_client
from app.engine.phase2_context import (
    build_cognition_recent_turns_tail,
    build_cognition_witnessed_synopsis_strip,
    format_arc_objective_prompt_line,
    pack_recalled_items_to_budget,
    resolve_character_previous_state,
)
from app.engine.phase3_cognition import (
    run_character_cognition_agent,
    select_cognition_recalled_items,
)
from app.engine.clerk.pipeline import _is_character_objective_disrupted
from app.engine.phase5_clerk import (
    resolve_post_turn_arc_objective,
    run_phase5_post_turn_clerk,
)
from app.schemas.affective import temperament_config_for_archetype
from app.schemas.character import (
    BaselinePsyche,
    CharacterObjective,
    CharacterStateSnapshot,
    CharacterWizardDraft,
    CognitionBlock,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    EpisodicChunkRecord,
    ExtractedCharacterMemory,
    MajorEventSpec,
    PreTurnAnalysis,
    RecalledMemoryItem,
    RelationalEventSpec,
    WorldPostTurnDelta,
)
from tests.factories import seed_campaign, seed_character, seed_linear_world, seed_minimal_scenario, seed_user


def test_character_objective_schema_sanitization_and_turn0_seeding(
    empty_repo: CantinaRepository,
) -> None:
    """Verify CharacterObjective sanitization, BaselinePsyche Turn 0 seeding, and showcase v4."""
    obj = CharacterObjective(
        summary="<think>reasoning leak</think><b>Smuggle</b> Cargo (< 30 kg) through Gate 4",
        deadline_cue="<i>before</i> daybreak < 6 AM",
        set_at_turn_depth=2,
    )
    assert "reasoning leak" not in obj.summary
    assert "<b>" not in obj.summary
    assert "Smuggle Cargo (< 30 kg) through Gate 4" == obj.summary
    assert obj.deadline_cue == "before daybreak < 6 AM"
    assert obj.format_prompt_text() == "Smuggle Cargo (< 30 kg) through Gate 4 [Deadline/Condition: before daybreak < 6 AM]"

    # Showcase catalog bump & Yulia Halim default_objective verification
    assert SHOWCASE_CHARACTER_SEED_VERSION == 4
    yulia_path = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "db"
        / "showcase_data"
        / "the_green_lie"
        / "character.json"
    )
    yulia_raw = json.loads(yulia_path.read_text(encoding="utf-8"))
    yulia_obj = yulia_raw["baseline_psyche"].get("default_objective")
    assert isinstance(yulia_obj, dict)
    assert "Sluice" in yulia_obj["summary"]
    assert "aegis" in (yulia_obj.get("deadline_cue") or "").lower()

    # Turn 0 seeding: with default_objective vs None
    user = seed_user(empty_repo)
    world, _ = seed_linear_world(empty_repo, owner_id=user.id)

    char_with_goal = empty_repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Kira Goal",
            tagline="Driven runner",
            core_persona="Focused.",
            initial_message="We move at dawn.",
            baseline_psyche=BaselinePsyche(
                mood_label="Alert",
                valence=0.0,
                arousal=0.4,
                core_drive="Reach Sector 8",
                core_fear="Lockdown",
                default_want="Confirm pilot",
                default_plan="Check docks",
                default_objective=CharacterObjective(
                    summary="Cross the Sluice checkpoint into Sector 8",
                    deadline_cue="at daybreak",
                ),
            ),
        ),
        world_id=world.id,
        owner_id=user.id,
    )
    char_no_goal = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Vesper Blank")

    camp_with = seed_campaign(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=char_with_goal.id,
    )
    bundle_with = empty_repo.get_campaign_state_bundle(camp_with.id, owner_id=user.id)
    turn0_obj = bundle_with.character_states[char_with_goal.id].arc_objective
    assert turn0_obj is not None
    assert turn0_obj.summary == "Cross the Sluice checkpoint into Sector 8"
    assert turn0_obj.deadline_cue == "at daybreak"
    assert turn0_obj.set_at_turn_depth == 0

    camp_without = seed_campaign(
        empty_repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=char_no_goal.id,
    )
    bundle_without = empty_repo.get_campaign_state_bundle(camp_without.id, owner_id=user.id)
    assert bundle_without.character_states[char_no_goal.id].arc_objective is None


def test_arc_objective_branch_and_checkout_isolation(empty_repo: CantinaRepository) -> None:
    """Verify character_states.arc_objective_json is strictly branch-scoped across checkouts."""
    scenario = seed_minimal_scenario(empty_repo, character_name="Kira Vance")
    camp = scenario.campaign
    char = scenario.character
    bundle0 = empty_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]
    base_state = bundle0.character_states[char.id]

    assert base_state.arc_objective is None

    # Branch A sets one objective at Turn 1
    obj_a = CharacterObjective(summary="Smuggle medicine through the Sluice", deadline_cue="at daybreak", set_at_turn_depth=1)
    turn_a = empty_repo.save_turn_node(
        turn_id="turn_branch_a",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Let's go via the Sluice.",
        actor_id=char.id,
        raw_prose="Agreed.",
        cognition=CognitionBlock(feeling="Resolved", valence=0.1, arousal=0.5),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_branch_a"}),
        character_state=base_state.model_copy(update={"turn_id": "turn_branch_a", "arc_objective": obj_a}),
        recalled_items=[],
    )

    # Branch B sets a completely different objective from root_turn
    obj_b = CharacterObjective(summary="Lay low in the backroom clinic", deadline_cue=None, set_at_turn_depth=1)
    turn_b = empty_repo.save_turn_node(
        turn_id="turn_branch_b",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Stay in hiding.",
        actor_id=char.id,
        raw_prose="We hide.",
        cognition=CognitionBlock(feeling="Cautious", valence=-0.1, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_branch_b"}),
        character_state=base_state.model_copy(update={"turn_id": "turn_branch_b", "arc_objective": obj_b}),
        recalled_items=[],
    )

    assert empty_repo.get_campaign_state_bundle(camp.id).character_states[char.id].arc_objective == obj_b

    empty_repo.checkout_turn_branch(camp.id, turn_a.id)
    assert empty_repo.get_campaign_state_bundle(camp.id).character_states[char.id].arc_objective == obj_a

    empty_repo.checkout_turn_branch(camp.id, turn_b.id)
    assert empty_repo.get_campaign_state_bundle(camp.id).character_states[char.id].arc_objective == obj_b

    empty_repo.checkout_turn_branch(camp.id, root_turn.id)
    assert empty_repo.get_campaign_state_bundle(camp.id).character_states[char.id].arc_objective is None


def test_cognition_short_first_recall_packing_turn72_regression() -> None:
    """Reproduce Turn 72 starvation bug and verify short-first + 450 token default preserves rank #3/#4."""
    assert settings.memory_config.recall_budget_cognition_tokens == 450

    verbose_body = " ".join(["Atmospheric harbor chatter and rain on corrugated steel."] * 45)
    shared_items = [
        RecalledMemoryItem(
            id="vec_rank0",
            source_type="episodic_chunk",
            title="Episode Turns 49–54",
            content=verbose_body,
            short_content="Kira and Jax waited out a patrol in the lower maintenance duct.",
            score=1.0,
        ),
        RecalledMemoryItem(
            id="vec_rank1",
            source_type="lore",
            title="Harbor Patrol Shifts",
            content=" ".join(["Detailed garrison duty roster across all twenty-four sector watches."] * 16),
            short_content="Harbor Patrol sweeps thin out at dusk and shift right after daybreak.",
            score=0.95,
        ),
        RecalledMemoryItem(
            id="vec_rank2",
            source_type="lore",
            title="Customs Manifest",
            content=" ".join(["Routine freight manifest details for dock barges."] * 14),
            short_content="Docked freighters require transponder clearance codes.",
            score=0.91,
        ),
        RecalledMemoryItem(
            id="vec_ep1_6",
            source_type="episodic_chunk",
            title="Episode Turns 1–6",
            content="Longer episode recap covering initial harbor meeting and payment negotiation.",
            short_content="Kira Vance offers 3,000 credits, half upfront, for transit through the Sluice at daybreak.",
            score=0.888,
        ),
        RecalledMemoryItem(
            id="vec_sluice_shard",
            source_type="lore",
            title="The Sluice Passage",
            content="Narrow tidal spillway between Old Wharf and Sector 8.",
            short_content="Tidal spillway connecting Old Wharf to Sector 8; passable before patrol sweep.",
            score=0.885,
        ),
    ]
    personal_shards = [
        RecalledMemoryItem(
            id="shard_personal_1",
            source_type="character_shard",
            title="Courier Ledger",
            content="She swore never to abandon her Sector 8 contact before sunrise.",
            short_content="Swore to deliver Sector 8 contact ledger before sunrise.",
            score=0.85,
        ),
    ]

    # Full-first would give vec_rank0 ~300+ tokens; short-first lets all critical items fit!
    selected = select_cognition_recalled_items(
        shared_items,
        personal_shards,
        token_budget=settings.memory_config.recall_budget_cognition_tokens,
    )
    by_id = {item.id: item for item in selected}
    assert "shard_personal_1" in by_id
    assert "vec_rank0" in by_id
    assert by_id["vec_rank0"].render_form == "short"
    assert "vec_ep1_6" in by_id
    assert "vec_sluice_shard" in by_id

    # Direct pack_recalled_items_to_budget(..., prefer_short_first=True) even at tighter budget
    packed_tight = pack_recalled_items_to_budget(
        shared_items,
        token_budget=220,
        prefer_short_first=True,
    )
    tight_ids = {item.id for item in packed_tight}
    assert "vec_ep1_6" in tight_ids
    assert "vec_sluice_shard" in tight_ids


async def test_cognition_context_bridge_synopses_tail_whispers_and_arc_objective(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify witnessed Zone 2 synopses, compact Zone 3 tail (whisper/epistemic gated), and quiet Arc Objective anchor."""
    scenario = seed_minimal_scenario(
        empty_repo,
        location_names=("Old Wharf", "Locked Vault"),
        character_name="Yulia Halim",
        temperament="obsessive",
    )
    user = scenario.user
    world = scenario.world
    wharf, vault = world.locations[0], world.locations[1]
    yulia = scenario.character
    viktor = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Viktor Voss")

    state_yulia = CharacterStateSnapshot(
        turn_id="turn_5",
        character_id=yulia.id,
        current_location_id=wharf.id,
        mood_label="Guarded",
        valence=-0.05,
        arousal=0.45,
        active_want="Verify the boat can run quietly",
        active_plan="- Ask about fuel reserves",
        arc_objective=CharacterObjective(
            summary="Reach Sector 8 through the Sluice",
            deadline_cue="at daybreak",
            set_at_turn_depth=0,
        ),
        care_state=None,
    )

    chunks = [
        EpisodicChunkRecord(
            id="ep_witnessed",
            campaign_id=scenario.campaign.id,
            leaf_turn_id="turn_5",
            start_turn_depth=1,
            end_turn_depth=3,
            summary_text="Turns 1–3: Yulia offered 3,000 credits for Sluice passage at daybreak.",
            synopsis_text="Yulia offered 3,000 credits, half upfront, for transit through the Sluice at daybreak.",
            witness_character_ids=[yulia.id],
            salience_score=7,
            created_at="2088-05-10T21:10:00Z",
        ),
        EpisodicChunkRecord(
            id="ep_secret",
            campaign_id=scenario.campaign.id,
            leaf_turn_id="turn_5",
            start_turn_depth=4,
            end_turn_depth=5,
            summary_text="Turns 4–5: Secret Syndicate deal in the Locked Vault.",
            synopsis_text="Viktor secretly sold Yulia's transponder frequency in the Locked Vault.",
            witness_character_ids=[viktor.id],
            salience_score=8,
            created_at="2088-05-10T21:20:00Z",
        ),
    ]

    bundle0 = empty_repo.get_campaign_state_bundle(scenario.campaign.id)
    root_turn = bundle0.active_branch_turns[-1]

    t1 = empty_repo.save_turn_node(
        turn_id="turn_6",
        campaign_id=scenario.campaign.id,
        parent_turn_id=root_turn.id,
        depth_index=6,
        user_message="How much fuel is in the skiff?",
        actor_id=yulia.id,
        raw_prose="Half a tank, enough for the tide run.",
        cognition=CognitionBlock(feeling="Alert", valence=0.0, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_6", "active_location_id": wharf.id}
        ),
        character_state=state_yulia.model_copy(update={"turn_id": "turn_6"}),
        recalled_items=[],
    )
    t2 = empty_repo.save_turn_node(
        turn_id="turn_7",
        campaign_id=scenario.campaign.id,
        parent_turn_id=t1.id,
        depth_index=7,
        user_message="@Viktor Voss: Hide the stolen detonators in the vault.\nCheck the tide chart on deck.",
        actor_id=viktor.id,
        raw_prose="Yulia inspects the harbor tide table under the lantern.",
        cognition=CognitionBlock(feeling="Measured", valence=0.0, arousal=0.35),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_7", "active_location_id": wharf.id}
        ),
        character_state=state_yulia.model_copy(update={"turn_id": "turn_7"}),
        extra_character_states=[
            bundle0.character_states[yulia.id].model_copy(
                update={
                    "turn_id": "turn_7",
                    "character_id": viktor.id,
                    "current_location_id": wharf.id,
                }
            )
        ],
        recalled_items=[],
    )
    t3_elsewhere = empty_repo.save_turn_node(
        turn_id="turn_8",
        campaign_id=scenario.campaign.id,
        parent_turn_id=t2.id,
        depth_index=8,
        user_message="Open the secret safe in the Locked Vault.",
        actor_id=viktor.id,
        raw_prose="Viktor cracks the Syndicate safe inside the Locked Vault alone.",
        cognition=CognitionBlock(feeling="Sly", valence=0.2, arousal=0.5),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_8", "active_location_id": vault.id}
        ),
        character_state=state_yulia.model_copy(
            update={"turn_id": "turn_8", "current_location_id": wharf.id}
        ),
        extra_character_states=[
            state_yulia.model_copy(
                update={"turn_id": "turn_8", "character_id": viktor.id, "current_location_id": vault.id}
            )
        ],
        recalled_items=[],
    )

    branch_turns = [root_turn, t1, t2, t3_elsewhere]

    strip = build_cognition_witnessed_synopsis_strip(chunks, branch_turns, yulia.id, max_tokens=350)
    assert "3,000 credits" in strip
    assert "transponder frequency" not in strip

    tail = build_cognition_recent_turns_tail(
        branch_turns,
        chunks,
        yulia.id,
        present_characters=[yulia, viktor],
        character_name_map={yulia.id: yulia.name, viktor.id: viktor.name},
        max_turns=3,
        max_tokens=300,
    )
    assert "Half a tank" in tail
    assert "Check the tide chart" in tail
    assert "stolen detonators" not in tail
    assert "Syndicate safe" not in tail

    prompt_line = format_arc_objective_prompt_line(
        state_yulia.arc_objective,
        world_timestamp="2088-05-11 04:45",
        temperament_archetype="obsessive",
        for_cognition=True,
    )
    assert "Reach Sector 8 through the Sluice" in prompt_line
    assert "at daybreak" in prompt_line
    assert "2088-05-11 04:45" in prompt_line
    assert "never force" in prompt_line.lower()

    captured_messages: list[list[dict[str, str]]] = []

    async def fake_complete_structured(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
        **kwargs: Any,
    ) -> CognitionBlock:
        captured_messages.append(messages)
        return CognitionBlock(
            recall="- Sluice transit at daybreak.\n",
            feeling="Alert",
            valence=0.0,
            arousal=0.4,
            want="Check launch readiness",
            plan="- Confirm tide clearance",
        )

    monkeypatch.setattr(llm_client, "complete_structured", fake_complete_structured)

    # Refresh baseline psyche with explicit obsessive temperament
    yulia_obsessive = yulia.model_copy(
        update={
            "baseline_psyche": yulia.baseline_psyche.model_copy(
                update={"temperament": temperament_config_for_archetype("obsessive")}
            )
        }
    )

    await run_character_cognition_agent(
        user_message="When do we actually need to be at the Sluice?",
        character=yulia_obsessive,
        world=world,
        role="primary",
        previous_state=state_yulia,
        active_location=wharf,
        neighbors=bundle0.neighbor_locations,
        shared_scene_items=[],
        character_recalled_items=[],
        pre_turn=PreTurnAnalysis(active_speaker_id=yulia.id, speaker_order=[yulia.id]),
        co_present_characters=[],
        episodic_chunks=chunks,
        branch_turns=branch_turns,
        world_timestamp="2088-05-11 04:45",
        character_name_map={yulia.id: yulia.name, viktor.id: viktor.name},
    )

    assert len(captured_messages) == 1
    user_prompt = captured_messages[0][-1]["content"]
    assert "Current In-World Time: 2088-05-11 04:45" in user_prompt
    assert "Arc Objective: Reach Sector 8 through the Sluice [Deadline/Condition: at daybreak]" in user_prompt
    assert "Story So Far (Witnessed Episode Synopses)" in user_prompt
    assert "3,000 credits" in user_prompt
    assert "transponder frequency" not in user_prompt
    assert "Recent Scene Exchanges (Witnessed)" in user_prompt
    assert "stolen detonators" not in user_prompt
    assert "Syndicate safe" not in user_prompt


async def test_phase5_arc_objective_lifecycle_and_passive_bystander_disruption(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify resolve_post_turn_arc_objective anti-churn guards and passive bystander Major Event wake-up."""
    existing = CharacterObjective(summary="Meet at Sluice", deadline_cue="at daybreak", set_at_turn_depth=0)

    # 1. Anti-churn guard: cannot blindly replace an active objective when undisturbed
    blocked_obj, blocked_rec, blocked_delta = resolve_post_turn_arc_objective(
        existing,
        CharacterAgentDelta(
            objective_action="set",
            objective_summary="Grab a noodle bowl instead",
            objective_deadline_cue=None,
        ),
        turn_depth=4,
        disruption_triggered=False,
    )
    assert blocked_obj == existing
    assert blocked_rec is None
    assert blocked_delta.objective_action == "keep"

    # 2. Setting when empty works and stamps turn_depth
    new_obj, set_rec, _ = resolve_post_turn_arc_objective(
        None,
        CharacterAgentDelta(
            objective_action="set",
            objective_summary="Escort Kira through the Sluice",
            objective_deadline_cue="at daybreak",
        ),
        turn_depth=3,
        disruption_triggered=False,
    )
    assert new_obj is not None
    assert new_obj.set_at_turn_depth == 3
    assert set_rec is not None and set_rec.action == "set"

    # 3. Refining preserves set_at_turn_depth and inherits deadline when omitted
    refined_obj, refine_rec, _ = resolve_post_turn_arc_objective(
        new_obj,
        CharacterAgentDelta(
            objective_action="refine",
            objective_summary="Escort Kira via East Lock Gate",
            objective_deadline_cue=None,
        ),
        turn_depth=7,
        disruption_triggered=False,
    )
    assert refined_obj is not None
    assert refined_obj.set_at_turn_depth == 3
    assert refined_obj.deadline_cue == "at daybreak"
    assert refine_rec is not None and refine_rec.action == "refine"

    # 4. Complete clears to None; Abandon clears to None
    done_obj, done_rec, _ = resolve_post_turn_arc_objective(
        refined_obj,
        CharacterAgentDelta(objective_action="complete"),
        turn_depth=8,
        disruption_triggered=False,
    )
    assert done_obj is None
    assert done_rec is not None and done_rec.action == "complete"

    # 5. Disruption predicate triggers on Major Event, trauma/betrayal, grave_wrong, or high threat+strong_neg
    assert _is_character_objective_disrupted(CharacterAgentDelta(), major_event_fired=True) is True
    assert _is_character_objective_disrupted(
        CharacterAgentDelta(
            new_memories=[ExtractedCharacterMemory(title="Betrayed", content="Sold out", significance="betrayal")]
        ),
        major_event_fired=False,
    ) is True
    assert _is_character_objective_disrupted(
        CharacterAgentDelta(
            relational_events=[RelationalEventSpec(target="user", grievance_shift="grave_wrong")]
        ),
        major_event_fired=False,
    ) is True
    assert _is_character_objective_disrupted(
        CharacterAgentDelta(goal_congruence="strong_neg", scene_threat="high"),
        major_event_fired=False,
    ) is True
    assert _is_character_objective_disrupted(CharacterAgentDelta(), major_event_fired=False) is False

    # 6. End-to-end Phase 5 run: Major Event wakes up passive co-present bystander to pivot Arc Objective
    scenario = seed_minimal_scenario(empty_repo, character_name="Kira Vance")
    world = scenario.world
    kira = scenario.character
    bystander = seed_character(empty_repo, owner_id=scenario.user.id, world_id=world.id, name="Bystander Nyx")
    loc = world.locations[0]

    camp = empty_repo.create_campaign(
        name="Major Event Disruption",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, bystander.id],
        character_locations={kira.id: loc.id, bystander.id: loc.id},
    )
    bundle0 = empty_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    nyx_old_obj = CharacterObjective(summary="Wait calmly for night shift", deadline_cue="before dawn", set_at_turn_depth=0)
    kira_state = bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_me_1"})
    nyx_state = bundle0.character_states[bystander.id].model_copy(
        update={"turn_id": "turn_me_1", "arc_objective": nyx_old_obj}
    )

    saved = empty_repo.save_turn_node(
        turn_id="turn_me_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Detonate the harbor sea-wall charges!",
        actor_id=kira.id,
        raw_prose="*The outer sea-wall erupts in white fire as Nyx shields her eyes.*",
        cognition=CognitionBlock(feeling="Shocked", valence=-0.6, arousal=0.95),
        pre_turn=PreTurnAnalysis(spatial_intent="stay", active_speaker_id=kira.id, speaker_order=[kira.id]),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_me_1"}),
        character_state=kira_state,
        extra_character_states=[nyx_state],
        recalled_items=[],
    )

    seen_prompts: list[str] = []

    async def fake_clerk_llm(
        messages: list[dict[str, str]],
        response_model: type[Any],
        profile: Any = None,
        temperature: float | None = None,
        **kwargs: Any,
    ) -> Any:
        prompt_text = "\n".join(m.get("content", "") for m in messages)
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=4,
                transition_type="stay",
                major_event=MajorEventSpec(
                    scope="location",
                    evocative_title="Harbor Sea-Wall Breached",
                    summary="Explosives tore open the Sluice sea-wall while Kira and Nyx watched.",
                    keywords=["sluice", "breach"],
                ),
            )
        if response_model is CharacterAgentDelta:
            seen_prompts.append(prompt_text)
            if "Bystander Nyx" in prompt_text:
                return CharacterAgentDelta(
                    mood_label="Panicked",
                    valence_delta=-0.25,
                    arousal_delta=0.35,
                    objective_action="set",
                    objective_summary="Evacuate the flooded pier immediately",
                    objective_deadline_cue="right now",
                )
            return CharacterAgentDelta(
                mood_label="Adrenaline-spiked",
                valence_delta=-0.1,
                arousal_delta=0.3,
                objective_action="set",
                objective_summary="Escape through the breached Sluice channel",
                objective_deadline_cue="before sirens",
            )
        raise AssertionError(f"Unexpected schema {response_model}")

    monkeypatch.setattr(llm_client, "complete_structured", fake_clerk_llm)

    updated_turn, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=saved,
        active_location=loc,
        neighbors=[],
        present_characters=[kira, bystander],
        all_participants=[kira, bystander],
        dispatch_mode="sequential",
    )

    # Passive co-present bystander MUST receive disruption signal and pivot objective
    assert any("OBJECTIVE DISRUPTION SIGNAL" in p and "Bystander Nyx" in p for p in seen_prompts)
    nyx_after = updated_turn.character_states[bystander.id].arc_objective
    assert nyx_after is not None
    assert nyx_after.summary == "Evacuate the flooded pier immediately"
    assert updated_turn.post_turn is not None
    assert bystander.id in updated_turn.post_turn.objective_transitions
    assert updated_turn.post_turn.objective_transitions[bystander.id].disruption_triggered is True


def test_resolve_character_previous_state_preserves_arc_objective_across_narrator_turns(
    empty_repo: CantinaRepository,
) -> None:
    """Verify narrator/arrival rewinds carry forward arc_objective safely."""
    scenario = seed_minimal_scenario(empty_repo, character_name="Kira Vance")
    camp = scenario.campaign
    char = scenario.character
    bundle0 = empty_repo.get_campaign_state_bundle(camp.id)
    t0 = bundle0.active_branch_turns[-1]
    obj = CharacterObjective(summary="Cross the Sluice", deadline_cue="at daybreak", set_at_turn_depth=1)

    t1 = empty_repo.save_turn_node(
        turn_id="turn_obj_1",
        campaign_id=camp.id,
        parent_turn_id=t0.id,
        depth_index=1,
        user_message="Let's go.",
        actor_id=char.id,
        raw_prose="Okay.",
        cognition=CognitionBlock(feeling="Alert", valence=0.0, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=t0.world_snapshot.model_copy(update={"turn_id": "turn_obj_1"}),
        character_state=bundle0.character_states[char.id].model_copy(
            update={"turn_id": "turn_obj_1", "arc_objective": obj}
        ),
        recalled_items=[],
    )
    t2_narrator = empty_repo.save_turn_node(
        turn_id="turn_narr_2",
        campaign_id=camp.id,
        parent_turn_id=t1.id,
        depth_index=2,
        user_message="[Narrator] Describe rain falling.",
        actor_id="__narrator__",
        raw_prose="Rain hammers the tin roof.",
        cognition=CognitionBlock(feeling="Detached", valence=0.0, arousal=0.0, skipped=True),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=t0.world_snapshot.model_copy(update={"turn_id": "turn_narr_2"}),
        character_state=CharacterStateSnapshot(
            turn_id="turn_narr_2",
            character_id=char.id,
            current_location_id=scenario.locations[0].id,
            mood_label="Objective / Detached",
            active_want="",
            active_plan="",
            care_state=None,
        ),
        recalled_items=[],
    )

    resolved = resolve_character_previous_state([t0, t1, t2_narrator], char, scenario.locations[0].id)
    assert resolved.arc_objective == obj


def test_commitment_memory_significance_heuristic_and_schema(
    empty_repo: CantinaRepository,
) -> None:
    """Verify 'commitment' significance classification in heuristic extractor and Pydantic schema."""
    scenario = seed_minimal_scenario(empty_repo, character_name="Kira Vance")
    char = scenario.character

    mem = ExtractedCharacterMemory(
        title="Sluice Transit Deal",
        content="Kira agreed to pay 3,000 credits for Sluice transit at daybreak.",
        significance="pledge/deal",
    )
    assert mem.significance == "commitment"

    extracted = _extract_heuristic_character_memories(
        user_message="Kira Vance agreed to meet at daybreak for transit through the Sluice, half paid upfront.",
        raw_prose="Kira nods once to seal the deal.",
        present_characters=[char],
        active_character=char,
    )
    assert len(extracted) == 1
    assert extracted[0].significance == "commitment"


async def test_gm_override_endpoint_zcc_roundtrip_and_gm_talk(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory: Any,
) -> None:
    """Verify GM Mode objective-override endpoint, .zcc character/campaign round-trips, and GM Talk visibility."""
    client, repo, _ = showcase_api_env
    headers, user_id, _ = api_user_factory("arc_gm_tester")

    world, _ = seed_linear_world(repo, owner_id=user_id, world_name="Harbor Test")
    char = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Yulia Tester",
            tagline="Runner",
            core_persona="Focused",
            initial_message="Ready.",
            baseline_psyche=BaselinePsyche(
                mood_label="Alert",
                valence=0.0,
                arousal=0.4,
                core_drive="Survive",
                core_fear="Capture",
                default_want="Negotiate",
                default_plan="Stay sharp",
                default_objective=CharacterObjective(
                    summary="Deliver ledger to Outer Docks",
                    deadline_cue="before dawn",
                ),
            ),
        ),
        world_id=world.id,
        owner_id=user_id,
    )
    camp = seed_campaign(repo, owner_id=user_id, world_id=world.id, character_id=char.id)

    # 1. GM override POST sets custom objective on active leaf without touching Turn 0 root once child exists
    bundle0 = repo.get_campaign_state_bundle(camp.id, owner_id=user_id)
    root_turn = bundle0.active_branch_turns[-1]
    child_turn = repo.save_turn_node(
        turn_id="turn_ov_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Update plans.",
        actor_id=char.id,
        raw_prose="Right.",
        cognition=CognitionBlock(feeling="Alert", valence=0.0, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=root_turn.world_snapshot.model_copy(update={"turn_id": "turn_ov_1"}),
        character_state=bundle0.character_states[char.id].model_copy(update={"turn_id": "turn_ov_1"}),
        recalled_items=[],
    )

    ov_res = client.post(
        f"/api/campaigns/{camp.id}/characters/{char.id}/objective-override",
        headers=headers,
        json={"summary": "Reach Sector 8 via Lock 4", "deadline_cue": "at daybreak", "clear": False},
    )
    assert ov_res.status_code == 200
    ov_bundle = ov_res.json()
    assert ov_bundle["character_states"][char.id]["arc_objective"] == {
        "summary": "Reach Sector 8 via Lock 4",
        "deadline_cue": "at daybreak",
        "set_at_turn_depth": 0,
    }
    # Root turn stays untouched (branch isolation)
    root_reloaded = next(
        t for t in repo.get_campaign_state_bundle(camp.id, owner_id=user_id).all_turn_nodes if t.id == root_turn.id
    )
    assert root_reloaded.character_states[char.id].arc_objective is not None
    assert root_reloaded.character_states[char.id].arc_objective.summary == "Deliver ledger to Outer Docks"

    # 2. GM Talk formatting & get_campaign_entity expose arc_objective
    live_bundle = repo.get_campaign_state_bundle(camp.id, owner_id=user_id)
    vis = _compute_branch_visibility(live_bundle)
    detail_str = _format_character_detail(char, live_bundle.character_states[char.id], vis=vis, detailed=True)
    assert "Arc Objective: Reach Sector 8 via Lock 4 [Deadline/Condition: at daybreak]" in detail_str

    gm_out, _, _ = await execute_gm_tool(
        repo,
        bundle=live_bundle,
        vis=vis,
        base_world_ids=set(),
        call=LlmToolCall(
            id="tc_obj",
            name="get_campaign_entity",
            arguments={"kind": "character", "query": "Yulia Tester"},
        ),
        emitted_proposals=[],
    )
    assert gm_out["arc_objective"]["summary"] == "Reach Sector 8 via Lock 4"

    # 3. Clear objective via override endpoint
    clr_res = client.post(
        f"/api/campaigns/{camp.id}/characters/{char.id}/objective-override",
        headers=headers,
        json={"clear": True},
    )
    assert clr_res.status_code == 200
    assert clr_res.json()["character_states"][char.id]["arc_objective"] is None

    # Re-set before exporting campaign .zcc so active arc_objective is preserved across export/import (stamps active depth=1)
    res_set2 = client.post(
        f"/api/campaigns/{camp.id}/characters/{char.id}/objective-override",
        headers=headers,
        json={"summary": "Exported Sector Goal", "deadline_cue": "midnight", "clear": False},
    )
    assert res_set2.status_code == 200
    assert res_set2.json()["character_states"][char.id]["arc_objective"]["set_at_turn_depth"] == 1

    # 4. .zcc Character & Campaign export/import round-trip (to a second owner)
    char_exp = client.post(f"/api/export/character/{char.id}", headers=headers, json={})
    assert char_exp.status_code == 200
    camp_exp = client.post(f"/api/export/campaign/{camp.id}", headers=headers, json={})
    assert camp_exp.status_code == 200

    headers_u2, user2_id, _ = api_user_factory("arc_importer")

    char_ins = client.post(
        "/api/import/inspect",
        headers=headers_u2,
        files={"file": ("yulia.zcc", char_exp.content, "application/octet-stream")},
    )
    assert char_ins.status_code == 200
    char_com = client.post(
        "/api/import/commit",
        headers=headers_u2,
        json={"staged_token": char_ins.json()["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert char_com.status_code == 200
    imp_char = next(c for c in repo.list_characters(owner_id=user2_id) if "Yulia Tester" in c.name)
    assert imp_char.baseline_psyche.default_objective is not None
    assert imp_char.baseline_psyche.default_objective.summary == "Deliver ledger to Outer Docks"
    assert imp_char.baseline_psyche.default_objective.deadline_cue == "before dawn"

    camp_ins = client.post(
        "/api/import/inspect",
        headers=headers_u2,
        files={"file": ("camp.zcc", camp_exp.content, "application/octet-stream")},
    )
    assert camp_ins.status_code == 200
    camp_com = client.post(
        "/api/import/commit",
        headers=headers_u2,
        json={
            "staged_token": camp_ins.json()["staged_token"],
            "default_conflict_strategy": "copy",
            "import_campaign_assets_as_standalone": False,
        },
    )
    assert camp_com.status_code == 200
    imp_camp = repo.list_campaigns(owner_id=user2_id)[0]
    imp_bundle = repo.get_campaign_state_bundle(imp_camp.id, owner_id=user2_id)
    imp_obj = imp_bundle.character_states[imp_camp.character_id].arc_objective
    assert imp_obj is not None
    assert imp_obj.summary == "Exported Sector Goal"
    assert imp_obj.deadline_cue == "midnight"
    assert child_turn.id == "turn_ov_1"
