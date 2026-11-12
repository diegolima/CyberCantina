"""Tests for Long-Term Memory Upgrade (Phases A–D):
- Phase A: Structured episodic compaction (title, synopsis_text, keywords, witness_character_ids, salience_score)
- Phase B: Zone 2 sealed-episode LOD cascade + Zone 3 working-memory floor protection
- Phase C: Hybrid BM25/IDF + MMR diversity + RRF fusion + dynamic top-k
- Phase D: Epistemic turn elevation, two-form (full/short) budget packing, and Phase 3 personal shard quota
- Admin & User Preferences overrides for all 6 memory/LOD/recall parameters
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.db.vector_store import (
    build_short_memory_content,
    compute_corpus_idf,
    compute_dynamic_max,
    extract_context_activations,
    fuse_rrf,
    mmr_select,
)
from app.dependencies import resolve_effective_models
from app.engine.phase2_context import (
    assemble_four_zone_messages,
    build_zone4_ephemeral_tail_frame,
    elevate_compacted_episode_turns,
    estimate_messages_tokens,
    pack_recalled_items_to_budget,
    render_zone2_lod_episodic_summary,
)
from app.engine.phase3_cognition import select_cognition_recalled_items
from app.engine.phase5_clerk import (
    compute_episodic_chunk_salience,
    compute_episodic_chunk_witnesses,
    summarize_turn_chunk_structured,
)
from app.schemas.auth import UserModelSettingsPayload
from app.schemas.turn import (
    DiceRollResult,
    EpisodicChunkRecord,
    ExtractedCharacterMemory,
    MechanicsTrigger,
    PreTurnAnalysis,
    RecalledMemoryItem,
)


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_ltm_lod_rrf.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://127.0.0.1:9/v1")
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


# ============================================================================
# Phase A: Structured Episodic Compaction
# ============================================================================


async def test_phase_a_structured_episodic_compaction_and_persistence(
    temp_repo: CantinaRepository,
) -> None:
    """Verify witness extraction, mechanical salience scoring, structured compaction, and DB round-trip."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    base_turn = bundle.active_branch_turns[0]
    char_id = bundle.campaign.character_id
    char = temp_repo.get_character(char_id)

    # Create a turn with a Critical Success roll and transformative memory to test salience boost
    crit_roll = DiceRollResult(
        character_id=char_id,
        action_description="Decrypt the Chimera vault core",
        skill_or_approach="Netrunning",
        d20_raw=20,
        modifier=2,
        total=22,
        difficulty_class=18,
        outcome_tier="Critical Success",
        narrative_directive="Vault decrypts completely.",
    )
    crit_pre = PreTurnAnalysis(
        user_sentiment="fierce",
        subtext_interpretation="All-in gamble",
        mentioned_entities=["Chimera", "Obsidian Keycard"],
        mechanics_check=MechanicsTrigger(
            requires_roll=True,
            action_description="Decrypt the Chimera vault core",
            skill_or_approach="Netrunning",
            difficulty_class=18,
            relevant_modifier=2,
        ),
        character_rolls={char_id: crit_roll},
    )
    high_emotion_state = base_turn.character_state.model_copy(
        update={"valence": 0.85, "arousal": 0.92}
    )
    absent_state = base_turn.character_state.model_copy(
        update={
            "character_id": "char_absent_spy",
            "current_location_id": "loc_somewhere_else",
        }
    )
    turn1 = base_turn.model_copy(
        update={
            "id": "turn_salient_1",
            "parent_turn_id": base_turn.id,
            "depth_index": 1,
            "actor_id": char_id,
            "user_message": "I crack the Chimera vault core with the obsidian keycard!",
            "raw_prose": "Sparks shower the terminal as Kira pulls the decrypted Chimera ledger from the vault.",
            "pre_turn": crit_pre,
            "character_state": high_emotion_state,
            "character_states": {
                char_id: high_emotion_state,
                "char_absent_spy": absent_state,
            },
        }
    )

    witnesses = compute_episodic_chunk_witnesses([base_turn, turn1])
    assert char_id in witnesses
    assert "char_absent_spy" not in witnesses

    salience_high = compute_episodic_chunk_salience(
        [base_turn, turn1],
        extracted_memories=[
            ExtractedCharacterMemory(
                character_id=char_id,
                title="Chimera Vault Vow",
                content="Kira swore to guard the decrypted Chimera ledger with her life.",
                significance="vow",
            )
        ],
    )
    salience_calm = compute_episodic_chunk_salience([base_turn])
    assert salience_high >= 8
    assert salience_high > salience_calm

    structured = await summarize_turn_chunk_structured([base_turn, turn1], char)
    assert structured.title
    assert structured.synopsis_text
    assert structured.summary_text
    assert len(structured.keywords) >= 1

    # Persist via save_episodic_chunk and verify SQLite + VectorStore round-trip
    created_chunk = temp_repo.save_episodic_chunk(
        campaign_id=bundle.campaign.id,
        world_id=bundle.campaign.world_id,
        character_id=char_id,
        start_turn_depth=0,
        end_turn_depth=1,
        leaf_turn_id=base_turn.id,
        summary_text=structured.summary_text,
        title=structured.title,
        synopsis_text=structured.synopsis_text,
        keywords=structured.keywords,
        witness_character_ids=witnesses,
        salience_score=salience_high,
    )
    assert created_chunk is not None
    assert created_chunk.title == structured.title
    assert created_chunk.synopsis_text == structured.synopsis_text
    assert char_id in created_chunk.witness_character_ids
    assert created_chunk.salience_score >= 8

    db_chunks = temp_repo.get_branch_episodic_chunks(
        bundle.campaign.id, {base_turn.id}
    )
    assert len(db_chunks) == 1
    persisted = db_chunks[0]
    assert persisted.title == created_chunk.title
    assert persisted.synopsis_text == created_chunk.synopsis_text
    assert persisted.keywords == created_chunk.keywords
    assert persisted.witness_character_ids == created_chunk.witness_character_ids
    assert persisted.salience_score == created_chunk.salience_score


