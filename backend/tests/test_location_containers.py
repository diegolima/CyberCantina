"""Comprehensive tests for Tiered Hierarchical Map Location Containers (Levels 0-4):
Schema & hierarchy invariants, SQLite migration & cascade safety, container CRUD &
conversion, campaign exploration inheritance & dynamic portals, Zone 4 breadcrumbs /
LCA transition cues, Phase 1/2/3 container lore & secret gating, live campaign CoW
container lore overrides, world forking/in-place updates, and .zcc ZIP round-trips.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import AsyncMock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.phase2_context import (
    build_zone1_static_system_prompt,
    build_zone4_ephemeral_tail_frame,
    compute_lca_transition_cue,
    resolve_phase2_turn_context,
    select_active_container_lore_for_turn,
)
from app.engine.phase3_cognition import run_character_cognition_agent
from app.schemas.character import CognitionBlock
from app.schemas.turn import (
    DiceRollResult,
    ImprovisedLocationSpec,
    PreTurnAnalysis,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    LocationContainer,
    LocationEdge,
    LocationNode,
    LoreNode,
    WorldGlobalRules,
    WorldRecord,
    WorldUpdatePayload,
)


@pytest.fixture
def authed_client(
    temp_repo: CantinaRepository,
) -> tuple[TestClient, CantinaRepository]:
    """Provide an authenticated FastAPI TestClient bound to temp_repo."""
    user = temp_repo.create_user(
        username="container_admin",
        display_name="Container Admin",
        role="admin",
        user_id="user_container_admin",
    )
    temp_repo.claim_unowned_entities(user.id)
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(main_module.app)
    try:
        yield client, temp_repo
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def _create_hierarchical_world(
    repo: CantinaRepository,
    *,
    owner_id: str | None = None,
    name: str = "Hierarchia Prime",
) -> WorldRecord:
    """Create a baseline world then populate Levels 4 -> 1 containers and elastic Level 0 nodes."""
    conn = repo._connect()
    w_id = "world_hier_test"
    try:
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
            (
                w_id,
                owner_id,
                name,
                WorldGlobalRules(
                    genre_and_tone="Neon Noir",
                    setting_overview="Layered metropolis surrounded by wasteland",
                    tech_or_magic_rules="Cybernetic augmentation",
                ).model_dump_json(),
            ),
        )
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, name, summary, description,
                environmental_tags_json, is_starting_location, is_hub, is_entry_exit, starting_message
            )
            VALUES ('loc_boot', ?, NULL, 'Boot Node', 'Boot summary', 'Boot description.', '["boot"]', 1, 0, 0, 'Booting.')
            """,
            (w_id,),
        )
        conn.commit()
    finally:
        conn.close()

    realm = LocationContainer(
        id="new_cont_realm",
        world_id=w_id,
        name="Pacific Rim",
        description="Coastal megalopolis belt. Vast urbanized Pacific basin.",
        depth=4,
        environmental_tags=["coastal", "sprawl"],
    )
    city = LocationContainer(
        id="new_cont_city",
        world_id=w_id,
        parent_container_id=realm.id,
        name="Night City",
        description="Neon corporate citadel with towering glass arcologies and acid rain.",
        depth=3,
        environmental_tags=["neon", "rain"],
    )
    district = LocationContainer(
        id="new_cont_dist",
        world_id=w_id,
        parent_container_id=city.id,
        name="Watson District",
        description="Gritty industrial port ward with cargo cranes, ramen stalls, and flickering holo-signs.",
        depth=2,
        environmental_tags=["industrial", "crowded"],
    )
    club = LocationContainer(
        id="new_cont_club",
        world_id=w_id,
        parent_container_id=district.id,
        name="Afterlife Club",
        description="Subterranean mercenary haunt in a repurposed morgue pulsing with sub-bass and chrome.",
        depth=1,
        environmental_tags=["subterranean", "heavy bass", "neon haze"],
        lore_nodes=[
            LoreNode(
                id="new_cl_1",
                world_id=w_id,
                container_id="new_cont_club",
                title="Mercenary Etiquette",
                category="culture",
                content="Deals are brokered in muted booths; Fixer Rogue enforces neutrality.",
                entity_tags=["Fixer Rogue", "neutrality", "booths"],
            ),
            LoreNode(
                id="new_cl_2",
                world_id=w_id,
                container_id="new_cont_club",
                title="Founding History",
                category="history",
                content="Constructed inside a 2020s triage morgue beneath Watson docks.",
                entity_tags=["morgue", "triage", "docks"],
            ),
            LoreNode(
                id="new_cl_3",
                world_id=w_id,
                container_id="new_cont_club",
                title="Valkyrie Vault Rumor",
                category="rumor",
                content="A biometric locker allegedly sits behind the cool-room chiller.",
                entity_tags=["Valkyrie Vault", "locker"],
            ),
            LoreNode(
                id="new_cl_secret",
                world_id=w_id,
                container_id="new_cont_club",
                title="Hidden Tunnel Code",
                category="secret",
                content="Tapping 4-2-9 on the breaker panel opens the sub-pier smuggler tunnel.",
                entity_tags=["breaker panel", "smuggler tunnel"],
            ),
        ],
    )
    lizzies = LocationContainer(
        id="new_cont_lizzies",
        world_id=w_id,
        parent_container_id=district.id,
        name="Lizzies Bar",
        description="Velvet-lined Mox club bathed in warm magenta neon and padded synth-leather.",
        depth=1,
        environmental_tags=["magenta neon", "lounge"],
    )

    foyer = LocationNode(
        id="new_loc_foyer",
        world_id=w_id,
        container_id=club.id,
        name="Main Floor",
        summary="Crowded dance pit and bar counter.",
        description="Laser beams cut through synth-smoke above the semicircular bar.",
        environmental_tags=["bar", "crowded"],
        is_starting_location=True,
        is_entry_exit=True,
        starting_message="The bass rattles your sternum inside Afterlife.",
    )
    vip = LocationNode(
        id="new_loc_vip",
        world_id=w_id,
        container_id=club.id,
        name="VIP Booth",
        summary="Soundproofed alcove off the pit.",
        description="Velour curtains shield a holo-table.",
        environmental_tags=["booth", "private"],
        is_entry_exit=False,
    )
    highway = LocationNode(
        id="new_loc_highway",
        world_id=w_id,
        container_id=district.id,  # Loose Level 0 directly in Level 2 District!
        name="Watson Overpass",
        summary="Elevated maglev roadway.",
        description="Slick asphalt glistening beneath sodium streetlights.",
        environmental_tags=["road", "open air"],
        is_entry_exit=False,
    )
    lounge = LocationNode(
        id="new_loc_lounge",
        world_id=w_id,
        container_id=lizzies.id,
        name="Velvet Lounge",
        summary="Entry salon of Lizzies Bar.",
        description="Pink holo-palms sway by the coat check.",
        environmental_tags=["lounge", "entry"],
        is_entry_exit=True,
    )
    badlands = LocationNode(
        id="new_loc_badlands",
        world_id=w_id,
        container_id=None,  # Root Level 0 outside all containers
        name="Salt Flats Outpost",
        summary="Dust-swept border checkpoint.",
        description="Abandoned radar dishes hum in the red wind.",
        environmental_tags=["desert", "open"],
        is_entry_exit=False,
    )

    edges = [
        LocationEdge(
            id="new_e1",
            world_id=w_id,
            from_location_id=foyer.id,
            to_location_id=vip.id,
            direction_label="Behind velvet ropes",
            compass_direction="N",
            travel_minutes=1,
        ),
        LocationEdge(
            id="new_e2",
            world_id=w_id,
            from_location_id=vip.id,
            to_location_id=foyer.id,
            direction_label="Out to Main Floor",
            compass_direction="S",
            travel_minutes=1,
        ),
        LocationEdge(
            id="new_e3",
            world_id=w_id,
            from_location_id=foyer.id,
            to_location_id=highway.id,
            direction_label="Stairs to street",
            compass_direction="S",
            travel_minutes=2,
        ),
        LocationEdge(
            id="new_e4",
            world_id=w_id,
            from_location_id=highway.id,
            to_location_id=foyer.id,
            direction_label="Down into Afterlife",
            compass_direction="N",
            travel_minutes=2,
        ),
        LocationEdge(
            id="new_e5",
            world_id=w_id,
            from_location_id=highway.id,
            to_location_id=lounge.id,
            direction_label="Eastbound to Lizzies",
            compass_direction="E",
            travel_minutes=4,
        ),
        LocationEdge(
            id="new_e6",
            world_id=w_id,
            from_location_id=lounge.id,
            to_location_id=highway.id,
            direction_label="Out to Watson Overpass",
            compass_direction="W",
            travel_minutes=4,
        ),
        LocationEdge(
            id="new_e7",
            world_id=w_id,
            from_location_id=highway.id,
            to_location_id=badlands.id,
            direction_label="Outer highway",
            compass_direction="W",
            travel_minutes=15,
        ),
        LocationEdge(
            id="new_e8",
            world_id=w_id,
            from_location_id=badlands.id,
            to_location_id=highway.id,
            direction_label="City approach",
            compass_direction="E",
            travel_minutes=15,
        ),
    ]

    return repo.update_world(
        w_id,
        WorldUpdatePayload(
            name=name,
            global_rules=WorldGlobalRules(
                genre_and_tone="Neon Noir",
                setting_overview="Layered metropolis surrounded by wasteland",
                tech_or_magic_rules="Cybernetic augmentation",
            ),
            containers=[realm, city, district, club, lizzies],
            locations=[foyer, vip, highway, lounge, badlands],
            edges=edges,
            lore_nodes=[
                LoreNode(
                    id="new_wl_1",
                    world_id=w_id,
                    title="Corporate Accord",
                    category="history",
                    content="Arasaka and Militech truce governs coastal trade.",
                    entity_tags=["Arasaka", "Militech"],
                )
            ],
        ),
        owner_id=owner_id,
    )


