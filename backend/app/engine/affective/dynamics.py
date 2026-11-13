"""Continuous decay, Kalman mood updates, composure masking, and Gottman steps."""

from __future__ import annotations

import math

from app.schemas.affective import (
    AffectiveCareState,
    CategoricalFeelingImpulse,
    INTENSITY_TO_AROUSAL,
    RelationalEdge,
    RelationalEventSpec,
    TONE_TO_VALENCE,
    TemperamentConfig,
)
from app.schemas.character import BaselinePsyche
from app.schemas.turn import CanonicalOutcomeTier

from app.engine.affective.hydration import _refresh_derived_care_fields
from app.engine.affective.models import (
    AGENCY_TO_DOMINANCE,
    COMPOSURE_DAMPER_BETA,
    COMPOSURE_STRAIN_ETA,
    COPING_TO_KAPPA,
    GOTTMAN_BASE_POS_SLOPE,
    GOTTMAN_OVERRIDE_GAMMA,
    GRIEVANCE_BASE_GAIN,
    GRIEVANCE_TO_STIMULUS,
    LAMBDA_APPRAISAL_DECAY,
    LAMBDA_AROUSAL,
    LAMBDA_BOND_CONSOLIDATION,
    LAMBDA_COMPOSURE_REST,
    LAMBDA_DOMINANCE,
    LAMBDA_VALENCE,
    ORDINAL_TO_OBLIGATION_DELTA,
    ORDINAL_TO_STIMULUS,
    Q_TURN_ENGAGED,
    R_BASE_NOISE,
    SHOCK_BYPASS_PSI,
    SIGMA_STAT,
    THREAT_TO_TAU,
    _arousal_to_tilde,
    _clamp,
    _mechanical_roll_impulse,
    _resting_pad_baseline,
    _tilde_to_arousal,
)

# ---------------------------------------------------------------------------
# Pure Mathematical Steppers (OU Clock Catch-Up, Kalman, Composure, Gottman)
# ---------------------------------------------------------------------------


