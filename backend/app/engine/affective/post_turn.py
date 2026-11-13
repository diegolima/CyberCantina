"""Post-turn CARE appraisal, salience clamping, and witness coupling."""

from __future__ import annotations

import math
import re

from app.schemas.affective import (
    AffectiveCareState,
    CategoricalFeelingImpulse,
    GrievanceShift,
    INTENSITY_TO_AROUSAL,
    OrdinalImpact,
    RelationalEventSpec,
    SituationalAppraisal,
    TONE_TO_VALENCE,
    VisibilityScope,
    WorldviewProfile,
)
from app.schemas.character import BaselinePsyche
from app.schemas.turn import (
    CharacterAgentDelta,
    ExtractedCharacterMemory,
)
from collections.abc import (
    Mapping,
    Sequence,
)
from typing import Final

from app.engine.affective.dynamics import (
    _gottman_influence,
    _weber_fechner_step,
    apply_gottman_relational_event,
    gottman_effective_thresholds,
    kalman_mood_step,
    project_care_to_minute,
    update_composure_step,
)
from app.engine.affective.hydration import _refresh_derived_care_fields
from app.engine.affective.models import (
    AGENCY_TO_DOMINANCE,
    COPING_TO_KAPPA,
    GOTTMAN_BASE_POS_SLOPE,
    INTENSITY_TO_AMBIGUITY,
    LAMBDA_APPRAISAL_DECAY,
    MechanicalTurnSignals,
    ORDINAL_TO_GOAL_CONGRUENCE,
    ResolvedWitnessEvent,
    THREAT_TO_TAU,
    WITNESS_ALLY_MU,
    WITNESS_MORAL_MU,
    _NARRATOR_ALIASES,
    _USER_ALIASES,
    _clamp,
    _mechanical_roll_impulse,
    _resting_pad_baseline,
    _tilde_to_arousal,
    build_stranger_edge,
)

# ---------------------------------------------------------------------------
# Relational Event Normalization & Epistemic Clamping
# ---------------------------------------------------------------------------


def _canonicalize_target_token(
    raw_target: str,
    *,
    self_id: str,
    self_name: str,
    persona_name: str | None,
    allowed_target_ids: set[str],
    character_name_map: Mapping[str, str] | None = None,
) -> str | None:
    cleaned = re.sub(r"\s+", " ", (raw_target or "").strip().lstrip("@"))
    if not cleaned:
        return None
    low = cleaned.lower()

    if low in _NARRATOR_ALIASES:
        return None
    if low == self_id.lower() or (self_name and low == self_name.strip().lower()):
        return None

    # Canonicalize player & PersonaRecord name -> 'user'
    if low in _USER_ALIASES:
        return "user" if "user" in allowed_target_ids else None
    if persona_name and persona_name.strip():
        p_clean = persona_name.strip().lower()
        p_first = p_clean.split()[0] if p_clean.split() else ""
        if low == p_clean or (len(p_first) >= 3 and low == p_first):
            return "user" if "user" in allowed_target_ids else None

    # Exact or case-insensitive character_id match
    for aid in allowed_target_ids:
        if aid != "user" and low == aid.lower():
            return aid

    # Display name match against character_name_map
    if character_name_map:
        for cid, cname in character_name_map.items():
            if cid not in allowed_target_ids:
                continue
            cname_low = cname.strip().lower()
            c_first = cname_low.split()[0] if cname_low.split() else ""
            if low == cname_low or (len(c_first) >= 3 and low == c_first):
                if cid != self_id:
                    return cid

    return None


def _synthesize_event_from_legacy_stance(target_id: str, stance_text: str) -> RelationalEventSpec:
    low = stance_text.lower()
    w: OrdinalImpact = "none"
    r: OrdinalImpact = "none"
    t: OrdinalImpact = "none"
    g: GrievanceShift = "none"
    o: OrdinalImpact = "none"

    if any(k in low for k in ("betray", "unforgiv", "stole", "attacked", "poison")):
        t = "strong_neg"
        w = "strong_neg"
        g = "grave_wrong"
    elif any(k in low for k in ("distrust", "suspici", "wary", "annoy", "irritat", "cold", "resent")):
        t = "mild_neg"
        w = "mild_neg"
        g = "slighted" if "resent" in low or "insult" in low else "none"
    elif any(k in low for k in ("saved", "loyal", "deeply grateful", "bonded", "trusted ally")):
        t = "strong_pos"
        w = "strong_pos"
    elif any(k in low for k in ("warm", "trust", "fond", "appreciat", "grateful", "friendly")):
        t = "mild_pos"
        w = "mild_pos"

    if any(k in low for k in ("impress", "respect", "admire", "capable")):
        r = "mild_pos"
    elif any(k in low for k in ("contempt", "disdain", "pathetic", "incompetent")):
        r = "mild_neg"

    if any(k in low for k in ("life-debt", "owes a major", "heavily indebted")):
        o = "strong_pos"
    elif any(k in low for k in ("owes a favor", "indebted")):
        o = "mild_pos"

    return RelationalEventSpec(
        target=target_id,
        warmth_shift=w,
        respect_shift=r,
        trust_shift=t,
        grievance_shift=g,
        obligation_shift=o,
        note=stance_text[:160],
    )


