"""Tests for v0.15.0 World Media Files, CoW Lifecycle, Quotas, Arrival Media & .zcc Packaging."""

from __future__ import annotations

import io
import os
import time
import uuid
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
from app.housekeeping.purge_inactive import ORPHAN_MEDIA_GRACE_SECONDS, _sweep_orphan_media_dirs
from app.schemas.auth import UserProfile
from app.schemas.character import BaselinePsyche, CharacterWizardDraft
from app.schemas.import_export import ImportCommitRequest
from app.schemas.turn import CampaignMapUpdatePayload
from app.schemas.world import (
    WorldGlobalRules,
    WorldUpdatePayload,
)
from app.security.media_path import (
    PathTraversalError,
    safe_resolve_asset_file_path,
    safe_resolve_world_media_file_path,
)
from app.services.import_export_service import (
    build_zcc_export,
    commit_staged_import,
    inspect_uploaded_file,
)


def _make_png_bytes(width: int = 160, height: int = 90, color: tuple[int, int, int] = (20, 140, 190)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color)
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_user(repo: CantinaRepository, username: str, role: str = "user") -> UserProfile:
    return repo.create_user(
        username=username,
        display_name=username.title(),
        password_hash="hash",
        role=role,
    )


def _seed_world_and_char(
    repo: CantinaRepository,
    owner_id: str,
    *,
    describe_default: bool = True,
    char_initial_message: str = "Welcome inside.",
):
    w_id = f"world_wm_{uuid.uuid4().hex[:8]}"
    c_id = f"char_wm_{uuid.uuid4().hex[:8]}"
    now = "2026-01-01T00:00:00Z"
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                w_id,
                owner_id,
                "Harbor City",
                WorldGlobalRules(
                    genre="Noir",
                    tone="Rain-slicked",
                    setting_overview="Neon docks and brass towers.",
                    tech_or_magic_rules="Steam and cybernetics.",
                    describe_on_first_visit=describe_default,
                ).model_dump_json(),
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO location_containers (
                id, world_id, created_at_turn_id, parent_container_id, depth, name,
                description, environmental_tags_json, created_at
            )
            VALUES (?, ?, NULL, NULL, 1, 'Dockside Warehouse', 'Salt and rust.', '["docks"]', ?)
            """,
            (f"cont_{w_id}", w_id, now),
        )
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, container_id, name, summary, description,
                environmental_tags_json, is_starting_location, is_hub, is_entry_exit, starting_message
            )
            VALUES (?, ?, NULL, NULL, 'Pier Gate', 'Start gate.', 'Mist drifts off the pier.', '["pier"]', 1, 0, 1, '')
            """,
            (f"loc_start_{w_id}", w_id),
        )
        conn.execute(
            """
            INSERT INTO location_nodes (
                id, world_id, created_at_turn_id, container_id, name, summary, description,
                environmental_tags_json, is_starting_location, is_hub, is_entry_exit, starting_message
            )
            VALUES (?, ?, NULL, ?, 'Boiler Room', 'Dim boiler room.', '', '[]', 0, 0, 1, '')
            """,
            (f"loc_dest_{w_id}", w_id, f"cont_{w_id}"),
        )
        conn.execute(
            """
            INSERT INTO location_edges (
                id, world_id, from_location_id, to_location_id, direction_label, compass_direction, distance_meters, is_blocked, is_secret
            )
            VALUES (?, ?, ?, ?, 'Enter warehouse', 'N', 140, 0, 0),
                   (?, ?, ?, ?, 'Back to pier', 'S', 140, 0, 0)
            """,
            (
                f"edge_fwd_{w_id}",
                w_id,
                f"loc_start_{w_id}",
                f"loc_dest_{w_id}",
                f"edge_rev_{w_id}",
                w_id,
                f"loc_dest_{w_id}",
                f"loc_start_{w_id}",
            ),
        )
        conn.commit()
    finally:
        conn.close()

    repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Vex",
            tagline="Harbor fixer",
            core_persona="Sharp and observant.",
            initial_message=char_initial_message,
            baseline_psyche=BaselinePsyche(
                core_drive="Survive the harbor.",
                core_fear="Drowning.",
                default_want="Watch the docks.",
                default_plan="Stay alert.",
            ),
        ),
        world_id=w_id,
        character_id=c_id,
        owner_id=owner_id,
    )
    return w_id, c_id, f"cont_{w_id}", f"loc_start_{w_id}", f"loc_dest_{w_id}"


