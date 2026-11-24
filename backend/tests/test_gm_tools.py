"""Tests for v0.34.0 GM Agentic Tools (Phase 2)."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.dependencies import resolve_effective_models, resolve_gm_profile
from app.engine import llm_client as llm_client_mod
from app.engine.gm_talk import _compute_branch_visibility, build_gm_context_and_messages
from app.engine.gm_tools import (
    GM_TOOL_DEFINITIONS,
    MAX_GM_PROPOSALS_PER_TURN,
    MAX_GM_TOOL_ROUNDS,
    describe_gm_tool_status,
    execute_gm_tool,
    run_gm_tool_loop,
)
from app.engine.llm_client import CallTarget, ToolsUnsupportedError, llm_client
from app.prompts import FACTORY_DEFAULT_PROMPTS
from app.providers.local_relay import RelayRemoteError
from app.routers import campaigns as campaigns_facade
from app.schemas.character import CognitionBlock
from app.schemas.gm import GmCodexProposal, GmWorldLoreDraftLLMOutput
from app.schemas.llm_tools import LlmToolCall, LlmToolCompletionResult
from app.schemas.persona import PersonaCreatePayload
from app.schemas.turn import CampaignWorldSettings, PreTurnAnalysis
from app.schemas.world import (
    LocationContainer,
    LocationEdgeDraft,
    LocationLoreNodeDraft,
    LocationNodeDraft,
    LoreNode,
    WorldLoreNodeDraft,
    WorldUpdatePayload,
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


def _seed_tools_campaign(repo: CantinaRepository, owner_id: str) -> dict[str, Any]:
    """Seed a world & multi-turn branched campaign with visited/unvisited areas and secret lore."""
    cont_visited = LocationContainer(
        id="cont_visited",
        world_id="",
        depth=1,
        name="The Neon Cantina",
        description="A subterranean noodle bar and smugglers' exchange.",
        environmental_tags=["neon", "steam"],
        lore_nodes=[
            LoreNode(
                id="lore_cont_pub",
                world_id="",
                container_id="cont_visited",
                title="Syndicate Exchange Etiquette",
                category="culture",
                content="No weapons drawn at the counter.",
                entity_tags=["syndicate", "cantina"],
            ),
            LoreNode(
                id="lore_cont_secret",
                world_id="",
                container_id="cont_visited",
                title="Cantina Floor Hatch",
                category="secret",
                content="CONT_SECRET_HATCH_111 leads to the reactor.",
                entity_tags=["hatch", "secret"],
            ),
        ],
    )
    cont_unvisited = LocationContainer(
        id="cont_unvisited",
        world_id="",
        depth=1,
        name="Restricted Sub-Basement",
        description="UNVISITED_CONTAINER_222 beneath the sector.",
        environmental_tags=["restricted"],
        lore_nodes=[],
    )
    loc_bar = LocationNodeDraft(
        key="bar",
        name="Main Bar",
        summary="Crowded neon bar.",
        description="Chrome stools line a scarred zinc counter.",
        environmental_tags=["crowded"],
        is_starting_location=True,
        is_hub=True,
        lore_nodes=[
            LocationLoreNodeDraft(
                title="Bar Local Public Lore",
                category="culture",
                content="Synth-sake flows nightly.",
                entity_tags=["sake"],
            ),
            LocationLoreNodeDraft(
                title="Bar Unrevealed Trapdoor",
                category="secret",
                content="LOC_SECRET_TRAPDOOR_333 sits behind the fridge.",
                entity_tags=["trapdoor"],
            ),
        ],
    )
    loc_vault = LocationNodeDraft(
        key="vault",
        name="Sub-Zero Vault",
        summary="UNVISITED_LOC_444 server bank.",
        description="Frost-rimmed racks behind blast doors.",
        environmental_tags=["cold"],
        lore_nodes=[
            LocationLoreNodeDraft(
                title="Vault Coolant Specs",
                category="history",
                content="Coolant runs at -40C.",
                entity_tags=["coolant"],
            )
        ],
    )
    world = seed_world(
        repo,
        owner_id=owner_id,
        name="New Kowloon",
        locations=[loc_bar, loc_vault],
        edges=[
            LocationEdgeDraft(
                from_key="bar",
                to_key="vault",
                direction_label="Hatch Down",
                compass_direction="S",
                distance_meters=140,
            )
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Helios Blackout of 2091",
                category="history",
                content="An orbital EMP shattered the upper grid for eleven days.",
                entity_tags=["helios", "blackout", "emp"],
            ),
            WorldLoreNodeDraft(
                title="Aegis Directorate",
                category="faction",
                content="Corporate compliance enforcers patrolling Sector 9.",
                entity_tags=["aegis", "compliance"],
            ),
        ],
    )
    bar_node = next(loc for loc in world.locations if loc.name == "Main Bar")
    vault_node = next(loc for loc in world.locations if loc.name == "Sub-Zero Vault")
    updated_locs = []
    for loc in world.locations:
        if loc.id == bar_node.id:
            updated_locs.append(loc.model_copy(update={"container_id": cont_visited.id}))
        elif loc.id == vault_node.id:
            updated_locs.append(loc.model_copy(update={"container_id": cont_unvisited.id}))
        else:
            updated_locs.append(loc)

    world = repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=world.name,
            global_rules=world.global_rules,
            containers=[cont_visited, cont_unvisited],
            locations=updated_locs,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id=owner_id,
    )
    bar_node = next(loc for loc in world.locations if loc.name == "Main Bar")
    bar_secret = next(ln for ln in bar_node.lore_nodes if ln.title == "Bar Unrevealed Trapdoor")
    public_world_lore = next(
        ln for ln in world.lore_nodes if ln.title == "Helios Blackout of 2091"
    )
    aegis_world_lore = next(
        ln for ln in world.lore_nodes if ln.title == "Aegis Directorate"
    )

    persona = repo.create_persona(
        PersonaCreatePayload(
            name="Deckard Zero",
            tagline="Independent netrunner",
            persona_bio="Ex-orbital auditor carrying a custom cyberdeck.",
            tags=["netrunner"],
        ),
        owner_id=owner_id,
    )
    char = seed_character(repo, owner_id=owner_id, world_id=world.id, name="Kira Voss")
    campaign = repo.create_campaign(
        name="Sector 9 Run",
        world_id=world.id,
        character_id=char.id,
        owner_id=owner_id,
        persona_id=persona.id,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    prev_turn = bundle.active_branch_turns[0]

    # Alternate inactive sibling turn
    repo.save_turn_node(
        turn_id="turn_alt_branch",
        campaign_id=campaign.id,
        parent_turn_id=prev_turn.id,
        depth_index=1,
        user_message="Take the east tunnel instead.",
        actor_id=char.id,
        raw_prose="ALT_BRANCH_SECRET_777 echoed down the east tunnel.",
        cognition=CognitionBlock(
            recall="Alt branch.",
            feeling="Cautious",
            valence=0.0,
            arousal=0.3,
            want="Escape",
            plan="Go east.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="neutral",
            subtext_interpretation="Exploring tunnel",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=prev_turn.world_snapshot.model_copy(update={"turn_id": "turn_alt_branch"}),
        character_state=prev_turn.character_state.model_copy(update={"turn_id": "turn_alt_branch"}),
        recalled_items=[],
    )

    # Chain 7 linear active turns so get_campaign_turns range clamping can be verified cleanly
    last_turn = prev_turn
    for idx in range(1, 8):
        tid = f"turn_tools_{idx}"
        snap = prev_turn.world_snapshot.model_copy(update={"turn_id": tid})
        cstate = prev_turn.character_state.model_copy(update={"turn_id": tid})
        last_turn = repo.save_turn_node(
            turn_id=tid,
            campaign_id=campaign.id,
            parent_turn_id=last_turn.id,
            depth_index=idx,
            user_message=f"Turn {idx} action inspecting beacon {idx}.",
            actor_id=char.id,
            raw_prose=f"In step {idx}, an Aegis mobile scanner sweeps sector beacon {idx}.",
            cognition=CognitionBlock(
                recall=f"PRIVATE_COGNITION_888 step {idx}",
                feeling="Alert",
                valence=-0.1,
                arousal=0.5,
                want="Avoid scan",
                plan="Stay silent",
            ),
            pre_turn=PreTurnAnalysis(
                user_sentiment="tense",
                subtext_interpretation="Scanning",
                mentioned_entities=["Aegis"],
                memory_search_queries=["aegis"],
                spatial_intent="stay",
            ),
            world_snapshot=snap,
            character_state=cstate,
            recalled_items=[],
        )

    repo.checkout_turn_branch(campaign.id, last_turn.id, owner_id=owner_id)
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    return {
        "world": world,
        "char": char,
        "persona": persona,
        "campaign": bundle.campaign,
        "bundle": bundle,
        "last_turn": last_turn,
        "public_world_lore": public_world_lore,
        "aegis_world_lore": aegis_world_lore,
        "bar_secret": bar_secret,
    }


def test_gm_tools_enabled_persistence_and_api_exposure(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)
    headers, user_id, _ = api_user_factory("gm_tools_prefs")
    seeded = _seed_tools_campaign(repo, user_id)
    cid = seeded["campaign"].id

    conn = sqlite3.connect(repo.db_path)
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(user_model_settings)").fetchall()}
    finally:
        conn.close()
    assert "gm_tools_enabled" in cols

    # Default is False everywhere
    prof_res = client.get("/api/profile/models", headers=headers)
    assert prof_res.status_code == 200
    prof_json = prof_res.json()
    assert prof_json["default_gm_tools_enabled"] is False
    assert prof_json["effective_gm_tools_enabled"] is False
    assert prof_json["user_gm_tools_enabled"] is None

    gm_msg_res = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert gm_msg_res.status_code == 200
    assert gm_msg_res.json()["gm_tools_enabled"] is False

    # Enable gm_tools_enabled + clerk pairing
    put_res = client.put(
        "/api/profile/models",
        headers=headers,
        json={"gm_model_role": "clerk", "gm_tools_enabled": True},
    )
    assert put_res.status_code == 200
    put_json = put_res.json()
    assert put_json["effective_gm_tools_enabled"] is True
    assert put_json["user_gm_tools_enabled"] is True

    eff = resolve_effective_models(user_id)
    assert eff.gm_tools_enabled is True
    _, gm_role = resolve_gm_profile(eff)
    assert gm_role == "clerk"

    gm_msg_res2 = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert gm_msg_res2.status_code == 200
    assert gm_msg_res2.json()["gm_tools_enabled"] is True
    assert gm_msg_res2.json()["gm_model_role"] == "clerk"


@pytest.mark.asyncio
async def test_complete_with_tools_across_providers_and_unsupported_detection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = ModelProfile(model="qwen3:8b", temperature=0.4, max_tokens=512)

    class FakeResp:
        def __init__(self, status_code: int, payload: Any = None, text: str = "") -> None:
            self.status_code = status_code
            self._payload = payload
            self.text = text or (json.dumps(payload) if payload is not None else "")

        def json(self) -> Any:
            return self._payload

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                req = httpx.Request("POST", "http://localhost")
                resp = httpx.Response(self.status_code, text=self.text, request=req)
                raise httpx.HTTPStatusError(f"HTTP {self.status_code}", request=req, response=resp)

    captured_posts: list[tuple[str, dict[str, Any]]] = []
    queued_responses: list[FakeResp] = []

    class FakeHttpClient:
        async def post(self, url: str, headers: Any = None, json: Any = None, timeout: Any = None) -> FakeResp:
            captured_posts.append((url, dict(json)))
            return queued_responses.pop(0)

    async def fake_get_http_client(timeout: Any = None) -> FakeHttpClient:
        return FakeHttpClient()

    monkeypatch.setattr(llm_client, "get_http_client", fake_get_http_client)

    # 1. Native Ollama /api/chat tool call with dict arguments
    async def ollama_target(p: ModelProfile, role: str = "model") -> CallTarget:
        return CallTarget(
            root_url="http://127.0.0.1:11434",
            native_headers={},
            openai_headers={"Content-Type": "application/json"},
            provider_type="ollama",
        )

    monkeypatch.setattr(llm_client_mod, "build_call_target", ollama_target)
    queued_responses.append(
        FakeResp(
            200,
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "search_world_codex",
                                "arguments": {"query": "Aegis"},
                            }
                        }
                    ],
                },
                "done_reason": "stop",
                "prompt_eval_count": 40,
                "eval_count": 12,
            },
        )
    )
    res_ollama = await llm_client.complete_with_tools(
        [{"role": "user", "content": "Check Aegis"}],
        GM_TOOL_DEFINITIONS[:1],
        profile=profile,
    )
    assert captured_posts[-1][0].endswith("/api/chat")
    assert len(captured_posts[-1][1]["tools"]) == 1
    assert len(res_ollama.tool_calls) == 1
    assert res_ollama.tool_calls[0].name == "search_world_codex"
    assert res_ollama.tool_calls[0].arguments == {"query": "Aegis"}

    # Ollama HTTP 400 "does not support tools" -> ToolsUnsupportedError
    queued_responses.append(FakeResp(400, text="registry.ollama.ai/library/llama3 does not support tools"))
    with pytest.raises(ToolsUnsupportedError):
        await llm_client.complete_with_tools(
            [{"role": "user", "content": "Check Aegis"}],
            GM_TOOL_DEFINITIONS[:1],
            profile=profile,
        )

    # 2. OpenAI-compat /chat/completions with JSON string arguments
    async def oai_target(p: ModelProfile, role: str = "model") -> CallTarget:
        return CallTarget(
            root_url="https://api.example.com/v1",
            native_headers={},
            openai_headers={"Authorization": "Bearer key", "Content-Type": "application/json"},
            provider_type="openai_compat",
        )

    monkeypatch.setattr(llm_client_mod, "build_call_target", oai_target)
    queued_responses.append(
        FakeResp(
            200,
            {
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_oai_1",
                                    "type": "function",
                                    "function": {
                                        "name": "get_campaign_turns",
                                        "arguments": '{"start_turn": 1, "end_turn": 2}',
                                    },
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 55, "completion_tokens": 18},
            },
        )
    )
    res_oai = await llm_client.complete_with_tools(
        [{"role": "user", "content": "Inspect turns 1-2"}],
        GM_TOOL_DEFINITIONS,
        profile=profile,
    )
    assert captured_posts[-1][0].endswith("/chat/completions")
    assert captured_posts[-1][1]["tool_choice"] == "auto"
    assert res_oai.tool_calls[0].id == "call_oai_1"
    assert res_oai.tool_calls[0].arguments == {"start_turn": 1, "end_turn": 2}

    # OpenAI HTTP 422 "tools is not supported" -> ToolsUnsupportedError
    queued_responses.append(FakeResp(422, text='{"error":"tools is not supported on this endpoint"}'))
    with pytest.raises(ToolsUnsupportedError):
        await llm_client.complete_with_tools(
            [{"role": "user", "content": "Inspect"}],
            GM_TOOL_DEFINITIONS[:1],
            profile=profile,
        )

    # 3. WebGPU & AI Horde immediately raise ToolsUnsupportedError
    for ptype in ("webgpu", "aihorde"):

        async def _unsupported_target(p: ModelProfile, role: str = "model", _pt: str = ptype) -> CallTarget:
            return CallTarget(root_url="http://local", native_headers={}, openai_headers={}, provider_type=_pt)

        monkeypatch.setattr(llm_client_mod, "build_call_target", _unsupported_target)
        with pytest.raises(ToolsUnsupportedError):
            await llm_client.complete_with_tools(
                [{"role": "user", "content": "Hi"}],
                GM_TOOL_DEFINITIONS[:1],
                profile=profile,
            )

    # 4. Browser Relay returning tools_unsupported raises ToolsUnsupportedError
    async def relay_target(p: ModelProfile, role: str = "model") -> CallTarget:
        return CallTarget(
            root_url="http://127.0.0.1:11434",
            native_headers={},
            openai_headers={},
            provider_type="browser_ollama",
            credential_storage="browser",
        )

    async def fake_relay_complete(**kwargs: Any) -> Any:
        raise RelayRemoteError("tools_unsupported", "Browser model rejected tools")

    monkeypatch.setattr(llm_client_mod, "build_call_target", relay_target)
    monkeypatch.setattr(llm_client_mod.local_relay_hub, "complete", fake_relay_complete)
    with pytest.raises(ToolsUnsupportedError):
        await llm_client.complete_with_tools(
            [{"role": "user", "content": "Hi"}],
            GM_TOOL_DEFINITIONS[:1],
            profile=profile,
        )


@pytest.mark.asyncio
async def test_execute_gm_tool_spoiler_gating_and_proposal_limits(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("gm_tools_spoiler")
    seeded = _seed_tools_campaign(repo, user_id)
    cid = seeded["campaign"].id

    # 1. With unlock_lore=False, hidden secrets / unvisited places / private cognitions must NOT leak
    bundle_safe = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    hidden_world_secret = LoreNode.model_construct(
        id="lore_world_secret_hidden",
        world_id=seeded["world"].id,
        location_id=None,
        container_id=None,
        campaign_id=None,
        title="Orbital Override Key",
        category="secret",
        content="WORLD_SECRET_OVERRIDE_555 is hidden in Orbital Sat-7.",
        entity_tags=["orbital", "override", "sat-7"],
    )
    revealed_world_secret = LoreNode.model_construct(
        id=seeded["bar_secret"].id,  # matches revealed check via world_snapshot copy below
        world_id=seeded["world"].id,
        location_id=None,
        container_id=None,
        campaign_id=None,
        title="Unlocked Syndicate Ledger",
        category="secret",
        content="WORLD_REVEALED_LEDGER_666 lists three port brokers.",
        entity_tags=["syndicate", "ledger"],
    )
    snap_with_rev = bundle_safe.current_world_snapshot.model_copy(
        update={"revealed_lore_ids": [revealed_world_secret.id]}
    )
    turn_with_rev = bundle_safe.active_branch_turns[-1].model_copy(update={"world_snapshot": snap_with_rev})
    bundle_with_secret = bundle_safe.model_copy(
        update={
            "current_world_snapshot": snap_with_rev,
            "world_lore_nodes": [
                *bundle_safe.world_lore_nodes,
                hidden_world_secret,
                revealed_world_secret,
            ],
            "active_branch_turns": [*bundle_safe.active_branch_turns[:-1], turn_with_rev],
        }
    )
    vis_safe = _compute_branch_visibility(bundle_with_secret)
    base_ids = repo.get_base_world_lore_ids(seeded["world"].id)

    codex_search, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_with_secret,
        vis=vis_safe,
        base_world_ids=base_ids,
        call=LlmToolCall(id="c1", name="search_world_codex", arguments={"query": "Orbital Override"}),
        emitted_proposals=[],
    )
    assert "WORLD_SECRET_OVERRIDE_555" not in json.dumps(codex_search)
    assert all(e["id"] != hidden_world_secret.id for e in codex_search["entries"])
    assert codex_search["total_world_codex"] == 3  # Helios + Aegis + Unlocked Syndicate Ledger only

    codex_get_secret, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_with_secret,
        vis=vis_safe,
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="c2",
            name="get_world_codex_entry",
            arguments={"lore_id": hidden_world_secret.id},
        ),
        emitted_proposals=[],
    )
    assert codex_get_secret == {"error": "World Codex entry not found."}

    codex_get_rev, rev_srcs, _ = await execute_gm_tool(
        repo,
        bundle=bundle_with_secret,
        vis=vis_safe,
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="c3",
            name="get_world_codex_entry",
            arguments={"title": "Unlocked Syndicate Ledger"},
        ),
        emitted_proposals=[],
    )
    assert "WORLD_REVEALED_LEDGER_666" in codex_get_rev["content"]
    assert rev_srcs and rev_srcs[0].kind == "lore"

    turns_search, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(id="c4", name="search_campaign_turns", arguments={"query": "sector"}),
        emitted_proposals=[],
    )
    search_blob = json.dumps(turns_search)
    assert "ALT_BRANCH_SECRET_777" not in search_blob
    assert "PRIVATE_COGNITION_888" not in search_blob
    assert "Avoid scan" not in search_blob
    assert "Cognition (GM Mode)" not in search_blob

    turns_range, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(id="c5", name="get_campaign_turns", arguments={"start_turn": 1, "end_turn": 20}),
        emitted_proposals=[],
    )
    assert [t["turn_number"] for t in turns_range["turns"]] == [1, 2, 3, 4, 5, 6]
    range_blob = json.dumps(turns_range)
    assert "PRIVATE_COGNITION_888" not in range_blob
    assert "Avoid scan" not in range_blob
    assert "Cognition (GM Mode)" not in range_blob

    unvis_loc, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(id="c6", name="get_campaign_entity", arguments={"kind": "location", "query": "Vault"}),
        emitted_proposals=[],
    )
    assert "error" in unvis_loc

    unvis_cont, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="c7", name="get_campaign_entity", arguments={"kind": "container", "query": "Sub-Basement"}
        ),
        emitted_proposals=[],
    )
    assert "error" in unvis_cont

    vis_bar, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(id="c8", name="get_campaign_entity", arguments={"kind": "location", "query": "Main Bar"}),
        emitted_proposals=[],
    )
    assert vis_bar["name"] == "Main Bar"
    assert "LOC_SECRET_TRAPDOOR_333" not in json.dumps(vis_bar)

    vis_cont, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="c8b", name="get_campaign_entity", arguments={"kind": "container", "query": "Neon Cantina"}
        ),
        emitted_proposals=[],
    )
    assert vis_cont["name"] == "The Neon Cantina"
    assert "CONT_SECRET_HATCH_111" not in json.dumps(vis_cont)

    # Proposal tool sanitizes OOC turn citations, hides unrevealed secret duplicates, and caps at 3
    emitted: list[GmCodexProposal] = []
    prop_out, _, prop_obj = await execute_gm_tool(
        repo,
        bundle=bundle_with_secret,
        vis=vis_safe,
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="p1",
            name="propose_world_lore_entry",
            arguments={
                "category": "enemy",
                "title": "Orbital Override Arch\nSources: Turn 1",
                "entity_tags": ["orbital", "scanner", "override"],
                "content": "Sweep unit. Range < 12m.\n\nSources: Turns 1-3.",
                "source_turns": [1, 2],
                "replace_lore_id": seeded["public_world_lore"].id,
            },
        ),
        emitted_proposals=emitted,
    )
    assert prop_obj is not None
    assert prop_obj.draft.category == "threat"
    assert prop_obj.draft.title == "Orbital Override Arch"
    assert prop_obj.draft.content == "Sweep unit. Range < 12m."
    assert prop_obj.replace_lore_id is None
    assert prop_out["requires_gm_mode_for_replace"] is True
    assert all(d["id"] != hidden_world_secret.id for d in prop_out["duplicate_matches"])
    emitted.append(prop_obj)

    for idx in range(2, MAX_GM_PROPOSALS_PER_TURN + 1):
        _, _, extra_prop = await execute_gm_tool(
            repo,
            bundle=bundle_safe,
            vis=_compute_branch_visibility(bundle_safe),
            base_world_ids=base_ids,
            call=LlmToolCall(
                id=f"p{idx}",
                name="propose_world_lore_entry",
                arguments={
                    "category": "artifact",
                    "title": f"Unit {idx}",
                    "entity_tags": ["unit"],
                    "content": f"Entry {idx}.",
                },
            ),
            emitted_proposals=emitted,
        )
        assert extra_prop is not None
        emitted.append(extra_prop)

    capped_out, _, capped_prop = await execute_gm_tool(
        repo,
        bundle=bundle_safe,
        vis=_compute_branch_visibility(bundle_safe),
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="p4",
            name="propose_world_lore_entry",
            arguments={
                "category": "artifact",
                "title": "Fourth Proposal",
                "entity_tags": ["unit"],
                "content": "Should be rejected.",
            },
        ),
        emitted_proposals=emitted,
    )
    assert capped_prop is None
    assert capped_out["status"] == "limit_reached"

    # Zero World Codex DB mutation occurred
    after_bundle = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    assert len(after_bundle.world_lore_nodes) == len(bundle_safe.world_lore_nodes)

    # 2. With unlock_lore=True, GM Mode reveals secrets, unvisited areas, and private cognitions
    repo.update_campaign_world_settings(cid, CampaignWorldSettings(unlock_lore=True), owner_id=user_id)
    bundle_gm = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    bundle_gm_with_secret = bundle_gm.model_copy(
        update={"world_lore_nodes": [*bundle_gm.world_lore_nodes, hidden_world_secret]}
    )
    vis_gm = _compute_branch_visibility(bundle_gm_with_secret)

    codex_gm_secret, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_gm_with_secret,
        vis=vis_gm,
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="g1",
            name="get_world_codex_entry",
            arguments={"lore_id": hidden_world_secret.id},
        ),
        emitted_proposals=[],
    )
    assert "WORLD_SECRET_OVERRIDE_555" in codex_gm_secret["content"]

    turns_gm, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_gm,
        vis=_compute_branch_visibility(bundle_gm),
        base_world_ids=base_ids,
        call=LlmToolCall(id="g2", name="get_campaign_turns", arguments={"start_turn": 1, "end_turn": 2}),
        emitted_proposals=[],
    )
    turns_gm_blob = json.dumps(turns_gm)
    assert "Cognition (GM Mode)" in turns_gm_blob
    assert "Avoid scan" in turns_gm_blob

    vault_gm, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_gm,
        vis=_compute_branch_visibility(bundle_gm),
        base_world_ids=base_ids,
        call=LlmToolCall(id="g3", name="get_campaign_entity", arguments={"kind": "location", "query": "Vault"}),
        emitted_proposals=[],
    )
    assert vault_gm["name"] == "Sub-Zero Vault"

    cantina_gm, _, _ = await execute_gm_tool(
        repo,
        bundle=bundle_gm,
        vis=_compute_branch_visibility(bundle_gm),
        base_world_ids=base_ids,
        call=LlmToolCall(
            id="g4", name="get_campaign_entity", arguments={"kind": "container", "query": "Neon Cantina"}
        ),
        emitted_proposals=[],
    )
    assert "CONT_SECRET_HATCH_111" in json.dumps(cantina_gm)

    assert describe_gm_tool_status("get_campaign_turns", {"start_turn": 5, "end_turn": 2}) == "Checking Turns 2–5…"


@pytest.mark.asyncio
async def test_run_gm_tool_loop_max_rounds_produces_wire_safe_synthesis_messages(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    _, repo, _ = api_env
    _, user_id, _ = api_user_factory("gm_tools_loop")
    seeded = _seed_tools_campaign(repo, user_id)
    cid = seeded["campaign"].id

    prep = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="Tell me about Helios Blackout.",
        mentions=[],
        working_memory_turns=4,
        context_size=8192,
        gm_max_tokens=512,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
    )
    assert prep.bundle is not None

    round_count = 0

    class EndlessToolLLM:
        async def complete_with_tools(self, messages: Any, tools: Any, **kwargs: Any) -> LlmToolCompletionResult:
            nonlocal round_count
            round_count += 1
            return LlmToolCompletionResult(
                content="",
                tool_calls=[
                    LlmToolCall(
                        id=f"tc_{round_count}",
                        name="search_world_codex",
                        arguments={"query": "Helios"},
                    )
                ],
            )

    events: list[tuple[str, Any]] = []
    async for ev in run_gm_tool_loop(
        repo,
        bundle=prep.bundle,
        prep=prep,
        gm_profile=ModelProfile(model="qwen3:8b"),
        llm_client_override=EndlessToolLLM(),
    ):
        events.append(ev)

    assert round_count == MAX_GM_TOOL_ROUNDS
    kinds = [k for k, _ in events]
    assert "fallback_stream" in kinds
    synth_msgs = next(val for k, val in events if k == "fallback_stream")
    assert all(m["role"] in ("system", "user", "assistant") for m in synth_msgs)
    assert all("tool_calls" not in m for m in synth_msgs)
    assert "Helios Blackout of 2091" in synth_msgs[-1]["content"]


def test_gm_chat_sse_with_tools_and_round1_unsupported_fallback(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    monkeypatch.setattr(settings, "allow_user_model_overrides", True)
    headers, user_id, _ = api_user_factory("gm_tools_e2e")
    seeded = _seed_tools_campaign(repo, user_id)
    cid = seeded["campaign"].id
    initial_lore_count = len(repo.get_campaign_state_bundle(cid, owner_id=user_id).world_lore_nodes)

    client.put("/api/profile/models", headers=headers, json={"gm_tools_enabled": True}).raise_for_status()

    # 1. Happy path: read tool -> proposal tool -> final prose answer (no DB mutation until confirm)
    class AgenticFakeLLM:
        def __init__(self) -> None:
            self.step = 0

        async def complete_with_tools(self, messages: Any, tools: Any, **kwargs: Any) -> LlmToolCompletionResult:
            self.step += 1
            if self.step == 1:
                return LlmToolCompletionResult(
                    content="",
                    tool_calls=[
                        LlmToolCall(
                            id="call_search",
                            name="search_world_codex",
                            arguments={"query": "Aegis"},
                        )
                    ],
                )
            if self.step == 2:
                return LlmToolCompletionResult(
                    content="",
                    tool_calls=[
                        LlmToolCall(
                            id="call_prop",
                            name="propose_world_lore_entry",
                            arguments={
                                "category": "artifact",
                                "title": "Aegis Mobile Scanner",
                                "entity_tags": ["aegis", "scanner"],
                                "content": "A portable sector sweep arch. Range < 15m.\n\nSources: Turn 1.",
                                "source_turns": [1, 2],
                            },
                        )
                    ],
                )
            return LlmToolCompletionResult(
                content="<think>hidden</think>I checked your Codex and prepared a tentative **Aegis Mobile Scanner** card below for your review."
            )

    monkeypatch.setattr(campaigns_facade, "llm_client", AgenticFakeLLM())
    sse_res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Search the codex and add an Aegis Mobile Scanner entry.", "mentions": []},
    )
    assert sse_res.status_code == 200
    events = _parse_sse_events(sse_res.text)
    ev_names = [ev for ev, _ in events]

    assert ev_names[0] == "meta"
    assert events[0][1]["tools_enabled"] is True
    assert "tool_status" in ev_names
    assert "codex_proposal" in ev_names
    assert ev_names[-1] == "done"
    assert ev_names.index("codex_proposal") < ev_names.index("done")

    token_text = "".join(p["text"] for ev, p in events if ev == "token")
    assert "hidden" not in token_text
    assert "Aegis Mobile Scanner" in token_text
    assert "LOC_SECRET_TRAPDOOR_333" not in token_text

    done_asst = events[-1][1]["assistant_message"]
    assert len(done_asst["proposals"]) == 1
    assert done_asst["proposals"][0]["draft"]["title"] == "Aegis Mobile Scanner"
    assert done_asst["proposals"][0]["draft"]["content"] == "A portable sector sweep arch. Range < 15m."
    # World Codex stays untouched until user confirms
    assert len(repo.get_campaign_state_bundle(cid, owner_id=user_id).world_lore_nodes) == initial_lore_count

    # 2. Round-1 ToolsUnsupportedError -> `event: notice` + clean Phase 1 fallback + Phase 1 auto-draft
    class UnsupportedToolsLLM:
        async def complete_with_tools(self, *args: Any, **kwargs: Any) -> LlmToolCompletionResult:
            raise ToolsUnsupportedError("model does not support tools")

        async def stream_chat(self, *args: Any, **kwargs: Any) -> AsyncIterator[str]:
            yield "Standard GM Talk reply explaining the scanner."

        async def complete_structured(self, *args: Any, **kwargs: Any) -> GmWorldLoreDraftLLMOutput:
            return GmWorldLoreDraftLLMOutput.model_validate(
                {
                    "category": "threat",
                    "title": "Sector Sweep Unit",
                    "entity_tags": ["aegis", "sweep"],
                    "content": "Mobile enforcement sweep arch operating along beacon corridors.",
                    "source_turns": [1],
                }
            )

    monkeypatch.setattr(campaigns_facade, "llm_client", UnsupportedToolsLLM())
    fb_res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Please add a Sector Sweep Unit to the codex.", "mentions": []},
    )
    assert fb_res.status_code == 200
    fb_events = _parse_sse_events(fb_res.text)
    fb_names = [ev for ev, _ in fb_events]
    assert "notice" in fb_names
    assert "token" in fb_names
    assert "codex_proposal" in fb_names
    assert fb_names[-1] == "done"
    notice_detail = next(p["detail"] for ev, p in fb_events if ev == "notice")
    assert "does not support native tools" in notice_detail
