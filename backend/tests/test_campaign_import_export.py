"""End-to-end tests for v0.30.0 running campaign .zcc v2 export/import and password protection."""

from __future__ import annotations

import json
import zipfile
import io

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.db.repository import CantinaRepository
from app.db.vector_math import current_embedding_fingerprint
from app.routers import import_export as import_export_router
from app.schemas.affective import (
    AffectiveCareState,
    RelationalEdge,
    RelationalEventSpec,
    SituationalAppraisal,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterStateSnapshot,
    CharacterWizardDraft,
    CognitionBlock,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.party import (
    PartyActionSpec,
    PartyEventDelta,
    PartyInviteOutcome,
)
from app.schemas.persona import PersonaCreatePayload
from app.schemas.turn import (
    ArbitrationRulingRecord,
    CharacterAgentDelta,
    CharacterCheckSpec,
    CharacterChoiceOption,
    CharacterChoiceSet,
    ChoiceResolution,
    DiceRollResult,
    ExtractedCharacterMemory,
    PostTurnStateDelta,
    PreTurnAnalysis,
    WorldStateSnapshot,
)
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldWizardDraft,
)
from app.security.rate_limit import reset_rate_limiters
from app.security.zcc_crypto import is_encrypted_zcc_bytes


def _build_rich_campaign(repo: CantinaRepository, owner_id: str) -> dict[str, str]:
    """Create a world, 2 characters, persona, and multi-branch campaign with swipes, bookmarks, summaries & vectors."""
    world = repo.create_world_from_draft(
        WorldWizardDraft(
            name="Neon Docklands",
            global_rules=WorldGlobalRules(
                genre="Cyberpunk",
                tone="Noir",
                setting_overview="Rain-soaked industrial port ruled by smugglers.",
                starting_time="2099-05-01T21:00:00",
            ),
            locations=[
                LocationNodeDraft(
                    key="harbor_gate",
                    name="Harbor Gate",
                    summary="Rain-slicked gate",
                    description="Steel arches over wet concrete.",
                    is_starting_location=True,
                ),
                LocationNodeDraft(
                    key="warehouse_9",
                    name="Warehouse 9",
                    summary="Smuggler depot",
                    description="Crates stacked to the ceiling.",
                ),
            ],
            edges=[
                LocationEdgeDraft(
                    from_key="harbor_gate",
                    to_key="warehouse_9",
                    direction_label="north",
                    distance_meters=350,
                )
            ],
            lore_nodes=[
                WorldLoreNodeDraft(
                    title="Dock Syndicate",
                    category="faction",
                    content="Controls night cranes.",
                    entity_tags=["syndicate", "dock"],
                )
            ],
        ),
        owner_id=owner_id,
    )
    char1 = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Vex Mercer",
            tagline="Harbor fixer",
            character_bio="Knows every manifest in the port.",
            core_persona="Pragmatic and guarded.",
            initial_message="You're late. The boat leaves in ten.",
            baseline_psyche=BaselinePsyche(
                mood_label="Wary",
                valence=-0.1,
                arousal=0.5,
                default_want="Unload cargo",
                default_plan="Check manifest",
                core_drive="Stay independent",
                core_fear="Syndicate debt",
            ),
            voice_anchors=[VoiceAnchor(context="pressure", snippet="Keep your voice down.")],
            memory_shards=[MemoryShard(title="Lost Cargo", content="Lost a crate in sector 4.", keywords=["cargo"])],
        ),
        world_id=world.id,
        owner_id=owner_id,
    )
    char2 = repo.create_character_from_draft(
        CharacterWizardDraft(
            name="Mina Sato",
            tagline="Drone rigger",
            character_bio="Eyes in the sky.",
            core_persona="Quick-witted.",
            initial_message="Cameras are looped.",
            baseline_psyche=BaselinePsyche(
                mood_label="Focused",
                valence=0.2,
                arousal=0.4,
                default_want="Watch perimeter",
                default_plan="Scan roof",
                core_drive="Protect crew",
                core_fear="Signal jam",
            ),
        ),
        world_id=world.id,
        owner_id=owner_id,
    )
    persona = repo.create_persona(
        PersonaCreatePayload(name="Courier Kai", tagline="Smuggler runner", persona_bio="Fast on a bike."),
        owner_id=owner_id,
    )

    camp = repo.create_campaign(
        name="Midnight Drop",
        world_id=world.id,
        character_id=char1.id,
        persona_id=persona.id,
        owner_id=owner_id,
    )
    root_turn_id = camp.active_leaf_turn_id
    assert root_turn_id is not None
    loc0 = world.locations[0].id
    loc1 = world.locations[1].id

    # Turn 1A (active branch) + Turn 1B (sibling swipe on same prompt)
    pre = PreTurnAnalysis(
        narrative_mode="standard",
        mentioned_entities=["Vex Mercer"],
    )
    cog = CognitionBlock(
        private_thoughts="Trust is earned.",
        emotional_appraisal="Slightly warmer",
        new_mood_label="Guarded",
        new_valence=0.1,
        new_arousal=0.45,
        new_want="Move to Warehouse 9",
        new_plan="Lead courier inside",
        action_intent="Gesture toward the dock.",
    )
    t1a = repo.save_turn_node(
        turn_id="turn_1a",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        user_message="Show me the manifest.",
        actor_id=char1.id,
        raw_prose="Vex slides a damp datapad across the crate.",
        cognition=cog,
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_1a",
            world_timestamp="2099-05-01T21:05:00",
            active_location_id=loc1,
            scene_flags=["manifest_shown"],
            campaign_elapsed_minutes=5,
            visited_location_ids=[loc0, loc1],
        ),
        character_state=CharacterStateSnapshot(
            turn_id="turn_1a",
            character_id=char1.id,
            current_location_id=loc1,
            mood_label="Guarded",
            valence=0.1,
            arousal=0.45,
            active_want="Move to Warehouse 9",
            active_plan="Lead courier inside",
            relationship_notes={"user": "Careful partner"},
            affective_state={"mood": {"valence": 0.1, "arousal": 0.45}, "relationships": {"user": {"trust": 0.6}}},
        ),
        recalled_items=[],
    )
    t1b = repo.save_turn_node(
        turn_id="turn_1b",
        campaign_id=camp.id,
        parent_turn_id=root_turn_id,
        depth_index=1,
        user_message="Show me the manifest.",
        actor_id=char1.id,
        raw_prose="Vex refuses and pockets the datapad.",
        cognition=cog,
        pre_turn=pre,
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_1b",
            world_timestamp="2099-05-01T21:05:00",
            active_location_id=loc0,
            scene_flags=["manifest_denied"],
            campaign_elapsed_minutes=5,
            visited_location_ids=[loc0],
        ),
        character_state=CharacterStateSnapshot(
            turn_id="turn_1b",
            character_id=char1.id,
            current_location_id=loc0,
            mood_label="Suspicious",
            valence=-0.4,
            arousal=0.7,
            active_want="Leave",
            active_plan="Walk away",
        ),
        recalled_items=[],
    )

    # Bookmark t1a with a personal user_note and bookmark t1b (alternate swipe)
    repo.update_turn_bookmark(camp.id, t1a.id, is_bookmarked=True, user_note="Great noir reveal")
    repo.update_turn_bookmark(camp.id, t1b.id, is_bookmarked=True, user_note="Alternate hostile swipe")

    # Add char2 ONLY on alternate branch t1b (joined_at_turn_id = t1b.id)
    conn = repo._connect()
    try:
        conn.execute(
            "INSERT INTO campaign_characters (campaign_id, character_id, joined_at_turn_id, created_at) VALUES (?, ?, ?, ?)",
            (camp.id, char2.id, t1b.id, "2099-05-01T21:06:00Z"),
        )
        # Add episodic summary on active branch t1a and another on sibling t1b
        conn.execute(
            """
            INSERT INTO episodic_chunks (
                id, campaign_id, start_turn_depth, end_turn_depth, leaf_turn_id,
                title, synopsis_text, summary_text, keywords_json, witness_character_ids_json, salience_score, created_at
            ) VALUES (?, ?, 0, 1, ?, 'Manifest Exchange', 'Datapad handed over.', 'Vex shared the manifest.', '["manifest"]', ?, 7, '2099-05-01T21:06:00Z')
            """,
            ("ep_active", camp.id, t1a.id, json.dumps([char1.id])),
        )
        conn.execute(
            """
            INSERT INTO episodic_chunks (
                id, campaign_id, start_turn_depth, end_turn_depth, leaf_turn_id,
                title, synopsis_text, summary_text, keywords_json, witness_character_ids_json, salience_score, created_at
            ) VALUES (?, ?, 0, 1, ?, 'Refusal', 'Datapad hidden.', 'Vex refused.', '["refusal"]', ?, 6, '2099-05-01T21:06:00Z')
            """,
            ("ep_alt", camp.id, t1b.id, json.dumps([char1.id, char2.id])),
        )
        # Add campaign_character_memories for char1
        conn.execute(
            "INSERT INTO campaign_character_memories (campaign_id, character_id, memory_shards_json, updated_at) VALUES (?, ?, ?, ?)",
            (camp.id, char1.id, json.dumps([{"title": "Dock Deal", "content": "Agreed on split.", "keywords": ["deal"]}]), "2099-05-01T21:06:00Z"),
        )
        # Add branch-bound vector entries on t1a and t1b
        repo.vector_store.upsert_entry(
            entry_id="vec_active_1",
            source_type="episodic_chunk",
            world_id=world.id,
            campaign_id=camp.id,
            anchor_turn_id=t1a.id,
            title="Active Memory",
            content="Vex shared the manifest at Warehouse 9.",
            keywords=["manifest"],
            conn=conn,
        )
        repo.vector_store.upsert_entry(
            entry_id="vec_alt_1",
            source_type="episodic_chunk",
            world_id=world.id,
            campaign_id=camp.id,
            anchor_turn_id=t1b.id,
            title="Alt Memory",
            content="Vex refused on the alternate swipe.",
            keywords=["refusal"],
            conn=conn,
        )
        # Set active leaf to t1a
        conn.execute("UPDATE campaigns SET active_leaf_turn_id = ? WHERE id = ?", (t1a.id, camp.id))
        conn.commit()
    finally:
        conn.close()

    return {
        "campaign_id": camp.id,
        "world_id": world.id,
        "char1_id": char1.id,
        "char2_id": char2.id,
        "persona_id": persona.id,
        "root_turn_id": root_turn_id,
        "t1a_id": t1a.id,
        "t1b_id": t1b.id,
    }


