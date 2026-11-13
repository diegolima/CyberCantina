"""Mathematical constants, dataclasses, and low-level CARE helpers."""

from __future__ import annotations

import math

from app.schemas.affective import (
    AgencyLevel,
    CopingLevel,
    GrievanceShift,
    IntensityLevel,
    OrdinalImpact,
    RelationalEdge,
    ThreatLevel,
    VisibilityScope,
    WorldviewProfile,
)
from app.schemas.character import BaselinePsyche
from app.schemas.turn import (
    CanonicalOutcomeTier,
    ExtractedCharacterMemory,
)
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

# ---------------------------------------------------------------------------
# Mathematical Constants
# ---------------------------------------------------------------------------

LN2: Final[float] = math.log(2.0)


# Mood OU decay rates (minutes^-1)
LAMBDA_VALENCE: Final[float] = LN2 / 360.0       # 6-hour half-life


LAMBDA_AROUSAL: Final[float] = LN2 / 45.0        # 45-minute half-life


LAMBDA_DOMINANCE: Final[float] = LN2 / 180.0     # 3-hour half-life


LAMBDA_COMPOSURE_REST: Final[float] = LN2 / 240.0  # 4-hour safe rest half-life


LAMBDA_APPRAISAL_DECAY: Final[float] = LN2 / 30.0  # 30-minute acute threat decay


LAMBDA_BOND_CONSOLIDATION: Final[float] = LN2 / (14.0 * 1440.0)  # 14-day anchor relaxation


# Stationary variance & per-turn interaction process floor (prevents K_t -> 0 senility)
SIGMA_STAT: Final[tuple[float, float, float]] = (0.12, 0.14, 0.12)


Q_TURN_ENGAGED: Final[tuple[float, float, float]] = (0.04, 0.06, 0.04)


R_BASE_NOISE: Final[tuple[float, float, float]] = (0.18, 0.15, 0.18)


COMPOSURE_DAMPER_BETA: Final[float] = 2.0


SHOCK_BYPASS_PSI: Final[float] = 3.5


COMPOSURE_STRAIN_ETA: Final[float] = 0.14


COMPOSURE_MASK_THRESHOLD: Final[float] = 0.35


# Gottman parameters
GOTTMAN_OVERRIDE_GAMMA: Final[float] = 0.25


GOTTMAN_BASE_POS_SLOPE: Final[float] = 1.35


GRIEVANCE_BASE_GAIN: Final[float] = 4.40


WITNESS_ALLY_MU: Final[float] = 0.45


WITNESS_MORAL_MU: Final[float] = 0.35


# ---------------------------------------------------------------------------
# Categorical -> Calibrated Numerical Mappings
# ---------------------------------------------------------------------------

INTENSITY_TO_AMBIGUITY: Final[dict[IntensityLevel, float]] = {
    "calm": 0.00,
    "low": 0.20,
    "moderate": 0.45,
    "high": 0.75,
    "extreme": 0.95,
}


AGENCY_TO_DOMINANCE: Final[dict[AgencyLevel, float]] = {
    "helpless": -0.85,
    "pressured": -0.42,
    "steady": 0.05,
    "assured": 0.48,
    "commanding": 0.85,
}


THREAT_TO_TAU: Final[dict[ThreatLevel, float]] = {
    "none": 0.00,
    "low": 0.20,
    "moderate": 0.45,
    "high": 0.75,
    "critical": 0.95,
}


COPING_TO_KAPPA: Final[dict[CopingLevel, float]] = {
    "overwhelmed": -0.85,
    "strained": -0.35,
    "adequate": 0.35,
    "mastery": 0.85,
}


ORDINAL_TO_GOAL_CONGRUENCE: Final[dict[OrdinalImpact, float]] = {
    "strong_neg": -0.85,
    "mild_neg": -0.35,
    "none": 0.00,
    "mild_pos": 0.35,
    "strong_pos": 0.85,
}


# Calibrated against Gottman Sentiment Override dead-zones:
# mild_pos (+0.20) builds rapport at neutral (theta_pos=0.15) but is blocked under
# Negative Sentiment Override (theta_pos_eff >= 0.30); strong_pos (+0.78) pierces it.
ORDINAL_TO_STIMULUS: Final[dict[OrdinalImpact, float]] = {
    "strong_neg": -0.82,
    "mild_neg": -0.22,
    "none": 0.00,
    "mild_pos": 0.20,
    "strong_pos": 0.78,
}


# Obligation is an explicit moral/social debt ledger (not gated by hostility dead-zone)
ORDINAL_TO_OBLIGATION_DELTA: Final[dict[OrdinalImpact, float]] = {
    "strong_neg": -0.68,
    "mild_neg": -0.22,
    "none": 0.00,
    "mild_pos": 0.22,
    "strong_pos": 0.68,
}


