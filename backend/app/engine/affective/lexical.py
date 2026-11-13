"""Lexical rendering (zero-raw-float PAD/CARE/edge descriptions for Zone 4)."""

from __future__ import annotations

import math

from app.schemas.affective import (
    AffectiveCareState,
    AgencyLevel,
    CopingLevel,
    RelationalEdge,
    SituationalAppraisal,
    ThreatLevel,
    ValidEmotion,
    WorldviewProfile,
    impulse_from_legacy_floats,
)
from collections.abc import Mapping

from app.engine.affective.models import (
    COMPOSURE_MASK_THRESHOLD,
    build_stranger_edge,
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
