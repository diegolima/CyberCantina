"""Tests for CyberCantina .zcc native archive export, format auto-detection, and transactional import."""

import io
import json
import zipfile
import pytest
from PIL import Image
from fastapi.testclient import TestClient

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
def client_and_repo(empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch):
    user = empty_repo.create_user(username="export_user", display_name="Export Tester")
    user_profile = empty_repo.get_user_by_id(user.id)

    monkeypatch.setattr(main_module, "get_repo", lambda: empty_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: user_profile

    client = TestClient(main_module.app)
    yield client, empty_repo, user_profile

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
        tagline="Ghost in the orbital relay.",
        age="29",
        age_is_secret=False,
        physical_appearance="Long trenchcoat, dark goggles.",
        equipped=[PersonaItemInstance(name="Deckpad X1")],
        inventory=[PersonaItemInstance(name="Subdermal credchip")],
        lore_entries=[PersonaLoreEntry(title="Ex-Militech Analyst", content="Deserted after uncovering illicit projects.", trigger_keywords=["militech"])],
    )
    created_persona = repo.create_persona(persona_payload, owner_id=user.id)
    p_portrait_res = client.post(
        f"/api/personas/{created_persona.id}/portrait",
        files={"file": ("op_zero.png", _create_test_image(300, 300, "teal"), "image/png")},
    )
    assert p_portrait_res.status_code == 200
    p_gal_res = client.post(
        f"/api/personas/{created_persona.id}/gallery",
        files={"file": ("op_gal.png", _create_test_image(320, 240, "navy"), "image/png")},
        data={"caption": "Safehouse Rig"},
    )
    assert p_gal_res.status_code == 200

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
        # Portrait + gallery media should be packed (1 char portrait + 1 persona portrait + 1 persona gallery)
        media_files = [n for n in namelist if n.startswith("media/")]
        assert len(media_files) == 3
        assert any(n.startswith(f"media/personas/{created_persona.id}/portraits/") for n in media_files)
        assert any(n.startswith(f"media/personas/{created_persona.id}/gallery/") for n in media_files)

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

    all_personas = repo.list_personas(owner_id=user.id)
    imported_persona = next(p for p in all_personas if "Operator Zero (Imported)" in p.name)
    assert imported_persona.id != created_persona.id
    assert imported_persona.tagline == "Ghost in the orbital relay."
    assert imported_persona.portrait_url is not None
    assert imported_persona.portrait_url.startswith(f"/api/media/personas/{imported_persona.id}/portraits/")
    assert len(imported_persona.gallery) == 1
    assert imported_persona.gallery[0].caption == "Safehouse Rig"
    assert imported_persona.gallery[0].url.startswith(f"/api/media/personas/{imported_persona.id}/gallery/")
    assert client.get(imported_persona.portrait_url).status_code == 200
    assert client.get(imported_persona.gallery[0].url).status_code == 200

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


