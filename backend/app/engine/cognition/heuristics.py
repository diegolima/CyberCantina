"""Offline heuristic cognition fallback and episodic memory recall selection."""

from __future__ import annotations

import re

from app.config import settings
from app.engine.affective_engine import ensure_snapshot_care_state
from app.engine.mentions import CharacterWhisper
from app.engine.parties import find_member_party, resolve_character_travel_intent_enum
from app.engine.phase2_context import (
    DiscoveredPersonaView,
    pack_recalled_items_to_budget,
)
from app.schemas.affective import (
    AgencyLevel,
    CategoricalFeelingImpulse,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    ThreatLevel,
    impulse_from_legacy_floats,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
)
from app.schemas.party import (
    USER_PARTY_MEMBER_ID,
    PartyInviteDecision,
    PartyRecord,
    TravelIntent,
)
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterSpotlightRole,
    ChoiceResolution,
    PreTurnAnalysis,
    RecalledMemoryItem,
)
from collections.abc import Sequence
from dataclasses import dataclass

@dataclass(frozen=True)
class PriorCognitionCue:
    """Observable outward cue from a character evaluated earlier in sequential mode."""

    character_id: str
    character_name: str
    feeling_summary: str
    want_summary: str
    observable_action_hint: str
    roll_outcome_tier: CanonicalOutcomeTier | None = None
    observable_consequence_hint: str = ""


def compute_heuristic_party_invite_decision(
    *,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    pre_turn: PreTurnAnalysis,
    active_parties: Sequence[PartyRecord] | None = None,
    active_location_id: str | None = None,
) -> PartyInviteDecision:
    """Deterministically weigh CARE trust/warmth/grievance, roll tier, and NPC-party loyalty."""
    care = ensure_snapshot_care_state(previous_state, character.baseline_psyche)
    user_edge = care.relations.get(USER_PARTY_MEMBER_ID)
    warmth = float(user_edge.warmth) if user_edge else 0.0
    trust = float(user_edge.trust) if user_edge else 0.35
    grievance = float(user_edge.grievance) if user_edge else 0.0

    char_roll = pre_turn.character_rolls.get(character.id) or (
        pre_turn.resolved_roll
        if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
        else None
    )
    roll_adj = 0.0
    if char_roll:
        if char_roll.outcome_tier == "Critical Success":
            roll_adj = 0.35
        elif char_roll.outcome_tier == "Clean Success":
            roll_adj = 0.20
        elif char_roll.outcome_tier == "Simple Failure":
            roll_adj = -0.15
        elif char_roll.outcome_tier == "Failure with Consequences":
            roll_adj = -0.25
        elif char_roll.outcome_tier == "Critical Failure":
            roll_adj = -0.45

    eff_loc = active_location_id or previous_state.current_location_id
    npc_party_penalty = 0.0
    existing_party = find_member_party(active_parties or [], character.id)
    if (
        existing_party is not None
        and USER_PARTY_MEMBER_ID not in existing_party.member_ids
        and existing_party.location_id == eff_loc
    ):
        npc_party_penalty = -0.32 if existing_party.leader_id == character.id else -0.22

    score = warmth + (trust - 0.35) - (0.8 * grievance) + roll_adj + npc_party_penalty
    return "accept" if score >= 0.15 else "refuse"


