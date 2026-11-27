import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.db.seed import (
    SHOWCASE_SEED_VERSION,
    SHOWCASE_WORLD_SEED_KEY,
    seed_showcase_for_user,
)
from app.engine.clerk.heuristics import heuristic_post_turn_delta
from app.engine.context.zone4_ephemeral import build_zone4_ephemeral_tail_frame
from app.main import _execute_turn_stream_events, app
from app.prompts import get_default_prompt
from app.schemas.affective import MAX_TURN_ELAPSED_MINUTES_SANITY
from app.schemas.character import CognitionBlock
from app.schemas.turn import ImprovisedLocationSpec, PreTurnAnalysis, TurnSubmitRequest
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    NeighborLocationView,
    derive_walking_minutes,
    find_nested_world_unsupported_keys,
    format_distance_meters,
    format_walking_duration,
)
from tests.factories import seed_campaign, seed_character, seed_user, seed_world


@pytest.fixture
def spatial_scenario(empty_repo: CantinaRepository):
    user = seed_user(empty_repo, username="admin", display_name="Admin", role="admin", user_id="user_admin")
    world = seed_world(
        empty_repo,
        owner_id=user.id,
        name="Spatial Test Sector",
        locations=[
            LocationNodeDraft(
                key="main_bar",
                name="The Neon Rust Main Floor",
                summary="Main bar",
                description="Main bar room.",
                environmental_tags=["bar"],
                is_starting_location=True,
                is_hub=True,
            ),
            LocationNodeDraft(
                key="clinic",
                name="Backroom Ripperdoc Bay",
                summary="Clinic",
                description="Backroom surgical bay.",
                environmental_tags=["clinic"],
            ),
            LocationNodeDraft(
                key="tunnels",
                name="Sub-Basement Cooling Tunnels",
                summary="Tunnels",
                description="Flooded conduits.",
                environmental_tags=["tunnels"],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="clinic",
                direction_label="Curtain to clinic",
                reverse_direction_label="Curtain to bar",
                compass_direction="N",
                reverse_compass_direction="S",
                distance_meters=70,
            ),
            LocationEdgeDraft(
                from_key="clinic",
                to_key="tunnels",
                direction_label="Floor hatch",
                reverse_direction_label="Ladder up",
                compass_direction="N",
                reverse_compass_direction="S",
                distance_meters=210,
            ),
        ],
    )
    char = seed_character(empty_repo, owner_id=user.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=user.id, world_id=world.id, character_id=char.id)
    return empty_repo, user, world, camp


@pytest.fixture
def mock_current_user(spatial_scenario):
    _repo, user, _world, _camp = spatial_scenario
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(get_current_user, None)


