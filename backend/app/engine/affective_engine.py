"""CyberCantina Affective & Relational Engine (CARE v2.1).

Pure, deterministic mathematical psychology & lexical projection engine:
- Layer 1: Active Worldview (benevolence, belonging, agency)
- Layer 2: Discretized Ornstein-Uhlenbeck + Composure-gated Kalman Mood Filter (V, A, D, C)
- Layer 3: Situational Appraisal (threat, coping, goal_congruence, ambiguity)
- Layer 4: Two-Timescale Gottman Sentiment Override & Weber-Fechner Relational Matrix
- Symmetric Semantic Quantization: zero raw floats exposed to LLM prompts
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Final

from app.schemas.affective import (
    INTENSITY_TO_AROUSAL,
    TONE_TO_VALENCE,
    AgencyLevel,
    AffectiveCareState,
    CategoricalFeelingImpulse,
    CopingLevel,
    FeelingTone,
    GrievanceShift,
    IntensityLevel,
    OrdinalImpact,
    RelationalEdge,
    RelationalEventSpec,
    SituationalAppraisal,
    TemperamentConfig,
    ThreatLevel,
    ValidEmotion,
    VisibilityScope,
    WorldviewProfile,
    coerce_agency_level,
    coerce_coping_level,
    coerce_feeling_tone,
    coerce_intensity_level,
    coerce_threat_level,
    impulse_from_legacy_floats,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterStateSnapshot,
)
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterAgentDelta,
    ExtractedCharacterMemory,
)

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


# ---------------------------------------------------------------------------
# Engine Dataclasses
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Portrait Emotion & Lexical Projection Helpers
# ---------------------------------------------------------------------------


def pad_radial_magnitude(valence: float, arousal: float, dominance: float) -> float:
    """Compute distance from calm neutral center (V=0, A=0.40, D=0)."""
    a_centered = 2.0 * arousal - 0.80
    return math.sqrt(valence * valence + a_centered * a_centered + dominance * dominance)


def derive_active_emotion(
    *,
    valence: float,
    arousal: float,
    dominance: float,
    ambiguity: float = 0.0,
    primary_edge: RelationalEdge | None = None,
    prior_emotion: ValidEmotion = "default",
) -> ValidEmotion:
    """Deterministically derive a VALID_EMOTIONS portrait key from PAD + appraisal + target edge.

    Includes Schmitt-trigger hysteresis bands when `prior_emotion` is provided so coordinates
    hovering near decision boundaries do not flicker rapidly between expressions.
    """
    mag = pad_radial_magnitude(valence, arousal, dominance)
    edge_w = primary_edge.warmth if primary_edge is not None else 0.0
    edge_r = primary_edge.respect if primary_edge is not None else 0.0

    # High-shock surprise overrides when ambiguity and activation both spike (with hold hysteresis)
    if ambiguity >= 0.65 and arousal >= 0.58:
        return "surprised"
    if prior_emotion == "surprised" and ambiguity >= 0.48 and arousal >= 0.50:
        return "surprised"

    # Strong interpersonal contempt / disgust even at moderate somatic arousal
    if valence <= -0.18 and edge_r <= -0.55 and edge_w <= -0.40 and arousal >= 0.48:
        return "disgusted"
    if edge_r <= -0.40 and edge_w <= -0.20 and dominance >= -0.05 and valence <= 0.05:
        return "contempt"

    # Calm / neutral core prevents near-zero coordinates from flickering extreme expressions
    neutral_cutoff = 0.20 if prior_emotion != "default" else 0.25
    if mag < neutral_cutoff:
        return "default"

    happy_cutoff = 0.19 if prior_emotion == "happy" else 0.26
    if valence >= happy_cutoff:
        return "happy"

    neg_cutoff = (
        -0.15
        if prior_emotion in ("angry", "afraid", "sad", "contempt", "disgusted")
        else -0.20
    )
    if valence <= neg_cutoff:
        high_arousal_cutoff = 0.46 if prior_emotion in ("angry", "afraid") else 0.52
        if arousal >= high_arousal_cutoff:
            # Dominance cleanly separates Anger (+D) from Fear (-D) with hysteresis dead-band
            if prior_emotion == "angry":
                return "angry" if dominance >= -0.04 else "afraid"
            if prior_emotion == "afraid":
                return "angry" if dominance >= 0.14 else "afraid"
            return "angry" if dominance >= 0.05 else "afraid"
        if dominance >= (0.18 if prior_emotion == "contempt" else 0.25):
            return "contempt"
        if dominance <= -0.45 and arousal >= 0.40:
            return "afraid"
        return "sad"

    if arousal >= 0.78 and ambiguity >= 0.45:
        return "surprised"

    return "default"


def describe_pad_disposition(
    valence: float,
    arousal: float,
    dominance: float,
) -> tuple[str, str]:
    """Return (short_mood_label, full_disposition_sentence) using radial 8-octant Mehrabian lexicon."""
    mag = pad_radial_magnitude(valence, arousal, dominance)
    if mag < 0.25:
        if dominance >= 0.12:
            return (
                "Measured and self-possessed",
                "Even-tempered, observant, and quietly self-possessed.",
            )
        if valence >= 0.10:
            return (
                "At ease and attentive",
                "Relaxed, receptive, and attentively grounded in the moment.",
            )
        if valence <= -0.10:
            return (
                "Wary and reserved",
                "Measured and slightly guarded, watching the room without agitation.",
            )
        return (
            "Observant and composed",
            "Even-tempered and observant, taking in the scene with steady focus.",
        )

    intense = mag >= 0.60
    pos_v = valence >= 0.0
    high_a = arousal >= 0.48
    pos_d = dominance >= 0.0

    # Near-zero valence axis buffer (-0.08 < V < 0.08) prevents small coordinate jitter
    # from flipping between exuberant warmth and combative irritation.
    if abs(valence) < 0.08:
        if high_a:
            if pos_d:
                return (
                    "Focused and alert",
                    "Heightened, alert focus; actively commanding the pace of the exchange without hostility.",
                )
            return (
                "Taut and watchful",
                "Keyed up and closely watching every movement in the room with cautious intensity.",
            )
        if pos_d:
            return (
                "Measured and self-possessed",
                "Even-tempered, observant, and quietly self-possessed.",
            )
        return (
            "Quiet and guarded",
            "Subdued, observant, and keeping a careful, measured distance.",
        )

    if pos_v and high_a and pos_d:
        if intense:
            return (
                "Exuberant and commanding",
                "Charged with triumphant energy and decisive, commanding confidence.",
            )
        return (
            "Assured and energized",
            "Engaged, spirited, and confidently leaning into the momentum of the scene.",
        )

    if pos_v and high_a and not pos_d:
        if intense:
            return (
                "Breathless and captivated",
                "Swept up in intense excitement and wonder, openly reactive to the other's lead.",
            )
        return (
            "Eager and fascinated",
            "Warmly animated and curious, yielding the initiative with genuine interest.",
        )

    if pos_v and not high_a and pos_d:
        if intense:
            return (
                "Serene and unshakeable",
                "Settled in calm, unshakeable authority and deep satisfaction.",
            )
        return (
            "Relaxed and self-assured",
            "Comfortable, unhurried, and quietly confident in their standing.",
        )

    if pos_v and not high_a and not pos_d:
        if intense:
            return (
                "Tranquil and deeply trusting",
                "Softened into tranquil warmth and unguarded openness.",
            )
        return (
            "Warm and obliging",
            "Gentle, accommodating, and inclined toward quiet goodwill.",
        )

    if not pos_v and high_a and pos_d:
        if intense:
            return (
                "Furious and confrontational",
                "Cold, combative fury; coiled for confrontation and refusing to yield ground.",
            )
        return (
            "Irritated and confrontational",
            "Sharply displeased and assertive, ready to push back on provocation.",
        )

    if not pos_v and high_a and not pos_d:
        if intense:
            return (
                "Cornered and hyper-vigilant",
                "Flooded with acute alarm and defensive urgency, feeling boxed in by rising danger.",
            )
        return (
            "Guarded and anxious",
            "Uneasy and on edge, bracing defensively against an uncertain threat.",
        )

    if not pos_v and not high_a and pos_d:
        if intense:
            return (
                "Cold and disdainful",
                "Icy, aloof disdain; emotionally detached and unimpressed.",
            )
        return (
            "Sardonic and unimpressed",
            "Dry, skeptical, and coolly detached, keeping a critical distance.",
        )

    # (-V, -A, -D)
    if intense:
        return (
            "Hollow and defeated",
            "Drained, heavy-hearted, and weighed down by quiet resignation.",
        )
    return (
        "Weary and discouraged",
        "Subdued, tired, and reluctant to press their luck.",
    )


def describe_outward_demeanor(
    *,
    valence: float,
    arousal: float,
    dominance: float,
    composure: float,
    short_mood_label: str,
) -> str:
    """Render epistemically masked outward demeanor visible to co-present characters."""
    mag = pad_radial_magnitude(valence, arousal, dominance)
    if composure >= COMPOSURE_MASK_THRESHOLD:
        if mag < 0.28:
            return "Outwardly calm, measured, and attentive"
        if valence >= 0.30:
            if composure >= 0.75:
                return "Outwardly poised with a subtle, controlled warmth"
            return f"Outwardly congenial ({short_mood_label.lower()})"
        if arousal >= 0.65:
            return (
                "Outwardly controlled and hard to read, though posture is taut and hyper-alert"
            )
        if dominance >= 0.25:
            return "Outwardly cool, deliberate, and unreadable behind a steady gaze"
        return "Outwardly reserved and composed, giving very little away"

    # Composure cracked (C < 0.35) -> visible affective leakage
    if valence <= -0.25 and arousal >= 0.55:
        if dominance >= 0.05:
            return "Visibly rattled—jaw clenched, voice tight with barely contained anger"
        return "Visibly shaken—breathing shallow, eyes darting with unmasked strain"
    if valence <= -0.25:
        return "Visibly worn down—shoulders tense, struggling to hide quiet distress"
    if valence >= 0.25 and arousal >= 0.55:
        return "Visibly flushed and animated, unable to hide a rush of excitement"
    return f"Composure frayed—outwardly {short_mood_label.lower()}"


def _describe_composure_directive(composure: float, arousal: float) -> str:
    if composure >= 0.75:
        if arousal >= 0.62:
            return (
                "Ironclad self-control—keeping outward voice and expression deliberate despite high internal tension."
            )
        return "Steady and self-possessed—fully in command of outward expression and body language."
    if composure >= COMPOSURE_MASK_THRESHOLD:
        return (
            "Guarded self-control—maintaining a measured front, though sharp micro-reactions may slip under pressure."
        )
    if composure >= 0.18:
        return (
            "Composure cracking—struggling to mask raw emotion; tension leaks into cadence, hands, and gaze."
        )
    return (
        "Composure shattered—emotionally raw and unmasked, unable to maintain a detached facade."
    )


def _describe_appraisal_directive(appraisal: SituationalAppraisal) -> str:
    parts: list[str] = []
    if appraisal.threat >= 0.70:
        parts.append("Perceives acute, high-stakes danger")
    elif appraisal.threat >= 0.35:
        parts.append("Senses notable tension and risk in the room")
    elif appraisal.threat >= 0.15:
        parts.append("Mildly cautious of potential complications")
    else:
        parts.append("No immediate physical or social threat perceived")

    if appraisal.coping >= 0.65:
        parts.append("confident in tactical leverage and control")
    elif appraisal.coping >= 0.15:
        parts.append("steady in ability to handle the exchange")
    elif appraisal.coping >= -0.50:
        parts.append("feeling stretched and defensive")
    else:
        parts.append("feeling dangerously outmatched and short on options")

    if appraisal.goal_congruence >= 0.50:
        parts.append("current events strongly advance immediate goals")
    elif appraisal.goal_congruence <= -0.50:
        parts.append("current events directly obstruct immediate goals")

    if appraisal.ambiguity >= 0.60:
        parts.append("jolted by an unexpected turn")

    return "; ".join(parts) + "."


def _describe_worldview_summary(worldview: WorldviewProfile) -> str | None:
    cues: list[str] = []
    if worldview.benevolence <= -0.55:
        cues.append("expects ulterior motives from strangers")
    elif worldview.benevolence >= 0.55:
        cues.append("instinctively gives fair-minded people the benefit of the doubt")

    if worldview.belonging <= -0.55:
        cues.append("carries the instincts of a guarded outsider")
    elif worldview.belonging >= 0.55:
        cues.append("protective of shared community bonds")

    if worldview.agency >= 0.60:
        cues.append("refuses to be coerced or fatalistically boxed in")
    elif worldview.agency <= -0.55:
        cues.append("weighed down by fatalistic doubt")

    if not cues:
        return None
    return "Underlying Outlook: " + "; ".join(cues) + "."


def _render_edge_bullets(edge: RelationalEdge, *, is_player: bool) -> list[str]:
    bullets: list[str] = []
    subj = "you" if is_player else "them"
    poss = "your" if is_player else "their"

    # Warmth & Trust synthesis
    if edge.warmth >= 0.60 and edge.trust >= 0.55:
        bullets.append(f"Deeply warm and loyal toward {subj}—treats {subj} as a trusted inner-circle ally.")
    elif edge.warmth >= 0.28 and edge.trust >= 0.20:
        bullets.append(f"Genuinely fond of {subj} and inclined to trust {poss} word.")
    elif edge.warmth >= 0.28 and edge.trust <= -0.25:
        bullets.append(f"Drawn to {subj} personally, yet wary of trusting {poss} motives.")
    elif edge.warmth <= -0.55 and edge.trust <= -0.50:
        bullets.append(
            f"Hardened hostility and deep distrust—expects deception or malice from {subj} and dismisses cheap flattery."
        )
    elif edge.trust <= -0.45:
        bullets.append(
            f"Deeply distrustful of {subj}—skeptical of promises unless backed by costly proof."
        )
    elif edge.warmth <= -0.30:
        bullets.append(f"Cold and unfriendly toward {subj}, keeping interaction clipped.")
    elif edge.trust <= -0.20:
        bullets.append(f"Cautious and unconvinced of {poss} reliability.")
    elif edge.trust >= 0.45:
        bullets.append(f"Places solid trust in {poss} reliability and word.")

    # Respect
    if edge.respect >= 0.55:
        bullets.append(f"Holds strong respect for {poss} competence, nerve, and capability.")
    elif edge.respect >= 0.25:
        bullets.append(f"Acknowledges {poss} capability as credible.")
    elif edge.respect <= -0.55:
        bullets.append(f"Looks down on {subj} with sharp contempt for perceived weakness or incompetence.")
    elif edge.respect <= -0.25:
        bullets.append(f"Unimpressed by {poss} judgment or follow-through.")

    # Power dynamic
    if edge.power >= 0.45:
        bullets.append(f"Feels firmly in command of the leverage between {subj} and themselves.")
    elif edge.power <= -0.45:
        bullets.append(f"Feels at a disadvantage against {poss} leverage or authority.")

    # Orthogonal Grievance & Obligation (never cancel!)
    if edge.grievance >= 0.65:
        bullets.append(f"Carries a severe, unforgiven grievance against {subj} that polite words will not erase.")
    elif edge.grievance >= 0.25:
        bullets.append(f"Still nurses an unresolved slight held against {subj}.")

    if edge.obligation >= 0.55:
        bullets.append(f"Bound by a heavy personal debt owed to {subj}.")
    elif edge.obligation >= 0.22:
        bullets.append(f"Conscious of owing {subj} a favor.")
    elif edge.obligation <= -0.55:
        bullets.append(f"Considers {subj} heavily indebted to them.")
    elif edge.obligation <= -0.22:
        bullets.append(f"Expects {subj} to make good on an owed favor.")

    if edge.episodic_note:
        bullets.append(f"Recent relational context: {edge.episodic_note}")

    if not bullets:
        bullets.append(f"Neutral, uncommitted stance toward {subj}—judging by immediate conduct.")

    return bullets


def _edge_compact_summary(edge: RelationalEdge) -> str:
    """Render 1-line synchronized summary for legacy CharacterStateSnapshot.relationship_notes."""
    tags: list[str] = []
    if edge.warmth >= 0.35:
        tags.append("warm")
    elif edge.warmth <= -0.35:
        tags.append("cold")

    if edge.trust >= 0.35:
        tags.append("trusting")
    elif edge.trust <= -0.35:
        tags.append("distrustful")

    if edge.respect >= 0.35:
        tags.append("respectful")
    elif edge.respect <= -0.35:
        tags.append("contemptuous")

    if edge.grievance >= 0.30:
        tags.append("aggrieved")
    if edge.obligation >= 0.30:
        tags.append("indebted")
    elif edge.obligation <= -0.30:
        tags.append("owed a debt")

    prefix = ", ".join(tags).capitalize() if tags else "Measured / neutral"
    if edge.episodic_note:
        return f"{prefix} — {edge.episodic_note}"[:200]
    return prefix


def describe_edge_stance(edge: RelationalEdge) -> str:
    """Return a concise stance label (e.g. 'Warm & Trusting', 'Cold & Distrustful', 'Measured & Neutral')."""
    tags: list[str] = []
    if edge.warmth >= 0.35:
        tags.append("Warm")
    elif edge.warmth <= -0.35:
        tags.append("Cold")

    if edge.trust >= 0.35:
        tags.append("Trusting")
    elif edge.trust <= -0.35:
        tags.append("Distrustful")

    if edge.respect >= 0.35:
        tags.append("Respectful")
    elif edge.respect <= -0.35:
        tags.append("Contemptuous")

    if edge.grievance >= 0.30:
        tags.append("Aggrieved")
    if edge.obligation >= 0.30:
        tags.append("Indebted")
    elif edge.obligation <= -0.30:
        tags.append("Owed a debt")

    return " & ".join(tags) if tags else "Measured & Neutral"


def describe_trust_tier(trust: float) -> str:
    """Classify scalar trust into a qualitative descriptor."""
    if trust >= 0.60:
        return "High"
    if trust >= 0.20:
        return "Moderate"
    if trust <= -0.45:
        return "Deep Distrust"
    if trust <= -0.20:
        return "Guarded"
    return "Neutral"


# ---------------------------------------------------------------------------
# Seeding, Legacy Hydration, & Snapshot Materialization
# ---------------------------------------------------------------------------


def _refresh_derived_care_fields(
    care: AffectiveCareState,
    *,
    preferred_mood_label: str | None = None,
    primary_target_id: str = "user",
) -> AffectiveCareState:
    short_label, _ = describe_pad_disposition(
        care.valence, care.arousal, care.dominance
    )
    effective_label = (
        preferred_mood_label.strip()[:80]
        if (preferred_mood_label and preferred_mood_label.strip())
        else short_label
    )
    primary_edge = care.relations.get(primary_target_id) or care.relations.get("user")
    emotion = derive_active_emotion(
        valence=care.valence,
        arousal=care.arousal,
        dominance=care.dominance,
        ambiguity=care.appraisal.ambiguity,
        primary_edge=primary_edge,
        prior_emotion=care.active_emotion,
    )
    demeanor = describe_outward_demeanor(
        valence=care.valence,
        arousal=care.arousal,
        dominance=care.dominance,
        composure=care.composure,
        short_mood_label=effective_label,
    )
    return care.model_copy(
        update={
            "active_emotion": emotion,
            "short_mood_label": effective_label,
            "outward_demeanor": demeanor,
        }
    )


def seed_initial_care_state(
    psyche: BaselinePsyche,
    *,
    initial_elapsed_minutes: int = 0,
    initial_user_note: str = "Acquaintance / Uncertain trust",
) -> AffectiveCareState:
    """Construct Turn-0 authoritative AffectiveCareState from immutable CharacterRecord seed."""
    wv = psyche.initial_worldview.model_copy()
    v0 = round(_clamp(psyche.valence, -1.0, 1.0), 4)
    a0 = round(_clamp(psyche.arousal, 0.0, 1.0), 4)
    d0 = round(_clamp(0.40 * wv.agency, -1.0, 1.0), 4)
    c0 = round(
        _clamp(0.82 + 0.06 * (psyche.temperament.composure_resilience - 1.0), 0.55, 0.96),
        4,
    )
    user_edge = build_stranger_edge("user", wv, episodic_note=initial_user_note)
    base = AffectiveCareState(
        schema_version=1,
        is_provisional=False,
        state_elapsed_minutes=max(0, int(initial_elapsed_minutes)),
        valence=v0,
        arousal=a0,
        dominance=d0,
        composure=c0,
        mood_variance=(0.08, 0.08, 0.08),
        active_worldview=wv,
        appraisal=SituationalAppraisal(),
        relations={"user": user_edge},
    )
    return _refresh_derived_care_fields(base, preferred_mood_label=psyche.mood_label)


def _infer_edge_from_legacy_note(
    target_id: str,
    note: str,
    worldview: WorldviewProfile,
) -> RelationalEdge:
    edge = build_stranger_edge(target_id, worldview, episodic_note=note)
    low = note.lower()
    w = edge.warmth
    t = edge.trust
    r = edge.respect
    g = 0.0
    o = 0.0
    if any(k in low for k in ("ally", "friend", "fond", "warm", "loyal", "care")):
        w = _clamp(w + 0.40, -1.0, 1.0)
        t = _clamp(t + 0.35, -1.0, 1.0)
    if any(k in low for k in ("trust", "confid", "reliab")):
        t = _clamp(t + 0.40, -1.0, 1.0)
    if any(k in low for k in ("distrust", "suspici", "wary", "skeptic", "doubt")):
        t = _clamp(t - 0.40, -1.0, 1.0)
    if any(k in low for k in ("hostil", "enem", "hate", "furi", "despis", "malic")):
        w = _clamp(w - 0.55, -1.0, 1.0)
        t = _clamp(t - 0.50, -1.0, 1.0)
    if any(k in low for k in ("betray", "grudge", "grievance", "unforgiv", "wronged")):
        g = 0.55
        t = _clamp(t - 0.45, -1.0, 1.0)
    if any(k in low for k in ("respect", "admir", "capable", "impress")):
        r = _clamp(r + 0.40, -1.0, 1.0)
    if any(k in low for k in ("contempt", "disdain", "pathetic", "weak")):
        r = _clamp(r - 0.45, -1.0, 1.0)
    if any(k in low for k in ("indebted", "owes them", "life-debt", "saved my")):
        o = 0.50
    return edge.model_copy(
        update={
            "warmth": round(w, 4),
            "trust": round(t, 4),
            "respect": round(r, 4),
            "grievance": round(g, 4),
            "obligation": round(o, 4),
            "consolidated_warmth": round(w, 4),
            "consolidated_trust": round(t, 4),
        }
    )


def hydrate_legacy_care_state(
    *,
    valence: float,
    arousal: float,
    mood_label: str,
    relationship_notes: Mapping[str, str],
    psyche: BaselinePsyche,
    elapsed_minutes: int = 0,
) -> AffectiveCareState:
    """Deterministically upgrade a pre-CARE SQLite row (affective_state_json == '{}')."""
    seeded = seed_initial_care_state(
        psyche, initial_elapsed_minutes=max(0, int(elapsed_minutes))
    )
    relations = dict(seeded.relations)
    for raw_key, raw_note in (relationship_notes or {}).items():
        key = str(raw_key or "").strip()
        if not key:
            continue
        canon_key = "user" if key.lower() in _USER_ALIASES else key
        if canon_key.lower() in _NARRATOR_ALIASES:
            continue
        relations[canon_key] = _infer_edge_from_legacy_note(
            canon_key, str(raw_note or "").strip(), seeded.active_worldview
        )
    updated = seeded.model_copy(
        update={
            "valence": round(_clamp(float(valence), -1.0, 1.0), 4),
            "arousal": round(_clamp(float(arousal), 0.0, 1.0), 4),
            "relations": relations,
        }
    )
    pref_label = mood_label if mood_label and mood_label != "Objective / Detached" else None
    return _refresh_derived_care_fields(updated, preferred_mood_label=pref_label)


def ensure_snapshot_care_state(
    snapshot: CharacterStateSnapshot,
    psyche: BaselinePsyche,
    *,
    elapsed_minutes: int = 0,
) -> AffectiveCareState:
    """Return snapshot.care_state if present (syncing any newly injected relationship_notes), else hydrate."""
    if snapshot.care_state is not None:
        care = snapshot.care_state
        raw_notes = snapshot.relationship_notes or {}
        if not raw_notes:
            return care
        updated_rels: dict[str, RelationalEdge] | None = None
        for raw_key, raw_note in raw_notes.items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            canon_key = "user" if key.lower() in _USER_ALIASES else key
            if canon_key.lower() in _NARRATOR_ALIASES:
                continue
            note_str = str(raw_note or "").strip()
            existing = care.relations.get(canon_key)
            if existing is None:
                if updated_rels is None:
                    updated_rels = dict(care.relations)
                updated_rels[canon_key] = _infer_edge_from_legacy_note(
                    canon_key, note_str, care.active_worldview
                )
            elif (
                canon_key == "user"
                and existing.episodic_note == "Acquaintance / Uncertain trust"
                and note_str
                and note_str != existing.episodic_note
                and note_str != _edge_compact_summary(existing)
            ):
                if updated_rels is None:
                    updated_rels = dict(care.relations)
                updated_rels["user"] = _infer_edge_from_legacy_note(
                    "user", note_str, care.active_worldview
                )
        if updated_rels is not None:
            return _refresh_derived_care_fields(
                care.model_copy(update={"relations": updated_rels}),
                preferred_mood_label=care.short_mood_label,
            )
        return care
    return hydrate_legacy_care_state(
        valence=snapshot.valence,
        arousal=snapshot.arousal,
        mood_label=snapshot.mood_label,
        relationship_notes=snapshot.relationship_notes,
        psyche=psyche,
        elapsed_minutes=elapsed_minutes,
    )


def materialize_snapshot_with_care(
    snapshot: CharacterStateSnapshot,
    care_state: AffectiveCareState,
) -> CharacterStateSnapshot:
    """One-way projection syncing top-level valence, arousal, mood_label & relationship_notes."""
    merged_notes = dict(snapshot.relationship_notes or {})
    for target_id, edge in care_state.relations.items():
        summary = _edge_compact_summary(edge)
        if edge.episodic_note or target_id in merged_notes or target_id != "user":
            if (
                edge.episodic_note
                and merged_notes.get(target_id) == edge.episodic_note
                and summary.startswith("Measured / neutral — ")
            ):
                merged_notes[target_id] = edge.episodic_note
            else:
                merged_notes[target_id] = summary
        elif (
            abs(edge.warmth) >= 0.25
            or abs(edge.trust) >= 0.25
            or abs(edge.respect) >= 0.25
            or edge.grievance >= 0.20
            or abs(edge.obligation) >= 0.20
        ):
            merged_notes[target_id] = summary

    return snapshot.model_copy(
        update={
            "valence": round(_clamp(care_state.valence, -1.0, 1.0), 3),
            "arousal": round(_clamp(care_state.arousal, 0.0, 1.0), 3),
            "mood_label": care_state.short_mood_label,
            "relationship_notes": merged_notes,
            "care_state": care_state,
        }
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


# ---------------------------------------------------------------------------
# Zone 4 Deterministic Lexical Projection (Zero Floats)
# ---------------------------------------------------------------------------


def _edge_salience_score(edge: RelationalEdge) -> float:
    return (
        abs(edge.warmth)
        + abs(edge.trust)
        + abs(edge.respect)
        + 1.5 * edge.grievance
        + abs(edge.obligation)
    )


def summarize_categorical_care_anchor(care_state: AffectiveCareState) -> str:
    """Project continuous AffectiveCareState onto canonical zero-float categorical tokens."""
    imp = impulse_from_legacy_floats(care_state.valence, care_state.arousal)
    dom = care_state.dominance
    if dom <= -0.64:
        agency: AgencyLevel = "helpless"
    elif dom <= -0.20:
        agency = "pressured"
    elif dom < 0.26:
        agency = "steady"
    elif dom < 0.66:
        agency = "assured"
    else:
        agency = "commanding"

    tau = care_state.appraisal.threat
    if tau < 0.10:
        threat: ThreatLevel = "none"
    elif tau < 0.32:
        threat = "low"
    elif tau < 0.60:
        threat = "moderate"
    elif tau < 0.85:
        threat = "high"
    else:
        threat = "critical"

    kap = care_state.appraisal.coping
    if kap <= -0.60:
        coping: CopingLevel = "overwhelmed"
    elif kap < 0.0:
        coping = "strained"
    elif kap < 0.60:
        coping = "adequate"
    else:
        coping = "mastery"

    return (
        f"tone={imp.tone}, intensity={imp.intensity}, agency={agency}, "
        f"threat={threat}, coping={coping}"
    )


def render_zone4_affective_block(
    care_state: AffectiveCareState,
    *,
    character_name: str,
    persona_name: str | None,
    character_name_map: Mapping[str, str],
    active_speaker_id: str | None,
    co_present_ids: set[str],
    max_npc_edges: int = 2,
) -> str:
    """Deterministic Lexical Projection with radial neutral core & O(1) salience-capped dyadic bullets.

    Guaranteed to contain ZERO raw floating-point telemetry numbers.
    """
    _, full_disposition = describe_pad_disposition(
        care_state.valence, care_state.arousal, care_state.dominance
    )
    anchor_tokens = summarize_categorical_care_anchor(care_state)
    composure_line = _describe_composure_directive(
        care_state.composure, care_state.arousal
    )
    appraisal_line = _describe_appraisal_directive(care_state.appraisal)
    worldview_line = _describe_worldview_summary(care_state.active_worldview)

    lines = [
        f'<internal_affective_state character="{character_name}">',
        f"  - Active Mood ({care_state.short_mood_label}): {full_disposition}",
        f"  - Categorical Baseline Anchor: {anchor_tokens}",
        f"  - Self-Control & Masking: {composure_line}",
        f"  - Tactical Scene Appraisal: {appraisal_line}",
    ]
    if worldview_line:
        lines.append(f"  - {worldview_line}")

    # 1. Always render Player ('user') stance first under Relationship Notes
    lines.append("  - Relationship Notes:")
    player_label = (
        f"{persona_name.strip()} (Player)"
        if (persona_name and persona_name.strip())
        else "the Player"
    )
    user_edge = care_state.relations.get("user") or build_stranger_edge(
        "user", care_state.active_worldview
    )
    lines.append(f"    * Stance toward {player_label}:")
    for bullet in _render_edge_bullets(user_edge, is_player=True):
        lines.append(f"      - {bullet}")

    # 2. Select co-present NPC edges: active_speaker_id + top max_npc_edges by salience
    selected_npc_ids: list[str] = []
    if (
        active_speaker_id
        and active_speaker_id != "user"
        and active_speaker_id in co_present_ids
        and active_speaker_id in care_state.relations
    ):
        selected_npc_ids.append(active_speaker_id)

    remaining_candidates = [
        (cid, care_state.relations[cid])
        for cid in co_present_ids
        if cid != "user"
        and cid not in selected_npc_ids
        and cid in care_state.relations
    ]
    remaining_candidates.sort(key=lambda pair: _edge_salience_score(pair[1]), reverse=True)
    for cid, _ in remaining_candidates[: max(0, int(max_npc_edges))]:
        selected_npc_ids.append(cid)

    for npc_id in selected_npc_ids:
        edge = care_state.relations[npc_id]
        npc_name = character_name_map.get(npc_id, npc_id)
        lines.append(f"    * Stance toward {npc_name}:")
        for bullet in _render_edge_bullets(edge, is_player=False):
            lines.append(f"      - {bullet}")

    lines.append("</internal_affective_state>")
    return "\n".join(lines)