# ============================================================================
# Phase B: Zone 2 Sealed-Episode LOD Cascade & Zone 3 Budget Allocation
# ============================================================================


def test_phase_b_zone2_lod_cascade_and_salience_bonus() -> None:
    """Verify summary -> synopsis -> dropped LOD tiers and salience_score >= 8 importance bonus."""
    chunks: list[EpisodicChunkRecord] = []
    for idx in range(10):
        # Make chunk 1 (old, index 1) highly salient (salience_score=9)
        salience = 9 if idx == 1 else 5
        chunks.append(
            EpisodicChunkRecord(
                id=f"chunk_{idx}",
                campaign_id="camp_1",
                start_turn_depth=idx * 6,
                end_turn_depth=idx * 6 + 5,
                leaf_turn_id=f"turn_{idx * 6 + 5}",
                title=f"Episode {idx}",
                synopsis_text=f"One-line synopsis for episode {idx}.",
                summary_text=(
                    f"Full multi-sentence summary for episode {idx}. "
                    + ("Detailed narrative context about the sector conflict. " * 6)
                ),
                salience_score=salience,
                created_at="2026-01-01T00:00:00Z",
            )
        )

    # With lod_summary_chunks=4 and lod_importance_bonus=8, chunk_1 (pos_from_end=8, eff_age=0)
    # should win a 'summary' slot alongside the newest chunks!
    rendered, tiers = render_zone2_lod_episodic_summary(
        chunks,
        lod_summary_chunks=4,
        lod_importance_bonus=8,
    )
    assert rendered is not None
    assert tiers["chunk_1"] == "summary"
    assert tiers["chunk_9"] == "summary"
    assert tiers["chunk_0"] == "synopsis"
    assert "[Episode Turns 0–5 (Synopsis)]: One-line synopsis for episode 0." in rendered
    assert "[Episode Turns 6–11]: Full multi-sentence summary for episode 1." in rendered

    # Constrain budget so older summaries demote to synopsis first, then oldest drop
    full_cost = estimate_messages_tokens([{"role": "system", "content": rendered}])
    tight_rendered, tight_tiers = render_zone2_lod_episodic_summary(
        chunks,
        budget_tokens=int(full_cost * 0.55),
        lod_summary_chunks=4,
        lod_importance_bonus=2,
    )
    assert tight_rendered is not None
    # Newest chunk should still survive while oldest chunks demote or drop
    assert tight_tiers["chunk_9"] in ("summary", "synopsis")
    assert any(t == "synopsis" for t in tight_tiers.values())


