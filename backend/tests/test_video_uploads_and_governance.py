"""Tests for v0.24.0 MP4/WebM video uploads, ffmpeg extraction, quota edge cases, and admin governance."""

from __future__ import annotations

import io
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.dependencies import get_user_media_usage_bytes
from app.schemas.character import BaselinePsyche, CharacterWizardDraft
from app.schemas.persona import PersonaCreatePayload
from app.schemas.world import LocationNodeDraft, WorldGlobalRules, WorldWizardDraft
from app.security.media_path import safe_resolve_asset_file_path, safe_resolve_staging_dir


def _make_video(
    tmp_dir: Path,
    filename: str,
    *,
    vcodec: str,
    width: int = 160,
    height: int = 90,
    duration: float = 0.4,
    extra_args: list[str] | None = None,
) -> bytes:
    out = tmp_dir / filename
    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"testsrc=size={width}x{height}:rate=12:duration={duration}",
        "-c:v",
        vcodec,
        "-an",
        *(extra_args or []),
        str(out),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out.read_bytes()


def _png_bytes(w: int = 200, h: int = 120) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (90, 40, 150)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def media_env(empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch):
    admin = empty_repo.create_user(username="gov_admin", display_name="Admin", role="admin")
    player = empty_repo.create_user(username="gov_player", display_name="Player", role="user")
    other = empty_repo.create_user(username="gov_other", display_name="Other", role="user")

    world = empty_repo.create_world_from_draft(
        WorldWizardDraft(
            name="Video Realm",
            global_rules=WorldGlobalRules(
                genre="Sci-Fi",
                tone="Crisp",
                setting_overview="Docking ring.",
                tech_or_magic_rules="Orbital mechanics.",
            ),
            locations=[
                LocationNodeDraft(
                    key="loc_pad",
                    name="Landing Pad",
                    summary="Pad 4.",
                    description="Scorched titanium deck.",
                    environmental_tags=["orbital"],
                    is_starting_location=True,
                )
            ],
            edges=[],
            lore_nodes=[],
        ),
        owner_id=player.id,
    )
    char = empty_repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Nora Vance",
            tagline="Flight Lead",
            core_persona="Decisive.",
            baseline_psyche=BaselinePsyche(
                core_drive="Clear traffic.",
                core_fear="Hull loss.",
                default_want="Run preflight.",
                default_plan="Check telemetry.",
            ),
        ),
        world_id=world.id,
        owner_id=player.id,
    )
    persona = empty_repo.create_persona(
        PersonaCreatePayload(name="Comms Officer", tagline="Relay operator"),
        owner_id=player.id,
    )

    actor = [player]
    monkeypatch.setattr(main_module, "get_repo", lambda: empty_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: actor[0]
    with TestClient(main_module.app) as client:
        yield client, empty_repo, actor, admin, player, other, world.id, char.id, persona.id
    main_module.app.dependency_overrides.clear()


def test_mp4_webm_upload_frame_extraction_range_serving_and_cascades(media_env, tmp_path: Path) -> None:
    """MP4 H.264 & WebM VP9 upload with 1st-frame poster extraction, linking, video-only delete vs image cascade delete."""
    client, repo, actor, _admin, player, other, w_id, c_id, p_id = media_env

    mp4_bytes = _make_video(tmp_path, "sample.mp4", vcodec="libx264", extra_args=["-pix_fmt", "yuv420p"])
    webm_bytes = _make_video(tmp_path, "sample.webm", vcodec="libvpx-vp9", extra_args=["-pix_fmt", "yuv420p"])

    # 1. World MP4 without linked_image_id -> extracts 1st-frame WebP image & links video
    r_w = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("bay.mp4", mp4_bytes, "video/mp4")},
        data={"label": "Dock Loop"},
    )
    assert r_w.status_code == 200, r_w.text
    wm = r_w.json()["media"][0]
    assert wm["label"] == "Dock Loop"
    assert wm["video_mime_type"] == "video/mp4"
    assert wm["video_byte_size"] == len(mp4_bytes)

    # HTTP GET supports Accept-Ranges: bytes & byte range slices; cross-user blocked with 404
    r_stream = client.get(wm["video_url"], headers={"Range": "bytes=0-15"})
    assert r_stream.status_code in (200, 206)
    assert r_stream.headers.get("accept-ranges") == "bytes"
    assert "video/mp4" in r_stream.headers.get("content-type", "")

    actor[0] = other
    assert client.get(wm["video_url"]).status_code == 404
    actor[0] = player

    # 2. Remove video only -> keeps extracted poster image, removes video file & frees video bytes
    r_vdel = client.delete(f"/api/worlds/{w_id}/media/{wm['id']}/video")
    assert r_vdel.status_code == 200
    wm_after = r_vdel.json()["media"][0]
    assert wm_after["video_url"] is None
    assert client.get(wm["url"]).status_code == 200
    assert client.get(wm["video_url"]).status_code == 404

    # 3. Link WebM VP9 to that existing still image -> succeeds; swapping with MP4 replaces old WebM cleanly
    r_link = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("bay2.webm", webm_bytes, "video/webm")},
        data={"label": "Dock Loop", "linked_image_id": wm["id"]},
    )
    assert r_link.status_code == 200
    wm_webm = r_link.json()["media"][0]
    assert wm_webm["video_mime_type"] == "video/webm"
    assert client.get(wm_webm["video_url"]).status_code == 200

    # 4. Deleting the parent image cascades to linked video and removes both files & quota bytes
    r_idel = client.delete(f"/api/worlds/{w_id}/media/{wm['id']}")
    assert r_idel.status_code == 200
    assert r_idel.json()["media"] == []
    assert client.get(wm["url"]).status_code == 404
    assert client.get(wm_webm["video_url"]).status_code == 404

    # 5. Character & Persona video upload + video-only delete + image cascade delete
    r_c = client.post(
        f"/api/characters/{c_id}/gallery/videos",
        files={"file": ("char.webm", webm_bytes, "video/webm")},
        data={"caption": "Hangar"},
    )
    assert r_c.status_code == 200
    cg = r_c.json()["gallery"][0]
    assert cg["video_mime_type"] == "video/webm"

    r_cvdel = client.delete(f"/api/characters/{c_id}/gallery/{cg['id']}/video")
    assert r_cvdel.status_code == 200
    assert r_cvdel.json()["gallery"][0]["video_url"] is None
    assert client.get(cg["url"]).status_code == 200
    assert client.get(cg["video_url"]).status_code == 404

    r_p = client.post(
        f"/api/personas/{p_id}/gallery/videos",
        files={"file": ("p.mp4", mp4_bytes, "video/mp4")},
        data={"caption": "Helm"},
    )
    assert r_p.status_code == 200
    pg = r_p.json()["gallery"][0]
    assert client.get(pg["video_url"]).status_code == 200
    assert client.delete(f"/api/personas/{p_id}/gallery/{pg['id']}").status_code == 200
    assert client.get(pg["video_url"]).status_code == 404


