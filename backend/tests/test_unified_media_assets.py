"""Tests for v0.24.0 unified media_assets store, legacy DB migration, CoW deduplication, and immediate deletion."""

from __future__ import annotations

import io
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_module
from app.auth import get_current_user
from app.config import settings
from app.db.repos.arrival_descriptions import build_first_visit_arrival_bundle
from app.db.repository import CantinaRepository
from app.dependencies import get_user_media_usage_bytes
from app.schemas.character import BaselinePsyche, CharacterUpdatePayload, CharacterWizardDraft
from app.schemas.persona import PersonaCreatePayload
from app.schemas.world import (
    LocationNodeDraft,
    WorldGlobalRules,
    WorldUpdatePayload,
    WorldWizardDraft,
)
from app.security.media_path import safe_resolve_asset_file_path


def _png_bytes(w: int = 128, h: int = 96, color: tuple[int, int, int] = (30, 110, 180)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _ffmpeg_mp4_bytes(tmp_dir: Path, name: str = "clip.mp4") -> bytes:
    out = tmp_dir / name
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x2266aa:s=160x90:d=0.4:r=10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(out),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return out.read_bytes()


def _seed_world_char_persona(repo: CantinaRepository, owner_id: str) -> tuple[str, str, str]:
    world = repo.create_world_from_draft(
        WorldWizardDraft(
            name="Glass Harbor",
            global_rules=WorldGlobalRules(
                genre="Noir",
                tone="Misty",
                setting_overview="Tidal docks.",
                tech_or_magic_rules="Steam.",
                describe_on_first_visit=True,
            ),
            locations=[
                LocationNodeDraft(
                    key="loc_pier",
                    name="Pier One",
                    summary="Wet planks.",
                    description="Fog curls under amber lamps.",
                    environmental_tags=["fog"],
                    is_starting_location=True,
                ),
            ],
            edges=[],
            lore_nodes=[],
        ),
        owner_id=owner_id,
    )
    char = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Mara Cross",
            tagline="Dockwatcher",
            core_persona="Sharp and watchful.",
            baseline_psyche=BaselinePsyche(
                core_drive="Protect the cove.",
                core_fear="Tidewall breach.",
                default_want="Log incoming ships.",
                default_plan="Patrol Pier One.",
            ),
        ),
        world_id=world.id,
        owner_id=owner_id,
    )
    persona = repo.create_persona(
        PersonaCreatePayload(name="Captain Reyes", tagline="Harbor pilot"),
        owner_id=owner_id,
    )
    return world.id, char.id, persona.id


