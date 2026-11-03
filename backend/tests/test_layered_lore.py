"""Comprehensive tests for Multi-Layered World & Location Lore, Strict Validation,
Copy-on-Write Isolation, Timeline Branch Visibility, and Hard Secret Gating.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sqlite3
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app import main as main_module
from app.auth import get_current_user
from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.phase2_context import (
    build_zone4_ephemeral_tail_frame,
    resolve_phase2_turn_context,
    select_active_location_lore_for_turn,
)
from app.engine.phase3_cognition import run_character_cognition_agent
from app.schemas.turn import DiceRollResult, PreTurnAnalysis
from app.schemas.world import (
    LocationEdgeDraft,
    LocationLoreNodeDraft,
    LocationNodeDraft,
    WizardLocationNodeLLMOutput,
    WizardLoreNodeLLMOutput,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldMapReimagineRequest,
    WorldUpdatePayload,
    WorldWizardDraft,
    WorldWizardSeed,
)
from app.wizards.world_wizard import (
    _WizardWorldLLMOutput,
    generate_world_draft,
    reimagine_world_map,
)


@pytest.fixture
def authed_client(temp_repo: CantinaRepository) -> tuple[TestClient, CantinaRepository]:
    """Provide an authenticated FastAPI TestClient bound to temp_repo."""
    user = temp_repo.create_user(
        username="lore_admin",
        display_name="Lore Admin",
        role="admin",
        user_id="user_lore_admin",
    )
    temp_repo.claim_unowned_entities(user.id)
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(main_module.app)
    try:
        yield client, temp_repo
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


# ==============================================================================
# 1. Legacy SQLite Migration & Raw DB CHECK Constraints
# ==============================================================================


def test_legacy_sqlite_migration_salvages_invalid_categories_and_empty_tags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify pre-layered-lore SQLite databases migrate cleanly to strict CHECK constraints."""
    db_file = str(tmp_path / "legacy_pre_layered.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")

    conn = sqlite3.connect(db_file)
    try:
        conn.executescript(
            """
            CREATE TABLE worlds (
                id TEXT PRIMARY KEY,
                owner_id TEXT,
                name TEXT NOT NULL,
                global_rules_json TEXT NOT NULL,
                pending_deletion INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE location_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT,
                name TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                is_starting_location INTEGER NOT NULL DEFAULT 0,
                is_hub INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE lore_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                entity_tags_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE vector_entries (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                world_id TEXT,
                character_id TEXT,
                campaign_id TEXT,
                anchor_turn_id TEXT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                keywords_json TEXT NOT NULL DEFAULT '[]',
                embedding_blob BLOB NOT NULL,
                embedding_dim INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        rules_json = json.dumps(
            {
                "genre": "Cyberpunk Noir",
                "tone": "Gritty",
                "setting_overview": "Rain-slick streets.",
                "tech_or_magic_rules": "Cybernetics.",
                "starting_timestamp": "2099-01-01 22:00",
            }
        )
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, pending_deletion, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            ("world_legacy", None, "Legacy City", rules_json, "2026-01-01T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO location_nodes (id, world_id, name, summary, description, environmental_tags_json, is_starting_location, is_hub) VALUES (?, ?, ?, ?, ?, '[]', 1, 1)",
            ("loc_legacy_hub", "world_legacy", "Legacy Bar", "Old bar.", "Neon hums."),
        )
        # Insert legacy rows violating the new strict rules:
        # 1) category='item' + empty entity_tags_json='[]'
        conn.execute(
            "INSERT INTO lore_nodes (id, world_id, title, category, content, entity_tags_json) VALUES (?, ?, ?, ?, ?, ?)",
            (
                "lore_leg_1",
                "world_legacy",
                "Project Chimera Chip",
                "item",
                "Prototype neural shard rumored to rewrite memories.",
                "[]",
            ),
        )
        # 2) category='rule' + blank string tag '[""]'
        conn.execute(
            "INSERT INTO lore_nodes (id, world_id, title, category, content, entity_tags_json) VALUES (?, ?, ?, ?, ?, ?)",
            (
                "lore_leg_2",
                "world_legacy",
                "Sub-Grid Blackout Curfew",
                "rule",
                "Power cuts every midnight across the lower tiers.",
                '[""]',
            ),
        )
        # 3) category='rumour' (British spelling) + duplicate/untrimmed tags
        conn.execute(
            "INSERT INTO lore_nodes (id, world_id, title, category, content, entity_tags_json) VALUES (?, ?, ?, ?, ?, ?)",
            (
                "lore_leg_3",
                "world_legacy",
                "Ghost Freighter",
                "rumour",
                "Dockworkers claim an unmanned hull drifts into Bay 9.",
                '["  Bay 9  ", "bay 9", "Freighter"]',
            ),
        )
        conn.commit()
    finally:
        conn.close()

    repo = CantinaRepository(db_file)
    repo.init_db()

    migrated_world = repo.get_world("world_legacy")
    by_id = {ln.id: ln for ln in migrated_world.lore_nodes}

    assert set(by_id.keys()) == {"lore_leg_1", "lore_leg_2", "lore_leg_3"}
    assert by_id["lore_leg_1"].category == "rumor"
    assert len(by_id["lore_leg_1"].entity_tags) >= 1
    assert all(tag.strip() for tag in by_id["lore_leg_1"].entity_tags)

    assert by_id["lore_leg_2"].category == "culture"
    assert len(by_id["lore_leg_2"].entity_tags) >= 1

    assert by_id["lore_leg_3"].category == "rumor"
    assert by_id["lore_leg_3"].entity_tags == ["Bay 9", "Freighter"]


def test_sqlite_check_constraints_enforced_at_db_layer(temp_repo: CantinaRepository) -> None:
    """Verify raw SQLite CHECK constraints block invalid categories, world secrets, and empty tags."""
    world = temp_repo.list_worlds()[0]
    loc_id = world.locations[0].id

    conn = temp_repo._connect()
    try:
        # 1. Banned category ('item')
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
                VALUES ('bad_cat', ?, NULL, NULL, 'Bad Cat', 'item', 'Invalid category.', '["tag1"]')
                """,
                (world.id,),
            )

        # 2. 'secret' forbidden on world-level lore (location_id IS NULL)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
                VALUES ('bad_world_secret', ?, NULL, NULL, 'Global Secret', 'secret', 'Should fail.', '["secret_tag"]')
                """,
                (world.id,),
            )

        # 3. Empty entity_tags_json ('[]')
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
                VALUES ('bad_empty_tags', ?, NULL, NULL, 'No Tags', 'history', 'Missing tags.', '[]')
                """,
                (world.id,),
            )

        # 4. Empty string inside entity_tags_json ('[""]')
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
                VALUES ('bad_blank_tag', ?, NULL, NULL, 'Blank Tag', 'history', 'Blank tag item.', '[""]')
                """,
                (world.id,),
            )

        # 5. Valid 'secret' on a specific location_id succeeds
        conn.execute(
            """
            INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
            VALUES ('good_loc_secret', ?, ?, NULL, 'Hidden Hatch', 'secret', 'Under the rug.', '["hatch"]')
            """,
            (world.id, loc_id),
        )
        conn.commit()
    finally:
        conn.close()


# ==============================================================================
# 2. Pydantic & HTTP API Validation
# ==============================================================================


def test_pydantic_and_api_validation_world_and_location_lore(
    authed_client: tuple[TestClient, CantinaRepository]
) -> None:
    """Verify strict schema validation across Pydantic models and World/Wizard/Campaign APIs."""
    client, repo = authed_client

    # British spelling normalized + tags trimmed & deduplicated case-insensitively
    w_lore = WorldLoreNodeDraft(
        title="  Harbor Syndicate  ",
        category="rumour",  # type: ignore[arg-type]
        content="  Controls the eastern docks.  ",
        entity_tags=["  Dockers  ", "dockers", "East Pier"],
    )
    assert w_lore.category == "rumor"
    assert w_lore.title == "Harbor Syndicate"
    assert w_lore.entity_tags == ["Dockers", "East Pier"]

    # World lore rejects 'secret' and empty tags
    with pytest.raises(ValidationError):
        WorldLoreNodeDraft(
            title="Forbidden World Secret",
            category="secret",  # type: ignore[arg-type]
            content="Not allowed at world layer.",
            entity_tags=["vault"],
        )
    with pytest.raises(ValidationError):
        WorldLoreNodeDraft(
            title="Tagless Lore",
            category="history",
            content="No trigger tags.",
            entity_tags=["   "],
        )

    # Location lore allows 'secret' but still requires >= 1 non-empty tag
    loc_secret = LocationLoreNodeDraft(
        title="False Wall",
        category="secret",
        content="Behind the liquor rack lies a listening post.",
        entity_tags=["liquor rack", "wall"],
    )
    assert loc_secret.category == "secret"

    with pytest.raises(ValidationError):
        LocationLoreNodeDraft(
            title="Tagless Secret",
            category="secret",
            content="Missing keywords.",
            entity_tags=[],
        )

    # HTTP API checks
    camp_id = "camp_neon_rust_default"
    default_bundle = repo.get_campaign_state_bundle(camp_id)
    world = repo.get_world(default_bundle.campaign.world_id)
    loc_id = world.locations[0].id

    # PUT /api/worlds/{id} rejects empty entity_tags on world lore (422)
    bad_world_payload = world.model_dump()
    bad_world_payload["lore_nodes"] = [
        {
            "title": "Tagless Entry",
            "category": "history",
            "content": "Some content.",
            "entity_tags": [],
        }
    ]
    res = client.put(f"/api/worlds/{world.id}", json=bad_world_payload)
    assert res.status_code == 422

    # PUT /api/worlds/{id} rejects 'secret' on world lore (422)
    bad_world_payload["lore_nodes"] = [
        {
            "title": "Secret Entry",
            "category": "secret",
            "content": "Some content.",
            "entity_tags": ["valid_tag"],
        }
    ]
    res = client.put(f"/api/worlds/{world.id}", json=bad_world_payload)
    assert res.status_code == 422

    # POST /api/wizards/world/commit rejects location lore with empty tags (422), accepts valid location + world lore (200)
    wizard_commit_body = {
        "name": "Validated Citadel",
        "global_rules": world.global_rules.model_dump(),
        "locations": [
            {
                "key": "hub",
                "name": "Citadel Gate",
                "summary": "Main gate.",
                "description": "Towering iron archway.",
                "environmental_tags": ["iron"],
                "is_starting_location": True,
                "is_hub": True,
                "lore_nodes": [
                    {
                        "title": "Gatehouse Murder-Holes",
                        "category": "secret",
                        "content": "Concealed oil chutes line the ceiling.",
                        "entity_tags": [],
                    }
                ],
            }
        ],
        "edges": [],
        "lore_nodes": [
            {
                "title": "Siege of Year 40",
                "category": "history",
                "content": "The northern banners broke against the outer wall.",
                "entity_tags": ["Siege", "Northern Banners"],
            }
        ],
    }
    res_bad_commit = client.post("/api/wizards/world/commit", json=wizard_commit_body)
    assert res_bad_commit.status_code == 422

    wizard_commit_body["locations"][0]["lore_nodes"][0]["entity_tags"] = [
        "murder-holes",
        "ceiling",
    ]
    res_good_commit = client.post("/api/wizards/world/commit", json=wizard_commit_body)
    assert res_good_commit.status_code == 200, res_good_commit.text
    created_world = res_good_commit.json()
    assert len(created_world["locations"][0]["lore_nodes"]) == 1
    assert created_world["locations"][0]["lore_nodes"][0]["category"] == "secret"

    # PUT /api/campaigns/{campaign_id}/locations/{loc_id}/lore rejects empty tags (422),
    # rejects foreign world location (400/404), and persists valid CoW override (200)
    res_bad_camp_lore = client.put(
        f"/api/campaigns/{camp_id}/locations/{loc_id}/lore",
        json={
            "lore_nodes": [
                {
                    "title": "Broken Rumor",
                    "category": "rumor",
                    "content": "No tags.",
                    "entity_tags": [],
                }
            ]
        },
    )
    assert res_bad_camp_lore.status_code == 422

    foreign_loc_id = created_world["locations"][0]["id"]
    res_foreign_loc = client.put(
        f"/api/campaigns/{camp_id}/locations/{foreign_loc_id}/lore",
        json={"lore_nodes": []},
    )
    assert res_foreign_loc.status_code in (400, 404)

    res_good_camp_lore = client.put(
        f"/api/campaigns/{camp_id}/locations/{loc_id}/lore",
        json={
            "lore_nodes": [
                {
                    "title": "Loose Floor Grate",
                    "category": "secret",
                    "content": "A pried grate drops into a smuggling conduit.",
                    "entity_tags": ["grate", "conduit"],
                }
            ]
        },
    )
    assert res_good_camp_lore.status_code == 200, res_good_camp_lore.text
    updated_bundle = res_good_camp_lore.json()
    updated_loc = next(
        l for l in updated_bundle["visible_locations"] if l["id"] == loc_id
    )
    assert len(updated_loc["lore_nodes"]) == 1
    assert updated_loc["lore_nodes"][0]["title"] == "Loose Floor Grate"


# ==============================================================================
# 3. World Wizard Zero-Location-Lore & LLM Salvage
# ==============================================================================


def test_world_wizard_salvages_llm_output_and_never_autogenerates_location_lore(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify World Wizard omits location lore from LLM schemas and never autogenerates room lore."""
    loc_schema = WizardLocationNodeLLMOutput.model_json_schema()
    assert "lore_nodes" not in loc_schema.get("properties", {})

    # LLM salvage: legacy categories + missing entity_tags synthesized from title
    salvaged_a = WizardLoreNodeLLMOutput(
        title="Orbital Relay Accord",
        category="rule",
        content="All off-world transmissions pass through Triad relays.",
        entity_tags=[],
    ).to_strict_draft()
    assert salvaged_a.category == "culture"
    assert len(salvaged_a.entity_tags) >= 1

    salvaged_b = WizardLoreNodeLLMOutput(
        title="Crimson Shard",
        category="item",
        content="Rumored to power the old spire.",
        entity_tags=["  Crimson Shard "],
    ).to_strict_draft()
    assert salvaged_b.category == "rumor"
    assert salvaged_b.entity_tags == ["Crimson Shard"]

    seed = WorldWizardSeed(
        name="Ashen Reach",
        genre_and_tone="Dark Low Fantasy",
        core_premise="An isolated fortress town bordering a petrified forest.",
        initial_hub_concept="The Cinder Hearth Tavern",
    )

    # 1. Offline heuristic fallback
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    fallback_draft = asyncio.run(generate_world_draft(seed))
    assert len(fallback_draft.locations) >= 3
    for loc in fallback_draft.locations:
        assert loc.lore_nodes == []
    for lore in fallback_draft.lore_nodes:
        assert lore.category in {"history", "culture", "faction", "rumor"}
        assert len(lore.entity_tags) >= 1

    # 2. Mocked structured LLM response
    mock_llm_world = _WizardWorldLLMOutput(
        name="Ashen Reach",
        global_rules=fallback_draft.global_rules,
        locations=[
            WizardLocationNodeLLMOutput(
                key="hearth",
                name="The Cinder Hearth",
                summary="Smoky timber tavern.",
                description="Embers glow in a central hearth.",
                environmental_tags=["hearth", "smoke"],
                is_starting_location=True,
                is_hub=True,
            )
        ],
        edges=[],
        lore_nodes=[
            WizardLoreNodeLLMOutput(
                title="Wardens of the Ash",
                category="faction",
                content="Rangers sworn to burn encroaching spores.",
                entity_tags=[],  # Should be salvaged automatically
            )
        ],
    )
    monkeypatch.setattr(
        llm_client, "complete_structured", AsyncMock(return_value=mock_llm_world)
    )
    llm_draft = asyncio.run(generate_world_draft(seed))
    assert llm_draft.locations[0].lore_nodes == []
    assert llm_draft.lore_nodes[0].category == "faction"
    assert len(llm_draft.lore_nodes[0].entity_tags) >= 1

    # 3. Map Re-imagine never produces location lore
    monkeypatch.setattr(
        llm_client, "complete_structured", AsyncMock(side_effect=RuntimeError("offline"))
    )
    reimagined = asyncio.run(
        reimagine_world_map(
            WorldMapReimagineRequest(
                world_name="Ashen Reach",
                global_rules=fallback_draft.global_rules,
                map_description="Three concentric baileys and a watchtower.",
                location_count=4,
            )
        )
    )
    assert all(loc.lore_nodes == [] for loc in reimagined.locations)


