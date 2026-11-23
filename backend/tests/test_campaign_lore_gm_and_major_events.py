"""Tests for v0.31.0: Unlock Lore & Secrets (GM Mode), branch-safe campaign lore CoW,
secret discovery tracking, Phase 5 Clerk Major Events & location mutations, and .zcc v2 parity.
"""

from __future__ import annotations

import asyncio
import io
import json
import zipfile
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
import pytest

from app import main as main_module
from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine.llm_client import llm_client
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.engine.world_clock import extract_world_date_label
from app.routers import import_export as import_export_router
from app.schemas.turn import (
    CampaignMapUpdatePayload,
    CampaignWorldSettings,
    CharacterAgentDelta,
    MajorEventSpec,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    LocationLoreNodeDraft,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldWizardDraft,
    LocationNodeDraft,
)
from app.security.rate_limit import reset_rate_limiters
from tests.factories import seed_character


@pytest.fixture
def authed_client(empty_repo: CantinaRepository) -> tuple[TestClient, CantinaRepository]:
    user = empty_repo.create_user(
        username="gm_tester",
        display_name="GM Tester",
        role="admin",
        user_id="user_gm_tester",
    )
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(main_module.app)
    try:
        yield client, empty_repo
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def _seed_gm_scenario(repo: CantinaRepository, owner_id: str = "user_gm_tester"):
    world = repo.create_world_from_draft(
        WorldWizardDraft(
            name="Ashen Kingdom",
            global_rules=WorldGlobalRules(
                genre="Dark Fantasy",
                tone="Grim",
                setting_overview="A fractured kingdom on the edge of war.",
                tech_or_magic_rules="Blood runes and iron.",
                starting_timestamp="1420-05-10 09:00",
            ),
            locations=[
                LocationNodeDraft(
                    key="plaza",
                    name="Sunstone Plaza",
                    summary="Wide cobblestone square.",
                    description="An empty cobblestone plaza framed by white marble arcades.",
                    environmental_tags=["cobblestone", "open", "swamp"],
                    is_starting_location=True,
                    is_hub=True,
                    ui_x=120.0,
                    ui_y=240.0,
                    icon="castle",
                    lore_nodes=[
                        LocationLoreNodeDraft(
                            title="Old Fountain Rumor",
                            category="rumor",
                            content="Merchants toss silver coins into the dry basin.",
                            entity_tags=["fountain", "silver"],
                        ),
                        LocationLoreNodeDraft(
                            title="Vault Below the Dais",
                            category="secret",
                            content="A hidden crypt beneath the central dais holds the crown ledger.",
                            entity_tags=["dais", "crypt", "ledger"],
                        ),
                    ],
                )
            ],
            edges=[],
            lore_nodes=[
                WorldLoreNodeDraft(
                    title="Iron Pact Charter",
                    category="history",
                    content="Signed three centuries ago to bind the three duchies.",
                    entity_tags=["Iron Pact", "duchies"],
                ),
                WorldLoreNodeDraft(
                    title="Crown of Embers",
                    category="artifact",
                    content="An ancient circlet forged in volcanic glass.",
                    entity_tags=["Crown of Embers", "circlet"],
                ),
            ],
        ),
        owner_id=owner_id,
    )
    char = seed_character(repo, owner_id=owner_id, world_id=world.id)
    camp = repo.create_campaign(
        name="Ashen Run",
        world_id=world.id,
        character_id=char.id,
        owner_id=owner_id,
    )
    return world, char, camp


def _append_turn(
    repo: CantinaRepository,
    campaign_id: str,
    *,
    parent_turn_id: str,
    turn_id: str,
    depth: int,
    user_message: str = "Look around.",
    raw_prose: str = "The square is quiet.",
):
    parent = repo.get_turn_node(parent_turn_id)
    turn = repo.save_turn_node(
        turn_id=turn_id,
        campaign_id=campaign_id,
        parent_turn_id=parent_turn_id,
        depth_index=depth,
        user_message=user_message,
        actor_id=parent.actor_id,
        raw_prose=raw_prose,
        cognition=parent.cognition,
        pre_turn=parent.pre_turn,
        world_snapshot=parent.world_snapshot,
        character_state=parent.character_state,
        recalled_items=[],
    )
    repo.checkout_turn_branch(campaign_id, turn.id)
    return turn


