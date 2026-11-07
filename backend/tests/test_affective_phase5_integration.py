"""Milestone 4 Integration Tests: Phase 5 CARE Solver, GBNF Retry Fix, Epistemic Ceiling, & Fast-Path."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any

import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.affective_engine import (
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
)
from app.engine.character_agent import run_character_post_turn_agent
from app.engine.llm_client import _inline_json_schema_defs, llm_client
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.engine.world_clock import (
    resolve_bounded_turn_elapsed_minutes,
    resolve_turn_timestamp,
)
from app.routers.campaigns import _execute_turn_stream_events
from app.schemas.affective import RelationalEdge, RelationalEventSpec
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterWizardDraft,
    CognitionBlock,
)
from app.schemas.persona import PersonaRecord
from app.schemas.turn import (
    CharacterAgentDelta,
    DisputedItemDecision,
    InventoryArbitrationResult,
    PostTurnStateDelta,
    PreTurnAnalysis,
    TurnSubmitRequest,
    WorldPostTurnDelta,
)

_FLOAT_RE = re.compile(r"(?<![a-zA-Z0-9_])[+-]?\d+\.\d+")


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_care_phase5.db")
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


def _create_bouncer_and_medic(
    repo: CantinaRepository, world_id: str = "world_neon_rust"
) -> tuple[CharacterRecord, CharacterRecord]:
    viktor = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Viktor Kroll",
            tagline="Stoic cantina bouncer loyal to Kira.",
            physical_appearance="Broad-shouldered cyborg with steel jawplates.",
            core_persona="Clipped, protective orbital marine veteran.",
            equipped=["Heavy Stun Baton"],
            inventory=["Synth-Rye Flask"],
            baseline_psyche=BaselinePsyche(
                mood_label="Stoic, watchful calm",
                valence=0.05,
                arousal=0.30,
                default_want="Keep trouble away from the bar.",
                default_plan="Watch the doorway.",
                core_drive="Protect allies.",
                core_fear="Losing his crew.",
            ),
        ),
        world_id=world_id,
    )
    nyx = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Nyx Holloway",
            tagline="Backroom ripperdoc.",
            physical_appearance="Pale surgical tech with optic loupes.",
            core_persona="Dry-humored underground surgeon.",
            equipped=["Optic Loupes"],
            inventory=["Laser Scalpel"],
            baseline_psyche=BaselinePsyche(
                mood_label="Detached clinical focus",
                valence=-0.05,
                arousal=0.38,
                default_want="Finish calibrating the neural splicer.",
                default_plan="Stay in the surgical bay.",
                core_drive="Keep off-grid patients alive.",
                core_fear="Vespera raids.",
            ),
        ),
        world_id=world_id,
    )
    return viktor, nyx


@pytest.mark.asyncio
async def test_gbnf_inlined_schema_and_structured_retry_never_serializes_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify $defs/$ref are inlined for GBNF and complete_structured retry passes effective_schema (never 'null')."""
    inlined = _inline_json_schema_defs(CharacterAgentDelta.model_json_schema())
    dumped = str(inlined)
    assert "$defs" not in inlined
    assert "$ref" not in dumped

    captured_calls: list[tuple[list[dict[str, str]], dict[str, Any] | None]] = []

    async def fake_complete_text(
        messages: list[dict[str, str]],
        *,
        profile: Any = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
        json_mode: bool = False,
        json_schema: dict[str, Any] | None = None,
        disable_reasoning: bool = False,
    ) -> str:
        captured_calls.append((messages, json_schema))
        if len(captured_calls) == 1:
            raise RuntimeError("Simulated GBNF compilation rejection on first attempt")
        return '{"mood_label": "Calm tactical focus", "affect_tone": "content", "affect_intensity": "low"}'

    monkeypatch.setattr(llm_client, "complete_text", fake_complete_text)

    res = await llm_client.complete_structured(
        [{"role": "user", "content": "Evaluate state"}],
        CharacterAgentDelta,
    )
    assert res.mood_label == "Calm tactical focus"
    assert res.affect_tone == "content"
    assert len(captured_calls) == 2

    # First call received inlined schema without $defs
    first_schema = captured_calls[0][1]
    assert first_schema is not None
    assert "$defs" not in first_schema

    # Second (retry) call injected effective_schema into system hint (NOT literal 'null')
    retry_hint = captured_calls[1][0][-1]["content"]
    assert not retry_hint.endswith(":\nnull")
    assert '"mood_label"' in retry_hint
    assert '"relational_events"' in retry_hint


