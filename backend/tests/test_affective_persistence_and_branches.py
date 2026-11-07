"""Gate 2 tests for CARE persistence, absent-NPC carry-forward, branching, & concurrency gate."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sqlite3

import pytest

from app.config import settings
from app.db.repository import CantinaRepository
from app.db.seed import ensure_default_seed
from app.engine.affective_engine import materialize_snapshot_with_care, seed_initial_care_state
from app.routers.campaigns import campaign_turn_gate
from app.schemas.affective import (
    AffectiveCareState,
    RelationalEdge,
    WorldviewProfile,
    temperament_config_for_archetype,
)
from app.schemas.character import (
    BaselinePsyche,
    CharacterStateSnapshot,
    CharacterWizardDraft,
    CognitionBlock,
)
from app.schemas.turn import (
    PostTurnStateDelta,
    PreTurnAnalysis,
    WorldStateSnapshot,
)


@pytest.fixture()
def temp_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> CantinaRepository:
    db_file = str(tmp_path / "test_care_persistence.db")
    monkeypatch.setattr(settings, "db_path", db_file)
    monkeypatch.setattr(settings, "allow_offline_fallback", True)
    monkeypatch.setattr(settings.embedding_profile, "mode", "local_hash")
    repo = CantinaRepository(db_file)
    repo.init_db()
    ensure_default_seed(repo)
    return repo


def test_seed_turn0_care_state_and_campaign_elapsed_minutes(temp_repo: CantinaRepository) -> None:
    """Turn 0 seeded campaign persists Kira's stoic CARE state & campaign_elapsed_minutes == 0."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    kira = bundle.character_records["char_kira_vance"]
    assert kira.baseline_psyche.temperament.archetype == "stoic"
    assert kira.baseline_psyche.temperament.relational_inertia == pytest.approx(0.92)

    kira_state = bundle.current_character_state
    assert kira_state.care_state is not None
    assert kira_state.care_state.is_provisional is False
    assert kira_state.care_state.state_elapsed_minutes == 0
    assert "user" in kira_state.care_state.relations
    assert bundle.current_world_snapshot.campaign_elapsed_minutes == 0


