"""Tests for library-only seeded world & character updates, CoW campaign isolation, copy detachment, and dismissal."""

from __future__ import annotations

import asyncio
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed_catalog import (
    SHOWCASE_CHARACTER_SEED_KEY,
    SHOWCASE_CHARACTER_SEED_VERSION,
    SHOWCASE_WORLD_SEED_KEY,
    SHOWCASE_WORLD_SEED_VERSION,
)
from app.schemas.import_export import ImportCommitRequest
from app.services.import_export_service import (
    build_zcc_export,
    commit_staged_import,
    inspect_uploaded_file,
)


def _make_png_bytes(color: tuple[int, int, int] = (40, 180, 120)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (48, 48), color)
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def update_env(
    showcase_api_env: tuple[TestClient, CantinaRepository, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, CantinaRepository, Path, dict[str, str]]:
    monkeypatch.setattr(settings, "allow_self_registration", True)
    client, repo, media_dir = showcase_api_env
    res = client.post(
        "/api/auth/setup",
        json={"username": "seed_updater", "password": "StrongPassword123!"},
    )
    assert res.status_code == 200
    headers = {"Authorization": f"Bearer {res.json()['token']}"}
    return client, repo, media_dir, headers


def _set_world_seed_state(
    repo: CantinaRepository,
    world_id: str,
    *,
    seed_version: int = 2,
    seed_modified: int | None = None,
) -> None:
    conn = repo._connect()
    try:
        if seed_modified is None:
            conn.execute(
                "UPDATE worlds SET seed_version = ? WHERE id = ?",
                (seed_version, world_id),
            )
        else:
            conn.execute(
                "UPDATE worlds SET seed_version = ?, seed_modified = ? WHERE id = ?",
                (seed_version, seed_modified, world_id),
            )
        conn.commit()
    finally:
        conn.close()


def _set_char_seed_state(
    repo: CantinaRepository,
    char_id: str,
    *,
    seed_version: int = 2,
    seed_modified: int | None = None,
) -> None:
    conn = repo._connect()
    try:
        if seed_modified is None:
            conn.execute(
                "UPDATE characters SET seed_version = ? WHERE id = ?",
                (seed_version, char_id),
            )
        else:
            conn.execute(
                "UPDATE characters SET seed_version = ?, seed_modified = ? WHERE id = ?",
                (seed_version, seed_modified, char_id),
            )
        conn.commit()
    finally:
        conn.close()


def _world_update_payload_from_record(w: dict) -> dict:
    return {
        "name": w["name"],
        "global_rules": w["global_rules"],
        "containers": w.get("containers", []),
        "locations": w.get("locations", []),
        "edges": w.get("edges", []),
        "lore_nodes": w.get("lore_nodes", []),
        "unsupported_fields": w.get("unsupported_fields", {}),
    }


def _char_update_payload_from_record(c: dict) -> dict:
    keys = (
        "world_id",
        "name",
        "tagline",
        "character_bio",
        "species",
        "sex",
        "pronouns",
        "age",
        "build_and_height",
        "distinctive_features",
        "posture",
        "mannerisms",
        "modifications",
        "visual_aesthetic",
        "personality_traits",
        "core_persona",
        "moral_code",
        "quirks_flaws",
        "communication_style",
        "initial_message",
        "equipped",
        "inventory",
        "voice_anchors",
        "baseline_psyche",
        "memory_shards",
        "tags",
        "creator",
        "creator_notes",
        "portraits",
        "gallery",
        "unsupported_fields",
    )
    return {k: c[k] for k in keys if k in c}


def test_seed_update_hydration_library_only_and_noop_save_tightening(
    update_env: tuple[TestClient, CantinaRepository, Path, dict[str, str]],
) -> None:
    client, repo, _, headers = update_env
    w = client.get("/api/worlds", headers=headers).json()[0]
    c = client.get("/api/characters", headers=headers).json()[0]

    # Freshly seeded v3 assets have update_available = False
    assert w["seed_update"]["current_version"] == SHOWCASE_WORLD_SEED_VERSION
    assert w["seed_update"]["latest_version"] == SHOWCASE_WORLD_SEED_VERSION
    assert w["seed_update"]["update_available"] is False
    assert w["seed_update"]["seed_modified"] is False
    assert c["seed_update"]["current_version"] == SHOWCASE_CHARACTER_SEED_VERSION
    assert c["seed_update"]["latest_version"] == SHOWCASE_CHARACTER_SEED_VERSION
    assert c["seed_update"]["update_available"] is False
    assert c["seed_update"]["seed_modified"] is False

    # No-op save on world and character must NOT set seed_modified = 1
    w_save = client.put(
        f"/api/worlds/{w['id']}",
        headers=headers,
        json=_world_update_payload_from_record(w),
    )
    assert w_save.status_code == 200
    assert w_save.json()["seed_update"]["seed_modified"] is False

    c_save = client.put(
        f"/api/characters/{c['id']}",
        headers=headers,
        json=_char_update_payload_from_record(c),
    )
    assert c_save.status_code == 200
    assert c_save.json()["seed_update"]["seed_modified"] is False

    # Downgrade to v2 and start a campaign: library sees update_available, campaign state does NOT
    _set_world_seed_state(repo, w["id"], seed_version=2)
    _set_char_seed_state(repo, c["id"], seed_version=2)

    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={"name": "Active Campaign", "world_id": w["id"], "character_id": c["id"]},
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]
    state_json = client.get(f"/api/campaigns/{camp_id}/state", headers=headers).json()
    assert state_json["character_records"][c["id"]]["seed_update"] is None
    assert repo.get_world(w["id"], campaign_id=camp_id).seed_update is None

    lib_w = client.get(f"/api/worlds/{w['id']}", headers=headers).json()
    lib_c = client.get(f"/api/characters/{c['id']}", headers=headers).json()
    assert lib_w["seed_update"]["update_available"] is True
    assert lib_w["seed_update"]["active_campaigns_count"] == 1
    assert lib_c["seed_update"]["update_available"] is True
    assert lib_c["seed_update"]["active_campaigns_count"] == 1

    # Real edit flips seed_modified = True
    edited_w_payload = _world_update_payload_from_record(lib_w)
    edited_w_payload["name"] = "The Green Lie Edited"
    w_edited = client.put(
        f"/api/worlds/{w['id']}", headers=headers, json=edited_w_payload
    )
    assert w_edited.status_code == 200
    assert w_edited.json()["seed_update"]["seed_modified"] is True


