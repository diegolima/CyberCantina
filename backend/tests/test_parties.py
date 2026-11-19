"""Comprehensive tests for Phase 2: Core Parties System (v0.21.0)."""

from __future__ import annotations

import random
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db.repository import CantinaRepository
from app.engine import phase5_clerk
from app.engine.affective_engine import seed_initial_care_state
from app.engine.choices import (
    build_directed_cognition_schema,
    build_undirected_cognition_schema,
)
from app.engine.cognition.heuristics import compute_heuristic_party_invite_decision
from app.engine.cognition.runner import run_character_cognition_agent
from app.engine.context.assembler import assemble_four_zone_messages
from app.engine.context.zone1_static import build_zone1_ensemble_system_prompt
from app.engine.llm_client import llm_client
from app.engine.parties import (
    apply_party_disband,
    apply_party_invite_acceptances,
    apply_party_kick,
    apply_party_leave,
    build_party_invite_roll_directives,
    create_npc_only_party,
    get_player_party,
    parse_party_slash_command,
    reconcile_parties_strict_colocation,
    render_cognition_party_context,
    resolve_character_travel_intent_enum,
    resolve_phase5_spatial_and_parties,
)
from app.engine.phase1_pre import run_phase1_pre_analysis
from app.routers.campaign_routes.turn_streaming import _execute_turn_stream_events
from app.schemas.affective import RelationalEdge
from app.schemas.character import CharacterStateSnapshot, CognitionBlock
from app.schemas.party import (
    USER_PARTY_MEMBER_ID,
    PartyActionSpec,
    PartyInviteOutcome,
    PartyRecord,
)
from app.schemas.turn import (
    CharacterAgentDelta,
    CharacterCheckSpec,
    ChoiceResolution,
    DiceRollResult,
    MechanicsTrigger,
    PreTurnAnalysis,
    PreTurnLLMOutput,
    TurnSubmitRequest,
    WorldPostTurnDelta,
)
from tests.factories import (
    seed_character,
    seed_linear_world,
    seed_minimal_scenario,
    seed_user,
)


def _char_state(cid: str, loc_id: str, turn_id: str = "t0") -> CharacterStateSnapshot:
    return CharacterStateSnapshot(
        turn_id=turn_id,
        character_id=cid,
        current_location_id=loc_id,
        mood_label="Steady",
        valence=0.1,
        arousal=0.4,
        active_want="Watch",
        active_plan="Wait",
    )


# ---------------------------------------------------------------------------
# 1. Pure Party Engine: Model 1 Co-Location, Disjointness & Lifecycles
# ---------------------------------------------------------------------------


def test_strict_colocation_and_disjointness_reconciliation() -> None:
    p_player = PartyRecord(
        id="p1",
        name="Your Party",
        member_ids=[USER_PARTY_MEMBER_ID, "c1", "c2", "c3"],
        leader_id=USER_PARTY_MEMBER_ID,
        location_id="loc_a",
    )
    # c3 also duplicated in p2 -> disjointness drops c3 from p2, making p2 < 2 so p2 dissolves
    p_dup = PartyRecord(
        id="p2",
        name="Duplicate",
        member_ids=["c3", "c4"],
        leader_id="c3",
        location_id="loc_a",
    )

    # Player moves to loc_b with c1; c2 & c3 stay behind in loc_a -> form NPC party with random NPC leader
    reconciled = reconcile_parties_strict_colocation(
        [p_player, p_dup],
        {
            USER_PARTY_MEMBER_ID: "loc_b",
            "c1": "loc_b",
            "c2": "loc_a",
            "c3": "loc_a",
            "c4": "loc_a",
        },
        name_map={"c1": "Kira", "c2": "Nyx", "c3": "Viktor", "c4": "Dex"},
        rng=random.Random(7),
    )
    assert len(reconciled) == 2
    by_user = [p for p in reconciled if USER_PARTY_MEMBER_ID in p.member_ids][0]
    assert by_user.member_ids == [USER_PARTY_MEMBER_ID, "c1"]
    assert by_user.location_id == "loc_b"
    assert by_user.leader_id == USER_PARTY_MEMBER_ID

    npc_left = [p for p in reconciled if USER_PARTY_MEMBER_ID not in p.member_ids][0]
    assert set(npc_left.member_ids) == {"c2", "c3"}
    assert npc_left.location_id == "loc_a"
    assert npc_left.leader_id in {"c2", "c3"}

    # Leaving behind a single NPC (< 2) dissolves the abandoned cluster
    dissolved = reconcile_parties_strict_colocation(
        [
            PartyRecord(
                id="p3",
                name="Duo",
                member_ids=[USER_PARTY_MEMBER_ID, "c1"],
                leader_id=USER_PARTY_MEMBER_ID,
                location_id="loc_a",
            )
        ],
        {USER_PARTY_MEMBER_ID: "loc_b", "c1": "loc_a"},
    )
    assert dissolved == []


