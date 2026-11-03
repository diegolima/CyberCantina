"""Comprehensive tests for the Cybercantina Item & Inventory System Evolution:
- World-only 'artifact' lore category & SQLite migration
- Structured ItemInstance coercion & flag invariants
- Consolidated /item-equip endpoint (equip/unequip/add/remove/update, Swipe backfill, tenant security)
- Copy-on-Write world fork artifact lore_id remapping
- Phase 5 Clerk 'permanent' custody protection, anti-cloning, word-boundary matching & transfer conservation
- Phase 2 conditional item lore injection, Zone 3 suppression, RAG deduplication & epistemic isolation
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app import main as main_module
from app.auth import get_current_user
from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.character_agent import apply_character_inventory_delta
from app.engine.phase2_context import resolve_phase2_turn_context
from app.engine.phase5_clerk import run_phase5_post_turn_clerk
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    CognitionBlock,
    ItemInstance,
    VoiceAnchor,
    coerce_item_list,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    PostTurnStateDelta,
    PreTurnAnalysis,
    WorldPostTurnDelta,
)
from app.schemas.world import (
    LocationLoreNodeDraft,
    LocationNodeDraft,
    LoreNode,
    WorldLoreNodeDraft,
    WorldUpdatePayload,
)


@pytest.fixture
def authed_client(temp_repo: CantinaRepository) -> tuple[TestClient, CantinaRepository]:
    """Authenticated FastAPI TestClient bound to temp_repo."""
    user = temp_repo.create_user(
        username="item_tester",
        display_name="Item Tester",
        role="admin",
        user_id="user_item_tester",
    )
    temp_repo.claim_unowned_entities(user.id)
    main_module.app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(main_module.app)
    try:
        yield client, temp_repo
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def _make_npc(
    repo: CantinaRepository,
    name: str,
    world_id: str,
    *,
    equipped: list[str | ItemInstance] | None = None,
    inventory: list[str | ItemInstance] | None = None,
    owner_id: str | None = None,
) -> CharacterRecord:
    draft = CharacterWizardDraft(
        name=name,
        tagline="Seasoned cantina operative",
        physical_appearance="Lean frame with weathered cybernetic knuckles.",
        core_persona="Pragmatic, watchful, and terse.",
        initial_message=f"*{name} nods from the corner.*",
        equipped=equipped or [" Trench Coat "],  # type: ignore[arg-type]
        inventory=inventory or [" Brass Lighter "],  # type: ignore[arg-type]
        voice_anchors=[VoiceAnchor(context="Neutral", snippet='"Keep your voice down."')],
        baseline_psyche=BaselinePsyche(
            mood_label="Calmly alert",
            valence=0.05,
            arousal=0.35,
            core_drive="Protect old debts",
            core_fear="Betrayal",
            default_want="Assess the room",
            default_plan="Watch the door",
        ),
        memory_shards=[],
    )
    return repo.create_character_from_draft(draft, world_id=world_id, owner_id=owner_id)


def _add_world_artifact(
    repo: CantinaRepository,
    world_id: str,
    *,
    title: str = "The Astral Chrono-Key",
    content: str = "Pre-collapse quantum skeleton key capable of unlocking orbital vault bulkheads.",
    tags: list[str] | None = None,
    owner_id: str | None = None,
) -> tuple[str, str]:
    """Append an 'artifact' lore entry to world_id and return (updated_world_id, artifact_lore_id)."""
    w = repo.get_world(world_id, owner_id=owner_id)
    new_lore_nodes = [
        *w.lore_nodes,
        LoreNode(
            id="new_artifact_1",
            world_id=w.id,
            location_id=None,
            title=title,
            category="artifact",
            content=content,
            entity_tags=tags or ["Chrono-Key", "Orbital Vault"],
        ),
    ]
    updated_w = repo.update_world(
        w.id,
        WorldUpdatePayload(
            name=w.name,
            global_rules=w.global_rules,
            locations=w.locations,
            edges=w.edges,
            lore_nodes=new_lore_nodes,
        ),
        owner_id=owner_id,
    )
    art = next(ln for ln in updated_w.lore_nodes if ln.title == title and ln.category == "artifact")
    return updated_w.id, art.id


# ==============================================================================
# 1. World 'artifact' Lore Scope & SQLite Schema Migration
# ==============================================================================


def test_artifact_lore_allowed_on_world_and_rejected_on_location(
    temp_repo: CantinaRepository,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify 'artifact' is strictly allowed on world lore and disallowed on location lore at all layers."""
    # Pydantic validation
    w_draft = WorldLoreNodeDraft(
        title="Relic Core",
        category="artifact",
        content="Ancient fusion core.",
        entity_tags=["Relic Core"],
    )
    assert w_draft.category == "artifact"

    with pytest.raises(ValidationError):
        LocationLoreNodeDraft(
            title="Local Relic",
            category="artifact",  # type: ignore[arg-type]
            content="Should not be allowed in location lore.",
            entity_tags=["Local Relic"],
        )

    with pytest.raises(ValidationError):
        LoreNode(
            id="lore_bad_loc_art",
            world_id="world_neon_rust",
            location_id="loc_some_room",
            title="Scoped Artifact",
            category="artifact",
            content="Location-scoped artifacts are forbidden.",
            entity_tags=["Scoped Artifact"],
        )

    # SQLite raw CHECK constraint enforcement
    world = temp_repo.get_world("world_neon_rust")
    loc_id = world.locations[0].id
    conn = temp_repo._connect()
    try:
        conn.execute(
            """
            INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
            VALUES ('lore_ok_world_art', ?, NULL, NULL, 'Sun Shard', 'artifact', 'Radiant shard.', '["Sun Shard"]')
            """,
            (world.id,),
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
                VALUES ('lore_bad_loc_art', ?, ?, NULL, 'Room Shard', 'artifact', 'Invalid scope.', '["Room Shard"]')
                """,
                (world.id, loc_id),
            )
        conn.rollback()
    finally:
        conn.close()

    # Pre-artifact layered DB migration upgrades lore_nodes CHECK constraint cleanly
    old_db = str(tmp_path / "pre_artifact_layered.db")
    conn_old = sqlite3.connect(old_db)
    try:
        conn_old.executescript(
            """
            CREATE TABLE worlds (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                global_rules_json TEXT NOT NULL,
                pending_deletion INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE location_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT NULL,
                name TEXT NOT NULL,
                summary TEXT NOT NULL,
                description TEXT NOT NULL,
                environmental_tags_json TEXT NOT NULL,
                is_starting_location INTEGER NOT NULL DEFAULT 0,
                is_hub INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE lore_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                location_id TEXT NULL,
                campaign_id TEXT NULL,
                title TEXT NOT NULL CHECK(length(trim(title)) >= 1),
                category TEXT NOT NULL CHECK(
                    category IN ('history', 'culture', 'faction', 'rumor', 'secret')
                    AND (location_id IS NOT NULL OR category != 'secret')
                    AND (campaign_id IS NULL OR location_id IS NOT NULL)
                ),
                content TEXT NOT NULL CHECK(length(trim(content)) >= 1),
                entity_tags_json TEXT NOT NULL CHECK(
                    json_valid(entity_tags_json)
                    AND json_type(entity_tags_json) = 'array'
                    AND json_array_length(entity_tags_json) >= 1
                )
            );
            INSERT INTO worlds VALUES ('w_old', 'Old World', '{"genre":"Sci-Fi","tone":"Gritty","setting_overview":"x","tech_or_magic_rules":"y","starting_timestamp":"Day 1, 20:00"}', 0, '2026-01-01T00:00:00Z');
            INSERT INTO lore_nodes VALUES ('l_old', 'w_old', NULL, NULL, 'Old History', 'history', 'Ancient war.', '["War"]');
            """
        )
        conn_old.commit()
    finally:
        conn_old.close()

    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    upgraded_repo = CantinaRepository(old_db)
    upgraded_repo.init_db()
    conn_up = upgraded_repo._connect()
    try:
        conn_up.execute(
            """
            INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
            VALUES ('l_new_art', 'w_old', NULL, NULL, 'Upgraded Artifact', 'artifact', 'Works after migration.', '["Artifact"]')
            """
        )
        conn_up.commit()
    finally:
        conn_up.close()


# ==============================================================================
# 2. ItemInstance Coercion, Deterministic IDs & Flag Invariants
# ==============================================================================


def test_item_instance_coercion_and_flag_invariants() -> None:
    """Verify legacy strings coerce deterministically and flag <-> lore_id invariants hold."""
    raw_list = [
        "  Silver Locket  ",
        "",
        "   ",
        "Silver Locket",  # duplicate gets disambiguated ID
        "X" * 220,  # clamped to 160 chars
        {"name": "Chrono Key", "lore_id": "lore_art_1", "flags": ["permanent"]},
        {"name": "Orphan Relic", "flags": ["artifact"], "lore_id": None},
    ]
    coerced = coerce_item_list(raw_list)
    assert len(coerced) == 5

    # Deterministic IDs across repeated coercions
    again = coerce_item_list(["Silver Locket"])
    assert coerced[0].id == again[0].id
    assert coerced[0].name == "Silver Locket"
    assert coerced[0] == "Silver Locket"  # string equality compatibility
    assert coerced[1].id != coerced[0].id  # duplicate disambiguated
    assert len(coerced[2].name) == 160

    # Linking lore_id auto-attaches 'artifact' while preserving 'permanent'
    assert set(coerced[3].flags) == {"permanent", "artifact"}
    assert coerced[3].lore_id == "lore_art_1"

    # Lenient read mode strips unlinked 'artifact' flag
    assert coerced[4].flags == []
    assert coerced[4].lore_id is None

    # Strict payload mode rejects 'artifact' flag without lore_id
    with pytest.raises(ValidationError):
        CharacterUpdatePayload(
            name="Strict Tester",
            tagline="Tag",
            core_persona="Persona",
            equipped=[{"name": "Unlinked Relic", "flags": ["artifact"], "lore_id": None}],  # type: ignore[list-item]
            inventory=[],
            baseline_psyche=BaselinePsyche(
                core_drive="Drive",
                core_fear="Fear",
                default_want="Want",
                default_plan="Plan",
            ),
        )


# ==============================================================================
# 3. Consolidated /item-equip Endpoint, Tenant Security & Swipe Backfill
# ==============================================================================


def test_consolidated_item_endpoint_security_and_swipe_backfill(
    authed_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify add/update/equip/unequip metadata preservation, cross-world/location lore rejection, and parent backfill."""
    client, repo = authed_client
    owner_id = "user_item_tester"

    world_id, art_lore_id = _add_world_artifact(repo, "world_neon_rust", owner_id=owner_id)
    world = repo.get_world(world_id, owner_id=owner_id)
    non_artifact_lore = next(ln for ln in world.lore_nodes if ln.category != "artifact")

    # Create a second world owned by ANOTHER user with its own artifact lore (cross-tenant test)
    other_user = repo.create_user(
        username="other_tenant",
        display_name="Other Tenant",
        role="user",
        user_id="user_other_tenant",
    )
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO worlds VALUES ('world_foreign', 'user_other_tenant', 'Foreign World', ?, 0, '2026-01-01T00:00:00Z')",
            (world.global_rules.model_dump_json(),),
        )
        conn.execute(
            """
            INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
            VALUES ('lore_foreign_art', 'world_foreign', NULL, NULL, 'Foreign Crown', 'artifact', 'Secret crown.', '["Crown"]')
            """
        )
        conn.execute(
            """
            INSERT INTO lore_nodes (id, world_id, location_id, campaign_id, title, category, content, entity_tags_json)
            VALUES ('lore_local_sec', ?, ?, NULL, 'Hidden Safe', 'secret', 'Behind painting.', '["Safe"]')
            """,
            (world.id, world.locations[0].id),
        )
        conn.commit()
    finally:
        conn.close()
    assert other_user.id == "user_other_tenant"

    npc = _make_npc(
        repo,
        "Sera Voss",
        world.id,
        equipped=[" Leather Duster "],
        inventory=[" Silver Locket "],
        owner_id=owner_id,
    )
    camp = repo.create_campaign(
        name="Sera Item Campaign",
        world_id=world.id,
        character_id=npc.id,
        owner_id=owner_id,
    )
    bundle0 = repo.get_campaign_state_bundle(camp.id, owner_id=owner_id)
    turn0 = bundle0.active_branch_turns[-1]

    # Save Turn 1 inheriting blank metadata on "Silver Locket"
    turn1 = repo.save_turn_node(
        turn_id="turn_item_1",
        campaign_id=camp.id,
        parent_turn_id=turn0.id,
        depth_index=1,
        user_message="Hello Sera.",
        actor_id=npc.id,
        raw_prose='*Sera adjusts her collar.* "Evening."',
        cognition=CognitionBlock(feeling="Guarded", valence=0.0, arousal=0.3),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=turn0.world_snapshot.model_copy(update={"turn_id": "turn_item_1"}),
        character_state=turn0.character_state.model_copy(update={"turn_id": "turn_item_1"}),
        recalled_items=[],
    )

    locket = next(it for it in turn1.character_state.inventory if it.name == "Silver Locket")

    # 1. Reject setting 'artifact' without lore_id -> 400
    r_bad1 = client.post(
        f"/api/campaigns/{camp.id}/item-equip",
        json={
            "character_id": npc.id,
            "item": "Silver Locket",
            "item_id": locket.id,
            "action": "update",
            "flags": ["artifact"],
        },
    )
    assert r_bad1.status_code == 400

    # 2. Reject linking foreign-tenant artifact lore, non-artifact world lore, and location secret lore -> 400
    for invalid_lore_id in ("lore_foreign_art", non_artifact_lore.id, "lore_local_sec"):
        r_bad_lore = client.post(
            f"/api/campaigns/{camp.id}/item-equip",
            json={
                "character_id": npc.id,
                "item": "Silver Locket",
                "item_id": locket.id,
                "action": "update",
                "flags": ["artifact"],
                "lore_id": invalid_lore_id,
            },
        )
        assert r_bad_lore.status_code == 400

    # 3. Valid update on Turn 1: attach note + permanent + world artifact lore_id
    r_ok = client.post(
        f"/api/campaigns/{camp.id}/item-equip",
        json={
            "character_id": npc.id,
            "item": "Silver Locket",
            "item_id": locket.id,
            "action": "update",
            "note": "Heirloom left by Sera's mother.",
            "flags": ["permanent", "artifact"],
            "lore_id": art_lore_id,
        },
    )
    assert r_ok.status_code == 200
    b_after_upd = r_ok.json()
    inv_items = b_after_upd["character_states"][npc.id]["inventory"]
    upd_locket = next(x for x in inv_items if x["id"] == locket.id)
    assert upd_locket["note"] == "Heirloom left by Sera's mother."
    assert set(upd_locket["flags"]) == {"permanent", "artifact"}
    assert upd_locket["lore_id"] == art_lore_id

    # 4. Immediate-parent blank-metadata backfill: Turn 0 also received the metadata so Swipe/Undo keeps it!
    reloaded_turn0 = repo.get_turn_node(turn0.id)
    t0_locket = next(it for it in reloaded_turn0.character_state.inventory if it.name == "Silver Locket")
    assert t0_locket.note == "Heirloom left by Sera's mother."
    assert set(t0_locket.flags) == {"permanent", "artifact"}
    assert t0_locket.lore_id == art_lore_id

    # Verify non-blank parent metadata is NOT overwritten on subsequent turn edits
    repo.save_turn_node(
        turn_id="turn_item_2",
        campaign_id=camp.id,
        parent_turn_id="turn_item_1",
        depth_index=2,
        user_message="Open the locket.",
        actor_id=npc.id,
        raw_prose="*Sera clicks the locket open.*",
        cognition=CognitionBlock(feeling="Wistful", valence=0.1, arousal=0.3),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=turn1.world_snapshot.model_copy(update={"turn_id": "turn_item_2"}),
        character_state=repo.get_turn_node("turn_item_1").character_state.model_copy(update={"turn_id": "turn_item_2"}),
        recalled_items=[],
    )
    r_upd2 = client.post(
        f"/api/campaigns/{camp.id}/item-equip",
        json={
            "character_id": npc.id,
            "item": "Silver Locket",
            "item_id": locket.id,
            "action": "update",
            "note": "Opened: holds a micro-cipher.",
        },
    )
    assert r_upd2.status_code == 200
    # Turn 1 kept its prior non-blank note ("Heirloom left by Sera's mother.") AND Turn 2 kept flags/lore_id!
    assert (
        next(it for it in repo.get_turn_node("turn_item_1").character_state.inventory if it.id == locket.id).note
        == "Heirloom left by Sera's mother."
    )
    t2_locket = next(it for it in repo.get_turn_node("turn_item_2").character_state.inventory if it.id == locket.id)
    assert t2_locket.note == "Opened: holds a micro-cipher."
    assert set(t2_locket.flags) == {"permanent", "artifact"}
    assert t2_locket.lore_id == art_lore_id

    # 5. Equip and Unequip preserve id, note, flags, and lore_id intact!
    r_eq = client.post(
        f"/api/campaigns/{camp.id}/item-equip",
        json={
            "character_id": npc.id,
            "item": "Silver Locket",
            "item_id": locket.id,
            "action": "equip",
        },
    )
    assert r_eq.status_code == 200
    eq_locket = next(
        x for x in r_eq.json()["character_states"][npc.id]["equipped"] if x["id"] == locket.id
    )
    assert eq_locket["note"] == "Opened: holds a micro-cipher."
    assert set(eq_locket["flags"]) == {"permanent", "artifact"}
    assert eq_locket["lore_id"] == art_lore_id

    # 6. Clearing lore_id removes 'artifact' flag while preserving 'permanent' and note
    r_clear = client.post(
        f"/api/campaigns/{camp.id}/item-equip",
        json={
            "character_id": npc.id,
            "item": "Silver Locket",
            "item_id": locket.id,
            "action": "update",
            "lore_id": None,
        },
    )
    assert r_clear.status_code == 200
    cleared_locket = next(
        x for x in r_clear.json()["character_states"][npc.id]["equipped"] if x["id"] == locket.id
    )
    assert cleared_locket["lore_id"] is None
    assert cleared_locket["flags"] == ["permanent"]
    assert cleared_locket["note"] == "Opened: holds a micro-cipher."