def test_unmodified_world_replace_inplace_and_cow_campaign_isolation(
    update_env: tuple[TestClient, CantinaRepository, Path, dict[str, str]],
) -> None:
    client, repo, _, headers = update_env
    w = client.get("/api/worlds", headers=headers).json()[0]
    c = client.get("/api/characters", headers=headers).json()[0]
    _set_world_seed_state(repo, w["id"], seed_version=2, seed_modified=0)

    # 1. In-place replace when unused by campaigns
    rep_res = client.post(
        f"/api/worlds/{w['id']}/seed-update",
        headers=headers,
        json={"mode": "replace"},
    )
    assert rep_res.status_code == 200
    body = rep_res.json()
    assert body["preserved_copy"] is None
    updated_w = body["updated_world"]
    assert updated_w["id"] == w["id"]
    assert updated_w["seed_update"]["current_version"] == SHOWCASE_WORLD_SEED_VERSION
    assert updated_w["seed_update"]["update_available"] is False
    assert len(updated_w["locations"]) == 37

    # Linked character remains valid and retains Sovereign Cipher artifact lore_id
    c_after = client.get(f"/api/characters/{c['id']}", headers=headers).json()
    assert c_after["world_id"] == updated_w["id"]
    cipher_lore = next(ln for ln in updated_w["lore_nodes"] if ln["title"] == "The Sovereign Cipher")
    slate = next(it for it in c_after["inventory"] if it["name"] == "Encrypted burner slate")
    assert slate["lore_id"] == cipher_lore["id"]

    # 2. Campaign-bound CoW fork replace: mutate old world title on DB row to verify campaign stays frozen
    conn = repo._connect()
    try:
        conn.execute(
            "UPDATE worlds SET name = 'Frozen Old Seed', seed_version = 1 WHERE id = ?",
            (updated_w["id"],),
        )
        conn.commit()
    finally:
        conn.close()

    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={"name": "Frozen Run", "world_id": updated_w["id"], "character_id": c["id"]},
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]

    cow_res = client.post(
        f"/api/worlds/{updated_w['id']}/seed-update",
        headers=headers,
        json={"mode": "replace"},
    )
    assert cow_res.status_code == 200
    cow_body = cow_res.json()
    new_lib_world = cow_body["updated_world"]
    assert new_lib_world["id"] != updated_w["id"]
    assert new_lib_world["name"] == "The Green Lie"
    assert new_lib_world["seed_update"]["update_available"] is False

    # Existing campaign remains on its frozen world snapshot
    camp_state = client.get(f"/api/campaigns/{camp_id}/state", headers=headers).json()
    assert camp_state["campaign"]["world_id"] == updated_w["id"]
    assert repo.get_world(updated_w["id"], campaign_id=camp_id).name == "Frozen Old Seed"


