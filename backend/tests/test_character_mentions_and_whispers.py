"""Unit and Integration Tests for Targeted Character Mentions and Whispers."""

import pytest
from app.engine.mentions import (
    MentionTargetScope,
    decompose_user_message,
    filter_user_message_for_character,
    normalize_quotes,
    parse_whisper_content,
    sanitize_history_for_episodic_summary,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
)


@pytest.fixture
def sample_roster() -> list[CharacterRecord]:
    elena = CharacterRecord(
        id="char_elena",
        world_id="world_1",
        name="Elena Vance",
        tagline="Infiltrator",
        core_persona="Sharp and cautious",
        physical_appearance="Athletic build, dark coat",
        baseline_psyche=BaselinePsyche(
            core_drive="Survival",
            core_fear="Capture",
            default_want="Stay alert",
            default_plan="Observe surroundings",
        ),
        created_at="2026-11-05T00:00:00Z",
    )
    jax = CharacterRecord(
        id="char_jax",
        world_id="world_1",
        name="Jax",
        tagline="Tech specialist",
        core_persona="Curious and tech-savvy",
        physical_appearance="Cybernetic ocular implant",
        baseline_psyche=BaselinePsyche(
            core_drive="Discovery",
            core_fear="Ignorance",
            default_want="Scan the room",
            default_plan="Check sensors",
        ),
        created_at="2026-11-05T00:00:00Z",
    )
    markus = CharacterRecord(
        id="char_markus",
        world_id="world_1",
        name="Markus Stone",
        tagline="Heavy weapons handler",
        core_persona="Steadfast and rugged",
        physical_appearance="Armored vest",
        baseline_psyche=BaselinePsyche(
            core_drive="Protection",
            core_fear="Failing the squad",
            default_want="Hold defensive perimeter",
            default_plan="Cover the doorway",
        ),
        created_at="2026-11-05T00:00:00Z",
    )
    return [elena, jax, markus]


def test_normalize_quotes():
    raw = '“Hello,” he said. ‘Wait,’ she replied. «Yes» and „No‟.'
    normalized = normalize_quotes(raw)
    assert normalized == '"Hello," he said. \'Wait,\' she replied. "Yes" and "No".'


def test_parse_whisper_content_pure_speech():
    speeches, sensory = parse_whisper_content('"Look out!"')
    assert speeches == ["Look out!"]
    assert sensory == []


def test_parse_whisper_content_pure_sensory():
    speeches, sensory = parse_whisper_content("You see a shadow to your left")
    assert speeches == []
    assert sensory == ["You see a shadow to your left"]


def test_parse_whisper_content_mixed():
    speeches, sensory = parse_whisper_content('"Look out!" You hear me shout as I run')
    assert speeches == ["Look out!"]
    assert sensory == ["You hear me shout as I run"]


def test_parse_whisper_content_multiple_quotes():
    speeches, sensory = parse_whisper_content('"Look out!" You hear me shout, "Get down!" as sparks fly.')
    assert speeches == ["Look out!", "Get down!"]
    assert sensory == ["You hear me shout", "as sparks fly."]


def test_parse_whisper_content_unclosed_quote():
    speeches, sensory = parse_whisper_content('You hear a whisper: "Look out! Run')
    assert speeches == ["Look out! Run"]
    assert sensory == ["You hear a whisper"]