@pytest.mark.asyncio
async def test_phase5_character_agent_prompt_zero_floats_and_whisper_scoping(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Phase 5 Character Agent prompt contains zero raw floats and strips other NPCs' whispers."""
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_bouncer_and_medic(temp_repo)
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    root_turn = bundle.active_branch_turns[-1]

    completed = root_turn.model_copy(
        update={
            "actor_id": kira.id,
            "user_message": (
                "We should keep our voices low.\n"
                '@Kira Vance: You spot a Syndicate tail outside.\n'
                '@Viktor Kroll: You hear a faint click near the back fusebox.'
            ),
            "raw_prose": '*Kira lowers her voice behind the counter.* "Nobody moves."',
            "cognition": CognitionBlock(
                recall="- Syndicate watchers.",
                feeling="Guarded and alert",
                feeling_tone="guarded",
                feeling_intensity="high",
                feeling_agency="steady",
                scene_threat="moderate",
                scene_coping="adequate",
                want="Spot the tail.",
                plan="- Check the street reflection.",
            ),
        }
    )

    captured_messages: list[dict[str, str]] = []

    async def capture_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        captured_messages.extend(messages)
        return CharacterAgentDelta(
            mood_label="Guarded alert focus",
            affect_tone="guarded",
            affect_intensity="high",
        )

    monkeypatch.setattr(llm_client, "complete_structured", capture_llm)

    await run_character_post_turn_agent(
        character=kira,
        prev_state=bundle.character_states[kira.id],
        completed_turn=completed,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
        active_shards=kira.memory_shards,
        persona_name="Vex Mercer",
    )

    assert len(captured_messages) == 2
    sys_prompt = captured_messages[0]["content"]
    usr_prompt = captured_messages[1]["content"]

    assert _FLOAT_RE.findall(sys_prompt) == []
    assert _FLOAT_RE.findall(usr_prompt) == []
    assert "<internal_affective_state" in usr_prompt
    assert "Syndicate tail" in usr_prompt
    # Viktor's private sensory whisper MUST NOT leak into Kira's Phase 5 prompt
    assert "fusebox" not in usr_prompt
    assert "@Viktor Kroll" not in usr_prompt


@pytest.mark.asyncio
async def test_gottman_negative_sentiment_override_across_live_turns(
    temp_repo: CantinaRepository,
) -> None:
    """Verify betrayal triggers Negative Sentiment Override: cheap flattery fails, costly restitution succeeds."""
    camp_id = "camp_neon_rust_default"
    char = temp_repo.get_character("char_kira_vance")

    # Turn 1: Severe betrayal
    async for _ in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="I betrayed you and sold your courier route out to Vespera Security, Kira.",
        ),
    ):
        pass

    b1 = temp_repo.get_campaign_state_bundle(camp_id)
    care1 = b1.character_states[char.id].care_state
    assert care1 is not None
    assert care1.is_provisional is False
    edge1 = care1.relations["user"]
    assert edge1.trust < -0.18
    assert edge1.warmth < -0.18
    assert edge1.grievance >= 0.28

    # Turn 2: Cheap superficial flattery should be absorbed by Negative Sentiment Override (zero warmth/trust gain)
    async for _ in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="Hey Kira, nice jacket—you look charming tonight, sweet talk aside.",
        ),
    ):
        pass

    b2 = temp_repo.get_campaign_state_bundle(camp_id)
    care2 = b2.character_states[char.id].care_state
    assert care2 is not None
    edge2 = care2.relations["user"]
    assert edge2.warmth <= edge1.warmth + 1e-4
    assert edge2.trust <= edge1.trust + 1e-4
    assert edge2.grievance >= edge1.grievance - 0.05

    # Turn 3: Costly restitution / saving her life pierces Negative Sentiment Override & eases grievance
    async for _ in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message=(
                "I risked my life to make restitution, returned the stolen cipher, and shielded you from Vespera fire."
            ),
        ),
    ):
        pass

    b3 = temp_repo.get_campaign_state_bundle(camp_id)
    care3 = b3.character_states[char.id].care_state
    assert care3 is not None
    edge3 = care3.relations["user"]
    assert edge3.trust > edge2.trust + 0.05
    assert edge3.warmth > edge2.warmth + 0.05
    assert edge3.grievance < edge2.grievance
    assert edge3.obligation > 0.05


