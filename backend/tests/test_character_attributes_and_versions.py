"""Tests for Character tags, creator metadata, Model A creator notes, and character versioning."""

from __future__ import annotations

import pytest
from app.db.repository import CantinaRepository
from app.schemas.character import (
    BaselinePsyche,
    CharacterUpdatePayload,
    CharacterWizardDraft,
    MemoryShard,
    VoiceAnchor,
)


def _make_sample_draft(name: str = "Talon Frost") -> CharacterWizardDraft:
    return CharacterWizardDraft(
        name=name,
        tagline="Infiltration specialist with sub-dermal optical camouflage.",
        physical_appearance="Athletic build, grey-blue eyes, cybernetic mesh along neck.",
        core_persona="Cool-headed, calculating, rarely raises voice.",
        initial_message="*Talon checks the security cameras.* \"We have three minutes.\"",
        equipped=["Stealth combat suit"],
        inventory=["Lockpick matrix", "Thermal vision goggles"],
        tags=["stealth", "infiltrator", "cyberware"],
        creator="Nightfall",
        creator_notes="Prefers stealth routes over combat. Never betrays a client without proof.",
        voice_anchors=[
            VoiceAnchor(
                context="Infiltrating",
                snippet="*Talon lowers his voice.* \"Stay behind me and watch the laser sweep.\"",
            )
        ],
        baseline_psyche=BaselinePsyche(
            mood_label="Cool and focused",
            valence=0.1,
            arousal=0.4,
            core_drive="Uncover who framed his old unit.",
            core_fear="Permanent system shutdown.",
            default_want="Bypass the security checkpoint.",
            default_plan="Use EMP jammer on terminal.",
        ),
        memory_shards=[
            MemoryShard(
                title="The Blackout Protocol",
                content="Talon escaped the military facility during a staged blackout.",
                keywords=["blackout", "escape", "facility"],
                emotional_weight=0.8,
            )
        ],
    )


def test_character_creation_and_attributes(temp_repo: CantinaRepository) -> None:
    """Verify character creation initializes version=1 and stores tags, creator, and creator_notes."""
    user = temp_repo.create_user(username="user_test_1", display_name="Test User 1")
    draft = _make_sample_draft()
    char = temp_repo.create_character_from_draft(draft, owner_id=user.id)

    assert char.version == 1
    assert char.name == "Talon Frost"
    assert "stealth" in char.tags
    assert "infiltrator" in char.tags
    assert char.creator == "Nightfall"
    assert char.creator_notes == "Prefers stealth routes over combat. Never betrays a client without proof."

    # Verify version 1 snapshot exists in character_versions
    versions = temp_repo.list_character_versions(char.id, owner_id=user.id)
    assert len(versions) == 1
    assert versions[0].version == 1
    assert versions[0].character_id == char.id

    v1_char = temp_repo.get_character_version(char.id, 1, owner_id=user.id)
    assert v1_char.version == 1
    assert v1_char.name == "Talon Frost"
    assert v1_char.creator == "Nightfall"