def _make_client(empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch, user_id: str) -> TestClient:
    profile = empty_repo.get_user_by_id(user_id)
    monkeypatch.setattr(main_module, "get_repo", lambda: empty_repo)
    monkeypatch.setattr(import_export_router, "get_repo", lambda: empty_repo)
    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: profile
    return TestClient(main_module.app)


def test_campaign_full_export_and_campaign_private_import_roundtrip(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    reset_rate_limiters()
    u1 = empty_repo.create_user(username="author_u1", display_name="Author")
    u2 = empty_repo.create_user(username="player_u2", display_name="Player")
    ids = _build_rich_campaign(empty_repo, u1.id)

    try:
        # 1. Export FULL campaign as u1
        client_u1 = _make_client(empty_repo, monkeypatch, u1.id)
        exp_res = client_u1.post(
            f"/api/export/campaign/{ids['campaign_id']}",
            json={"timeline_scope": "full", "strip_bookmark_comments": False},
        )
        assert exp_res.status_code == 200
        zcc_bytes = exp_res.content

        with zipfile.ZipFile(io.BytesIO(zcc_bytes), "r") as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["format_version"] == 2
            assert manifest["contents"]["campaigns_count"] == 1
            camps_raw = json.loads(zf.read("campaigns.json"))
            assert len(camps_raw) == 1
            assert len(camps_raw[0]["turns"]) == 3  # root + t1a + t1b

        # 2. Inspect & commit as u2 with standalone=False (default)
        client_u2 = _make_client(empty_repo, monkeypatch, u2.id)
        ins_res = client_u2.post(
            "/api/import/inspect",
            files={"file": ("midnight_drop.zcc", zcc_bytes, "application/octet-stream")},
        )
        assert ins_res.status_code == 200
        ins_data = ins_res.json()
        assert ins_data["requires_password"] is False
        assert len(ins_data["campaigns"]) == 1
        assert ins_data["campaigns"][0]["name"] == "Midnight Drop"
        assert ins_data["campaigns"][0]["extra_info"]["turns_count"] == 3

        commit_res = client_u2.post(
            "/api/import/commit",
            json={
                "staged_token": ins_data["staged_token"],
                "import_campaign_assets_as_standalone": False,
            },
        )
        assert commit_res.status_code == 200
        cdata = commit_res.json()
        assert cdata["success"] is True
        assert cdata["imported_campaigns"] == ["Midnight Drop"]
        assert cdata["imported_worlds"] == []
        assert cdata["imported_characters"] == []
        assert cdata["imported_personas"] == []

        # Standalone libraries for u2 remain completely clean!
        assert empty_repo.list_worlds(include_pending_deletion=False, owner_id=u2.id) == []
        assert empty_repo.list_characters(include_pending_deletion=False, owner_id=u2.id) == []
        assert "Courier Kai" not in [p.name for p in empty_repo.list_personas(owner_id=u2.id)]

        # Imported campaign exists with real world_name & character_name metadata
        u2_camps = empty_repo.list_campaigns(owner_id=u2.id)
        assert len(u2_camps) == 1
        imp_camp = u2_camps[0]
        assert imp_camp.id != ids["campaign_id"]
        assert imp_camp.world_id != ids["world_id"]
        assert imp_camp.character_id != ids["char1_id"]
        assert imp_camp.world_name == "Neon Docklands"
        assert imp_camp.character_name == "Vex Mercer"
        assert imp_camp.persona_id is None
        assert imp_camp.persona_snapshot is not None
        assert imp_camp.persona_snapshot.name == "Courier Kai"

        # Full turn tree, bookmarks, CARE, summaries, memories & vectors preserved
        bundle = empty_repo.get_campaign_state_bundle(imp_camp.id, owner_id=u2.id)
        assert len(bundle.all_turn_nodes) == 3
        assert len(bundle.active_branch_turns) == 2  # root + t1a
        active_leaf = bundle.active_branch_turns[-1]
        assert active_leaf.is_bookmarked is True
        assert active_leaf.user_note == "Great noir reveal"
        assert len(bundle.all_episodic_chunks) == 2
        assert len(bundle.episodic_chunks) == 1
        assert bundle.character_states[imp_camp.character_id].mood_label == "Guarded"
        assert empty_repo.get_raw_campaign_character_memories(imp_camp.id, imp_camp.character_id)

        # Re-exporting a campaign backed by pending_deletion=1 entities succeeds
        reexp_res = client_u2.post(
            f"/api/export/campaign/{imp_camp.id}",
            json={"timeline_scope": "active", "strip_bookmark_comments": True},
        )
        assert reexp_res.status_code == 200

        # Deleting the imported campaign allows pruning its pending_deletion=1 world & characters
        empty_repo.delete_campaign(imp_camp.id, owner_id=u2.id)
        pruned_chars = empty_repo.prune_pending_deletion_characters()
        pruned_worlds = empty_repo.prune_pending_deletion_worlds()
        assert imp_camp.character_id in pruned_chars
        assert imp_camp.world_id in pruned_worlds
    finally:
        main_module.app.dependency_overrides.clear()


def test_active_timeline_pruning_strip_comments_and_standalone_import(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    reset_rate_limiters()
    u1 = empty_repo.create_user(username="prune_u1", display_name="Pruner")
    u2 = empty_repo.create_user(username="prune_u2", display_name="Importer")
    ids = _build_rich_campaign(empty_repo, u1.id)

    try:
        client_u1 = _make_client(empty_repo, monkeypatch, u1.id)
        exp_res = client_u1.post(
            f"/api/export/campaign/{ids['campaign_id']}",
            json={"timeline_scope": "active", "strip_bookmark_comments": True},
        )
        assert exp_res.status_code == 200

        with zipfile.ZipFile(io.BytesIO(exp_res.content), "r") as zf:
            chars_raw = json.loads(zf.read("characters.json"))
            # char2 joined only on alt branch t1b -> excluded in active mode!
            assert [c["name"] for c in chars_raw] == ["Vex Mercer"]
            camp_raw = json.loads(zf.read("campaigns.json"))[0]
            assert len(camp_raw["turns"]) == 2
            assert len(camp_raw["episodic_chunks"]) == 1
            assert camp_raw["episodic_chunks"][0]["title"] == "Manifest Exchange"
            assert len(camp_raw["vector_entries"]) == 1
            assert camp_raw["vector_entries"][0]["title"] == "Active Memory"
            leaf_turn = camp_raw["turns"][-1]
            # Bookmark pin preserved, personal note stripped!
            assert leaf_turn["is_bookmarked"] == 1
            assert leaf_turn["user_note"] is None

        # Import as u2 with standalone=True -> world, character, persona appear in libraries
        client_u2 = _make_client(empty_repo, monkeypatch, u2.id)
        ins = client_u2.post(
            "/api/import/inspect",
            files={"file": ("active.zcc", exp_res.content, "application/octet-stream")},
        ).json()
        commit = client_u2.post(
            "/api/import/commit",
            json={
                "staged_token": ins["staged_token"],
                "import_campaign_assets_as_standalone": True,
            },
        ).json()
        assert commit["success"] is True
        assert commit["imported_campaigns"] == ["Midnight Drop"]
        assert commit["imported_worlds"] == ["Neon Docklands"]
        assert commit["imported_characters"] == ["Vex Mercer"]
        assert commit["imported_personas"] == ["Courier Kai"]

        assert len(empty_repo.list_worlds(include_pending_deletion=False, owner_id=u2.id)) == 1
        assert len(empty_repo.list_characters(include_pending_deletion=False, owner_id=u2.id)) == 1
        assert "Courier Kai" in [p.name for p in empty_repo.list_personas(owner_id=u2.id)]

        # Copy semantics: importing the same archive again creates a second campaign "(Imported)"
        ins2 = client_u2.post(
            "/api/import/inspect",
            files={"file": ("active2.zcc", exp_res.content, "application/octet-stream")},
        ).json()
        commit2 = client_u2.post(
            "/api/import/commit",
            json={
                "staged_token": ins2["staged_token"],
                "import_campaign_assets_as_standalone": False,
            },
        ).json()
        assert commit2["imported_campaigns"] == ["Midnight Drop (Imported)"]
        assert len(empty_repo.list_campaigns(owner_id=u2.id)) == 2
    finally:
        main_module.app.dependency_overrides.clear()


def test_password_protected_zcc_unlock_and_vector_reembed_on_fingerprint_mismatch(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    reset_rate_limiters()
    u1 = empty_repo.create_user(username="enc_u1", display_name="Sender")
    u2 = empty_repo.create_user(username="enc_u2", display_name="Receiver")
    ids = _build_rich_campaign(empty_repo, u1.id)

    # Stamp a mismatched fingerprint on the campaign's vector entry to test automatic re-embedding
    conn = empty_repo._connect()
    try:
        conn.execute(
            "UPDATE vector_entries SET embedding_fingerprint = ? WHERE campaign_id = ?",
            ("other-server:legacy-embedder:768", ids["campaign_id"]),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        client_u1 = _make_client(empty_repo, monkeypatch, u1.id)
        exp_res = client_u1.post(
            f"/api/export/campaign/{ids['campaign_id']}",
            json={"timeline_scope": "active", "password": "vault-password-42"},
        )
        assert exp_res.status_code == 200
        enc_bytes = exp_res.content
        assert is_encrypted_zcc_bytes(enc_bytes) is True
        assert b"Midnight Drop" not in enc_bytes
        assert b"Vex Mercer" not in enc_bytes

        client_u2 = _make_client(empty_repo, monkeypatch, u2.id)
        ins_res = client_u2.post(
            "/api/import/inspect",
            files={"file": ("secret.zcc", enc_bytes, "application/octet-stream")},
        )
        assert ins_res.status_code == 200
        ins_data = ins_res.json()
        assert ins_data["requires_password"] is True
        assert ins_data["campaigns"] == []
        assert ins_data["characters"] == []

        # Attempting commit before unlock is rejected
        premature = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_data["staged_token"]},
        )
        assert premature.status_code == 400

        # Wrong password returns 401 and preserves staged_token for retry
        wrong = client_u2.post(
            "/api/import/unlock",
            json={"staged_token": ins_data["staged_token"], "password": "nope"},
        )
        assert wrong.status_code == 401

        # Correct password unlocks and returns full inspect preview
        unlocked = client_u2.post(
            "/api/import/unlock",
            json={"staged_token": ins_data["staged_token"], "password": "vault-password-42"},
        )
        assert unlocked.status_code == 200
        u_data = unlocked.json()
        assert u_data["requires_password"] is False
        assert len(u_data["campaigns"]) == 1

        # Commit succeeds and re-embeds mismatched vector entry with current fingerprint
        committed = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_data["staged_token"]},
        )
        assert committed.status_code == 200
        assert committed.json()["success"] is True

        new_camp = empty_repo.list_campaigns(owner_id=u2.id)[0]
        conn = empty_repo._connect()
        try:
            vec_rows = conn.execute(
                "SELECT embedding_fingerprint, embedding_blob FROM vector_entries WHERE campaign_id = ?",
                (new_camp.id,),
            ).fetchall()
            assert len(vec_rows) == 1
            assert vec_rows[0]["embedding_fingerprint"] == current_embedding_fingerprint()
            assert len(vec_rows[0]["embedding_blob"]) > 0
        finally:
            conn.close()
    finally:
        main_module.app.dependency_overrides.clear()


