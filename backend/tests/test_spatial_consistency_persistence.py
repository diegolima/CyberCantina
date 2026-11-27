"""Persistence, CoW, campaign route, branch-rewind, and .zcc round-trip tests
for spatial distance consistency fields:
- location_nodes.anchor_location_id
- location_edges.distance_mode ('flexible' | 'locked' | 'non_euclidean')
- location_edges.is_vertical (bool)
"""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.routers import import_export as import_export_router
from app.schemas.character import CognitionBlock
from app.schemas.turn import (
    CampaignMapUpdatePayload,
    CharacterStateSnapshot,
    PreTurnAnalysis,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationContainer,
    LocationEdge,
    LocationNode,
    WorldGlobalRules,
    WorldUpdatePayload,
)
from app.security.rate_limit import reset_rate_limiters
from tests.factories import seed_campaign, seed_character, seed_user


def _client_for(
    repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, user_id: str
) -> TestClient:
    user = repo.get_user_by_id(user_id)
    assert user is not None
    monkeypatch.setattr(main_module, "get_repo", lambda: repo)
    monkeypatch.setattr(import_export_router, "get_repo", lambda: repo)
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(main_module.app)


def _seed_green_lie_like_world(
    repo: CantinaRepository,
    owner_id: str,
    *,
    world_id: str = "world_green_lie_test",
) -> tuple[str, dict[str, str]]:
    """Build Sector 9 + Neon Rust + Sewers world via direct update_world so containers & links exist cleanly."""
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
            (
                world_id,
                owner_id,
                "Green Lie Topology Test",
                WorldGlobalRules(
                    genre="Cyberpunk",
                    tone="Gritty",
                    setting_overview="Sector 9 rooftops and flooded sub-sewers.",
                ).model_dump_json(),
            ),
        )
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, name, summary, description,
                environmental_tags_json, is_starting_location, is_hub, is_entry_exit, starting_message
            )
            VALUES ('loc_boot_s9', ?, NULL, 'Boot Sector 9', 'Boot', 'Temp start node.', '[]', 1, 0, 0, 'Boot.')
            """,
            (world_id,),
        )
        conn.commit()
    finally:
        conn.close()

    c_neon = LocationContainer(
        id="new_cont_neon",
        world_id=world_id,
        name="The Neon Rust",
        description="Dive bar above Sector 9.",
        depth=1,
        environmental_tags=["bar"],
    )
    c_sewers = LocationContainer(
        id="new_cont_sewers",
        world_id=world_id,
        name="Sewers",
        description="Sub-street maintenance tunnels.",
        depth=1,
        environmental_tags=["sewer"],
    )

    loc_chop = LocationNode(
        id="new_loc_chop",
        world_id=world_id,
        name="The Chop-Cathedral",
        summary="Organ clinic",
        description="Bright neon operating nave.",
        is_starting_location=False,
    )
    loc_sump = LocationNode(
        id="new_loc_sump",
        world_id=world_id,
        container_id=c_neon.id,
        name="The Sump-Well",
        summary="Backroom bar pit",
        description="Rusty grate descending below the bar.",
        is_starting_location=True,
    )
    loc_ent = LocationNode(
        id="new_loc_ent",
        world_id=world_id,
        container_id=c_sewers.id,
        name="Sewer Entrance",
        summary="Ladder landing",
        description="Damp tunnel beneath the grating.",
        anchor_location_id=loc_sump.id,
    )
    loc_1l = LocationNode(
        id="new_loc_1l",
        world_id=world_id,
        container_id=c_sewers.id,
        name="Tunnel 1-L",
        summary="West junction",
        description="Flooded pipe bend.",
        # Same-container anchor (must be sanitized out to None)
        anchor_location_id=loc_ent.id,
    )
    loc_1m = LocationNode(
        id="new_loc_1m",
        world_id=world_id,
        container_id=c_sewers.id,
        name="Tunnel 1-M",
        summary="East exit",
        description="Steps leading up to Sector 9.",
        anchor_location_id=loc_chop.id,
    )
    # Root location attempting to anchor (must be sanitized out to None)
    loc_rooftop = LocationNode(
        id="new_loc_roof",
        world_id=world_id,
        container_id=None,
        name="Sector 9 Overpass",
        summary="Street bridge",
        description="Rain-slicked concrete walkway.",
        anchor_location_id=loc_sump.id,
    )

    edges = [
        # Locked outer street link: Neon Rust (via Sump-Well footprint) -> Chop-Cathedral (E 1500m)
        LocationEdge(
            id="new_e_street_f",
            world_id=world_id,
            from_location_id=loc_sump.id,
            to_location_id=loc_chop.id,
            direction_label="East along Sector 9 Ave",
            compass_direction="E",
            distance_meters=1500,
            distance_mode="locked",
            is_vertical=False,
        ),
        LocationEdge(
            id="new_e_street_r",
            world_id=world_id,
            from_location_id=loc_chop.id,
            to_location_id=loc_sump.id,
            direction_label="West to Neon Rust",
            compass_direction="W",
            distance_meters=1500,
            distance_mode="locked",
            is_vertical=False,
        ),
        # Vertical hatch: Sump-Well <-> Sewer Entrance
        LocationEdge(
            id="new_e_hatch_f",
            world_id=world_id,
            from_location_id=loc_sump.id,
            to_location_id=loc_ent.id,
            direction_label="Hatch down",
            compass_direction="S",
            distance_meters=25,
            distance_mode="locked",
            is_vertical=True,
        ),
        LocationEdge(
            id="new_e_hatch_r",
            world_id=world_id,
            from_location_id=loc_ent.id,
            to_location_id=loc_sump.id,
            direction_label="Ladder up",
            compass_direction="N",
            distance_meters=25,
            distance_mode="locked",
            is_vertical=True,
        ),
        # Non-Euclidean portal shortcut: Tunnel 1-M <-> Overpass
        LocationEdge(
            id="new_e_portal_f",
            world_id=world_id,
            from_location_id=loc_1m.id,
            to_location_id=loc_rooftop.id,
            direction_label="Folded Gate",
            compass_direction="NE",
            distance_meters=15,
            distance_mode="non_euclidean",
            is_vertical=False,
        ),
        LocationEdge(
            id="new_e_portal_r",
            world_id=world_id,
            from_location_id=loc_rooftop.id,
            to_location_id=loc_1m.id,
            direction_label="Folded Return",
            compass_direction="SW",
            distance_meters=15,
            distance_mode="non_euclidean",
            is_vertical=False,
        ),
        # Flexible sewer corridor
        LocationEdge(
            id="new_e_sew_1",
            world_id=world_id,
            from_location_id=loc_ent.id,
            to_location_id=loc_1l.id,
            direction_label="North pipe",
            compass_direction="N",
            distance_meters=1000,
        ),
        LocationEdge(
            id="new_e_sew_1r",
            world_id=world_id,
            from_location_id=loc_1l.id,
            to_location_id=loc_ent.id,
            direction_label="South pipe",
            compass_direction="S",
            distance_meters=1000,
        ),
        LocationEdge(
            id="new_e_sew_2",
            world_id=world_id,
            from_location_id=loc_1l.id,
            to_location_id=loc_1m.id,
            direction_label="East trunk",
            compass_direction="E",
            distance_meters=140,
            distance_mode="flexible",
        ),
        LocationEdge(
            id="new_e_sew_2r",
            world_id=world_id,
            from_location_id=loc_1m.id,
            to_location_id=loc_1l.id,
            direction_label="West trunk",
            compass_direction="W",
            distance_meters=140,
            distance_mode="flexible",
        ),
    ]

    saved = repo.update_world(
        world_id,
        WorldUpdatePayload(
            name="Green Lie Topology Test",
            global_rules=WorldGlobalRules(
                genre="Cyberpunk",
                tone="Gritty",
                setting_overview="Sector 9 rooftops and flooded sub-sewers.",
            ),
            containers=[c_neon, c_sewers],
            locations=[loc_sump, loc_chop, loc_ent, loc_1l, loc_1m, loc_rooftop],
            edges=edges,
        ),
        owner_id=owner_id,
    )
    by_name = {loc.name: loc.id for loc in saved.locations}
    return saved.id, by_name


def test_schema_migrations_backfill_spatial_consistency_columns(tmp_path: Path) -> None:
    db_file = tmp_path / "legacy_spatial.db"
    conn = sqlite3.connect(db_file)
    try:
        conn.executescript(
            """
            CREATE TABLE worlds (
                id TEXT PRIMARY KEY,
                owner_id TEXT,
                name TEXT NOT NULL,
                global_rules_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE location_containers (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                parent_container_id TEXT,
                depth INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                environmental_tags_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE location_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT,
                name TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                environmental_tags_json TEXT NOT NULL,
                is_starting_location INTEGER NOT NULL DEFAULT 0,
                is_hub INTEGER NOT NULL DEFAULT 0,
                is_entry_exit INTEGER NOT NULL DEFAULT 0,
                starting_message TEXT
            );
            CREATE TABLE location_edges (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT,
                from_location_id TEXT NOT NULL,
                to_location_id TEXT NOT NULL,
                direction_label TEXT NOT NULL,
                distance_meters INTEGER NOT NULL DEFAULT 50
            );
            INSERT INTO worlds VALUES ('w1', NULL, 'Legacy World', '{}', '2026-01-01T00:00:00Z');
            INSERT INTO location_nodes VALUES ('l1', 'w1', NULL, 'Room A', 'A', 'Desc A', '[]', 1, 0, 0, 'Hi');
            INSERT INTO location_nodes VALUES ('l2', 'w1', NULL, 'Room B', 'B', 'Desc B', '[]', 0, 0, 0, NULL);
            INSERT INTO location_edges VALUES ('e1', 'w1', NULL, 'l1', 'l2', 'North', 80);
            """
        )
        conn.commit()
    finally:
        conn.close()

    repo = CantinaRepository(db_file, tmp_path / "media")
    repo.init_db()
    check_conn = repo._connect()
    try:
        node_cols = {r[1] for r in check_conn.execute("PRAGMA table_info(location_nodes)").fetchall()}
        edge_cols = {r[1] for r in check_conn.execute("PRAGMA table_info(location_edges)").fetchall()}
        assert "anchor_location_id" in node_cols
        assert "distance_mode" in edge_cols
        assert "is_vertical" in edge_cols

        edge_row = check_conn.execute(
            "SELECT distance_mode, is_vertical FROM location_edges WHERE id = 'e1'"
        ).fetchone()
        assert edge_row is not None
        assert tuple(edge_row) == ("flexible", 0)
        node_row = check_conn.execute(
            "SELECT anchor_location_id FROM location_nodes WHERE id = 'l1'"
        ).fetchone()
        assert node_row is not None
        assert tuple(node_row) == (None,)
    finally:
        check_conn.close()


def test_world_update_sanitizes_and_cow_remaps_anchors_and_edge_modes(
    empty_repo: CantinaRepository,
) -> None:
    user = seed_user(empty_repo, username="arch_builder", user_id="u_arch")
    world_id, ids_by_name = _seed_green_lie_like_world(empty_repo, user.id)

    world = empty_repo.get_world(world_id, owner_id=user.id)
    assert world is not None
    locs = {l.id: l for l in world.locations}
    assert locs[ids_by_name["Sewer Entrance"]].anchor_location_id == ids_by_name["The Sump-Well"]
    assert locs[ids_by_name["Tunnel 1-M"]].anchor_location_id == ids_by_name["The Chop-Cathedral"]
    # Invalid same-container & root-level anchors were cleared on save
    assert locs[ids_by_name["Tunnel 1-L"]].anchor_location_id is None
    assert locs[ids_by_name["Sector 9 Overpass"]].anchor_location_id is None

    edges = {(e.from_location_id, e.to_location_id): e for e in world.edges}
    street_e = edges[(ids_by_name["The Sump-Well"], ids_by_name["The Chop-Cathedral"])]
    assert street_e.distance_mode == "locked"
    assert street_e.is_vertical is False

    hatch_e = edges[(ids_by_name["The Sump-Well"], ids_by_name["Sewer Entrance"])]
    assert hatch_e.distance_mode == "locked"
    assert hatch_e.is_vertical is True

    portal_e = edges[(ids_by_name["Tunnel 1-M"], ids_by_name["Sector 9 Overpass"])]
    assert portal_e.distance_mode == "non_euclidean"
    assert portal_e.is_vertical is False

    # Attach campaign so update_world triggers Copy-on-Write world fork
    char = seed_character(empty_repo, owner_id=user.id, name="Diver", world_id=world.id)
    seed_campaign(empty_repo, owner_id=user.id, world_id=world.id, character_id=char.id)

    forked = empty_repo.update_world(
        world.id,
        WorldUpdatePayload(
            name="Green Lie Topology v2",
            global_rules=world.global_rules,
            containers=world.containers,
            locations=world.locations,
            edges=world.edges,
        ),
        owner_id=user.id,
    )
    assert forked.id != world.id
    forked_by_name = {l.name: l for l in forked.locations}
    old_sump_id = ids_by_name["The Sump-Well"]
    new_sump_id = forked_by_name["The Sump-Well"].id
    assert new_sump_id != old_sump_id
    # Anchor remapped to the NEW cloned location ID, never dangling to old world ID
    assert forked_by_name["Sewer Entrance"].anchor_location_id == new_sump_id
    assert forked_by_name["Tunnel 1-M"].anchor_location_id == forked_by_name["The Chop-Cathedral"].id


def test_campaign_spatial_routes_mirror_distance_mode_and_vertical(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = seed_user(empty_repo, username="spatial_rt", user_id="u_spatial_rt")
    world_id, ids_by_name = _seed_green_lie_like_world(empty_repo, user.id)
    char = seed_character(empty_repo, owner_id=user.id, name="Runner", world_id=world_id)
    camp = seed_campaign(empty_repo, owner_id=user.id, world_id=world_id, character_id=char.id)

    client = _client_for(empty_repo, monkeypatch, user.id)
    try:
        connect_res = client.post(
            f"/api/campaigns/{camp.id}/edges",
            json={
                "from_location_id": ids_by_name["Tunnel 1-L"],
                "to_location_id": ids_by_name["Sector 9 Overpass"],
                "direction_label": "Climb Manhole",
                "compass_direction": "NW",
                "distance_meters": 18,
                "bidirectional": True,
                "distance_mode": "locked",
                "is_vertical": True,
            },
        )
        assert connect_res.status_code == 200, connect_res.text
        edges_after_connect = connect_res.json()["visible_edges"]
        created_pair = [
            e
            for e in edges_after_connect
            if {e["from_location_id"], e["to_location_id"]}
            == {ids_by_name["Tunnel 1-L"], ids_by_name["Sector 9 Overpass"]}
        ]
        assert len(created_pair) == 2
        assert all(e["distance_mode"] == "locked" for e in created_pair)
        assert all(e["is_vertical"] is True for e in created_pair)

        target_edge_id = created_pair[0]["id"]
        patch_res = client.patch(
            f"/api/campaigns/{camp.id}/edges/{target_edge_id}",
            json={
                "distance_mode": "non_euclidean",
                "is_vertical": False,
                "update_reciprocal": True,
            },
        )
        assert patch_res.status_code == 200, patch_res.text
        updated_pair = [
            e
            for e in patch_res.json()["visible_edges"]
            if {e["from_location_id"], e["to_location_id"]}
            == {ids_by_name["Tunnel 1-L"], ids_by_name["Sector 9 Overpass"]}
        ]
        assert len(updated_pair) == 2
        assert all(e["distance_mode"] == "non_euclidean" for e in updated_pair)
        assert all(e["is_vertical"] is False for e in updated_pair)
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def test_campaign_map_update_branch_anchor_overrides_and_rewind_isolation(
    empty_repo: CantinaRepository,
) -> None:
    user = seed_user(empty_repo, username="branch_mapper", user_id="u_branch")
    world_id, ids_by_name = _seed_green_lie_like_world(empty_repo, user.id)
    char = seed_character(empty_repo, owner_id=user.id, name="Scout", world_id=world_id)
    camp = seed_campaign(empty_repo, owner_id=user.id, world_id=world_id, character_id=char.id)
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None

    turn1 = empty_repo.save_turn_node(
        turn_id="turn_anchor_branch",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        user_message="Descend into Tunnel 1-L",
        actor_id=char.id,
        raw_prose="Water echoes along the concrete corridor.",
        cognition=CognitionBlock(
            private_thoughts="Tight tunnels.",
            emotional_appraisal="Alert",
            new_mood_label="Focused",
            new_valence=0.0,
            new_arousal=0.4,
            new_want="Map the junction",
            new_plan="Check pipes",
            action_intent="Walk north",
        ),
        pre_turn=PreTurnAnalysis(narrative_mode="standard"),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_anchor_branch",
            world_timestamp="2099-05-01T21:05:00",
            active_location_id=ids_by_name["Tunnel 1-L"],
        ),
        character_state=CharacterStateSnapshot(
            turn_id="turn_anchor_branch",
            character_id=char.id,
            current_location_id=ids_by_name["Tunnel 1-L"],
            mood_label="Focused",
            valence=0.0,
            arousal=0.4,
            active_want="Map the junction",
            active_plan="Check pipes",
        ),
        recalled_items=[],
    )
    conn = empty_repo._connect()
    try:
        conn.execute(
            "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
            (turn1.id, camp.id),
        )
        conn.commit()
    finally:
        conn.close()

    bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert bundle is not None

    # Set anchor on Tunnel 1-L -> Chop-Cathedral and change Sewer edge to locked 1500m on active branch
    updated_locs = [
        loc.model_copy(
            update={"anchor_location_id": ids_by_name["The Chop-Cathedral"]}
        )
        if loc.id == ids_by_name["Tunnel 1-L"]
        else loc
        for loc in bundle.visible_locations
    ]
    updated_edges = [
        edge.model_copy(
            update={
                "distance_meters": 1500,
                "distance_mode": "locked",
                "is_vertical": False,
            }
        )
        if edge.from_location_id == ids_by_name["Tunnel 1-L"]
        and edge.to_location_id == ids_by_name["Tunnel 1-M"]
        else edge
        for edge in bundle.visible_edges
    ]

    after_save = empty_repo.update_campaign_map(
        camp.id,
        CampaignMapUpdatePayload(
            containers=bundle.containers,
            locations=updated_locs,
            edges=updated_edges,
        ),
        owner_id=user.id,
    )
    t1l_after = next(l for l in after_save.visible_locations if l.id == ids_by_name["Tunnel 1-L"])
    assert t1l_after.anchor_location_id == ids_by_name["The Chop-Cathedral"]
    sew_edge_after = next(
        e
        for e in after_save.visible_edges
        if e.from_location_id == ids_by_name["Tunnel 1-L"]
        and e.to_location_id == ids_by_name["Tunnel 1-M"]
    )
    assert sew_edge_after.distance_meters == 1500
    assert sew_edge_after.distance_mode == "locked"

    # Rewinding to root excludes Turn 1 overrides cleanly
    conn = empty_repo._connect()
    try:
        conn.execute(
            "UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?",
            (root_turn_id, camp.id),
        )
        conn.commit()
    finally:
        conn.close()

    after_rewind = empty_repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert after_rewind is not None
    t1l_rewound = next(l for l in after_rewind.visible_locations if l.id == ids_by_name["Tunnel 1-L"])
    assert t1l_rewound.anchor_location_id is None


def test_zcc_world_and_campaign_export_import_roundtrip_and_legacy_defaults(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    reset_rate_limiters()
    u1 = seed_user(empty_repo, username="zcc_exp", user_id="u_zcc_1")
    u2 = seed_user(empty_repo, username="zcc_imp", user_id="u_zcc_2")
    world_id, ids_by_name = _seed_green_lie_like_world(empty_repo, u1.id)

    char = seed_character(empty_repo, owner_id=u1.id, name="Porter", world_id=world_id)
    camp = seed_campaign(empty_repo, owner_id=u1.id, world_id=world_id, character_id=char.id)

    # Apply a branch anchor override on Tunnel 1-L before exporting campaign
    bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u1.id)
    assert bundle is not None
    empty_repo.update_campaign_map(
        camp.id,
        CampaignMapUpdatePayload(
            containers=bundle.containers,
            locations=[
                l.model_copy(update={"anchor_location_id": ids_by_name["The Sump-Well"]})
                if l.id == ids_by_name["Tunnel 1-L"]
                else l
                for l in bundle.visible_locations
            ],
            edges=bundle.visible_edges,
        ),
        owner_id=u1.id,
    )

    try:
        client_u1 = _client_for(empty_repo, monkeypatch, u1.id)
        exp_world = client_u1.get(f"/api/export/world/{world_id}")
        assert exp_world.status_code == 200, exp_world.text
        world_zcc = exp_world.content

        exp_camp = client_u1.post(
            f"/api/export/campaign/{camp.id}",
            json={"timeline_scope": "full"},
        )
        assert exp_camp.status_code == 200, exp_camp.text
        camp_zcc = exp_camp.content

        # Strip new consistency fields to verify legacy .zcc import defaults
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(world_zcc), "r") as zin, zipfile.ZipFile(buf, "w") as zout:
            for item in zin.infolist():
                raw = zin.read(item.filename)
                if item.filename == "worlds.json":
                    data = json.loads(raw)
                    for w in data:
                        w["name"] = "Legacy Stripped World"
                        for loc in w.get("locations", []):
                            loc.pop("anchor_location_id", None)
                        for edge in w.get("edges", []):
                            edge.pop("distance_mode", None)
                            edge.pop("is_vertical", None)
                    raw = json.dumps(data).encode("utf-8")
                zout.writestr(item, raw)
        legacy_zcc = buf.getvalue()

        # Import full world.zcc as u2
        client_u2 = _client_for(empty_repo, monkeypatch, u2.id)
        ins_w = client_u2.post(
            "/api/import/inspect",
            files={"file": ("world.zcc", world_zcc, "application/octet-stream")},
        )
        assert ins_w.status_code == 200, ins_w.text
        com_w = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_w.json()["staged_token"], "default_conflict_strategy": "copy"},
        )
        assert com_w.status_code == 200, com_w.text

        u2_worlds = empty_repo.list_worlds(owner_id=u2.id)
        imp_w = empty_repo.get_world(u2_worlds[0].id, owner_id=u2.id)
        assert imp_w is not None
        imp_locs = {l.name: l for l in imp_w.locations}
        assert imp_locs["Sewer Entrance"].anchor_location_id == imp_locs["The Sump-Well"].id
        assert imp_locs["Sewer Entrance"].anchor_location_id != ids_by_name["The Sump-Well"]
        imp_edges = {
            (
                next(l.name for l in imp_w.locations if l.id == e.from_location_id),
                next(l.name for l in imp_w.locations if l.id == e.to_location_id),
            ): e
            for e in imp_w.edges
        }
        assert imp_edges[("The Sump-Well", "The Chop-Cathedral")].distance_mode == "locked"
        assert imp_edges[("The Sump-Well", "Sewer Entrance")].is_vertical is True
        assert imp_edges[("Tunnel 1-M", "Sector 9 Overpass")].distance_mode == "non_euclidean"

        # Import campaign.zcc as u2 and verify branch anchor override survived remap
        ins_c = client_u2.post(
            "/api/import/inspect",
            files={"file": ("camp.zcc", camp_zcc, "application/octet-stream")},
        )
        assert ins_c.status_code == 200, ins_c.text
        com_c = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_c.json()["staged_token"], "default_conflict_strategy": "copy"},
        )
        assert com_c.status_code == 200, com_c.text
        u2_camps = empty_repo.list_campaigns(owner_id=u2.id)
        assert len(u2_camps) == 1
        imp_bundle = empty_repo.get_campaign_state_bundle(u2_camps[0].id, owner_id=u2.id)
        assert imp_bundle is not None
        imp_t1l = next(l for l in imp_bundle.visible_locations if l.name == "Tunnel 1-L")
        imp_camp_sump = next(l for l in imp_bundle.visible_locations if l.name == "The Sump-Well")
        assert imp_t1l.anchor_location_id == imp_camp_sump.id

        # Import legacy stripped world.zcc as u2 -> defaults clean
        ins_l = client_u2.post(
            "/api/import/inspect",
            files={"file": ("legacy.zcc", legacy_zcc, "application/octet-stream")},
        )
        assert ins_l.status_code == 200, ins_l.text
        com_l = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_l.json()["staged_token"], "default_conflict_strategy": "copy"},
        )
        assert com_l.status_code == 200, com_l.text
        legacy_world_summary = next(
            w for w in empty_repo.list_worlds(owner_id=u2.id) if w.name == "Legacy Stripped World"
        )
        legacy_w = empty_repo.get_world(legacy_world_summary.id, owner_id=u2.id)
        assert legacy_w is not None
        assert all(l.anchor_location_id is None for l in legacy_w.locations)
        assert all(e.distance_mode == "flexible" and e.is_vertical is False for e in legacy_w.edges)
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)