def project_care_to_minute(
    care_state: AffectiveCareState,
    *,
    target_elapsed_minutes: int,
    psyche: BaselinePsyche,
) -> AffectiveCareState:
    """Strictly idempotent OU clock catch-up & safe-rest composure recovery over Δt >= 0."""
    target = max(0, int(target_elapsed_minutes))
    dt = max(0, target - care_state.state_elapsed_minutes)
    if dt == 0:
        return care_state

    v_base, a_base, d_base = _resting_pad_baseline(psyche, care_state.active_worldview)
    phi_v = math.exp(-LAMBDA_VALENCE * dt)
    phi_a = math.exp(-LAMBDA_AROUSAL * dt)
    phi_d = math.exp(-LAMBDA_DOMINANCE * dt)

    v_pred = _clamp(v_base + phi_v * (care_state.valence - v_base), -1.0, 1.0)
    a_tilde_prev = _arousal_to_tilde(care_state.arousal)
    a_tilde_pred = _clamp(a_base + phi_a * (a_tilde_prev - a_base), -1.0, 1.0)
    a_pred = _tilde_to_arousal(a_tilde_pred)
    d_pred = _clamp(d_base + phi_d * (care_state.dominance - d_base), -1.0, 1.0)

    p_v0, p_a0, p_d0 = care_state.mood_variance
    p_v = (phi_v * phi_v) * p_v0 + SIGMA_STAT[0] * (1.0 - phi_v * phi_v)
    p_a = (phi_a * phi_a) * p_a0 + SIGMA_STAT[1] * (1.0 - phi_a * phi_a)
    p_d = (phi_d * phi_d) * p_d0 + SIGMA_STAT[2] * (1.0 - phi_d * phi_d)

    # Decay acute tactical threat & surprise over unengaged elapsed time
    phi_app = math.exp(-LAMBDA_APPRAISAL_DECAY * dt)
    new_threat = round(care_state.appraisal.threat * phi_app, 4)
    new_ambiguity = round(care_state.appraisal.ambiguity * phi_app, 4)
    new_appraisal = care_state.appraisal.model_copy(
        update={"threat": new_threat, "ambiguity": new_ambiguity}
    )

    # Exact semigroup rest recovery when scene threat is calm or rest span is substantive
    if care_state.appraisal.threat < 0.25 or dt >= 30:
        c_new = _clamp(
            1.0 - (1.0 - care_state.composure) * math.exp(-LAMBDA_COMPOSURE_REST * dt),
            0.0,
            1.0,
        )
    else:
        c_new = care_state.composure

    # Ultra-slow 14-day plastic consolidation over multi-day separations (> 24h)
    relations = dict(care_state.relations)
    if dt > 1440:
        phi_bond = math.exp(-LAMBDA_BOND_CONSOLIDATION * dt)
        for tid, edge in relations.items():
            w_rel = edge.consolidated_warmth + phi_bond * (
                edge.warmth - edge.consolidated_warmth
            )
            t_rel = edge.consolidated_trust + phi_bond * (
                edge.trust - edge.consolidated_trust
            )
            relations[tid] = edge.model_copy(
                update={
                    "warmth": round(_clamp(w_rel, -1.0, 1.0), 4),
                    "trust": round(_clamp(t_rel, -1.0, 1.0), 4),
                }
            )

    projected = care_state.model_copy(
        update={
            "is_provisional": False,
            "state_elapsed_minutes": target,
            "valence": round(v_pred, 4),
            "arousal": round(a_pred, 4),
            "dominance": round(d_pred, 4),
            "composure": round(c_new, 4),
            "mood_variance": (round(p_v, 6), round(p_a, 6), round(p_d, 6)),
            "appraisal": new_appraisal,
            "relations": relations,
        }
    )
    max_pad_drift = max(
        abs(v_pred - care_state.valence),
        abs(a_pred - care_state.arousal),
        abs(d_pred - care_state.dominance),
    )
    dist_to_rest = max(
        abs(v_pred - v_base),
        abs(_arousal_to_tilde(a_pred) - a_base),
        abs(d_pred - d_base),
    )
    if max_pad_drift < 0.03:
        pref_label: str | None = care_state.short_mood_label
    elif dist_to_rest < 0.05 and psyche.mood_label:
        pref_label = psyche.mood_label
    else:
        pref_label = None

    return _refresh_derived_care_fields(projected, preferred_mood_label=pref_label)


def kalman_mood_step(
    *,
    prior_pad: tuple[float, float, float],
    prior_variance: tuple[float, float, float],
    resting_pad_tilde: tuple[float, float, float],
    observation_pad: tuple[float, float, float],
    composure: float,
    composure_resilience: float,
    dt_minutes: int,
    mech_impulse_tilde: tuple[float, float, float] = (0.0, 0.0, 0.0),
    is_shock_rupture: bool = False,
) -> tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]:
    """Execute one discretized OU-Kalman prediction + measurement step.

    Returns ((valence, arousal, dominance), new_variance, kalman_gains).
    """
    dt = max(0, int(dt_minutes))
    phis = (
        math.exp(-LAMBDA_VALENCE * dt),
        math.exp(-LAMBDA_AROUSAL * dt),
        math.exp(-LAMBDA_DOMINANCE * dt),
    )
    x_prev = (
        prior_pad[0],
        _arousal_to_tilde(prior_pad[1]),
        prior_pad[2],
    )
    z_obs = (
        observation_pad[0],
        _arousal_to_tilde(observation_pad[1]),
        observation_pad[2],
    )

    psi = SHOCK_BYPASS_PSI if is_shock_rupture else 1.0
    # Bound effective resilience scaling so steady-state gain stays responsive (> 0.12)
    eff_beta = COMPOSURE_DAMPER_BETA * _clamp(composure_resilience, 0.5, 1.8)

    x_post: list[float] = []
    p_post: list[float] = []
    gains: list[float] = []

    for idx in range(3):
        phi = phis[idx]
        x_base = resting_pad_tilde[idx]
        x_pred = _clamp(
            x_base + phi * (x_prev[idx] - x_base) + mech_impulse_tilde[idx],
            -1.0,
            1.0,
        )
        p_pred = (
            (phi * phi) * prior_variance[idx]
            + SIGMA_STAT[idx] * (1.0 - phi * phi)
            + Q_TURN_ENGAGED[idx]
        )
        r_eff = (R_BASE_NOISE[idx] * (1.0 + eff_beta * composure)) / psi
        k_gain = p_pred / (p_pred + r_eff)
        x_upd = _clamp(x_pred + k_gain * (z_obs[idx] - x_pred), -1.0, 1.0)
        p_upd = max(1e-5, (1.0 - k_gain) * p_pred)

        x_post.append(x_upd)
        p_post.append(round(p_upd, 6))
        gains.append(round(k_gain, 6))

    new_pad = (
        round(x_post[0], 4),
        round(_tilde_to_arousal(x_post[1]), 4),
        round(x_post[2], 4),
    )
    return (
        new_pad,
        (p_post[0], p_post[1], p_post[2]),
        (gains[0], gains[1], gains[2]),
    )


