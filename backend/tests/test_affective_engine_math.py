"""Gate 1 unit tests for CARE v2.1 mathematical, lexical, and epistemic invariants."""

from __future__ import annotations

import re

import pytest

from app.engine.affective_engine import (
    MechanicalTurnSignals,
    apply_co_present_witness_coupling,
    apply_gottman_relational_event,
    compute_provisional_cognition_preview,
    derive_active_emotion,
    describe_outward_demeanor,
    describe_pad_disposition,
    hydrate_legacy_care_state,
    impulse_from_legacy_floats,
    kalman_mood_step,
    materialize_snapshot_with_care,
    normalize_relational_events,
    project_care_to_minute,
    render_zone4_affective_block,
    resolve_post_turn_care_state,
    seed_initial_care_state,
)
from app.schemas.affective import (
    CategoricalFeelingImpulse,
    RelationalEdge,
    RelationalEventSpec,
    default_worldview_for_archetype,
    temperament_config_for_archetype,
)
from app.schemas.character import BaselinePsyche, CharacterStateSnapshot
from app.schemas.turn import CharacterAgentDelta, ExtractedCharacterMemory


def _make_psyche(archetype: str = "balanced") -> BaselinePsyche:
    return BaselinePsyche(
        mood_label="Observant and composed",
        valence=0.0,
        arousal=0.4,
        core_drive="Survive and protect the cantina.",
        core_fear="Betrayal from the inside.",
        default_want="Gauge the newcomer.",
        default_plan="Keep conversation measured.",
        initial_worldview=default_worldview_for_archetype(archetype),
        temperament=temperament_config_for_archetype(archetype),
    )


def test_zero_drift_fixed_point_over_twenty_neutral_turns():
    """Invariant 1: 20 consecutive neutral turns produce zero drift (no a/(1-r) explosion)."""
    psyche = _make_psyche("balanced")
    edge = RelationalEdge(
        target_id="user",
        warmth=0.42,
        respect=0.35,
        trust=0.58,
        power=-0.10,
        grievance=0.15,
        obligation=0.25,
        consolidated_warmth=0.40,
        consolidated_trust=0.50,
    )
    neutral_event = RelationalEventSpec(target="user")
    cur = edge
    for _ in range(20):
        cur, stimuli = apply_gottman_relational_event(
            cur, neutral_event, psyche.temperament
        )
        assert stimuli == (0.0, 0.0, 0.0)

    assert cur.warmth == pytest.approx(0.42, abs=1e-6)
    assert cur.respect == pytest.approx(0.35, abs=1e-6)
    assert cur.trust == pytest.approx(0.58, abs=1e-6)
    assert cur.grievance == pytest.approx(0.15, abs=1e-6)
    assert cur.obligation == pytest.approx(0.25, abs=1e-6)


@pytest.mark.parametrize("archetype", ["balanced", "stoic", "volatile", "paranoiac"])
def test_non_degenerate_kalman_steady_state_gain_and_shock_rupture(archetype: str):
    """Invariant 2: After 50 rapid 1-minute turns, Kalman gain stays > 0.12 (never collapses to 0)."""
    psyche = _make_psyche(archetype)
    pad = (0.0, 0.4, 0.0)
    var = (0.08, 0.08, 0.08)
    gains = (0.0, 0.0, 0.0)

    for _ in range(50):
        pad, var, gains = kalman_mood_step(
            prior_pad=pad,
            prior_variance=var,
            resting_pad_tilde=(0.0, -0.2, 0.0),
            observation_pad=(0.25, 0.55, 0.15),
            composure=1.0,  # Maximum composure damping
            composure_resilience=psyche.temperament.composure_resilience,
            dt_minutes=1,
        )

    assert gains[0] > 0.12
    assert gains[1] > 0.12
    assert gains[2] > 0.12

    # Shock rupture immediately spikes gain and shifts mood sharply
    shock_pad, _, shock_gains = kalman_mood_step(
        prior_pad=pad,
        prior_variance=var,
        resting_pad_tilde=(0.0, -0.2, 0.0),
        observation_pad=(-0.85, 0.92, -0.75),
        composure=1.0,
        composure_resilience=psyche.temperament.composure_resilience,
        dt_minutes=1,
        mech_impulse_tilde=(-0.20, 0.35, -0.30),
        is_shock_rupture=True,
    )
    assert shock_gains[0] > gains[0] * 1.8
    assert shock_pad[0] < -0.25
    assert shock_pad[1] > 0.70


