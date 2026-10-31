import io
from pathlib import Path
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.config import settings
from app.db.repository import CantinaRepository
from app import main as main_module
from app.schemas.character import CharacterWizardDraft, BaselinePsyche, VoiceAnchor, MemoryShard


def _create_test_image(width: int = 400, height: int = 300, color: str = "red") -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def test_setup(temp_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    media_dir = str(tmp_path / "media")
    settings.media_dir = media_dir
    temp_repo.media_dir = media_dir

    user = temp_repo.create_user(username="media_tester", display_name="Media Tester")
    temp_repo.claim_unowned_entities(user.id)
    user_profile = temp_repo.get_user_by_id(user.id)

    monkeypatch.setattr(main_module, "get_repo", lambda: temp_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    draft = CharacterWizardDraft(
        name="Media Test NPC",
        tagline="A test subject for portraits",
        physical_appearance="Athletic build, cybernetic left eye.",
        core_persona="Cautious and observant.",
        initial_message="Greetings, traveler.",
        baseline_psyche=BaselinePsyche(
            core_drive="Survival",
            core_fear="Failure",
            default_want="Safety",
            default_plan="Assess risks",
        ),
        equipped=["Tactical Vest"],
        inventory=["Data Chip"],
        voice_anchors=[VoiceAnchor(context="Calm", snippet="All clear.")],
        memory_shards=[MemoryShard(title="Origin", content="Born in Neon City.")],
        tags=["cyberpunk", "tester"],
        creator="Unit Tester",
        creator_notes="Handle with care.",
    )
    char = temp_repo.create_character_from_draft(draft, owner_id=user.id)

    client = TestClient(main_module.app)
    yield temp_repo, user, char, client

    main_module.app.dependency_overrides.clear()


def test_portrait_upload_crop_and_retrieval(test_setup):
    repo, user, char, client = test_setup

    img_bytes = _create_test_image(800, 600, "blue")
    res = client.post(
        f"/api/characters/{char.id}/portraits/happy",
        files={"file": ("happy.png", img_bytes, "image/png")},
    )
    assert res.status_code == 200
    data = res.json()
    assert "happy" in data["portraits"]
    media_url = data["portraits"]["happy"]
    assert media_url.startswith(f"/api/media/characters/{char.id}/portraits/happy_")
    assert media_url.endswith(".webp")

    # Fetch static media asset
    media_res = client.get(media_url)
    assert media_res.status_code == 200
    assert media_res.headers["content-type"] == "image/webp"

    # Verify square cropping (max 512x512)
    saved_img = Image.open(io.BytesIO(media_res.content))
    assert saved_img.size == (512, 512)


def test_portrait_replace_and_delete(test_setup):
    repo, user, char, client = test_setup

    # Upload first
    img1 = _create_test_image(200, 200, "green")
    res1 = client.post(
        f"/api/characters/{char.id}/portraits/angry",
        files={"file": ("angry.png", img1, "image/png")},
    )
    assert res1.status_code == 200
    url1 = res1.json()["portraits"]["angry"]

    # Replace with second
    img2 = _create_test_image(300, 300, "yellow")
    res2 = client.post(
        f"/api/characters/{char.id}/portraits/angry",
        files={"file": ("angry2.png", img2, "image/png")},
    )
    assert res2.status_code == 200
    url2 = res2.json()["portraits"]["angry"]
    assert url1 != url2

    # Old file must no longer exist
    assert client.get(url1).status_code == 404
    # New file must exist
    assert client.get(url2).status_code == 200

    # Delete portrait
    del_res = client.delete(f"/api/characters/{char.id}/portraits/angry")
    assert del_res.status_code == 200
    assert "angry" not in del_res.json()["portraits"]
    assert client.get(url2).status_code == 404


def test_invalid_emotion_rejected(test_setup):
    repo, user, char, client = test_setup

    img_bytes = _create_test_image(100, 100)
    res = client.post(
        f"/api/characters/{char.id}/portraits/nonexistent_emotion",
        files={"file": ("test.png", img_bytes, "image/png")},
    )
    assert res.status_code == 400
    assert "Invalid emotion" in res.json()["detail"]


def test_gallery_upload_and_delete(test_setup):
    repo, user, char, client = test_setup

    img_bytes = _create_test_image(1200, 800, "purple")
    res = client.post(
        f"/api/characters/{char.id}/gallery",
        data={"caption": "Sunset on Sector 7"},
        files={"file": ("sunset.png", img_bytes, "image/png")},
    )
    assert res.status_code == 200
    gallery = res.json()["gallery"]
    assert len(gallery) == 1
    item = gallery[0]
    assert item["caption"] == "Sunset on Sector 7"
    assert item["url"].startswith(f"/api/media/characters/{char.id}/gallery/img_")

    # Fetch image
    get_res = client.get(item["url"])
    assert get_res.status_code == 200
    assert get_res.headers["content-type"] == "image/webp"

    # Delete image
    del_res = client.delete(f"/api/characters/{char.id}/gallery/{item['id']}")
    assert del_res.status_code == 200
    assert len(del_res.json()["gallery"]) == 0
    assert client.get(item["url"]).status_code == 404


def test_character_version_preserves_static_media(test_setup):
    repo, user, char, client = test_setup

    # Upload default portrait & a gallery image
    client.post(
        f"/api/characters/{char.id}/portraits/default",
        files={"file": ("default.png", _create_test_image(200, 200), "image/png")},
    )
    client.post(
        f"/api/characters/{char.id}/gallery",
        data={"caption": "Action Shot"},
        files={"file": ("action.png", _create_test_image(300, 200), "image/png")},
    )

    # Edit character text attributes to increment version
    update_payload = {
        "name": "Media Test NPC (Updated)",
        "tagline": "Updated tagline",
        "physical_appearance": char.physical_appearance,
        "core_persona": "More seasoned and vigilant.",
        "initial_message": char.initial_message,
        "equipped": char.equipped,
        "inventory": char.inventory,
        "voice_anchors": [v.model_dump() for v in char.voice_anchors],
        "baseline_psyche": char.baseline_psyche.model_dump(),
        "memory_shards": [m.model_dump() for m in char.memory_shards],
        "tags": char.tags,
        "creator": char.creator,
        "creator_notes": char.creator_notes,
    }
    put_res = client.put(f"/api/characters/{char.id}", json=update_payload)
    assert put_res.status_code == 200
    v2_char = put_res.json()
    assert v2_char["version"] == 2
    assert "default" in v2_char["portraits"]
    assert len(v2_char["gallery"]) == 1

    # Fetch version 1 historical snapshot
    v1_res = client.get(f"/api/characters/{char.id}/versions/1")
    assert v1_res.status_code == 200
    v1_char = v1_res.json()
    assert v1_char["name"] == "Media Test NPC"
    assert v1_char["version"] == 1
    # Crucial: static media is maintained even when viewing historical version 1
    assert "default" in v1_char["portraits"]
    assert len(v1_char["gallery"]) == 1
    assert v1_char["gallery"][0]["caption"] == "Action Shot"
