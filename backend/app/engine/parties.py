"""Pure deterministic engine helpers for parties, /party slash parsing, co-location, and prompt directives."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import random
import re
import uuid

from app.schemas.character import (
    CharacterRecord,
    CharacterStateSnapshot,
    CognitionBlock,
)
from app.schemas.party import (
    USER_PARTY_MEMBER_ID,
    LocationOverrideMoveMode,
    PartyActionSpec,
    PartyEventDelta,
    PartyInviteDecision,
    PartyInviteOutcome,
    PartyRecord,
)
from app.schemas.turn import CanonicalOutcomeTier, PreTurnAnalysis

# ---------------------------------------------------------------------------
# Basic Queries & Formatting
# ---------------------------------------------------------------------------


def find_member_party(
    parties: Sequence[PartyRecord],
    member_id: str,
) -> PartyRecord | None:
    """Return the single active party containing member_id, or None."""
    for party in parties:
        if member_id in party.member_ids:
            return party
    return None


def get_player_party(parties: Sequence[PartyRecord]) -> PartyRecord | None:
    """Return the party containing the player sentinel ('user'), if any."""
    return find_member_party(parties, USER_PARTY_MEMBER_ID)


def get_npc_only_parties(parties: Sequence[PartyRecord]) -> list[PartyRecord]:
    """Return all active parties that do not contain 'user'."""
    return [p for p in parties if USER_PARTY_MEMBER_ID not in p.member_ids]


def get_co_located_player_party_npcs(
    parties: Sequence[PartyRecord],
    active_location_id: str,
) -> list[str]:
    """Return NPC member IDs in the player's party co-located at active_location_id."""
    party = get_player_party(parties)
    if party is None or party.location_id != active_location_id:
        return []
    return [mid for mid in party.member_ids if mid != USER_PARTY_MEMBER_ID]


def default_party_name(
    member_ids: Sequence[str],
    name_map: Mapping[str, str] | None = None,
) -> str:
    """Generate a concise fallback display name for a party."""
    if USER_PARTY_MEMBER_ID in member_ids:
        return "Your Party"
    labels = [
        (name_map or {}).get(mid, mid)
        for mid in member_ids
        if mid != USER_PARTY_MEMBER_ID
    ]
    if not labels:
        return "Companion Group"
    if len(labels) == 2:
        return f"{labels[0]} & {labels[1]}"
    return f"{labels[0]}, {labels[1]} +{len(labels) - 2}"


def elect_party_leader(
    member_ids: Sequence[str],
    *,
    current_leader_id: str | None = None,
    rng: random.Random | None = None,
) -> str:
    """Elect a leader ID: 'user' if present, preserve valid leader, or random NPC."""
    unique_ids = list(dict.fromkeys(member_ids))
    if not unique_ids:
        raise ValueError("Cannot elect a leader for an empty member list.")
    if USER_PARTY_MEMBER_ID in unique_ids:
        return USER_PARTY_MEMBER_ID
    if current_leader_id and current_leader_id in unique_ids:
        return current_leader_id
    chooser = rng or random
    return chooser.choice(unique_ids)


def resolve_character_travel_intent_enum(
    character_id: str,
    active_parties: Sequence[PartyRecord],
    active_location_id: str,
) -> list[str]:
    """Return role-scoped non-nullable travel_intent enum values for Phase 3 grammar."""
    party = find_member_party(active_parties, character_id)
    if party is not None and party.location_id == active_location_id:
        if USER_PARTY_MEMBER_ID in party.member_ids:
            return ["default", "stay_behind"]
        if party.leader_id != character_id:
            return ["default", "stay_behind", "follow_player"]
        return ["default", "follow_player"]
    return ["default", "follow_player"]


# ---------------------------------------------------------------------------
# Strict Co-Location & Single-Party Disjointness Reconciliation (Model 1)
# ---------------------------------------------------------------------------


