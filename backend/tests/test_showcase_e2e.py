"""Real-asset end-to-end tests exercising The Green Lie & Yulia Halim showcase bundles."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.phase2_context import (
    build_zone1_static_system_prompt,
    build_zone4_ephemeral_tail_frame,
    resolve_phase2_turn_context,
)
from app.main import _execute_turn_stream_events
from app.schemas.import_export import ImportCommitRequest
from app.schemas.turn import MechanicsTrigger, PreTurnAnalysis, TurnSubmitRequest
from app.services.import_export_service import commit_staged_import, inspect_uploaded_file


def _register_showcase_user(
    client: TestClient,
    *,
    username: str,
    setup_admin: bool = True,
) -> tuple[dict[str, str], str]:
    """Create a fresh account via auth API so per-user showcase seeding runs."""
    if setup_admin:
        res = client.post(
            "/api/auth/setup",
            json={"username": username, "password": "Password123!"},
        )
    else:
        res = client.post(
            "/api/auth/register",
            json={"username": username, "password": "Password123!"},
        )
    assert res.status_code == 200, res.text
    payload = res.json()
    headers = {"Authorization": f"Bearer {payload['token']}"}
    client.cookies.clear()
    return headers, str(payload["user"]["id"])


def test_showcase_zero_campaign_and_start_focus_launches(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """E2E-1: Zero-campaign start, world- vs character-focused launch, arrival media & prompt hygiene."""
    client, repo, _media_dir = showcase_api_env
    headers, uid = _register_showcase_user(client, username="e2e_launch_admin", setup_admin=True)

    # Freshly seeded user has 0 campaigns and 1 private clone each of The Green Lie & Yulia Halim
    assert client.get("/api/campaigns", headers=headers).json() == []
    worlds = client.get("/api/worlds", headers=headers).json()
    chars = client.get("/api/characters", headers=headers).json()
    assert len(worlds) == 1 and worlds[0]["name"] == "The Green Lie"
    assert len(chars) == 1 and chars[0]["name"] == "Yulia Halim"
    w_id, c_id = worlds[0]["id"], chars[0]["id"]

    # 1. World-focused launch -> Turn 0 uses __narrator__, Main Floor.starting_message & arrival media
    world_camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "Green Lie — World Focus",
            "world_id": w_id,
            "character_id": c_id,
            "start_focus": "world",
        },
    )
    assert world_camp_res.status_code == 200, world_camp_res.text
    w_bundle = world_camp_res.json()
    w_turn0 = w_bundle["active_branch_turns"][0]
    assert w_turn0["actor_id"] == "__narrator__"
    assert "Grey runoff hisses" in w_turn0["raw_prose"]
    assert w_bundle["active_location"]["name"] == "Main Floor"

    # First-visit arrival cards & media for Main Floor + parent containers (Neo-Veridia, Sector 9: The Drain)
    media_urls = [m["image_url"] for m in w_turn0["post_turn"]["first_visit_media"]]
    assert len(media_urls) >= 2
    for url in media_urls:
        assert client.get(url, headers=headers).status_code == 200

    # 2. Character-focused launch -> Turn 0 uses Yulia Halim's initial_message and excludes unsupported_fields
    char_camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "Green Lie — Character Focus",
            "world_id": w_id,
            "character_id": c_id,
            "start_focus": "character",
        },
    )
    assert char_camp_res.status_code == 200, char_camp_res.text
    c_bundle = char_camp_res.json()
    c_turn0 = c_bundle["active_branch_turns"][0]
    assert c_turn0["actor_id"] == c_id
    assert "low_token_initial_message" in chars[0]["unsupported_fields"]
    assert "undisturbed passage through the Sluice" not in c_turn0["raw_prose"]

    zone1 = build_zone1_static_system_prompt(
        world=repo.get_world(w_id, owner_id=uid),
        character=repo.get_character(c_id, owner_id=uid),
    )
    assert "undisturbed passage through the Sluice" not in zone1


async def test_showcase_nested_container_traversal_arrival_media_and_secret_lore_gating(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """E2E-2: Nested 4->3->1 traversal, arrival card/media suppression on revisit, and scoped secret lore."""
    client, repo, _media_dir = showcase_api_env
    headers, uid = _register_showcase_user(client, username="e2e_lore_admin", setup_admin=True)
    w_id = client.get("/api/worlds", headers=headers).json()[0]["id"]
    c_id = client.get("/api/characters", headers=headers).json()[0]["id"]

    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "Green Lie — Traversal",
            "world_id": w_id,
            "character_id": c_id,
            "start_focus": "world",
        },
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]
    world = repo.get_world(w_id, owner_id=uid)

    main_floor = next(loc for loc in world.locations if loc.name == "Main Floor")
    chop_cathedral = next(loc for loc in world.locations if loc.name == "The Chop-Cathedral")
    mid_web = next(loc for loc in world.locations if loc.name == "The Mid-Web")

    # 1. At Main Floor, secret lore belonging to The Caissons / Chop-Cathedral / Unit 4B-12 MUST stay gated out
    bundle0 = repo.get_campaign_state_bundle(camp_id, owner_id=uid)
    kira = bundle0.character_records[c_id]
    probe_pre = PreTurnAnalysis(
        user_sentiment="curious",
        subtext_interpretation="Asking about hidden rumors.",
        mechanics_check=MechanicsTrigger(requires_roll=False),
        active_speaker_id=c_id,
        speaker_order=[c_id],
    )
    ctx_main = await resolve_phase2_turn_context(
        repo=repo,
        campaign_id=camp_id,
        world=world,
        branch_turns=bundle0.active_branch_turns,
        pre_turn=probe_pre,
        user_message="Tell me about Mei's noodle stall canisters, rust-splicers weapons raid, and the ghost signal cutout.",
        active_location=main_floor,
        neighbors=bundle0.neighbor_locations,
        present_characters=[kira],
        character_name_map={c_id: kira.name},
        episodic_chunks=[],
    )
    zone4_main = build_zone4_ephemeral_tail_frame(
        world=world,
        character=kira,
        active_location=main_floor,
        neighbors=bundle0.neighbor_locations,
        recalled_items=ctx_main.shared_scene_items + ctx_main.per_character_recalled_items.get(c_id, []),
        pre_turn=probe_pre,
        user_message="Tell me about Mei's noodle stall canisters, rust-splicers weapons raid, and the ghost signal cutout.",
        world_snapshot=bundle0.current_world_snapshot,
        character_state=bundle0.current_character_state,
    )
    assert "Neo-Veridia > Sector 9: The Drain > The Neon Rust" in zone4_main
    assert "The Noodle-Stall Scrub" not in zone4_main
    assert "Arming the Rust-Splicers" not in zone4_main
    assert "Ghost Signal Location" not in zone4_main

    # Secret lore must never be indexed into vector_entries for global RAG
    conn = repo._connect()
    try:
        secret_vec_rows = conn.execute(
            """
            SELECT ve.id FROM vector_entries ve
            JOIN lore_nodes ln ON ve.id = 'lore_' || ln.id
            WHERE ln.world_id = ? AND ln.category = 'secret'
            """,
            (w_id,),
        ).fetchall()
        assert secret_vec_rows == []
    finally:
        conn.close()

    # 2. Move from Main Floor -> The Chop-Cathedral (leaves depth-1 The Neon Rust into depth-3 Sector 9: The Drain)
    move_chop = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        headers=headers,
        json={"location_id": chop_cathedral.id},
    )
    assert move_chop.status_code == 200, move_chop.text
    chop_bundle = move_chop.json()
    assert chop_bundle["active_location"]["id"] == chop_cathedral.id
    arrival_chop = chop_bundle["active_branch_turns"][-1]
    assert arrival_chop["actor_id"] == "__arrival__"
    assert any(card["title"] == "The Chop-Cathedral" for card in arrival_chop["post_turn"]["first_visit_cards"])

    # Inside The Chop-Cathedral with matching secret cues -> Arming the Rust-Splicers unlocks, others stay gated
    zone4_chop = build_zone4_ephemeral_tail_frame(
        world=world,
        character=kira,
        active_location=chop_cathedral,
        neighbors=[],
        recalled_items=[],
        pre_turn=probe_pre,
        user_message="I eavesdrop on the rust-splicers whisper about the weapons raid.",
        world_snapshot=repo.get_campaign_state_bundle(camp_id, owner_id=uid).current_world_snapshot,
        character_state=repo.get_campaign_state_bundle(camp_id, owner_id=uid).current_character_state,
        origin_location_id=main_floor.id,
    )
    assert "Arming the Rust-Splicers" in zone4_chop
    assert "The Noodle-Stall Scrub" not in zone4_chop
    assert "Ghost Signal Location" not in zone4_chop
    assert "<narrative_exit_cue>You step out of The Neon Rust into The Chop-Cathedral.</narrative_exit_cue>" in zone4_chop

    # 3. Return to Main Floor (revisit -> no new __arrival__ turn), then move to The Mid-Web inside The Caissons
    turns_before_revisit = len(repo.get_campaign_state_bundle(camp_id, owner_id=uid).active_branch_turns)
    revisit_res = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        headers=headers,
        json={"location_id": main_floor.id},
    )
    assert revisit_res.status_code == 200
    assert len(revisit_res.json()["active_branch_turns"]) == turns_before_revisit

    move_mid_web = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        headers=headers,
        json={"location_id": mid_web.id},
    )
    assert move_mid_web.status_code == 200
    mid_bundle = move_mid_web.json()
    assert any(
        card["title"] == "The Caissons"
        for card in mid_bundle["active_branch_turns"][-1]["post_turn"]["first_visit_cards"]
    )

    # Inside The Caissons with matching secret cues -> container secret 'The Noodle-Stall Scrub' unlocks
    zone4_caissons = build_zone4_ephemeral_tail_frame(
        world=world,
        character=kira,
        active_location=mid_web,
        neighbors=[],
        recalled_items=[],
        pre_turn=probe_pre,
        user_message="Ask Mei at the noodle stall about the stims canisters job and credits from Chop-Cathedral.",
        world_snapshot=repo.get_campaign_state_bundle(camp_id, owner_id=uid).current_world_snapshot,
        character_state=repo.get_campaign_state_bundle(camp_id, owner_id=uid).current_character_state,
        origin_location_id=main_floor.id,
    )
    assert "Neo-Veridia > Sector 9: The Drain > The Caissons" in zone4_caissons
    assert "The Noodle-Stall Scrub" in zone4_caissons
    assert "Arming the Rust-Splicers" not in zone4_caissons


async def test_showcase_paranoiac_care_items_and_branch_rollback(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """E2E-3: Paranoiac CARE evolution, permanent/artifact items, and branch rewind isolation."""
    client, repo, _media_dir = showcase_api_env
    headers, uid = _register_showcase_user(client, username="e2e_care_admin", setup_admin=True)
    w_id = client.get("/api/worlds", headers=headers).json()[0]["id"]
    c_id = client.get("/api/characters", headers=headers).json()[0]["id"]

    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "Green Lie — CARE & Items",
            "world_id": w_id,
            "character_id": c_id,
            "start_focus": "character",
        },
    )
    assert camp_res.status_code == 200
    bundle0 = camp_res.json()
    camp_id = bundle0["campaign"]["id"]
    turn0_id = bundle0["campaign"]["active_leaf_turn_id"]

    # Turn 0 has Yulia's paranoiac baseline CARE state
    assert bundle0["character_records"][c_id]["baseline_psyche"]["temperament"]["archetype"] == "paranoiac"
    care0 = bundle0["current_character_state"]["care_state"]
    assert care0 is not None
    assert care0["active_worldview"]["benevolence"] == pytest.approx(-0.8)

    # Run Turn 1 referencing her artifact item ('Encrypted burner slate' -> 'The Sovereign Cipher')
    events_t1 = [
        pkt
        async for pkt in _execute_turn_stream_events(
            campaign_id=camp_id,
            req=TurnSubmitRequest(
                user_message="Show me what is on the Encrypted burner slate about the Sovereign Cipher."
            ),
            owner_id=uid,
        )
    ]
    turn1_saved = next(e["data"] for e in events_t1 if e["event"] == "turn_saved")
    turn1_id = turn1_saved["id"]
    assert turn1_saved["character_state"]["care_state"]["state_elapsed_minutes"] >= 0

    # Artifact lore 'The Sovereign Cipher' must be conditionally recalled in Phase 2 when burner slate is carried
    bundle1 = repo.get_campaign_state_bundle(camp_id, owner_id=uid)
    world = repo.get_world(w_id, owner_id=uid)
    kira = bundle1.character_records[c_id]
    pre_item = PreTurnAnalysis(
        user_sentiment="tense",
        subtext_interpretation="Inspecting the encrypted burner slate.",
        mechanics_check=MechanicsTrigger(requires_roll=False),
        active_speaker_id=c_id,
        speaker_order=[c_id],
    )
    ctx_item = await resolve_phase2_turn_context(
        repo=repo,
        campaign_id=camp_id,
        world=world,
        branch_turns=bundle1.active_branch_turns,
        pre_turn=pre_item,
        user_message="Inspect the Encrypted burner slate and Sovereign Cipher.",
        active_location=bundle1.active_location,
        neighbors=bundle1.neighbor_locations,
        present_characters=[kira],
        character_name_map={c_id: kira.name},
        episodic_chunks=[],
    )
    recalled_for_kira = ctx_item.shared_scene_items + ctx_item.per_character_recalled_items.get(c_id, [])
    assert any(
        "Sovereign Cipher" in item.title
        for item in recalled_for_kira
    )

    # Permanent item ('Subdermal shard') resists Clerk / inventory delta removal
    from app.engine.character_agent import apply_character_inventory_delta
    from app.schemas.turn import CharacterAgentDelta

    updated_eq, _updated_inv = apply_character_inventory_delta(
        existing_equipped=bundle1.current_character_state.equipped,
        existing_inventory=bundle1.current_character_state.inventory,
        delta=CharacterAgentDelta(items_removed=["Subdermal shard"]),
    )
    assert any(it.name == "Subdermal shard" for it in updated_eq)

    # Branch from Turn 0 -> creates sibling branch, then rewind back to Turn 1 cleanly
    events_alt = [
        pkt
        async for pkt in _execute_turn_stream_events(
            campaign_id=camp_id,
            req=TurnSubmitRequest(
                user_message="Stay quiet and watch the rain from the door.",
                parent_turn_id=turn0_id,
            ),
            owner_id=uid,
        )
    ]
    alt_turn_id = next(e["data"] for e in events_alt if e["event"] == "turn_saved")["id"]
    assert alt_turn_id != turn1_id

    rewound = repo.checkout_turn_branch(camp_id, turn1_id, owner_id=uid)
    assert rewound.campaign.active_leaf_turn_id == turn1_id

    # Base seeded entities remain unmodified (seed_modified == 0)
    conn = repo._connect()
    try:
        w_mod = conn.execute("SELECT seed_modified FROM worlds WHERE id = ?", (w_id,)).fetchone()["seed_modified"]
        c_mod = conn.execute("SELECT seed_modified FROM characters WHERE id = ?", (c_id,)).fetchone()["seed_modified"]
        assert w_mod == 0 and c_mod == 0
    finally:
        conn.close()


async def test_showcase_zcc_roundtrip_into_playable_campaign(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """E2E-4: Export User A's seeded showcase bundle, import into User B, and play Turn 1."""
    client, repo, _media_dir = showcase_api_env
    headers_a, _uid_a = _register_showcase_user(client, username="e2e_exporter", setup_admin=True)
    client.cookies.clear()

    # Enable registration so User B can self-register
    settings.allow_self_registration = True
    headers_b, uid_b = _register_showcase_user(client, username="e2e_importer", setup_admin=False)

    w_a = client.get("/api/worlds", headers=headers_a).json()[0]
    c_a = client.get("/api/characters", headers=headers_a).json()[0]

    export_res = client.post(
        "/api/export/bundle",
        headers=headers_a,
        json={
            "bundle_name": "green_lie_showcase",
            "world_ids": [w_a["id"]],
            "character_ids": [c_a["id"]],
            "include_world_media": True,
        },
    )
    assert export_res.status_code == 200
    zcc_bytes = export_res.content

    preview = inspect_uploaded_file(repo, zcc_bytes, "green_lie_showcase.zcc", user_id=uid_b)
    assert preview.is_native is True
    assert preview.staged_token
    commit_res = await commit_staged_import(
        repo,
        ImportCommitRequest(staged_token=preview.staged_token, conflict_strategy="copy"),
        user_id=uid_b,
    )
    assert commit_res.success is True

    worlds_b = client.get("/api/worlds", headers=headers_b).json()
    chars_b = client.get("/api/characters", headers=headers_b).json()
    imp_world = next(w for w in worlds_b if "(Imported)" in w["name"])
    imp_char = next(c for c in chars_b if "(Imported)" in c["name"])

    assert len(imp_world["locations"]) == 35
    assert len(imp_world["edges"]) == 88
    assert len(imp_world["containers"]) == 13
    assert len(imp_world["lore_nodes"]) == 14
    assert len(imp_world["media"]) == 3
    assert "low_token_initial_message" in imp_char["unsupported_fields"]
    assert imp_char["world_id"] == imp_world["id"]

    burner = next(it for it in imp_char["inventory"] if it["name"] == "Encrypted burner slate")
    sovereign = next(ln for ln in imp_world["lore_nodes"] if ln["title"] == "The Sovereign Cipher")
    assert burner["lore_id"] == sovereign["id"]

    # Launch a playable campaign and execute Turn 1 on User B's imported copy
    camp_res = client.post(
        "/api/campaigns",
        headers=headers_b,
        json={
            "name": "Imported Showcase Play",
            "world_id": imp_world["id"],
            "character_id": imp_char["id"],
            "start_focus": "world",
        },
    )
    assert camp_res.status_code == 200, camp_res.text
    camp_id = camp_res.json()["campaign"]["id"]
    events = [
        pkt
        async for pkt in _execute_turn_stream_events(
            campaign_id=camp_id,
            req=TurnSubmitRequest(user_message="Look around the Main Floor and greet Yulia."),
            owner_id=uid_b,
        )
    ]
    assert any(e["event"] == "turn_saved" for e in events)