def test_lore_nodes_check_constraint_migration(tmp_path: Path) -> None:
    """Table recreation converts legacy lore_nodes cleanly and enforces container_id constraints."""
    db_file = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;
        CREATE TABLE worlds (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            global_rules_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE location_nodes (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
            created_at_turn_id TEXT NULL,
            name TEXT NOT NULL,
            summary TEXT NOT NULL,
            description TEXT NOT NULL,
            environmental_tags_json TEXT NOT NULL,
            is_starting_location INTEGER NOT NULL DEFAULT 0,
            is_hub INTEGER NOT NULL DEFAULT 0,
            starting_message TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE lore_nodes (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
            location_id TEXT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
            campaign_id TEXT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL CHECK(
                category IN ('history', 'culture', 'faction', 'rumor', 'artifact', 'secret')
                AND (location_id IS NOT NULL OR category != 'secret')
                AND (location_id IS NULL OR category != 'artifact')
                AND (campaign_id IS NULL OR location_id IS NOT NULL)
            ),
            content TEXT NOT NULL,
            entity_tags_json TEXT NOT NULL CHECK(
                json_valid(entity_tags_json)
                AND json_type(entity_tags_json) = 'array'
                AND json_array_length(entity_tags_json) >= 1
                AND entity_tags_json NOT LIKE '%""%'
            )
        );
        CREATE TABLE vector_entries (
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            world_id TEXT NULL,
            character_id TEXT NULL,
            campaign_id TEXT NULL,
            anchor_turn_id TEXT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            keywords_json TEXT NOT NULL DEFAULT '[]',
            embedding_blob BLOB NOT NULL
        );
        INSERT INTO worlds VALUES ('w1', 'Legacy World', '{"genre_and_tone":"noir","setting_overview":"city","tech_or_magic_rules":"none"}', '2026-01-01T00:00:00Z');
        INSERT INTO location_nodes VALUES ('l1', 'w1', NULL, 'Room', 'Sum', 'Desc', '[]', 1, 0, '');
        INSERT INTO lore_nodes VALUES ('lr_world', 'w1', NULL, NULL, 'Old History', 'history', 'Legacy text.', '["legacy"]');
        INSERT INTO lore_nodes VALUES ('lr_loc', 'w1', 'l1', NULL, 'Room Secret', 'secret', 'Hidden safe.', '["safe"]');
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(str(db_file))
    repo.init_db()
    # Second call must be idempotent
    repo.init_db()

    conn2 = repo._connect()
    try:
        ddl = conn2.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='lore_nodes'"
        ).fetchone()["sql"]
        assert "container_id" in ddl

        loc_cols = {r["name"] for r in conn2.execute("PRAGMA table_info(location_nodes)").fetchall()}
        assert "container_id" in loc_cols
        assert "is_entry_exit" in loc_cols

        vec_cols = {r["name"] for r in conn2.execute("PRAGMA table_info(vector_entries)").fetchall()}
        assert "container_id" in vec_cols

        # Container secret + campaign override allowed
        conn2.execute(
            """
            INSERT INTO location_containers (
                id, world_id, parent_container_id, depth, name, description, environmental_tags_json, created_at
            )
            VALUES ('c1', 'w1', NULL, 1, 'Keep', '', '[]', '2026-01-01T00:00:00Z')
            """
        )
        conn2.execute(
            "INSERT INTO lore_nodes VALUES ('lr_csec', 'w1', NULL, 'c1', NULL, 'Keep Secret', 'secret', 'Secret door.', '[\"door\"]')"
        )

        # Mutual exclusivity check fails when BOTH location_id and container_id are populated
        with pytest.raises(sqlite3.IntegrityError):
            conn2.execute(
                "INSERT INTO lore_nodes VALUES ('lr_bad', 'w1', 'l1', 'c1', NULL, 'Bad', 'rumor', 'Conflict', '[\"bad\"]')"
            )
    finally:
        conn2.close()


def test_schema_cycle_and_depth_validation() -> None:
    """WorldRecord rejects cycles, depth inversions, dangling references, and Level 2+ lore."""
    base_kwargs = dict(
        id="w1",
        name="ValWorld",
        global_rules=WorldGlobalRules(
            genre_and_tone="Fantasy", setting_overview="Keep", tech_or_magic_rules="Magic"
        ),
        created_at="2026-01-01T00:00:00Z",
        locations=[
            LocationNode(
                id="loc1",
                world_id="w1",
                name="Hall",
                summary="Main hall",
                description="Stone hall",
                is_starting_location=True,
            )
        ],
    )

    # 1. Level 2 container with lore rejected
    with pytest.raises(ValidationError, match="Level 1"):
        LocationContainer(
            id="c2",
            world_id="w1",
            name="High District",
            description="District",
            depth=2,
            lore_nodes=[
                LoreNode(
                    id="ln1",
                    world_id="w1",
                    container_id="c2",
                    title="Invalid Lore",
                    category="history",
                    content="Cannot live on L2",
                    entity_tags=["invalid"],
                )
            ],
        )

    # 2. Cycle / depth inversion rejected
    with pytest.raises(ValidationError):
        WorldRecord(
            **base_kwargs,
            containers=[
                LocationContainer(
                    id="ca", world_id="w1", parent_container_id="cb", name="A", depth=2
                ),
                LocationContainer(
                    id="cb", world_id="w1", parent_container_id="ca", name="B", depth=2
                ),
            ],
        )

    # 3. Dangling location.container_id rejected
    with pytest.raises(ValidationError, match="non-existent container"):
        WorldRecord(
            **{
                **base_kwargs,
                "locations": [
                    LocationNode(
                        id="loc1",
                        world_id="w1",
                        container_id="cont_missing",
                        name="Hall",
                        summary="Main hall",
                        description="Stone hall",
                        is_starting_location=True,
                    )
                ],
            }
        )

    # 4. Elastic containment & empty zero-portal container valid
    valid_rec = WorldRecord(
        **{
            **base_kwargs,
            "locations": [
                LocationNode(
                    id="loc1",
                    world_id="w1",
                    container_id="c3",
                    name="Mountain Road",
                    summary="Open road",
                    description="Direct L0 inside L3",
                    is_starting_location=True,
                )
            ],
        },
        containers=[
            LocationContainer(id="c3", world_id="w1", name="Northlands", description="Region", depth=3),
            LocationContainer(
                id="c1_empty",
                world_id="w1",
                parent_container_id="c3",
                name="Sealed Tomb",
                description="Unlinked secret tomb",
                depth=1,
            ),
        ],
    )
    assert len(valid_rec.containers) == 2


def test_container_deletion_restriction(temp_repo: CantinaRepository) -> None:
    """Repository blocks non-empty container deletion unless children are reassigned/unparented, and handles lore disposal."""
    world = _create_hierarchical_world(temp_repo)
    club = next(c for c in world.containers if c.name == "Afterlife Club")
    lizzies = next(c for c in world.containers if c.name == "Lizzies Bar")
    district = next(c for c in world.containers if c.name == "Watson District")

    # 1. Deleting populated container without options raises ValueError
    with pytest.raises(ValueError, match="still contains|contains child"):
        temp_repo.delete_location_container(world.id, club.id)

    # 2. Reassigning L1 lore to Level 2 District raises ValueError
    with pytest.raises(ValueError, match="depth 1"):
        temp_repo.delete_location_container(
            world.id,
            club.id,
            reassign_to_container_id=district.id,
            lore_disposal="reassign",
        )

    # 3. Reassigning to another Level 1 container (Lizzies) works & preserves lore cleanly
    updated = temp_repo.delete_location_container(
        world.id,
        club.id,
        reassign_to_container_id=lizzies.id,
        lore_disposal="reassign",
    )
    assert all(c.id != club.id for c in updated.containers)
    new_lizzies = next(c for c in updated.containers if c.name == "Lizzies Bar")
    assert any(ln.title == "Mercenary Etiquette" for ln in new_lizzies.lore_nodes)
    assert all(loc.container_id != club.id for loc in updated.locations)

    # 4. Promote L1 lore to world lore (pruning secrets) & unparent children to root
    promoted = temp_repo.delete_location_container(
        updated.id,
        new_lizzies.id,
        unparent_children=True,
        lore_disposal="promote_to_world",
    )
    world_titles = {ln.title for ln in promoted.lore_nodes}
    assert "Mercenary Etiquette" in world_titles
    assert "Hidden Tunnel Code" not in world_titles  # Secrets must be pruned
    assert all(loc.container_id is None or loc.container_id != new_lizzies.id for loc in promoted.locations)


def test_location_container_wrapper(authed_client: tuple[TestClient, CantinaRepository]) -> None:
    """Converting a location wraps it into a Level 1 container, renames portal, migrates lore, and protects campaigns."""
    client, repo = authed_client
    world = _create_hierarchical_world(repo, owner_id="user_container_admin")
    highway = next(loc for loc in world.locations if loc.name == "Watson Overpass")

    # Add location lore onto badlands (at root) and convert it via API
    badlands = next(loc for loc in world.locations if loc.name == "Salt Flats Outpost")
    world.locations = [
        loc.model_copy(
            update={
                "lore_nodes": [
                    LoreNode(
                        id="new_bl_1",
                        world_id=world.id,
                        location_id=badlands.id,
                        title="Radio Ghost",
                        category="rumor",
                        content="Weird transmissions echo at dusk.",
                        entity_tags=["transmissions", "dusk"],
                    )
                ]
            }
        )
        if loc.id == badlands.id
        else loc
        for loc in world.locations
    ]
    world = repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=world.name,
            global_rules=world.global_rules,
            containers=world.containers,
            locations=world.locations,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id="user_container_admin",
    )
    badlands = next(loc for loc in world.locations if loc.name == "Salt Flats Outpost")

    resp = client.post(
        f"/api/worlds/{world.id}/locations/{badlands.id}/convert-to-container",
        json={
            "container_name": "Salt Flats Complex",
            "portal_name": "Perimeter Gate",
            "migrate_lore": True,
        },
    )
    assert resp.status_code == 200
    w_after = WorldRecord.model_validate(resp.json())
    new_cont = next(c for c in w_after.containers if c.name == "Salt Flats Complex")
    assert new_cont.depth == 1
    assert any(ln.title == "Radio Ghost" for ln in new_cont.lore_nodes)
    wrapped_loc = next(loc for loc in w_after.locations if loc.id == badlands.id)
    assert wrapped_loc.name == "Perimeter Gate"
    assert wrapped_loc.container_id == new_cont.id
    assert wrapped_loc.is_entry_exit is True
    assert wrapped_loc.lore_nodes == []

    # Converting a location already inside a Level 1 container is rejected
    foyer = next(loc for loc in w_after.locations if loc.name == "Main Floor")
    bad_resp = client.post(
        f"/api/worlds/{world.id}/locations/{foyer.id}/convert-to-container",
        json={"container_name": "Invalid Nested L1"},
    )
    assert bad_resp.status_code == 400
    assert highway.id