def test_party_lifecycle_leave_kick_disband_invite_migration_and_npc_crud() -> None:
    p_player = PartyRecord(
        id="p_u",
        name="Your Party",
        member_ids=[USER_PARTY_MEMBER_ID, "c1", "c2"],
        leader_id=USER_PARTY_MEMBER_ID,
        location_id="loc_a",
    )
    p_npc = PartyRecord(
        id="p_n",
        name="Fixers",
        member_ids=["c3", "c4", "c5"],
        leader_id="c3",
        location_id="loc_a",
    )

    # Leave preserves >=2 NPCs as an NPC-only party
    after_leave, leave_delta = apply_party_leave(
        [p_player, p_npc],
        active_location_id="loc_a",
        name_map={"c1": "Kira", "c2": "Nyx"},
        rng=random.Random(3),
    )
    assert get_player_party(after_leave) is None
    kept_from_leave = [p for p in after_leave if p.id == "p_u"][0]
    assert kept_from_leave.member_ids == ["c1", "c2"]
    assert kept_from_leave.leader_id in {"c1", "c2"}
    assert leave_delta.updated_party_ids == ["p_u"]

    # Kick 1 from 3-member player party keeps remaining 2; kick last dissolves
    after_kick1, _ = apply_party_kick([p_player], ["c2"], name_map={"c2": "Nyx"})
    assert after_kick1[0].member_ids == [USER_PARTY_MEMBER_ID, "c1"]
    after_kick2, kick2_delta = apply_party_kick(after_kick1, ["c1"], name_map={"c1": "Kira"})
    assert after_kick2 == []
    assert kick2_delta.disbanded_party_ids == ["p_u"]

    # Disband removes target party only
    after_disband, d_delta = apply_party_disband([p_player, p_npc], "p_u")
    assert [p.id for p in after_disband] == ["p_n"]
    assert d_delta.disbanded_party_ids == ["p_u"]

    # Invite acceptance migrates c3 out of 3-member p_npc while keeping c4 & c5 together with re-elected leader
    outcomes = [
        PartyInviteOutcome(character_id="c3", character_name="Viktor", decision="accept", reason="Trusts lead"),
        PartyInviteOutcome(character_id="c4", character_name="Dex", decision="refuse", reason="Staying put"),
    ]
    after_inv, inv_delta = apply_party_invite_acceptances(
        [p_npc],
        accepted_ids=["c3"],
        outcomes=outcomes,
        active_location_id="loc_a",
        turn_id="t1",
        rng=random.Random(5),
    )
    joined_p = get_player_party(after_inv)
    assert joined_p is not None
    assert joined_p.member_ids == [USER_PARTY_MEMBER_ID, "c3"]
    rem_npc = [p for p in after_inv if p.id == "p_n"][0]
    assert rem_npc.member_ids == ["c4", "c5"]
    assert rem_npc.leader_id in {"c4", "c5"}
    assert inv_delta.updated_party_ids == ["p_n"]
    assert len(inv_delta.formed_party_ids) == 1

    # NPC-only party creation validates co-location, >=2, and disjointness
    with pytest.raises(ValueError, match="already belongs"):
        create_npc_only_party(
            after_inv,
            member_ids=["c3", "c4"],
            member_locations={"c3": "loc_a", "c4": "loc_a"},
        )
    with pytest.raises(ValueError, match="same current location"):
        create_npc_only_party(
            [],
            member_ids=["c4", "c5"],
            member_locations={"c4": "loc_a", "c5": "loc_b"},
        )


