"""Phase 3: Single-Pass <cognition> + Narrative Prose Streamer & Parser."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from typing import Any

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import PreTurnAnalysis, RecalledMemoryItem
from app.schemas.world import LocationNode, NeighborLocationView

logger = logging.getLogger("cybercantina.phase3")

_RECALL_RE = re.compile(r"<recall>(.*?)</recall>", re.DOTALL | re.I)
_FEELING_RE = re.compile(
    r"<feeling(?P<attrs>[^>]*)>(?P<text>.*?)</feeling>",
    re.DOTALL | re.I,
)
_VALENCE_ATTR_RE = re.compile(r'valence\s*=\s*["\']?([+-]?\d+(?:\.\d+)?)["\']?', re.I)
_AROUSAL_ATTR_RE = re.compile(r'arousal\s*=\s*["\']?([+-]?\d+(?:\.\d+)?)["\']?', re.I)
_WANT_RE = re.compile(r"<want>(.*?)</want>", re.DOTALL | re.I)
_PLAN_RE = re.compile(r"<plan>(.*?)</plan>", re.DOTALL | re.I)


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

    recall = recall_match.group(1).strip() if recall_match else "- Holding onto the current thread of conversation."
    feeling = feeling_match.group("text").strip() if feeling_match else fallback_state.mood_label
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
    # Strip accidental outer brackets, commas, or raw metadata tags
    t = re.sub(r"^[,\s\[]+", "", text).strip()
    t = re.sub(r"[\]\s]+$", "", t).strip()
    t = re.sub(
        r"\[(EPISODIC_CHUNK|CHARACTER_SHARD|LORE)\]\s*",
        "",
        t,
        flags=re.I,
    ).strip()

    # If the model emitted numbered or bulleted items on a single line (e.g. '1. Foo 2. Bar' or '1) Foo 2) Bar')
    if "\n" not in t and re.search(r"\b[1-9][.)]\s+", t):
        parts = re.split(r"\s*(?:^|\b)[1-9][.)]\s+", t)
        items = [f"- {p.strip()}" for p in parts if p.strip()]
        if items:
            return "\n".join(items)

    # If the text has newlines, normalize each bullet prefix to standard '- '
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
    """Generate structured character cognition using the analytical Clerk model."""
    system_prompt = (
        prompt_template
        or (
            "You are the Cognitive & Psychological Director for {character_name}.\n"
            "Your task is to analyze the character's persona, current location, recent context, "
            "and the user's latest interaction to formulate the character's internal 4-step cognitive process.\n\n"
            "CRITICAL DIRECTIVES:\n"
            "- Deeply reflect {character_name}'s personality, baseline psyche, and emotional momentum.\n"
            "- recall: 1-3 concise bullet points (each on its own line starting with '- ') of relevant lore, history, or recent events directly shaping {character_name}'s thoughts right now. Do not write continuous prose; format strictly as bullet points. Do not include raw tags or timestamps.\n"
            "- feeling: 1 evocative sentence capturing {character_name}'s primary emotional state right now.\n"
            "- valence: A float between -1.0 (extremely negative/hostile) and 1.0 (extremely positive/euphoric).\n"
            "- arousal: A float between 0.0 (calm/subdued) and 1.0 (hyper-alert/agitated).\n"
            "- want: 1 singular sentence defining {character_name}'s immediate objective in this interaction.\n"
            "- plan: 2-3 brief sequential bullet points (each on its own line starting with '- ') detailing physical action, spoken dialogue, and tactical focus for this turn.\n"
            "- skipped: MUST be false."
        )
    ).replace("{character_name}", character.name)

    recalled_text = "\n".join(
        f"  - {m.title}: {m.content}"
        for m in recalled_items
    ) or "  - No specific background lore triggered this turn."

    roll_text = ""
    if pre_turn.resolved_roll:
        r = pre_turn.resolved_roll
        roll_text = (
            f"\nMechanics Check Outcome:\n"
            f"Action: {r.action_description} ({r.skill_or_approach})\n"
            f"Result: [{r.outcome_tier}] - {r.narrative_directive}\n"
        )

    rel_text = "; ".join(f"{k}: {v}" for k, v in previous_state.relationship_notes.items()) or "None"

    voice_quotes = [v.snippet for v in character.voice_anchors[:2]]
    user_prompt = (
        f"Character Profile:\n"
        f"- Name: {character.name}\n"
        f"- Tagline: {character.tagline}\n"
        f"- Core Persona: {character.core_persona[:200]}\n"
        f"- Core Drive: {character.baseline_psyche.core_drive}\n"
        f"- Core Fear: {character.baseline_psyche.core_fear}\n"
        f"- Voice Quotes: {', '.join(voice_quotes) or 'None'}\n\n"
        f"Previous Psychological State:\n"
        f"- Mood: {previous_state.mood_label} (Valence: {previous_state.valence:+.2f}, Arousal: {previous_state.arousal:.2f})\n"
        f"- Active Want: {previous_state.active_want}\n"
        f"- Active Plan: {previous_state.active_plan}\n"
        f"- Relationship Notes: {rel_text}\n\n"
        f"Environment ({active_location.name}):\n"
        f"- Atmosphere/Props: {', '.join(active_location.environmental_tags) or 'None'}\n\n"
        f"Turn Context:\n"
        f"- User Sentiment: {pre_turn.user_sentiment}\n"
        f"- Subtext Interpretation: {pre_turn.subtext_interpretation}\n"
        f"{roll_text}\n"
        f"Recalled Background Memories & Lore:\n"
        f"{recalled_text}\n\n"
        f"User Message:\n"
        f"\"{user_message}\""
    )

    clerk_prof = profile or settings.clerk_profile
    try:
        cog = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            CognitionBlock,
            profile=clerk_prof,
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

        # 1. Clean and normalize multi-step bullet lists for recall & plan
        cog.recall = _format_cognition_bullets(cog.recall)
        cog.plan = _format_cognition_bullets(cog.plan)

        # 2. Extract embedded (Valence: X, Arousal: Y) from feeling if model put it inside text
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

        # 3. Guard against blank fields
        if not cog.feeling:
            cog.feeling = previous_state.mood_label or "Observant and measured."
        if not cog.want:
            cog.want = previous_state.active_want or "Assess the situation and respond."
        if not cog.plan:
            cog.plan = previous_state.active_plan or "Listen and react to the user."

        cog.skipped = False
        return cog
    except Exception as exc:
        if not settings.allow_offline_fallback:
            raise
        logger.warning("Clerk cognition generation failed (%s); using heuristic cognition.", exc)
        simulated = build_offline_simulated_response(
            user_message=user_message,
            character=character,
            previous_state=previous_state,
            active_location=active_location,
            neighbors=neighbors,
            recalled_items=recalled_items,
            pre_turn=pre_turn,
        )
        cog = parse_cognition_xml(simulated, previous_state)
        cog.skipped = False
        return cog


def build_offline_simulated_response(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
) -> str:
    """Construct a context-grounded <cognition> + prose response when running without a live LLM server."""
    if is_narrator:
        env_tags_str = (
            ", ".join(active_location.environmental_tags)
            if active_location.environmental_tags
            else "ambient atmospheric hum"
        )
        exit_desc = (
            f"To the {neighbors[0].direction_label.lower()}, a passage leads toward {neighbors[0].destination.name}."
            if neighbors
            else "No open corridors are immediately prominent."
        )
        if narrative_mode == "describe":
            return (
                f"*{active_location.name} rests in quiet stasis beneath muted lighting. {active_location.description} "
                f"Sensory markers: {env_tags_str}. {exit_desc}*"
            )
        elif narrative_mode == "advance":
            return (
                f"*Minutes elapse steadily across {active_location.name}. The ambient cooling cycle completes with a soft pneumatic click. "
                f"Condensation trickles down exposed conduits, and the low drone of distant power conduits rises and falls.*"
            )
        elif narrative_mode == "complication":
            comp_detail = narrator_directive or "An electrical relay pops from an overhead conduit housing"
            return (
                f"*{active_location.name}: {comp_detail}. A burst of pale blue sparks arcs across the metal framework, "
                f"tripping an auxiliary breaker. A low warning chime pulses three times through the ventilation.*"
            )
        elif narrative_mode == "perception":
            lore_note = f" Faded industrial stenciling matches archival records: '{recalled_items[0].title}'." if recalled_items else ""
            return (
                f"*Careful inspection of {active_location.name} reveals subtle physical markers. "
                f"Fine hairline fractures run along the deck plating near the bulkhead, and the air carries a faint ozone tang.{lore_note}*"
            )
        else:
            directive_note = narrator_directive or "The environment remains indifferent"
            return (
                f"*{active_location.name}: {directive_note}. {active_location.description} "
                f"Current surroundings: {env_tags_str}.*"
            )

    if recalled_items:
        bullet_points = [
            f"- Recalling '{item.title}': {item.content}"
            for item in recalled_items[:2]
        ]
        top_memory = "\n".join(bullet_points)
    else:
        top_memory = f"- Watching the door of {active_location.name} and weighing {character.name}'s history here."

    if "vulnerable" in pre_turn.user_sentiment:
        new_val = _clamp(previous_state.valence + 0.15, -1.0, 1.0)
        new_arousal = _clamp(previous_state.arousal + 0.2, 0.0, 1.0)
        feeling_text = "Protective instinct kicking in beneath her dry exterior; alert and focused."
        want_text = "Stabilize the situation and get them somewhere safe away from prying eyes."
    elif "confrontational" in pre_turn.user_sentiment or "tense" in pre_turn.user_sentiment:
        new_val = _clamp(previous_state.valence - 0.25, -1.0, 1.0)
        new_arousal = _clamp(previous_state.arousal + 0.25, 0.0, 1.0)
        feeling_text = "Razor-sharp tension; guarded and unwilling to be backed into a corner."
        want_text = "Maintain control of the room and deter any reckless move."
    else:
        new_val = _clamp(previous_state.valence + 0.05, -1.0, 1.0)
        new_arousal = _clamp(previous_state.arousal, 0.0, 1.0)
        feeling_text = f"Measured and observant, reading their tone ({pre_turn.user_sentiment})."
        want_text = "Uncover the full truth of what brought them in tonight."

    target_exit = neighbors[0] if neighbors else None
    if pre_turn.spatial_intent == "move_known" and pre_turn.target_location_hint:
        plan_bullets = [
            f"- Check the immediate perimeter of {active_location.name} for sensors or eavesdroppers.",
            f"- Signal assent and lead the way toward {pre_turn.target_location_hint}.",
            "- Keep a sharp eye on corridor sightlines during transit.",
        ]
        action_prose = (
            f"*{character.name} gives a curt nod toward {pre_turn.target_location_hint}, "
            f"checking the sightlines of {active_location.name} before moving.*\n\n"
            f"\"Come on, then. Let's not linger out in the open where every sensor in the sector can log us.\""
        )
    elif pre_turn.spatial_intent == "explore_new":
        plan_bullets = [
            "- Shift posture into a ready defensive stance with hand resting near weapon.",
            "- Deliver a quiet warning about unmapped sector hazards.",
            "- Step forward into the breach to take point.",
        ]
        action_prose = (
            f"*{character.name}'s eyes narrow as she steps forward beside you, the micro-servos in her "
            f"forearm clicking into readiness as the unmapped threshold opens ahead.*\n\n"
            f"\"Stay behind my left shoulder. Nobody's cleared this section in months.\""
        )
    elif pre_turn.resolved_roll is not None:
        roll = pre_turn.resolved_roll
        plan_bullets = [
            f"- Observe the immediate outcome of their {roll.outcome_tier.lower()} action on {roll.skill_or_approach}.",
            "- Address their performance directly with dialogue.",
            "- Determine the immediate tactical follow-up in this room.",
        ]
        if "Success" in roll.outcome_tier:
            action_prose = (
                f"*{character.name} watches the maneuver play out inside {active_location.name} "
                f"[{roll.outcome_tier}: rolled {roll.total} vs DC {roll.difficulty_class}], "
                f"a faint smirk tugging at the corner of her mouth.*\n\n"
                f"\"Not bad. Most people who try that in here end up losing a finger—or their dignity. "
                f"Alright, you've bought yourself some leverage. What's the next play?\""
            )
        else:
            action_prose = (
                f"*{character.name} winces slightly as the attempt goes sideways inside {active_location.name} "
                f"[{roll.outcome_tier}: rolled {roll.total} vs DC {roll.difficulty_class}], "
                f"stepping in smoothly to contain the fallout.*\n\n"
                f"\"Easy—force it any harder and you'll trip every alarm on the block. Step back and let me look at it.\""
            )
    else:
        exit_mention = (
            f" glancing briefly toward the {target_exit.direction_label.lower()}"
            if target_exit
            else ""
        )
        plan_bullets = [
            "- Study their facial expression and body language across the counter.",
            "- Confront the unspoken subtext of their words directly in dialogue.",
            "- Prompt them for their next concrete move.",
        ]
        mem_cue = (
            f" \"And don't think I've forgotten about {recalled_items[0].title.lower()},\" *she adds quietly.*"
            if recalled_items
            else ""
        )
        action_prose = (
            f"*Inside {active_location.name}, {character.name} studies your face,{exit_mention} "
            f"before leaning an elbow against the counter.*\n\n"
            f"\"I hear what you're saying, even the part you're trying not to say out loud.\"{mem_cue} "
            f"\"So tell me straight—what's our move from here?\""
        )
    plan_text = "\n".join(plan_bullets)

    return (
        "<cognition>\n"
        f"  <recall>\n{top_memory}\n  </recall>\n"
        f"  <feeling valence=\"{new_val:.2f}\" arousal=\"{new_arousal:.2f}\">{feeling_text}</feeling>\n"
        f"  <want>{want_text}</want>\n"
        f"  <plan>\n{plan_text}\n  </plan>\n"
        "</cognition>\n"
        f"{action_prose}"
    )


async def stream_phase3_actor(
    *,
    messages: list[dict[str, str]],
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    profile: ModelProfile | None = None,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    pregenerated_cognition: CognitionBlock | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream Phase 3 response, splitting <cognition> tokens from narrative prose tokens in real time."""
    raw_chunks: list[str] = []
    actor_prof = profile or settings.actor_profile

    async def _token_generator() -> AsyncIterator[str]:
        try:
            async for delta in llm_client.stream_chat(messages, profile=actor_prof):
                yield delta
        except Exception:
            if not settings.allow_offline_fallback:
                raise
            simulated = build_offline_simulated_response(
                user_message=user_message,
                character=character,
                previous_state=previous_state,
                active_location=active_location,
                neighbors=neighbors,
                recalled_items=recalled_items,
                pre_turn=pre_turn,
                is_narrator=is_narrator,
                narrative_mode=narrative_mode,
                narrator_directive=narrator_directive,
            )
            if pregenerated_cognition is not None:
                simulated = re.sub(r"<cognition>.*?</cognition>\s*", "", simulated, flags=re.DOTALL | re.I)
            # Stream in small chunks to mirror real SSE token cadence
            step = 18
            for i in range(0, len(simulated), step):
                yield simulated[i : i + step]
                await asyncio.sleep(0.005)

    buffer = ""
    in_cognition = not is_narrator and pregenerated_cognition is None
    cognition_emitted = is_narrator or pregenerated_cognition is not None
    prose_Accumulator: list[str] = []
    cognition_block = (
        CognitionBlock(
            recall=f"Observing {active_location.name}",
            feeling="Objective / Detached",
            valence=0.0,
            arousal=0.0,
            want="Depict environment and world state neutrally",
            plan=narrator_directive
            or (
                "Describe scene environment"
                if narrative_mode == "describe"
                else (
                    "Depict unexpected complication"
                    if narrative_mode == "complication"
                    else (
                        "Detail subtle perceptual clues"
                        if narrative_mode == "perception"
                        else "Depict passage of time"
                    )
                )
            ),
        )
        if is_narrator
        else (
            pregenerated_cognition
            if pregenerated_cognition is not None
            else CognitionBlock(
                recall="",
                feeling=previous_state.mood_label,
                valence=previous_state.valence,
                arousal=previous_state.arousal,
                want=previous_state.active_want,
                plan=previous_state.active_plan,
                skipped=True,
            )
        )
    )

    if is_narrator or pregenerated_cognition is not None:
        yield {
            "event": "cognition_complete",
            "data": cognition_block.model_dump(),
        }

    async for delta in _token_generator():
        raw_chunks.append(delta)
        if in_cognition:
            buffer += delta
            lower_buf = buffer.lower()
            close_idx = lower_buf.find("</cognition>")
            if close_idx != -1:
                cog_end = close_idx + len("</cognition>")
                cog_raw = buffer[:cog_end]
                remainder = re.sub(r"^[\s`]*", "", buffer[cog_end:])
                cognition_block = parse_cognition_xml(cog_raw, previous_state)
                in_cognition = False
                cognition_emitted = True
                yield {
                    "event": "cognition_complete",
                    "data": cognition_block.model_dump(),
                }
                if remainder:
                    prose_Accumulator.append(remainder)
                    yield {"event": "prose_delta", "data": {"delta": remainder}}
            elif (
                len(buffer) > 120
                and "<cognition" not in lower_buf
                and "<think" not in lower_buf
                and "<recall" not in lower_buf
            ):
                # Model skipped <cognition>; flush buffer directly as prose
                in_cognition = False
                cognition_emitted = True
                cognition_block = CognitionBlock(
                    recall="",
                    feeling=previous_state.mood_label,
                    valence=previous_state.valence,
                    arousal=previous_state.arousal,
                    want=previous_state.active_want,
                    plan=previous_state.active_plan,
                    skipped=True,
                )
                yield {
                    "event": "cognition_complete",
                    "data": cognition_block.model_dump(),
                }
                prose_Accumulator.append(buffer)
                yield {"event": "prose_delta", "data": {"delta": buffer}}
            else:
                yield {"event": "cognition_delta", "data": {"raw_buffer": buffer}}
        else:
            prose_Accumulator.append(delta)
            yield {"event": "prose_delta", "data": {"delta": delta}}

    if not cognition_emitted:
        # Handle edge case where stream ended before </cognition> closed
        lower_buf = buffer.lower()
        if "<cognition" in lower_buf or "<recall" in lower_buf:
            cognition_block = parse_cognition_xml(buffer, previous_state)
        else:
            cognition_block = CognitionBlock(
                recall="",
                feeling=previous_state.mood_label,
                valence=previous_state.valence,
                arousal=previous_state.arousal,
                want=previous_state.active_want,
                plan=previous_state.active_plan,
                skipped=True,
            )
        yield {"event": "cognition_complete", "data": cognition_block.model_dump()}
        cleaned = re.sub(r"<cognition>.*?</cognition>", "", buffer, flags=re.DOTALL | re.I).strip()
        if cleaned:
            prose_Accumulator.append(cleaned)
            yield {"event": "prose_delta", "data": {"delta": cleaned}}

    final_prose = "".join(prose_Accumulator).strip()
    yield {
        "event": "actor_finished",
        "data": {
            "cognition": cognition_block.model_dump(),
            "raw_prose": final_prose,
        },
    }
