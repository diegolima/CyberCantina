"""Phase 3: Per-Character Multi-Cognition Swarm & State Reasoning."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging
import re
from typing import Any

from app.config import settings
from app.engine.phase2_context import TurnContextBundle, resolve_character_previous_state
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.prompts.defaults import (
    DEFAULT_CHARACTER_COGNITION_SYSTEM,
    PROMPT_KEY_CHARACTER_COGNITION,
)
from app.schemas.auth import ModelProfile
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import (
    CharacterSpotlightRole,
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
_PLAN_RE = re.compile(r"<plan>(.*?)</plan>", re.DOTALL | re.IGNORECASE)
_VALENCE_ATTR_RE = re.compile(r'valence=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)
_AROUSAL_ATTR_RE = re.compile(r'arousal=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


def parse_cognition_xml(
    cognition_xml: str,
    fallback_state: CharacterStateSnapshot,
) -> CognitionBlock:
    """Parse inner tags of <cognition>...</cognition> into a validated CognitionBlock."""
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
    valence = fallback_state.valence
    arousal = fallback_state.arousal

    if feeling_match:
        attrs = feeling_match.group("attrs") or ""
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

    want = want_match.group(1).strip() if want_match else fallback_state.active_want
    plan = plan_match.group(1).strip() if plan_match else fallback_state.active_plan

    return CognitionBlock(
        recall=recall,
        feeling=feeling,
        valence=round(valence, 2),
        arousal=round(arousal, 2),
        want=want,
        plan=plan,
    )


def _format_cognition_bullets(text: str) -> str:
    """Format cognition multi-item fields (recall, plan) into clean newline-separated bullet points."""
    if not text:
        return ""
    t = re.sub(r"^[,\s\[]+", "", text).strip()
    t = re.sub(r"[\]\s]+$", "", t).strip()
    t = re.sub(
        r"\[(EPISODIC_CHUNK|CHARACTER_SHARD|LORE)\]\s*",
        "",
        t,
        flags=re.I,
    ).strip()

    if "\n" not in t and re.search(r"\b[1-9][.)]\s+", t):
        parts = re.split(r"\s*(?:^|\b)[1-9][.)]\s+", t)
        items = [f"- {p.strip()}" for p in parts if p.strip()]
        if items:
            return "\n".join(items)

    lines: list[str] = []
    for line in t.splitlines():
        line = line.strip()
        if not line:
            continue
        cleaned = re.sub(r"^(?:[-*•]|\d+[.)])\s*", "- ", line)
        if not cleaned.startswith("- "):
            cleaned = f"- {cleaned}"
        lines.append(cleaned)

    if lines:
        return "\n".join(lines)

    return f"- {t}" if not t.startswith("- ") else t


@dataclass(frozen=True)
class PriorCognitionCue:
    """Observable outward cue from a character evaluated earlier in sequential mode."""

    character_id: str
    character_name: str
    feeling_summary: str
    want_summary: str
    observable_action_hint: str


def heuristic_character_cognition(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    pre_turn: PreTurnAnalysis,
    prior_cues: list[PriorCognitionCue] | None = None,
    role: CharacterSpotlightRole = "primary_speaker",
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
    if prior_cues:
        for c in prior_cues[:2]:
            recall_bullets.append(f"- Clocked {c.character_name}'s reaction.")

    plan_bullets = (
        [
            f"- Address the player directly regarding: {user_message[:60]}...",
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

    return CognitionBlock(
        recall="\n".join(recall_bullets),
        feeling=f"{previous_state.mood_label}.{cues_text}",
        valence=new_valence,
        arousal=new_arousal,
        want=previous_state.active_want or character.baseline_psyche.default_want,
        plan="\n".join(plan_bullets),
        skipped=False,
    )


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

    # Scoped recalled items: shared room items + character's isolated memories
    all_recalled = list(shared_scene_items) + list(character_recalled_items)
    recalled_text = "\n".join(
        f"  - [{m.source_type.upper()}] {m.title}: {m.content}"
        for m in all_recalled
    ) or "  - No specific background lore triggered this turn."

    roll_text = ""
    if pre_turn.resolved_roll:
        r = pre_turn.resolved_roll
        roll_text = (
            f"\nMechanics Check Outcome:\n"
            f"Action: {r.action_description} ({r.skill_or_approach})\n"
            f"Result: [{r.outcome_tier}] - {r.narrative_directive}\n"
        )

    rel_text = (
        "; ".join(f"{k}: {v}" for k, v in previous_state.relationship_notes.items())
        or "None"
    )
    voice_quotes = [v.snippet for v in character.voice_anchors[:2]]

    co_present_text = "\n".join(
        f"  - {c.name} (id='{c.id}'): {c.tagline}"
        for c in co_present_characters
    ) or "  - None (alone with user)"

    prior_cues_section = ""
    if prior_cues:
        cue_lines = [
            f"  - {c.character_name}: Outward posture/mood: '{c.feeling_summary}'. Apparent aim: '{c.want_summary}'. Visible action: '{c.observable_action_hint}'"
            for c in prior_cues
        ]
        prior_cues_section = (
            "\nObservable Co-Present Character Actions & Postures this turn:\n"
            + "\n".join(cue_lines)
            + "\n*(Note: You observe their outward behavior and stance, not their private subconscious memories.)*\n"
        )

    user_prompt = (
        f"Character: {character.name} (id='{character.id}', Role in scene: {role})\n"
        f"- Tagline: {character.tagline}\n"
        f"- Core Persona: {character.core_persona[:250]}\n"
        f"- Core Drive: {character.baseline_psyche.core_drive}\n"
        f"- Core Fear: {character.baseline_psyche.core_fear}\n"
        f"- Voice Quotes: {', '.join(voice_quotes) or 'None'}\n\n"
        f"Previous Psychological State (Emotional Anchor):\n"
        f"- Mood: {previous_state.mood_label} (Valence: {previous_state.valence:+.2f}, Arousal: {previous_state.arousal:.2f})\n"
        f"- Active Want: {previous_state.active_want}\n"
        f"- Active Plan: {previous_state.active_plan}\n"
        f"- Relationship Notes: {rel_text}\n"
        f"- Equipped / Worn: {', '.join(previous_state.equipped) or 'None'}\n"
        f"- Carried Inventory: {', '.join(previous_state.inventory) or 'None'}\n"
        f"*(Anchor guideline: evolve valence and arousal gradually from this previous baseline unless this turn brings a critical dramatic shock or danger.)*\n\n"
        f"Environment ({active_location.name}):\n"
        f"- Atmosphere/Props: {', '.join(active_location.environmental_tags) or 'None'}\n\n"
        f"Co-Present Characters in Room:\n"
        f"{co_present_text}\n"
        f"{prior_cues_section}"
        f"Turn Context:\n"
        f"- User Sentiment: {pre_turn.user_sentiment}\n"
        f"- Subtext Interpretation: {pre_turn.subtext_interpretation}\n"
        f"{roll_text}\n"
        f"Recalled Scoped Memories & Lore:\n"
        f"{recalled_text}\n\n"
        f"User Action / Dialogue:\n"
        f"\"{user_message}\""
    )

    eff_profile = profile or settings.clerk_profile
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    import sys
    p3_mod = sys.modules.get("app.engine.phase3_actor")
    active_client = getattr(p3_mod, "llm_client", llm_client) if p3_mod else llm_client

    try:
        cog = await active_client.complete_structured(
            messages,
            CognitionBlock,
            profile=eff_profile,
            max_tokens=1024,
            temperature=0.7,
            required_properties=[
                "recall",
                "feeling",
                "valence",
                "arousal",
                "want",
                "plan",
                "skipped",
            ],
        )

        cog.recall = _format_cognition_bullets(cog.recall)
        cog.plan = _format_cognition_bullets(cog.plan)

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

        if not cog.feeling:
            cog.feeling = previous_state.mood_label or "Observant and measured."
        if not cog.want:
            cog.want = previous_state.active_want or "Assess the situation and respond."
        if not cog.plan:
            cog.plan = previous_state.active_plan or "Listen and react to the user."

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
    ordered_characters = sorted(
        context.present_characters,
        key=lambda c: (0 if c.id == primary_id else 1, c.id),
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
                    prior_cues=None,
                    profile=profile,
                    system_prompt_template=cognition_system_template,
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
                )
                used_fallback = True

            results[char.id] = cog

            first_plan_action = cog.plan.splitlines()[0] if cog.plan else "observing"
            first_plan_action = re.sub(r"^[-*•\d.)\s]+", "", first_plan_action).strip()
            prior_cues.append(
                PriorCognitionCue(
                    character_id=char.id,
                    character_name=char.name,
                    feeling_summary=cog.feeling,
                    want_summary=cog.want,
                    observable_action_hint=first_plan_action,
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