def test_gm_mode_default_off_partial_settings_and_403_guards(
    authed_client: tuple[TestClient, CantinaRepository],
) -> None:
    client, repo = authed_client
    world, _char, camp = _seed_gm_scenario(repo)
    loc = world.locations[0]
    secret_lore = next(ln for ln in loc.lore_nodes if ln.category == "secret")

    # Default unlock_lore is False
    bundle = repo.get_campaign_state_bundle(camp.id, owner_id="user_gm_tester")
    assert bundle.campaign.world_settings.unlock_lore is False
    assert bundle.campaign.world_settings.describe_on_first_visit is True
    assert len(bundle.world_lore_nodes) == 2

    # All GM lore/reveal/major-event endpoints return 403 while unlock_lore is False
    assert (
        client.put(f"/api/campaigns/{camp.id}/lore", json={"lore_nodes": []}).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/campaigns/{camp.id}/locations/{loc.id}/lore",
            json={"lore_nodes": []},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/campaigns/{camp.id}/lore/{secret_lore.id}/reveal",
            json={"revealed": True},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/campaigns/{camp.id}/major-events/{bundle.active_branch_turns[0].id}",
            json={"title": "X", "summary": "Y", "keywords": ["k"]},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/campaigns/{camp.id}/major-events/{bundle.active_branch_turns[0].id}"
        ).status_code
        == 403
    )

    # Partial PATCH preserves other world setting fields
    res1 = client.patch(
        f"/api/campaigns/{camp.id}/world-settings",
        json={"describe_on_first_visit": False},
    )
    assert res1.status_code == 200
    assert res1.json()["campaign"]["world_settings"] == {
        "describe_on_first_visit": False,
        "unlock_lore": False,
    }

    res2 = client.patch(
        f"/api/campaigns/{camp.id}/world-settings",
        json={"unlock_lore": True},
    )
    assert res2.status_code == 200
    assert res2.json()["campaign"]["world_settings"] == {
        "describe_on_first_visit": False,
        "unlock_lore": True,
    }


def test_branch_safe_world_lore_cow_tombstones_and_rag(
    authed_client: tuple[TestClient, CantinaRepository],
) -> None:
    client, repo = authed_client
    world, _char, camp = _seed_gm_scenario(repo)
    base_history = next(ln for ln in world.lore_nodes if ln.title == "Iron Pact Charter")
    base_artifact = next(ln for ln in world.lore_nodes if ln.title == "Crown of Embers")

    root_id = repo.get_campaign_state_bundle(camp.id).active_branch_turns[0].id
    t1 = _append_turn(repo, camp.id, parent_turn_id=root_id, turn_id="t1", depth=1)
    t2a = _append_turn(repo, camp.id, parent_turn_id=t1.id, turn_id="t2a", depth=2)

    client.patch(f"/api/campaigns/{camp.id}/world-settings", json={"unlock_lore": True})

    # At Turn 2a: edit base_history, delete base_artifact, and add a new campaign Codex entry
    res_put = client.put(
        f"/api/campaigns/{camp.id}/lore",
        json={
            "lore_nodes": [
                {
                    "id": base_history.id,
                    "title": "Iron Pact Charter (Amended)",
                    "category": "history",
                    "content": "Amended after the northern lords seceded.",
                    "entity_tags": ["Iron Pact", "secession"],
                },
                {
                    "title": "Black Glass Guild",
                    "category": "faction",
                    "content": "Smugglers trading volcanic glass blades in the capital.",
                    "entity_tags": ["Black Glass Guild", "volcanic glass"],
                },
            ]
        },
    )
    assert res_put.status_code == 200, res_put.text
    b_t2a = res_put.json()
    titles_t2a = [ln["title"] for ln in b_t2a["world_lore_nodes"]]
    assert titles_t2a == ["Iron Pact Charter (Amended)", "Black Glass Guild"]

    # Base world must remain completely untouched
    base_world = repo.get_world(world.id, base_only=True)
    assert [ln.title for ln in base_world.lore_nodes] == [
        "Iron Pact Charter",
        "Crown of Embers",
    ]

    # RAG on branch {root, t1, t2a} finds Black Glass Guild and excludes tombstoned Crown of Embers
    recalled_a = asyncio.run(
        repo.vector_store.search_memories(
            queries=["Black Glass Guild Crown of Embers"],
            mentioned_entities=["Black Glass Guild", "Crown of Embers"],
            world_id=world.id,
            character_id=camp.character_id,
            campaign_id=camp.id,
            valid_branch_turn_ids={root_id, t1.id, t2a.id},
        )
    )
    recalled_titles_a = [r.title for r in recalled_a]
    assert "Black Glass Guild" in recalled_titles_a
    assert "Crown of Embers" not in recalled_titles_a

    # Branch from Turn 1 -> Turn 2b: later edits from Turn 2a must NOT appear!
    t2b = _append_turn(repo, camp.id, parent_turn_id=t1.id, turn_id="t2b", depth=2)
    b_t2b = repo.get_campaign_state_bundle(camp.id)
    assert [ln.title for ln in b_t2b.world_lore_nodes] == [
        "Iron Pact Charter",
        "Crown of Embers",
    ]
    recalled_b = asyncio.run(
        repo.vector_store.search_memories(
            queries=["Black Glass Guild Crown of Embers"],
            mentioned_entities=["Black Glass Guild", "Crown of Embers"],
            world_id=world.id,
            character_id=camp.character_id,
            campaign_id=camp.id,
            valid_branch_turn_ids={root_id, t1.id, t2b.id},
        )
    )
    recalled_titles_b = [r.title for r in recalled_b]
    assert "Black Glass Guild" not in recalled_titles_b
    assert "Crown of Embers" in recalled_titles_b

    # Checkout Turn 2a and delete Turn 2a -> tombstones & Turn 2a lore are cleaned up
    repo.checkout_turn_branch(camp.id, t2a.id)
    b_after_del = repo.delete_last_turn(camp.id, owner_id="user_gm_tester")
    assert [ln.title for ln in b_after_del.world_lore_nodes] == [
        "Iron Pact Charter",
        "Crown of Embers",
    ]


