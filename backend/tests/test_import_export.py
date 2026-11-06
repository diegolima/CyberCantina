"""Tests for CyberCantina .zcc native archive export, format auto-detection, and transactional import."""

import io
import json
import zipfile
from pathlib import Path
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from app.config import settings
from app.db.repository import CantinaRepository
from app import main as main_module
from app.dependencies import process_and_save_image, safe_resolve_media_path
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.persona import PersonaCreatePayload, PersonaItemInstance, PersonaLoreEntry
from app.schemas.world import (
    LocationEdgeDraft,
    LocationLoreNodeDraft,
    LocationNodeDraft,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldWizardDraft,
)


def _create_test_image(width: int = 200, height: int = 200, color: str = "blue") -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client_and_repo(temp_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    media_dir = str(tmp_path / "media")
    settings.media_dir = media_dir
    temp_repo.media_dir = media_dir

    user = temp_repo.create_user(username="export_user", display_name="Export Tester")
    temp_repo.claim_unowned_entities(user.id)
    user_profile = temp_repo.get_user_by_id(user.id)

    monkeypatch.setattr(main_module, "get_repo", lambda: temp_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    client = TestClient(main_module.app)
    yield client, temp_repo, user_profile

    main_module.app.dependency_overrides.clear()


def test_bundle_export_and_import_roundtrip(client_and_repo, tmp_path):
    client, repo, user = client_and_repo

    # 1. Create a World
    world_draft = WorldWizardDraft(
        name="Neo-Kyoto 2099",
        global_rules=WorldGlobalRules(
            genre="cyberpunk",
            tone="gritty noir",
            setting_overview="A high-tech low-life metropolis ruled by mega-corporations.",
            narrative_style="second person",
            sensory_profile="neon rain, smell of ozone",
            taboos_and_limits="no supernatural magic",
        ),
        locations=[
            LocationNodeDraft(
                key="loc_slums",
                name="Lower Slums",
                summary="Downtrodden district",
                description="Dark alleyways illuminated by flickering neon signs.",
                environmental_tags=["rain", "neon", "crowded"],
                is_starting_location=True,
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="The Black Market",
                        category="faction",
                        content="Underground network of cyberware dealers.",
                        entity_tags=["market", "cyberware"],
                    )
                ],
            ),
            LocationNodeDraft(
                key="loc_spire",
                name="Arasaka Spire",
                summary="Towering corporate citadel",
                description="Gleaming glass monolith reaching above the smog.",
                environmental_tags=["clean", "corporate", "secure"],
                is_starting_location=False,
                lore_nodes=[],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="loc_slums",
                to_key="loc_spire",
                direction_label="monorail express",
                compass_direction="N",
                travel_minutes=15,
                is_locked_or_hidden=False,
            )
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="The Data Crash of '77",
                category="artifact",
                content="Cataclysmic AI virus that wiped financial institutions.",
                entity_tags=["crash", "virus", "history"],
            )
        ],
    )
    created_world = repo.create_world_from_draft(world_draft, owner_id=user.id)

    # Find world lore artifact id
    world_lore_id = created_world.lore_nodes[0].id

    # 2. Create a Character in this world with portraits and lore-linked item
    char_draft = CharacterWizardDraft(
        name="Kael Vex",
        tagline="Shadowrunner for hire",
        physical_appearance="Chrome arm, jagged facial scar.",
        core_persona="Pragmatic mercenary with a hidden heart of gold.",
        initial_message="You got the creds, or are you just wasting my time?",
        equipped=[
            ItemInstance(name="Neural Jack", note="Grade 4 interface"),
            ItemInstance(name="Ancient Data Shard", note="Found during the crash", lore_id=world_lore_id, flags=["artifact"]),
        ],
        inventory=[ItemInstance(name="Lockpick kit")],
        voice_anchors=[VoiceAnchor(context="Aggressive", snippet="Back off or lose a hand.")],
        baseline_psyche=BaselinePsyche(
            core_drive="Pay off street debt",
            core_fear="Cyberpsychosis",
            default_want="Find clean water",
            default_plan="Contact fixer",
        ),
        memory_shards=[
            MemoryShard(title="Childhood in Slums", content="Grew up scrounging scraps from corporate dumpsters.", keywords=["childhood", "slums"])
        ],
        tags=["mercenary", "cyborg"],
        creator="Tester",
        creator_notes="Play with an abrasive demeanor.",
    )

    created_char = repo.create_character_from_draft(char_draft, world_id=created_world.id, owner_id=user.id)

    # Save a physical portrait image for character
    portrait_bytes = _create_test_image(300, 300, "purple")
    portrait_file = "default_test.webp"
    p_path = safe_resolve_media_path(created_char.id, "portraits", portrait_file)
    process_and_save_image(portrait_bytes, p_path, square_crop=True)
    repo.update_character_portraits(
        created_char.id,
        portraits={"default": f"/api/media/characters/{created_char.id}/portraits/{portrait_file}"},
    )

    # 3. Create a Persona
    persona_payload = PersonaCreatePayload(
        name="Operator Zero",
        age="29",
        age_is_secret=False,
        physical_appearance="Long trenchcoat, dark goggles.",
        equipped=[PersonaItemInstance(name="Deckpad X1")],
        inventory=[PersonaItemInstance(name="Subdermal credchip")],
        lore_entries=[PersonaLoreEntry(title="Ex-Militech Analyst", content="Deserted after uncovering illicit projects.", trigger_keywords=["militech"])],
    )
    created_persona = repo.create_persona(persona_payload, owner_id=user.id)

    # 4. Call Export Endpoint
    export_payload = {
        "character_ids": [created_char.id],
        "world_ids": [created_world.id],
        "persona_ids": [created_persona.id],
        "bundle_name": "neokyoto_pack",
    }
    resp = client.post("/api/export/bundle", json=export_payload)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/octet-stream"
    assert "neokyoto_pack.zcc" in resp.headers["content-disposition"]

    zip_bytes = resp.content
    assert zip_bytes.startswith(b"PK\x03\x04")

    # 5. Verify ZIP contents
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()
        assert "manifest.json" in namelist
        assert "characters.json" in namelist
        assert "worlds.json" in namelist
        assert "personas.json" in namelist
        # Portrait media should be packed
        media_files = [n for n in namelist if n.startswith("media/")]
        assert len(media_files) == 1

        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["generator"] == "CyberCantina"
        assert manifest["contents"]["characters_count"] == 1
        assert manifest["contents"]["worlds_count"] == 1
        assert manifest["contents"]["personas_count"] == 1

    # 6. Test Import Inspect Endpoint
    files = {"file": ("neokyoto_pack.zcc", zip_bytes, "application/octet-stream")}
    inspect_resp = client.post("/api/import/inspect", files=files)
    assert inspect_resp.status_code == 200
    inspect_data = inspect_resp.json()
    assert inspect_data["is_native"] is True
    assert inspect_data["format_type"] == "zcc"
    staged_token = inspect_data["staged_token"]
    assert len(inspect_data["characters"]) == 1
    assert inspect_data["characters"][0]["name"] == "Kael Vex"
    assert len(inspect_data["worlds"]) == 1
    assert inspect_data["worlds"][0]["name"] == "Neo-Kyoto 2099"
    assert len(inspect_data["personas"]) == 1
    assert inspect_data["personas"][0]["name"] == "Operator Zero"

    # Conflicts detected because entities already exist with these names
    assert len(inspect_data["conflicts"]) == 3

    # 7. Test Commit Endpoint with 'copy' strategy (creates duplicates with (Imported))
    commit_payload = {
        "staged_token": staged_token,
        "default_conflict_strategy": "copy",
    }
    commit_resp = client.post("/api/import/commit", json=commit_payload)
    assert commit_resp.status_code == 200
    commit_data = commit_resp.json()
    assert commit_data["success"] is True
    assert len(commit_data["imported_characters"]) == 1
    assert "Kael Vex (Imported)" in commit_data["imported_characters"][0]

    # 8. Verify the new entities exist in the database with new IDs and remapped connections
    all_chars = repo.list_characters()
    imported_char = next(c for c in all_chars if "Kael Vex (Imported)" in c.name)
    assert imported_char.id != created_char.id
    assert imported_char.world_id != created_world.id
    assert imported_char.world_id is not None

    all_worlds = repo.list_worlds(owner_id=user.id)
    imported_world = next(w for w in all_worlds if "Neo-Kyoto 2099 (Imported)" in w.name)
    assert imported_char.world_id == imported_world.id

    # Verify vector embeddings were created for memory shards and lore
    conn = repo._connect()
    try:
        lore_rows = conn.execute(
            "SELECT * FROM vector_entries WHERE source_type = 'lore' AND world_id = ?",
            (imported_world.id,),
        ).fetchall()
        assert len(lore_rows) >= 1

        shard_rows = conn.execute(
            "SELECT * FROM vector_entries WHERE source_type = 'character_shard' AND character_id = ?",
            (imported_char.id,),
        ).fetchall()
        assert len(shard_rows) >= 1
    finally:
        conn.close()


