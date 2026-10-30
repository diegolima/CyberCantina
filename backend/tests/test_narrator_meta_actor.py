"""Integration tests for the Narrator Meta-Actor in CyberCantina."""

from __future__ import annotations

from pathlib import Path
import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.main import _execute_turn_stream_events
from app.schemas.turn import TurnSubmitRequest


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_cantina_narrator.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


async def test_narrator_describe_scene_execution(temp_repo: CantinaRepository) -> None:
    """Verify that invoking the narrator in 'describe' mode produces an objective scene turn with actor_id='__narrator__'."""
    camp_id = "camp_neon_rust_default"

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


async def test_narrator_advance_story_execution(temp_repo: CantinaRepository) -> None:
    """Verify that invoking the narrator in 'advance' mode advances narrative time and world state."""
    camp_id = "camp_neon_rust_default"

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


async def test_narrator_custom_directive_execution(temp_repo: CantinaRepository) -> None:
    """Verify that a custom director directive instructs the narrator properly."""
    camp_id = "camp_neon_rust_default"

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


async def test_interleaved_npc_and_narrator_turns(temp_repo: CantinaRepository) -> None:
    """Verify that turns can alternate seamlessly between player/NPC and Narrator."""
    camp_id = "camp_neon_rust_default"

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
    bundle = temp_repo.get_campaign_state_bundle(camp_id)
    assert len(bundle.active_branch_turns) == 4  # Root (turn 0) + 3 turns
    assert [t.actor_id for t in bundle.active_branch_turns[-3:]] == [
        t1_turn["actor_id"],
        "__narrator__",
        t3_turn["actor_id"],
    ]


async def test_narrator_complication_mode(temp_repo: CantinaRepository) -> None:
    """Verify that 'complication' mode introduces an external inciting incident without player puppeteering."""
    camp_id = "camp_neon_rust_default"

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


async def test_narrator_perception_mode(temp_repo: CantinaRepository) -> None:
    """Verify that 'perception' mode triggers environmental lore analysis and detached inspection."""
    camp_id = "camp_neon_rust_default"

    events = []
    async for packet in _execute_turn_stream_events(
        campaign_id=camp_id,
        req=TurnSubmitRequest(
            user_message="",
            narrative_mode="perception",
        ),
    ):
        events.append(packet)

    turn_saved_ev = next(e for e in events if e["event"] == "turn_saved")
    saved_turn = turn_saved_ev["data"]

    assert saved_turn["actor_id"] == "__narrator__"
    assert "perception" in saved_turn["user_message"].lower() or "examine" in saved_turn["user_message"].lower()
    assert saved_turn["cognition"]["feeling"] == "Objective / Detached"
    assert len(saved_turn["raw_prose"]) > 10


async def test_narrator_advance_with_explicit_duration(temp_repo: CantinaRepository) -> None:
    """Verify that 'advance' mode with duration_minutes advances the world clock properly."""
    camp_id = "camp_neon_rust_default"

    init_bundle = temp_repo.get_campaign_state_bundle(camp_id)
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


async def test_narrator_swipe_regeneration_preserves_narrator_actor(temp_repo: CantinaRepository) -> None:
    """Verify that swiping / regenerating a narrator turn executes as narrator (not standard character)."""
    camp_id = "camp_neon_rust_default"

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


async def test_narrator_swipe_auto_detection_when_standard_mode_sent(temp_repo: CantinaRepository) -> None:
    """Verify that backend auto-detects bracketed narrator cues during swipe even if narrative_mode='standard'."""
    camp_id = "camp_neon_rust_default"

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
    temp_repo: CantinaRepository,
) -> None:
    """Verify that narrator turns do NOT overwrite NPC emotional state and that following turns anchor to the last non-narrator turn."""
    from app.engine.phase2_context import resolve_character_previous_state

    camp_id = "camp_neon_rust_default"
    bundle_init = temp_repo.get_campaign_state_bundle(camp_id)
    char = temp_repo.get_character(bundle_init.campaign.character_id)

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

    bundle_t1 = temp_repo.get_campaign_state_bundle(camp_id)
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

    bundle_t2 = temp_repo.get_campaign_state_bundle(camp_id)
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

    bundle_t3 = temp_repo.get_campaign_state_bundle(camp_id)
    t3_turn = bundle_t3.active_branch_turns[-1]
    assert t3_turn.actor_id == "__narrator__"
    t3_char_state = t3_turn.character_states[char.id]
    assert t3_char_state.mood_label == t1_char_state.mood_label
    assert t3_char_state.valence == t1_char_state.valence
    assert t3_char_state.arousal == t1_char_state.arousal

    # 4. Verify resolve_character_previous_state walks backwards past consecutive narrator turns to find Turn 1
    resolved_prev = resolve_character_previous_state(
        bundle_t3.active_branch_turns,
        char,
        bundle_t3.active_location.id,
    )
    assert resolved_prev.mood_label == t1_char_state.mood_label
    assert resolved_prev.valence == t1_char_state.valence
    assert resolved_prev.arousal == t1_char_state.arousal

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

    bundle_t4 = temp_repo.get_campaign_state_bundle(camp_id)
    t4_turn = bundle_t4.active_branch_turns[-1]
    assert t4_turn.actor_id == char.id
    assert t4_turn.character_state.mood_label != "Objective / Detached"