# ==============================================================================
# 4. Copy-on-Write World Fork Artifact lore_id Remapping
# ==============================================================================


def test_cow_world_fork_remaps_character_artifact_lore_id(
    temp_repo: CantinaRepository,
) -> None:
    """Verify Copy-on-Write world fork remaps ItemInstance.lore_id on active character templates."""
    world_id, orig_art_id = _add_world_artifact(temp_repo, "world_neon_rust")
    world = temp_repo.get_world(world_id)

    # Create a character in this world holding an item linked to orig_art_id, plus an unused template character
    runner_npc = _make_npc(temp_repo, "Runner NPC", world.id)
    template_npc = _make_npc(
        temp_repo,
        "Template Relic Bearer",
        world.id,
        inventory=[
            ItemInstance(
                name="Strange Key",
                note="Found in sector 9.",
                flags=["artifact"],
                lore_id=orig_art_id,
            )
        ],
    )

    # Launch a campaign so world_id has campaigns_using > 0 (triggers CoW fork on next update_world!)
    camp = temp_repo.create_campaign(
        name="World Fork Anchor Campaign",
        world_id=world.id,
        character_id=runner_npc.id,
    )
    assert camp.world_id == world.id

    # Edit the world ( triggers Copy-on-Write fork generating a brand-new world_id and brand-new lore_ids )
    forked_world = temp_repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=f"{world.name} v2",
            global_rules=world.global_rules,
            locations=world.locations,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
    )
    assert forked_world.id != world.id
    forked_art = next(ln for ln in forked_world.lore_nodes if ln.category == "artifact")
    assert forked_art.id != orig_art_id

    # Active template_npc was repointed to forked_world AND its ItemInstance.lore_id was remapped!
    repointed_char = temp_repo.get_character(template_npc.id)
    assert repointed_char.world_id == forked_world.id
    assert repointed_char.inventory[0].lore_id == forked_art.id
    assert "artifact" in repointed_char.inventory[0].flags
    assert repointed_char.inventory[0].note == "Found in sector 9."

    # Deleting the artifact lore node on forked_world (0 campaigns using forked_world) cleanly unlinks it
    no_art_world = temp_repo.update_world(
        forked_world.id,
        WorldUpdatePayload(
            name=forked_world.name,
            global_rules=forked_world.global_rules,
            locations=forked_world.locations,
            edges=forked_world.edges,
            lore_nodes=[ln for ln in forked_world.lore_nodes if ln.category != "artifact"],
        ),
    )
    cleaned_char = temp_repo.get_character(template_npc.id)
    assert cleaned_char.world_id == no_art_world.id
    assert cleaned_char.inventory[0].lore_id is None
    assert "artifact" not in cleaned_char.inventory[0].flags