def test_negative_sentiment_override_blocks_cheap_flattery_until_costly_proof():
    """Invariant 3: Distrustful NPC ignores 5 polite compliments, recovers only on strong_pos."""
    psyche = _make_psyche("balanced")
    distrust_edge = RelationalEdge(
        target_id="user",
        warmth=-0.50,
        respect=-0.10,
        trust=-0.70,
        grievance=0.55,
    )
    flattery = RelationalEventSpec(
        target="user",
        warmth_shift="mild_pos",
        trust_shift="mild_pos",
        grievance_shift="eased",
        note="Offered a polite apology and compliment.",
    )
    cur = distrust_edge
    for _ in range(5):
        cur, _ = apply_gottman_relational_event(cur, flattery, psyche.temperament)

    # Completely inside Negative Sentiment Override dead-zone!
    assert cur.trust == pytest.approx(-0.70, abs=1e-6)
    assert cur.warmth == pytest.approx(-0.50, abs=1e-6)
    assert cur.grievance == pytest.approx(0.55, abs=1e-6)

    # High-cost sacrifice pierces effective threshold
    sacrifice = RelationalEventSpec(
        target="user",
        warmth_shift="strong_pos",
        trust_shift="strong_pos",
        grievance_shift="reconciled",
        note="Took a blaster bolt to shield me and returned the stolen cypher.",
    )
    recovered, _ = apply_gottman_relational_event(cur, sacrifice, psyche.temperament)
    assert recovered.trust > cur.trust + 0.15
    assert recovered.warmth > cur.warmth + 0.15
    assert recovered.grievance < cur.grievance


def test_positive_sentiment_override_absorbs_minor_friction_and_betrayal_cuts_deepest():
    """Positive Sentiment Override absorbs mild_neg, while strong_neg betrayal cuts deeper on allies."""
    psyche = _make_psyche("balanced")
    ally = RelationalEdge(target_id="user", warmth=0.82, respect=0.70, trust=0.85)
    stranger = RelationalEdge(target_id="user", warmth=0.0, respect=0.0, trust=0.0)

    minor_friction = RelationalEventSpec(target="user", warmth_shift="mild_neg")
    ally_after_minor, _ = apply_gottman_relational_event(
        ally, minor_friction, psyche.temperament
    )
    stranger_after_minor, _ = apply_gottman_relational_event(
        stranger, minor_friction, psyche.temperament
    )
    # Trusted ally gives benefit of the doubt; stranger takes offense
    assert ally_after_minor.warmth == pytest.approx(ally.warmth, abs=1e-6)
    assert stranger_after_minor.warmth < stranger.warmth

    # Severe betrayal hits trusted ally with larger absolute drop than stranger
    betrayal = RelationalEventSpec(target="user", trust_shift="strong_neg")
    ally_betrayed, _ = apply_gottman_relational_event(ally, betrayal, psyche.temperament)
    stranger_betrayed, _ = apply_gottman_relational_event(
        stranger, betrayal, psyche.temperament
    )
    ally_drop = ally.trust - ally_betrayed.trust
    stranger_drop = stranger.trust - stranger_betrayed.trust
    assert ally_drop > stranger_drop * 1.35


