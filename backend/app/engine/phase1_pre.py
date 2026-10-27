"""Phase 1: Auxiliary Pre-Turn Analyzer & Native RNG/Dice Mechanics Resolver."""

from __future__ import annotations

import random
import re

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.schemas.character import CharacterRecord
from app.schemas.turn import DiceRollResult, MechanicsTrigger, PreTurnAnalysis
from app.schemas.world import LocationNode, NeighborLocationView

_RISKY_ACTION_PATTERNS: list[tuple[re.Pattern[str], str, int]] = [
    (
        re.compile(r"\b(hack|decrypt|slice|bypass|crack|override|jack in)\b", re.I),
        "Tech / Intrusion",
        14,
    ),
    (
        re.compile(r"\b(picklock|pick the lock|jimmy|force open|pry open|kick open|breach)\b", re.I),
        "Infiltration / Force",
        13,
    ),
    (
        re.compile(r"\b(sneak|slip past|hide|conceal|palm|pickpocket|steal)\b", re.I),
        "Stealth / Sleight of Hand",
        13,
    ),
    (
        re.compile(
            r"\b(bluff|lie|deceive|intimidate|threaten|convince|persuade|bribe)\b",
            re.I,
        ),
        "Social / Leverage",
        12,
    ),
    (
        re.compile(r"\b(shoot|fire|stab|strike|disarm|grapple|dodge|draw my gun)\b", re.I),
        "Combat Reflexes",
        14,
    ),
]

_HOSTILE_WORDS = {"gun", "weapon", "shut up", "lie", "lying", "betray", "kill", "syndicate", "threat"}
_VULNERABLE_WORDS = {"bleeding", "hurt", "help", "scared", "dying", "wound", "sorry", "please", "trust"}
_SARCASTIC_WORDS = {"sure", "right", "whatever", "charming", "relax", "calm down"}


def resolve_dice_check(
    trigger: MechanicsTrigger,
    manual_override: int | None = None,
) -> DiceRollResult:
    """Execute a native d20 check and translate it into a narrative directive."""
    d20_raw = manual_override if manual_override is not None else random.randint(1, 20)
    total = d20_raw + trigger.relevant_modifier
    dc = trigger.difficulty_class

    if d20_raw == 1 or total <= dc - 6:
        outcome_tier = "Critical Failure"
        directive = (
            f"The attempt ({trigger.action_description}) fails badly. Introduce an immediate "
            "complication, escalation, or costly setback."
        )
    elif d20_raw == 20 or total >= dc + 5:
        outcome_tier = "Critical Success"
        directive = (
            f"The attempt ({trigger.action_description}) succeeds with exceptional precision "
            "and yields an extra advantage or revelation."
        )
    elif total >= dc:
        outcome_tier = "Clean Success"
        directive = (
            f"The attempt ({trigger.action_description}) succeeds cleanly as intended."
        )
    elif total >= dc - 2:
        outcome_tier = "Partial Success"
        directive = (
            f"The attempt ({trigger.action_description}) partially succeeds, but comes with a "
            "complication, hesitation, or partial cost."
        )
    else:
        outcome_tier = "Failure with Consequence"
        directive = (
            f"The attempt ({trigger.action_description}) fails to achieve its goal, drawing "
            "suspicion or resistance."
        )

    return DiceRollResult(
        action_description=trigger.action_description,
        skill_or_approach=trigger.skill_or_approach,
        d20_raw=d20_raw,
        modifier=trigger.relevant_modifier,
        total=total,
        difficulty_class=dc,
        outcome_tier=outcome_tier,
        narrative_directive=directive,
    )