@pytest.mark.asyncio
async def test_epistemic_visibility_ceiling_passive_fast_path_and_remote_whispers(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify public_room witness coupling vs local_whisper/remote_comm isolation and passive bystander fast-path."""
    kira = temp_repo.get_character("char_kira_vance")
    viktor, nyx = _create_bouncer_and_medic(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)
    ripper_bay = next(loc for loc in world.locations if loc.id != main_bar.id)

    camp = temp_repo.create_campaign(
        name="Epistemic Ceiling Test",
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

    # Seed Viktor with strong ally warmth (+0.80) toward Kira so public attacks on Kira shift Viktor's view of 'user'
    viktor_care0 = ensure_snapshot_care_state(bundle0.character_states[viktor.id], viktor.baseline_psyche)
    ally_rels = dict(viktor_care0.relations)
    ally_rels[kira.id] = RelationalEdge(
        target_id=kira.id,
        warmth=0.80,
        trust=0.75,
        respect=0.70,
        consolidated_warmth=0.80,
        consolidated_trust=0.75,
        episodic_note="Loyal to Kira.",
    )
    viktor_seeded = materialize_snapshot_with_care(
        bundle0.character_states[viktor.id],
        viktor_care0.model_copy(update={"relations": ally_rels}),
    )
    temp_repo.update_turn_post_clerk(
        turn_id=root_turn.id,
        post_turn=PostTurnStateDelta(elapsed_minutes=0, transition_type="stay"),
        updated_world_snapshot=root_turn.world_snapshot,
        updated_character_state=bundle0.character_states[kira.id],
        extra_character_states=[viktor_seeded, bundle0.character_states[nyx.id]],
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    viktor_user_w0 = bundle0.character_states[viktor.id].care_state.relations["user"].warmth  # type: ignore[union-attr]

    # Case 1: Pure LOCAL whisper to Kira + unmentioned passive bystander Viktor
    # Viktor MUST be fast-pathed (0 CharacterAgentDelta LLM calls for Viktor) AND receive 0 witness coupling!
    llm_char_calls: list[str] = []

    async def spy_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=2, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            llm_char_calls.append(prompt)
            return CharacterAgentDelta(
                mood_label="Cold silent shock",
                affect_tone="hostile",
                affect_intensity="high",
                relational_events=[
                    RelationalEventSpec(
                        target="user",
                        warmth_shift="strong_neg",
                        trust_shift="strong_neg",
                        grievance_shift="grave_wrong",
                        note="Whispered confession of betrayal.",
                    )
                ],
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", spy_llm)

    turn_whisper = temp_repo.save_turn_node(
        turn_id="turn_vis_whisper",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message='@Kira Vance: "I lied to you and betrayed your route."',
        actor_id=kira.id,
        raw_prose='*Kira keeps her face unreadable as she wipes the zinc counter.*',
        cognition=CognitionBlock(feeling="Cold shock", feeling_tone="hostile", feeling_intensity="high"),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle0.current_world_snapshot.model_copy(update={"turn_id": "turn_vis_whisper"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_vis_whisper"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_vis_whisper"}),
            bundle0.character_states[nyx.id].model_copy(update={"turn_id": "turn_vis_whisper"}),
        ],
        recalled_items=[],
    )
    await run_phase5_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn_whisper,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor, nyx],
    )
    # Passive bystander Viktor was completely unmentioned -> 0 LLM calls for Viktor!
    assert len(llm_char_calls) == 1
    assert f"id='{kira.id}'" in llm_char_calls[0]

    b_whisper = temp_repo.get_campaign_state_bundle(camp.id)
    assert b_whisper.character_states[kira.id].care_state.relations["user"].trust < -0.18  # type: ignore[union-attr]
    # Because interaction was local_whisper, co-present ally Viktor did NOT overhear!
    assert b_whisper.character_states[viktor.id].care_state.relations["user"].warmth == viktor_user_w0  # type: ignore[union-attr]

    # Case 2: Public betrayal in main_bar + REMOTE comm whisper to off-screen Nyx (branching from root_turn)
    llm_char_calls.clear()
    turn_pub_and_remote = temp_repo.save_turn_node(
        turn_id="turn_vis_pub_rem",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message=(
            "I betrayed your courier route to Vespera Security, Kira!\n"
            '@Nyx Holloway: "I saved your life by wiping the Vespera raid manifest—make restitution with me."'
        ),
        actor_id=kira.id,
        raw_prose='*Kira slams her palm on the bar.* "You sold us out?!"',
        cognition=CognitionBlock(feeling="Betrayed fury", feeling_tone="hostile", feeling_intensity="high"),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle0.current_world_snapshot.model_copy(update={"turn_id": "turn_vis_pub_rem"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_vis_pub_rem"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_vis_pub_rem"}),
            bundle0.character_states[nyx.id].model_copy(update={"turn_id": "turn_vis_pub_rem"}),
        ],
        recalled_items=[],
    )
    await run_phase5_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn_pub_and_remote,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor, nyx],
    )
    b_pub = temp_repo.get_campaign_state_bundle(camp.id)
    # Public attack on Kira caused silent witness Viktor's warmth toward 'user' to drop via witness coupling!
    assert b_pub.character_states[viktor.id].care_state.relations["user"].warmth < viktor_user_w0 - 0.05  # type: ignore[union-attr]
    # Off-screen Nyx received the REMOTE comm whisper -> Nyx's trust/warmth toward 'user' rose while staying in ripper_bay!
    nyx_after = b_pub.character_states[nyx.id]
    assert nyx_after.current_location_id == ripper_bay.id
    assert nyx_after.care_state is not None
    assert nyx_after.care_state.relations["user"].trust > 0.08


@pytest.mark.asyncio
async def test_unrelinquished_seizure_grievance_and_persona_name_canonicalization(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify unrelinquished item seizure auto-injects victim grievance/distrust and persona_name maps to 'user'."""
    kira = temp_repo.get_character("char_kira_vance")
    viktor, _ = _create_bouncer_and_medic(temp_repo)
    world = temp_repo.get_world("world_neon_rust")
    main_bar = next(loc for loc in world.locations if loc.is_starting_location)

    persona = PersonaRecord(
        id="pers_vex",
        owner_id="system",
        name="Vex Mercer",
        summary="Freelance courier",
        appearance="Rain-slick coat",
        created_at="2026-11-07T00:00:00Z",
        updated_at="2026-11-07T00:00:00Z",
    )
    camp = temp_repo.create_campaign(
        name="Seizure & Persona Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: main_bar.id, viktor.id: main_bar.id},
    )
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)
    root_turn = bundle0.active_branch_turns[-1]

    async def mock_seizure_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=2, transition_type="stay")
        if response_model is CharacterAgentDelta:
            prompt = messages[-1]["content"]
            if f"id='{kira.id}'" in prompt:
                # Kira claims Viktor's Heavy Stun Baton AND addresses player by Persona name 'Vex Mercer'
                return CharacterAgentDelta(
                    mood_label="Commanding urgency",
                    affect_tone="guarded",
                    affect_intensity="high",
                    items_equipped=["Heavy Stun Baton"],
                    relational_events=[
                        RelationalEventSpec(
                            target="Vex Mercer",
                            warmth_shift="strong_pos",
                            trust_shift="strong_pos",
                            note="Backed Vex's warning.",
                        )
                    ],
                    stance_updates={"Vex": "Backed Vex's warning."},
                )
            # Viktor did NOT relinquish Heavy Stun Baton and emitted empty relational_events
            return CharacterAgentDelta(
                mood_label="Startled resentment",
                affect_tone="bitter",
                affect_intensity="high",
            )
        if response_model is InventoryArbitrationResult:
            return InventoryArbitrationResult(
                decisions=[
                    DisputedItemDecision(
                        item_name="Heavy Stun Baton",
                        winner_id=kira.id,
                        rationale="Kira snatched the baton out of Viktor's belt.",
                    )
                ]
            )
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_seizure_llm)

    turn1 = temp_repo.save_turn_node(
        turn_id="turn_seize_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="Kira, grab Viktor's baton!",
        actor_id=kira.id,
        raw_prose="*Kira snatches the Heavy Stun Baton straight off Viktor's belt.*",
        cognition=CognitionBlock(feeling="Urgent", feeling_tone="guarded", feeling_intensity="high"),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=bundle0.current_world_snapshot.model_copy(update={"turn_id": "turn_seize_1"}),
        character_state=bundle0.character_states[kira.id].model_copy(update={"turn_id": "turn_seize_1"}),
        extra_character_states=[
            bundle0.character_states[viktor.id].model_copy(update={"turn_id": "turn_seize_1"})
        ],
        recalled_items=[],
    )

    await run_phase5_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=turn1,
        active_location=main_bar,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
        persona_snapshot=persona,
    )

    bundle1 = temp_repo.get_campaign_state_bundle(camp.id)
    kira_care = bundle1.character_states[kira.id].care_state
    viktor_care = bundle1.character_states[viktor.id].care_state
    assert kira_care is not None and viktor_care is not None

    # 1. Persona name 'Vex Mercer' / 'Vex' canonicalized cleanly to 'user' (zero duplicate player keys)
    kira_trust0 = bundle0.character_states[kira.id].care_state.relations["user"].trust  # type: ignore[union-attr]
    assert "Vex Mercer" not in kira_care.relations
    assert "Vex" not in kira_care.relations
    assert kira_care.relations["user"].trust > kira_trust0 + 0.04
    assert "Vex" not in bundle1.character_states[kira.id].relationship_notes

    # 2. Mechanical unrelinquished_transfer automatically generated grievance & trust drop in victim Viktor toward Kira
    assert kira.id in viktor_care.relations
    assert viktor_care.relations[kira.id].grievance >= 0.30
    assert viktor_care.relations[kira.id].trust < -0.15


