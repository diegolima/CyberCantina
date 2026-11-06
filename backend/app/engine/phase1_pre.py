"""Phase 1: Auxiliary Pre-Turn Analyzer & Native RNG/Dice Mechanics Resolver."""

from __future__ import annotations

import random
import re

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.engine.mentions import DecomposedUserMessage, MentionTargetScope, decompose_user_message
from app.prompts import get_default_prompt, render_template
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    format_item_names,
)
from app.schemas.persona import (
    DisclosureDetectionMode,
    PersonaItemInstance,
    PersonaLoreEntry,
    PersonaRecord,
)
from app.schemas.turn import (
    CanonicalOutcomeTier,
    CharacterCheckSpec,
    CharacterChoiceSet,
    CheckRole,
    ChoiceResolution,
    DiceMode,
    DiceRollResult,
    MechanicsTrigger,
    PreTurnAnalysis,
    PreTurnLLMOutput,
)
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


def detect_persona_disclosures_token_matching(
    *,
    user_message: str,
    persona_snapshot: PersonaRecord | None,
    current_player_items: list[PersonaItemInstance] | None = None,
    already_unlocked_keys: set[str] | None = None,
) -> list[str]:
    """Word-boundary regex & stemmed keyword matching for persona secrets.

    Guards:
    - Requires word-boundary match (r'\\b' + re.escape(kw) + r'\\b')
    - Enforces min keyword length >= 3 to prevent substring collisions (except numeric age >= 1 digit)
    - Checks both snapshot lore and active turn items
    """
    if persona_snapshot is None:
        return []

    msg_lower = user_message.lower()
    already = already_unlocked_keys or set()
    disclosed: list[str] = []

    # 1. Age check
    if persona_snapshot.age and persona_snapshot.age_is_secret and "age" not in already:
        age_str = str(persona_snapshot.age).strip().lower()
        if age_str:
            pattern = rf"\b{re.escape(age_str)}\b"
            if re.search(pattern, msg_lower):
                disclosed.append("age")

    # 2. Items check (equipped & inventory)
    items_pool = (
        current_player_items
        if current_player_items is not None
        else (persona_snapshot.equipped + persona_snapshot.inventory)
    )
    for it in items_pool:
        if not it.is_secret or it.id in already or it.id in disclosed:
            continue
        kws = list(it.trigger_keywords) or [it.name.lower()]
        for kw in kws:
            kw_clean = kw.strip().lower()
            if len(kw_clean) >= 3:
                pattern = rf"\b{re.escape(kw_clean)}\b"
                if re.search(pattern, msg_lower):
                    disclosed.append(it.id)
                    break

    # 3. Lore entries check
    for lore in persona_snapshot.lore_entries:
        if not lore.is_secret or lore.id in already or lore.id in disclosed:
            continue
        kws = list(lore.trigger_keywords) or [lore.title.lower()]
        for kw in kws:
            kw_clean = kw.strip().lower()
            if len(kw_clean) >= 3:
                pattern = rf"\b{re.escape(kw_clean)}\b"
                if re.search(pattern, msg_lower):
                    disclosed.append(lore.id)
                    break

    return disclosed


def detect_persona_disclosures(
    *,
    user_message: str,
    persona_snapshot: PersonaRecord | None,
    current_player_items: list[PersonaItemInstance] | None = None,
    already_unlocked_keys: set[str] | None = None,
    present_characters_count: int = 1,
    mode: DisclosureDetectionMode = "llm_intent",
    llm_revealed_keys: list[str] | None = None,
) -> list[str]:
    """Resolve disclosed persona keys using selected strategy.

    Solitary Action Guard:
    If present_characters_count == 0, keys are recorded as player-active but
    flagged as un-witnessed by NPCs (empty disclosure returned).
    """
    if persona_snapshot is None:
        return []

    # Solitary Action Guard
    if present_characters_count <= 0:
        return []

    token_matches = detect_persona_disclosures_token_matching(
        user_message=user_message,
        persona_snapshot=persona_snapshot,
        current_player_items=current_player_items,
        already_unlocked_keys=already_unlocked_keys,
    )

    if mode == "token_matching":
        return token_matches

    # Candidate secret keys filter
    candidate_keys: set[str] = set()
    if persona_snapshot.age_is_secret and persona_snapshot.age:
        candidate_keys.add("age")
    items_pool = (
        current_player_items
        if current_player_items is not None
        else (persona_snapshot.equipped + persona_snapshot.inventory)
    )
    for it in items_pool:
        if it.is_secret:
            candidate_keys.add(it.id)
    for l in persona_snapshot.lore_entries:
        if l.is_secret:
            candidate_keys.add(l.id)

    llm_valid = [k for k in (llm_revealed_keys or []) if k in candidate_keys]

    if mode == "llm_intent":
        return llm_valid
    elif mode == "hybrid":
        return list(dict.fromkeys(token_matches + llm_valid))

    return llm_valid