def test_spatial_edges_connect_edit_distance_and_remove(spatial_scenario) -> None:
    """Test connecting C to A on A <-> B <-> C, editing distance, and removing links as long as at least one remains."""
    empty_repo, _user, _world, camp = spatial_scenario
    camp_id = camp.id
    bundle_0 = empty_repo.get_campaign_state_bundle(camp_id)

    # In default seed:
    # A = main_bar ("The Neon Rust Main Floor")
    # B = backroom_clinic ("Backroom Ripperdoc Bay")
    # C = cooling_tunnels ("Sub-level Cooling Tunnels")
    # Initial topology: A <-> B <-> C
    loc_a = next(l for l in bundle_0.visible_locations if "Main Floor" in l.name)
    loc_b = next(l for l in bundle_0.visible_locations if "Ripperdoc" in l.name)
    loc_c = next(l for l in bundle_0.visible_locations if "Cooling Tunnels" in l.name)

    # Verify initial topology: C is connected to B, B is connected to A, C is NOT connected to A
    c_b_init = next(
        (e for e in bundle_0.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id),
        None,
    )
    assert c_b_init is not None
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_a.id)
        for e in bundle_0.visible_edges
    )

    # Removing C <-> B before connecting C to A MUST fail because C has only 1 connection (severing its path to hub)!
    with pytest.raises(ValueError, match="valid path to the starting hub"):
        empty_repo.remove_campaign_edge(
            camp_id,
            edge_id=c_b_init.id,
            remove_reciprocal=True,
        )

    # 1. Connect C to A (Cooling Tunnels to Main Floor)
    bundle_connected = empty_repo.connect_campaign_locations(
        camp_id,
        from_location_id=loc_c.id,
        to_location_id=loc_a.id,
        compass_direction="S",
        distance_meters=350,
        bidirectional=True,
    )

    # Previous connection (C <-> B) MUST be preserved!
    c_to_b = next(
        (e for e in bundle_connected.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id),
        None,
    )
    b_to_c = next(
        (e for e in bundle_connected.visible_edges if e.from_location_id == loc_b.id and e.to_location_id == loc_c.id),
        None,
    )
    assert c_to_b is not None, "Previous connection C -> B should be kept"
    assert b_to_c is not None, "Previous connection B -> C should be kept"

    # New connections C <-> A should exist
    c_to_a = next(
        (e for e in bundle_connected.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_a.id),
        None,
    )
    a_to_c = next(
        (e for e in bundle_connected.visible_edges if e.from_location_id == loc_a.id and e.to_location_id == loc_c.id),
        None,
    )
    assert c_to_a is not None, "New connection C -> A should exist"
    assert a_to_c is not None, "New reciprocal connection A -> C should exist"
    assert c_to_a.distance_meters == 350
    assert a_to_c.distance_meters == 350

    # 2. Edit existing distances (including uncapped > 240m overland routes)
    bundle_dist = empty_repo.update_campaign_edge_distance(
        camp_id,
        edge_id=c_to_a.id,
        distance_meters=1500,
        update_reciprocal=True,
    )
    c_to_a_updated = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
    )
    a_to_c_updated = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_a.id and e.to_location_id == loc_c.id
    )
    assert c_to_a_updated.distance_meters == 1500
    assert a_to_c_updated.distance_meters == 1500

    # 3. Remove links as long as at least one remains
    # C now has links to B and A. B has links to A and C. A has links to B and C.
    # Removing C <-> B should succeed because C still has A, and B still has A!
    c_to_b_current = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id
    )
    bundle_after_removal = empty_repo.remove_campaign_edge(
        camp_id,
        edge_id=c_to_b_current.id,
        remove_reciprocal=True,
    )
    # Verify C <-> B is gone
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        or (e.from_location_id == loc_b.id and e.to_location_id == loc_c.id)
        for e in bundle_after_removal.visible_edges
    )
    # Verify C <-> A and A <-> B still exist
    assert any(
        e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
        for e in bundle_after_removal.visible_edges
    )

    # Now C only has a connection to A. If we try to remove C <-> A, it must fail because C would have no path to hub!
    c_to_a_remaining = next(
        e for e in bundle_after_removal.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
    )
    with pytest.raises(ValueError, match="valid path to the starting hub"):
        empty_repo.remove_campaign_edge(
            camp_id,
            edge_id=c_to_a_remaining.id,
            remove_reciprocal=True,
        )


