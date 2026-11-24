"""End-to-end backend tests for v0.37.0 First-Class Map Links."""

from __future__ import annotations

import asyncio
import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine.context.lore_scope import select_newly_discovered_secret_edges
from app.engine.context.zone4_ephemeral import build_zone4_ephemeral_tail_frame
from app.engine.gm_talk import (
    _compute_branch_visibility,
    _visible_location_exits_for_gm,
)
from app.engine.gm_tools import execute_gm_tool
from app.engine.llm_client import llm_client
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.routers import campaigns as campaigns_facade
from app.routers import import_export as import_export_router
from app.schemas.character import CognitionBlock
from app.schemas.llm_tools import LlmToolCall
from app.schemas.turn import (
    CampaignWorldSettings,
    CharacterAgentDelta,
    DiceRollResult,
    PreTurnAnalysis,
    TurnSubmitRequest,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    NeighborLocationView,
    WorldGlobalRules,
    format_exit_travel_phrase,
)
from tests.factories import seed_campaign, seed_character, seed_user, seed_world


def _authed_client(empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, user_id: str) -> TestClient:
    profile = empty_repo.get_user_by_id(user_id)
    monkeypatch.setattr(main_module, "get_repo", lambda: empty_repo)
    monkeypatch.setattr(import_export_router, "get_repo", lambda: empty_repo)
    main_module.app.dependency_overrides[get_current_user] = lambda: profile
    return TestClient(main_module.app)


def _seed_three_room_world(
    repo: CantinaRepository,
    owner_id: str,
    *,
    with_secret_branch: bool = True,
) -> tuple[Any, dict[str, Any]]:
    locations = [
        LocationNodeDraft(
            key="lobby",
            name="Grand Lobby",
            summary="Starting atrium.",
            description="A marble hall with velvet ropes.",
            environmental_tags=["marble", "atrium"],
            is_starting_location=True,
            is_hub=True,
        ),
        LocationNodeDraft(
            key="bog",
            name="Mire Trail",
            summary="Waterlogged trail.",
            description="Sinking peat and reeds.",
            environmental_tags=["swamp", "mud"],
        ),
    ]
    edges = [
        LocationEdgeDraft(
            from_key="lobby",
            to_key="bog",
            direction_label="Muddy Sluice Gate",
            reverse_direction_label="Back to Grand Lobby",
            compass_direction="E",
            reverse_compass_direction="W",
            distance_meters=2100,
            speed_modifier=0.3,
            travel_mode="Swamp / Bog",
            obstacles=["Knee-Deep Mud", "Thorny Vines"],
            is_blocked=True,
            is_secret=False,
        ),
    ]
    if with_secret_branch:
        locations.append(
            LocationNodeDraft(
                key="vault",
                name="Subterranean Vault",
                summary="Hidden archive room.",
                description="Dusty ledgers behind masonry.",
                environmental_tags=["secret", "vault"],
            )
        )
        edges.append(
            LocationEdgeDraft(
                from_key="lobby",
                to_key="vault",
                direction_label="Sliding Bookcase Alcove",
                reverse_direction_label="Hidden Spring Door",
                compass_direction="N",
                reverse_compass_direction="S",
                distance_meters=35,
                speed_modifier=1.0,
                travel_mode=None,
                obstacles=["Concealed Latch"],
                is_blocked=False,
                is_secret=True,
            )
        )

    world = seed_world(
        repo,
        owner_id=owner_id,
        name="Link Feature World",
        locations=locations,
        edges=edges,
        global_rules=WorldGlobalRules(
            genre="Mystery",
            tone="Suspenseful",
            setting_overview="An estate hiding flooded marshlands and secret archives.",
            starting_timestamp="1926-09-12 20:00",
        ),
    )
    loc_by_name = {loc.name: loc for loc in world.locations}
    return world, loc_by_name