def test_secret_reveal_detection_manual_toggle_and_canonical_edit_identity(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo = authed_client
    world, char, camp = _seed_gm_scenario(repo)
    loc = world.locations[0]
    secret_lore = next(ln for ln in loc.lore_nodes if ln.category == "secret")
    root_id = repo.get_campaign_state_bundle(camp.id).active_branch_turns[0].id
    t1 = _append_turn(
        repo,
        camp.id,
        parent_turn_id=root_id,
        turn_id="t_reveal_1",
        depth=1,
        user_message="Pry open the central dais.",
        raw_prose="The stonework slides back, revealing the hidden crypt holding the crown ledger.",
    )

    # Mock Phase 5 Clerk returning the revealed secret ID
    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        AsyncMock(
            side_effect=[
                WorldPostTurnDelta(
                    elapsed_minutes=5,
                    revealed_secret_lore_ids=[secret_lore.id, "bogus_unknown_id"],
                ),
                CharacterAgentDelta(mood_label="Intrigued and alert"),
            ]
        ),
    )

    updated_turn, _ = asyncio.run(
        run_phase5_post_turn_clerk(
            repo=repo,
            campaign_id=camp.id,
            world_id=world.id,
            character=char,
            completed_turn=t1,
            active_location=loc,
            neighbors=[],
            present_characters=[char],
            dispatch_mode="sequential",
        )
    )
    assert updated_turn.world_snapshot.revealed_lore_ids == [secret_lore.id]
    assert updated_turn.post_turn is not None
    assert updated_turn.post_turn.revealed_secret_lore_ids == [secret_lore.id]

    # Enable GM Mode and edit the revealed secret (creating a CoW revision with origin_lore_id)
    client.patch(f"/api/campaigns/{camp.id}/world-settings", json={"unlock_lore": True})
    t2 = _append_turn(repo, camp.id, parent_turn_id=t1.id, turn_id="t_reveal_2", depth=2)
    b_t2 = repo.get_campaign_state_bundle(camp.id)
    assert secret_lore.id in b_t2.current_world_snapshot.revealed_lore_ids

    res_edit = client.put(
        f"/api/campaigns/{camp.id}/locations/{loc.id}/lore",
        json={
            "lore_nodes": [
                {
                    "id": secret_lore.id,
                    "title": "Vault Below the Dais (Corrected)",
                    "category": "secret",
                    "content": "Holds the sealed royal ledger and signet.",
                    "entity_tags": ["dais", "crypt", "ledger"],
                }
            ]
        },
    )
    assert res_edit.status_code == 200
    edited_loc = next(
        l for l in res_edit.json()["visible_locations"] if l["id"] == loc.id
    )
    edited_secret = edited_loc["lore_nodes"][0]
    assert edited_secret["id"] != secret_lore.id
    assert edited_secret["origin_lore_id"] == secret_lore.id
    # Canonical ID remains in revealed_lore_ids!
    assert secret_lore.id in res_edit.json()["current_world_snapshot"]["revealed_lore_ids"]

    # Manual Mark Hidden toggle removes canonical ID at active leaf turn
    res_hide = client.post(
        f"/api/campaigns/{camp.id}/lore/{edited_secret['id']}/reveal",
        json={"revealed": False},
    )
    assert res_hide.status_code == 200
    assert res_hide.json()["current_world_snapshot"]["revealed_lore_ids"] == []

    # Rewind to t1 -> t1 still has the reveal intact!
    b_t1 = repo.checkout_turn_branch(camp.id, t1.id)
    assert b_t1.current_world_snapshot.revealed_lore_ids == [secret_lore.id]
    # Rewind to root -> root has zero reveals!
    b_root = repo.checkout_turn_branch(camp.id, root_id)
    assert b_root.current_world_snapshot.revealed_lore_ids == []
    assert t2.id != root_id


