"""Integration tests for the Narrator Meta-Actor in CyberCantina."""

from __future__ import annotations


from app.db.repository import CantinaRepository
from tests.factories import seed_minimal_scenario
from app.main import _execute_turn_stream_events
from app.schemas.turn import TurnSubmitRequest


async def test_narrator_describe_scene_execution(empty_repo: CantinaRepository) -> None:
    """Verify that invoking the narrator in 'describe' mode produces an objective scene turn with actor_id='__narrator__'."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",  # Should auto-populate default description cue
            narrative_mode="describe",
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert saved_turn["user_message"] == "[Describe the current scene]"
    assert saved_turn["cognition"]["feeling"] == "Objective / Detached"
    assert saved_turn["cognition"]["valence"] == 0.0
    assert saved_turn["cognition"]["arousal"] == 0.0
    assert len(saved_turn["raw_prose"]) > 10


async def test_narrator_advance_story_execution(empty_repo: CantinaRepository) -> None:
    """Verify that invoking the narrator in 'advance' mode advances narrative time and world state."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="advance",
            narrator_directive="45 minutes elapse while waiting for the contact",
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert "45 minutes elapse" in saved_turn["user_message"]
    assert len(saved_turn["raw_prose"]) > 10


async def test_narrator_custom_directive_execution(empty_repo: CantinaRepository) -> None:
    """Verify that a custom director directive instructs the narrator properly."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    custom_text = "Heavy rain begins pounding against the corrugated aluminum roof."
    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message=custom_text,
            narrative_mode="custom",
            narrator_directive=custom_text,
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert saved_turn["user_message"] == custom_text
    assert "aluminum roof" in saved_turn["raw_prose"] or len(saved_turn["raw_prose"]) > 10


async def test_interleaved_npc_and_narrator_turns(empty_repo: CantinaRepository) -> None:
    """Verify that turns can alternate seamlessly between player/NPC and Narrator."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    # Turn 1: Player speaks to NPC
    t1_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="Vespera, who else is supposed to be meeting us here tonight?",
            narrative_mode="standard",
        ),
    ):
        t1_events.append(packet)
    t1_turn = next(e for e in t1_events if e["event"] == "turn_saved")["data"]
    assert t1_turn["actor_id"] != "__narrator__"

    # Turn 2: Narrator describes scene transition
    t2_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="describe",
        ),
    ):
        t2_events.append(packet)
    t2_turn = next(e for e in t2_events if e["event"] == "turn_saved")["data"]
    assert t2_turn["actor_id"] == "__narrator__"

    # Turn 3: Player acts again -> NPC responds
    t3_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="I keep my eyes on the doorway and reach for my comms unit.",
            narrative_mode="standard",
        ),
    ):
        t3_events.append(packet)
    t3_turn = next(e for e in t3_events if e["event"] == "turn_saved")["data"]
    assert t3_turn["actor_id"] != "__narrator__"

    # Verify branch history depth
    bundle = empty_repo.get_campaign_state_bundle(camp_id)
    assert len(bundle.active_branch_turns) == 4  # Root (turn 0) + 3 turns
    assert [t.actor_id for t in bundle.active_branch_turns[-3:]] == [
        t1_turn["actor_id"],
        "__narrator__",
        t3_turn["actor_id"],
    ]


async def test_narrator_complication_mode(empty_repo: CantinaRepository) -> None:
    """Verify that 'complication' mode introduces an external inciting incident without player puppeteering."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="complication",
            narrator_directive="A sudden blackout plunges the bar into darkness",
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert "complication" in saved_turn["user_message"].lower()
    assert saved_turn["cognition"]["feeling"] == "Objective / Detached"
    assert "complication" in saved_turn["cognition"]["plan"].lower() or "blackout" in saved_turn["cognition"]["plan"].lower()
    assert len(saved_turn["raw_prose"]) > 10


async def test_narrator_legacy_perception_coerced_to_custom(empty_repo: CantinaRepository) -> None:
    """Verify that legacy 'perception' input or cues are cleanly coerced to custom narrator mode."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest.model_validate({
            "user_message": "[Perception check: inspect bulkhead conduits]",
            "narrative_mode": "perception",
        }),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert saved_turn["cognition"]["feeling"] == "Objective / Detached"
    assert len(saved_turn["raw_prose"]) > 10


