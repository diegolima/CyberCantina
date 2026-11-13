"""Offline heuristic post-turn world and spatial/inventory delta extraction."""

from __future__ import annotations

import re

from app.engine.world_clock import (
    advance_world_timestamp,
    extract_time_hint_minutes,
    parse_world_timestamp,
)
from app.schemas.affective import MAX_TURN_ELAPSED_MINUTES_SANITY
from app.schemas.character import CharacterRecord
from app.schemas.turn import (
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    LocationNode,
    NeighborLocationView,
    normalize_compass_direction,
)

from app.engine.clerk.inventory import _extract_heuristic_inventory_delta
from app.engine.clerk.memories import _extract_heuristic_character_memories

def heuristic_post_turn_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
    current_timestamp: str | None = None,
    present_characters: list[CharacterRecord] | None = None,
    active_character: CharacterRecord | None = None,
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

    if present_characters:
        delta.character_memories = _extract_heuristic_character_memories(
            user_message=user_message,
            raw_prose=raw_prose,
            present_characters=present_characters,
            active_character=active_character,
            mentioned_entities=pre_turn.mentioned_entities,
        )
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
        is_exterior_heuristic = bool(
            re.search(
                r"\b(step(?:s|ped)?\s+outside|exit(?:s|ed)?\s+(?:into|to|the)|out\s+into\s+the\s+street|outside\s+the\s+(?:building|club|bar|tavern|compound)|onto\s+the\s+(?:street|road|alley|plaza))\b",
                f"{user_message} {raw_prose}",
                re.I,
            )
        )
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
                is_exterior=is_exterior_heuristic,
            ),
            notable_event_summary=f"Discovered and entered {room_name} from {active_location.name}.",
            scene_flags_updated=[f"Discovered {room_name}"],
            inventory_added=inv_added,
            inventory_removed=inv_removed,
        )

    elapsed = 3 if len(raw_prose) > 350 else 2
    notable = None
    flags_added: list[str] = []
    if pre_turn.character_rolls:
        notable_parts = []
        for cid, r in pre_turn.character_rolls.items():
            name = r.character_name or cid
            notable_parts.append(
                f"{name} attempted '{r.action_description}': {r.outcome_tier} ({r.total} vs DC {r.difficulty_class})."
            )
            if r.outcome_tier == "Critical Failure":
                flags_added.append(f"Crisis: {r.action_description[:30]} Backfire")
        if notable_parts:
            notable = " ".join(notable_parts)
    elif pre_turn.resolved_roll is not None:
        r = pre_turn.resolved_roll
        notable = (
            f"Attempted '{r.action_description}' ({r.skill_or_approach}) at {active_location.name}: "
            f"{r.outcome_tier} (rolled {r.total} vs DC {r.difficulty_class})."
        )
        if r.outcome_tier == "Critical Failure":
            flags_added.append(f"Crisis: {r.action_description[:30]} Backfire")

    return PostTurnStateDelta(
        elapsed_minutes=elapsed,
        transition_type="stay",
        notable_event_summary=notable,
        scene_flags_updated=flags_added,
        inventory_added=inv_added,
        inventory_removed=inv_removed,
    )


def heuristic_world_post_turn_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_timestamp: str | None = None,
) -> WorldPostTurnDelta:
    """Deterministic fallback global world state extractor (clock, spatial graph, scene flags)."""
    legacy = _heuristic_spatial_and_inventory_delta(
        user_message=user_message,
        raw_prose=raw_prose,
        pre_turn=pre_turn,
        active_location=active_location,
        neighbors=neighbors,
        current_inventory=None,
    )
    new_ts: str | None = None
    elapsed = (
        0
        if user_message.strip().lower().startswith("[describe")
        else legacy.elapsed_minutes
    )
    if current_timestamp is not None:
        hint_minutes = extract_time_hint_minutes(user_message, current_timestamp)
        if hint_minutes is not None and hint_minutes > 0:
            if parse_world_timestamp(current_timestamp) is not None:
                new_ts = advance_world_timestamp(current_timestamp, hint_minutes)
            elapsed = min(hint_minutes, MAX_TURN_ELAPSED_MINUTES_SANITY)

    return WorldPostTurnDelta(
        elapsed_minutes=elapsed,
        new_world_timestamp=new_ts,
        transition_type=legacy.transition_type,
        target_location_id=legacy.target_location_id,
        improvised_location=legacy.improvised_location,
        notable_event_summary=legacy.notable_event_summary,
        scene_flags_updated=legacy.scene_flags_updated,
        scene_flags_removed=legacy.scene_flags_removed,
    )