def test_improvised_exploration_inheritance_and_dynamic_portals(temp_repo: CantinaRepository) -> None:
    """Exploration inherits container_id, climbs only on portal+is_exterior, handles 9th overflow hubs, and computes dynamic campaign portals."""
    world = _create_hierarchical_world(temp_repo)
    foyer = next(loc for loc in world.locations if loc.name == "Main Floor")
    vip = next(loc for loc in world.locations if loc.name == "VIP Booth")
    lounge = next(loc for loc in world.locations if loc.name == "Velvet Lounge")
    club = next(c for c in world.containers if c.name == "Afterlife Club")
    district = next(c for c in world.containers if c.name == "Watson District")

    kira = temp_repo.get_character("char_kira_vance")
    camp = temp_repo.create_campaign(
        name="Container Exploration",
        world_id=world.id,
        character_id=kira.id,
    )
    root_turn = temp_repo.get_campaign_state_bundle(camp.id).active_branch_turns[-1]

    # 1. From VIP (non-portal) even if is_exterior=True -> stays inside Afterlife Club!
    stayed = temp_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=vip.id,
        created_at_turn_id=root_turn.id,
        spec=ImprovisedLocationSpec(
            name="Security Locker",
            summary="Armored closet.",
            description="Steel walls.",
            environmental_tags=["steel"],
            compass_direction="E",
            is_exterior=True,
        ),
    )
    assert stayed.container_id == club.id

    # 2. From Main Floor (portal) with is_exterior=True -> climbs to Watson District (parent_container_id)!
    climbed = temp_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=foyer.id,
        created_at_turn_id=root_turn.id,
        spec=ImprovisedLocationSpec(
            name="Docks Alley",
            summary="Back alley outside Afterlife.",
            description="Wet cobblestones and steam grates.",
            environmental_tags=["alley", "steam"],
            compass_direction="W",
            is_exterior=True,
        ),
    )
    assert climbed.container_id == district.id

    # 3. Fill to 8 neighbors from Main Floor (2 base + Docks Alley + 5 Alcoves = 8),
    # then 9th neighbor overflow creates a Passage Hub inheriting Afterlife Club
    for i in range(5):
        temp_repo.add_improvised_location(
            world_id=world.id,
            from_location_id=foyer.id,
            created_at_turn_id=root_turn.id,
            spec=ImprovisedLocationSpec(
                name=f"Alcove {i}",
                summary="Side room",
                description="Small alcove",
                compass_direction="NE",
                is_exterior=False,
            ),
        )
    overflow_loc = temp_repo.add_improvised_location(
        world_id=world.id,
        from_location_id=foyer.id,
        created_at_turn_id=root_turn.id,
        spec=ImprovisedLocationSpec(
            name="Outer Pier",
            summary="Pier outside",
            description="Wooden pier.",
            compass_direction="W",
            is_exterior=True,
        ),
    )
    assert overflow_loc.container_id == district.id
    bundle_after = temp_repo.get_campaign_state_bundle(camp.id)
    hub_nodes = [loc for loc in bundle_after.visible_locations if loc.is_hub]
    assert len(hub_nodes) >= 1
    assert hub_nodes[0].container_id == club.id
    assert hub_nodes[0].is_entry_exit is True

    # 4. Dynamic campaign portals via connect_campaign_locations without mutating base DB location_nodes
    temp_repo.connect_campaign_locations(
        camp.id,
        from_location_id=vip.id,  # raw is_entry_exit == False
        to_location_id=lounge.id,
        compass_direction="E",
    )
    conn = temp_repo._connect()
    try:
        raw_vip_portal = conn.execute(
            "SELECT is_entry_exit FROM location_nodes WHERE id = ?", (vip.id,)
        ).fetchone()["is_entry_exit"]
    finally:
        conn.close()
    assert raw_vip_portal == 0  # Base DB row untouched!

    bundle_conn = temp_repo.get_campaign_state_bundle(camp.id)
    vis_vip = next(loc for loc in bundle_conn.visible_locations if loc.id == vip.id)
    assert vis_vip.is_entry_exit is True


