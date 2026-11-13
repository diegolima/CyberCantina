"""Heuristic delta extraction and LLM character post-turn state agent."""

from __future__ import annotations

import re

from app.config import (
    ModelProfile,
    settings,
)
from app.engine.affective_engine import (
    ensure_snapshot_care_state,
    render_zone4_affective_block,
)
from app.engine.llm_client import llm_client
from app.engine.mentions import (
    DecomposedUserMessage,
    filter_user_message_for_character,
)
from app.prompts import PROMPT_KEY_CHARACTER_POST_TURN
from app.prompts.renderer import (
    get_default_prompt,
    render_template,
)
from app.schemas.affective import (
    AgencyLevel,
    CopingLevel,
    FeelingTone,
    IntensityLevel,
    OrdinalImpact,
    RelationalEventSpec,
    ThreatLevel,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    ItemInstance,
    MemoryShard,
    format_item_names,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    ExtractedCharacterMemory,
    TurnNodeRecord,
)
from app.schemas.world import (
    LocationNode,
    NeighborLocationView,
)
from typing import Literal

from app.engine.char_agent.inventory import resolve_roll_for_character
from app.engine.char_agent.matching import (
    _GENERIC_ITEM_ADJECTIVES,
    logger,
    normalize_inventory_item,
    normalize_mood_label,
    normalize_stance_updates,
)