def test_phase_b_zone2_share_cap_protects_zone3_working_memory(
    temp_repo: CantinaRepository,
) -> None:
    """Verify 15 episodic chunks cannot starve Zone 3 below min_working_memory_turns."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    world = temp_repo.get_world(bundle.campaign.world_id)
    char = temp_repo.get_character(bundle.campaign.character_id)
    turn0 = bundle.active_branch_turns[0]

    # Create 15 large episodic chunks covering depths 0..89
    chunks = [
        EpisodicChunkRecord(
            id=f"chunk_{i}",
            campaign_id=bundle.campaign.id,
            start_turn_depth=i * 6,
            end_turn_depth=i * 6 + 5,
            leaf_turn_id=f"turn_leaf_{i}",
            title=f"Chapter {i}",
            synopsis_text=f"Compact 1-line synopsis for chapter {i}.",
            summary_text=f"Heavy episodic summary {i}: " + ("long historical recap text " * 35),
            salience_score=5,
            created_at="2026-01-01T00:00:00Z",
        )
        for i in range(15)
    ]

    # Create 6 unsummarized recent turns at depths 90..95
    turns = [turn0]
    for idx in range(6):
        depth = 90 + idx
        turns.append(
            turn0.model_copy(
                update={
                    "id": f"turn_{depth}",
                    "parent_turn_id": turns[-1].id,
                    "depth_index": depth,
                    "actor_id": char.id,
                    "user_message": f"RECENT_WM_USER_{depth}: checking the perimeter sensors.",
                    "raw_prose": f"RECENT_WM_PROSE_{depth}: Kira scans the rain-slicked alley.",
                }
            )
        )

    # Measure base tokens (Zone 1 + Zone 4) and 6 Zone 3 turns
    no_z2_msgs = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=turns,
        episodic_chunks=[],
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=turn0.pre_turn,
        user_message="Status report?",
        working_memory_turns=6,
    )
    base_cost = estimate_messages_tokens([no_z2_msgs[0], no_z2_msgs[-1]])
    z3_all_cost = estimate_messages_tokens(no_z2_msgs[1:-1])

    # Set context ceiling so remaining_history_budget is ~1.9x z3_all_cost (plenty for 4 turns + compressed Zone 2,
    # but smaller than 15 uncompressed chunks + 6 turns)
    target_input = base_cost + int(z3_all_cost * 1.9)
    max_ctx = target_input + 1024 + 256

    assembled = assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=turns,
        episodic_chunks=chunks,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=[],
        pre_turn=turn0.pre_turn,
        user_message="Status report?",
        working_memory_turns=6,
        min_working_memory_turns=4,
        lod_summary_chunks=6,
        zone2_budget_share_pct=45,
        max_context_tokens=max_ctx,
        reserved_output_tokens=1024,
    )

    joined_z3 = "\n".join(m["content"] for m in assembled[2:-1])
    # All 4 newest working-memory turns (depths 92, 93, 94, 95) must be preserved
    for depth in (92, 93, 94, 95):
        assert f"RECENT_WM_USER_{depth}" in joined_z3
    # And Zone 2 is still present in cascaded LOD form
    assert "=== STORY SO FAR (EPISODIC MEMORY) ===" in assembled[1]["content"]


# ============================================================================
# Phase C: Hybrid BM25/IDF + MMR + RRF Retrieval
# ============================================================================


def test_phase_c_idf_mmr_rrf_and_dynamic_max() -> None:
    """Verify corpus IDF weighting, recency-graded activations, MMR diversity, and RRF fusion."""
    doc_sets = [
        {"neon", "rust", "synth", "ale", "glass", "bar"},
        {"neon", "rust", "rain", "patrol", "drone"},
        {"neon", "rust", "black", "ice", "chimera", "subdermal", "prototype"},
    ]
    idf = compute_corpus_idf(doc_sets)
    # 'chimera' appears in 1/3 docs, 'neon' appears in 3/3 docs -> chimera has strictly higher IDF
    assert idf["chimera"] > idf["neon"]

    weights, phrases = extract_context_activations(
        queries=["chimera prototype"],
        mentioned_entities=["Project Chimera"],
        recent_turn_texts=[
            "older turn talking about weather",
            "previous turn mentioning patrol",
            "latest turn asking about subdermal key",
        ],
    )
    assert weights["chimera"] == pytest.approx(1.5)  # mentioned entity
    assert weights["prototype"] == pytest.approx(1.0)  # query token
    assert weights["subdermal"] == pytest.approx(0.65)  # recent 2 turns
    assert weights["patrol"] == pytest.approx(0.65)  # recent 2 turns
    assert weights["weather"] == pytest.approx(0.25)  # older working window turn
    assert "project chimera" in phrases

    # MMR diversity: two identical unit vectors vs one orthogonal unit vector
    vec_a = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    vec_b = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    vec_c = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    mmr_ranked = mmr_select(
        [("doc_dup_a", 0.95, vec_a), ("doc_dup_b", 0.94, vec_b), ("doc_distinct_c", 0.80, vec_c)],
        top_k=3,
        lambda_mult=0.55,
    )
    # Distinct doc_c should be promoted ahead of near-duplicate dup_b
    assert mmr_ranked[0][0] == "doc_dup_a"
    assert mmr_ranked[1][0] == "doc_distinct_c"
    assert mmr_ranked[2][0] == "doc_dup_b"

    # RRF fusion rewards consensus item appearing near the top of both lists
    kw_list = ["lex_only_3", "consensus_1"]
    emb_list = ["consensus_1", "sem_only_2", "lex_only_3"]
    fused = fuse_rrf(kw_list, emb_list, k=60)
    assert fused[0][0] == "consensus_1"

    assert compute_dynamic_max(["consensus_1", "a"], ["consensus_1", "b"], base_top_k=4, top_keyword_score=4.5) == 6


# ============================================================================
# Phase D: Turn Elevation, Two-Form Budget Packing & Phase 3 Shard Quota
# ============================================================================


def test_phase_d_two_form_budget_packing_and_zone4_rendering(
    temp_repo: CantinaRepository,
) -> None:
    """Verify Rank 0 is always full, subsequent items pack as short, and upgrade when budget allows."""
    items = [
        RecalledMemoryItem(
            id=f"mem_{i}",
            source_type="lore",
            title=f"Archive Entry {i}",
            content=f"Full detailed lore paragraph for entry {i}. " + ("Extra archival detail. " * 18),
            short_content=f"Archive Entry {i}: concise 1-line summary.",
            score=10.0 - i,
        )
        for i in range(4)
    ]

    # Tight budget: Rank 0 is 'full', additional admitted items stay 'short'
    packed_tight = pack_recalled_items_to_budget(items, token_budget=210)
    assert len(packed_tight) >= 2
    assert packed_tight[0].render_form == "full"
    assert any(it.render_form == "short" for it in packed_tight[1:])

    # Generous budget: all items upgrade to 'full'
    packed_generous = pack_recalled_items_to_budget(items, token_budget=1200)
    assert len(packed_generous) == 4
    assert all(it.render_form == "full" for it in packed_generous)

    # Verify Zone 4 renders 'short' items using short_content and 'full' items using content
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    char = temp_repo.get_character(bundle.campaign.character_id)
    turn0 = bundle.active_branch_turns[0]
    zone4_txt = build_zone4_ephemeral_tail_frame(
        user_message="Tell me about the archives.",
        character=char,
        world_snapshot=turn0.world_snapshot,
        character_state=turn0.character_state,
        active_location=bundle.active_location,
        neighbors=bundle.neighbor_locations,
        recalled_items=packed_tight,
        pre_turn=turn0.pre_turn,
    )
    assert "Full detailed lore paragraph for entry 0." in zone4_txt
    assert "concise 1-line summary." in zone4_txt


def test_phase_d_epistemic_turn_elevation_respects_character_presence(
    temp_repo: CantinaRepository,
) -> None:
    """Verify compacted episode turn elevation attaches verbatim quotes ONLY when character witnessed the turn."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    char = temp_repo.get_character(bundle.campaign.character_id)
    turn0 = bundle.active_branch_turns[0]

    # Turn 1: Kira is present in active_location and hears the secret passcode 'SOLARIS-9'
    present_state = turn0.character_state.model_copy(
        update={
            "character_id": char.id,
            "current_location_id": turn0.world_snapshot.active_location_id,
        }
    )
    turn1_present = turn0.model_copy(
        update={
            "id": "turn_ep_1",
            "parent_turn_id": turn0.id,
            "depth_index": 1,
            "actor_id": char.id,
            "user_message": "The vault passcode is SOLARIS-9.",
            "raw_prose": "Kira memorizes the vault passcode SOLARIS-9 and nods.",
            "character_state": present_state,
            "character_states": {char.id: present_state},
        }
    )

    # Turn 2: Kira is in a DIFFERENT room when 'OMEGA-ZERO' is spoken
    away_state = turn0.character_state.model_copy(
        update={
            "character_id": char.id,
            "current_location_id": "loc_ripperdoc_clinic",
        }
    )
    turn2_absent = turn0.model_copy(
        update={
            "id": "turn_ep_2",
            "parent_turn_id": turn1_present.id,
            "depth_index": 2,
            "actor_id": "char_other_npc",
            "user_message": "The override code is OMEGA-ZERO.",
            "raw_prose": "The courier whispers the override code OMEGA-ZERO in the empty hall.",
            "character_state": away_state,
            "character_states": {char.id: away_state},
        }
    )

    chunk = EpisodicChunkRecord(
        id="chunk_ep_1_2",
        campaign_id=bundle.campaign.id,
        start_turn_depth=1,
        end_turn_depth=2,
        leaf_turn_id=turn2_absent.id,
        title="Passcode Exchange",
        synopsis_text="Codes were exchanged in the cantina.",
        summary_text="Several security codes were discussed during the meeting.",
        created_at="2026-01-01T00:00:00Z",
    )
    recalled_chunk_item = RecalledMemoryItem(
        id="chunk_ep_1_2",
        source_type="episodic_chunk",
        title="Episodic Memory (Turns 1–2): Passcode Exchange",
        content=chunk.summary_text,
        short_content=chunk.synopsis_text,
        relevance_score=5.0,
    )

    # Querying SOLARIS-9 for Kira elevates Turn 1
    elevated_present = elevate_compacted_episode_turns(
        recalled_items=[recalled_chunk_item],
        episodic_chunks=[chunk],
        branch_turns=[turn0, turn1_present, turn2_absent],
        queries=["What was the SOLARIS-9 vault passcode?"],
        mentioned_entities=["SOLARIS-9"],
        target_character_id=char.id,
        present_characters=[char],
        working_memory_turns=1,
    )
    assert "[Elevated Turn 1 Recall" in elevated_present[0].content
    assert "SOLARIS-9" in elevated_present[0].content

    # Querying OMEGA-ZERO for Kira MUST NOT elevate Turn 2 because Kira was absent!
    elevated_absent = elevate_compacted_episode_turns(
        recalled_items=[recalled_chunk_item],
        episodic_chunks=[chunk],
        branch_turns=[turn0, turn1_present, turn2_absent],
        queries=["What was the OMEGA-ZERO override code?"],
        mentioned_entities=["OMEGA-ZERO"],
        target_character_id=char.id,
        present_characters=[char],
        working_memory_turns=1,
    )
    assert "OMEGA-ZERO" not in elevated_absent[0].content