def test_island_creation_prevention(spatial_scenario) -> None:
    """Ensure removing an edge that would create an isolated multi-node island is rejected."""
    empty_repo, _user, _world, camp = spatial_scenario
    camp_id = camp.id
    bundle_0 = empty_repo.get_campaign_state_bundle(camp_id)

    # Initial chain: Hub (Main Floor) <-> Clinic <-> Cooling Tunnels
    hub = next(l for l in bundle_0.visible_locations if "Main Floor" in l.name)
    clinic = next(l for l in bundle_0.visible_locations if "Ripperdoc" in l.name)
    cooling = next(l for l in bundle_0.visible_locations if "Cooling Tunnels" in l.name)

    # Add a 4th room linked to Cooling Tunnels: Deep Vault
    bundle_1 = empty_repo.create_linked_location(
        camp_id,
        from_location_id=cooling.id,
        name="Deep Vault",
        description="A heavy blast vault.",
        environmental_tags=["vault", "steel"],
        compass_direction="E",
        distance_meters=280,
    )
    vault = next(l for l in bundle_1.visible_locations if l.name == "Deep Vault")

    # Now we have: Hub <-> Clinic <-> Cooling Tunnels <-> Deep Vault
    # Cooling Tunnels has connections to Clinic AND Deep Vault (degree >= 2).
    # Deep Vault has connection to Cooling Tunnels (degree >= 1).
    # If someone tries to remove Clinic <-> Cooling Tunnels:
    # Under a simple degree check, Cooling Tunnels and Deep Vault would still each have >= 1 link!
    # BUT {Cooling Tunnels, Deep Vault} would become an island with no path to Hub!
    clinic_to_cooling = next(
        e for e in bundle_1.visible_edges
        if e.from_location_id == clinic.id and e.to_location_id == cooling.id
    )

    with pytest.raises(ValueError, match="valid path to the starting hub"):
        empty_repo.remove_campaign_edge(
            camp_id,
            edge_id=clinic_to_cooling.id,
            remove_reciprocal=True,
        )

    # Now connect Deep Vault back to the Hub (or Clinic):
    # Hub <-> Clinic <-> Cooling Tunnels <-> Deep Vault <-> Hub
    bundle_2 = empty_repo.connect_campaign_locations(
        camp_id,
        from_location_id=vault.id,
        to_location_id=hub.id,
        compass_direction="W",
        distance_meters=420,
        bidirectional=True,
    )

    # Now removing Clinic <-> Cooling Tunnels SHOULD succeed because Cooling Tunnels can reach Hub via Deep Vault!
    clinic_to_cooling_current = next(
        e for e in bundle_2.visible_edges
        if e.from_location_id == clinic.id and e.to_location_id == cooling.id
    )
    bundle_3 = empty_repo.remove_campaign_edge(
        camp_id,
        edge_id=clinic_to_cooling_current.id,
        remove_reciprocal=True,
    )

    # Assert Clinic <-> Cooling Tunnels is removed
    assert not any(
        (e.from_location_id == clinic.id and e.to_location_id == cooling.id)
        for e in bundle_3.visible_edges
    )
    # Cooling Tunnels is still reachable from Hub via Deep Vault!
    assert any(
        (e.from_location_id == cooling.id and e.to_location_id == vault.id)
        for e in bundle_3.visible_edges
    )
    assert any(
        (e.from_location_id == vault.id and e.to_location_id == hub.id)
        for e in bundle_3.visible_edges
    )


def test_spatial_edges_api_endpoints(spatial_scenario, mock_current_user) -> None:
    """Test the FastAPI endpoints for connecting, editing distances, and deleting edges."""
    empty_repo, _user, _world, camp = spatial_scenario
    client = TestClient(app)
    camp_id = camp.id

    bundle = empty_repo.get_campaign_state_bundle(camp_id)
    loc_a = next(l for l in bundle.visible_locations if "Main Floor" in l.name)
    loc_c = next(l for l in bundle.visible_locations if "Cooling Tunnels" in l.name)

    # POST connect C to A
    res = client.post(
        f"/api/campaigns/{camp_id}/edges",
        json={
            "from_location_id": loc_c.id,
            "to_location_id": loc_a.id,
            "compass_direction": "SW",
            "distance_meters": 490,
            "bidirectional": True,
        },
    )
    assert res.status_code == 200, res.text
    edge = next(
        e for e in res.json()["visible_edges"]
        if e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id
    )
    assert edge["distance_meters"] == 490
    edge_id = edge["id"]

    # PATCH distance beyond 240m cap
    patch_res = client.patch(
        f"/api/campaigns/{camp_id}/edges/{edge_id}",
        json={"distance_meters": 25000, "update_reciprocal": True},
    )
    assert patch_res.status_code == 200
    updated_edges = patch_res.json()["visible_edges"]
    matching = [
        e for e in updated_edges
        if (e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id)
        or (e["from_location_id"] == loc_a.id and e["to_location_id"] == loc_c.id)
    ]
    for m in matching:
        assert m["distance_meters"] == 25000

    # DELETE edge
    del_res = client.delete(
        f"/api/campaigns/{camp_id}/edges/{edge_id}?remove_reciprocal=true",
    )
    assert del_res.status_code == 200
    after_edges = del_res.json()["visible_edges"]
    assert not any(
        (e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id)
        for e in after_edges
    )