def test_decompose_user_message_mixed(sample_roster):
    raw_message = (
        "We walk into a dark room together.\n"
        '@Elena Vance: "Look out!" You see a shadow to your left\n'
        "@Jax: You hear something clicking in the vents\n"
        '@Markus Stone: "Can you hear me over comms?"'
    )
    # Elena and Jax are in room; Markus is elsewhere
    present_ids = {"char_elena", "char_jax"}
    decomposed = decompose_user_message(
        raw_message,
        campaign_characters=sample_roster,
        present_character_ids=present_ids,
    )

    assert decomposed.public_text == "We walk into a dark room together."
    assert len(decomposed.whispers) == 3

    # Check Elena
    elena_w = decomposed.whispers_by_character_id.get("char_elena")
    assert elena_w is not None
    assert elena_w.character_name == "Elena Vance"
    assert elena_w.target_scope == MentionTargetScope.LOCAL
    assert elena_w.speech_parts == ["Look out!"]
    assert elena_w.sensory_parts == ["You see a shadow to your left"]

    # Check Jax
    jax_w = decomposed.whispers_by_character_id.get("char_jax")
    assert jax_w is not None
    assert jax_w.target_scope == MentionTargetScope.LOCAL
    assert jax_w.speech_parts == []
    assert jax_w.sensory_parts == ["You hear something clicking in the vents"]

    # Check Markus (Remote)
    markus_w = decomposed.whispers_by_character_id.get("char_markus")
    assert markus_w is not None
    assert markus_w.target_scope == MentionTargetScope.REMOTE
    assert markus_w.speech_parts == ["Can you hear me over comms?"]
    assert decomposed.remote_whispers == [markus_w]


def test_decompose_user_message_multiple_lines_same_character(sample_roster):
    raw_message = (
        "We ready our gear.\n"
        '@Elena Vance: "Watch the door."\n'
        "@Elena Vance: You notice faint bootprints in the dust.\n"
        "@Jax: Power levels are surging."
    )
    decomposed = decompose_user_message(
        raw_message,
        campaign_characters=sample_roster,
    )

    assert len(decomposed.whispers) == 2
    elena_w = decomposed.whispers_by_character_id["char_elena"]
    assert len(elena_w.raw_lines) == 2
    assert elena_w.speech_parts == ["Watch the door."]
    assert elena_w.sensory_parts == ["You notice faint bootprints in the dust."]


def test_filter_user_message_for_character(sample_roster):
    raw_message = (
        "We ready our weapons.\n"
        '@Elena Vance: "Watch the door." You spot movement.\n'
        "@Jax: You hear the humming generator."
    )

    elena_view = filter_user_message_for_character(
        raw_message,
        target_character_id="char_elena",
        campaign_characters=sample_roster,
    )
    assert "We ready our weapons." in elena_view
    assert '@Elena Vance: "Watch the door." You spot movement.' in elena_view
    assert "@Jax" not in elena_view
    assert "generator" not in elena_view

    jax_view = filter_user_message_for_character(
        raw_message,
        target_character_id="char_jax",
        campaign_characters=sample_roster,
    )
    assert "We ready our weapons." in jax_view
    assert "@Jax: You hear the humming generator." in jax_view
    assert "@Elena Vance" not in jax_view

    markus_view = filter_user_message_for_character(
        raw_message,
        target_character_id="char_markus",
        campaign_characters=sample_roster,
    )
    assert markus_view == "We ready our weapons."


def test_sanitize_history_for_episodic_summary(sample_roster):
    raw_message = (
        "The team steps into the vault.\n"
        '@Elena Vance: "Watch out!" You notice a tripwire at your feet.\n'
        "@Jax: You smell ozone in the air."
    )
    summary_history = sanitize_history_for_episodic_summary(
        raw_message,
        campaign_characters=sample_roster,
    )
    assert "The team steps into the vault." in summary_history
    assert '[Elena Vance]: "Watch out!"' in summary_history
    # Private sensory cues MUST be scrubbed from episodic summary
    assert "tripwire" not in summary_history
    assert "ozone" not in summary_history


@pytest.mark.asyncio
async def test_phase1_speaker_prioritization_and_perception_check(
    sample_roster, monkeypatch: pytest.MonkeyPatch
):
    from app.config import settings
    from app.engine.phase1_pre import run_phase1_pre_analysis, select_speaker_order
    from app.schemas.world import LocationNode

    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")

    active_loc = LocationNode(
        id="loc_vault",
        world_id="world_1",
        name="Abandoned Vault",
        summary="A dark sealed chamber.",
        description="Rusted consoles line the walls.",
    )

    msg = (
        "We push the reinforced door open.\n"
        '@Elena Vance: "Watch the blind spot!"\n'
        "@Jax: You hear a strange clicking noise behind the wall."
    )

    # select_speaker_order prioritizes direct speech to Elena
    order = select_speaker_order(msg, sample_roster[:2])
    assert order[0] == "char_elena"

    pre_turn = await run_phase1_pre_analysis(
        user_message=msg,
        character=sample_roster[0],
        active_location=active_loc,
        neighbors=[],
        known_entities=[],
        present_characters=sample_roster[:2],  # Elena & Jax
        previous_speaker_id=None,
    )

    # Sensory cue about "clicking noise" should stage a perception check for Jax
    jax_checks = [c for c in pre_turn.character_checks if c.character_id == "char_jax"]
    assert len(jax_checks) > 0
    assert "perception" in jax_checks[0].skill_or_approach.lower()


