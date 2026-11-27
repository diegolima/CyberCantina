"""Comprehensive tests for v0.16.0 Default Showcase Seeding, Public Media, Quotas, CoW, and Profile Restore."""

from __future__ import annotations

import io
import json
import os
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.db.repos.arrival_descriptions import build_first_visit_arrival_bundle
from app.db.repository import CantinaRepository
from app.db.seed import (
    SHOWCASE_CHARACTER_SEED_KEY,
    SHOWCASE_SEED_VERSION,
    SHOWCASE_WORLD_SEED_KEY,
    ensure_public_showcase_media,
)
from app.engine.phase2_context import build_zone1_static_system_prompt
from app.housekeeping.purge_inactive import ORPHAN_MEDIA_GRACE_SECONDS, _sweep_orphan_media_dirs
from app.schemas.character import CharacterUpdatePayload
from app.schemas.import_export import ImportCommitRequest
from app.schemas.world import WorldUpdatePayload
from app.services.import_export_service import (
    build_zcc_export,
    commit_staged_import,
    inspect_uploaded_file,
)


def _make_png_bytes(width: int = 64, height: int = 64, color: tuple[int, int, int] = (40, 180, 120)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color)
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def showcase_env(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, CantinaRepository, Path]:
    monkeypatch.setattr(settings, "allow_self_registration", True)
    return showcase_api_env