def normalize_relational_events(
    raw_events: Sequence[RelationalEventSpec],
    legacy_stance_updates: Mapping[str, str],
    *,
    self_id: str,
    self_name: str,
    persona_name: str | None,
    allowed_target_ids: set[str],
    visibility_ceiling: Mapping[str, VisibilityScope],
    character_name_map: Mapping[str, str] | None = None,
) -> list[tuple[RelationalEventSpec, VisibilityScope]]:
    """Canonicalize Persona name -> 'user', strip self/__narrator__/absent targets, clamp visibility."""
    by_target: dict[str, RelationalEventSpec] = {}

    for ev in raw_events:
        canon = _canonicalize_target_token(
            ev.target,
            self_id=self_id,
            self_name=self_name,
            persona_name=persona_name,
            allowed_target_ids=allowed_target_ids,
            character_name_map=character_name_map,
        )
        if canon is None:
            continue
        by_target[canon] = ev.model_copy(update={"target": canon})

    # Fallback synthesis for older custom PromptPresets or tests emitting only stance_updates
    for raw_key, raw_note in (legacy_stance_updates or {}).items():
        canon = _canonicalize_target_token(
            raw_key,
            self_id=self_id,
            self_name=self_name,
            persona_name=persona_name,
            allowed_target_ids=allowed_target_ids,
            character_name_map=character_name_map,
        )
        if canon is None:
            continue
        if canon not in by_target:
            by_target[canon] = _synthesize_event_from_legacy_stance(canon, raw_note)
        elif not by_target[canon].note and raw_note.strip():
            by_target[canon] = by_target[canon].model_copy(
                update={"note": raw_note.strip()[:160]}
            )

    results: list[tuple[RelationalEventSpec, VisibilityScope]] = []
    for target_id, spec in by_target.items():
        scope = visibility_ceiling.get(target_id, "public_room")
        results.append((spec, scope))
    return results


# ---------------------------------------------------------------------------
# Phase 5 Post-Turn CARE Solver & Co-Present Witness Coupling
# ---------------------------------------------------------------------------


def _apply_worldview_memory_shifts(
    worldview: WorldviewProfile,
    memories: Sequence[ExtractedCharacterMemory],
) -> tuple[WorldviewProfile, set[str], bool]:
    """Apply tectonic Layer 1 shifts from transformative extracted memories.

    Returns (updated_worldview, consolidated_shift_categories, has_shock_memory).
    """
    ben = worldview.benevolence
    bel = worldview.belonging
    age = worldview.agency
    categories: set[str] = set()
    has_shock = False

    for mem in memories:
        sig = mem.significance
        weight_scale = _clamp(mem.emotional_weight, 0.5, 1.0)
        categories.add(sig)
        if sig == "trauma":
            ben -= 0.08 * weight_scale
            age -= 0.06 * weight_scale
            has_shock = True
        elif sig == "betrayal":
            ben -= 0.10 * weight_scale
            bel -= 0.08 * weight_scale
            has_shock = True
        elif sig == "bonding":
            ben += 0.08 * weight_scale
            bel += 0.10 * weight_scale
        elif sig == "vow":
            age += 0.08 * weight_scale
            bel += 0.05 * weight_scale
        elif sig == "revelation":
            age += 0.04 * weight_scale

    return (
        WorldviewProfile(
            benevolence=round(_clamp(ben, -1.0, 1.0), 4),
            belonging=round(_clamp(bel, -1.0, 1.0), 4),
            agency=round(_clamp(age, -1.0, 1.0), 4),
        ),
        categories,
        has_shock,
    )