def test_phase_d_cognition_personal_shard_quota() -> None:
    """Verify Phase 3 cognition reserves slots for character_shard items even when 4 shared items exist."""
    shared_items = [
        RecalledMemoryItem(
            id=f"shared_lore_{i}",
            source_type="lore",
            title=f"World Lore {i}",
            content=f"Detailed world faction lore entry {i}.",
            short_content=build_short_memory_content(f"World Lore {i}", f"Detailed world faction lore entry {i}."),
            score=9.0 - i,
        )
        for i in range(4)
    ]
    personal_shards = [
        RecalledMemoryItem(
            id="shard_personal_1",
            source_type="character_shard",
            title="Meridian Scar",
            content="I still carry the neural burn from the Meridian betrayal.",
            short_content="Meridian Scar: I still carry the neural burn from the Meridian betrayal.",
            score=7.5,
        ),
        RecalledMemoryItem(
            id="shard_personal_2",
            source_type="character_shard",
            title="Debt to Vespera",
            content="I swore never to let Vespera take my clinic.",
            short_content="Debt to Vespera: I swore never to let Vespera take my clinic.",
            score=7.0,
        ),
    ]

    selected = select_cognition_recalled_items(
        shared_items,
        personal_shards,
        token_budget=220,
    )
    selected_ids = {m.id for m in selected}
    # Both personal character shards must be preserved in Phase 3 cognition recall
    assert "shard_personal_1" in selected_ids
    assert "shard_personal_2" in selected_ids


