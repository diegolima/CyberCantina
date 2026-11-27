"""Tests for runtime spatial improvisation: travel cue parsing, 2D geometry clamping,
non-adjacent connect_existing, multi-hop move_existing, duplicate-name guards, and secret isolation.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.clerk.heuristics import heuristic_world_post_turn_delta
from app.engine.clerk.pipeline import run_phase5_post_turn_clerk
from app.engine.llm_client import llm_client
from app.engine.phase1_pre import _build_heuristic_llm_output
from app.engine.spatial_geometry import (
    estimate_euclidean_offset,
    extract_travel_cues,
    find_shortest_visible_path,
    select_candidate_known_locations,
)
from app.schemas.character import CharacterStateSnapshot, CognitionBlock
from app.schemas.turn import (
    ImprovisedLinkSpec,
    ImprovisedLocationSpec,
    MechanicsTrigger,
    PreTurnAnalysis,
    TurnNodeRecord,
    WorldPostTurnDelta,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationEdge,
    LocationEdgeDraft,
    LocationNodeDraft,
    WorldGlobalRules,
)
from tests.factories import seed_campaign, seed_character, seed_user, seed_world


def _setup_plaza_bar_world(repo: CantinaRepository):
    user = seed_user(repo, username="walker", user_id="u_walker")
    world = seed_world(
        repo,
        owner_id=user.id,
        name="City Grid",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk",
            tone="Grounded",
            setting_overview="District blocks around a central plaza.",
            starting_timestamp="2099-05-01 12:00",
        ),
        locations=[
            LocationNodeDraft(
                key="plaza",
                name="Plaza",
                summary="Open concrete square.",
                description="Rain-washed stone plaza at the center of the block.",
                is_starting_location=True,
            ),
            LocationNodeDraft(
                key="bar",
                name="Bar",
                summary="Neon dive bar.",
                description="Smoky corner bar west of the plaza.",
            ),
            LocationNodeDraft(
                key="crypt",
                name="Hidden Vault",
                summary="Secret basement.",
                description="Locked vault behind a false wall.",
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="plaza",
                to_key="bar",
                direction_label="West alley to Bar",
                reverse_direction_label="East alley to Plaza",
                compass_direction="W",
                reverse_compass_direction="E",
                distance_meters=350,
            ),
            LocationEdgeDraft(
                from_key="bar",
                to_key="crypt",
                direction_label="False Keg Hatch",
                reverse_direction_label="Up to Bar",
                compass_direction="S",
                reverse_compass_direction="N",
                distance_meters=25,
                is_secret=True,
                is_vertical=True,
            ),
        ],
    )
    char = seed_character(repo, owner_id=user.id, world_id=world.id, name="Vance")
    camp = seed_campaign(repo, owner_id=user.id, world_id=world.id, character_id=char.id)
    by_name = {loc.name: loc for loc in world.locations}
    return user, world, char, camp, by_name


def _make_turn(
    repo: CantinaRepository,
    *,
    turn_id: str,
    campaign_id: str,
    parent_turn_id: str,
    depth_index: int,
    actor_id: str,
    user_message: str,
    raw_prose: str,
    active_location_id: str,
    world_timestamp: str,
    elapsed_minutes: int,
    visited_ids: list[str],
    spatial_intent: str = "stay",
    target_hint: str | None = None,
) -> TurnNodeRecord:
    return repo.save_turn_node(
        turn_id=turn_id,
        campaign_id=campaign_id,
        parent_turn_id=parent_turn_id,
        depth_index=depth_index,
        user_message=user_message,
        actor_id=actor_id,
        raw_prose=raw_prose,
        cognition=CognitionBlock(
            private_thoughts="Keep moving.",
            emotional_appraisal="Calm",
            new_mood_label="Focused",
            new_valence=0.0,
            new_arousal=0.3,
            new_want="Reach destination",
            new_plan="Walk briskly",
            action_intent="Walk",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="direct",
            subtext_interpretation="Moving",
            spatial_intent=spatial_intent,  # type: ignore[arg-type]
            target_location_hint=target_hint,
            mechanics_check=MechanicsTrigger(requires_roll=False),
        ),
        world_snapshot=WorldStateSnapshot(
            turn_id=turn_id,
            world_timestamp=world_timestamp,
            active_location_id=active_location_id,
            campaign_elapsed_minutes=elapsed_minutes,
            visited_location_ids=visited_ids,
        ),
        character_state=CharacterStateSnapshot(
            turn_id=turn_id,
            character_id=actor_id,
            current_location_id=active_location_id,
            mood_label="Focused",
            valence=0.0,
            arousal=0.3,
            active_want="Reach destination",
            active_plan="Walk briskly",
        ),
        recalled_items=[],
    )


def test_extract_travel_cues_parses_walk_duration_distance_pace_vertical_and_portal() -> None:
    walk = extract_travel_cues("I walk 10 minutes north into the street")
    assert walk.duration_minutes == 10
    assert walk.distance_meters is None
    assert walk.speed_modifier is None
    assert walk.is_vertical is False
    assert walk.is_non_euclidean is False

    km = extract_travel_cues("I sprint 1.5 km east across the bridge")
    assert km.distance_meters == 1500
    assert km.speed_modifier == 2.0

    half = extract_travel_cues("We drive for half an hour along the highway")
    assert half.duration_minutes == 30
    assert half.speed_modifier == 10.0

    vert = extract_travel_cues("I climb down the rusty ladder through the hatch into the cellar")
    assert vert.is_vertical is True

    portal = extract_travel_cues("I step through a shimmering magic portal back to the plaza")
    assert portal.is_non_euclidean is True


def test_visible_scope_projection_pathfinding_and_secret_spoiler_isolation(
    empty_repo: CantinaRepository,
) -> None:
    _user, world, _char, camp, by_name = _setup_plaza_bar_world(empty_repo)
    plaza = by_name["Plaza"]
    bar = by_name["Bar"]
    crypt = by_name["Hidden Vault"]
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None

    street = empty_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=bar.id,
        created_at_turn_id=root_turn_id,
        spec=ImprovisedLocationSpec(
            name="Street",
            summary="North avenue",
            description="Wet asphalt avenue north of the bar.",
            compass_direction="N",
            distance_meters=700,
            is_exterior=True,
        ),
    )

    world_now = empty_repo.get_world(world.id, valid_turn_ids={root_turn_id})
    street_neighbors = empty_repo.get_neighbor_locations(
        world.id, street.id, valid_turn_ids={root_turn_id}
    )

    # Bar is W 350m of Plaza; Street is N 700m of Bar -> Street to Plaza is E 350m, S 700m = 783m SE
    offset = estimate_euclidean_offset(world_now, street.id, plaza.id)
    assert offset is not None
    assert offset.distance_meters == 783
    assert offset.bearing == "SE"

    path = find_shortest_visible_path(world_now, street.id, plaza.id)
    assert path is not None
    assert path.path_node_ids == [street.id, bar.id, plaza.id]
    assert path.hop_count == 2
    assert path.total_distance_meters == 1050
    assert path.total_travel_minutes == 15

    # In Player Mode, unvisited Hidden Vault behind secret edge MUST NOT appear in Other Known Locations
    candidates = select_candidate_known_locations(
        world_now,
        street.id,
        street_neighbors,
        visited_location_ids=[plaza.id, bar.id, street.id],
        revealed_edge_ids=set(),
        gm_unlocked=False,
        user_message="I walk 5 minutes back to the plaza",
    )
    cand_ids = [c.location.id for c in candidates]
    assert plaza.id in cand_ids
    assert crypt.id not in cand_ids
    plaza_cand = next(c for c in candidates if c.location.id == plaza.id)
    assert plaza_cand.geometric_offset is not None
    assert plaza_cand.geometric_offset.distance_meters == 783
    assert plaza_cand.geometric_offset.bearing == "SE"

    # With GM Mode unlocked, Hidden Vault behind secret edge IS visible to geometry/candidates
    gm_candidates = select_candidate_known_locations(
        world_now,
        street.id,
        street_neighbors,
        visited_location_ids=[plaza.id, bar.id, street.id],
        revealed_edge_ids=set(),
        gm_unlocked=True,
    )
    assert crypt.id in [c.location.id for c in gm_candidates]


def test_add_improvised_link_independent_slots_idempotency_and_branch_cleanup(
    empty_repo: CantinaRepository,
) -> None:
    _user, world, char, camp, by_name = _setup_plaza_bar_world(empty_repo)
    plaza = by_name["Plaza"]
    bar = by_name["Bar"]
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None

    street = empty_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=bar.id,
        created_at_turn_id=root_turn_id,
        spec=ImprovisedLocationSpec(
            name="Street",
            summary="North avenue",
            description="Wet asphalt avenue.",
            compass_direction="N",
            distance_meters=700,
            is_exterior=True,
        ),
    )

    turn_link = _make_turn(
        empty_repo,
        turn_id="turn_link_1",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        actor_id=char.id,
        user_message="Take shortcut back to Plaza",
        raw_prose="You cut southeast across an alley back into the Plaza.",
        active_location_id=street.id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=11,
        visited_ids=[plaza.id, bar.id, street.id],
    )

    edge, created = empty_repo.add_improvised_link(
        world_id=world.id,
        from_location_id=street.id,
        to_location_id=plaza.id,
        created_at_turn_id=turn_link.id,
        spec=ImprovisedLinkSpec(
            to_location_id=plaza.id,
            entry_direction_label="Alley to Plaza",
            return_direction_label="Alley to Street",
            compass_direction="SE",
            distance_meters=783,
        ),
        valid_turn_ids={root_turn_id, turn_link.id},
    )
    assert created is True
    assert edge.distance_meters == 783
    assert edge.compass_direction == "SE"

    # Calling add_improvised_link again on same branch is idempotent
    edge_again, created_again = empty_repo.add_improvised_link(
        world_id=world.id,
        from_location_id=street.id,
        to_location_id=plaza.id,
        created_at_turn_id=turn_link.id,
        spec=ImprovisedLinkSpec(
            to_location_id=plaza.id,
            compass_direction="SE",
            distance_meters=783,
        ),
        valid_turn_ids={root_turn_id, turn_link.id},
    )
    assert created_again is False
    assert edge_again.id == edge.id

    # Rewinding before turn_link excludes the improvised link
    rewound_world = empty_repo.get_world(world.id, valid_turn_ids={root_turn_id})
    assert not any(
        isinstance(e, LocationEdge)
        and {e.from_location_id, e.to_location_id} == {street.id, plaza.id}
        for e in rewound_world.edges
    )


@pytest.mark.asyncio
async def test_four_turn_plaza_bar_street_improvisation_and_clamping_pipeline(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    _user, world, char, camp, by_name = _setup_plaza_bar_world(empty_repo)
    plaza = by_name["Plaza"]
    bar = by_name["Bar"]
    crypt = by_name["Hidden Vault"]
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None

    # Turn 1: Move West 5 min from Plaza to Bar (at 12:05)
    t1_bar = _make_turn(
        empty_repo,
        turn_id="turn_1_bar",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        actor_id=char.id,
        user_message="I walk 5 minutes west to the Bar.",
        raw_prose="You stroll west into the neon glow of the Bar.",
        active_location_id=bar.id,
        world_timestamp="2099-05-01 12:05",
        elapsed_minutes=5,
        visited_ids=[plaza.id, bar.id],
        spatial_intent="move_known",
        target_hint="Bar",
    )

    # Turn 2: Improvise Street 10 minutes north of Bar (LLM emits unaligned default 100m & elapsed 2)
    t2_raw = _make_turn(
        empty_repo,
        turn_id="turn_2_street",
        campaign_id=camp.id,
        parent_turn_id=t1_bar.id,
        depth_index=2,
        actor_id=char.id,
        user_message="I walk 10 minutes north into the street.",
        raw_prose="You push out the north side door and walk ten minutes up into a broad flooded Street.",
        active_location_id=bar.id,
        world_timestamp="2099-05-01 12:05",
        elapsed_minutes=5,
        visited_ids=[plaza.id, bar.id],
        spatial_intent="explore_new",
    )

    async def _mock_t2_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=2,  # Deliberately undercounted by LLM
                transition_type="improvise_new",
                improvised_location=ImprovisedLocationSpec(
                    name="Street",
                    summary="Flooded avenue",
                    description="Wide avenue north of the bar.",
                    compass_direction="N",
                    distance_meters=100,  # Unaligned exterior default
                    is_exterior=True,
                ),
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t2_clerk)
    bar_neighbors = empty_repo.get_neighbor_locations(
        world.id, bar.id, valid_turn_ids={root_turn_id, t1_bar.id}, campaign_id=camp.id
    )
    visible_bar_nbs = [nb for nb in bar_neighbors if not nb.is_secret]
    res_t2, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t2_raw,
        active_location=bar,
        neighbors=visible_bar_nbs,
        present_characters=[],
        dispatch_mode="sequential",
    )

    street_id = res_t2.world_snapshot.active_location_id
    assert street_id != bar.id
    # Walk cue alignment bumped 100m -> 700m (10 min * 70 m/min) and clock floor enforced >= 10 min
    assert res_t2.world_snapshot.campaign_elapsed_minutes == 15
    assert res_t2.world_snapshot.world_timestamp == "2099-05-01 12:15"
    assert res_t2.post_turn is not None
    assert res_t2.post_turn.elapsed_minutes == 10
    assert res_t2.post_turn.improvised_location is not None
    assert res_t2.post_turn.improvised_location.distance_meters == 700

    street_loc = empty_repo.get_location(street_id)
    street_neighbors = empty_repo.get_neighbor_locations(
        world.id, street_id, valid_turn_ids={root_turn_id, t1_bar.id, res_t2.id}, campaign_id=camp.id
    )

    # Turn 3A: Direct shortcut back to Plaza with conflicting 5 min walk -> clamped to 783m SE (~11 min)
    t3a_raw = _make_turn(
        empty_repo,
        turn_id="turn_3a_plaza",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I walk 5 minutes back to the plaza.",
        raw_prose="You cut down a side passage heading southeast and emerge back on the Plaza.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
        spatial_intent="connect_existing",
        target_hint="Plaza",
    )

    async def _mock_t3a_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=5,
                transition_type="connect_existing",
                target_location_id=plaza.id,
                improvised_link=ImprovisedLinkSpec(
                    to_location_id=plaza.id,
                    entry_direction_label="Side passage to Plaza",
                    return_direction_label="Side passage to Street",
                    compass_direction="S",
                    distance_meters=350,
                ),
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3a_clerk)
    res_t3a, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3a_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )

    assert res_t3a.world_snapshot.active_location_id == plaza.id
    assert res_t3a.post_turn is not None
    assert res_t3a.post_turn.transition_type == "connect_existing"
    assert res_t3a.post_turn.improvised_link is not None
    assert res_t3a.post_turn.improvised_link.distance_meters == 783
    assert res_t3a.post_turn.improvised_link.compass_direction == "SE"
    assert res_t3a.post_turn.improvised_link.clamped_from_meters == 350
    assert res_t3a.post_turn.elapsed_minutes == 11  # round(783 / 70)
    assert res_t3a.world_snapshot.campaign_elapsed_minutes == 26
    world_after_3a = empty_repo.get_world(
        world.id, valid_turn_ids={root_turn_id, t1_bar.id, res_t2.id, res_t3a.id}
    )
    assert sum(1 for l in world_after_3a.locations if l.name.lower() == "plaza") == 1
    street_to_plaza = next(
        e
        for e in world_after_3a.edges
        if e.from_location_id == street_id and e.to_location_id == plaza.id
    )
    assert street_to_plaza.distance_meters == 783
    assert street_to_plaza.compass_direction == "SE"

    # Turn 3B (alternate branch from t2): "I sprint back to the plaza" -> 783m SE at 2x speed = ~6 min
    t3b_raw = _make_turn(
        empty_repo,
        turn_id="turn_3b_sprint",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I sprint 5 minutes back to the plaza.",
        raw_prose="You tear down a connecting lane straight back to the Plaza.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
        spatial_intent="connect_existing",
        target_hint="Plaza",
    )

    async def _mock_t3b_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=5,
                transition_type="connect_existing",
                target_location_id=plaza.id,
                improvised_link=ImprovisedLinkSpec(
                    to_location_id=plaza.id,
                    compass_direction="SE",
                    distance_meters=350,
                    speed_modifier=2.0,
                ),
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3b_clerk)
    res_t3b, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3b_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )
    assert res_t3b.post_turn is not None
    assert res_t3b.post_turn.improvised_link is not None
    assert res_t3b.post_turn.improvised_link.distance_meters == 783
    assert res_t3b.post_turn.elapsed_minutes == 6  # round(783 / (70 * 2.0))

    # Turn 3C (alternate branch from t2): Magic portal bypasses Euclidean clamping
    t3c_raw = _make_turn(
        empty_repo,
        turn_id="turn_3c_portal",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I step through a magic portal back to the plaza.",
        raw_prose="A violet rift opens and deposits you on the Plaza.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
        spatial_intent="connect_existing",
        target_hint="Plaza",
    )

    async def _mock_t3c_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=1,
                transition_type="connect_existing",
                target_location_id=plaza.id,
                improvised_link=ImprovisedLinkSpec(
                    to_location_id=plaza.id,
                    compass_direction="N",
                    distance_meters=350,
                    distance_mode="non_euclidean",
                ),
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3c_clerk)
    res_t3c, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3c_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )
    assert res_t3c.post_turn is not None
    assert res_t3c.post_turn.improvised_link is not None
    assert res_t3c.post_turn.improvised_link.distance_mode == "non_euclidean"
    assert res_t3c.post_turn.improvised_link.distance_meters == 350
    assert res_t3c.post_turn.improvised_link.clamped_from_meters is None

    # Turn 3D (alternate branch from t2): Multi-hop move_existing retraces Street -> Bar -> Plaza WITHOUT adding edge
    t3d_raw = _make_turn(
        empty_repo,
        turn_id="turn_3d_retrace",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I walk back through the bar to the plaza.",
        raw_prose="You retrace your steps south into the Bar and east out onto the Plaza.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
        spatial_intent="move_known",
        target_hint="Plaza",
    )

    async def _mock_t3d_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=3,
                transition_type="move_existing",
                target_location_id=plaza.id,
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3d_clerk)
    res_t3d, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3d_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )
    assert res_t3d.world_snapshot.active_location_id == plaza.id
    assert res_t3d.post_turn is not None
    assert res_t3d.post_turn.transition_type == "move_existing"
    assert res_t3d.post_turn.traversed_location_ids == [street_id, bar.id, plaza.id]
    assert res_t3d.post_turn.elapsed_minutes == 15  # 10 min + 5 min
    world_after_3d = empty_repo.get_world(
        world.id, valid_turn_ids={root_turn_id, t1_bar.id, res_t2.id, res_t3d.id}
    )
    assert not any(
        {e.from_location_id, e.to_location_id} == {street_id, plaza.id}
        for e in world_after_3d.edges
    )

    # Turn 3E (duplicate-name guard): Clerk emits improvise_new named "The Plaza" -> coerced to connect_existing
    t3e_raw = _make_turn(
        empty_repo,
        turn_id="turn_3e_dup",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I head back to the Plaza.",
        raw_prose="You cut straight back to the Plaza.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
        spatial_intent="connect_existing",
        target_hint="Plaza",
    )

    async def _mock_t3e_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=5,
                transition_type="improvise_new",
                improvised_location=ImprovisedLocationSpec(
                    name="The Plaza",
                    summary="Dup plaza",
                    description="Should not spawn.",
                    compass_direction="SE",
                    distance_meters=350,
                    is_exterior=True,
                ),
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3e_clerk)
    res_t3e, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3e_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )
    assert res_t3e.world_snapshot.active_location_id == plaza.id
    assert res_t3e.post_turn is not None
    assert res_t3e.post_turn.transition_type == "connect_existing"
    world_after_3e = empty_repo.get_world(
        world.id, valid_turn_ids={root_turn_id, t1_bar.id, res_t2.id, res_t3e.id}
    )
    assert sum(1 for l in world_after_3e.locations if "plaza" in l.name.lower()) == 1

    # Turn 3F (hidden secret spoiler guard): connect_existing targeting unvisited Hidden Vault is blocked
    t3f_raw = _make_turn(
        empty_repo,
        turn_id="turn_3f_secret_guard",
        campaign_id=camp.id,
        parent_turn_id=res_t2.id,
        depth_index=3,
        actor_id=char.id,
        user_message="I tunnel into the Hidden Vault.",
        raw_prose="Attempt.",
        active_location_id=street_id,
        world_timestamp="2099-05-01 12:15",
        elapsed_minutes=15,
        visited_ids=[plaza.id, bar.id, street_id],
    )

    async def _mock_t3f_clerk(_msgs, schema_cls, **_kwargs):
        if schema_cls is WorldPostTurnDelta:
            return WorldPostTurnDelta(
                elapsed_minutes=2,
                transition_type="connect_existing",
                target_location_id=crypt.id,
            )
        raise RuntimeError("unused agent mock")

    monkeypatch.setattr(llm_client, "complete_structured", _mock_t3f_clerk)
    res_t3f, _ = await run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=char,
        completed_turn=t3f_raw,
        active_location=street_loc,
        neighbors=street_neighbors,
        present_characters=[],
        dispatch_mode="sequential",
    )
    assert res_t3f.world_snapshot.active_location_id == street_id


def test_offline_phase1_and_clerk_heuristics_align_walk_distance_and_connect_existing(
    empty_repo: CantinaRepository,
) -> None:
    _user, world, char, camp, by_name = _setup_plaza_bar_world(empty_repo)
    plaza = by_name["Plaza"]
    bar = by_name["Bar"]
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None

    # 1. Offline Phase 1 + Clerk heuristics on "I walk 10 minutes north into the street"
    pre1 = _build_heuristic_llm_output(
        "I walk 10 minutes north into the street.",
        bar,
        empty_repo.get_neighbor_locations(world.id, bar.id, valid_turn_ids={root_turn_id}),
        known_entities=["Plaza", "Bar"],
        present_characters=[char],
    )
    assert pre1.spatial_intent == "explore_new"

    w_delta = heuristic_world_post_turn_delta(
        user_message="I walk 10 minutes north into the street.",
        raw_prose="You walk ten minutes north into the Street.",
        pre_turn=PreTurnAnalysis(**pre1.model_dump()),
        active_location=bar,
        neighbors=empty_repo.get_neighbor_locations(world.id, bar.id, valid_turn_ids={root_turn_id}),
        current_timestamp="2099-05-01 12:05",
    )
    assert w_delta.transition_type == "improvise_new"
    assert w_delta.elapsed_minutes == 10
    assert w_delta.improvised_location is not None
    assert w_delta.improvised_location.distance_meters == 700
    assert w_delta.improvised_location.compass_direction == "N"

    # 2. Vertical cellar ladder heuristic sets is_vertical=True
    assert settings is not None
    pre_vert = _build_heuristic_llm_output(
        "I climb down the ladder into the cellar.",
        bar,
        [],
        known_entities=[],
        present_characters=[char],
    )
    w_vert = heuristic_world_post_turn_delta(
        user_message="I climb down the ladder into the cellar.",
        raw_prose="You climb down the iron ladder into a damp Cellar.",
        pre_turn=PreTurnAnalysis(**pre_vert.model_dump()),
        active_location=bar,
        neighbors=[],
        current_timestamp="2099-05-01 12:05",
    )
    assert w_vert.improvised_location is not None
    assert w_vert.improvised_location.is_vertical is True

    # 3. Offline Phase 1 + Clerk connect_existing to candidate Plaza
    street = empty_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=bar.id,
        created_at_turn_id=root_turn_id,
        spec=ImprovisedLocationSpec(
            name="Street",
            summary="Street",
            description="North street.",
            compass_direction="N",
            distance_meters=700,
            is_exterior=True,
        ),
    )
    world_now = empty_repo.get_world(world.id, valid_turn_ids={root_turn_id})
    street_nbs = empty_repo.get_neighbor_locations(world.id, street.id, valid_turn_ids={root_turn_id})
    cands = select_candidate_known_locations(
        world_now,
        street.id,
        street_nbs,
        visited_location_ids=[plaza.id, bar.id, street.id],
    )
    pre2 = _build_heuristic_llm_output(
        "I walk 5 minutes back to the plaza.",
        street,
        street_nbs,
        known_entities=["Plaza", "Bar", "Street"],
        present_characters=[char],
        other_known_locations=cands,
    )
    assert pre2.spatial_intent == "connect_existing"
    w_conn = heuristic_world_post_turn_delta(
        user_message="I walk 5 minutes back to the plaza.",
        raw_prose="You cut back to the Plaza.",
        pre_turn=PreTurnAnalysis(**pre2.model_dump()),
        active_location=street,
        neighbors=street_nbs,
        current_timestamp="2099-05-01 12:15",
        other_known_locations=cands,
    )
    assert w_conn.transition_type == "connect_existing"
    assert w_conn.target_location_id == plaza.id
    assert w_conn.improvised_link is not None
    assert w_conn.improvised_link.distance_meters == 783
    assert w_conn.improvised_link.compass_direction == "SE"
    assert w_conn.improvised_link.clamped_from_meters == 350