# ==============================================================================
# 4. Campaign Copy-on-Write Isolation, World Fork Remapping & Vector Cleanup
# ==============================================================================


def test_campaign_cow_isolation_world_fork_remapping_and_vector_cleanup(
    temp_repo: CantinaRepository,
) -> None:
    """Verify campaign CoW location lore isolation, empty-override masking, world fork remapping, and vector cleanup."""
    draft = WorldWizardDraft(
        name="Twin Spire Station",
        global_rules=WorldGlobalRules(
            genre="Sci-Fi Thriller",
            tone="Tense",
            setting_overview="Dual-ring orbital station.",
            tech_or_magic_rules="Hard vacuum physics.",
            starting_timestamp="2140-05-10 08:00",
        ),
        locations=[
            LocationNodeDraft(
                key="dock",
                name="Docking Ring Alpha",
                summary="Main pressurized berth.",
                description="Clang of magnetic clamps and ozone.",
                environmental_tags=["airlock", "clamps"],
                is_starting_location=True,
                is_hub=True,
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="Berth 4 Decompression",
                        category="history",
                        content="Ten years ago Berth 4 blew out during a strike.",
                        entity_tags=["Berth 4", "strike"],
                    ),
                    LocationLoreNodeDraft(
                        title="Smuggler Hatch 4B",
                        category="secret",
                        content="Unlogged maintenance crawlway under deckplate 4B.",
                        entity_tags=["deckplate 4B", "crawlway"],
                    ),
                ],
            ),
            LocationNodeDraft(
                key="hydro",
                name="Hydroponics Dome",
                summary="Humid oxygen gardens.",
                description="Rows of bioluminescent algae vats.",
                environmental_tags=["algae", "humid"],
                is_starting_location=False,
                is_hub=False,
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="Blighted Vat Row",
                        category="rumor",
                        content="Workers whisper Vat Row 7 grows illicit mycotoxins.",
                        entity_tags=["Vat Row 7", "mycotoxins"],
                    )
                ],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="dock",
                to_key="hydro",
                direction_label="Lift to Hydroponics",
                reverse_direction_label="Lift to Docking Ring",
                compass_direction="N",
                travel_minutes=4,
                bidirectional=True,
            )
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Station Charter",
                category="culture",
                content="Oxygen quotas govern citizen voting weight.",
                entity_tags=["Oxygen quotas", "Charter"],
            )
        ],
    )

    world = asyncio.run(temp_repo.acreate_world_from_draft(draft))
    dock_loc = next(l for l in world.locations if l.name == "Docking Ring Alpha")
    base_lore_id = dock_loc.lore_nodes[0].id

    # Verify secrets are NEVER indexed in vector_entries
    conn = temp_repo._connect()
    try:
        vec_rows = conn.execute(
            "SELECT id, source_type, location_id, title FROM vector_entries WHERE world_id = ?",
            (world.id,),
        ).fetchall()
    finally:
        conn.close()
    vec_titles = {r["title"] for r in vec_rows}
    assert any("Berth 4 Decompression" in t for t in vec_titles)
    assert any("Blighted Vat Row" in t for t in vec_titles)
    assert not any("Smuggler Hatch 4B" in t for t in vec_titles)

    # Create two independent campaigns on the same world
    char_id = temp_repo.list_characters()[0].id
    camp_a = temp_repo.create_campaign(
        name="Campaign Alpha", world_id=world.id, character_id=char_id
    )
    camp_b = temp_repo.create_campaign(
        name="Campaign Beta", world_id=world.id, character_id=char_id
    )

    # Override dock_loc lore in Campaign A while passing base_lore_id (tests PK collision avoidance!)
    bundle_a = asyncio.run(
        temp_repo.aupdate_campaign_location_lore(
            camp_a.id,
            dock_loc.id,
            [
                LocationLoreNodeDraft(
                    id=base_lore_id,  # Base template ID must NOT collide with base row PK!
                    title="Berth 4 Quarantine",
                    category="faction",
                    content="Security sealed Berth 4 under martial lockdown.",
                    entity_tags=["Berth 4", "quarantine"],
                ),
                LocationLoreNodeDraft(
                    title=" Locker 19 Keycard",
                    category="secret",
                    content="Taped beneath the customs desk.",
                    entity_tags=["customs desk", "keycard"],
                ),
            ],
        )
    )
    dock_in_a = next(l for l in bundle_a.visible_locations if l.id == dock_loc.id)
    assert [ln.title for ln in dock_in_a.lore_nodes] == [
        "Berth 4 Quarantine",
        "Locker 19 Keycard",
    ]
    assert dock_in_a.lore_nodes[0].id != base_lore_id

    # Campaign B and base world remain untouched
    bundle_b = temp_repo.get_campaign_state_bundle(camp_b.id)
    dock_in_b = next(l for l in bundle_b.visible_locations if l.id == dock_loc.id)
    assert [ln.title for ln in dock_in_b.lore_nodes] == [
        "Berth 4 Decompression",
        "Smuggler Hatch 4B",
    ]

    # Clearing dock_loc lore to [] in Campaign A masks base template lore via override sentinel
    bundle_a_cleared = asyncio.run(
        temp_repo.aupdate_campaign_location_lore(camp_a.id, dock_loc.id, [])
    )
    dock_in_a_cleared = next(
        l for l in bundle_a_cleared.visible_locations if l.id == dock_loc.id
    )
    assert dock_in_a_cleared.lore_nodes == []
    # Campaign B STILL sees base lore
    assert (
        len(
            next(
                l
                for l in temp_repo.get_campaign_state_bundle(camp_b.id).visible_locations
                if l.id == dock_loc.id
            ).lore_nodes
        )
        == 2
    )

    # Trigger Copy-on-Write World Fork by updating `world` while Campaigns A & B reference it
    forked_world = asyncio.run(
        temp_repo.aupdate_world(
            world.id,
            WorldUpdatePayload(
                name="Twin Spire Station v2",
                global_rules=world.global_rules,
                locations=world.locations,
                edges=world.edges,
                lore_nodes=world.lore_nodes,
            ),
        )
    )
    assert forked_world.id != world.id
    forked_dock = next(
        l for l in forked_world.locations if l.name == "Docking Ring Alpha"
    )
    assert forked_dock.id != dock_loc.id
    assert [ln.title for ln in forked_dock.lore_nodes] == [
        "Berth 4 Decompression",
        "Smuggler Hatch 4B",
    ]

    # Verify forked world vector_entries point to forked location IDs and still exclude secrets
    conn = temp_repo._connect()
    try:
        fork_vecs = conn.execute(
            "SELECT location_id, title FROM vector_entries WHERE world_id = ? AND source_type = 'location_lore'",
            (forked_world.id,),
        ).fetchall()
    finally:
        conn.close()
    assert any(
        r["location_id"] == forked_dock.id and "Berth 4 Decompression" in r["title"]
        for r in fork_vecs
    )
    assert not any("Smuggler Hatch 4B" in r["title"] for r in fork_vecs)

    # Delete campaigns and old world -> verify zero orphaned vector_entries or lore_nodes
    temp_repo.mark_world_pending_deletion(world.id)  # Marked pending_deletion while campaigns exist
    temp_repo.delete_campaign(camp_a.id)
    temp_repo.delete_campaign(camp_b.id)
    temp_repo.prune_pending_deletion_worlds()

    conn = temp_repo._connect()
    try:
        rem_lore = conn.execute(
            "SELECT COUNT(*) AS cnt FROM lore_nodes WHERE world_id = ?", (world.id,)
        ).fetchone()["cnt"]
        rem_vecs = conn.execute(
            "SELECT COUNT(*) AS cnt FROM vector_entries WHERE world_id = ? OR campaign_id IN (?, ?)",
            (world.id, camp_a.id, camp_b.id),
        ).fetchone()["cnt"]
    finally:
        conn.close()
    assert rem_lore == 0
    assert rem_vecs == 0


