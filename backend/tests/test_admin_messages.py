"""Integration tests for Admin Communication Messages, Archive/Restore, and Chloromancer purge."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.housekeeping import chloromancer_scheduler, run_admin_messages_purge


def _iso_offset(**kwargs: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(**kwargs)).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture()
def msg_env(
    api_env: tuple[TestClient, CantinaRepository, Path],
    no_showcase_seeding: None,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, CantinaRepository]:
    admin_client, repo, _media_dir = api_env
    monkeypatch.setattr(settings, "allow_self_registration", True)

    setup_res = admin_client.post(
        "/api/auth/setup",
        json={
            "username": "AdminRoot",
            "display_name": "Root Admin",
            "password": "AdminPassword123!",
        },
    )
    assert setup_res.status_code == 200
    return admin_client, repo


def test_crud_versioning_placement_and_unauthenticated_login_delivery(
    msg_env: tuple[TestClient, CantinaRepository],
) -> None:
    admin_client, _repo = msg_env
    anon_client = TestClient(main_module.app)

    # Create login-only, home-only, and both messages
    res_login = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "login",
            "title": "Login Notice",
            "message": "Sign in notice body",
            "urgency": "info",
            "dismissable": True,
        },
    )
    assert res_login.status_code == 200
    login_msg = res_login.json()
    assert login_msg["revision"] == 1
    assert login_msg["status"] == "live"

    res_home = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "home",
            "title": "Home Warning",
            "message": "Check your settings.",
            "urgency": "warning",
            "dismissable": False,
        },
    )
    assert res_home.status_code == 200

    res_both = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Outage Alert",
            "message": "Maintenance at 22:00 UTC.",
            "urgency": "critical",
            "dismissable": True,
        },
    )
    assert res_both.status_code == 200
    both_id = res_both.json()["id"]

    # Unauthenticated /api/auth/status delivers login + both ordered critical -> info
    auth_status = anon_client.get("/api/auth/status").json()
    login_titles = [m["title"] for m in auth_status["login_messages"]]
    assert login_titles == ["Outage Alert", "Login Notice"]
    # Public payload strips internal fields
    assert "deleted_at" not in auth_status["login_messages"][0]
    assert "starts_at" not in auth_status["login_messages"][0]

    # Standard user sees home + both ordered critical -> warning
    user_client = TestClient(main_module.app)
    reg_res = user_client.post(
        "/api/auth/register",
        json={"username": "player1", "password": "PlayerPassword123!"},
    )
    assert reg_res.status_code == 200

    home_res = user_client.get("/api/messages/home")
    assert home_res.status_code == 200
    assert [m["title"] for m in home_res.json()] == ["Outage Alert", "Home Warning"]

    # Standard user cannot access admin message routes
    assert user_client.get("/api/admin/messages").status_code == 403
    assert (
        user_client.post(
            "/api/admin/messages",
            json={
                "placement": "home",
                "title": "Nope",
                "message": "Blocked",
                "urgency": "info",
                "dismissable": True,
            },
        ).status_code
        == 403
    )

    # Updating keeps stable id and bumps revision
    upd_res = admin_client.put(
        f"/api/admin/messages/{both_id}",
        json={
            "placement": "both",
            "title": "Outage Alert (Extended)",
            "message": "Maintenance extended by 30 minutes.",
            "urgency": "critical",
            "dismissable": True,
            "starts_at": None,
            "expires_at": None,
        },
    )
    assert upd_res.status_code == 200
    updated = upd_res.json()
    assert updated["id"] == both_id
    assert updated["revision"] == 2


def test_reorder_within_urgency_preserves_revision_and_blocks_cross_urgency(
    msg_env: tuple[TestClient, CantinaRepository],
) -> None:
    admin_client, _repo = msg_env

    m1 = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Warning One",
            "message": "First",
            "urgency": "warning",
            "dismissable": True,
        },
    ).json()
    m2 = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Warning Two",
            "message": "Second",
            "urgency": "warning",
            "dismissable": True,
        },
    ).json()
    c1 = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Critical One",
            "message": "Urgent",
            "urgency": "critical",
            "dismissable": False,
        },
    ).json()

    # Cross-urgency reorder must be rejected
    bad_reorder = admin_client.put(
        "/api/admin/messages/reorder",
        json={"urgency": "warning", "ordered_ids": [m2["id"], c1["id"], m1["id"]]},
    )
    assert bad_reorder.status_code == 400

    # Valid reorder within warning group preserves revision=1
    ok_reorder = admin_client.put(
        "/api/admin/messages/reorder",
        json={"urgency": "warning", "ordered_ids": [m2["id"], m1["id"]]},
    )
    assert ok_reorder.status_code == 200
    reordered = ok_reorder.json()
    assert [m["title"] for m in reordered] == [
        "Critical One",
        "Warning Two",
        "Warning One",
    ]
    assert all(m["revision"] == 1 for m in reordered)

    anon_client = TestClient(main_module.app)
    login_titles = [
        m["title"] for m in anon_client.get("/api/auth/status").json()["login_messages"]
    ]
    assert login_titles == ["Critical One", "Warning Two", "Warning One"]


def test_effective_dates_validation_and_archive_restore_flow(
    msg_env: tuple[TestClient, CantinaRepository],
) -> None:
    admin_client, repo = msg_env

    # Until in the past must be rejected on create
    past_res = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Past",
            "message": "Already expired",
            "urgency": "info",
            "dismissable": True,
            "starts_at": None,
            "expires_at": _iso_offset(hours=-1),
        },
    )
    assert past_res.status_code == 422

    # Until <= From must be rejected
    inverted_res = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Inverted",
            "message": "Bad range",
            "urgency": "info",
            "dismissable": True,
            "starts_at": _iso_offset(hours=5),
            "expires_at": _iso_offset(hours=2),
        },
    )
    assert inverted_res.status_code == 422

    # Future-scheduled message appears in admin active as 'scheduled' but not on login/home yet
    future_msg = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "both",
            "title": "Future Maintenance",
            "message": "Starts tomorrow",
            "urgency": "warning",
            "dismissable": True,
            "starts_at": _iso_offset(days=1),
            "expires_at": _iso_offset(days=2),
        },
    ).json()
    assert future_msg["status"] == "scheduled"
    assert admin_client.get("/api/messages/home").json() == []

    # Live message -> soft delete -> moves to Archived -> Edit & Restore bumps revision
    live_msg = admin_client.post(
        "/api/admin/messages",
        json={
            "placement": "home",
            "title": "Live Banner",
            "message": "Hello world",
            "urgency": "info",
            "dismissable": True,
        },
    ).json()
    assert len(admin_client.get("/api/messages/home").json()) == 1

    del_res = admin_client.delete(f"/api/admin/messages/{live_msg['id']}")
    assert del_res.status_code == 200
    assert admin_client.get("/api/messages/home").json() == []

    lists = admin_client.get("/api/admin/messages").json()
    assert [m["id"] for m in lists["archived"]] == [live_msg["id"]]
    assert lists["archived"][0]["status"] == "deleted"

    restored = admin_client.put(
        f"/api/admin/messages/{live_msg['id']}",
        json={
            "placement": "home",
            "title": "Live Banner Restored",
            "message": "Back again",
            "urgency": "info",
            "dismissable": True,
            "starts_at": None,
            "expires_at": None,
        },
    ).json()
    assert restored["id"] == live_msg["id"]
    assert restored["revision"] == 2
    assert restored["deleted_at"] is None
    assert restored["status"] == "live"
    assert len(admin_client.get("/api/messages/home").json()) == 1

    # Simulate an expired message in DB; editing without clearing/updating past Until fails,
    # while clearing Until restores it to Active with revision + 1
    expired_row = repo.create_admin_message(
        placement="login",
        title="Old Expired Notice",
        message="Past window",
        urgency="info",
        dismissable=True,
        starts_at=None,
        expires_at=_iso_offset(hours=-2),
    )
    archived_ids = {
        m["id"]: m["status"]
        for m in admin_client.get("/api/admin/messages").json()["archived"]
    }
    assert archived_ids[expired_row["id"]] == "expired"

    fail_restore = admin_client.put(
        f"/api/admin/messages/{expired_row['id']}",
        json={
            "placement": "login",
            "title": "Old Expired Notice",
            "message": "Still expired",
            "urgency": "info",
            "dismissable": True,
            "starts_at": None,
            "expires_at": _iso_offset(hours=-1),
        },
    )
    assert fail_restore.status_code == 422

    ok_restore = admin_client.put(
        f"/api/admin/messages/{expired_row['id']}",
        json={
            "placement": "login",
            "title": "Renewed Notice",
            "message": "Now active",
            "urgency": "info",
            "dismissable": True,
            "starts_at": None,
            "expires_at": None,
        },
    )
    assert ok_restore.status_code == 200
    assert ok_restore.json()["status"] == "live"
    assert ok_restore.json()["revision"] == 2


def test_single_user_mode_suppresses_messages_and_setup_gate(
    api_env: tuple[TestClient, CantinaRepository, Path],
    no_showcase_seeding: None,
) -> None:
    client, repo, _media_dir = api_env

    # Seed a message row directly in DB to confirm single-user mode still hides it
    repo.create_admin_message(
        placement="both",
        title="Should Stay Hidden",
        message="Hidden in single-user mode",
        urgency="critical",
        dismissable=False,
    )

    # Before setup completes, login_messages must be empty
    pre_status = client.get("/api/auth/status").json()
    assert pre_status["setup_required"] is True
    assert pre_status["login_messages"] == []

    # Complete setup with blank password -> single_user_mode=True
    setup_res = client.post(
        "/api/auth/setup",
        json={
            "username": "localadmin",
            "display_name": "Local Admin",
            "password": "",
            "confirm_blank_password": True,
        },
    )
    assert setup_res.status_code == 200

    single_status = client.get("/api/auth/status").json()
    assert single_status["single_user_mode"] is True
    assert single_status["login_messages"] == []
    assert client.get("/api/messages/home").json() == []
    assert client.get("/api/admin/messages").status_code == 403


def test_chloromancer_purges_deleted_and_expired_messages_older_than_7_days(
    msg_env: tuple[TestClient, CantinaRepository],
) -> None:
    _admin_client, repo = msg_env

    old_deleted = repo.create_admin_message(
        placement="both",
        title="Old Deleted",
        message="Deleted 8 days ago",
        urgency="info",
    )
    recent_deleted = repo.create_admin_message(
        placement="both",
        title="Recent Deleted",
        message="Deleted 3 days ago",
        urgency="info",
    )
    old_expired = repo.create_admin_message(
        placement="home",
        title="Old Expired",
        message="Expired 9 days ago",
        urgency="warning",
        expires_at=_iso_offset(days=-9),
    )
    recent_expired = repo.create_admin_message(
        placement="home",
        title="Recent Expired",
        message="Expired 2 days ago",
        urgency="warning",
        expires_at=_iso_offset(days=-2),
    )
    live_msg = repo.create_admin_message(
        placement="login",
        title="Active Forever",
        message="Still live",
        urgency="critical",
    )

    repo.soft_delete_admin_message(old_deleted["id"], now_iso=_iso_offset(days=-8))
    repo.soft_delete_admin_message(recent_deleted["id"], now_iso=_iso_offset(days=-3))

    # Registered in ChloromancerScheduler and always enabled
    status_bundle = chloromancer_scheduler.get_status(repo, limit=10)
    purge_job = next(
        (j for j in status_bundle.jobs if j.job_id == "purge_admin_messages"),
        None,
    )
    assert purge_job is not None
    assert purge_job.enabled is True

    run_record = run_admin_messages_purge(repo, trigger="manual", actor_user_id="admin")
    assert run_record["status"] == "ok"
    assert run_record["items_affected"] == 2
    assert run_record["details"]["deleted_purged"] == 1
    assert run_record["details"]["expired_purged"] == 1

    assert repo.get_admin_message(old_deleted["id"]) is None
    assert repo.get_admin_message(old_expired["id"]) is None
    assert repo.get_admin_message(recent_deleted["id"]) is not None
    assert repo.get_admin_message(recent_expired["id"]) is not None
    assert repo.get_admin_message(live_msg["id"]) is not None