def classify_outcome_tier(
    d20_raw: int,
    total: int,
    difficulty_class: int,
) -> CanonicalOutcomeTier:
    """Classify roll into 5 canonical tiers with strict natural roll precedence:
    1. d20_raw == 1  -> Critical Failure
    2. d20_raw == 20 -> Critical Success
    3. margin = total - difficulty_class:
       - margin <= -6        -> Critical Failure
       - -5 <= margin <= -3  -> Failure with Consequences
       - -2 <= margin <= -1  -> Simple Failure
       -  0 <= margin <=  4  -> Clean Success
       - margin >= 5         -> Critical Success
    """
    if d20_raw == 1:
        return "Critical Failure"
    if d20_raw == 20:
        return "Critical Success"
    margin = total - difficulty_class
    if margin <= -6:
        return "Critical Failure"
    if margin <= -3:
        return "Failure with Consequences"
    if margin < 0:
        return "Simple Failure"
    if margin < 5:
        return "Clean Success"
    return "Critical Success"


def build_tier_directives(
    outcome_tier: CanonicalOutcomeTier,
    action_description: str,
    check_role: CheckRole = "active_attempt",
    character_name: str | None = None,
) -> tuple[str, str]:
    """Return (plan_directive, narrative_directive) calibrated to check_role and outcome tier."""
    name_prefix = f"{character_name}: " if character_name else ""
    desc = action_description or "action"

    if check_role == "contested_reaction":
        if outcome_tier == "Critical Failure":
            plan = "Your defense/resistance completely collapses. Your counter-maneuver backfires with severe consequences, exposing you to critical danger, loss, or injury."
            narr = f"{name_prefix}Defense/reaction ({desc}) completely backfires and fails catastrophically with severe, immediate fallout."
        elif outcome_tier == "Failure with Consequences":
            plan = "You fail to hold ground or resist cleanly. You suffer moderate setback, strain, or disadvantage, though not catastrophic."
            narr = f"{name_prefix}Defense/reaction ({desc}) fails to hold, drawing moderate complications or resistance."
        elif outcome_tier == "Simple Failure":
            plan = "You fail to achieve the intended counter or defensive edge, but there are no immediate aggravations or extra penalties."
            narr = f"{name_prefix}Defense/reaction ({desc}) simply does not succeed, but without immediate aggravation."
        elif outcome_tier == "Clean Success":
            plan = "You successfully defend, resist, or hold your ground cleanly as intended."
            narr = f"{name_prefix}Defense/reaction ({desc}) succeeds cleanly as intended."
        else:  # Critical Success
            plan = "You anticipate and deflect the challenge with exceptional precision, decisively turning the tables and seizing the upper hand."
            narr = f"{name_prefix}Defense/reaction ({desc}) succeeds with exceptional flair, outperforming expectations and gaining a decisive advantage."
    elif check_role == "scene_hazard":
        if outcome_tier == "Critical Failure":
            plan = "The environmental hazard overwhelms you. Your reaction backfires into an immediate crisis, damage, or equipment failure."
            narr = f"{name_prefix}Reaction to hazard ({desc}) backfires catastrophically with severe consequences."
        elif outcome_tier == "Failure with Consequences":
            plan = "You fail to fully evade or mitigate the hazard, incurring moderate damage, delay, or complication."
            narr = f"{name_prefix}Reaction to hazard ({desc}) fails to mitigate the hazard, incurring moderate consequences."
        elif outcome_tier == "Simple Failure":
            plan = "You fail to overcome or bypass the hazard, but suffer no immediate escalation or extra damage."
            narr = f"{name_prefix}Reaction to hazard ({desc}) fails without immediate aggravation."
        elif outcome_tier == "Clean Success":
            plan = "You successfully withstand, avoid, or navigate the hazard cleanly."
            narr = f"{name_prefix}Reaction to hazard ({desc}) succeeds cleanly as intended."
        else:  # Critical Success
            plan = "You masterfully exploit the hazard or navigate it flawlessly, discovering a hidden route or tactical asset."
            narr = f"{name_prefix}Reaction to hazard ({desc}) outperforms expectations, turning the hazard into a tactical advantage."
    elif check_role == "co_present_bystander":
        if outcome_tier == "Critical Failure":
            plan = "You misread the situation entirely or stumble into danger, worsening the crisis or drawing hostile focus."
            narr = f"{name_prefix}Observation/presence ({desc}) backfires into an unexpected complication or crisis."
        elif outcome_tier == "Failure with Consequences":
            plan = "You are caught off-guard or drawn into the commotion with moderate complications."
            narr = f"{name_prefix}Presence ({desc}) draws moderate complications or unwanted attention."
        elif outcome_tier == "Simple Failure":
            plan = "You are momentarily distracted or fail to grasp the developing action, but suffer no immediate penalty."
            narr = f"{name_prefix}Presence ({desc}) yields no immediate advantage or penalty."
        elif outcome_tier == "Clean Success":
            plan = "You maintain calm awareness and remain composed as intended."
            narr = f"{name_prefix}Presence ({desc}) maintains steady awareness and positioning."
        else:  # Critical Success
            plan = "You read the scene with exceptional clarity, outperforming expectations and gaining key tactical insight."
            narr = f"{name_prefix}Presence ({desc}) provides exceptional foresight, outperforming expectations."
    else:  # active_attempt
        if outcome_tier == "Critical Failure":
            plan = "Your planned action backfires with severe consequences. You fail completely and create an immediate crisis, dangerous escalation, or costly setback. Adapt your plan to crisis control."
            narr = f"{name_prefix}The attempt ({desc}) fails badly and backfires with severe, immediate consequences, crisis, or costly setback."
        elif outcome_tier == "Failure with Consequences":
            plan = "You fail to achieve what you attempted, incurring moderate resistance, complications, or secondary costs. Adapt your plan to handle the setback."
            narr = f"{name_prefix}The attempt ({desc}) fails to achieve its objective and introduces moderate consequences, complications, or heightened resistance."
        elif outcome_tier == "Simple Failure":
            plan = "You fail to achieve what you attempted, but there are no immediate aggravations or extra penalties (the attempt simply does not work). Plan your next response accordingly."
            narr = f"{name_prefix}The attempt ({desc}) cleanly fails to achieve what was attempted; no immediate aggravations, complications, or penalties."
        elif outcome_tier == "Clean Success":
            plan = "You successfully achieve what you are attempting cleanly as intended. Plan your dialogue and action to capitalize on this success."
            narr = f"{name_prefix}The attempt ({desc}) succeeds cleanly and effectively as intended."
        else:  # Critical Success
            plan = "You succeed beyond expectations, outperforming what you attempted and securing an extra tactical advantage, discovery, or opening."
            narr = f"{name_prefix}The attempt ({desc}) succeeds exceptionally, outperforming expectations and securing a distinct tactical or narrative advantage."

    return plan, narr