def test_zone3_history_scoping_in_assemble_four_zone_messages(sample_roster):
    from app.engine.phase2_context import assemble_four_zone_messages
    from app.schemas.turn import PreTurnAnalysis, TurnNodeRecord, WorldStateSnapshot
    from app.schemas.character import CharacterStateSnapshot, CognitionBlock
    from app.schemas.world import LocationNode, WorldGlobalRules, WorldRecord

    world = WorldRecord(
        id="w_test",
        owner_id="u_test",
        name="Test World",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk",
            tone="Dark",
            setting_overview="City",
            tech_or_magic_rules="Cyber",
            starting_timestamp="2026-11-05 00:00",
        ),
        created_at="2026-11-05T00:00:00Z",
    )
    loc = LocationNode(id="loc_1", world_id="w_test", name="Room", summary="S", description="D")
    w_snap = WorldStateSnapshot(
        turn_id="turn_0",
        world_timestamp="2026-11-05 00:00",
        active_location_id="loc_1",
    )
    c_snap = CharacterStateSnapshot(
        turn_id="turn_0",
        character_id="char_elena",
        current_location_id="loc_1",
        mood_label="Calm",
        active_want="Stay alert",
        active_plan="Observe room",
    )
    j_snap = CharacterStateSnapshot(
        turn_id="turn_0",
        character_id="char_jax",
        current_location_id="loc_1",
        mood_label="Attentive",
        active_want="Scan",
        active_plan="Listen",
    )
    p_turn = PreTurnAnalysis(
        user_sentiment="neutral",
        subtext_interpretation="neutral",
        mentioned_entities=[],
        memory_search_queries=[],
    )

    turn_0 = TurnNodeRecord(
        id="turn_0",
        campaign_id="camp_1",
        depth_index=0,
        user_message="[Scene Start]",
        actor_id="__narrator__",
        raw_prose="The scene begins.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=p_turn,
        world_snapshot=w_snap,
        character_state=c_snap,
        character_states={"char_elena": c_snap, "char_jax": j_snap},
        created_at="2026-11-05T00:00:00Z",
    )
    # Turn 1 has private whispers for Elena and Jax
    turn_1 = TurnNodeRecord(
        id="turn_1",
        campaign_id="camp_1",
        parent_turn_id="turn_0",
        depth_index=1,
        user_message=(
            "We enter the room.\n"
            '@Elena Vance: "Look out!" You see a shadow to your left.\n'
            "@Jax: You hear something clicking in the vent."
        ),
        actor_id="char_elena",
        raw_prose="Elena draws her weapon.",
        cognition=CognitionBlock(recall="none", feeling="alert", want="guard", plan="ready"),
        pre_turn=p_turn,
        world_snapshot=w_snap,
        character_state=c_snap,
        character_states={"char_elena": c_snap, "char_jax": j_snap},
        created_at="2026-11-05T00:01:00Z",
    )

    # Turn 2: Generate messages for Jax
    jax_messages = assemble_four_zone_messages(
        world=world,
        character=sample_roster[1],  # Jax
        branch_turns=[turn_0, turn_1],
        episodic_chunks=[],
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=p_turn,
        user_message="What should we do?",
        present_characters=sample_roster[:2],  # Elena & Jax
    )

    # In Jax's message history (Zone 3), Elena's private whisper MUST NOT be present
    jax_history_content = "\n".join(m["content"] for m in jax_messages)
    assert "@Jax: You hear something clicking in the vent." in jax_history_content
    assert "@Elena Vance" not in jax_history_content
    assert "shadow" not in jax_history_content

