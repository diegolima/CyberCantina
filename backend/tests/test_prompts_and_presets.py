"""Tests for Prompt Presets, Rendering Engine, Validation, and Storage."""

from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.prompts import (
    FACTORY_DEFAULT_PROMPTS,
    PROMPT_KEY_ACTOR_ZONE1,
    PROMPT_KEY_CLERK_POST_TURN,
    get_default_prompt,
    render_template,
    validate_prompt_template,
)
from app.schemas.auth import UserModelSettingsPayload
from app.schemas.prompt import PromptPresetRecord


def test_render_template_variable_substitution() -> None:
    """Verify {var} and {{ var }} placeholders are cleanly substituted."""
    tpl = "Hello {character_name}! Welcome to {{ world_name }} with tone {tone}."
    rendered = render_template(tpl, character_name="Kira", world_name="Sector 9", tone="Gritty")
    assert rendered == "Hello Kira! Welcome to Sector 9 with tone Gritty."


def test_render_template_json_safety() -> None:
    """Ensure raw curly braces in JSON schemas and regex patterns do not trigger errors."""
    tpl = (
        "Role: {character_name}.\n"
        "Return schema: {requires_roll (bool), action: str}\n"
        "Raw JSON: {\"success\": true, \"count\": 42}"
    )
    rendered = render_template(tpl, character_name="Vance")
    assert "Role: Vance." in rendered
    assert "{requires_roll (bool), action: str}" in rendered
    assert "{\"success\": true, \"count\": 42}" in rendered


def test_validate_prompt_template() -> None:
    """Verify structural warnings for missing required tokens like <cognition>."""
    bad_actor_prompt = "You are a bartender. Write dialogue directly."
    warnings = validate_prompt_template(PROMPT_KEY_ACTOR_ZONE1, bad_actor_prompt)
    assert len(warnings) > 0
    assert any("<cognition>" in w for w in warnings)

    good_actor_prompt = FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_ZONE1]
    good_warnings = validate_prompt_template(PROMPT_KEY_ACTOR_ZONE1, good_actor_prompt)
    assert len(good_warnings) == 0


def test_builtin_presets_have_no_missing_required_tags() -> None:
    """Verify every built-in preset prompt satisfies PROMPTS_METADATA required_tags with zero warnings."""
    from app.prompts.defaults import BUILTIN_PRESETS, PROMPTS_METADATA

    for preset in BUILTIN_PRESETS:
        for meta in PROMPTS_METADATA:
            key = meta["key"]
            tpl = preset["prompts"].get(key, "")
            warnings = validate_prompt_template(key, tpl)
            assert warnings == [], f"Preset {preset['id']} prompt {key} has warnings: {warnings}"


@pytest.fixture()
def test_repo(tmp_path: Path) -> CantinaRepository:
    """Provide an isolated, freshly initialized repository with built-in presets."""
    db_file = str(tmp_path / "test_prompts.db")
    repo = CantinaRepository(db_file)
    repo.init_db()
    return repo


def test_builtin_presets_seeded(test_repo: CantinaRepository) -> None:
    """Verify init_db seeds the built-in system presets."""
    presets = test_repo.list_prompt_presets()
    preset_ids = {p.id for p in presets}
    assert "builtin-default" in preset_ids
    assert "builtin-novelistic" in preset_ids
    assert "builtin-fast-concise" in preset_ids

    default_preset = test_repo.get_prompt_preset("builtin-default")
    assert default_preset is not None
    assert default_preset.is_builtin is True
    assert default_preset.prompts[PROMPT_KEY_ACTOR_ZONE1] == FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_ZONE1]


def test_custom_preset_crud_and_reset(test_repo: CantinaRepository) -> None:
    """Test creating, updating, resetting to defaults, and deleting custom presets."""
    test_user = test_repo.create_user(username="cruduser", user_id="user_123")
    # 1. Create custom preset
    custom_prompts = {
        PROMPT_KEY_ACTOR_ZONE1: "Custom Actor Zone 1: Roleplay as {character_name} <cognition></cognition>",
    }
    created = test_repo.create_prompt_preset(
        owner_id=test_user.id,
        name="Cyberpunk Hardboiled",
        description="Grittier tone with fast responses.",
        prompts=custom_prompts,
    )
    assert created.id.startswith("preset_")
    assert created.name == "Cyberpunk Hardboiled"
    assert created.is_builtin is False
    assert created.prompts[PROMPT_KEY_ACTOR_ZONE1] == custom_prompts[PROMPT_KEY_ACTOR_ZONE1]
    # Missing prompts cleanly fall back to factory defaults
    assert created.prompts[PROMPT_KEY_CLERK_POST_TURN] == FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_CLERK_POST_TURN]

    # 2. Update custom preset
    updated = test_repo.update_prompt_preset(
        created.id,
        name="Cyberpunk Hardboiled v2",
        prompts={PROMPT_KEY_ACTOR_ZONE1: "Updated Actor System <cognition></cognition>"},
        user_id=test_user.id,
    )
    assert updated.name == "Cyberpunk Hardboiled v2"
    assert updated.prompts[PROMPT_KEY_ACTOR_ZONE1] == "Updated Actor System <cognition></cognition>"

    # 3. Built-in presets are protected from modification
    with pytest.raises(ValueError, match="Built-in presets cannot be edited"):
        test_repo.update_prompt_preset("builtin-default", name="Hacked Default")

    # 4. Reset custom preset back to defaults
    reset = test_repo.reset_prompt_preset(created.id, user_id=test_user.id)
    assert reset.prompts[PROMPT_KEY_ACTOR_ZONE1] == FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_ZONE1]

    # 5. Delete custom preset
    deleted = test_repo.delete_prompt_preset(created.id, user_id=test_user.id)
    assert deleted is True
    assert test_repo.get_prompt_preset(created.id) is None

    # 6. Built-in presets are protected from deletion
    with pytest.raises(ValueError, match="Built-in system presets cannot be deleted"):
        test_repo.delete_prompt_preset("builtin-default")