def test_absent_character_carry_forward_preserves_care_state_and_idle_clock(
    temp_repo: CantinaRepository,
) -> None:
    """save_turn_node carries forward off-screen NPC's care_state & state_elapsed_minutes untouched."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    world = temp_repo.get_world(bundle.campaign.world_id)
    backroom = next(loc for loc in world.locations if "Ripperdoc" in loc.name)

    offscreen_draft = CharacterWizardDraft(
        name="Marcus Holt",
        tagline="Stranded fixer waiting in the clinic.",
        core_persona="Cynical fixer nursing a shoulder wound.",
        baseline_psyche=BaselinePsyche(
            mood_label="Bitter and tense",
            valence=-0.40,
            arousal=0.72,
            core_drive="Clear the blockade.",
            core_fear="Being sold out.",
            default_want="Patch his shoulder.",
            default_plan="Wait in the clinic.",
            initial_worldview=WorldviewProfile(benevolence=-0.6, belonging=-0.4, agency=0.5),
            temperament=temperament_config_for_archetype("paranoiac"),
        ),
    )
    marcus = temp_repo.create_character_from_draft(
        offscreen_draft, world_id=world.id, character_id="char_marcus_holt"
    )
    updated_bundle = temp_repo.add_character_to_campaign(
        "camp_neon_rust_default", marcus.id, location_id=backroom.id
    )
    turn_0 = updated_bundle.active_branch_turns[-1]

    # Give Marcus a customized grudge at minute 15 via update_turn_post_clerk
    custom_care = seed_initial_care_state(marcus.baseline_psyche, initial_elapsed_minutes=15)
    custom_care = custom_care.model_copy(
        update={
            "composure": 0.32,
            "relations": {
                "user": RelationalEdge(
                    target_id="user",
                    warmth=-0.55,
                    trust=-0.75,
                    grievance=0.80,
                    obligation=0.65,
                    episodic_note="Left stranded at docks, yet saved from Hounds.",
                )
            },
        }
    )
    marcus_t0 = materialize_snapshot_with_care(
        turn_0.character_states[marcus.id], custom_care
    )
    temp_repo.update_turn_post_clerk(
        turn_id=turn_0.id,
        post_turn=PostTurnStateDelta(elapsed_minutes=15),
        updated_world_snapshot=turn_0.world_snapshot.model_copy(
            update={"campaign_elapsed_minutes": 15}
        ),
        updated_character_state=turn_0.character_state,
        extra_character_states=[marcus_t0],
    )

    # Now save Turn 1 in Main Bar WITHOUT passing Marcus in extra_character_states!
    t1 = temp_repo.save_turn_node(
        turn_id="turn_main_bar_1",
        campaign_id="camp_neon_rust_default",
        parent_turn_id=turn_0.id,
        depth_index=1,
        user_message="Pour me a drink, Kira.",
        actor_id="char_kira_vance",
        raw_prose="*Kira pours a drink.*",
        cognition=CognitionBlock(feeling="Measured", want="Talk", plan="- Pour drink"),
        pre_turn=PreTurnAnalysis(active_speaker_id="char_kira_vance"),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_main_bar_1",
            world_timestamp="2094-11-14 23:35",
            active_location_id=turn_0.world_snapshot.active_location_id,
            scene_flags=["Main Bar"],
            campaign_elapsed_minutes=20,
        ),
        character_state=turn_0.character_state.model_copy(update={"turn_id": "turn_main_bar_1"}),
        recalled_items=[],
        extra_character_states=[],  # Marcus is absent from active room!
    )

    carried = t1.character_states[marcus.id]
    assert carried.care_state is not None
    assert carried.care_state.state_elapsed_minutes == 15  # Preserved for Δt_idle = 20 - 15 = 5m!
    assert carried.care_state.composure == pytest.approx(0.32)
    assert carried.care_state.relations["user"].grievance == pytest.approx(0.80)
    assert carried.care_state.relations["user"].obligation == pytest.approx(0.65)


def test_branch_isolation_preserves_divergent_worldviews_and_relations(
    temp_repo: CantinaRepository,
) -> None:
    """Tenet V: Trauma/betrayal on Branch A never leaks into sibling swipe Branch B."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    root_turn = bundle.active_branch_turns[0]
    kira = bundle.character_records["char_kira_vance"]

    # Branch A: Betrayal shatters trust & lowers worldview benevolence
    care_a = seed_initial_care_state(kira.baseline_psyche, initial_elapsed_minutes=10).model_copy(
        update={
            "valence": -0.80,
            "composure": 0.22,
            "active_worldview": WorldviewProfile(benevolence=-0.75, belonging=-0.20, agency=0.10),
            "relations": {
                "user": RelationalEdge(
                    target_id="user", warmth=-0.80, trust=-0.90, grievance=0.92
                )
            },
        }
    )
    snap_a = materialize_snapshot_with_care(
        root_turn.character_state.model_copy(update={"turn_id": "turn_branch_a"}),
        care_a,
    )
    temp_repo.save_turn_node(
        turn_id="turn_branch_a",
        campaign_id="camp_neon_rust_default",
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="I sold your clinic coordinates to Vespera.",
        actor_id=kira.id,
        raw_prose="*Kira reaches under the counter.*",
        cognition=CognitionBlock(feeling="Betrayed", want="Defend clinic", plan="- Draw shotgun"),
        pre_turn=PreTurnAnalysis(active_speaker_id=kira.id),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_branch_a", "campaign_elapsed_minutes": 10}
        ),
        character_state=snap_a,
        recalled_items=[],
    )

    # Branch B (Swipe from root_turn): Bonding builds high trust & positive worldview
    care_b = seed_initial_care_state(kira.baseline_psyche, initial_elapsed_minutes=8).model_copy(
        update={
            "valence": 0.55,
            "composure": 0.90,
            "active_worldview": WorldviewProfile(benevolence=0.35, belonging=0.70, agency=0.45),
            "relations": {
                "user": RelationalEdge(
                    target_id="user", warmth=0.65, trust=0.72, grievance=0.0
                )
            },
        }
    )
    snap_b = materialize_snapshot_with_care(
        root_turn.character_state.model_copy(update={"turn_id": "turn_branch_b"}),
        care_b,
    )
    temp_repo.save_turn_node(
        turn_id="turn_branch_b",
        campaign_id="camp_neon_rust_default",
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="I wiped Vespera's trace logs on your clinic.",
        actor_id=kira.id,
        raw_prose="*Kira exhales slowly.*",
        cognition=CognitionBlock(feeling="Relieved", want="Thank runner", plan="- Pour good synth"),
        pre_turn=PreTurnAnalysis(active_speaker_id=kira.id),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_branch_b", "campaign_elapsed_minutes": 8}
        ),
        character_state=snap_b,
        recalled_items=[],
    )

    checked_a = temp_repo.checkout_turn_branch("camp_neon_rust_default", "turn_branch_a")
    assert checked_a.current_character_state.care_state is not None
    assert checked_a.current_character_state.care_state.relations["user"].grievance == pytest.approx(0.92)
    assert checked_a.current_character_state.care_state.active_worldview.benevolence == pytest.approx(-0.75)

    checked_b = temp_repo.checkout_turn_branch("camp_neon_rust_default", "turn_branch_b")
    assert checked_b.current_character_state.care_state is not None
    assert checked_b.current_character_state.care_state.relations["user"].grievance == pytest.approx(0.0)
    assert checked_b.current_character_state.care_state.relations["user"].trust == pytest.approx(0.72)

    # Static character definition in `characters` table remains untouched!
    kira_static = temp_repo.get_character(kira.id)
    assert kira_static.baseline_psyche.initial_worldview.benevolence == pytest.approx(-0.15)