# ==============================================================================
# 5. Timeline Branch Visibility for Improvised Location Lore
# ==============================================================================


def test_branch_timeline_visibility_for_improvised_location_lore(
    temp_repo: CantinaRepository,
) -> None:
    """Verify lore attached to an improvised room respects timeline branch visibility."""
    camp_id = "camp_neon_rust_default"
    bundle_0 = temp_repo.get_campaign_state_bundle(camp_id)
    root_turn_id = bundle_0.active_branch_turns[0].id
    hub_id = bundle_0.active_location.id

    # Create a child turn on branch 1 so we can anchor an improvised room to Turn 1
    parent_turn = bundle_0.active_branch_turns[-1]
    turn_1 = temp_repo.save_turn_node(
        turn_id="turn_branch_1_leaf",
        campaign_id=camp_id,
        parent_turn_id=parent_turn.id,
        depth_index=parent_turn.depth_index + 1,
        user_message="Explore the side alley.",
        actor_id=parent_turn.actor_id,
        raw_prose="You step toward a rusted service hatch.",
        cognition=parent_turn.cognition,
        pre_turn=parent_turn.pre_turn,
        world_snapshot=parent_turn.world_snapshot,
        character_state=parent_turn.character_state,
        recalled_items=[],
    )
    temp_repo.checkout_turn_branch(camp_id, turn_1.id)

    # Create a linked room anchored at turn_1
    bundle_with_room = temp_repo.create_linked_location(
        camp_id,
        from_location_id=hub_id,
        name="Rusted Relay Vault",
        description="Condensation drips down copper busbars.",
        environmental_tags=["copper", "relay"],
        compass_direction="W",
        travel_minutes=3,
    )
    improv_loc = next(
        l for l in bundle_with_room.visible_locations if l.name == "Rusted Relay Vault"
    )
    assert improv_loc.created_at_turn_id == turn_1.id

    # Attach non-secret location lore to the improvised room while on turn_1
    asyncio.run(
        temp_repo.aupdate_campaign_location_lore(
            camp_id,
            improv_loc.id,
            [
                LocationLoreNodeDraft(
                    title="Copper Siphon Tap",
                    category="rumor",
                    content="Someone spliced an illegal tap into Rusted Relay Vault.",
                    entity_tags=["Rusted Relay Vault", "Copper Siphon"],
                )
            ],
        )
    )

    # On branch {root, turn_1}, remote RAG search finds the improvised room's lore
    recalled_on_branch = asyncio.run(
        temp_repo.vector_store.search_memories(
            queries=["Rusted Relay Vault Copper Siphon"],
            mentioned_entities=["Rusted Relay Vault"],
            world_id=bundle_0.campaign.world_id,
            character_id=bundle_0.campaign.character_id,
            campaign_id=camp_id,
            valid_branch_turn_ids={root_turn_id, turn_1.id},
            exclude_location_id=hub_id,
        )
    )
    assert any(
        r.source_type == "location_lore" and "Copper Siphon Tap" in r.title
        for r in recalled_on_branch
    )

    # Rewind campaign back to root_turn_id (before improv_loc existed!)
    temp_repo.checkout_turn_branch(camp_id, root_turn_id)

    # 1) Remote RAG at root_turn_id MUST NOT leak future-branch location lore
    recalled_at_root = asyncio.run(
        temp_repo.vector_store.search_memories(
            queries=["Rusted Relay Vault Copper Siphon"],
            mentioned_entities=["Rusted Relay Vault"],
            world_id=bundle_0.campaign.world_id,
            character_id=bundle_0.campaign.character_id,
            campaign_id=camp_id,
            valid_branch_turn_ids={root_turn_id},
            exclude_location_id=hub_id,
        )
    )
    assert not any("Copper Siphon Tap" in r.title for r in recalled_at_root)

    # 2) Editing location lore of an invisible future-branch room raises KeyError
    with pytest.raises(KeyError, match="not visible on the active timeline"):
        asyncio.run(
            temp_repo.aupdate_campaign_location_lore(
                camp_id,
                improv_loc.id,
                [],
            )
        )