def test_resolve_effective_prompts_hierarchy(test_repo: CantinaRepository) -> None:
    """Test resolution hierarchy: Campaign preset > User active preset > Factory default."""
    test_user = test_repo.create_user(username="hieruser", user_id="user_abc")
    ensure_default_seed(test_repo, owner_id=test_user.id)
    world = test_repo.list_worlds(owner_id=test_user.id)[0]
    char = test_repo.list_characters(owner_id=test_user.id)[0]

    # 1. Base resolution with no user/campaign gives default
    eff = test_repo.resolve_effective_prompts()
    assert eff[PROMPT_KEY_ACTOR_ZONE1] == FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_ZONE1]

    # 2. Create user active preset
    user_preset = test_repo.create_prompt_preset(
        owner_id=test_user.id,
        name="User Custom Preset",
        prompts={PROMPT_KEY_ACTOR_ZONE1: "User Actor System <cognition></cognition>"},
    )
    # Save in user_model_settings
    test_repo.save_user_model_settings(
        test_user.id,
        UserModelSettingsPayload(active_prompt_preset_id=user_preset.id),
    )

    eff_user = test_repo.resolve_effective_prompts(user_id=test_user.id)
    assert eff_user[PROMPT_KEY_ACTOR_ZONE1] == "User Actor System <cognition></cognition>"

    # 3. Create a campaign preset override
    campaign_preset = test_repo.create_prompt_preset(
        owner_id=test_user.id,
        name="Campaign Specific Preset",
        prompts={PROMPT_KEY_ACTOR_ZONE1: "Campaign Override Actor <cognition></cognition>"},
    )
    # Simulate a campaign with prompt_preset_id set
    conn = test_repo._connect()
    try:
        conn.execute(
            """
            INSERT INTO campaigns (id, owner_id, name, world_id, character_id, active_leaf_turn_id, prompt_preset_id, created_at)
            VALUES ('camp_test_preset', ?, 'Test Camp', ?, ?, NULL, ?, '2026-10-27T00:00:00Z')
            """,
            (test_user.id, world.id, char.id, campaign_preset.id),
        )
        conn.commit()
    finally:
        conn.close()

    eff_camp = test_repo.resolve_effective_prompts(user_id=test_user.id, campaign_id="camp_test_preset")
    assert eff_camp[PROMPT_KEY_ACTOR_ZONE1] == "Campaign Override Actor <cognition></cognition>"


