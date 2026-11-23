"""End-to-end backend tests for v0.33.0 GM-Assisted World Codex Authoring (Phase 1)."""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db.repository import CantinaRepository
from app.engine.gm_codex import (
    detect_explicit_codex_add_intent,
    draft_world_codex_proposal,
)
from app.prompts import ALL_PROMPT_KEYS, FACTORY_DEFAULT_PROMPTS, PROMPT_KEY_GM_CODEX_DRAFT
from app.routers import campaigns as campaigns_facade
from app.schemas.character import CognitionBlock
from app.schemas.gm import GmWorldLoreDraftLLMOutput
from app.schemas.turn import CampaignWorldSettings, PreTurnAnalysis
from app.schemas.world import (
    LocationLoreNodeDraft,
    LocationNodeDraft,
    WorldLoreNodeDraft,
)
from tests.factories import seed_character, seed_world


def _parse_sse_events(raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in raw_text.split("\n\n"):
        if not block.strip():
            continue
        ev_name = "message"
        data_str = ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                ev_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_str += line.split(":", 1)[1].strip()
        if data_str:
            events.append((ev_name, json.loads(data_str)))
    return events


def _seed_codex_campaign(repo: CantinaRepository, owner_id: str) -> dict[str, Any]:
    world = seed_world(
        repo,
        owner_id=owner_id,
        name="New Kowloon",
        locations=[
            LocationNodeDraft(
                key="chop",
                name="Chop-Cathedral",
                summary="Rain-slicked cyberclinic.",
                description="Fluorescent inspection arches stand near the bay doors.",
                environmental_tags=["cyberclinic"],
                is_starting_location=True,
                is_hub=True,
                lore_nodes=[
                    LocationLoreNodeDraft(
                        title="Hidden Override Key",
                        category="secret",
                        content="SECRET_OVERRIDE_TOKEN_999 lies under the altar.",
                        entity_tags=["override", "altar"],
                    )
                ],
            )
        ],
        edges=[],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Aegis Directorate",
                category="faction",
                content="Corporate compliance enforcers patrolling Sector 9.",
                entity_tags=["aegis", "sector 9", "compliance"],
            )
        ],
    )
    char = seed_character(
        repo,
        owner_id=owner_id,
        world_id=world.id,
        name="Kira Vance",
    )
    campaign = repo.create_campaign(
        name="Sector 9 Run",
        world_id=world.id,
        character_id=char.id,
        owner_id=owner_id,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    root = bundle.active_branch_turns[0]

    turn1 = repo.save_turn_node(
        turn_id="turn_codex_1",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Watch the compliance inspection arch.",
        actor_id=char.id,
        raw_prose="An Aegis mobile scanner arch rolled across the floor sweeping white-blue light.",
        cognition=CognitionBlock(
            recall="SECRET_COGNITION_LEAK_777",
            feeling="Tense",
            valence=-0.2,
            arousal=0.6,
            want="Conceal my subdermal shard",
            plan="Keep moving slowly.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="tense",
            subtext_interpretation="Observing inspection",
            mentioned_entities=["Aegis"],
            memory_search_queries=["aegis"],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_codex_1"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_codex_1"}),
        recalled_items=[],
    )

    turn1b = repo.save_turn_node(
        turn_id="turn_codex_1b",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Slip out the rear alley.",
        actor_id=char.id,
        raw_prose="You slip out before Aegis arrives.",
        cognition=CognitionBlock(
            recall="Safe exit.",
            feeling="Calm",
            valence=0.1,
            arousal=0.2,
            want="Leave quietly",
            plan="Head south.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="neutral",
            subtext_interpretation="Leaving",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_codex_1b"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_codex_1b"}),
        recalled_items=[],
    )

    repo.checkout_turn_branch(campaign.id, turn1.id, owner_id=owner_id)
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    return {
        "world": world,
        "char": char,
        "campaign": bundle.campaign,
        "bundle": bundle,
        "turn1": turn1,
        "turn1b": turn1b,
        "base_lore_id": bundle.world_lore_nodes[0].id,
    }


