"""Phase 5 async post-turn clerk orchestrator and passive bystander fast-pathing."""

from __future__ import annotations

import asyncio
import re
import uuid

from app.config import (
    AgentDispatchMode,
    ModelProfile,
    settings,
)
from app.db.repos.arrival_descriptions import build_first_visit_arrival_bundle
from app.db.repos.turns import resolve_effective_location_props
from app.db.repository import CantinaRepository
from app.engine.affective_engine import (
    MechanicalTurnSignals,
    ResolvedWitnessEvent,
    apply_co_present_witness_coupling,
    ensure_snapshot_care_state,
    materialize_snapshot_with_care,
    project_care_to_minute,
    resolve_post_turn_care_state,
)
from app.engine.character_agent import (
    apply_character_inventory_delta,
    arbitrate_inventory_disputes_detailed,
    collect_relinquished_item_instances,
    detect_inventory_disputes,
    enforce_permanent_item_locks,
    heuristic_character_agent_delta,
    item_names_match_word_bounded,
    resolve_roll_for_character,
    run_character_post_turn_agent,
)
from app.engine.llm_client import llm_client
from app.engine.telemetry import telemetry_phase_scope
from app.engine.mentions import (
    DecomposedUserMessage,
    MentionTargetScope,
    decompose_user_message,
)
from app.engine.parties import (
    find_member_party,
    resolve_phase5_spatial_and_parties,
)
from app.engine.phase2_context import resolve_character_previous_state
from app.engine.spatial_geometry import (
    CandidateKnownLocation,
    extract_travel_cues,
    format_candidate_known_locations_block,
    normalize_location_name_key,
    select_candidate_known_locations,
)
from app.engine.world_clock import (
    advance_world_timestamp,
    describe_world_timestamp,
    extract_world_date_label,
    resolve_bounded_turn_elapsed_minutes,
    resolve_turn_timestamp,
)
from app.prompts import (
    get_default_prompt,
    render_template,
)
from app.schemas.affective import (
    MAX_TURN_ELAPSED_MINUTES_SANITY,
    AffectiveCareState,
    VisibilityScope,
)
from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    MemoryShard,
    normalize_item_key,
)
from app.schemas.party import USER_PARTY_MEMBER_ID
from app.schemas.persona import (
    PersonaItemInstance,
    PersonaRecord,
    PersonaTurnStateSnapshot,
)
from app.schemas.physical import (
    PhysicalStateResetReason,
    format_physical_state_prompt_value,
    is_physical_state_established,
    normalize_physical_stance,
    resolve_post_turn_physical_state,
    sanitize_physical_context,
)
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    EpisodicChunkLLMOutput,
    EpisodicChunkRecord,
    ImprovisedLinkSpec,
    MajorEventRecord,
    PersonaGossipEvent,
    Phase4ProgressCallback,
    Phase4ProgressEvent,
    Phase4RosterEntry,
    Phase5ProgressCallback,
    PostTurnStateDelta,
    PropClaim,
    TurnNodeRecord,
    WorldPostTurnDelta,
    WorldStateSnapshot,
)
from app.schemas.world import (
    DEFAULT_EDGE_SPEED_MODIFIER,
    MAX_EDGE_DISTANCE_METERS,
    WALKING_METERS_PER_MINUTE,
    LocationNode,
    LocationProp,
    LoreNode,
    NeighborLocationView,
    derive_travel_minutes,
    format_distance_meters,
    format_exit_travel_phrase,
    normalize_and_validate_entity_tags,
    normalize_compass_direction,
    normalize_edge_distance_mode,
    normalize_edge_is_vertical,
    normalize_edge_speed_modifier,
)

from app.engine.clerk.episodic import (
    compute_episodic_chunk_salience,
    compute_episodic_chunk_witnesses,
    summarize_turn_chunk_structured,
)
from app.engine.clerk.gossip import (
    apply_turn_persona_state_and_gossip,
    merge_scene_flags,
    verify_prose_gossip_exchanges,
)
from app.engine.clerk.heuristics import heuristic_world_post_turn_delta
from app.engine.clerk.memories import (
    _extract_heuristic_character_memories,
    apply_extracted_character_memories,
    compact_character_memories,
)

def should_fast_path_passive_bystander(
    character: CharacterRecord,
    *,
    completed_turn: TurnNodeRecord,
    decomposed_message: DecomposedUserMessage,
    has_mechanics_roll: bool,
    player_moved_location: bool,
) -> bool:
    """Return True when a co-present bystander was completely unengaged and needs only deterministic CARE math."""
    if completed_turn.actor_id in ("__narrator__", "__solo__"):
        return True
    if character.id == completed_turn.actor_id:
        return False
    if completed_turn.pre_turn.party_action is not None:
        pa = completed_turn.pre_turn.party_action
        if character.id in (pa.target_character_ids or []):
            return False
        char_party = find_member_party(
            completed_turn.world_snapshot.parties or [], character.id
        )
        if char_party is not None and USER_PARTY_MEMBER_ID in char_party.member_ids:
            return False
    if character.id in decomposed_message.whispers_by_character_id:
        return False
    if has_mechanics_roll or player_moved_location:
        return False
    char_cog = (completed_turn.cognitions or {}).get(character.id)
    if char_cog is not None and not char_cog.skipped:
        return False

    combined_low = f"{decomposed_message.public_text}\n{completed_turn.raw_prose}".lower()
    full_name_low = character.name.strip().lower()
    if full_name_low and full_name_low in combined_low:
        return False
    first_tok = full_name_low.split()[0] if full_name_low.split() else ""
    if len(first_tok) >= 3 and re.search(rf"\b{re.escape(first_tok)}\b", combined_low):
        return False
    if character.id.lower() in combined_low:
        return False
    return True


def _resolve_character_agent_fn():
    import sys

    for mod_name in ("app.engine.phase5_clerk", "app.engine.phase4_clerk"):
        mod = sys.modules.get(mod_name)
        fn = getattr(mod, "run_character_post_turn_agent", None) if mod else None
        if fn is not None and fn is not run_character_post_turn_agent:
            return fn
    return run_character_post_turn_agent