# ==============================================================================
# 5. Phase 5 Clerk Protection, Anti-Cloning, Substring Safety & Conservation
# ==============================================================================


async def test_clerk_permanent_protection_anti_cloning_and_artifact_transfer(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify permanent lock vetoes removal & cloning, substring 'ring' spares 'Syringe', and transfers conserve metadata."""
    # Substring safety unit check: removing 'ring' removes 'Silver Ring' and NEVER deletes 'Medkit Syringe'
    eq_out, inv_out = apply_character_inventory_delta(
        existing_equipped=["Silver Ring"],
        existing_inventory=["Medkit Syringe"],
        delta=CharacterAgentDelta(mood_label="Calm", items_removed=["ring"]),
    )
    assert "Silver Ring" not in eq_out
    assert "Medkit Syringe" in inv_out

    world_id, art_id = _add_world_artifact(temp_repo, "world_neon_rust")
    world = temp_repo.get_world(world_id)
    start_loc = next(loc for loc in world.locations if loc.is_starting_location)

    perm_locket = ItemInstance(
        name="Mother's Locket",
        note="Engraved silver locket; never leaves Kira.",
        flags=["permanent"],
    )
    transfer_key = ItemInstance(
        name="Chrono-Key",
        note="Warm to the touch.",
        flags=["artifact"],
        lore_id=art_id,
    )

    kira = _make_npc(
        temp_repo,
        "Kira Test",
        world.id,
        equipped=[perm_locket],
        inventory=[transfer_key, ItemInstance(name="Medkit Syringe")],
    )
    viktor = _make_npc(
        temp_repo,
        "Viktor Test",
        world.id,
        equipped=["Heavy Coat"],
        inventory=[],
    )

    camp = temp_repo.create_campaign(
        name="Clerk Conservation Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: start_loc.id, viktor.id: start_loc.id},
    )
    b0 = temp_repo.get_campaign_state_bundle(camp.id)
    t0 = b0.active_branch_turns[-1]

    t1 = temp_repo.save_turn_node(
        turn_id="turn_clerk_1",
        campaign_id=camp.id,
        parent_turn_id=t0.id,
        depth_index=1,
        user_message="Kira, pass Viktor the Chrono-Key.",
        actor_id=kira.id,
        raw_prose='*Kira slides the Chrono-Key to Viktor while clutching her locket.*',
        cognition=CognitionBlock(feeling="Tense", valence=-0.1, arousal=0.5),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=t0.world_snapshot.model_copy(update={"turn_id": "turn_clerk_1"}),
        character_state=b0.character_states[kira.id].model_copy(update={"turn_id": "turn_clerk_1"}),
        extra_character_states=[b0.character_states[viktor.id].model_copy(update={"turn_id": "turn_clerk_1"})],
        recalled_items=[],
    )

    syringe_id = next(x.id for x in b0.character_states[kira.id].inventory if x.name == "Medkit Syringe")

    # Simulate Clerk agents where:
    # - Kira's agent tries to remove BOTH "Mother's Locket" (permanent!) and "Chrono-Key" (transferable artifact!)
    # - Viktor's agent tries to claim BOTH "Mother's Locket" (cloning attempt!) and "Chrono-Key" (valid handoff!)
    # - Meanwhile, mid-flight (after Phase 5 has already snapshotted prev_states_by_char), a player saves a live
    #   note edit on "Medkit Syringe" via the inspector!
    edited_mid_flight = False

    async def _fake_char_agent(**kwargs):
        nonlocal edited_mid_flight
        ch = kwargs["character"]
        if ch.id == kira.id:
            if not edited_mid_flight:
                edited_mid_flight = True
                temp_repo.toggle_campaign_item_equip(
                    camp.id,
                    character_id=kira.id,
                    item="Medkit Syringe",
                    item_id=syringe_id,
                    action="update",
                    note="Last dose of neuro-stabilizer.",
                )
            return CharacterAgentDelta(
                mood_label="Guarded resolve",
                items_removed=["Mother's Locket", "Chrono-Key"],
            )
        return CharacterAgentDelta(
            mood_label="Opportunistic",
            items_obtained=["Mother's Locket", "Chrono-Key"],
        )

    monkeypatch.setattr("app.engine.phase5_clerk.run_character_post_turn_agent", _fake_char_agent)

    await run_phase5_post_turn_clerk(
        repo=temp_repo,
        campaign_id=camp.id,
        world_id=world.id,
        character=kira,
        completed_turn=t1,
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        all_participants=[kira, viktor],
    )

    b_after = temp_repo.get_campaign_state_bundle(camp.id)
    kira_st = b_after.character_states[kira.id]
    viktor_st = b_after.character_states[viktor.id]
    post_turn = b_after.active_branch_turns[-1].post_turn
    assert post_turn is not None

    # 1. Permanent "Mother's Locket" stayed on Kira, was NOT cloned to Viktor, and was stripped from items_removed!
    assert any(x.id == perm_locket.id and "permanent" in x.flags for x in kira_st.equipped)
    assert not any("locket" in x.name.lower() for x in [*viktor_st.equipped, *viktor_st.inventory])
    assert not any("locket" in r.lower() for r in post_turn.inventory_removed)
    assert not any("locket" in r.lower() for r in post_turn.character_deltas[kira.id].items_removed)
    assert any("Permanent flag" in note for note in post_turn.arbitration_notes)

    # 2. Non-permanent artifact "Chrono-Key" moved from Kira to Viktor WITH full ItemInstance metadata intact!
    assert not any("chrono-key" in x.name.lower() for x in [*kira_st.equipped, *kira_st.inventory])
    viktor_key = next(x for x in viktor_st.inventory if x.name == "Chrono-Key")
    assert viktor_key.id == transfer_key.id
    assert viktor_key.note == "Warm to the touch."
    assert viktor_key.lore_id == art_id
    assert "artifact" in viktor_key.flags

    # 3. Live manual note edit on "Medkit Syringe" during Phase 5 was preserved by update_turn_post_clerk!
    kira_syringe = next(x for x in kira_st.inventory if x.id == syringe_id)
    assert kira_syringe.note == "Last dose of neuro-stabilizer."


# ==============================================================================
# 6. Phase 2 Conditional Injection, Zone 3 Suppression, RAG Dedup & Epistemic Isolation
# ==============================================================================


async def test_phase2_item_lore_hygiene_dedup_and_epistemic_isolation(
    temp_repo: CantinaRepository,
) -> None:
    """Verify relevance triggering, Zone 3 window suppression, RAG artifact deduplication, and pocket note privacy."""
    world_id, art_id = _add_world_artifact(
        temp_repo,
        "world_neon_rust",
        title="The Astral Chrono-Key",
        content="Pre-collapse quantum skeleton key capable of unlocking orbital vault bulkheads.",
        tags=["Chrono-Key", "Orbital Vault"],
    )
    world = temp_repo.get_world(world_id)
    start_loc = next(loc for loc in world.locations if loc.is_starting_location)

    kira = _make_npc(
        temp_repo,
        "Kira Hygiene",
        world.id,
        equipped=[
            ItemInstance(
                name="Patched Flight Jacket",
                note="Scorched along the left sleeve during the Ceres mutiny.",
                flags=["permanent"],
            )
        ],
        inventory=[
            ItemInstance(
                name="Tarnished Silver Locket",
                note="Secret heirloom from mother Elena containing orbital coordinates.",
                flags=["permanent"],
            ),
            ItemInstance(
                name="Brass Cylinder",
                note="Stolen from the syndicate courier.",
                flags=["artifact"],
                lore_id=art_id,
            ),
        ],
    )
    viktor = _make_npc(temp_repo, "Viktor Witness", world.id)

    camp = temp_repo.create_campaign(
        name="Context Hygiene Test",
        world_id=world.id,
        character_id=kira.id,
        character_ids=[kira.id, viktor.id],
        character_locations={kira.id: start_loc.id, viktor.id: start_loc.id},
    )
    b0 = temp_repo.get_campaign_state_bundle(camp.id)
    t0 = b0.active_branch_turns[-1]

    # Case A: Unrelated turn ("Pour me a synth-whiskey") -> ZERO item_lore injected even though Jacket is equipped!
    ctx_unrelated = await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=[t0],
        pre_turn=PreTurnAnalysis(
            active_speaker_id=kira.id,
            mentioned_entities=[],
            memory_search_queries=["synth-whiskey"],
        ),
        user_message="Pour me a synth-whiskey.",
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
        episodic_chunks=[],
        working_memory_turns=4,
    )
    assert not any(m.source_type == "item_lore" for m in ctx_unrelated.per_character_recalled_items[kira.id])
    assert not any(m.source_type == "item_lore" for m in ctx_unrelated.per_character_recalled_items[viktor.id])

    # Case B: Mentioning "locket" triggers Kira's private note ONLY for Kira (NOT Viktor!)
    ctx_locket = await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=[t0],
        pre_turn=PreTurnAnalysis(
            active_speaker_id=kira.id,
            mentioned_entities=["locket"],
            memory_search_queries=["silver locket"],
        ),
        user_message="What is inside that locket?",
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
        episodic_chunks=[],
        working_memory_turns=4,
    )
    kira_item_lore = [m for m in ctx_locket.per_character_recalled_items[kira.id] if m.source_type == "item_lore"]
    viktor_item_lore = [m for m in ctx_locket.per_character_recalled_items[viktor.id] if m.source_type == "item_lore"]
    assert len(kira_item_lore) == 1
    assert "mother Elena" in kira_item_lore[0].content
    assert viktor_item_lore == []

    # Case C: Mentioning "Chrono-Key" (or "Brass Cylinder") triggers World Artifact in shared_scene_items WITHOUT duplicate RAG entry!
    ctx_art = await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=[t0],
        pre_turn=PreTurnAnalysis(
            active_speaker_id=kira.id,
            mentioned_entities=["Chrono-Key"],
            memory_search_queries=["Astral Chrono-Key orbital vault"],
        ),
        user_message="Show me the Brass Cylinder — is that the Chrono-Key?",
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
        episodic_chunks=[],
        working_memory_turns=4,
    )
    art_matches = [m for m in ctx_art.shared_scene_items if m.id == art_id]
    assert len(art_matches) == 1  # Deduplicated!
    assert "Brass Cylinder" in art_matches[0].title

    # Case D: Zone 3 suppression — once Kira's Turn 1 prose reveals the locket's secret, Turn 2 does NOT re-inject it!
    t1 = temp_repo.save_turn_node(
        turn_id="turn_hyg_1",
        campaign_id=camp.id,
        parent_turn_id=t0.id,
        depth_index=1,
        user_message="What is inside that locket?",
        actor_id=kira.id,
        raw_prose=(
            '*Kira opens the tarnished silver locket.* "It is a secret heirloom from my mother Elena, '
            'containing the old orbital coordinates."'
        ),
        cognition=CognitionBlock(feeling="Solemn", valence=0.0, arousal=0.4),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=t0.world_snapshot.model_copy(update={"turn_id": "turn_hyg_1"}),
        character_state=b0.character_states[kira.id].model_copy(update={"turn_id": "turn_hyg_1"}),
        extra_character_states=[b0.character_states[viktor.id].model_copy(update={"turn_id": "turn_hyg_1"})],
        recalled_items=[],
    )
    ctx_suppressed = await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=[t0, t1],
        pre_turn=PreTurnAnalysis(
            active_speaker_id=kira.id,
            mentioned_entities=["locket"],
            memory_search_queries=["silver locket"],
        ),
        user_message="Look closer at the locket.",
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
        episodic_chunks=[],
        working_memory_turns=4,
    )
    assert [
        m for m in ctx_suppressed.per_character_recalled_items[kira.id] if m.source_type == "item_lore"
    ] == []

    # Case E: Once Turn 1 scrolls out of Zone 3 (working_memory_turns=1 after Turn 2), mentioning "locket" re-injects!
    t2 = temp_repo.save_turn_node(
        turn_id="turn_hyg_2",
        campaign_id=camp.id,
        parent_turn_id=t1.id,
        depth_index=2,
        user_message="Let's check the bar.",
        actor_id=kira.id,
        raw_prose='*Kira wipes down the neon counter and checks the rain outside.*',
        cognition=CognitionBlock(feeling="Calm", valence=0.0, arousal=0.3),
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        world_snapshot=t1.world_snapshot.model_copy(update={"turn_id": "turn_hyg_2"}),
        character_state=t1.character_states[kira.id].model_copy(update={"turn_id": "turn_hyg_2"}),
        extra_character_states=[t1.character_states[viktor.id].model_copy(update={"turn_id": "turn_hyg_2"})],
        recalled_items=[],
    )
    ctx_reinjected = await resolve_phase2_turn_context(
        repo=temp_repo,
        campaign_id=camp.id,
        world=world,
        branch_turns=[t0, t1, t2],
        pre_turn=PreTurnAnalysis(
            active_speaker_id=kira.id,
            mentioned_entities=["locket"],
            memory_search_queries=["silver locket"],
        ),
        user_message="Remind me about that locket.",
        active_location=start_loc,
        neighbors=[],
        present_characters=[kira, viktor],
        character_name_map={kira.id: kira.name, viktor.id: viktor.name},
        episodic_chunks=[],
        working_memory_turns=1,  # Only t2 is in Zone 3; t1 has rolled out!
    )
    reinjected = [
        m for m in ctx_reinjected.per_character_recalled_items[kira.id] if m.source_type == "item_lore"
    ]
    assert len(reinjected) == 1
    assert "mother Elena" in reinjected[0].content