def test_codex_draft_prompt_and_output_sanitization() -> None:
    assert PROMPT_KEY_GM_CODEX_DRAFT in ALL_PROMPT_KEYS
    assert PROMPT_KEY_GM_CODEX_DRAFT in FACTORY_DEFAULT_PROMPTS

    parsed = GmWorldLoreDraftLLMOutput.model_validate(
        {
            "category": "enemy",
            "title": "<think>internal</think>Aegis Mobile Scanner Arch\nSources: Turns 12-14",
            "entity_tags": "aegis, scanner, Aegis, Age < 30",
            "content": (
                "<thought>drafting carefully</thought>\n"
                "A portable <i>inspection</i> arch mounted on a wheeled frame. Range < 15m.\n\n"
                "Sources: Turns 12–14; Episode Turns 1–6."
            ),
            "source_turns": [14, "12", 14, -1, "bad"],
        }
    )
    assert parsed.category == "threat"
    assert parsed.title == "Aegis Mobile Scanner Arch"
    assert parsed.content == "A portable *inspection* arch mounted on a wheeled frame. Range < 15m."
    assert parsed.entity_tags == ["aegis", "scanner", "Age < 30"]
    assert parsed.source_turns == [12, 14]


def test_detect_explicit_codex_add_intent() -> None:
    # Explicit commands & polite requests -> True
    assert detect_explicit_codex_add_intent("Add that to the codex") is True
    assert detect_explicit_codex_add_intent("Please save this to the world codex.") is True
    assert detect_explicit_codex_add_intent("Can you create a codex entry for the Aegis scanner?") is True
    assert detect_explicit_codex_add_intent("Put it in the codex") is True
    assert detect_explicit_codex_add_intent("Draft a codex entry for the scanner arch") is True

    # Exploratory questions & normal OOC queries -> False
    assert detect_explicit_codex_add_intent("What would be a reasonable entry to add to the codex?") is False
    assert detect_explicit_codex_add_intent("What was the aegis scanner?") is False
    assert detect_explicit_codex_add_intent("Should I add this to the codex?") is False
    assert detect_explicit_codex_add_intent("Tell me about the codex entries for Aegis") is False
    assert detect_explicit_codex_add_intent("Where is the Chop-Cathedral?") is False