def _extract_scoped_heuristic_inventory(
    *,
    character: CharacterRecord,
    is_active_speaker: bool,
    present_characters: list[CharacterRecord],
    user_message: str,
    raw_prose: str,
    prev_state: CharacterStateSnapshot,
) -> tuple[list[str], list[str], list[str], list[str]]:
    """Deterministic per-character item extractor returning (equipped, unequipped, obtained, removed)."""
    other_chars = [c for c in present_characters if c.id != character.id]
    char_first = character.name.split()[0].lower() if character.name.split() else character.name.lower()

    def _mentions_other_npc_exclusively(segment: str) -> bool:
        seg_low = segment.lower()
        mentions_self = character.name.lower() in seg_low or (
            len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        )
        if mentions_self:
            return False
        for oc in other_chars:
            oc_first = oc.name.split()[0].lower() if oc.name.split() else oc.name.lower()
            if oc.name.lower() in seg_low or (
                len(oc_first) >= 3 and re.search(rf"\b{re.escape(oc_first)}\b", seg_low)
            ):
                return True
        return False

    def _segment_applies_to_character(segment: str, *, from_user_msg: bool) -> bool:
        seg_low = segment.lower()
        mentions_self = character.name.lower() in seg_low or (
            len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        )
        if mentions_self:
            return True
        if _mentions_other_npc_exclusively(segment):
            return False
        if from_user_msg:
            # In user message, "give you / hand you" applies to active speaker; "I pick up" is the player!
            if is_active_speaker and re.search(r"\b(?:hand|hands|give|gives|pass|passes|toss|tosses)\s+(?:you|her|him)\b", seg_low):
                return True
            if is_active_speaker and len(present_characters) == 1:
                # Preserve legacy single-character deterministic behavior where user/prose combined cues apply
                if not re.search(r"\bi\s+(?:pick up|pocket|grab|put on|wear|don)\b", seg_low):
                    return True
            return False
        return is_active_speaker

    items_equipped: list[str] = []
    items_unequipped: list[str] = []
    items_obtained: list[str] = []
    items_removed: list[str] = []

    current_all = [*prev_state.equipped, *prev_state.inventory]
    segments: list[tuple[str, bool]] = [
        *[(s, True) for s in re.split(r"(?<=[.!?])\s+|\n+", user_message) if s.strip()],
        *[(s, False) for s in re.split(r"(?<=[.!?])\s+|\n+", raw_prose) if s.strip()],
    ]

    for seg, from_user in segments:
        seg_low = seg.lower()

        # Check direct user handoff to a named character: "I hand Viktor the wrench" / "give Kira the keycard"
        if from_user and (
            character.name.lower() in seg_low
            or (len(char_first) >= 3 and re.search(rf"\b{re.escape(char_first)}\b", seg_low))
        ):
            named_give = re.finditer(
                rf"\b(?:hand|hands|give|gives|pass|passes|toss|tosses)\s+{re.escape(char_first)}(?:\s+[a-z]+)?\s+"
                r"(?:(?:an|a|the|my|this)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
                r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|in)\b)",
                seg,
                re.I,
            )
            for m in named_give:
                obj = m.group(1).strip()
                if len(obj) >= 3:
                    items_obtained.append(obj[0].upper() + obj[1:])

        if not _segment_applies_to_character(seg, from_user_msg=from_user):
            continue

        # 1. Holster / stow into carried inventory (unequip without dropping)
        if re.search(r"\b(holsters?|stows?|sheathes?|tucks?\s+away|puts?\s+away)\b", seg_low):
            for eq_item in prev_state.equipped:
                norm = normalize_inventory_item(eq_item)
                if not norm:
                    continue
                tokens = [w for w in re.findall(r"[a-z0-9]{4,}", norm) if w not in _GENERIC_ITEM_ADJECTIVES]
                if norm in seg_low or any(re.search(rf"\b{re.escape(tok)}\b", seg_low) for tok in tokens):
                    items_unequipped.append(eq_item.name if isinstance(eq_item, ItemInstance) else str(eq_item))

        # 2. Remove / drop / hand over / take off
        if re.search(
            r"\b(take off|takes off|took off|remove|removes|removed|shed|sheds|unfasten|unfastens|"
            r"strip off|strips off|drop|drops|dropped|hand over|hands over|give|gives|gave|toss|tosses|discard|discards)\b",
            seg_low,
        ):
            for item in current_all:
                if isinstance(item, ItemInstance) and "permanent" in item.flags:
                    continue
                norm = normalize_inventory_item(item)
                if not norm:
                    continue
                item_label = item.name if isinstance(item, ItemInstance) else str(item)
                if norm in seg_low:
                    items_removed.append(item_label)
                    continue
                tokens = [w for w in re.findall(r"[a-z0-9]{4,}", norm) if w not in _GENERIC_ITEM_ADJECTIVES]
                if any(re.search(rf"\b{re.escape(tok)}\b", seg_low) for tok in tokens):
                    items_removed.append(item_label)

        # 3. Wear / equip / draw
        wear_matches = re.finditer(
            r"\b(?:put on|puts on|pull on|pulls on|slip into|slips into|wear|wears|don|dons|draws?|equips?|wields?)\s+"
            r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
            r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|over|under|as|from|in)\b)",
            seg,
            re.I,
        )
        for m in wear_matches:
            garment = m.group(1).strip()
            if len(garment) >= 3 and garment.lower() not in {"it", "them", "this", "that", "gun", "closer", "breath"}:
                items_equipped.append(garment[0].upper() + garment[1:])

        # 4. Obtain / pick up / pocket
        acquire_matches = re.finditer(
            r"\b(?:pick up|picks up|pocket|pockets|grab|grabs|catch|catches|snatch|snatches|"
            r"hand you|hands you|give you|gives you|hand her|hands her|hand him|hands him|give her|gives her|give him|gives him)\s+"
            r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
            r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|off|on|in|into|across)\b)",
            seg,
            re.I,
        )
        for m in acquire_matches:
            obj = m.group(1).strip()
            if len(obj) >= 3 and obj.lower() not in {"it", "them", "this", "that", "him", "her", "me", "you"}:
                items_obtained.append(obj[0].upper() + obj[1:])

    return items_equipped, items_unequipped, items_obtained, items_removed