def _compute_heuristic_travel_intent(
    *,
    user_message: str,
    character: CharacterRecord,
    allowed_enum: list[str],
    public_message: str | None = None,
    char_whisper: CharacterWhisper | None = None,
) -> TravelIntent:
    msg_low = (user_message or "").lower()
    char_first = character.name.strip().split()[0].lower() if character.name.strip() else ""
    mentions_self = bool(
        character.name.strip().lower() in msg_low
        or (len(char_first) >= 3 and re.search(rf"\b{re.escape(char_first)}\b", msg_low))
    )
    has_whisper = bool(char_whisper and char_whisper.raw_lines)

    if "stay_behind" in allowed_enum:
        alone_cue = bool(re.search(r"\b(alone|by myself|without you|slip out alone)\b", msg_low))
        told_stay = len(char_first) >= 3 and bool(
            re.search(
                rf"\b{re.escape(char_first)}\b[^.!?\n]{{0,35}}\b(?:stay here|wait here|stay behind|hold the door|watch the door)\b",
                msg_low,
            )
        )
        if alone_cue or told_stay:
            return "stay_behind"

    if "follow_player" in allowed_enum:
        pub_low = (public_message or msg_low).lower()
        explicit_follow = bool(
            re.search(r"\b(?:follow me|come with me|come along|tag along|walk with me|join me)\b", pub_low)
        )
        addressed_follow = (mentions_self or has_whisper) and bool(
            re.search(r"\b(?:follow|come with|with me|after them|after him|after her)\b", msg_low)
        )
        if explicit_follow or addressed_follow:
            return "follow_player"

    return "default"