def test_clerk_major_events_world_and_location_mutations_and_gm_edit_revert(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo = authed_client
    world, char, camp = _seed_gm_scenario(repo)
    loc = world.locations[0]
    conn_init = repo._connect()
    try:
        conn_init.execute(
            "UPDATE location_nodes SET ui_x = 120.0, ui_y = 240.0, icon = 'castle' WHERE id = ?",
            (loc.id,),
        )
        conn_init.commit()
    finally:
        conn_init.close()
    loc = repo.get_location(loc.id, campaign_id=camp.id)
    root_id = repo.get_campaign_state_bundle(camp.id).active_branch_turns[0].id

    # Verify date stripping for both ISO and custom fantasy calendars
    assert extract_world_date_label("1420-05-10 09:45") == "1420-05-10"
    assert extract_world_date_label("Day 4 of the Ash Moon, 14:30") == "Day 4 of the Ash Moon"
    assert extract_world_date_label("Third Age, Year 12 (+15m)") == "Third Age, Year 12"

    # 1. World-changing Major Event on Turn 1
    t1 = _append_turn(
        repo,
        camp.id,
        parent_turn_id=root_id,
        turn_id="t_me_world",
        depth=1,
        user_message="Strike down the usurper king before the crowd.",
        raw_prose="The usurper king falls dead on the flagstones of Sunstone Plaza.",
    )
    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        AsyncMock(
            side_effect=[
                WorldPostTurnDelta(
                    elapsed_minutes=10,
                    notable_event_summary="The usurper king was assassinated in Sunstone Plaza.",
                    major_event=MajorEventSpec(
                        scope="world",
                        evocative_title="Fall of the Usurper King",
                        summary="At Sunstone Plaza, the player and allies assassinated the usurper king before the assembled populace.",
                        keywords=["Usurper King", "assassination", "Sunstone Plaza"],
                    ),
                ),
                CharacterAgentDelta(mood_label="Shaken yet resolute"),
            ]
        ),
    )
    t1_updated, _ = asyncio.run(
        run_phase5_post_turn_clerk(
            repo=repo,
            campaign_id=camp.id,
            world_id=world.id,
            character=char,
            completed_turn=t1,
            active_location=loc,
            neighbors=[],
            present_characters=[char],
            dispatch_mode="sequential",
        )
    )
    assert t1_updated.post_turn is not None
    assert t1_updated.post_turn.major_event is not None
    assert t1_updated.post_turn.major_event.scope == "world"
    assert t1_updated.post_turn.major_event.title == "1420-05-10 - Fall of the Usurper King"

    bundle_t1 = repo.get_campaign_state_bundle(camp.id)
    major_world_lore = [ln for ln in bundle_t1.world_lore_nodes if ln.is_major_event]
    assert len(major_world_lore) == 1
    assert major_world_lore[0].category == "history"
    assert major_world_lore[0].title == "1420-05-10 - Fall of the Usurper King"

    # Confirm no redundant event_t_me_world vector entry was double-indexed
    conn = repo._connect()
    try:
        dup_ev = conn.execute(
            "SELECT id FROM vector_entries WHERE id = ?", (f"event_{t1.id}",)
        ).fetchone()
    finally:
        conn.close()
    assert dup_ev is None

    # 2. Location-changing Major Event on Turn 2
    t2 = _append_turn(
        repo,
        camp.id,
        parent_turn_id=t1.id,
        turn_id="t_me_loc",
        depth=2,
        user_message="Divert the sluice gates and erect a bronze statue.",
        raw_prose="The swamp drains away and workers raise a towering bronze statue in the center of Sunstone Plaza.",
    )
    monkeypatch.setattr(
        llm_client,
        "complete_structured",
        AsyncMock(
            side_effect=[
                WorldPostTurnDelta(
                    elapsed_minutes=60,
                    major_event=MajorEventSpec(
                        scope="location",
                        evocative_title="Bronze Monument Raised in Sunstone Plaza",
                        summary="Workers redirected the canals and erected a massive bronze statue in the plaza center.",
                        keywords=["bronze statue", "Sunstone Plaza"],
                        location_description_update="A cobblestone plaza framed by white marble arcades, now dominated by a towering bronze statue in its center.",
                        environmental_tags_added=["monument", "dry"],
                        environmental_tags_removed=["swamp"],
                    ),
                ),
                CharacterAgentDelta(mood_label="Proud and reflective"),
            ]
        ),
    )
    t2_updated, _ = asyncio.run(
        run_phase5_post_turn_clerk(
            repo=repo,
            campaign_id=camp.id,
            world_id=world.id,
            character=char,
            completed_turn=t2,
            active_location=loc,
            neighbors=[],
            present_characters=[char],
            dispatch_mode="sequential",
        )
    )
    assert t2_updated.post_turn is not None
    assert t2_updated.post_turn.major_event is not None
    assert t2_updated.post_turn.major_event.scope == "location"

    # Verify location description & tags updated while spatial ui_x, ui_y, icon preserved!
    bundle_t2 = repo.get_campaign_state_bundle(camp.id)
    mutated_loc = next(l for l in bundle_t2.visible_locations if l.id == loc.id)
    assert "towering bronze statue" in mutated_loc.description
    assert "monument" in mutated_loc.environmental_tags
    assert "swamp" not in mutated_loc.environmental_tags
    assert mutated_loc.ui_x == 120.0
    assert mutated_loc.ui_y == 240.0
    assert mutated_loc.icon == "castle"

    # Base world remains untouched
    base_loc = repo.get_world(world.id, base_only=True).locations[0]
    assert "empty cobblestone plaza" in base_loc.description
    assert "swamp" in base_loc.environmental_tags

    # 3. GM Mode Edit & Delete/Revert on Major Events
    client.patch(f"/api/campaigns/{camp.id}/world-settings", json={"unlock_lore": True})
    res_patch_world = client.patch(
        f"/api/campaigns/{camp.id}/major-events/{t1.id}",
        json={
            "title": "1420-05-10 - Fall of the Tyrant King",
            "summary": "Edited summary naming the tyrant king.",
            "keywords": ["Tyrant King", "Sunstone Plaza"],
        },
    )
    assert res_patch_world.status_code == 200
    patched_lore = [
        ln for ln in res_patch_world.json()["world_lore_nodes"] if ln.get("is_major_event")
    ]
    assert len(patched_lore) == 1
    assert patched_lore[0]["title"] == "1420-05-10 - Fall of the Tyrant King"

    res_del_loc = client.delete(f"/api/campaigns/{camp.id}/major-events/{t2.id}")
    assert res_del_loc.status_code == 200
    reverted_loc = next(
        l for l in res_del_loc.json()["visible_locations"] if l["id"] == loc.id
    )
    assert "empty cobblestone plaza" in reverted_loc["description"]
    assert "swamp" in reverted_loc["environmental_tags"]
    assert reverted_loc["ui_x"] == 120.0
    assert reverted_loc["icon"] == "castle"

    res_del_world = client.delete(f"/api/campaigns/{camp.id}/major-events/{t1.id}")
    assert res_del_world.status_code == 200
    assert [
        ln for ln in res_del_world.json()["world_lore_nodes"] if ln.get("is_major_event")
    ] == []


