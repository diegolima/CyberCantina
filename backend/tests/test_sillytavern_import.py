"""Unit and integration tests for SillyTavern character card imports."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from app import main as main_module
from app.config import settings
from app.db.repository import CantinaRepository
from app.schemas.character import CharacterWizardDraft
from app.wizards.sillytavern_distiller import (
    _fallback_sillytavern_distillation,
    synthesize_world_seed_from_sillytavern,
)
from app.wizards.sillytavern_parser import (
    extract_card_from_bytes,
    parse_sillytavern_json,
)


LIBBY_V2_JSON = json.dumps(
    {
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name": "Libby",
            "description": (
                "Libby\nBasic Information\nName: Libby\nFull Name: Elizabeth Quinn\nAge: 26\n"
                "Appearance\nLibby is a fit young woman with short, tousled orange-red hair and striking green eyes.\n"
                "Personality\nLibby is confident, observant, playful, and quick-witted.\n"
                "Likes\nRock music\nBurgers and pizza\n"
                "Dislikes\nSpiders\nCrowds"
            ),
            "personality": "Observant and cheeky",
            "scenario": "Undercover investigation in a downtown dive bar",
            "first_mes": (
                "As you sat at the bar alone, Libby walked up to the bar with a confident stride. "
                "\"Hey there sweetie, how're you?\""
            ),
            "mes_example": "<START>\n{{user}}: What are you looking for?\n{{char}}: *smiles* \"Nothing that concerns you, handsome.\"",
            "creator_notes": "Libby is at work, looking for criminality.",
            "alternate_greetings": [
                "Libby sits on a stool next to you. \"Buy a girl a drink?\"",
                "Libby flashes a badge under her jacket. \"We need to talk privately.\"",
            ],
            "tags": ["#female #roleplay #anypov #human #english #adventure"],
            "creator": "persia63",
            "character_version": "3",
            "extensions": {},
        },
    }
)

LEGACY_V1_JSON = json.dumps(
    {
        "name": "Marcus Kane",
        "description": "Ex-soldier turned mercenary bodyguard.",
        "personality": "Stoic and disciplined",
        "scenario": "Escorting a VIP through the warzone",
        "first_mes": "*Marcus cocks his rifle.* \"Stay behind me, {{user}}.\"",
        "mes_example": "<START>\n{{user}}: Are we clear?\nMarcus Kane: *checks perimeter* \"All clear for now.\"",
    }
)


def _create_synthetic_png_card(
    card_dict: dict,
    width: int = 300,
    height: int = 300,
    color: str = "teal",
) -> bytes:
    """Create a synthetic PNG image with a base64 'chara' metadata chunk."""
    b64_payload = base64.b64encode(json.dumps(card_dict).encode("utf-8")).decode("ascii")
    info = PngImagePlugin.PngInfo()
    info.add_text("chara", b64_payload)

    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=info)
    return buf.getvalue()


@pytest.fixture
def import_client(temp_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    media_dir = str(tmp_path / "media")
    settings.media_dir = media_dir
    temp_repo.media_dir = media_dir

    user = temp_repo.create_user(username="importer_user", display_name="Importer User")
    temp_repo.claim_unowned_entities(user.id)
    user_profile = temp_repo.get_user_by_id(user.id)

    # Fresh repository instances created per-request in production now correctly resolve staged ownership via SQLite
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    client = TestClient(main_module.app)
    yield temp_repo, user_profile, client

    main_module.app.dependency_overrides.clear()


def test_parse_sillytavern_v2_json():
    """Verify parsing of SillyTavern V2 card JSON format with tags, creator, and alternate greetings."""
    card = parse_sillytavern_json(LIBBY_V2_JSON)
    assert card.name == "Libby"
    assert card.creator == "persia63"
    assert "female" in card.tags
    assert "roleplay" in card.tags
    assert "adventure" in card.tags
    # Verify alternate greetings were appended to creator_notes
    assert "### Alternate Greetings" in card.creator_notes
    assert "Buy a girl a drink?" in card.creator_notes
    assert "Buy a girl a drink?" in card.alternate_greetings[0]


def test_parse_sillytavern_v1_json():
    """Verify parsing of legacy V1 format with macro interpolation."""
    card = parse_sillytavern_json(LEGACY_V1_JSON)
    assert card.name == "Marcus Kane"
    assert "Stay behind me, you." in card.first_mes
    assert card.creator == ""
    assert card.tags == []


def test_extract_png_chara_chunk():
    """Verify extracting card data and image bytes from a PNG file."""
    card_data = {
        "spec": "chara_card_v2",
        "data": {
            "name": "Sarah Connor",
            "description": "Fierce protector of humanity's future.",
            "first_mes": "*Sarah checks her magazine.* \"There is no fate but what we make.\"",
            "tags": ["hero", "badass"],
            "creator": "TechNoir",
        },
    }
    png_bytes = _create_synthetic_png_card(card_data, width=400, height=400, color="darkgreen")

    pkg = extract_card_from_bytes(png_bytes, "sarah.png")
    assert pkg.card.name == "Sarah Connor"
    assert pkg.card.creator == "TechNoir"
    assert "hero" in pkg.card.tags
    assert pkg.image_format == "png"
    assert len(pkg.image_bytes) > 0


def test_fallback_distillation():
    """Verify heuristic rule-based distillation extracts anatomy, persona, and shards."""
    card = parse_sillytavern_json(LIBBY_V2_JSON)
    draft = _fallback_sillytavern_distillation(card)

    assert draft.name == "Libby"
    assert "Libby" in draft.physical_appearance
    assert "orange-red hair" in draft.physical_appearance
    assert "confident" in draft.core_persona
    assert draft.creator == "persia63"
    assert "female" in draft.tags
    assert len(draft.voice_anchors) >= 1
    assert len(draft.memory_shards) >= 1
    assert draft.baseline_psyche.mood_label != ""


def test_synthesize_world_seed():
    """Verify automatic world seed generation matches scenario clues."""
    card = parse_sillytavern_json(LIBBY_V2_JSON)
    world_seed = synthesize_world_seed_from_sillytavern(card)

    assert "Libby" in world_seed.name or "Domain" in world_seed.name
    assert "Noir" in world_seed.genre_and_tone or "Crime" in world_seed.genre_and_tone
    assert world_seed.location_count == 5


def test_import_json_card_endpoint(import_client):
    """Test POST /api/wizards/character/import-sillytavern with JSON file and auto-generated world."""
    repo, user, client = import_client

    res = client.post(
        "/api/wizards/character/import-sillytavern",
        data={"auto_generate_world": "true"},
        files={"file": ("libby.json", LIBBY_V2_JSON.encode("utf-8"), "application/json")},
    )
    assert res.status_code == 200
    data = res.json()
    assert "draft" in data
    assert "preassigned_character_id" in data
    assert "auto_generated_world" in data

    draft = data["draft"]
    assert draft["name"] == "Libby"
    assert draft["creator"] == "persia63"
    assert "female" in draft["tags"]
    assert "Libby is at work" in draft["creator_notes"]
    assert len(draft["memory_shards"]) >= 1

    # Verify auto-generated world draft is valid
    world_draft = data["auto_generated_world"]
    assert world_draft is not None
    assert len(world_draft["locations"]) >= 3
    assert len(world_draft["edges"]) >= 2


def test_import_png_card_stages_media_and_commits(import_client):
    """Test importing a PNG card stages portraits and gallery, allowing preview and seamless commit."""
    repo, user, client = import_client

    card_data = {
        "spec": "chara_card_v2",
        "data": {
            "name": "Deckard Thorne",
            "description": "Cyber-detective working the rainy streets of Sector 4.",
            "first_mes": "*Deckard raises his trenchcoat collar.* \"Keep walking if you know what's good for you.\"",
            "tags": ["detective", "noir", "cyberpunk"],
            "creator": "Bladerunner99",
            "creator_notes": "Drinks synthetic whiskey only.",
        },
    }
    png_bytes = _create_synthetic_png_card(card_data, width=500, height=400, color="navy")

    # 1. Import PNG card
    import_res = client.post(
        "/api/wizards/character/import-sillytavern",
        data={"auto_generate_world": "false"},
        files={"file": ("deckard.png", png_bytes, "image/png")},
    )
    assert import_res.status_code == 200
    import_data = import_res.json()
    pre_id = import_data["preassigned_character_id"]
    draft = import_data["draft"]

    # Verify portraits["default"] and gallery[0] were created
    assert "default" in draft["portraits"]
    default_portrait_url = draft["portraits"]["default"]
    assert default_portrait_url.startswith(f"/api/media/characters/{pre_id}/portraits/")

    assert len(draft["gallery"]) == 1
    gallery_url = draft["gallery"][0]["url"]
    assert gallery_url.startswith(f"/api/media/characters/{pre_id}/gallery/")

    # 2. Verify media preview works BEFORE commit (staged ownership)
    media_res = client.get(default_portrait_url)
    assert media_res.status_code == 200
    assert media_res.headers["content-type"] == "image/webp"

    # 3. Commit character with preassigned ID
    commit_res = client.post(
        "/api/wizards/character/commit",
        json={"draft": draft, "character_id": pre_id},
    )
    assert commit_res.status_code == 200
    committed = commit_res.json()
    assert committed["id"] == pre_id
    assert committed["name"] == "Deckard Thorne"
    assert committed["creator"] == "Bladerunner99"
    assert "default" in committed["portraits"]

    # 4. Verify media is still accessible after commit
    post_commit_media = client.get(default_portrait_url)
    assert post_commit_media.status_code == 200

    # 5. Verify creator notes federated to User Notes
    notes = repo.list_user_notes(user.id)
    deckard_note = next((n for n in notes if n.character_id == pre_id), None)
    assert deckard_note is not None
    assert "synthetic whiskey" in deckard_note.content


def test_import_json_card_never_hallucinates_media(import_client):
    """Verify that importing from a text JSON card strictly results in empty portraits and gallery."""
    repo, user, client = import_client

    res = client.post(
        "/api/wizards/character/import-sillytavern",
        data={"auto_generate_world": "false"},
        files={"file": ("libby.json", LIBBY_V2_JSON.encode("utf-8"), "application/json")},
    )
    assert res.status_code == 200
    data = res.json()
    draft = data["draft"]
    assert draft["portraits"] == {}
    assert draft["gallery"] == []


def test_media_sanitization_removes_invalid_entries(temp_repo: CantinaRepository):
    """Verify that _sanitize_character_media strips out non-emotion keys and broken URLs."""
    user = temp_repo.create_user(username="sanitizer_user", display_name="Sanitizer")
    draft = CharacterWizardDraft(
        name="Test Sanitization",
        tagline="Testing media sanitization",
        physical_appearance="Normal build.",
        core_persona="Calm and collected.",
        initial_message="Hello.",
        baseline_psyche={
            "mood_label": "Calm",
            "valence": 0.0,
            "arousal": 0.3,
            "core_drive": "Testing",
            "core_fear": "Bugs",
            "default_want": "Pass tests",
            "default_plan": "Execute assertions",
        },
        portraits={
            "location": "Forest Camp",
            "initial_dialogue": "Good morning",
            "happy": "/api/media/characters/char_123/portraits/happy.webp",
        },
        gallery=[
            {"id": "initial_message", "url": "text_based", "caption": "", "created_at": "deployment"},
            {"id": "valid_img", "url": "/api/media/characters/char_123/gallery/img1.webp", "caption": "Real image", "created_at": "2026-10-31"},
        ],
    )

    char = temp_repo.create_character_from_draft(draft, owner_id=user.id)
    # The hallucinated keys must be stripped, only valid emotion & media URL remains
    assert "location" not in char.portraits
    assert "initial_dialogue" not in char.portraits
    assert "happy" in char.portraits
    assert len(char.portraits) == 1

    # Gallery item with url="text_based" must be stripped, only valid media URL remains
    assert len(char.gallery) == 1
    assert char.gallery[0].id == "valid_img"

