"""End-to-end tests for v0.44.0 Neuromancer Game Mechanics Access (`@mechanics` + `lookup_game_rules`)."""

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

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.engine.game_mechanics import (
    CARRYOVER_MATCH_MIN_SCORE,
    UMBRELLA_MECHANIC_ID,
    has_inline_mechanics_trigger,
    load_mechanics_catalog,
    search_mechanics_articles,
)
from app.engine.gm_talk import (
    apply_non_tool_mechanics_fallback,
    build_gm_context_and_messages,
    search_gm_mentions,
)
from app.engine.gm_tools import (
    GM_MECHANICS_TOOL_DEFINITION,
    GM_TOOL_DEFINITIONS,
    describe_gm_tool_status,
    execute_gm_tool,
    run_gm_tool_loop,
)
from app.engine.llm_client import ToolsUnsupportedError
from app.prompts import FACTORY_DEFAULT_PROMPTS
from app.routers import campaigns as campaigns_facade
from app.schemas.character import CognitionBlock
from app.schemas.gm import GmMentionRef, GmSourceRef
from app.schemas.llm_tools import LlmToolCall, LlmToolCompletionResult
from app.schemas.persona import PersonaCreatePayload
from app.schemas.turn import PreTurnAnalysis
from app.schemas.world import LocationNodeDraft, WorldLoreNodeDraft
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


def _seed_mechanics_campaign(repo: CantinaRepository, owner_id: str) -> dict[str, Any]:
    world = seed_world(
        repo,
        owner_id=owner_id,
        name="Kowloon Orbit",
        locations=[
            LocationNodeDraft(
                key="bar",
                name="Docking Cantina",
                summary="Orbital transit bar.",
                description="Neon tubes buzz above steel tables.",
                environmental_tags=["orbital"],
                is_starting_location=True,
                is_hub=True,
            ),
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Orbital Dock Curfew",
                category="culture",
                content="No unlogged thrusters after midnight.",
                entity_tags=["curfew", "dock"],
            )
        ],
    )
    persona = repo.create_persona(
        PersonaCreatePayload(
            name="Deckard Zero",
            tagline="Courier",
            persona_bio="Orbital runner.",
            tags=["runner"],
        ),
        owner_id=owner_id,
    )
    char = seed_character(
        repo,
        owner_id=owner_id,
        world_id=world.id,
        name="Kira Voss",
    )
    campaign = repo.create_campaign(
        name="Mechanics Test Run",
        world_id=world.id,
        character_id=char.id,
        persona_id=persona.id,
        owner_id=owner_id,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    root = bundle.active_branch_turns[0]
    turn1 = repo.save_turn_node(
        turn_id="turn_mech_1",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Greet Kira at the counter.",
        actor_id=char.id,
        raw_prose='*Kira glances up from her mug.* "You made the shuttle."',
        cognition=CognitionBlock(
            recall="Deckard arrived on time.",
            feeling="Measured relief",
            valence=0.1,
            arousal=0.3,
            want="Confirm payload",
            plan="Keep things brief.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="neutral",
            subtext_interpretation="Opening check-in",
            mentioned_entities=["Kira"],
            memory_search_queries=["shuttle"],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_mech_1"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_mech_1"}),
        recalled_items=[],
    )
    return {"world": world, "char": char, "campaign": campaign, "turn1": turn1}


