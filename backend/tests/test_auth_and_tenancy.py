"""Unit and integration tests for Phase 1 Multi-Tenancy, Auth, Passkeys, Sessions, and Admin Area."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
import webauthn

from app import auth as auth_module
from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed


@pytest.fixture()
def auth_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, CantinaRepository]:
    """Provide an isolated FastAPI TestClient and CantinaRepository with an empty users table."""
    db_file = str(tmp_path / "test_auth_cantina.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")

    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)

    client = TestClient(main_module.app)
    return client, repo


def test_first_time_setup_blank_password_and_single_user_transition(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify first-time setup with blank password confirmation, auto-login, and transition to multi-user."""
    client, _repo = auth_client

    # 1. Before any user exists, status reports setup_required=True and API routes reject unauthenticated access
    status_res = client.get("/api/auth/status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["setup_required"] is True
    assert status_data["authenticated"] is False

    unauth_worlds = client.get("/api/worlds")
    assert unauth_worlds.status_code == 401

    # 2. Attempting blank-password setup WITHOUT confirm_blank_password=True is rejected with warning
    bad_setup = client.post(
        "/api/auth/setup",
        json={
            "username": "AdminLocal",
            "display_name": "Local Admin",
            "password": "",
            "confirm_blank_password": False,
        },
    )
    assert bad_setup.status_code == 400
    assert "disable multi-user support" in bad_setup.json()["detail"]

    # 3. Confirming blank password creates the admin account and enables single-user mode
    ok_setup = client.post(
        "/api/auth/setup",
        json={
            "username": "AdminLocal",
            "display_name": "Local Admin",
            "password": "",
            "confirm_blank_password": True,
        },
    )
    assert ok_setup.status_code == 200
    setup_session = ok_setup.json()
    assert setup_session["single_user_mode"] is True
    assert setup_session["user"]["username"] == "AdminLocal"
    assert setup_session["user"]["role"] == "admin"
    assert setup_session["user"]["has_password"] is False

    # 4. Subsequent accesses with a brand-new unauthenticated client auto-log in as the blank-password admin
    fresh_client = TestClient(main_module.app)
    auto_status = fresh_client.get("/api/auth/status").json()
    assert auto_status["setup_required"] is False
    assert auto_status["single_user_mode"] is True
    assert auto_status["authenticated"] is True
    assert auto_status["user"]["username"] == "AdminLocal"

    # Seeded entities were claimed by the initial admin and are accessible immediately
    worlds_res = fresh_client.get("/api/worlds")
    assert worlds_res.status_code == 200
    assert len(worlds_res.json()) >= 1

    # 5. Creating new users while in blank-password single-user mode is blocked (both self-register and admin create)
    reg_blocked = fresh_client.post(
        "/api/auth/register",
        json={"username": "player2", "password": "StrongPassword123!"},
    )
    assert reg_blocked.status_code == 403

    admin_create_blocked = fresh_client.post(
        "/api/admin/users",
        json={"username": "player2", "password": "StrongPassword123!"},
    )
    assert admin_create_blocked.status_code == 403

    # 6. Admin sets a password later in Profile -> re-enables multi-user functionality
    set_pw_res = client.post(
        "/api/profile/password",
        json={
            "current_password": "",
            "new_password": "AdminSecurePassword99!",
            "confirm_blank_password": False,
        },
    )
    assert set_pw_res.status_code == 200
    assert set_pw_res.json()["user"]["has_password"] is True
    assert set_pw_res.json()["single_user_mode"] is False

    # Single-user mode is now disabled
    status_after_pw = client.get("/api/auth/status").json()
    assert status_after_pw["single_user_mode"] is False

    # Unauthenticated client is no longer auto-logged in
    unauth_client = TestClient(main_module.app)
    assert unauth_client.get("/api/worlds").status_code == 401

    # 7. Now that multi-user mode is enabled, a second user can register
    reg_ok = unauth_client.post(
        "/api/auth/register",
        json={
            "username": "alice",
            "display_name": "Alice Runner",
            "password": "AlicePassword123!",
        },
    )
    assert reg_ok.status_code == 200
    assert reg_ok.json()["user"]["username"] == "alice"
    assert reg_ok.json()["user"]["role"] == "user"

    # 8. Invariant: Admin can no longer set a blank password once total_users > 1
    revert_blank = client.post(
        "/api/profile/password",
        json={
            "current_password": "AdminSecurePassword99!",
            "new_password": "",
            "confirm_blank_password": True,
        },
    )
    assert revert_blank.status_code == 400
    assert "other users exist" in revert_blank.json()["detail"]


def test_profile_password_confirmation_and_session_inactivity_expiry(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify profile edits, current password confirmation before password change, and 24h session expiry."""
    client, repo = auth_client

    # Initial admin setup with a password
    setup_res = client.post(
        "/api/auth/setup",
        json={
            "username": "admin",
            "display_name": "System Admin",
            "password": "InitialPassword123!",
        },
    )
    assert setup_res.status_code == 200
    token = setup_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Update display name
    prof_res = client.put(
        "/api/profile",
        headers=headers,
        json={"display_name": "Archivist Prime"},
    )
    assert prof_res.status_code == 200
    assert prof_res.json()["display_name"] == "Archivist Prime"
    assert prof_res.json()["username"] == "admin"

    # Password change without current_password or with wrong current_password fails
    wrong_pw = client.post(
        "/api/profile/password",
        headers=headers,
        json={
            "current_password": "WrongPassword!",
            "new_password": "UpdatedPassword456!",
        },
    )
    assert wrong_pw.status_code == 400

    # Password change with valid current_password succeeds
    good_pw = client.post(
        "/api/profile/password",
        headers=headers,
        json={
            "current_password": "InitialPassword123!",
            "new_password": "UpdatedPassword456!",
        },
    )
    assert good_pw.status_code == 200

    # Simulate 24 hours + 10 seconds of session inactivity in the database
    expired_iso = (
        datetime.now(timezone.utc)
        - timedelta(seconds=auth_module.SESSION_IDLE_TIMEOUT_SECONDS + 10)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    with repo._connect() as conn:
        conn.execute(
            "UPDATE user_sessions SET last_active_at = ?",
            (expired_iso,),
        )
        conn.commit()

    # Clear cookies on client and test with the expired token
    client.cookies.clear()
    expired_check = client.get("/api/worlds", headers=headers)
    assert expired_check.status_code == 401


def test_passkey_registration_renewal_and_login_flow(
    auth_client: tuple[TestClient, CantinaRepository],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify multiple passkeys, password confirmation on passkey registration/renewal, and passkey login."""
    client, _ = auth_client

    setup_res = client.post(
        "/api/auth/setup",
        json={
            "username": "cipher",
            "display_name": "Cipher",
            "password": "CipherSecretPassword!",
        },
    )
    assert setup_res.status_code == 200
    token = setup_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Requesting passkey registration options without confirming password fails
    no_pw_opts = client.post(
        "/api/profile/passkeys/register/start",
        headers=headers,
        json={"current_password": "wrong", "friendly_name": "YubiKey 5"},
    )
    assert no_pw_opts.status_code == 400

    # 2. Requesting passkey registration options with valid current_password succeeds
    opts_res = client.post(
        "/api/profile/passkeys/register/start",
        headers=headers,
        json={"current_password": "CipherSecretPassword!", "friendly_name": "YubiKey 5"},
    )
    assert opts_res.status_code == 200
    challenge_id_1 = opts_res.json()["challenge_id"]

    # Mock py_webauthn's verify_registration_response for deterministic unit testing
    monkeypatch.setattr(
        webauthn,
        "verify_registration_response",
        lambda **kwargs: SimpleNamespace(
            credential_id=b"cred-yubikey-1",
            credential_public_key=b"pub-key-1",
            sign_count=1,
            aaguid="00000000-0000-0000-0000-000000000000",
        ),
    )

    verify_res_1 = client.post(
        "/api/profile/passkeys/register/finish",
        headers=headers,
        json={
            "challenge_id": challenge_id_1,
            "credential": {
                "id": auth_module.bytes_to_base64url(b"cred-yubikey-1"),
                "rawId": auth_module.bytes_to_base64url(b"cred-yubikey-1"),
                "type": "public-key",
                "response": {"transports": ["usb", "nfc"]},
            },
        },
    )
    assert verify_res_1.status_code == 200
    user_after_1 = verify_res_1.json()
    assert len(user_after_1["passkeys"]) == 1
    pk1 = user_after_1["passkeys"][0]
    assert pk1["friendly_name"] == "YubiKey 5"

    # 3. Register a second passkey (multiple passkeys supported)
    opts_res_2 = client.post(
        "/api/profile/passkeys/register/start",
        headers=headers,
        json={"current_password": "CipherSecretPassword!", "friendly_name": "TouchID Laptop"},
    )
    assert opts_res_2.status_code == 200
    challenge_id_2 = opts_res_2.json()["challenge_id"]

    monkeypatch.setattr(
        webauthn,
        "verify_registration_response",
        lambda **kwargs: SimpleNamespace(
            credential_id=b"cred-touchid-2",
            credential_public_key=b"pub-key-2",
            sign_count=0,
            aaguid="00000000-0000-0000-0000-000000000000",
        ),
    )

    verify_res_2 = client.post(
        "/api/profile/passkeys/register/finish",
        headers=headers,
        json={
            "challenge_id": challenge_id_2,
            "credential": {
                "id": auth_module.bytes_to_base64url(b"cred-touchid-2"),
                "rawId": auth_module.bytes_to_base64url(b"cred-touchid-2"),
                "type": "public-key",
                "response": {"transports": ["internal"]},
            },
        },
    )
    assert verify_res_2.status_code == 200
    user_after_2 = verify_res_2.json()
    assert len(user_after_2["passkeys"]) == 2
    pk2 = next(p for p in user_after_2["passkeys"] if p["friendly_name"] == "TouchID Laptop")

    # 4. Renew the first passkey (replaces pk1 atomically after password confirmation)
    opts_renew = client.post(
        "/api/profile/passkeys/register/start",
        headers=headers,
        json={
            "current_password": "CipherSecretPassword!",
            "friendly_name": "YubiKey 5 Renewed",
            "replace_credential_id": pk1["id"],
        },
    )
    assert opts_renew.status_code == 200
    challenge_renew = opts_renew.json()["challenge_id"]

    monkeypatch.setattr(
        webauthn,
        "verify_registration_response",
        lambda **kwargs: SimpleNamespace(
            credential_id=b"cred-yubikey-1-renewed",
            credential_public_key=b"pub-key-1-renewed",
            sign_count=0,
            aaguid="00000000-0000-0000-0000-000000000000",
        ),
    )

    verify_renew = client.post(
        "/api/profile/passkeys/register/finish",
        headers=headers,
        json={
            "challenge_id": challenge_renew,
            "credential": {
                "id": auth_module.bytes_to_base64url(b"cred-yubikey-1-renewed"),
                "rawId": auth_module.bytes_to_base64url(b"cred-yubikey-1-renewed"),
                "type": "public-key",
                "response": {"transports": ["usb"]},
            },
        },
    )
    assert verify_renew.status_code == 200
    prof_after = verify_renew.json()
    passkey_ids = {p["id"] for p in prof_after["passkeys"]}
    cred_renewed_id = auth_module.bytes_to_base64url(b"cred-yubikey-1-renewed")
    assert pk1["id"] not in passkey_ids
    assert cred_renewed_id in passkey_ids
    assert pk2["id"] in passkey_ids

    # 5. Authenticate using the renewed passkey
    login_opts = client.post(
        "/api/auth/passkey/login/start",
        json={"username": "cipher"},
    )
    assert login_opts.status_code == 200
    login_challenge_id = login_opts.json()["challenge_id"]

    monkeypatch.setattr(
        webauthn,
        "verify_authentication_response",
        lambda **kwargs: SimpleNamespace(new_sign_count=5),
    )

    login_verify = client.post(
        "/api/auth/passkey/login/finish",
        json={
            "challenge_id": login_challenge_id,
            "credential": {
                "id": cred_renewed_id,
                "rawId": cred_renewed_id,
                "type": "public-key",
                "response": {},
            },
        },
    )
    assert login_verify.status_code == 200
    login_session = login_verify.json()
    assert login_session["user"]["username"] == "cipher"
    assert login_session["token"]


def test_tenant_isolation_for_worlds_characters_and_campaigns(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify worlds, characters, and campaigns are private to the user who created them."""
    client, repo = auth_client

    # User 1 (Admin) setup — claims the seeded world/character/campaign
    res_u1 = client.post(
        "/api/auth/setup",
        json={"username": "user_one", "password": "PasswordOne123!"},
    )
    assert res_u1.status_code == 200
    u1_headers = {"Authorization": f"Bearer {res_u1.json()['token']}"}

    # User 2 registers
    client.cookies.clear()
    res_u2 = client.post(
        "/api/auth/register",
        json={"username": "user_two", "password": "PasswordTwo123!"},
    )
    assert res_u2.status_code == 200
    u2_user_id = res_u2.json()["user"]["id"]
    u2_headers = {"Authorization": f"Bearer {res_u2.json()['token']}"}
    client.cookies.clear()

    # User 1 sees the seeded world, character, and campaign
    u1_worlds = client.get("/api/worlds", headers=u1_headers).json()
    u1_chars = client.get("/api/characters", headers=u1_headers).json()
    u1_camps = client.get("/api/campaigns", headers=u1_headers).json()
    assert len(u1_worlds) == 1
    assert len(u1_chars) == 1
    assert len(u1_camps) == 1

    u1_world_id = u1_worlds[0]["id"]
    u1_char_id = u1_chars[0]["id"]
    u1_camp_id = u1_camps[0]["id"]

    # User 2 sees 0 worlds, 0 characters, and 0 campaigns
    assert client.get("/api/worlds", headers=u2_headers).json() == []
    assert client.get("/api/characters", headers=u2_headers).json() == []
    assert client.get("/api/campaigns", headers=u2_headers).json() == []

    # User 2 cannot fetch, update, or delete User 1's private entities by ID (returns 404)
    assert client.get(f"/api/worlds/{u1_world_id}", headers=u2_headers).status_code == 404
    assert client.get(f"/api/characters/{u1_char_id}", headers=u2_headers).status_code == 404
    assert client.get(f"/api/campaigns/{u1_camp_id}/state", headers=u2_headers).status_code == 404
    assert client.delete(f"/api/worlds/{u1_world_id}", headers=u2_headers).status_code == 404
    assert client.delete(f"/api/characters/{u1_char_id}", headers=u2_headers).status_code == 404
    assert client.delete(f"/api/campaigns/{u1_camp_id}", headers=u2_headers).status_code == 404

    # User 2 cannot create a campaign referencing User 1's world or character (returns 404)
    cross_tenant_camp = client.post(
        "/api/campaigns",
        headers=u2_headers,
        json={
            "name": "Unauthorized Cross-Tenant Campaign",
            "world_id": u1_world_id,
            "character_id": u1_char_id,
        },
    )
    assert cross_tenant_camp.status_code == 404

    # User 2 creates their own world and character via Wizard draft + commit endpoints
    w_draft_res = client.post(
        "/api/wizards/world/draft",
        headers=u2_headers,
        json={
            "name": "User Two Citadel",
            "genre_and_tone": "Solarpunk",
            "core_premise": "Floating sky gardens.",
        },
    )
    assert w_draft_res.status_code == 200

    # User 2 tests the re-imagine map endpoint
    reimagine_res = client.post(
        "/api/wizards/world/reimagine-map",
        headers=u2_headers,
        json={
            "world_name": "User Two Citadel",
            "global_rules": w_draft_res.json()["global_rules"],
            "map_description": "A central solar spire connected to two hanging greenhouse terraces.",
            "location_count": 3,
        },
    )
    assert reimagine_res.status_code == 200
    map_draft = reimagine_res.json()
    assert len(map_draft["locations"]) >= 3
    assert len(map_draft["edges"]) >= 2

    w_commit_res = client.post(
        "/api/wizards/world/commit",
        headers=u2_headers,
        json=w_draft_res.json(),
    )
    assert w_commit_res.status_code == 200
    u2_world_id = w_commit_res.json()["id"]

    c_draft_res = client.post(
        "/api/wizards/character/draft",
        headers=u2_headers,
        json={
            "name": "Vex of User Two",
            "archetype": "Sky Courier",
            "world_id": u2_world_id,
        },
    )
    assert c_draft_res.status_code == 200
    c_commit_res = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": c_draft_res.json(), "world_id": u2_world_id},
    )
    assert c_commit_res.status_code == 200
    u2_char_id = c_commit_res.json()["id"]

    # User 2 creates a campaign with their own world & character
    save_camp = client.post(
        "/api/campaigns",
        headers=u2_headers,
        json={
            "name": "User Two Private Campaign",
            "world_id": u2_world_id,
            "character_id": u2_char_id,
        },
    )
    assert save_camp.status_code == 200
    u2_camp_id = save_camp.json()["campaign"]["id"]

    # User 2 sees only their own entities
    assert [w["id"] for w in client.get("/api/worlds", headers=u2_headers).json()] == [u2_world_id]
    assert [c["id"] for c in client.get("/api/characters", headers=u2_headers).json()] == [u2_char_id]
    assert [cp["id"] for cp in client.get("/api/campaigns", headers=u2_headers).json()] == [u2_camp_id]

    # User 1 cannot access User 2's world, character, or campaign
    assert client.get(f"/api/worlds/{u2_world_id}", headers=u1_headers).status_code == 404
    assert client.get(f"/api/characters/{u2_char_id}", headers=u1_headers).status_code == 404
    assert client.get(f"/api/campaigns/{u2_camp_id}/state", headers=u1_headers).status_code == 404


def test_admin_panel_user_filtering_username_change_and_random_password_reset(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify Admin Users list/filter, username change, and random password reset."""
    client, _ = auth_client

    # Setup Admin
    admin_res = client.post(
        "/api/auth/setup",
        json={"username": "rootadmin", "password": "AdminPassword123!"},
    )
    admin_headers = {"Authorization": f"Bearer {admin_res.json()['token']}"}
    client.cookies.clear()

    # Register normal user
    user_res = client.post(
        "/api/auth/register",
        json={"username": "netrunner_bob", "display_name": "Bob", "password": "BobOldPassword123!"},
    )
    bob_id = user_res.json()["user"]["id"]
    bob_headers = {"Authorization": f"Bearer {user_res.json()['token']}"}
    client.cookies.clear()

    # 1. Normal user cannot access Admin endpoints (403 Forbidden)
    assert client.get("/api/admin/users", headers=bob_headers).status_code == 403
    assert (
        client.put(
            f"/api/admin/users/{bob_id}/username",
            headers=bob_headers,
            json={"username": "hacked"},
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/admin/users/{bob_id}/reset-password", headers=bob_headers).status_code
        == 403
    )

    # 2. Admin can list and filter users
    all_users = client.get("/api/admin/users", headers=admin_headers).json()
    assert len(all_users) == 2

    filtered = client.get("/api/admin/users?q=netrunner", headers=admin_headers).json()
    assert len(filtered) == 1
    assert filtered[0]["username"] == "netrunner_bob"

    # 3. Admin can change Bob's username
    rename_res = client.put(
        f"/api/admin/users/{bob_id}/username",
        headers=admin_headers,
        json={"username": "bob_zero"},
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["username"] == "bob_zero"

    # 4. Admin can reset Bob's password to a randomly generated password
    reset_res = client.post(
        f"/api/admin/users/{bob_id}/reset-password",
        headers=admin_headers,
    )
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    generated_pw = reset_data["generated_password"]
    assert isinstance(generated_pw, str)
    assert len(generated_pw) >= 12

    # Bob's previous session was invalidated on password reset
    assert client.get("/api/worlds", headers=bob_headers).status_code == 401

    # Bob's old password no longer works, and the new randomly generated password logs Bob in
    bad_login = client.post(
        "/api/auth/login",
        json={"username": "bob_zero", "password": "BobOldPassword123!"},
    )
    assert bad_login.status_code == 401

    good_login = client.post(
        "/api/auth/login",
        json={"username": "bob_zero", "password": generated_pw},
    )
    assert good_login.status_code == 200
    assert good_login.json()["user"]["username"] == "bob_zero"


def test_user_reset_account_data(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify that resetting account data deletes all user characters, worlds, and campaigns while preserving account and credentials."""
    client, _ = auth_client

    # Admin setup
    res_admin = client.post(
        "/api/auth/setup",
        json={"username": "admin", "password": "AdminPassword123!"},
    )
    admin_headers = {"Authorization": f"Bearer {res_admin.json()['token']}"}
    client.cookies.clear()

    # User 2 registers
    res_u2 = client.post(
        "/api/auth/register",
        json={"username": "runner_k", "password": "RunnerPassword123!"},
    )
    u2_headers = {"Authorization": f"Bearer {res_u2.json()['token']}"}
    client.cookies.clear()

    # User 2 creates world, character, and campaign
    w_draft = client.post(
        "/api/wizards/world/draft",
        headers=u2_headers,
        json={
            "name": "K-Citadel",
            "genre_and_tone": "Cyberpunk Noir",
            "core_premise": "Rain-slick neon streets.",
        },
    ).json()
    w_res = client.post("/api/wizards/world/commit", headers=u2_headers, json=w_draft).json()

    c_draft = client.post(
        "/api/wizards/character/draft",
        headers=u2_headers,
        json={"name": "K-Nine", "archetype": "Decker", "world_id": w_res["id"]},
    ).json()
    c_res = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": c_draft, "world_id": w_res["id"]},
    ).json()

    camp_res = client.post(
        "/api/campaigns",
        headers=u2_headers,
        json={
            "name": "K-Nine Mission",
            "world_id": w_res["id"],
            "character_id": c_res["id"],
        },
    )
    assert camp_res.status_code == 200

    # User 2 has entities
    assert len(client.get("/api/worlds", headers=u2_headers).json()) == 1
    assert len(client.get("/api/characters", headers=u2_headers).json()) == 1
    assert len(client.get("/api/campaigns", headers=u2_headers).json()) == 1

    # Resetting without valid password fails
    bad_reset = client.post(
        "/api/profile/reset-data",
        headers=u2_headers,
        json={"current_password": "WrongPassword!"},
    )
    assert bad_reset.status_code == 400

    # Resetting with valid password succeeds
    good_reset = client.post(
        "/api/profile/reset-data",
        headers=u2_headers,
        json={"current_password": "RunnerPassword123!"},
    )
    assert good_reset.status_code == 200

    # User 2's characters, worlds, and campaigns are completely purged
    assert client.get("/api/worlds", headers=u2_headers).json() == []
    assert client.get("/api/characters", headers=u2_headers).json() == []
    assert client.get("/api/campaigns", headers=u2_headers).json() == []

    # User 2's account, session, and profile remain intact
    prof = client.get("/api/profile", headers=u2_headers)
    assert prof.status_code == 200
    assert prof.json()["username"] == "runner_k"

    # Admin's seeded entities were untouched
    assert len(client.get("/api/worlds", headers=admin_headers).json()) == 1
    assert len(client.get("/api/characters", headers=admin_headers).json()) == 1
    assert len(client.get("/api/campaigns", headers=admin_headers).json()) == 1


def test_user_delete_account_and_admin_delete_rules(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify regular user account self-deletion and admin delete rules (at least 1 admin must remain)."""
    client, _ = auth_client

    # 1. Setup Admin 1
    res_a1 = client.post(
        "/api/auth/setup",
        json={"username": "superadmin", "password": "SuperAdminPassword123!"},
    )
    a1_headers = {"Authorization": f"Bearer {res_a1.json()['token']}"}
    a1_id = res_a1.json()["user"]["id"]
    client.cookies.clear()

    # 2. Admin 1 creates Admin 2
    res_a2 = client.post(
        "/api/admin/users",
        headers=a1_headers,
        json={"username": "secondadmin", "password": "SecondAdminPassword123!", "role": "admin"},
    )
    assert res_a2.status_code == 200
    a2_id = res_a2.json()["id"]

    # 3. Regular user registers
    res_user = client.post(
        "/api/auth/register",
        json={"username": "charlie", "password": "CharliePassword123!"},
    )
    assert res_user.status_code == 200
    user_headers = {"Authorization": f"Bearer {res_user.json()['token']}"}
    client.cookies.clear()

    # Charlie creates a world
    w_draft = client.post(
        "/api/wizards/world/draft",
        headers=user_headers,
        json={"name": "Charlie Haven", "genre_and_tone": "Post-Cyberpunk", "core_premise": "A calm alley cafe."},
    ).json()
    client.post("/api/wizards/world/commit", headers=user_headers, json=w_draft)
    assert len(client.get("/api/worlds", headers=user_headers).json()) == 1

    # 4. Charlie deletes their own account
    # Wrong password fails
    del_bad = client.request("DELETE", "/api/profile", headers=user_headers, json={"current_password": "wrong"})
    assert del_bad.status_code == 400

    # Correct password succeeds
    del_ok = client.request("DELETE", "/api/profile", headers=user_headers, json={"current_password": "CharliePassword123!"})
    assert del_ok.status_code == 200
    assert del_ok.json()["status"] == "deleted"

    # Charlie's session is expired, profile returns 401, login fails
    assert client.get("/api/profile", headers=user_headers).status_code == 401
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "charlie", "password": "CharliePassword123!"},
        ).status_code
        == 401
    )

    # 5. Admin deleting accounts
    # Non-admin cannot call admin delete
    unauth_del = client.delete(f"/api/admin/users/{a2_id}")
    assert unauth_del.status_code == 401

    # Admin 1 deletes Admin 2 (allowed because 2 admins exist)
    del_a2 = client.delete(f"/api/admin/users/{a2_id}", headers=a1_headers)
    assert del_a2.status_code == 200
    assert del_a2.json()["status"] == "deleted"

    # Now only 1 admin remains (Admin 1). Trying to delete Admin 1 is blocked!
    del_last_admin = client.delete(f"/api/admin/users/{a1_id}", headers=a1_headers)
    assert del_last_admin.status_code == 400
    assert "only remaining administrator account" in del_last_admin.json()["detail"]

    # Also, calling DELETE /api/profile by the last admin is blocked
    self_del_last_admin = client.request(
        "DELETE",
        "/api/profile",
        headers=a1_headers,
        json={"current_password": "SuperAdminPassword123!"},
    )
    assert self_del_last_admin.status_code == 400
    assert "only remaining administrator account" in self_del_last_admin.json()["detail"]


def test_admin_and_user_model_settings_and_overrides(
    auth_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify Admin-configured default models, override policy toggle, per-user overrides, and 403 restrictions."""
    client, _repo = auth_client

    # 1. Setup admin user
    setup_res = client.post(
        "/api/auth/setup",
        json={
            "username": "superadmin",
            "display_name": "Super Admin",
            "password": "AdminPassword123!",
        },
    )
    assert setup_res.status_code == 200
    admin_token = setup_res.json()["token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    admin_id = setup_res.json()["user"]["id"]

    # 2. Register regular user Bob
    reg_res = client.post(
        "/api/auth/register",
        json={
            "username": "bob",
            "display_name": "Bob Vance",
            "password": "BobPassword123!",
        },
    )
    assert reg_res.status_code == 200
    bob_token = reg_res.json()["token"]
    bob_headers = {"Authorization": f"Bearer {bob_token}"}
    bob_id = reg_res.json()["user"]["id"]

    # 3. Admin checks current settings and updates defaults with overrides disabled
    curr_settings = client.get("/api/settings", headers=admin_headers).json()
    curr_settings["actor_profile"]["model"] = "llama3.2:3b"
    curr_settings["clerk_profile"]["model"] = "llama3.1:8b"
    curr_settings["allow_user_model_overrides"] = False

    update_res = client.put("/api/settings", headers=admin_headers, json=curr_settings)
    assert update_res.status_code == 200
    assert update_res.json()["actor_profile"]["model"] == "llama3.2:3b"
    assert update_res.json()["allow_user_model_overrides"] is False

    # 4. Regular user Bob is forbidden from modifying system settings
    bob_sys_put = client.put("/api/settings", headers=bob_headers, json=curr_settings)
    assert bob_sys_put.status_code == 403
    assert "Administrator privileges required" in bob_sys_put.json()["detail"]

    # 5. Bob queries profile models while overrides are disabled
    bob_models_res = client.get("/api/profile/models", headers=bob_headers)
    assert bob_models_res.status_code == 200
    bob_models = bob_models_res.json()
    assert bob_models["allow_user_model_overrides"] is False
    assert bob_models["has_override"] is False
    assert bob_models["effective_actor_profile"]["model"] == "llama3.2:3b"
    assert bob_models["default_actor_profile"]["model"] == "llama3.2:3b"

    # 6. Bob tries to save custom overrides while disabled -> blocked with 403
    bob_override_payload = {
        "actor_profile": {
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": "ollama",
            "model": "qwen2.5:7b",
            "temperature": 0.85,
            "max_tokens": 1024,
            "timeout_seconds": 120.0,
        },
        "clerk_profile": {
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": "ollama",
            "model": "mistral:latest",
            "temperature": 0.15,
            "max_tokens": 512,
            "timeout_seconds": 120.0,
        },
        "working_memory_turns": 14,
        "max_scene_flags": 6,
    }
    blocked_put = client.put("/api/profile/models", headers=bob_headers, json=bob_override_payload)
    assert blocked_put.status_code == 403
    assert "Per-user model overrides are currently disabled" in blocked_put.json()["detail"]

    # 7. Admin enables per-user model overrides
    curr_settings["allow_user_model_overrides"] = True
    enable_res = client.put("/api/settings", headers=admin_headers, json=curr_settings)
    assert enable_res.status_code == 200
    assert enable_res.json()["allow_user_model_overrides"] is True

    # 8. Now Bob successfully sets their custom model overrides
    allowed_put = client.put("/api/profile/models", headers=bob_headers, json=bob_override_payload)
    assert allowed_put.status_code == 200
    bob_updated = allowed_put.json()
    assert bob_updated["has_override"] is True
    assert bob_updated["effective_actor_profile"]["model"] == "qwen2.5:7b"
    assert bob_updated["effective_clerk_profile"]["model"] == "mistral:latest"
    assert bob_updated["effective_working_memory_turns"] == 14
    assert bob_updated["effective_max_scene_flags"] == 6
    assert bob_updated["user_max_scene_flags"] == 6
    assert bob_updated["default_actor_profile"]["model"] == "llama3.2:3b"

    # 9. Effective settings resolution helper check
    eff_bob_actor, eff_bob_clerk, eff_bob_wm, eff_bob_del, eff_bob_flags = main_module.get_effective_user_model_settings(bob_id)
    assert eff_bob_actor.model == "qwen2.5:7b"
    assert eff_bob_clerk.model == "mistral:latest"
    assert eff_bob_wm == 14
    assert eff_bob_flags == 6

    # Admin without overrides still resolves global defaults
    eff_admin_actor, eff_admin_clerk, eff_admin_wm, eff_admin_del, eff_admin_flags = main_module.get_effective_user_model_settings(admin_id)
    assert eff_admin_actor.model == "llama3.2:3b"
    assert eff_admin_clerk.model == "llama3.1:8b"
    assert eff_admin_wm == settings.memory_config.working_memory_turns
    assert eff_admin_flags == settings.memory_config.max_scene_flags

    # 10. Bob resets overrides back to defaults
    del_override = client.delete("/api/profile/models", headers=bob_headers)
    assert del_override.status_code == 200
    bob_reverted = del_override.json()
    assert bob_reverted["has_override"] is False
    assert bob_reverted["effective_actor_profile"]["model"] == "llama3.2:3b"
    assert bob_reverted["effective_clerk_profile"]["model"] == "llama3.1:8b"
    assert bob_reverted["effective_max_scene_flags"] == settings.memory_config.max_scene_flags
    assert bob_reverted["user_max_scene_flags"] is None

    eff_bob_reverted_actor, _, _, _, eff_bob_reverted_flags = main_module.get_effective_user_model_settings(bob_id)
    assert eff_bob_reverted_actor.model == "llama3.2:3b"
    assert eff_bob_reverted_flags == settings.memory_config.max_scene_flags

