"""Phase 4: Async Post-Turn Clerk (World Clock, Spatial Graph Mutation, and Episodic Summarizer)."""

from __future__ import annotations

import asyncio
import re

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.world_clock import (
    advance_world_timestamp,  # noqa: F401  (re-exported for backwards compatibility)
    describe_world_timestamp,
    extract_time_hint_minutes,
    parse_world_timestamp,
    resolve_turn_timestamp,
)
from app.schemas.character import CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import (
    EpisodicChunkRecord,
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, NeighborLocationView, normalize_compass_direction


def merge_scene_flags(
    existing_flags: list[str],
    updated_flags: list[str],
    removed_flags: list[str] | None = None,
) -> list[str]:
    """Merge new scene/inventory/world flags into existing_flags without overwriting prior flags."""
    remove_set = {f.strip().lower() for f in (removed_flags or []) if f.strip()}
    additions: list[str] = []
    for raw in updated_flags:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            remove_set.add(cleaned[1:].strip().lower())
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    merged: list[str] = []
    seen_lower: set[str] = set()
    for flag in existing_flags:
        f_clean = flag.strip()
        f_low = f_clean.lower()
        if f_clean and f_low not in remove_set and f_low not in seen_lower:
            merged.append(f_clean)
            seen_lower.add(f_low)

    for flag in additions:
        f_low = flag.lower()
        if f_low not in remove_set and f_low not in seen_lower:
            merged.append(flag)
            seen_lower.add(f_low)

    return merged


def _normalize_inventory_item(raw: str) -> str:
    """Normalize an inventory item label by stripping state tags like '[Worn]' or '(worn)'."""
    s = raw.strip().lower()
    s = re.sub(
        r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*",
        "",
        s,
    )
    s = re.sub(
        r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$",
        "",
        s,
    )
    return s.strip()


def _matches_inventory_removal(existing_item: str, removal_queries: set[str]) -> bool:
    """Return True if existing_item matches any removal query exactly, by normalized name, or by 4+ char substring."""
    if not removal_queries:
        return False
    ex_low = existing_item.strip().lower()
    ex_norm = _normalize_inventory_item(existing_item)
    if ex_low in removal_queries or ex_norm in removal_queries:
        return True
    for rem in removal_queries:
        if len(rem) >= 4 and (rem in ex_norm or (len(ex_norm) >= 4 and ex_norm in rem)):
            return True
    return False


def merge_inventory(
    existing_inventory: list[str],
    added_items: list[str],
    removed_items: list[str] | None = None,
) -> list[str]:
    """Merge added and removed clothing/objects into existing_inventory with prefix/substring tolerance."""
    remove_queries: set[str] = set()
    for raw_rem in removed_items or []:
        cleaned = raw_rem.strip()
        if cleaned:
            remove_queries.add(cleaned.lower())
            norm = _normalize_inventory_item(cleaned)
            if norm:
                remove_queries.add(norm)

    additions: list[str] = []
    for raw in added_items:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if cleaned.startswith("-") and len(cleaned) > 1:
            rem_val = cleaned[1:].strip()
            remove_queries.add(rem_val.lower())
            norm = _normalize_inventory_item(rem_val)
            if norm:
                remove_queries.add(norm)
        elif cleaned.startswith("+") and len(cleaned) > 1:
            additions.append(cleaned[1:].strip())
        else:
            additions.append(cleaned)

    addition_overrides: dict[str, str] = {}
    for item in additions:
        norm = _normalize_inventory_item(item)
        if norm:
            addition_overrides[norm] = item

    merged: list[str] = []
    seen_norm: set[str] = set()
    for existing in existing_inventory:
        ex_clean = existing.strip()
        if not ex_clean:
            continue
        if _matches_inventory_removal(ex_clean, remove_queries):
            continue
        ex_norm = _normalize_inventory_item(ex_clean)
        if not ex_norm or ex_norm in seen_norm:
            continue
        if ex_norm in addition_overrides:
            merged.append(addition_overrides[ex_norm])
        else:
            merged.append(ex_clean)
        seen_norm.add(ex_norm)

    for item in additions:
        item_norm = _normalize_inventory_item(item)
        if not item_norm or item_norm in seen_norm:
            continue
        if _matches_inventory_removal(item, remove_queries):
            continue
        merged.append(item)
        seen_norm.add(item_norm)

    return merged


_GENERIC_ITEM_ADJECTIVES = {
    "dark",
    "light",
    "heavy",
    "worn",
    "old",
    "new",
    "small",
    "large",
    "black",
    "white",
    "work",
    "utility",
    "stained",
    "leather",
    "concealed",
}


def _extract_heuristic_inventory_delta(
    user_message: str,
    raw_prose: str,
    current_inventory: list[str] | None = None,
) -> tuple[list[str], list[str]]:
    """Extract deterministic inventory additions and removals when running without a live Clerk LLM."""
    combined = f"{user_message}\n{raw_prose}"
    combined_lower = combined.lower()
    inv_added: list[str] = []
    inv_removed: list[str] = []

    remove_cue = bool(
        re.search(
            r"\b(take off|takes off|took off|remove|removes|removed|shed|sheds|unfasten|unfastens|"
            r"strip off|strips off|drop|drops|dropped|hand over|hands over|give|gives|gave|toss|tosses|discard|discards)\b",
            combined_lower,
        )
    )
    if remove_cue and current_inventory:
        for item in current_inventory:
            norm = _normalize_inventory_item(item)
            if not norm:
                continue
            if norm in combined_lower:
                inv_removed.append(item)
                continue
            tokens = [
                w
                for w in re.findall(r"[a-z0-9]{4,}", norm)
                if w not in _GENERIC_ITEM_ADJECTIVES
            ]
            if any(re.search(rf"\b{re.escape(tok)}\b", combined_lower) for tok in tokens):
                inv_removed.append(item)

    wear_matches = re.finditer(
        r"\b(?:put on|puts on|pull on|pulls on|slip into|slips into|wear|wears|don|dons)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|over|under|as|from|in)\b)",
        combined,
        re.I,
    )
    for m in wear_matches:
        garment = m.group(1).strip()
        if len(garment) >= 3:
            inv_added.append(f"[Worn] {garment[0].upper() + garment[1:]}")

    acquire_matches = re.finditer(
        r"\b(?:pick up|picks up|pocket|pockets|grab|grabs|hand you|hands you|give you|gives you|"
        r"hand her|hands her|hand him|hands him|give her|gives her|give him|gives him)\s+"
        r"(?:(?:an|a|the|my|her|his|their|your)\b\s*)?([a-z0-9][a-z0-9\s\-]{2,32}?)"
        r"(?=[.,;!?'\")\n]|$|\s+(?:and|before|while|to|from|off|on|in|into|across)\b)",
        combined,
        re.I,
    )
    for m in acquire_matches:
        obj = m.group(1).strip()
        if len(obj) >= 3 and obj.lower() not in {"it", "them", "this", "that", "him", "her", "me", "you"}:
            inv_added.append(obj[0].upper() + obj[1:])

    return inv_added, inv_removed


def heuristic_post_turn_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
    current_timestamp: str | None = None,
) -> PostTurnStateDelta:
    """Deterministic fallback state extractor when the Auxiliary Clerk endpoint is offline."""
    delta = _heuristic_spatial_and_inventory_delta(
        user_message=user_message,
        raw_prose=raw_prose,
        pre_turn=pre_turn,
        active_location=active_location,
        neighbors=neighbors,
        current_inventory=current_inventory,
    )
    # Honor explicit time cues in the user's message (e.g. "it's 5am", "slept until morning").
    if current_timestamp is not None:
        hint_minutes = extract_time_hint_minutes(user_message, current_timestamp)
        if hint_minutes is not None and hint_minutes > 0:
            if parse_world_timestamp(current_timestamp) is not None:
                delta.new_world_timestamp = advance_world_timestamp(current_timestamp, hint_minutes)
            delta.elapsed_minutes = min(hint_minutes, 1440)
    return delta