def _setup_client_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = str(tmp_path / "wm_test.db")
    media_root = str(tmp_path / "media")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", media_root)
    monkeypatch.setattr(settings, "embedding_profile", settings.embedding_profile.model_copy(update={"mode": "local_hash"}))
    repo = CantinaRepository(db_file, media_dir=media_root)
    repo.init_db()
    return repo


def test_world_media_path_confinement(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        safe_resolve_world_media_file_path(tmp_path, "images", "../escape.webp")
    with pytest.raises(ValueError):
        safe_resolve_world_media_file_path(tmp_path, "portraits", "a.webp")
    with pytest.raises(ValueError):
        safe_resolve_world_media_file_path(tmp_path, "images", ".hidden.webp")
    # Symlink escape check raises PathTraversalError
    img_dir = tmp_path / "worlds" / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    outside = tmp_path / "secret.webp"
    outside.write_bytes(b"secret")
    link = img_dir / "link.webp"
    link.symlink_to(outside)
    with pytest.raises(PathTraversalError):
        safe_resolve_world_media_file_path(tmp_path, "images", "link.webp")


def test_world_media_upload_label_reorder_quota_and_access(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _setup_client_repo(tmp_path, monkeypatch)
    owner = _make_user(repo, "alice")
    other = _make_user(repo, "bob")
    w_id, _c_id, _cont_id, _s_id, _d_id = _seed_world_and_char(repo, owner.id)

    current_actor = [owner]
    main_module.app.dependency_overrides[get_current_user] = lambda: current_actor[0]
    try:
        with TestClient(main_module.app) as client:
            # 1. Upload landscape PNG -> converted to WebP preserving aspect ratio (not square-cropped)
            png_bytes = _make_png_bytes(320, 180)
            resp1 = client.post(
                f"/api/worlds/{w_id}/media",
                files={"file": ("harbor_dawn.png", png_bytes, "image/png")},
                data={"label": ""},
            )
            assert resp1.status_code == 200, resp1.text
            w_data = resp1.json()
            assert len(w_data["media"]) == 1
            m1 = w_data["media"][0]
            assert m1["label"] == "harbor_dawn"
            assert m1["url"].startswith("/api/media/assets/")
            assert m1["byte_size"] > 0

            # Verify non-square dimensions preserved
            disk_path = safe_resolve_asset_file_path(
                repo.media_dir, "images", f"{m1['id']}.webp"
            )
            with Image.open(disk_path) as saved_img:
                assert saved_img.size == (320, 180)

            # 2. Quota accounting includes world media
            assert get_user_media_usage_bytes(repo, owner.id) == m1["byte_size"]

            # 3. Authorized GET succeeds; unauthorized GET returns 404
            assert client.get(m1["url"]).status_code == 200
            current_actor[0] = other
            assert client.get(m1["url"]).status_code == 404
            current_actor[0] = owner

            # 4. Upload second image & reorder primary
            resp2 = client.post(
                f"/api/worlds/{w_id}/media",
                files={"file": ("dock_night.png", _make_png_bytes(200, 100, (90, 20, 150)), "image/png")},
                data={"label": "Night Docks"},
            )
            assert resp2.status_code == 200
            m2 = resp2.json()["media"][1]
            assert m2["label"] == "Night Docks"

            resp_re = client.put(
                f"/api/worlds/{w_id}/media/reorder",
                json={"ordered_media_ids": [m2["id"], m1["id"]]},
            )
            assert resp_re.status_code == 200
            assert [m["id"] for m in resp_re.json()["media"]] == [m2["id"], m1["id"]]

            # 5. Rename label
            resp_lbl = client.patch(
                f"/api/worlds/{w_id}/media/{m1['id']}",
                json={"label": "Dawn Harbor"},
            )
            assert resp_lbl.status_code == 200
            assert next(m for m in resp_lbl.json()["media"] if m["id"] == m1["id"])["label"] == "Dawn Harbor"

            # 6. Quota exceeded (413)
            monkeypatch.setattr(settings, "user_media_quota_mb", 0.0001)
            resp_quota = client.post(
                f"/api/worlds/{w_id}/media",
                files={"file": ("too_big.png", _make_png_bytes(400, 300), "image/png")},
            )
            assert resp_quota.status_code == 413
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def test_world_media_cow_isolation_cross_fork_delete_and_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _setup_client_repo(tmp_path, monkeypatch)
    owner = _make_user(repo, "alice")
    w_id, c_id, cont_id, start_id, dest_id = _seed_world_and_char(repo, owner.id)

    main_module.app.dependency_overrides[get_current_user] = lambda: owner
    try:
        with TestClient(main_module.app) as client:
            r_up = client.post(
                f"/api/worlds/{w_id}/media",
                files={"file": ("pier.png", _make_png_bytes(160, 90), "image/png")},
                data={"label": "Foggy Pier"},
            )
            assert r_up.status_code == 200
            m_id = r_up.json()["media"][0]["id"]
            m_url = r_up.json()["media"][0]["url"]

            # Link image to start_id before launching campaign
            w_orig = repo.get_world(w_id, base_only=True, owner_id=owner.id)
            updated_locs = [
                loc.model_copy(update={"image_media_id": m_id})
                if loc.id == start_id
                else loc
                for loc in w_orig.locations
            ]
            w_linked = repo.update_world(
                w_id,
                WorldUpdatePayload(
                    name=w_orig.name,
                    global_rules=w_orig.global_rules,
                    containers=w_orig.containers,
                    locations=updated_locs,
                    edges=w_orig.edges,
                    lore_nodes=w_orig.lore_nodes,
                ),
                owner_id=owner.id,
            )
            assert w_linked.id == w_id

            # Start campaign on w_id (Turn 0 must always emit first_visit_media)
            camp = repo.create_campaign(
                name="Run 1",
                world_id=w_id,
                character_id=c_id,
                owner_id=owner.id,
                start_focus="world",
            )
            bundle = repo.get_campaign_state_bundle(camp.id, owner_id=owner.id)
            turn0_media = bundle.active_branch_turns[0].post_turn.first_visit_media
            assert len(turn0_media) == 1
            assert turn0_media[0].media_id == m_id
            assert turn0_media[0].label == "Foggy Pier"

            # Upload a second image while campaign runs -> CoW-forks w_id -> w_v2, zero disk duplication
            r_up2 = client.post(
                f"/api/worlds/{w_id}/media",
                files={"file": ("boiler.png", _make_png_bytes(160, 90, (120, 40, 20)), "image/png")},
                data={"label": "Boiler"},
            )
            assert r_up2.status_code == 200
            w_v2 = r_up2.json()
            w_v2_id = w_v2["id"]
            assert w_v2_id != w_id
            m2_id = w_v2["media"][1]["id"]

            # Campaign still pinned to original w_id without m2_id
            camp_world_orig = repo.get_world(w_id, base_only=True)
            assert [m.id for m in camp_world_orig.media] == [m_id]

            # Usage check on w_v2 for m_id warns about Campaign 1 on sibling fork w_id!
            r_imp = client.get(f"/api/worlds/{w_v2_id}/media/{m_id}/impact")
            assert r_imp.status_code == 200
            assert r_imp.json()["campaigns_using"] == 1

            r_wimp = client.get(f"/api/worlds/{w_v2_id}/delete-impact")
            assert r_wimp.status_code == 200
            assert r_wimp.json()["campaigns_using"] == 0
            assert r_wimp.json()["sibling_campaigns_sharing_media"] == 1

            # Unlink m_id from start_id on w_v2 and link m2_id to dest_id -> campaign retains m_id on start_id
            w_v2_obj = repo.get_world(w_v2_id, base_only=True, owner_id=owner.id)
            repo.update_world(
                w_v2_id,
                WorldUpdatePayload(
                    name=w_v2_obj.name,
                    global_rules=w_v2_obj.global_rules,
                    containers=w_v2_obj.containers,
                    locations=[
                        loc.model_copy(update={"image_media_id": None})
                        if loc.id == start_id
                        else loc.model_copy(update={"image_media_id": m2_id})
                        if loc.id == dest_id
                        else loc
                        for loc in w_v2_obj.locations
                    ],
                    edges=w_v2_obj.edges,
                    lore_nodes=w_v2_obj.lore_nodes,
                ),
                owner_id=owner.id,
            )
            bundle_after_edit = repo.get_campaign_state_bundle(camp.id, owner_id=owner.id)
            assert bundle_after_edit.active_location.image_media_id == m_id
            assert len(bundle_after_edit.active_branch_turns[0].post_turn.first_visit_media) == 1

            # Mid-campaign update_campaign_map must preserve existing image_media_id
            bundle_after_map = repo.update_campaign_map(
                camp.id,
                CampaignMapUpdatePayload(
                    containers=[
                        c.model_copy(update={"image_media_id": m2_id})
                        for c in bundle_after_edit.containers
                    ],
                    locations=[
                        l.model_copy(update={"image_media_id": None})
                        for l in bundle_after_edit.visible_locations
                    ],
                    edges=bundle_after_edit.visible_edges,
                ),
                owner_id=owner.id,
            )
            camp_start_loc = next(l for l in bundle_after_map.visible_locations if l.id == start_id)
            assert camp_start_loc.image_media_id == m_id

            # Hard-delete m_id on w_v2 -> disk file unlinked immediately, quota drops, campaign degrades cleanly
            before_bytes = get_user_media_usage_bytes(repo, owner.id)
            r_del = client.delete(f"/api/worlds/{w_v2_id}/media/{m_id}")
            assert r_del.status_code == 200
            after_bytes = get_user_media_usage_bytes(repo, owner.id)
            assert after_bytes < before_bytes

            disk_m1 = safe_resolve_asset_file_path(
                repo.media_dir, "images", f"{m_id}.webp"
            )
            assert not disk_m1.exists()

            bundle_after_del = repo.get_campaign_state_bundle(camp.id, owner_id=owner.id)
            assert bundle_after_del.active_location.image_media_id is None
            assert bundle_after_del.active_branch_turns[0].post_turn.first_visit_media == []

            # Deleting campaign & pruning pending_deletion worlds cleans up m2_id if world deleted too
            repo.delete_campaign(camp.id, owner_id=owner.id)
            repo.mark_world_pending_deletion(w_v2_id, owner_id=owner.id)
            pruned = repo.prune_pending_deletion_worlds()
            assert w_id in pruned and w_v2_id in pruned
            assert get_user_media_usage_bytes(repo, owner.id) == 0
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def test_arrival_media_dedup_descriptionless_and_manual_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _setup_client_repo(tmp_path, monkeypatch)
    owner = _make_user(repo, "alice")
    w_id, c_id, cont_id, start_id, dest_id = _seed_world_and_char(repo, owner.id)

    # Create two media files directly on disk + DB
    fn1 = "wmed_shared01.webp"
    fn2 = "wmed_room02.webp"
    p1 = safe_resolve_world_media_file_path(repo.media_dir, "images", fn1)
    p2 = safe_resolve_world_media_file_path(repo.media_dir, "images", fn2)
    p1.parent.mkdir(parents=True, exist_ok=True)
    p1.write_bytes(_make_png_bytes())
    p2.write_bytes(_make_png_bytes())
    repo.add_world_media(w_id, media_id="wmed_shared01", filename=fn1, label="Warehouse Ext", mime_type="image/webp", byte_size=p1.stat().st_size, owner_id=owner.id)
    repo.add_world_media(w_id, media_id="wmed_room02", filename=fn2, label="", mime_type="image/webp", byte_size=p2.stat().st_size, owner_id=owner.id)

    w_orig = repo.get_world(w_id, base_only=True, owner_id=owner.id)
    # Test 1: Same media linked on container and location -> deduplicated to 1 slide
    c_list = [c.model_copy(update={"image_media_id": "wmed_shared01"}) for c in w_orig.containers]
    l_list = [
        l.model_copy(update={"image_media_id": "wmed_shared01"}) if l.id == dest_id else l
        for l in w_orig.locations
    ]
    w_dedup = repo.update_world(
        w_id,
        WorldUpdatePayload(
            name=w_orig.name,
            global_rules=w_orig.global_rules,
            containers=c_list,
            locations=l_list,
            edges=w_orig.edges,
            lore_nodes=w_orig.lore_nodes,
        ),
        owner_id=owner.id,
    )
    dest_obj = next(l for l in w_dedup.locations if l.id == dest_id)
    cards, media_items, _, _ = build_first_visit_arrival_bundle(
        target_location=dest_obj,
        containers=w_dedup.containers,
        locations=w_dedup.locations,
        prev_visited_locations=[start_id],
        prev_visited_containers=[],
        describe_on_first_visit=True,
    )
    assert len(media_items) == 1
    assert media_items[0].entity_id == dest_id  # innermost kept

    # Test 2: Distinct images + descriptionless dest_id still emits arrival_media via override_campaign_location
    l_list2 = [
        l.model_copy(update={"image_media_id": "wmed_room02"}) if l.id == dest_id else l
        for l in w_dedup.locations
    ]
    repo.update_world(
        w_id,
        WorldUpdatePayload(
            name=w_dedup.name,
            global_rules=w_dedup.global_rules,
            containers=w_dedup.containers,
            locations=l_list2,
            edges=w_dedup.edges,
            lore_nodes=w_dedup.lore_nodes,
        ),
        owner_id=owner.id,
    )
    camp = repo.create_campaign(name="Arrival Test", world_id=w_id, character_id=c_id, owner_id=owner.id)
    bundle_after_move = repo.override_campaign_location(camp.id, dest_id, owner_id=owner.id)
    leaf = bundle_after_move.active_branch_turns[-1]
    assert leaf.actor_id == "__arrival__"
    assert leaf.post_turn is not None
    assert len(leaf.post_turn.first_visit_media) == 2
    assert [m.entity_id for m in leaf.post_turn.first_visit_media] == [cont_id, dest_id]
    assert leaf.post_turn.first_visit_media[0].label == "Warehouse Ext"
    # Blank label falls back to location name
    assert leaf.post_turn.first_visit_media[1].label == "Boiler Room"


@pytest.mark.asyncio
async def test_world_media_zcc_export_import_and_orphan_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _setup_client_repo(tmp_path, monkeypatch)
    owner = _make_user(repo, "alice")
    importer = _make_user(repo, "bob")
    w_id, _c_id, cont_id, start_id, _dest_id = _seed_world_and_char(repo, owner.id)

    fn = "wmed_exp01.webp"
    fpath = safe_resolve_world_media_file_path(repo.media_dir, "images", fn)
    fpath.parent.mkdir(parents=True, exist_ok=True)
    fpath.write_bytes(_make_png_bytes(160, 90))
    repo.add_world_media(
        w_id,
        media_id="wmed_exp01",
        filename=fn,
        label="Exported Scene",
        mime_type="image/webp",
        byte_size=fpath.stat().st_size,
        owner_id=owner.id,
    )
    w_orig = repo.get_world(w_id, base_only=True, owner_id=owner.id)
    repo.update_world(
        w_id,
        WorldUpdatePayload(
            name=w_orig.name,
            global_rules=w_orig.global_rules,
            containers=[c.model_copy(update={"image_media_id": "wmed_exp01"}) for c in w_orig.containers],
            locations=[
                l.model_copy(update={"image_media_id": "wmed_exp01"}) if l.id == start_id else l
                for l in w_orig.locations
            ],
            edges=w_orig.edges,
            lore_nodes=w_orig.lore_nodes,
        ),
        owner_id=owner.id,
    )

    # 1. Export WITH media
    zcc_with_media = build_zcc_export(
        repo=repo,
        character_ids=[],
        world_ids=[w_id],
        persona_ids=[],
        owner_id=owner.id,
        include_world_media=True,
    )
    insp_with = inspect_uploaded_file(repo, zcc_with_media, "world_with.zcc", importer.id)
    res_with = await commit_staged_import(
        repo, ImportCommitRequest(staged_token=insp_with.staged_token), importer.id
    )
    assert res_with.success
    bob_worlds = repo.list_worlds(owner_id=importer.id)
    assert len(bob_worlds) == 1
    bw = bob_worlds[0]
    assert len(bw.media) == 1
    assert bw.media[0].id != "wmed_exp01"
    assert bw.media[0].label == "Exported Scene"
    assert bw.containers[0].image_media_id == bw.media[0].id
    assert next(l for l in bw.locations if l.name == "Pier Gate").image_media_id == bw.media[0].id

    # 2. Export WITHOUT media clears links & omits binaries
    zcc_no_media = build_zcc_export(
        repo=repo,
        character_ids=[],
        world_ids=[w_id],
        persona_ids=[],
        owner_id=owner.id,
        include_world_media=False,
    )
    insp_no = inspect_uploaded_file(repo, zcc_no_media, "world_no.zcc", importer.id)
    assert insp_no.manifest is not None
    assert insp_no.manifest.contents.media_files_count == 0
    res_no = await commit_staged_import(
        repo,
        ImportCommitRequest(
            staged_token=insp_no.staged_token,
            default_conflict_strategy="copy",
        ),
        importer.id,
    )
    assert res_no.success
    bw_no = next(w for w in repo.list_worlds(owner_id=importer.id) if w.id != bw.id)
    assert bw_no.media == []
    assert bw_no.containers[0].image_media_id is None

    # 3. Orphan sweep removes stale unreferenced files; reset_user_data clears world media on disk
    orphan_file = safe_resolve_asset_file_path(repo.media_dir, "images", "wmed_orphan99.webp")
    orphan_file.parent.mkdir(parents=True, exist_ok=True)
    orphan_file.write_bytes(b"orphan")
    old_ts = time.time() - ORPHAN_MEDIA_GRACE_SECONDS - 120
    os.utime(orphan_file, (old_ts, old_ts))
    swept = _sweep_orphan_media_dirs(repo)
    assert swept >= 1
    assert not orphan_file.exists()

    assert get_user_media_usage_bytes(repo, owner.id) > 0
    repo.reset_user_data(owner.id)
    assert get_user_media_usage_bytes(repo, owner.id) == 0