def test_grievance_and_obligation_orthogonality_and_lexical_rendering():
    """Invariant 4: Grave wrong + life-saving debt keep BOTH G > 0.6 and O > 0.6 without cancelling."""
    psyche = _make_psyche("balanced")
    care = seed_initial_care_state(psyche)
    edge = care.relations["user"]

    edge, _ = apply_gottman_relational_event(
        edge,
        RelationalEventSpec(
            target="user",
            warmth_shift="strong_neg",
            trust_shift="strong_neg",
            grievance_shift="grave_wrong",
            note="Left me stranded at the orbital docks.",
        ),
        psyche.temperament,
    )
    edge, _ = apply_gottman_relational_event(
        edge,
        RelationalEventSpec(
            target="user",
            respect_shift="strong_pos",
            obligation_shift="strong_pos",
            note="Pulled me out of the burning reactor bay.",
        ),
        psyche.temperament,
    )

    assert edge.grievance > 0.60
    assert edge.obligation > 0.60

    care = care.model_copy(update={"relations": {"user": edge}})
    rendered = render_zone4_affective_block(
        care,
        character_name="Vesper",
        persona_name="Kaelen",
        character_name_map={},
        active_speaker_id=None,
        co_present_ids=set(),
    )
    assert "grievance" in rendered.lower()
    assert "debt" in rendered.lower()
    assert not re.search(r"\d+\.\d+", rendered)


def test_clock_projection_semigroup_idempotency_and_rest_recovery():
    """Invariant 6: project_care_to_minute is an exact semigroup and strictly idempotent at dt=0."""
    psyche = _make_psyche("balanced")
    stressed = seed_initial_care_state(psyche).model_copy(
        update={
            "state_elapsed_minutes": 100,
            "valence": -0.70,
            "arousal": 0.92,
            "dominance": -0.60,
            "composure": 0.20,
        }
    )

    # Single 480m jump vs two 240m jumps
    one_shot = project_care_to_minute(
        stressed, target_elapsed_minutes=580, psyche=psyche
    )
    half_step = project_care_to_minute(
        stressed, target_elapsed_minutes=340, psyche=psyche
    )
    two_step = project_care_to_minute(
        half_step, target_elapsed_minutes=580, psyche=psyche
    )

    assert one_shot.valence == pytest.approx(two_step.valence, abs=1e-3)
    assert one_shot.arousal == pytest.approx(two_step.arousal, abs=1e-3)
    assert one_shot.composure == pytest.approx(two_step.composure, abs=1e-3)

    # Calling again at 580 is an exact identity operation
    repeated = project_care_to_minute(
        one_shot, target_elapsed_minutes=580, psyche=psyche
    )
    assert repeated == one_shot

    # 8 hours of rest decays high arousal nearly to baseline (0.40) and restores ~75% of missing composure
    assert one_shot.arousal < 0.45
    assert one_shot.composure == pytest.approx(0.80, abs=0.02)


def test_provisional_preview_is_strictly_non_destructive():
    """Phase 3 -> Phase 4 preview never mutates variance, relations, worldview, or elapsed minutes."""
    psyche = _make_psyche("balanced")
    committed = seed_initial_care_state(psyche, initial_elapsed_minutes=42)
    impulse = CategoricalFeelingImpulse(
        tone="hostile",
        intensity="high",
        agency="commanding",
        threat="high",
        coping="mastery",
    )

    preview = compute_provisional_cognition_preview(
        committed, impulse, roll_outcome="Critical Failure"
    )
    assert preview.is_provisional is True
    assert preview.mood_variance == committed.mood_variance
    assert preview.relations == committed.relations
    assert preview.active_worldview == committed.active_worldview
    assert preview.state_elapsed_minutes == 42
    assert preview.valence < committed.valence
    assert preview.arousal > committed.arousal