def test_modified_world_copy_and_update_with_campaigns_media_and_character_split(
    update_env: tuple[TestClient, CantinaRepository, Path, dict[str, str]],
) -> None:
    client, repo, _, headers = update_env
    w = client.get("/api/worlds", headers=headers).json()[0]
    yulia = client.get("/api/characters", headers=headers).json()[0]

    # Create a custom character linked to The Green Lie
    custom_char_payload = _char_update_payload_from_record(yulia)
    custom_char_payload["name"] = "Rico Vance"
    custom_char_payload["portraits"] = {}
    custom_char_payload["gallery"] = []
    custom_res = client.post(
        "/api/wizards/character/commit",
        headers=headers,
        json={"draft": custom_char_payload, "world_id": w["id"]},
    )
    assert custom_res.status_code == 200
    custom_char = custom_res.json()

    # Upload custom media + edit world name -> sets seed_modified = 1 & has_custom_media = True
    up_res = client.post(
        f"/api/worlds/{w['id']}/media",
        headers=headers,
        files={"file": ("custom.png", _make_png_bytes(), "image/png")},
        data={"label": "Player Custom Alley"},
    )
    assert up_res.status_code == 200
    w_with_media = up_res.json()

    edit_payload = _world_update_payload_from_record(w_with_media)
    edit_payload["name"] = "My Custom Green Lie"
    w_edited = client.put(f"/api/worlds/{w['id']}", headers=headers, json=edit_payload).json()
    _set_world_seed_state(repo, w_edited["id"], seed_version=2)

    # Start an active campaign against the modified world so CoW isolation is exercised too
    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={"name": "Custom World Run", "world_id": w_edited["id"], "character_id": yulia["id"]},
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]

    # Check library metadata before update
    lib_before = client.get(f"/api/worlds/{w_edited['id']}", headers=headers).json()
    assert lib_before["seed_update"]["seed_modified"] is True
    assert lib_before["seed_update"]["has_custom_media"] is True
    assert lib_before["seed_update"]["active_campaigns_count"] == 1
    assert lib_before["seed_update"]["linked_characters_count"] == 2

    # Save Copy & Update
    cu_res = client.post(
        f"/api/worlds/{w_edited['id']}/seed-update",
        headers=headers,
        json={"mode": "copy_and_update"},
    )
    assert cu_res.status_code == 200
    cu_body = cu_res.json()
    updated_w = cu_body["updated_world"]
    preserved_copy = cu_body["preserved_copy"]
    assert preserved_copy is not None
    assert preserved_copy["name"] == "My Custom Green Lie (Custom Copy)"
    assert preserved_copy["seed_update"] is None
    assert any(m["label"] == "Player Custom Alley" for m in preserved_copy["media"])

    # Active campaign stays on its frozen snapshot name, NOT renamed to "(Custom Copy)"
    camp_world = repo.get_world(
        client.get(f"/api/campaigns/{camp_id}/state", headers=headers).json()["campaign"]["world_id"],
        campaign_id=camp_id,
    )
    assert camp_world.name == "My Custom Green Lie"

    # Fresh v3 world installed
    assert updated_w["name"] == "The Green Lie"
    assert updated_w["seed_update"]["update_available"] is False
    assert updated_w["seed_update"]["seed_modified"] is False

    # Linked character split: custom Rico stays on preserved copy; unmodified Yulia moves to updated world
    rico_after = client.get(f"/api/characters/{custom_char['id']}", headers=headers).json()
    yulia_after = client.get(f"/api/characters/{yulia['id']}", headers=headers).json()
    assert rico_after["world_id"] == preserved_copy["id"]
    assert yulia_after["world_id"] == updated_w["id"]
    new_cipher = next(ln for ln in updated_w["lore_nodes"] if ln["title"] == "The Sovereign Cipher")
    yulia_slate = next(it for it in yulia_after["inventory"] if it["name"] == "Encrypted burner slate")
    assert yulia_slate["lore_id"] == new_cipher["id"]


