"""End-to-end backend tests for v0.32.0 GM Talk ('Neuromancer')."""

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
from app.dependencies import resolve_effective_models, resolve_gm_profile
from app.engine.gm_talk import (
    ReasoningTagStreamFilter,
    build_gm_context_and_messages,
    strip_reasoning_blocks,
)
from app.prompts import (
    ALL_PROMPT_KEYS,
    FACTORY_DEFAULT_PROMPTS,
    PROMPT_KEY_GM_TALK_SYSTEM,
)
from app.routers import campaigns as campaigns_facade
from app.schemas.character import CognitionBlock
from app.schemas.gm import GmMentionRef
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


def _seed_rich_campaign(
    repo: CantinaRepository,
    owner_id: str,
) -> dict[str, Any]:
    """Create a multi-location, multi-container, secret-bearing, branched campaign."""
    cont_l1 = LocationContainer(
        id="cont_cantina",
        world_id="",
        depth=1,
        name="The Neon Cantina",
        description="A subterranean noodle bar and smugglers' exchange.",
        environmental_tags=["neon", "steam"],
        lore_nodes=[
            LoreNode(
                id="lore_cont_pub",
                world_id="",
                container_id="cont_cantina",
                title="Syndicate Exchange Etiquette",
                category="culture",
                content="No weapons drawn at the bar counter.",
                entity_tags=["syndicate", "cantina"],
            ),
            LoreNode(
                id="lore_cont_secret",
                world_id="",
                container_id="cont_cantina",
                title="Hidden Smuggler Hatch",
                category="secret",
                content="A biometric floor hatch beneath booth four leads to the vault.",
                entity_tags=["hatch", "vault", "secret"],
            ),
        ],
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
                title="Bartender's Killswitch",
                category="secret",
                content="Toby keeps a remote EMP detonator taped under the tap.",
                entity_tags=["killswitch", "emp"],
            ),
            LocationLoreNodeDraft(
                title="Courier Drop Signal",
                category="secret",
                content="Ordering blue sake twice signals a black-market drop.",
                entity_tags=["sake", "drop"],
            ),
        ],
    )
    loc_vault = LocationNodeDraft(
        key="vault",
        name="Sub-Zero Vault",
        summary="Unvisited cold-storage server room.",
        description="Frost-rimmed server racks hum behind blast doors.",
        environmental_tags=["cold", "vault"],
        lore_nodes=[
            LocationLoreNodeDraft(
                title="Vault Cryo Coolant",
                category="history",
                content="Coolant lines run at minus forty degrees.",
                entity_tags=["coolant", "vault"],
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
                travel_minutes=2,
            )
        ],
        lore_nodes=[
            WorldLoreNodeDraft(
                title="Helios Blackout of 2091",
                category="history",
                content="An orbital EMP shattered the upper grid for eleven days.",
                entity_tags=["helios", "blackout"],
            )
        ],
    )
    # Attach Main Bar to The Neon Cantina container
    bar_node = next(l for l in world.locations if l.name == "Main Bar")
    updated_locs = [
        l.model_copy(update={"container_id": cont_l1.id}) if l.id == bar_node.id else l
        for l in world.locations
    ]
    world = repo.update_world(
        world.id,
        WorldUpdatePayload(
            name=world.name,
            global_rules=world.global_rules,
            containers=[cont_l1],
            locations=updated_locs,
            edges=world.edges,
            lore_nodes=world.lore_nodes,
        ),
        owner_id=owner_id,
    )
    bar_node = next(l for l in world.locations if l.name == "Main Bar")
    rev_secret = next(ln for ln in bar_node.lore_nodes if ln.title == "Courier Drop Signal")
    unrev_secret = next(ln for ln in bar_node.lore_nodes if ln.title == "Bartender's Killswitch")
    persona = repo.create_persona(
        PersonaCreatePayload(
            name="Deckard Zero",
            tagline="Independent netrunner",
            persona_bio="Ex-orbital auditor carrying a custom cyberdeck.",
            tags=["netrunner"],
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
        name="Kowloon Run",
        world_id=world.id,
        character_id=char.id,
        persona_id=persona.id,
        owner_id=owner_id,
    )
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)
    root = bundle.active_branch_turns[0]

    # Mark lore_loc_secret_rev as legitimately discovered in Turn 1 (branch A)
    turn1 = repo.save_turn_node(
        turn_id="turn_gm_1",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Order blue sake twice and watch Kira.",
        actor_id=char.id,
        raw_prose='*Kira nods subtly at the blue sake bottles.* "The drop is tonight."',
        cognition=CognitionBlock(
            recall="Remembered my brother's debt trigger.",
            feeling="Guarded but intrigued",
            valence=0.05,
            arousal=0.45,
            want="Protect the vault secret from outsiders",
            plan="Test Deckard before mentioning the EMP killswitch.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="cautious",
            subtext_interpretation="Signaling drop",
            mentioned_entities=["Kira"],
            memory_search_queries=["blue sake"],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(
            update={
                "turn_id": "turn_gm_1",
                "revealed_lore_ids": [rev_secret.id],
            }
        ),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_gm_1"}),
        recalled_items=[],
    )

    # Alternate sibling branch from root: Turn 1B
    turn1b = repo.save_turn_node(
        turn_id="turn_gm_1b",
        campaign_id=campaign.id,
        parent_turn_id=root.id,
        depth_index=1,
        user_message="Walk straight out into the alley.",
        actor_id=char.id,
        raw_prose="*Rain streaks down the alley neon.*",
        cognition=CognitionBlock(
            recall="Player left immediately.",
            feeling="Neutral",
            valence=0.0,
            arousal=0.2,
            want="Stay dry",
            plan="Watch the door.",
        ),
        pre_turn=PreTurnAnalysis(
            user_sentiment="neutral",
            subtext_interpretation="Leaving bar",
            mentioned_entities=[],
            memory_search_queries=[],
            spatial_intent="stay",
        ),
        world_snapshot=root.world_snapshot.model_copy(update={"turn_id": "turn_gm_1b"}),
        character_state=root.character_state.model_copy(update={"turn_id": "turn_gm_1b"}),
        recalled_items=[],
    )

    # Set active branch back to turn1
    repo.checkout_turn_branch(campaign.id, turn1.id, owner_id=owner_id)
    bundle = repo.get_campaign_state_bundle(campaign.id, owner_id=owner_id)

    return {
        "world": world,
        "persona": persona,
        "char": char,
        "campaign": bundle.campaign,
        "bundle": bundle,
        "root": root,
        "turn1": turn1,
        "turn1b": turn1b,
        "loc_bar": next(l for l in world.locations if l.name == "Main Bar"),
        "loc_vault": next(l for l in world.locations if l.name == "Sub-Zero Vault"),
        "cont_cantina": world.containers[0],
        "rev_secret_id": rev_secret.id,
        "unrev_secret_id": unrev_secret.id,
    }


def test_gm_prompt_and_reasoning_filter_hygiene() -> None:
    assert PROMPT_KEY_GM_TALK_SYSTEM in ALL_PROMPT_KEYS
    assert PROMPT_KEY_GM_TALK_SYSTEM in FACTORY_DEFAULT_PROMPTS
    assert "Neuromancer" in FACTORY_DEFAULT_PROMPTS[PROMPT_KEY_GM_TALK_SYSTEM]

    raw = "<think>secret chain\nwith <nested> stuff</think>Hello player. a < b and c > d."
    assert strip_reasoning_blocks(raw) == "Hello player. a < b and c > d."
    assert strip_reasoning_blocks("<thought>unclosed reasoning") == ""

    # Streaming tag filter handles tags split across arbitrary token boundaries
    stream_filter = ReasoningTagStreamFilter()
    chunks = ["<th", "ink>internal", " reasoning</th", "ink>Visible ", "answer < 10"]
    out = "".join(stream_filter.feed(c) for c in chunks) + stream_filter.flush()
    assert out == "Visible answer < 10"


def test_schema_migration_and_profile_gm_settings(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_prefs_user")

    # Verify fresh DB schema has gm_chat_messages and user_model_settings GM columns
    conn = sqlite3.connect(repo.db_path)
    try:
        ums_cols = {r[1] for r in conn.execute("PRAGMA table_info(user_model_settings)").fetchall()}
        assert {"gm_model_role", "gm_temperature", "gm_max_tokens"}.issubset(ums_cols)
        gm_cols = {r[1] for r in conn.execute("PRAGMA table_info(gm_chat_messages)").fetchall()}
        assert {"id", "campaign_id", "anchor_turn_id", "role", "content", "mentions_json", "sources_json"}.issubset(gm_cols)
    finally:
        conn.close()

    # Check defaults via API
    settings.allow_user_model_overrides = True
    res = client.get("/api/profile/models", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["default_gm_model_role"] == "primary"
    assert body["default_gm_temperature"] == 0.5
    assert body["default_gm_max_tokens"] == 1024
    assert body["effective_gm_model_role"] == "primary"
    assert body["effective_gm_temperature"] == 0.5
    assert body["effective_gm_max_tokens"] == 1024

    # Update GM behavior settings to clerk, temp=0.35, max_tokens=1536
    put_payload = {
        "working_memory_turns": 12,
        "gm_model_role": "clerk",
        "gm_temperature": 0.35,
        "gm_max_tokens": 1536,
    }
    put_res = client.put("/api/profile/models", headers=headers, json=put_payload)
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["has_override"] is True
    assert updated["user_gm_model_role"] == "clerk"
    assert updated["effective_gm_model_role"] == "clerk"
    assert updated["effective_gm_temperature"] == 0.35
    assert updated["effective_gm_max_tokens"] == 1536

    # Verify resolve_gm_profile picks clerk when not mirrored, and falls back to actor when mirrored
    eff = resolve_effective_models(user_id)
    gm_prof, eff_role = resolve_gm_profile(eff)
    assert eff_role == "clerk"
    assert gm_prof.temperature == 0.35
    assert gm_prof.max_tokens == 1536
    assert gm_prof.context_size == eff.clerk.context_size

    eff.clerk_mirrors_actor = True
    mirrored_prof, mirrored_role = resolve_gm_profile(eff)
    assert mirrored_role == "primary"
    assert mirrored_prof.model == eff.actor.model
    assert mirrored_prof.context_size == eff.actor.context_size
    assert mirrored_prof.temperature == 0.35


@pytest.mark.asyncio
async def test_gm_three_layer_unlock_lore_gating_and_mention_pinning(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_spoiler_user")
    seeded = _seed_rich_campaign(repo, user_id)
    cid = seeded["campaign"].id

    # 1. With unlock_lore=False (default):
    # - Mentions API omits unrevealed secrets and unvisited locations, keeps discovered secrets
    mentions_res = client.get(f"/api/campaigns/{cid}/gm/mentions", headers=headers)
    assert mentions_res.status_code == 200
    labels = {item["label"] for item in mentions_res.json()["items"]}
    assert "Helios Blackout of 2091" in labels
    assert "Courier Drop Signal" in labels  # revealed_lore_ids
    assert "Bartender's Killswitch" not in labels  # unrevealed location secret
    assert "Hidden Smuggler Hatch" not in labels  # unrevealed container secret
    assert "Sub-Zero Vault" not in labels  # unvisited location
    assert "Vault Cryo Coolant" not in labels  # lore on unvisited location
    assert "Deckard Zero" in labels  # persona
    assert "Kira Voss" in labels  # character
    assert "The Neon Cantina" in labels  # active container
    assert "Turn 1" in labels

    # - Turns category returns reverse-chronological order without <cognition> leakage
    turns_res = client.get(
        f"/api/campaigns/{cid}/gm/mentions",
        params={"category": "turns", "q": "1"},
        headers=headers,
    )
    assert turns_res.status_code == 200
    turn_items = turns_res.json()["items"]
    assert turn_items[0]["label"] == "Turn 1"
    assert "Protect the vault secret" not in json.dumps(turn_items)

    # - Context & hybrid RAG enforce unlock_lore=False and ignore unpermitted @ pins
    prep_safe = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="Tell me about the killswitch, vault coolant, and @Turn 1",
        mentions=[
            GmMentionRef(kind="lore", id=seeded["unrev_secret_id"], label="Bartender's Killswitch"),
            GmMentionRef(kind="location", id=seeded["loc_vault"].id, label="Sub-Zero Vault"),
            GmMentionRef(kind="character", id=seeded["char"].id, label="Kira Voss"),
            GmMentionRef(kind="persona", id=seeded["persona"].id, label="Deckard Zero"),
            GmMentionRef(kind="container", id=seeded["cont_cantina"].id, label="The Neon Cantina"),
            GmMentionRef(kind="lore", id=seeded["rev_secret_id"], label="Courier Drop Signal"),
        ],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
    )
    sys_safe = prep_safe.messages[0]["content"]
    assert prep_safe.unlock_lore is False
    assert "SPOILER-SAFE MODE ACTIVE" in sys_safe
    assert "Toby keeps a remote EMP detonator" not in sys_safe
    assert "Coolant lines run at minus forty" not in sys_safe
    assert "Protect the vault secret from outsiders" not in sys_safe
    assert "Keep the safehouse independent." not in sys_safe
    # Legitimately revealed secret + inline @Turn 1 + permitted pins ARE present
    assert "Ordering blue sake twice" in sys_safe
    assert "Independent netrunner" in sys_safe
    assert "subterranean noodle bar" in sys_safe
    assert "### Pinned Turn 1" in sys_safe

    # 2. Enable Unlock Lore & Secrets (GM Mode) -> unlock_lore=True
    repo.update_campaign_world_settings(
        cid,
        CampaignWorldSettings(describe_on_first_visit=True, unlock_lore=True),
        owner_id=user_id,
    )
    mentions_unlocked = client.get(f"/api/campaigns/{cid}/gm/mentions", headers=headers)
    assert mentions_unlocked.status_code == 200
    labels_unlocked = {item["label"] for item in mentions_unlocked.json()["items"]}
    assert "Bartender's Killswitch" in labels_unlocked
    assert "Hidden Smuggler Hatch" in labels_unlocked
    assert "Sub-Zero Vault" in labels_unlocked
    assert "Vault Cryo Coolant" in labels_unlocked

    prep_gm = await build_gm_context_and_messages(
        repo,
        campaign_id=cid,
        owner_id=user_id,
        user_message="What is the killswitch and hatch?",
        mentions=[
            GmMentionRef(kind="lore", id=seeded["unrev_secret_id"], label="Bartender's Killswitch"),
        ],
        working_memory_turns=12,
        context_size=8192,
        gm_max_tokens=1024,
        resolved_prompts=dict(FACTORY_DEFAULT_PROMPTS),
    )
    sys_gm = prep_gm.messages[0]["content"]
    assert prep_gm.unlock_lore is True
    assert "GM MODE ACTIVE" in sys_gm
    assert "Toby keeps a remote EMP detonator" in sys_gm
    assert "biometric floor hatch" in sys_gm  # keyword fallback retrieves unrevealed secret
    assert "Protect the vault secret from outsiders" in sys_gm
    assert "Keep the safehouse independent." in sys_gm


def test_gm_sse_stream_zero_mutation_branch_safety_and_error_hygiene(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_stream_user")
    seeded = _seed_rich_campaign(repo, user_id)
    cid = seeded["campaign"].id
    turn1_id = seeded["turn1"].id
    turn1b_id = seeded["turn1b"].id

    before_turns = len(repo.list_campaign_turn_nodes(cid))
    before_bundle = repo.get_campaign_state_bundle(cid, owner_id=user_id)

    class FakeLLM:
        async def stream_chat(
            self,
            messages: list[dict[str, str]],
            *,
            profile: ModelProfile | None = None,
            disable_reasoning: bool = False,
        ) -> AsyncIterator[str]:
            assert disable_reasoning is True
            assert profile is not None
            assert profile.temperature == 0.5
            yield "<think>checking canon</think>"
            yield "In Turn 1, you signaled "
            yield "with blue sake."

    monkeypatch.setattr(campaigns_facade, "llm_client", FakeLLM())

    # 1. Stream GM response on Turn 1 branch
    res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={
            "message": "What happened in @Turn 1?",
            "mentions": [{"kind": "turn", "id": turn1_id, "label": "Turn 1"}],
        },
    )
    assert res.status_code == 200
    events = _parse_sse_events(res.text)
    ev_names = [e[0] for e in events]
    assert ev_names[0] == "meta"
    assert "token" in ev_names
    assert ev_names[-1] == "done"
    done_payload = events[-1][1]
    assert done_payload["user_message"]["anchor_turn_id"] == turn1_id
    assert done_payload["assistant_message"]["content"] == "In Turn 1, you signaled with blue sake."
    assert "<think>" not in done_payload["assistant_message"]["content"]

    # Zero campaign mutation verified
    after_turns = len(repo.list_campaign_turn_nodes(cid))
    after_bundle = repo.get_campaign_state_bundle(cid, owner_id=user_id)
    assert after_turns == before_turns
    assert after_bundle.current_world_snapshot == before_bundle.current_world_snapshot

    # 2. Branch isolation: switch to sibling branch Turn 1B -> Turn 1 GM chat is invisible
    repo.checkout_turn_branch(cid, turn1b_id, owner_id=user_id)
    hist_b = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert hist_b.status_code == 200
    assert hist_b.json()["messages"] == []

    # Create a message on Branch B
    res_b = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Where did I walk?", "mentions": []},
    )
    assert res_b.status_code == 200

    # Clear Branch B -> Branch A remains intact!
    clr_b = client.delete(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert clr_b.status_code == 200
    assert clr_b.json()["deleted"] == 2

    repo.checkout_turn_branch(cid, turn1_id, owner_id=user_id)
    hist_a = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert len(hist_a.json()["messages"]) == 2

    # 3. Deleting Turn 1 cascades its anchored GM messages cleanly
    repo.delete_last_turn(cid, owner_id=user_id)
    hist_root = client.get(f"/api/campaigns/{cid}/gm/messages", headers=headers)
    assert hist_root.json()["messages"] == []

    # 4. Sanitized error handling when offline fallback is disabled (never exposes raw str(exc))
    monkeypatch.setattr(settings, "allow_offline_fallback", False)

    class BrokenLLM:
        async def stream_chat(self, *args: Any, **kwargs: Any) -> AsyncIterator[str]:
            raise RuntimeError("SECRET_INTERNAL_TRACE_12345")
            yield ""  # pragma: no cover

    monkeypatch.setattr(campaigns_facade, "llm_client", BrokenLLM())
    err_res = client.post(
        f"/api/campaigns/{cid}/gm/chat",
        headers=headers,
        json={"message": "Any updates?", "mentions": []},
    )
    assert err_res.status_code == 200
    err_events = _parse_sse_events(err_res.text)
    assert err_events[-1][0] == "error"
    assert "SECRET_INTERNAL_TRACE_12345" not in err_events[-1][1]["detail"]


def test_zcc_campaign_export_import_gm_chat_toggle(
    api_env: tuple[TestClient, CantinaRepository, Path],
    api_user_factory,
) -> None:
    client, repo, _ = api_env
    headers, user_id, _ = api_user_factory("gm_export_user")
    seeded = _seed_rich_campaign(repo, user_id)
    cid = seeded["campaign"].id
    turn1_id = seeded["turn1"].id

    repo.append_gm_message_pair(
        campaign_id=cid,
        anchor_turn_id=turn1_id,
        user_content="Summarize @Turn 1",
        user_mentions=[GmMentionRef(kind="turn", id=turn1_id, label="Turn 1")],
        assistant_content="You ordered blue sake.",
        sources=[],
    )

    # 1. Default export (include_gm_chat omitted / False) omits gm_chat_messages
    exp_default = client.post(
        f"/api/export/campaign/{cid}",
        headers=headers,
        json={"timeline_scope": "full"},
    )
    assert exp_default.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp_default.content), "r") as zf:
        camps_default = json.loads(zf.read("campaigns.json"))
        assert camps_default[0]["gm_chat_messages"] == []

    # 2. Export with include_gm_chat=True bundles gm_chat_messages & round-trips on import
    exp_with_gm = client.post(
        f"/api/export/campaign/{cid}",
        headers=headers,
        json={"timeline_scope": "full", "include_gm_chat": True},
    )
    assert exp_with_gm.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exp_with_gm.content), "r") as zf:
        camps_with_gm = json.loads(zf.read("campaigns.json"))
        assert len(camps_with_gm[0]["gm_chat_messages"]) == 2

    inspect_res = client.post(
        "/api/import/inspect",
        headers=headers,
        files={"file": ("campaign_gm.zcc", exp_with_gm.content, "application/octet-stream")},
    )
    assert inspect_res.status_code == 200
    staged_token = inspect_res.json()["staged_token"]
    commit_res = client.post(
        "/api/import/commit",
        headers=headers,
        json={"staged_token": staged_token, "conflict_strategy": "copy"},
    )
    assert commit_res.status_code == 200

    all_camps = repo.list_campaigns(owner_id=user_id)
    imported_camp = next(c for c in all_camps if c.id != cid)
    imported_bundle = repo.get_campaign_state_bundle(imported_camp.id, owner_id=user_id)
    imported_turns = {t.id for t in imported_bundle.active_branch_turns}
    imported_gm = repo.list_gm_messages_for_branch(imported_camp.id, imported_turns)
    assert len(imported_gm) == 2
    assert imported_gm[0].content == "Summarize @Turn 1"
    assert imported_gm[0].anchor_turn_id in imported_turns
    assert imported_gm[0].anchor_turn_id != turn1_id
    assert imported_gm[0].mentions[0].id in imported_turns
    assert imported_gm[1].content == "You ordered blue sake."
