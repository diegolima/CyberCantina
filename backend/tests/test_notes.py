"""Tests for User Notes repository, smart ordering, privacy, and API endpoints."""

from __future__ import annotations

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.schemas.auth import UserProfile


@pytest.fixture()
def test_repo(tmp_path: Path) -> CantinaRepository:
    """Provide an isolated, freshly initialized repository."""
    db_file = str(tmp_path / "test_notes.db")
    repo = CantinaRepository(db_file)
    repo.init_db()
    return repo


def test_user_note_crud_and_ordering(test_repo: CantinaRepository) -> None:
    u1 = test_repo.create_user(username="user_alpha", display_name="Alpha")
    u2 = test_repo.create_user(username="user_beta", display_name="Beta")

    # 1. Create notes for user1
    n1 = test_repo.create_user_note(
        owner_id=u1.id,
        title="Combat Tactics",
        content="Keep distance, use EMP grenades.",
        tags=["#combat", "tactics", "emp"],
        is_starred=False,
    )
    assert n1.id.startswith("note_")
    assert n1.title == "Combat Tactics"
    assert n1.tags == ["combat", "tactics", "emp"]
    assert not n1.is_starred

    n2 = test_repo.create_user_note(
        owner_id=u1.id,
        title="Viktor Secrets",
        content="Knows about the black market chip.",
        tags=["viktor", "cyberware"],
        is_starred=True,
    )
    assert n2.is_starred

    # 2. List user1 notes: starred note should come first
    notes = test_repo.list_user_notes(u1.id)
    assert len(notes) == 2
    assert notes[0].id == n2.id
    assert notes[1].id == n1.id

    # 3. Privacy isolation: user2 should have 0 notes
    assert len(test_repo.list_user_notes(u2.id)) == 0
    assert test_repo.get_user_note(n1.id, owner_id=u2.id) is None

    # 4. Update note: change star and content
    updated = test_repo.update_user_note(
        n1.id,
        owner_id=u1.id,
        is_starred=True,
        content="Updated: aim for weak points.",
    )
    assert updated is not None
    assert updated.is_starred
    assert updated.content == "Updated: aim for weak points."

    # 5. User2 cannot delete user1's note
    assert not test_repo.delete_user_note(n1.id, owner_id=u2.id)

    # 6. User1 deletes note
    assert test_repo.delete_user_note(n1.id, owner_id=u1.id)
    assert test_repo.get_user_note(n1.id, owner_id=u1.id) is None
    assert len(test_repo.list_user_notes(u1.id)) == 1


def test_notes_api_endpoints(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = str(tmp_path / "test_notes_api.db")
    repo = CantinaRepository(db_file)
    repo.init_db()

    user = repo.create_user(username="netrunner", display_name="Netrunner")

    monkeypatch.setattr(main_module, "get_repo", lambda: repo)
    monkeypatch.setattr(settings, "db_path", db_file)

    user_profile = repo.get_user_by_id(user.id)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    client = TestClient(main_module.app)

    try:
        # GET empty list
        resp = client.get("/api/notes")
        assert resp.status_code == 200
        assert resp.json() == []

        # POST create note
        payload = {
            "title": "Neon Bar Intel",
            "content": "Speak with bartender about access code.",
            "tags": ["neon", "quest"],
            "is_starred": True,
        }
        create_resp = client.post("/api/notes", json=payload)
        assert create_resp.status_code == 200
        created = create_resp.json()
        assert created["title"] == "Neon Bar Intel"
        assert created["tags"] == ["neon", "quest"]
        assert created["is_starred"] is True
        note_id = created["id"]

        # GET note by id
        get_resp = client.get(f"/api/notes/{note_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == note_id

        # PUT update note
        update_resp = client.put(
            f"/api/notes/{note_id}",
            json={"title": "Updated Intel", "is_starred": False},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["title"] == "Updated Intel"
        assert update_resp.json()["is_starred"] is False

        # DELETE note
        del_resp = client.delete(f"/api/notes/{note_id}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleted"

        # Verify gone
        get_again = client.get(f"/api/notes/{note_id}")
        assert get_again.status_code == 404
    finally:
        main_module.app.dependency_overrides.clear()
