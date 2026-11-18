"""Comprehensive tests for v0.16.0 Default Showcase Seeding, Public Media, Quotas, CoW, and Profile Restore."""

from __future__ import annotations

import io
import os
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import (
    SHOWCASE_CHARACTER_SEED_KEY,
    SHOWCASE_SEED_VERSION,
    SHOWCASE_WORLD_SEED_KEY,
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
    """Verify initial_setup, register, and admin_create_user seed The Green Lie + Kira Vance with 0 campaigns."""
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
        assert c["name"] == "Kira Vance"
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
    assert len(w["locations"]) == 35
    assert len(w["edges"]) == 88
    assert len(w["lore_nodes"]) == 14
    assert len(w["media"]) == 3
    assert all(m["is_public"] is True for m in w["media"])

    main_floor = next(loc for loc in w["locations"] if loc["name"] == "Main Floor")
    assert main_floor["is_starting_location"] is True
    assert "Grey runoff hisses" in main_floor["starting_message"]
    assert main_floor["image_media_id"] is not None
    assert main_floor["image_url"].startswith("/api/media/worlds/images/pub_v1_")

    # Check container- and location-scoped lore nodes including secret gating
    caissons = next(ct for ct in w["containers"] if ct["name"] == "The Caissons")
    assert [ln["title"] for ln in caissons["lore_nodes"]] == ["The Noodle-Stall Scrub"]
    assert caissons["lore_nodes"][0]["category"] == "secret"

    unit_4b = next(loc for loc in w["locations"] if loc["name"] == "Unit 4B-12")
    assert unit_4b["lore_nodes"][0]["title"] == "Ghost Signal Location"
    assert unit_4b["lore_nodes"][0]["category"] == "secret"

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
    assert "low_token_initial_message" in c["unsupported_fields"]
    assert "Sluice" in c["unsupported_fields"]["low_token_initial_message"]

    subdermal = next(it for it in c["equipped"] if it["name"] == "Subdermal shard")
    assert "permanent" in subdermal["flags"]
    burner = next(it for it in c["inventory"] if it["name"] == "Encrypted burner slate")
    assert "artifact" in burner["flags"]
    sovereign_lore = next(ln for ln in w["lore_nodes"] if ln["title"] == "The Sovereign Cipher")
    assert burner["lore_id"] == sovereign_lore["id"]

    # Public media URLs serve cleanly and are excluded from user media quota
    portrait_url = c["portraits"]["default"]
    gallery_url = c["gallery"][0]["url"]
    assert portrait_url.startswith("/api/media/public/v1/characters/kira_vance/portraits/")
    assert gallery_url.startswith("/api/media/public/v1/characters/kira_vance/gallery/")
    assert client.get(portrait_url, headers=reg_headers).status_code == 200
    assert client.get(gallery_url, headers=reg_headers).status_code == 200
    assert client.get(w["media"][0]["url"], headers=reg_headers).status_code == 200
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

    # Starting a campaign with Kira verifies unsupported_fields are excluded from AI context
    camp_res = client.post(
        "/api/campaigns",
        headers=reg_headers,
        json={"name": "Green Lie Run", "world_id": w["id"], "character_id": c["id"]},
    )
    assert camp_res.status_code == 200
    bundle = repo.get_campaign_state_bundle(camp_res.json()["campaign"]["id"])
    z1_prompt = build_zone1_static_system_prompt(
        world=repo.get_world(w["id"]),
        character=bundle.character_records[c["id"]],
    )
    assert "undisturbed passage through the Sluice" not in z1_prompt


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

    # Alice CoW-edits Kira Vance -> public portrait & gallery stay public (0 bytes), not copied into private dir
    c_upd = repo.update_character(
        c_a["id"],
        CharacterUpdatePayload(
            name="Kira Vance (Alice Edit)",
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
    assert c_after_p["portraits"]["default"].startswith(f"/api/media/characters/{c_after_p['id']}/portraits/")
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

    # Export seeded character & world to .zcc -> public media files are packaged into the ZIP
    zcc_bytes = build_zcc_export(
        repo,
        character_ids=[c_u["id"]],
        world_ids=[w_u["id"]],
        persona_ids=[],
        owner_id=uid,
        include_world_media=True,
    )
    with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as zf:
        names = set(zf.namelist())
        assert any(n.endswith("default_0b97fa1a.webp") for n in names)
        assert any(n.endswith("img_59a7be04b1.webp") for n in names)
        assert any("pub_v1_wmed_" in n for n in names)

    # Reset user data -> clears user's catalog, leaves public files & public world_media rows intact
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

    # Backdate public files and run Chloromancer orphan sweep -> public files MUST survive
    pub_char_file = media_dir / "public" / "v1" / "characters" / "kira_vance" / "portraits" / "default_0b97fa1a.webp"
    pub_world_file = media_dir / "worlds" / "images" / "pub_v1_wmed_28416ce9b1.webp"
    past = time.time() - (ORPHAN_MEDIA_GRACE_SECONDS + 3600)
    os.utime(pub_char_file, (past, past))
    os.utime(pub_world_file, (past, past))
    _sweep_orphan_media_dirs(repo)
    assert pub_char_file.is_file()
    assert pub_world_file.is_file()

    # Importing a .zcc manually creates private entities (seed_key=NULL) so Profile Restore still detects missing defaults
    import asyncio

    preview = inspect_uploaded_file(repo, zcc_bytes, "exported.zcc", user_id=uid)
    commit_res = asyncio.run(
        commit_staged_import(repo, ImportCommitRequest(staged_token=preview.staged_token), user_id=uid)
    )
    assert commit_res.success is True
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

    # 2. User edits The Green Lie (removing 'The Sovereign Cipher' lore) and deletes Kira Vance
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

    # Restore -> restores ONLY Kira Vance (linked to edited world, gracefully clearing missing artifact lore_id), skips world
    r2 = client.post("/api/profile/restore-defaults", headers=headers_u).json()
    assert r2["restored_world"] is False
    assert r2["restored_character"] is True
    assert r2["skipped_world"] is True
    assert r2["skipped_character"] is False
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