def heuristic_character_cognition(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    pre_turn: PreTurnAnalysis,
    prior_cues: list[PriorCognitionCue] | None = None,
    role: CharacterSpotlightRole = "primary_speaker",
    choice_resolution: ChoiceResolution | None = None,
    known_persona: DiscoveredPersonaView | None = None,
    public_message: str | None = None,
    char_whisper: CharacterWhisper | None = None,
    active_parties: Sequence[PartyRecord] | None = None,
    active_location_id: str | None = None,
) -> CognitionBlock:
    """Generate a deterministic, high-quality fallback CognitionBlock without LLM."""
    sentiment_lower = pre_turn.user_sentiment.lower()
    is_positive = any(
        w in sentiment_lower
        for w in ("friendly", "warm", "agreeable", "positive", "calm", "cooperative")
    )
    is_negative = any(
        w in sentiment_lower
        for w in ("hostile", "tense", "angry", "suspicious", "aggressive", "threat")
    )
    val_drift = 0.05 if is_positive else (-0.05 if is_negative else 0.0)
    new_valence = max(-1.0, min(1.0, round(previous_state.valence + val_drift, 2)))
    new_arousal = max(0.0, min(1.0, round(previous_state.arousal, 2)))

    recall_bullets = [
        f"- Sizing up the interaction in {previous_state.current_location_id}.",
        f"- Noted player tone: {pre_turn.user_sentiment}.",
    ]
    if known_persona:
        if known_persona.revealed_age:
            recall_bullets.append(f"- Aware of player age: {known_persona.revealed_age}.")
        if known_persona.known_inventory:
            recall_bullets.append(f"- Observed player gear: {', '.join(it.name for it in known_persona.known_inventory)}.")
        if known_persona.known_lore:
            for l in known_persona.known_lore:
                recall_bullets.append(f"- Knows player history: {l.title}.")
    if prior_cues:
        for c in prior_cues[:2]:
            conseq_str = f" after {c.roll_outcome_tier}" if c.roll_outcome_tier else ""
            recall_bullets.append(f"- Clocked {c.character_name}'s reaction{conseq_str}.")

    # Check for this character's specific roll
    char_roll = pre_turn.character_rolls.get(character.id) or (
        pre_turn.resolved_roll
        if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
        else None
    )

    is_lethal_danger = bool(
        re.search(r"\b(gun|shoot|kill|ambush|hit-squad|grenade|blade|attack)\b", user_message.lower())
    )
    base_imp = impulse_from_legacy_floats(new_valence, new_arousal)
    h_tone: FeelingTone = "uneasy" if is_lethal_danger else base_imp.tone
    h_intensity: IntensityLevel = "high" if is_lethal_danger else base_imp.intensity
    h_agency: AgencyLevel = "pressured" if is_lethal_danger else base_imp.agency
    h_threat: ThreatLevel = "high" if is_lethal_danger else ("moderate" if is_negative else "none")
    h_coping: CopingLevel = "strained" if is_lethal_danger else "adequate"

    if char_roll:
        if char_roll.outcome_tier == "Critical Failure":
            new_valence = max(-1.0, min(1.0, round(previous_state.valence - 0.35, 2)))
            new_arousal = max(0.0, min(1.0, round(previous_state.arousal + 0.35, 2)))
            h_tone = "anguished" if new_valence <= -0.6 else "uneasy"
            h_intensity = "extreme"
            h_agency = "pressured"
            h_threat = "high"
            h_coping = "strained"
            plan_bullets = [
                f"- React to catastrophic backfire of '{char_roll.action_description}'.",
                "- Scramble to contain the immediate danger and fallout.",
            ]
        elif char_roll.outcome_tier == "Failure with Consequences":
            new_valence = max(-1.0, min(1.0, round(previous_state.valence - 0.15, 2)))
            new_arousal = max(0.0, min(1.0, round(previous_state.arousal + 0.15, 2)))
            h_tone = "guarded"
            h_intensity = "high"
            h_agency = "pressured"
            h_threat = "moderate"
            h_coping = "strained"
            plan_bullets = [
                f"- Attempt at '{char_roll.action_description}' met with resistance.",
                "- Regroup and brace for secondary complications.",
            ]
        elif char_roll.outcome_tier == "Simple Failure":
            new_valence = max(-1.0, min(1.0, round(previous_state.valence - 0.05, 2)))
            h_tone = "guarded"
            h_intensity = "moderate"
            plan_bullets = [
                f"- Notice '{char_roll.action_description}' failed to produce results.",
                "- Reset stance without immediate overcommitment.",
            ]
        elif char_roll.outcome_tier == "Clean Success":
            new_valence = max(-1.0, min(1.0, round(previous_state.valence + 0.15, 2)))
            h_tone = "content" if new_valence >= 0.15 else h_tone
            h_agency = "assured"
            h_coping = "adequate"
            plan_bullets = [
                f"- Execute '{char_roll.action_description}' cleanly.",
                "- Capitalize on the intended opening.",
            ]
        else:  # Critical Success
            new_valence = max(-1.0, min(1.0, round(previous_state.valence + 0.35, 2)))
            new_arousal = max(0.0, min(1.0, round(previous_state.arousal + 0.20, 2)))
            h_tone = "elated" if new_valence >= 0.55 else "warm"
            h_intensity = "high"
            h_agency = "commanding"
            h_coping = "mastery"
            plan_bullets = [
                f"- Capitalize on exceptional breakthrough from '{char_roll.action_description}'.",
                "- Seize decisive initiative with unexpected advantage.",
            ]
    else:
        target_cue = (
            char_whisper.raw_lines[0]
            if char_whisper and char_whisper.raw_lines
            else (public_message or user_message)
        )
        plan_bullets = (
            [
                f"- Address the player directly regarding: {target_cue[:60]}...",
                "- Hold ground and monitor room reactions.",
            ]
            if role == "primary_speaker"
            else [
                "- React subtly from the periphery to the player's dialogue.",
                "- Maintain eye contact and observe next developments.",
            ]
        )

    cues_text = ""
    if prior_cues:
        cues_text = " " + "; ".join(
            f"observing {c.character_name}'s {c.feeling_summary}" for c in prior_cues
        )

    h_impulse = CategoricalFeelingImpulse(
        tone=h_tone,
        intensity=h_intensity,
        agency=h_agency,
        threat=h_threat,
        coping=h_coping,
    )
    eff_loc = active_location_id or previous_state.current_location_id
    party_invite_decision: PartyInviteDecision | None = None
    want_override: str | None = None
    if (
        pre_turn.party_action is not None
        and pre_turn.party_action.kind == "invite"
        and character.id in pre_turn.party_action.target_character_ids
    ):
        party_invite_decision = compute_heuristic_party_invite_decision(
            character=character,
            previous_state=previous_state,
            pre_turn=pre_turn,
            active_parties=active_parties,
            active_location_id=eff_loc,
        )
        if party_invite_decision == "accept":
            want_override = "Accept the invitation and coordinate closely with the group."
            plan_bullets = [
                "- Agree to join the traveling party for mutual leverage.",
                "- Signal readiness while keeping personal guard intact.",
            ]
        else:
            want_override = "Decline the party invitation and maintain current position."
            plan_bullets = [
                "- Refuse the invitation plainly without surrendering ground.",
                "- Hold current loyalties and position in the room.",
            ]

    travel_intent: TravelIntent = "default"
    if pre_turn.spatial_intent != "stay":
        allowed_travel = resolve_character_travel_intent_enum(
            character.id, active_parties or [], eff_loc
        )
        travel_intent = _compute_heuristic_travel_intent(
            user_message=user_message,
            character=character,
            allowed_enum=allowed_travel,
            public_message=public_message,
            char_whisper=char_whisper,
        )

    cog = CognitionBlock(
        recall="\n".join(recall_bullets),
        feeling=f"{previous_state.mood_label}.{cues_text}",
        feeling_tone=h_tone,
        feeling_intensity=h_intensity,
        feeling_agency=h_agency,
        scene_threat=h_threat,
        scene_coping=h_coping,
        valence=new_valence,
        arousal=new_arousal,
        feeling_impulse=h_impulse,
        want=want_override or previous_state.active_want or character.baseline_psyche.default_want,
        plan="\n".join(plan_bullets),
        skipped=False,
        roll_outcome_tier=char_roll.outcome_tier if char_roll else None,
        travel_intent=travel_intent,
        party_invite_decision=party_invite_decision,
    )
    if choice_resolution:
        from app.engine.choices import coerce_choice_compliance
        cog = coerce_choice_compliance(cog, choice_resolution, previous_state)
    return cog