def test_mechanics_catalog_integrity_and_zero_db_contamination(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("mech_catalog_user")
    seeded = _seed_mechanics_campaign(repo, user_id)

    catalog = load_mechanics_catalog()
    assert len(catalog.subcategories) == 7
    assert len(catalog.articles) == 24
    article_ids = {a.id for a in catalog.articles}
    subcat_ids = {s.id for s in catalog.subcategories}

    for art in catalog.articles:
        assert art.title.strip()
        assert art.in_one_line.strip()
        assert art.subcategory_id in subcat_ids
        for rel_id in art.related_topic_ids:
            assert rel_id in article_ids

    # Verify mechanics never live in SQLite lore_nodes or vector_entries
    conn = sqlite3.connect(repo.db_path)
    try:
        lore_rows = conn.execute("SELECT id, title FROM lore_nodes").fetchall()
        vec_rows = conn.execute("SELECT id, title FROM vector_entries").fetchall()
    finally:
        conn.close()
    assert all(row[0] not in article_ids for row in lore_rows)
    assert all(row[0] not in article_ids for row in vec_rows)
    assert seeded["world"].id


def test_inline_mechanics_trigger_and_deterministic_scorer() -> None:
    # Matches standalone @mechanic / @mechanics
    assert has_inline_mechanics_trigger("@mechanics how does composure work?") is True
    assert has_inline_mechanics_trigger("@mechanic explain d20") is True
    assert has_inline_mechanics_trigger("/gm @MECHANICS explain /choice") is True
    assert has_inline_mechanics_trigger("Check (@mechanics) for travel time.") is True

    # Rejects emails, mid-word tokens, and compound words
    assert has_inline_mechanics_trigger("Email user@mechanics.com today.") is False
    assert has_inline_mechanics_trigger("Inspect biomechanics implant.") is False
    assert has_inline_mechanics_trigger("Ask @mechanical armory.") is False
    assert has_inline_mechanics_trigger("Where is Kira right now?") is False

    # Precision ranking across key mechanics queries
    assert search_mechanics_articles("composure", limit=2)[0][1].id == "care-mood-composure"
    comp_half = {a.id for _, a in search_mechanics_articles("composure half-life", limit=2)}
    assert comp_half == {"care-overview", "care-mood-composure"}
    assert search_mechanics_articles("d20 critical failure", limit=2)[0][1].id == "dice-outcome-tiers"
    assert search_mechanics_articles("/choice gates", limit=2)[0][1].id == "dice-director-choices"
    assert search_mechanics_articles("travel speed modifier", limit=2)[0][1].id == "spatial-links-travel"
    assert search_mechanics_articles("context health 4-zone", limit=2)[0][1].id == "memory-context-health"
    assert search_mechanics_articles("trust warmth bond", limit=2)[0][1].id == "care-dyadic-bonds"

    # Pure campaign queries stay well below sticky carryover threshold
    assert (
        search_mechanics_articles(
            "Where is Kira right now?",
            limit=2,
            min_score=CARRYOVER_MATCH_MIN_SCORE,
        )
        == []
    )


def test_gm_mentions_scoping_and_api_limit(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("mech_mentions_user")
    seeded = _seed_mechanics_campaign(repo, user_id)
    cid = seeded["campaign"].id

    # 1. `@mechanics:` category lists umbrella + all 24 articles when limit=30
    cat_res = client.get(
        f"/api/campaigns/{cid}/gm/mentions",
        headers=headers,
        params={"category": "mechanics", "limit": 30},
    )
    assert cat_res.status_code == 200
    items = cat_res.json()["items"]
    assert len(items) == 25
    assert items[0]["kind"] == "mechanic"
    assert items[0]["id"] == UMBRELLA_MECHANIC_ID
    assert items[0]["label"] == "Mechanics"
    assert items[0]["badge"] == "All Rules"

    # 2. Filtering within `@mechanics:` ranks exact match first
    comp_items = search_gm_mentions(
        repo,
        cid,
        user_id,
        category="mechanics",
        q="composure",
        limit=10,
    )
    assert any(it.id == "care-mood-composure" for it in comp_items)
    assert comp_items[0].id == "care-mood-composure"

    # 3. Bare `@<query>` search excludes mechanics articles for campaign words
    for campaign_q in ("party", "trust", "map", "memory"):
        bare = search_gm_mentions(repo, cid, user_id, category=None, q=campaign_q, limit=25)
        assert all(it.kind != "mechanic" for it in bare)

    # 4. Bare `@mech` / `@mechanics` surfaces ONLY the umbrella candidate
    for prefix_q in ("mech", "mechanics"):
        pref = search_gm_mentions(repo, cid, user_id, category=None, q=prefix_q, limit=25)
        mech_items = [it for it in pref if it.kind == "mechanic"]
        assert len(mech_items) == 1
        assert mech_items[0].id == UMBRELLA_MECHANIC_ID


@pytest.mark.asyncio
async def test_strict_gating_pinning_and_non_tool_matching(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("mech_context_user")
    seeded = _seed_mechanics_campaign(repo, user_id)
    cid = seeded["campaign"].id

    # 1. Normal campaign message -> mechanics off, no <game_mechanics> block
    prep_normal = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="What did Kira just say?",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=False,
    )
    assert prep_normal.mechanics_active is False
    assert "<game_mechanics>" not in prep_normal.messages[0]["content"]
    assert all(s.kind != "mechanic" for s in prep_normal.all_sources)

    # 2. Specific `@mechanics:<article>` pin -> injected into <game_mechanics> (NOT <referenced_entities>)
    prep_pin = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="Explain @Mood & Composure (PAD) please.",
        mentions=[GmMentionRef(kind="mechanic", id="care-mood-composure", label="Mood & Composure (PAD)")],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=True,
    )
    assert prep_pin.mechanics_active is True
    assert prep_pin.mechanics_explicit is True
    assert prep_pin.mechanics_needs_non_tool_fallback is False
    sys_pin = prep_pin.messages[0]["content"]
    assert "<game_mechanics>" in sys_pin
    assert "Mood & Composure" in sys_pin
    assert "<referenced_entities>\n" not in sys_pin
    assert [s.id for s in prep_pin.pinned_sources] == ["care-mood-composure"]

    # 3. Bare `@mechanics` with tools OFF -> deterministic top 1-2 articles injected
    prep_non_tool = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="@mechanics how does composure half-life work?",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=False,
    )
    assert prep_non_tool.mechanics_active is True
    assert "<game_mechanics>" in prep_non_tool.messages[0]["content"]
    mech_srcs = [s for s in prep_non_tool.retrieved_sources if s.kind == "mechanic"]
    assert {s.id for s in mech_srcs} == {"care-overview", "care-mood-composure"}

    # 4. Generic bare `@mechanics` with no specific keyword -> compact directory fallback
    prep_dir = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="@mechanics",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=False,
    )
    assert prep_dir.mechanics_active is True
    assert "CyberCantina Game Mechanics Directory" in prep_dir.messages[0]["content"]

    # 5. Bare `@mechanics` with tools ON -> tool-first (not pre-injected until fallback needed)
    prep_tools = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="@mechanics explain d20 critical failure",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=True,
    )
    assert prep_tools.mechanics_active is True
    assert prep_tools.mechanics_needs_non_tool_fallback is True
    assert "<game_mechanics>" not in prep_tools.messages[0]["content"]

    added = apply_non_tool_mechanics_fallback(prep_tools, "@mechanics explain d20 critical failure")
    assert added
    assert added[0].id == "dice-outcome-tiers"
    assert "<game_mechanics>" in prep_tools.messages[0]["content"]
    assert prep_tools.mechanics_needs_non_tool_fallback is False


