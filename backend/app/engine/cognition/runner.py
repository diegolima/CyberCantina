"""Phase 3 character cognition LLM execution and multi-actor orchestration."""

from __future__ import annotations

import asyncio
import re

from collections.abc import Sequence

from app.config import settings
from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    ensure_snapshot_care_state,
    render_zone4_affective_block,
)
from app.engine.llm_client import llm_client
from app.engine.telemetry import telemetry_phase_scope
from app.engine.mentions import (
    CharacterWhisper,
    decompose_user_message,
)
from app.engine.parties import (
    render_cognition_party_context,
    resolve_character_travel_intent_enum,
)
from app.engine.phase2_context import (
    DiscoveredPersonaView,
    TurnContextBundle,
    get_immediate_level1_container,
    resolve_character_previous_state,
    select_active_container_lore_for_turn,
    select_active_location_lore_for_turn,
)
from app.prompts import (
    get_default_prompt,
    render_template,
)
from app.prompts.defaults import PROMPT_KEY_CHARACTER_COGNITION
from app.schemas.auth import ModelProfile
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    format_item_names,
)
from app.schemas.party import PartyRecord
from app.schemas.persona import PersonaTurnStateSnapshot
from app.schemas.physical import format_physical_state_prompt_value
from app.schemas.turn import (
    CharacterSpotlightRole,
    ChoiceResolution,
    Phase3ProgressCallback,
    Phase3ProgressEvent,
    Phase3RosterEntry,
    PreTurnAnalysis,
    RecalledMemoryItem,
)
from app.schemas.world import (
    LocationNode,
    NeighborLocationView,
    WorldRecord,
)

from app.engine.cognition.heuristics import (
    PriorCognitionCue,
    compute_heuristic_party_invite_decision,
    heuristic_character_cognition,
    select_cognition_recalled_items,
)
from app.engine.cognition.xml_parser import (
    _format_cognition_bullets,
    _sanitize_cognition_text,
    logger,
)