def _heuristic_spatial_and_inventory_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
) -> PostTurnStateDelta:
    """Deterministic spatial transition + inventory extraction (clock defaults only)."""
    combined = f"{user_message} {raw_prose}".lower()
    inv_added, inv_removed = _extract_heuristic_inventory_delta(
        user_message, raw_prose, current_inventory
    )

    # Check if movement to a known neighbor occurred
    if pre_turn.spatial_intent == "move_known":
        for nb in neighbors:
            if (
                pre_turn.target_location_hint
                and pre_turn.target_location_hint.lower() in nb.destination.name.lower()
            ):
                return PostTurnStateDelta(
                    elapsed_minutes=max(2, nb.travel_minutes + 1),
                    transition_type="move_existing",
                    target_location_id=nb.destination.id,
                    notable_event_summary=(
                        f"Moved from {active_location.name} to {nb.destination.name}."
                    ),
                    scene_flags_updated=[f"At {nb.destination.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )
        # Fallback to matching neighbor words in combined text
        for nb in neighbors:
            dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
            if any(w in combined for w in dest_words):
                return PostTurnStateDelta(
                    elapsed_minutes=max(2, nb.travel_minutes + 1),
                    transition_type="move_existing",
                    target_location_id=nb.destination.id,
                    notable_event_summary=(
                        f"Transitioned from {active_location.name} to {nb.destination.name}."
                    ),
                    scene_flags_updated=[f"At {nb.destination.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )

    # Check if an unmapped room was explored/improvised
    if pre_turn.spatial_intent == "explore_new":
        room_match = re.search(
            r"(?:into the|open the|enter the|inside the)\s+([a-z0-9\s\-]{3,28})",
            user_message,
            re.I,
        )
        raw_room = room_match.group(1).strip().title() if room_match else "Uncharted Annex"
        room_name = raw_room if len(raw_room) >= 4 else "Uncharted Annex"
        inferred_dir = normalize_compass_direction(None, f"{user_message} {raw_prose}")
        return PostTurnStateDelta(
            elapsed_minutes=4,
            transition_type="improvise_new",
            improvised_location=ImprovisedLocationSpec(
                name=room_name,
                summary=f"Newly accessed area adjoining {active_location.name}.",
                description=(
                    f"A dimly lit space beyond {active_location.name}, thick with dust and "
                    "the hum of concealed infrastructure."
                ),
                environmental_tags=["dim lighting", "uncharted threshold", "echoing acoustics"],
                entry_direction_label=f"Passage to {room_name}",
                return_direction_label=f"Doorway back to {active_location.name}",
                compass_direction=inferred_dir,
                travel_minutes=2,
            ),
            notable_event_summary=f"Discovered and entered {room_name} from {active_location.name}.",
            scene_flags_updated=[f"Discovered {room_name}"],
            inventory_added=inv_added,
            inventory_removed=inv_removed,
        )

    elapsed = 3 if len(raw_prose) > 350 else 2
    notable = None
    flags_added: list[str] = []
    if pre_turn.resolved_roll is not None:
        r = pre_turn.resolved_roll
        notable = (
            f"Attempted '{r.action_description}' ({r.skill_or_approach}) at {active_location.name}: "
            f"{r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})."
        )
        flags_added.append(f"{r.skill_or_approach}: {r.outcome_tier}")

    return PostTurnStateDelta(
        elapsed_minutes=elapsed,
        transition_type="stay",
        notable_event_summary=notable,
        scene_flags_updated=flags_added,
        inventory_added=inv_added,
        inventory_removed=inv_removed,
    )


async def summarize_turn_chunk(
    turns: list[TurnNodeRecord],
    character: CharacterRecord,
    profile: ModelProfile | None = None,
) -> str:
    """Summarize a slice of working memory turns into a compact episodic paragraph."""
    transcript = "\n".join(
        f"Turn {t.depth_index} | User: {t.user_message}\n{character.name}: {t.raw_prose}"
        for t in turns
    )
    system_prompt = (
        "Summarize the following roleplay exchange turns into a single cohesive 2-4 sentence "
        "episodic memory paragraph. Preserve key plot decisions, emotional shifts, promises, "
        "and location changes."
    )
    clerk_prof = profile or settings.clerk_profile
    try:
        summary = await llm_client.complete_text(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": transcript},
            ],
            profile=clerk_prof,
            temperature=0.2,
            max_tokens=256,
        )
        if summary.strip():
            return summary.strip()
    except Exception:
        if not settings.allow_offline_fallback:
            raise

    # Deterministic fallback episodic compression
    start_d = turns[0].depth_index
    end_d = turns[-1].depth_index
    snippets: list[str] = []
    for t in turns:
        u_short = t.user_message.strip().replace("\n", " ")[:70]
        c_short = t.cognition.want.strip()[:70]
        snippets.append(f"[T{t.depth_index}] User: '{u_short}' -> {character.name} aimed to: {c_short}")
    return f"Turns {start_d}–{end_d} summary: " + " | ".join(snippets[:4])


async def run_phase4_post_turn_clerk(
    *,
    repo: CantinaRepository,
    campaign_id: str,
    world_id: str,
    character: CharacterRecord,
    completed_turn: TurnNodeRecord,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    profile: ModelProfile | None = None,
    working_memory_turns: int | None = None,
) -> tuple[TurnNodeRecord, list[EpisodicChunkRecord]]:
    """Run Phase 4 Clerk to advance the clock, mutate the Spatial Graph, and compress Episodic Memory."""
    clerk_prof = profile or settings.clerk_profile
    neighbor_options = "\n".join(
        f"- [{n.compass_direction or 'N'}] id='{n.destination.id}': {n.destination.name} (via {n.direction_label}, {n.travel_minutes}m)"
        for n in neighbors
    ) or "None"
    existing_flags_str = (
        ", ".join(completed_turn.world_snapshot.scene_flags)
        if completed_turn.world_snapshot.scene_flags
        else "None"
    )
    equipped_str = (
        ", ".join(completed_turn.character_state.equipped)
        if completed_turn.character_state.equipped
        else "None"
    )
    existing_inventory_str = (
        ", ".join(completed_turn.character_state.inventory)
        if completed_turn.character_state.inventory
        else "None"
    )

    current_timestamp = completed_turn.world_snapshot.world_timestamp
    current_time_str = describe_world_timestamp(current_timestamp)

    system_prompt = (
        "You are the Post-Turn State Clerk for an AI roleplay engine.\n"
        "Inspect the completed turn and output a JSON object matching PostTurnStateDelta:\n"
        "- elapsed_minutes (int 0-1440): narrative minutes that passed during this turn. Typical "
        "dialogue/action turns take 1-10 minutes; travel adds the exit's travel time.\n"
        "- new_world_timestamp (string 'YYYY-MM-DD HH:MM' or null): the absolute in-world time at the "
        "END of this turn. Set it ONLY when the user's message or the response states or clearly "
        "implies a specific time or a time skip, e.g. \"it's 5am\" -> the next 05:00; \"they slept "
        "until morning\" -> the following morning (~07:00-08:00); \"at dusk\" -> ~18:30; \"three days "
        "later\" -> current time + 3 days. Compute it from the Current In-Game Time; it must never be "
        "earlier than the current time (roll the date forward when the stated hour has already "
        "passed today). When set, it overrides elapsed_minutes. Otherwise use null.\n"
        "- transition_type ('stay' | 'move_existing' | 'improvise_new')\n"
        "- target_location_id (if transition_type == 'move_existing', must match one of the neighbor IDs)\n"
        "- improvised_location (if transition_type == 'improvise_new', object with name, summary, description, environmental_tags, entry_direction_label, return_direction_label, compass_direction ['N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'], travel_minutes)\n"
        "- notable_event_summary (1-sentence summary if a significant plot/relationship event occurred, else null)\n"
        "- scene_flags_updated (list of newly added scene/fact flags; existing flags are preserved automatically)\n"
        "- scene_flags_removed (list of obsolete flags to remove, if any)\n"
        f"- inventory_added (list of items newly picked up, acquired, or crafted by {character.name} this turn; ignore momentary scene furniture/props not kept)\n"
        f"- inventory_removed (list of items dropped, given away, consumed, or lost by {character.name} this turn; match names from Equipped / Worn or Carried Inventory)\n"
        "- relationship_shift_note (string or null)"
    )
    user_prompt = (
        f"Current In-Game Time (start of this turn): {current_time_str}\n"
        f"Current Location: {active_location.name} (id='{active_location.id}')\n"
        f"Current Scene Flags: {existing_flags_str}\n"
        f"{character.name} Equipped / Worn: {equipped_str}\n"
        f"{character.name} Carried Inventory: {existing_inventory_str}\n"
        f"Known Exits:\n{neighbor_options}\n\n"
        f"User Message: {completed_turn.user_message}\n"
        f"{character.name} Cognition Plan: {completed_turn.cognition.plan}\n"
        f"{character.name} Response:\n{completed_turn.raw_prose}"
    )

    async def _compute_delta() -> PostTurnStateDelta:
        try:
            return await llm_client.complete_structured(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                PostTurnStateDelta,
                profile=clerk_prof,
            )
        except Exception:
            if not settings.allow_offline_fallback:
                raise
            return heuristic_post_turn_delta(
                user_message=completed_turn.user_message,
                raw_prose=completed_turn.raw_prose,
                pre_turn=completed_turn.pre_turn,
                active_location=active_location,
                neighbors=neighbors,
                current_inventory=[
                    *(completed_turn.character_state.equipped or []),
                    *(completed_turn.character_state.inventory or []),
                ],
                current_timestamp=current_timestamp,
            )

    # Check Rolling Episodic Compression threshold upfront so delta extraction and chunk summarization run concurrently
    branch_turns = repo.get_branch_turn_chain(completed_turn.id)
    valid_turn_ids = {t.id for t in branch_turns}
    existing_chunks = repo.get_branch_episodic_chunks(campaign_id, valid_turn_ids)
    max_summarized_depth = max((c.end_turn_depth for c in existing_chunks), default=0)

    unsummarized = [t for t in branch_turns if t.depth_index > max_summarized_depth]
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

    if needs_chunk_summary:
        try:
            summarize_coro = summarize_turn_chunk(
                chunk_slice, character, profile=clerk_prof
            )
        except TypeError:
            summarize_coro = summarize_turn_chunk(chunk_slice, character)
        delta, summary_text = await asyncio.gather(
            _compute_delta(),
            summarize_coro,
        )
    else:
        delta = await _compute_delta()
        summary_text = None

    # 1. Resolve new active location (stay, move_existing, or improvise_new)
    new_location_id = active_location.id
    valid_neighbor_ids = {n.destination.id for n in neighbors}
    if delta.transition_type == "move_existing" and delta.target_location_id in valid_neighbor_ids:
        new_location_id = delta.target_location_id  # type: ignore[assignment]
    elif delta.transition_type == "improvise_new" and delta.improvised_location is not None:
        created_loc = repo.add_improvised_location(
            world_id=world_id,
            from_location_id=active_location.id,
            created_at_turn_id=completed_turn.id,
            spec=delta.improvised_location,
            valid_turn_ids=valid_turn_ids,
        )
        new_location_id = created_loc.id
        delta.target_location_id = created_loc.id

    # 2. Advance World Clock & Merge Scene Flags (preserving previous flags unless removed)
    new_timestamp = resolve_turn_timestamp(
        current_timestamp,
        delta.elapsed_minutes,
        delta.new_world_timestamp,
    )
    merged_flags = merge_scene_flags(
        completed_turn.world_snapshot.scene_flags,
        delta.scene_flags_updated,
        delta.scene_flags_removed,
    )
    updated_world_snapshot = WorldStateSnapshot(
        turn_id=completed_turn.id,
        world_timestamp=new_timestamp,
        active_location_id=new_location_id,
        scene_flags=merged_flags,
    )

    # 3. Update Character State Snapshot from Phase 3 Cognition + Phase 4 Delta
    rel_notes = dict(completed_turn.character_state.relationship_notes)
    if delta.relationship_shift_note:
        rel_notes["user"] = delta.relationship_shift_note

    # Determine whether the active speaker moved with the user or stayed behind (if user moved alone)
    msg_lower = completed_turn.user_message.lower()
    user_moved_alone = bool(
        new_location_id != active_location.id
        and re.search(r"\b(alone|by myself|without you|slip out alone|leave .+ behind)\b", msg_lower)
    )
    actor_new_location_id = active_location.id if user_moved_alone else new_location_id

    rem_queries: set[str] = set()
    for raw_rem in delta.inventory_removed or []:
        cleaned = raw_rem.strip()
        if cleaned:
            rem_queries.add(cleaned.lower())
            norm = _normalize_inventory_item(cleaned)
            if norm:
                rem_queries.add(norm)

    updated_equipped = [
        item for item in (completed_turn.character_state.equipped or [])
        if not _matches_inventory_removal(item, rem_queries)
    ]

    merged_inventory = merge_inventory(
        completed_turn.character_state.inventory,
        delta.inventory_added,
        delta.inventory_removed,
    )

    updated_char_state = CharacterStateSnapshot(
        turn_id=completed_turn.id,
        character_id=character.id,
        current_location_id=actor_new_location_id,
        mood_label=completed_turn.cognition.feeling[:80] or completed_turn.character_state.mood_label,
        valence=completed_turn.cognition.valence,
        arousal=completed_turn.cognition.arousal,
        active_want=completed_turn.cognition.want or completed_turn.character_state.active_want,
        active_plan=completed_turn.cognition.plan or completed_turn.character_state.active_plan,
        relationship_notes=rel_notes,
        equipped=updated_equipped,
        inventory=merged_inventory,
    )

    updated_turn = repo.update_turn_post_clerk(
        turn_id=completed_turn.id,
        post_turn=delta,
        updated_world_snapshot=updated_world_snapshot,
        updated_character_state=updated_char_state,
    )

    # 4. Asynchronously embed and index notable atomic event and/or episodic chunk
    async_tasks = []
    if delta.notable_event_summary:
        async_tasks.append(
            repo.vector_store.aupsert_entry(
                entry_id=f"event_{completed_turn.id}",
                source_type="episodic_chunk",
                world_id=world_id,
                character_id=character.id,
                campaign_id=campaign_id,
                anchor_turn_id=completed_turn.id,
                title=f"Turn {completed_turn.depth_index} Event ({new_timestamp})",
                content=delta.notable_event_summary,
                keywords=completed_turn.pre_turn.mentioned_entities,
            )
        )

    if needs_chunk_summary and summary_text is not None:
        async_tasks.append(
            repo.asave_episodic_chunk(
                campaign_id=campaign_id,
                world_id=world_id,
                character_id=character.id,
                start_turn_depth=chunk_slice[0].depth_index,
                end_turn_depth=chunk_slice[-1].depth_index,
                leaf_turn_id=completed_turn.id,
                summary_text=summary_text,
            )
        )

    if async_tasks:
        results = await asyncio.gather(*async_tasks)
        for res in results:
            if isinstance(res, EpisodicChunkRecord):
                existing_chunks.append(res)

    return updated_turn, existing_chunks