@pytest.mark.asyncio
async def test_lookup_game_rules_tool_single_round_and_disambiguation(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("mech_tool_unit")
    seeded = _seed_mechanics_campaign(repo, user_id)
    cid = seeded["campaign"].id

    assert "codex" not in GM_MECHANICS_TOOL_DEFINITION.name.lower()
    assert "codex" not in GM_MECHANICS_TOOL_DEFINITION.description.lower()
    assert describe_gm_tool_status("lookup_game_rules", {"query": "composure"}) == "Checking CyberCantina game rules…"

    bundle = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    from app.engine.gm_talk import _compute_branch_visibility

    vis = _compute_branch_visibility(bundle)
    base_ids = repo.get_base_world_lore_ids(bundle.campaign.world_id)
    out, sources, prop = await execute_gm_tool(
        repo,
        bundle=bundle,
        vis=vis,
        base_world_ids=base_ids,
        call=LlmToolCall(id="call_rules", name="lookup_game_rules", arguments={"query": "composure half-life"}),
        emitted_proposals=[],
    )
    assert prop is None
    assert len(out["articles"]) == 2
    by_id = {art["id"]: art for art in out["articles"]}
    assert set(by_id.keys()) == {"care-overview", "care-mood-composure"}
    assert by_id["care-mood-composure"]["under_the_hood"] is not None
    assert any("35%" in item["value"] for item in by_id["care-mood-composure"]["under_the_hood"]["items"])
    assert any("240 minutes" in item["value"] for item in by_id["care-overview"]["under_the_hood"]["items"])
    assert any(s.kind == "mechanic" and s.id == "care-mood-composure" for s in sources)

    # Verify tool loop omits lookup_game_rules on normal campaign turns, and includes it when active
    prep_off = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="Who is Kira?",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=True,
    )
    seen_tools_off: list[list[str]] = []

    class CaptureToolsLLM:
        def __init__(self, sink: list[list[str]]) -> None:
            self.sink = sink

        async def complete_with_tools(self, messages: Any, tools: Any, **kwargs: Any) -> LlmToolCompletionResult:
            self.sink.append([t.name for t in tools])
            return LlmToolCompletionResult(content="Kira is waiting at the counter.")

    events_off = [
        ev
        async for ev in run_gm_tool_loop(
            repo,
            bundle=bundle,
            prep=prep_off,
            gm_profile=ModelProfile(model="test-model"),
            llm_client_override=CaptureToolsLLM(seen_tools_off),
        )
    ]
    assert seen_tools_off[0] == [t.name for t in GM_TOOL_DEFINITIONS]
    assert "lookup_game_rules" not in seen_tools_off[0]
    assert any(k == "final_text" for k, _ in events_off)

    prep_on = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="@mechanics explain composure",
        mentions=[],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=FACTORY_DEFAULT_PROMPTS,
        gm_tools_enabled=True,
    )
    seen_tools_on: list[list[str]] = []
    events_on = [
        ev
        async for ev in run_gm_tool_loop(
            repo,
            bundle=bundle,
            prep=prep_on,
            gm_profile=ModelProfile(model="test-model"),
            llm_client_override=CaptureToolsLLM(seen_tools_on),
        )
    ]
    assert "lookup_game_rules" in seen_tools_on[0]
    assert any(k == "final_text" for k, _ in events_on)