GRIEVANCE_TO_STIMULUS: Final[dict[GrievanceShift, float]] = {
    "reconciled": 0.72,   # Restitution / forgiveness (reduces G if > theta_pos_eff)
    "eased": 0.22,        # Minor apology (blocked when G is high & theta_pos_eff > 0.22!)
    "none": 0.00,
    "slighted": -0.30,    # Minor offense (increases G)
    "grave_wrong": -0.88,  # Major betrayal / injury (sharply increases G)
}


_USER_ALIASES: Final[frozenset[str]] = frozenset(
    {"user", "player", "protagonist", "the player", "the user", "you"}
)


_NARRATOR_ALIASES: Final[frozenset[str]] = frozenset(
    {"__narrator__", "narrator", "system", "gm", "director"}
)


@dataclass(frozen=True, slots=True)
class MechanicalTurnSignals:
    """Deterministic simulation ground-truth fused with LLM observations in Phase 5."""

    roll_outcome: CanonicalOutcomeTier | None = None
    seized_from_me_by: tuple[str, ...] = ()  # winner_ids from unrelinquished_transfer rulings
    extracted_memories: tuple[ExtractedCharacterMemory, ...] = ()
    visibility_ceiling_by_target: Mapping[str, VisibilityScope] | None = None


@dataclass(frozen=True, slots=True)
class ResolvedWitnessEvent:
    """Validated public-room interaction eligible for co-present witness coupling."""

    actor_id: str      # 'user' or character_id
    target_id: str     # 'user' or character_id
    warmth_stimulus: float
    respect_stimulus: float
    trust_stimulus: float


# ---------------------------------------------------------------------------
# Utility Clamps & Conversions
# ---------------------------------------------------------------------------


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def _arousal_to_tilde(arousal: float) -> float:
    """Map A in [0, 1] -> A_tilde in [-1, 1]."""
    return _clamp(2.0 * arousal - 1.0, -1.0, 1.0)


def _tilde_to_arousal(a_tilde: float) -> float:
    """Map A_tilde in [-1, 1] -> A in [0, 1]."""
    return _clamp(0.5 * (a_tilde + 1.0), 0.0, 1.0)


def _resting_pad_baseline(
    psyche: BaselinePsyche,
    worldview: WorldviewProfile,
) -> tuple[float, float, float]:
    """Compute resting [V_base, A_tilde_base, D_base] in [-1, 1]^3.

    psyche.valence already reflects psyche.initial_worldview at Turn 0; tectonic shifts in
    active_worldview.benevolence during campaign play shift V_base proportionally.
    """
    delta_ben = worldview.benevolence - psyche.initial_worldview.benevolence
    v_base = _clamp(psyche.valence + 0.20 * delta_ben, -0.85, 0.85)
    a_base = _arousal_to_tilde(psyche.arousal)
    d_base = _clamp(0.40 * worldview.agency, -0.85, 0.85)
    return (v_base, a_base, d_base)


def _mechanical_roll_impulse(
    roll_outcome: CanonicalOutcomeTier | None,
) -> tuple[tuple[float, float, float], float, bool]:
    """Return (u_mech_VAD, composure_shock_drain, is_shock_rupture) for a d20 outcome."""
    if roll_outcome == "Critical Failure":
        return ((-0.20, 0.35, -0.30), 0.18, True)
    if roll_outcome == "Failure with Consequences":
        return ((-0.10, 0.18, -0.15), 0.07, False)
    if roll_outcome == "Simple Failure":
        return ((-0.04, 0.06, -0.06), 0.02, False)
    if roll_outcome == "Clean Success":
        return ((0.08, 0.04, 0.10), 0.00, False)
    if roll_outcome == "Critical Success":
        return ((0.20, 0.15, 0.30), 0.00, True)
    return ((0.0, 0.0, 0.0), 0.0, False)


def build_stranger_edge(
    target_id: str,
    worldview: WorldviewProfile,
    *,
    episodic_note: str = "",
) -> RelationalEdge:
    """Initialize a newly encountered target edge from Layer 1 Benevolence & Agency priors."""
    w0 = round(_clamp(0.18 * worldview.benevolence, -0.35, 0.35), 4)
    t0 = round(_clamp(0.28 * worldview.benevolence, -0.45, 0.35), 4)
    p0 = round(_clamp(0.12 * worldview.agency, -0.25, 0.25), 4)
    return RelationalEdge(
        target_id=target_id,
        warmth=w0,
        respect=0.0,
        trust=t0,
        power=p0,
        grievance=0.0,
        obligation=0.0,
        consolidated_warmth=w0,
        consolidated_trust=t0,
        episodic_note=episodic_note[:160],
    )