def select_speaker_order(
    user_message: str,
    present_characters: list[CharacterRecord],
    previous_speaker_id: str | None = None,
) -> list[str]:
    """Order speakers present at active_location by direct address, topic relevance, or turn rotation."""
    if not present_characters:
        return []
    if len(present_characters) == 1:
        return [present_characters[0].id]

    msg_lower = user_message.lower()
    named_scores: dict[str, int] = {}
    topic_scores: dict[str, int] = {}

    for char in present_characters:
        name_lower = char.name.lower()
        first_name = name_lower.split()[0] if name_lower.split() else name_lower
        if name_lower in msg_lower or (
            len(first_name) >= 3 and re.search(rf"\b{re.escape(first_name)}\b", msg_lower)
        ):
            named_scores[char.id] = 100
        else:
            named_scores[char.id] = 0

        kw_hits = 0
        for shard in char.memory_shards:
            for kw in shard.keywords:
                if len(kw) >= 3 and kw.lower() in msg_lower:
                    kw_hits += 2
        for word in re.findall(r"[a-z0-9]{4,}", char.tagline.lower()):
            if word in msg_lower:
                kw_hits += 1
        topic_scores[char.id] = kw_hits

    any_signal = any(v > 0 for v in named_scores.values()) or any(
        v > 0 for v in topic_scores.values()
    )
    if any_signal:
        ordered = sorted(
            present_characters,
            key=lambda c: (named_scores[c.id], topic_scores[c.id]),
            reverse=True,
        )
        return [c.id for c in ordered]

    # No explicit name or topic cue: rotate from previous_speaker_id so present NPCs take turns/banter
    ids = [c.id for c in present_characters]
    if previous_speaker_id in ids:
        idx = ids.index(previous_speaker_id)
        return ids[idx + 1 :] + ids[: idx + 1]
    return ids


def heuristic_pre_turn_analysis(
    user_message: str,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    known_entities: list[str],
    present_characters: list[CharacterRecord] | None = None,
    previous_speaker_id: str | None = None,
) -> PreTurnAnalysis:
    """Fast deterministic analyzer used as fallback when no auxiliary LLM server is reachable."""
    msg_lower = user_message.lower()

    # 1. Sentiment & subtext
    if any(w in msg_lower for w in _VULNERABLE_WORDS):
        sentiment = "urgent, strained, showing vulnerability"
        subtext = "Seeking immediate aid or testing whether they are safe here."
    elif any(w in msg_lower for w in _HOSTILE_WORDS):
        sentiment = "tense, confrontational, guarded"
        subtext = "Applying pressure or bracing for a confrontation."
    elif any(w in msg_lower for w in _SARCASTIC_WORDS):
        sentiment = "dry, deflecting, guardedly casual"
        subtext = "Using humor or deflection to mask underlying tension."
    else:
        sentiment = "focused, observant, direct"
        subtext = "Engaging directly with the situation and gauging reaction."

    # 2. Mentioned entities
    mentioned: list[str] = []
    for ent in known_entities:
        if ent.lower() in msg_lower and ent not in mentioned:
            mentioned.append(ent)

    # 3. Spatial movement detection
    spatial_intent = "stay"
    target_hint: str | None = None
    move_verbs = ("go to", "head to", "walk into", "step into", "enter", "head out", "go through", "up the", "down to", "follow me to", "backroom", "clinic", "alley", "mezzanine", "tunnels", "hatch")
    if any(v in msg_lower for v in move_verbs):
        for nb in neighbors:
            dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
            dir_words = [w.lower() for w in nb.direction_label.split() if len(w) > 3]
            if any(w in msg_lower for w in dest_words + dir_words):
                spatial_intent = "move_known"
                target_hint = nb.destination.name
                break
        if spatial_intent == "stay" and re.search(
            r"\b(kick open|step into the|head into the|open the door to|explore the)\b",
            msg_lower,
        ):
            spatial_intent = "explore_new"
            target_hint = user_message[:80]

    # 4. Mechanics / RNG check detection
    mechanics = MechanicsTrigger(requires_roll=False)
    for pattern, skill, dc in _RISKY_ACTION_PATTERNS:
        match = pattern.search(user_message)
        if match:
            mechanics = MechanicsTrigger(
                requires_roll=True,
                action_description=f"Attempting '{match.group(0)}' ({user_message[:70].strip()})",
                skill_or_approach=skill,
                difficulty_class=dc,
                relevant_modifier=1,
            )
            break

    # 5. Semantic RAG search queries
    queries = [user_message.strip()]
    if mentioned:
        queries.append(" ".join(mentioned))

    # 6. Multi-character speaker orchestration among characters in active_location
    speaker_order = select_speaker_order(
        user_message,
        present_characters or [],
        previous_speaker_id=previous_speaker_id,
    )
    active_speaker_id = speaker_order[0] if speaker_order else None

    return PreTurnAnalysis(
        user_sentiment=sentiment,
        subtext_interpretation=subtext,
        mentioned_entities=mentioned,
        memory_search_queries=queries[:2],
        spatial_intent=spatial_intent,  # type: ignore[arg-type]
        target_location_hint=target_hint,
        active_speaker_id=active_speaker_id,
        speaker_order=speaker_order,
        mechanics_check=mechanics,
    )