def update_composure_step(
    prior_composure: float,
    *,
    threat: float,
    coping: float,
    dt_minutes: int,
    composure_resilience: float,
    shock_drain: float = 0.0,
) -> float:
    """Apply log-capped acute turn strain and low-threat restorative recovery."""
    dt = max(0, int(dt_minutes))
    resilience = max(0.30, composure_resilience)
    strain_factor = 1.0 + math.log(1.0 + min(float(dt), 60.0) / 10.0)
    vulnerability = _clamp((1.0 - coping) * 0.5, 0.0, 1.0)
    drain = (
        (COMPOSURE_STRAIN_ETA / resilience) * threat * vulnerability * strain_factor
        + shock_drain
    )
    recover = (
        (1.0 - prior_composure) * (1.0 - math.exp(-LAMBDA_COMPOSURE_REST * max(dt, 1)))
        if threat < 0.25
        else 0.0
    )
    return round(_clamp(prior_composure - drain + recover, 0.0, 1.0), 4)


def gottman_effective_thresholds(
    edge: RelationalEdge,
    temperament: TemperamentConfig,
) -> tuple[float, float, float]:
    """Return (rapport_B, theta_neg_eff, theta_pos_eff) under Gottman Sentiment Override."""
    rapport = _clamp(
        0.45 * edge.trust
        + 0.35 * edge.warmth
        + 0.20 * edge.respect
        - 0.45 * edge.grievance,
        -1.0,
        1.0,
    )
    theta_pos = _clamp(
        temperament.theta_pos_base - GOTTMAN_OVERRIDE_GAMMA * rapport,
        0.05,
        0.50,
    )
    theta_neg = _clamp(
        temperament.theta_neg_base - GOTTMAN_OVERRIDE_GAMMA * rapport,
        -0.45,
        -0.03,
    )
    return (rapport, theta_neg, theta_pos)


def _gottman_influence(
    u: float,
    *,
    theta_neg: float,
    theta_neg_base: float,
    theta_pos: float,
    s_pos: float,
    s_neg: float,
) -> float:
    """Piecewise Gottman influence with strict I(0) == 0 dead-zone invariance.

    Severe ruptures (u <= -0.70) shatter Positive Sentiment Override buffering.
    """
    if u > theta_pos:
        return s_pos * (u - theta_pos)
    eff_theta_neg = max(theta_neg, theta_neg_base) if u <= -0.70 else theta_neg
    if u < eff_theta_neg:
        return s_neg * (u - eff_theta_neg)
    return 0.0


def _weber_fechner_step(
    current: float,
    delta: float,
    *,
    max_step: float = 0.88,
) -> float:
    """Asymmetric boundary-damped integration ('betrayal from a trusted ally cuts deepest')."""
    clamped_delta = _clamp(delta, -max_step, max_step)
    if clamped_delta >= 0.0:
        return _clamp(current + (1.0 - current) * clamped_delta, -1.0, 1.0)
    return _clamp(current + (1.0 + current) * clamped_delta, -1.0, 1.0)


