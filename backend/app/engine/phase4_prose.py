"""Phase 4: Narrative Prose Generation & Streaming."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
import logging
import re
import sys
from typing import Any

from app.config import settings
from app.engine.llm_client import llm_client
from app.engine.phase3_cognition import parse_cognition_xml
from app.schemas.auth import ModelProfile
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import PreTurnAnalysis, RecalledMemoryItem
from app.schemas.world import LocationNode, NeighborLocationView

logger = logging.getLogger(__name__)


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


def build_offline_simulated_prose(
    *,
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    present_characters: list[CharacterRecord] | None = None,
    all_character_states: dict[str, CharacterStateSnapshot] | None = None,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    established_cognition: CognitionBlock | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    include_cognition: bool = False,
) -> str:
    """Construct offline simulated narrative prose (or legacy cognition+prose)."""
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
            lore_note = (
                f" Archival records mark: '{recalled_items[0].title}'."
                if recalled_items
                else ""
            )
            return (
                f"*{active_location.name} rests in quiet stasis beneath muted lighting. {active_location.description} "
                f"Sensory markers: {env_tags_str}.{lore_note} {exit_desc}*"
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
        else:
            directive_note = narrator_directive or "The environment remains indifferent"
            return (
                f"*{active_location.name}: {directive_note}. {active_location.description} "
                f"Current surroundings: {env_tags_str}.*"
            )

    # Narrative dialogue and action for the active character
    target_exit = neighbors[0] if neighbors else None
    if pre_turn.spatial_intent == "move_known" and pre_turn.target_location_hint:
        action_prose = (
            f"*{character.name} gives a curt nod toward {pre_turn.target_location_hint}, "
            f"checking the sightlines of {active_location.name} before moving.*\n\n"
            f"\"Come on, then. Let's not linger out in the open where every sensor in the sector can log us.\""
        )
    elif pre_turn.spatial_intent == "explore_new":
        action_prose = (
            f"*{character.name}'s eyes narrow as she steps forward beside you, the micro-servos in her "
            f"forearm clicking into readiness as the unmapped threshold opens ahead.*\n\n"
            f"\"Stay behind my left shoulder. Nobody's cleared this section in months.\""
        )
    elif pre_turn.character_rolls.get(character.id) is not None or pre_turn.resolved_roll is not None:
        roll = pre_turn.character_rolls.get(character.id) or pre_turn.resolved_roll
        assert roll is not None
        tier = roll.outcome_tier
        roll_tag = f"[{tier}: rolled {roll.total} vs DC {roll.difficulty_class}]"

        if tier == "Critical Success":
            action_prose = (
                f"*{character.name} executes the maneuver flawlessly inside {active_location.name} {roll_tag}, "
                f"turning an ambitious play into an overwhelming breakthrough.*\n\n"
                f"\"Flawless execution. We didn't just pull it off—we bought ourselves total leverage. Move before they catch on.\""
            )
        elif tier == "Clean Success":
            action_prose = (
                f"*{character.name} watches the maneuver succeed cleanly inside {active_location.name} {roll_tag}, "
                f"a measured nod of approval crossing her face.*\n\n"
                f"\"Clean work. It went down exactly as planned. Let's keep this momentum going.\""
            )
        elif tier == "Simple Failure":
            action_prose = (
                f"*{character.name} pauses as the attempt falls flat inside {active_location.name} {roll_tag}, "
                f"the mechanism or target remaining completely unmoved.*\n\n"
                f"\"Didn't take. Nothing broke and nobody heard us, but that angle is dead. Let's rethink our approach.\""
            )
        elif tier == "Failure with Consequences":
            action_prose = (
                f"*{character.name} stiffens as the attempt goes sideways inside {active_location.name} {roll_tag}, "
                f"drawing unwanted friction and resistance.*\n\n"
                f"\"Messy. That didn't go through and it cost us our footing. Heads up—we have complications to manage.\""
            )
        else:  # Critical Failure
            action_prose = (
                f"*{character.name} recoils in alarm as the action catastrophically backfires inside {active_location.name} {roll_tag}, "
                f"an immediate crisis detonating into the room.*\n\n"
                f"\"Look out! That completely unraveled—everything's blowing back on us! Move, now!\""
            )
    else:
        exit_mention = (
            f" then glances briefly toward the passage to {target_exit.destination.name},"
            if target_exit
            else ""
        )
        mem_cue = (
            f" *A flicker of recognition passes through her eyes—echoing '{recalled_items[0].title}'.* "
            if recalled_items
            else " "
        )
        action_prose = (
            f"*Inside {active_location.name}, {character.name} studies your face,{exit_mention} "
            f"before leaning an elbow against the counter.*\n\n"
            f"\"I hear what you're saying, even the part you're trying not to say out loud.\"{mem_cue}"
            f"\"So tell me straight—what's our move from here?\""
        )

    # If co-present characters exist, add subtle room reaction
    if present_characters and len(present_characters) > 1:
        other_chars = [c for c in present_characters if c.id != character.id]
        if other_chars:
            oc = other_chars[0]
            action_prose += f"\n\n*{oc.name} watches silently from near the entryway, arms crossed in quiet vigilance.*"

    if include_cognition:
        # Legacy compatibility format: wrap with <cognition>
        eff_cog = (
            established_cognition
            or (established_cognitions or {}).get(character.id)
        )
        if eff_cog:
            return (
                f"<cognition>\n"
                f"  <recall>\n{eff_cog.recall}\n  </recall>\n"
                f"  <feeling valence=\"{eff_cog.valence:+.2f}\" arousal=\"{eff_cog.arousal:.2f}\">{eff_cog.feeling}</feeling>\n"
                f"  <want>{eff_cog.want}</want>\n"
                f"  <plan>\n{eff_cog.plan}\n  </plan>\n"
                f"</cognition>\n"
                f"{action_prose}"
            )
        bullet_parsed = "- Holding onto the current thread."
        return (
            f"<cognition>\n"
            f"  <recall>\n{bullet_parsed}\n  </recall>\n"
            f"  <feeling valence=\"{previous_state.valence:+.2f}\" arousal=\"{previous_state.arousal:.2f}\">{previous_state.mood_label}</feeling>\n"
            f"  <want>{previous_state.active_want}</want>\n"
            f"  <plan>\n- Address player.\n  </plan>\n"
            f"</cognition>\n"
            f"{action_prose}"
        )

    return action_prose


async def stream_phase4_prose(
    *,
    messages: list[dict[str, str]],
    user_message: str,
    character: CharacterRecord,
    previous_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    present_characters: list[CharacterRecord] | None = None,
    all_character_states: dict[str, CharacterStateSnapshot] | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    profile: ModelProfile | None = None,
    is_narrator: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    pregenerated_cognition: CognitionBlock | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream Phase 4 Narrative Prose generation with leading-tag guard and fallback."""
    actor_prof = profile or settings.actor_profile
    cogs_map = established_cognitions or (
        {character.id: pregenerated_cognition}
        if pregenerated_cognition is not None and not is_narrator
        else {}
    )
    is_legacy_single_pass = (
        not is_narrator
        and pregenerated_cognition is None
        and not bool(established_cognitions)
    )

    primary_cognition = (
        cogs_map.get(character.id)
        if not is_narrator and character.id in cogs_map
        else (
            pregenerated_cognition
            if pregenerated_cognition is not None
            else CognitionBlock(
                recall=f"Observing {active_location.name}",
                feeling="Objective / Detached" if is_narrator else previous_state.mood_label,
                valence=0.0 if is_narrator else previous_state.valence,
                arousal=0.0 if is_narrator else previous_state.arousal,
                want="Depict environment neutrally" if is_narrator else previous_state.active_want,
                plan=narrator_directive or "Describe scene" if is_narrator else previous_state.active_plan,
                skipped=is_narrator or is_legacy_single_pass,
            )
        )
    )

    if not is_legacy_single_pass:
        yield {
            "event": "cognition_complete",
            "data": primary_cognition.model_dump(),
        }

    p3_mod = sys.modules.get("app.engine.phase3_actor")
    effective_client = getattr(p3_mod, "llm_client", llm_client) if p3_mod else llm_client

    async def _token_generator() -> AsyncIterator[str]:
        try:
            async for delta in effective_client.stream_chat(messages, profile=actor_prof):
                yield delta
        except Exception as exc:
            if not settings.allow_offline_fallback:
                raise
            logger.warning("Actor live streaming failed (%s); using offline simulated prose.", exc)
            simulated = build_offline_simulated_prose(
                user_message=user_message,
                character=character,
                previous_state=previous_state,
                active_location=active_location,
                neighbors=neighbors,
                recalled_items=recalled_items,
                pre_turn=pre_turn,
                present_characters=present_characters,
                all_character_states=all_character_states,
                is_narrator=is_narrator,
                narrative_mode=narrative_mode,
                narrator_directive=narrator_directive,
                established_cognition=primary_cognition,
                established_cognitions=cogs_map,
                include_cognition=is_legacy_single_pass,
            )
            step = 18
            for i in range(0, len(simulated), step):
                yield simulated[i : i + step]
                await asyncio.sleep(0.005)

    buffer = ""
    in_cognition = is_legacy_single_pass
    cognition_emitted = not is_legacy_single_pass
    prose_accumulator: list[str] = []

    # Leading-tag guard variables (active when not in legacy single-pass cognition)
    guard_active = not is_legacy_single_pass
    guard_buffer = ""

    async for delta in _token_generator():
        if in_cognition:
            buffer += delta
            lower_buf = buffer.lower()
            close_idx = lower_buf.find("</cognition>")
            if close_idx != -1:
                cog_end = close_idx + len("</cognition>")
                cog_raw = buffer[:cog_end]
                remainder = re.sub(r"^[\s`]*", "", buffer[cog_end:])
                primary_cognition = parse_cognition_xml(cog_raw, previous_state)
                in_cognition = False
                cognition_emitted = True
                yield {
                    "event": "cognition_complete",
                    "data": primary_cognition.model_dump(),
                }
                if remainder:
                    prose_accumulator.append(remainder)
                    yield {"event": "prose_delta", "data": {"delta": remainder}}
            elif (
                len(buffer) > 120
                and "<cognition" not in lower_buf
                and "<think" not in lower_buf
                and "<recall" not in lower_buf
            ):
                in_cognition = False
                cognition_emitted = True
                primary_cognition = CognitionBlock(
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
                    "data": primary_cognition.model_dump(),
                }
                prose_accumulator.append(buffer)
                yield {"event": "prose_delta", "data": {"delta": buffer}}
            else:
                yield {"event": "cognition_delta", "data": {"raw_buffer": buffer}}
        elif guard_active:
            guard_buffer += delta
            stripped = guard_buffer.lstrip()
            if not stripped:
                continue
            if not stripped.startswith("<"):
                guard_active = False
                prose_accumulator.append(guard_buffer)
                yield {"event": "prose_delta", "data": {"delta": guard_buffer}}
                guard_buffer = ""
            else:
                lower = stripped.lower()
                if "</cognition>" in lower:
                    idx = lower.find("</cognition>") + len("</cognition>")
                    remainder = stripped[idx:].lstrip()
                    guard_active = False
                    guard_buffer = ""
                    if remainder:
                        prose_accumulator.append(remainder)
                        yield {"event": "prose_delta", "data": {"delta": remainder}}
                elif "</think>" in lower:
                    idx = lower.find("</think>") + len("</think>")
                    remainder = stripped[idx:].lstrip()
                    guard_active = False
                    guard_buffer = ""
                    if remainder:
                        prose_accumulator.append(remainder)
                        yield {"event": "prose_delta", "data": {"delta": remainder}}
                elif len(stripped) > 120 and not any(
                    t in lower for t in ("<cognition", "<think", "<recall")
                ):
                    guard_active = False
                    prose_accumulator.append(guard_buffer)
                    yield {"event": "prose_delta", "data": {"delta": guard_buffer}}
                    guard_buffer = ""
        else:
            prose_accumulator.append(delta)
            yield {"event": "prose_delta", "data": {"delta": delta}}

    if in_cognition and not cognition_emitted:
        lower_buf = buffer.lower()
        if "<cognition" in lower_buf or "<recall" in lower_buf:
            primary_cognition = parse_cognition_xml(buffer, previous_state)
        else:
            primary_cognition = CognitionBlock(
                recall="",
                feeling=previous_state.mood_label,
                valence=previous_state.valence,
                arousal=previous_state.arousal,
                want=previous_state.active_want,
                plan=previous_state.active_plan,
                skipped=True,
            )
        yield {"event": "cognition_complete", "data": primary_cognition.model_dump()}
        cleaned = re.sub(
            r"<cognition>.*?</cognition>", "", buffer, flags=re.DOTALL | re.I
        ).strip()
        if cleaned:
            prose_accumulator.append(cleaned)
            yield {"event": "prose_delta", "data": {"delta": cleaned}}
    elif guard_buffer:
        cleaned = re.sub(
            r"<(?:cognition|think)>.*?</(?:cognition|think)>\s*",
            "",
            guard_buffer,
            flags=re.DOTALL | re.I,
        ).strip()
        if cleaned:
            prose_accumulator.append(cleaned)
            yield {"event": "prose_delta", "data": {"delta": cleaned}}

    final_prose = "".join(prose_accumulator).strip()
    yield {
        "event": "actor_finished",
        "data": {
            "cognition": primary_cognition.model_dump(),
            "cognitions": {cid: c.model_dump() for cid, c in cogs_map.items()},
            "raw_prose": final_prose,
        },
    }