async def test_map_edits_do_not_affect_base_world_or_previous_turns(
    spatial_scenario, mock_current_user
) -> None:
    """Verify that campaign map edits do NOT touch the base world and do NOT cascade to previous turns."""
    empty_repo, _user, _world, camp = spatial_scenario
    client = TestClient(app)
    camp_id = camp.id

    bundle_0 = empty_repo.get_campaign_state_bundle(camp_id)
    world_id = bundle_0.campaign.world_id
    turn_0_id = bundle_0.campaign.active_leaf_turn_id

    # 1. Capture original base world state
    base_world_initial = empty_repo.get_world(world_id, base_only=True)
    initial_edge_count = len(base_world_initial.edges)
    initial_loc_count = len(base_world_initial.locations)

    # 2. Advance campaign by 1 turn to create Turn 1
    req = TurnSubmitRequest(user_message="I check the perimeter.")
    async for _ev in _execute_turn_stream_events(camp_id, req):
        pass

    bundle_turn_1 = empty_repo.get_campaign_state_bundle(camp_id)
    turn_1_id = bundle_turn_1.campaign.active_leaf_turn_id
    assert turn_1_id != turn_0_id, "Should be on Turn 1 now"

    # Find Cooling Tunnels (C), Main Floor (A), Ripperdoc (B)
    loc_a = next(l for l in bundle_turn_1.visible_locations if "Main Floor" in l.name)
    loc_b = next(l for l in bundle_turn_1.visible_locations if "Ripperdoc" in l.name)
    loc_c = next(l for l in bundle_turn_1.visible_locations if "Cooling Tunnels" in l.name)

    # In Turn 1:
    # A) Connect C to A (Cooling Tunnels to Main Floor) with distance 560m
    empty_repo.connect_campaign_locations(
        camp_id,
        from_location_id=loc_c.id,
        to_location_id=loc_a.id,
        compass_direction="SW",
        distance_meters=560,
        bidirectional=True,
    )

    # B) Update distance of Clinic <-> Main Floor from 70m to 1750m
    edge_a_b = next(
        e for e in bundle_turn_1.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    empty_repo.update_campaign_edge_distance(
        camp_id,
        edge_id=edge_a_b.id,
        distance_meters=1750,
        update_reciprocal=True,
    )

    # C) Remove Cooling Tunnels <-> Clinic (C <-> B)
    edge_c_b = next(
        e for e in bundle_turn_1.visible_edges
        if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id
    )
    empty_repo.remove_campaign_edge(
        camp_id,
        edge_id=edge_c_b.id,
        remove_reciprocal=True,
    )

    # Verify Turn 1 has the edits
    bundle_turn_1_edited = empty_repo.get_campaign_state_bundle(camp_id)
    # C <-> A is present
    assert any(
        e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
        for e in bundle_turn_1_edited.visible_edges
    )
    # A <-> B distance is 1750m
    edge_ab_edited = next(
        e for e in bundle_turn_1_edited.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert edge_ab_edited.distance_meters == 1750
    # C <-> B is removed
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        for e in bundle_turn_1_edited.visible_edges
    )

    # 3. VERIFY ORIGINAL WORLD MAP IS COMPLETELY UNTOUCHED:
    base_world_after = empty_repo.get_world(world_id, base_only=True)
    assert len(base_world_after.locations) == initial_loc_count
    assert len(base_world_after.edges) == initial_edge_count

    # The newly added link C <-> A does NOT exist in the base world map
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_a.id)
        for e in base_world_after.edges
    )
    # The removed link C <-> B is STILL PRESENT in the base world map
    assert any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        for e in base_world_after.edges
    )
    # The distance of A <-> B is STILL 70m in the base world map (not 1750m)
    base_edge_ab = next(
        e for e in base_world_after.edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert base_edge_ab.distance_meters == 70

    # Also check GET /api/worlds/{world_id} returns the clean base world
    world_api_res = client.get(f"/api/worlds/{world_id}")
    assert world_api_res.status_code == 200
    api_world = world_api_res.json()
    assert len(api_world["edges"]) == initial_edge_count
    assert not any(
        (e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id)
        for e in api_world["edges"]
    )
    assert any(
        (e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_b.id)
        for e in api_world["edges"]
    )

    # 4. VERIFY PREVIOUS TURN (Turn 0) DOES NOT HAVE THE EDITS (NO CASCADE):
    bundle_turn_0_checkout = empty_repo.checkout_turn_branch(camp_id, turn_0_id)
    # C <-> A does NOT exist on Turn 0
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_a.id)
        for e in bundle_turn_0_checkout.visible_edges
    )
    # C <-> B is STILL PRESENT on Turn 0
    assert any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        for e in bundle_turn_0_checkout.visible_edges
    )
    # A <-> B distance is STILL 70m on Turn 0 (not 1750m)
    turn_0_edge_ab = next(
        e for e in bundle_turn_0_checkout.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert turn_0_edge_ab.distance_meters == 70

    # 5. Check out Turn 1 again and delete it to verify rollback restoration
    empty_repo.checkout_turn_branch(camp_id, turn_1_id)
    bundle_after_delete = empty_repo.delete_last_turn(camp_id)
    assert bundle_after_delete.campaign.active_leaf_turn_id == turn_0_id
    # After deleting Turn 1, the edits on Turn 1 are purged and Turn 0 is restored
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_a.id)
        for e in bundle_after_delete.visible_edges
    )
    assert any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        for e in bundle_after_delete.visible_edges
    )
    restored_ab = next(
        e for e in bundle_after_delete.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert restored_ab.distance_meters == 70


def test_legacy_location_edges_db_migration_and_idempotency(tmp_path: Path) -> None:
    """Legacy `location_edges.travel_minutes` columns migrate idempotently (* 70) to `distance_meters`."""
    db_file = tmp_path / "legacy_edges.db"
    conn = sqlite3.connect(str(db_file))
    conn.executescript(
        """
        CREATE TABLE worlds (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            global_rules_json TEXT NOT NULL DEFAULT '{}',
            is_template INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
        );
        CREATE TABLE location_nodes (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            container_id TEXT NULL,
            name TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            environmental_tags_json TEXT NOT NULL DEFAULT '[]',
            is_starting_location INTEGER NOT NULL DEFAULT 0,
            is_hub INTEGER NOT NULL DEFAULT 0,
            starting_message TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE location_edges (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            from_location_id TEXT NOT NULL,
            to_location_id TEXT NOT NULL,
            direction_label TEXT NOT NULL,
            compass_direction TEXT NULL,
            travel_minutes INTEGER NOT NULL DEFAULT 1,
            is_locked_or_hidden INTEGER NOT NULL DEFAULT 0,
            created_at_turn_id TEXT NULL,
            superseded_at_turn_id TEXT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_location_edges_from ON location_edges(from_location_id);
        INSERT INTO worlds (id, owner_id, name) VALUES ('w_leg', NULL, 'Legacy World');
        INSERT INTO location_nodes (id, world_id, name, is_starting_location) VALUES
            ('loc_1', 'w_leg', 'Start', 1),
            ('loc_2', 'w_leg', 'Street', 0),
            ('loc_3', 'w_leg', 'Tower', 0);
        INSERT INTO location_edges (
            id, world_id, from_location_id, to_location_id, direction_label, compass_direction, travel_minutes
        ) VALUES
            ('e_one', 'w_leg', 'loc_1', 'loc_2', 'Door', 'N', 1),
            ('e_five', 'w_leg', 'loc_2', 'loc_3', 'Bridge', 'E', 5),
            ('e_zero', 'w_leg', 'loc_3', 'loc_1', 'Shortcut', 'S', 0);
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(str(db_file))
    repo.init_db()
    repo.init_db()  # Must not double-multiply distance_meters on repeated init_db()

    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row
    try:
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(location_edges)").fetchall()}
        assert "distance_meters" in cols
        assert "travel_minutes" not in cols
        rows = {
            row["id"]: int(row["distance_meters"])
            for row in conn.execute("SELECT id, distance_meters FROM location_edges").fetchall()
        }
        assert rows == {"e_one": 70, "e_five": 350, "e_zero": 1}
        indexes = {
            row["name"] for row in conn.execute("PRAGMA index_list(location_edges)").fetchall()
        }
        assert "idx_location_edges_from" in indexes
    finally:
        conn.close()


def test_uncapped_metric_distances_validation_and_legacy_compat(
    spatial_scenario, mock_current_user
) -> None:
    """Uncapped distances persist, non-positive values fail validation, and legacy `travel_minutes` coerces safely."""
    empty_repo, _user, _world, camp = spatial_scenario
    client = TestClient(app)
    camp_id = camp.id

    bundle = empty_repo.get_campaign_state_bundle(camp_id)
    loc_a = next(l for l in bundle.visible_locations if "Main Floor" in l.name)
    loc_c = next(l for l in bundle.visible_locations if "Cooling Tunnels" in l.name)

    # Uncapped distance on POST (1500m) and PATCH (100000m)
    create_res = client.post(
        f"/api/campaigns/{camp_id}/edges",
        json={
            "from_location_id": loc_c.id,
            "to_location_id": loc_a.id,
            "compass_direction": "W",
            "distance_meters": 1500,
            "bidirectional": True,
        },
    )
    assert create_res.status_code == 200, create_res.text
    edge_ca = next(
        e for e in create_res.json()["visible_edges"]
        if e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id
    )
    assert edge_ca["distance_meters"] == 1500

    patch_res = client.patch(
        f"/api/campaigns/{camp_id}/edges/{edge_ca['id']}",
        json={"distance_meters": 100_000, "update_reciprocal": True},
    )
    assert patch_res.status_code == 200, patch_res.text
    patched_ca = next(
        e for e in patch_res.json()["visible_edges"]
        if e["id"] == edge_ca["id"]
    )
    assert patched_ca["distance_meters"] == 100_000

    # Non-positive distances return 422
    bad_post = client.post(
        f"/api/campaigns/{camp_id}/edges",
        json={
            "from_location_id": loc_c.id,
            "to_location_id": loc_a.id,
            "distance_meters": 0,
        },
    )
    assert bad_post.status_code == 422

    bad_patch = client.patch(
        f"/api/campaigns/{camp_id}/edges/{edge_ca['id']}",
        json={"distance_meters": -10, "update_reciprocal": True},
    )
    assert bad_patch.status_code == 422

    # Legacy `travel_minutes` API payload coerces via * 70
    del_res = client.delete(f"/api/campaigns/{camp_id}/edges/{edge_ca['id']}?remove_reciprocal=true")
    assert del_res.status_code == 200
    legacy_post = client.post(
        f"/api/campaigns/{camp_id}/edges",
        json={
            "from_location_id": loc_c.id,
            "to_location_id": loc_a.id,
            "travel_minutes": 4,
            "bidirectional": True,
        },
    )
    assert legacy_post.status_code == 200, legacy_post.text
    coerced_ca = next(
        e for e in legacy_post.json()["visible_edges"]
        if e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id
    )
    assert coerced_ca["distance_meters"] == 280

    # Pydantic model shims never double-multiply when distance_meters is already supplied
    draft_legacy = LocationEdgeDraft(
        from_key="a",
        to_key="b",
        direction_label="East",
        travel_minutes=4,
    )
    assert draft_legacy.distance_meters == 280
    draft_both = LocationEdgeDraft(
        from_key="a",
        to_key="b",
        direction_label="East",
        distance_meters=300,
        travel_minutes=4,
    )
    assert draft_both.distance_meters == 300

    assert (
        ImprovisedLocationSpec(
            name="Cellar",
            summary="s",
            description="d",
            is_exterior=False,
        ).distance_meters
        == 20
    )
    assert (
        ImprovisedLocationSpec(
            name="Street",
            summary="s",
            description="d",
            is_exterior=True,
        ).distance_meters
        == 100
    )
    assert (
        ImprovisedLocationSpec(
            name="Alley",
            summary="s",
            description="d",
            travel_minutes=3,
        ).distance_meters
        == 210
    )

    assert (
        find_nested_world_unsupported_keys(
            {
                "edges": [
                    {
                        "from_location_id": "loc_a",
                        "to_location_id": "loc_b",
                        "direction_label": "East",
                        "travel_minutes": 3,
                    }
                ]
            }
        )
        == []
    )


def test_metric_helpers_heuristics_and_prompt_formatting(spatial_scenario) -> None:
    """Metric helpers, offline clerk heuristics, and Zone 4 exit lines stay aligned at 70 m/min."""
    empty_repo, _user, _world, camp = spatial_scenario
    bundle = empty_repo.get_campaign_state_bundle(camp.id)
    active_loc = next(l for l in bundle.visible_locations if "Main Floor" in l.name)
    clinic_loc = next(l for l in bundle.visible_locations if "Ripperdoc" in l.name)
    char = next(iter(bundle.character_records.values()))

    assert derive_walking_minutes(1) == 1
    assert derive_walking_minutes(20) == 1
    assert derive_walking_minutes(70) == 1
    assert derive_walking_minutes(105) == 2
    assert derive_walking_minutes(350) == 5
    assert derive_walking_minutes(1500) == 21
    assert derive_walking_minutes(5000) == 71

    assert format_distance_meters(20) == "20m"
    assert format_distance_meters(350) == "350m"
    assert format_distance_meters(1000) == "1km"
    assert format_distance_meters(1400) == "1.4km"
    assert format_distance_meters(1460) == "1.5km"
    assert format_distance_meters(125_000) == "125km"

    assert format_walking_duration(20) == "< 1 min"
    assert format_walking_duration(70) == "~1 min"
    assert format_walking_duration(350) == "~5 min"
    assert format_walking_duration(4200) == "~1h"
    assert format_walking_duration(5250) == "~1h 15min"

    nb_700 = NeighborLocationView(
        edge_id="e_700",
        direction_label="Plaza Walkway",
        compass_direction="E",
        distance_meters=700,
        is_blocked=False,
        is_secret=False,
        destination=clinic_loc,
    )
    nb_20 = NeighborLocationView(
        edge_id="e_20",
        direction_label="Curtain",
        compass_direction="N",
        distance_meters=20,
        is_blocked=False,
        is_secret=False,
        destination=clinic_loc,
    )
    nb_huge = NeighborLocationView(
        edge_id="e_huge",
        direction_label="Desert Highway",
        compass_direction="S",
        distance_meters=5_000_000,
        is_blocked=False,
        is_secret=False,
        destination=clinic_loc,
    )
    move_pre = PreTurnAnalysis(spatial_intent="move_known", target_location_hint="Ripperdoc")

    delta_700 = heuristic_post_turn_delta(
        user_message="I walk into Backroom Ripperdoc Bay.",
        raw_prose="She walks to Backroom Ripperdoc Bay.",
        pre_turn=move_pre,
        active_location=active_loc,
        neighbors=[nb_700],
    )
    assert delta_700.transition_type == "move_existing"
    assert delta_700.elapsed_minutes == 11

    delta_20 = heuristic_post_turn_delta(
        user_message="I slip into Backroom Ripperdoc Bay.",
        raw_prose="She steps inside Backroom Ripperdoc Bay.",
        pre_turn=move_pre,
        active_location=active_loc,
        neighbors=[nb_20],
    )
    assert delta_20.elapsed_minutes == 2

    delta_huge = heuristic_post_turn_delta(
        user_message="I trek toward Backroom Ripperdoc Bay.",
        raw_prose="Days pass along the road to Backroom Ripperdoc Bay.",
        pre_turn=move_pre,
        active_location=active_loc,
        neighbors=[nb_huge],
    )
    assert delta_huge.elapsed_minutes == MAX_TURN_ELAPSED_MINUTES_SANITY

    explore_pre = PreTurnAnalysis(spatial_intent="explore_new")
    delta_int = heuristic_post_turn_delta(
        user_message="I open the storage annex.",
        raw_prose="Inside the annex, dusty shelving lines the bulkhead.",
        pre_turn=explore_pre,
        active_location=active_loc,
        neighbors=[nb_20],
    )
    assert delta_int.improvised_location is not None
    assert delta_int.improvised_location.is_exterior is False
    assert delta_int.improvised_location.distance_meters == 20

    delta_ext = heuristic_post_turn_delta(
        user_message="I step outside onto the street.",
        raw_prose="Rain needles the neon pavement outside.",
        pre_turn=explore_pre,
        active_location=active_loc,
        neighbors=[nb_20],
    )
    assert delta_ext.improvised_location is not None
    assert delta_ext.improvised_location.is_exterior is True
    assert delta_ext.improvised_location.distance_meters == 100

    nb_350 = NeighborLocationView(
        edge_id="e_350",
        direction_label="Covered Walkway",
        compass_direction="E",
        distance_meters=350,
        is_blocked=False,
        is_secret=False,
        destination=clinic_loc,
    )
    z4_prompt = build_zone4_ephemeral_tail_frame(
        user_message="Look around.",
        character=char,
        world_snapshot=bundle.current_world_snapshot,
        character_state=bundle.current_character_state,
        active_location=active_loc,
        neighbors=[nb_350, nb_20],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(),
        established_cognition=CognitionBlock(skipped=True),
    )
    assert "[350m; ~5 min walk]" in z4_prompt
    assert "[20m; < 1 min walk]" in z4_prompt
    assert "travel_minutes" not in get_default_prompt("clerk_post_turn_system")


def test_green_lie_showcase_seed_uses_metric_distances(empty_repo: CantinaRepository) -> None:
    """Showcase seed version stays 2 while all seeded Green Lie edges carry metric distances."""
    assert SHOWCASE_SEED_VERSION == 2
    user = seed_user(
        empty_repo,
        username="showcase_metric",
        display_name="Showcase Metric",
        role="user",
        user_id="user_showcase_metric",
    )
    result = seed_showcase_for_user(empty_repo, user.id)
    assert result["restored_world"] is True

    worlds = empty_repo.list_worlds(owner_id=user.id)
    green_lie = next(w for w in worlds if w.name == "The Green Lie")
    assert len(green_lie.locations) == 37
    assert len(green_lie.edges) == 88
    assert all(e.distance_meters >= 1 for e in green_lie.edges)
    assert sum(1 for e in green_lie.edges if e.is_vertical) == 22
    assert sum(len(loc.props) for loc in green_lie.locations) == 2
    assert sum(1 for loc in green_lie.locations if loc.anchor_location_id) == 3
    conn = empty_repo._connect()
    try:
        row = conn.execute("SELECT seed_key, seed_version FROM worlds WHERE id = ?", (green_lie.id,)).fetchone()
        assert row is not None
        assert row["seed_key"] == SHOWCASE_WORLD_SEED_KEY
        assert row["seed_version"] == SHOWCASE_SEED_VERSION
    finally:
        conn.close()