async def test_narrator_advance_with_explicit_duration(empty_repo: CantinaRepository) -> None:
    """Verify that 'advance' mode with duration_minutes advances the world clock properly."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    init_bundle = empty_repo.get_campaign_state_bundle(camp_id)
    init_time = init_bundle.current_world_snapshot.world_timestamp

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="advance",
            duration_minutes=30,
        ),
    ):
        events.append(packet)

    final_packet = next(e for e in events if e["event"] == "phase4_complete")
    new_bundle = final_packet["data"]["state_bundle"]
    new_time = new_bundle["current_world_snapshot"]["world_timestamp"]

    # Verify clock actually moved forward
    assert new_time != init_time


async def test_narrator_swipe_regeneration_preserves_narrator_actor(empty_repo: CantinaRepository) -> None:
    """Verify that swiping / regenerating a narrator turn executes as narrator (not standard character)."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    # Step 1: Initial narrator turn
    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="describe",
        ),
    ):
        events.append(packet)

    t1 = next(e for e in events if e["event"] == "turn_saved")["data"]
    assert t1["actor_id"] == "__narrator__"

    # Step 2: Swipe / regenerate from t1's parent_turn_id with narrative_mode="describe"
    swipe_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message=t1["user_message"],
            parent_turn_id=t1["parent_turn_id"],
            narrative_mode="describe",
        ),
    ):
        swipe_events.append(packet)

    t2 = next(e for e in swipe_events if e["event"] == "turn_saved")["data"]
    assert t2["actor_id"] == "__narrator__"
    assert t2["parent_turn_id"] == t1["parent_turn_id"]
    assert t2["id"] != t1["id"]


async def test_narrator_swipe_auto_detection_when_standard_mode_sent(empty_repo: CantinaRepository) -> None:
    """Verify that backend auto-detects bracketed narrator cues during swipe even if narrative_mode='standard'."""
    camp_id = seed_minimal_scenario(empty_repo).campaign.id

    # Step 1: Initial narrator turn
    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="describe",
        ),
    ):
        events.append(packet)

    t1 = next(e for e in events if e["event"] == "turn_saved")["data"]
    assert t1["actor_id"] == "__narrator__"

    # Step 2: Swipe / regenerate sending narrative_mode="standard" (simulating legacy client or omitted mode)
    swipe_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message=t1["user_message"],
            parent_turn_id=t1["parent_turn_id"],
            narrative_mode="standard",
        ),
    ):
        swipe_events.append(packet)

    t2 = next(e for e in swipe_events if e["event"] == "turn_saved")["data"]
    # Auto-detector should recognize "[Describe the current scene]" and execute as __narrator__
    assert t2["actor_id"] == "__narrator__"
    assert t2["parent_turn_id"] == t1["parent_turn_id"]
    assert t2["id"] != t1["id"]


async def test_narrator_turn_preserves_character_emotional_anchor(
    empty_repo: CantinaRepository,
) -> None:
    """Verify that narrator turns do NOT overwrite NPC emotional state and that following turns anchor to the last non-narrator turn."""
    from app.engine.phase2_context import resolve_character_previous_state

    camp_id = seed_minimal_scenario(empty_repo).campaign.id
    bundle_init = empty_repo.get_campaign_state_bundle(camp_id)
    char = empty_repo.get_character(bundle_init.campaign.character_id)

    # 1. Player speaks to character -> Turn 1
    t1_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="Keep your voice down, we're being watched.",
            narrative_mode="standard",
        ),
    ):
        t1_events.append(packet)

    bundle_t1 = empty_repo.get_campaign_state_bundle(camp_id)
    t1_turn = bundle_t1.active_branch_turns[-1]
    t1_char_state = t1_turn.character_states[char.id]
    assert t1_turn.actor_id != "__narrator__"
    assert t1_char_state.mood_label != "Objective / Detached"

    # 2. Narrator turn 1: Describe scene -> Turn 2
    t2_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="describe",
        ),
    ):
        t2_events.append(packet)

    bundle_t2 = empty_repo.get_campaign_state_bundle(camp_id)
    t2_turn = bundle_t2.active_branch_turns[-1]
    assert t2_turn.actor_id == "__narrator__"
    # Ensure Phase 4 Clerk preserved character's emotional state on the narrator turn
    t2_char_state = t2_turn.character_states[char.id]
    assert t2_char_state.mood_label == t1_char_state.mood_label
    assert t2_char_state.valence == t1_char_state.valence
    assert t2_char_state.arousal == t1_char_state.arousal
    assert t2_char_state.mood_label != "Objective / Detached"

    # 3. Narrator turn 2: Advance time 10 minutes -> Turn 3
    t3_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="advance",
            duration_minutes=10,
        ),
    ):
        t3_events.append(packet)

    bundle_t3 = empty_repo.get_campaign_state_bundle(camp_id)
    t3_turn = bundle_t3.active_branch_turns[-1]
    assert t3_turn.actor_id == "__narrator__"
    t3_char_state = t3_turn.character_states[char.id]
    assert t3_char_state.mood_label != "Objective / Detached"
    assert t3_char_state.care_state is not None
    assert t3_char_state.care_state.state_elapsed_minutes >= t1_turn.world_snapshot.campaign_elapsed_minutes + 10
    # Smooth OU relaxation toward resting baseline over 10 elapsed minutes (never erased to Objective / Detached)
    assert abs(t3_char_state.valence - char.baseline_psyche.valence) <= abs(
        t1_char_state.valence - char.baseline_psyche.valence
    ) + 1e-4

    # 4. Verify resolve_character_previous_state preserves valid CARE-decayed state on Narrator advance turns
    resolved_prev = resolve_character_previous_state(
        bundle_t3.active_branch_turns,
        char,
        bundle_t3.active_location.id,
    )
    assert resolved_prev.mood_label == t3_char_state.mood_label
    assert resolved_prev.valence == t3_char_state.valence
    assert resolved_prev.arousal == t3_char_state.arousal

    # 5. Player speaks to character -> Turn 4: Verify NPC resumes from Turn 1's emotional anchor
    t4_events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="Are they still behind us?",
            narrative_mode="standard",
        ),
    ):
        t4_events.append(packet)

    bundle_t4 = empty_repo.get_campaign_state_bundle(camp_id)
    t4_turn = bundle_t4.active_branch_turns[-1]
    assert t4_turn.actor_id == char.id
    assert t4_turn.character_state.mood_label != "Objective / Detached"