def test_persona_canonicalization_whisper_isolation_and_witness_coupling():
    """Invariant 5: Persona name -> 'user', self/__narrator__ stripped, whispers invisible to witnesses."""
    vesper_psyche = _make_psyche("balanced")
    kira_psyche = _make_psyche("confidant")  # High benevolence (+0.6)

    vesper_prior = seed_initial_care_state(vesper_psyche)
    kira_prior = seed_initial_care_state(kira_psyche)

    # 1. Private @Vesper whisper targeting Persona name "Kaelen Vance" + bogus self/__narrator__ edges
    whisper_delta = CharacterAgentDelta(
        affect_tone="hostile",
        affect_intensity="high",
        affect_agency="assured",
        scene_threat="moderate",
        scene_coping="adequate",
        relational_events=[
            RelationalEventSpec(
                target="Kaelen Vance",
                warmth_shift="strong_neg",
                trust_shift="strong_neg",
                grievance_shift="grave_wrong",
                note="Whispered confession of sabotage.",
            ),
            RelationalEventSpec(target="char_vesper", warmth_shift="strong_pos"),
            RelationalEventSpec(target="__narrator__", warmth_shift="strong_pos"),
            RelationalEventSpec(target="char_absent_npc", warmth_shift="strong_pos"),
        ],
    )
    vesper_after_whisper, public_events = resolve_post_turn_care_state(
        vesper_prior,
        psyche=vesper_psyche,
        delta=whisper_delta,
        cognition_impulse=None,
        signals=MechanicalTurnSignals(
            visibility_ceiling_by_target={"user": "local_whisper"}
        ),
        turn_elapsed_minutes=2,
        target_elapsed_minutes=2,
        self_id="char_vesper",
        self_name="Vesper",
        persona_name="Kaelen Vance",
        allowed_target_ids={"user", "char_vesper", "char_kira"},
    )

    assert "Kaelen Vance" not in vesper_after_whisper.relations
    assert "char_vesper" not in vesper_after_whisper.relations
    assert "__narrator__" not in vesper_after_whisper.relations
    assert "char_absent_npc" not in vesper_after_whisper.relations
    assert vesper_after_whisper.relations["user"].grievance > 0.60
    assert public_events == []  # Zero public leakage from local_whisper!

    coupled_whisper = apply_co_present_witness_coupling(
        {"char_vesper": vesper_after_whisper, "char_kira": kira_prior},
        psyches_by_char={"char_vesper": vesper_psyche, "char_kira": kira_psyche},
        public_events=public_events,
        co_present_throughout_ids={"char_vesper", "char_kira"},
    )
    assert coupled_whisper["char_kira"] == kira_prior

    # 2. Now same cruelty happens in PUBLIC room -> benevolent witness Kira loses warmth & trust toward user!
    _, public_cruelty_events = resolve_post_turn_care_state(
        vesper_prior,
        psyche=vesper_psyche,
        delta=whisper_delta,
        cognition_impulse=None,
        signals=MechanicalTurnSignals(
            visibility_ceiling_by_target={"user": "public_room"}
        ),
        turn_elapsed_minutes=2,
        target_elapsed_minutes=2,
        self_id="char_vesper",
        self_name="Vesper",
        persona_name="Kaelen Vance",
        allowed_target_ids={"user", "char_vesper", "char_kira"},
    )
    assert len(public_cruelty_events) == 1
    coupled_public = apply_co_present_witness_coupling(
        {"char_vesper": vesper_after_whisper, "char_kira": kira_prior},
        psyches_by_char={"char_vesper": vesper_psyche, "char_kira": kira_psyche},
        public_events=public_cruelty_events,
        co_present_throughout_ids={"char_vesper", "char_kira"},
    )
    assert coupled_public["char_kira"].relations["user"].warmth < kira_prior.relations["user"].warmth
    assert coupled_public["char_kira"].relations["user"].trust < kira_prior.relations["user"].trust