def apply_gottman_relational_event(
    edge: RelationalEdge,
    event: RelationalEventSpec,
    temperament: TemperamentConfig,
) -> tuple[RelationalEdge, tuple[float, float, float]]:
    """Apply a single RelationalEventSpec to edge. Returns (updated_edge, (u_w, u_r, u_t))."""
    _, theta_neg, theta_pos = gottman_effective_thresholds(edge, temperament)
    one_minus_r = 1.0 - temperament.relational_inertia
    s_pos = GOTTMAN_BASE_POS_SLOPE
    s_neg = GOTTMAN_BASE_POS_SLOPE * temperament.negativity_ratio

    u_w = ORDINAL_TO_STIMULUS[event.warmth_shift]
    u_r = ORDINAL_TO_STIMULUS[event.respect_shift]
    u_t = ORDINAL_TO_STIMULUS[event.trust_shift]
    u_p = ORDINAL_TO_STIMULUS[event.power_shift]

    # Respect update first (since Proud Rival gates positive warmth by earned respect)
    inf_r = _gottman_influence(
        u_r,
        theta_neg=theta_neg,
        theta_neg_base=temperament.theta_neg_base,
        theta_pos=theta_pos,
        s_pos=s_pos,
        s_neg=s_neg * 0.75,
    )
    new_r = _weber_fechner_step(edge.respect, one_minus_r * inf_r, max_step=0.55)

    eff_u_w = u_w
    if temperament.archetype == "proud_rival" and u_w > 0.0 and new_r < 0.10:
        eff_u_w = u_w * 0.45  # Proud Rival resists warming to unproven peers

    inf_w = _gottman_influence(
        eff_u_w,
        theta_neg=theta_neg,
        theta_neg_base=temperament.theta_neg_base,
        theta_pos=theta_pos,
        s_pos=s_pos,
        s_neg=s_neg,
    )
    new_w = _weber_fechner_step(edge.warmth, one_minus_r * inf_w, max_step=0.55)

    inf_t = _gottman_influence(
        u_t,
        theta_neg=theta_neg,
        theta_neg_base=temperament.theta_neg_base,
        theta_pos=theta_pos,
        s_pos=s_pos,
        s_neg=s_neg,
    )
    new_t = _weber_fechner_step(edge.trust, one_minus_r * inf_t, max_step=0.55)

    # Power dynamic uses symmetric slope (leverage shifts directly without negativity bias)
    inf_p = _gottman_influence(
        u_p,
        theta_neg=-0.10,
        theta_neg_base=-0.10,
        theta_pos=0.10,
        s_pos=2.20,
        s_neg=2.20,
    )
    new_p = _weber_fechner_step(edge.power, one_minus_r * inf_p, max_step=0.55)

    # Orthogonal Grievance in [0, 1]
    u_g = GRIEVANCE_TO_STIMULUS[event.grievance_shift]
    new_g = edge.grievance
    if u_g < 0.0:
        g_inc = _clamp(one_minus_r * GRIEVANCE_BASE_GAIN * abs(u_g), 0.0, 0.90)
        new_g = _clamp(edge.grievance + (1.0 - edge.grievance) * g_inc, 0.0, 1.0)
    elif u_g > theta_pos:
        # Restitution only reduces grievance when it exceeds effective Gottman threshold!
        g_dec = _clamp((u_g - theta_pos) * 0.85, 0.0, 0.80)
        new_g = _clamp(edge.grievance * (1.0 - g_dec), 0.0, 1.0)

    # Orthogonal Obligation / Debt ledger in [-1, 1] (not blocked by hostility dead-zone!)
    d_o = ORDINAL_TO_OBLIGATION_DELTA[event.obligation_shift]
    new_o = _weber_fechner_step(edge.obligation, d_o) if d_o != 0.0 else edge.obligation

    note = event.note.strip()[:160] if event.note.strip() else edge.episodic_note

    updated = edge.model_copy(
        update={
            "warmth": round(new_w, 4),
            "respect": round(new_r, 4),
            "trust": round(new_t, 4),
            "power": round(new_p, 4),
            "grievance": round(new_g, 4),
            "obligation": round(new_o, 4),
            "episodic_note": note,
        }
    )
    return (updated, (u_w, u_r, u_t))