def resolve_dice_check(
    trigger: MechanicsTrigger | CharacterCheckSpec,
    manual_override: int | None = None,
    *,
    character_id: str | None = None,
    character_name: str | None = None,
    check_role: CheckRole = "active_attempt",
    rng: random.Random | None = None,
) -> DiceRollResult:
    """Execute a native d20 check and translate it into plan and narrative directives."""
    r = rng or random
    d20_raw = manual_override if manual_override is not None else r.randint(1, 20)
    total = d20_raw + trigger.relevant_modifier
    dc = trigger.difficulty_class

    role = getattr(trigger, "check_role", check_role)
    char_id = getattr(trigger, "character_id", character_id)

    outcome_tier = classify_outcome_tier(d20_raw, total, dc)
    plan_directive, narrative_directive = build_tier_directives(
        outcome_tier,
        trigger.action_description,
        check_role=role,
        character_name=character_name,
    )

    return DiceRollResult(
        character_id=char_id,
        character_name=character_name,
        check_role=role,
        is_manual_override=manual_override is not None,
        action_description=trigger.action_description,
        skill_or_approach=trigger.skill_or_approach,
        d20_raw=d20_raw,
        modifier=trigger.relevant_modifier,
        total=total,
        difficulty_class=dc,
        outcome_tier=outcome_tier,
        plan_directive=plan_directive,
        narrative_directive=narrative_directive,
    )


