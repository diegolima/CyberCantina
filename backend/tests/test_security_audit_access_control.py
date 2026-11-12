"""Security Audit Verification Tests: Authentication, Authorization, Media Protection, and IDOR Prevention."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import pytest
from PIL import Image
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.dependencies import safe_resolve_media_path
from app.schemas.character import (
    BaselinePsyche,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    MemoryShard,
    VoiceAnchor,
)


def _create_test_image(width: int = 200, height: int = 200, color: str = "blue") -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture()
def sec_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, CantinaRepository]:
    """Provide an isolated TestClient and CantinaRepository for security tests."""
    db_file = str(tmp_path / "test_sec_audit.db")
    media_dir = str(tmp_path / "test_sec_media")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "media_dir", media_dir)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)

    repo = CantinaRepository(db_file, media_dir=media_dir)
    repo.init_db()

    client = TestClient(main_module.app)
    return client, repo


def test_media_endpoint_requires_auth_and_enforces_character_ownership(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify character portraits and gallery images are strictly protected against unauthenticated and cross-tenant access."""
    client, repo = sec_client

    # 1. Setup Admin (User 1)
    res_admin = client.post(
        "/api/auth/setup",
        json={"username": "admin_audit", "password": "AdminPassword123!"},
    )
    assert res_admin.status_code == 200
    admin_token = res_admin.json()["token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Register User 2 (Bob)
    res_u2 = client.post(
        "/api/auth/register",
        json={"username": "bob_audit", "password": "BobPassword123!"},
    )
    assert res_u2.status_code == 200
    u2_token = res_u2.json()["token"]
    u2_headers = {"Authorization": f"Bearer {u2_token}"}
    u2_id = res_u2.json()["user"]["id"]

    # 3. User 2 creates a character
    draft = CharacterWizardDraft(
        name="Bob Special Operative",
        tagline="Infiltrator",
        core_persona="Silent and disciplined",
        baseline_psyche=BaselinePsyche(
            core_drive="Mission",
            core_fear="Exposure",
            default_want="Extraction",
            default_plan="Move stealthily",
        ),
        equipped=["Silenced Pistol"],
        inventory=["Lockpick"],
        voice_anchors=[VoiceAnchor(context="Whisper", snippet="Copy that.")],
        memory_shards=[MemoryShard(title="Origins", content="Black ops veteran.")],
        tags=["stealth"],
    )
    commit_res = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": draft.model_dump()},
    )
    assert commit_res.status_code == 200
    char_id = commit_res.json()["id"]

    # 4. User 2 uploads a portrait
    img_bytes = _create_test_image(300, 300, "cyan")
    upload_res = client.post(
        f"/api/characters/{char_id}/portraits/happy",
        headers=u2_headers,
        files={"file": ("happy.png", img_bytes, "image/png")},
    )
    assert upload_res.status_code == 200
    media_url = upload_res.json()["portraits"]["happy"]

    # 5. Unauthenticated request to the media URL is REJECTED (HTTP 401)
    unauth_client = TestClient(main_module.app)
    unauth_res = unauth_client.get(media_url)
    assert unauth_res.status_code == 401

    # 6. Register a third user (Charlie)
    res_u3 = client.post(
        "/api/auth/register",
        json={"username": "charlie_audit", "password": "CharliePassword123!"},
    )
    assert res_u3.status_code == 200
    u3_headers = {"Authorization": f"Bearer {res_u3.json()['token']}"}

    # Charlie (unrelated non-admin) attempts to fetch Bob's portrait -> REJECTED (HTTP 404)
    charlie_res = client.get(media_url, headers=u3_headers)
    assert charlie_res.status_code == 404

    # 7. Bob (owner) fetches his portrait -> ALLOWED (HTTP 200) with private Cache-Control
    bob_res = client.get(media_url, headers=u2_headers)
    assert bob_res.status_code == 200
    assert "private" in bob_res.headers.get("cache-control", "").lower()

    # 8. Admin attempts to fetch Bob's portrait -> REJECTED (HTTP 404)
    # (Admins do NOT have access to user character data)
    admin_res = client.get(media_url, headers=admin_headers)
    assert admin_res.status_code == 404

    # 9. If Charlie has a campaign where Bob's character participates, Charlie is granted access
    conn = repo._connect()
    try:
        # Create a world & campaign for Charlie that includes Bob's character
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, pending_deletion, created_at) "
            "VALUES ('world_charlie', ?, 'Charlie World', '[]', 0, '2026-10-31T00:00:00Z')",
            (res_u3.json()["user"]["id"],),
        )
        conn.execute(
            "INSERT INTO location_nodes (id, world_id, name, summary, description, environmental_tags_json, is_starting_location) "
            "VALUES ('loc_c1', 'world_charlie', 'HQ', 'HQ', 'HQ Room', '[]', 1)",
        )
        conn.execute(
            "INSERT INTO campaigns (id, owner_id, name, world_id, character_id, active_leaf_turn_id, created_at) "
            "VALUES ('camp_charlie', ?, 'Shared Op', 'world_charlie', ?, NULL, '2026-10-31T00:00:00Z')",
            (res_u3.json()["user"]["id"], char_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Now Charlie can view the character's portrait because it's part of Charlie's campaign
    charlie_access = client.get(media_url, headers=u3_headers)
    assert charlie_access.status_code == 200


def test_prompt_presets_require_auth_and_prevent_idor(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify prompt preset endpoints require authentication and prevent IDOR/cross-tenant reading/cloning."""
    client, _repo = sec_client

    # 1. Unauthenticated requests to prompt endpoints return 401
    unauth_client = TestClient(main_module.app)
    assert unauth_client.get("/api/prompts/defaults").status_code == 401
    assert unauth_client.get("/api/prompts/presets").status_code == 401
    assert unauth_client.get("/api/prompts/presets/builtin-default").status_code == 401

    # 2. Setup Admin and User Alice
    res_admin = client.post(
        "/api/auth/setup",
        json={"username": "admin_prompts", "password": "AdminPassword123!"},
    )
    admin_headers = {"Authorization": f"Bearer {res_admin.json()['token']}"}

    res_alice = client.post(
        "/api/auth/register",
        json={"username": "alice_prompts", "password": "AlicePassword123!"},
    )
    alice_headers = {"Authorization": f"Bearer {res_alice.json()['token']}"}

    res_bob = client.post(
        "/api/auth/register",
        json={"username": "bob_prompts", "password": "BobPassword123!"},
    )
    bob_headers = {"Authorization": f"Bearer {res_bob.json()['token']}"}

    # 3. Alice creates a private custom prompt preset with sensitive instructions
    create_res = client.post(
        "/api/prompts/presets",
        headers=alice_headers,
        json={
            "name": "Alice Secret Formula",
            "description": "Proprietary system prompt",
            "prompts": {"actor_zone1_system": "Secret instructions for Alice characters only."},
        },
    )
    assert create_res.status_code == 200
    alice_preset_id = create_res.json()["id"]

    # 4. Bob attempts to fetch Alice's private preset by ID -> 404
    bob_get = client.get(f"/api/prompts/presets/{alice_preset_id}", headers=bob_headers)
    assert bob_get.status_code == 404

    # 5. Bob attempts to clone Alice's private preset using base_preset_id -> 404
    bob_clone = client.post(
        "/api/prompts/presets",
        headers=bob_headers,
        json={
            "name": "Bob Stolen Preset",
            "base_preset_id": alice_preset_id,
        },
    )
    assert bob_clone.status_code == 404

    # 6. Admin attempts to fetch Alice's preset -> REJECTED (HTTP 404)
    # (Admins do NOT have access to user custom presets)
    admin_get = client.get(f"/api/prompts/presets/{alice_preset_id}", headers=admin_headers)
    assert admin_get.status_code == 404


def test_ollama_status_requires_auth_and_blocks_ssrf_probes(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify /api/ollama/status requires authentication and blocks arbitrary base_url SSRF probes by non-admins."""
    client, _repo = sec_client

    # 1. Unauthenticated request -> 401
    unauth_client = TestClient(main_module.app)
    assert unauth_client.get("/api/ollama/status").status_code == 401

    # 2. Setup Admin and User
    res_admin = client.post(
        "/api/auth/setup",
        json={"username": "admin_ollama", "password": "AdminPassword123!"},
    )
    admin_headers = {"Authorization": f"Bearer {res_admin.json()['token']}"}

    res_user = client.post(
        "/api/auth/register",
        json={"username": "user_ollama", "password": "UserPassword123!"},
    )
    user_headers = {"Authorization": f"Bearer {res_user.json()['token']}"}

    # 3. Regular user without custom base_url queries default Ollama status -> 200 (allowed)
    user_default = client.get("/api/ollama/status", headers=user_headers)
    assert user_default.status_code == 200

    # 4. Regular user attempts to probe internal network via custom base_url -> 403 (SSRF blocked)
    user_ssrf = client.get(
        "/api/ollama/status?base_url=http://169.254.169.254/latest/meta-data/",
        headers=user_headers,
    )
    assert user_ssrf.status_code == 403
    assert "Administrator privileges required" in user_ssrf.json()["detail"]

    # 5. Admin is permitted to test custom base_urls
    admin_probe = client.get(
        "/api/ollama/status?base_url=http://127.0.0.1:9999/v1",
        headers=admin_headers,
    )
    assert admin_probe.status_code == 200
    assert admin_probe.json()["reachable"] is False


def test_cross_tenant_world_commit_and_update_blocked(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify users cannot link their characters to worlds owned by other tenants."""
    client, _repo = sec_client

    # Setup User 1 (Admin) and User 2
    res_u1 = client.post(
        "/api/auth/setup",
        json={"username": "tenant_one", "password": "PasswordOne123!"},
    )
    u1_headers = {"Authorization": f"Bearer {res_u1.json()['token']}"}

    res_u2 = client.post(
        "/api/auth/register",
        json={"username": "tenant_two", "password": "PasswordTwo123!"},
    )
    u2_headers = {"Authorization": f"Bearer {res_u2.json()['token']}"}

    # User 1 creates a private world
    w1_res = client.post(
        "/api/wizards/world/draft",
        headers=u1_headers,
        json={"name": "Tenant One Fortress", "genre_and_tone": "Cyberpunk", "core_premise": "Citadel"},
    )
    w1_commit = client.post("/api/wizards/world/commit", headers=u1_headers, json=w1_res.json())
    u1_world_id = w1_commit.json()["id"]

    # User 2 attempts to commit a character referencing User 1's world_id -> 400
    draft = CharacterWizardDraft(
        name="Tenant Two Infiltrator",
        tagline="Trojan",
        core_persona="Suspicious",
        baseline_psyche=BaselinePsyche(
            core_drive="Infiltrate", core_fear="Detection", default_want="Access", default_plan="Probe"
        ),
    )
    bad_commit = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": draft.model_dump(), "world_id": u1_world_id},
    )
    assert bad_commit.status_code == 400
    assert "access denied" in bad_commit.json()["detail"].lower()

    # User 2 creates a character without world_id
    ok_commit = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": draft.model_dump()},
    )
    assert ok_commit.status_code == 200
    u2_char_id = ok_commit.json()["id"]

    # User 2 attempts to update the character to link to User 1's world_id -> 400
    bad_update = client.put(
        f"/api/characters/{u2_char_id}",
        headers=u2_headers,
        json={
            "name": "Tenant Two Infiltrator",
            "tagline": "Trojan",
            "world_id": u1_world_id,
            "core_persona": "Suspicious",
            "baseline_psyche": draft.baseline_psyche.model_dump(),
        },
    )
    assert bad_update.status_code == 400
    assert "access denied" in bad_update.json()["detail"].lower()


def test_campaign_character_memories_checks_participant(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify attempting to update campaign character memories for a non-participant character is rejected."""
    client, _repo = sec_client

    res_u1 = client.post(
        "/api/auth/setup",
        json={"username": "camp_user", "password": "Password123!"},
    )
    u1_headers = {"Authorization": f"Bearer {res_u1.json()['token']}"}

    # Create world & character & campaign
    w_res = client.post(
        "/api/wizards/world/draft",
        headers=u1_headers,
        json={"name": "Memory World", "genre_and_tone": "SciFi", "core_premise": "Test"},
    )
    w_commit = client.post("/api/wizards/world/commit", headers=u1_headers, json=w_res.json())
    world_id = w_commit.json()["id"]

    draft = CharacterWizardDraft(
        name="Main Char",
        tagline="Hero",
        core_persona="Brave",
        baseline_psyche=BaselinePsyche(
            core_drive="Courage", core_fear="Fear", default_want="Win", default_plan="Fight"
        ),
    )
    c_commit = client.post("/api/wizards/character/commit", headers=u1_headers, json={"draft": draft.model_dump()})
    char_id = c_commit.json()["id"]

    camp_res = client.post(
        "/api/campaigns",
        headers=u1_headers,
        json={"name": "Memory Campaign", "world_id": world_id, "character_id": char_id},
    )
    camp_id = camp_res.json()["campaign"]["id"]

    # Attempt to update memories for a non-existent / non-participant character -> 400
    bad_mem = client.post(
        f"/api/campaigns/{camp_id}/characters/char_non_participant/memories",
        headers=u1_headers,
        json={"memory_shards": [{"title": "Fake", "content": "Fake"}]},
    )
    assert bad_mem.status_code == 400
    assert "not a participant" in bad_mem.json()["detail"]


def test_admin_cannot_access_user_data_except_on_deletion(
    sec_client: tuple[TestClient, CantinaRepository],
) -> None:
    """Verify admins have zero access to user characters, worlds, or campaigns, and user data is wiped upon account deletion."""
    client, repo = sec_client

    # 1. Admin setup
    res_admin = client.post(
        "/api/auth/setup",
        json={"username": "superadmin_iso", "password": "AdminPassword123!"},
    )
    admin_headers = {"Authorization": f"Bearer {res_admin.json()['token']}"}

    # 2. Regular user David registers
    res_david = client.post(
        "/api/auth/register",
        json={"username": "david_iso", "password": "DavidPassword123!"},
    )
    david_id = res_david.json()["user"]["id"]
    david_headers = {"Authorization": f"Bearer {res_david.json()['token']}"}

    # 3. David creates a world, a character, a portrait, and a campaign
    w_res = client.post(
        "/api/wizards/world/draft",
        headers=david_headers,
        json={"name": "David Private Realm", "genre_and_tone": "Cyberpunk", "core_premise": "Isolated"},
    )
    w_commit = client.post("/api/wizards/world/commit", headers=david_headers, json=w_res.json())
    d_world_id = w_commit.json()["id"]

    c_draft = CharacterWizardDraft(
        name="David Secret Agent",
        tagline="Shadow",
        core_persona="Inconspicuous",
        baseline_psyche=BaselinePsyche(
            core_drive="Survival", core_fear="Discovery", default_want="Escape", default_plan="Vanish"
        ),
    )
    c_commit = client.post(
        "/api/wizards/character/commit",
        headers=david_headers,
        json={"draft": c_draft.model_dump(), "world_id": d_world_id},
    )
    d_char_id = c_commit.json()["id"]

    img_bytes = _create_test_image(200, 200, "green")
    p_upload = client.post(
        f"/api/characters/{d_char_id}/portraits/happy",
        headers=david_headers,
        files={"file": ("happy.png", img_bytes, "image/png")},
    )
    assert p_upload.status_code == 200
    media_url = p_upload.json()["portraits"]["happy"]

    camp_res = client.post(
        "/api/campaigns",
        headers=david_headers,
        json={"name": "David Secret Campaign", "world_id": d_world_id, "character_id": d_char_id},
    )
    d_camp_id = camp_res.json()["campaign"]["id"]

    note_res = client.post(
        "/api/notes",
        headers=david_headers,
        json={"title": "David Notes", "content": "Classified"},
    )
    assert note_res.status_code == 200

    # 4. Verify Admin CANNOT access David's world, character, media, or campaign data
    valid_world_payload = {
        "name": "Hacked World",
        "global_rules": w_commit.json()["global_rules"],
        "locations": [],
        "edges": [],
        "lore_nodes": [],
    }
    valid_char_payload = c_draft.model_dump()
    valid_char_payload["name"] = "Hacked Char"

    assert client.get(f"/api/worlds/{d_world_id}", headers=admin_headers).status_code == 404
    assert client.put(f"/api/worlds/{d_world_id}", headers=admin_headers, json=valid_world_payload).status_code == 404
    assert client.delete(f"/api/worlds/{d_world_id}", headers=admin_headers).status_code == 404

    assert client.get(f"/api/characters/{d_char_id}", headers=admin_headers).status_code == 404
    assert client.put(f"/api/characters/{d_char_id}", headers=admin_headers, json=valid_char_payload).status_code == 404
    assert client.get(f"/api/characters/{d_char_id}/versions", headers=admin_headers).status_code == 404
    assert client.delete(f"/api/characters/{d_char_id}", headers=admin_headers).status_code == 404
    assert client.get(media_url, headers=admin_headers).status_code == 404

    assert client.get(f"/api/campaigns/{d_camp_id}/state", headers=admin_headers).status_code == 404
    assert client.delete(f"/api/campaigns/{d_camp_id}", headers=admin_headers).status_code == 404
    assert client.put(f"/api/campaigns/{d_camp_id}/prompt-preset", headers=admin_headers, json={"preset_id": None}).status_code == 404

    # Verify character media directory exists on disk before deletion
    char_media_dir = Path(settings.media_dir) / "characters" / d_char_id
    assert char_media_dir.exists()

    # 5. Admin deletes David's account via the account management endpoint
    del_user_res = client.delete(f"/api/admin/users/{david_id}", headers=admin_headers)
    assert del_user_res.status_code == 200
    assert del_user_res.json()["status"] == "deleted"

    # 6. Verify all David's user data (database & disk) has been completely removed
    conn = repo._connect()
    try:
        assert conn.execute("SELECT COUNT(*) FROM worlds WHERE owner_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM characters WHERE owner_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM campaigns WHERE owner_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM user_notes WHERE owner_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM prompt_presets WHERE owner_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM user_sessions WHERE user_id = ?", (david_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (david_id,)).fetchone()[0] == 0
    finally:
        conn.close()

    # Character media on disk is also removed
    assert not char_media_dir.exists()


def test_character_id_path_injection_blocked_at_commit_and_filesystem_sinks(
    sec_client: tuple[TestClient, CantinaRepository], tmp_path: Path
) -> None:
    """Reject traversal character IDs at API/repo entry points and protect copy/delete sinks."""
    client, repo = sec_client

    res_u1 = client.post(
        "/api/auth/setup",
        json={"username": "path_attacker", "password": "AttackPassword123!"},
    )
    assert res_u1.status_code == 200
    u1_id = res_u1.json()["user"]["id"]
    u1_headers = {"Authorization": f"Bearer {res_u1.json()['token']}"}

    res_u2 = client.post(
        "/api/auth/register",
        json={"username": "path_victim", "password": "VictimPassword123!"},
    )
    assert res_u2.status_code == 200
    u2_id = res_u2.json()["user"]["id"]
    u2_headers = {"Authorization": f"Bearer {res_u2.json()['token']}"}

    draft = CharacterWizardDraft(
        name="Boundary Tester",
        tagline="Security probe",
        core_persona="Methodical",
        baseline_psyche=BaselinePsyche(
            core_drive="Truth",
            core_fear="Regression",
            default_want="Verification",
            default_plan="Probe boundaries",
        ),
    )

    outside_dir = tmp_path / "sensitive_outside"
    outside_dir.mkdir(parents=True, exist_ok=True)
    outside_marker = outside_dir / "keep.txt"
    outside_marker.write_text("must survive", encoding="utf-8")

    # 1. API rejects invalid/traversal character_id values on commit
    for bad_id in ("..", ".", "../outside", "../../etc", str(outside_dir), "bad\\path", "char_1\n", ""):
        res = client.post(
            "/api/wizards/character/commit",
            headers=u1_headers,
            json={"draft": draft.model_dump(), "character_id": bad_id},
        )
        assert res.status_code == 400, f"Expected 400 for bad_id={bad_id!r}, got {res.status_code}"

        with pytest.raises(ValueError):
            repo.create_character_from_draft(draft, character_id=bad_id, owner_id=u1_id)
        with pytest.raises(ValueError):
            repo.stage_character_media_ownership(u1_id, bad_id)

    # 2. Prevent claiming another user's staged character ID or colliding with existing IDs
    repo.stage_character_media_ownership(u2_id, "char_u2_staged")
    hijack_res = client.post(
        "/api/wizards/character/commit",
        headers=u1_headers,
        json={"draft": draft.model_dump(), "character_id": "char_u2_staged"},
    )
    assert hijack_res.status_code == 400

    valid_commit = client.post(
        "/api/wizards/character/commit",
        headers=u2_headers,
        json={"draft": draft.model_dump(), "character_id": "char_u2_staged"},
    )
    assert valid_commit.status_code == 200

    dup_res = client.post(
        "/api/wizards/character/commit",
        headers=u1_headers,
        json={"draft": draft.model_dump(), "character_id": "char_u2_staged"},
    )
    assert dup_res.status_code == 400

    # Victim's media folder must remain intact even if legacy corrupted DB rows exist
    victim_media = Path(settings.media_dir) / "characters" / "char_u2_staged" / "portraits"
    victim_media.mkdir(parents=True, exist_ok=True)
    victim_file = victim_media / "default_safe.webp"
    victim_file.write_bytes(b"VALID_WEBP_BYTES")

    # 3. Defense-in-depth: simulate pre-existing corrupted SQLite character rows
    conn = repo._connect()
    try:
        for idx, legacy_id in enumerate(("..", str(outside_dir)), start=1):
            conn.execute(
                """
                INSERT INTO characters (
                    id, owner_id, world_id, name, tagline, core_persona, baseline_psyche_json,
                    pending_deletion, version, created_at
                )
                VALUES (?, ?, NULL, ?, 'Legacy', 'Test', ?, 0, 1, '2026-10-31T00:00:00Z')
                """,
                (legacy_id, u1_id, f"Legacy Bad {idx}", draft.baseline_psyche.model_dump_json()),
            )
            version_snapshot = {
                **draft.model_dump(),
                "id": legacy_id,
                "version": 1,
                "pending_deletion": False,
                "created_at": "2026-10-31T00:00:00Z",
            }
            conn.execute(
                """
                INSERT INTO character_versions (id, character_id, version, data_json, created_at)
                VALUES (?, ?, 1, ?, '2026-10-31T00:00:00Z')
                """,
                (
                    f"cver_bad_{idx}",
                    legacy_id,
                    json.dumps(version_snapshot),
                ),
            )
        conn.execute(
            "INSERT INTO worlds (id, owner_id, name, global_rules_json, pending_deletion, created_at) "
            "VALUES ('world_legacy_sec', ?, 'Sec World', '{}', 0, '2026-10-31T00:00:00Z')",
            (u1_id,),
        )
        conn.execute(
            "INSERT INTO location_nodes (id, world_id, name, summary, description, environmental_tags_json, is_starting_location) "
            "VALUES ('loc_legacy_sec', 'world_legacy_sec', 'Start', 'Start', 'Room', '[]', 1)"
        )
        conn.execute(
            "INSERT INTO campaigns (id, owner_id, name, world_id, character_id, active_leaf_turn_id, created_at) "
            "VALUES ('camp_legacy_sec', ?, 'Legacy Camp', 'world_legacy_sec', '..', NULL, '2026-10-31T00:00:00Z')",
            (u1_id,),
        )
        conn.commit()
    finally:
        conn.close()

    # CoW fork on update_character and restore_character_version must NOT copy parent media_dir
    upd = repo.update_character(
        "..",
        CharacterUpdatePayload(
            name="Updated Legacy",
            tagline="Legacy",
            core_persona="Test",
            baseline_psyche=draft.baseline_psyche,
        ),
        owner_id=u1_id,
    )
    forked_upd_dir = Path(settings.media_dir) / "characters" / upd.id
    assert not forked_upd_dir.exists()

    # Re-attach a campaign to the '..' row if needed and test restore_character_version CoW path
    conn = repo._connect()
    try:
        conn.execute("UPDATE campaigns SET character_id = '..' WHERE id = 'camp_legacy_sec'")
        conn.commit()
    finally:
        conn.close()

    restored = repo.restore_character_version("..", 1, owner_id=u1_id)
    forked_rest_dir = Path(settings.media_dir) / "characters" / restored.id
    assert not forked_rest_dir.exists()

    # Detach campaign and run pruner + reset_user_data; neither media_dir nor outside_dir may be deleted
    conn = repo._connect()
    try:
        conn.execute("DELETE FROM campaigns WHERE id = 'camp_legacy_sec'")
        conn.execute("UPDATE characters SET pending_deletion = 1 WHERE id = ?", (str(outside_dir),))
        conn.commit()
    finally:
        conn.close()

    repo.prune_pending_deletion_characters()
    assert victim_file.exists()
    assert outside_marker.exists()

    repo.reset_user_data(u1_id)
    assert victim_file.exists()
    assert outside_marker.exists()


def test_safe_resolve_media_path_blocks_newlines_and_symlinks(
    sec_client: tuple[TestClient, CantinaRepository], tmp_path: Path
) -> None:
    """Verify safe_resolve_media_path rejects trailing newlines and symlink escapes."""
    _client, _repo = sec_client

    with pytest.raises(HTTPException) as exc_char:
        safe_resolve_media_path("char_abc\n", "portraits", "default_123.webp")
    assert exc_char.value.status_code == 400

    with pytest.raises(HTTPException) as exc_file:
        safe_resolve_media_path("char_abc", "portraits", "default_123.webp\n")
    assert exc_file.value.status_code == 400

    outside_target = tmp_path / "outside_secret.webp"
    outside_target.write_bytes(b"SECRET")
    char_portraits = Path(settings.media_dir) / "characters" / "char_sym" / "portraits"
    char_portraits.mkdir(parents=True, exist_ok=True)
    symlink_path = char_portraits / "leak.webp"
    os.symlink(outside_target, symlink_path)

    with pytest.raises(HTTPException) as exc_sym:
        safe_resolve_media_path("char_sym", "portraits", "leak.webp")
    assert exc_sym.value.status_code == 403


