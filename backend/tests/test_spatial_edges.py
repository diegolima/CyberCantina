import pytest
from fastapi.testclient import TestClient

from app.db.repository import CantinaRepository
from app.main import app, _execute_turn_stream_events
from app.schemas.turn import TurnSubmitRequest
from app.auth import get_current_user


@pytest.fixture
def mock_current_user(temp_repo: CantinaRepository):
    user = temp_repo.create_user(
        username="admin",
        display_name="Admin",
        role="admin",
        user_id="user_admin",
    )
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.pop(get_current_user, None)


def test_spatial_edges_connect_edit_distance_and_remove(temp_repo: CantinaRepository) -> None:
    """Test connecting C to A on A <-> B <-> C, editing distance, and removing links as long as at least one remains."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)

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
        temp_repo.remove_campaign_edge(
            camp_id,
            edge_id=c_b_init.id,
            remove_reciprocal=True,
        )

    # 1. Connect C to A (Cooling Tunnels to Main Floor)
    bundle_connected = temp_repo.connect_campaign_locations(
        camp_id,
        from_location_id=loc_c.id,
        to_location_id=loc_a.id,
        compass_direction="S",
        travel_minutes=5,
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
    assert c_to_a.travel_minutes == 5
    assert a_to_c.travel_minutes == 5

    # 2. Edit existing distances
    bundle_dist = temp_repo.update_campaign_edge_distance(
        camp_id,
        edge_id=c_to_a.id,
        travel_minutes=14,
        update_reciprocal=True,
    )
    c_to_a_updated = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
    )
    a_to_c_updated = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_a.id and e.to_location_id == loc_c.id
    )
    assert c_to_a_updated.travel_minutes == 14
    assert a_to_c_updated.travel_minutes == 14

    # 3. Remove links as long as at least one remains
    # C now has links to B and A. B has links to A and C. A has links to B and C.
    # Removing C <-> B should succeed because C still has A, and B still has A!
    c_to_b_current = next(
        e for e in bundle_dist.visible_edges if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id
    )
    bundle_after_removal = temp_repo.remove_campaign_edge(
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
        temp_repo.remove_campaign_edge(
            camp_id,
            edge_id=c_to_a_remaining.id,
            remove_reciprocal=True,
        )


def test_island_creation_prevention(temp_repo: CantinaRepository) -> None:
    """Ensure removing an edge that would create an isolated multi-node island is rejected."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)

    # Initial chain: Hub (Main Floor) <-> Clinic <-> Cooling Tunnels
    hub = next(l for l in bundle_0.visible_locations if "Main Floor" in l.name)
    clinic = next(l for l in bundle_0.visible_locations if "Ripperdoc" in l.name)
    cooling = next(l for l in bundle_0.visible_locations if "Cooling Tunnels" in l.name)

    # Add a 4th room linked to Cooling Tunnels: Deep Vault
    bundle_1 = temp_repo.create_linked_location(
        camp_id,
        from_location_id=cooling.id,
        name="Deep Vault",
        description="A heavy blast vault.",
        environmental_tags=["vault", "steel"],
        compass_direction="E",
        travel_minutes=4,
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
        temp_repo.remove_campaign_edge(
            camp_id,
            edge_id=clinic_to_cooling.id,
            remove_reciprocal=True,
        )

    # Now connect Deep Vault back to the Hub (or Clinic):
    # Hub <-> Clinic <-> Cooling Tunnels <-> Deep Vault <-> Hub
    bundle_2 = temp_repo.connect_campaign_locations(
        camp_id,
        from_location_id=vault.id,
        to_location_id=hub.id,
        compass_direction="W",
        travel_minutes=6,
        bidirectional=True,
    )

    # Now removing Clinic <-> Cooling Tunnels SHOULD succeed because Cooling Tunnels can reach Hub via Deep Vault!
    clinic_to_cooling_current = next(
        e for e in bundle_2.visible_edges
        if e.from_location_id == clinic.id and e.to_location_id == cooling.id
    )
    bundle_3 = temp_repo.remove_campaign_edge(
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


def test_spatial_edges_api_endpoints(temp_repo: CantinaRepository, mock_current_user) -> None:
    """Test the FastAPI endpoints for connecting, editing distances, and deleting edges."""
    client = TestClient(app)
    camp_id = "camp_neon_rust_default"
    # Claim campaign for user_admin
    conn = temp_repo._connect()
    try:
        conn.execute("UPDATE campaigns SET owner_id = ? WHERE id = ?", ("user_admin", camp_id))
        conn.commit()
    finally:
        conn.close()

    bundle = temp_repo.get_campaign_state_bundle(camp_id)
    loc_a = next(l for l in bundle.visible_locations if "Main Floor" in l.name)
    loc_c = next(l for l in bundle.visible_locations if "Cooling Tunnels" in l.name)

    # POST connect C to A
    res = client.post(
        f"/api/campaigns/{camp_id}/edges",
        json={
            "from_location_id": loc_c.id,
            "to_location_id": loc_a.id,
            "compass_direction": "SW",
            "travel_minutes": 7,
            "bidirectional": True,
        },
    )
    assert res.status_code == 200, res.text
    edge = next(
        e for e in res.json()["visible_edges"]
        if e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id
    )
    assert edge["travel_minutes"] == 7
    edge_id = edge["id"]

    # PATCH distance
    patch_res = client.patch(
        f"/api/campaigns/{camp_id}/edges/{edge_id}",
        json={"travel_minutes": 15, "update_reciprocal": True},
    )
    assert patch_res.status_code == 200
    updated_edges = patch_res.json()["visible_edges"]
    matching = [
        e for e in updated_edges
        if (e["from_location_id"] == loc_c.id and e["to_location_id"] == loc_a.id)
        or (e["from_location_id"] == loc_a.id and e["to_location_id"] == loc_c.id)
    ]
    for m in matching:
        assert m["travel_minutes"] == 15

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
    temp_repo: CantinaRepository, mock_current_user
) -> None:
    """Verify that campaign map edits do NOT touch the base world and do NOT cascade to previous turns."""
    client = TestClient(app)
    camp_id = "camp_neon_rust_default"
    conn = temp_repo._connect()
    try:
        conn.execute("UPDATE campaigns SET owner_id = ? WHERE id = ?", ("user_admin", camp_id))
        conn.commit()
    finally:
        conn.close()

    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    world_id = bundle_0.campaign.world_id
    turn_0_id = bundle_0.campaign.active_leaf_turn_id

    conn = temp_repo._connect()
    try:
        conn.execute("UPDATE worlds SET owner_id = ? WHERE id = ?", ("user_admin", world_id))
        conn.commit()
    finally:
        conn.close()

    # 1. Capture original base world state
    base_world_initial = temp_repo.get_world(world_id, base_only=True)
    initial_edge_count = len(base_world_initial.edges)
    initial_loc_count = len(base_world_initial.locations)

    # 2. Advance campaign by 1 turn to create Turn 1
    req = TurnSubmitRequest(user_message="I check the perimeter.")
    async for _ev in _execute_turn_stream_events(camp_id, req):
        pass

    bundle_turn_1 = temp_repo.get_campaign_state_bundle(camp_id)
    turn_1_id = bundle_turn_1.campaign.active_leaf_turn_id
    assert turn_1_id != turn_0_id, "Should be on Turn 1 now"

    # Find Cooling Tunnels (C), Main Floor (A), Ripperdoc (B)
    loc_a = next(l for l in bundle_turn_1.visible_locations if "Main Floor" in l.name)
    loc_b = next(l for l in bundle_turn_1.visible_locations if "Ripperdoc" in l.name)
    loc_c = next(l for l in bundle_turn_1.visible_locations if "Cooling Tunnels" in l.name)

    # In Turn 1:
    # A) Connect C to A (Cooling Tunnels to Main Floor) with distance 8
    temp_repo.connect_campaign_locations(
        camp_id,
        from_location_id=loc_c.id,
        to_location_id=loc_a.id,
        compass_direction="SW",
        travel_minutes=8,
        bidirectional=True,
    )

    # B) Update distance of Clinic <-> Main Floor from 1 to 25 minutes
    edge_a_b = next(
        e for e in bundle_turn_1.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    temp_repo.update_campaign_edge_distance(
        camp_id,
        edge_id=edge_a_b.id,
        travel_minutes=25,
        update_reciprocal=True,
    )

    # C) Remove Cooling Tunnels <-> Clinic (C <-> B)
    edge_c_b = next(
        e for e in bundle_turn_1.visible_edges
        if e.from_location_id == loc_c.id and e.to_location_id == loc_b.id
    )
    temp_repo.remove_campaign_edge(
        camp_id,
        edge_id=edge_c_b.id,
        remove_reciprocal=True,
    )

    # Verify Turn 1 has the edits
    bundle_turn_1_edited = temp_repo.get_campaign_state_bundle(camp_id)
    # C <-> A is present
    assert any(
        e.from_location_id == loc_c.id and e.to_location_id == loc_a.id
        for e in bundle_turn_1_edited.visible_edges
    )
    # A <-> B distance is 25
    edge_ab_edited = next(
        e for e in bundle_turn_1_edited.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert edge_ab_edited.travel_minutes == 25
    # C <-> B is removed
    assert not any(
        (e.from_location_id == loc_c.id and e.to_location_id == loc_b.id)
        for e in bundle_turn_1_edited.visible_edges
    )

    # 3. VERIFY ORIGINAL WORLD MAP IS COMPLETELY UNTOUCHED:
    base_world_after = temp_repo.get_world(world_id, base_only=True)
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
    # The distance of A <-> B is STILL 1 in the base world map (not 25)
    base_edge_ab = next(
        e for e in base_world_after.edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert base_edge_ab.travel_minutes == 1

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
    bundle_turn_0_checkout = temp_repo.checkout_turn_branch(camp_id, turn_0_id)
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
    # A <-> B distance is STILL 1 on Turn 0 (not 25)
    turn_0_edge_ab = next(
        e for e in bundle_turn_0_checkout.visible_edges
        if e.from_location_id == loc_a.id and e.to_location_id == loc_b.id
    )
    assert turn_0_edge_ab.travel_minutes == 1

    # 5. Check out Turn 1 again and delete it to verify rollback restoration
    temp_repo.checkout_turn_branch(camp_id, turn_1_id)
    bundle_after_delete = temp_repo.delete_last_turn(camp_id)
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
    assert restored_ab.travel_minutes == 1