def resolve_character_dice_checks(
    present_characters: list[CharacterRecord],
    *,
    character_checks: list[CharacterCheckSpec],
    fallback_trigger: MechanicsTrigger,
    user_message: str,
    dice_mode: DiceMode = "auto",
    manual_override: int | None = None,
    active_speaker_id: str | None = None,
    rng: random.Random | None = None,
    gate_specs: Mapping[str, CharacterCheckSpec] | None = None,
) -> dict[str, DiceRollResult]:
    """Resolve individual d20 checks for characters present in active location."""
    if dice_mode == "disabled":
        return {}

    if manual_override is not None:
        dice_mode = "forced"

    from app.engine.choices import build_gate_directives

    results: dict[str, DiceRollResult] = {}
    spec_by_char = {c.character_id: c for c in character_checks}
    chars_by_id = {c.id: c for c in present_characters}
    effective_speaker_id = active_speaker_id or (present_characters[0].id if present_characters else None)
    active_gate_specs = gate_specs or {}

    # 1. Resolve choice gate specs first (Decision D1: replaces character's roll)
    for char in present_characters:
        if char.id in active_gate_specs:
            g_spec = active_gate_specs[char.id]
            roll = resolve_dice_check(
                g_spec,
                manual_override=manual_override,
                character_id=char.id,
                character_name=char.name,
                rng=rng,
            )
            roll.is_choice_gate = True
            p_dir, n_dir = build_gate_directives(char.name, roll.outcome_tier)
            roll.plan_directive = p_dir
            roll.narrative_directive = n_dir
            results[char.id] = roll

    if dice_mode == "forced":
        if manual_override is not None:
            # Pinned forced roll: all present characters adopt manual_override
            for char in present_characters:
                if char.id in results:
                    continue
                spec = spec_by_char.get(char.id)
                if spec and spec.requires_roll:
                    results[char.id] = resolve_dice_check(
                        spec,
                        manual_override=manual_override,
                        character_id=char.id,
                        character_name=char.name,
                        rng=rng,
                    )
                elif spec:
                    forced_spec = spec.model_copy(
                        update={
                            "requires_roll": True,
                            "action_description": spec.action_description or f"{char.name} acts under pressure",
                        }
                    )
                    results[char.id] = resolve_dice_check(
                        forced_spec,
                        manual_override=manual_override,
                        character_id=char.id,
                        character_name=char.name,
                        rng=rng,
                    )
                else:
                    is_speaker = char.id == effective_speaker_id
                    role: CheckRole = "active_attempt" if is_speaker else "co_present_bystander"
                    desc = (
                        fallback_trigger.action_description
                        if is_speaker and fallback_trigger.action_description
                        else (f"{char.name} acts under pressure" if is_speaker else f"{char.name} observes the situation")
                    )
                    mod = fallback_trigger.relevant_modifier if is_speaker else 0
                    synth_spec = CharacterCheckSpec(
                        character_id=char.id,
                        requires_roll=True,
                        check_role=role,
                        action_description=desc,
                        skill_or_approach=fallback_trigger.skill_or_approach if is_speaker else "Composure",
                        difficulty_class=fallback_trigger.difficulty_class,
                        relevant_modifier=mod,
                    )
                    results[char.id] = resolve_dice_check(
                        synth_spec,
                        manual_override=manual_override,
                        character_id=char.id,
                        character_name=char.name,
                        rng=rng,
                    )
            return results

        # Forced random roll: roll for any characters already flagged requires_roll=True
        for char in present_characters:
            if char.id in results:
                continue
            spec = spec_by_char.get(char.id)
            if spec and spec.requires_roll:
                results[char.id] = resolve_dice_check(
                    spec,
                    manual_override=None,
                    character_id=char.id,
                    character_name=char.name,
                    rng=rng,
                )

        # If nobody was flagged as requiring a roll, force a roll on the active speaker
        if not results and effective_speaker_id and effective_speaker_id in chars_by_id:
            char = chars_by_id[effective_speaker_id]
            spec = spec_by_char.get(char.id)
            if spec:
                forced_spec = spec.model_copy(
                    update={
                        "requires_roll": True,
                        "check_role": "active_attempt",
                        "action_description": spec.action_description or f"{char.name} acts/responds in the scene",
                    }
                )
            else:
                forced_spec = CharacterCheckSpec(
                    character_id=char.id,
                    requires_roll=True,
                    check_role="active_attempt",
                    action_description=fallback_trigger.action_description or f"{char.name} acts/responds in the scene",
                    skill_or_approach=fallback_trigger.skill_or_approach or "General",
                    difficulty_class=fallback_trigger.difficulty_class,
                    relevant_modifier=fallback_trigger.relevant_modifier,
                )
            results[char.id] = resolve_dice_check(
                forced_spec,
                manual_override=None,
                character_id=char.id,
                character_name=char.name,
                rng=rng,
            )

        return results

    # Standard "auto" mode:
    # 1. Roll individually ONLY for involved characters; skip uninvolved bystanders
    for char in present_characters:
        if char.id in results:
            continue
        spec = spec_by_char.get(char.id)
        if spec and spec.requires_roll:
            results[char.id] = resolve_dice_check(
                spec,
                manual_override=manual_override,
                character_id=char.id,
                character_name=char.name,
                rng=rng,
            )

    # 2. If character_checks was empty or didn't flag anyone, but fallback_trigger requested roll:
    if not results and fallback_trigger.requires_roll:
        if effective_speaker_id and effective_speaker_id in chars_by_id:
            char = chars_by_id[effective_speaker_id]
            synth_spec = CharacterCheckSpec(
                character_id=char.id,
                requires_roll=True,
                check_role="active_attempt",
                action_description=fallback_trigger.action_description or f"{char.name} acts/responds in the scene",
                skill_or_approach=fallback_trigger.skill_or_approach,
                difficulty_class=fallback_trigger.difficulty_class,
                relevant_modifier=fallback_trigger.relevant_modifier,
            )
            results[char.id] = resolve_dice_check(
                synth_spec,
                manual_override=manual_override,
                character_id=char.id,
                character_name=char.name,
                rng=rng,
            )

    return results