def heuristic_character_agent_delta(
    *,
    character: CharacterRecord,
    prev_state: CharacterStateSnapshot,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord],
    extracted_memories_fn=None,
    user_message_override: str | None = None,
) -> CharacterAgentDelta:
    """Deterministic per-character state delta used when running without a live Clerk LLM."""
    is_speaker = completed_turn.actor_id == character.id
    user_msg = user_message_override if user_message_override is not None else completed_turn.user_message
    raw_prose = completed_turn.raw_prose
    pre_turn = completed_turn.pre_turn
    combined_lower = f"{user_msg}\n{raw_prose}".lower()
    user_msg_lower = user_msg.lower()

    # 1. Categorical CARE Mood, Appraisal & Legacy Float Fallback (anchored strictly to prev_state)
    affect_tone: FeelingTone | None = None
    affect_intensity: IntensityLevel | None = None
    affect_agency: AgencyLevel | None = None
    scene_threat: ThreatLevel = "none"
    scene_coping: CopingLevel = "adequate"
    goal_congruence: OrdinalImpact = "none"
    scene_surprise: IntensityLevel = "calm"

    char_cog = (
        (completed_turn.cognitions or {}).get(character.id)
        if hasattr(completed_turn, "cognitions") and completed_turn.cognitions
        else (completed_turn.cognition if is_speaker else None)
    )
    char_roll = resolve_roll_for_character(pre_turn, character.id)

    if char_cog and not char_cog.skipped:
        imp = char_cog.to_feeling_impulse()
        affect_tone = imp.tone
        affect_intensity = imp.intensity
        affect_agency = imp.agency
        scene_threat = imp.threat
        scene_coping = imp.coping
        val_delta = round(char_cog.valence - prev_state.valence, 2)
        ar_delta = round(char_cog.arousal - prev_state.arousal, 2)
        mood = normalize_mood_label(char_cog.feeling, fallback=prev_state.mood_label)
        updated_want = char_cog.want or None
    elif char_roll:
        updated_want = None
        if char_roll.outcome_tier == "Critical Failure":
            affect_tone = "anguished"
            affect_intensity = "extreme"
            affect_agency = "helpless"
            scene_threat = "high"
            scene_coping = "overwhelmed"
            goal_congruence = "strong_neg"
            scene_surprise = "extreme"
            val_delta = -0.35
            ar_delta = 0.35
            mood = "Shaken, critical setback"
        elif char_roll.outcome_tier == "Failure with Consequences":
            affect_tone = "uneasy"
            affect_intensity = "high"
            affect_agency = "pressured"
            scene_threat = "moderate"
            scene_coping = "strained"
            goal_congruence = "mild_neg"
            scene_surprise = "moderate"
            val_delta = -0.15
            ar_delta = 0.15
            mood = "Guarded, tense strain"
        elif char_roll.outcome_tier == "Simple Failure":
            affect_tone = "guarded"
            affect_intensity = "moderate"
            affect_agency = "pressured"
            scene_threat = "low"
            scene_coping = "adequate"
            goal_congruence = "mild_neg"
            scene_surprise = "low"
            val_delta = -0.05
            ar_delta = 0.05
            mood = "Wary, thwarted attempt"
        elif char_roll.outcome_tier == "Clean Success":
            affect_tone = "content"
            affect_intensity = "moderate"
            affect_agency = "assured"
            scene_threat = "none"
            scene_coping = "adequate"
            goal_congruence = "mild_pos"
            scene_surprise = "low"
            val_delta = 0.15
            ar_delta = -0.05
            mood = "Confident, steady relief"
        else:  # Critical Success
            affect_tone = "elated"
            affect_intensity = "high"
            affect_agency = "commanding"
            scene_threat = "none"
            scene_coping = "mastery"
            goal_congruence = "strong_pos"
            scene_surprise = "high"
            val_delta = 0.30
            ar_delta = 0.15
            mood = "Triumphant, sharp breakthrough"
    else:
        updated_want = None
        sentiment_low = pre_turn.user_sentiment.lower()
        if (
            re.search(r"\b(betray(?:ed|al)?|sold .+ out|aims? a|points? a gun|threaten|traitor)\b", combined_lower)
            or "confrontational" in sentiment_low
            or "tense" in sentiment_low
        ):
            affect_tone = "hostile" if "betray" in combined_lower else "guarded"
            affect_intensity = "high"
            affect_agency = "steady"
            scene_threat = "high" if ("gun" in combined_lower or "betray" in combined_lower) else "moderate"
            scene_coping = "strained"
            goal_congruence = "strong_neg" if "betray" in combined_lower else "mild_neg"
            scene_surprise = "high" if "betray" in combined_lower else "low"
            val_delta = -0.12
            ar_delta = 0.15
            mood = "Guarded, tense vigilance"
        elif (
            "vulnerable" in sentiment_low
            or "trust" in combined_lower
            or "saved" in combined_lower
            or "restitution" in combined_lower
        ):
            affect_tone = "warm"
            affect_intensity = "moderate"
            affect_agency = "assured"
            scene_threat = "none"
            scene_coping = "adequate"
            goal_congruence = "mild_pos"
            val_delta = 0.10
            ar_delta = 0.06
            mood = "Attentive, quiet concern"
        else:
            val_delta = 0.02
            ar_delta = 0.0
            mood = normalize_mood_label(prev_state.mood_label, fallback="Observant and measured")

    # 2. Directed Relational Events & Stances (toward 'user' and co-present NPCs)
    stances: dict[str, str] = {}
    rel_events: list[RelationalEventSpec] = []
    char_first = character.name.split()[0].lower() if character.name.split() else character.name.lower()
    char_engaged = (
        is_speaker
        or character.name.lower() in combined_lower
        or (len(char_first) >= 3 and bool(re.search(rf"\b{re.escape(char_first)}\b", combined_lower)))
    )

    if char_engaged:
        if re.search(
            r"\b(betray(?:ed|al)?|sold .+ out|lied to|broke .+ trust|stabbed .+ back)\b",
            combined_lower,
        ):
            note = "Views them with sharp distrust after the exposed betrayal."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="strong_neg",
                    trust_shift="strong_neg",
                    grievance_shift="grave_wrong",
                    note=note,
                )
            )
        elif re.search(
            r"\b(make restitution|return(?:s|ed)? the stolen|atone|risked my life|saved (?:my|your|her|his) life|"
            r"shielded (?:me|you|her|him)|blood oath|solemn(?:ly)? (?:swear|vow))\b",
            combined_lower,
        ):
            note = "Holds cautious, deepening trust bound by costly proof of commitment."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="strong_pos",
                    respect_shift="strong_pos",
                    trust_shift="strong_pos",
                    grievance_shift="reconciled",
                    obligation_shift="strong_pos",
                    note=note,
                )
            )
        elif re.search(
            r"\b(aims? a|points? a gun|draws? a blade on|threaten(?:s|ed)?|kill you)\b",
            user_msg_lower,
        ):
            note = "Bracing against overt hostility and physical intimidation."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="strong_neg",
                    trust_shift="strong_neg",
                    power_shift="mild_neg",
                    grievance_shift="slighted",
                    note=note,
                )
            )
        elif re.search(
            r"\b(pathetic|coward|idiot|useless|worthless|mock(?:s|ed)?|insult(?:s|ed)?)\b",
            user_msg_lower,
        ):
            note = "Resents the open disrespect and sharp mockery."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="mild_neg",
                    respect_shift="mild_neg",
                    grievance_shift="slighted",
                    note=note,
                )
            )
        elif re.search(
            r"\b(nice jacket|you look nice|charming|flatter|sweet talk|pretty eyes|compliment|great hair)\b",
            user_msg_lower,
        ):
            note = "Registers the casual flattery without dropping deeper guard."
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="mild_pos",
                    trust_shift="none",
                    note=note,
                )
            )
        elif re.search(
            r"\b(buy you a drink|cover your tab|patch you up|here, take this|do you a favor|trust you)\b",
            user_msg_lower,
        ):
            note = "Appreciates the practical goodwill extended to them."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="mild_pos",
                    trust_shift="mild_pos",
                    obligation_shift="mild_pos",
                    note=note,
                )
            )
        elif "confrontational" in pre_turn.user_sentiment.lower():
            note = "Wary of their confrontational posture and watching their hands."
            stances["user"] = note
            rel_events.append(
                RelationalEventSpec(
                    target="user",
                    warmth_shift="mild_neg",
                    trust_shift="mild_neg",
                    note=note,
                )
            )

        for oc in present_characters:
            if oc.id == character.id:
                continue
            oc_first = oc.name.split()[0].lower() if oc.name.split() else oc.name.lower()
            oc_mentioned = oc.name.lower() in combined_lower or (
                len(oc_first) >= 3 and bool(re.search(rf"\b{re.escape(oc_first)}\b", combined_lower))
            )
            if oc_mentioned or (oc.id == completed_turn.actor_id):
                if oc.id not in prev_state.relationship_notes:
                    stances[oc.id] = f"Reading {oc.name}'s reactions closely in {active_location.name}."

    # 3. Scoped Inventory Transitions
    eq_add, eq_unequip, inv_obtain, inv_rem = _extract_scoped_heuristic_inventory(
        character=character,
        is_active_speaker=is_speaker,
        present_characters=present_characters,
        user_message=user_msg,
        raw_prose=raw_prose,
        prev_state=prev_state,
    )

    # 4. Independent Character Location Transition
    loc_transition: Literal["stay_here", "follow_player", "move_to_neighbor"] = "stay_here"
    target_loc_id: str | None = None
    msg_low = user_msg.lower()

    # Check if this NPC independently departed to a neighbor while the player stayed
    if pre_turn.spatial_intent == "stay" and neighbors:
        depart_re = re.compile(
            rf"\b{re.escape(char_first)}\b[^.!?\n]{{0,50}}\b(?:storms?\s+out|leaves?|walks?\s+(?:into|out|toward)|heads?\s+(?:into|to|toward)|retreats?\s+(?:into|to))\b",
            re.I,
        )
        if len(char_first) >= 3 and depart_re.search(raw_prose):
            for nb in neighbors:
                dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
                if nb.destination.name.lower() in raw_prose.lower() or any(w in raw_prose.lower() for w in dest_words):
                    loc_transition = "move_to_neighbor"
                    target_loc_id = nb.destination.id
                    break
    elif pre_turn.spatial_intent in ("move_known", "explore_new"):
        user_moved_alone = bool(
            re.search(r"\b(alone|by myself|without you|slip out alone|leave .+ behind)\b", msg_low)
        )
        told_to_stay = len(char_first) >= 3 and bool(
            re.search(
                rf"\b{re.escape(char_first)}\b[^.!?\n]{{0,30}}\b(?:stay here|wait here|hold the door|watch the door|stay behind)\b",
                msg_low,
            )
        )
        other_invited_exclusively = False
        if not is_speaker and len(present_characters) > 1 and not (
            character.name.lower() in msg_low
            or (len(char_first) >= 3 and re.search(rf"\b{re.escape(char_first)}\b", msg_low))
        ):
            for oc in present_characters:
                if oc.id == character.id:
                    continue
                oc_first = oc.name.split()[0].lower()
                if len(oc_first) >= 3 and re.search(
                    rf"\b(?:just|only)\s+{re.escape(oc_first)}\b|\b{re.escape(oc_first)},\s*(?:come|follow|walk)\s+with\s+me\b",
                    msg_low,
                ):
                    other_invited_exclusively = True
                    break

        if user_moved_alone or told_to_stay or other_invited_exclusively:
            loc_transition = "stay_here"
        else:
            loc_transition = "follow_player"

    # 5. Character-Specific Personal Memories
    memories: list[ExtractedCharacterMemory] = []
    if extracted_memories_fn is not None:
        all_candidates: list[ExtractedCharacterMemory] = extracted_memories_fn(
            user_message=user_msg,
            raw_prose=raw_prose,
            present_characters=present_characters,
            active_character=next((c for c in present_characters if c.id == completed_turn.actor_id), character),
            mentioned_entities=pre_turn.mentioned_entities,
        )
        memories = [m for m in all_candidates if m.character_id == character.id]

    return CharacterAgentDelta(
        mood_label=mood,
        affect_tone=affect_tone,
        affect_intensity=affect_intensity,
        affect_agency=affect_agency,
        scene_threat=scene_threat,
        scene_coping=scene_coping,
        goal_congruence=goal_congruence,
        scene_surprise=scene_surprise,
        relational_events=rel_events,
        valence_delta=val_delta,
        arousal_delta=ar_delta,
        updated_want=updated_want,
        stance_updates=stances,
        items_equipped=eq_add,
        items_unequipped=eq_unequip,
        items_obtained=inv_obtain,
        items_removed=inv_rem,
        location_transition=loc_transition,
        target_location_id=target_loc_id,
        new_memories=memories,
    )