def test_sse_tool_mode_unsupported_fallback_and_sticky_carryover(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)
    headers, user_id, _ = api_user_factory("mech_sse_user")
    seeded = _seed_mechanics_campaign(repo, user_id)
    cid = seeded["campaign"].id

    # 1. Tools ON + `@mechanics` -> executes `lookup_game_rules`, emits tool_status & mechanic source
    client.put("/api/profile/models", headers=headers, json={"gm_tools_enabled": True}).raise_for_status()

    class RulesToolLLM:
        def __init__(self) -> None:
            self.calls = 0
            self.observed_tools_by_call: list[list[str]] = []

        async def complete_with_tools(self, messages: Any, tools: Any, **kwargs: Any) -> LlmToolCompletionResult:
            self.calls += 1
            self.observed_tools_by_call.append([t.name for t in tools])
            if self.calls == 1:
                return LlmToolCompletionResult(
                    content="",
                    tool_calls=[
                        LlmToolCall(
                            id="call_1",
                            name="lookup_game_rules",
                            arguments={"query": "composure"},
                        )
                    ],
                )
            return LlmToolCompletionResult(
                content="Composure dampens PAD swings until dropping below 35%."
            )

    llm1 = RulesToolLLM()
    monkeypatch.setattr(campaigns_facade, "llm_client", llm1)
    r1 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "@mechanics How does composure work?", "mentions": []},
    )
    assert r1.status_code == 200
    ev1 = _parse_sse_events(r1.text)
    assert "lookup_game_rules" in llm1.observed_tools_by_call[0]
    statuses = [p for k, p in ev1 if k == "tool_status"]
    assert any(s["label"] == "Checking CyberCantina game rules…" for s in statuses)
    done1 = ev1[-1][1]
    assert any(s["kind"] == "mechanic" and s["id"] == "care-mood-composure" for s in done1["assistant_message"]["sources"])

    # 2. Sticky 1-turn carryover in tool mode: next turn has NO `@mechanics`, still exposes `lookup_game_rules`
    #    LLM answers campaign question without calling `lookup_game_rules` -> carryover expires after Turn 2!
    class CampaignPivotLLM:
        def __init__(self) -> None:
            self.observed_tools: list[str] = []

        async def complete_with_tools(self, messages: Any, tools: Any, **kwargs: Any) -> LlmToolCompletionResult:
            self.observed_tools = [t.name for t in tools]
            return LlmToolCompletionResult(content="Kira is right here at the Docking Cantina.")

    llm2 = CampaignPivotLLM()
    monkeypatch.setattr(campaigns_facade, "llm_client", llm2)
    r2 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Wait—where is Kira right now?", "mentions": []},
    )
    assert r2.status_code == 200
    ev2 = _parse_sse_events(r2.text)
    assert "lookup_game_rules" in llm2.observed_tools
    done2 = ev2[-1][1]
    assert all(s["kind"] != "mechanic" for s in done2["assistant_message"]["sources"])

    # Turn 3 (after Turn 2 cited NO mechanic sources): `lookup_game_rules` must be OFF again
    llm3 = CampaignPivotLLM()
    monkeypatch.setattr(campaigns_facade, "llm_client", llm3)
    r3 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "What did she say about the shuttle?", "mentions": []},
    )
    assert r3.status_code == 200
    assert "lookup_game_rules" not in llm3.observed_tools

    # 3. Round-0 ToolsUnsupportedError with `@mechanics` -> deterministic `<game_mechanics>` fallback + source
    seen_fallback_system: list[str] = []

    class UnsupportedWithStreamLLM:
        async def complete_with_tools(self, *args: Any, **kwargs: Any) -> LlmToolCompletionResult:
            raise ToolsUnsupportedError("no native tools")

        async def stream_chat(self, messages: list[dict[str, str]], **kwargs: Any) -> AsyncIterator[str]:
            seen_fallback_system.append(messages[0]["content"])
            yield "Travel minutes equal distance divided by walking speed times speed modifier."

    monkeypatch.setattr(campaigns_facade, "llm_client", UnsupportedWithStreamLLM())
    r4 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "@mechanics explain travel speed modifier", "mentions": []},
    )
    assert r4.status_code == 200
    ev4 = _parse_sse_events(r4.text)
    assert any(k == "notice" for k, _ in ev4)
    assert "<game_mechanics>" in seen_fallback_system[0]
    assert "Links, Travel Time" in seen_fallback_system[0]
    done4 = ev4[-1][1]
    assert any(s["kind"] == "mechanic" and s["id"] == "spatial-links-travel" for s in done4["assistant_message"]["sources"])

    # 4. Non-tool carryover + campaign pivot expiration
    client.put("/api/profile/models", headers=headers, json={"gm_tools_enabled": False}).raise_for_status()
    seen_nontool_prompts: list[str] = []

    class PlainStreamLLM:
        async def stream_chat(self, messages: list[dict[str, str]], **kwargs: Any) -> AsyncIterator[str]:
            seen_nontool_prompts.append(messages[0]["content"])
            yield "Here is the answer."

    monkeypatch.setattr(campaigns_facade, "llm_client", PlainStreamLLM())
    # Previous reply (r4) cited `spatial-links-travel`, so Turn 5 gets 1-turn carryover for strong match `"trust"`
    r5 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "And how does trust work?", "mentions": []},
    )
    assert r5.status_code == 200
    ev5 = _parse_sse_events(r5.text)
    assert "<game_mechanics>" in seen_nontool_prompts[-1]
    assert any(s["kind"] == "mechanic" and s["id"] == "care-dyadic-bonds" for s in ev5[-1][1]["assistant_message"]["sources"])

    # Turn 6 pivots to campaign question -> carryover threshold rejects -> no <game_mechanics> & no mechanic source
    r6 = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Where is Kira right now?", "mentions": []},
    )
    assert r6.status_code == 200
    ev6 = _parse_sse_events(r6.text)
    assert "<game_mechanics>" not in seen_nontool_prompts[-1]
    assert all(s["kind"] != "mechanic" for s in ev6[-1][1]["assistant_message"]["sources"])