async def run_phase1_pre_analysis(
    *,
    user_message: str,
    character: CharacterRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    known_entities: list[str],
    manual_dice_override: int | None = None,
    present_characters: list[CharacterRecord] | None = None,
    previous_speaker_id: str | None = None,
    profile: ModelProfile | None = None,
) -> PreTurnAnalysis:
    """Execute Phase 1 Pre-Turn Analysis via the Auxiliary Clerk (with offline fallback) and resolve RNG."""
    room_chars = present_characters if present_characters else [character]
    room_char_ids = {c.id for c in room_chars}
    fallback_order = select_speaker_order(
        user_message,
        room_chars,
        previous_speaker_id=previous_speaker_id,
    )

    neighbor_desc = ", ".join(
        f"{n.destination.name} (via {n.direction_label})" for n in neighbors
    ) or "None"
    present_desc = "\n".join(
        f"- id='{c.id}': {c.name} ({c.tagline})" for c in room_chars
    )

    system_prompt = (
        "You are the Auxiliary Subconscious & Game Master Clerk for an AI roleplay engine.\n"
        "Analyze the user's latest message in the context of the active location, present characters, and exits.\n"
        "Return ONLY a JSON object matching the PreTurnAnalysis schema with keys:\n"
        "- user_sentiment (string)\n"
        "- subtext_interpretation (string)\n"
        "- mentioned_entities (list of strings)\n"
        "- memory_search_queries (list of 1-2 short semantic search strings)\n"
        "- spatial_intent ('stay' | 'move_known' | 'explore_new')\n"
        "- target_location_hint (string or null)\n"
        "- active_speaker_id (character id from Characters Present in Room who should respond first)\n"
        "- speaker_order (ordered list of character ids from Characters Present in Room)\n"
        "- mechanics_check: {requires_roll (bool), action_description (str), skill_or_approach (str), difficulty_class (int 5-20), relevant_modifier (int -3 to +3)}\n"
        "Set requires_roll=true ONLY if the user attempts a risky or uncertain physical/social/technical action."
    )
    user_prompt = (
        f"Characters Present in Room ({active_location.name}):\n{present_desc}\n"
        f"Previous Turn Speaker ID: {previous_speaker_id or character.id}\n"
        f"Current Location: {active_location.name} ({active_location.summary})\n"
        f"Adjacent Exits: {neighbor_desc}\n"
        f"Known Entities/Lore Keywords: {', '.join(known_entities[:30])}\n\n"
        f"User Message:\n{user_message}"
    )

    clerk_prof = profile or settings.clerk_profile
    try:
        analysis = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            PreTurnAnalysis,
            profile=clerk_prof,
        )
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        analysis = heuristic_pre_turn_analysis(
            user_message=user_message,
            active_location=active_location,
            neighbors=neighbors,
            known_entities=known_entities,
            present_characters=room_chars,
            previous_speaker_id=previous_speaker_id,
        )

    # Ensure active_speaker_id and speaker_order only reference characters actually present in active_location
    valid_order = [cid for cid in analysis.speaker_order if cid in room_char_ids]
    for cid in fallback_order:
        if cid not in valid_order:
            valid_order.append(cid)
    analysis.speaker_order = valid_order
    if analysis.active_speaker_id not in room_char_ids:
        analysis.active_speaker_id = valid_order[0] if valid_order else character.id
    elif valid_order and valid_order[0] != analysis.active_speaker_id:
        analysis.speaker_order = [analysis.active_speaker_id] + [
            cid for cid in valid_order if cid != analysis.active_speaker_id
        ]

    if not analysis.memory_search_queries:
        analysis.memory_search_queries = [user_message]

    if analysis.mechanics_check.requires_roll or manual_dice_override is not None:
        if not analysis.mechanics_check.requires_roll and manual_dice_override is not None:
            analysis.mechanics_check = MechanicsTrigger(
                requires_roll=True,
                action_description=f"Action check on: {user_message[:60]}",
                skill_or_approach="Direct Action",
                difficulty_class=12,
                relevant_modifier=1,
            )
        analysis.resolved_roll = resolve_dice_check(
            analysis.mechanics_check,
            manual_override=manual_dice_override,
        )

    return analysis