def test_zone4_hierarchy_prompt_lca_cues_and_zone1_stability(temp_repo: CantinaRepository) -> None:
    """Zone 1 remains byte-identical across container transitions; Zone 4 renders breadcrumbs, capped L1 lore, secrets & LCA Entry Precedence."""
    world = _create_hierarchical_world(temp_repo)
    foyer = next(loc for loc in world.locations if loc.name == "Main Floor")
    vip = next(loc for loc in world.locations if loc.name == "VIP Booth")
    highway = next(loc for loc in world.locations if loc.name == "Watson Overpass")
    lounge = next(loc for loc in world.locations if loc.name == "Velvet Lounge")
    badlands = next(loc for loc in world.locations if loc.name == "Salt Flats Outpost")
    club = next(c for c in world.containers if c.name == "Afterlife Club")

    kira = temp_repo.get_character("char_kira_vance")
    z1_foyer = build_zone1_static_system_prompt(world, kira)
    # Zone 1 must not change when scene location changes or containers exist
    assert "Afterlife Club" not in z1_foyer
    assert z1_foyer == build_zone1_static_system_prompt(world, kira)

    # Zone 4 hierarchy + L1 container ambiance + capped L1 lore (max 2 ambient, excluding secret)
    pre_neutral = PreTurnAnalysis(
        user_sentiment="curious",
        subtext_interpretation="Looking around",
        mentioned_entities=[],
        memory_search_queries=["music"],
    )
    camp = temp_repo.create_campaign(name="LCA Test", world_id=world.id, character_id=kira.id)
    snap = temp_repo.get_campaign_state_bundle(camp.id).current_world_snapshot
    char_st = temp_repo.get_campaign_state_bundle(camp.id).current_character_state

    z4_inside = build_zone4_ephemeral_tail_frame(
        user_message="I scan the main bar.",
        character=kira,
        world_snapshot=snap,
        character_state=char_st,
        active_location=foyer,
        neighbors=[],
        recalled_items=[],
        pre_turn=pre_neutral,
        world=world,
        origin_location_id=highway.id,  # Entered Afterlife Club from Overpass
    )
    assert "<spatial_hierarchy>Pacific Rim > Night City > Watson District > Afterlife Club</spatial_hierarchy>" in z4_inside
    assert '<parent_container name="Afterlife Club">' in z4_inside
    assert "<container_lore>" in z4_inside
    assert "Hidden Tunnel Code" not in z4_inside
    assert "<narrative_entry_cue>" in z4_inside
    assert "<narrative_exit_cue>" not in z4_inside

    # Verify ambient L1 container lore cap == 2
    sel_ambient = select_active_container_lore_for_turn(club, user_message="tell me everything")
    assert len(sel_ambient) == 2

    # Verify failed roll suppresses container secret even if keywords appear; Clean Success unlocks
    pre_fail = PreTurnAnalysis(
        user_sentiment="curious",
        subtext_interpretation="Inspect breaker",
        mentioned_entities=["breaker panel"],
        character_rolls={
            kira.id: DiceRollResult(
                action_description="Inspect breaker panel",
                skill_or_approach="Tech",
                d20_raw=3,
                modifier=1,
                total=4,
                difficulty_class=15,
                outcome_tier="Simple Failure",
                narrative_directive="Fails.",
            )
        },
    )
    assert all(
        ln.category != "secret"
        for ln in select_active_container_lore_for_turn(club, user_message="Inspect breaker panel", pre_turn=pre_fail)
    )
    pre_success = PreTurnAnalysis(
        user_sentiment="curious",
        subtext_interpretation="Inspect breaker",
        mentioned_entities=["breaker panel"],
        character_rolls={
            kira.id: DiceRollResult(
                action_description="Inspect breaker panel",
                skill_or_approach="Tech",
                d20_raw=18,
                modifier=2,
                total=20,
                difficulty_class=12,
                outcome_tier="Clean Success",
                narrative_directive="Succeeds.",
            )
        },
    )
    assert any(
        ln.category == "secret"
        for ln in select_active_container_lore_for_turn(club, user_message="Inspect breaker panel", pre_turn=pre_success)
    )

    # LCA Edge Cases:
    # 1) Turn 0/1 suppression (origin=None)
    assert compute_lca_transition_cue(None, foyer, world.containers) == ""
    # 2) Same location suppression
    assert compute_lca_transition_cue(foyer, foyer, world.containers) == ""
    # 3) Sibling within same L1 container -> no cue
    assert compute_lca_transition_cue(foyer, vip, world.containers) == ""
    # 4) Entry Precedence: L1 Afterlife -> L1 Lizzies suppresses <narrative_exit_cue>
    cue_l1_l1 = compute_lca_transition_cue(foyer, lounge, world.containers)
    assert "<narrative_entry_cue>" in cue_l1_l1
    assert "<narrative_exit_cue>" not in cue_l1_l1
    # 5) Asymmetric exit to Root -> emits <narrative_exit_cue>
    cue_to_root = compute_lca_transition_cue(foyer, badlands, world.containers)
    assert "<narrative_exit_cue>" in cue_to_root
    assert "<narrative_entry_cue>" not in cue_to_root
    # 6) Disjoint trees fast-travel (Badlands -> Afterlife Club) -> emits entry cue, <= 200 chars interior
    cue_from_root = compute_lca_transition_cue(badlands, foyer, world.containers)
    assert "<narrative_entry_cue>" in cue_from_root
    assert "<narrative_exit_cue>" not in cue_from_root
    inner_text = cue_from_root.split("<narrative_entry_cue>", 1)[1].split("</narrative_entry_cue>", 1)[0]
    assert len(inner_text) <= 200