def _observation_pad_from_delta(
    prior: AffectiveCareState,
    delta: CharacterAgentDelta,
    cognition_impulse: CategoricalFeelingImpulse | None,
) -> tuple[float, float, float]:
    """Derive observation z_t in [-1,1] x [0,1] x [-1,1] with legacy PromptPreset fallback."""
    if delta.affect_tone is not None:
        v_obs = TONE_TO_VALENCE[delta.affect_tone]
    elif abs(delta.valence_delta) > 1e-4:
        v_obs = _clamp(prior.valence + 2.2 * delta.valence_delta, -1.0, 1.0)
    elif cognition_impulse is not None:
        v_obs = (
            cognition_impulse.legacy_valence
            if (
                cognition_impulse.used_legacy_float_fallback
                and cognition_impulse.legacy_valence is not None
            )
            else TONE_TO_VALENCE[cognition_impulse.tone]
        )
    else:
        v_obs = prior.valence

    if delta.affect_intensity is not None:
        a_obs = INTENSITY_TO_AROUSAL[delta.affect_intensity]
    elif abs(delta.arousal_delta) > 1e-4:
        a_obs = _clamp(prior.arousal + 2.0 * delta.arousal_delta, 0.0, 1.0)
    elif cognition_impulse is not None:
        a_obs = (
            cognition_impulse.legacy_arousal
            if (
                cognition_impulse.used_legacy_float_fallback
                and cognition_impulse.legacy_arousal is not None
            )
            else INTENSITY_TO_AROUSAL[cognition_impulse.intensity]
        )
    else:
        a_obs = prior.arousal

    if delta.affect_agency is not None:
        d_obs = AGENCY_TO_DOMINANCE[delta.affect_agency]
    elif cognition_impulse is not None:
        d_obs = AGENCY_TO_DOMINANCE[cognition_impulse.agency]
    else:
        d_obs = prior.dominance

    return (v_obs, a_obs, d_obs)


_SEVERE_RUPTURE_NOTE_KEYWORDS: Final[tuple[str, ...]] = (
    "betray",
    "stole",
    "stolen",
    "seiz",
    "attack",
    "shot",
    "shoot",
    "stab",
    "poison",
    "sabotag",
    "strand",
    "kill",
    "murder",
    "lied",
    "sold",
    "threaten",
    "ambush",
    "robbed",
    "wrench",
    "snatch",
    "hostil",
    "cruel",
)


def _has_explicit_affect_observation(
    delta: CharacterAgentDelta,
    cognition_impulse: CategoricalFeelingImpulse | None,
    signals: MechanicalTurnSignals,
    is_shock: bool,
) -> bool:
    """Return True when the turn provides an explicit affective observation for the Kalman filter."""
    return (
        delta.affect_tone is not None
        or delta.affect_intensity is not None
        or delta.affect_agency is not None
        or abs(delta.valence_delta) > 1e-4
        or abs(delta.arousal_delta) > 1e-4
        or cognition_impulse is not None
        or signals.roll_outcome is not None
        or is_shock
    )


def _compute_turn_salience(
    *,
    delta: CharacterAgentDelta,
    cognition_impulse: CategoricalFeelingImpulse | None,
    signals: MechanicalTurnSignals,
    is_shock: bool,
    has_memories: bool,
    tau_obs: float,
    alpha_surp: float,
) -> float:
    """Estimate turn affective salience in [0.10, 1.00] to gate non-shock PAD slew velocity."""
    if is_shock:
        return 1.0
    roll_sal = 0.0
    if signals.roll_outcome in ("Failure with Consequences", "Clean Success"):
        roll_sal = 0.55
    elif signals.roll_outcome == "Simple Failure":
        roll_sal = 0.35

    eff_intensity = (
        delta.affect_intensity
        or (cognition_impulse.intensity if cognition_impulse is not None else None)
    )
    int_sal = (
        0.65
        if eff_intensity == "extreme"
        else (0.40 if eff_intensity == "high" else 0.0)
    )
    eff_tone = (
        delta.affect_tone
        or (cognition_impulse.tone if cognition_impulse is not None else None)
    )
    tone_sal = 0.50 if eff_tone in ("anguished", "hostile", "elated") else 0.0
    mem_sal = 0.65 if has_memories else 0.0
    rel_sal = (
        0.65
        if any(
            ev.warmth_shift in ("strong_neg", "strong_pos")
            or ev.trust_shift in ("strong_neg", "strong_pos")
            or ev.grievance_shift in ("grave_wrong", "reconciled")
            for ev in delta.relational_events
        )
        else 0.0
    )
    return _clamp(
        max(
            0.10,
            roll_sal,
            tau_obs * 0.85,
            alpha_surp * 0.85,
            int_sal,
            tone_sal,
            mem_sal,
            rel_sal,
        ),
        0.10,
        1.0,
    )