async def run_phase5_post_turn_clerk(
    *,
    repo: CantinaRepository,
    campaign_id: str,
    world_id: str,
    character: CharacterRecord,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    present_characters: list[CharacterRecord] | None = None,
    all_participants: list[CharacterRecord] | None = None,
    profile: ModelProfile | None = None,
    dispatch_mode: AgentDispatchMode | None = None,
    working_memory_turns: int | None = None,
    ephemeral_lifespan_turns: int | None = None,
    max_scene_flags: int | None = None,
    post_turn_prompt_template: str | None = None,
    character_post_turn_prompt_template: str | None = None,
    arbitration_prompt_template: str | None = None,
    summary_prompt_template: str | None = None,
    persona_snapshot: PersonaRecord | None = None,
    current_player_state: PersonaTurnStateSnapshot | None = None,
    newly_discovered_edge_ids: set[str] | None = None,
    on_progress: Phase5ProgressCallback | Phase4ProgressCallback | None = None,
) -> tuple[TurnNodeRecord, list[EpisodicChunkRecord]]:
    """Phase 5: Async Post-Turn Global World Clerk + Character State Agents & Arbitration."""
    clerk_prof = profile or settings.clerk_profile
    eff_dispatch: AgentDispatchMode = dispatch_mode or settings.agent_dispatch_mode
    is_narrator_turn = completed_turn.actor_id == "__narrator__"
    is_solo_turn = completed_turn.actor_id == "__solo__"

    scene_characters = (
        [c for c in present_characters if c.id not in ("__narrator__", "__solo__")]
        if present_characters is not None
        else (
            [character]
            if (not is_narrator_turn and not is_solo_turn and character.id not in ("__narrator__", "__solo__"))
            else []
        )
    )
    if (
        not is_narrator_turn
        and not is_solo_turn
        and (present_characters is None or len(present_characters) > 0)
        and character.id not in ("__narrator__", "__solo__")
        and all(c.id != character.id for c in scene_characters)
    ):
        scene_characters = [character, *scene_characters]

    known_participants = list(all_participants or scene_characters)
    for ch in scene_characters:
        if all(p.id != ch.id for p in known_participants):
            known_participants.append(ch)

    # Announce Phase 4 Roster upfront
    roster = [Phase4RosterEntry(agent_key="clerk", kind="world_clerk", label="clerk")]
    if not is_narrator_turn and not is_solo_turn:
        for ch in scene_characters:
            roster.append(Phase4RosterEntry(agent_key=ch.id, kind="character", label=ch.name))

    if on_progress:
        await on_progress(
            Phase4ProgressEvent(
                event="phase4_start",
                turn_id=completed_turn.id,
                dispatch_mode=eff_dispatch,
                roster=roster,
            )
        )

    branch_turns = repo.get_branch_turn_chain(completed_turn.id)
    valid_turn_ids = {t.id for t in branch_turns}
    prior_branch_turns = branch_turns[:-1] if branch_turns and branch_turns[-1].id == completed_turn.id else branch_turns
    prior_elapsed = (
        prior_branch_turns[-1].world_snapshot.campaign_elapsed_minutes
        if prior_branch_turns
        else 0
    )

    eff_persona_name: str | None = (
        persona_snapshot.name.strip()
        if (persona_snapshot is not None and persona_snapshot.name and persona_snapshot.name.strip())
        else None
    )
    if eff_persona_name is None:
        try:
            camp_rec = repo.get_campaign(campaign_id)
            if camp_rec.persona_snapshot and camp_rec.persona_snapshot.name:
                eff_persona_name = camp_rec.persona_snapshot.name.strip()
        except Exception:
            eff_persona_name = None

    decomposed_msg = decompose_user_message(
        completed_turn.user_message,
        campaign_characters=known_participants,
        present_character_ids={c.id for c in scene_characters},
    )
    player_moved_intent = completed_turn.pre_turn.spatial_intent != "stay"

    # Resolve strict pre-turn baselines for every present character to prevent double-applying speaker cognition
    prev_states_by_char: dict[str, CharacterStateSnapshot] = {
        ch.id: resolve_character_previous_state(prior_branch_turns, ch, active_location.id)
        for ch in scene_characters
    }

    raw_shards_by_char: dict[str, list[MemoryShard]] = {}
    active_shards_by_char: dict[str, list[MemoryShard]] = {}
    for ch in scene_characters:
        raw_shards = repo.get_raw_campaign_character_memories(campaign_id, ch.id)
        raw_shards_by_char[ch.id] = raw_shards
        active_shards_by_char[ch.id] = [
            s for s in raw_shards if repo._is_shard_active_on_branch(s, valid_turn_ids)
        ]

    def _format_clerk_neighbor_line(n: NeighborLocationView) -> str:
        meta = [
            format_distance_meters(n.distance_meters),
            format_exit_travel_phrase(n.distance_meters, n.speed_modifier, n.travel_mode),
        ]
        if n.obstacles:
            meta.append(f"obstacles: {', '.join(n.obstacles)}")
        if n.is_blocked:
            meta.append("BLOCKED")
        return (
            f"- [{n.compass_direction or 'N'}] id='{n.destination.id}': {n.destination.name} "
            f"(via {n.direction_label}; {'; '.join(meta)})"
        )

    neighbor_options = "\n".join(_format_clerk_neighbor_line(n) for n in neighbors) or "None"
    existing_flags_str = (
        ", ".join(completed_turn.world_snapshot.scene_flags)
        if completed_turn.world_snapshot.scene_flags
        else "None"
    )

    current_timestamp = completed_turn.world_snapshot.world_timestamp
    current_time_str = describe_world_timestamp(current_timestamp)
    speaker_label = "Narrator" if (is_narrator_turn or is_solo_turn) else character.name

    # Gather prior revealed secrets & candidate unrevealed secrets (active location + immediate L1 container)
    prior_revealed_ids = list(
        dict.fromkeys(
            [
                *(
                    prior_branch_turns[-1].world_snapshot.revealed_lore_ids
                    if prior_branch_turns
                    else []
                ),
                *(completed_turn.world_snapshot.revealed_lore_ids or []),
            ]
        )
    )
    prior_revealed_set = set(prior_revealed_ids)
    candidate_secrets: list[LoreNode] = []
    for ln in active_location.lore_nodes or []:
        if ln.category == "secret":
            canon_id = ln.origin_lore_id or ln.id
            if canon_id not in prior_revealed_set and ln.id not in prior_revealed_set:
                candidate_secrets.append(ln)
    world_for_secrets = None
    gm_unlocked_spatial = False
    candidate_known_locations: list[CandidateKnownLocation] = []
    prior_revealed_edge_ids_spatial = {
        *(
            prior_branch_turns[-1].world_snapshot.revealed_edge_ids
            if prior_branch_turns
            else []
        ),
        *(completed_turn.world_snapshot.revealed_edge_ids or []),
        *(newly_discovered_edge_ids or ()),
    }
    try:
        camp_for_spatial = repo.get_campaign(campaign_id)
        gm_unlocked_spatial = bool(camp_for_spatial.world_settings.unlock_lore)
    except Exception:
        gm_unlocked_spatial = False
    try:
        world_for_secrets = repo.get_world(
            world_id, valid_turn_ids=valid_turn_ids, campaign_id=campaign_id
        )
        candidate_known_locations = select_candidate_known_locations(
            world_for_secrets,
            active_location.id,
            neighbors,
            visited_location_ids=list(completed_turn.world_snapshot.visited_location_ids or []),
            revealed_edge_ids=prior_revealed_edge_ids_spatial,
            gm_unlocked=gm_unlocked_spatial,
            user_message=completed_turn.user_message,
        )
        if active_location.container_id:
            imm_cont = next(
                (
                    c
                    for c in world_for_secrets.containers
                    if c.id == active_location.container_id and c.depth == 1
                ),
                None,
            )
            if imm_cont is not None:
                for ln in imm_cont.lore_nodes or []:
                    if ln.category == "secret":
                        canon_id = ln.origin_lore_id or ln.id
                        if canon_id not in prior_revealed_set and ln.id not in prior_revealed_set:
                            candidate_secrets.append(ln)
    except Exception:
        pass

    candidate_secret_map: dict[str, LoreNode] = {ln.id: ln for ln in candidate_secrets}
    for ln in candidate_secrets:
        if ln.origin_lore_id:
            candidate_secret_map.setdefault(ln.origin_lore_id, ln)

    candidate_secrets_block = ""
    if candidate_secrets:
        secret_lines = "\n".join(
            f"- id='{ln.id}': {ln.title} — {ln.content[:220]} (tags: {', '.join(ln.entity_tags[:5])})"
            for ln in candidate_secrets
        )
        candidate_secrets_block = f"\nCandidate Unrevealed Secrets at Current Location:\n{secret_lines}\n"

    visible_room_props: list[LocationProp] = resolve_effective_location_props(
        active_location,
        completed_turn.world_snapshot,
        include_hidden=False,
    )
    visible_prop_by_id: dict[str, LocationProp] = {p.id: p for p in visible_room_props}
    visible_props_block = ""
    if visible_room_props:
        prop_lines = "\n".join(
            f"- id='{p.id}': {p.name}" + (f" — {p.note[:160]}" if p.note else "")
            for p in visible_room_props
        )
        holder_options = [f"'player' ({eff_persona_name or 'Player'})"] + [
            f"'{c.id}' ({c.name})" for c in scene_characters
        ]
        visible_props_block = (
            f"\nVisible Portable Props at Current Location:\n{prop_lines}\n"
            f"Valid Prop Holder IDs: {', '.join(holder_options)}\n"
            "Emit claimed_props ONLY if the narrative prose clearly depicts the player or a co-present NPC picking up, pocketing, or taking one of these props.\n"
        )

    active_loc_env_str = (
        ", ".join(active_location.environmental_tags)
        if active_location.environmental_tags
        else "None"
    )
    involved_roster_parts = [
        *([f"Player Persona: {eff_persona_name}"] if eff_persona_name else ["Player"]),
        *[c.name for c in scene_characters],
    ]
    involved_roster_str = ", ".join(dict.fromkeys(involved_roster_parts))

    prev_player_stance = normalize_physical_stance(
        current_player_state.physical_stance if current_player_state is not None else "unspecified"
    )
    prev_player_context = sanitize_physical_context(
        current_player_state.physical_context if current_player_state is not None else ""
    )
    player_start_phys_str = (
        format_physical_state_prompt_value(prev_player_stance, prev_player_context)
        or "unspecified"
    )

    world_system_prompt = render_template(
        post_turn_prompt_template or get_default_prompt("clerk_post_turn_system"),
        character_name=character.name,
    )
    other_known_block = (
        f"Other Known Locations (not directly linked yet):\n"
        f"{format_candidate_known_locations_block(candidate_known_locations, include_ids=True)}\n"
        if candidate_known_locations
        else ""
    )
    world_user_prompt = (
        f"Current In-Game Time (start of this turn): {current_time_str}\n"
        f"Current Location: {active_location.name} (id='{active_location.id}')\n"
        f"Current Location Description: {active_location.description}\n"
        f"Current Location Environmental Tags: {active_loc_env_str}\n"
        f"Present Characters/Persona: {involved_roster_str}\n"
        f"Player Starting Physical State: {player_start_phys_str}\n"
        f"Current Scene Flags: {existing_flags_str}\n"
        f"Known Exits:\n{neighbor_options}\n"
        f"{other_known_block}"
        f"{candidate_secrets_block}"
        f"{visible_props_block}\n"
        f"User Message: {completed_turn.user_message}\n"
        f"{speaker_label} Response:\n{completed_turn.raw_prose}"
    )

    async def _compute_world_delta() -> WorldPostTurnDelta:
        if on_progress:
            await on_progress(
                Phase4ProgressEvent(
                    event="phase4_agent_start",
                    turn_id=completed_turn.id,
                    agent_key="clerk",
                    kind="world_clerk",
                    label="clerk",
                )
            )
        try:
            with telemetry_phase_scope("phase5_clerk", "World Clerk"):
                w_delta = await llm_client.complete_structured(
                    [
                        {"role": "system", "content": world_system_prompt},
                        {"role": "user", "content": world_user_prompt},
                    ],
                    WorldPostTurnDelta,
                    profile=clerk_prof,
                )
        except Exception as exc:
            if not settings.allow_offline_fallback:
                if on_progress:
                    await on_progress(
                        Phase4ProgressEvent(
                            event="phase4_agent_error",
                            turn_id=completed_turn.id,
                            agent_key="clerk",
                            kind="world_clerk",
                            label="clerk",
                            error=str(exc),
                        )
                    )
                raise
            w_delta = heuristic_world_post_turn_delta(
                user_message=completed_turn.user_message,
                raw_prose=completed_turn.raw_prose,
                pre_turn=completed_turn.pre_turn,
                active_location=active_location,
                neighbors=neighbors,
                current_timestamp=current_timestamp,
                candidate_secrets=candidate_secrets,
                prev_player_stance=prev_player_stance,
                prev_player_context=prev_player_context,
                visible_location_props=visible_room_props,
                present_characters=scene_characters,
                other_known_locations=candidate_known_locations,
            )
        if on_progress:
            await on_progress(
                Phase4ProgressEvent(
                    event="phase4_agent_complete",
                    turn_id=completed_turn.id,
                    agent_key="clerk",
                    kind="world_clerk",
                    label="clerk",
                    world_delta=w_delta,
                )
            )
        return w_delta

    async def _run_single_char_agent(ch: CharacterRecord) -> tuple[str, CharacterAgentDelta]:
        if on_progress:
            await on_progress(
                Phase4ProgressEvent(
                    event="phase4_agent_start",
                    turn_id=completed_turn.id,
                    agent_key=ch.id,
                    kind="character",
                    label=ch.name,
                )
            )
        try:
            has_char_roll = resolve_roll_for_character(completed_turn.pre_turn, ch.id) is not None
            if should_fast_path_passive_bystander(
                ch,
                completed_turn=completed_turn,
                decomposed_message=decomposed_msg,
                has_mechanics_roll=has_char_roll,
                player_moved_location=player_moved_intent,
            ):
                c_delta = CharacterAgentDelta(
                    mood_label=prev_states_by_char[ch.id].mood_label,
                    location_transition="stay_here",
                )
            else:
                c_delta = await _resolve_character_agent_fn()(
                    character=ch,
                    prev_state=prev_states_by_char[ch.id],
                    completed_turn=completed_turn,
                    active_location=active_location,
                    neighbors=neighbors,
                    present_characters=scene_characters,
                    all_participants=known_participants,
                    active_shards=active_shards_by_char.get(ch.id, []),
                    profile=clerk_prof,
                    prompt_template=character_post_turn_prompt_template,
                    extracted_memories_fn=_extract_heuristic_character_memories,
                    persona_name=eff_persona_name,
                    decomposed_message=decomposed_msg,
                    campaign_elapsed_minutes=prior_elapsed,
                )
            if on_progress:
                await on_progress(
                    Phase4ProgressEvent(
                        event="phase4_agent_complete",
                        turn_id=completed_turn.id,
                        agent_key=ch.id,
                        kind="character",
                        label=ch.name,
                        character_delta=c_delta,
                    )
                )
            return ch.id, c_delta
        except Exception as exc:
            if on_progress:
                await on_progress(
                    Phase4ProgressEvent(
                        event="phase4_agent_error",
                        turn_id=completed_turn.id,
                        agent_key=ch.id,
                        kind="character",
                        label=ch.name,
                        error=str(exc),
                    )
                )
            raise

    # Check Rolling Episodic Compression threshold upfront
    existing_chunks = repo.get_branch_episodic_chunks(campaign_id, valid_turn_ids)
    max_summarized_depth = max((c.end_turn_depth for c in existing_chunks), default=0)

    unsummarized = [
        t
        for t in branch_turns
        if t.depth_index > max_summarized_depth and t.actor_id != "__arrival__"
    ]
    wm_limit = (
        working_memory_turns
        if working_memory_turns is not None
        else settings.memory_config.working_memory_turns
    )
    needs_chunk_summary = len(unsummarized) > wm_limit
    chunk_slice = (
        unsummarized[: settings.memory_config.episodic_chunk_size]
        if needs_chunk_summary
        else []
    )
    char_name_map = {c.id: c.name for c in known_participants}
    char_name_map[character.id] = character.name

    char_deltas: dict[str, CharacterAgentDelta] = {}
    summary_output: EpisodicChunkLLMOutput | None = None

    if is_narrator_turn:
        # Narrator fast-path: preserve character emotional anchors; update global world state & episodic chunks only
        if needs_chunk_summary:
            summarize_coro = summarize_turn_chunk_structured(
                chunk_slice,
                character,
                profile=clerk_prof,
                prompt_template=summary_prompt_template,
                character_name_map=char_name_map,
            )
            if eff_dispatch == "parallel":
                world_delta, summary_output = await asyncio.gather(_compute_world_delta(), summarize_coro)
            else:
                world_delta = await _compute_world_delta()
                summary_output = await summarize_coro
        else:
            world_delta = await _compute_world_delta()
    elif eff_dispatch == "parallel":
        char_tasks = [_run_single_char_agent(ch) for ch in scene_characters]
        if needs_chunk_summary:
            summarize_coro = summarize_turn_chunk_structured(
                chunk_slice,
                character,
                profile=clerk_prof,
                prompt_template=summary_prompt_template,
                character_name_map=char_name_map,
            )
            gathered = await asyncio.gather(
                _compute_world_delta(),
                summarize_coro,
                *char_tasks,
            )
            world_delta = gathered[0]
            summary_output = gathered[1]
            for cid, c_delta in gathered[2:]:
                char_deltas[cid] = c_delta
        else:
            gathered = await asyncio.gather(
                _compute_world_delta(),
                *char_tasks,
            )
            world_delta = gathered[0]
            for cid, c_delta in gathered[1:]:
                char_deltas[cid] = c_delta
    else:
        # Sequential dispatch: strictly 1 LLM request in-flight at a time for single-GPU local servers.
        # Run World Clerk first, then character agents, then summarization.
        world_delta = await _compute_world_delta()
        for ch in scene_characters:
            cid, c_delta = await _run_single_char_agent(ch)
            char_deltas[cid] = c_delta
        if needs_chunk_summary:
            summary_output = await summarize_turn_chunk_structured(
                chunk_slice,
                character,
                profile=clerk_prof,
                prompt_template=summary_prompt_template,
                character_name_map=char_name_map,
            )

    # 1. Resolve new active location (stay, move_existing, connect_existing, or improvise_new)
    new_location_id = active_location.id
    valid_neighbor_ids = {n.destination.id for n in neighbors}
    neighbor_by_norm_name: dict[str, NeighborLocationView] = {
        normalize_location_name_key(n.destination.name): n
        for n in neighbors
        if normalize_location_name_key(n.destination.name)
    }
    candidate_by_id: dict[str, CandidateKnownLocation] = {
        c.location.id: c for c in candidate_known_locations
    }
    candidate_by_norm_name: dict[str, CandidateKnownLocation] = {
        normalize_location_name_key(c.location.name): c
        for c in candidate_known_locations
        if normalize_location_name_key(c.location.name)
    }
    combined_turn_text = f"{completed_turn.user_message}\n{completed_turn.raw_prose}"
    travel_cues = extract_travel_cues(combined_turn_text)

    # A. Deterministic Duplicate-Name Guard: never spawn duplicate node if name matches known location
    if world_delta.transition_type == "improvise_new" and world_delta.improvised_location is not None:
        norm_imp = normalize_location_name_key(world_delta.improvised_location.name)
        if norm_imp and norm_imp in neighbor_by_norm_name:
            matched_nb = neighbor_by_norm_name[norm_imp]
            world_delta.transition_type = "move_existing"
            world_delta.target_location_id = matched_nb.destination.id
            world_delta.improvised_location = None
        elif norm_imp and norm_imp in candidate_by_norm_name:
            matched_cand = candidate_by_norm_name[norm_imp]
            msg_low_dup = completed_turn.user_message.lower()
            is_retrace_dup = (
                any(
                    kw in msg_low_dup
                    for kw in ("back through", "retrace", "return along", "via the")
                )
                and matched_cand.shortest_path is not None
            )
            if is_retrace_dup:
                world_delta.transition_type = "move_existing"
                world_delta.target_location_id = matched_cand.location.id
                world_delta.improvised_location = None
            else:
                imp_old = world_delta.improvised_location
                world_delta.transition_type = "connect_existing"
                world_delta.target_location_id = matched_cand.location.id
                world_delta.improvised_link = ImprovisedLinkSpec(
                    to_location_id=matched_cand.location.id,
                    entry_direction_label=imp_old.entry_direction_label,
                    return_direction_label=imp_old.return_direction_label,
                    compass_direction=imp_old.compass_direction,
                    distance_meters=imp_old.distance_meters,
                    speed_modifier=travel_cues.speed_modifier or DEFAULT_EDGE_SPEED_MODIFIER,
                    distance_mode=imp_old.distance_mode,
                    is_vertical=imp_old.is_vertical,
                )
                world_delta.improvised_location = None

    moved_neighbor: NeighborLocationView | None = None
    traversed_location_ids: list[str] = []
    min_travel_minutes = 0

    if world_delta.transition_type == "move_existing":
        if world_delta.target_location_id in valid_neighbor_ids:
            new_location_id = world_delta.target_location_id  # type: ignore[assignment]
            moved_neighbor = next(
                (n for n in neighbors if n.destination.id == new_location_id),
                None,
            )
            if moved_neighbor is not None:
                eff_speed = normalize_edge_speed_modifier(moved_neighbor.speed_modifier)
                raw_travel_minutes = moved_neighbor.distance_meters / (
                    WALKING_METERS_PER_MINUTE * eff_speed
                )
                if raw_travel_minutes >= 0.5:
                    min_travel_minutes = min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        derive_travel_minutes(moved_neighbor.distance_meters, eff_speed),
                    )
        elif (
            world_delta.target_location_id in candidate_by_id
            and candidate_by_id[world_delta.target_location_id].shortest_path is not None
        ):
            cand = candidate_by_id[world_delta.target_location_id]
            assert cand.shortest_path is not None
            new_location_id = cand.location.id
            traversed_location_ids = list(cand.shortest_path.path_node_ids)
            min_travel_minutes = min(
                MAX_TURN_ELAPSED_MINUTES_SANITY,
                cand.shortest_path.total_travel_minutes,
            )
    elif world_delta.transition_type == "connect_existing":
        target_conn_id = world_delta.target_location_id or (
            world_delta.improvised_link.to_location_id if world_delta.improvised_link else None
        )
        if target_conn_id in valid_neighbor_ids:
            world_delta.transition_type = "move_existing"
            world_delta.target_location_id = target_conn_id
            world_delta.improvised_link = None
            new_location_id = target_conn_id  # type: ignore[assignment]
            moved_neighbor = next(
                (n for n in neighbors if n.destination.id == new_location_id),
                None,
            )
            if moved_neighbor is not None:
                eff_speed = normalize_edge_speed_modifier(moved_neighbor.speed_modifier)
                if moved_neighbor.distance_meters / (WALKING_METERS_PER_MINUTE * eff_speed) >= 0.5:
                    min_travel_minutes = min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        derive_travel_minutes(moved_neighbor.distance_meters, eff_speed),
                    )
        elif target_conn_id in candidate_by_id:
            cand = candidate_by_id[target_conn_id]
            if cand.has_hidden_secret_direct_edge and not gm_unlocked_spatial:
                # Never duplicate/leak an unrevealed secret direct route
                if cand.shortest_path is not None:
                    world_delta.transition_type = "move_existing"
                    world_delta.target_location_id = cand.location.id
                    world_delta.improvised_link = None
                    new_location_id = cand.location.id
                    traversed_location_ids = list(cand.shortest_path.path_node_ids)
                    min_travel_minutes = min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        cand.shortest_path.total_travel_minutes,
                    )
                else:
                    world_delta.transition_type = "stay"
                    world_delta.target_location_id = None
                    world_delta.improvised_link = None
            else:
                had_explicit_link = world_delta.improvised_link is not None
                link_spec = (
                    world_delta.improvised_link.model_copy()
                    if world_delta.improvised_link is not None
                    else ImprovisedLinkSpec(
                        to_location_id=cand.location.id,
                        entry_direction_label=f"Route to {cand.location.name}",
                        return_direction_label=f"Back to {active_location.name}",
                    )
                )
                link_spec.to_location_id = cand.location.id
                if travel_cues.is_non_euclidean:
                    link_spec.distance_mode = "non_euclidean"
                elif link_spec.distance_mode == "flexible" and travel_cues.is_vertical:
                    link_spec.is_vertical = True
                if (
                    abs(link_spec.speed_modifier - DEFAULT_EDGE_SPEED_MODIFIER) < 1e-6
                    and travel_cues.speed_modifier is not None
                ):
                    link_spec.speed_modifier = travel_cues.speed_modifier
                eff_speed = normalize_edge_speed_modifier(link_spec.speed_modifier)

                # Align raw meters when LLM omitted ImprovisedLinkSpec
                if not had_explicit_link:
                    if travel_cues.distance_meters is not None:
                        link_spec.distance_meters = travel_cues.distance_meters
                    elif travel_cues.duration_minutes is not None:
                        link_spec.distance_meters = max(
                            1,
                            min(
                                MAX_EDGE_DISTANCE_METERS,
                                int(
                                    round(
                                        travel_cues.duration_minutes
                                        * WALKING_METERS_PER_MINUTE
                                        * eff_speed
                                    )
                                ),
                            ),
                        )

                # Apply 2D Geometry Clamping unless portal/vertical or disconnected component
                if (
                    normalize_edge_distance_mode(link_spec.distance_mode) != "non_euclidean"
                    and not normalize_edge_is_vertical(link_spec.is_vertical)
                    and cand.geometric_offset is not None
                ):
                    raw_requested_m = link_spec.distance_meters
                    if (
                        raw_requested_m == 100
                        and travel_cues.duration_minutes is not None
                        and abs(
                            round(travel_cues.duration_minutes * WALKING_METERS_PER_MINUTE * eff_speed)
                            - 100
                        )
                        > 25
                    ):
                        raw_requested_m = max(
                            1,
                            min(
                                MAX_EDGE_DISTANCE_METERS,
                                int(
                                    round(
                                        travel_cues.duration_minutes
                                        * WALKING_METERS_PER_MINUTE
                                        * eff_speed
                                    )
                                ),
                            ),
                        )
                    geo_m = cand.geometric_offset.distance_meters
                    if abs(raw_requested_m - geo_m) >= 25 or (
                        geo_m > 0 and abs(raw_requested_m - geo_m) / geo_m > 0.10
                    ):
                        link_spec.clamped_from_meters = raw_requested_m
                    link_spec.distance_meters = geo_m
                    link_spec.compass_direction = normalize_compass_direction(
                        cand.geometric_offset.bearing
                    )
                else:
                    if travel_cues.distance_meters is not None and abs(
                        link_spec.distance_meters - travel_cues.distance_meters
                    ) > max(10, 0.25 * travel_cues.distance_meters):
                        link_spec.distance_meters = travel_cues.distance_meters
                    elif (
                        travel_cues.duration_minutes is not None
                        and link_spec.distance_mode != "non_euclidean"
                        and not link_spec.is_vertical
                    ):
                        exp_m = max(
                            1,
                            min(
                                MAX_EDGE_DISTANCE_METERS,
                                int(
                                    round(
                                        travel_cues.duration_minutes
                                        * WALKING_METERS_PER_MINUTE
                                        * eff_speed
                                    )
                                ),
                            ),
                        )
                        if (
                            link_spec.distance_meters in (20, 50, 100)
                            or link_spec.distance_meters < exp_m * 0.5
                            or link_spec.distance_meters > exp_m * 2.0
                        ):
                            link_spec.distance_meters = exp_m

                created_edge, _created = repo.add_improvised_link(
                    world_id=world_id,
                    from_location_id=active_location.id,
                    to_location_id=cand.location.id,
                    created_at_turn_id=completed_turn.id,
                    spec=link_spec,
                    valid_turn_ids=valid_turn_ids,
                )
                link_spec.distance_meters = created_edge.distance_meters
                if created_edge.compass_direction is not None:
                    link_spec.compass_direction = created_edge.compass_direction
                world_delta.target_location_id = cand.location.id
                world_delta.improvised_link = link_spec
                new_location_id = cand.location.id
                min_travel_minutes = min(
                    MAX_TURN_ELAPSED_MINUTES_SANITY,
                    derive_travel_minutes(link_spec.distance_meters, eff_speed),
                )
    elif world_delta.transition_type == "improvise_new" and world_delta.improvised_location is not None:
        imp_spec = world_delta.improvised_location.model_copy()
        if travel_cues.is_non_euclidean and imp_spec.distance_mode == "flexible":
            imp_spec.distance_mode = "non_euclidean"
        if travel_cues.is_vertical and not imp_spec.is_vertical:
            imp_spec.is_vertical = True
        eff_speed = normalize_edge_speed_modifier(travel_cues.speed_modifier or DEFAULT_EDGE_SPEED_MODIFIER)
        if travel_cues.distance_meters is not None:
            if abs(imp_spec.distance_meters - travel_cues.distance_meters) > max(
                10, 0.25 * travel_cues.distance_meters
            ):
                imp_spec.distance_meters = travel_cues.distance_meters
        elif (
            travel_cues.duration_minutes is not None
            and imp_spec.distance_mode != "non_euclidean"
            and not imp_spec.is_vertical
        ):
            expected_m = max(
                1,
                min(
                    MAX_EDGE_DISTANCE_METERS,
                    int(
                        round(
                            travel_cues.duration_minutes
                            * WALKING_METERS_PER_MINUTE
                            * eff_speed
                        )
                    ),
                ),
            )
            if (
                imp_spec.distance_meters in (20, 50, 100)
                or imp_spec.distance_meters < expected_m * 0.5
                or imp_spec.distance_meters > expected_m * 2.0
            ):
                imp_spec.distance_meters = expected_m

        world_delta.improvised_location = imp_spec
        created_loc = repo.add_improvised_location(
            world_id=world_id,
            from_location_id=active_location.id,
            created_at_turn_id=completed_turn.id,
            spec=imp_spec,
            valid_turn_ids=valid_turn_ids,
        )
        new_location_id = created_loc.id
        world_delta.target_location_id = created_loc.id
        raw_imp_min = imp_spec.distance_meters / (WALKING_METERS_PER_MINUTE * eff_speed)
        if raw_imp_min >= 0.5:
            min_travel_minutes = min(
                MAX_TURN_ELAPSED_MINUTES_SANITY,
                derive_travel_minutes(imp_spec.distance_meters, eff_speed),
            )

    # 2. Advance World Clock & Merge Scene Flags (anchoring movement to link speed/distance floor)
    requested_elapsed_minutes = max(int(world_delta.elapsed_minutes), min_travel_minutes)
    new_timestamp = resolve_turn_timestamp(
        current_timestamp,
        requested_elapsed_minutes,
        world_delta.new_world_timestamp,
    )
    is_static_describe = (
        is_narrator_turn
        and completed_turn.user_message.strip().lower().startswith("[describe")
        and not world_delta.new_world_timestamp
    )
    turn_elapsed = (
        0
        if is_static_describe
        else resolve_bounded_turn_elapsed_minutes(
            prev_timestamp=current_timestamp,
            new_timestamp=new_timestamp,
            clerk_elapsed_minutes=requested_elapsed_minutes,
            raw_turn_text=f"{completed_turn.user_message}\n{completed_turn.raw_prose}",
        )
    )
    if not is_static_describe and turn_elapsed < min_travel_minutes:
        turn_elapsed = min_travel_minutes
        new_timestamp = advance_world_timestamp(current_timestamp, turn_elapsed)
    new_campaign_elapsed = prior_elapsed + turn_elapsed

    location_changed = new_location_id != active_location.id
    if location_changed:
        try:
            new_loc_name = repo.get_location(new_location_id).name
        except Exception:
            new_loc_name = ""
        merged_flags = [f"At {new_loc_name}"] if new_loc_name else []
    else:
        eff_max_flags = (
            max_scene_flags
            if max_scene_flags is not None
            else getattr(settings.memory_config, "max_scene_flags", 10)
        )
        merged_flags = merge_scene_flags(
            completed_turn.world_snapshot.scene_flags,
            world_delta.scene_flags_updated,
            world_delta.scene_flags_removed,
            max_flags=eff_max_flags,
        )
    prev_visited = list(completed_turn.world_snapshot.visited_location_ids or [])
    prev_visited_containers = list(
        completed_turn.world_snapshot.visited_container_ids or []
    )
    first_visit_cards = []
    first_visit_media = []
    merged_visited_containers = list(prev_visited_containers)
    try:
        camp_rec = repo.get_campaign(campaign_id)
        world_rec = repo.get_world(
            world_id, valid_turn_ids=valid_turn_ids, campaign_id=campaign_id
        )
        target_loc_obj = next(
            (loc for loc in world_rec.locations if loc.id == new_location_id),
            None,
        )
        if target_loc_obj is None:
            target_loc_obj = repo.get_location(new_location_id)
        first_visit_cards, first_visit_media, merged_visited, merged_visited_containers = (
            build_first_visit_arrival_bundle(
                target_location=target_loc_obj,
                containers=world_rec.containers,
                locations=world_rec.locations,
                prev_visited_locations=prev_visited,
                prev_visited_containers=prev_visited_containers,
                describe_on_first_visit=camp_rec.world_settings.describe_on_first_visit,
                emit_media=camp_rec.world_settings.describe_on_first_visit,
                extra_visited_location_ids=list(
                    dict.fromkeys(
                        [
                            *(
                                [completed_turn.world_snapshot.active_location_id]
                                if completed_turn.world_snapshot.active_location_id
                                else []
                            ),
                            *traversed_location_ids,
                        ]
                    )
                ),
            )
        )
    except Exception:
        merged_visited = list(
            dict.fromkeys(
                [
                    *prev_visited,
                    *(
                        [completed_turn.world_snapshot.active_location_id]
                        if completed_turn.world_snapshot.active_location_id
                        else []
                    ),
                    *([new_location_id] if new_location_id else []),
                ]
            )
        )

    # 2.5 Reconcile prose-grounded secret reveals (canonical IDs, branch-safe)
    newly_revealed_ids: list[str] = []
    for raw_sid in world_delta.revealed_secret_lore_ids or []:
        matched = candidate_secret_map.get(str(raw_sid).strip())
        if matched is not None:
            canon_id = matched.origin_lore_id or matched.id
            if canon_id not in prior_revealed_set and canon_id not in newly_revealed_ids:
                newly_revealed_ids.append(canon_id)
    merged_revealed_lore_ids = list(dict.fromkeys([*prior_revealed_ids, *newly_revealed_ids]))

    # Reconcile discovered secret links pairwise onto snapshot
    prior_revealed_edge_ids = [
        *(
            prior_branch_turns[-1].world_snapshot.revealed_edge_ids
            if prior_branch_turns
            else []
        ),
        *(completed_turn.world_snapshot.revealed_edge_ids or []),
    ]
    discovered_edge_pair_ids: list[str] = []
    if newly_discovered_edge_ids:
        discovered_dest_ids = {
            n.destination.id for n in neighbors if n.edge_id in newly_discovered_edge_ids
        }
        discovered_edge_pair_ids.extend(sorted(newly_discovered_edge_ids))
        try:
            world_edges_ref = (
                world_rec.edges
                if "world_rec" in locals() and world_rec is not None
                else (
                    world_for_secrets.edges
                    if "world_for_secrets" in locals() and world_for_secrets is not None
                    else repo.get_world(world_id, valid_turn_ids=valid_turn_ids, campaign_id=campaign_id).edges
                )
            )
            for edge in world_edges_ref:
                if edge.id in newly_discovered_edge_ids:
                    discovered_edge_pair_ids.append(edge.id)
                elif (
                    edge.from_location_id in discovered_dest_ids
                    and edge.to_location_id == active_location.id
                    and edge.is_secret
                ):
                    discovered_edge_pair_ids.append(edge.id)
        except Exception:
            pass
    merged_revealed_edge_ids = list(
        dict.fromkeys([*prior_revealed_edge_ids, *discovered_edge_pair_ids])
    )

    # 2.6 Validate & arbitrate room prop claims (visible/unclaimed only, single-owner)
    valid_holder_ids = {"player"} | {c.id for c in scene_characters}
    validated_claimed_props: list[PropClaim] = []
    seen_claimed_prop_ids: set[str] = set()
    if not is_narrator_turn and visible_prop_by_id:
        for raw_claim in world_delta.claimed_props or []:
            pid = (raw_claim.prop_id or "").strip()
            hid = (raw_claim.holder_id or "").strip()
            if pid in visible_prop_by_id and hid in valid_holder_ids and pid not in seen_claimed_prop_ids:
                seen_claimed_prop_ids.add(pid)
                validated_claimed_props.append(PropClaim(prop_id=pid, holder_id=hid))

    claimed_props_by_holder: dict[str, list[LocationProp]] = {}
    for claim in validated_claimed_props:
        prop_obj = visible_prop_by_id[claim.prop_id]
        claimed_props_by_holder.setdefault(claim.holder_id, []).append(prop_obj)

    if claimed_props_by_holder and char_deltas:
        all_claimed_names = [
            visible_prop_by_id[c.prop_id].name for c in validated_claimed_props
        ]
        for cid, c_delta in list(char_deltas.items()):
            filtered_obtained = [
                it
                for it in (c_delta.items_obtained or [])
                if not any(item_names_match_word_bounded(it, cname) for cname in all_claimed_names)
            ]
            filtered_equipped = [
                it
                for it in (c_delta.items_equipped or [])
                if not any(item_names_match_word_bounded(it, cname) for cname in all_claimed_names)
            ]
            if (
                len(filtered_obtained) != len(c_delta.items_obtained or [])
                or len(filtered_equipped) != len(c_delta.items_equipped or [])
            ):
                char_deltas[cid] = c_delta.model_copy(
                    update={
                        "items_obtained": filtered_obtained,
                        "items_equipped": filtered_equipped,
                    }
                )

    merged_claimed_prop_ids = list(
        dict.fromkeys(
            [
                *(completed_turn.world_snapshot.claimed_prop_ids or []),
                *(c.prop_id for c in validated_claimed_props),
            ]
        )
    )

    updated_world_snapshot = WorldStateSnapshot(
        turn_id=completed_turn.id,
        world_timestamp=new_timestamp,
        campaign_elapsed_minutes=new_campaign_elapsed,
        active_location_id=new_location_id,
        scene_flags=merged_flags,
        visited_location_ids=merged_visited,
        visited_container_ids=merged_visited_containers,
        revealed_lore_ids=merged_revealed_lore_ids,
        revealed_edge_ids=merged_revealed_edge_ids,
        revealed_prop_ids=list(completed_turn.world_snapshot.revealed_prop_ids or []),
        claimed_prop_ids=merged_claimed_prop_ids,
        spawned_props=list(completed_turn.world_snapshot.spawned_props or []),
        location_search_last_turn_depth=dict(
            completed_turn.world_snapshot.location_search_last_turn_depth or {}
        ),
        auto_spawned_prop_location_ids=list(
            completed_turn.world_snapshot.auto_spawned_prop_location_ids or []
        ),
        parties=list(completed_turn.world_snapshot.parties or []),
    )

    # 3. Permanent Custody Protection + Two-Tier Inventory Contention Detection & Clerk Arbitration
    arbitration_notes: list[str] = []
    arbitration_rulings: list[ArbitrationRulingRecord] = []
    if not is_narrator_turn and char_deltas:
        perm_notes = enforce_permanent_item_locks(
            scene_characters=scene_characters,
            prev_states_by_char=prev_states_by_char,
            character_deltas=char_deltas,
        )
        arbitration_notes.extend(perm_notes)

        disputes = detect_inventory_disputes(
            scene_characters=scene_characters,
            prev_states_by_char=prev_states_by_char,
            character_deltas=char_deltas,
        )
        if disputes:
            contested_keys = list({cid for d in disputes for cid in d.claimant_ids})
            if "clerk" not in contested_keys:
                contested_keys.append("clerk")
            if on_progress:
                await on_progress(
                    Phase4ProgressEvent(
                        event="phase4_arbitration_start",
                        turn_id=completed_turn.id,
                        contested_agent_keys=contested_keys,
                    )
                )
            char_deltas, arb_notes, arbitration_rulings = await arbitrate_inventory_disputes_detailed(
                disputes=disputes,
                scene_characters=scene_characters,
                character_deltas=char_deltas,
                completed_turn=completed_turn,
                profile=clerk_prof,
                prompt_template=arbitration_prompt_template,
            )
            arbitration_notes.extend(arb_notes)

    # 3.5 Deterministic Party & Spatial Reconciliation (Model 1 strict co-location)
    all_char_locations: dict[str, str] = {
        cid: st.current_location_id
        for cid, st in (completed_turn.character_states or {}).items()
    }
    for ch in scene_characters:
        all_char_locations[ch.id] = active_location.id
    for kp in known_participants:
        all_char_locations.setdefault(kp.id, active_location.id)

    cogs_for_resolution = dict(completed_turn.cognitions or {})
    if (
        completed_turn.actor_id not in ("__narrator__", "__arrival__", "__solo__")
        and completed_turn.actor_id not in cogs_for_resolution
    ):
        cogs_for_resolution[completed_turn.actor_id] = completed_turn.cognition

    resolved_parties, resolved_end_locs, party_event_delta = resolve_phase5_spatial_and_parties(
        prior_parties=list(completed_turn.world_snapshot.parties or []),
        start_location_id=active_location.id,
        new_player_location_id=new_location_id,
        all_character_locations=all_char_locations,
        cognitions=cogs_for_resolution,
        char_deltas=char_deltas,
        valid_neighbor_ids=valid_neighbor_ids,
        is_narrator_turn=is_narrator_turn,
        party_action=completed_turn.pre_turn.party_action,
        turn_id=completed_turn.id,
        name_map=char_name_map,
    )
    updated_world_snapshot.parties = resolved_parties

    # 4. Reconcile CharacterStateSnapshots via CARE Solver + Witness Coupling (conserving ItemInstances)
    updated_states_by_char: dict[str, CharacterStateSnapshot] = {}
    physical_reset_reasons: dict[str, PhysicalStateResetReason] = {}
    if is_narrator_turn:
        for ch in scene_characters:
            prev_st = prev_states_by_char[ch.id]
            prior_care = ensure_snapshot_care_state(
                prev_st,
                ch.baseline_psyche,
                elapsed_minutes=prior_elapsed,
            )
            projected_care = project_care_to_minute(
                prior_care,
                target_elapsed_minutes=new_campaign_elapsed,
                psyche=ch.baseline_psyche,
            )
            char_end_loc = resolved_end_locs.get(ch.id, prev_st.current_location_id)
            if is_static_describe:
                next_stance = prev_st.physical_stance
                next_ctx = prev_st.physical_context
                reset_reason = None
            else:
                next_stance, next_ctx, reset_reason = resolve_post_turn_physical_state(
                    prev_st.physical_stance,
                    prev_st.physical_context,
                    prev_st.physical_stance,
                    prev_st.physical_context,
                    location_changed=(char_end_loc != prev_st.current_location_id),
                    time_elapsed_minutes=turn_elapsed,
                )
            if reset_reason is not None:
                physical_reset_reasons[ch.id] = reset_reason
            base_snap = CharacterStateSnapshot(
                turn_id=completed_turn.id,
                character_id=ch.id,
                current_location_id=char_end_loc,
                mood_label=prev_st.mood_label,
                valence=prev_st.valence,
                arousal=prev_st.arousal,
                active_want=prev_st.active_want,
                active_plan=prev_st.active_plan,
                relationship_notes=dict(prev_st.relationship_notes),
                equipped=list(prev_st.equipped),
                inventory=list(prev_st.inventory),
                unlocked_persona_keys=list(prev_st.unlocked_persona_keys),
                persona_knowledge_provenance=dict(prev_st.persona_knowledge_provenance),
                care_state=projected_care,
                physical_stance=next_stance,
                physical_context=next_ctx,
            )
            updated_states_by_char[ch.id] = (
                base_snap
                if turn_elapsed == 0
                else materialize_snapshot_with_care(base_snap, projected_care)
            )
    else:
        donor_pool = collect_relinquished_item_instances(
            scene_characters=scene_characters,
            prev_states_by_char=prev_states_by_char,
            character_deltas=char_deltas,
        )
        base_snaps_by_char: dict[str, CharacterStateSnapshot] = {}
        post_care_by_char: dict[str, AffectiveCareState] = {}
        end_loc_by_char: dict[str, str] = {}
        all_public_witness_events: list[ResolvedWitnessEvent] = []
        scene_ids = {c.id for c in scene_characters}

        for ch in scene_characters:
            prev_st = prev_states_by_char[ch.id]
            c_delta = char_deltas[ch.id]

            # Apply deterministic Phase 5 party & spatial resolution
            char_loc_id = resolved_end_locs.get(ch.id, active_location.id)
            end_loc_by_char[ch.id] = char_loc_id
            if char_loc_id == active_location.id:
                c_delta = c_delta.model_copy(
                    update={"location_transition": "stay_here", "target_location_id": None}
                )
            elif location_changed and char_loc_id == new_location_id:
                c_delta = c_delta.model_copy(
                    update={"location_transition": "follow_player", "target_location_id": None}
                )
            else:
                c_delta = c_delta.model_copy(
                    update={
                        "location_transition": "move_to_neighbor",
                        "target_location_id": char_loc_id,
                    }
                )
            char_deltas[ch.id] = c_delta

            char_cog = (completed_turn.cognitions or {}).get(ch.id) or (
                completed_turn.cognition if ch.id == completed_turn.actor_id else None
            )

            if c_delta.updated_want and c_delta.updated_want.strip():
                new_want = c_delta.updated_want.strip()
            elif char_cog and char_cog.want and not char_cog.skipped:
                new_want = char_cog.want
            else:
                new_want = prev_st.active_want

            if char_cog and char_cog.plan and not char_cog.skipped:
                new_plan = char_cog.plan
            else:
                new_plan = prev_st.active_plan

            merged_rel = {**prev_st.relationship_notes, **c_delta.stance_updates}
            new_equipped, new_inventory = apply_character_inventory_delta(
                existing_equipped=prev_st.equipped,
                existing_inventory=prev_st.inventory,
                delta=c_delta,
                donor_pool=donor_pool,
                recipient_id=ch.id,
            )
            for claimed_prop in claimed_props_by_holder.get(ch.id, ()):
                claimed_item = claimed_prop.to_item_instance()
                claimed_key = normalize_item_key(claimed_item.name)
                if all(
                    it.id != claimed_item.id and normalize_item_key(it.name) != claimed_key
                    for it in new_inventory
                ):
                    new_inventory.append(claimed_item)
            next_stance, next_ctx, char_reset_reason = resolve_post_turn_physical_state(
                prev_st.physical_stance,
                prev_st.physical_context,
                c_delta.physical_stance,
                c_delta.physical_context,
                location_changed=(char_loc_id != prev_st.current_location_id),
                time_elapsed_minutes=turn_elapsed,
            )
            if char_reset_reason is not None:
                physical_reset_reasons[ch.id] = char_reset_reason
            char_deltas[ch.id] = char_deltas[ch.id].model_copy(
                update={
                    "physical_stance": next_stance,
                    "physical_context": next_ctx,
                }
            )

            base_snaps_by_char[ch.id] = CharacterStateSnapshot(
                turn_id=completed_turn.id,
                character_id=ch.id,
                current_location_id=char_loc_id,
                mood_label=c_delta.mood_label,
                valence=prev_st.valence,
                arousal=prev_st.arousal,
                active_want=new_want,
                active_plan=new_plan,
                relationship_notes=merged_rel,
                equipped=new_equipped,
                inventory=new_inventory,
                unlocked_persona_keys=list(prev_st.unlocked_persona_keys),
                persona_knowledge_provenance=dict(prev_st.persona_knowledge_provenance),
                physical_stance=next_stance,
                physical_context=next_ctx,
            )

            # Python-enforced epistemic visibility ceiling
            vis_ceiling: dict[str, VisibilityScope] = {
                tid: "public_room" for tid in (scene_ids | {"user"}) if tid != ch.id
            }
            w_entry = decomposed_msg.whispers_by_character_id.get(ch.id)
            if w_entry is not None:
                if w_entry.target_scope == MentionTargetScope.REMOTE:
                    vis_ceiling["user"] = "remote_comm"
                elif not decomposed_msg.public_text.strip() or (
                    w_entry.sensory_parts and not w_entry.speech_parts
                ):
                    vis_ceiling["user"] = "local_whisper"

            char_roll = resolve_roll_for_character(completed_turn.pre_turn, ch.id)
            seized_from_me = tuple(
                r.winner_id
                for r in arbitration_rulings
                if r.reason == "unrelinquished_transfer"
                and r.prior_holder_id == ch.id
                and r.winner_id not in ("none", ch.id)
            )
            signals = MechanicalTurnSignals(
                roll_outcome=char_roll.outcome_tier if char_roll else None,
                seized_from_me_by=seized_from_me,
                extracted_memories=tuple(c_delta.new_memories),
                visibility_ceiling_by_target=vis_ceiling,
            )
            cog_imp = (
                char_cog.to_feeling_impulse()
                if (char_cog and not char_cog.skipped)
                else None
            )
            prior_care = ensure_snapshot_care_state(
                prev_st,
                ch.baseline_psyche,
                elapsed_minutes=prior_elapsed,
            )
            allowed_targets = {"user"} | (scene_ids - {ch.id})
            post_care, witness_evs = resolve_post_turn_care_state(
                prior_care,
                psyche=ch.baseline_psyche,
                delta=c_delta,
                cognition_impulse=cog_imp,
                signals=signals,
                turn_elapsed_minutes=turn_elapsed,
                target_elapsed_minutes=new_campaign_elapsed,
                self_id=ch.id,
                self_name=ch.name,
                persona_name=eff_persona_name,
                allowed_target_ids=allowed_targets,
                character_name_map=char_name_map,
            )
            post_care_by_char[ch.id] = post_care
            all_public_witness_events.extend(witness_evs)

        # Co-present witness coupling strictly across characters sharing start_loc -> end_loc
        co_present_throughout_ids = {
            cid for cid, end_loc in end_loc_by_char.items() if end_loc == new_location_id
        }
        coupled_care_by_char = apply_co_present_witness_coupling(
            post_care_by_char,
            psyches_by_char={c.id: c.baseline_psyche for c in scene_characters},
            public_events=all_public_witness_events,
            co_present_throughout_ids=co_present_throughout_ids,
        )
        for ch in scene_characters:
            updated_states_by_char[ch.id] = materialize_snapshot_with_care(
                base_snaps_by_char[ch.id],
                coupled_care_by_char[ch.id],
            )

        # Update off-screen campaign characters addressed via REMOTE @Character comm whispers
        if decomposed_msg.remote_whispers:
            participants_by_id = {p.id: p for p in known_participants}
            for rw in decomposed_msg.remote_whispers:
                rem_char = participants_by_id.get(rw.character_id)
                if rem_char is None or rem_char.id in updated_states_by_char:
                    continue
                rem_prev = resolve_character_previous_state(
                    prior_branch_turns, rem_char, active_location.id
                )
                rem_visible_msg = "\n".join(rw.raw_lines)
                rem_delta = heuristic_character_agent_delta(
                    character=rem_char,
                    prev_state=rem_prev,
                    completed_turn=completed_turn.model_copy(update={"raw_prose": ""}),
                    active_location=active_location,
                    neighbors=[],
                    present_characters=[rem_char],
                    user_message_override=rem_visible_msg,
                )
                rem_delta = rem_delta.model_copy(
                    update={
                        "items_equipped": [],
                        "items_unequipped": [],
                        "items_obtained": [],
                        "items_removed": [],
                        "location_transition": "stay_here",
                        "target_location_id": None,
                    }
                )
                rem_prior_care = ensure_snapshot_care_state(
                    rem_prev,
                    rem_char.baseline_psyche,
                    elapsed_minutes=prior_elapsed,
                )
                rem_post_care, _ = resolve_post_turn_care_state(
                    rem_prior_care,
                    psyche=rem_char.baseline_psyche,
                    delta=rem_delta,
                    cognition_impulse=None,
                    signals=MechanicalTurnSignals(
                        visibility_ceiling_by_target={"user": "remote_comm"}
                    ),
                    turn_elapsed_minutes=turn_elapsed,
                    target_elapsed_minutes=new_campaign_elapsed,
                    self_id=rem_char.id,
                    self_name=rem_char.name,
                    persona_name=eff_persona_name,
                    allowed_target_ids={"user"},
                    character_name_map=char_name_map,
                )
                rem_snap = rem_prev.model_copy(
                    update={"turn_id": completed_turn.id}
                )
                updated_states_by_char[rem_char.id] = materialize_snapshot_with_care(
                    rem_snap, rem_post_care
                )

    # 4.5. Prose-Verified Gossip Protocol & Player Direct Revelations
    verified_gossip: list[PersonaGossipEvent] = []
    if persona_snapshot is not None:
        verified_gossip = verify_prose_gossip_exchanges(
            raw_prose=completed_turn.raw_prose,
            present_characters=scene_characters,
            all_character_states=updated_states_by_char,
            persona_snapshot=persona_snapshot,
        )
        updated_states_by_char, current_player_state = apply_turn_persona_state_and_gossip(
            turn_id=completed_turn.id,
            present_characters=scene_characters,
            character_states=updated_states_by_char,
            current_player_state=current_player_state,
            player_revealed_keys=completed_turn.pre_turn.revealed_persona_keys,
            verified_gossip_events=verified_gossip,
        )

    # 5. Process per-character personal memories (ephemeral extraction + deduplication + 40-turn compaction)
    all_extracted_memories = [
        mem
        for ch in scene_characters
        for mem in (char_deltas[ch.id].new_memories if ch.id in char_deltas else [])
    ]
    modified_char_ids = apply_extracted_character_memories(
        extracted_memories=all_extracted_memories,
        present_characters=scene_characters,
        default_character=character,
        raw_shards_by_char=raw_shards_by_char,
        valid_turn_ids=valid_turn_ids,
        completed_turn=completed_turn,
    )

    lifespan_limit = (
        ephemeral_lifespan_turns
        if ephemeral_lifespan_turns is not None
        else settings.memory_config.ephemeral_memory_lifespan_turns
    )
    compaction_jobs: list[tuple[CharacterRecord, list[int], list[MemoryShard]]] = []
    for ch in scene_characters:
        char_shards = raw_shards_by_char.get(ch.id, [])
        aged_indices: list[int] = []
        aged_shards: list[MemoryShard] = []
        for idx, s in enumerate(char_shards):
            if (
                s.origin == "clerk_ephemeral"
                and repo._is_shard_active_on_branch(s, valid_turn_ids)
                and s.created_at_depth is not None
                and (completed_turn.depth_index - s.created_at_depth) >= lifespan_limit
            ):
                aged_indices.append(idx)
                aged_shards.append(s)
        if aged_shards:
            compaction_jobs.append((ch, aged_indices, aged_shards))

    if compaction_jobs:
        if eff_dispatch == "parallel" and len(compaction_jobs) > 1:
            compacted_specs = await asyncio.gather(
                *(
                    compact_character_memories(aged_s, ch, profile=clerk_prof)
                    for ch, _idxs, aged_s in compaction_jobs
                )
            )
        else:
            compacted_specs = [
                await compact_character_memories(aged_s, ch, profile=clerk_prof)
                for ch, _idxs, aged_s in compaction_jobs
            ]

        for (ch, aged_indices, _aged_shards), compacted_spec in zip(compaction_jobs, compacted_specs, strict=True):
            char_shards = raw_shards_by_char.get(ch.id, [])
            for idx in aged_indices:
                char_shards[idx] = char_shards[idx].model_copy(
                    update={"superseded_at_turn_id": completed_turn.id}
                )
            consolidated_shard = MemoryShard(
                id=f"mem_comp_{ch.id}_{completed_turn.id}_{uuid.uuid4().hex[:6]}",
                title=compacted_spec.title.strip()[:80],
                content=compacted_spec.content.strip(),
                keywords=list(
                    dict.fromkeys(k.strip() for k in compacted_spec.keywords if k.strip())
                )[:6],
                emotional_weight=max(0.0, min(1.0, compacted_spec.emotional_weight)),
                origin="compacted",
                significance="consolidated",
                anchor_turn_id=completed_turn.id,
                created_at_depth=completed_turn.depth_index,
                superseded_at_turn_id=None,
            )
            char_shards.append(consolidated_shard)
            raw_shards_by_char[ch.id] = char_shards
            modified_char_ids.add(ch.id)

    # Assemble composite PostTurnStateDelta (preserving legacy top-level fields + per-character audit map)
    speaker_delta = char_deltas.get(character.id)
    speaker_user_rel_note = None
    if speaker_delta is not None:
        speaker_user_rel_note = speaker_delta.stance_updates.get("user") or next(
            (
                ev.note
                for ev in speaker_delta.relational_events
                if ev.target.strip().lower() in ("user", "player") and ev.note.strip()
            ),
            None,
        )
    # 5.5 Persist Major Event (world-changing Codex history lore or location-changing spatial override)
    persisted_major_event: MajorEventRecord | None = None
    if world_delta.major_event is not None:
        me_spec = world_delta.major_event
        date_label = extract_world_date_label(new_timestamp)
        raw_ev_title = me_spec.evocative_title.strip()
        if date_label and raw_ev_title.lower().startswith(date_label.lower()):
            raw_ev_title = raw_ev_title[len(date_label) :].lstrip(" -—:–")
        full_title = (
            f"{date_label} - {raw_ev_title}".strip(" -")
            if date_label
            else raw_ev_title
        )[:120]
        me_summary = me_spec.summary.strip()[:2000]
        me_keywords = normalize_and_validate_entity_tags(
            [*(me_spec.keywords or []), active_location.name],
            strict=False,
            fallback_title=full_title,
            fallback_content=me_summary,
        )
        if me_spec.scope == "world":
            created_lore = await repo.aadd_clerk_world_major_event_lore(
                campaign_id=campaign_id,
                world_id=world_id,
                turn_id=completed_turn.id,
                title=full_title,
                content=me_summary,
                keywords=me_keywords,
            )
            persisted_major_event = MajorEventRecord(
                id=f"me_{completed_turn.id}",
                turn_id=completed_turn.id,
                scope="world",
                date_label=date_label,
                title=created_lore.title,
                summary=created_lore.content,
                keywords=created_lore.entity_tags,
                lore_node_id=created_lore.id,
                location_id=active_location.id,
                location_name=active_location.name,
            )
        else:
            final_desc, _final_tags, applied_added, applied_removed = (
                repo.apply_clerk_location_mutation(
                    campaign_id=campaign_id,
                    turn_id=completed_turn.id,
                    location=active_location,
                    updated_description=me_spec.location_description_update,
                    tags_added=me_spec.environmental_tags_added,
                    tags_removed=me_spec.environmental_tags_removed,
                )
            )
            persisted_major_event = MajorEventRecord(
                id=f"me_{completed_turn.id}",
                turn_id=completed_turn.id,
                scope="location",
                date_label=date_label,
                title=full_title,
                summary=me_summary,
                keywords=me_keywords,
                location_id=active_location.id,
                location_name=active_location.name,
                previous_description=active_location.description,
                updated_description=final_desc,
                tags_added=applied_added,
                tags_removed=applied_removed,
            )

    if is_static_describe:
        resolved_player_stance = prev_player_stance
        resolved_player_context = prev_player_context
        player_reset_reason = None
    else:
        raw_player_stance = normalize_physical_stance(world_delta.player_physical_stance)
        raw_player_ctx = sanitize_physical_context(world_delta.player_physical_context)
        if (
            raw_player_stance == "unspecified"
            and not raw_player_ctx
            and is_physical_state_established(prev_player_stance, prev_player_context)
        ):
            raw_player_stance = prev_player_stance
            raw_player_ctx = prev_player_context
        resolved_player_stance, resolved_player_context, player_reset_reason = (
            resolve_post_turn_physical_state(
                prev_player_stance,
                prev_player_context,
                raw_player_stance,
                raw_player_ctx,
                location_changed=location_changed,
                time_elapsed_minutes=turn_elapsed,
            )
        )
    if player_reset_reason is not None:
        physical_reset_reasons["user"] = player_reset_reason

    if current_player_state is not None:
        current_player_state = current_player_state.model_copy(
            update={
                "turn_id": completed_turn.id,
                "physical_stance": resolved_player_stance,
                "physical_context": resolved_player_context,
            }
        )
    else:
        current_player_state = PersonaTurnStateSnapshot(
            turn_id=completed_turn.id,
            equipped=list(persona_snapshot.equipped) if persona_snapshot else [],
            inventory=list(persona_snapshot.inventory) if persona_snapshot else [],
            physical_stance=resolved_player_stance,
            physical_context=resolved_player_context,
        )

    player_claimed_props = claimed_props_by_holder.get("player", [])
    if player_claimed_props:
        next_player_inv = list(current_player_state.inventory)
        for claimed_prop in player_claimed_props:
            claimed_key = normalize_item_key(claimed_prop.name)
            if all(
                it.id != claimed_prop.id and normalize_item_key(it.name) != claimed_key
                for it in next_player_inv
            ):
                next_player_inv.append(
                    PersonaItemInstance(
                        id=claimed_prop.id,
                        name=claimed_prop.name,
                        note=claimed_prop.note,
                        flags=list(claimed_prop.flags),
                        is_secret=False,
                        trigger_keywords=[claimed_prop.name.lower()],
                    )
                )
        current_player_state = current_player_state.model_copy(
            update={"inventory": next_player_inv}
        )

    composite_post_turn = PostTurnStateDelta(
        elapsed_minutes=turn_elapsed if (min_travel_minutes > 0 or moved_neighbor is not None) else world_delta.elapsed_minutes,
        new_world_timestamp=new_timestamp if ((min_travel_minutes > 0 or moved_neighbor is not None) and turn_elapsed >= min_travel_minutes) else world_delta.new_world_timestamp,
        transition_type=world_delta.transition_type,
        target_location_id=world_delta.target_location_id,
        improvised_location=world_delta.improvised_location,
        improvised_link=world_delta.improvised_link,
        traversed_location_ids=traversed_location_ids,
        notable_event_summary=world_delta.notable_event_summary,
        scene_flags_updated=world_delta.scene_flags_updated,
        scene_flags_removed=world_delta.scene_flags_removed,
        inventory_added=(
            [*speaker_delta.items_equipped, *speaker_delta.items_obtained]
            if speaker_delta is not None
            else []
        ),
        inventory_removed=(
            list(speaker_delta.items_removed) if speaker_delta is not None else []
        ),
        relationship_shift_note=speaker_user_rel_note,
        character_memories=all_extracted_memories,
        character_deltas=char_deltas,
        arbitration_notes=arbitration_notes,
        character_names={ch.id: ch.name for ch in scene_characters},
        arbitration_rulings=arbitration_rulings,
        compacted_character_ids=[ch.id for ch, _idxs, _aged in compaction_jobs],
        first_visit_cards=first_visit_cards,
        first_visit_media=first_visit_media,
        party_event_delta=party_event_delta,
        revealed_secret_lore_ids=newly_revealed_ids,
        claimed_props=validated_claimed_props,
        major_event=persisted_major_event,
        player_physical_stance=resolved_player_stance,
        player_physical_context=resolved_player_context,
        previous_player_physical_stance=prev_player_stance,
        previous_player_physical_context=prev_player_context,
        physical_state_reset_reasons=physical_reset_reasons,
    )

    primary_char_state = updated_states_by_char.get(
        character.id,
        completed_turn.character_state,
    )
    extra_char_states = [
        st for cid, st in updated_states_by_char.items() if cid != primary_char_state.character_id
    ]

    updated_turn = repo.update_turn_post_clerk(
        turn_id=completed_turn.id,
        post_turn=composite_post_turn,
        updated_world_snapshot=updated_world_snapshot,
        updated_character_state=primary_char_state,
        extra_character_states=extra_char_states,
        updated_persona_turn_state=current_player_state,
    )

    # 6. Sequentially embed and index notable atomic event, episodic chunk, and updated character memories
    # (Serialized to prevent concurrent SQLite write contention under dispatch_mode='parallel')
    primary_witness_id = (
        character.id if any(c.id == character.id for c in scene_characters) else None
    )
    if world_delta.notable_event_summary and not (
        persisted_major_event is not None and persisted_major_event.scope == "world"
    ):
        await repo.vector_store.aupsert_entry(
            entry_id=f"event_{completed_turn.id}",
            source_type="episodic_chunk",
            world_id=world_id,
            character_id=primary_witness_id,
            campaign_id=campaign_id,
            anchor_turn_id=completed_turn.id,
            title=f"Turn {completed_turn.depth_index} Event ({new_timestamp})",
            content=world_delta.notable_event_summary,
            keywords=completed_turn.pre_turn.mentioned_entities,
        )

    if needs_chunk_summary and summary_output is not None:
        chunk_witnesses = compute_episodic_chunk_witnesses(chunk_slice)
        chunk_salience = compute_episodic_chunk_salience(
            chunk_slice,
            extracted_memories=(
                all_extracted_memories
                if any(t.id == completed_turn.id for t in chunk_slice)
                else None
            ),
        )
        saved_chunk = await repo.asave_episodic_chunk(
            campaign_id=campaign_id,
            world_id=world_id,
            character_id=character.id if character.id in chunk_witnesses else None,
            start_turn_depth=chunk_slice[0].depth_index,
            end_turn_depth=chunk_slice[-1].depth_index,
            leaf_turn_id=completed_turn.id,
            summary_text=summary_output.summary_text,
            title=summary_output.title,
            synopsis_text=summary_output.synopsis_text,
            keywords=summary_output.keywords,
            witness_character_ids=chunk_witnesses,
            salience_score=chunk_salience,
        )
        if isinstance(saved_chunk, EpisodicChunkRecord):
            existing_chunks.append(saved_chunk)

    for cid in modified_char_ids:
        await repo.aupdate_campaign_character_memories(
            campaign_id=campaign_id,
            character_id=cid,
            memory_shards=raw_shards_by_char[cid],
            preserve_other_branches=False,
        )

    return updated_turn, existing_chunks
