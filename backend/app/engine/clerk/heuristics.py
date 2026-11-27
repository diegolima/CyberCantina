"""Offline heuristic post-turn world and spatial/inventory delta extraction."""

from __future__ import annotations

import re

from app.engine.spatial_geometry import (
    CandidateKnownLocation,
    extract_travel_cues,
    normalize_location_name_key,
)
from app.engine.world_clock import (
    advance_world_timestamp,
    extract_time_hint_minutes,
    parse_world_timestamp,
)
from app.schemas.affective import MAX_TURN_ELAPSED_MINUTES_SANITY
from app.schemas.character import CharacterRecord
from app.schemas.physical import (
    PhysicalStance,
    extract_heuristic_physical_state,
)
from app.schemas.turn import (
    ImprovisedLinkSpec,
    ImprovisedLocationSpec,
    PostTurnStateDelta,
    PreTurnAnalysis,
    PropClaim,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    DEFAULT_EDGE_SPEED_MODIFIER,
    DEFAULT_EXTERIOR_DISTANCE_METERS,
    DEFAULT_INTERIOR_DISTANCE_METERS,
    MAX_EDGE_DISTANCE_METERS,
    WALKING_METERS_PER_MINUTE,
    LocationNode,
    LocationProp,
    NeighborLocationView,
    derive_travel_minutes,
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
    other_known_locations: list[CandidateKnownLocation] | None = None,
) -> PostTurnStateDelta:
    """Deterministic fallback state extractor when the Auxiliary Clerk endpoint is offline."""
    delta = _heuristic_spatial_and_inventory_delta(
        user_message=user_message,
        raw_prose=raw_prose,
        pre_turn=pre_turn,
        active_location=active_location,
        neighbors=neighbors,
        current_inventory=current_inventory,
        other_known_locations=other_known_locations,
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


def _match_candidate_location(
    candidates: list[CandidateKnownLocation] | None,
    pre_turn: PreTurnAnalysis,
    user_message: str,
) -> CandidateKnownLocation | None:
    if not candidates:
        return None
    hint = normalize_location_name_key(pre_turn.target_location_hint or "")
    msg_low = user_message.lower()
    if hint:
        for cand in candidates:
            norm = normalize_location_name_key(cand.location.name)
            if norm == hint or hint in norm or cand.location.id == pre_turn.target_location_hint:
                return cand
    for cand in candidates:
        norm = normalize_location_name_key(cand.location.name)
        if cand.location.name.lower() in msg_low or (len(norm) >= 3 and norm in msg_low):
            return cand
    return None


def _heuristic_spatial_and_inventory_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_inventory: list[str] | None = None,
    other_known_locations: list[CandidateKnownLocation] | None = None,
) -> PostTurnStateDelta:
    """Deterministic spatial transition + inventory extraction (clock defaults only)."""
    combined = f"{user_message} {raw_prose}".lower()
    cues = extract_travel_cues(f"{user_message}\n{raw_prose}")
    inv_added, inv_removed = _extract_heuristic_inventory_delta(
        user_message, raw_prose, current_inventory
    )

    # Check if movement to a known neighbor (or multi-hop / connect_existing candidate) occurred
    if pre_turn.spatial_intent in ("move_known", "connect_existing"):
        for nb in neighbors:
            if (
                pre_turn.target_location_hint
                and pre_turn.target_location_hint.lower() in nb.destination.name.lower()
            ):
                return PostTurnStateDelta(
                    elapsed_minutes=min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        max(2, derive_travel_minutes(nb.distance_meters, nb.speed_modifier) + 1),
                    ),
                    transition_type="move_existing",
                    target_location_id=nb.destination.id,
                    notable_event_summary=(
                        f"Moved from {active_location.name} to {nb.destination.name}."
                    ),
                    scene_flags_updated=[f"At {nb.destination.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )

        cand = _match_candidate_location(other_known_locations, pre_turn, user_message)
        if cand is not None:
            is_retrace = pre_turn.spatial_intent == "move_known" or any(
                kw in combined
                for kw in ("back through", "retrace", "return along", "via the")
            )
            if is_retrace and cand.shortest_path is not None:
                return PostTurnStateDelta(
                    elapsed_minutes=min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        max(2, cand.shortest_path.total_travel_minutes),
                    ),
                    transition_type="move_existing",
                    target_location_id=cand.location.id,
                    traversed_location_ids=list(cand.shortest_path.path_node_ids),
                    notable_event_summary=(
                        f"Returned from {active_location.name} to {cand.location.name}."
                    ),
                    scene_flags_updated=[f"At {cand.location.name}"],
                    inventory_added=inv_added,
                    inventory_removed=inv_removed,
                )
            eff_speed = cues.speed_modifier or DEFAULT_EDGE_SPEED_MODIFIER
            raw_m = (
                cues.distance_meters
                if cues.distance_meters is not None
                else (
                    max(1, min(MAX_EDGE_DISTANCE_METERS, int(round(cues.duration_minutes * WALKING_METERS_PER_MINUTE * eff_speed))))
                    if cues.duration_minutes is not None
                    else DEFAULT_EXTERIOR_DISTANCE_METERS
                )
            )
            clamped_from: int | None = None
            final_m = raw_m
            final_dir = normalize_compass_direction(None, f"{user_message} {raw_prose}")
            if (
                not cues.is_non_euclidean
                and not cues.is_vertical
                and cand.geometric_offset is not None
            ):
                final_m = cand.geometric_offset.distance_meters
                final_dir = cand.geometric_offset.bearing
                if abs(raw_m - final_m) >= 25:
                    clamped_from = raw_m
            elapsed_min = derive_travel_minutes(final_m, eff_speed)
            return PostTurnStateDelta(
                elapsed_minutes=min(MAX_TURN_ELAPSED_MINUTES_SANITY, elapsed_min),
                transition_type="connect_existing",
                target_location_id=cand.location.id,
                improvised_link=ImprovisedLinkSpec(
                    to_location_id=cand.location.id,
                    entry_direction_label=f"Direct route to {cand.location.name}",
                    return_direction_label=f"Back to {active_location.name}",
                    compass_direction=final_dir,
                    distance_meters=final_m,
                    speed_modifier=eff_speed,
                    distance_mode="non_euclidean" if cues.is_non_euclidean else "flexible",
                    is_vertical=cues.is_vertical,
                    clamped_from_meters=clamped_from,
                ),
                notable_event_summary=(
                    f"Opened a direct route from {active_location.name} to {cand.location.name}."
                ),
                scene_flags_updated=[f"At {cand.location.name}"],
                inventory_added=inv_added,
                inventory_removed=inv_removed,
            )

        # Fallback to matching neighbor words in combined text
        for nb in neighbors:
            dest_words = [w.lower() for w in nb.destination.name.split() if len(w) > 3]
            if any(w in combined for w in dest_words):
                return PostTurnStateDelta(
                    elapsed_minutes=min(
                        MAX_TURN_ELAPSED_MINUTES_SANITY,
                        max(2, derive_travel_minutes(nb.distance_meters, nb.speed_modifier) + 1),
                    ),
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
                r"\b(step(?:s|ped)?\s+outside|exit(?:s|ed)?\s+(?:into|to|the)|out\s+into\s+the\s+street|outside\s+the\s+(?:building|club|bar|tavern|compound)|onto\s+the\s+(?:street|road|alley|plaza)|into\s+the\s+street)\b",
                f"{user_message} {raw_prose}",
                re.I,
            )
        )
        eff_speed = cues.speed_modifier or DEFAULT_EDGE_SPEED_MODIFIER
        if cues.distance_meters is not None:
            imp_dist = cues.distance_meters
        elif cues.duration_minutes is not None:
            imp_dist = max(
                1,
                min(
                    MAX_EDGE_DISTANCE_METERS,
                    int(round(cues.duration_minutes * WALKING_METERS_PER_MINUTE * eff_speed)),
                ),
            )
        else:
            imp_dist = (
                DEFAULT_EXTERIOR_DISTANCE_METERS
                if is_exterior_heuristic
                else DEFAULT_INTERIOR_DISTANCE_METERS
            )
        imp_elapsed = (
            cues.duration_minutes
            if cues.duration_minutes is not None
            else derive_travel_minutes(imp_dist, eff_speed)
        )
        return PostTurnStateDelta(
            elapsed_minutes=min(MAX_TURN_ELAPSED_MINUTES_SANITY, max(1, imp_elapsed)),
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
                distance_meters=imp_dist,
                is_exterior=is_exterior_heuristic,
                distance_mode="non_euclidean" if cues.is_non_euclidean else "flexible",
                is_vertical=cues.is_vertical,
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


_PICKUP_PROP_RE = re.compile(
    r"\b(?:pick(?:s|ed|ing)?\s+up|grab(?:s|bed|bing)?|take(?:s)?|took|"
    r"pocket(?:s|ed|ing)?|stash(?:es|ed|ing)?|collect(?:s|ed|ing)?|"
    r"snatch(?:es|ed|ing)?|retrieve(?:s|d|ing)?|scoop(?:s|ed|ing)?\s+up|"
    r"slip(?:s|ped)?)\b",
    re.IGNORECASE,
)


def _extract_heuristic_prop_claims(
    *,
    user_message: str,
    raw_prose: str,
    visible_location_props: list[LocationProp] | None,
    present_characters: list[CharacterRecord] | None = None,
) -> list[PropClaim]:
    """Deterministically detect obvious room-prop pickups when running offline."""
    if not visible_location_props:
        return []
    combined = f"{user_message}\n{raw_prose}".strip()
    if not combined:
        return []
    claims: list[PropClaim] = []
    seen_ids: set[str] = set()
    chars = list(present_characters or [])
    for prop in visible_location_props:
        if prop.id in seen_ids:
            continue
        prop_name = (prop.name or "").strip()
        if len(prop_name) < 3:
            continue
        name_pat = re.compile(rf"\b{re.escape(prop_name)}\b", re.IGNORECASE)
        for m in name_pat.finditer(combined):
            window_start = max(0, m.start() - 60)
            window_end = min(len(combined), m.end() + 45)
            snippet = combined[window_start:window_end]
            pickup_m = _PICKUP_PROP_RE.search(snippet)
            if not pickup_m:
                continue
            holder_id = "player"
            subject_ctx = snippet[: pickup_m.start()].lower()
            for ch in chars:
                first_tok = ch.name.strip().lower().split()[0] if ch.name.strip() else ""
                if (ch.name.strip().lower() in subject_ctx) or (
                    len(first_tok) >= 3 and re.search(rf"\b{re.escape(first_tok)}\b", subject_ctx)
                ):
                    holder_id = ch.id
                    break
            claims.append(PropClaim(prop_id=prop.id, holder_id=holder_id))
            seen_ids.add(prop.id)
            break
    return claims


def heuristic_world_post_turn_delta(
    *,
    user_message: str,
    raw_prose: str,
    pre_turn: PreTurnAnalysis,
    active_location: LocationNode,
    neighbors: list[NeighborLocationView],
    current_timestamp: str | None = None,
    candidate_secrets: list | None = None,
    prev_player_stance: PhysicalStance = "unspecified",
    prev_player_context: str = "",
    visible_location_props: list[LocationProp] | None = None,
    present_characters: list[CharacterRecord] | None = None,
    other_known_locations: list[CandidateKnownLocation] | None = None,
) -> WorldPostTurnDelta:
    """Deterministic fallback global world state extractor (clock, spatial graph, scene flags)."""
    legacy = _heuristic_spatial_and_inventory_delta(
        user_message=user_message,
        raw_prose=raw_prose,
        pre_turn=pre_turn,
        active_location=active_location,
        neighbors=neighbors,
        current_inventory=None,
        other_known_locations=other_known_locations,
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

    revealed_ids: list[str] = []
    if candidate_secrets and raw_prose:
        prose_low = raw_prose.lower()
        all_rolls = []
        if pre_turn.character_rolls:
            all_rolls.extend(pre_turn.character_rolls.values())
        elif pre_turn.resolved_roll is not None:
            all_rolls.append(pre_turn.resolved_roll)
        has_only_failed = bool(all_rolls) and not any(
            r.outcome_tier in ("Clean Success", "Critical Success") for r in all_rolls
        )
        if not has_only_failed:
            for sec in candidate_secrets:
                title_low = (getattr(sec, "title", "") or "").strip().lower()
                tags = getattr(sec, "entity_tags", None) or []
                if (title_low and len(title_low) >= 4 and title_low in prose_low) or any(
                    len(t.strip()) >= 4 and re.search(rf"\b{re.escape(t.strip().lower())}\b", prose_low)
                    for t in tags
                ):
                    revealed_ids.append(sec.id)

    player_stance, player_ctx = (
        (prev_player_stance, prev_player_context)
        if user_message.strip().lower().startswith("[describe")
        else extract_heuristic_physical_state(
            user_message,
            prev_stance=prev_player_stance,
            prev_context=prev_player_context,
        )
    )

    claimed_props = _extract_heuristic_prop_claims(
        user_message=user_message,
        raw_prose=raw_prose,
        visible_location_props=visible_location_props,
        present_characters=present_characters,
    )

    return WorldPostTurnDelta(
        elapsed_minutes=elapsed,
        new_world_timestamp=new_ts,
        transition_type=legacy.transition_type,
        target_location_id=legacy.target_location_id,
        improvised_location=legacy.improvised_location,
        improvised_link=legacy.improvised_link,
        notable_event_summary=legacy.notable_event_summary,
        scene_flags_updated=legacy.scene_flags_updated,
        scene_flags_removed=legacy.scene_flags_removed,
        revealed_secret_lore_ids=revealed_ids,
        claimed_props=claimed_props,
        major_event=None,
        player_physical_stance=player_stance,
        player_physical_context=player_ctx,
    )