@pytest.mark.asyncio
async def test_draft_world_codex_proposal_passes_required_props_and_hides_secrets(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("gm_codex_unit")
    seeded = _seed_codex_campaign(repo, user_id)
    cid = seeded["campaign"].id
    turn1_id = seeded["turn1"].id

    _, asst_msg = repo.append_gm_message_pair(
        campaign_id=cid,
        anchor_turn_id=turn1_id,
        user_content="What was the Aegis scanner?",
        user_mentions=[],
        assistant_content="It was a wheeled compliance arch sweeping white-blue light.",
        sources=[],
    )

    captured: dict[str, Any] = {}

    class SpyLLM:
        async def complete_structured(
            self,
            messages: list[dict[str, str]],
            schema_cls: Any,
            **kwargs: Any,
        ) -> GmWorldLoreDraftLLMOutput:
            captured["messages"] = messages
            captured["required_properties"] = kwargs.get("required_properties")
            return GmWorldLoreDraftLLMOutput.model_validate(
                {
                    "category": "artifact",
                    "title": "Aegis Mobile Scanner Arch",
                    "entity_tags": ["aegis", "scanner", "sector 9"],
                    "content": "A wheeled inspection arch deployed by Aegis Directorate officers.",
                    "source_turns": [1],
                }
            )

    from app.dependencies import resolve_effective_models, resolve_gm_profile

    eff = resolve_effective_models(user_id)
    gm_profile, _ = resolve_gm_profile(eff)

    proposal = await draft_world_codex_proposal(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        gm_profile=gm_profile,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
        target_message_id=asst_msg.id,
        llm_client_override=SpyLLM(),
    )

    assert set(captured["required_properties"]) == set(GmWorldLoreDraftLLMOutput.model_fields.keys())
    joined = "\n".join(m["content"] for m in captured["messages"])
    assert "SECRET_OVERRIDE_TOKEN_999" not in joined
    assert "SECRET_COGNITION_LEAK_777" not in joined
    assert proposal.status == "pending"
    assert proposal.draft.title == "Aegis Mobile Scanner Arch"
    assert proposal.source_turns == [1]
    assert len(proposal.duplicate_matches) == 1
    assert proposal.duplicate_matches[0].title == "Aegis Directorate"
    assert proposal.duplicate_matches[0].is_base_world is True


def test_gm_codex_proposal_end_to_end_branch_safe_and_permissions(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_codex_e2e")
    seeded = _seed_codex_campaign(repo, user_id)
    cid = seeded["campaign"].id
    turn1_id = seeded["turn1"].id
    turn1b_id = seeded["turn1b"].id
    base_lore_id = seeded["base_lore_id"]

    class FakeCodexLLM:
        async def stream_chat(self, *args: Any, **kwargs: Any) -> AsyncIterator[str]:
            yield "Here is a suggested Codex draft for the scanner."

        async def complete_structured(self, *args: Any, **kwargs: Any) -> GmWorldLoreDraftLLMOutput:
            return GmWorldLoreDraftLLMOutput.model_validate(
                {
                    "category": "artifact",
                    "title": "Aegis Mobile Scanner Arch",
                    "entity_tags": ["aegis", "scanner", "chop-cathedral"],
                    "content": (
                        "A wheeled compliance arch deployed in the Chop-Cathedral. "
                        "Its exact detection thresholds remain unconfirmed.\n\nSources: Turn 1."
                    ),
                    "source_turns": [1],
                }
            )

    monkeypatch.setattr(campaigns_facade, "llm_client", FakeCodexLLM())

    # 1. Exploratory question must NOT emit codex_proposal
    q_res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "What would be a reasonable entry to add to the codex?", "mentions": []},
    )
    assert q_res.status_code == 200
    q_events = _parse_sse_events(q_res.text)
    assert [ev for ev, _ in q_events if ev == "codex_proposal"] == []
    q_done = q_events[-1][1]
    asst_msg_id = q_done["assistant_message"]["id"]
    assert q_done["assistant_message"]["proposals"] == []

    # 2. Explicit "Draft Codex Entry" button endpoint attaches pending proposal & persists across GET
    draft_res = client.post(
        f"/api/campaigns/{cid}/gm/codex-draft",
        headers=headers,
        json={"message_id": asst_msg_id},
    )
    assert draft_res.status_code == 200
    draft_payload = draft_res.json()
    prop1 = draft_payload["proposal"]
    assert prop1["status"] == "pending"
    assert prop1["draft"]["category"] == "artifact"
    assert "Sources: Turn 1" not in prop1["draft"]["content"]
    assert prop1["source_turns"] == [1]

    # Verify DB & GET /gm/messages round-trip the pending proposal without mutating lore_nodes
    msgs_res = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert msgs_res.status_code == 200
    assert len(msgs_res.json()["messages"][1]["proposals"]) == 1
    assert len(repo.get_campaign_state_bundle(cid, owner_id=user_id).world_lore_nodes) == 1

    # 3. Confirming & saving NEW entry works even when unlock_lore=False, indexes vector_entries, and is branch-safe
    edited_draft = {
        "title": "Aegis Mobile Scanner Arch",
        "category": "threat",
        "content": "A portable inspection arch used by Aegis compliance teams; detection limits unconfirmed.",
        "entity_tags": ["aegis", "scanner", "compliance"],
    }
    save_res = client.post(
        f"/api/campaigns/{cid}/lore/entries",
        headers=headers,
        json={
            "draft": edited_draft,
            "proposal_message_id": asst_msg_id,
            "proposal_id": prop1["id"],
        },
    )
    assert save_res.status_code == 200
    save_data = save_res.json()
    saved_lore_id = save_data["saved_lore_id"]
    assert saved_lore_id
    assert save_data["proposal"]["status"] == "confirmed"
    assert save_data["proposal"]["saved_lore_id"] == saved_lore_id
    assert len(save_data["bundle"]["world_lore_nodes"]) == 2

    # Verify vector_entries row created for the new campaign Codex entry
    conn = sqlite3.connect(repo.db_path)
    conn.row_factory = sqlite3.Row
    vec_row = conn.execute(
        "SELECT id, campaign_id, source_type, title FROM vector_entries WHERE id = ?",
        (saved_lore_id,),
    ).fetchone()
    conn.close()
    assert vec_row is not None
    assert vec_row["campaign_id"] == cid
    assert vec_row["source_type"] == "lore"
    assert vec_row["title"] == "Aegis Mobile Scanner Arch"

    # Branch isolation: sibling branch turn1b does NOT see the Turn 1 Codex addition
    repo.checkout_turn_branch(cid, turn1b_id, owner_id=user_id)
    sibling_bundle = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    assert [ln.title for ln in sibling_bundle.world_lore_nodes] == ["Aegis Directorate"]
    repo.checkout_turn_branch(cid, turn1_id, owner_id=user_id)

    # 4. Updating that campaign-authored entry on a LATER turn still succeeds with unlock_lore=False
    turn2 = repo.save_turn_node(
        turn_id="turn_codex_2",
        campaign_id=cid,
        parent_turn_id=turn1_id,
        depth_index=2,
        user_message="Test the scanner with an iron shim.",
        actor_id=seeded["char"].id,
        raw_prose="The scanner chirps immediately at ferrous alloys.",
        cognition=CognitionBlock(
            recall="Confirmed ferrous trigger.",
            feeling="Alert",
            valence=0.0,
            arousal=0.5,
            want="Avoid detection",
            plan="Step back.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="curious",
            subtext_interpretation="Testing scanner",
            mentioned_entities=["Aegis"],
            memory_search_queries=["scanner"],
            spatial_intent="stay",
        ),
        world_snapshot=seeded["turn1"].world_snapshot.model_copy(update={"turn_id": "turn_codex_2"}),
        character_state=seeded["turn1"].character_state.model_copy(update={"turn_id": "turn_codex_2"}),
        recalled_items=[],
    )
    repo.checkout_turn_branch(cid, turn2.id, owner_id=user_id)

    update_camp_res = client.post(
        f"/api/campaigns/{cid}/lore/entries",
        headers=headers,
        json={
            "draft": {
                **edited_draft,
                "content": "A portable inspection arch that detects ferrous alloys immediately.",
            },
            "replace_lore_id": saved_lore_id,
        },
    )
    assert update_camp_res.status_code == 200
    updated_campaign_lore_id = update_camp_res.json()["saved_lore_id"]
    assert updated_campaign_lore_id != saved_lore_id  # CoW row on turn2

    # Even a SECOND update on turn3 against the CoW-replaced campaign entry works with unlock_lore=False
    turn3 = repo.save_turn_node(
        turn_id="turn_codex_3",
        campaign_id=cid,
        parent_turn_id=turn2.id,
        depth_index=3,
        user_message="Note its power cable.",
        actor_id=seeded["char"].id,
        raw_prose="It draws power from a floor conduit.",
        cognition=CognitionBlock(
            recall="Power cable noted.",
            feeling="Focused",
            valence=0.0,
            arousal=0.3,
            want="Escape",
            plan="Cut power later.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="observant",
            subtext_interpretation="Inspecting cable",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=turn2.world_snapshot.model_copy(update={"turn_id": "turn_codex_3"}),
        character_state=turn2.character_state.model_copy(update={"turn_id": "turn_codex_3"}),
        recalled_items=[],
    )
    repo.checkout_turn_branch(cid, turn3.id, owner_id=user_id)
    update_camp_res2 = client.post(
        f"/api/campaigns/{cid}/lore/entries",
        headers=headers,
        json={
            "draft": {
                **edited_draft,
                "content": "A portable inspection arch tethered to floor conduits; detects ferrous alloys.",
            },
            "replace_lore_id": updated_campaign_lore_id,
        },
    )
    assert update_camp_res2.status_code == 200

    # 5. Overwriting a BASE-WORLD authored entry requires unlock_lore=True
    deny_base = client.post(
        f"/api/campaigns/{cid}/lore/entries",
        headers=headers,
        json={
            "draft": {
                "title": "Aegis Directorate",
                "category": "faction",
                "content": "Attempted player overwrite.",
                "entity_tags": ["aegis"],
            },
            "replace_lore_id": base_lore_id,
        },
    )
    assert deny_base.status_code == 403

    repo.update_campaign_world_settings(
        cid, CampaignWorldSettings(unlock_lore=True), owner_id=user_id
    )
    allow_base = client.post(
        f"/api/campaigns/{cid}/lore/entries",
        headers=headers,
        json={
            "draft": {
                "title": "Aegis Directorate",
                "category": "faction",
                "content": "GM-updated Aegis Directorate dossier.",
                "entity_tags": ["aegis", "compliance"],
            },
            "replace_lore_id": base_lore_id,
        },
    )
    assert allow_base.status_code == 200

    # 6. Explicit conversational add request emits `codex_proposal` SSE and can be cancelled cleanly
    add_res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Add that to the codex", "mentions": []},
    )
    assert add_res.status_code == 200
    add_events = _parse_sse_events(add_res.text)
    ev_names = [ev for ev, _ in add_events]
    assert "codex_proposal" in ev_names
    assert ev_names.index("codex_proposal") < ev_names.index("done")
    prop2 = next(payload["proposal"] for ev, payload in add_events if ev == "codex_proposal")
    assert prop2["status"] == "pending"

    cancel_res = client.patch(
        f"/api/campaigns/{cid}/gm/proposals/{prop2['id']}",
        headers=headers,
        json={"status": "cancelled"},
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["proposal"]["status"] == "cancelled"

    # 7. .zcc v2 export/import with include_gm_chat=True preserves proposals_json cleanly
    exp_res = client.post(
        f"/api/export/campaign/{cid}",
        headers=headers,
        json={"timeline_scope": "full", "include_gm_chat": True},
    )
    assert exp_res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp_res.content), "r") as zf:
        camps = json.loads(zf.read("campaigns.json"))
        gm_rows = camps[0]["gm_chat_messages"]
        assert any(json.loads(r.get("proposals_json") or "[]") for r in gm_rows)

    inspect_res = client.post(
        "/api/import/inspect",
        headers=headers,
        files={"file": ("codex_camp.zcc", exp_res.content, "application/octet-stream")},
    )
    assert inspect_res.status_code == 200
    commit_res = client.post(
        "/api/import/commit",
        headers=headers,
        json={"staged_token": inspect_res.json()["staged_token"], "conflict_strategy": "copy"},
    )
    assert commit_res.status_code == 200

    imported_camp = next(c for c in repo.list_campaigns(owner_id=user_id) if c.id != cid)
    imp_bundle = repo.get_campaign_state_bundle(imported_camp.id, owner_id=user_id)
    imp_turns = {t.id for t in imp_bundle.active_branch_turns}
    imp_gm = repo.list_gm_messages_for_branch(imported_camp.id, imp_turns)
    confirmed_props = [p for m in imp_gm for p in m.proposals if p.status == "confirmed"]
    cancelled_props = [p for m in imp_gm for p in m.proposals if p.status == "cancelled"]
    assert len(confirmed_props) == 1
    assert len(cancelled_props) == 1
    assert confirmed_props[0].saved_lore_id != saved_lore_id
    # The Turn-1 lore ID was remapped and is present when viewing Turn 1 on the imported campaign
    imp_turn1 = next(t for t in imp_bundle.active_branch_turns if t.depth_index == 1)
    repo.checkout_turn_branch(imported_camp.id, imp_turn1.id, owner_id=user_id)
    imp_t1_bundle = repo.get_campaign_state_bundle(imported_camp.id, owner_id=user_id)
    assert any(ln.id == confirmed_props[0].saved_lore_id for ln in imp_t1_bundle.world_lore_nodes)


def test_gm_codex_draft_error_sanitization(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_codex_err")
    seeded = _seed_codex_campaign(repo, user_id)
    cid = seeded["campaign"].id
    _, asst = repo.append_gm_message_pair(
        campaign_id=cid,
        anchor_turn_id=seeded["turn1"].id,
        user_content="What happened?",
        user_mentions=[],
        assistant_content="An inspection arch appeared.",
        sources=[],
    )

    monkeypatch.setattr(settings, "allow_offline_fallback", False)

    class BrokenLLM:
        async def complete_structured(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("INTERNAL_STACK_SECRET_42")

    monkeypatch.setattr(campaigns_facade, "llm_client", BrokenLLM())
    res = client.post(
        f"/api/campaigns/{cid}/gm/codex-draft",
        headers=headers,
        json={"message_id": asst.id},
    )
    assert res.status_code == 502
    assert "INTERNAL_STACK_SECRET_42" not in res.text