@pytest.fixture()
def client_with_auth(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, CantinaRepository]:
    """Provide an authenticated TestClient with an admin user."""
    db_file = str(tmp_path / "test_api_prompts.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)

    repo = CantinaRepository(db_file)
    repo.init_db()

    client = TestClient(main_module.app)
    # Perform initial admin setup
    setup_res = client.post(
        "/api/auth/setup",
        json={"username": "adminuser", "password": "AdminPassword123!"},
    )
    assert setup_res.status_code == 200
    return client, repo


def test_prompts_rest_api_lifecycle(client_with_auth: tuple[TestClient, CantinaRepository]) -> None:
    """Test the full REST API lifecycle for Prompt Presets."""
    client, _repo = client_with_auth

    # 1. GET /api/prompts/defaults
    defaults_res = client.get("/api/prompts/defaults")
    assert defaults_res.status_code == 200
    data = defaults_res.json()
    assert "defaults" in data
    assert "metadata" in data
    assert "presets" in data
    assert len(data["presets"]) >= 3
    assert PROMPT_KEY_ACTOR_ZONE1 in data["defaults"]

    # 2. GET /api/prompts/presets
    list_res = client.get("/api/prompts/presets")
    assert list_res.status_code == 200
    presets = list_res.json()
    assert any(p["id"] == "builtin-default" for p in presets)

    # 3. POST /api/prompts/presets (Create custom preset cloned from builtin-default)
    create_res = client.post(
        "/api/prompts/presets",
        json={
            "name": "API Created Preset",
            "description": "Created via API tests",
            "base_preset_id": "builtin-default",
            "prompts": {
                PROMPT_KEY_ACTOR_ZONE1: "API Custom Zone 1 <cognition></cognition>",
            },
        },
    )
    assert create_res.status_code == 200
    created = create_res.json()
    preset_id = created["id"]
    assert created["name"] == "API Created Preset"
    assert created["prompts"][PROMPT_KEY_ACTOR_ZONE1] == "API Custom Zone 1 <cognition></cognition>"

    # 4. PUT /api/prompts/presets/{preset_id} (Update)
    update_res = client.put(
        f"/api/prompts/presets/{preset_id}",
        json={
            "name": "API Updated Preset",
            "prompts": {
                PROMPT_KEY_ACTOR_ZONE1: "API Custom Zone 1 Updated <cognition></cognition>",
            },
        },
    )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["name"] == "API Updated Preset"
    assert updated["prompts"][PROMPT_KEY_ACTOR_ZONE1] == "API Custom Zone 1 Updated <cognition></cognition>"

    # 5. POST /api/prompts/presets/{preset_id}/reset
    reset_res = client.post(f"/api/prompts/presets/{preset_id}/reset")
    assert reset_res.status_code == 200
    reset_data = reset_res.json()
    assert reset_data["prompts"][PROMPT_KEY_ACTOR_ZONE1] == FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_ACTOR_ZONE1]

    # 6. DELETE /api/prompts/presets/{preset_id}
    del_res = client.delete(f"/api/prompts/presets/{preset_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"

    # Verify 404 after deletion
    get_res = client.get(f"/api/prompts/presets/{preset_id}")
    assert get_res.status_code == 404


def test_character_cognition_prompt_affordance_hierarchy() -> None:
    """Verify that DEFAULT_CHARACTER_COGNITION_SYSTEM contains the 4-tier affordance hierarchy."""
    from app.prompts.defaults import (
        DEFAULT_ACTOR_ZONE1_SYSTEM,
        DEFAULT_CHARACTER_COGNITION_SYSTEM,
        NOVELISTIC_ACTOR_ZONE1,
    )

    for p in (
        DEFAULT_CHARACTER_COGNITION_SYSTEM,
        DEFAULT_ACTOR_ZONE1_SYSTEM,
        NOVELISTIC_ACTOR_ZONE1,
    ):
        assert "=== PHYSICAL ACTION & OBJECT INTERACTION HIERARCHY ===" in p
        assert "1. Equipped & In-Hand" in p
        assert "2. Carried Inventory" in p
        assert "3. Scene Props & Fixtures" in p
        assert "4. Terminal Fallback" in p
        assert "Never manifest or invent unlisted mechanical items" in p


def test_active_prompt_preset_api_and_isolation(client_with_auth: tuple[TestClient, CantinaRepository], monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that users can set, fetch, and clear active prompt presets, even with model overrides disabled."""
    client, repo = client_with_auth

    # Disable user model overrides to verify prompt presets are NOT blocked
    monkeypatch.setattr(settings, "allow_user_model_overrides", False)

    # 1. Initially no active preset override (null in defaults)
    defaults = client.get("/api/prompts/defaults").json()
    assert defaults["active_preset_id"] is None

    # 2. Create custom preset
    create_res = client.post(
        "/api/prompts/presets",
        json={"name": "Noir Active Test", "base_preset_id": "builtin-default"},
    )
    assert create_res.status_code == 200
    preset_id = create_res.json()["id"]

    # 3. Set active via PUT /api/prompts/active
    set_res = client.put("/api/prompts/active", json={"preset_id": preset_id})
    assert set_res.status_code == 200
    assert set_res.json()["active_prompt_preset_id"] == preset_id

    # 4. GET /api/prompts/active and GET /api/prompts/defaults reflect the active preset
    get_res = client.get("/api/prompts/active")
    assert get_res.status_code == 200
    assert get_res.json()["active_prompt_preset_id"] == preset_id

    defaults_after = client.get("/api/prompts/defaults").json()
    assert defaults_after["active_preset_id"] == preset_id

    # 5. Saving other settings via /api/profile/models does NOT erase active_prompt_preset_id
    update_prof = client.put(
        "/api/profile/models",
        json={"working_memory_turns": 15},
    )
    assert update_prof.status_code == 200
    assert update_prof.json()["active_prompt_preset_id"] == preset_id

    # 6. Deleting active preset clears active_preset_id
    del_res = client.delete(f"/api/prompts/presets/{preset_id}")
    assert del_res.status_code == 200

    defaults_deleted = client.get("/api/prompts/defaults").json()
    assert defaults_deleted["active_preset_id"] is None