def test_legacy_sqlite_migration_and_revealed_edge_ids_column(tmp_path: Path) -> None:
    """Old SQLite DBs with is_locked_or_hidden=1 migrate into is_blocked=1, is_secret=0 cleanly."""
    db_file = tmp_path / "legacy_links.db"
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
            distance_meters INTEGER NOT NULL DEFAULT 50,
            is_locked_or_hidden INTEGER NOT NULL DEFAULT 0,
            created_at_turn_id TEXT NULL,
            superseded_at_turn_id TEXT NULL
        );
        CREATE TABLE world_state_snapshots (
            turn_id TEXT PRIMARY KEY,
            world_timestamp TEXT NOT NULL DEFAULT '',
            active_location_id TEXT NOT NULL DEFAULT '',
            scene_flags_json TEXT NOT NULL DEFAULT '[]',
            campaign_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
            visited_location_ids_json TEXT NOT NULL DEFAULT '[]',
            visited_container_ids_json TEXT NOT NULL DEFAULT '[]',
            revealed_lore_ids_json TEXT NOT NULL DEFAULT '[]',
            parties_json TEXT NOT NULL DEFAULT '[]'
        );
        INSERT INTO worlds (id, owner_id, name) VALUES ('w_mig', NULL, 'Migrated World');
        INSERT INTO location_nodes (id, world_id, name, is_starting_location) VALUES
            ('l1', 'w_mig', 'Entry', 1),
            ('l2', 'w_mig', 'Cellar', 0);
        INSERT INTO location_edges (
            id, world_id, from_location_id, to_location_id, direction_label, compass_direction, distance_meters, is_locked_or_hidden
        ) VALUES
            ('e_locked', 'w_mig', 'l1', 'l2', 'Iron Grate', 'D', 45, 1),
            ('e_open', 'w_mig', 'l2', 'l1', 'Cellar Stairs', 'U', 45, 0);
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(str(db_file))
    repo.init_db()
    repo.init_db()

    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row
    try:
        edge_cols = {row["name"] for row in conn.execute("PRAGMA table_info(location_edges)").fetchall()}
        assert {"speed_modifier", "travel_mode", "obstacles_json", "is_blocked", "is_secret"} <= edge_cols
        assert "is_locked_or_hidden" not in edge_cols

        ws_cols = {row["name"] for row in conn.execute("PRAGMA table_info(world_state_snapshots)").fetchall()}
        assert "revealed_edge_ids_json" in ws_cols

        rows = {
            row["id"]: dict(row)
            for row in conn.execute("SELECT * FROM location_edges").fetchall()
        }
        assert rows["e_locked"]["is_blocked"] == 1
        assert rows["e_locked"]["is_secret"] == 0
        assert rows["e_locked"]["speed_modifier"] == pytest.approx(1.0)
        assert rows["e_locked"]["travel_mode"] is None
        assert rows["e_locked"]["obstacles_json"] == "[]"
        assert rows["e_open"]["is_blocked"] == 0
        assert rows["e_open"]["is_secret"] == 0
    finally:
        conn.close()