def _apply_salience_slew_bound(
    prior_pad: tuple[float, float, float],
    raw_pad: tuple[float, float, float],
    resting_tilde: tuple[float, float, float],
    *,
    salience: float,
    is_shock: bool,
) -> tuple[float, float, float]:
    """Bound single-turn PAD step velocity on low-salience turns with a homeostatic return exemption."""
    if is_shock or salience >= 0.95:
        return raw_pad

    base_max = 0.09 + 0.51 * salience  # 0.141 at S=0.10, up to 0.60 at S=1.0
    rest_pad = (
        resting_tilde[0],
        _tilde_to_arousal(resting_tilde[1]),
        resting_tilde[2],
    )
    bounded: list[float] = []
    for idx in range(3):
        p_val = prior_pad[idx]
        r_val = raw_pad[idx]
        diff = r_val - p_val
        scale = 0.55 if idx == 1 else 1.0
        axis_max = base_max * scale
        moving_to_rest = abs(r_val - rest_pad[idx]) < abs(p_val - rest_pad[idx])
        if moving_to_rest:
            axis_max = max(axis_max, 0.22 * scale)
        if abs(diff) > axis_max:
            r_val = p_val + math.copysign(axis_max, diff)
        lo = 0.0 if idx == 1 else -1.0
        bounded.append(round(_clamp(r_val, lo, 1.0), 4))
    return (bounded[0], bounded[1], bounded[2])


def _corroborate_relational_event_severity(
    spec: RelationalEventSpec,
    *,
    delta: CharacterAgentDelta,
    cognition_impulse: CategoricalFeelingImpulse | None,
    is_shock: bool,
    tau_obs: float,
    alpha_surp: float,
) -> RelationalEventSpec:
    """Soften uncorroborated strong_neg / grave_wrong LLM over-classifications in calm banter."""
    has_severe_neg = (
        spec.warmth_shift == "strong_neg"
        or spec.trust_shift == "strong_neg"
        or spec.respect_shift == "strong_neg"
        or spec.grievance_shift == "grave_wrong"
    )
    if not has_severe_neg:
        return spec

    eff_tone = (
        delta.affect_tone
        or (cognition_impulse.tone if cognition_impulse is not None else None)
    )
    eff_intensity = (
        delta.affect_intensity
        or (cognition_impulse.intensity if cognition_impulse is not None else None)
    )
    note_low = spec.note.lower()
    is_corroborated = (
        is_shock
        or tau_obs >= 0.45
        or alpha_surp >= 0.75
        or eff_tone in ("hostile", "anguished", "bitter")
        or eff_intensity in ("high", "extreme")
        or any(k in note_low for k in _SEVERE_RUPTURE_NOTE_KEYWORDS)
    )
    if is_corroborated:
        return spec

    return spec.model_copy(
        update={
            "warmth_shift": "mild_neg" if spec.warmth_shift == "strong_neg" else spec.warmth_shift,
            "trust_shift": "mild_neg" if spec.trust_shift == "strong_neg" else spec.trust_shift,
            "respect_shift": "mild_neg" if spec.respect_shift == "strong_neg" else spec.respect_shift,
            "grievance_shift": "slighted" if spec.grievance_shift == "grave_wrong" else spec.grievance_shift,
        }
    )