def test_radial_pad_emotions_composure_masking_salience_cap_and_gbnf_schema():
    """Verify portrait emotion separation, composure masking, salience cap, zero floats, & flat GBNF schema."""
    # Near-zero coordinates stay in neutral core
    assert derive_active_emotion(valence=-0.04, arousal=0.43, dominance=0.05) == "default"
    # Dominance separates Angry (+D) from Afraid (-D)
    assert derive_active_emotion(valence=-0.65, arousal=0.78, dominance=0.60) == "angry"
    assert derive_active_emotion(valence=-0.65, arousal=0.78, dominance=-0.60) == "afraid"
    assert derive_active_emotion(valence=0.60, arousal=0.65, dominance=0.30) == "happy"
    assert (
        derive_active_emotion(valence=-0.10, arousal=0.72, dominance=0.0, ambiguity=0.80)
        == "surprised"
    )
    contempt_edge = RelationalEdge(target_id="user", warmth=-0.45, respect=-0.60)
    assert (
        derive_active_emotion(
            valence=-0.25, arousal=0.35, dominance=0.35, primary_edge=contempt_edge
        )
        == "contempt"
    )

    # Composure masking vs leakage
    masked = describe_outward_demeanor(
        valence=-0.70,
        arousal=0.80,
        dominance=0.50,
        composure=0.85,
        short_mood_label="Furious and confrontational",
    )
    cracked = describe_outward_demeanor(
        valence=-0.70,
        arousal=0.80,
        dominance=0.50,
        composure=0.15,
        short_mood_label="Furious and confrontational",
    )
    assert "outwardly controlled" in masked.lower()
    assert "visibly rattled" in cracked.lower()

    # Salience cap in crowded 5-NPC room + zero floats
    psyche = _make_psyche("stoic")
    care = seed_initial_care_state(psyche)
    rels = dict(care.relations)
    for idx in range(5):
        rels[f"npc_{idx}"] = RelationalEdge(
            target_id=f"npc_{idx}",
            warmth=0.10 * (idx + 1),
            grievance=0.15 * idx,
        )
    care = care.model_copy(update={"relations": rels})
    block = render_zone4_affective_block(
        care,
        character_name="Rook",
        persona_name="Kaelen",
        character_name_map={f"npc_{i}": f"Patron_{i}" for i in range(5)},
        active_speaker_id="npc_0",
        co_present_ids={f"npc_{i}" for i in range(5)},
        max_npc_edges=2,
    )
    # Active speaker (Patron_0) + top 2 salience (Patron_4, Patron_3) = 3 NPCs; Patron_1 & Patron_2 omitted
    assert "Patron_0" in block
    assert "Patron_4" in block
    assert "Patron_3" in block
    assert "Patron_1" not in block
    assert "Patron_2" not in block
    assert not re.search(r"\d+\.\d+", block)

    # GBNF flatness check: no nullable nested $ref sub-objects inside CharacterAgentDelta properties
    schema = CharacterAgentDelta.model_json_schema()
    for prop_name, prop_schema in schema.get("properties", {}).items():
        if "anyOf" in prop_schema:
            for branch in prop_schema["anyOf"]:
                assert "$ref" not in branch, f"Nullable nested $ref found on {prop_name}"


def test_legacy_hydration_memory_worldview_shift_and_item_seizure_fusion():
    """Verify pre-CARE row hydration, legacy float <feeling> fallback, memory shift, and item seizure."""
    psyche = _make_psyche("balanced")
    legacy_snap = CharacterStateSnapshot(
        turn_id="t1",
        character_id="c1",
        current_location_id="loc1",
        mood_label="Suspicious and tense",
        valence=-0.35,
        arousal=0.68,
        active_want="Watch the door",
        active_plan="Keep hand on holster",
        relationship_notes={"user": "Distrustful after the dockyard betrayal"},
    )
    hydrated = hydrate_legacy_care_state(
        valence=legacy_snap.valence,
        arousal=legacy_snap.arousal,
        mood_label=legacy_snap.mood_label,
        relationship_notes=legacy_snap.relationship_notes,
        psyche=psyche,
        elapsed_minutes=15,
    )
    assert hydrated.relations["user"].grievance > 0.40
    assert hydrated.relations["user"].trust < -0.20

    impulse = impulse_from_legacy_floats(-0.75, 0.88)
    assert impulse.used_legacy_float_fallback is True
    assert impulse.tone in ("hostile", "bitter")
    assert impulse.intensity == "extreme"

    # Unrelinquished item seizure + betrayal memory shifts worldview & creates grievance automatically
    updated, _ = resolve_post_turn_care_state(
        hydrated,
        psyche=psyche,
        delta=CharacterAgentDelta(
            new_memories=[
                ExtractedCharacterMemory(
                    character_id="c1",
                    title="Robbed at the Cantina",
                    content="Kaelen wrenched the data-core from my grip.",
                    significance="betrayal",
                    emotional_weight=0.95,
                )
            ]
        ),
        cognition_impulse=impulse,
        signals=MechanicalTurnSignals(
            roll_outcome="Failure with Consequences",
            seized_from_me_by=("user",),
        ),
        turn_elapsed_minutes=3,
        target_elapsed_minutes=18,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user", "c1"},
    )
    assert updated.active_worldview.benevolence < hydrated.active_worldview.benevolence
    assert updated.relations["user"].grievance > hydrated.relations["user"].grievance
    materialized = materialize_snapshot_with_care(legacy_snap, updated)
    assert materialized.care_state == updated
    assert materialized.valence == pytest.approx(updated.valence, abs=1e-3)