def test_visited_location_gm_unlock_in_campaign_map_update(
    empty_repo: CantinaRepository,
) -> None:
    empty_repo.create_user(
        username="map_gm", display_name="Map GM", role="admin", user_id="user_gm_tester"
    )
    world, _char, camp = _seed_gm_scenario(empty_repo)
    b0 = empty_repo.get_campaign_state_bundle(camp.id, owner_id="user_gm_tester")
    visited_loc = b0.visible_locations[0]
    assert visited_loc.is_visited is True

    edited_loc = visited_loc.model_copy(
        update={"description": "A rebuilt marble plaza."}
    )
    payload = CampaignMapUpdatePayload(
        containers=b0.containers,
        locations=[edited_loc],
        edges=b0.visible_edges,
    )

    # Blocked when unlock_lore is False
    with pytest.raises(ValueError, match="Cannot modify name, summary, description"):
        empty_repo.update_campaign_map(camp.id, payload, owner_id="user_gm_tester")

    # Allowed when unlock_lore is True (saved branch-safely via campaign_spatial_overrides)
    empty_repo.update_campaign_world_settings(
        camp.id,
        CampaignWorldSettings(describe_on_first_visit=True, unlock_lore=True),
        owner_id="user_gm_tester",
    )
    b1 = empty_repo.update_campaign_map(camp.id, payload, owner_id="user_gm_tester")
    assert b1.visible_locations[0].description == "A rebuilt marble plaza."
    assert "empty cobblestone plaza" in empty_repo.get_world(world.id, base_only=True).locations[0].description