def test_zcc_import_preserves_all_character_fields(client_and_repo):
    client, repo, user = client_and_repo

    char_draft = CharacterWizardDraft(
        name="Kira Vance",
        tagline="The scalpel is sharper than the truth.",
        character_bio="Former corporate trauma surgeon now operating an underground clinic in Sector 9.",
        species="Human",
        sex="Female",
        pronouns="she/her",
        age="34",
        build_and_height="170 cm",
        distinctive_features=[
            "Piercing icy-grey eyes",
            "Cauterized wrist-barcode",
            "Subdermal data-shard interface port",
        ],
        posture="Tense and efficient, standing with a slight forward lean.",
        mannerisms=["Taps a closed scalpel handle against her palm when thinking."],
        visual_aesthetic="Muted charcoal and rust utilitarian medical-tech wear.",
        personality_traits=["cynical", "hyper-observant"],
        core_persona="Treats every conversation like medical triage.",
        moral_code=["No freebies", "Never hand a patient over to security"],
        quirks_flaws=["Fixates on corporate logos"],
        communication_style=["clipped", "dryly sarcastic"],
        initial_message="State who sent you before my drink goes flat.",
        baseline_psyche=BaselinePsyche(
            core_drive="Broadcast the atmospheric ledger.",
            core_fear="Mind wipe by corporate cleaners.",
            default_want="Diagnose the newcomer's motive.",
            default_plan="- Scan for trackers\n- Demand upfront payment",
        ),
        memory_shards=[
            MemoryShard(
                title="The Order of Silence",
                content="Copied the encrypted ledger onto a subdermal shard.",
                keywords=["ledger", "shard"],
            )
        ],
        tags=["paranoid", "razor-sharp"],
        creator="Tester",
        creator_notes="Keep dialogue terse.",
    )
    created = repo.create_character_from_draft(char_draft, owner_id=user.id)

    # 1. Export & verify canonical export omits deprecated/unsupported keys
    export_resp = client.get(f"/api/export/character/{created.id}")
    assert export_resp.status_code == 200

    with zipfile.ZipFile(io.BytesIO(export_resp.content)) as zf:
        chars_payload = json.loads(zf.read("characters.json").decode("utf-8"))
        manifest_payload = json.loads(zf.read("manifest.json").decode("utf-8"))
    assert "physical_appearance" not in chars_payload[0]
    assert "modifications" not in chars_payload[0]
    assert "unsupported_fields" not in chars_payload[0]
    chars_payload[0]["name"] = "Kira Vance Archive"

    patched_buf = io.BytesIO()
    with zipfile.ZipFile(patched_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("characters.json", json.dumps(chars_payload))

    inspect_resp = client.post(
        "/api/import/inspect",
        files={"file": ("kira.zcc", patched_buf.getvalue(), "application/octet-stream")},
    )
    assert inspect_resp.status_code == 200
    assert inspect_resp.json()["warnings"] == []
    token = inspect_resp.json()["staged_token"]

    commit_resp = client.post(
        "/api/import/commit",
        json={"staged_token": token, "default_conflict_strategy": "copy"},
    )
    assert commit_resp.status_code == 200
    assert commit_resp.json()["success"] is True

    imported = next(c for c in repo.list_characters() if c.name == "Kira Vance Archive")
    assert imported.character_bio == char_draft.character_bio
    assert imported.physical_appearance == ""
    assert imported.modifications == []
    assert imported.unsupported_fields == {}
    assert imported.species == "Human"
    assert imported.sex == "Female"
    assert imported.pronouns == "she/her"
    assert imported.age == "34"
    assert imported.build_and_height == "170 cm"
    assert "Piercing icy-grey eyes" in imported.distinctive_features
    assert "Subdermal data-shard interface port" in imported.distinctive_features
    assert imported.posture == char_draft.posture
    assert imported.mannerisms == char_draft.mannerisms
    assert imported.visual_aesthetic == char_draft.visual_aesthetic
    assert imported.personality_traits == char_draft.personality_traits
    assert imported.moral_code == char_draft.moral_code
    assert imported.quirks_flaws == char_draft.quirks_flaws
    assert imported.communication_style == char_draft.communication_style


def test_zcc_future_and_legacy_unsupported_fields_roundtrip_and_bounds(client_and_repo):
    client, repo, user = client_and_repo
    from app.schemas.character import CharacterUpdatePayload

    base_draft = CharacterWizardDraft(
        name="Future Traveler",
        tagline="Imported from v0.99",
        character_bio="Canonical bio text.",
        core_persona="Calm observer.",
        initial_message="Greetings.",
        baseline_psyche=BaselinePsyche(
            core_drive="Observe",
            core_fear="Loss",
            default_want="Talk",
            default_plan="- Listen",
        ),
    )
    base_char = repo.create_character_from_draft(base_draft, owner_id=user.id)
    exp = client.get(f"/api/export/character/{base_char.id}")
    with zipfile.ZipFile(io.BytesIO(exp.content)) as zf:
        chars_payload = json.loads(zf.read("characters.json").decode("utf-8"))
        manifest_payload = json.loads(zf.read("manifest.json").decode("utf-8"))

    # Add unknown future keys + distinct legacy physical_appearance & modifications
    chars_payload[0]["name"] = "Future Traveler Imported"
    chars_payload[0]["voice_id"] = "elevenlabs_v99"
    chars_payload[0]["custom_metrics"] = {"luck": 9, "karma": -2}
    chars_payload[0]["physical_appearance"] = "Distinct legacy appearance prose."
    chars_payload[0]["modifications"] = ["Old optic zoom"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("characters.json", json.dumps(chars_payload))

    insp = client.post(
        "/api/import/inspect",
        files={"file": ("future.zcc", buf.getvalue(), "application/octet-stream")},
    )
    assert insp.status_code == 200
    insp_data = insp.json()
    assert len(insp_data["warnings"]) == 1
    assert "voice_id" in insp_data["warnings"][0]

    commit = client.post(
        "/api/import/commit",
        json={"staged_token": insp_data["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert commit.status_code == 200

    imported = next(c for c in repo.list_characters() if c.name == "Future Traveler Imported")
    assert imported.physical_appearance == ""
    assert imported.modifications == []
    assert imported.unsupported_fields == {
        "voice_id": "elevenlabs_v99",
        "custom_metrics": {"luck": 9, "karma": -2},
        "physical_appearance": "Distinct legacy appearance prose.",
        "modifications": ["Old optic zoom"],
    }

    # Saving unrelated fields preserves unsupported_fields
    updated = repo.update_character(
        imported.id,
        CharacterUpdatePayload(
            name=imported.name,
            tagline="Updated tagline",
            character_bio=imported.character_bio,
            core_persona=imported.core_persona,
            initial_message=imported.initial_message,
            baseline_psyche=imported.baseline_psyche,
            unsupported_fields=imported.unsupported_fields,
        ),
        owner_id=user.id,
    )
    assert updated.tagline == "Updated tagline"
    assert updated.unsupported_fields == imported.unsupported_fields

    # Re-export emits unsupported keys at top level without wrapper key
    re_exp = client.get(f"/api/export/character/{updated.id}")
    with zipfile.ZipFile(io.BytesIO(re_exp.content)) as zf:
        re_chars = json.loads(zf.read("characters.json").decode("utf-8"))
    assert "unsupported_fields" not in re_chars[0]
    assert re_chars[0]["voice_id"] == "elevenlabs_v99"
    assert re_chars[0]["custom_metrics"] == {"luck": 9, "karma": -2}
    assert re_chars[0]["physical_appearance"] == "Distinct legacy appearance prose."
    assert re_chars[0]["modifications"] == ["Old optic zoom"]

    # Deleting unsupported_fields omits them from DB and subsequent export
    cleaned = repo.update_character(
        updated.id,
        CharacterUpdatePayload(
            name=updated.name,
            tagline=updated.tagline,
            character_bio=updated.character_bio,
            core_persona=updated.core_persona,
            initial_message=updated.initial_message,
            baseline_psyche=updated.baseline_psyche,
            unsupported_fields={},
        ),
        owner_id=user.id,
    )
    assert cleaned.unsupported_fields == {}
    clean_exp = client.get(f"/api/export/character/{cleaned.id}")
    with zipfile.ZipFile(io.BytesIO(clean_exp.content)) as zf:
        clean_chars = json.loads(zf.read("characters.json").decode("utf-8"))
    assert "voice_id" not in clean_chars[0]
    assert "physical_appearance" not in clean_chars[0]
    assert "modifications" not in clean_chars[0]

    # Bounds rejection: > 64 unsupported keys returns HTTP 400
    too_many = dict(chars_payload[0])
    for i in range(70):
        too_many[f"extra_key_{i}"] = f"val_{i}"
    bad_buf = io.BytesIO()
    with zipfile.ZipFile(bad_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("characters.json", json.dumps([too_many]))
    bad_insp = client.post(
        "/api/import/inspect",
        files={"file": ("too_many.zcc", bad_buf.getvalue(), "application/octet-stream")},
    )
    bad_commit = client.post(
        "/api/import/commit",
        json={"staged_token": bad_insp.json()["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert bad_commit.status_code == 400


def test_zcc_world_and_persona_unsupported_fields_roundtrip_and_bounds(client_and_repo):
    """Worlds and Personas preserve legacy/unknown fields in unsupported_fields, round-trip in .zcc, and enforce bounds."""
    client, repo, user = client_and_repo
    from app.schemas.persona import PersonaCreatePayload, PersonaUpdatePayload
    from app.schemas.world import WorldGlobalRules, WorldUpdatePayload

    # Seed base persona and base world
    base_persona = repo.create_persona(
        PersonaCreatePayload(
            name="Archivist Mara",
            persona_bio="Curator of orbital archives.",
        ),
        owner_id=user.id,
    )
    base_world_draft = WorldWizardDraft(
        name="Orbital Ring",
        global_rules=WorldGlobalRules(
            genre="Sci-Fi",
            tone="Atmospheric",
            setting_overview="An ancient rotating habitat ring.",
            tech_or_magic_rules="Hard vacuum engineering.",
        ),
        locations=[
            LocationNodeDraft(
                key="loc_hub",
                name="Docking Concourse",
                summary="Primary hub",
                description="Pressurized arrival concourse.",
                environmental_tags=["orbital", "dock"],
                is_starting_location=True,
                is_hub=True,
            )
        ],
        edges=[],
        lore_nodes=[],
    )
    base_world = repo.create_world_from_draft(
        base_world_draft,
        owner_id=user.id,
    )

    # Export bundle containing world + persona
    exp_resp = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [],
            "world_ids": [base_world.id],
            "persona_ids": [base_persona.id],
            "description": "World & Persona bundle",
        },
    )
    assert exp_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp_resp.content)) as zf:
        manifest_payload = json.loads(zf.read("manifest.json").decode("utf-8"))
        worlds_payload = json.loads(zf.read("worlds.json").decode("utf-8"))
        personas_payload = json.loads(zf.read("personas.json").decode("utf-8"))

    # Inject legacy global_rules + unknown world/nested keys + alias conflict + alias consumption check
    worlds_payload[0]["name"] = "Orbital Ring Imported"
    worlds_payload[0]["calendar_system"] = "13-month solar ledger"
    worlds_payload[0]["global_rules"]["narrative_style"] = "Second-person tactile"
    worlds_payload[0]["global_rules"]["sensory_profile"] = "Ozone and cold copper"
    worlds_payload[0]["global_rules"]["taboos_and_limits"] = "No FTL teleportation"
    worlds_payload[0]["global_rules"]["mood"] = "Conflicting secondary tone"
    worlds_payload[0]["locations"][0]["future_weather"] = "Acid Drizzle"

    # Inject unknown persona keys + distinct legacy physical_appearance
    personas_payload[0]["name"] = "Archivist Mara Imported"
    personas_payload[0]["favorite_drink"] = "Synthetic chamomile"
    personas_payload[0]["physical_appearance"] = "Silver spectacles and grease-stained apron."

    archive_buf = io.BytesIO()
    with zipfile.ZipFile(archive_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("worlds.json", json.dumps(worlds_payload))
        zf.writestr("personas.json", json.dumps(personas_payload))

    insp = client.post(
        "/api/import/inspect",
        files={"file": ("world_persona_future.zcc", archive_buf.getvalue(), "application/octet-stream")},
    )
    assert insp.status_code == 200
    insp_data = insp.json()
    warnings_text = "\n".join(insp_data["warnings"])
    assert "calendar_system" in warnings_text
    assert "locations.future_weather" in warnings_text
    assert "cannot be preserved in this version" in warnings_text
    assert "favorite_drink" in warnings_text

    commit = client.post(
        "/api/import/commit",
        json={"staged_token": insp_data["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert commit.status_code == 200

    imp_world = next(w for w in repo.list_worlds(owner_id=user.id) if w.name == "Orbital Ring Imported")
    assert imp_world.unsupported_fields == {
        "calendar_system": "13-month solar ledger",
        "global_rules.narrative_style": "Second-person tactile",
        "global_rules.sensory_profile": "Ozone and cold copper",
        "global_rules.taboos_and_limits": "No FTL teleportation",
        "global_rules.mood": "Conflicting secondary tone",
    }

    # Check consumed alias is NOT duplicated into unsupported_fields when tone was empty
    clean_locations = [
        {k: v for k, v in loc.items() if k != "future_weather"}
        for loc in worlds_payload[0]["locations"]
    ]
    consumed_world_raw = {
        "name": "Alias Consumed World",
        "global_rules": {
            "genre": "Noir",
            "tone": "",
            "atmosphere": "Rain-slicked tension",
            "setting_overview": "Drowned metropolis.",
            "tech_or_magic_rules": "Clockwork",
        },
        "locations": clean_locations,
        "edges": worlds_payload[0]["edges"],
        "containers": worlds_payload[0]["containers"],
        "lore_nodes": [],
    }
    alias_buf = io.BytesIO()
    with zipfile.ZipFile(alias_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("worlds.json", json.dumps([consumed_world_raw]))
    alias_insp = client.post(
        "/api/import/inspect",
        files={"file": ("alias_consumed.zcc", alias_buf.getvalue(), "application/octet-stream")},
    )
    assert alias_insp.status_code == 200
    assert alias_insp.json()["warnings"] == []
    alias_commit = client.post(
        "/api/import/commit",
        json={"staged_token": alias_insp.json()["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert alias_commit.status_code == 200
    alias_world = next(w for w in repo.list_worlds(owner_id=user.id) if w.name == "Alias Consumed World")
    assert alias_world.global_rules.tone == "Rain-slicked tension"
    assert alias_world.unsupported_fields == {}

    imp_persona = next(p for p in repo.list_personas(owner_id=user.id) if p.name == "Archivist Mara Imported")
    assert imp_persona.physical_appearance == ""
    assert imp_persona.unsupported_fields == {
        "favorite_drink": "Synthetic chamomile",
        "physical_appearance": "Silver spectacles and grease-stained apron.",
    }

    # Updating unrelated world fields without unsupported_fields preserves existing unsupported_fields
    partial_world = repo.update_world(
        imp_world.id,
        WorldUpdatePayload(
            name="Orbital Ring Edited",
            global_rules=WorldGlobalRules(**imp_world.global_rules.model_dump()),
            containers=imp_world.containers,
            locations=imp_world.locations,
            edges=imp_world.edges,
            lore_nodes=imp_world.lore_nodes,
        ),
        owner_id=user.id,
    )
    assert partial_world.unsupported_fields == imp_world.unsupported_fields

    # Re-export restores top-level & global_rules.* keys without wrapper key
    re_exp = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [],
            "world_ids": [partial_world.id],
            "persona_ids": [imp_persona.id],
            "description": "Round-trip check",
        },
    )
    assert re_exp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(re_exp.content)) as zf:
        re_worlds = json.loads(zf.read("worlds.json").decode("utf-8"))
        re_personas = json.loads(zf.read("personas.json").decode("utf-8"))
    assert "unsupported_fields" not in re_worlds[0]
    assert re_worlds[0]["calendar_system"] == "13-month solar ledger"
    assert re_worlds[0]["global_rules"]["narrative_style"] == "Second-person tactile"
    assert re_worlds[0]["global_rules"]["mood"] == "Conflicting secondary tone"
    assert "unsupported_fields" not in re_personas[0]
    assert re_personas[0]["favorite_drink"] == "Synthetic chamomile"
    assert re_personas[0]["physical_appearance"] == "Silver spectacles and grease-stained apron."

    # Deleting via update omits keys on subsequent export
    cleaned_persona = repo.update_persona(
        imp_persona.id,
        PersonaUpdatePayload(unsupported_fields={}),
        owner_id=user.id,
    )
    assert cleaned_persona.unsupported_fields == {}

    # Bounds rejection: deep nesting (> depth 8) on persona triggers HTTP 400
    deep_obj: object = "leaf"
    for _ in range(11):
        deep_obj = {"nested": deep_obj}
    bad_p = dict(personas_payload[0])
    bad_p["deep_ext"] = deep_obj
    bad_p_buf = io.BytesIO()
    with zipfile.ZipFile(bad_p_buf, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest_payload))
        zf.writestr("personas.json", json.dumps([bad_p]))
    bad_p_insp = client.post(
        "/api/import/inspect",
        files={"file": ("deep_persona.zcc", bad_p_buf.getvalue(), "application/octet-stream")},
    )
    bad_p_commit = client.post(
        "/api/import/commit",
        json={"staged_token": bad_p_insp.json()["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert bad_p_commit.status_code == 400


def test_zcc_import_edit_save_and_reexport_preserves_media(client_and_repo):
    """Importing a .zcc with world + character (2 media files), editing/saving the character, and re-exporting preserves all media."""
    client, repo, user = client_and_repo

    # 1. Create world + character with 2 media files (1 portrait + 1 gallery)
    world_draft = WorldWizardDraft(
        name="Media Harbor",
        global_rules=WorldGlobalRules(
            genre="noir",
            tone="moody",
            setting_overview="Rain-slicked docks.",
            narrative_style="second person",
            sensory_profile="salt and diesel",
            taboos_and_limits="",
        ),
        locations=[
            LocationNodeDraft(
                key="loc_pier",
                name="Pier 9",
                summary="Foggy pier",
                description="Crates and lanterns.",
                environmental_tags=["fog"],
                is_starting_location=True,
                lore_nodes=[],
            )
        ],
        edges=[],
        lore_nodes=[],
    )
    world = repo.create_world_from_draft(world_draft, owner_id=user.id)
    char = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Mara Voss",
            tagline="Harbor investigator",
            core_persona="Patient and observant.",
            baseline_psyche=BaselinePsyche(
                core_drive="Uncover the smuggling ring",
                core_fear="Drowning",
                default_want="Check the manifest",
                default_plan="Question the dockmaster",
            ),
        ),
        world_id=world.id,
        owner_id=user.id,
    )

    p_path = safe_resolve_media_path(char.id, "portraits", "default_orig.webp")
    process_and_save_image(_create_test_image(256, 256, "red"), p_path, square_crop=True)
    repo.update_character_portraits(
        char.id,
        {"default": f"/api/media/characters/{char.id}/portraits/default_orig.webp"},
        owner_id=user.id,
    )

    g_path = safe_resolve_media_path(char.id, "gallery", "img_orig.webp")
    process_and_save_image(_create_test_image(320, 240, "green"), g_path, square_crop=False)
    from app.schemas.character import GalleryImage

    repo.update_character_gallery(
        char.id,
        [
            GalleryImage(
                id="img_orig",
                url=f"/api/media/characters/{char.id}/gallery/img_orig.webp",
                caption="On the pier",
                created_at="2026-11-16T12:00:00Z",
            )
        ],
        owner_id=user.id,
    )

    # Export original .zcc
    exp1 = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [char.id],
            "world_ids": [world.id],
            "persona_ids": [],
            "bundle_name": "mara_bundle",
        },
    )
    assert exp1.status_code == 200

    # 2. Import the .zcc file
    insp = client.post(
        "/api/import/inspect",
        files={"file": ("mara_bundle.zcc", exp1.content, "application/octet-stream")},
    )
    assert insp.status_code == 200
    commit = client.post(
        "/api/import/commit",
        json={"staged_token": insp.json()["staged_token"], "default_conflict_strategy": "copy"},
    )
    assert commit.status_code == 200
    assert commit.json()["success"] is True

    imported_char = next(c for c in repo.list_characters() if c.name == "Mara Voss (Imported)")
    imported_world = next(w for w in repo.list_worlds(owner_id=user.id) if w.name == "Media Harbor (Imported)")
    assert "default" in imported_char.portraits
    assert len(imported_char.gallery) == 1

    # 3. Edit and save character via PUT without modifying media
    update_payload = imported_char.model_dump(
        exclude={"id", "pending_deletion", "version", "created_at"}
    )
    update_payload["tagline"] = "Senior harbor investigator"
    update_payload["world_id"] = imported_world.id
    put_resp = client.put(f"/api/characters/{imported_char.id}", json=update_payload)
    assert put_resp.status_code == 200
    saved_char = put_resp.json()
    assert saved_char["portraits"] == imported_char.portraits
    assert len(saved_char["gallery"]) == 1

    # 4. Re-export both character and world and confirm both media files are packed
    exp2 = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [saved_char["id"]],
            "world_ids": [imported_world.id],
            "persona_ids": [],
            "bundle_name": "mara_reexport",
        },
    )
    assert exp2.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp2.content)) as zf:
        media_entries = [n for n in zf.namelist() if n.startswith("media/")]
        assert len(media_entries) == 2
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert manifest["contents"]["media_files_count"] == 2
        re_chars = json.loads(zf.read("characters.json").decode("utf-8"))
        assert re_chars[0]["portraits"]["default"] in media_entries
        assert re_chars[0]["gallery"][0]["url"] in media_entries


def test_cow_fork_and_restore_rewrite_media_urls_and_recover_legacy_export(client_and_repo):
    """CoW-forking or restoring a character rewrites media URLs to the new ID so pruning the old character never breaks media or exports."""
    client, repo, user = client_and_repo

    world = repo.create_world_from_draft(
        WorldWizardDraft(
            name="Neon Quay",
            global_rules=WorldGlobalRules(
                genre="cyberpunk",
                tone="gritty",
                setting_overview="Flooded piers.",
                narrative_style="second person",
                sensory_profile="ozone",
                taboos_and_limits="",
            ),
            locations=[
                LocationNodeDraft(
                    key="loc_dock",
                    name="Dock A",
                    summary="Wet concrete",
                    description="Flickering sodium lamps.",
                    environmental_tags=["wet"],
                    is_starting_location=True,
                    lore_nodes=[],
                )
            ],
            edges=[],
            lore_nodes=[],
        ),
        owner_id=user.id,
    )
    char_v1 = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Vesper Lin",
            tagline="Courier",
            core_persona="Keeps moving.",
            baseline_psyche=BaselinePsyche(
                core_drive="Deliver the package",
                core_fear="Lockdown",
                default_want="Reach Dock A",
                default_plan="Stay out of sight",
            ),
        ),
        world_id=world.id,
        owner_id=user.id,
    )
    p_path = safe_resolve_media_path(char_v1.id, "portraits", "default_v1.webp")
    process_and_save_image(_create_test_image(200, 200, "purple"), p_path, square_crop=True)
    repo.update_character_portraits(
        char_v1.id,
        {"default": f"/api/media/characters/{char_v1.id}/portraits/default_v1.webp"},
        owner_id=user.id,
    )
    g_path = safe_resolve_media_path(char_v1.id, "gallery", "img_v1.webp")
    process_and_save_image(_create_test_image(300, 200, "teal"), g_path, square_crop=False)
    from app.schemas.character import GalleryImage

    repo.update_character_gallery(
        char_v1.id,
        [
            GalleryImage(
                id="img_v1",
                url=f"/api/media/characters/{char_v1.id}/gallery/img_v1.webp",
                caption="Alleyway",
                created_at="2026-11-16T12:00:00Z",
            )
        ],
        owner_id=user.id,
    )
    char_v1 = repo.get_character(char_v1.id, owner_id=user.id)

    # Start a campaign referencing char_v1 so editing triggers Copy-on-Write fork
    camp = repo.create_campaign(
        name="Quay Run",
        world_id=world.id,
        character_id=char_v1.id,
        owner_id=user.id,
    )

    update_payload = char_v1.model_dump(
        exclude={"id", "pending_deletion", "version", "created_at"}
    )
    update_payload["tagline"] = "Veteran courier"
    put_resp = client.put(f"/api/characters/{char_v1.id}", json=update_payload)
    assert put_resp.status_code == 200
    forked_v2 = put_resp.json()
    assert forked_v2["id"] != char_v1.id
    assert forked_v2["portraits"]["default"] == f"/api/media/characters/{forked_v2['id']}/portraits/default_v1.webp"
    assert forked_v2["gallery"][0]["url"] == f"/api/media/characters/{forked_v2['id']}/gallery/img_v1.webp"

    # Delete campaign and prune char_v1 -> deletes char_v1's media folder
    repo.delete_campaign(camp.id, owner_id=user.id)
    pruned = repo.prune_pending_deletion_characters()
    assert char_v1.id in pruned

    # Export forked_v2 + world: both media files must still be served and exported
    media_get = client.get(forked_v2["portraits"]["default"])
    assert media_get.status_code == 200

    exp_resp = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [forked_v2["id"]],
            "world_ids": [world.id],
            "persona_ids": [],
            "bundle_name": "vesper_after_prune",
        },
    )
    assert exp_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp_resp.content)) as zf:
        media_entries = [n for n in zf.namelist() if n.startswith("media/")]
        assert len(media_entries) == 2

    # Also verify CoW restore_character_version rewrites URLs to the new forked ID
    camp2 = repo.create_campaign(
        name="Quay Run 2",
        world_id=world.id,
        character_id=forked_v2["id"],
        owner_id=user.id,
    )
    restored = repo.restore_character_version(forked_v2["id"], 1, owner_id=user.id)
    assert restored.id != forked_v2["id"]
    assert restored.portraits["default"] == f"/api/media/characters/{restored.id}/portraits/default_v1.webp"
    assert restored.gallery[0].url == f"/api/media/characters/{restored.id}/gallery/img_v1.webp"
    repo.delete_campaign(camp2.id, owner_id=user.id)
    repo.prune_pending_deletion_characters()

    # Legacy recovery: simulate a character forked before the fix whose DB URLs still cite a pruned ID
    # while its copied files exist under restored.id
    conn = repo._connect()
    try:
        conn.execute(
            "UPDATE characters SET portraits_json = ?, gallery_json = ? WHERE id = ?",
            (
                json.dumps({"default": "/api/media/characters/char_pruned_legacy/portraits/default_v1.webp"}),
                json.dumps([
                    {
                        "id": "img_v1",
                        "url": "/api/media/characters/char_pruned_legacy/gallery/img_v1.webp",
                        "caption": "Alleyway",
                        "created_at": "2026-11-16T12:00:00Z",
                    }
                ]),
                restored.id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    legacy_exp = client.post(
        "/api/export/bundle",
        json={
            "character_ids": [restored.id],
            "world_ids": [world.id],
            "persona_ids": [],
            "bundle_name": "vesper_legacy_recovery",
        },
    )
    assert legacy_exp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(legacy_exp.content)) as zf:
        media_entries = [n for n in zf.namelist() if n.startswith("media/")]
        assert len(media_entries) == 2


def test_zcc_import_normalizes_codex_and_legacy_lore_categories(client_and_repo):
    client, repo, user = client_and_repo

    manifest = {
        "format_version": "1.0",
        "generator": "CyberCantina",
        "exporter_version": "0.20.0",
        "exported_at": "2026-11-18T12:00:00Z",
        "bundle_name": "codex_alias_bundle",
        "contents": {"characters_count": 0, "worlds_count": 1, "personas_count": 0},
    }
    world_payload = {
        "id": "w_codex",
        "name": "Codex Realm",
        "global_rules": {
            "genre": "Dark Fantasy",
            "tone": "Bleak",
            "setting_overview": "A ruined citadel.",
            "tech_or_magic_rules": "Blood alchemy.",
            "starting_timestamp": "1204-04-10 08:00",
        },
        "containers": [
            {
                "id": "c_citadel",
                "world_id": "w_codex",
                "depth": 1,
                "name": "Obsidian Keep",
                "description": "Cracked keep.",
                "environmental_tags": ["stone"],
                "lore_nodes": [
                    {
                        "id": "cl_1",
                        "title": "Keep Guard",
                        "category": "person",
                        "content": "Watches the gate.",
                        "entity_tags": ["guard"],
                    }
                ],
            }
        ],
        "locations": [
            {
                "id": "loc_gate",
                "world_id": "w_codex",
                "container_id": "c_citadel",
                "name": "Iron Gate",
                "summary": "Entry gate.",
                "description": "Rusted portcullis.",
                "environmental_tags": ["iron"],
                "is_starting_location": True,
                "lore_nodes": [
                    {
                        "id": "ll_1",
                        "title": "Gate Miasma",
                        "category": "hazard",
                        "content": "Toxic mist seeps from below.",
                        "entity_tags": ["miasma"],
                    }
                ],
            }
        ],
        "edges": [],
        "lore_nodes": [
            {
                "id": "wl_fig",
                "title": "Lord Ash",
                "category": "figure",
                "content": "Exiled regent.",
                "entity_tags": ["ash"],
            },
            {
                "id": "wl_thr",
                "title": "Ashen Rot",
                "category": "threat",
                "content": "Creeping blight.",
                "entity_tags": ["rot"],
            },
            {
                "id": "wl_alias",
                "title": "Wandering Scribe",
                "category": "people",
                "content": "Chronicler of ruins.",
                "entity_tags": ["scribe"],
            },
        ],
    }

    zcc_buf = io.BytesIO()
    with zipfile.ZipFile(zcc_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        zf.writestr("characters.json", "[]")
        zf.writestr("personas.json", "[]")
        zf.writestr("worlds.json", json.dumps([world_payload]))

    insp = client.post(
        "/api/import/inspect",
        files={"file": ("codex.zcc", zcc_buf.getvalue(), "application/octet-stream")},
    )
    assert insp.status_code == 200
    token = insp.json()["staged_token"]

    commit = client.post(
        "/api/import/commit",
        json={
            "staged_token": token,
            "default_conflict_strategy": "copy",
        },
    )
    assert commit.status_code == 200
    assert commit.json()["success"] is True
    worlds = repo.list_worlds(owner_id=user.id)
    imported = next(w for w in worlds if w.name == "Codex Realm")
    world_cats = {ln.title: ln.category for ln in imported.lore_nodes}
    assert world_cats["Lord Ash"] == "figure"
    assert world_cats["Ashen Rot"] == "threat"
    assert world_cats["Wandering Scribe"] == "figure"
    assert imported.containers[0].lore_nodes[0].category == "culture"
    assert imported.locations[0].lore_nodes[0].category == "rumor"