def test_seeded_character_updates_dismiss_restore_hint_and_zcc_roundtrip(
    update_env: tuple[TestClient, CantinaRepository, Path, dict[str, str]],
) -> None:
    client, repo, _, headers = update_env
    w = client.get("/api/worlds", headers=headers).json()[0]
    yulia = client.get("/api/characters", headers=headers).json()[0]

    # Simulate legacy Kira Vance v1 character with a manual edit + campaign
    edit_c = _char_update_payload_from_record(yulia)
    edit_c["name"] = "Kira Vance Custom"
    edit_c["tagline"] = "Edited fixer"
    edited = client.put(f"/api/characters/{yulia['id']}", headers=headers, json=edit_c).json()
    _set_char_seed_state(repo, edited["id"], seed_version=1, seed_modified=1)
    _set_world_seed_state(repo, w["id"], seed_version=2, seed_modified=0)

    # Restore Defaults mentions update available
    restore_res = client.post("/api/profile/restore-defaults", headers=headers)
    assert restore_res.status_code == 200
    assert "Update available" in restore_res.json()["message"]

    # Dismiss character update -> is_dismissed = True
    dis_res = client.post(
        f"/api/characters/{edited['id']}/seed-update/dismiss", headers=headers
    )
    assert dis_res.status_code == 200
    assert dis_res.json()["seed_update"]["is_dismissed"] is True
    assert dis_res.json()["seed_update"]["dismissed_version"] == SHOWCASE_CHARACTER_SEED_VERSION

    # Even after dismissing, player can still invoke Copy & Update from Inspector
    camp_res = client.post(
        "/api/campaigns",
        headers=headers,
        json={"name": "Kira Run", "world_id": w["id"], "character_id": edited["id"]},
    )
    assert camp_res.status_code == 200
    camp_id = camp_res.json()["campaign"]["id"]

    cu_res = client.post(
        f"/api/characters/{edited['id']}/seed-update",
        headers=headers,
        json={"mode": "copy_and_update", "copy_name": "Kira Legacy Branch"},
    )
    assert cu_res.status_code == 200
    cu_body = cu_res.json()
    new_yulia = cu_body["updated_character"]
    preserved = cu_body["preserved_copy"]
    assert new_yulia["name"] == "Yulia Halim"
    assert new_yulia["seed_update"]["update_available"] is False
    assert new_yulia["seed_update"]["is_dismissed"] is False
    assert preserved is not None
    assert preserved["name"] == "Kira Legacy Branch"
    assert preserved["seed_update"] is None

    # Campaign stays frozen on "Kira Vance Custom"
    camp_state = client.get(f"/api/campaigns/{camp_id}/state", headers=headers).json()
    camp_char = camp_state["character_records"][camp_state["campaign"]["character_id"]]
    assert camp_char["name"] == "Kira Vance Custom"

    # .zcc export excludes seed_update and imports with empty unsupported_fields
    user_id = client.get("/api/profile", headers=headers).json()["id"]
    zcc_bytes = build_zcc_export(
        repo,
        character_ids=[new_yulia["id"]],
        world_ids=[w["id"]],
        persona_ids=[],
        owner_id=user_id,
    )
    with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as zf:
        world_json = json.loads(zf.read("worlds.json"))
        char_json = json.loads(zf.read("characters.json"))
        assert "seed_update" not in world_json[0]
        assert "seed_update" not in char_json[0]

    inspect_res = inspect_uploaded_file(repo, zcc_bytes, "roundtrip.zcc", user_id=user_id)
    commit_res = asyncio.run(
        commit_staged_import(
            repo,
            ImportCommitRequest(staged_token=inspect_res.staged_token),
            user_id=user_id,
        )
    )
    assert commit_res.success is True
    imported_w = next(
        world_item
        for world_item in repo.list_worlds(owner_id=user_id)
        if world_item.name == commit_res.imported_worlds[0]
    )
    imported_c = next(
        char_item
        for char_item in repo.list_characters(owner_id=user_id)
        if char_item.name == commit_res.imported_characters[0]
    )
    assert imported_w.unsupported_fields == {}
    assert "seed_update" not in imported_c.unsupported_fields
    assert set(imported_c.unsupported_fields.keys()) == {"low_token_initial_message"}
    assert imported_w.seed_update is None
    assert imported_c.seed_update is None
    assert SHOWCASE_WORLD_SEED_KEY != "" and SHOWCASE_CHARACTER_SEED_KEY != ""