def test_zcc_v2_roundtrip_campaign_lore_tombstones_reveals_and_major_events(
    authed_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reset_rate_limiters()
    client, repo = authed_client
    monkeypatch.setattr(import_export_router, "get_repo", lambda: repo)
    world, _char, camp = _seed_gm_scenario(repo)
    loc = world.locations[0]
    secret_lore = next(ln for ln in loc.lore_nodes if ln.category == "secret")
    base_history = next(ln for ln in world.lore_nodes if ln.title == "Iron Pact Charter")

    client.patch(f"/api/campaigns/{camp.id}/world-settings", json={"unlock_lore": True})
    client.post(
        f"/api/campaigns/{camp.id}/lore/{secret_lore.id}/reveal",
        json={"revealed": True},
    )
    client.put(
        f"/api/campaigns/{camp.id}/lore",
        json={
            "lore_nodes": [
                {
                    "id": base_history.id,
                    "title": "Iron Pact Charter (Exported)",
                    "category": "history",
                    "content": "Campaign-amended charter.",
                    "entity_tags": ["Iron Pact"],
                }
            ]
        },
    )
    root_id = repo.get_campaign_state_bundle(camp.id).active_branch_turns[0].id
    asyncio.run(
        repo.aadd_clerk_world_major_event_lore(
            campaign_id=camp.id,
            world_id=world.id,
            turn_id=root_id,
            title="1420-05-10 - Eclipse Over Sunstone",
            content="The sun vanished at noon over Sunstone Plaza.",
            keywords=["Eclipse", "Sunstone Plaza"],
        )
    )

    # Base world export MUST exclude campaign-scoped lore
    w_exp = client.get(f"/api/export/world/{world.id}?include_characters=false&include_media=false")
    assert w_exp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(w_exp.content), "r") as zf:
        worlds_raw = json.loads(zf.read("worlds.json"))
        exported_world_lore_titles = [ln["title"] for ln in worlds_raw[0]["lore_nodes"]]
        assert exported_world_lore_titles == ["Iron Pact Charter", "Crown of Embers"]

    # Campaign export + import round-trip preserves unlock_lore, world lore CoW, tombstones, reveals & major events
    c_exp = client.post(
        f"/api/export/campaign/{camp.id}",
        json={"timeline_scope": "full", "strip_bookmark_comments": False},
    )
    assert c_exp.status_code == 200
    ins_res = client.post(
        "/api/import/inspect",
        files={"file": ("ashen.zcc", c_exp.content, "application/octet-stream")},
    )
    assert ins_res.status_code == 200
    staged_token = ins_res.json()["staged_token"]
    commit_res = client.post(
        "/api/import/commit",
        json={
            "staged_token": staged_token,
            "import_campaign_assets_as_standalone": False,
        },
    )
    assert commit_res.status_code == 200, commit_res.text
    imported_camps = commit_res.json()["imported_campaigns"]
    assert len(imported_camps) == 1
    imported_camp = next(
        c for c in repo.list_campaigns(owner_id="user_gm_tester") if c.id != camp.id
    )
    imported_bundle = repo.get_campaign_state_bundle(
        imported_camp.id, owner_id="user_gm_tester"
    )
    assert imported_bundle.campaign.world_settings.unlock_lore is True
    assert len(imported_bundle.current_world_snapshot.revealed_lore_ids) == 1
    imported_titles = {ln.title for ln in imported_bundle.world_lore_nodes}
    assert "Iron Pact Charter (Exported)" in imported_titles
    assert "1420-05-10 - Eclipse Over Sunstone" in imported_titles
    # Crown of Embers was tombstoned in the original campaign and must stay tombstoned!
    assert "Crown of Embers" not in imported_titles
    assert any(ln.is_major_event for ln in imported_bundle.world_lore_nodes)