def test_export_character_without_world_strips_dangling_references(client_and_repo):
    client, repo, user = client_and_repo

    # Create World
    world_draft = WorldWizardDraft(
        name="Dystopia Prime",
        global_rules=WorldGlobalRules(
            genre="cyberpunk",
            tone="bleak",
            setting_overview="A desolate post-war radioactive wasteland.",
            narrative_style="third person",
            sensory_profile="ash and rust",
            taboos_and_limits="none",
        ),
        locations=[
            LocationNodeDraft(
                key="loc_bunker",
                name="Bunker 12",
                summary="Shelter",
                description="Cold concrete walls.",
                environmental_tags=["dark"],
                is_starting_location=True,
                lore_nodes=[],
            )
        ],
        edges=[],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Bunker Treaty",
                category="artifact",
                content="Rules governing bunker resource distribution.",
                entity_tags=["treaty", "bunker"],
            )
        ],
    )
    world = repo.create_world_from_draft(world_draft, owner_id=user.id)

    # Create Character with item linking to world lore
    char_draft = CharacterWizardDraft(
        name="Wanderer Jack",
        tagline="Lone nomad",
        physical_appearance="Dusty duster coat.",
        core_persona="Silent observer.",
        initial_message="Water is life.",
        equipped=[
            ItemInstance(name="Bunker Treaty Badge", lore_id=world.lore_nodes[0].id, flags=["artifact"]),
        ],
        inventory=[ItemInstance(name="Canteen")],
        baseline_psyche=BaselinePsyche(
            core_drive="Reach the coast",
            core_fear="Thirst",
            default_want="Rest",
            default_plan="Camp here",
        ),
        memory_shards=[MemoryShard(title="Desert March", content="Walked through the salt flats.")],
        tags=["nomad"],
    )
    char = repo.create_character_from_draft(char_draft, world_id=world.id, owner_id=user.id)

    # Export Character ONLY via GET /api/export/character/{id}?include_world=false
    resp = client.get(f"/api/export/character/{char.id}?include_world=false")
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        chars_json = json.loads(zf.read("characters.json").decode("utf-8"))
        exported_char = chars_json[0]
        # World and item lore_id must be stripped
        assert exported_char["world_id"] is None
        assert exported_char["equipped"][0]["lore_id"] is None

    # Import the standalone character
    files = {"file": ("wanderer.zcc", resp.content, "application/octet-stream")}
    inspect_resp = client.post("/api/import/inspect", files=files)
    assert inspect_resp.status_code == 200
    token = inspect_resp.json()["staged_token"]

    commit_resp = client.post("/api/import/commit", json={"staged_token": token, "default_conflict_strategy": "copy"})
    assert commit_resp.status_code == 200
    assert commit_resp.json()["success"] is True