@pytest.mark.asyncio
async def test_clock_typo_rejection_and_narrator_sleep_composure_recovery(
    temp_repo: CantinaRepository,
) -> None:
    """Verify multi-year Clerk timestamp typos are rejected and an 8-hour Narrator advance recovers composure & decays arousal."""
    now = "2094-11-14 23:15"
    # Hallucinated 5-year jump '2099-11-14 23:18' is rejected -> falls back to 3 elapsed minutes
    resolved_ts = resolve_turn_timestamp(now, 3, "2099-11-14 23:18")
    assert resolved_ts == "2094-11-14 23:18"
    dt = resolve_bounded_turn_elapsed_minutes(
        prev_timestamp=now,
        new_timestamp="2099-11-14 23:18",
        clerk_elapsed_minutes=3,
        raw_turn_text="I order a synth-ale.",
    )
    assert dt == 3

    # Live campaign: trigger high-threat / drained-composure turn, then sleep 480 minutes via Narrator advance
    camp_id = "camp_neon_rust_default"
    char_before_play = temp_repo.get_character("char_kira_vance")
    psyche_seed_before = char_before_play.baseline_psyche.model_dump()

    async for _ in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="I try to repair the jammed blast-shutter lock while a Syndicate hit-squad shoots through the window!",
            dice_mode="forced",
            manual_dice_override=1,
        ),
    ):
        pass

    b_crisis = temp_repo.get_campaign_state_bundle(camp_id)
    care_crisis = b_crisis.character_states[char_before_play.id].care_state
    assert care_crisis is not None
    assert care_crisis.arousal > 0.50
    assert care_crisis.composure < 0.82

    # Advance 480 minutes (8 hours rest) via Narrator
    async for _ in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="advance",
            duration_minutes=480,
        ),
    ):
        pass

    b_rested = temp_repo.get_campaign_state_bundle(camp_id)
    care_rested = b_rested.character_states[char_before_play.id].care_state
    assert care_rested is not None
    assert b_rested.current_world_snapshot.campaign_elapsed_minutes >= 480
    assert care_rested.state_elapsed_minutes == b_rested.current_world_snapshot.campaign_elapsed_minutes
    # Composure recovered and acute arousal relaxed back toward resting baseline
    assert care_rested.composure > 0.88
    assert abs(care_rested.arousal - char_before_play.baseline_psyche.arousal) < 0.05

    # Immutable CharacterRecord seed in SQLite was NEVER mutated during campaign play
    char_after_play = temp_repo.get_character("char_kira_vance")
    assert char_after_play.baseline_psyche.model_dump() == psyche_seed_before