def test_character_edits_increment_version(temp_repo: CantinaRepository) -> None:
    """Verify editing a character increments version and maintains read-only historical snapshots."""
    user = temp_repo.create_user(username="user_test_2", display_name="Test User 2")
    draft = _make_sample_draft("Renna Kane")
    char_v1 = temp_repo.create_character_from_draft(draft, owner_id=user.id)
    assert char_v1.version == 1

    # Update 1: Rename and add new tags
    char_v2 = temp_repo.update_character(
        char_v1.id,
        CharacterUpdatePayload(
            name="Renna Kane (Armored)",
            tagline=char_v1.tagline,
            physical_appearance=char_v1.physical_appearance,
            core_persona=char_v1.core_persona,
            initial_message=char_v1.initial_message,
            equipped=["Ceramic reinforced chestplate"],
            inventory=char_v1.inventory,
            tags=["stealth", "armored-v2"],
            creator="Nightfall",
            creator_notes="Updated notes: now carries heavy armor.",
            voice_anchors=char_v1.voice_anchors,
            baseline_psyche=char_v1.baseline_psyche,
            memory_shards=char_v1.memory_shards,
            world_id=char_v1.world_id,
        ),
        owner_id=user.id,
    )
    assert char_v2.id == char_v1.id
    assert char_v2.version == 2
    assert char_v2.name == "Renna Kane (Armored)"
    assert "armored-v2" in char_v2.tags
    assert "Ceramic reinforced chestplate" in char_v2.equipped

    # Update 2: Another edit
    char_v3 = temp_repo.update_character(
        char_v1.id,
        CharacterUpdatePayload(
            name="Renna Kane (Master)",
            tagline=char_v1.tagline,
            physical_appearance=char_v1.physical_appearance,
            core_persona=char_v1.core_persona,
            initial_message=char_v1.initial_message,
            equipped=char_v2.equipped,
            inventory=char_v2.inventory,
            tags=["master", "covert"],
            creator="Nightfall",
            creator_notes="Final notes.",
            voice_anchors=char_v1.voice_anchors,
            baseline_psyche=char_v1.baseline_psyche,
            memory_shards=char_v1.memory_shards,
            world_id=char_v1.world_id,
        ),
        owner_id=user.id,
    )
    assert char_v3.version == 3

    # Check version history
    versions = temp_repo.list_character_versions(char_v1.id, owner_id=user.id)
    assert len(versions) == 3
    assert [v.version for v in versions] == [3, 2, 1]

    # Verify past versions are immutable and read-only
    hist_v1 = temp_repo.get_character_version(char_v1.id, 1, owner_id=user.id)
    assert hist_v1.version == 1
    assert hist_v1.name == "Renna Kane"
    assert hist_v1.equipped == ["Stealth combat suit"]

    hist_v2 = temp_repo.get_character_version(char_v1.id, 2, owner_id=user.id)
    assert hist_v2.version == 2
    assert hist_v2.name == "Renna Kane (Armored)"
    assert hist_v2.equipped == ["Ceramic reinforced chestplate"]

    hist_v3 = temp_repo.get_character_version(char_v1.id, 3, owner_id=user.id)
    assert hist_v3.version == 3
    assert hist_v3.name == "Renna Kane (Master)"


def test_creator_notes_model_a_federation(temp_repo: CantinaRepository) -> None:
    """Verify Model A federates character.creator_notes into user_notes listing and supports note operations."""
    user = temp_repo.create_user(username="user_notes_owner", display_name="Notes Owner")
    draft = _make_sample_draft("Dr. Kaelen")
    draft.creator_notes = "Special notes on Kaelen's medical history."
    char = temp_repo.create_character_from_draft(draft, owner_id=user.id)

    # 1. list_user_notes should include the virtual note
    notes = temp_repo.list_user_notes(user.id)
    virtual_note = next((n for n in notes if n.id == f"char_note_{char.id}"), None)
    assert virtual_note is not None
    assert virtual_note.is_character_note is True
    assert virtual_note.character_id == char.id
    assert virtual_note.title == "Dr. Kaelen — Creator Notes"
    assert virtual_note.content == "Special notes on Kaelen's medical history."
    # Tag must include character name slug
    assert "dr-kaelen" in virtual_note.tags
    assert "creator-notes" in virtual_note.tags

    # 2. get_user_note should retrieve the virtual note
    fetched = temp_repo.get_user_note(f"char_note_{char.id}", user.id)
    assert fetched is not None
    assert fetched.content == "Special notes on Kaelen's medical history."

    # 3. update_user_note on virtual note should update character.creator_notes
    updated_note = temp_repo.update_user_note(
        f"char_note_{char.id}",
        user.id,
        content="Amended notes regarding neurological surgery.",
    )
    assert updated_note is not None
    assert updated_note.content == "Amended notes regarding neurological surgery."

    refreshed_char = temp_repo.get_character(char.id, owner_id=user.id)
    assert refreshed_char.creator_notes == "Amended notes regarding neurological surgery."

    # 4. delete_user_note on virtual note should clear creator_notes on character
    deleted = temp_repo.delete_user_note(f"char_note_{char.id}", user.id)
    assert deleted is True

    cleared_char = temp_repo.get_character(char.id, owner_id=user.id)
    assert cleared_char.creator_notes == ""

    # Should no longer appear in list_user_notes
    notes_after_del = temp_repo.list_user_notes(user.id)
    assert not any(n.id == f"char_note_{char.id}" for n in notes_after_del)