def test_single_world_export_endpoint(client_and_repo):
    client, repo, user = client_and_repo

    world_draft = WorldWizardDraft(
        name="Solaris Station",
        global_rules=WorldGlobalRules(
            genre="sci-fi",
            tone="atmospheric",
            setting_overview="An isolated orbital research habitat near Jupiter.",
            narrative_style="first person",
            sensory_profile="low hum of air scrubbers",
            taboos_and_limits="",
        ),
        locations=[
            LocationNodeDraft(
                key="loc_airlock",
                name="Main Airlock",
                summary="Entry to Solaris",
                description="Heavy magnetic seals.",
                environmental_tags=["vacuum"],
                is_starting_location=True,
                lore_nodes=[],
            )
        ],
        edges=[],
        lore_nodes=[],
    )
    world = repo.create_world_from_draft(world_draft, owner_id=user.id)

    resp = client.get(f"/api/export/world/{world.id}")
    assert resp.status_code == 200
    assert "world_Solaris_Station.zcc" in resp.headers["content-disposition"]


def test_security_zip_slip_prevention(client_and_repo):
    client, _, _ = client_and_repo

    # Create a malicious zip file with path traversal
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../etc/passwd", "root:x:0:0::/root:/bin/bash")
        zf.writestr("manifest.json", "{}")

    malicious_bytes = buf.getvalue()
    files = {"file": ("evil.zcc", malicious_bytes, "application/octet-stream")}
    resp = client.post("/api/import/inspect", files=files)
    assert resp.status_code == 400
    assert "traversal" in resp.json()["detail"].lower()