def resolve_post_turn_care_state(
    committed_prior: AffectiveCareState,
    *,
    psyche: BaselinePsyche,
    delta: CharacterAgentDelta,
    cognition_impulse: CategoricalFeelingImpulse | None,
    signals: MechanicalTurnSignals,
    turn_elapsed_minutes: int,
    target_elapsed_minutes: int,
    self_id: str,
    self_name: str,
    persona_name: str | None,
    allowed_target_ids: set[str],
    character_name_map: Mapping[str, str] | None = None,
) -> tuple[AffectiveCareState, list[ResolvedWitnessEvent]]:
    """Full Phase 5 update: OU step + Composure + Kalman + Gottman + Worldview memory nudges."""
    # First catch up any prior off-screen idle gap up to the start of this turn
    turn_dt = max(0, int(turn_elapsed_minutes))
    turn_start_minute = max(
        committed_prior.state_elapsed_minutes,
        max(0, int(target_elapsed_minutes)) - turn_dt,
    )
    base_state = project_care_to_minute(
        committed_prior,
        target_elapsed_minutes=turn_start_minute,
        psyche=psyche,
    )

    # 1. Layer 1: Transformative Memory Worldview shifts
    all_memories = list(delta.new_memories) + list(signals.extracted_memories)
    # Deduplicate by title if same memory passed in both lists
    dedup_memories: list[ExtractedCharacterMemory] = []
    seen_titles: set[str] = set()
    for m in all_memories:
        t_key = m.title.strip().lower()
        if t_key and t_key not in seen_titles:
            seen_titles.add(t_key)
            dedup_memories.append(m)

    new_worldview, mem_categories, has_shock_mem = _apply_worldview_memory_shifts(
        base_state.active_worldview, dedup_memories
    )

    # 2. Layer 3: Asymmetric Tactical Appraisal (instant attack, exponential time decay)
    eff_threat_level = (
        cognition_impulse.threat
        if (
            "scene_threat" not in delta.model_fields_set
            and delta.scene_threat == "none"
            and cognition_impulse is not None
        )
        else delta.scene_threat
    )
    eff_coping_level = (
        cognition_impulse.coping
        if (
            "scene_coping" not in delta.model_fields_set
            and delta.scene_coping == "adequate"
            and cognition_impulse is not None
        )
        else delta.scene_coping
    )
    tau_obs = THREAT_TO_TAU[eff_threat_level]
    kappa_obs = COPING_TO_KAPPA[eff_coping_level]
    gamma_goal = ORDINAL_TO_GOAL_CONGRUENCE[delta.goal_congruence]
    alpha_surp = INTENSITY_TO_AMBIGUITY[delta.scene_surprise]

    dt_eff = max(1, turn_dt)
    phi_app = math.exp(-LAMBDA_APPRAISAL_DECAY * dt_eff)
    prior_app = base_state.appraisal

    tau = (
        tau_obs
        if tau_obs >= prior_app.threat
        else (tau_obs + (prior_app.threat - tau_obs) * phi_app)
    )
    amb_new = (
        alpha_surp
        if alpha_surp >= prior_app.ambiguity
        else (alpha_surp + (prior_app.ambiguity - alpha_surp) * phi_app)
    )
    if kappa_obs <= prior_app.coping or tau < 0.20:
        kappa = kappa_obs
    else:
        phi_cop = math.exp(-LAMBDA_APPRAISAL_DECAY * max(dt_eff, 6))
        kappa = kappa_obs + (prior_app.coping - kappa_obs) * phi_cop

    new_appraisal = SituationalAppraisal(
        threat=round(tau, 4),
        coping=round(kappa, 4),
        goal_congruence=round(gamma_goal, 4),
        ambiguity=round(amb_new, 4),
    )

    # 3. Layer 2: Composure & Discretized OU-Kalman Mood Filter
    u_mech, roll_shock_drain, is_roll_shock = _mechanical_roll_impulse(signals.roll_outcome)
    seizure_shock = 0.10 if signals.seized_from_me_by else 0.0
    is_shock = is_roll_shock or has_shock_mem or bool(signals.seized_from_me_by)

    new_composure = update_composure_step(
        base_state.composure,
        threat=tau,
        coping=kappa,
        dt_minutes=turn_dt,
        composure_resilience=psyche.temperament.composure_resilience,
        shock_drain=roll_shock_drain + seizure_shock,
    )

    resting_tilde = _resting_pad_baseline(psyche, new_worldview)
    if not _has_explicit_affect_observation(delta, cognition_impulse, signals, is_shock):
        ou_only = project_care_to_minute(
            base_state.model_copy(update={"active_worldview": new_worldview}),
            target_elapsed_minutes=base_state.state_elapsed_minutes + turn_dt,
            psyche=psyche,
        )
        new_pad = (ou_only.valence, ou_only.arousal, ou_only.dominance)
        new_variance = ou_only.mood_variance
    else:
        obs_pad = _observation_pad_from_delta(base_state, delta, cognition_impulse)
        raw_pad, new_variance, _ = kalman_mood_step(
            prior_pad=(base_state.valence, base_state.arousal, base_state.dominance),
            prior_variance=base_state.mood_variance,
            resting_pad_tilde=resting_tilde,
            observation_pad=obs_pad,
            composure=new_composure,
            composure_resilience=psyche.temperament.composure_resilience,
            dt_minutes=turn_dt,
            mech_impulse_tilde=u_mech,
            is_shock_rupture=is_shock,
        )
        salience = _compute_turn_salience(
            delta=delta,
            cognition_impulse=cognition_impulse,
            signals=signals,
            is_shock=is_shock,
            has_memories=bool(dedup_memories),
            tau_obs=tau_obs,
            alpha_surp=alpha_surp,
        )
        new_pad = _apply_salience_slew_bound(
            (base_state.valence, base_state.arousal, base_state.dominance),
            raw_pad,
            resting_tilde,
            salience=salience,
            is_shock=is_shock,
        )

    # 4. Layer 4: Normalize relational events & fuse mechanical item seizures
    vis_ceiling = signals.visibility_ceiling_by_target or {}
    raw_events = list(delta.relational_events)
    existing_targets = {ev.target for ev in raw_events}
    for winner_id in signals.seized_from_me_by:
        if winner_id and winner_id != "none" and winner_id != self_id:
            if winner_id not in existing_targets:
                raw_events.append(
                    RelationalEventSpec(
                        target=winner_id,
                        warmth_shift="mild_neg",
                        trust_shift="strong_neg",
                        power_shift="mild_neg",
                        grievance_shift="grave_wrong",
                        note="Forcibly took custody of a contested item against my will.",
                    )
                )

    normalized = normalize_relational_events(
        raw_events,
        delta.stance_updates,
        self_id=self_id,
        self_name=self_name,
        persona_name=persona_name,
        allowed_target_ids=allowed_target_ids,
        visibility_ceiling=vis_ceiling,
        character_name_map=character_name_map,
    )

    relations = {k: v.model_copy() for k, v in base_state.relations.items()}
    if "user" not in relations and "user" in allowed_target_ids:
        relations["user"] = build_stranger_edge("user", new_worldview)

    witness_events: list[ResolvedWitnessEvent] = []
    consolidate_anchor = bool(mem_categories & {"bonding", "betrayal", "vow"})

    for spec, scope in normalized:
        tid = spec.target
        corroborated_spec = _corroborate_relational_event_severity(
            spec,
            delta=delta,
            cognition_impulse=cognition_impulse,
            is_shock=is_shock,
            tau_obs=tau_obs,
            alpha_surp=alpha_surp,
        )
        prior_edge = relations.get(tid) or build_stranger_edge(tid, new_worldview)
        updated_edge, (u_w, u_r, u_t) = apply_gottman_relational_event(
            prior_edge, corroborated_spec, psyche.temperament
        )
        if consolidate_anchor:
            updated_edge = updated_edge.model_copy(
                update={
                    "consolidated_warmth": round(
                        0.40 * updated_edge.consolidated_warmth + 0.60 * updated_edge.warmth,
                        4,
                    ),
                    "consolidated_trust": round(
                        0.40 * updated_edge.consolidated_trust + 0.60 * updated_edge.trust,
                        4,
                    ),
                }
            )
        relations[tid] = updated_edge

        # Only public_room interactions enter bystander witness coupling!
        # In CharacterAgentDelta, `self_id` is evaluating how `tid` (actor) treated `self_id` (target).
        if scope == "public_room" and (
            abs(u_w) > 1e-4 or abs(u_r) > 1e-4 or abs(u_t) > 1e-4
        ):
            witness_events.append(
                ResolvedWitnessEvent(
                    actor_id=tid,
                    target_id=self_id,
                    warmth_stimulus=u_w,
                    respect_stimulus=u_r,
                    trust_stimulus=u_t,
                )
            )

    final_elapsed = max(turn_start_minute + turn_dt, int(target_elapsed_minutes))
    preferred_label = (
        delta.mood_label.strip()
        if (
            delta.mood_label
            and delta.mood_label.strip()
            and delta.mood_label.strip() != "Observant and composed"
        )
        else None
    )

    committed = AffectiveCareState(
        schema_version=1,
        is_provisional=False,
        state_elapsed_minutes=max(0, final_elapsed),
        valence=new_pad[0],
        arousal=new_pad[1],
        dominance=new_pad[2],
        composure=new_composure,
        mood_variance=new_variance,
        active_emotion=base_state.active_emotion,
        active_worldview=new_worldview,
        appraisal=new_appraisal,
        relations=relations,
    )
    return (
        _refresh_derived_care_fields(committed, preferred_mood_label=preferred_label),
        witness_events,
    )