def select_cognition_recalled_items(
    shared_scene_items: Sequence[RecalledMemoryItem],
    character_recalled_items: Sequence[RecalledMemoryItem],
    *,
    token_budget: int | None = None,
    personal_shard_quota: int = 2,
) -> list[RecalledMemoryItem]:
    """Merge shared scene items and character-scoped memories with personal shard quota protection.

    Prevents shared world/location lore from starving a character's personal `character_shard`
    memories, then packs the prioritized list into `token_budget` using two-form (full + short) packing.
    """
    eff_budget = (
        token_budget
        if token_budget is not None
        else settings.memory_config.recall_budget_cognition_tokens
    )
    personal_shards: list[RecalledMemoryItem] = []
    other_items: list[RecalledMemoryItem] = []
    seen_ids: set[str] = set()

    for m in character_recalled_items:
        if m.id in seen_ids:
            continue
        seen_ids.add(m.id)
        if m.source_type == "character_shard":
            personal_shards.append(m)
        else:
            other_items.append(m)

    for m in shared_scene_items:
        if m.id in seen_ids:
            continue
        seen_ids.add(m.id)
        other_items.append(m)

    personal_shards.sort(key=lambda x: x.score, reverse=True)
    other_items.sort(key=lambda x: x.score, reverse=True)

    reserved_shards = personal_shards[: max(0, personal_shard_quota)]
    reserved_ids = {m.id for m in reserved_shards}
    remaining_pool = [
        m for m in (*personal_shards[len(reserved_shards) :], *other_items) if m.id not in reserved_ids
    ]
    remaining_pool.sort(key=lambda x: x.score, reverse=True)

    prioritized: list[RecalledMemoryItem] = []
    if reserved_shards and remaining_pool:
        if reserved_shards[0].score >= remaining_pool[0].score:
            prioritized.append(reserved_shards[0])
            prioritized.append(remaining_pool[0])
            prioritized.extend(reserved_shards[1:])
            prioritized.extend(remaining_pool[1:])
        else:
            prioritized.append(remaining_pool[0])
            prioritized.extend(reserved_shards)
            prioritized.extend(remaining_pool[1:])
    else:
        prioritized = [*reserved_shards, *remaining_pool]

    if not prioritized:
        return []

    return pack_recalled_items_to_budget(prioritized, eff_budget)