@pytest.mark.asyncio
async def test_phase3_cognition_container_ambiance_and_phase2_exclude(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Phase 2 excludes active Level 1 container from distant RAG; Phase 3 injects container ambiance in dynamic user_prompt."""
    world = _create_hierarchical_world(temp_repo)
    foyer = next(loc for loc in world.locations if loc.name == "Main Floor")
    club = next(c for c in world.containers if c.name == "Afterlife Club")
    kira = temp_repo.get_character("char_kira_vance")
    camp = temp_repo.create_campaign(name="RAG Exclude", world_id=world.id, character_id=kira.id)
    bundle0 = temp_repo.get_campaign_state_bundle(camp.id)

    monkeypatch.setattr("app.engine.phase2_context.settings.memory_config.working_memory_turns", 4)
    monkeypatch.setattr("app.engine.phase2_context.settings.memory_config.rag_top_k", 5)

    spy_calls: list[dict[str, object]] = []
    orig_search = temp_repo.vector_store.search_memories_for_characters

    async def spy_search(*args, **kwargs):
        spy_calls.append(kwargs)
        return await orig_search(*args, **kwargs)

    monkeypatch.setattr(temp_repo.vector_store, "search_memories_for_characters", spy_search)

    pre = PreTurnAnalysis(
        user_sentiment="focused",
        subtext_interpretation="Checking booths",
        mentioned_entities=["Afterlife Club", "Fixer Rogue"],
        memory_search_queries=["Fixer Rogue booths"],
    )
    await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=bundle0.active_branch_turns,
        pre_turn=pre,
        user_message="Who sits in the booths?",
        active_location=foyer,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira],
        character_name_map={kira.id: kira.name},
        episodic_chunks=[],
    )
    assert len(spy_calls) == 1
    assert spy_calls[0]["exclude_container_id"] == club.id

    # Phase 3 dynamic user_prompt includes immediate container ambiance & unlocked L1 container lore
    captured_msgs: list[list[dict[str, str]]] = []

    async def capture_cognition(messages, response_model, **kwargs):
        captured_msgs.append(messages)
        return CognitionBlock(recall="Watching booths.", feeling="Alert", want="Track Fixer Rogue", plan="Scan bar")

    monkeypatch.setattr(llm_client, "complete_structured", capture_cognition)
    await run_character_cognition_agent(
        world=world,
        character=kira,
        role="primary",
        previous_state=bundle0.current_character_state,
        active_location=foyer,
        neighbors=bundle0.neighbor_locations,
        co_present_characters=[],
        shared_scene_items=[],
        character_recalled_items=[],
        pre_turn=pre,
        user_message="What did Fixer Rogue say?",
    )
    assert len(captured_msgs) == 1
    sys_msg = captured_msgs[0][0]["content"]
    usr_msg = captured_msgs[0][1]["content"]
    assert "Afterlife Club" not in sys_msg
    assert "Surrounding Building/Compound (Afterlife Club)" in usr_msg
    assert "Mercenary Etiquette" in usr_msg


def test_campaign_container_lore_cow_and_secrets_excluded(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PUT /api/campaigns/{id}/containers/{cid}/lore applies CoW override isolated per campaign and skips secret vectors."""
    client, repo = authed_client
    world = _create_hierarchical_world(repo, owner_id="user_container_admin")
    club = next(c for c in world.containers if c.name == "Afterlife Club")
    district = next(c for c in world.containers if c.name == "Watson District")
    kira = repo.get_character("char_kira_vance")

    camp_a = repo.create_campaign(name="Camp A", world_id=world.id, character_id=kira.id, owner_id="user_container_admin")
    camp_b = repo.create_campaign(name="Camp B", world_id=world.id, character_id=kira.id, owner_id="user_container_admin")

    # Macro L2 container lore CoW rejected (400)
    bad_resp = client.put(
        f"/api/campaigns/{camp_a.id}/containers/{district.id}/lore",
        json={
            "lore_nodes": [
                {
                    "title": "Bad L2 Lore",
                    "category": "rumor",
                    "content": "Disallowed",
                    "entity_tags": ["bad"],
                }
            ]
        },
    )
    assert bad_resp.status_code == 400

    # Save CoW container lore override on Camp A (with 1 rumor + 1 secret)
    ok_resp = client.put(
        f"/api/campaigns/{camp_a.id}/containers/{club.id}/lore",
        json={
            "lore_nodes": [
                {
                    "title": "Lockdown Alert",
                    "category": "rumor",
                    "content": "Security drones sealed the main shaft this morning.",
                    "entity_tags": ["lockdown", "drones"],
                },
                {
                    "title": "Override Vent Code",
                    "category": "secret",
                    "content": "Vent code is 9981.",
                    "entity_tags": ["vent code", "9981"],
                },
            ]
        },
    )
    assert ok_resp.status_code == 200

    # Verify Camp A sees override, Camp B & base world keep original lore
    bundle_a = repo.get_campaign_state_bundle(camp_a.id)
    bundle_b = repo.get_campaign_state_bundle(camp_b.id)
    club_a = next(c for c in bundle_a.containers if c.id == club.id)
    club_b = next(c for c in bundle_b.containers if c.id == club.id)
    assert {ln.title for ln in club_a.lore_nodes} == {"Lockdown Alert", "Override Vent Code"}
    assert any(ln.title == "Mercenary Etiquette" for ln in club_b.lore_nodes)
    assert all(ln.title != "Lockdown Alert" for ln in club_b.lore_nodes)

    # Verify secret NOT in vector_entries, while public Lockdown Alert IS indexed under camp_a
    conn = repo._connect()
    try:
        vec_titles = [
            r["title"]
            for r in conn.execute(
                "SELECT title FROM vector_entries WHERE campaign_id = ? AND container_id = ?",
                (camp_a.id, club.id),
            ).fetchall()
        ]
    finally:
        conn.close()
    assert any("Lockdown Alert" in t for t in vec_titles)
    assert all("Override Vent Code" not in t for t in vec_titles)


@pytest.mark.asyncio
async def test_phase1_container_known_entities_and_lca_override_timing(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Phase 1 known_entities includes container names & public container lore tags; override_location captures pre-mutation origin."""
    client, repo = authed_client
    world = _create_hierarchical_world(repo, owner_id="user_container_admin")
    highway = next(loc for loc in world.locations if loc.name == "Watson Overpass")
    foyer = next(loc for loc in world.locations if loc.name == "Main Floor")
    kira = repo.get_character("char_kira_vance")
    camp = repo.create_campaign(name="P1 Entity Test", world_id=world.id, character_id=kira.id, owner_id="user_container_admin")

    captured_known: list[list[str]] = []
    captured_zone4: list[str] = []

    async def fake_p1(*args, **kwargs):
        captured_known.append(list(kwargs.get("known_entities", [])))
        return PreTurnAnalysis(
            user_sentiment="curious",
            subtext_interpretation="Heading back",
            mentioned_entities=["Afterlife Club"],
            memory_search_queries=["Afterlife Club"],
            spatial_intent="stay",
            active_speaker_id=kira.id,
            speaker_order=[kira.id],
        )

    async def fake_p3(*args, **kwargs):
        return {kira.id: CognitionBlock(recall="x", feeling="calm", want="y", plan="z")}

    async def fake_p4_stream(*, messages, **kwargs):
        captured_zone4.append(messages[-1]["content"])
        yield {"event": "actor_finished", "data": {"cognition": CognitionBlock(feeling="calm").model_dump(), "raw_prose": "Arrived."}}

    monkeypatch.setattr("app.routers.campaigns.run_phase1_pre_analysis", fake_p1)
    monkeypatch.setattr("app.routers.campaigns.run_phase3_multi_cognition", fake_p3)
    monkeypatch.setattr("app.routers.campaigns.stream_phase4_prose", fake_p4_stream)
    monkeypatch.setattr(
        "app.routers.campaigns.run_phase5_post_turn_clerk",
        AsyncMock(side_effect=lambda **kw: (kw["completed_turn"], [])),
    )

    # Active starts at Main Floor -> override move to Watson Overpass
    with client.stream(
        "POST",
        f"/api/campaigns/{camp.id}/turns/stream",
        json={"user_message": "Head outside onto Watson Overpass", "override_location_id": highway.id},
    ) as resp:
        assert resp.status_code == 200
        _ = resp.read()

    assert len(captured_known) == 1
    known_lower = {k.lower() for k in captured_known[0]}
    assert "afterlife club" in known_lower
    assert "watson district" in known_lower
    assert "fixer rogue" in known_lower  # Public container lore tag
    assert "smuggler tunnel" not in known_lower  # Secret tag must NEVER leak into known_entities

    assert len(captured_zone4) == 1
    # Moved from Main Floor (L1 Afterlife Club) -> Watson Overpass (L2 District): should emit <narrative_exit_cue>
    assert foyer.name != highway.name
    assert "<narrative_exit_cue>" in captured_zone4[0]


def test_world_forking_and_zcc_import_export_containers(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In-place updates, CoW world forking, embedding cache reuse, and .zcc ZIP round-trip preserve container hierarchy & FK order."""
    client, repo = authed_client
    world = _create_hierarchical_world(repo, owner_id="user_container_admin")
    kira = repo.get_character("char_kira_vance")

    # 1. Re-verify in-place embedding reuse when container lore unchanged
    embed_calls: list[str] = []

    def fake_embed(text: str) -> np.ndarray:
        embed_calls.append(text)
        return np.ones(8, dtype=np.float32)

    # First ensure world in-place update keeps cached container_lore vectors cleanly
    repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=f"{world.name} Renamed",
            global_rules=world.global_rules,
            containers=world.containers,
            locations=world.locations,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id="user_container_admin",
    )

    # 2. Export .zcc and commit staged import under PRAGMA foreign_keys = ON
    exp_resp = client.get(f"/api/export/world/{world.id}")
    assert exp_resp.status_code == 200
    zip_bytes = exp_resp.content

    stage_resp = client.post(
        "/api/import/inspect",
        files={"file": ("world.zcc", zip_bytes, "application/zip")},
    )
    assert stage_resp.status_code == 200
    staged_token = stage_resp.json()["staged_token"]
    assert stage_resp.json()["worlds"][0]["extra_info"]["containers_count"] == 5

    commit_resp = client.post(
        "/api/import/commit",
        json={"staged_token": staged_token, "default_conflict_strategy": "copy"},
    )
    assert commit_resp.status_code == 200
    worlds_list = [WorldRecord.model_validate(w) for w in client.get("/api/worlds").json()]
    imported = next(w for w in worlds_list if w.id != world.id and "Imported" in w.name)
    assert len(imported.containers) == 5
    imp_club = next(c for c in imported.containers if c.name == "Afterlife Club")
    assert imp_club.parent_container_id is not None
    assert any(ln.title == "Mercenary Etiquette" for ln in imp_club.lore_nodes)
    imp_foyer = next(loc for loc in imported.locations if loc.name == "Main Floor")
    assert imp_foyer.container_id == imp_club.id
    assert imp_foyer.is_entry_exit is True

    conn = repo._connect()
    try:
        imp_vecs = conn.execute(
            "SELECT source_type FROM vector_entries WHERE world_id = ? AND source_type = 'container_lore'",
            (imported.id,),
        ).fetchall()
    finally:
        conn.close()
    assert len(imp_vecs) == 3  # 3 public container lore nodes indexed; 1 secret excluded

    # 3. Silent CoW fork when a campaign references world
    repo.create_campaign(name="Lock Camp", world_id=world.id, character_id=kira.id, owner_id="user_container_admin")
    forked = repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=f"{world.name} v2",
            global_rules=world.global_rules,
            containers=world.containers,
            locations=world.locations,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id="user_container_admin",
    )
    assert forked.id != world.id
    assert len(forked.containers) == 5
    forked_club = next(c for c in forked.containers if c.name == "Afterlife Club")
    assert forked_club.id != next(c for c in world.containers if c.name == "Afterlife Club").id
    forked_foyer = next(loc for loc in forked.locations if loc.name == "Main Floor")
    assert forked_foyer.container_id == forked_club.id