def test_import_inspect_sillytavern_card_detection(client_and_repo):
    import base64
    from PIL import PngImagePlugin

    client, _, _ = client_and_repo

    # 1. SillyTavern JSON
    st_json = json.dumps({
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name": "SillyTavern Bot",
            "description": "A cheeky test bot",
            "personality": "Playful",
            "creator_notes": "Author note here",
        }
    }).encode("utf-8")

    files = {"file": ("bot.json", st_json, "application/json")}
    resp = client.post("/api/import/inspect", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_native"] is False
    assert data["format_type"] == "sillytavern_json"
    assert data["characters"][0]["name"] == "SillyTavern Bot"

    # 2. SillyTavern PNG
    img = Image.new("RGB", (100, 100), color="green")
    pnginfo = PngImagePlugin.PngInfo()
    pnginfo.add_text("chara", base64.b64encode(st_json).decode("ascii"))
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=pnginfo)
    png_bytes = buf.getvalue()

    files_png = {"file": ("card.png", png_bytes, "image/png")}
    resp_png = client.post("/api/import/inspect", files=files_png)
    assert resp_png.status_code == 200
    data_png = resp_png.json()
    assert data_png["is_native"] is False
    assert data_png["format_type"] == "sillytavern_png"
    assert data_png["characters"][0]["name"] == "SillyTavern Bot"


def test_export_single_character_with_world_included(client_and_repo):
    client, repo, user = client_and_repo

    world_draft = WorldWizardDraft(
        name="Alpha Centauri Outpost",
        global_rules=WorldGlobalRules(
            genre="sci-fi",
            tone="hard sci-fi",
            setting_overview="Frontier mining colony under corporate governance.",
            narrative_style="second person",
            sensory_profile="methane dust and recycled air",
            taboos_and_limits="",
        ),
        locations=[],
        edges=[],
        lore_nodes=[],
    )
    world = repo.create_world_from_draft(world_draft, owner_id=user.id)

    char_draft = CharacterWizardDraft(
        name="Miner 49er",
        tagline="Colony prospector",
        physical_appearance="Exosuit frame.",
        core_persona="Hard-working miner.",
        initial_message="Found a new vein.",
        baseline_psyche=BaselinePsyche(
            core_drive="Strike gold",
            core_fear="Cave-in",
            default_want="Fuel cell",
            default_plan="Dig deeper",
        ),
    )
    char = repo.create_character_from_draft(char_draft, world_id=world.id, owner_id=user.id)

    # Export with include_world=true
    resp = client.get(f"/api/export/character/{char.id}?include_world=true")
    assert resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["contents"]["characters_count"] == 1
        assert manifest["contents"]["worlds_count"] == 1
        assert "worlds.json" in zf.namelist()
        chars = json.loads(zf.read("characters.json").decode("utf-8"))
        assert chars[0]["world_id"] == world.id