def test_per_user_showcase_seeding_and_full_field_validation(
    showcase_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """Verify initial_setup, register, and admin_create_user seed The Green Lie + Yulia Halim with 0 campaigns."""
    client, repo, media_dir = showcase_env

    # 1. Admin setup
    admin_res = client.post(
        "/api/auth/setup",
        json={"username": "admin_one", "password": "AdminPassword123!"},
    )
    assert admin_res.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_res.json()['token']}"}
    assert admin_res.json()["user"]["media_bytes_used"] == 0

    # 2. Self-registered standard user
    client.cookies.clear()
    reg_res = client.post(
        "/api/auth/register",
        json={"username": "player_reg", "password": "PlayerPassword123!"},
    )
    assert reg_res.status_code == 200
    reg_headers = {"Authorization": f"Bearer {reg_res.json()['token']}"}
    assert reg_res.json()["user"]["media_bytes_used"] == 0

    # 3. Admin-created standard user
    adm_create_res = client.post(
        "/api/admin/users",
        headers=admin_headers,
        json={"username": "player_adm", "password": "PlayerPassword123!", "role": "user"},
    )
    assert adm_create_res.status_code == 200
    adm_login = client.post(
        "/api/auth/login",
        json={"username": "player_adm", "password": "PlayerPassword123!"},
    )
    assert adm_login.status_code == 200
    adm_created_headers = {"Authorization": f"Bearer {adm_login.json()['token']}"}

    # Verify all three users have private clones, 0 campaigns, and 0 legacy Neon Rust entities
    seen_world_ids: set[str] = set()
    seen_char_ids: set[str] = set()
    for headers in (admin_headers, reg_headers, adm_created_headers):
        worlds = client.get("/api/worlds", headers=headers).json()
        chars = client.get("/api/characters", headers=headers).json()
        camps = client.get("/api/campaigns", headers=headers).json()
        assert len(worlds) == 1
        assert len(chars) == 1
        assert len(camps) == 0
        w = worlds[0]
        c = chars[0]
        assert w["name"] == "The Green Lie"
        assert c["name"] == "Yulia Halim"
        assert w["id"].startswith("world_")
        assert c["id"].startswith("char_")
        seen_world_ids.add(w["id"])
        seen_char_ids.add(c["id"])

    assert len(seen_world_ids) == 3
    assert len(seen_char_ids) == 3

    # Deep field validation on player_reg's seeded world & character
    w = client.get("/api/worlds", headers=reg_headers).json()[0]
    c = client.get("/api/characters", headers=reg_headers).json()[0]

    assert w["global_rules"]["genre"] == "Eco-Dystopian Cyberpunk / Biopunk Brutalism"
    assert w["global_rules"]["starting_timestamp"] == "2144-05-12 22:30"
    assert w["global_rules"]["describe_on_first_visit"] is True
    assert len(w["containers"]) == 13
    assert {ct["depth"] for ct in w["containers"]} == {1, 3, 4}
    assert len(w["locations"]) == 37
    assert len(w["edges"]) == 88
    assert len(w["lore_nodes"]) == 15
    assert any(
        ln["title"] == "Aegis Security Patrols" and ln["category"] == "threat"
        for ln in w["lore_nodes"]
    )
    assert len(w["media"]) == 3
    assert all(m["is_public"] is True for m in w["media"])

    # Verify modern spatial features preserved by seed.py: anchors, props, verticality, and rich link metadata
    locs_by_name = {loc["name"]: loc for loc in w["locations"]}
    assert locs_by_name["Tunnel 1-O"]["anchor_location_id"] == locs_by_name["Drowned Reliquary"]["id"]
    assert locs_by_name["Tunnel 2-O"]["anchor_location_id"] == locs_by_name["The Pillory"]["id"]
    assert locs_by_name["Tunnel 3-L"]["anchor_location_id"] == locs_by_name["The Mid-Web"]["id"]
    assert locs_by_name["Tunnel 1-N"]["is_entry_exit"] is False

    reliquary_props = locs_by_name["Drowned Reliquary"]["props"]
    assert len(reliquary_props) == 1
    assert reliquary_props[0]["name"] == "Encrypted Ghost Signal Data Slate"
    assert reliquary_props[0]["is_hidden"] is True

    cage_props = locs_by_name["The Cage-Walk"]["props"]
    assert len(cage_props) == 1
    assert cage_props[0]["name"] == "Old Pistol"
    assert cage_props[0]["is_hidden"] is False

    vertical_edges = [e for e in w["edges"] if e.get("is_vertical")]
    assert len(vertical_edges) == 22
    edge_by_names = {
        (
            next(l["name"] for l in w["locations"] if l["id"] == e["from_location_id"]),
            next(l["name"] for l in w["locations"] if l["id"] == e["to_location_id"]),
        ): e
        for e in w["edges"]
    }
    assert edge_by_names[("The Oculus Concourse", "Aetheris Terminal")]["travel_mode"] == "Maglev"
    assert edge_by_names[("The Oculus Concourse", "Aetheris Terminal")]["speed_modifier"] == pytest.approx(25.0)
    assert edge_by_names[("The Iron Yard", "Terminus Plaza")]["is_secret"] is True
    assert edge_by_names[("Tunnel 2-L", "Tunnel 3-L")]["obstacles"] == ["false wall"]
    assert edge_by_names[("Tunnel 4-M", "The Sluice")]["is_blocked"] is True
    assert edge_by_names[("Tunnel 4-M", "The Sluice")]["obstacles"] == ["Sealed Doors"]

    main_floor = next(loc for loc in w["locations"] if loc["name"] == "Main Floor")
    assert main_floor["is_starting_location"] is True
    assert "Grey runoff hisses" in main_floor["starting_message"]
    assert main_floor["image_media_id"] is not None
    assert main_floor["image_url"].startswith("/api/media/worlds/images/pub_v2_")

    # Neo-Veridia primary world visual carries the built-in linked showcase video
    neo_media = next(m for m in w["media"] if m["label"] == "Neo-Veridia")
    assert neo_media["id"] == "pub_v2_wmed_28416ce9b1"
    assert neo_media["video_asset_id"] == "pub_v2_vid_neo_veridia"
    assert neo_media["video_url"] == "/api/media/assets/pub_v2_vid_neo_veridia"
    assert neo_media["video_mime_type"] == "video/mp4"
    assert neo_media["video_byte_size"] == 1948665
    neo_container = next(ct for ct in w["containers"] if ct["name"] == "Neo-Veridia")
    assert neo_container["video_url"] == "/api/media/assets/pub_v2_vid_neo_veridia"
    assert neo_container["video_mime_type"] == "video/mp4"

    # Check container- and location-scoped lore nodes including secret gating
    caissons = next(ct for ct in w["containers"] if ct["name"] == "The Caissons")
    assert [ln["title"] for ln in caissons["lore_nodes"]] == ["The Noodle-Stall Scrub"]
    assert caissons["lore_nodes"][0]["category"] == "secret"

    unit_4b = next(loc for loc in w["locations"] if loc["name"] == "Unit 4B-12")
    assert unit_4b["lore_nodes"][0]["title"] == "Ghost Signal Location"
    assert unit_4b["lore_nodes"][0]["category"] == "secret"
    assert "Yulia Halim" in unit_4b["lore_nodes"][0]["content"]

    chop = next(loc for loc in w["locations"] if loc["name"] == "The Chop-Cathedral")
    assert chop["lore_nodes"][0]["title"] == "Arming the Rust-Splicers"
    assert chop["lore_nodes"][0]["category"] == "secret"

    # Character fields + intentional unsupported_fields + linked artifact lore + CARE temperament
    assert c["world_id"] == w["id"]
    assert c["age"] == "34"
    assert c["build_and_height"] == "170 cm"
    assert c["baseline_psyche"]["temperament"]["archetype"] == "paranoiac"
    assert c["baseline_psyche"]["initial_worldview"]["benevolence"] == pytest.approx(-0.8)
    assert len(c["memory_shards"]) == 8
    assert len(c["voice_anchors"]) == 3
    assert "Yulia Halim" in c["gallery"][0]["caption"]
    assert "low_token_initial_message" in c["unsupported_fields"]
    assert "Sluice" in c["unsupported_fields"]["low_token_initial_message"]

    subdermal = next(it for it in c["equipped"] if it["name"] == "Subdermal shard")
    assert "permanent" in subdermal["flags"]
    burner = next(it for it in c["inventory"] if it["name"] == "Encrypted burner slate")
    assert "artifact" in burner["flags"]
    sovereign_lore = next(ln for ln in w["lore_nodes"] if ln["title"] == "The Sovereign Cipher")
    assert burner["lore_id"] == sovereign_lore["id"]

    # Public media URLs (including linked Neo-Veridia video with Range support) serve cleanly and are excluded from user media quota
    portrait_url = c["portraits"]["default"]
    gallery_url = c["gallery"][0]["url"]
    assert portrait_url.startswith("/api/media/public/v2/characters/kira_vance/portraits/")
    assert gallery_url.startswith("/api/media/public/v2/characters/kira_vance/gallery/")
    assert client.get(portrait_url, headers=reg_headers).status_code == 200
    assert client.get(gallery_url, headers=reg_headers).status_code == 200
    assert client.get(w["media"][0]["url"], headers=reg_headers).status_code == 200
    vid_res = client.get(neo_media["video_url"], headers=reg_headers)
    assert vid_res.status_code == 200
    assert vid_res.headers.get("content-type", "").startswith("video/mp4")
    vid_range_res = client.get(
        neo_media["video_url"],
        headers={**reg_headers, "Range": "bytes=0-1023"},
    )
    assert vid_range_res.status_code == 206
    assert len(vid_range_res.content) == 1024
    assert client.get("/api/profile", headers=reg_headers).json()["media_bytes_used"] == 0
    assert not (media_dir / "characters" / c["id"]).exists()

    # Provenance DB columns
    conn = repo._connect()
    try:
        w_row = conn.execute("SELECT seed_key, seed_version, seed_modified FROM worlds WHERE id = ?", (w["id"],)).fetchone()
        c_row = conn.execute("SELECT seed_key, seed_version, seed_modified FROM characters WHERE id = ?", (c["id"],)).fetchone()
        assert (w_row["seed_key"], w_row["seed_version"], w_row["seed_modified"]) == (
            SHOWCASE_WORLD_SEED_KEY,
            SHOWCASE_SEED_VERSION,
            0,
        )
        assert (c_row["seed_key"], c_row["seed_version"], c_row["seed_modified"]) == (
            SHOWCASE_CHARACTER_SEED_KEY,
            SHOWCASE_SEED_VERSION,
            0,
        )
    finally:
        conn.close()

    # Starting a campaign with Kira verifies unsupported_fields are excluded from AI context and Turn-1 arrival includes Neo-Veridia's linked video
    camp_res = client.post(
        "/api/campaigns",
        headers=reg_headers,
        json={"name": "Green Lie Run", "world_id": w["id"], "character_id": c["id"]},
    )
    assert camp_res.status_code == 200
    loaded_world = repo.get_world(w["id"])
    bundle = repo.get_campaign_state_bundle(camp_res.json()["campaign"]["id"])
    z1_prompt = build_zone1_static_system_prompt(
        world=loaded_world,
        character=bundle.character_records[c["id"]],
    )
    assert "undisturbed passage through the Sluice" not in z1_prompt

    start_loc = next(loc for loc in loaded_world.locations if loc.is_starting_location)
    _cards, arrival_media, _m_locs, _m_conts = build_first_visit_arrival_bundle(
        target_location=start_loc,
        containers=loaded_world.containers,
        locations=loaded_world.locations,
        prev_visited_locations=[],
        prev_visited_containers=[],
        describe_on_first_visit=True,
    )
    neo_arrival = next(item for item in arrival_media if item.media_id == "pub_v2_wmed_28416ce9b1")
    assert neo_arrival.video_url == "/api/media/assets/pub_v2_vid_neo_veridia"
    assert neo_arrival.video_mime_type == "video/mp4"

    # Built-in public image & linked video reject private video replacement and deletion
    repl_vid_res = client.post(
        f"/api/worlds/{w['id']}/media/videos",
        headers=reg_headers,
        files={"file": ("override.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4")},
        data={"linked_image_id": neo_media["id"]},
    )
    assert repl_vid_res.status_code == 400
    del_vid_res = client.delete(
        f"/api/worlds/{w['id']}/media/{neo_media['id']}/video",
        headers=reg_headers,
    )
    assert del_vid_res.status_code == 400
    with pytest.raises(ValueError, match="Built-in public video"):
        repo.delete_linked_video(neo_media["id"])