async def run_character_post_turn_agent(
    *,
    character: CharacterRecord,
    prev_state: CharacterStateSnapshot,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord],
    all_participants: list[CharacterRecord],
    active_shards: list[MemoryShard],
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    extracted_memories_fn=None,
    persona_name: str | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
    campaign_elapsed_minutes: int = 0,
) -> CharacterAgentDelta:
    """Execute a focused Post-Turn Character State Agent for a single present character."""
    clerk_prof = profile or settings.clerk_profile
    is_speaker = completed_turn.actor_id == character.id
    name_map = {c.id: c.name for c in all_participants}
    name_map[character.id] = character.name

    co_present_lines = [
        f"- id='{c.id}': {c.name} ({c.tagline})"
        for c in present_characters
        if c.id != character.id
    ]
    co_present_str = "\n".join(co_present_lines) or "None (only you and the player)"

    neighbor_str = "\n".join(
        f"- id='{n.destination.id}': {n.destination.name} (via {n.direction_label})"
        for n in neighbors
    ) or "None"

    # Omit numeric emotional_weight floats so Phase 5 prompts remain 100% zero-float
    existing_mem_lines = [
        f"- [id='{s.id}' | {s.origin}{f'/{s.significance}' if s.significance else ''}] {s.title}: {s.content}"
        for s in active_shards[-8:]
    ]
    existing_mem_str = "\n".join(existing_mem_lines) or "None"

    eq_names = format_item_names(prev_state.equipped)
    inv_names = format_item_names(prev_state.inventory)
    equipped_str = ", ".join(eq_names) if eq_names else "None"
    inventory_str = ", ".join(inv_names) if inv_names else "None"

    prior_care = ensure_snapshot_care_state(
        prev_state,
        character.baseline_psyche,
        elapsed_minutes=campaign_elapsed_minutes,
    )
    co_present_ids = {c.id for c in present_characters if c.id != character.id}
    affective_block = render_zone4_affective_block(
        prior_care,
        character_name=character.name,
        persona_name=persona_name,
        character_name_map=name_map,
        active_speaker_id=completed_turn.actor_id,
        co_present_ids=co_present_ids,
    )

    speaker_name = name_map.get(completed_turn.actor_id, character.name)
    char_cog = (
        (completed_turn.cognitions or {}).get(character.id)
        if hasattr(completed_turn, "cognitions") and completed_turn.cognitions
        else (completed_turn.cognition if is_speaker else None)
    )
    cognition_context = ""
    if char_cog and not char_cog.skipped:
        cognition_context = (
            f"\n{character.name}'s Intra-Turn Cognition Impulse (at start of response):\n"
            f"- Feeling Impulse: {char_cog.feeling} "
            f"(tone={char_cog.feeling_tone}, intensity={char_cog.feeling_intensity}, "
            f"agency={char_cog.feeling_agency}, threat={char_cog.scene_threat}, coping={char_cog.scene_coping})\n"
            f"- Immediate Want: {char_cog.want}\n"
            f"- Planned Action: {char_cog.plan}\n"
            f"*(Note: Anchor post-turn affect_tone and relational_events relative to Pre-Turn Baseline State below.)*\n"
        )

    char_roll = resolve_roll_for_character(completed_turn.pre_turn, character.id)
    roll_str = ""
    if char_roll is not None:
        roll_str = f"Personal Mechanics Outcome for {character.name}: {char_roll.action_description} -> [{char_roll.outcome_tier}] ({char_roll.narrative_directive})\n"
    elif completed_turn.pre_turn.resolved_roll is not None and completed_turn.pre_turn.resolved_roll.character_id in (None, character.id):
        r = completed_turn.pre_turn.resolved_roll
        roll_str = f"Mechanics Outcome: {r.action_description} -> [{r.outcome_tier}] ({r.narrative_directive})\n"

    visible_user_msg = filter_user_message_for_character(
        completed_turn.user_message,
        target_character_id=character.id,
        campaign_characters=all_participants,
    )

    system_prompt = render_template(
        prompt_template or get_default_prompt(PROMPT_KEY_CHARACTER_POST_TURN),
        character_name=character.name,
        character_id=character.id,
    )
    user_prompt = (
        f"Character Identity:\n"
        f"- Name: {character.name} (id='{character.id}')\n"
        f"- Tagline: {character.tagline}\n"
        f"- Core Drive: {character.baseline_psyche.core_drive}\n"
        f"- Core Fear: {character.baseline_psyche.core_fear}\n"
        f"- Role This Turn: {'Primary Speaking Character' if is_speaker else 'Co-Present Witness in Scene'}\n\n"
        f"Pre-Turn Baseline State (Anchor post-turn updates here):\n"
        f"{affective_block}\n"
        f"- Pre-Turn Want: {prev_state.active_want}\n"
        f"- Equipped / Worn: {equipped_str}\n"
        f"- Carried Inventory: {inventory_str}\n"
        f"{cognition_context}\n"
        f"Scene Roster & Spatial Context:\n"
        f"- Starting Location: {active_location.name} (id='{active_location.id}')\n"
        f"- Player Spatial Intent: {completed_turn.pre_turn.spatial_intent}"
        f"{f' ({completed_turn.pre_turn.target_location_hint})' if completed_turn.pre_turn.target_location_hint else ''}\n"
        f"- Co-Present Characters:\n{co_present_str}\n"
        f"- Known Exits:\n{neighbor_str}\n\n"
        f"Existing Memories for {character.name} (do NOT duplicate; use supersedes_memory_id if refining ephemeral):\n"
        f"{existing_mem_str}\n\n"
        f"=== COMPLETED TURN EXCHANGE ===\n"
        f"{roll_str}"
        f"User Message:\n{visible_user_msg}\n\n"
        f"Narrative Prose (spoken/enacted primarily by {speaker_name}):\n{completed_turn.raw_prose}"
    )

    try:
        delta = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            CharacterAgentDelta,
            profile=clerk_prof,
            temperature=0.25,
        )
    except Exception as exc:
        if not settings.allow_offline_fallback:
            raise
        logger.warning(
            "Character State Agent for '%s' failed (%s); falling back to heuristic character delta.",
            character.name,
            exc,
        )
        delta = heuristic_character_agent_delta(
            character=character,
            prev_state=prev_state,
            completed_turn=completed_turn,
            active_location=active_location,
            neighbors=neighbors,
            present_characters=present_characters,
            extracted_memories_fn=extracted_memories_fn,
            user_message_override=visible_user_msg,
        )

    # Post-process invariants: 2-4 word mood, canonical stance keys, and strict self-scoped memory ownership
    delta.mood_label = normalize_mood_label(delta.mood_label, fallback=prev_state.mood_label)
    delta.stance_updates = normalize_stance_updates(
        delta.stance_updates,
        self_id=character.id,
        self_name=character.name,
        persona_name=persona_name,
        known_characters=all_participants,
    )
    for mem in delta.new_memories:
        mem.character_id = character.id

    return delta