# ==============================================================================
# 6. Context Hygiene, Remote RAG & Hard Secret Gating (Phase 2 & Phase 3)
# ==============================================================================


def test_phase2_and_phase3_context_hygiene_remote_rag_and_hard_secret_gating(
    temp_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify:
    1) Active room non-secret lore is injected into Zone 4 <local_lore> & Phase 3 cognition,
       and excluded from RAG recalled_items (no double-injection).
    2) Remote room non-secret lore is recalled ONLY when conversationally mentioned.
    3) 'secret' location lore is NEVER recalled remotely (even if exact secret tags are spoken),
       withheld in active_location on idle turns AND failed rolls, and unlocked ONLY on
       uncontested keyword mention or Clean/Critical Success checks.
    """
    camp_id = "camp_neon_rust_default"
    bundle0 = temp_repo.get_campaign_state_bundle(camp_id)
    loc_bar = next(l for l in bundle0.visible_locations if "Main Floor" in l.name)
    loc_tunnels = next(
        l for l in bundle0.visible_locations if "Cooling Tunnels" in l.name
    )

    # Populate Main Floor (active room) with 1 ambient history + 1 secret
    asyncio.run(
        temp_repo.aupdate_campaign_location_lore(
            camp_id,
            loc_bar.id,
            [
                LocationLoreNodeDraft(
                    title="Shrapnel-Scarred Bar",
                    category="history",
                    content="Corporate riot troopers strafed this counter during the '89 lockout.",
                    entity_tags=["counter", "lockout"],
                ),
                LocationLoreNodeDraft(
                    title="Floorboard Contraband Cache",
                    category="secret",
                    content="A lead-lined cache of forged IDs rests under the loose floorboards.",
                    entity_tags=["floorboards", "contraband cache"],
                ),
            ],
        )
    )

    # Populate Cooling Tunnels (remote room) with 1 rumor + 1 secret
    asyncio.run(
        temp_repo.aupdate_campaign_location_lore(
            camp_id,
            loc_tunnels.id,
            [
                LocationLoreNodeDraft(
                    title="Cryo Valve Sabotage",
                    category="rumor",
                    content="Scavengers bled coolant from the primary valve in the Cooling Tunnels.",
                    entity_tags=["Cooling Tunnels", "cryo valve"],
                ),
                LocationLoreNodeDraft(
                    title="Pipe Seven Passcode",
                    category="secret",
                    content="Passcode 7734 is scratched into the underside of Pipe Seven.",
                    entity_tags=["Pipe Seven", "passcode", "Cooling Tunnels"],
                ),
            ],
        )
    )

    bundle = temp_repo.get_campaign_state_bundle(camp_id)
    world = temp_repo.get_world(bundle.campaign.world_id, campaign_id=camp_id)
    active_loc = bundle.active_location
    assert active_loc.id == loc_bar.id
    neighbors = temp_repo.get_neighbor_locations(
        world.id, active_loc.id, campaign_id=camp_id
    )
    primary_char = temp_repo.get_character(bundle.campaign.character_id)

    # --- CASE A: Idle turn in Main Floor ---
    idle_msg = "I order a glass of cheap synth-rye and watch the rain."
    idle_pre = PreTurnAnalysis(
        mentioned_entities=[],
        memory_search_queries=["synth-rye rain bar"],
    )
    ctx_idle = asyncio.run(
        resolve_phase2_turn_context(
            repo=temp_repo,
            campaign_id=camp_id,
            world=world,
            branch_turns=bundle.active_branch_turns,
            pre_turn=idle_pre,
            user_message=idle_msg,
            active_location=active_loc,
            neighbors=neighbors,
            present_characters=[primary_char],
            character_name_map={primary_char.id: primary_char.name},
            episodic_chunks=bundle.episodic_chunks,
        )
    )
    idle_recalled = (
        ctx_idle.shared_scene_items
        + ctx_idle.per_character_recalled_items.get(primary_char.id, [])
    )
    # Active room lore NOT duplicated in RAG; remote room lore NOT pulled on unrelated turn
    assert not any("Shrapnel-Scarred Bar" in m.title for m in idle_recalled)
    assert not any("Cryo Valve Sabotage" in m.title for m in idle_recalled)
    assert not any("Floorboard Contraband Cache" in m.title for m in idle_recalled)

    zone4_idle = build_zone4_ephemeral_tail_frame(
        user_message=idle_msg,
        character=primary_char,
        world_snapshot=bundle.current_world_snapshot,
        character_state=bundle.current_character_state,
        active_location=active_loc,
        neighbors=neighbors,
        recalled_items=idle_recalled,
        pre_turn=idle_pre,
    )
    assert "<local_lore>" in zone4_idle
    assert "Shrapnel-Scarred Bar" in zone4_idle
    assert "Floorboard Contraband Cache" not in zone4_idle  # Secret strictly withheld!

    # --- CASE B: Conversational mention of remote room AND remote secret's exact keywords ---
    remote_msg = "What have you heard about the Cooling Tunnels, the cryo valve, or Pipe Seven passcode?"
    remote_pre = PreTurnAnalysis(
        mentioned_entities=["Cooling Tunnels", "Pipe Seven", "passcode"],
        memory_search_queries=["Cooling Tunnels cryo valve Pipe Seven passcode"],
    )
    ctx_remote = asyncio.run(
        resolve_phase2_turn_context(
            repo=temp_repo,
            campaign_id=camp_id,
            world=world,
            branch_turns=bundle.active_branch_turns,
            pre_turn=remote_pre,
            user_message=remote_msg,
            active_location=active_loc,
            neighbors=neighbors,
            present_characters=[primary_char],
            character_name_map={primary_char.id: primary_char.name},
            episodic_chunks=bundle.episodic_chunks,
        )
    )
    remote_recalled = (
        ctx_remote.shared_scene_items
        + ctx_remote.per_character_recalled_items.get(primary_char.id, [])
    )
    assert any(
        m.source_type == "location_lore" and "Cryo Valve Sabotage" in m.title
        for m in remote_recalled
    )
    # Remote secret MUST NEVER be recalled even when exact tags ("Pipe Seven", "passcode") are spoken!
    assert not any("Pipe Seven Passcode" in m.title for m in remote_recalled)
    assert not any("7734" in m.content for m in remote_recalled)

    # --- CASE C: Failed check on active room secret ---
    failed_roll = DiceRollResult(
        character_id=primary_char.id,
        character_name=primary_char.name,
        action_description="Pry at the floorboards to search for a contraband cache",
        skill_or_approach="Investigation",
        d20_raw=3,
        modifier=0,
        total=3,
        difficulty_class=14,
        outcome_tier="Simple Failure",
        narrative_directive="The search turns up nothing unusual.",
    )
    failed_pre = PreTurnAnalysis(
        mentioned_entities=["floorboards"],
        memory_search_queries=["floorboards"],
        resolved_roll=failed_roll,
        character_rolls={primary_char.id: failed_roll},
    )
    selected_on_fail = select_active_location_lore_for_turn(
        active_loc,
        user_message="I pry at the floorboards looking for a hidden contraband cache.",
        pre_turn=failed_pre,
    )
    assert any(ln.title == "Shrapnel-Scarred Bar" for ln in selected_on_fail)
    assert not any(
        ln.title == "Floorboard Contraband Cache" for ln in selected_on_fail
    ), "Failed investigation check must NOT leak room secrets!"

    # --- CASE D: Clean Success discovery roll unlocks active room secret in Zone 4 & Phase 3 ---
    success_roll = failed_roll.model_copy(
        update={
            "d20_raw": 18,
            "total": 18,
            "outcome_tier": "Clean Success",
            "narrative_directive": "Hidden compartment discovered cleanly.",
        }
    )
    success_pre = PreTurnAnalysis(
        mentioned_entities=[],
        memory_search_queries=["inspect room"],
        resolved_roll=success_roll,
        character_rolls={primary_char.id: success_roll},
    )
    zone4_success = build_zone4_ephemeral_tail_frame(
        user_message="I carefully sweep the room for hidden compartments.",
        character=primary_char,
        world_snapshot=bundle.current_world_snapshot,
        character_state=bundle.current_character_state,
        active_location=active_loc,
        neighbors=neighbors,
        recalled_items=[],
        pre_turn=success_pre,
    )
    assert "[SECRET — DISCOVERED] Floorboard Contraband Cache" in zone4_success

    # Verify Phase 3 Character Cognition prompt also receives Local Facts & Rumors including unlocked secret
    captured_messages: list[list[dict[str, str]]] = []

    async def _capture_cognition_llm(messages, schema_cls, **kwargs):
        captured_messages.append(messages)
        raise RuntimeError("trigger heuristic fallback after capturing prompt")

    monkeypatch.setattr(llm_client, "complete_structured", _capture_cognition_llm)
    asyncio.run(
        run_character_cognition_agent(
            user_message="I carefully sweep the room for hidden compartments.",
            character=primary_char,
            world=world,
            role="primary_speaker",
            previous_state=bundle.current_character_state,
            active_location=active_loc,
            neighbors=neighbors,
            shared_scene_items=[],
            character_recalled_items=[],
            pre_turn=success_pre,
            co_present_characters=[],
        )
    )
    assert len(captured_messages) == 1
    phase3_user_prompt = captured_messages[0][1]["content"]
    assert "Local Facts & Rumors:" in phase3_user_prompt
    assert "[HISTORY] Shrapnel-Scarred Bar" in phase3_user_prompt
    assert "[SECRET — DISCOVERED] Floorboard Contraband Cache" in phase3_user_prompt