def apply_co_present_witness_coupling(
    states_by_char: Mapping[str, AffectiveCareState],
    *,
    psyches_by_char: Mapping[str, BaselinePsyche],
    public_events: Sequence[ResolvedWitnessEvent],
    co_present_throughout_ids: set[str],
) -> dict[str, AffectiveCareState]:
    """Apply smooth tanh(2*W_ki) + moral worldview coupling strictly across co_present_throughout_ids."""
    out: dict[str, AffectiveCareState] = {
        cid: st.model_copy(deep=True) for cid, st in states_by_char.items()
    }
    if not public_events or len(co_present_throughout_ids) < 2:
        return out

    for ev in public_events:
        # Both actor and target must be publicly observable in this room throughout the turn
        actor_present = ev.actor_id == "user" or ev.actor_id in co_present_throughout_ids
        target_present = ev.target_id == "user" or ev.target_id in co_present_throughout_ids
        if not (actor_present and target_present):
            continue

        for witness_id in co_present_throughout_ids:
            if witness_id in (ev.actor_id, ev.target_id):
                continue
            w_state = out.get(witness_id)
            w_psyche = psyches_by_char.get(witness_id)
            if w_state is None or w_psyche is None:
                continue

            temp = w_psyche.temperament
            one_minus_r = 1.0 - temp.relational_inertia

            edge_to_target = w_state.relations.get(ev.target_id)
            w_ki = edge_to_target.warmth if edge_to_target is not None else 0.0
            ally_alignment = math.tanh(2.0 * w_ki)
            ben_k = max(0.0, w_state.active_worldview.benevolence)

            edge_to_actor = w_state.relations.get(ev.actor_id) or build_stranger_edge(
                ev.actor_id, w_state.active_worldview
            )
            _, theta_neg, theta_pos = gottman_effective_thresholds(edge_to_actor, temp)
            s_pos = GOTTMAN_BASE_POS_SLOPE
            s_neg = GOTTMAN_BASE_POS_SLOPE * temp.negativity_ratio

            inf_w = _gottman_influence(
                ev.warmth_stimulus,
                theta_neg=theta_neg,
                theta_neg_base=temp.theta_neg_base,
                theta_pos=theta_pos,
                s_pos=s_pos,
                s_neg=s_neg,
            )
            moral_penalty = (
                WITNESS_MORAL_MU * ben_k * ev.warmth_stimulus
                if ev.warmth_stimulus < temp.theta_neg_base
                else 0.0
            )
            dw_witness = one_minus_r * (WITNESS_ALLY_MU * ally_alignment * inf_w + moral_penalty)

            inf_t = _gottman_influence(
                ev.trust_stimulus,
                theta_neg=theta_neg,
                theta_neg_base=temp.theta_neg_base,
                theta_pos=theta_pos,
                s_pos=s_pos,
                s_neg=s_neg,
            )
            moral_trust_pen = (
                WITNESS_MORAL_MU * ben_k * ev.trust_stimulus
                if ev.trust_stimulus < temp.theta_neg_base
                else 0.0
            )
            dt_witness = one_minus_r * (
                0.35 * ally_alignment * inf_t + moral_trust_pen
            )

            # Public competence/disgrace shifts witness respect directly (independent of alliance)
            dr_witness = one_minus_r * 0.35 * ev.respect_stimulus

            if abs(dw_witness) < 1e-5 and abs(dt_witness) < 1e-5 and abs(dr_witness) < 1e-5:
                continue

            updated_actor_edge = edge_to_actor.model_copy(
                update={
                    "warmth": round(_weber_fechner_step(edge_to_actor.warmth, dw_witness), 4),
                    "trust": round(_weber_fechner_step(edge_to_actor.trust, dt_witness), 4),
                    "respect": round(_weber_fechner_step(edge_to_actor.respect, dr_witness), 4),
                }
            )
            new_rels = dict(w_state.relations)
            new_rels[ev.actor_id] = updated_actor_edge
            out[witness_id] = _refresh_derived_care_fields(
                w_state.model_copy(update={"relations": new_rels}),
                preferred_mood_label=w_state.short_mood_label,
            )

    return out
