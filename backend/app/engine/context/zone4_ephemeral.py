"""Zone 4 ephemeral tail frame and elapsed snapshot state projection."""

from __future__ import annotations

from app.engine.affective_engine import (
    compute_provisional_cognition_preview,
    describe_edge_stance,
    describe_trust_tier,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
    project_care_to_minute,
    render_zone4_affective_block,
    seed_initial_care_state,
)
from app.engine.mentions import DecomposedUserMessage
from app.engine.parties import render_zone4_party_and_movement_blocks
from app.engine.world_clock import describe_world_timestamp
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
    format_item_names,
)
from app.schemas.party import PartyRecord
from app.schemas.persona import (
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.physical import format_physical_state_prompt_value
from app.schemas.turn import (
    PreTurnAnalysis,
    RecalledMemoryItem,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationNode,
    LocationProp,
    NeighborLocationView,
    WorldRecord,
    format_distance_meters,
    format_exit_travel_phrase,
)

from app.engine.context.lore_scope import (
    build_container_chain,
    compute_lca_transition_cue,
    select_active_container_lore_for_turn,
    select_active_location_lore_for_turn,
)
from app.engine.context.zone2_episodic import format_arc_objective_prompt_line


def _seed_turn0_arc_objective(character: CharacterRecord):
    base_obj = getattr(character.baseline_psyche, "default_objective", None)
    if base_obj is None:
        return None
    return base_obj.model_copy(update={"set_at_turn_depth": 0})

def _project_snapshot_to_elapsed(
    snapshot: CharacterStateSnapshot,
    character: CharacterRecord,
    target_elapsed_minutes: int,
) -> CharacterStateSnapshot:
    """Idempotently project a character's CARE state up to target_elapsed_minutes."""
    target = max(0, int(target_elapsed_minutes))
    if snapshot.care_state is None:
        hydrated = ensure_snapshot_care_state(
            snapshot,
            character.baseline_psyche,
            elapsed_minutes=target,
        )
        return snapshot.model_copy(update={"care_state": hydrated})

    if target <= snapshot.care_state.state_elapsed_minutes:
        return snapshot

    projected = project_care_to_minute(
        snapshot.care_state,
        target_elapsed_minutes=target,
        psyche=character.baseline_psyche,
    )
    return materialize_snapshot_with_care(snapshot, projected)


def resolve_character_previous_state(
    branch_turns: list[TurnNodeRecord],
    character: CharacterRecord,
    fallback_location_id: str,
) -> CharacterStateSnapshot:
    """Resolve a character's state before the current turn, preserving valid CARE states across narrator turns."""
    if not branch_turns:
        seeded = seed_initial_care_state(
            character.baseline_psyche,
            initial_elapsed_minutes=0,
        )
        return CharacterStateSnapshot(
            turn_id="turn_root",
            character_id=character.id,
            current_location_id=fallback_location_id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            arc_objective=_seed_turn0_arc_objective(character),
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            equipped=list(character.equipped),
            inventory=list(character.inventory),
            care_state=seeded,
        )

    parent_turn = branch_turns[-1]
    parent_elapsed = parent_turn.world_snapshot.campaign_elapsed_minutes
    current_state = parent_turn.character_states.get(
        character.id,
        parent_turn.character_state if parent_turn.character_state.character_id == character.id else None,
    )
    if current_state is None:
        seeded = seed_initial_care_state(
            character.baseline_psyche,
            initial_elapsed_minutes=parent_elapsed,
        )
        current_state = CharacterStateSnapshot(
            turn_id=parent_turn.id,
            character_id=character.id,
            current_location_id=fallback_location_id,
            mood_label=character.baseline_psyche.mood_label,
            valence=character.baseline_psyche.valence,
            arousal=character.baseline_psyche.arousal,
            active_want=character.baseline_psyche.default_want,
            active_plan=character.baseline_psyche.default_plan,
            arc_objective=_seed_turn0_arc_objective(character),
            relationship_notes={"user": "Acquaintance / Uncertain trust"},
            equipped=list(character.equipped),
            inventory=list(character.inventory),
            care_state=seeded,
        )

    # Only rewind across narrator turns if current_state holds a detached narrator placeholder
    # or lacks a self-contained CARE snapshot (never overwrite valid narrator-decayed CARE states).
    if current_state.mood_label == "Objective / Detached" or (
        parent_turn.actor_id in ("__narrator__", "__arrival__", "__solo__") and current_state.care_state is None
    ):
        for turn in reversed(branch_turns):
            if turn.actor_id in ("__narrator__", "__arrival__", "__solo__"):
                continue
            hist_state = turn.character_states.get(
                character.id,
                turn.character_state if turn.character_state.character_id == character.id else None,
            )
            if hist_state and hist_state.mood_label != "Objective / Detached":
                rewound = current_state.model_copy(
                    update={
                        "mood_label": hist_state.mood_label,
                        "valence": hist_state.valence,
                        "arousal": hist_state.arousal,
                        "active_want": hist_state.active_want,
                        "active_plan": hist_state.active_plan,
                        "arc_objective": hist_state.arc_objective,
                        "care_state": hist_state.care_state,
                    }
                )
                if rewound.care_state is None:
                    rewound = rewound.model_copy(
                        update={
                            "care_state": ensure_snapshot_care_state(
                                rewound,
                                character.baseline_psyche,
                                elapsed_minutes=parent_elapsed,
                            )
                        }
                    )
                return rewound

        # Fallback to baseline psyche if no non-narrator turn had custom emotion
        seeded_fallback = seed_initial_care_state(
            character.baseline_psyche,
            initial_elapsed_minutes=parent_elapsed,
        )
        return current_state.model_copy(
            update={
                "mood_label": character.baseline_psyche.mood_label,
                "valence": character.baseline_psyche.valence,
                "arousal": character.baseline_psyche.arousal,
                "active_want": character.baseline_psyche.default_want,
                "active_plan": character.baseline_psyche.default_plan,
                "arc_objective": _seed_turn0_arc_objective(character),
                "care_state": seeded_fallback,
            }
        )

    if current_state.care_state is None:
        current_state = current_state.model_copy(
            update={
                "care_state": ensure_snapshot_care_state(
                    current_state,
                    character.baseline_psyche,
                    elapsed_minutes=parent_elapsed,
                )
            }
        )
    return current_state


def build_zone4_ephemeral_tail_frame(
    *,
    user_message: str,
    character: CharacterRecord,
    world_snapshot: WorldStateSnapshot,
    character_state: CharacterStateSnapshot,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    recalled_items: list[RecalledMemoryItem],
    pre_turn: PreTurnAnalysis,
    present_characters: list[CharacterRecord] | None = None,
    all_character_states: dict[str, CharacterStateSnapshot] | None = None,
    character_name_map: dict[str, str] | None = None,
    is_narrator: bool = False,
    is_solo: bool = False,
    narrative_mode: str | None = None,
    narrator_directive: str | None = None,
    established_cognition: CognitionBlock | None = None,
    established_cognitions: dict[str, CognitionBlock] | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    decomposed_message: DecomposedUserMessage | None = None,
    world: WorldRecord | None = None,
    origin_location_id: str | None = None,
    active_parties: list[PartyRecord] | None = None,
    newly_discovered_edge_ids: set[str] | None = None,
    visible_location_props: list[LocationProp] | None = None,
    newly_revealed_prop_ids: set[str] | None = None,
    newly_spawned_prop_ids: set[str] | None = None,
    narrative_voice: str | None = None,
) -> str:
    """Zone 4: Dynamic turn-specific context injected at the tail of the prompt."""
    discovered_set = newly_discovered_edge_ids or set()
    has_newly_discovered = False
    exit_lines: list[str] = []
    for n in neighbors:
        is_new_secret = n.edge_id in discovered_set
        if is_new_secret:
            has_newly_discovered = True
        meta_parts = [
            format_distance_meters(n.distance_meters),
            format_exit_travel_phrase(n.distance_meters, n.speed_modifier, n.travel_mode),
        ]
        if n.obstacles:
            meta_parts.append(f"obstacles: {', '.join(n.obstacles)}")
        if n.is_blocked:
            meta_parts.append("BLOCKED")
        if is_new_secret:
            meta_parts.append("NEWLY DISCOVERED SECRET PASSAGE")
        exit_lines.append(
            f"  - [{n.compass_direction or 'N'}] {n.direction_label} -> {n.destination.name} "
            f"({n.destination.summary}) [{'; '.join(meta_parts)}]"
        )
    if has_newly_discovered:
        exit_lines.append(
            "  *(Note: Any exit tagged NEWLY DISCOVERED SECRET PASSAGE was just uncovered this turn — narrate finding it naturally.)*"
        )
    exits_text = "\n".join(exit_lines) or "  - None visible"

    memories_text = "\n".join(
        f"  - [{m.source_type.upper()}] {m.title}: {m.short_content if (m.render_form == 'short' and m.short_content) else m.content}"
        for m in recalled_items
    ) or "  - No specific background lore triggered this turn."

    name_lookup_local = dict(character_name_map or {})
    for pc in present_characters or []:
        name_lookup_local.setdefault(pc.id, pc.name)

    rng_section = ""
    if pre_turn.character_rolls:
        roll_lines = []
        for cid, r in pre_turn.character_rolls.items():
            name_label = r.character_name or name_lookup_local.get(cid, cid)
            roll_lines.append(
                f"    <character_roll character=\"{name_label}\" character_id=\"{cid}\">\n"
                f"      Action: {r.action_description} ({r.skill_or_approach}, role: {r.check_role})\n"
                f"      Roll: d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class} -> [{r.outcome_tier}]\n"
                f"      Directive: {r.narrative_directive}\n"
                f"    </character_roll>"
            )
        rng_section = (
            "\n  <mechanics_outcome>\n"
            + "\n".join(roll_lines)
            + "\n    <mechanics_guidance>\n"
            "      Enforce each character's outcome tier strictly in dialogue and action. If co-present characters rolled opposing outcomes, higher tiers take precedence over contested objectives (Critical Success > Clean Success > Simple Failure > Failure with Consequences > Critical Failure).\n"
            "    </mechanics_guidance>\n"
            "  </mechanics_outcome>"
        )
    elif pre_turn.resolved_roll is not None:
        r = pre_turn.resolved_roll
        rng_section = (
            f"\n  <mechanics_outcome>\n"
            f"    Action: {r.action_description} ({r.skill_or_approach})\n"
            f"    Roll: d20({r.d20_raw}) + {r.modifier} = {r.total} vs DC {r.difficulty_class} -> [{r.outcome_tier}]\n"
            f"    Directive: {r.narrative_directive}\n"
            f"  </mechanics_outcome>"
        )

    env_tags = ", ".join(active_location.environmental_tags) if active_location.environmental_tags else "None"
    scene_flags_text = (
        ", ".join(world_snapshot.scene_flags)
        if world_snapshot.scene_flags
        else "None"
    )
    eq_names = format_item_names(character_state.equipped)
    inv_names = format_item_names(character_state.inventory)
    equipped_text = ", ".join(eq_names) if eq_names else "None"
    inventory_text = ", ".join(inv_names) if inv_names else "None"

    co_present_section = ""
    if is_solo:
        co_present_section = (
            "\n  <other_characters_in_room>\n"
            "    - None (you are alone in this location)\n"
            "  </other_characters_in_room>"
        )
    elif present_characters:
        others = [c for c in present_characters if c.id != character.id]
        if others:
            other_lines: list[str] = []
            for oc in others:
                oc_state = (all_character_states or {}).get(oc.id)
                demeanor_info = ""
                player_stance = ""
                speaker_stance = ""
                if oc_state is not None:
                    oc_care = ensure_snapshot_care_state(
                        oc_state,
                        oc.baseline_psyche,
                        elapsed_minutes=world_snapshot.campaign_elapsed_minutes,
                    )
                    oc_cog = (established_cognitions or {}).get(oc.id)
                    if oc_cog is not None and not oc_cog.skipped:
                        oc_roll = pre_turn.character_rolls.get(oc.id)
                        oc_care = compute_provisional_cognition_preview(
                            oc_care,
                            oc_cog.to_feeling_impulse(),
                            roll_outcome=oc_roll.outcome_tier if oc_roll else None,
                        )
                    demeanor_info = f" [Demeanor: {oc_care.outward_demeanor}]"
                    player_edge = oc_care.relations.get("user")
                    if player_edge:
                        p_name = persona_snapshot.name.strip() if persona_snapshot and persona_snapshot.name.strip() else "Player"
                        player_stance = f" [Stance toward {p_name}: {describe_edge_stance(player_edge)} (Trust: {describe_trust_tier(player_edge.trust)})]"
                    if character.id != "user":
                        speaker_edge = oc_care.relations.get(character.id)
                        if speaker_edge:
                            speaker_desc = describe_edge_stance(speaker_edge)
                            if speaker_desc != "Measured & Neutral":
                                speaker_stance = f" [Stance toward {character.name}: {speaker_desc}]"
                app_info = (
                    f" | Appearance: {oc.physical_appearance}"
                    if oc.physical_appearance.strip()
                    else ""
                )
                oc_eq_names = format_item_names(
                    oc_state.equipped if oc_state is not None else oc.equipped
                )
                oc_inv_names = format_item_names(
                    oc_state.inventory if oc_state is not None else oc.inventory
                )
                oc_phys = (
                    format_physical_state_prompt_value(
                        oc_state.physical_stance, oc_state.physical_context
                    )
                    if oc_state is not None
                    else ""
                )
                phys_info = f" | Starting Physical State: {oc_phys}" if oc_phys else ""
                eq_info = f" | Equipped: {', '.join(oc_eq_names)}" if oc_eq_names else ""
                inv_info = f" | Carried: {', '.join(oc_inv_names)}" if oc_inv_names else ""
                obj_info = (
                    f" | Arc Objective: {oc_state.arc_objective.format_prompt_text()}"
                    if (narrative_voice == "storyteller" and oc_state is not None and oc_state.arc_objective is not None)
                    else ""
                )
                other_lines.append(
                    f"    - {oc.name} ({oc.tagline}){demeanor_info}{player_stance}{speaker_stance}{app_info}{phys_info}{eq_info}{inv_info}{obj_info}"
                )
            co_present_section = (
                "\n  <other_characters_in_room>\n"
                + "\n".join(other_lines)
                + "\n  </other_characters_in_room>"
            )

    if is_narrator:
        if narrative_mode == "describe":
            default_dir = (
                "Describe the immediate environment, lighting, acoustics, smells, visible points of interest, "
                "and subtle observable details or lore markers with objective neutrality. "
                "If any visible <location_props> are present, weave them naturally into the scene as subtle observable hints. "
                "Do not speak or decide for the user's character."
            )
        elif narrative_mode == "advance":
            default_dir = (
                "Advance the story and depict the passage of time without player character actions. "
                "Detail environmental shifts, ambient sounds, lighting cycles, weather, or machine cycles."
            )
        elif narrative_mode == "complication":
            default_dir = (
                "Introduce an unexpected external complication or inciting incident (e.g. a sudden power surge, "
                "an unannounced arrival, mechanical failure, alarm, or environmental hazard). "
                "Do NOT force the protagonist's emotional or physical reaction; present the event as external fact."
            )
        else:
            default_dir = (
                "Follow the director guidance with strict objective detachment: "
                f"{narrator_directive or 'Depict the scene objectively.'}"
            )
        directive_text = narrator_directive if narrator_directive and narrative_mode not in ("describe", "complication") else default_dir
        if narrator_directive and narrative_mode == "complication":
            directive_text += f" (Focus hint: {narrator_directive})"
        mind_state_section = (
            f"  <narrator_directive mode=\"{narrative_mode or 'custom'}\">\n"
            f"    Directive: {directive_text}\n"
            f"    STRICT NEUTRALITY CONSTRAINTS:\n"
            f"    - Zero emotional puppeteering (do not write 'you feel', 'relief', 'panic', 'dread').\n"
            f"    - Zero helpful hints or editorial guidance (do not suggest what to do).\n"
            f"    - Zero heroic sycophancy (no 'luckily', 'bravely', 'against all odds').\n"
            f"    - The world is completely indifferent to the characters.\n"
            f"  </narrator_directive>"
        )
        user_tail = f"Director / Narrator Request:\n{user_message}"
    elif is_solo:
        mind_state_section = (
            "  <solo_scene_directive>\n"
            "    The protagonist is acting alone in this empty location.\n"
            "    - Depict concrete environmental, sensory, and spatial outcomes of the user's action.\n"
            "    - Treat any Starting Physical State below as where the protagonist begins this turn (not a frozen pose)—depict stance, orientation, and spatial transitions explicitly in prose rather than skipping or leaving them ambiguous.\n"
            "    - Honor any <mechanics_outcome> roll tier strictly without narrating absent NPC reactions.\n"
            "    - Keep absent campaign characters strictly off-screen unless triggered via remote comms.\n"
            "  </solo_scene_directive>"
        )
        user_tail = f"User Action / Dialogue:\n{user_message}"
    else:
        char_roll_for_anchor = pre_turn.character_rolls.get(character.id) or (
            pre_turn.resolved_roll
            if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
            else None
        )
        active_care = ensure_snapshot_care_state(
            character_state,
            character.baseline_psyche,
            elapsed_minutes=world_snapshot.campaign_elapsed_minutes,
        )
        active_cog = (established_cognitions or {}).get(character.id) or established_cognition
        if active_cog is not None and not active_cog.skipped:
            active_care = compute_provisional_cognition_preview(
                active_care,
                active_cog.to_feeling_impulse(),
                roll_outcome=char_roll_for_anchor.outcome_tier if char_roll_for_anchor else None,
            )

        co_present_npc_ids = {
            c.id for c in (present_characters or []) if c.id != character.id
        }
        affective_block = render_zone4_affective_block(
            active_care,
            character_name=character.name,
            persona_name=persona_snapshot.name if persona_snapshot else None,
            character_name_map=name_lookup_local,
            active_speaker_id=pre_turn.active_speaker_id,
            co_present_ids=co_present_npc_ids,
            max_npc_edges=2,
        )
        indented_affective = "\n".join("  " + ln for ln in affective_block.splitlines())

        if char_roll_for_anchor and char_roll_for_anchor.outcome_tier in ("Critical Failure", "Critical Success"):
            anchor_line = f"    Behavioral Anchor: This turn resulted in a [{char_roll_for_anchor.outcome_tier}]—sharp emotional, physical, and behavioral shifts are explicitly required.\n"
        elif active_care.composure <= 0.35:
            anchor_line = "    Behavioral Anchor: Composure is [STRAINED/SHATTERED] (masking collapsed)—subconscious tension, micro-expressions, trembling, voice breaks, or involuntary defensive escalation MUST leak into dialogue and action.\n"
        elif active_care.composure >= 0.70:
            anchor_line = "    Behavioral Anchor: Composure is [DISCIPLINED/HIGH]—mask internal feelings behind controlled decorum and professional stillness; do NOT blurt out raw private thoughts.\n"
        else:
            anchor_line = "    Behavioral Anchor: Ground outward speech, cadence, and micro-expressions in the affective state and self-control directives above.\n"

        speaker_phys = format_physical_state_prompt_value(
            character_state.physical_stance, character_state.physical_context
        )
        speaker_phys_line = f"    Starting Physical State: {speaker_phys}\n" if speaker_phys else ""
        arc_obj_zone4_line = format_arc_objective_prompt_line(
            character_state.arc_objective,
            world_timestamp=world_snapshot.world_timestamp,
            temperament_archetype=character.baseline_psyche.temperament.archetype,
            for_cognition=False,
        )
        mind_state_section = (
            f"{indented_affective}\n"
            f"  <character_equipment_and_goals character=\"{character.name}\">\n"
            f"{arc_obj_zone4_line}"
            f"    Previous Want: {character_state.active_want}\n"
            f"    Previous Plan: {character_state.active_plan}\n"
            f"{speaker_phys_line}"
            f"    Equipped / Worn: {equipped_text}\n"
            f"    Carried Inventory: {inventory_text}\n"
            f"{anchor_line}"
            f"    Physical Continuity: Treat any Starting Physical State above or below as where each participant begins this turn (not a frozen pose)—depict stance, orientation, and spatial transitions explicitly in prose rather than skipping or leaving them ambiguous.\n"
            f"  </character_equipment_and_goals>"
        )
        user_tail = f"User Action / Dialogue:\n{user_message}"

    established_cognition_section = ""
    if not is_narrator and not is_solo:
        if established_cognitions:
            cog_blocks: list[str] = []
            present_chars = present_characters or [character]
            primary_id = pre_turn.active_speaker_id or character.id
            from app.engine.choices import cognition_dispatch_order
            choice_target_ids = set(pre_turn.choice_resolutions.keys())
            ordered_chars = cognition_dispatch_order(
                present_chars,
                primary_id=primary_id,
                choice_target_ids=choice_target_ids,
            )
            for pc in ordered_chars:
                cog = established_cognitions.get(pc.id)
                if not cog or cog.skipped:
                    continue
                role_label = "primary_speaker" if pc.id == primary_id else "co_present"
                pc_roll = pre_turn.character_rolls.get(pc.id) or (
                    pre_turn.resolved_roll
                    if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, pc.id)
                    else None
                )
                effective_roll = cog.roll_outcome_tier or (pc_roll.outcome_tier if pc_roll else None)
                roll_attr = f' roll_outcome="{effective_roll}"' if effective_roll else ""
                tone_attr = f' tone="{cog.feeling_tone}"' if cog.feeling_tone else ""
                int_attr = f' intensity="{cog.feeling_intensity}"' if cog.feeling_intensity else ""
                agency_attr = f' agency="{cog.feeling_agency}"' if cog.feeling_agency else ""
                threat_attr = f' threat="{cog.scene_threat}"' if cog.scene_threat else ""
                coping_attr = f' coping="{cog.scene_coping}"' if cog.scene_coping else ""
                cog_blocks.append(
                    f'  <character_active_cognition character="{pc.name}" character_id="{pc.id}" role="{role_label}"{roll_attr}>\n'
                    f"    <feeling{tone_attr}{int_attr}{agency_attr}{threat_attr}{coping_attr}>{cog.feeling}</feeling>\n"
                    f"    <want>{cog.want}</want>\n"
                    f"    <plan>\n{cog.plan}\n    </plan>\n"
                    f"  </character_active_cognition>"
                )
            if cog_blocks:
                if narrative_voice == "first_person":
                    multi_actor_dir = (
                        "    CRITICAL: Internal thoughts, emotional feelings, and tactical plans have already been established above in <character_active_cognition>.\n"
                        f"    Write strictly from {character.name}'s 1st-person (\"I\") POV, executing {character.name}'s plan while rendering co-present characters' spoken dialogue and actions strictly as observable outward behavior (never narrate their private thoughts telepathically).\n"
                        "    Address the player in 2nd person (\"you\"). Do NOT output <cognition> blocks.\n"
                    )
                else:
                    multi_actor_dir = (
                        "    CRITICAL: Internal thoughts, emotional feelings, and tactical plans for the characters have already been established above in <character_active_cognition>.\n"
                        "    Do NOT output <cognition> blocks. Output ONLY immersive 3rd-person Storyteller prose portraying the NPC(s) executing these plans while addressing the player in 2nd person (\"you\").\n"
                    )
                established_cognition_section = (
                    "\n"
                    + "\n".join(cog_blocks)
                    + "\n  <actor_directive>\n"
                    + multi_actor_dir
                    + "  </actor_directive>"
                )
        elif established_cognition:
            ec_roll = pre_turn.character_rolls.get(character.id) or (
                pre_turn.resolved_roll
                if pre_turn.resolved_roll and pre_turn.resolved_roll.character_id in (None, character.id)
                else None
            )
            effective_ec_roll = established_cognition.roll_outcome_tier or (ec_roll.outcome_tier if ec_roll else None)
            ec_roll_attr = f' roll_outcome="{effective_ec_roll}"' if effective_ec_roll else ""
            ec_tone_attr = f' tone="{established_cognition.feeling_tone}"' if established_cognition.feeling_tone else ""
            ec_int_attr = f' intensity="{established_cognition.feeling_intensity}"' if established_cognition.feeling_intensity else ""
            ec_agency_attr = f' agency="{established_cognition.feeling_agency}"' if established_cognition.feeling_agency else ""
            ec_threat_attr = f' threat="{established_cognition.scene_threat}"' if established_cognition.scene_threat else ""
            ec_coping_attr = f' coping="{established_cognition.scene_coping}"' if established_cognition.scene_coping else ""
            if narrative_voice == "storyteller":
                single_actor_dir = (
                    f"    CRITICAL: {character.name}'s internal thoughts and immediate plan for this turn have already been established above in <character_active_cognition>.\n"
                    f"    Do NOT output <cognition> blocks. Output ONLY immersive 3rd-person Storyteller prose portraying {character.name} embodying this feeling and executing this plan while addressing the player in 2nd person (\"you\").\n"
                )
            else:
                single_actor_dir = (
                    "    CRITICAL: Your character's internal thoughts and immediate plan for this turn have already been established above in <character_active_cognition>.\n"
                    "    Do NOT output <cognition> blocks. Output ONLY immersive, in-character narrative prose embodying this feeling and executing this plan, addressing the player in 2nd person (\"you\").\n"
                )
            established_cognition_section = (
                f'\n  <character_active_cognition character="{character.name}"{ec_roll_attr}>\n'
                f"    <recall>\n{established_cognition.recall}\n    </recall>\n"
                f"    <feeling{ec_tone_attr}{ec_int_attr}{ec_agency_attr}{ec_threat_attr}{ec_coping_attr}>{established_cognition.feeling}</feeling>\n"
                f"    <want>{established_cognition.want}</want>\n"
                f"    <plan>\n{established_cognition.plan}\n    </plan>\n"
                f"  </character_active_cognition>\n"
                f"  <actor_directive>\n"
                f"{single_actor_dir}"
                f"  </actor_directive>"
            )

    selected_local_lore = select_active_location_lore_for_turn(
        active_location,
        user_message=user_message,
        pre_turn=pre_turn,
        narrator_directive=narrator_directive,
    )
    local_lore_block = ""
    if selected_local_lore:
        local_lore_lines = "\n".join(
            f"      - [{'SECRET — DISCOVERED' if ln.category == 'secret' else ln.category.upper()}] {ln.title}: {ln.content}"
            for ln in selected_local_lore
        )
        local_lore_block = f"\n    <local_lore>\n{local_lore_lines}\n    </local_lore>"

    container_chain = build_container_chain(active_location, world.containers) if world else []
    spatial_hierarchy_block = ""
    if container_chain:
        spatial_hierarchy_block = (
            f"\n    <spatial_hierarchy>{' > '.join(c.name for c in container_chain)}</spatial_hierarchy>"
        )

    parent_container_block = ""
    if container_chain and container_chain[-1].depth == 1:
        imm_cont = container_chain[-1]
        cont_body = (imm_cont.description or "").strip()
        cont_env = (
            ", ".join(imm_cont.environmental_tags)
            if imm_cont.environmental_tags
            else "None"
        )
        selected_cont_lore = select_active_container_lore_for_turn(
            imm_cont,
            user_message=user_message,
            pre_turn=pre_turn,
            narrator_directive=narrator_directive,
            max_ambient_entries=2,
        )
        cont_lore_block = ""
        if selected_cont_lore:
            cont_lore_lines = "\n".join(
                f"        - [{'SECRET — DISCOVERED' if ln.category == 'secret' else ln.category.upper()}] {ln.title}: {ln.content}"
                for ln in selected_cont_lore
            )
            cont_lore_block = f"\n      <container_lore>\n{cont_lore_lines}\n      </container_lore>"
        parent_container_block = (
            f'\n    <parent_container name="{imm_cont.name}">\n'
            f"      {cont_body}\n"
            f"      Atmosphere: {cont_env}\n"
            f"      *(Ground container ambiance subtly on entry; avoid repeating verbatim on subsequent turns.)*"
            f"{cont_lore_block}\n"
            f"    </parent_container>"
        )

    transition_cue_block = ""
    if world and origin_location_id:
        origin_loc = next(
            (loc for loc in world.locations if loc.id == origin_location_id),
            None,
        )
        if origin_loc is not None:
            transition_cue_block = compute_lca_transition_cue(
                origin_loc, active_location, world.containers
            )

    player_gear_section = ""
    if persona_snapshot:
        eq_items = (
            current_player_state.equipped
            if current_player_state is not None
            else persona_snapshot.equipped
        )
        vis_eq = [it.name for it in eq_items if not it.is_secret]
        if vis_eq:
            player_gear_section = (
                f"\n  <player_visible_equipment player=\"{persona_snapshot.name}\">\n"
                f"    Equipped / Worn: {', '.join(vis_eq)}\n"
                f"  </player_visible_equipment>"
            )

    player_phys_str = (
        format_physical_state_prompt_value(
            current_player_state.physical_stance,
            current_player_state.physical_context,
        )
        if current_player_state is not None
        else ""
    )
    player_label = (
        persona_snapshot.name.strip()
        if persona_snapshot and persona_snapshot.name and persona_snapshot.name.strip()
        else "Player"
    )
    player_phys_section = (
        f'\n  <player_physical_state player="{player_label}">\n'
        f"    Starting Physical State: {player_phys_str}\n"
        f"  </player_physical_state>"
        if player_phys_str
        else ""
    )
    narrator_continuity_section = (
        "\n  <physical_continuity>Treat any Starting Physical State above as where each participant begins this turn (not a frozen pose)—depict stance, orientation, and spatial transitions explicitly in prose rather than skipping or leaving them ambiguous.</physical_continuity>"
        if is_narrator
        and narrative_mode != "describe"
        and (bool(player_phys_str) or "Starting Physical State:" in co_present_section)
        else ""
    )

    directed_cues_section = ""
    if decomposed_message and decomposed_message.whispers:
        whisper_lines = []
        for w in decomposed_message.whispers:
            pts = []
            if w.speech_parts:
                pts.append(f"Spoken Dialogue: {w.speech_parts}")
            if w.sensory_parts:
                pts.append(f"Sensory/Perception: {w.sensory_parts}")
            whisper_lines.append(f"    - @{w.character_name} ({w.target_scope.value.upper()}): {'; '.join(pts)}")
        directed_cues_section = (
            "\n  <directed_character_cues>\n"
            + "\n".join(whisper_lines)
            + "\n    CRITICAL DIRECTIVE: Characters are only aware of their own private perceptions and words spoken aloud in the room. Characters must NOT metagame each other's private sensory observations.\n"
            "  </directed_character_cues>"
        )

    eff_parties = (
        list(active_parties)
        if active_parties is not None
        else list(world_snapshot.parties or [])
    )
    party_and_movement_section = render_zone4_party_and_movement_blocks(
        active_parties=eff_parties,
        active_location_id=active_location.id,
        active_location_name=active_location.name,
        present_characters=present_characters or ([] if is_solo else [character]),
        pre_turn=pre_turn,
        established_cognitions=established_cognitions,
        character_name_map=name_lookup_local,
        persona_name=persona_snapshot.name if persona_snapshot else None,
    )

    rev_prop_ids = newly_revealed_prop_ids or set()
    spawn_prop_ids = newly_spawned_prop_ids or set()
    props_for_prompt = list(visible_location_props or [])
    location_props_block = ""
    if props_for_prompt:
        prop_lines: list[str] = []
        for prop in props_for_prompt:
            tags: list[str] = []
            if prop.id in rev_prop_ids:
                tags.append("NEWLY DISCOVERED")
            if prop.id in spawn_prop_ids:
                tags.append("NEWLY FOUND")
            tag_prefix = f"[{' / '.join(tags)}] " if tags else ""
            note_suffix = f": {prop.note}" if prop.note else ""
            prop_lines.append(f"      - {tag_prefix}{prop.name}{note_suffix}")
        prop_hint = (
            "      *(Highlight these visible props naturally as observable environmental hints.)*\n"
            if (is_narrator and narrative_mode == "describe")
            else "      *(Portable items currently in this room; narrate discovery of NEWLY DISCOVERED/FOUND items without forcing pickup unless explicitly taken.)*\n"
        )
        location_props_block = f"\n    <location_props>\n{prop_hint}" + "\n".join(prop_lines) + "\n    </location_props>"

    search_directive_block = ""
    if pre_turn.is_search_action:
        search_directive_block = (
            "\n  <search_action_directive>\n"
            "    The protagonist is actively searching this location.\n"
            "    - Honor the <mechanics_outcome> roll strictly: on Clean/Critical Success, clearly depict discovering any [NEWLY DISCOVERED] or [NEWLY FOUND] items or secrets in the room.\n"
            "    - On failure (or if no new items/secrets were uncovered), describe a thorough search that turns up nothing new—NEVER invent unprompted hidden items or secret loot on a failed roll.\n"
            "  </search_action_directive>"
        )

    return (
        "<scene_context>\n"
        f"  <world_clock>{describe_world_timestamp(world_snapshot.world_timestamp)}</world_clock>\n"
        f"  <scene_flags>{scene_flags_text}</scene_flags>\n"
        f"  <active_location name=\"{active_location.name}\">{spatial_hierarchy_block}{parent_container_block}\n"
        f"    {active_location.description}\n"
        f"    Props & Atmosphere: {env_tags}{local_lore_block}{location_props_block}\n"
        f"  </active_location>{transition_cue_block}{co_present_section}{party_and_movement_section}\n"
        f"  <connected_locations>\n{exits_text}\n  </connected_locations>\n"
        f"  <recalled_memories_and_lore>\n{memories_text}\n  </recalled_memories_and_lore>\n"
        f"  <auxiliary_prompt_analysis>\n"
        f"    User Tone/Sentiment: {pre_turn.user_sentiment}\n"
        f"    Subtext Cue: {pre_turn.subtext_interpretation}\n"
        f"    Spatial Intent: {pre_turn.spatial_intent}"
        f"{f' ({pre_turn.target_location_hint})' if pre_turn.target_location_hint else ''}\n"
        f"  </auxiliary_prompt_analysis>{rng_section}\n"
        f"{mind_state_section}"
        f"{search_directive_block}"
        f"{established_cognition_section}"
        f"{player_gear_section}"
        f"{player_phys_section}"
        f"{narrator_continuity_section}"
        f"{directed_cues_section}\n"
        "</scene_context>\n\n"
        f"{user_tail}"
    )