def _resolve_location_name(
    location_id: str | None,
    active_location: LocationNode,
    world: WorldRecord | None = None,
) -> str:
    """Resolve a human-readable location name from active_location or world topology."""
    if not location_id or location_id == active_location.id:
        return active_location.name
    if world is not None:
        for loc in world.locations:
            if loc.id == location_id and loc.name.strip():
                return loc.name.strip()
    return active_location.name

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
    recall_budget_cognition_tokens: int | None = None,
    active_parties: Sequence[PartyRecord] | None = None,
    all_character_states: dict[str, CharacterStateSnapshot] | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
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

    # Scoped recalled items with personal character_shard quota protection + two-form budget packing
    effective_recalled = select_cognition_recalled_items(
        shared_scene_items,
        character_recalled_items,
        token_budget=recall_budget_cognition_tokens,
    )
    recalled_text = "\n".join(
        f"  - [{m.source_type.upper()}] {m.title}: {m.short_content if (m.render_form == 'short' and m.short_content) else m.content}"
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
        is_party_invite_roll = bool(
            pre_turn.party_action is not None
            and pre_turn.party_action.kind == "invite"
            and character.id in set(pre_turn.party_action.target_character_ids)
            and not getattr(r, "is_choice_gate", False)
        )
        if getattr(r, "is_choice_gate", False):
            roll_text = (
                f"\n=== MECHANICS CHECK OUTCOME FOR {character.name} ===\n"
                f"- Decisive Moment: Resulted in [{r.outcome_tier}] (d20({r.d20_raw}) = {r.total} vs DC {r.difficulty_class})\n"
                f"- Directive: {r.plan_directive}\n"
            )
        elif is_party_invite_roll:
            player_label = (
                known_persona.name.strip()
                if known_persona is not None and known_persona.name and known_persona.name.strip()
                else "Player"
            )
            roll_text = (
                f"\n=== PARTY INVITATION PERSUASION CHECK ({player_label} -> {character.name}) ===\n"
                f"- Roll Meaning: This check measures how persuasively {player_label}'s recruitment pitch landed "
                f"(NOT {character.name}'s willpower to refuse).\n"
                f"- Polarity: Clean/Critical Success means {player_label}'s pitch landed persuasively and pulls toward accept; "
                f"Failure/Critical Failure means the pitch fell flat or backfired and pulls toward refuse.\n"
                f"- Attempt: {r.action_description} ({r.skill_or_approach})\n"
                f"- Result: [{r.outcome_tier}] (d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class})\n"
                f"- Guidance: {r.plan_directive}\n"
                f"- WEIGHTED PERSUASION RULE: Weigh this outcome heavily alongside Trust/Warmth/Grievance, Core Drive/Fear, "
                f"and existing companion loyalties. Strong persuasion (especially Critical Success) sways neutral or skeptical "
                f"characters toward accepting; only deep hostility or an unbreakable core boundary should override it.\n"
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

    co_present_lines: list[str] = []
    for c in co_present_characters:
        c_st = (all_character_states or {}).get(c.id)
        c_phys = (
            format_physical_state_prompt_value(c_st.physical_stance, c_st.physical_context)
            if c_st is not None
            else ""
        )
        phys_suffix = f" [Starting Physical State: {c_phys}]" if c_phys else ""
        co_present_lines.append(f"  - {c.name} (id='{c.id}'): {c.tagline}{phys_suffix}")
    co_present_text = "\n".join(co_present_lines) or "  - None (alone with user)"

    prior_cues_section = ""
    if prior_cues:
        cue_lines = []
        for c in prior_cues:
            roll_note = f" [Roll: {c.roll_outcome_tier}]" if c.roll_outcome_tier else ""
            conseq_note = f" Fallout: '{c.observable_consequence_hint}'." if c.observable_consequence_hint else ""
            cue_lines.append(
                f"  - {c.character_name}: Outward manner: '{c.feeling_summary}'. Aim: '{c.want_summary}'. Action: '{c.observable_action_hint}'.{roll_note}{conseq_note}"
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

    imm_container = get_immediate_level1_container(active_location, world)
    container_ambiance_section = ""
    if imm_container is not None:
        c_desc = (imm_container.description or "").strip()
        c_tags = ", ".join(imm_container.environmental_tags) if imm_container.environmental_tags else "None"
        c_lore_selected = select_active_container_lore_for_turn(
            imm_container,
            user_message=user_message,
            pre_turn=pre_turn,
            narrator_directive=narrator_directive,
            max_ambient_entries=2,
        )
        c_lore_text = ""
        if c_lore_selected:
            c_lore_lines = "\n".join(
                f"    * [{'SECRET — DISCOVERED' if ln.category == 'secret' else ln.category.upper()}] {ln.title}: {ln.content}"
                for ln in c_lore_selected
            )
            c_lore_text = f"\n  * Building/Compound Lore:\n{c_lore_lines}"
        container_ambiance_section = (
            f"- Surrounding Building/Compound ({imm_container.name}): {c_desc} "
            f"[Atmosphere: {c_tags}]{c_lore_text}\n"
        )

    player_phys_text = (
        format_physical_state_prompt_value(
            current_player_state.physical_stance,
            current_player_state.physical_context,
        )
        if current_player_state is not None
        else ""
    )
    known_player_facts_section = ""
    if known_persona is not None:
        lines: list[str] = [f"Player Character ({known_persona.name}):"]
        if known_persona.physical_appearance:
            lines.append(f"- Appearance: {known_persona.physical_appearance}")
        if player_phys_text:
            lines.append(f"- Starting Physical State: {player_phys_text}")
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
    elif player_phys_text:
        known_player_facts_section = (
            f"Known Player Facts & Secrets (epistemically verified for {character.name}):\n"
            f"Player Character (Player):\n"
            f"- Starting Physical State: {player_phys_text}\n\n"
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

    self_phys_text = format_physical_state_prompt_value(
        previous_state.physical_stance, previous_state.physical_context
    )
    self_phys_line = (
        f"- [0] Starting Physical State: {self_phys_text} "
        "(respect physical constraints—e.g. stand up or break free before crossing the room)\n"
        if self_phys_text
        else ""
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
        f"{self_phys_line}"
        f"- [1] Equipped / In-Hand: {', '.join(format_item_names(previous_state.equipped)) or 'None'}\n"
        f"- [2] Carried Inventory: {', '.join(format_item_names(previous_state.inventory)) or 'None'}\n"
        f"- [3] Scene Props & Fixtures ({active_location.name}): {', '.join(active_location.environmental_tags) or 'None'}\n\n"
        f"Environment Details ({active_location.name}):\n"
        f"{container_ambiance_section}"
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
        f"Recalled Scoped Memories & Lore (Synthesize relevant beats into <recall> in under 12 words per bullet):\n"
        f"{recalled_text}\n\n"
    )

    eff_parties = list(active_parties or [])
    party_name_map = {**co_present_name_map, character.id: character.name}
    party_cognition_section = render_cognition_party_context(
        character_id=character.id,
        character_name=character.name,
        active_parties=eff_parties,
        active_location_id=active_location.id,
        pre_turn=pre_turn,
        character_name_map=party_name_map,
        character_state=previous_state,
        persona_name=known_persona.name if known_persona is not None else None,
    )
    party_ctx_block = f"{party_cognition_section}\n\n" if party_cognition_section else ""

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
        f"{party_ctx_block}"
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

    travel_intent_enum = (
        resolve_character_travel_intent_enum(
            character.id, eff_parties, active_location.id
        )
        if pre_turn.spatial_intent != "stay"
        else None
    )
    include_party_invite = bool(
        pre_turn.party_action is not None
        and pre_turn.party_action.kind == "invite"
        and character.id in set(pre_turn.party_action.target_character_ids)
    )

    from app.engine.choices import (
        build_directed_cognition_schema,
        build_undirected_cognition_schema,
        coerce_choice_compliance,
    )
    if choice_resolution:
        eff_schema = build_directed_cognition_schema(
            choice_resolution,
            travel_intent_enum=travel_intent_enum,
            include_party_invite=include_party_invite,
        )
    else:
        eff_schema = build_undirected_cognition_schema(
            travel_intent_enum=travel_intent_enum,
            include_party_invite=include_party_invite,
        )

    try:
        with telemetry_phase_scope("phase3_cognition", f"Cognition: {character.name}"):
            cog = await active_client.complete_structured(
                messages,
                CognitionBlock,
                profile=eff_profile,
                max_tokens=1024,
                temperature=0.7,
                required_properties=eff_schema.get("required"),
                json_schema=eff_schema,
            )

        resolved_loc_name = _resolve_location_name(
            previous_state.current_location_id, active_location, world
        )
        cog.recall = _sanitize_cognition_text(
            cog.recall,
            field_type="recall",
            location_id=active_location.id,
            location_name=resolved_loc_name,
        )
        cog.recall = _format_cognition_bullets(cog.recall, max_bullets=3, max_words_per_bullet=12)

        cog.want = _sanitize_cognition_text(
            cog.want,
            field_type="want",
            location_id=active_location.id,
            location_name=resolved_loc_name,
        )
        if not cog.want:
            cog.want = clean_prev_want

        cog.plan = _sanitize_cognition_text(
            cog.plan,
            field_type="plan",
            location_id=active_location.id,
            location_name=resolved_loc_name,
        )
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

        if not travel_intent_enum or cog.travel_intent not in travel_intent_enum:
            cog.travel_intent = "default"

        if not include_party_invite:
            cog.party_invite_decision = None
        elif cog.party_invite_decision not in ("accept", "refuse"):
            cog.party_invite_decision = compute_heuristic_party_invite_decision(
                character=character,
                previous_state=previous_state,
                pre_turn=pre_turn,
                active_parties=eff_parties,
                active_location_id=active_location.id,
            )

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
            known_persona=known_persona,
            public_message=public_message,
            char_whisper=char_whisper,
            active_parties=eff_parties,
            active_location_id=active_location.id,
            active_location_name=_resolve_location_name(
                previous_state.current_location_id, active_location, world
            ),
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
                        recall_budget_cognition_tokens=context.recall_budget_cognition_tokens,
                        active_parties=context.active_parties,
                        all_character_states=context.all_character_states,
                        current_player_state=context.current_player_state,
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
                    active_parties=context.active_parties,
                    active_location_id=context.active_location.id,
                    active_location_name=_resolve_location_name(
                        char_prev.current_location_id, context.active_location, context.world
                    ),
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
                    recall_budget_cognition_tokens=context.recall_budget_cognition_tokens,
                    active_parties=context.active_parties,
                    all_character_states=context.all_character_states,
                    current_player_state=context.current_player_state,
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
                    active_parties=context.active_parties,
                    active_location_id=context.active_location.id,
                    active_location_name=_resolve_location_name(
                        char_prev.current_location_id, context.active_location, context.world
                    ),
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