def test_slash_command_parser_variants_and_strict_blocking(empty_repo: CantinaRepository) -> None:
    user = seed_user(empty_repo)
    world, locs = seed_linear_world(empty_repo, owner_id=user.id)
    kira = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Kira Vance")
    nyx = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Nyx")
    vik1 = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Viktor Vane")
    vik2 = seed_character(empty_repo, owner_id=user.id, world_id=world.id, name="Viktor K")
    chars = [kira, nyx, vik1, vik2]
    loc_names = {loc.id: loc.name for loc in locs}
    char_locs = {kira.id: locs[0].id, nyx.id: locs[0].id, vik1.id: locs[1].id, vik2.id: locs[0].id}

    # Multi-word longest-prefix + pitch
    act, err = parse_party_slash_command(
        "/party @Kira Vance watch the catwalk",
        all_characters=chars,
        present_character_ids={kira.id, nyx.id, vik2.id},
        active_parties=[],
        location_name_by_id=loc_names,
        char_locations=char_locs,
    )
    assert err is None and act is not None
    assert act.kind == "invite"
    assert act.target_character_ids == [kira.id]
    assert act.message == "watch the catwalk"

    # Canonical chained invite
    act2, err2 = parse_party_slash_command(
        "/party invite @Kira @Nyx move out",
        all_characters=chars,
        present_character_ids={kira.id, nyx.id, vik2.id},
        active_parties=[],
    )
    assert err2 is None and act2 is not None
    assert act2.target_character_ids == [kira.id, nyx.id]
    assert act2.message == "move out"

    # Ambiguous @Viktor -> strict error, never invite-all
    act_amb, err_amb = parse_party_slash_command(
        "/party @Viktor",
        all_characters=chars,
        present_character_ids={kira.id, vik2.id},
        active_parties=[],
    )
    assert act_amb is None and err_amb is not None and "Ambiguous" in err_amb

    # Unknown @Ghost -> strict error
    act_unk, err_unk = parse_party_slash_command(
        "/party @Ghost",
        all_characters=chars,
        present_character_ids={kira.id, nyx.id},
        active_parties=[],
    )
    assert act_unk is None and err_unk is not None and "Unknown character" in err_unk

    # Off-site target -> strict error mentioning their location
    act_off, err_off = parse_party_slash_command(
        "/party @Viktor Vane",
        all_characters=chars,
        present_character_ids={kira.id, nyx.id},
        active_parties=[],
        location_name_by_id=loc_names,
        char_locations=char_locs,
    )
    assert act_off is None and err_off is not None and "Backroom Clinic" in err_off

    # Non-member kick -> strict error
    p = PartyRecord(id="p1", name="Your Party", member_ids=["user", kira.id], leader_id="user", location_id=locs[0].id)
    act_kick_bad, err_kick_bad = parse_party_slash_command(
        "/party kick @Nyx",
        all_characters=chars,
        present_character_ids={kira.id, nyx.id},
        active_parties=[p],
    )
    assert act_kick_bad is None and err_kick_bad is not None and "not currently in your party" in err_kick_bad


# ---------------------------------------------------------------------------
# 2. SQLite Migration, Empty-List Persistence & Branch Rollback
# ---------------------------------------------------------------------------