def test_zcc_roundtrip_and_legacy_locked_coercion(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """World & campaign .zcc round-trips preserve link properties, revealed_edge_ids, and coerce legacy archives."""
    u1 = seed_user(empty_repo, username="zcc_u1", display_name="ZCC U1")
    u2 = seed_user(empty_repo, username="zcc_u2", display_name="ZCC U2")
    world, loc_map = _seed_three_room_world(empty_repo, u1.id)
    char = seed_character(empty_repo, owner_id=u1.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u1.id, world_id=world.id, character_id=char.id)

    secret_edge = next(e for e in world.edges if e.is_secret)
    empty_repo.update_campaign_world_settings(
        camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u1.id
    )
    empty_repo.toggle_campaign_edge_reveal(camp.id, secret_edge.id, revealed=True, owner_id=u1.id)
    empty_repo.update_campaign_world_settings(
        camp.id, CampaignWorldSettings(unlock_lore=False), owner_id=u1.id
    )

    try:
        client1 = _authed_client(empty_repo, monkeypatch, u1.id)
        exp_res = client1.post(
            f"/api/export/campaign/{camp.id}",
            json={"timeline_scope": "full"},
        )
        assert exp_res.status_code == 200
        zcc_bytes = exp_res.content

        with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as zf:
            exported_worlds = json.loads(zf.read("worlds.json"))
            exported_edges = exported_worlds[0]["edges"]
            bog_edge = next(e for e in exported_edges if e["travel_mode"] == "Swamp / Bog")
            assert bog_edge["speed_modifier"] == pytest.approx(0.3)
            assert bog_edge["obstacles"] == ["Knee-Deep Mud", "Thorny Vines"]
            assert bog_edge["is_blocked"] is True
            assert bog_edge["is_secret"] is False

        client2 = _authed_client(empty_repo, monkeypatch, u2.id)
        ins_res = client2.post(
            "/api/import/inspect",
            files={"file": ("links_roundtrip.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert ins_res.status_code == 200
        commit_res = client2.post(
            "/api/import/commit",
            json={
                "staged_token": ins_res.json()["staged_token"],
                "import_campaign_assets_as_standalone": True,
            },
        )
        assert commit_res.status_code == 200

        u2_camps = empty_repo.list_campaigns(owner_id=u2.id)
        imported_camp = u2_camps[0]
        imported_bundle = empty_repo.get_campaign_state_bundle(imported_camp.id, owner_id=u2.id)
        # Remapped secret edge must remain discovered after import!
        imported_secret_edges = [e for e in imported_bundle.visible_edges if e.is_secret]
        assert len(imported_secret_edges) == 2
        assert len(imported_bundle.current_world_snapshot.revealed_edge_ids) >= 2
        bog_imported = next(e for e in imported_bundle.visible_edges if e.travel_mode == "Swamp / Bog")
        assert bog_imported.speed_modifier == pytest.approx(0.3)
        assert bog_imported.obstacles == ["Knee-Deep Mud", "Thorny Vines"]
        assert bog_imported.is_blocked is True

        # Legacy archive coercion: replace new fields with is_locked_or_hidden=True in worlds.json
        with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as src_zf:
            entries = {n: src_zf.read(n) for n in src_zf.namelist()}
        legacy_worlds = json.loads(entries["worlds.json"])
        for e in legacy_worlds[0]["edges"]:
            e.pop("speed_modifier", None)
            e.pop("travel_mode", None)
            e.pop("obstacles", None)
            e.pop("is_blocked", None)
            e.pop("is_secret", None)
            e["is_locked_or_hidden"] = True
        legacy_worlds[0]["edges"][0]["id"] = legacy_worlds[0]["edges"][0]["id"]
        entries["worlds.json"] = json.dumps(legacy_worlds).encode("utf-8")
        legacy_buf = io.BytesIO()
        with zipfile.ZipFile(legacy_buf, "w", zipfile.ZIP_DEFLATED) as out_zf:
            for k, v in entries.items():
                out_zf.writestr(k, v)
        leg_ins = client2.post(
            "/api/import/inspect",
            files={"file": ("legacy.zcc", legacy_buf.getvalue(), "application/octet-stream")},
        )
        assert leg_ins.status_code == 200
        # Ensure standalone world import coerces is_locked_or_hidden=True cleanly without unsupported warnings
        leg_commit = client2.post(
            "/api/import/commit",
            json={
                "staged_token": leg_ins.json()["staged_token"],
                "import_campaign_assets_as_standalone": True,
            },
        )
        assert leg_commit.status_code == 200
        u2_worlds = empty_repo.list_worlds(owner_id=u2.id)
        coerced_world = max(u2_worlds, key=lambda w: w.created_at)
        assert all(e.is_blocked is True and e.is_secret is False for e in coerced_world.edges)
        assert not coerced_world.unsupported_fields
    finally:
        main_module.app.dependency_overrides.clear()


def test_patch_edge_permissions_clear_mode_and_cow_preserves_reveal(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PATCH /edges/{id} enforces GM 403 on is_secret, clears travel_mode on null, and preserves reveal across CoW."""
    u = seed_user(empty_repo, username="patch_u", display_name="Patch U")
    world, loc_map = _seed_three_room_world(empty_repo, u.id)
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)

    bog_edge = next(
        e for e in world.edges
        if e.from_location_id == loc_map["Grand Lobby"].id and e.to_location_id == loc_map["Mire Trail"].id
    )
    secret_edge = next(
        e for e in world.edges
        if e.from_location_id == loc_map["Grand Lobby"].id and e.to_location_id == loc_map["Subterranean Vault"].id
    )

    try:
        client = _authed_client(empty_repo, monkeypatch, u.id)

        # Player mode cannot toggle is_secret -> 403
        deny_res = client.patch(
            f"/api/campaigns/{camp.id}/edges/{bog_edge.id}",
            json={"is_secret": True},
        )
        assert deny_res.status_code == 403

        # Player mode CAN update operational properties + clear travel_mode with null
        ok_res = client.patch(
            f"/api/campaigns/{camp.id}/edges/{bog_edge.id}",
            json={
                "speed_modifier": 25.0,
                "travel_mode": None,
                "obstacles": ["Rusted Rail", "Signal Flare"],
                "is_blocked": False,
                "direction_label": "Restored Mag-Lev Spur",
                "reciprocal_direction_label": "Return Spur to Lobby",
            },
        )
        assert ok_res.status_code == 200
        bundle = ok_res.json()
        updated_fwd = next(e for e in bundle["visible_edges"] if e["direction_label"] == "Restored Mag-Lev Spur")
        updated_rev = next(e for e in bundle["visible_edges"] if e["direction_label"] == "Return Spur to Lobby")
        assert updated_fwd["speed_modifier"] == pytest.approx(25.0)
        assert updated_fwd["travel_mode"] is None
        assert updated_fwd["obstacles"] == ["Rusted Rail", "Signal Flare"]
        assert updated_fwd["is_blocked"] is False
        assert updated_rev["speed_modifier"] == pytest.approx(25.0)
        assert updated_rev["travel_mode"] is None

        # Enable GM Mode, reveal secret_edge, then CoW-edit secret_edge -> reveal persists on new CoW ID!
        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u.id
        )
        rev_res = client.post(
            f"/api/campaigns/{camp.id}/edges/{secret_edge.id}/reveal",
            json={"revealed": True},
        )
        assert rev_res.status_code == 200
        assert secret_edge.id in rev_res.json()["current_world_snapshot"]["revealed_edge_ids"]

        cow_res = client.patch(
            f"/api/campaigns/{camp.id}/edges/{secret_edge.id}",
            json={"distance_meters": 55, "obstacles": ["Oil-Slick Hinges"]},
        )
        assert cow_res.status_code == 200
        cow_bundle = cow_res.json()
        new_fwd = next(
            e for e in cow_bundle["visible_edges"]
            if e["from_location_id"] == loc_map["Grand Lobby"].id
            and e["to_location_id"] == loc_map["Subterranean Vault"].id
        )
        assert new_fwd["id"] != secret_edge.id
        assert new_fwd["id"] in cow_bundle["current_world_snapshot"]["revealed_edge_ids"]
    finally:
        main_module.app.dependency_overrides.clear()


def test_reveal_edge_endpoint_pairwise_and_branch_rewind(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """POST /edges/{id}/reveal guards GM Mode, toggles pairs, and rewinding re-hides secret links."""
    u = seed_user(empty_repo, username="rev_u", display_name="Rev U")
    world, loc_map = _seed_three_room_world(empty_repo, u.id)
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)
    turn_0_id = camp.active_leaf_turn_id
    assert turn_0_id is not None

    secret_fwd = next(
        e for e in world.edges
        if e.is_secret and e.from_location_id == loc_map["Grand Lobby"].id
    )
    secret_rev = next(
        e for e in world.edges
        if e.is_secret and e.to_location_id == loc_map["Grand Lobby"].id
    )

    try:
        client = _authed_client(empty_repo, monkeypatch, u.id)

        # 403 when GM Mode is OFF
        deny_res = client.post(
            f"/api/campaigns/{camp.id}/edges/{secret_fwd.id}/reveal",
            json={"revealed": True},
        )
        assert deny_res.status_code == 403

        # Add Turn 1 off Turn 0, then unlock GM Mode and reveal on Turn 1
        t0_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
        t1 = empty_repo.save_turn_node(
            turn_id="turn_rev_1",
            campaign_id=camp.id,
            parent_turn_id=turn_0_id,
            depth_index=1,
            user_message="Tap the wainscot panels.",
            actor_id=char.id,
            raw_prose="Hollow echo behind the shelf.",
            cognition=CognitionBlock(skipped=True),
            pre_turn=PreTurnAnalysis(),
            world_snapshot=t0_bundle.current_world_snapshot.model_copy(
                update={"turn_id": "turn_rev_1"}
            ),
            character_state=t0_bundle.current_character_state.model_copy(
                update={"turn_id": "turn_rev_1"}
            ),
            recalled_items=[],
        )

        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u.id
        )
        rev_res = client.post(
            f"/api/campaigns/{camp.id}/edges/{secret_fwd.id}/reveal",
            json={"revealed": True},
        )
        assert rev_res.status_code == 200
        rev_ids = rev_res.json()["current_world_snapshot"]["revealed_edge_ids"]
        assert secret_fwd.id in rev_ids
        assert secret_rev.id in rev_ids

        # Player Mode sees revealed secret in neighbor_locations & visible_edges
        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=False), owner_id=u.id
        )
        player_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
        assert any(nb.edge_id == secret_fwd.id for nb in player_bundle.neighbor_locations)

        # Checkout back to Turn 0 -> secret link is hidden again!
        empty_repo.checkout_turn_branch(camp.id, turn_0_id, owner_id=u.id)
        rewound_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
        assert not any(nb.edge_id == secret_fwd.id for nb in rewound_bundle.neighbor_locations)
        assert not any(e.is_secret for e in rewound_bundle.visible_edges)

        # Re-checkout Turn 1 & test GM re-hide
        empty_repo.checkout_turn_branch(camp.id, t1.id, owner_id=u.id)
        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u.id
        )
        hide_res = client.post(
            f"/api/campaigns/{camp.id}/edges/{secret_fwd.id}/reveal",
            json={"revealed": False},
        )
        assert hide_res.status_code == 200
        assert secret_fwd.id not in hide_res.json()["current_world_snapshot"]["revealed_edge_ids"]
        assert secret_rev.id not in hide_res.json()["current_world_snapshot"]["revealed_edge_ids"]
    finally:
        main_module.app.dependency_overrides.clear()


def test_player_mode_map_update_preserves_hidden_secret_links(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PUT /map in Player Mode omits hidden secret edges from visible_edges and must preserve them intact."""
    u = seed_user(empty_repo, username="pmap_u", display_name="PMap U")
    world, loc_map = _seed_three_room_world(empty_repo, u.id)
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)

    try:
        client = _authed_client(empty_repo, monkeypatch, u.id)
        player_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)

        # Player bundle omits hidden secret links even though Subterranean Vault is only linked via secret edge!
        assert not any(e.is_secret for e in player_bundle.visible_edges)

        # Edit unvisited Mire Trail summary + visible Mire Trail edge distance and PUT /map
        edited_locs = [
            loc.model_copy(update={"summary": "Updated waterlogged trail summary."})
            if loc.id == loc_map["Mire Trail"].id
            else loc
            for loc in player_bundle.visible_locations
        ]
        edited_edges = [
            edge.model_copy(update={"distance_meters": 1800, "speed_modifier": 0.6})
            for edge in player_bundle.visible_edges
        ]
        put_res = client.put(
            f"/api/campaigns/{camp.id}/map",
            json={
                "containers": [c.model_dump() for c in player_bundle.containers],
                "locations": [l.model_dump() for l in edited_locs],
                "edges": [e.model_dump() for e in edited_edges],
            },
        )
        assert put_res.status_code == 200

        # Toggle GM Mode ON and confirm the hidden secret edge pair was NOT wiped!
        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u.id
        )
        gm_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
        secret_edges = [e for e in gm_bundle.visible_edges if e.is_secret]
        assert len(secret_edges) == 2

        # Submitting an edge with is_secret=True in Player Mode fails with 403
        empty_repo.update_campaign_world_settings(
            camp.id, CampaignWorldSettings(unlock_lore=False), owner_id=u.id
        )
        bad_edges = [
            edge.model_copy(update={"is_secret": True}) for edge in edited_edges
        ]
        bad_res = client.put(
            f"/api/campaigns/{camp.id}/map",
            json={
                "containers": [c.model_dump() for c in player_bundle.containers],
                "locations": [l.model_dump() for l in edited_locs],
                "edges": [e.model_dump() for e in bad_edges],
            },
        )
        assert bad_res.status_code == 403
    finally:
        main_module.app.dependency_overrides.clear()


def test_same_turn_secret_discovery_dice_and_diceless(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Failed roll stays hidden; Clean Success & diceless search intent discover on the same turn & persist pairwise."""
    u = seed_user(empty_repo, username="disc_u", display_name="Disc U")
    world, loc_map = _seed_three_room_world(empty_repo, u.id)
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)

    secret_edge = next(
        e for e in world.edges
        if e.is_secret and e.from_location_id == loc_map["Grand Lobby"].id
    )
    secret_rev = next(
        e for e in world.edges
        if e.is_secret and e.to_location_id == loc_map["Grand Lobby"].id
    )
    vault_nb = NeighborLocationView(
        edge_id=secret_edge.id,
        direction_label=secret_edge.direction_label,
        compass_direction=secret_edge.compass_direction,
        distance_meters=secret_edge.distance_meters,
        obstacles=list(secret_edge.obstacles),
        is_secret=True,
        destination=loc_map["Subterranean Vault"],
    )

    fail_roll = DiceRollResult(
        character_id=char.id,
        action_description="Search the bookcase",
        skill_or_approach="Investigation",
        d20_raw=4,
        modifier=1,
        total=5,
        difficulty_class=14,
        outcome_tier="Simple Failure",
        narrative_directive="Find nothing.",
    )
    assert (
        select_newly_discovered_secret_edges(
            [vault_nb],
            user_message="I inspect the bookcase.",
            pre_turn=PreTurnAnalysis(
                resolved_roll=fail_roll,
                character_rolls={char.id: fail_roll},
            ),
            dice_mode="auto",
        )
        == []
    )

    ok_roll = DiceRollResult(
        character_id=char.id,
        action_description="Search behind the shelves",
        skill_or_approach="Investigation",
        d20_raw=17,
        modifier=2,
        total=19,
        difficulty_class=14,
        outcome_tier="Clean Success",
        narrative_directive="Uncover a sliding latch.",
    )
    assert len(
        select_newly_discovered_secret_edges(
            [vault_nb],
            user_message="I search the shelves.",
            pre_turn=PreTurnAnalysis(
                resolved_roll=ok_roll,
                character_rolls={char.id: ok_roll},
            ),
            dice_mode="auto",
        )
    ) == 1

    # Diceless mode reveals on search/keyword intent without a dice roll
    assert len(
        select_newly_discovered_secret_edges(
            [vault_nb],
            user_message="I press the concealed latch.",
            pre_turn=PreTurnAnalysis(),
            dice_mode="disabled",
        )
    ) == 1

    # Full turn execution test: Clean Success discovery injects into Zone 4 and persists pairwise
    monkeypatch.setattr(
        campaigns_facade,
        "run_phase1_pre_analysis",
        AsyncMock(
            return_value=PreTurnAnalysis(
                active_speaker_id=char.id,
                speaker_order=[char.id],
                resolved_roll=ok_roll,
                character_rolls={char.id: ok_roll},
            )
        ),
    )
    monkeypatch.setattr(
        campaigns_facade,
        "run_phase3_multi_cognition",
        AsyncMock(
            return_value={
                char.id: CognitionBlock(
                    recall="A hidden switch clicks.",
                    feeling="Intrigued",
                    valence=0.2,
                    arousal=0.6,
                    want="Inspect the vault.",
                    plan="Open the secret passage.",
                )
            }
        ),
    )

    captured_neighbors_in_p4: list[NeighborLocationView] = []
    captured_discovered_ids: set[str] = set()

    async def fake_stream_phase4_prose(**kwargs: Any):
        captured_neighbors_in_p4.extend(kwargs["neighbors"])
        yield {"event": "prose_chunk", "data": {"delta": "A bookshelf swings inward."}}
        yield {
            "event": "actor_finished",
            "data": {
                "cognition": kwargs["established_cognitions"][char.id].model_dump(),
                "raw_prose": "A bookshelf swings inward.",
            },
        }

    monkeypatch.setattr(campaigns_facade, "stream_phase4_prose", fake_stream_phase4_prose)
    orig_assembler = main_module.assemble_four_zone_messages if hasattr(main_module, "assemble_four_zone_messages") else None
    assert orig_assembler is None  # assembled inside turn_streaming

    from app.routers.campaign_routes import turn_streaming as ts_mod

    orig_build_zone4 = ts_mod.assemble_four_zone_messages

    def spy_assemble(*args: Any, **kwargs: Any):
        captured_discovered_ids.update(kwargs.get("newly_discovered_edge_ids") or set())
        return orig_build_zone4(*args, **kwargs)

    monkeypatch.setattr(ts_mod, "assemble_four_zone_messages", spy_assemble)

    monkeypatch.setattr(main_module, "get_repo", lambda: empty_repo)
    monkeypatch.setattr(ts_mod, "get_repo", lambda: empty_repo)

    async def run_turn() -> None:
        async for _ev in main_module._execute_turn_stream_events(
            camp.id,
            TurnSubmitRequest(user_message="I inspect the bookcase for a hidden switch."),
            owner_id=u.id,
        ):
            pass

    asyncio.run(run_turn())

    assert secret_edge.id in captured_discovered_ids
    assert any(nb.edge_id == secret_edge.id for nb in captured_neighbors_in_p4)

    after_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
    assert secret_edge.id in after_bundle.current_world_snapshot.revealed_edge_ids
    assert secret_rev.id in after_bundle.current_world_snapshot.revealed_edge_ids
    assert any(nb.edge_id == secret_edge.id for nb in after_bundle.neighbor_locations)


def test_phase5_clerk_travel_time_floor_and_exit_phrases(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 5 Clerk applies speed-adjusted travel duration as a deterministic floor over LLM elapsed_minutes."""
    u = seed_user(empty_repo, username="clerk_u", display_name="Clerk U")
    world = seed_world(
        empty_repo,
        owner_id=u.id,
        name="Transit Test World",
        locations=[
            LocationNodeDraft(
                key="hub",
                name="Central Station",
                summary="Main hub",
                description="Platform.",
                is_starting_location=True,
                is_hub=True,
            ),
            LocationNodeDraft(
                key="marsh",
                name="Black Peat Marsh",
                summary="Slow bog",
                description="Sinking mire.",
            ),
            LocationNodeDraft(
                key="spire",
                name="Skyport Terminal",
                summary="Fast terminal",
                description="Glass concourse.",
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="hub",
                to_key="marsh",
                direction_label="Boardwalk into Marsh",
                distance_meters=2100,
                speed_modifier=0.3,
                travel_mode="Swamp",
            ),
            LocationEdgeDraft(
                from_key="hub",
                to_key="spire",
                direction_label="Mag-Lev Platform",
                distance_meters=17500,
                speed_modifier=25.0,
                travel_mode="Rail",
            ),
        ],
    )
    locs = {l.name: l for l in world.locations}
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)
    bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)

    # Check mode-aware exit formatting (no hardcoded 'walk' when modified!)
    assert format_exit_travel_phrase(2100, 0.3, "Swamp") == "~1h 40min via Swamp"
    assert format_exit_travel_phrase(17500, 25.0, "Rail") == "~10 min via Rail"
    assert format_exit_travel_phrase(350, 1.0, None) == "~5 min walk"

    z4 = build_zone4_ephemeral_tail_frame(
        user_message="Check exits.",
        character=char,
        world_snapshot=bundle.current_world_snapshot,
        character_state=bundle.current_character_state,
        active_location=locs["Central Station"],
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=PreTurnAnalysis(),
        established_cognition=CognitionBlock(skipped=True),
    )
    assert "~1h 40min via Swamp" in z4
    assert "~10 min via Rail" in z4

    turn_slow = empty_repo.save_turn_node(
        turn_id="turn_slow_move",
        campaign_id=camp.id,
        parent_turn_id=camp.active_leaf_turn_id,
        depth_index=1,
        user_message="Trudge out to Black Peat Marsh.",
        actor_id=char.id,
        raw_prose="They slog through deep peat until reaching Black Peat Marsh.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(spatial_intent="move_known"),
        world_snapshot=bundle.current_world_snapshot.model_copy(update={"turn_id": "turn_slow_move"}),
        character_state=bundle.current_character_state.model_copy(update={"turn_id": "turn_slow_move"}),
        recalled_items=[],
    )

    def _mock_clerk_complete(slow_delta: WorldPostTurnDelta):
        async def _fn(*args: Any, **kwargs: Any):
            schema_cls = kwargs.get("schema_cls") or (
                args[1] if len(args) > 1 else None
            )
            if schema_cls is CharacterAgentDelta:
                return CharacterAgentDelta()
            return slow_delta

        return AsyncMock(side_effect=_fn)

    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        _mock_clerk_complete(
            WorldPostTurnDelta(
                elapsed_minutes=1,  # Way below 100-min swamp floor!
                transition_type="move_existing",
                target_location_id=locs["Black Peat Marsh"].id,
                scene_flags_updated=["Mud-spattered"],
            )
        ),
    )
    updated_turn, _ = asyncio.run(
        run_phase5_post_turn_clerk(
            repo=empty_repo,
            campaign_id=camp.id,
            world_id=world.id,
            character=char,
            completed_turn=turn_slow,
            active_location=locs["Central Station"],
            neighbors=bundle.neighbor_locations,
        )
    )
    assert updated_turn.world_snapshot.campaign_elapsed_minutes >= 100

    # Fast 25x Rail: 17500m / (70 * 25) = 10 min floor
    turn_fast = empty_repo.save_turn_node(
        turn_id="turn_fast_move",
        campaign_id=camp.id,
        parent_turn_id=turn_slow.id,
        depth_index=2,
        user_message="Board the Mag-Lev back and up to Skyport Terminal.",
        actor_id=char.id,
        raw_prose="The rail streaks up into Skyport Terminal.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(spatial_intent="move_known"),
        world_snapshot=updated_turn.world_snapshot.model_copy(
            update={
                "turn_id": "turn_fast_move",
                "active_location_id": locs["Central Station"].id,
            }
        ),
        character_state=updated_turn.character_states[char.id].model_copy(
            update={
                "turn_id": "turn_fast_move",
                "current_location_id": locs["Central Station"].id,
            }
        ),
        recalled_items=[],
    )
    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        _mock_clerk_complete(
            WorldPostTurnDelta(
                elapsed_minutes=1,
                transition_type="move_existing",
                target_location_id=locs["Skyport Terminal"].id,
                scene_flags_updated=["High above"],
            )
        ),
    )
    updated_fast, _ = asyncio.run(
        run_phase5_post_turn_clerk(
            repo=empty_repo,
            campaign_id=camp.id,
            world_id=world.id,
            character=char,
            completed_turn=turn_fast,
            active_location=locs["Central Station"],
            neighbors=bundle.neighbor_locations,
        )
    )
    delta_fast = (
        updated_fast.world_snapshot.campaign_elapsed_minutes
        - updated_turn.world_snapshot.campaign_elapsed_minutes
    )
    assert delta_fast == 10