def test_zcc_export_excludes_mechanics_from_lore_and_preserves_gm_sources(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("mech_zcc_user")
    seeded = _seed_mechanics_campaign(repo, user_id)
    cid = seeded["campaign"].id
    turn1_id = seeded["turn1"].id

    repo.append_gm_message_pair(
        campaign_id=cid,
        anchor_turn_id=turn1_id,
        user_content="Explain @Mood & Composure (PAD)",
        user_mentions=[
            GmMentionRef(kind="mechanic", id="care-mood-composure", label="Mood & Composure (PAD)")
        ],
        assistant_content="Composure shields PAD coordinates.",
        sources=[GmSourceRef(kind="mechanic", id="care-mood-composure", label="Mood & Composure (PAD)")],
    )

    exp_res = client.post(
        f"/api/export/campaign/{cid}",
        headers=headers,
        json={"timeline_scope": "full", "include_gm_chat": True},
    )
    assert exp_res.status_code == 200
    catalog_ids = {a.id for a in load_mechanics_catalog().articles}
    with zipfile.ZipFile(io.BytesIO(exp_res.content), "r") as zf:
        worlds = json.loads(zf.read("worlds.json"))
        for w in worlds:
            for ln in w.get("lore_nodes") or []:
                assert ln["id"] not in catalog_ids
        camps = json.loads(zf.read("campaigns.json"))
        gm_msgs = camps[0]["gm_chat_messages"]
        assert len(gm_msgs) == 2
        assert "care-mood-composure" in gm_msgs[0]["mentions_json"]
        assert "care-mood-composure" in gm_msgs[1]["sources_json"]