def test_campaign_zcc_remaps_memories_care_relations_and_turn_payloads(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify .zcc export/import branch-filters & remaps campaign_character_memories, CARE relations, and turn JSON payloads."""
    reset_rate_limiters()
    u1 = empty_repo.create_user(username="remap_u1", display_name="Author")
    u2 = empty_repo.create_user(username="remap_u2", display_name="Importer")
    ids = _build_rich_campaign(empty_repo, u1.id)

    char1_id = ids["char1_id"]
    char2_id = ids["char2_id"]
    camp_id = ids["campaign_id"]
    root_tid = ids["root_turn_id"]
    t1a_id = ids["t1a_id"]
    t1b_id = ids["t1b_id"]

    # Enrich t1a with full pre_turn, post_turn, wrapped cognitions, CARE relations toward char2, and anchored memories
    world = empty_repo.get_world(ids["world_id"])
    loc1_id = world.locations[1].id
    rich_pre = PreTurnAnalysis(
        spatial_intent="stay",
        active_speaker_id=char1_id,
        speaker_order=[char1_id, char2_id],
        character_checks=[
            CharacterCheckSpec(
                character_id=char1_id,
                requires_roll=True,
                action_description="Signal Mina across the dock",
                skill_or_approach="Stealth",
            )
        ],
        character_rolls={
            char1_id: DiceRollResult(
                character_id=char1_id,
                character_name="Vex Mercer",
                action_description="Signal Mina",
                skill_or_approach="Stealth",
                d20_raw=15,
                modifier=2,
                total=17,
                difficulty_class=12,
                outcome_tier="Clean Success",
                narrative_directive="Cleanly signaled.",
            )
        },
        character_choices={
            char1_id: CharacterChoiceSet(options=[CharacterChoiceOption(label="Signal Mina")])
        },
        choice_resolutions={
            char1_id: ChoiceResolution(character_id=char1_id, status="mandatory")
        },
        party_action=PartyActionSpec(kind="invite", target_character_ids=[char2_id]),
    )
    rich_post = PostTurnStateDelta(
        transition_type="move_existing",
        target_location_id=loc1_id,
        character_names={char1_id: "Vex Mercer", char2_id: "Mina Sato"},
        compacted_character_ids=[char1_id],
        character_memories=[
            ExtractedCharacterMemory(
                character_id=char1_id,
                title="Signal at Warehouse 9",
                content="Mina held the perimeter without hesitation.",
                significance="bonding",
            )
        ],
        character_deltas={
            char1_id: CharacterAgentDelta(
                mood_label="Steady trust",
                location_transition="move_to_neighbor",
                target_location_id=loc1_id,
                relational_events=[
                    RelationalEventSpec(
                        target=char2_id,
                        warmth_shift="mild_pos",
                        trust_shift="mild_pos",
                        note="Mina covered my blind spot.",
                    )
                ],
                stance_updates={char2_id: "Reliable rig watcher."},
                new_memories=[
                    ExtractedCharacterMemory(
                        character_id=char1_id,
                        title="Signal at Warehouse 9",
                        content="Mina held the perimeter without hesitation.",
                        significance="bonding",
                    )
                ],
                persona_secrets_disclosed_to={char2_id: ["past_alias"]},
            )
        },
        arbitration_rulings=[
            ArbitrationRulingRecord(
                item_name="Manifest Datapad",
                reason="multi_claim",
                claimant_ids=[char1_id, char2_id],
                prior_holder_id=char2_id,
                winner_id=char1_id,
                winner_label="Vex Mercer",
                rationale="Vex kept custody.",
            )
        ],
        party_event_delta=PartyEventDelta(
            action_kind="invite",
            invite_outcomes=[
                PartyInviteOutcome(
                    character_id=char2_id,
                    character_name="Mina Sato",
                    decision="accept",
                    reason="Trusted Vex's lead.",
                )
            ],
            followed_player_ids=[char2_id],
        ),
    )
    rich_care = AffectiveCareState(
        valence=0.1,
        arousal=0.45,
        dominance=0.15,
        composure=0.78,
        appraisal=SituationalAppraisal(threat=0.2, coping=0.4),
        relations={
            "user": RelationalEdge(target_id="user", warmth=0.25, trust=0.2, episodic_note="Solid run."),
            char2_id: RelationalEdge(target_id=char2_id, warmth=0.42, trust=0.55, episodic_note="Has my back."),
        },
    )
    cog_payload = {
        "cognitions": {
            char1_id: CognitionBlock(
                recall="- Mina looped the cameras.",
                feeling="Alert",
                want="Reach Warehouse 9",
                plan="- Signal Mina",
            ).model_dump()
        },
        "character_names": {char1_id: "Vex Mercer"},
    }
    shards = [
        MemoryShard(id="mem_backstory", title="Lost Cargo", content="Lost a crate.", origin="backstory").model_dump(),
        MemoryShard(
            id="mem_superseded",
            title="Initial Suspicion",
            content="Doubted the courier at the gate.",
            origin="clerk_ephemeral",
            significance="revelation",
            anchor_turn_id=root_tid,
            created_at_depth=0,
            superseded_at_turn_id=t1a_id,
        ).model_dump(),
        MemoryShard(
            id="mem_active",
            title="Signal at Warehouse 9",
            content="Mina held the perimeter without hesitation.",
            origin="clerk_ephemeral",
            significance="bonding",
            anchor_turn_id=t1a_id,
            created_at_depth=1,
        ).model_dump(),
        MemoryShard(
            id="mem_alt_branch",
            title="Refused at Harbor",
            content="Walked away on the alternate swipe.",
            origin="clerk_ephemeral",
            significance="betrayal",
            anchor_turn_id=t1b_id,
            created_at_depth=1,
        ).model_dump(),
    ]

    conn = empty_repo._connect()
    try:
        conn.execute(
            """
            UPDATE turn_nodes
            SET pre_turn_json = ?, post_turn_json = ?, cognitions_json = ?
            WHERE id = ?
            """,
            (rich_pre.model_dump_json(), rich_post.model_dump_json(), json.dumps(cog_payload), t1a_id),
        )
        conn.execute(
            """
            UPDATE character_states
            SET affective_state_json = ?, relationship_notes_json = ?
            WHERE turn_id = ? AND character_id = ?
            """,
            (
                rich_care.model_dump_json(),
                json.dumps({"user": "Solid run.", char2_id: "Has my back."}),
                t1a_id,
                char1_id,
            ),
        )
        # Ensure char2 is a campaign participant on root/active branch for active export testing too
        conn.execute(
            "UPDATE campaign_characters SET joined_at_turn_id = NULL WHERE campaign_id = ? AND character_id = ?",
            (camp_id, char2_id),
        )
        conn.execute(
            "UPDATE campaign_character_memories SET memory_shards_json = ? WHERE campaign_id = ? AND character_id = ?",
            (json.dumps(shards), camp_id, char1_id),
        )
        conn.commit()
    finally:
        conn.close()

    try:
        client_u1 = _make_client(empty_repo, monkeypatch, u1.id)
        # 1. Active export prunes alt-branch memory shards
        exp_active = client_u1.post(
            f"/api/export/campaign/{camp_id}",
            json={"timeline_scope": "active", "strip_bookmark_comments": False},
        )
        assert exp_active.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exp_active.content), "r") as zf:
            camp_raw = json.loads(zf.read("campaigns.json"))[0]
            exported_shards = json.loads(camp_raw["campaign_character_memories"][0]["memory_shards_json"])
            assert [s["id"] for s in exported_shards] == ["mem_backstory", "mem_superseded", "mem_active"]

        # 2. Full export + import remaps all memory anchors, CARE relations, pre_turn, post_turn, and cognitions
        exp_full = client_u1.post(
            f"/api/export/campaign/{camp_id}",
            json={"timeline_scope": "full", "strip_bookmark_comments": False},
        )
        assert exp_full.status_code == 200

        client_u2 = _make_client(empty_repo, monkeypatch, u2.id)
        ins = client_u2.post(
            "/api/import/inspect",
            files={"file": ("full.zcc", exp_full.content, "application/octet-stream")},
        ).json()
        commit = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins["staged_token"], "import_campaign_assets_as_standalone": False},
        ).json()
        assert commit["success"] is True

        imp_camp = empty_repo.list_campaigns(owner_id=u2.id)[0]
        bundle = empty_repo.get_campaign_state_bundle(imp_camp.id, owner_id=u2.id)
        imp_char1_id = imp_camp.character_id
        other_chars = [cid for cid in bundle.campaign.participant_character_ids if cid != imp_char1_id]
        assert len(other_chars) == 1
        imp_char2_id = other_chars[0]
        assert imp_char1_id != char1_id
        assert imp_char2_id != char2_id

        imp_t1a = bundle.active_branch_turns[-1]
        imp_t1b = next(t for t in bundle.all_turn_nodes if t.id not in {b.id for b in bundle.active_branch_turns})
        imp_loc1_id = bundle.active_location.id

        # Active branch memories returned cleanly with remapped anchor_turn_id / superseded_at_turn_id!
        valid_active_ids = {t.id for t in bundle.active_branch_turns}
        active_mems = empty_repo.get_campaign_character_memories(
            imp_camp.id, imp_char1_id, valid_turn_ids=valid_active_ids
        )
        assert active_mems is not None
        assert [m.id for m in active_mems] == ["mem_backstory", "mem_active"]
        assert active_mems[1].anchor_turn_id == imp_t1a.id

        raw_mems = empty_repo.get_raw_campaign_character_memories(imp_camp.id, imp_char1_id)
        by_mid = {m.id: m for m in raw_mems}
        assert by_mid["mem_superseded"].superseded_at_turn_id == imp_t1a.id
        assert by_mid["mem_alt_branch"].anchor_turn_id == imp_t1b.id

        # CARE Layer 4 relations key & target_id remapped
        imp_care = imp_t1a.character_states[imp_char1_id].care_state
        assert imp_care is not None
        assert imp_char2_id in imp_care.relations
        assert char2_id not in imp_care.relations
        assert imp_care.relations[imp_char2_id].target_id == imp_char2_id

        # PreTurnAnalysis, PostTurnStateDelta, and wrapped cognitions remapped
        assert imp_t1a.pre_turn.active_speaker_id == imp_char1_id
        assert imp_t1a.pre_turn.speaker_order == [imp_char1_id, imp_char2_id]
        assert imp_char1_id in imp_t1a.pre_turn.character_rolls
        assert imp_t1a.pre_turn.character_rolls[imp_char1_id].character_id == imp_char1_id
        assert imp_t1a.pre_turn.resolved_roll is not None
        assert imp_t1a.pre_turn.resolved_roll.character_id == imp_char1_id
        assert imp_t1a.pre_turn.party_action is not None
        assert imp_t1a.pre_turn.party_action.target_character_ids == [imp_char2_id]

        assert imp_t1a.post_turn is not None
        assert imp_t1a.post_turn.target_location_id == imp_loc1_id
        assert imp_char1_id in imp_t1a.post_turn.character_deltas
        assert imp_t1a.post_turn.character_deltas[imp_char1_id].relational_events[0].target == imp_char2_id
        assert imp_char2_id in imp_t1a.post_turn.character_deltas[imp_char1_id].stance_updates
        assert imp_t1a.post_turn.character_deltas[imp_char1_id].new_memories[0].character_id == imp_char1_id
        assert imp_t1a.post_turn.character_memories[0].character_id == imp_char1_id
        assert imp_t1a.post_turn.arbitration_rulings[0].winner_id == imp_char1_id
        assert imp_t1a.post_turn.party_event_delta is not None
        assert imp_t1a.post_turn.party_event_delta.followed_player_ids == [imp_char2_id]
        assert imp_char1_id in imp_t1a.cognitions
        assert imp_char1_id in imp_t1a.cognition_character_names

        # 3. Legacy archive with unmappable anchor_turn_id / superseded_at_turn_id drops orphan and clears unmapped supersedure
        buf = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(exp_active.content), "r") as zin, zipfile.ZipFile(buf, "w") as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "campaigns.json":
                    camps = json.loads(data)
                    cur_shards = json.loads(camps[0]["campaign_character_memories"][0]["memory_shards_json"])
                    cur_shards[2]["superseded_at_turn_id"] = "turn_orphan_sup"
                    cur_shards.append(
                        MemoryShard(
                            id="mem_orphan",
                            title="Ghost Branch",
                            content="Should be dropped.",
                            origin="clerk_ephemeral",
                            anchor_turn_id="turn_orphan_missing",
                        ).model_dump()
                    )
                    camps[0]["campaign_character_memories"][0]["memory_shards_json"] = json.dumps(cur_shards)
                    data = json.dumps(camps).encode("utf-8")
                zout.writestr(item, data)

        ins_leg = client_u2.post(
            "/api/import/inspect",
            files={"file": ("legacy.zcc", buf.getvalue(), "application/octet-stream")},
        ).json()
        commit_leg = client_u2.post(
            "/api/import/commit",
            json={"staged_token": ins_leg["staged_token"], "import_campaign_assets_as_standalone": False},
        ).json()
        assert commit_leg["success"] is True
        leg_camp = next(c for c in empty_repo.list_campaigns(owner_id=u2.id) if c.id != imp_camp.id)
        leg_mems = empty_repo.get_raw_campaign_character_memories(leg_camp.id, leg_camp.character_id)
        assert [m.id for m in leg_mems] == ["mem_backstory", "mem_superseded", "mem_active"]
        assert leg_mems[2].superseded_at_turn_id is None
    finally:
        main_module.app.dependency_overrides.clear()