def test_video_validation_quota_swap_and_zero_leftover_staging(media_env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Reject bad containers/codecs/oversized uploads cleanly with empty .staging/, and allow smaller-replaces-larger at quota."""
    client, repo, _actor, _admin, player, _other, w_id, _c_id, _p_id = media_env

    # 1. Corrupt bytes & unsupported Matroska/AVI & unsupported mjpeg codec -> 400 + empty .staging/
    r_bad = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("broken.mp4", b"not_a_real_mp4_payload", "video/mp4")},
    )
    assert r_bad.status_code == 400
    assert list(safe_resolve_staging_dir(repo.media_dir).iterdir()) == []

    avi_bytes = _make_video(tmp_path, "legacy.avi", vcodec="mpeg4")
    r_avi = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("legacy.avi", avi_bytes, "video/x-msvideo")},
    )
    assert r_avi.status_code == 400
    assert list(safe_resolve_staging_dir(repo.media_dir).iterdir()) == []

    mjpeg_mp4 = _make_video(tmp_path, "mjpeg.mp4", vcodec="mjpeg")
    r_mjpeg = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("mjpeg.mp4", mjpeg_mp4, "video/mp4")},
    )
    assert r_mjpeg.status_code == 400
    assert list(safe_resolve_staging_dir(repo.media_dir).iterdir()) == []

    # 2. Per-video size limit enforcement (413) leaves zero files in .staging/
    big_mp4 = _make_video(
        tmp_path,
        "large.mp4",
        vcodec="libx264",
        width=320,
        height=180,
        duration=1.5,
        extra_args=["-pix_fmt", "yuv420p", "-b:v", "600k"],
    )
    small_mp4 = _make_video(
        tmp_path,
        "small.mp4",
        vcodec="libx264",
        width=96,
        height=64,
        duration=0.2,
        extra_args=["-pix_fmt", "yuv420p", "-b:v", "40k"],
    )
    assert len(big_mp4) > len(small_mp4) + 5000

    monkeypatch.setattr(settings, "max_video_upload_mb", max(0.001, (len(big_mp4) - 2048) / (1024 * 1024)))
    r_over_cap = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("large.mp4", big_mp4, "video/mp4")},
    )
    assert r_over_cap.status_code == 413
    assert list(safe_resolve_staging_dir(repo.media_dir).iterdir()) == []

    # 3. Upload big_mp4, tighten quota right above usage (100% full), then replace with small_mp4 -> succeeds!
    monkeypatch.setattr(settings, "max_video_upload_mb", 15.0)
    r_ok = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("large.mp4", big_mp4, "video/mp4")},
        data={"label": "Big Clip"},
    )
    assert r_ok.status_code == 200
    wm = r_ok.json()["media"][0]
    used_now = get_user_media_usage_bytes(repo, player.id)

    # Set quota practically equal to current usage (still enough to store tiny diff? smaller is negative net_added!)
    monkeypatch.setattr(settings, "user_media_quota_mb", used_now / (1024 * 1024))

    # Another unlinked video exceeds quota -> 413
    r_second = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("extra.mp4", small_mp4, "video/mp4")},
        data={"label": "Extra"},
    )
    assert r_second.status_code == 413
    assert list(safe_resolve_staging_dir(repo.media_dir).iterdir()) == []

    # Swapping big_mp4 -> small_mp4 on the same linked_image_id reduces net usage (net_added <= 0) -> 200!
    r_swap = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("small.mp4", small_mp4, "video/mp4")},
        data={"linked_image_id": wm["id"]},
    )
    assert r_swap.status_code == 200
    wm_swapped = r_swap.json()["media"][0]
    assert wm_swapped["video_byte_size"] == len(small_mp4)
    assert client.get(wm["video_url"]).status_code == 404
    assert client.get(wm_swapped["video_url"]).status_code == 200
    assert get_user_media_usage_bytes(repo, player.id) < used_now


def test_admin_upload_toggles_public_guard_and_cascade_purge(
    media_env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reject private video on built-in image, enforce admin image/video upload toggles with admin exemption, and test cascade purge."""
    client, repo, actor, admin, player, _other, w_id, c_id, _p_id = media_env
    mp4_bytes = _make_video(tmp_path, "gov.mp4", vcodec="libx264", extra_args=["-pix_fmt", "yuv420p"])

    # 1. Seed a built-in public image + attach to world; private video targeting it must fail with 400
    pub_img_path = safe_resolve_asset_file_path(repo.media_dir, "images", "pub_v1_pad.webp")
    pub_img_path.parent.mkdir(parents=True, exist_ok=True)
    pub_img_path.write_bytes(b"RIFFpubimg")
    repo.register_media_asset(
        asset_id="pub_v1_pad",
        owner_id=None,
        entity_scope="world",
        media_type="image",
        role="world_scene",
        filename="pub_v1_pad.webp",
        mime_type="image/webp",
        byte_size=len(b"RIFFpubimg"),
        is_public=True,
        seed_key="showcase:gov:1",
    )
    repo.link_existing_world_media_asset(w_id, "pub_v1_pad")
    r_pub_vid = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("try_pub.mp4", mp4_bytes, "video/mp4")},
        data={"linked_image_id": "pub_v1_pad"},
    )
    assert r_pub_vid.status_code == 400

    # 2. Player uploads 1 standalone image + 1 video (with extracted image)
    r_img = client.post(
        f"/api/characters/{c_id}/gallery",
        files={"file": ("still.png", _png_bytes(), "image/png")},
        data={"caption": "Still"},
    )
    assert r_img.status_code == 200
    still_item = r_img.json()["gallery"][0]

    r_vid = client.post(
        f"/api/worlds/{w_id}/media/videos",
        files={"file": ("world_vid.mp4", mp4_bytes, "video/mp4")},
        data={"label": "Animated Scene"},
    )
    assert r_vid.status_code == 200
    vid_item = next(m for m in r_vid.json()["media"] if m["id"] != "pub_v1_pad")

    # 3. Admin disables image uploads & video uploads -> player gets 403; admin remains exempt!
    monkeypatch.setattr(settings, "allow_image_uploads", False)
    monkeypatch.setattr(settings, "allow_video_uploads", False)

    assert (
        client.post(
            f"/api/worlds/{w_id}/media",
            files={"file": ("blocked.png", _png_bytes(), "image/png")},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/characters/{c_id}/gallery/videos",
            files={"file": ("blocked.mp4", mp4_bytes, "video/mp4")},
        ).status_code
        == 403
    )

    actor[0] = admin
    admin_world = repo.create_world_from_draft(
        WorldWizardDraft(
            name="Admin World",
            global_rules=WorldGlobalRules(
                genre="Noir",
                tone="Dark",
                setting_overview="Tower.",
                tech_or_magic_rules="None.",
            ),
            locations=[
                LocationNodeDraft(
                    key="loc_a",
                    name="Room A",
                    summary="A",
                    description="D",
                    is_starting_location=True,
                )
            ],
            edges=[],
            lore_nodes=[],
        ),
        owner_id=admin.id,
    )
    assert (
        client.post(
            f"/api/worlds/{admin_world.id}/media",
            files={"file": ("ok_admin.png", _png_bytes(), "image/png")},
        ).status_code
        == 200
    )

    # 4. Non-admin cannot hit admin purge endpoints (403)
    actor[0] = player
    assert client.get("/api/admin/media/purge-preview?images=true&videos=true").status_code == 403
    assert (
        client.post("/api/admin/media/purge", json={"purge_images": False, "purge_videos": True}).status_code
        == 403
    )

    # 5. Admin purge preview + video-only purge leaves images intact
    actor[0] = admin
    pv_vid = client.get("/api/admin/media/purge-preview?images=false&videos=true").json()
    assert pv_vid["videos_count"] == 1
    assert pv_vid["images_count"] == 0
    assert pv_vid["cascade_videos_included"] is False

    # Images preview forces cascade_videos_included even when videos query param is false
    pv_img = client.get("/api/admin/media/purge-preview?images=true&videos=false").json()
    assert pv_img["images_count"] >= 3  # still_item + vid_item poster + ok_admin
    assert pv_img["videos_count"] == 1
    assert pv_img["cascade_videos_included"] is True

    res_vid_purge = client.post(
        "/api/admin/media/purge", json={"purge_images": False, "purge_videos": True}
    )
    assert res_vid_purge.status_code == 200
    assert res_vid_purge.json()["videos_deleted"] == 1
    assert res_vid_purge.json()["images_deleted"] == 0
    # Image assets remain intact
    actor[0] = player
    assert client.get(still_item["url"]).status_code == 200
    assert client.get(vid_item["url"]).status_code == 200
    assert client.get(vid_item["video_url"]).status_code == 404

    # 6. Upload another video then purge images=true, videos=false -> cascades and deletes all non-built-in images & videos, preserving built-in pub_v1_pad!
    monkeypatch.setattr(settings, "allow_video_uploads", True)
    assert (
        client.post(
            f"/api/worlds/{w_id}/media/videos",
            files={"file": ("v2.mp4", mp4_bytes, "video/mp4")},
        ).status_code
        == 200
    )
    actor[0] = admin
    res_all_purge = client.post(
        "/api/admin/media/purge", json={"purge_images": True, "purge_videos": False}
    )
    assert res_all_purge.status_code == 200
    assert res_all_purge.json()["images_deleted"] >= 3
    assert res_all_purge.json()["videos_deleted"] == 1
    assert res_all_purge.json()["bytes_reclaimed"] > 0

    # Built-in showcase image remains completely intact; player private quota becomes 0
    assert pub_img_path.is_file()
    assert client.get("/api/media/assets/pub_v1_pad").status_code == 200
    assert get_user_media_usage_bytes(repo, player.id) == 0
