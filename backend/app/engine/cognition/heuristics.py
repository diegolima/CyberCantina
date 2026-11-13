"""Offline heuristic cognition fallback and episodic memory recall selection."""

from __future__ import annotations

import re

from app.config import settings
from app.engine.mentions import CharacterWhisper
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
        want=previous_state.active_want or character.baseline_psyche.default_want,
        plan="\n".join(plan_bullets),
        skipped=False,
        roll_outcome_tier=char_roll.outcome_tier if char_roll else None,
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