def test_public_media_quota_cow_and_cross_tenant_isolation(
    showcase_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """Editing, CoW-forking, adding/deleting media on User A leaves quota accurate and User B's public assets intact."""
    client, repo, media_dir = showcase_env

    assert client.post("/api/auth/setup", json={"username": "adm", "password": "Password123!"}).status_code == 200
    client.cookies.clear()

    res_a = client.post("/api/auth/register", json={"username": "alice", "password": "Password123!"})
    headers_a = {"Authorization": f"Bearer {res_a.json()['token']}"}
    uid_a = res_a.json()["user"]["id"]
    client.cookies.clear()

    res_b = client.post("/api/auth/register", json={"username": "bob", "password": "Password123!"})
    headers_b = {"Authorization": f"Bearer {res_b.json()['token']}"}
    client.cookies.clear()

    w_a = client.get("/api/worlds", headers=headers_a).json()[0]
    c_a = client.get("/api/characters", headers=headers_a).json()[0]
    w_b = client.get("/api/worlds", headers=headers_b).json()[0]
    c_b = client.get("/api/characters", headers=headers_b).json()[0]

    # Bob starts a campaign using his seeded world + character
    camp_b = client.post(
        "/api/campaigns",
        headers=headers_b,
        json={"name": "Bob Run", "world_id": w_b["id"], "character_id": c_b["id"]},
    )
    assert camp_b.status_code == 200

    # Alice starts a campaign too, then edits character & world -> CoW forks without duplicating public media or billing quota
    camp_a = client.post(
        "/api/campaigns",
        headers=headers_a,
        json={"name": "Alice Run", "world_id": w_a["id"], "character_id": c_a["id"]},
    )
    assert camp_a.status_code == 200

    # Cross-tenant impact isolation: Alice has 1 campaign, must NOT count Bob's campaign
    pub_wmed_id = w_a["media"][0]["id"]
    impact_a = client.get(f"/api/worlds/{w_a['id']}/media/{pub_wmed_id}/impact", headers=headers_a).json()
    assert impact_a["is_public"] is True
    assert impact_a["campaigns_using"] == 1

    # Alice renames a public world image label -> CoW forks Alice's world, keeps quota=0, leaves Bob's label intact
    rename_res = client.patch(
        f"/api/worlds/{w_a['id']}/media/{pub_wmed_id}",
        headers=headers_a,
        json={"label": "Alice Custom Canopy"},
    )
    assert rename_res.status_code == 200
    forked_w_a = rename_res.json()
    assert forked_w_a["id"] != w_a["id"]
    assert next(m["label"] for m in forked_w_a["media"] if m["id"] == pub_wmed_id) == "Alice Custom Canopy"
    w_b_after = client.get(f"/api/worlds/{w_b['id']}", headers=headers_b).json()
    assert next(m["label"] for m in w_b_after["media"] if m["id"] == pub_wmed_id) == "Neo-Veridia"
    assert client.get("/api/profile", headers=headers_a).json()["media_bytes_used"] == 0

    # Alice removes the public world image -> CoW-detached from Alice's world only; disk file & Bob's world untouched
    del_wm_res = client.delete(f"/api/worlds/{forked_w_a['id']}/media/{pub_wmed_id}", headers=headers_a)
    assert del_wm_res.status_code == 200
    assert len(del_wm_res.json()["media"]) == 2
    assert client.get(w_b["media"][0]["url"], headers=headers_b).status_code == 200

    # Alice uploads a private world image -> ONLY that new private file counts toward quota
    up_w_res = client.post(
        f"/api/worlds/{forked_w_a['id']}/media",
        headers=headers_a,
        files={"file": ("custom.png", _make_png_bytes(80, 60), "image/png")},
        data={"label": "Private Alley"},
    )
    assert up_w_res.status_code == 200
    priv_wmed = next(m for m in up_w_res.json()["media"] if m["label"] == "Private Alley")
    assert priv_wmed["is_public"] is False
    expected_world_bytes = priv_wmed["byte_size"]
    assert client.get("/api/profile", headers=headers_a).json()["media_bytes_used"] == expected_world_bytes

    # Alice CoW-edits Yulia Halim -> public portrait & gallery stay public (0 bytes), not copied into private dir
    c_upd = repo.update_character(
        c_a["id"],
        CharacterUpdatePayload(
            name="Yulia Halim (Alice Edit)",
            tagline=c_a["tagline"],
            core_persona=c_a["core_persona"],
            baseline_psyche=c_a["baseline_psyche"],
            world_id=forked_w_a["id"],
        ),
        owner_id=uid_a,
    )
    assert c_upd.id != c_a["id"]
    assert c_upd.portraits["default"] == c_a["portraits"]["default"]
    assert not (media_dir / "characters" / c_upd.id).exists()
    assert client.get("/api/profile", headers=headers_a).json()["media_bytes_used"] == expected_world_bytes

    # Alice uploads a private portrait over the public 'default' slot -> quota increases ONLY by the new portrait bytes,
    # and the shared public portrait stays intact on disk for Bob
    up_p_res = client.post(
        f"/api/characters/{c_upd.id}/portraits/default",
        headers=headers_a,
        files={"file": ("kira_custom.png", _make_png_bytes(96, 96, (200, 50, 80)), "image/png")},
    )
    assert up_p_res.status_code == 200
    c_after_p = up_p_res.json()
    assert c_after_p["portraits"]["default"].startswith("/api/media/assets/por_")
    used_after_p = client.get("/api/profile", headers=headers_a).json()["media_bytes_used"]
    assert used_after_p > expected_world_bytes
    assert client.get(c_b["portraits"]["default"], headers=headers_b).status_code == 200

    # Alice deletes her seeded gallery image -> public gallery file stays intact for Bob
    pub_gallery_id = c_after_p["gallery"][0]["id"]
    del_g_res = client.delete(f"/api/characters/{c_after_p['id']}/gallery/{pub_gallery_id}", headers=headers_a)
    assert del_g_res.status_code == 200
    assert del_g_res.json()["gallery"] == []
    assert client.get(c_b["gallery"][0]["url"], headers=headers_b).status_code == 200

    # Clearing all portraits via update_character persists (is not reverted by falsy fallback)
    cleared = repo.update_character(
        c_after_p["id"],
        CharacterUpdatePayload(
            name=c_after_p["name"],
            tagline=c_after_p["tagline"],
            core_persona=c_after_p["core_persona"],
            baseline_psyche=c_after_p["baseline_psyche"],
            world_id=forked_w_a["id"],
            portraits={},
            gallery=[],
        ),
        owner_id=uid_a,
    )
    assert cleared.portraits == {}
    assert cleared.gallery == []


def test_orphan_sweep_reset_data_and_zcc_roundtrip_preserve_public_media(
    showcase_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """Resetting/deleting users, pruning worlds, and Chloromancer orphan sweeps never delete public media; .zcc exports include them."""
    client, repo, media_dir = showcase_env
    assert client.post("/api/auth/setup", json={"username": "adm", "password": "Password123!"}).status_code == 200
    client.cookies.clear()

    res_u = client.post("/api/auth/register", json={"username": "zcc_user", "password": "Password123!"})
    headers_u = {"Authorization": f"Bearer {res_u.json()['token']}"}
    uid = res_u.json()["user"]["id"]

    w_u = client.get("/api/worlds", headers=headers_u).json()[0]
    c_u = client.get("/api/characters", headers=headers_u).json()[0]

    # Export seeded character & world to .zcc -> public media files are packaged into the ZIP (videos opt-in)
    zcc_bytes = build_zcc_export(
        repo,
        character_ids=[c_u["id"]],
        world_ids=[w_u["id"]],
        persona_ids=[],
        owner_id=uid,
        include_world_media=True,
        include_videos=False,
    )
    with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as zf:
        names = set(zf.namelist())
        assert any(n.endswith("default_0b97fa1a.webp") for n in names)
        assert any(n.endswith("img_59a7be04b1.webp") for n in names)
        assert any("pub_v2_wmed_" in n for n in names)
        assert not any(n.endswith(".mp4") for n in names)

    zcc_with_vid_bytes = build_zcc_export(
        repo,
        character_ids=[c_u["id"]],
        world_ids=[w_u["id"]],
        persona_ids=[],
        owner_id=uid,
        include_world_media=True,
        include_videos=True,
    )
    with zipfile.ZipFile(io.BytesIO(zcc_with_vid_bytes), "r") as zf:
        vid_names = set(zf.namelist())
        assert any(n.endswith("pub_v2_vid_neo_veridia.mp4") for n in vid_names)

    # Reset user data -> clears user's catalog, leaves public files & public media_assets rows intact
    assert (
        client.post(
            "/api/profile/reset-data",
            headers=headers_u,
            json={"current_password": "Password123!"},
        ).status_code
        == 200
    )
    assert client.get("/api/worlds", headers=headers_u).json() == []
    assert client.get("/api/characters", headers=headers_u).json() == []

    # Backdate public files and run admin purge + Chloromancer orphan sweep -> public images & linked video MUST survive
    pub_char_file = media_dir / "public" / "v2" / "characters" / "kira_vance" / "portraits" / "default_0b97fa1a.webp"
    pub_world_file = media_dir / "worlds" / "images" / "pub_v2_wmed_28416ce9b1.webp"
    pub_video_file = media_dir / "assets" / "videos" / "pub_v2_vid_neo_veridia.mp4"
    past = time.time() - (ORPHAN_MEDIA_GRACE_SECONDS + 3600)
    os.utime(pub_char_file, (past, past))
    os.utime(pub_world_file, (past, past))
    os.utime(pub_video_file, (past, past))
    purge_res = repo.execute_admin_media_purge(purge_images=True, purge_videos=True)
    assert purge_res["images_deleted"] == 0
    assert purge_res["videos_deleted"] == 0
    _sweep_orphan_media_dirs(repo)
    assert pub_char_file.is_file()
    assert pub_world_file.is_file()
    assert pub_video_file.is_file()

    # Importing a .zcc manually creates private entities (seed_key=NULL) so Profile Restore still detects missing defaults
    import asyncio

    preview = inspect_uploaded_file(repo, zcc_with_vid_bytes, "exported_vid.zcc", user_id=uid)
    assert preview.videos_count == 1
    commit_res = asyncio.run(
        commit_staged_import(
            repo,
            ImportCommitRequest(staged_token=preview.staged_token, import_videos=True),
            user_id=uid,
        )
    )
    assert commit_res.success is True
    imported_worlds = client.get("/api/worlds", headers=headers_u).json()
    assert imported_worlds[0]["media"][0]["video_url"] is not None
    restore_res = client.post("/api/profile/restore-defaults", headers=headers_u)
    assert restore_res.status_code == 200
    assert restore_res.json()["restored_world"] is True
    assert restore_res.json()["restored_character"] is True


def test_profile_restore_defaults_selective_and_non_destructive(
    showcase_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """Profile restore recreates only deleted defaults, preserves edits, and emits clear informational messages."""
    client, repo, _media_dir = showcase_env
    assert client.post("/api/auth/setup", json={"username": "adm", "password": "Password123!"}).status_code == 200
    client.cookies.clear()

    res_u = client.post("/api/auth/register", json={"username": "restorer", "password": "Password123!"})
    headers_u = {"Authorization": f"Bearer {res_u.json()['token']}"}
    uid = res_u.json()["user"]["id"]

    # 1. Both already exist -> nothing restored, informational message returned
    r1 = client.post("/api/profile/restore-defaults", headers=headers_u).json()
    assert r1["restored_world"] is False
    assert r1["restored_character"] is False
    assert r1["skipped_world"] is True
    assert r1["skipped_character"] is True
    assert "already exist" in r1["message"]

    # 2. User edits The Green Lie (removing 'The Sovereign Cipher' lore) and deletes Yulia Halim
    w_orig = client.get("/api/worlds", headers=headers_u).json()[0]
    c_orig = client.get("/api/characters", headers=headers_u).json()[0]
    edited_w = repo.update_world(
        w_orig["id"],
        WorldUpdatePayload(
            name="The Green Lie (My Remix)",
            global_rules=w_orig["global_rules"],
            containers=w_orig["containers"],
            locations=w_orig["locations"],
            edges=w_orig["edges"],
            lore_nodes=[ln for ln in w_orig["lore_nodes"] if ln["title"] != "The Sovereign Cipher"],
        ),
        owner_id=uid,
    )
    assert client.delete(f"/api/characters/{c_orig['id']}", headers=headers_u).status_code == 200

    # Restore -> restores ONLY Yulia Halim (linked to edited world, gracefully clearing missing artifact lore_id), skips world
    r2 = client.post("/api/profile/restore-defaults", headers=headers_u).json()
    assert r2["restored_world"] is False
    assert r2["restored_character"] is True
    assert r2["skipped_world"] is True
    assert r2["skipped_character"] is False
    assert "Restored default character 'Yulia Halim'" in r2["message"]
    assert "Skipped 'The Green Lie'" in r2["message"]

    worlds_after = client.get("/api/worlds", headers=headers_u).json()
    chars_after = client.get("/api/characters", headers=headers_u).json()
    assert len(worlds_after) == 1
    assert worlds_after[0]["name"] == "The Green Lie (My Remix)"
    assert len(chars_after) == 1
    assert chars_after[0]["world_id"] == edited_w.id
    burner = next(it for it in chars_after[0]["inventory"] if it["name"] == "Encrypted burner slate")
    assert burner["lore_id"] is None
    assert "artifact" not in burner["flags"]

    # 3. Delete world -> restore recreates ONLY The Green Lie
    assert client.delete(f"/api/worlds/{edited_w.id}", headers=headers_u).status_code == 200
    r3 = client.post("/api/profile/restore-defaults", headers=headers_u).json()
    assert r3["restored_world"] is True
    assert r3["restored_character"] is False
    assert r3["skipped_world"] is False
    assert r3["skipped_character"] is True
    assert "Restored default world 'The Green Lie'" in r3["message"]


def test_showcase_v1_to_v2_migration_upgrades_existing_entities(
    showcase_env: tuple[TestClient, CantinaRepository, Path],
) -> None:
    """Existing v1 showcase worlds, characters, versions, turn_nodes, and disk files upgrade cleanly to v2."""
    client, repo, media_dir = showcase_env
    assert client.post("/api/auth/setup", json={"username": "adm", "password": "Password123!"}).status_code == 200
    client.cookies.clear()

    res_u = client.post("/api/auth/register", json={"username": "v1_legacy_user", "password": "Password123!"})
    headers_u = {"Authorization": f"Bearer {res_u.json()['token']}"}
    uid = res_u.json()["user"]["id"]

    w = client.get("/api/worlds", headers=headers_u).json()[0]
    c = client.get("/api/characters", headers=headers_u).json()[0]
    camp_res = client.post(
        "/api/campaigns",
        headers=headers_u,
        json={"name": "Legacy v1 Run", "world_id": w["id"], "character_id": c["id"]},
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]
    neo_cont = next(ct for ct in w["containers"] if ct["name"] == "Neo-Veridia")
    main_floor = next(loc for loc in w["locations"] if loc["name"] == "Main Floor")

    # Simulate pre-upgrade v1 DB rows and legacy v1 disk files
    v1_world_file = media_dir / "worlds" / "images" / "pub_v1_wmed_28416ce9b1.webp"
    v1_world_file.parent.mkdir(parents=True, exist_ok=True)
    v1_world_file.write_bytes(b"RIFFoldv1world")

    v1_char_portrait = media_dir / "public" / "v1" / "characters" / "kira_vance" / "portraits" / "default_0b97fa1a.webp"
    v1_char_portrait.parent.mkdir(parents=True, exist_ok=True)
    v1_char_portrait.write_bytes(b"RIFFoldv1portrait")

    conn = repo._connect()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO media_assets (
                id, owner_id, entity_scope, media_type, role, filename, label,
                mime_type, byte_size, is_public, seed_key, parent_image_id, created_at
            )
            VALUES (
                'pub_v1_wmed_28416ce9b1', NULL, 'world', 'image', 'world_scene',
                'pub_v1_wmed_28416ce9b1.webp', 'Neo-Veridia', 'image/webp', 14, 1,
                ?, NULL, '2026-01-01T00:00:00Z'
            )
            """,
            (SHOWCASE_WORLD_SEED_KEY,),
        )
        conn.execute(
            "UPDATE world_media_links SET media_id = 'pub_v1_wmed_28416ce9b1' WHERE world_id = ? AND media_id = 'pub_v2_wmed_28416ce9b1'",
            (w["id"],),
        )
        conn.execute(
            "UPDATE location_containers SET image_media_id = 'pub_v1_wmed_28416ce9b1' WHERE id = ?",
            (neo_cont["id"],),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO media_assets (
                id, owner_id, entity_scope, media_type, role, filename, label,
                mime_type, byte_size, is_public, seed_key, parent_image_id, created_at
            )
            VALUES (
                'pub_v1_wmed_7149de5689', NULL, 'world', 'image', 'world_scene',
                'pub_v1_wmed_7149de5689.webp', 'Main Floor', 'image/webp', 14, 1,
                ?, NULL, '2026-01-01T00:00:00Z'
            )
            """,
            (SHOWCASE_WORLD_SEED_KEY,),
        )
        conn.execute(
            "UPDATE location_nodes SET image_media_id = 'pub_v1_wmed_7149de5689' WHERE id = ?",
            (main_floor["id"],),
        )
        conn.execute(
            "UPDATE worlds SET seed_version = 1 WHERE id = ?",
            (w["id"],),
        )
        conn.execute(
            """
            UPDATE characters
            SET portraits_json = REPLACE(portraits_json, '/api/media/public/v2/', '/api/media/public/v1/'),
                gallery_json = REPLACE(gallery_json, '/api/media/public/v2/', '/api/media/public/v1/'),
                seed_version = 1
            WHERE id = ?
            """,
            (c["id"],),
        )
        conn.execute(
            """
            INSERT INTO character_versions (id, character_id, version, data_json, created_at)
            VALUES (
                'cver_v1_legacy_test', ?, 99,
                '{"portraits": {"default": "/api/media/public/v1/characters/kira_vance/portraits/default_0b97fa1a.webp"}}',
                '2026-01-01T00:00:00Z'
            )
            """,
            (c["id"],),
        )
        legacy_post_turn = json.dumps(
            {
                "first_visit_media": [
                    {
                        "entity_type": "container",
                        "entity_id": neo_cont["id"],
                        "depth": 4,
                        "entity_name": "Neo-Veridia",
                        "media_id": "pub_v1_wmed_28416ce9b1",
                        "image_url": "/api/media/worlds/images/pub_v1_wmed_28416ce9b1.webp",
                        "label": "Neo-Veridia",
                    }
                ]
            }
        )
        conn.execute(
            """
            INSERT INTO turn_nodes (
                id, campaign_id, parent_turn_id, depth_index, user_message, actor_id,
                raw_prose, cognition_json, pre_turn_json, post_turn_json, created_at
            )
            VALUES (
                'turn_v1_legacy', ?, NULL, 0, 'Start', '__narrator__',
                'Opening prose', '{}', '{}', ?, '2026-01-01T00:00:00Z'
            )
            """,
            (camp_id, legacy_post_turn),
        )
        conn.commit()
    finally:
        conn.close()

    # Run startup showcase synchronization
    ensure_public_showcase_media(repo)

    # Verify DB + disk upgraded cleanly to v2
    upgraded_world = client.get(f"/api/worlds/{w['id']}", headers=headers_u).json()
    upgraded_neo = next(m for m in upgraded_world["media"] if m["label"] == "Neo-Veridia")
    assert upgraded_neo["id"] == "pub_v2_wmed_28416ce9b1"
    assert upgraded_neo["video_url"] == "/api/media/assets/pub_v2_vid_neo_veridia"
    assert next(loc for loc in upgraded_world["locations"] if loc["id"] == main_floor["id"])["image_media_id"] == "pub_v2_wmed_7149de5689"

    upgraded_char = client.get(f"/api/characters/{c['id']}", headers=headers_u).json()
    assert upgraded_char["portraits"]["default"].startswith("/api/media/public/v2/characters/kira_vance/portraits/")
    assert upgraded_char["gallery"][0]["url"].startswith("/api/media/public/v2/characters/kira_vance/gallery/")

    # Turn-1 arrival media migrated to pub_v2_wmed_28416ce9b1 and hydrates the linked v2 video
    turns = repo.list_campaign_turn_nodes(camp_id)
    assert turns[0].post_turn is not None
    assert turns[0].post_turn.first_visit_media[0].media_id == "pub_v2_wmed_28416ce9b1"
    assert turns[0].post_turn.first_visit_media[0].video_url == "/api/media/assets/pub_v2_vid_neo_veridia"

    conn = repo._connect()
    try:
        assert conn.execute("SELECT 1 FROM media_assets WHERE id = 'pub_v1_wmed_28416ce9b1'").fetchone() is None
        assert conn.execute("SELECT seed_version FROM worlds WHERE id = ?", (w["id"],)).fetchone()["seed_version"] == 2
        assert conn.execute("SELECT seed_version FROM characters WHERE id = ?", (c["id"],)).fetchone()["seed_version"] == 2
        cv_row = conn.execute("SELECT data_json FROM character_versions WHERE id = 'cver_v1_legacy_test'").fetchone()
        assert "/api/media/public/v2/characters/kira_vance/" in cv_row["data_json"]
    finally:
        conn.close()

    assert not v1_world_file.exists()
    assert not v1_char_portrait.exists()