def test_modified_world_and_character_replace_discards_edits_and_relinks_all(
    update_env: tuple[TestClient, CantinaRepository, Path, dict[str, str]],
) -> None:
    client, repo, _, headers = update_env
    w = client.get("/api/worlds", headers=headers).json()[0]
    yulia = client.get("/api/characters", headers=headers).json()[0]

    # Edit world + upload custom media
    up_res = client.post(
        f"/api/worlds/{w['id']}/media",
        headers=headers,
        files={"file": ("discard_me.png", _make_png_bytes((200, 50, 50)), "image/png")},
        data={"label": "Temporary Custom"},
    )
    assert up_res.status_code == 200
    w_payload = _world_update_payload_from_record(up_res.json())
    w_payload["name"] = "Temp Edited Green Lie"
    w_edited = client.put(f"/api/worlds/{w['id']}", headers=headers, json=w_payload).json()
    _set_world_seed_state(repo, w_edited["id"], seed_version=2)

    # Replace & Discard Edits
    w_rep = client.post(
        f"/api/worlds/{w_edited['id']}/seed-update",
        headers=headers,
        json={"mode": "replace"},
    )
    assert w_rep.status_code == 200
    w_rep_body = w_rep.json()
    assert w_rep_body["preserved_copy"] is None
    w_clean = w_rep_body["updated_world"]
    assert w_clean["name"] == "The Green Lie"
    assert w_clean["seed_update"]["seed_modified"] is False
    assert w_clean["seed_update"]["has_custom_media"] is False
    assert not any(m["label"] == "Temporary Custom" for m in w_clean["media"])

    # Edit Yulia + Replace & Discard Edits (refetch Yulia after w_rep remapped artifact lore_id)
    yulia_fresh = client.get(f"/api/characters/{yulia['id']}", headers=headers).json()
    c_payload = _char_update_payload_from_record(yulia_fresh)
    c_payload["name"] = "Kira Vance Edited"
    c_put_res = client.put(f"/api/characters/{yulia['id']}", headers=headers, json=c_payload)
    assert c_put_res.status_code == 200
    c_edited = c_put_res.json()
    _set_char_seed_state(repo, c_edited["id"], seed_version=1)

    c_rep = client.post(
        f"/api/characters/{c_edited['id']}/seed-update",
        headers=headers,
        json={"mode": "replace"},
    )
    assert c_rep.status_code == 200
    c_clean = c_rep.json()["updated_character"]
    assert c_clean["name"] == "Yulia Halim"
    assert c_clean["seed_update"]["seed_modified"] is False
    assert c_clean["seed_update"]["current_version"] == SHOWCASE_CHARACTER_SEED_VERSION
    assert c_clean["portraits"]["default"].startswith("/api/media/public/v2/characters/kira_vance/portraits/")