def reconcile_parties_strict_colocation(
    parties: Sequence[PartyRecord],
    member_locations: Mapping[str, str],
    *,
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> list[PartyRecord]:
    """Enforce Model 1 strict co-location and single-party disjointness.

    - Any member may appear in at most one party (first occurrence wins).
    - Members within a party are clustered by current location.
    - Every cluster of size >= 2 survives as a co-located party (keeping 'user' as
      leader if present, or keeping/randomly electing an NPC leader if 'user' departed).
    - Clusters of size < 2 dissolve cleanly.
    """
    claimed_members: set[str] = set()
    used_party_ids: set[str] = set()
    reconciled: list[PartyRecord] = []

    for party in parties:
        eligible_members: list[str] = []
        for mid in party.member_ids:
            if mid not in claimed_members and mid in member_locations:
                eligible_members.append(mid)
                claimed_members.add(mid)
        if len(eligible_members) < 2:
            continue

        clusters_by_loc: dict[str, list[str]] = {}
        for mid in eligible_members:
            loc_id = member_locations[mid]
            clusters_by_loc.setdefault(loc_id, []).append(mid)

        # Process player cluster first (if any) so it retains the original party ID
        ordered_clusters = sorted(
            clusters_by_loc.items(),
            key=lambda kv: (0 if USER_PARTY_MEMBER_ID in kv[1] else 1),
        )
        for loc_id, cluster_members in ordered_clusters:
            if len(cluster_members) < 2:
                continue
            has_user = USER_PARTY_MEMBER_ID in cluster_members
            prev_had_user = USER_PARTY_MEMBER_ID in party.member_ids
            if party.id not in used_party_ids:
                pid = party.id
            else:
                pid = f"party_{uuid.uuid4().hex[:8]}"
            used_party_ids.add(pid)

            leader = elect_party_leader(
                cluster_members,
                current_leader_id=(
                    USER_PARTY_MEMBER_ID
                    if has_user
                    else (party.leader_id if party.leader_id in cluster_members else None)
                ),
                rng=rng,
            )
            eff_name = party.name
            if not eff_name or (not has_user and prev_had_user and eff_name == "Your Party"):
                eff_name = default_party_name(cluster_members, name_map)

            reconciled.append(
                PartyRecord(
                    id=pid,
                    name=eff_name,
                    member_ids=cluster_members,
                    leader_id=leader,
                    location_id=loc_id,
                    shared_goal=party.shared_goal,
                    formed_at_turn_id=party.formed_at_turn_id or turn_id,
                )
            )
    return reconciled


# ---------------------------------------------------------------------------
# Party Lifecycle Mutations (Leave / Kick / Disband / Invite / NPC CRUD)
# ---------------------------------------------------------------------------


def apply_party_leave(
    parties: Sequence[PartyRecord],
    *,
    active_location_id: str,
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[PartyRecord], PartyEventDelta]:
    """Remove 'user' from their active party; preserve >=2 co-located NPCs as an NPC party."""
    delta = PartyEventDelta(action_kind="leave")
    updated: list[PartyRecord] = []

    for p in parties:
        if USER_PARTY_MEMBER_ID not in p.member_ids:
            updated.append(p)
            continue
        remaining = [m for m in p.member_ids if m != USER_PARTY_MEMBER_ID]
        delta.departed_member_ids.append(USER_PARTY_MEMBER_ID)
        if len(remaining) >= 2:
            new_leader = elect_party_leader(remaining, rng=rng)
            new_name = (
                default_party_name(remaining, name_map)
                if not p.name or p.name == "Your Party"
                else p.name
            )
            updated.append(
                PartyRecord(
                    id=p.id,
                    name=new_name,
                    member_ids=remaining,
                    leader_id=new_leader,
                    location_id=p.location_id or active_location_id,
                    shared_goal=p.shared_goal,
                    formed_at_turn_id=p.formed_at_turn_id or turn_id,
                )
            )
            delta.updated_party_ids.append(p.id)
            leader_label = (name_map or {}).get(new_leader, new_leader)
            delta.notes.append(
                f"You left the party; remaining companions stay together as '{new_name}' (leader: {leader_label})."
            )
        else:
            delta.disbanded_party_ids.append(p.id)
            delta.notes.append("You left the party; the party dissolved.")

    return updated, delta


def apply_party_kick(
    parties: Sequence[PartyRecord],
    target_ids: Sequence[str],
    *,
    name_map: Mapping[str, str] | None = None,
) -> tuple[list[PartyRecord], PartyEventDelta]:
    """Remove target NPC IDs from the player's party cleanly."""
    target_set = set(target_ids)
    delta = PartyEventDelta(action_kind="kick")
    updated: list[PartyRecord] = []

    for p in parties:
        if USER_PARTY_MEMBER_ID not in p.member_ids:
            updated.append(p)
            continue
        kicked_here = [m for m in p.member_ids if m != USER_PARTY_MEMBER_ID and m in target_set]
        remaining = [m for m in p.member_ids if m not in target_set]
        delta.departed_member_ids.extend(kicked_here)
        kicked_names = ", ".join((name_map or {}).get(cid, cid) for cid in kicked_here)
        if len(remaining) >= 2:
            updated.append(
                p.model_copy(
                    update={
                        "member_ids": remaining,
                        "leader_id": USER_PARTY_MEMBER_ID,
                    }
                )
            )
            delta.updated_party_ids.append(p.id)
            if kicked_names:
                delta.notes.append(f"Removed from your party: {kicked_names}.")
        else:
            delta.disbanded_party_ids.append(p.id)
            delta.notes.append(
                f"Removed {kicked_names or 'companion'}; the party dissolved."
            )

    return updated, delta


def apply_party_disband(
    parties: Sequence[PartyRecord],
    party_id: str,
) -> tuple[list[PartyRecord], PartyEventDelta]:
    """Dissolve the specified party completely."""
    delta = PartyEventDelta(action_kind="disband")
    updated: list[PartyRecord] = []
    for p in parties:
        if p.id == party_id:
            delta.disbanded_party_ids.append(p.id)
            delta.departed_member_ids.extend(p.member_ids)
            delta.notes.append(f"Disbanded party '{p.name or p.id}'.")
        else:
            updated.append(p)
    return updated, delta


def apply_party_invite_acceptances(
    parties: Sequence[PartyRecord],
    *,
    accepted_ids: Sequence[str],
    outcomes: Sequence[PartyInviteOutcome],
    active_location_id: str,
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[PartyRecord], PartyEventDelta]:
    """Commit accepted invitees into 'user' party, cleanly splitting from any prior NPC party."""
    accepted_ordered = list(dict.fromkeys(cid for cid in accepted_ids if cid != USER_PARTY_MEMBER_ID))
    accepted_set = set(accepted_ordered)
    delta = PartyEventDelta(action_kind="invite")

    player_party = get_player_party(parties)
    working: list[PartyRecord] = []

    # 1. Remove accepted NPCs from any existing NPC-only party (preserving >=2 or dissolving <2)
    for p in parties:
        if player_party and p.id == player_party.id:
            continue
        removed = [m for m in p.member_ids if m in accepted_set]
        if not removed:
            working.append(p)
            continue
        remaining = [m for m in p.member_ids if m not in accepted_set]
        delta.departed_member_ids.extend(removed)
        if len(remaining) >= 2:
            new_leader = elect_party_leader(
                remaining,
                current_leader_id=p.leader_id if p.leader_id in remaining else None,
                rng=rng,
            )
            working.append(
                p.model_copy(
                    update={
                        "member_ids": remaining,
                        "leader_id": new_leader,
                    }
                )
            )
            delta.updated_party_ids.append(p.id)
        else:
            delta.disbanded_party_ids.append(p.id)

    # 2. Add accepted NPCs to player party (or form a new one)
    joined_party_id: str | None = player_party.id if player_party else None
    if accepted_ordered:
        if player_party is not None:
            new_members = list(dict.fromkeys([*player_party.member_ids, *accepted_ordered]))
            updated_player_party = player_party.model_copy(
                update={
                    "member_ids": new_members,
                    "leader_id": USER_PARTY_MEMBER_ID,
                    "location_id": active_location_id,
                }
            )
            working.insert(0, updated_player_party)
            if updated_player_party.id not in delta.updated_party_ids:
                delta.updated_party_ids.append(updated_player_party.id)
        else:
            pid = f"party_{uuid.uuid4().hex[:8]}"
            joined_party_id = pid
            new_party = PartyRecord(
                id=pid,
                name="Your Party",
                member_ids=[USER_PARTY_MEMBER_ID, *accepted_ordered],
                leader_id=USER_PARTY_MEMBER_ID,
                location_id=active_location_id,
                formed_at_turn_id=turn_id,
            )
            working.insert(0, new_party)
            delta.formed_party_ids.append(pid)
    elif player_party is not None:
        working.insert(0, player_party)

    resolved_outcomes = [
        o.model_copy(
            update={
                "joined_party_id": joined_party_id if o.decision == "accept" else None
            }
        )
        for o in outcomes
    ]
    delta.invite_outcomes = resolved_outcomes
    for o in resolved_outcomes:
        verb = "joined your party" if o.decision == "accept" else "declined the party invitation"
        delta.notes.append(f"{o.character_name} {verb}.")

    return working, delta


def create_npc_only_party(
    parties: Sequence[PartyRecord],
    *,
    member_ids: Sequence[str],
    member_locations: Mapping[str, str],
    name: str | None = None,
    shared_goal: str | None = None,
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[PartyRecord], PartyRecord]:
    """Create a co-located NPC-only party with random leader election, enforcing disjointness."""
    clean_ids = list(dict.fromkeys(str(m).strip() for m in member_ids if str(m).strip()))
    if USER_PARTY_MEMBER_ID in clean_ids:
        raise ValueError("Cannot create an NPC-only party containing 'user'.")
    if len(clean_ids) < 2:
        raise ValueError("An NPC party requires at least 2 distinct characters.")

    for cid in clean_ids:
        if cid not in member_locations:
            raise ValueError(f"Character '{cid}' is not active in this campaign.")
        existing = find_member_party(parties, cid)
        if existing is not None:
            c_label = (name_map or {}).get(cid, cid)
            raise ValueError(
                f"{c_label} already belongs to party '{existing.name or existing.id}'."
            )

    locs = {member_locations[cid] for cid in clean_ids}
    if len(locs) != 1:
        raise ValueError("All members of an NPC party must share the same current location.")
    loc_id = next(iter(locs))

    leader_id = elect_party_leader(clean_ids, rng=rng)
    pid = f"party_{uuid.uuid4().hex[:8]}"
    eff_name = (name or "").strip() or default_party_name(clean_ids, name_map)
    created = PartyRecord(
        id=pid,
        name=eff_name,
        member_ids=clean_ids,
        leader_id=leader_id,
        location_id=loc_id,
        shared_goal=(shared_goal or "").strip() or None,
        formed_at_turn_id=turn_id,
    )
    return [*parties, created], created


# ---------------------------------------------------------------------------
# Phase 5 Deterministic Spatial & Party Reconciliation
# ---------------------------------------------------------------------------


def _delta_location_transition(delta: object | None) -> tuple[str, str | None]:
    if delta is None:
        return "stay_here", None
    return (
        getattr(delta, "location_transition", "stay_here"),
        getattr(delta, "target_location_id", None),
    )


def resolve_phase5_spatial_and_parties(
    *,
    prior_parties: Sequence[PartyRecord],
    start_location_id: str,
    new_player_location_id: str,
    all_character_locations: Mapping[str, str],
    cognitions: Mapping[str, CognitionBlock],
    char_deltas: Mapping[str, object],
    valid_neighbor_ids: set[str],
    is_narrator_turn: bool,
    party_action: PartyActionSpec | None,
    turn_id: str,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[PartyRecord], dict[str, str], PartyEventDelta | None]:
    """Resolve authoritative Phase 5 member locations and Model 1 party state."""
    names = name_map or {}
    player_moved = new_player_location_id != start_location_id
    end_locs: dict[str, str] = {
        cid: loc_id for cid, loc_id in all_character_locations.items()
    }

    # Case A: Narrator turns strictly obey co-located player party rules (never drag non-party NPCs)
    if is_narrator_turn:
        if player_moved:
            player_party = get_player_party(prior_parties)
            co_located_party_npcs = (
                set(player_party.member_ids) - {USER_PARTY_MEMBER_ID}
                if player_party is not None and player_party.location_id == start_location_id
                else set()
            )
            for cid in co_located_party_npcs:
                if all_character_locations.get(cid, start_location_id) == start_location_id:
                    end_locs[cid] = new_player_location_id
        member_locs = {**end_locs, USER_PARTY_MEMBER_ID: new_player_location_id}
        reconciled = reconcile_parties_strict_colocation(
            prior_parties,
            member_locs,
            turn_id=turn_id,
            name_map=names,
            rng=rng,
        )
        return reconciled, end_locs, None

    # Case B: Standard & /party turns
    working_parties = list(prior_parties)
    event_delta: PartyEventDelta | None = None

    if party_action is not None:
        if party_action.kind == "invite":
            current_player_party = get_player_party(working_parties)
            already_in_party = (
                set(current_player_party.member_ids) if current_player_party else set()
            )
            target_ids = list(party_action.target_character_ids)
            if not target_ids:
                target_ids = [
                    cid
                    for cid, loc_id in all_character_locations.items()
                    if loc_id == start_location_id and cid not in already_in_party
                ]
            outcomes: list[PartyInviteOutcome] = []
            accepted_ids: list[str] = []
            for tid in target_ids:
                if tid in already_in_party:
                    continue
                cog = cognitions.get(tid)
                decision: PartyInviteDecision = (
                    "accept"
                    if cog is not None and not cog.skipped and cog.party_invite_decision == "accept"
                    else "refuse"
                )
                reason = (cog.want or cog.feeling or "").strip()[:160] if cog else ""
                outcomes.append(
                    PartyInviteOutcome(
                        character_id=tid,
                        character_name=names.get(tid, tid),
                        decision=decision,
                        reason=reason,
                    )
                )
                if decision == "accept":
                    accepted_ids.append(tid)
            working_parties, event_delta = apply_party_invite_acceptances(
                working_parties,
                accepted_ids=accepted_ids,
                outcomes=outcomes,
                active_location_id=start_location_id,
                turn_id=turn_id,
                name_map=names,
                rng=rng,
            )
        elif party_action.kind == "leave":
            working_parties, event_delta = apply_party_leave(
                working_parties,
                active_location_id=start_location_id,
                turn_id=turn_id,
                name_map=names,
                rng=rng,
            )
        elif party_action.kind == "kick":
            working_parties, event_delta = apply_party_kick(
                working_parties,
                party_action.target_character_ids,
                name_map=names,
            )
        elif party_action.kind == "disband":
            player_party = get_player_party(working_parties)
            if player_party is not None:
                working_parties, event_delta = apply_party_disband(
                    working_parties, player_party.id
                )
            else:
                event_delta = PartyEventDelta(action_kind="disband")

    stayed_behind_ids: list[str] = []
    followed_player_ids: list[str] = []

    def _intent_for(cid: str) -> str:
        cog = cognitions.get(cid)
        if cog is None or cog.skipped:
            return "default"
        return getattr(cog, "travel_intent", "default") or "default"

    # Resolve co-located characters
    npc_parties_at_start = [
        p
        for p in working_parties
        if USER_PARTY_MEMBER_ID not in p.member_ids and p.location_id == start_location_id
    ]
    npc_leader_dest: dict[str, str] = {}

    for npc_party in npc_parties_at_start:
        lid = npc_party.leader_id
        l_intent = _intent_for(lid)
        l_trans, l_target = _delta_location_transition(char_deltas.get(lid))
        if player_moved and l_intent == "follow_player":
            l_dest = new_player_location_id
            followed_player_ids.append(lid)
        elif (
            not player_moved
            and l_trans == "move_to_neighbor"
            and l_target in valid_neighbor_ids
        ):
            l_dest = str(l_target)
        else:
            l_dest = start_location_id
            if player_moved:
                stayed_behind_ids.append(lid)
        npc_leader_dest[npc_party.id] = l_dest
        end_locs[lid] = l_dest

    for cid, orig_loc in all_character_locations.items():
        if orig_loc != start_location_id:
            continue
        party = find_member_party(working_parties, cid)
        intent = _intent_for(cid)
        c_trans, c_target = _delta_location_transition(char_deltas.get(cid))

        if party is not None and USER_PARTY_MEMBER_ID in party.member_ids:
            if player_moved:
                if intent == "stay_behind":
                    end_locs[cid] = start_location_id
                    stayed_behind_ids.append(cid)
                else:
                    end_locs[cid] = new_player_location_id
                    followed_player_ids.append(cid)
            elif c_trans == "move_to_neighbor" and c_target in valid_neighbor_ids:
                end_locs[cid] = str(c_target)
            else:
                end_locs[cid] = start_location_id
        elif party is not None:
            # NPC-only party member
            if cid == party.leader_id:
                continue  # Already resolved above
            l_dest = npc_leader_dest.get(party.id, start_location_id)
            if player_moved and intent == "follow_player":
                end_locs[cid] = new_player_location_id
                followed_player_ids.append(cid)
            elif l_dest != start_location_id:
                if intent == "stay_behind":
                    end_locs[cid] = start_location_id
                    if player_moved:
                        stayed_behind_ids.append(cid)
                elif (
                    not player_moved
                    and c_trans == "move_to_neighbor"
                    and c_target in valid_neighbor_ids
                    and c_target != l_dest
                ):
                    end_locs[cid] = str(c_target)
                else:
                    end_locs[cid] = l_dest
            elif not player_moved and c_trans == "move_to_neighbor" and c_target in valid_neighbor_ids:
                end_locs[cid] = str(c_target)
            else:
                end_locs[cid] = start_location_id
                if player_moved:
                    stayed_behind_ids.append(cid)
        else:
            # Solo non-party character
            if player_moved:
                if intent == "follow_player":
                    end_locs[cid] = new_player_location_id
                    followed_player_ids.append(cid)
                else:
                    end_locs[cid] = start_location_id
                    stayed_behind_ids.append(cid)
            elif c_trans == "move_to_neighbor" and c_target in valid_neighbor_ids:
                end_locs[cid] = str(c_target)
            else:
                end_locs[cid] = start_location_id

    member_locs_final = {**end_locs, USER_PARTY_MEMBER_ID: new_player_location_id}
    reconciled = reconcile_parties_strict_colocation(
        working_parties,
        member_locs_final,
        turn_id=turn_id,
        name_map=names,
        rng=rng,
    )

    # Track any additional splits/formations caused by movement
    working_ids = {p.id for p in working_parties}
    reconciled_by_id = {p.id: p for p in reconciled}
    prior_by_id = {p.id: p for p in prior_parties}
    has_split_or_travel_event = (
        event_delta is not None
        or player_moved
        or len(reconciled) != len(prior_parties)
        or any(pid not in reconciled_by_id for pid in prior_by_id)
        or any(
            pid not in prior_by_id
            or reconciled_by_id[pid].member_ids != prior_by_id[pid].member_ids
            or reconciled_by_id[pid].location_id != prior_by_id[pid].location_id
            for pid in reconciled_by_id
        )
    )
    if has_split_or_travel_event:
        if event_delta is None:
            event_delta = PartyEventDelta()
        event_delta.stayed_behind_ids = list(dict.fromkeys(stayed_behind_ids))
        event_delta.followed_player_ids = list(dict.fromkeys(followed_player_ids))
        for pid, p in reconciled_by_id.items():
            if pid not in working_ids and pid not in prior_by_id:
                if pid not in event_delta.formed_party_ids:
                    event_delta.formed_party_ids.append(pid)
            elif pid in prior_by_id and p.member_ids != prior_by_id[pid].member_ids:
                if pid not in event_delta.updated_party_ids:
                    event_delta.updated_party_ids.append(pid)
        for pid in prior_by_id:
            if pid not in reconciled_by_id and pid not in event_delta.disbanded_party_ids:
                event_delta.disbanded_party_ids.append(pid)

    return reconciled, end_locs, event_delta


# ---------------------------------------------------------------------------
# Manual Location Override Resolvers
# ---------------------------------------------------------------------------


def resolve_location_override_movement(
    *,
    prior_parties: Sequence[PartyRecord],
    old_loc_id: str,
    target_loc_id: str,
    all_char_locations: Mapping[str, str],
    move_mode: LocationOverrideMoveMode = "party",
    accompanying_character_ids: Sequence[str] | None = None,
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[PartyRecord], dict[str, str], set[str]]:
    """Compute new NPC locations and reconciled parties for a player location override."""
    co_party_npcs = get_co_located_player_party_npcs(prior_parties, old_loc_id)
    co_party_set = {
        cid
        for cid in co_party_npcs
        if all_char_locations.get(cid, old_loc_id) == old_loc_id
    }

    moving_npcs: set[str] = set()
    if move_mode == "party":
        moving_npcs = set(co_party_set)
    elif move_mode == "alone":
        moving_npcs = set()
    elif move_mode == "subset":
        for cid in accompanying_character_ids or []:
            if cid not in co_party_set:
                raise ValueError(
                    f"Character '{cid}' is not a co-located member of your current party."
                )
            moving_npcs.add(cid)
    else:
        raise ValueError(f"Unsupported move_mode '{move_mode}'.")

    end_locs = dict(all_char_locations)
    for cid in moving_npcs:
        end_locs[cid] = target_loc_id

    member_locs = {**end_locs, USER_PARTY_MEMBER_ID: target_loc_id}
    reconciled = reconcile_parties_strict_colocation(
        prior_parties,
        member_locs,
        turn_id=turn_id,
        name_map=name_map,
        rng=rng,
    )
    return reconciled, end_locs, moving_npcs


def resolve_character_location_override(
    *,
    prior_parties: Sequence[PartyRecord],
    character_id: str,
    target_location_id: str,
    active_location_id: str,
    all_char_locations: Mapping[str, str],
    turn_id: str | None = None,
    name_map: Mapping[str, str] | None = None,
    rng: random.Random | None = None,
) -> list[PartyRecord]:
    """Update a single NPC's location and strictly reconcile parties without touching player location."""
    end_locs = dict(all_char_locations)
    end_locs[character_id] = target_location_id
    member_locs = {**end_locs, USER_PARTY_MEMBER_ID: active_location_id}
    return reconcile_parties_strict_colocation(
        prior_parties,
        member_locs,
        turn_id=turn_id,
        name_map=name_map,
        rng=rng,
    )


# ---------------------------------------------------------------------------
# /party Slash Command Parsing & Strict Validation
# ---------------------------------------------------------------------------


def is_party_slash_command(raw_text: str) -> bool:
    """Return True if raw_text begins with /party (standalone or with arguments)."""
    trimmed = (raw_text or "").strip()
    return bool(re.match(r"^/party(?=\s|$)", trimmed, flags=re.IGNORECASE))


def _match_at_target_prefix(
    body_after_at: str,
    characters: Sequence[CharacterRecord],
) -> tuple[CharacterRecord | None, str, str | None]:
    """Match the longest character name (or unambiguous first name) after '@'.

    Returns (matched_character, remaining_text, error_message).
    """
    candidates_sorted = sorted(
        characters,
        key=lambda c: len(c.name.strip()),
        reverse=True,
    )
    body_low = body_after_at.lower()

    # 1. Exact full-name prefix match (longest first)
    for ch in candidates_sorted:
        cname = ch.name.strip()
        if not cname:
            continue
        clen = len(cname)
        if body_low.startswith(cname.lower()):
            if clen == len(body_after_at) or (
                body_after_at[clen].isspace() or body_after_at[clen] in ",;:"
            ):
                rest = body_after_at[clen:].lstrip(" ,;:\t")
                return ch, rest, None

    # 2. First-token match (if unambiguous across campaign roster)
    tok_match = re.match(r"^([^\s,;:@]+)(.*)$", body_after_at, flags=re.DOTALL)
    token = tok_match.group(1) if tok_match else ""
    rest_after_token = (tok_match.group(2) if tok_match else "").lstrip(" ,;:\t")
    token_low = token.lower()
    if token_low:
        first_matches = [
            ch
            for ch in characters
            if ch.name.strip().split()
            and ch.name.strip().split()[0].lower() == token_low
        ]
        if len(first_matches) == 1:
            return first_matches[0], rest_after_token, None
        if len(first_matches) > 1:
            names_list = ", ".join(c.name for c in first_matches)
            return (
                None,
                "",
                f"Ambiguous character name '@{token}' (matches {names_list}); use the full @Full Name.",
            )

    bad_label = token or body_after_at.split()[0] if body_after_at.strip() else ""
    return (
        None,
        "",
        f"Unknown character '@{bad_label}' — use @ autocomplete to pick an exact character.",
    )


def _extract_chained_at_targets(
    body: str,
    characters: Sequence[CharacterRecord],
) -> tuple[list[CharacterRecord], str | None, str | None]:
    """Consume consecutive leading @Character mentions and return (targets, trailing_msg, error)."""
    targets: list[CharacterRecord] = []
    seen_ids: set[str] = set()
    cursor = body.lstrip()

    while cursor.startswith("@"):
        matched, rest, err = _match_at_target_prefix(cursor[1:], characters)
        if err is not None:
            return [], None, err
        assert matched is not None
        if matched.id not in seen_ids:
            seen_ids.add(matched.id)
            targets.append(matched)
        cursor = rest.lstrip()

    trailing = cursor.strip() or None
    return targets, trailing, None


def parse_party_slash_command(
    raw_text: str,
    *,
    all_characters: Sequence[CharacterRecord],
    present_character_ids: set[str],
    active_parties: Sequence[PartyRecord],
    location_name_by_id: Mapping[str, str] | None = None,
    char_locations: Mapping[str, str] | None = None,
) -> tuple[PartyActionSpec | None, str | None]:
    """Parse /party commands strictly without falling back to invite-all on bad targets.

    Returns (PartyActionSpec, error_message). Exactly one is non-None on valid/invalid /party commands.
    Returns (None, None) if raw_text is not a /party command.
    """
    if not is_party_slash_command(raw_text):
        return None, None

    trimmed = raw_text.strip()
    after_cmd = trimmed[len("/party") :].lstrip()
    player_party = get_player_party(active_parties)
    party_member_ids = (
        set(player_party.member_ids) - {USER_PARTY_MEMBER_ID}
        if player_party
        else set()
    )

    if not after_cmd:
        # Bare /party -> invite all eligible co-located NPCs
        eligible = [cid for cid in present_character_ids if cid not in party_member_ids]
        if not present_character_ids:
            return None, "No characters are present in this location to invite."
        if not eligible:
            return None, "Everyone present in this location is already in your party."
        return PartyActionSpec(kind="invite", target_character_ids=eligible, source="slash_command"), None

    sub_match = re.match(r"^(leave|kick|disband|invite)(?=\s|$)(.*)$", after_cmd, flags=re.I | re.DOTALL)
    sub_cmd = sub_match.group(1).lower() if sub_match else "invite"
    rest_body = sub_match.group(2).lstrip() if sub_match else after_cmd

    if sub_cmd == "leave":
        if player_party is None:
            return None, "You are not currently in a party."
        msg = rest_body.strip() or None
        return PartyActionSpec(kind="leave", target_character_ids=[], message=msg, source="slash_command"), None

    if sub_cmd == "disband":
        if player_party is None:
            return None, "You are not currently in a party."
        msg = rest_body.strip() or None
        return PartyActionSpec(kind="disband", target_character_ids=[], message=msg, source="slash_command"), None

    if sub_cmd == "kick":
        if player_party is None:
            return None, "You are not currently in a party."
        if not rest_body.startswith("@"):
            return None, "Specify which companion to remove using /party kick @Character Name."
        targets, trailing_msg, err = _extract_chained_at_targets(rest_body, all_characters)
        if err is not None:
            return None, err
        if not targets:
            return None, "Specify at least one @Character Name to remove from your party."
        for ch in targets:
            if ch.id not in party_member_ids:
                return None, f"{ch.name} is not currently in your party."
        return (
            PartyActionSpec(
                kind="kick",
                target_character_ids=[ch.id for ch in targets],
                message=trailing_msg,
                source="slash_command",
            ),
            None,
        )

    # sub_cmd == "invite" (explicit `/party invite ...` or `/party ...`)
    if not rest_body:
        eligible = [cid for cid in present_character_ids if cid not in party_member_ids]
        if not present_character_ids:
            return None, "No characters are present in this location to invite."
        if not eligible:
            return None, "Everyone present in this location is already in your party."
        return PartyActionSpec(kind="invite", target_character_ids=eligible, source="slash_command"), None

    if rest_body.startswith("@"):
        targets, trailing_msg, err = _extract_chained_at_targets(rest_body, all_characters)
        if err is not None:
            return None, err
        if not targets:
            return None, "Specify a valid @Character Name to invite."
        for ch in targets:
            if ch.id in party_member_ids:
                return None, f"{ch.name} is already in your party."
            if ch.id not in present_character_ids:
                loc_id = (char_locations or {}).get(ch.id)
                loc_label = (location_name_by_id or {}).get(loc_id, "") if loc_id else ""
                loc_suffix = f" (currently in {loc_label})" if loc_label else ""
                return None, f"{ch.name} is not present in this location{loc_suffix} to invite."
        return (
            PartyActionSpec(
                kind="invite",
                target_character_ids=[ch.id for ch in targets],
                message=trailing_msg,
                source="slash_command",
            ),
            None,
        )

    # Invite all present non-party NPCs with pitch message
    eligible = [cid for cid in present_character_ids if cid not in party_member_ids]
    if not present_character_ids:
        return None, "No characters are present in this location to invite."
    if not eligible:
        return None, "Everyone present in this location is already in your party."
    return (
        PartyActionSpec(
            kind="invite",
            target_character_ids=eligible,
            message=rest_body.strip() or None,
            source="slash_command",
        ),
        None,
    )


def validate_party_action(
    action: PartyActionSpec,
    *,
    all_characters: Sequence[CharacterRecord],
    present_character_ids: set[str],
    active_parties: Sequence[PartyRecord],
) -> PartyActionSpec:
    """Validate and normalize an explicit PartyActionSpec against live room and party state."""
    char_by_id = {c.id: c for c in all_characters}
    player_party = get_player_party(active_parties)
    party_member_ids = (
        set(player_party.member_ids) - {USER_PARTY_MEMBER_ID}
        if player_party
        else set()
    )

    if action.kind in ("leave", "disband"):
        if player_party is None:
            raise ValueError("You are not currently in a party.")
        return action.model_copy(update={"target_character_ids": []})

    if action.kind == "kick":
        if player_party is None:
            raise ValueError("You are not currently in a party.")
        if not action.target_character_ids:
            raise ValueError("Specify at least one party member to remove.")
        for tid in action.target_character_ids:
            if tid not in party_member_ids:
                label = char_by_id[tid].name if tid in char_by_id else tid
                raise ValueError(f"{label} is not currently in your party.")
        return action

    # kind == "invite"
    if action.target_character_ids:
        for tid in action.target_character_ids:
            if tid not in char_by_id:
                raise ValueError(f"Unknown campaign character '{tid}'.")
            if tid in party_member_ids:
                raise ValueError(f"{char_by_id[tid].name} is already in your party.")
            if tid not in present_character_ids:
                raise ValueError(f"{char_by_id[tid].name} is not present in this location.")
        return action

    eligible = [c.id for c in all_characters if c.id in present_character_ids and c.id not in party_member_ids]
    if not eligible:
        if not present_character_ids:
            raise ValueError("No characters are present in this location to invite.")
        raise ValueError("Everyone present in this location is already in your party.")
    return action.model_copy(update={"target_character_ids": eligible})


def synthesize_party_action_message(
    action: PartyActionSpec,
    name_map: Mapping[str, str] | None = None,
) -> str:
    """Build a concise user-facing turn message summarizing a /party command or modal action."""
    names = name_map or {}
    target_labels = [names.get(cid, cid) for cid in action.target_character_ids]
    pitch = f" — \"{action.message}\"" if action.message else ""

    if action.kind == "invite":
        if target_labels:
            return f"[Party Invite to {', '.join(target_labels)}]{pitch}"
        return f"[Party Invite to everyone here]{pitch}"
    if action.kind == "leave":
        return f"[Leave Party]{pitch}"
    if action.kind == "kick":
        who = ", ".join(target_labels) if target_labels else "companion"
        return f"[Dismissed {who} from Party]{pitch}"
    return f"[Disband Party]{pitch}"


# ---------------------------------------------------------------------------
# Phase 3 & Zone 4 Context Renderers (Zero Raw Floats, Zero Zone 1 Leakage)
# ---------------------------------------------------------------------------


def _describe_care_edge_qualitative(rel_edge: object | None) -> str:
    """Summarize a CARE RelEdge cleanly without leaking raw numeric floats."""
    if rel_edge is None:
        return "Neutral acquaintance"
    warmth = float(getattr(rel_edge, "warmth", 0.0))
    trust = float(getattr(rel_edge, "trust", 0.35))
    grievance = float(getattr(rel_edge, "grievance", 0.0))

    warm_label = (
        "Close warmth" if warmth >= 0.5
        else "Warm" if warmth >= 0.2
        else "Hostile" if warmth <= -0.35
        else "Guarded" if warmth < -0.05
        else "Steady"
    )
    trust_label = (
        "High trust" if trust >= 0.72
        else "Solid trust" if trust >= 0.55
        else "Low trust" if trust < 0.30
        else "Uncertain trust"
    )
    griev_note = ", unresolved grievance" if grievance >= 0.35 else ""
    return f"{warm_label} / {trust_label}{griev_note}"


def build_party_invite_roll_directives(
    outcome_tier: CanonicalOutcomeTier,
    *,
    character_name: str,
    player_name: str | None = None,
) -> tuple[str, str]:
    """Return (plan_directive, narrative_directive) with unambiguous player-sided weighted-persuasion polarity."""
    player_label = (player_name or "Player").strip() or "Player"
    char_label = (character_name or "target").strip() or "target"

    if outcome_tier == "Critical Success":
        plan = (
            f"{player_label}'s recruitment pitch lands with extraordinary persuasive force and credibility; "
            f"weigh strongly toward `party_invite_decision='accept'` unless an unbreakable core boundary, "
            f"deep hostility, or absolute loyalty conflict makes joining {player_label} impossible."
        )
        narr = (
            f"{player_label}'s persuasion pitch to {char_label} lands with extraordinary force (Critical Success), "
            f"strongly pulling {char_label} toward accepting the party invitation."
        )
    elif outcome_tier == "Clean Success":
        plan = (
            f"{player_label}'s recruitment pitch is genuinely persuasive and credible; "
            f"weigh positively toward `party_invite_decision='accept'` when compatible with current trust, motives, and loyalties."
        )
        narr = (
            f"{player_label}'s persuasion pitch to {char_label} lands cleanly (Clean Success), "
            f"giving {char_label} genuine reason to accept if motives align."
        )
    elif outcome_tier == "Simple Failure":
        plan = (
            f"{player_label}'s recruitment pitch falls flat without causing offense; "
            f"rely on existing trust, motives, and loyalties (lean toward `party_invite_decision='refuse'` unless already inclined to join)."
        )
        narr = (
            f"{player_label}'s persuasion pitch to {char_label} falls flat without offense (Simple Failure), "
            f"gaining no extra leverage over {char_label}'s existing stance."
        )
    elif outcome_tier == "Failure with Consequences":
        plan = (
            f"{player_label}'s recruitment pitch lands clumsily, raising skepticism or friction; "
            f"weigh strongly toward `party_invite_decision='refuse'` unless overwhelming self-interest overrides {char_label}'s misgivings."
        )
        narr = (
            f"{player_label}'s persuasion pitch to {char_label} falters awkwardly (Failure with Consequences), "
            f"provoking skepticism or friction against joining."
        )
    else:  # Critical Failure
        plan = (
            f"{player_label}'s recruitment pitch backfires badly, provoking sharp distrust or irritation; "
            f"weigh heavily toward `party_invite_decision='refuse'`."
        )
        narr = (
            f"{player_label}'s persuasion pitch to {char_label} backfires badly (Critical Failure), "
            f"triggering sharp distrust or refusal."
        )
    return plan, narr


def render_cognition_party_context(
    *,
    character_id: str,
    character_name: str,
    active_parties: Sequence[PartyRecord],
    active_location_id: str,
    pre_turn: PreTurnAnalysis,
    character_name_map: Mapping[str, str],
    character_state: CharacterStateSnapshot | None = None,
    persona_name: str | None = None,
) -> str:
    """Render concise party membership, anti-sycophancy invite, and travel guidance for Phase 3."""
    sections: list[str] = []
    player_label = (persona_name or "Player").strip() or "Player"
    char_party = find_member_party(active_parties, character_id)

    # 1. Current party allegiance note
    if char_party is not None and char_party.location_id == active_location_id:
        if USER_PARTY_MEMBER_ID in char_party.member_ids:
            others = [
                character_name_map.get(m, m)
                for m in char_party.member_ids
                if m not in (USER_PARTY_MEMBER_ID, character_id)
            ]
            with_str = f" with {player_label}" + (f" and {', '.join(others)}" if others else "")
            sections.append(
                f"Party Status: You are traveling in {player_label}'s party{with_str} (leader: {player_label})."
            )
        else:
            leader_label = character_name_map.get(char_party.leader_id, char_party.leader_id)
            others = [
                character_name_map.get(m, m)
                for m in char_party.member_ids
                if m != character_id
            ]
            role_note = "You are the LEADER of this group." if char_party.leader_id == character_id else f"Leader: {leader_label}."
            sections.append(
                f"Party Status: You belong to NPC party '{char_party.name or 'Group'}' alongside {', '.join(others)}. {role_note}"
            )
    else:
        sections.append(f"Party Status: You are NOT in {player_label}'s party (independent actor here).")

    # 2. Party action context (invite / leave / kick / disband)
    p_action = pre_turn.party_action
    if p_action is not None:
        if p_action.kind == "invite":
            pitch_line = f'Invitation Message from {player_label}: "{p_action.message}"\n' if p_action.message else ""
            if character_id in p_action.target_character_ids:
                loyalty_block = ""
                if char_party is not None and USER_PARTY_MEMBER_ID not in char_party.member_ids:
                    companions = [m for m in char_party.member_ids if m != character_id]
                    care_relations = (
                        character_state.care_state.relations
                        if character_state and character_state.care_state
                        else {}
                    )
                    comp_lines = [
                        f"  - {character_name_map.get(mid, mid)} "
                        f"({'Leader' if mid == char_party.leader_id else 'Member'}: "
                        f"{_describe_care_edge_qualitative(care_relations.get(mid))})"
                        for mid in companions
                    ]
                    loyalty_block = (
                        f"EXISTING NPC-PARTY LOYALTY CONTEXT:\n"
                        f"- You are currently committed to '{char_party.name or 'Group'}' (leader: "
                        f"{'YOU' if char_party.leader_id == character_id else character_name_map.get(char_party.leader_id, char_party.leader_id)}).\n"
                        + "\n".join(comp_lines)
                        + "\n- CRITICAL: Accepting this invitation means LEAVING your current companions behind.\n"
                    )
                sections.append(
                    "<party_invite_evaluation>\n"
                    f"{player_label} is inviting {character_name} to join their traveling party.\n"
                    f"{pitch_line}"
                    f"{loyalty_block}"
                    "ANTI-SYCOPHANCY DECISION PROTOCOL (Required field `party_invite_decision`):\n"
                    f"- Evaluate authentically from <internal_affective_state>, Trust/Warmth/Grievance toward {player_label}, "
                    "your Core Drive, Core Fear, active goals/obligations here, any persuasion roll tier, and existing party loyalty.\n"
                    f"- ROLL POLARITY (Weighted Persuasion): Any persuasion check above measures how effectively {player_label}'s pitch landed "
                    "(Success / Critical Success pulls toward `accept`; Failure / Critical Failure pulls toward `refuse`), NOT your willpower to resist. "
                    "Strong persuasion sways neutral or skeptical characters toward accepting, though deep hostility or unbreakable boundaries can still refuse.\n"
                    "- Set `party_invite_decision='refuse'` whenever distrust, grievances, conflicting motives, loyalty to your "
                    "current companions/post, or a failed persuasion check outweighs the pitch. Do NOT blindly appease the player.\n"
                    "- Set `party_invite_decision='accept'` when trust, leverage, survival, or a persuasive roll genuinely justifies joining.\n"
                    "</party_invite_evaluation>"
                )
            else:
                invited_names = ", ".join(character_name_map.get(t, t) for t in p_action.target_character_ids)
                sections.append(
                    f"Scene Party Event: {player_label} invited {invited_names} to join a party. "
                    f"{pitch_line.strip()} React naturally from your perspective."
                )
        elif p_action.kind == "leave":
            pitch_line = f' Parting words: "{p_action.message}".' if p_action.message else ""
            if char_party is not None and USER_PARTY_MEMBER_ID in char_party.member_ids:
                remaining_npcs = [m for m in char_party.member_ids if m != USER_PARTY_MEMBER_ID]
                group_note = (
                    "The remaining companions stay together as a separate NPC group."
                    if len(remaining_npcs) >= 2
                    else "Your partnership with the player has ended."
                )
                sections.append(
                    f"<party_event type=\"leave\">{player_label} has unilaterally chosen to leave your party.{pitch_line} "
                    f"{group_note} Process the emotional and tactical impact honestly.</party_event>"
                )
        elif p_action.kind == "kick":
            kicked_names = ", ".join(character_name_map.get(t, t) for t in p_action.target_character_ids)
            pitch_line = f' Reason/words given: "{p_action.message}".' if p_action.message else ""
            if character_id in p_action.target_character_ids:
                sections.append(
                    f"<party_event type=\"kick\">{player_label} just kicked YOU out of the party.{pitch_line} "
                    "Reflect your genuine emotional reaction, pride, grievance, or relief.</party_event>"
                )
            else:
                sections.append(
                    f"<party_event type=\"kick\">{player_label} removed {kicked_names} from the party.{pitch_line}</party_event>"
                )
        elif p_action.kind == "disband":
            pitch_line = f' Parting words: "{p_action.message}".' if p_action.message else ""
            sections.append(
                f"<party_event type=\"disband\">{player_label} just formally disbanded the party.{pitch_line} "
                "Reflect your genuine reaction to going your separate ways.</party_event>"
            )

    # 3. Spatial travel_intent guidance ONLY when moving this turn
    if pre_turn.spatial_intent != "stay":
        dest_hint = pre_turn.target_location_hint or "another location"
        if char_party is not None and char_party.location_id == active_location_id:
            if USER_PARTY_MEMBER_ID in char_party.member_ids:
                sections.append(
                    f"<travel_intent_guidance>You are in {player_label}'s party while they attempt to travel to '{dest_hint}'. "
                    "Set `travel_intent='default'` to move together as part of the party, OR `travel_intent='stay_behind'` "
                    "ONLY if you deliberately split off to remain behind (or were explicitly told to wait here).</travel_intent_guidance>"
                )
            elif char_party.leader_id != character_id:
                leader_label = character_name_map.get(char_party.leader_id, char_party.leader_id)
                sections.append(
                    f"<travel_intent_guidance>You follow your NPC party leader {leader_label}, not {player_label}. "
                    "Set `travel_intent='default'` to stay with your group, `'follow_player'` to break toward "
                    f"{player_label}'s destination '{dest_hint}', or `'stay_behind'` to stay put.</travel_intent_guidance>"
                )
            else:
                sections.append(
                    f"<travel_intent_guidance>As leader of an independent NPC group (NOT in {player_label}'s party), "
                    f"you stay put (`travel_intent='default'`) unless you actively decide to follow {player_label} "
                    "(`travel_intent='follow_player'`).</travel_intent_guidance>"
                )
        else:
            sections.append(
                f"<travel_intent_guidance>You are NOT in {player_label}'s party as they move toward '{dest_hint}'. "
                "You remain here in this room (`travel_intent='default'`) unless your own goals compel you to "
                "follow them (`travel_intent='follow_player'`).</travel_intent_guidance>"
            )

    return "\n".join(sections)


def render_zone4_party_and_movement_blocks(
    *,
    active_parties: Sequence[PartyRecord],
    active_location_id: str,
    active_location_name: str,
    present_characters: Sequence[CharacterRecord],
    pre_turn: PreTurnAnalysis,
    established_cognitions: Mapping[str, CognitionBlock] | None = None,
    character_name_map: Mapping[str, str] | None = None,
    persona_name: str | None = None,
) -> str:
    """Render conditional Zone 4 <active_parties>, party events, and <movement_resolution> directives."""
    blocks: list[str] = []
    names = {c.id: c.name for c in present_characters}
    if character_name_map:
        names.update(character_name_map)
    player_label = (persona_name or "Player").strip() or "Player"
    cogs = established_cognitions or {}

    # 1. Active parties in current room (strictly in Zone 4, never Zone 1)
    co_located_parties = [p for p in active_parties if p.location_id == active_location_id]
    if co_located_parties:
        p_lines: list[str] = []
        for p in co_located_parties:
            kind_tag = "player_party" if USER_PARTY_MEMBER_ID in p.member_ids else "npc_party"
            members_str = ", ".join(
                player_label if m == USER_PARTY_MEMBER_ID else names.get(m, m)
                for m in p.member_ids
            )
            leader_str = player_label if p.leader_id == USER_PARTY_MEMBER_ID else names.get(p.leader_id, p.leader_id)
            goal_str = f' goal="{p.shared_goal}"' if p.shared_goal else ""
            p_lines.append(
                f'    <party name="{p.name or kind_tag}" type="{kind_tag}" leader="{leader_str}"{goal_str}>'
                f"{members_str}</party>"
            )
        blocks.append("  <active_parties>\n" + "\n".join(p_lines) + "\n  </active_parties>")

    # 2. Party Action directives for Phase 4 prose
    p_action = pre_turn.party_action
    if p_action is not None:
        if p_action.kind == "invite":
            out_lines: list[str] = []
            for tid in p_action.target_character_ids:
                cname = names.get(tid, tid)
                cog = cogs.get(tid)
                dec = (
                    "ACCEPT"
                    if cog is not None and not cog.skipped and cog.party_invite_decision == "accept"
                    else "REFUSE"
                )
                note = f" — Aim: {cog.want}" if cog and cog.want else ""
                out_lines.append(f"    - {cname}: {dec}{note}")
            if out_lines:
                blocks.append(
                    "  <party_invite_outcomes>\n"
                    + "\n".join(out_lines)
                    + "\n    CRITICAL: Prose MUST depict each invited character accepting or refusing strictly matching above.\n"
                    "  </party_invite_outcomes>"
                )
        elif p_action.kind == "leave":
            blocks.append(
                f'  <party_event type="leave">{player_label} left the party cleanly. '
                f'Depict remaining companions reacting naturally to parting ways.</party_event>'
            )
        elif p_action.kind == "kick":
            kicked = ", ".join(names.get(t, t) for t in p_action.target_character_ids)
            blocks.append(
                f'  <party_event type="kick">{player_label} removed {kicked} from the party. '
                "Depict the dismissal and immediate in-character reaction.</party_event>"
            )
        elif p_action.kind == "disband":
            blocks.append(
                f'  <party_event type="disband">{player_label} disbanded the party completely. '
                "Depict everyone reacting to the end of the group.</party_event>"
            )

    # 3. Conditional <movement_resolution> STRICTLY when pre_turn.spatial_intent != "stay"
    if pre_turn.spatial_intent != "stay" and present_characters:
        dest_label = pre_turn.target_location_hint or "the destination"
        moving_with: list[str] = []
        staying_behind: list[str] = []

        # Track whether an NPC-only party leader in the room chose follow_player
        npc_leader_following_player: dict[str, bool] = {}
        for p in co_located_parties:
            if USER_PARTY_MEMBER_ID in p.member_ids:
                continue
            lcog = cogs.get(p.leader_id)
            l_int = getattr(lcog, "travel_intent", "default") if (lcog and not lcog.skipped) else "default"
            npc_leader_following_player[p.id] = l_int == "follow_player"

        for ch in present_characters:
            party = find_member_party(active_parties, ch.id)
            cog = cogs.get(ch.id)
            intent = getattr(cog, "travel_intent", "default") if (cog and not cog.skipped) else "default"
            if party is not None and party.location_id == active_location_id:
                if USER_PARTY_MEMBER_ID in party.member_ids:
                    will_move = intent != "stay_behind"
                elif ch.id == party.leader_id:
                    will_move = intent == "follow_player"
                else:
                    will_move = intent == "follow_player" or (
                        npc_leader_following_player.get(party.id, False) and intent != "stay_behind"
                    )
            else:
                will_move = intent == "follow_player"

            if will_move:
                moving_with.append(ch.name)
            else:
                staying_behind.append(ch.name)

        move_str = ", ".join(moving_with) if moving_with else f"None ({player_label} travels alone)"
        stay_str = ", ".join(staying_behind) if staying_behind else "None"
        stay_rule = (
            f"Characters listed under Staying Behind MUST remain at {active_location_name} in your prose and MUST NOT arrive at {dest_label}."
            if staying_behind
            else "All present companions accompany the movement if it succeeds."
        )
        blocks.append(
            f'  <movement_resolution destination="{dest_label}" origin="{active_location_name}">\n'
            f"    If {player_label}'s movement succeeds:\n"
            f"    - Moving with {player_label}: {move_str}\n"
            f"    - Staying Behind in {active_location_name}: {stay_str}\n"
            f"    CRITICAL: {stay_rule}\n"
            "  </movement_resolution>"
        )

    if not blocks:
        return ""
    return "\n" + "\n".join(blocks)