def test_gm_talk_and_tools_spoiler_gating_for_secret_links(empty_repo: CantinaRepository) -> None:
    """GM Talk exit formatting & GM Tool get_campaign_entity respect secret reveal and GM Mode gating."""
    u = seed_user(empty_repo, username="gmt_u", display_name="GMT U")
    world, loc_map = _seed_three_room_world(empty_repo, u.id)
    char = seed_character(empty_repo, owner_id=u.id, world_id=world.id)
    camp = seed_campaign(empty_repo, owner_id=u.id, world_id=world.id, character_id=char.id)

    lobby_id = loc_map["Grand Lobby"].id
    secret_fwd = next(e for e in world.edges if e.is_secret and e.from_location_id == lobby_id)

    # 1. Player Mode (!unlock_lore) + unrevealed -> secret link omitted
    player_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
    vis_player = _compute_branch_visibility(player_bundle)
    exits_player = _visible_location_exits_for_gm(lobby_id, vis_player)
    assert not any(e["destination"] == "Subterranean Vault" for e in exits_player)
    assert any(
        e["is_blocked"] is True and "Knee-Deep Mud" in e["obstacles"]
        for e in exits_player
    )

    tool_out_player, _, _ = asyncio.run(
        execute_gm_tool(
            empty_repo,
            bundle=player_bundle,
            vis=vis_player,
            base_world_ids=set(),
            call=LlmToolCall(
                id="c1",
                name="get_campaign_entity",
                arguments={"kind": "location", "query": "Grand Lobby"},
            ),
            emitted_proposals=[],
        )
    )
    assert not any(
        c["destination"] == "Subterranean Vault" for c in tool_out_player["connections"]
    )

    # 2. GM Mode ON -> secret appears as Secret · Hidden
    empty_repo.update_campaign_world_settings(
        camp.id, CampaignWorldSettings(unlock_lore=True), owner_id=u.id
    )
    gm_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
    vis_gm = _compute_branch_visibility(gm_bundle)
    exits_gm = _visible_location_exits_for_gm(lobby_id, vis_gm)
    assert any(
        e["destination"] == "Subterranean Vault"
        and e.get("secret_status") == "Secret · Hidden"
        for e in exits_gm
    )

    # 3. Reveal link -> even with GM Mode OFF again, secret appears as Secret · Discovered
    empty_repo.toggle_campaign_edge_reveal(camp.id, secret_fwd.id, revealed=True, owner_id=u.id)
    empty_repo.update_campaign_world_settings(
        camp.id, CampaignWorldSettings(unlock_lore=False), owner_id=u.id
    )
    disc_bundle = empty_repo.get_campaign_state_bundle(camp.id, owner_id=u.id)
    vis_disc = _compute_branch_visibility(disc_bundle)
    exits_disc = _visible_location_exits_for_gm(lobby_id, vis_disc)
    assert any(
        e["destination"] == "Subterranean Vault"
        and e.get("secret_status") == "Secret · Discovered"
        for e in exits_disc
    )


def test_wizard_edge_schema_has_required_keys() -> None:
    """LocationEdgeDraft exposes required keys in JSON Schema so constrained decoders cannot omit link fields."""
    schema = LocationEdgeDraft.model_json_schema()
    req = set(schema.get("required") or [])
    assert {
        "from_key",
        "to_key",
        "direction_label",
        "speed_modifier",
        "obstacles",
        "is_blocked",
        "is_secret",
    } <= req
