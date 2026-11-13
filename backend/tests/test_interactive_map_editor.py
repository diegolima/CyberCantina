"""Comprehensive backend tests for v0.10.0 Interactive Map Editor & Enrichment."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.auth import generate_session_token
from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.llm_client import llm_client
from app.routers.enrich import LocationTagsEnrichOutput
from app.schemas.character import CognitionBlock
from app.schemas.turn import (
    ImprovisedLocationSpec,
    PreTurnAnalysis,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationContainer,
    LocationEdge,
    LocationNode,
    LocationNodeDraft,
    WizardLocationNodeLLMOutput,
    WorldUpdatePayload,
)
from app.schemas.import_export import ImportCommitRequest
from app.services.import_export_service import (
    build_zcc_export,
    commit_staged_import,
    inspect_uploaded_file,
)


@pytest.fixture()
def authed_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, CantinaRepository, str, str]:
    """Create isolated repo, seeded admin user with Bearer token, and TestClient."""
    db_file = str(tmp_path / "test_interactive_map.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)

    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)

    user = repo.create_user(
        username="map_admin", display_name="Map Admin", role="admin"
    )
    repo.claim_unowned_entities(user.id)
    raw_token, token_hash = generate_session_token()
    repo.create_session(session_id_hash=token_hash, user_id=user.id)

    client = TestClient(main_module.app)
    return client, repo, user.id, raw_token


def test_llm_schemas_exclude_ui_coords_and_icons() -> None:
    """Keep icon/ui_x/ui_y out of LLM-decoded wizard and improvised schemas."""
    for field in ("icon", "ui_x", "ui_y"):
        assert field not in WizardLocationNodeLLMOutput.model_fields
        assert field not in LocationNodeDraft.model_fields
        assert field not in ImprovisedLocationSpec.model_fields


def test_legacy_visited_locations_migration_backfill(tmp_path: Path) -> None:
    """Upgrading a pre-v0.10 DB marks existing campaign locations visited once cleanly."""
    db_file = tmp_path / "legacy_campaign.db"
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        PRAGMA foreign_keys = OFF;
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE worlds (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            global_rules_json TEXT NOT NULL,
            pending_deletion INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE location_containers (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            parent_container_id TEXT NULL,
            depth INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            environmental_tags_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE location_nodes (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            created_at_turn_id TEXT NULL,
            container_id TEXT NULL,
            is_entry_exit INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL,
            summary TEXT NOT NULL,
            description TEXT NOT NULL,
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
        CREATE TABLE characters (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            tagline TEXT NOT NULL,
            avatar_url TEXT NULL,
            gallery_json TEXT NOT NULL DEFAULT '[]',
            core_persona TEXT NOT NULL,
            moral_code TEXT NOT NULL,
            quirks_flaws TEXT NOT NULL,
            communication_style TEXT NOT NULL DEFAULT '',
            age INTEGER NULL,
            age_is_secret INTEGER NOT NULL DEFAULT 1,
            species TEXT NOT NULL DEFAULT 'Human',
            sex TEXT NOT NULL DEFAULT '',
            pronouns TEXT NOT NULL DEFAULT '',
            build_and_height TEXT NOT NULL DEFAULT '',
            distinctive_features_json TEXT NOT NULL DEFAULT '[]',
            physical_appearance TEXT NOT NULL DEFAULT '',
            initial_message TEXT NOT NULL DEFAULT '',
            voice_anchors_json TEXT NOT NULL,
            baseline_psyche_json TEXT NOT NULL,
            equipped_json TEXT NOT NULL DEFAULT '[]',
            inventory_json TEXT NOT NULL DEFAULT '[]',
            world_id TEXT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            parent_character_id TEXT NULL,
            version_note TEXT NOT NULL DEFAULT '',
            pending_deletion INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE campaigns (
            id TEXT PRIMARY KEY,
            owner_id TEXT NULL,
            name TEXT NOT NULL,
            world_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            persona_id TEXT NULL,
            persona_snapshot_json TEXT NULL,
            participant_character_ids_json TEXT NOT NULL DEFAULT '[]',
            active_leaf_turn_id TEXT NULL,
            prompt_preset_id TEXT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE turn_nodes (
            id TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            parent_turn_id TEXT NULL,
            depth_index INTEGER NOT NULL,
            user_message TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            raw_prose TEXT NOT NULL,
            cognition_json TEXT NOT NULL,
            cognitions_json TEXT NULL,
            pre_turn_json TEXT NOT NULL,
            post_turn_json TEXT NULL,
            recalled_items_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
        CREATE TABLE world_state_snapshots (
            turn_id TEXT PRIMARY KEY,
            world_timestamp TEXT NOT NULL,
            active_location_id TEXT NOT NULL,
            scene_flags_json TEXT NOT NULL DEFAULT '[]',
            campaign_elapsed_minutes INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE character_states (
            turn_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            current_location_id TEXT NOT NULL,
            mood_label TEXT NOT NULL,
            valence REAL NOT NULL DEFAULT 0.0,
            arousal REAL NOT NULL DEFAULT 0.4,
            active_want TEXT NOT NULL,
            active_plan TEXT NOT NULL,
            relationship_notes_json TEXT NOT NULL DEFAULT '{}',
            equipped_json TEXT NOT NULL DEFAULT '[]',
            inventory_json TEXT NOT NULL DEFAULT '[]',
            unlocked_persona_keys_json TEXT NOT NULL DEFAULT '[]',
            persona_knowledge_provenance_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (turn_id, character_id)
        );
        INSERT INTO users VALUES ('u1', 'u1', 'User One', NULL, 'admin', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO worlds VALUES ('w_leg', 'u1', 'Legacy W', '{"genre_and_tone":"noir","setting_overview":"city","tech_or_magic_rules":"none"}', 0, '2026-01-01T00:00:00Z');
        INSERT INTO location_nodes VALUES ('l_start', 'w_leg', NULL, NULL, 0, 'Lobby', 'S', 'D', '[]', 1, 0, '');
        INSERT INTO location_nodes VALUES ('l_unv', 'w_leg', NULL, NULL, 0, 'Roof', 'S', 'D', '[]', 0, 0, '');
        INSERT INTO location_edges VALUES ('e1', 'w_leg', 'l_start', 'l_unv', 'Up', 'N', 1, 0, NULL, NULL);
        INSERT INTO location_edges VALUES ('e2', 'w_leg', 'l_unv', 'l_start', 'Down', 'S', 1, 0, NULL, NULL);
        INSERT INTO characters VALUES (
            'c1', 'u1', 'Kai', 'Tag', NULL, '[]', 'P', 'M', 'Q', 'Style',
            NULL, 1, 'Human', '', '', '', '[]', '', '',
            '[]',
            '{"mood_label":"calm","valence":0.0,"arousal":0.4,"core_drive":"survive","core_fear":"loss","default_want":"w","default_plan":"p"}',
            '[]', '[]', 'w_leg', 1, NULL, '', 0, '2026-01-01T00:00:00Z'
        );
        INSERT INTO campaigns VALUES ('camp_leg', 'u1', 'Leg Camp', 'w_leg', 'c1', NULL, NULL, '["c1"]', 't0', NULL, '2026-01-01T00:00:00Z');
        INSERT INTO turn_nodes VALUES ('t0', 'camp_leg', NULL, 0, '[Start]', 'c1', 'Opening.', '{"recall":"","feeling":"calm","valence":0.0,"arousal":0.4,"want":"w","plan":"p","skipped":false}', '{}', '{}', NULL, '[]', '2026-01-01T00:00:00Z');
        INSERT INTO world_state_snapshots VALUES ('t0', '12:00', 'l_start', '[]', 0);
        INSERT INTO character_states VALUES ('t0', 'c1', 'l_start', 'calm', 0.0, 0.4, 'w', 'p', '{}', '[]', '[]', '[]', '{}');
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(str(db_file))
    repo.init_db()
    repo.init_db()  # idempotent

    bundle = repo.get_campaign_state_bundle("camp_leg", owner_id="u1")
    by_id = {loc.id: loc for loc in bundle.visible_locations}
    assert by_id["l_start"].is_visited is True
    assert by_id["l_unv"].is_visited is True


@pytest.mark.asyncio
async def test_world_update_reachability_and_zcc_coords_roundtrip(
    authed_client: tuple[TestClient, CantinaRepository, str, str],
) -> None:
    """Reject orphaned/one-way maps on World PUT; preserve coords and icons in DB and .zcc export/import."""
    client, repo, user_id, token = authed_client
    headers = {"Authorization": f"Bearer {token}"}

    w_base = repo.get_world("world_neon_rust", base_only=True, owner_id=user_id)

    l1 = w_base.locations[0]
    cont = LocationContainer(
        id="new_c1",
        world_id=w_base.id,
        depth=1,
        name="Docking Concourse",
        ui_x=110.5,
        ui_y=220.5,
        icon="warehouse",
    )
    loc_a = l1.model_copy(update={"container_id": cont.id, "ui_x": 45.0, "ui_y": 80.0, "icon": "home"})
    loc_b = LocationNode(
        id="new_loc_b",
        world_id=w_base.id,
        container_id=cont.id,
        name="Airlock Bay",
        summary="Pressurized lock.",
        description="Heavy blast doors.",
        is_entry_exit=True,
        ui_x=310.0,
        ui_y=140.0,
        icon="door-open",
    )
    # 1. One-way edge (missing return path) must be rejected with 400
    bad_payload = WorldUpdatePayload.model_construct(
        name="Atlas Edited",
        global_rules=w_base.global_rules,
        containers=[cont],
        locations=[loc_a, loc_b],
        edges=[
            LocationEdge(
                id="new_e1",
                world_id=w_base.id,
                from_location_id=loc_a.id,
                to_location_id=loc_b.id,
                direction_label="Airlock Hatch",
                compass_direction="E",
                travel_minutes=2,
            )
        ],
        lore_nodes=[],
    )
    res_bad = client.put(
        f"/api/worlds/{w_base.id}",
        headers=headers,
        json=bad_payload.model_dump(),
    )
    assert res_bad.status_code in (400, 422)

    # 2. Bidirectional path succeeds and persists coords & icons
    good_payload = WorldUpdatePayload(
        name="Atlas Edited",
        global_rules=w_base.global_rules,
        containers=[cont],
        locations=[loc_a, loc_b],
        edges=[
            LocationEdge(
                id="new_e1",
                world_id=w_base.id,
                from_location_id=loc_a.id,
                to_location_id=loc_b.id,
                direction_label="Airlock Hatch",
                compass_direction="E",
                travel_minutes=2,
            ),
            LocationEdge(
                id="new_e2",
                world_id=w_base.id,
                from_location_id=loc_b.id,
                to_location_id=loc_a.id,
                direction_label="Concourse Corridor",
                compass_direction="W",
                travel_minutes=2,
            ),
        ],
        lore_nodes=[],
    )
    res_ok = client.put(
        f"/api/worlds/{w_base.id}",
        headers=headers,
        json=good_payload.model_dump(),
    )
    assert res_ok.status_code == 200, res_ok.text
    saved_world = res_ok.json()
    saved_w_id = saved_world["id"]
    assert saved_world["containers"][0]["ui_x"] == 110.5
    assert saved_world["containers"][0]["icon"] == "warehouse"
    assert any(l["icon"] == "door-open" and l["ui_x"] == 310.0 for l in saved_world["locations"])

    # 3. Export .zcc and re-import to verify coords & icons roundtrip
    raw_zip = build_zcc_export(
        repo, character_ids=[], world_ids=[saved_w_id], persona_ids=[], owner_id=user_id
    )
    staged = inspect_uploaded_file(repo, raw_zip, "atlas.zcc", user_id)
    summary = await commit_staged_import(
        repo,
        ImportCommitRequest(
            staged_token=staged.staged_token,
            default_conflict_strategy="copy",
        ),
        user_id,
    )
    assert summary.success is True
    assert "Atlas Edited (Imported)" in summary.imported_worlds
    reimported = next(
        w
        for w in repo.list_worlds(owner_id=user_id)
        if w.name == "Atlas Edited (Imported)"
    )
    assert reimported.containers[0].ui_x == 110.5
    assert reimported.containers[0].icon == "warehouse"
    assert any(l.icon == "door-open" and l.ui_x == 310.0 for l in reimported.locations)


def test_campaign_map_editing_invariants_and_branch_safety(
    authed_client: tuple[TestClient, CantinaRepository, str, str],
) -> None:
    """Verify visited locks, ancestor monotonicity, container lifecycle, and turn/branch rollback."""
    client, repo, user_id, token = authed_client
    headers = {"Authorization": f"Bearer {token}"}

    # Build a clean 2-room world (Starter L0 inside no container -> Unvisited L0)
    w_src = repo.get_world("world_neon_rust", base_only=True, owner_id=user_id)
    w_edited = repo.update_world(
        w_src.id,
        WorldUpdatePayload(
            name="Branch Test World",
            global_rules=w_src.global_rules,
            containers=[],
            locations=[
                LocationNode(
                    id="new_l_start",
                    world_id=w_src.id,
                    name="Start Cantina",
                    summary="Opening bar.",
                    description="Warm neon lights.",
                    environmental_tags=["Neon"],
                    is_starting_location=True,
                ),
                LocationNode(
                    id="new_l_alley",
                    world_id=w_src.id,
                    name="Back Alley",
                    summary="Damp alley.",
                    description="Rusting fire escapes.",
                    environmental_tags=["Rain"],
                ),
            ],
            edges=[
                LocationEdge(
                    id="new_e_out",
                    world_id=w_src.id,
                    from_location_id="new_l_start",
                    to_location_id="new_l_alley",
                    direction_label="Alley Door",
                    compass_direction="N",
                    travel_minutes=2,
                ),
                LocationEdge(
                    id="new_e_back",
                    world_id=w_src.id,
                    from_location_id="new_l_alley",
                    to_location_id="new_l_start",
                    direction_label="Back Door",
                    compass_direction="S",
                    travel_minutes=2,
                ),
            ],
            lore_nodes=[],
        ),
        owner_id=user_id,
    )
    char = repo.get_character("char_kira_vance", owner_id=user_id)
    camp = repo.create_campaign(
        name="Map Branch Camp",
        world_id=w_edited.id,
        character_id=char.id,
        owner_id=user_id,
    )
    bundle0 = repo.get_campaign_state_bundle(camp.id, owner_id=user_id)
    root_turn_id = camp.active_leaf_turn_id
    locs0 = {l.name: l for l in bundle0.visible_locations}
    start_loc = locs0["Start Cantina"]
    alley_loc = locs0["Back Alley"]
    assert start_loc.is_visited is True
    assert alley_loc.is_visited is False

    # Advance to Turn 1 so we have a distinct branch turn to anchor edits on
    char_st0 = bundle0.current_character_state
    t1 = repo.save_turn_node(
        turn_id="turn_t1",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        user_message="Look around.",
        actor_id=char.id,
        raw_prose="She pours a glass.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_t1",
            world_timestamp=bundle0.current_world_snapshot.world_timestamp,
            active_location_id=start_loc.id,
            scene_flags=[],
            campaign_elapsed_minutes=1,
            visited_location_ids=[],  # verifies inheritance from parent
        ),
        character_state=char_st0.model_copy(update={"turn_id": "turn_t1"}),
        recalled_items=[],
    )
    assert t1.world_snapshot.visited_location_ids == [start_loc.id]

    # 1. Reject editing narrative fields of visited Start Cantina
    bad_narrative = client.put(
        f"/api/campaigns/{camp.id}/map",
        headers=headers,
        json={
            "containers": [],
            "locations": [
                start_loc.model_copy(update={"name": "Renamed Cantina"}).model_dump(),
                alley_loc.model_dump(),
            ],
            "edges": [e.model_dump() for e in bundle0.visible_edges],
        },
    )
    assert bad_narrative.status_code == 400

    # 2. Allow cosmetic icon/coords on visited Start Cantina + edit unvisited Back Alley + add L1 container + wrap Start Cantina inside L1 + add new unvisited Hub + Room
    c1_draft = LocationContainer(
        id="new_c_block",
        depth=1,
        name="Cantina Building",
        icon="building",
        ui_x=120.0,
        ui_y=200.0,
    )
    hub_draft = LocationNode(
        id="new_hub_street",
        name="Sector Crossing",
        summary="Passage hub.",
        description="Covered intersection.",
        is_hub=True,
        icon="git-branch",
        ui_x=400.0,
        ui_y=200.0,
    )
    res_save = client.put(
        f"/api/campaigns/{camp.id}/map",
        headers=headers,
        json={
            "containers": [c1_draft.model_dump()],
            "locations": [
                start_loc.model_copy(
                    update={"container_id": "new_c_block", "icon": "beer", "ui_x": 50.0, "ui_y": 60.0}
                ).model_dump(),
                alley_loc.model_copy(
                    update={"name": "Quiet Back Alley", "icon": "footprints"}
                ).model_dump(),
                hub_draft.model_dump(),
            ],
            "edges": [
                *[e.model_dump() for e in bundle0.visible_edges],
                {
                    "id": "new_e_hub1",
                    "world_id": w_edited.id,
                    "from_location_id": alley_loc.id,
                    "to_location_id": "new_hub_street",
                    "direction_label": "Street Exit",
                    "compass_direction": "E",
                    "travel_minutes": 1,
                },
                {
                    "id": "new_e_hub2",
                    "world_id": w_edited.id,
                    "from_location_id": "new_hub_street",
                    "to_location_id": alley_loc.id,
                    "direction_label": "To Alley",
                    "compass_direction": "W",
                    "travel_minutes": 1,
                },
            ],
        },
    )
    assert res_save.status_code == 200, res_save.text
    bundle1 = res_save.json()
    assert len(bundle1["containers"]) == 1
    saved_c1 = bundle1["containers"][0]
    by_id1 = {l["id"]: l for l in bundle1["visible_locations"]}
    assert by_id1[start_loc.id]["icon"] == "beer"
    assert by_id1[start_loc.id]["container_id"] == saved_c1["id"]
    assert by_id1[start_loc.id]["is_visited"] is True
    assert by_id1[alley_loc.id]["name"] == "Quiet Back Alley"
    assert by_id1[alley_loc.id]["is_visited"] is False
    hub_saved = next(l for l in bundle1["visible_locations"] if l["is_hub"])
    assert hub_saved["is_visited"] is False

    # Base world must remain completely untouched
    base_check = repo.get_world(w_edited.id, base_only=True, owner_id=user_id)
    assert len(base_check.containers) == 0
    assert next(l for l in base_check.locations if l.id == alley_loc.id).name == "Back Alley"

    # Advance to Turn 2
    repo.save_turn_node(
        turn_id="turn_t2",
        campaign_id=camp.id,
        parent_turn_id="turn_t1",
        depth_index=2,
        user_message="Next beat.",
        actor_id=char.id,
        raw_prose="Rain falls.",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_t2",
            world_timestamp=bundle0.current_world_snapshot.world_timestamp,
            active_location_id=start_loc.id,
            scene_flags=[],
            campaign_elapsed_minutes=2,
            visited_location_ids=[],
        ),
        character_state=char_st0.model_copy(update={"turn_id": "turn_t2"}),
        recalled_items=[],
    )

    # 3. On Turn 2: saved c1 CANNOT be deleted; visited start_loc CANNOT be pulled out of c1
    bundle2 = repo.get_campaign_state_bundle(camp.id, owner_id=user_id)
    res_del_c1 = client.put(
        f"/api/campaigns/{camp.id}/map",
        headers=headers,
        json={
            "containers": [],
            "locations": [
                l.model_copy(update={"container_id": None}).model_dump()
                for l in bundle2.visible_locations
                if l.id != hub_saved["id"]
            ],
            "edges": [
                e.model_dump()
                for e in bundle2.visible_edges
                if e.from_location_id != hub_saved["id"] and e.to_location_id != hub_saved["id"]
            ],
        },
    )
    assert res_del_c1.status_code == 400

    # Pull visited start_loc out of c1 while leaving c1 empty -> must fail monotonicity
    res_unparent_v = client.put(
        f"/api/campaigns/{camp.id}/map",
        headers=headers,
        json={
            "containers": [c.model_dump() for c in bundle2.containers],
            "locations": [
                (
                    l.model_copy(update={"container_id": None})
                    if l.id == start_loc.id
                    else l
                ).model_dump()
                for l in bundle2.visible_locations
            ],
            "edges": [e.model_dump() for e in bundle2.visible_edges],
        },
    )
    assert res_unparent_v.status_code == 400

    # 4. Deleting unvisited Back Alley on Turn 2 works ONLY while leaving valid path (remove hub too since Back Alley bridged to it)
    res_del_unvisited = client.put(
        f"/api/campaigns/{camp.id}/map",
        headers=headers,
        json={
            "containers": [c.model_dump() for c in bundle2.containers],
            "locations": [bundle2.active_location.model_dump()],
            "edges": [],
        },
    )
    assert res_del_unvisited.status_code == 200, res_del_unvisited.text
    assert [l["id"] for l in res_del_unvisited.json()["visible_locations"]] == [start_loc.id]

    # 5. Rewind / checkout back to Turn 0 restores pre-Turn-1 topology cleanly!
    repo.checkout_turn_branch(camp.id, root_turn_id, owner_id=user_id)
    rewound = repo.get_campaign_state_bundle(camp.id, owner_id=user_id)
    assert len(rewound.containers) == 0
    assert {l.name for l in rewound.visible_locations} == {"Start Cantina", "Back Alley"}


def test_enrich_uses_actor_model_draft_context_structured_tags_and_sanitization(
    authed_client: tuple[TestClient, CantinaRepository, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify /api/enrich uses eff_actor, draft context without DB lookup, location_tags structured schema, and strips <think>/HTML."""
    client, repo, user_id, token = authed_client
    headers = {"Authorization": f"Bearer {token}"}

    actor_profile = ModelProfile(provider="ollama", model="qwen3:14b-actor")
    clerk_profile = ModelProfile(provider="ollama", model="qwen3:4b-clerk")
    monkeypatch.setattr(
        "app.routers.enrich.get_effective_user_model_settings",
        lambda _uid: (actor_profile, clerk_profile, 8, False, {}),
    )

    seen_profiles: list[ModelProfile | None] = []

    async def fake_complete_text(messages, *, profile=None, **_kwargs):
        seen_profiles.append(profile)
        return "<think>hmm let me think</think><em>Steam</em> coils around brass pipes where Age < 30."

    monkeypatch.setattr(llm_client, "complete_text", fake_complete_text)

    # 1. Pure draft world_location (no DB world created yet)
    res = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_description",
            "current_text": "",
            "context_ref": {
                "scope": "world_location",
                "world_id": "new_world_draft",
                "location_id": "new_loc_draft",
                "world_name": "Clockwork Spire",
                "genre": "Steampunk",
                "tone": "Atmospheric",
                "setting_overview": "High-altitude brass towers.",
                "location_name": "Valve Gallery",
                "location_summary": "Hissing pressure hall.",
            },
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["model_used"] == "qwen3:14b-actor"
    assert seen_profiles[-1].model == "qwen3:14b-actor"
    assert "<think>" not in data["enriched_text"]
    assert "<em>" not in data["enriched_text"]
    assert "*Steam* coils around brass pipes where Age < 30." == data["enriched_text"]

    # 2. Structured location_tags via complete_structured with required_properties
    seen_req_props: list[list[str] | None] = []

    async def fake_complete_structured(messages, schema_cls, *, profile=None, required_properties=None, **_kwargs):
        seen_profiles.append(profile)
        seen_req_props.append(required_properties)
        return LocationTagsEnrichOutput(tags=["Brass Pipes", "Hissing Steam", "brass pipes", "Copper Ozone"])

    monkeypatch.setattr(llm_client, "complete_structured", fake_complete_structured)

    res_tags = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_tags",
            "current_text": "",
            "context_ref": {
                "scope": "world_location",
                "world_name": "Clockwork Spire",
                "location_name": "Valve Gallery",
                "location_description": "Hissing brass valves.",
            },
        },
    )
    assert res_tags.status_code == 200, res_tags.text
    tag_data = res_tags.json()
    assert tag_data["model_used"] == "qwen3:14b-actor"
    assert seen_req_props[-1] == ["tags"]
    assert tag_data["enriched_text"] == "Brass Pipes, Hissing Steam, Copper Ozone"

    # 3. 500 error sanitizes raw exception text
    async def boom(*_a, **_kw):
        raise RuntimeError("SECRET_INTERNAL_STACK_TRACE_XYZ")

    monkeypatch.setattr(llm_client, "complete_text", boom)
    res_err = client.post(
        "/api/enrich",
        headers=headers,
        json={
            "field_role": "location_description",
            "current_text": "draft",
            "context_ref": {"scope": "world_location", "location_name": "Vault"},
        },
    )
    assert res_err.status_code == 500
    assert "SECRET_INTERNAL_STACK_TRACE_XYZ" not in res_err.text
