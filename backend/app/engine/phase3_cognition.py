"""Phase 3: Per-Character Multi-Cognition Swarm & State Reasoning."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
import re
from typing import Any

from app.config import settings
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    ensure_snapshot_care_state,
    render_zone4_affective_block,
)
from app.engine.mentions import CharacterWhisper, DecomposedUserMessage, decompose_user_message
from app.engine.phase2_context import (
    DiscoveredPersonaView,
    TurnContextBundle,
    resolve_character_previous_state,
    select_active_location_lore_for_turn,
)
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.prompts.defaults import (
    DEFAULT_CHARACTER_COGNITION_SYSTEM,
    PROMPT_KEY_CHARACTER_COGNITION,
)
from app.schemas.affective import (
    INTENSITY_TO_AROUSAL,
    TONE_TO_VALENCE,
    AgencyLevel,
    CategoricalFeelingImpulse,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    ThreatLevel,
    coerce_agency_level,
    coerce_coping_level,
    coerce_feeling_tone,
    coerce_intensity_level,
    coerce_threat_level,
    impulse_from_legacy_floats,
)
from app.schemas.auth import ModelProfile
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    format_item_names,
)
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterSpotlightRole,
    ChoiceResolution,
    Phase3ProgressCallback,
    Phase3ProgressEvent,
    Phase3RosterEntry,
    PreTurnAnalysis,
    RecalledMemoryItem,
)
from app.schemas.world import LocationNode, NeighborLocationView, WorldRecord

logger = logging.getLogger(__name__)

_RECALL_RE = re.compile(r"<recall>(.*?)</recall>", re.DOTALL | re.IGNORECASE)
_FEELING_RE = re.compile(r"<feeling(?P<attrs>[^>]*)>(?P<text>.*?)</feeling>", re.DOTALL | re.IGNORECASE)
_WANT_RE = re.compile(r"<want>(.*?)</want>", re.DOTALL | re.IGNORECASE)
_SELECTED_CHOICE_RE = re.compile(r"<selected_choice>(.*?)</selected_choice>", re.DOTALL | re.IGNORECASE)
_PLAN_RE = re.compile(r"<plan>(.*?)</plan>", re.DOTALL | re.IGNORECASE)
_VALENCE_ATTR_RE = re.compile(r'valence=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)
_AROUSAL_ATTR_RE = re.compile(r'arousal=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)
_TONE_ATTR_RE = re.compile(r'tone=["\']([^"\']+)["\']', re.IGNORECASE)
_INTENSITY_ATTR_RE = re.compile(r'intensity=["\']([^"\']+)["\']', re.IGNORECASE)
_AGENCY_ATTR_RE = re.compile(r'agency=["\']([^"\']+)["\']', re.IGNORECASE)
_THREAT_ATTR_RE = re.compile(r'threat=["\']([^"\']+)["\']', re.IGNORECASE)
_COPING_ATTR_RE = re.compile(r'coping=["\']([^"\']+)["\']', re.IGNORECASE)
_ROLL_OUTCOME_ATTR_RE = re.compile(r'roll_outcome=["\']([^"\']+)["\']', re.IGNORECASE)


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


def parse_cognition_xml(
    cognition_xml: str,
    fallback_state: CharacterStateSnapshot,
) -> CognitionBlock:
    """Parse inner tags of <cognition>...</cognition> supporting both CARE enums and legacy floats."""
    recall_match = _RECALL_RE.search(cognition_xml)
    feeling_match = _FEELING_RE.search(cognition_xml)
    want_match = _WANT_RE.search(cognition_xml)
    plan_match = _PLAN_RE.search(cognition_xml)

    recall = (
        recall_match.group(1).strip()
        if recall_match
        else "- Holding onto the current thread of conversation."
    )
    feeling = (
        feeling_match.group("text").strip()
        if feeling_match
        else fallback_state.mood_label
    )

    fallback_imp = impulse_from_legacy_floats(fallback_state.valence, fallback_state.arousal)
    valence = fallback_state.valence
    arousal = fallback_state.arousal
    impulse: CategoricalFeelingImpulse = fallback_imp

    if feeling_match:
        attrs = feeling_match.group("attrs") or ""
        t_m = _TONE_ATTR_RE.search(attrs)
        i_m = _INTENSITY_ATTR_RE.search(attrs)
        ag_m = _AGENCY_ATTR_RE.search(attrs)
        th_m = _THREAT_ATTR_RE.search(attrs)
        cp_m = _COPING_ATTR_RE.search(attrs)

        if any((t_m, i_m, ag_m, th_m, cp_m)):
            tone = coerce_feeling_tone(t_m.group(1), default=fallback_imp.tone) if t_m else fallback_imp.tone
            intensity = (
                coerce_intensity_level(i_m.group(1), default=fallback_imp.intensity)
                if i_m
                else fallback_imp.intensity
            )
            agency = (
                coerce_agency_level(ag_m.group(1), default=fallback_imp.agency)
                if ag_m
                else fallback_imp.agency
            )
            threat = (
                coerce_threat_level(th_m.group(1), default=fallback_imp.threat)
                if th_m
                else fallback_imp.threat
            )
            coping = (
                coerce_coping_level(cp_m.group(1), default=fallback_imp.coping)
                if cp_m
                else fallback_imp.coping
            )
            impulse = CategoricalFeelingImpulse(
                tone=tone,
                intensity=intensity,
                agency=agency,
                threat=threat,
                coping=coping,
                used_legacy_float_fallback=False,
            )
            valence = TONE_TO_VALENCE[impulse.tone]
            arousal = INTENSITY_TO_AROUSAL[impulse.intensity]
        else:
            v_m = _VALENCE_ATTR_RE.search(attrs)
            a_m = _AROUSAL_ATTR_RE.search(attrs)
            if v_m:
                try:
                    valence = _clamp(float(v_m.group(1)), -1.0, 1.0)
                except ValueError:
                    pass
            if a_m:
                try:
                    arousal = _clamp(float(a_m.group(1)), 0.0, 1.0)
                except ValueError:
                    pass
            impulse = impulse_from_legacy_floats(valence, arousal)

    recall = _sanitize_cognition_text(recall, field_type="recall", location_id=fallback_state.current_location_id)
    recall = _format_cognition_bullets(recall, max_bullets=2, max_words_per_bullet=30)
    raw_want = want_match.group(1).strip() if want_match else fallback_state.active_want
    want = _sanitize_cognition_text(raw_want, field_type="want") or fallback_state.active_want
    choice_match = _SELECTED_CHOICE_RE.search(cognition_xml)
    selected_choice = choice_match.group(1).strip() if choice_match else None
    raw_plan = plan_match.group(1).strip() if plan_match else fallback_state.active_plan
    plan = _sanitize_cognition_text(raw_plan, field_type="plan") or fallback_state.active_plan
    plan = _format_cognition_bullets(plan, max_bullets=3, max_words_per_bullet=25)

    ro_m = _ROLL_OUTCOME_ATTR_RE.search(cognition_xml)
    roll_outcome_tier = ro_m.group(1).strip() if ro_m else None

    return CognitionBlock(
        recall=recall,
        feeling=feeling,
        feeling_tone=impulse.tone,
        feeling_intensity=impulse.intensity,
        feeling_agency=impulse.agency,
        scene_threat=impulse.threat,
        scene_coping=impulse.coping,
        valence=round(valence, 2),
        arousal=round(arousal, 2),
        feeling_impulse=impulse,
        want=want,
        selected_choice=selected_choice,
        plan=plan,
        roll_outcome_tier=roll_outcome_tier,
    )


def _format_cognition_bullets(
    text: str,
    *,
    max_bullets: int | None = None,
    max_words_per_bullet: int | None = None,
) -> str:
    """Format cognition multi-item fields (recall, plan) into clean newline-separated bullet points."""
    if not text:
        return ""
    t = re.sub(r"^[,\s\[]+", "", text).strip()
    t = re.sub(r"[\]\s]+$", "", t).strip()
    t = re.sub(
        r"\[(EPISODIC_CHUNK|CHARACTER_SHARD|LOCATION_LORE|LORE)\]\s*",
        "",
        t,
        flags=re.I,
    ).strip()

    if "\n" not in t and re.search(r"\b[1-9][.)]\s+", t):
        parts = re.split(r"\s*(?:^|\b)[1-9][.)]\s+", t)
        items = [f"- {p.strip()}" for p in parts if p.strip()]
        if items:
            t = "\n".join(items)

    lines: list[str] = []
    for line in t.splitlines():
        line = line.strip()
        if not line:
            continue
        cleaned = re.sub(r"^(?:[-*•]|\d+[.)])\s*", "- ", line)
        if not cleaned.startswith("- "):
            cleaned = f"- {cleaned}"
        if max_words_per_bullet is not None and max_words_per_bullet > 0:
            content = cleaned[2:].strip()
            words = content.split()
            if len(words) > max_words_per_bullet:
                cleaned = f"- {' '.join(words[:max_words_per_bullet])}..."
        lines.append(cleaned)

    if max_bullets is not None and max_bullets > 0:
        lines = lines[:max_bullets]

    if lines:
        return "\n".join(lines)

    fallback = f"- {t}" if not t.startswith("- ") else t
    if max_words_per_bullet is not None and max_words_per_bullet > 0:
        content = fallback[2:].strip()
        words = content.split()
        if len(words) > max_words_per_bullet:
            fallback = f"- {' '.join(words[:max_words_per_bullet])}..."
    return fallback


_PROMPT_LEAKAGE_RE = re.compile(
    r"(?:strictly\s*1-2\s*ultra-concise|critical\s*negative\s*constraint|"
    r"state\s*only\s*the\s*single\s*immediate|maximum\s*15-20\s*words|"
    r"never\s*summarize\s*backstory|1\s*singular\s*sentence\s*defining|"
    r"2-3\s*brief\s*sequential\s*bullet|adhering\s*strictly\s*to\s*the\s*object|"
    r"output\s*only\s*the\s*<cognition>|following\s*this\s*exact\s*4-step|"
    r"output\s*only\s*the\s*requested\s*structured|never\s*echo,?\s*copy,?\s*or\s*quote|"
    r"write\s*\{?character_name\}?'?s?\s*actual\s*in-character)",
    re.IGNORECASE,
)


def _sanitize_cognition_text(
    text: str | None,
    *,
    field_type: str,
    location_id: str | None = None,
) -> str:
    """Sanitize cognition text to remove prompt instruction leakage and malformed prefixes."""
    if not text:
        return ""
    t = text.strip()

    if field_type == "want":
        t = re.sub(r"^(?:<want>|want>|\[want\]|\"want\"[:=]|\bwant[:=])\s*", "", t, flags=re.I)
        t = re.sub(r"^1\s+singular\s+sentence\s+(?:defining\s+[^.]*\.\s*)?", "", t, flags=re.I)
        t = re.sub(r"</want>$", "", t, flags=re.I).strip()
    elif field_type == "plan":
        cleaned_tokens = re.sub(r"^[-*•\s]*plan[=:\s]*$", "", t, flags=re.I).strip()
        if not cleaned_tokens:
            return ""
        t = re.sub(r"^(?:[-*•\s]*(?:<plan>|plan>|\[plan\]|\"plan\"[:=]|\bplan[=:]))\s*", "", t, flags=re.I)
        t = re.sub(r"</plan>$", "", t, flags=re.I).strip()
    elif field_type == "recall":
        t = re.sub(r"^(?:<recall>|recall>|\[recall\]|\"recall\"[:=]|\brecall[:=])\s*", "", t, flags=re.I)
        t = re.sub(r"</recall>$", "", t, flags=re.I).strip()

    if _PROMPT_LEAKAGE_RE.search(t):
        if field_type == "recall":
            loc_str = f" in {location_id}" if location_id else ""
            return f"- Sizing up the interaction{loc_str}."
        elif field_type in ("want", "plan"):
            cleaned = _PROMPT_LEAKAGE_RE.sub("", t).strip()
            return cleaned if len(cleaned) > 5 else ""

    return t


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
                f"- Hold ground and monitor room reactions.",
            ]
            if role == "primary_speaker"
            else [
                f"- React subtly from the periphery to the player's dialogue.",
                f"- Maintain eye contact and observe next developments.",
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


async def run_character_cognition_agent(
    *,
    user_message: str,
    character: CharacterRecord,
    world: WorldRecord,
    role: CharacterSpotlightRole,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    shared_scene_items: list[RecalledMemoryItem],
    character_recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    co_present_characters: list[CharacterRecord],
    prior_cues: list[PriorCognitionCue] | None = None,
    profile: ModelProfile | None = None,
    system_prompt_template: str | None = None,
    choice_resolution: ChoiceResolution | None = None,
    narrator_directive: str | None = None,
    known_persona: DiscoveredPersonaView | None = None,
    public_message: str | None = None,
    char_whisper: CharacterWhisper | None = None,
) -> CognitionBlock:
    """Execute a single character subconscious cognition agent turn."""
    template = system_prompt_template or get_default_prompt(
        PROMPT_KEY_CHARACTER_COGNITION
    )
    appearance_line = (
        f"Physical Appearance: {character.physical_appearance}\n"
        if character.physical_appearance.strip()
        else ""
    )
    system_prompt = render_template(
        template,
        character_name=character.name,
        character_id=character.id,
        world_name=world.name,
        genre=world.global_rules.genre,
        tone=world.global_rules.tone,
        setting_overview=world.global_rules.setting_overview,
        tech_or_magic_rules=world.global_rules.tech_or_magic_rules,
        tagline=character.tagline,
        appearance_section=appearance_line,
        core_persona=character.core_persona,
        core_drive=character.baseline_psyche.core_drive,
        core_fear=character.baseline_psyche.core_fear,
    )

    # Scoped recalled items: shared room items + character's isolated memories (deduplicated by ID)
    seen_recall_ids: set[str] = set()
    all_recalled: list[RecalledMemoryItem] = []
    for m in (*shared_scene_items, *character_recalled_items):
        if m.id not in seen_recall_ids:
            seen_recall_ids.add(m.id)
            all_recalled.append(m)
    # Tame recall bloat: select top 3 most relevant items for subconscious cognition
    effective_recalled = all_recalled[:3]
    recalled_text = "\n".join(
        f"  - [{m.source_type.upper()}] {m.title}: {m.content}"
        for m in effective_recalled
    ) or "  - No specific background lore triggered this turn."

    char_roll = pre_turn.character_rolls.get(character.id) or (
        pre_turn.resolved_roll
        if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
        else None
    )
    roll_text = ""
    if char_roll:
        r = char_roll
        if getattr(r, "is_choice_gate", False):
            roll_text = (
                f"\n=== MECHANICS CHECK OUTCOME FOR {character.name} ===\n"
                f"- Decisive Moment: Resulted in [{r.outcome_tier}] (d20({r.d20_raw}) = {r.total} vs DC {r.difficulty_class})\n"
                f"- Directive: {r.plan_directive}\n"
            )
        else:
            directive_line = f"- Plan Directive: {r.plan_directive}\n" if r.plan_directive else f"- Directive: {r.narrative_directive}\n"
            roll_text = (
                f"\n=== MECHANICS CHECK OUTCOME FOR {character.name} ===\n"
                f"- Action: {r.action_description} ({r.skill_or_approach}, Role: {r.check_role})\n"
                f"- Result: [{r.outcome_tier}] (d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class})\n"
                f"{directive_line}"
                f"- CRITICAL RULE: Your tactical <plan> MUST strictly reflect this [{r.outcome_tier}]:\n"
                f"  * Critical Failure: Your planned action backfires with severe consequences. Adapt your plan to handle the disaster.\n"
                f"  * Failure with Consequences: Your attempt fails and creates complications/resistance.\n"
                f"  * Simple Failure: Your attempt simply doesn't succeed; no immediate aggravations.\n"
                f"  * Clean Success: You succeed cleanly as intended.\n"
                f"  * Critical Success: You succeed beyond expectations, gaining an extra advantage/opening.\n"
            )

    voice_quotes = [v.snippet for v in character.voice_anchors[:2]]

    co_present_text = "\n".join(
        f"  - {c.name} (id='{c.id}'): {c.tagline}"
        for c in co_present_characters
    ) or "  - None (alone with user)"

    prior_cues_section = ""
    if prior_cues:
        cue_lines = []
        for c in prior_cues:
            roll_note = f" [Roll: {c.roll_outcome_tier}]" if c.roll_outcome_tier else ""
            conseq_note = f" Fallout: '{c.observable_consequence_hint}'." if c.observable_consequence_hint else ""
            cue_lines.append(
                f"  - {c.character_name}: Outward posture: '{c.feeling_summary}'. Aim: '{c.want_summary}'. Action: '{c.observable_action_hint}'.{roll_note}{conseq_note}"
            )
        prior_cues_section = (
            "\nObservable Co-Present Character Actions & Postures this turn:\n"
            + "\n".join(cue_lines)
            + "\n*(Note: You observe their outward behavior and stance, not their private subconscious memories.)*\n"
        )

    if (char_roll and char_roll.outcome_tier in ("Critical Failure", "Critical Success")) or choice_resolution:
        anchor_guideline = "*(Anchor guideline: This turn involves a critical outcome or direct choice constraint! Sharp immediate shifts in feeling_tone, feeling_intensity, and feeling_agency are explicitly warranted.)*"
    else:
        anchor_guideline = "*(Anchor guideline: Evolve your emotional stance naturally from this baseline unless this turn introduces an acute shock, betrayal, or danger.)*"

    prior_care = ensure_snapshot_care_state(
        previous_state,
        character.baseline_psyche,
    )
    co_present_name_map = {c.id: c.name for c in co_present_characters}
    co_present_ids_set = {c.id for c in co_present_characters}
    affective_anchor_block = render_zone4_affective_block(
        prior_care,
        character_name=character.name,
        persona_name=known_persona.name if known_persona is not None else None,
        character_name_map=co_present_name_map,
        active_speaker_id=pre_turn.active_speaker_id,
        co_present_ids=co_present_ids_set,
        max_npc_edges=2,
    )

    choice_directive_text = ""
    if choice_resolution:
        from app.engine.choices import render_choice_directive
        choice_directive_text = render_choice_directive(choice_resolution, character.name) + "\n"

    selected_local_lore = select_active_location_lore_for_turn(
        active_location,
        user_message=user_message,
        pre_turn=pre_turn,
        narrator_directive=narrator_directive,
    )
    local_lore_section = ""
    if selected_local_lore:
        loc_lore_lines = "\n".join(
            f"  * [{'SECRET — DISCOVERED' if ln.category == 'secret' else ln.category.upper()}] {ln.title}: {ln.content}"
            for ln in selected_local_lore
        )
        local_lore_section = f"- Local Facts & Rumors:\n{loc_lore_lines}\n"

    known_player_facts_section = ""
    if known_persona is not None:
        lines: list[str] = [f"Player Character ({known_persona.name}):"]
        if known_persona.physical_appearance:
            lines.append(f"- Appearance: {known_persona.physical_appearance}")
        if known_persona.revealed_age:
            lines.append(f"- Known Age: {known_persona.revealed_age}")
        if known_persona.visible_equipped:
            eq_names = [f"{it.name}{' (' + it.note + ')' if it.note else ''}" for it in known_persona.visible_equipped]
            lines.append(f"- Visible Garments/Gear: {', '.join(eq_names)}")
        if known_persona.known_inventory:
            inv_names = [f"{it.name}{' (' + it.note + ')' if it.note else ''}" for it in known_persona.known_inventory]
            lines.append(f"- Known Carried Items: {', '.join(inv_names)}")
        if known_persona.known_lore:
            for l in known_persona.known_lore:
                lines.append(f"- Known Player Background: [{l.title}] {l.content}")
        known_player_facts_section = (
            f"Known Player Facts & Secrets (epistemically verified for {character.name}):\n"
            + "\n".join(lines)
            + "\n\n"
        )

    clean_prev_want = (
        _sanitize_cognition_text(previous_state.active_want, field_type="want")
        or character.baseline_psyche.default_want
        or "Assess the situation and respond."
    )
    clean_prev_plan = (
        _sanitize_cognition_text(previous_state.active_plan, field_type="plan")
        or character.baseline_psyche.default_plan
        or "Observe surroundings and maintain stance."
    )

    user_prompt = (
        f"Character: {character.name} (id='{character.id}', Role in scene: {role})\n"
        f"- Tagline: {character.tagline}\n"
        f"- Core Persona: {character.core_persona[:250]}\n"
        f"- Core Drive: {character.baseline_psyche.core_drive}\n"
        f"- Core Fear: {character.baseline_psyche.core_fear}\n"
        f"- Voice Quotes: {', '.join(voice_quotes) or 'None'}\n\n"
        f"Previous Psychological State (Emotional Anchor):\n"
        f"{affective_anchor_block}\n"
        f"- Active Want: {clean_prev_want}\n"
        f"- Active Plan: {clean_prev_plan}\n"
        f"{anchor_guideline}\n\n"
        f"Available Physical Affordances:\n"
        f"- [1] Equipped / In-Hand: {', '.join(format_item_names(previous_state.equipped)) or 'None'}\n"
        f"- [2] Carried Inventory: {', '.join(format_item_names(previous_state.inventory)) or 'None'}\n"
        f"- [3] Scene Props & Fixtures ({active_location.name}): {', '.join(active_location.environmental_tags) or 'None'}\n\n"
        f"Environment Details ({active_location.name}):\n"
        f"{local_lore_section}\n"
        f"Co-Present Characters in Room:\n"
        f"{co_present_text}\n"
        f"{prior_cues_section}\n"
        f"{known_player_facts_section}"
        f"Turn Context:\n"
        f"- User Sentiment: {pre_turn.user_sentiment}\n"
        f"- Subtext Interpretation: {pre_turn.subtext_interpretation}\n"
        f"{roll_text}\n"
        f"{choice_directive_text}"
        f"Recalled Scoped Memories & Lore (Context for internal orientation only — do NOT transcribe into <recall>):\n"
        f"{recalled_text}\n\n"
    )

    eff_public = public_message if public_message is not None else user_message
    directed_sections: list[str] = []
    if char_whisper:
        if char_whisper.speech_parts:
            s_lines = "\n".join(f'  - "{s}"' for s in char_whisper.speech_parts)
            directed_sections.append(f"Player Dialogue Directed Specifically To You:\n{s_lines}")
        if char_whisper.sensory_parts:
            sens_lines = "\n".join(f"  - {s}" for s in char_whisper.sensory_parts)
            directed_sections.append(
                f"Private Perception / Sensory Cues (Known ONLY to you, not spoken aloud):\n{sens_lines}"
            )
    directed_block = ("\n\n" + "\n\n".join(directed_sections)) if directed_sections else ""

    user_prompt += (
        f"Shared Scene Action (Observed by everyone in the room):\n"
        f"\"{eff_public}\""
        f"{directed_block}"
    )

    eff_profile = profile or settings.clerk_profile
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    import sys
    p3_mod = sys.modules.get("app.engine.phase3_actor")
    active_client = getattr(p3_mod, "llm_client", llm_client) if p3_mod else llm_client

    from app.engine.choices import (
        build_directed_cognition_schema,
        build_undirected_cognition_schema,
        coerce_choice_compliance,
    )
    if choice_resolution:
        eff_schema = build_directed_cognition_schema(choice_resolution)
    else:
        eff_schema = build_undirected_cognition_schema()

    try:
        cog = await active_client.complete_structured(
            messages,
            CognitionBlock,
            profile=eff_profile,
            max_tokens=1024,
            temperature=0.7,
            required_properties=eff_schema.get("required"),
            json_schema=eff_schema,
        )

        cog.recall = _sanitize_cognition_text(
            cog.recall,
            field_type="recall",
            location_id=active_location.id,
        )
        cog.recall = _format_cognition_bullets(cog.recall, max_bullets=2, max_words_per_bullet=30)

        cog.want = _sanitize_cognition_text(cog.want, field_type="want")
        if not cog.want:
            cog.want = clean_prev_want

        cog.plan = _sanitize_cognition_text(cog.plan, field_type="plan")
        if not cog.plan:
            cog.plan = clean_prev_plan
        cog.plan = _format_cognition_bullets(cog.plan, max_bullets=3, max_words_per_bullet=25)

        val_match = re.search(r"valence:\s*([+-]?\d+(?:\.\d+)?)", cog.feeling, flags=re.I)
        ar_match = re.search(r"arousal:\s*([+-]?\d+(?:\.\d+)?)", cog.feeling, flags=re.I)
        if val_match and cog.valence == 0.0:
            try:
                cog.valence = max(-1.0, min(1.0, float(val_match.group(1))))
            except ValueError:
                pass
        if ar_match and cog.arousal == 0.5:
            try:
                cog.arousal = max(0.0, min(1.0, float(ar_match.group(1))))
            except ValueError:
                pass
        cog.feeling = re.sub(r"\s*\(Valence:.*?\)", "", cog.feeling, flags=re.I).strip()
        cog.feeling = re.sub(r"^(?:<feeling[^>]*>|feeling>|\[feeling\])\s*", "", cog.feeling, flags=re.I)
        cog.feeling = re.sub(r"</feeling>$", "", cog.feeling, flags=re.I).strip()

        if not cog.feeling or cog.feeling.strip().lower() in ("neutral", "calibrating..."):
            cog.feeling = previous_state.mood_label or "Observant and measured."

        if choice_resolution:
            cog = coerce_choice_compliance(cog, choice_resolution, previous_state)

        if char_roll and not cog.roll_outcome_tier:
            cog.roll_outcome_tier = char_roll.outcome_tier

        cog.skipped = False
        return cog
    except Exception as exc:
        logger.warning(
            "Structured cognition agent failed for %s (%s). Falling back to heuristic: %s",
            character.name,
            character.id,
            exc,
        )
        return heuristic_character_cognition(
            user_message=user_message,
            character=character,
            previous_state=previous_state,
            pre_turn=pre_turn,
            prior_cues=prior_cues,
            role=role,
            choice_resolution=choice_resolution,
        )


async def run_phase3_multi_cognition(
    *,
    context: TurnContextBundle,
    profile: ModelProfile | None = None,
    dispatch_mode: str = "sequential",
    cognition_system_template: str | None = None,
    on_progress: Phase3ProgressCallback | None = None,
) -> dict[str, CognitionBlock]:
    """Phase 3: Multi-Character Cognition Swarm.
    Dispatches character cognition agents sequentially or in parallel,
    emitting real-time lifecycle SSE events.
    """
    if context.is_narrator or not context.present_characters:
        if on_progress:
            await on_progress(
                Phase3ProgressEvent(
                    event="phase3_start",
                    dispatch_mode=dispatch_mode,
                    roster=[],
                )
            )
            await on_progress(
                Phase3ProgressEvent(
                    event="phase3_complete",
                    dispatch_mode=dispatch_mode,
                    cognitions={},
                    character_names={},
                )
            )
        return {}

    primary_id = context.pre_turn.active_speaker_id or context.present_characters[0].id
    from app.engine.choices import cognition_dispatch_order
    choice_target_ids = set(context.pre_turn.choice_resolutions.keys())
    ordered_characters = cognition_dispatch_order(
        context.present_characters,
        primary_id=primary_id,
        choice_target_ids=choice_target_ids,
    )
    roster = [
        Phase3RosterEntry(
            character_id=c.id,
            character_name=c.name,
            role="primary_speaker" if c.id == primary_id else "co_present",
        )
        for c in ordered_characters
    ]

    if on_progress:
        await on_progress(
            Phase3ProgressEvent(
                event="phase3_start",
                dispatch_mode=dispatch_mode,
                roster=roster,
            )
        )

    char_lookup = {c.id: c for c in context.present_characters}
    results: dict[str, CognitionBlock] = {}

    decomp = getattr(context, "decomposed_message", None)
    if decomp is None:
        decomp = decompose_user_message(context.user_message, context.present_characters)

    semaphore = asyncio.Semaphore(4)

    if dispatch_mode == "parallel":
        async def _run_parallel_entry(entry: Phase3RosterEntry) -> tuple[str, CognitionBlock]:
            char = char_lookup.get(entry.character_id)
            if not char:
                return entry.character_id, CognitionBlock(skipped=True)
            if on_progress:
                await on_progress(
                    Phase3ProgressEvent(
                        event="phase3_agent_start",
                        dispatch_mode=dispatch_mode,
                        character_id=entry.character_id,
                        character_name=entry.character_name,
                        role=entry.role,
                    )
                )
            c_res = context.pre_turn.choice_resolutions.get(entry.character_id)
            known_p = (context.per_character_known_personas or {}).get(char.id)
            char_w = decomp.whispers_by_character_id.get(char.id)
            pub_text = decomp.public_text
            try:
                char_prev = context.all_character_states.get(
                    char.id
                ) or resolve_character_previous_state(
                    context.branch_turns, char, context.active_location.id
                )
                async with semaphore:
                    cog = await run_character_cognition_agent(
                        user_message=context.user_message,
                        character=char,
                        world=context.world,
                        role=entry.role,
                        previous_state=char_prev,
                        active_location=context.active_location,
                        neighbors=context.neighbors,
                        shared_scene_items=context.shared_scene_items,
                        character_recalled_items=context.per_character_recalled_items.get(
                            char.id, []
                        ),
                        pre_turn=context.pre_turn,
                        co_present_characters=[
                            c for c in context.present_characters if c.id != char.id
                        ],
                        prior_cues=None,
                        profile=profile,
                        system_prompt_template=cognition_system_template,
                        choice_resolution=c_res,
                        narrator_directive=context.narrator_directive,
                        known_persona=known_p,
                        public_message=pub_text,
                        char_whisper=char_w,
                    )
                used_fallback = False
            except Exception as err:
                logger.warning("Parallel Phase 3 error for %s: %s", char.name, err)
                char_prev = context.all_character_states.get(
                    char.id
                ) or resolve_character_previous_state(
                    context.branch_turns, char, context.active_location.id
                )
                cog = heuristic_character_cognition(
                    user_message=context.user_message,
                    character=char,
                    previous_state=char_prev,
                    pre_turn=context.pre_turn,
                    role=entry.role,
                    choice_resolution=c_res,
                    known_persona=known_p,
                    public_message=pub_text,
                    char_whisper=char_w,
                )
                used_fallback = True

            if on_progress:
                await on_progress(
                    Phase3ProgressEvent(
                        event="phase3_agent_complete",
                        dispatch_mode=dispatch_mode,
                        character_id=entry.character_id,
                        character_name=entry.character_name,
                        role=entry.role,
                        cognition=cog,
                        used_fallback=used_fallback,
                        choice_compliance=cog.choice_compliance,
                        choice_compliance_note=cog.choice_compliance_note,
                    )
                )
            return entry.character_id, cog

        gathered = await asyncio.gather(*[_run_parallel_entry(e) for e in roster])
        results = {cid: cog for cid, cog in gathered}
    else:
        # Sequential mode: accumulate prior cues
        prior_cues: list[PriorCognitionCue] = []
        for entry in roster:
            char = char_lookup.get(entry.character_id)
            if not char:
                continue
            if on_progress:
                await on_progress(
                    Phase3ProgressEvent(
                        event="phase3_agent_start",
                        dispatch_mode=dispatch_mode,
                        character_id=entry.character_id,
                        character_name=entry.character_name,
                        role=entry.role,
                    )
                )
            c_res = context.pre_turn.choice_resolutions.get(entry.character_id)
            known_p = (context.per_character_known_personas or {}).get(char.id)
            char_w = decomp.whispers_by_character_id.get(char.id)
            pub_text = decomp.public_text
            try:
                char_prev = context.all_character_states.get(
                    char.id
                ) or resolve_character_previous_state(
                    context.branch_turns, char, context.active_location.id
                )
                cog = await run_character_cognition_agent(
                    user_message=context.user_message,
                    character=char,
                    world=context.world,
                    role=entry.role,
                    previous_state=char_prev,
                    active_location=context.active_location,
                    neighbors=context.neighbors,
                    shared_scene_items=context.shared_scene_items,
                    character_recalled_items=context.per_character_recalled_items.get(
                        char.id, []
                    ),
                    pre_turn=context.pre_turn,
                    co_present_characters=[
                        c for c in context.present_characters if c.id != char.id
                    ],
                    prior_cues=list(prior_cues),
                    profile=profile,
                    system_prompt_template=cognition_system_template,
                    choice_resolution=c_res,
                    narrator_directive=context.narrator_directive,
                    known_persona=known_p,
                    public_message=pub_text,
                    char_whisper=char_w,
                )
                used_fallback = False
            except Exception as err:
                logger.warning("Sequential Phase 3 error for %s: %s", char.name, err)
                char_prev = context.all_character_states.get(
                    char.id
                ) or resolve_character_previous_state(
                    context.branch_turns, char, context.active_location.id
                )
                cog = heuristic_character_cognition(
                    user_message=context.user_message,
                    character=char,
                    previous_state=char_prev,
                    pre_turn=context.pre_turn,
                    prior_cues=list(prior_cues),
                    role=entry.role,
                    choice_resolution=c_res,
                    known_persona=known_p,
                    public_message=pub_text,
                    char_whisper=char_w,
                )
                used_fallback = True

            results[char.id] = cog

            first_plan_action = cog.plan.splitlines()[0] if cog.plan else "observing"
            first_plan_action = re.sub(r"^[-*•\d.)\s]+", "", first_plan_action).strip()

            c_roll = context.pre_turn.character_rolls.get(char.id)
            c_tier = c_roll.outcome_tier if c_roll else None
            c_consequence = ""
            if c_roll and len(cog.plan.splitlines()) > 1:
                c_consequence = re.sub(r"^[-*•\d.)\s]+", "", cog.plan.splitlines()[1]).strip()

            # Prevent leaking private whisper states or composure-masked hidden distress into outward posture cues
            has_secret_whisper = bool(char_w and char_w.sensory_parts)
            cue_base_care = ensure_snapshot_care_state(
                char_prev,
                char.baseline_psyche,
                elapsed_minutes=context.leaf_turn.world_snapshot.campaign_elapsed_minutes,
            )
            cue_preview = compute_provisional_cognition_preview(
                cue_base_care,
                cog.to_feeling_impulse(),
                roll_outcome=c_tier,
            )
            prior_cues.append(
                PriorCognitionCue(
                    character_id=char.id,
                    character_name=char.name,
                    feeling_summary="Alert, assessing scene" if has_secret_whisper else cue_preview.outward_demeanor,
                    want_summary="Respond to immediate developments" if has_secret_whisper else cog.want,
                    observable_action_hint=first_plan_action,
                    roll_outcome_tier=c_tier,
                    observable_consequence_hint=c_consequence,
                )
            )

            if on_progress:
                await on_progress(
                    Phase3ProgressEvent(
                        event="phase3_agent_complete",
                        dispatch_mode=dispatch_mode,
                        character_id=entry.character_id,
                        character_name=entry.character_name,
                        role=entry.role,
                        cognition=cog,
                        used_fallback=used_fallback,
                        choice_compliance=cog.choice_compliance,
                        choice_compliance_note=cog.choice_compliance_note,
                    )
                )

    if on_progress:
        await on_progress(
            Phase3ProgressEvent(
                event="phase3_complete",
                dispatch_mode=dispatch_mode,
                cognitions=results,
                character_names={c.id: c.name for c in context.present_characters},
            )
        )

    return results


async def generate_clerk_cognition(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CognitionBlock:
    """Backward-compatible helper matching legacy generate_clerk_cognition signature."""
    from app.schemas.world import WorldGlobalRules, WorldRecord
    mock_world = WorldRecord(
        id="world_context",
        owner_id="system",
        name="Interactive World",
        global_rules=WorldGlobalRules(
            genre="Roleplay",
            tone="Atmospheric",
            setting_overview=active_location.description,
            tech_or_magic_rules="",
            starting_timestamp="2026-11-02 00:00",
        ),
        created_at="2026-11-02T00:00:00Z",
    )
    return await run_character_cognition_agent(
        user_message=user_message,
        character=character,
        world=mock_world,
        role="primary_speaker",
        previous_state=previous_state,
        active_location=active_location,
        neighbors=neighbors,
        shared_scene_items=recalled_items,
        character_recalled_items=[],
        pre_turn=pre_turn,
        co_present_characters=[],
        prior_cues=None,
        profile=profile,
        system_prompt_template=prompt_template,
    )