@pytest.mark.asyncio
async def test_deleted_turn_clerk_guard_and_campaign_turn_gate(
    temp_repo: CantinaRepository,
) -> None:
    """Verify update_turn_post_clerk rejects deleted turn cleanly (no IntegrityError) & lock serializes."""
    bundle = temp_repo.get_campaign_state_bundle("camp_neon_rust_default")
    root_turn = bundle.active_branch_turns[0]

    with pytest.raises(KeyError, match="deleted before Phase 5"):
        temp_repo.update_turn_post_clerk(
            turn_id="turn_nonexistent_deleted",
            post_turn=PostTurnStateDelta(elapsed_minutes=2),
            updated_world_snapshot=root_turn.world_snapshot,
            updated_character_state=root_turn.character_state,
        )

    # Verify per-campaign gate serializes concurrent contenders on same campaign_id without blocking others
    order: list[str] = []
    lock_a1 = campaign_turn_gate.lock_for("camp_a")
    lock_a2 = campaign_turn_gate.lock_for("camp_a")
    lock_b = campaign_turn_gate.lock_for("camp_b")
    assert lock_a1 is lock_a2
    assert lock_a1 is not lock_b

    async def worker_1() -> None:
        async with campaign_turn_gate.lock_for("camp_race"):
            order.append("w1_enter")
            await asyncio.sleep(0.02)
            order.append("w1_exit")

    async def worker_2() -> None:
        await asyncio.sleep(0.005)
        async with campaign_turn_gate.lock_for("camp_race"):
            order.append("w2_enter")

    await asyncio.gather(worker_1(), worker_2())
    assert order == ["w1_enter", "w1_exit", "w2_enter"]


def test_legacy_sqlite_migration_adds_care_columns_idempotently(tmp_path: Path) -> None:
    """Simulate opening an older pre-CARE SQLite database missing affective_state_json."""
    db_file = str(tmp_path / "legacy_pre_care.db")
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE world_state_snapshots (
            turn_id TEXT PRIMARY KEY,
            world_timestamp TEXT NOT NULL,
            active_location_id TEXT NOT NULL,
            scene_flags_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE character_states (
            turn_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            current_location_id TEXT NOT NULL,
            mood_label TEXT NOT NULL,
            valence REAL NOT NULL DEFAULT 0.0,
            arousal REAL NOT NULL DEFAULT 0.4,
            active_want TEXT NOT NULL,
            active_plan TEXT NOT NULL,
            relationship_notes_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (turn_id, character_id)
        );
        """
    )
    conn.commit()
    conn.close()

    repo = CantinaRepository(db_file)
    repo.init_db()
    repo.init_db()  # Second call verifies strict idempotency

    check_conn = sqlite3.connect(db_file)
    ws_cols = {r[1] for r in check_conn.execute("PRAGMA table_info(world_state_snapshots)")}
    cs_cols = {r[1] for r in check_conn.execute("PRAGMA table_info(character_states)")}
    check_conn.close()

    assert "campaign_elapsed_minutes" in ws_cols
    assert "affective_state_json" in cs_cols