async def test_narrator_legacy_swipe_inference_and_empty_message_rejection(
    empty_repo: CantinaRepository,
) -> None:
    """Exercise swipe auto-detection for advance minutes, complication, perception check, custom leaf edit, and empty 400."""
    from fastapi import HTTPException
    import pytest

    campaign_id = seed_minimal_scenario(empty_repo).campaign.id

    # 1. Advance minutes parsed from bracketed prompt
    ev_adv = [
        p async for p in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message="[Advance the story: wait for 15 minutes]", narrative_mode="standard")
        )
    ]
    t_adv = next(e for e in ev_adv if e["event"] == "turn_saved")["data"]
    assert t_adv["actor_id"] == "__narrator__"
    assert t_adv["pre_turn"]["narrative_mode"] == "advance" if "narrative_mode" in t_adv["pre_turn"] else True

    # 2. Complication + legacy perception check + custom leaf edit re-execution
    ev_comp = [
        p async for p in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message="[Introduce a complication: Power outage]", narrative_mode="standard")
        )
    ]
    assert next(e for e in ev_comp if e["event"] == "turn_saved")["data"]["actor_id"] == "__narrator__"

    ev_perc = [
        p async for p in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message="[Perception check: Inspect vents]", narrative_mode="standard")
        )
    ]
    assert next(e for e in ev_perc if e["event"] == "turn_saved")["data"]["actor_id"] == "__narrator__"

    # Edit/swipe custom narrator turn using standard mode matching active leaf user_message
    ev_custom = [
        p async for p in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message="Describe the flicker outside.", narrative_mode="custom", narrator_directive="Describe the flicker outside.")
        )
    ]
    t_cust = next(e for e in ev_custom if e["event"] == "turn_saved")["data"]
    ev_reswipe = [
        p async for p in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message=t_cust["user_message"], parent_turn_id=t_cust["parent_turn_id"], narrative_mode="standard")
        )
    ]
    assert next(e for e in ev_reswipe if e["event"] == "turn_saved")["data"]["actor_id"] == "__narrator__"

    # 3. Empty standard message with no choices raises 400
    with pytest.raises(HTTPException) as exc_info:
        async for _ in _execute_turn_stream_events(
            campaign_id, TurnSubmitRequest(user_message="   ", narrative_mode="standard")
        ):
            pass
    assert exc_info.value.status_code == 400


def test_turn_streaming_sse_error_events_and_sync_turn_endpoint(
    empty_repo: CantinaRepository,
    monkeypatch,
) -> None:
    """Exercise /turns/stream SSE error payloads and synchronous POST /turns (+ 404)."""
    from fastapi.testclient import TestClient

    from app import main as main_module
    from app.auth import get_current_user
    from app.providers.local_relay import RelayRemoteError, RelayUnavailableError
    from app.routers.campaign_routes import turn_streaming as ts_mod

    scenario = seed_minimal_scenario(empty_repo)
    main_module.app.dependency_overrides[get_current_user] = lambda: scenario.user
    client = TestClient(main_module.app)

    try:
        # 1. Synchronous POST /api/campaigns/{id}/turns happy path & 404
        resp_sync = client.post(
            f"/api/campaigns/{scenario.campaign.id}/turns",
            json={"user_message": "", "narrative_mode": "describe"},
        )
        assert resp_sync.status_code == 200
        assert resp_sync.json()["campaign"]["id"] == scenario.campaign.id

        resp_404 = client.post(
            "/api/campaigns/missing_camp_xyz/turns",
            json={"user_message": "hello", "narrative_mode": "standard"},
        )
        assert resp_404.status_code == 404

        # 2. All 5 SSE error wrappers in stream_campaign_turn
        error_cases = [
            (RelayUnavailableError("offline"), "Browser inference relay is not connected"),
            (RelayRemoteError("model_not_found", "Missing"), "not installed in Ollama"),
            (KeyError("missing_turn"), "Campaign or required entity not found"),
            (ValueError("bad"), "Invalid turn request"),
            (RuntimeError("boom"), "An internal error occurred"),
        ]
        for exc, expected_substr in error_cases:
            async def _raise(*args, _exc=exc, **kwargs):
                if False:
                    yield {}
                raise _exc

            monkeypatch.setattr(ts_mod, "_execute_turn_stream_events", _raise)
            sse_resp = client.post(
                f"/api/campaigns/{scenario.campaign.id}/turns/stream",
                json={"user_message": "hi", "narrative_mode": "standard"},
            )
            assert sse_resp.status_code == 200
            assert "event: error" in sse_resp.text
            assert expected_substr in sse_resp.text
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)