def test_legacy_db_migrates_world_character_persona_media_into_unified_assets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Startup migration moves legacy world_media rows and per-entity image files into media_assets and assets/images."""
    db_path = tmp_path / "legacy.db"
    media_dir = tmp_path / "media"
    monkeypatch.setattr(settings, "db_path", str(db_path))
    monkeypatch.setattr(settings, "media_dir", str(media_dir))
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")

    # Initialize full schema first so all entity columns match v0.23, then rewind media tables to pre-v0.24 world_media
    pre_repo = CantinaRepository(str(db_path), media_dir=str(media_dir))
    pre_repo.init_db()
    now = "2026-01-01T00:00:00Z"
    uid = "user_legacy"
    wid = "world_legacy"
    cid = "char_legacy"
    pid = "persona_legacy"

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA foreign_keys = OFF;")
        conn.executescript(
            """
            DROP TABLE IF EXISTS world_media_links;
            DROP TABLE IF EXISTS location_nodes;
            DROP TABLE IF EXISTS location_containers;
            DROP TABLE IF EXISTS media_assets;
            CREATE TABLE world_media (
                id TEXT PRIMARY KEY,
                owner_id TEXT NULL,
                media_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                mime_type TEXT NOT NULL DEFAULT 'image/webp',
                byte_size INTEGER NOT NULL DEFAULT 0,
                is_public INTEGER NOT NULL DEFAULT 0,
                seed_key TEXT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE world_media_links (
                world_id TEXT NOT NULL,
                media_id TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                label_override TEXT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (world_id, media_id)
            );
            CREATE TABLE location_containers (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT NULL,
                parent_container_id TEXT NULL,
                depth INTEGER NOT NULL DEFAULT 1,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                ui_x REAL NULL,
                ui_y REAL NULL,
                icon TEXT NULL,
                image_media_id TEXT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE location_nodes (
                id TEXT PRIMARY KEY,
                world_id TEXT NOT NULL,
                created_at_turn_id TEXT NULL,
                superseded_at_turn_id TEXT NULL,
                container_id TEXT NULL,
                is_entry_exit INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                environmental_tags_json TEXT NOT NULL DEFAULT '[]',
                is_starting_location INTEGER NOT NULL DEFAULT 0,
                is_hub INTEGER NOT NULL DEFAULT 0,
                starting_message TEXT NOT NULL DEFAULT '',
                ui_x REAL NULL,
                ui_y REAL NULL,
                icon TEXT NULL,
                image_media_id TEXT NULL
            );
            """
        )
        conn.execute(
            "INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, 'leg', 'Leg', 'h', 'user', ?, ?)",
            (uid, now, now),
        )
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, 'Old Realm', ?, ?)",
            (
                wid,
                uid,
                WorldGlobalRules(
                    genre="Noir",
                    tone="Rainy",
                    setting_overview="Legacy town.",
                    tech_or_magic_rules="Steam.",
                ).model_dump_json(),
                now,
            ),
        )
        (media_dir / "worlds" / "images").mkdir(parents=True, exist_ok=True)
        w_file = media_dir / "worlds" / "images" / "wmed_old01.webp"
        w_file.write_bytes(b"RIFFworldimg")
        conn.execute(
            "INSERT INTO world_media (id, owner_id, media_type, filename, label, mime_type, byte_size, is_public, created_at) VALUES (?, ?, 'image', 'wmed_old01.webp', 'Old Pier', 'image/webp', ?, 0, ?)",
            ("wmed_old01", uid, len(b"RIFFworldimg"), now),
        )
        conn.execute(
            "INSERT INTO world_media_links (world_id, media_id, sort_order, created_at) VALUES (?, 'wmed_old01', 0, ?)",
            (wid, now),
        )
        conn.execute(
            "INSERT INTO location_nodes (id, world_id, name, summary, description, is_starting_location, image_media_id) VALUES (?, ?, 'Old Dock', 'S', 'D', 1, 'wmed_old01')",
            ("loc_old", wid),
        )

        (media_dir / "characters" / cid / "portraits").mkdir(parents=True, exist_ok=True)
        (media_dir / "characters" / cid / "gallery").mkdir(parents=True, exist_ok=True)
        (media_dir / "characters" / cid / "portraits" / "default_old.webp").write_bytes(b"RIFFcpor")
        (media_dir / "characters" / cid / "gallery" / "img_cgal01.webp").write_bytes(b"RIFFcgal")
        conn.execute(
            "INSERT INTO characters (id, owner_id, world_id, name, tagline, core_persona, baseline_psyche_json, portraits_json, gallery_json, created_at) VALUES (?, ?, ?, 'Legacy Char', 'T', 'Core', ?, ?, ?, ?)",
            (
                cid,
                uid,
                wid,
                BaselinePsyche(
                    core_drive="Survive",
                    core_fear="Loss",
                    default_want="Go",
                    default_plan="Stay",
                ).model_dump_json(),
                json.dumps({"default": f"/api/media/characters/{cid}/portraits/default_old.webp"}),
                json.dumps([
                    {
                        "id": "img_cgal01",
                        "url": f"/api/media/characters/{cid}/gallery/img_cgal01.webp",
                        "caption": "Old Shot",
                        "created_at": now,
                    }
                ]),
                now,
            ),
        )

        (media_dir / "personas" / pid / "portraits").mkdir(parents=True, exist_ok=True)
        (media_dir / "personas" / pid / "portraits" / "default_p.webp").write_bytes(b"RIFFppor")
        conn.execute(
            "INSERT INTO personas (id, owner_id, name, portrait_url, gallery_json, created_at, updated_at) VALUES (?, ?, 'Legacy Persona', ?, '[]', ?, ?)",
            (pid, uid, f"/api/media/personas/{pid}/portraits/default_p.webp", now, now),
        )
        conn.commit()
    finally:
        conn.close()

    repo = CantinaRepository(str(db_path), media_dir=str(media_dir))
    repo.init_db()

    migrated_world = repo.get_world(wid, base_only=True, owner_id=uid)
    assert len(migrated_world.media) == 1
    assert migrated_world.media[0].url == "/api/media/assets/wmed_old01"
    assert (media_dir / "assets" / "images" / "wmed_old01.webp").is_file()

    migrated_char = repo.get_character(cid, owner_id=uid)
    assert migrated_char.portraits["default"].startswith("/api/media/assets/")
    assert migrated_char.gallery[0].url.startswith("/api/media/assets/")
    c_gal_aid = migrated_char.gallery[0].id
    assert (media_dir / "assets" / "images" / f"{c_gal_aid}.webp").is_file()

    migrated_persona = repo.get_persona(pid, owner_id=uid)
    assert migrated_persona.portrait_url is not None
    assert migrated_persona.portrait_url.startswith("/api/media/assets/")

    # Usage accounting sums migrated unified assets accurately
    expected_total = len(b"RIFFworldimg") + len(b"RIFFcpor") + len(b"RIFFcgal") + len(b"RIFFppor")
    assert get_user_media_usage_bytes(repo, uid) == expected_total


def test_cow_zero_duplication_quota_dedup_immediate_delete_and_live_video_hydration(
    empty_repo: CantinaRepository, tmp_path: Path
) -> None:
    """Verify CoW forks never duplicate files/quota, immediate delete breaks campaign refs after impact warning, and campaign snapshots/arrivals hydrate videos."""
    repo = empty_repo
    owner = repo.create_user(username="unified_owner", display_name="Owner", role="user")
    w_id, c_id, p_id = _seed_world_char_persona(repo, owner.id)

    main_module.app.dependency_overrides[main_module.get_repo] = lambda: repo
    main_module.app.dependency_overrides[get_current_user] = lambda: owner
    mp4_bytes = _ffmpeg_mp4_bytes(tmp_path)

    with TestClient(main_module.app) as client:
        # 1. Upload world video -> creates poster + linked video; attach poster to starting location
        wv_res = client.post(
            f"/api/worlds/{w_id}/media/videos",
            files={"file": ("pier.mp4", mp4_bytes, "video/mp4")},
            data={"label": "Animated Pier"},
        )
        assert wv_res.status_code == 200, wv_res.text
        w_data = wv_res.json()
        w_media = w_data["media"][0]
        w_img_id = w_media["id"]
        assert w_media["video_url"] == f"/api/media/assets/{w_media['video_asset_id']}"
        assert w_media["video_mime_type"] == "video/mp4"

        w_obj = repo.get_world(w_id, base_only=True, owner_id=owner.id)
        repo.update_world(
            w_id,
            WorldUpdatePayload(
                name=w_obj.name,
                global_rules=w_obj.global_rules,
                containers=w_obj.containers,
                locations=[
                    l.model_copy(update={"image_media_id": w_img_id})
                    if l.is_starting_location
                    else l
                    for l in w_obj.locations
                ],
                edges=w_obj.edges,
                lore_nodes=w_obj.lore_nodes,
            ),
            owner_id=owner.id,
        )

        # 2. Upload character gallery video + persona gallery video
        cv_res = client.post(
            f"/api/characters/{c_id}/gallery/videos",
            files={"file": ("mara.mp4", mp4_bytes, "video/mp4")},
            data={"caption": "Mara Motion"},
        )
        assert cv_res.status_code == 200
        c_gal = cv_res.json()["gallery"][0]
        assert c_gal["video_url"].startswith("/api/media/assets/vid_")

        pv_res = client.post(
            f"/api/personas/{p_id}/gallery/videos",
            files={"file": ("reyes.mp4", mp4_bytes, "video/mp4")},
            data={"caption": "Reyes Helm"},
        )
        assert pv_res.status_code == 200
        p_gal = pv_res.json()["gallery"][0]
        assert p_gal["video_url"].startswith("/api/media/assets/vid_")

        baseline_quota = get_user_media_usage_bytes(repo, owner.id)
        assert baseline_quota > 0

        # 3. Start campaign -> Turn 0 arrival bundle + active location + persona_snapshot hydrate linked video
        camp = repo.create_campaign(
            name="Harbor Watch",
            world_id=w_id,
            character_id=c_id,
            persona_id=p_id,
            owner_id=owner.id,
            start_focus="world",
        )
        state = client.get(f"/api/campaigns/{camp.id}/state").json()
        assert state["active_location"]["video_url"] == w_media["video_url"]
        assert state["active_location"]["video_mime_type"] == "video/mp4"
        turn0_media = state["active_branch_turns"][0]["post_turn"]["first_visit_media"]
        assert len(turn0_media) == 1
        assert turn0_media[0]["video_url"] == w_media["video_url"]
        assert turn0_media[0]["video_mime_type"] == "video/mp4"
        assert state["campaign"]["persona_snapshot"]["gallery"][0]["video_url"] == p_gal["video_url"]

        # Verify pure arrival bundle builder carries video metadata forward too
        hydrated_world = repo.get_world(w_id, base_only=True, owner_id=owner.id)
        start_loc = next(l for l in hydrated_world.locations if l.is_starting_location)
        _, built_media, _, _ = build_first_visit_arrival_bundle(
            target_location=start_loc,
            containers=hydrated_world.containers,
            locations=hydrated_world.locations,
            prev_visited_locations=[],
            prev_visited_containers=[],
            describe_on_first_visit=True,
        )
        assert built_media[0].video_url == w_media["video_url"]

        # 4. CoW-fork character while campaign runs -> quota stays identical (0 bytes added) & same asset URLs
        c_cur = repo.get_character(c_id, owner_id=owner.id)
        c_fork = repo.update_character(
            c_id,
            CharacterUpdatePayload(
                name=c_cur.name,
                tagline="CoW Edited",
                core_persona=c_cur.core_persona,
                baseline_psyche=c_cur.baseline_psyche,
                world_id=w_id,
            ),
            owner_id=owner.id,
        )
        assert c_fork.id != c_id
        assert c_fork.gallery[0].video_url == c_gal["video_url"]
        assert get_user_media_usage_bytes(repo, owner.id) == baseline_quota

        # 5. Campaign impact checks report active campaign & linked video bytes before deletion
        w_imp = client.get(f"/api/worlds/{w_id}/media/{w_img_id}/impact").json()
        assert w_imp["campaigns_using"] == 1
        assert w_imp["has_linked_video"] is True
        assert w_imp["video_byte_size"] == w_media["video_byte_size"]

        p_imp = client.get(f"/api/personas/{p_id}/gallery/{p_gal['id']}/impact").json()
        assert p_imp["campaigns_using"] == 1
        assert p_imp["has_linked_video"] is True

        c_imp = client.get(f"/api/characters/{c_fork.id}/gallery/{c_gal['id']}/impact").json()
        assert c_imp["has_linked_video"] is True

        # 6. Immediate delete on persona video reflects immediately in running campaign snapshot & frees quota
        del_pv = client.delete(f"/api/personas/{p_id}/gallery/{p_gal['id']}/video")
        assert del_pv.status_code == 200
        assert client.get(p_gal["video_url"]).status_code == 404
        assert get_user_media_usage_bytes(repo, owner.id) < baseline_quota
        state_after_pv = client.get(f"/api/campaigns/{camp.id}/state").json()
        assert state_after_pv["campaign"]["persona_snapshot"]["gallery"][0]["video_url"] is None

        # Cleanup remaining assets
        del_w = client.delete(f"/api/worlds/{w_id}/media/{w_img_id}")
        assert del_w.status_code == 200
        assert client.get(w_media["url"]).status_code == 404
        assert client.get(w_media["video_url"]).status_code == 404


def test_public_assets_immune_to_delete_and_quota(
    empty_repo: CantinaRepository,
) -> None:
    """Built-in public showcase media cannot be deleted or billed against user quota."""
    repo = empty_repo
    alice = repo.create_user(username="pub_test_alice", display_name="Alice", role="user")
    img_path = safe_resolve_asset_file_path(repo.media_dir, "images", "pub_v1_showcase.webp")
    img_path.parent.mkdir(parents=True, exist_ok=True)
    img_path.write_bytes(b"RIFFpublic")

    repo.register_media_asset(
        asset_id="pub_v1_showcase",
        owner_id=None,
        entity_scope="world",
        media_type="image",
        role="world_scene",
        filename="pub_v1_showcase.webp",
        mime_type="image/webp",
        byte_size=len(b"RIFFpublic"),
        is_public=True,
        seed_key="showcase:test:1",
    )

    # Attempt to delete public asset returns empty list and leaves disk file untouched
    assert repo.delete_media_asset("pub_v1_showcase") == []
    assert img_path.is_file()
    assert get_user_media_usage_bytes(repo, alice.id) == 0
    shutil.rmtree(Path(repo.media_dir), ignore_errors=True)