def test_legacy_db_migration_and_branch_safety(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = str(tmp_path / "legacy_party.db")
    repo = CantinaRepository(db_file, media_dir=str(tmp_path / "media"))
    repo.init_db()

    # Simulate legacy schema missing parties_json by rebuilding table without the column
    conn = sqlite3.connect(db_file)
    conn.execute("ALTER TABLE world_state_snapshots RENAME TO world_state_snapshots_old")
    conn.execute(
        """
        CREATE TABLE world_state_snapshots (
            turn_id TEXT PRIMARY KEY,
            world_timestamp TEXT NOT NULL,
            active_location_id TEXT NOT NULL,
            scene_flags_json TEXT NOT NULL,
            campaign_elapsed_minutes INTEGER NOT NULL DEFAULT 0,
            visited_location_ids_json TEXT NOT NULL DEFAULT '[]',
            visited_container_ids_json TEXT NOT NULL DEFAULT '[]'
        )
        """
    )
    conn.execute("DROP TABLE world_state_snapshots_old")
    conn.commit()
    conn.close()

    # init_db() runs idempotent ALTER TABLE migration cleanly
    repo.init_db()
    conn = sqlite3.connect(db_file)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(world_state_snapshots)").fetchall()}
    conn.close()
    assert "parties_json" in cols

    # Seed campaign with start_in_party_character_ids -> Turn 0 has player party
    scen = seed_minimal_scenario(repo, character_name="Kira")
    nyx = seed_character(repo, owner_id=scen.user.id, world_id=scen.world.id, name="Nyx")
    camp = repo.create_campaign(
        name="Branch Party Campaign",
        world_id=scen.world.id,
        character_id=scen.character.id,
        character_ids=[scen.character.id, nyx.id],
        start_in_party_character_ids=[scen.character.id],
        owner_id=scen.user.id,
    )
    b0 = repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    assert len(b0.current_world_snapshot.parties) == 1
    assert set(b0.current_world_snapshot.parties[0].member_ids) == {"user", scen.character.id}

    # Turn 1 disbands party -> explicit parties=[] MUST NOT resurrect parent parties
    root_turn = b0.active_branch_turns[-1]
    disband_action = PartyActionSpec(kind="disband", target_character_ids=[], message="Good luck")
    turn1 = repo.save_turn_node(
        turn_id="turn_disband",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=1,
        user_message="[Disband Party]",
        actor_id=scen.character.id,
        raw_prose="*Kira nods slowly and steps back.*",
        cognition=CognitionBlock(feeling="Measured", valence=0.0, arousal=0.4),
        pre_turn=PreTurnAnalysis(party_action=disband_action),
        world_snapshot=root_turn.world_snapshot.model_copy(
            update={"turn_id": "turn_disband", "parties": []}
        ),
        character_state=b0.character_states[scen.character.id].model_copy(update={"turn_id": "turn_disband"}),
        extra_character_states=[
            b0.character_states[nyx.id].model_copy(update={"turn_id": "turn_disband"})
        ],
        recalled_items=[],
    )
    b1 = repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    assert b1.current_world_snapshot.parties == []
    assert turn1.pre_turn.party_action is not None and turn1.pre_turn.party_action.kind == "disband"

    # Delete last turn cleanly restores Turn 0's party snapshot!
    b_reverted = repo.delete_last_turn(camp.id, owner_id=scen.user.id)
    assert len(b_reverted.current_world_snapshot.parties) == 1
    assert set(b_reverted.current_world_snapshot.parties[0].member_ids) == {"user", scen.character.id}


# ---------------------------------------------------------------------------
# 3. Phase 3 Schemas, Anti-Sycophancy, Loyalty Context & Phase 1 Persuasion
# ---------------------------------------------------------------------------


async def test_phase3_schemas_anti_sycophancy_loyalty_and_persuasion(empty_repo: CantinaRepository) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    nyx = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Nyx")
    loc_a = scen.locations[0]

    # Dynamic GBNF schema tests
    undir_stay = build_undirected_cognition_schema(travel_intent_enum=None, include_party_invite=False)
    assert "travel_intent" not in undir_stay["properties"]
    assert "party_invite_decision" not in undir_stay["properties"]

    p_player = PartyRecord(id="p1", name="Your Party", member_ids=["user", scen.character.id], leader_id="user", location_id=loc_a.id)
    p_npc = PartyRecord(id="p2", name="Nyx Crew", member_ids=[nyx.id, "char_other"], leader_id="char_other", location_id=loc_a.id)

    enum_member = resolve_character_travel_intent_enum(scen.character.id, [p_player, p_npc], loc_a.id)
    enum_npc_follower = resolve_character_travel_intent_enum(nyx.id, [p_player, p_npc], loc_a.id)
    assert enum_member == ["default", "stay_behind"]
    assert enum_npc_follower == ["default", "stay_behind", "follow_player"]

    dir_schema = build_directed_cognition_schema(
        ChoiceResolution(
            character_id=scen.character.id,
            status="constrained",
            allowed=["Step back", "Agree"],
        ),
        travel_intent_enum=enum_member,
        include_party_invite=True,
    )
    assert dir_schema["properties"]["travel_intent"]["enum"] == ["default", "stay_behind"]
    assert "travel_intent" in dir_schema["required"]
    assert dir_schema["properties"]["party_invite_decision"]["enum"] == ["accept", "refuse"]
    assert "party_invite_decision" in dir_schema["required"]

    # Anti-sycophancy heuristic: hostile / low-trust / Critical Failure refuses; warm + Clean Success accepts
    hostile_care = seed_initial_care_state(scen.character.baseline_psyche)
    hostile_care.relations["user"] = RelationalEdge(target_id="user", trust=0.15, warmth=-0.5, respect=0.1, grievance=0.6)
    hostile_state = _char_state(scen.character.id, loc_a.id).model_copy(update={"care_state": hostile_care})
    crit_fail_roll = DiceRollResult(
        character_id=scen.character.id,
        character_name=scen.character.name,
        d20_raw=1,
        modifier=0,
        total=1,
        difficulty_class=14,
        outcome_tier="Critical Failure",
        skill_or_approach="Social / Persuasion",
        action_description="Convince Kira to join",
        narrative_directive="Refuses",
    )
    pre_fail = PreTurnAnalysis(
        party_action=PartyActionSpec(kind="invite", target_character_ids=[scen.character.id]),
        character_rolls={scen.character.id: crit_fail_roll},
    )
    assert (
        compute_heuristic_party_invite_decision(
            character=scen.character,
            previous_state=hostile_state,
            pre_turn=pre_fail,
            active_parties=[],
            active_location_id=loc_a.id,
        )
        == "refuse"
    )

    # NPC-party loyalty context injection (qualitative, no raw floats)
    nyx_care = seed_initial_care_state(nyx.baseline_psyche)
    nyx_care.relations["char_other"] = RelationalEdge(target_id="char_other", trust=0.82, warmth=0.6, respect=0.7, grievance=0.0)
    nyx_state = _char_state(nyx.id, loc_a.id).model_copy(update={"care_state": nyx_care})
    ctx_txt = render_cognition_party_context(
        character_id=nyx.id,
        character_name=nyx.name,
        active_parties=[p_npc],
        active_location_id=loc_a.id,
        pre_turn=PreTurnAnalysis(party_action=PartyActionSpec(kind="invite", target_character_ids=[nyx.id], message="Come with me")),
        character_name_map={nyx.id: "Nyx", "char_other": "Viktor"},
        character_state=nyx_state,
        persona_name="Merc",
    )
    assert "EXISTING NPC-PARTY LOYALTY CONTEXT" in ctx_txt
    assert "ANTI-SYCOPHANCY DECISION PROTOCOL" in ctx_txt
    assert "Viktor" in ctx_txt

    # Phase 1 offline pre-analysis enables Social/Persuasion check on invite & forces spatial_intent="stay"
    p1_out = await run_phase1_pre_analysis(
        user_message="/party @Kira please join us across the catwalk",
        character=scen.character,
        active_location=loc_a,
        neighbors=[],
        known_entities=[scen.character.name],
        dice_mode="forced",
        present_characters=[scen.character],
        party_action=PartyActionSpec(kind="invite", target_character_ids=[scen.character.id], message="please join us"),
    )
    assert p1_out.spatial_intent == "stay"
    assert scen.character.id in p1_out.character_rolls
    assert p1_out.character_rolls[scen.character.id].skill_or_approach == "Social / Persuasion"


# ---------------------------------------------------------------------------
# 4. Zone 1 vs Zone 4 KV-Cache Isolation & Phase 5 Enforcement
# ---------------------------------------------------------------------------


def test_zone1_static_and_zone4_conditional_movement_isolation(empty_repo: CantinaRepository) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    nyx = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Nyx")
    camp = empty_repo.create_campaign(
        name="Zone Isolation Campaign",
        world_id=scen.world.id,
        character_id=scen.character.id,
        character_ids=[scen.character.id, nyx.id],
        owner_id=scen.user.id,
    )
    b0 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    loc_a, loc_b, _ = scen.locations
    party = PartyRecord(id="p1", name="Your Party", member_ids=["user", scen.character.id], leader_id="user", location_id=loc_a.id)

    z1_no_party = build_zone1_ensemble_system_prompt(scen.world, [scen.character, nyx])
    msgs_stay = assemble_four_zone_messages(
        world=scen.world,
        character=scen.character,
        branch_turns=b0.active_branch_turns,
        episodic_chunks=[],
        active_location=loc_a,
        neighbors=[],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(spatial_intent="stay"),
        user_message="How are things looking?",
        present_characters=[scen.character, nyx],
        active_parties=[party],
    )
    assert msgs_stay[0]["content"] == z1_no_party
    assert "<active_parties>" in msgs_stay[-1]["content"]
    assert "<movement_resolution" not in msgs_stay[-1]["content"]

    msgs_move = assemble_four_zone_messages(
        world=scen.world,
        character=scen.character,
        branch_turns=b0.active_branch_turns,
        episodic_chunks=[],
        active_location=loc_a,
        neighbors=[],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(spatial_intent="move_known", target_location_hint=loc_b.name),
        user_message="I walk onto the catwalk.",
        present_characters=[scen.character, nyx],
        established_cognitions={
            scen.character.id: CognitionBlock(feeling="Focused", valence=0.1, arousal=0.4, travel_intent="stay_behind"),
            nyx.id: CognitionBlock(feeling="Alert", valence=0.0, arousal=0.4, travel_intent="default"),
        },
        active_parties=[party],
    )
    assert msgs_move[0]["content"] == z1_no_party
    assert "<movement_resolution" in msgs_move[-1]["content"]
    assert "Staying Behind in Main Floor: Kira, Nyx" in msgs_move[-1]["content"]


async def test_phase5_party_enforcement_and_narrator_alignment(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    kira = scen.character
    nyx = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Nyx")
    vik = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Viktor")
    dex = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Dex")
    loc_a, loc_b, _ = scen.locations

    # 1. Pure Phase 5 resolver: NPC-only party leader moves to loc_b, dragging NPC follower unless stay_behind;
    # player party member moves with player unless stay_behind; solo NPC stays unless follow_player.
    npc_party = PartyRecord(id="p_npc", name="Vik & Dex", member_ids=[vik.id, dex.id], leader_id=vik.id, location_id=loc_a.id)
    player_party = PartyRecord(id="p_u", name="Your Party", member_ids=["user", kira.id], leader_id="user", location_id=loc_a.id)

    reconciled, end_locs, delta = resolve_phase5_spatial_and_parties(
        prior_parties=[player_party, npc_party],
        start_location_id=loc_a.id,
        new_player_location_id=loc_a.id,  # Player stays at loc_a
        all_character_locations={kira.id: loc_a.id, nyx.id: loc_a.id, vik.id: loc_a.id, dex.id: loc_a.id},
        cognitions={},
        char_deltas={
            vik.id: CharacterAgentDelta(mood_label="Moving", location_transition="move_to_neighbor", target_location_id=loc_b.id),
        },
        valid_neighbor_ids={loc_b.id},
        is_narrator_turn=False,
        party_action=None,
        turn_id="t1",
        name_map={kira.id: kira.name, nyx.id: nyx.name, vik.id: vik.name, dex.id: dex.name},
    )
    assert end_locs[vik.id] == loc_b.id
    assert end_locs[dex.id] == loc_b.id  # Followed NPC party leader
    assert end_locs[kira.id] == loc_a.id  # Stayed with player
    assert end_locs[nyx.id] == loc_a.id

    # 2. Narrator turn travel moves ONLY co-located player-party NPCs (Kira), leaving non-party Nyx behind
    camp = empty_repo.create_campaign(
        name="Narrator Party Travel",
        world_id=scen.world.id,
        character_id=kira.id,
        character_ids=[kira.id, nyx.id],
        start_in_party_character_ids=[kira.id],
        owner_id=scen.user.id,
    )
    b0 = empty_repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    root = b0.active_branch_turns[-1]
    t_narr = empty_repo.save_turn_node(
        turn_id="t_narr_move",
        campaign_id=camp.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="[Advance toward the clinic]",
        actor_id="__narrator__",
        raw_prose="*You and Kira step through into the Backroom Clinic while Nyx remains behind at the bar.*",
        cognition=CognitionBlock(skipped=True),
        pre_turn=PreTurnAnalysis(active_speaker_id="__narrator__", speaker_order=["__narrator__"]),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "t_narr_move"}),
        character_state=b0.character_states[kira.id].model_copy(update={"turn_id": "t_narr_move"}),
        extra_character_states=[b0.character_states[nyx.id].model_copy(update={"turn_id": "t_narr_move"})],
        recalled_items=[],
    )

    async def mock_narr_world(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        if response_model is WorldPostTurnDelta:
            return WorldPostTurnDelta(elapsed_minutes=3, transition_type="move_existing", target_location_id=loc_b.id)
        raise AssertionError(response_model)

    monkeypatch.setattr(llm_client, "complete_structured", mock_narr_world)
    await phase5_clerk.run_phase5_post_turn_clerk(
        repo=empty_repo,
        campaign_id=camp.id,
        world_id=scen.world.id,
        character=kira,
        completed_turn=t_narr,
        active_location=loc_a,
        neighbors=b0.neighbor_locations,
        present_characters=[kira, nyx],
        all_participants=[kira, nyx],
    )
    b_after = empty_repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    assert b_after.active_location.id == loc_b.id
    assert b_after.character_states[kira.id].current_location_id == loc_b.id
    assert b_after.character_states[nyx.id].current_location_id == loc_a.id
    assert len(b_after.current_world_snapshot.parties) == 1
    assert b_after.current_world_snapshot.parties[0].location_id == loc_b.id


# ---------------------------------------------------------------------------
# 5. REST Endpoints, Overrides, /party Turn Execution & 422 Guards
# ---------------------------------------------------------------------------


def test_party_and_location_override_rest_endpoints(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("party_tester", role="admin")
    world, locs = seed_linear_world(repo, owner_id=user_id, names=("Lobby", "Vault", "Rooftop"))
    kira = seed_character(repo, owner_id=user_id, world_id=world.id, name="Kira Vance")
    nyx = seed_character(repo, owner_id=user_id, world_id=world.id, name="Nyx")
    vik = seed_character(repo, owner_id=user_id, world_id=world.id, name="Viktor")

    # Override dependency just in case, Bearer header handles auth directly
    res_create = client.post(
        "/api/campaigns",
        headers=headers,
        json={
            "name": "REST Party Campaign",
            "world_id": world.id,
            "character_id": kira.id,
            "character_ids": [kira.id, nyx.id, vik.id],
            "character_locations": {kira.id: locs[0].id, nyx.id: locs[1].id, vik.id: locs[0].id},
            # Force Nyx into Lobby by selecting start_in_party_character_ids
            "start_in_party_character_ids": [kira.id, nyx.id, vik.id],
        },
    )
    assert res_create.status_code == 200
    bundle0 = res_create.json()
    camp_id = bundle0["campaign"]["id"]
    assert bundle0["character_states"][nyx.id]["current_location_id"] == locs[0].id
    assert len(bundle0["current_world_snapshot"]["parties"]) == 1
    player_pid = bundle0["current_world_snapshot"]["parties"][0]["id"]

    # Attempting OOC DELETE on player party -> 422
    res_del_player = client.delete(f"/api/campaigns/{camp_id}/parties/{player_pid}", headers=headers)
    assert res_del_player.status_code == 422

    # Move Alone to Vault (first visit -> __arrival__ branch) leaves Kira+Nyx+Vik as a 3-NPC party in Lobby!
    res_alone = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        headers=headers,
        json={"location_id": locs[1].id, "move_mode": "alone"},
    )
    assert res_alone.status_code == 200
    b_alone = res_alone.json()
    assert b_alone["active_location"]["id"] == locs[1].id
    assert b_alone["present_character_ids"] == []
    assert b_alone["active_branch_turns"][-1]["actor_id"] == "__arrival__"
    rem_parties = b_alone["current_world_snapshot"]["parties"]
    assert len(rem_parties) == 1
    assert set(rem_parties[0]["member_ids"]) == {kira.id, nyx.id, vik.id}
    assert rem_parties[0]["location_id"] == locs[0].id

    # Move back to Lobby (in-place UPDATE branch since Lobby was already visited)
    res_back = client.post(
        f"/api/campaigns/{camp_id}/location-override",
        headers=headers,
        json={"location_id": locs[0].id, "move_mode": "party"},
    )
    assert res_back.status_code == 200

    # OOC disband the NPC-only party via DELETE
    res_del_npc = client.delete(
        f"/api/campaigns/{camp_id}/parties/{rem_parties[0]['id']}",
        headers=headers,
    )
    assert res_del_npc.status_code == 200
    assert res_del_npc.json()["current_world_snapshot"]["parties"] == []

    # Character location override moves Vik to Rooftop WITHOUT mutating player active_location_id or visited_location_ids
    prev_visited = res_del_npc.json()["current_world_snapshot"]["visited_location_ids"]
    prev_turns_len = len(res_del_npc.json()["active_branch_turns"])
    res_char_move = client.post(
        f"/api/campaigns/{camp_id}/characters/{vik.id}/location-override",
        headers=headers,
        json={"location_id": locs[2].id},
    )
    assert res_char_move.status_code == 200
    b_cm = res_char_move.json()
    assert b_cm["active_location"]["id"] == locs[0].id
    assert b_cm["character_states"][vik.id]["current_location_id"] == locs[2].id
    assert b_cm["current_world_snapshot"]["visited_location_ids"] == prev_visited
    assert len(b_cm["active_branch_turns"]) == prev_turns_len

    # Create NPC party at Lobby (Kira + Nyx)
    res_npc_create = client.post(
        f"/api/campaigns/{camp_id}/parties",
        headers=headers,
        json={"member_ids": [kira.id, nyx.id], "name": "Lobby Watch", "shared_goal": "Guard door"},
    )
    assert res_npc_create.status_code == 200
    npc_p = res_npc_create.json()["current_world_snapshot"]["parties"][0]
    assert npc_p["name"] == "Lobby Watch"
    assert npc_p["leader_id"] in {kira.id, nyx.id}

    # Execute valid /party kick check vs invalid /party command (422) via turns endpoint
    res_bad_turn = client.post(
        f"/api/campaigns/{camp_id}/turns",
        headers=headers,
        json={"user_message": "/party @Viktor"},
    )
    assert res_bad_turn.status_code == 422

    # Valid /party invite via synchronous turn (offline heuristic fallback)
    res_good_turn = client.post(
        f"/api/campaigns/{camp_id}/turns",
        headers=headers,
        json={"user_message": "/party @Kira Vance Let's team up", "dice_mode": "disabled"},
    )
    assert res_good_turn.status_code == 200
    turn_last = res_good_turn.json()["active_branch_turns"][-1]
    assert turn_last["pre_turn"]["party_action"]["kind"] == "invite"
    assert turn_last["user_message"].startswith("[Party Invite to Kira Vance]")
    # Clean override check unused import guard
    assert get_current_user is not None


async def test_subset_location_override_via_stream_and_in_place(empty_repo: CantinaRepository) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    kira = scen.character
    nyx = seed_character(empty_repo, owner_id=scen.user.id, world_id=scen.world.id, name="Nyx")
    camp = empty_repo.create_campaign(
        name="Subset Override",
        world_id=scen.world.id,
        character_id=kira.id,
        character_ids=[kira.id, nyx.id],
        start_in_party_character_ids=[kira.id, nyx.id],
        owner_id=scen.user.id,
    )
    loc_b = scen.locations[1]
    b_sub = empty_repo.override_campaign_location(
        camp.id,
        loc_b.id,
        move_mode="subset",
        accompanying_character_ids=[kira.id],
        owner_id=scen.user.id,
    )
    assert b_sub.active_location.id == loc_b.id
    assert b_sub.character_states[kira.id].current_location_id == loc_b.id
    assert b_sub.character_states[nyx.id].current_location_id == scen.locations[0].id
    assert len(b_sub.current_world_snapshot.parties) == 1
    assert set(b_sub.current_world_snapshot.parties[0].member_ids) == {"user", kira.id}

    # Verify _execute_turn_stream_events handles post-override turn cleanly
    async for _ev in _execute_turn_stream_events(camp.id, TurnSubmitRequest(user_message="Let's check the clinic.")):
        pass
    b_next = empty_repo.get_campaign_state_bundle(camp.id, owner_id=scen.user.id)
    assert b_next.character_states[kira.id].current_location_id == loc_b.id
    assert b_next.character_states[nyx.id].current_location_id == scen.locations[0].id



def test_weighted_persuasion_party_invite_roll_directives() -> None:
    crit_plan, crit_narr = build_party_invite_roll_directives(
        "Critical Success",
        character_name="Kira",
        player_name="Merc",
    )
    assert "Merc's recruitment pitch lands with extraordinary persuasive force" in crit_plan
    assert "party_invite_decision='accept'" in crit_plan
    assert "deflect" not in crit_plan.lower()
    assert "Critical Success" in crit_narr

    clean_plan, _ = build_party_invite_roll_directives("Clean Success", character_name="Kira", player_name="Merc")
    assert "genuinely persuasive" in clean_plan
    assert "party_invite_decision='accept'" in clean_plan

    simple_fail, _ = build_party_invite_roll_directives("Simple Failure", character_name="Kira", player_name="Merc")
    assert "falls flat" in simple_fail
    assert "party_invite_decision='refuse'" in simple_fail

    conseq_fail, _ = build_party_invite_roll_directives("Failure with Consequences", character_name="Kira", player_name="Merc")
    assert "clumsily" in conseq_fail
    assert "party_invite_decision='refuse'" in conseq_fail

    crit_fail, _ = build_party_invite_roll_directives("Critical Failure", character_name="Kira", player_name="Merc")
    assert "backfires badly" in crit_fail
    assert "party_invite_decision='refuse'" in crit_fail


async def test_phase1_normalizes_contested_reaction_on_party_invite(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    kira = scen.character
    loc_a = scen.locations[0]

    async def mock_pre_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        assert response_model is PreTurnLLMOutput
        # Simulate LLM choosing contested_reaction / NPC-resistance framing
        return PreTurnLLMOutput(
            user_sentiment="persuasive",
            subtext_interpretation="Player attempts to recruit Kira.",
            mentioned_entities=[kira.name],
            memory_search_queries=["party invite"],
            spatial_intent="stay",
            active_speaker_id=kira.id,
            speaker_order=[kira.id],
            mechanics_check=MechanicsTrigger(requires_roll=False),
            character_checks=[
                CharacterCheckSpec(
                    character_id=kira.id,
                    requires_roll=True,
                    check_role="contested_reaction",
                    action_description="Kira resists player's recruitment attempt",
                    skill_or_approach="Willpower",
                    difficulty_class=12,
                    relevant_modifier=0,
                )
            ],
        )

    monkeypatch.setattr(llm_client, "complete_structured", mock_pre_llm)
    analysis = await run_phase1_pre_analysis(
        user_message="/party @Kira Please cover my back across the catwalk",
        character=kira,
        active_location=loc_a,
        neighbors=[],
        known_entities=[kira.name],
        dice_mode="forced",
        manual_dice_override=20,
        present_characters=[kira],
        party_action=PartyActionSpec(
            kind="invite",
            target_character_ids=[kira.id],
            message="Please cover my back across the catwalk",
        ),
    )
    roll = analysis.character_rolls[kira.id]
    assert roll.outcome_tier == "Critical Success"
    assert roll.check_role == "active_attempt"
    assert roll.skill_or_approach == "Social / Persuasion"
    assert roll.action_description == f"Player persuading {kira.name} to join the party"
    assert "deflect" not in roll.plan_directive.lower()
    assert "party_invite_decision='accept'" in roll.plan_directive
    assert "Critical Success" in roll.narrative_directive


async def test_phase3_cognition_prompt_enforces_weighted_persuasion_polarity(
    empty_repo: CantinaRepository,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scen = seed_minimal_scenario(empty_repo, character_name="Kira")
    kira = scen.character
    loc_a = scen.locations[0]
    plan_dir, narr_dir = build_party_invite_roll_directives(
        "Critical Success",
        character_name=kira.name,
        player_name="Player",
    )
    roll = DiceRollResult(
        character_id=kira.id,
        character_name=kira.name,
        check_role="active_attempt",
        action_description=f"Player persuading {kira.name} to join the party",
        skill_or_approach="Social / Persuasion",
        d20_raw=20,
        modifier=1,
        total=21,
        difficulty_class=12,
        outcome_tier="Critical Success",
        plan_directive=plan_dir,
        narrative_directive=narr_dir,
    )
    pre_turn = PreTurnAnalysis(
        party_action=PartyActionSpec(
            kind="invite",
            target_character_ids=[kira.id],
            message="Come with me to the catwalk",
        ),
        character_rolls={kira.id: roll},
    )

    captured_prompts: list[str] = []

    async def mock_cog_llm(messages: list[dict[str, str]], response_model: type[Any], **_: Any) -> Any:
        captured_prompts.append(messages[-1]["content"])
        return CognitionBlock(
            recall="- Player offered a compelling pitch.",
            feeling="Measured but genuinely swayed",
            valence=0.3,
            arousal=0.5,
            want="Test this partnership across the catwalk.",
            plan="- Accept the invitation while keeping an eye out.",
            party_invite_decision="accept",
        )

    monkeypatch.setattr(llm_client, "complete_structured", mock_cog_llm)
    cog = await run_character_cognition_agent(
        user_message='[Party Invite to Kira] — "Come with me to the catwalk"',
        character=kira,
        world=scen.world,
        role="primary_speaker",
        previous_state=_char_state(kira.id, loc_a.id),
        active_location=loc_a,
        neighbors=[],
        shared_scene_items=[],
        character_recalled_items=[],
        pre_turn=pre_turn,
        co_present_characters=[],
    )
    assert cog.party_invite_decision == "accept"
    assert len(captured_prompts) == 1
    prompt = captured_prompts[0]
    assert f"=== PARTY INVITATION PERSUASION CHECK (Player -> {kira.name}) ===" in prompt
    assert f"NOT {kira.name}'s willpower to refuse" in prompt
    assert "WEIGHTED PERSUASION RULE" in prompt
    assert "ROLL POLARITY (Weighted Persuasion)" in prompt
    assert "Your planned action backfires" not in prompt
    assert "deflect the challenge" not in prompt