def test_asymmetric_appraisal_instant_attack_and_gradual_decay():
    """Verify threat spikes immediately on danger, retains >90% on a 1m bystander turn, and decays on 8h rest."""
    psyche = _make_psyche("balanced")
    prior = seed_initial_care_state(psyche)

    # Turn 1: Acute ambush -> instant threat attack to 0.75 ('high')
    t1, _ = resolve_post_turn_care_state(
        prior,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="uneasy",
            affect_intensity="high",
            scene_threat="high",
            scene_coping="strained",
            scene_surprise="high",
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=1,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert t1.appraisal.threat == pytest.approx(0.75, abs=1e-3)
    assert t1.appraisal.ambiguity == pytest.approx(0.75, abs=1e-3)

    # Turn 2: Passive 1-minute bystander fast-path (default scene_threat='none', no affect observation)
    # Threat must decay gradually (retaining > 95%), NOT snap to 0.0!
    t2, _ = resolve_post_turn_care_state(
        t1,
        psyche=psyche,
        delta=CharacterAgentDelta(mood_label=t1.short_mood_label),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=2,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert t2.appraisal.threat > 0.70
    assert t2.appraisal.ambiguity > 0.70

    # Turn 3: 480-minute (8-hour) Narrator rest -> threat decays to ~0 and composure recovers
    t3, _ = resolve_post_turn_care_state(
        t2,
        psyche=psyche,
        delta=CharacterAgentDelta(mood_label=t2.short_mood_label),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=480,
        target_elapsed_minutes=482,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert t3.appraisal.threat < 0.01
    assert t3.composure > 0.85


def test_salience_gated_slew_damps_routine_jitter_but_permits_shock_and_recovery():
    """Verify low-salience tone jitter is slew-bounded while shock turns and homeostatic recovery move freely."""
    psyche = _make_psyche("balanced")
    state = seed_initial_care_state(psyche).model_copy(update={"composure": 0.45})

    # Routine low-salience turn where LLM over-selects 'warm' (+0.55) from neutral (0.0)
    calm_jump, _ = resolve_post_turn_care_state(
        state,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="warm",
            affect_intensity="low",
            scene_threat="none",
            scene_surprise="calm",
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=1,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert abs(calm_jump.valence - state.valence) <= 0.145

    # High-salience shock turn (Critical Failure + extreme anguish) bypasses slew clamp
    shock_jump, _ = resolve_post_turn_care_state(
        state,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="anguished",
            affect_intensity="extreme",
            scene_threat="critical",
            scene_surprise="extreme",
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(roll_outcome="Critical Failure"),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=1,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert shock_jump.valence < -0.35

    # Homeostatic return exemption: recovering from extreme distress (-0.75) toward baseline (0.0)
    distressed = state.model_copy(update={"valence": -0.75, "composure": 0.25})
    recovered, _ = resolve_post_turn_care_state(
        distressed,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="content",
            affect_intensity="low",
            scene_threat="none",
            scene_surprise="calm",
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=2,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert (recovered.valence - distressed.valence) > 0.16


def test_uncorroborated_banter_strong_neg_softened_while_true_betrayal_pierces():
    """Verify uncorroborated strong_neg/grave_wrong in calm banter is softened to mild_neg/slighted."""
    psyche = _make_psyche("balanced")
    ally_edge = RelationalEdge(target_id="user", warmth=0.82, respect=0.70, trust=0.85)
    prior = seed_initial_care_state(psyche).model_copy(update={"relations": {"user": ally_edge}})

    # 1. Calm, low-intensity banter where LLM over-classifies a nosy question as strong_neg/grave_wrong
    after_banter, _ = resolve_post_turn_care_state(
        prior,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="guarded",
            affect_intensity="low",
            scene_threat="none",
            scene_surprise="calm",
            relational_events=[
                RelationalEventSpec(
                    target="user",
                    warmth_shift="strong_neg",
                    trust_shift="strong_neg",
                    grievance_shift="grave_wrong",
                    note="Asked an intrusive question about the cargo manifest.",
                )
            ],
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=1,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    # Softened to mild_neg -> absorbed by ally's Positive Sentiment Override!
    assert after_banter.relations["user"].warmth == pytest.approx(ally_edge.warmth, abs=1e-4)
    assert after_banter.relations["user"].trust == pytest.approx(ally_edge.trust, abs=1e-4)
    assert after_banter.relations["user"].grievance < 0.35

    # 2. Corroborated high-intensity hostile betrayal pierces Positive Sentiment Override
    after_betrayal, _ = resolve_post_turn_care_state(
        prior,
        psyche=psyche,
        delta=CharacterAgentDelta(
            affect_tone="hostile",
            affect_intensity="high",
            scene_threat="high",
            relational_events=[
                RelationalEventSpec(
                    target="user",
                    warmth_shift="strong_neg",
                    trust_shift="strong_neg",
                    grievance_shift="grave_wrong",
                    note="Betrayed the safehouse coordinates to the Syndicate.",
                )
            ],
        ),
        cognition_impulse=None,
        signals=MechanicalTurnSignals(),
        turn_elapsed_minutes=1,
        target_elapsed_minutes=1,
        self_id="c1",
        self_name="Vesper",
        persona_name="Kaelen",
        allowed_target_ids={"user"},
    )
    assert after_betrayal.relations["user"].trust < 0.0
    assert after_betrayal.relations["user"].grievance > 0.65


def test_portrait_emotion_hysteresis_prevents_boundary_flicker():
    """Verify Schmitt-trigger hysteresis prevents active_emotion flicker across V and D boundaries."""
    # Entering happy requires V >= 0.26, but once happy, V = 0.22 stays happy (exits below 0.19)
    assert derive_active_emotion(valence=0.22, arousal=0.45, dominance=0.10, prior_emotion="default") == "default"
    assert derive_active_emotion(valence=0.22, arousal=0.45, dominance=0.10, prior_emotion="happy") == "happy"
    assert derive_active_emotion(valence=0.15, arousal=0.45, dominance=0.10, prior_emotion="happy") == "default"

    # Anger vs Fear boundary at D = 0.05 has dead-band [-0.04, 0.14]
    assert derive_active_emotion(valence=-0.45, arousal=0.65, dominance=0.01, prior_emotion="angry") == "angry"
    assert derive_active_emotion(valence=-0.45, arousal=0.65, dominance=0.01, prior_emotion="afraid") == "afraid"
    assert derive_active_emotion(valence=-0.45, arousal=0.65, dominance=-0.10, prior_emotion="angry") == "afraid"
    assert derive_active_emotion(valence=-0.45, arousal=0.65, dominance=0.20, prior_emotion="afraid") == "angry"