def select_speaker_order(
    user_message: str,
    present_characters: list[CharacterRecord],
    previous_speaker_id: str | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> list[str]:
    """Order speakers present at active_location by direct address, topic relevance, or turn rotation."""
    if not present_characters:
        return []
    if len(present_characters) == 1:
        return [present_characters[0].id]

    decomp = (
        decomposed_message
        if decomposed_message is not None
        else decompose_user_message(user_message, present_characters)
    )

    msg_lower = user_message.lower()
    named_scores: dict[str, int] = {}
    topic_scores: dict[str, int] = {}

    for char in present_characters:
        score = 0
        if decomp:
            w = decomp.whispers_by_character_id.get(char.id)
            if w and w.target_scope == MentionTargetScope.LOCAL:
                score = 200 if w.speech_parts else 150

        name_lower = char.name.lower()
        first_name = name_lower.split()[0] if name_lower.split() else name_lower
        if score == 0:
            if name_lower in msg_lower or (
                len(first_name) >= 3 and re.search(rf"\b{re.escape(first_name)}\b", msg_lower)
            ):
                score = 100

        named_scores[char.id] = score

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


def _build_heuristic_llm_output(
    user_message: str,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    known_entities: list[str],
    present_characters: list[CharacterRecord] | None = None,
    previous_speaker_id: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_items: list[PersonaItemInstance] | None = None,
    already_unlocked_keys: set[str] | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> PreTurnLLMOutput:
    """Deterministic extractor producing structured PreTurnLLMOutput without invoking RNG."""
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

    if decomposed_message and decomposed_message.remote_whispers:
        rem_names = ", ".join(w.character_name for w in decomposed_message.remote_whispers)
        subtext += f" Comms transmission directed off-site to {rem_names}."

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
    room_chars = present_characters or []
    speaker_order = select_speaker_order(
        user_message,
        room_chars,
        previous_speaker_id=previous_speaker_id,
        decomposed_message=decomposed_message,
    )
    active_speaker_id = speaker_order[0] if speaker_order else None

    # 7. Character checks for sensory cues
    char_checks: list[CharacterCheckSpec] = []
    if decomposed_message:
        for w in decomposed_message.whispers:
            if w.target_scope == MentionTargetScope.LOCAL and w.sensory_parts:
                sensory_text = " ".join(w.sensory_parts).lower()
                if any(k in sensory_text for k in ("shadow", "click", "noise", "sound", "threat", "wire", "hear", "see", "spot")):
                    char_checks.append(
                        CharacterCheckSpec(
                            character_id=w.character_id,
                            requires_roll=True,
                            check_role="active_attempt",
                            action_description=f"Perceiving sensory cue: {w.sensory_parts[0][:50]}",
                            skill_or_approach="Perception",
                            difficulty_class=12,
                            relevant_modifier=1,
                        )
                    )

    # 8. Deterministic persona disclosures via token matching
    revealed_keys: list[str] = []
    if persona_snapshot is not None and len(room_chars) > 0:
        revealed_keys = detect_persona_disclosures_token_matching(
            user_message=user_message,
            persona_snapshot=persona_snapshot,
            current_player_items=current_player_items,
            already_unlocked_keys=already_unlocked_keys,
        )

    return PreTurnLLMOutput(
        user_sentiment=sentiment,
        subtext_interpretation=subtext,
        mentioned_entities=mentioned,
        memory_search_queries=queries[:2],
        spatial_intent=spatial_intent,  # type: ignore[arg-type]
        target_location_hint=target_hint,
        active_speaker_id=active_speaker_id,
        speaker_order=speaker_order,
        mechanics_check=mechanics,
        character_checks=char_checks,
        revealed_persona_keys=revealed_keys,
    )


def heuristic_pre_turn_analysis(
    user_message: str,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    known_entities: list[str],
    present_characters: list[CharacterRecord] | None = None,
    previous_speaker_id: str | None = None,
    dice_mode: DiceMode = "auto",
    manual_dice_override: int | None = None,
    rng: random.Random | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_items: list[PersonaItemInstance] | None = None,
    already_unlocked_keys: set[str] | None = None,
) -> PreTurnAnalysis:
    """Fast deterministic analyzer used as fallback when no auxiliary LLM server is reachable."""
    room_chars = present_characters or []
    raw_llm = _build_heuristic_llm_output(
        user_message=user_message,
        active_location=active_location,
        neighbors=neighbors,
        known_entities=known_entities,
        present_characters=room_chars,
        previous_speaker_id=previous_speaker_id,
        persona_snapshot=persona_snapshot,
        current_player_items=current_player_items,
        already_unlocked_keys=already_unlocked_keys,
    )

    character_rolls = resolve_character_dice_checks(
        room_chars,
        character_checks=raw_llm.character_checks,
        fallback_trigger=raw_llm.mechanics_check,
        user_message=user_message,
        dice_mode=dice_mode,
        manual_override=manual_dice_override,
        active_speaker_id=raw_llm.active_speaker_id,
        rng=rng,
    )

    analysis = PreTurnAnalysis(
        **raw_llm.model_dump(),
        dice_mode=dice_mode,
        manual_dice_value=manual_dice_override if dice_mode == "forced" else None,
        character_rolls=character_rolls,
    )
    return analysis


async def run_phase1_pre_analysis(
    *,
    user_message: str,
    character: CharacterRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    known_entities: list[str],
    dice_mode: DiceMode = "auto",
    manual_dice_override: int | None = None,
    present_characters: list[CharacterRecord] | None = None,
    previous_speaker_id: str | None = None,
    character_states: dict[str, CharacterStateSnapshot] | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
    rng: random.Random | None = None,
    character_choices: Mapping[str, CharacterChoiceSet] | None = None,
    message_is_synthetic: bool = False,
    persona_snapshot: PersonaRecord | None = None,
    current_player_items: list[PersonaItemInstance] | None = None,
    disclosure_detection_mode: DisclosureDetectionMode = "llm_intent",
    already_unlocked_keys: set[str] | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
) -> PreTurnAnalysis:
    """Execute Phase 1 Pre-Turn Analysis via the Auxiliary Clerk (with offline fallback) and resolve RNG."""
    has_any_gates = any(cs.has_gates for cs in (character_choices or {}).values())
    dice_mode_promoted = False
    if dice_mode == "disabled" and has_any_gates:
        dice_mode = "auto"
        dice_mode_promoted = True

    room_chars = present_characters if present_characters else [character]
    room_char_ids = {c.id for c in room_chars}
    decomp = (
        decomposed_message
        if decomposed_message is not None
        else decompose_user_message(user_message, room_chars)
    )
    fallback_order = select_speaker_order(
        user_message,
        room_chars,
        previous_speaker_id=previous_speaker_id,
        decomposed_message=decomp,
    )

    neighbor_desc = ", ".join(
        f"{n.destination.name} (via {n.direction_label})" for n in neighbors
    ) or "None"

    present_desc_lines: list[str] = []
    for c in room_chars:
        c_st = (character_states or {}).get(c.id)
        eq_names = format_item_names(c_st.equipped if c_st is not None else c.equipped)
        inv_names = format_item_names(c_st.inventory if c_st is not None else c.inventory)
        gear_str = f" | Equipped: {', '.join(eq_names)}" if eq_names else ""
        if inv_names:
            gear_str += f" | Carried: {', '.join(inv_names)}"
        present_desc_lines.append(f"- id='{c.id}': {c.name} ({c.tagline}){gear_str}")
    present_desc = "\n".join(present_desc_lines)

    mode_prompt_hint = ""
    if dice_mode == "forced":
        mode_prompt_hint = "\nNote: Dice mechanics are forced for this turn. Identify characters facing risk/action or assign an active attempt to the primary speaker."
    elif dice_mode == "disabled":
        mode_prompt_hint = "\nNote: Dice mechanics are disabled for this turn. Set character_checks=[] and mechanics_check.requires_roll=false."

    mention_hint = ""
    if decomp and decomp.whispers:
        mLines = []
        for w in decomp.whispers:
            pts = []
            if w.speech_parts:
                pts.append(f"Spoken Dialogue: {w.speech_parts}")
            if w.sensory_parts:
                pts.append(f"Sensory/Observation: {w.sensory_parts}")
            mLines.append(f"- @{w.character_name} ({w.target_scope.value.upper()}): {'; '.join(pts)}")
        mention_hint = (
            "\nTargeted Mentions / Whispers in this Message:\n"
            + "\n".join(mLines)
            + "\nPrioritize mentioned characters who are present in the room for active_speaker_id and speaker_order. "
            "If sensory danger or observation is whispered, consider requiring perception/reaction checks for that character."
        )

    persona_manifest_lines: list[str] = []
    if persona_snapshot:
        if persona_snapshot.age and persona_snapshot.age_is_secret:
            persona_manifest_lines.append(f"- key='age': Player Age ({persona_snapshot.age})")
        items_cand = (
            current_player_items
            if current_player_items is not None
            else (persona_snapshot.equipped + persona_snapshot.inventory)
        )
        for it in items_cand:
            if it.is_secret:
                kw_str = f" [Keywords: {', '.join(it.trigger_keywords)}]" if it.trigger_keywords else ""
                persona_manifest_lines.append(f"- key='{it.id}': Item '{it.name}'{kw_str}")
        for l in persona_snapshot.lore_entries:
            if l.is_secret:
                kw_str = f" [Keywords: {', '.join(l.trigger_keywords)}]" if l.trigger_keywords else ""
                persona_manifest_lines.append(f"- key='{l.id}': Lore '{l.title}'{kw_str}")

    persona_prompt_hint = ""
    if persona_manifest_lines:
        persona_prompt_hint = (
            "\nSecret Persona Manifest (Candidate keys to include in revealed_persona_keys ONLY if explicitly revealed by the user's message):\n"
            + "\n".join(persona_manifest_lines)
            + "\nIf user message explicitly reveals any secret above, include its exact key in revealed_persona_keys."
        )

    system_prompt = render_template(
        prompt_template or get_default_prompt("clerk_pre_turn_system")
    )
    user_prompt = (
        f"Characters Present in Room ({active_location.name}):\n{present_desc}\n"
        f"Previous Turn Speaker ID: {previous_speaker_id or character.id}\n"
        f"Current Location: {active_location.name} ({active_location.summary})\n"
        f"Adjacent Exits: {neighbor_desc}\n"
        f"Known Entities/Lore Keywords: {', '.join(known_entities[:30])}\n{mode_prompt_hint}{persona_prompt_hint}{mention_hint}\n\n"
        f"User Message:\n{user_message}"
    )

    clerk_prof = profile or settings.clerk_profile
    try:
        raw_output = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            PreTurnLLMOutput,
            profile=clerk_prof,
        )
        analysis = PreTurnAnalysis(**raw_output.model_dump())
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        raw_output = _build_heuristic_llm_output(
            user_message=user_message,
            active_location=active_location,
            neighbors=neighbors,
            known_entities=known_entities,
            present_characters=room_chars,
            previous_speaker_id=previous_speaker_id,
            persona_snapshot=persona_snapshot,
            current_player_items=current_player_items,
            already_unlocked_keys=already_unlocked_keys,
            decomposed_message=decomp,
        )
        analysis = PreTurnAnalysis(**raw_output.model_dump())

    # Resolve disclosed persona secrets with strategy and solitary action guard
    revealed_keys = detect_persona_disclosures(
        user_message=user_message,
        persona_snapshot=persona_snapshot,
        current_player_items=current_player_items,
        already_unlocked_keys=already_unlocked_keys,
        present_characters_count=len(present_characters) if present_characters is not None else len(room_chars),
        mode=disclosure_detection_mode,
        llm_revealed_keys=raw_output.revealed_persona_keys,
    )
    analysis.revealed_persona_keys = revealed_keys

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

    # Speaker prioritization when prompt was synthesized from director choices
    if message_is_synthetic and character_choices:
        target_ids = [c.id for c in room_chars if c.id in character_choices]
        if target_ids and analysis.active_speaker_id not in character_choices:
            first_target = target_ids[0]
            analysis.active_speaker_id = first_target
            if first_target in analysis.speaker_order:
                analysis.speaker_order = [first_target] + [
                    cid for cid in analysis.speaker_order if cid != first_target
                ]

    if not analysis.memory_search_queries:
        analysis.memory_search_queries = [user_message]

    # Build gate specs for characters with choices requiring a roll
    gate_specs: dict[str, CharacterCheckSpec] = {}
    if character_choices:
        from app.engine.choices import build_gate_check_spec
        for c in room_chars:
            c_set = character_choices.get(c.id)
            if c_set and c_set.has_gates:
                gate_specs[c.id] = build_gate_check_spec(c, c_set)

    # Resolve per-character checks with individual rolls and mode enforcement
    analysis.dice_mode = dice_mode
    analysis.manual_dice_value = manual_dice_override if dice_mode == "forced" else None

    if dice_mode == "disabled":
        analysis.character_rolls = {}
        analysis.resolved_roll = None
        analysis.mechanics_check.requires_roll = False
        for c in analysis.character_checks:
            c.requires_roll = False
    else:
        character_rolls = resolve_character_dice_checks(
            room_chars,
            character_checks=analysis.character_checks,
            fallback_trigger=analysis.mechanics_check,
            user_message=user_message,
            dice_mode=dice_mode,
            manual_override=manual_dice_override,
            active_speaker_id=analysis.active_speaker_id,
            rng=rng,
            gate_specs=gate_specs,
        )
        analysis.character_rolls = character_rolls
        if character_rolls:
            analysis.resolved_roll = (
                character_rolls.get(analysis.active_speaker_id)
                or (character_rolls.get(character.id) if character.id in character_rolls else None)
                or next(iter(character_rolls.values()))
            )
        else:
            analysis.resolved_roll = None

    # Resolve Director Choice sets against outcomes and store in PreTurnAnalysis
    if character_choices:
        from app.engine.choices import resolve_choice_set
        for c in room_chars:
            c_set = character_choices.get(c.id)
            if c_set:
                c_roll = analysis.character_rolls.get(c.id)
                c_tier = c_roll.outcome_tier if c_roll else None
                analysis.choice_resolutions[c.id] = resolve_choice_set(c.id, c_set, c_tier)
                analysis.character_choices[c.id] = c_set

    analysis.dice_mode_promoted = dice_mode_promoted

    return analysis