def test_versioning_with_active_campaign(temp_repo: CantinaRepository) -> None:
    """Verify that editing a character referenced by an active campaign copies version history to the forked entity."""
    user = temp_repo.create_user(username="user_camp", display_name="Camp User")
    temp_repo.claim_unowned_entities(user.id)
    world = temp_repo.get_world("world_neon_rust", owner_id=user.id)
    draft = _make_sample_draft("Soren Runner")
    char_v1 = temp_repo.create_character_from_draft(draft, world_id=world.id, owner_id=user.id)

    # Start a campaign referencing char_v1
    camp = temp_repo.create_campaign(
        name="Soren Campaign",
        world_id=world.id,
        character_id=char_v1.id,
        owner_id=user.id,
    )
    assert camp.character_id == char_v1.id

    # Edit Soren Runner while in an active campaign -> triggers Copy-on-Write fork
    forked_v2 = temp_repo.update_character(
        char_v1.id,
        CharacterUpdatePayload(
            name="Soren Runner (Cybernetic)",
            tagline=char_v1.tagline,
            physical_appearance=char_v1.physical_appearance,
            core_persona=char_v1.core_persona,
            initial_message=char_v1.initial_message,
            equipped=char_v1.equipped,
            inventory=char_v1.inventory,
            tags=char_v1.tags,
            creator=char_v1.creator,
            creator_notes=char_v1.creator_notes,
            voice_anchors=char_v1.voice_anchors,
            baseline_psyche=char_v1.baseline_psyche,
            memory_shards=char_v1.memory_shards,
            world_id=char_v1.world_id,
        ),
        owner_id=user.id,
    )
    assert forked_v2.id != char_v1.id
    assert forked_v2.version == 2

    # The new forked character has access to both v1 and v2 in history!
    forked_versions = temp_repo.list_character_versions(forked_v2.id, owner_id=user.id)
    assert len(forked_versions) == 2
    assert [v.version for v in forked_versions] == [2, 1]

    hist_v1 = temp_repo.get_character_version(forked_v2.id, 1, owner_id=user.id)
    assert hist_v1.name == "Soren Runner"
    assert hist_v1.version == 1

    hist_v2 = temp_repo.get_character_version(forked_v2.id, 2, owner_id=user.id)
    assert hist_v2.name == "Soren Runner (Cybernetic)"
    assert hist_v2.version == 2


def test_character_versions_and_notes_api(
    temp_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify REST API routes for character versions and federated creator notes."""
    from fastapi.testclient import TestClient
    from app import main as main_module

    user = temp_repo.create_user(username="api_user", display_name="API Tester")
    temp_repo.claim_unowned_entities(user.id)
    user_profile = temp_repo.get_user_by_id(user.id)

    monkeypatch.setattr(main_module, "get_repo", lambda: temp_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    client = TestClient(main_module.app)
    try:
        draft = _make_sample_draft("Vespera Scout")
        draft.creator_notes = "Scout notes for API test."
        char = temp_repo.create_character_from_draft(draft, owner_id=user.id)

        # Update character to get v2
        temp_repo.update_character(
            char.id,
            CharacterUpdatePayload(
                name="Vespera Scout (Veteran)",
                tagline=char.tagline,
                physical_appearance=char.physical_appearance,
                core_persona=char.core_persona,
                initial_message=char.initial_message,
                equipped=["Reflective vest"],
                inventory=char.inventory,
                tags=char.tags,
                creator=char.creator,
                creator_notes=char.creator_notes,
                voice_anchors=char.voice_anchors,
                baseline_psyche=char.baseline_psyche,
                memory_shards=char.memory_shards,
                world_id=char.world_id,
            ),
            owner_id=user.id,
        )

        # 1. GET /api/characters/{id}/versions
        vers_resp = client.get(f"/api/characters/{char.id}/versions")
        assert vers_resp.status_code == 200
        vers_data = vers_resp.json()
        assert len(vers_data) == 2
        assert vers_data[0]["version"] == 2
        assert vers_data[1]["version"] == 1

        # 2. GET /api/characters/{id}/versions/1
        v1_resp = client.get(f"/api/characters/{char.id}/versions/1")
        assert v1_resp.status_code == 200
        v1_data = v1_resp.json()
        assert v1_data["version"] == 1
        assert v1_data["name"] == "Vespera Scout"

        # 3. GET /api/characters/{id}/versions/2
        v2_resp = client.get(f"/api/characters/{char.id}/versions/2")
        assert v2_resp.status_code == 200
        v2_data = v2_resp.json()
        assert v2_data["version"] == 2
        assert v2_data["name"] == "Vespera Scout (Veteran)"

        # 4. GET /api/notes should show federated note
        notes_resp = client.get("/api/notes")
        assert notes_resp.status_code == 200
        notes_data = notes_resp.json()
        v_note = next((n for n in notes_data if n["id"] == f"char_note_{char.id}"), None)
        assert v_note is not None
        assert v_note["title"] == "Vespera Scout (Veteran) — Creator Notes"
        assert v_note["is_character_note"] is True
        assert v_note["character_id"] == char.id
        assert "vespera-scout-veteran" in v_note["tags"]
    finally:
        main_module.app.dependency_overrides.clear()