# ---------------------------------------------------------------------------
# Intra-Turn Preview (Phase 3 -> Phase 4)
# ---------------------------------------------------------------------------


def compute_provisional_cognition_preview(
    committed_care: AffectiveCareState,
    impulse: CategoricalFeelingImpulse,
    *,
    roll_outcome: CanonicalOutcomeTier | None = None,
    primary_target_id: str = "user",
) -> AffectiveCareState:
    """Non-destructive Phase 3 -> Phase 4 preview.

    Sets is_provisional=True and NEVER mutates mood_variance, relations,
    active_worldview, or state_elapsed_minutes.
    """
    v_obs = (
        impulse.legacy_valence
        if (impulse.used_legacy_float_fallback and impulse.legacy_valence is not None)
        else TONE_TO_VALENCE[impulse.tone]
    )
    a_obs = (
        impulse.legacy_arousal
        if (impulse.used_legacy_float_fallback and impulse.legacy_arousal is not None)
        else INTENSITY_TO_AROUSAL[impulse.intensity]
    )
    d_obs = AGENCY_TO_DOMINANCE[impulse.agency]
    tau = THREAT_TO_TAU[impulse.threat]
    kappa = COPING_TO_KAPPA[impulse.coping]

    u_mech, shock_drain, is_shock = _mechanical_roll_impulse(roll_outcome)
    blend = 0.52 if is_shock else (0.22 + 0.16 * (1.0 - committed_care.composure))

    v_prev = _clamp(
        committed_care.valence + blend * (v_obs - committed_care.valence) + u_mech[0],
        -1.0,
        1.0,
    )
    a_tilde_prev = _arousal_to_tilde(committed_care.arousal)
    a_tilde_obs = _arousal_to_tilde(a_obs)
    a_prev = _tilde_to_arousal(
        _clamp(a_tilde_prev + blend * (a_tilde_obs - a_tilde_prev) + u_mech[1], -1.0, 1.0)
    )
    d_prev = _clamp(
        committed_care.dominance + blend * (d_obs - committed_care.dominance) + u_mech[2],
        -1.0,
        1.0,
    )

    phi_app = math.exp(-LAMBDA_APPRAISAL_DECAY * 1.0)
    eff_tau = (
        tau
        if tau >= committed_care.appraisal.threat
        else (tau + (committed_care.appraisal.threat - tau) * phi_app)
    )
    c_prev = update_composure_step(
        committed_care.composure,
        threat=eff_tau,
        coping=kappa,
        dt_minutes=1,
        composure_resilience=1.0,
        shock_drain=shock_drain,
    )
    preview_appraisal = committed_care.appraisal.model_copy(
        update={
            "threat": round(eff_tau, 4),
            "coping": round(kappa, 4),
            "ambiguity": round(0.70 if is_shock else committed_care.appraisal.ambiguity, 4),
        }
    )

    preview = committed_care.model_copy(
        update={
            "is_provisional": True,
            "valence": round(v_prev, 4),
            "arousal": round(a_prev, 4),
            "dominance": round(d_prev, 4),
            "composure": round(c_prev, 4),
            # Strictly preserve committed variance, relations, worldview & clock!
            "mood_variance": committed_care.mood_variance,
            "relations": committed_care.relations,
            "active_worldview": committed_care.active_worldview,
            "state_elapsed_minutes": committed_care.state_elapsed_minutes,
            "appraisal": preview_appraisal,
        }
    )
    return _refresh_derived_care_fields(preview, primary_target_id=primary_target_id)