# ============================================================================
# Admin & User Preferences Overrides
# ============================================================================


def test_admin_and_user_preferences_memory_settings_override(
    temp_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify all 6 memory/LOD/recall parameters save per user and respect allow_user_model_overrides."""
    import app.dependencies as deps_module

    monkeypatch.setattr(deps_module, "get_repo", lambda: temp_repo)
    user = temp_repo.create_user(
        username="memtester",
        display_name="Mem Tester",
        password_hash="hash",
        role="user",
    )

    payload = UserModelSettingsPayload(
        working_memory_turns=10,
        min_working_memory_turns=5,
        lod_summary_chunks=9,
        lod_importance_bonus=3,
        zone2_budget_share_pct=40,
        recall_budget_prose_tokens=600,
        recall_budget_cognition_tokens=300,
    )
    saved = temp_repo.save_user_model_settings(user.id, payload)
    assert saved.min_working_memory_turns == 5
    assert saved.lod_summary_chunks == 9
    assert saved.lod_importance_bonus == 3
    assert saved.zone2_budget_share_pct == 40
    assert saved.recall_budget_prose_tokens == 600
    assert saved.recall_budget_cognition_tokens == 300

    # When allow_user_model_overrides is False, effective settings use admin defaults
    monkeypatch.setattr(settings, "allow_user_model_overrides", False)
    eff_locked = resolve_effective_models(user.id)
    assert eff_locked.min_working_memory_turns == settings.memory_config.min_working_memory_turns
    assert eff_locked.lod_summary_chunks == settings.memory_config.lod_summary_chunks
    assert eff_locked.zone2_budget_share_pct == settings.memory_config.zone2_budget_share_pct
    assert eff_locked.recall_budget_prose_tokens == settings.memory_config.recall_budget_prose_tokens
    assert eff_locked.recall_budget_cognition_tokens == settings.memory_config.recall_budget_cognition_tokens

    # When allow_user_model_overrides is True, effective settings reflect user preferences
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)
    eff_overridden = resolve_effective_models(user.id)
    assert eff_overridden.working_memory_turns == 10
    assert eff_overridden.min_working_memory_turns == 5
    assert eff_overridden.lod_summary_chunks == 9
    assert eff_overridden.lod_importance_bonus == 3
    assert eff_overridden.zone2_budget_share_pct == 40
    assert eff_overridden.recall_budget_prose_tokens == 600
    assert eff_overridden.recall_budget_cognition_tokens == 300
