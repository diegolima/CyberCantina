"""Tests for Clerk 'Run on CPU' (Ollama num_gpu=0) and model separation safety guards."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import httpx

from app.config import ModelProfile, settings
from app.db.repository import CantinaRepository
from app.dependencies import (
    is_separate_clerk_model,
    normalize_model_tag,
    resolve_effective_models,
)
from app.engine.llm_client import LLMClient, format_ollama_keep_alive
from app.providers.endpoint import ResolvedEndpoint


def test_format_ollama_keep_alive() -> None:
    assert format_ollama_keep_alive(30) == "30m"
    assert format_ollama_keep_alive(60) == "60m"
    assert format_ollama_keep_alive(0) == 0
    assert format_ollama_keep_alive(-1) == "-1"
    assert format_ollama_keep_alive(None) == "30m"


def test_normalize_model_tag() -> None:
    assert normalize_model_tag("llama3.1:8b") == "llama3.1:8b"
    assert normalize_model_tag("llama3.1:8b:latest") == "llama3.1:8b"
    assert normalize_model_tag("Qwen2.5:3B:LATEST") == "qwen2.5:3b"
    assert normalize_model_tag("  Mistral:Latest  ") == "mistral"
    assert normalize_model_tag("") == ""


def test_is_separate_clerk_model_mirroring() -> None:
    actor = ModelProfile(model="llama3.1:8b")
    clerk = ModelProfile(model="qwen2.5:3b")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=True) is False


def test_is_separate_clerk_model_same_model_and_host() -> None:
    actor = ModelProfile(model="llama3.1:8b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="llama3.1:8b:latest", base_url="http://127.0.0.1:11434/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is False


def test_is_separate_clerk_model_different_models() -> None:
    actor = ModelProfile(model="llama3.1:8b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11434/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is True


def test_is_separate_clerk_model_same_model_different_hosts() -> None:
    actor = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11434/v1")
    clerk = ModelProfile(model="qwen2.5:3b", base_url="http://localhost:11435/v1")
    assert is_separate_clerk_model(actor, clerk, clerk_mirrors_actor=False) is True


def test_resolve_effective_models_safety_override(monkeypatch: pytest.MonkeyPatch) -> None:
    # 1. When clerk and actor are separate and run_on_cpu is requested -> preserved
    monkeypatch.setattr(settings.actor_profile, "model", "llama3.1:8b")
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.clerk_profile, "run_on_cpu", True)
    monkeypatch.setattr(settings, "clerk_mirrors_actor", False)

    eff = resolve_effective_models(None)
    assert eff.clerk.run_on_cpu is True

    # 2. When clerk shares the same model as actor -> safety override forces False
    monkeypatch.setattr(settings.clerk_profile, "model", "llama3.1:8b:latest")
    eff_same = resolve_effective_models(None)
    assert eff_same.clerk.run_on_cpu is False

    # 3. When clerk mirrors actor -> safety override forces False
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings, "clerk_mirrors_actor", True)
    eff_mirror = resolve_effective_models(None)
    assert eff_mirror.clerk.run_on_cpu is False


@pytest.mark.asyncio
async def test_llm_client_injects_num_gpu_on_cpu_profile() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="qwen2.5:3b",
        base_url="http://localhost:11434/v1",
        run_on_cpu=True,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        resp = httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )
        return resp

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert req_json["options"]["num_gpu"] == 0


@pytest.mark.asyncio
async def test_llm_client_omits_num_gpu_when_run_on_cpu_is_false() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="llama3.1:8b",
        base_url="http://localhost:11434/v1",
        run_on_cpu=False,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        resp = httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )
        return resp

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert "num_gpu" not in req_json["options"]


@pytest.mark.asyncio
async def test_llm_client_injects_keep_alive() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="qwen2.5:3b",
        base_url="http://localhost:11434/v1",
        keep_alive_minutes=45,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        return httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert req_json["keep_alive"] == "45m"


@pytest.mark.asyncio
async def test_llm_client_omits_keep_alive_for_openrouter() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="meta-llama/llama-3.1-8b-instruct",
        base_url="https://openrouter.ai/api/v1",
        keep_alive_minutes=30,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_or",
        type="openrouter",
        root_url="https://openrouter.ai/api",
        bearer_token="sk-or-test",
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append({"url": str(url), "json": json})
        return httpx.Response(
            status_code=200,
            json={"choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", str(url)),
        )

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        req_json = captured_requests[0]["json"]
        assert "keep_alive" not in req_json


def test_resolve_effective_models_context_size_alignment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.actor_profile, "model", "llama3.1:8b")
    monkeypatch.setattr(settings.actor_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.actor_profile, "context_size", 16384)
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings.clerk_profile, "base_url", "http://localhost:11434/v1")
    monkeypatch.setattr(settings.clerk_profile, "context_size", 8192)
    monkeypatch.setattr(settings, "clerk_mirrors_actor", False)

    # 1. Separate models preserve independent context sizes
    eff_sep = resolve_effective_models(None)
    assert eff_sep.actor.context_size == 16384
    assert eff_sep.clerk.context_size == 8192

    # 2. Same model on same host aligns Clerk context_size to Actor to prevent runner reload thrashing
    monkeypatch.setattr(settings.clerk_profile, "model", "llama3.1:8b:latest")
    eff_same = resolve_effective_models(None)
    assert eff_same.clerk.context_size == 16384

    # 3. Mirroring Actor also aligns Clerk context_size to Actor
    monkeypatch.setattr(settings.clerk_profile, "model", "qwen2.5:3b")
    monkeypatch.setattr(settings, "clerk_mirrors_actor", True)
    eff_mirror = resolve_effective_models(None)
    assert eff_mirror.clerk.context_size == 16384


@pytest.mark.asyncio
async def test_llm_client_injects_num_ctx_across_primary_retry_and_stream() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="llama3.1:8b",
        base_url="http://localhost:11434/v1",
        context_size=12288,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_test",
        type="ollama",
        root_url="http://localhost:11434",
        bearer_token=None,
    )

    captured_requests: list[dict] = []
    call_count = 0

    def fake_post(url, headers, json, timeout):
        nonlocal call_count
        call_count += 1
        captured_requests.append(json)
        if call_count == 1:
            return httpx.Response(
                status_code=400,
                text="unknown parameter think",
                request=httpx.Request("POST", str(url)),
            )
        if call_count == 2:
            # Return empty content with done_reason=length to exercise fallback options builder too
            return httpx.Response(
                status_code=200,
                json={"message": {"content": ""}, "done": True, "done_reason": "length"},
                request=httpx.Request("POST", str(url)),
            )
        return httpx.Response(
            status_code=200,
            json={"message": {"content": "ok"}, "done": True},
            request=httpx.Request("POST", str(url)),
        )

    class _FakeStreamResp:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def aiter_lines(self):
            yield '{"message": {"content": "hi"}, "done": false}'
            yield '{"message": {"content": ""}, "done": true}'

    stream_payloads: list[dict] = []

    def fake_stream(method, url, headers, json, timeout):
        stream_payloads.append(json)
        return _FakeStreamResp()

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)
    mock_http.stream = fake_stream

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 3
        for req_json in captured_requests:
            assert req_json["options"]["num_ctx"] == 12288

        chunks = []
        async for delta in client.stream_chat([{"role": "user", "content": "ping"}], profile=profile):
            chunks.append(delta)
        assert "".join(chunks) == "hi"
        assert len(stream_payloads) == 1
        assert stream_payloads[0]["options"]["num_ctx"] == 12288


@pytest.mark.asyncio
async def test_llm_client_omits_num_ctx_for_openrouter() -> None:
    client = LLMClient()
    profile = ModelProfile(
        model="meta-llama/llama-3.1-8b-instruct",
        base_url="https://openrouter.ai/api/v1",
        context_size=12288,
    )
    profile.resolved = ResolvedEndpoint(
        provider_id="prov_or",
        type="openrouter",
        root_url="https://openrouter.ai/api",
        bearer_token="sk-or-test",
    )

    captured_requests: list[dict] = []

    def fake_post(url, headers, json, timeout):
        captured_requests.append(json)
        return httpx.Response(
            status_code=200,
            json={"choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", str(url)),
        )

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(side_effect=fake_post)

    with patch.object(client, "get_http_client", return_value=mock_http):
        res = await client.complete_text(
            [{"role": "user", "content": "ping"}],
            profile=profile,
        )
        assert res == "ok"
        assert len(captured_requests) == 1
        assert "num_ctx" not in captured_requests[0]
        assert "options" not in captured_requests[0]


def test_heuristic_post_turn_delta_time_cues_navigation_and_crisis_flags(
    empty_repo: CantinaRepository,
) -> None:
    """Exercise offline clerk time advancement, neighbor-word fallback, explore_new exterior, and resolved_roll crises."""
    from app.engine.clerk.heuristics import heuristic_post_turn_delta
    from app.schemas.turn import DiceRollResult, PreTurnAnalysis
    from tests.factories import seed_minimal_scenario

    scenario = seed_minimal_scenario(empty_repo)
    start_loc = scenario.locations[0]
    neighbors = empty_repo.get_neighbor_locations(scenario.world.id, start_loc.id)
    nb = neighbors[0]

    # 1. Neighbor-word fallback + explicit user time cue
    delta_move = heuristic_post_turn_delta(
        user_message="It's 5am now, let's head over to the " + nb.destination.name.split()[-1],
        raw_prose="You cross the rain-slick walkway.",
        pre_turn=PreTurnAnalysis(spatial_intent="move_known", target_location_hint="unmatched hint"),
        active_location=start_loc,
        neighbors=neighbors,
        current_timestamp="2094-11-15 02:00",
    )
    assert delta_move.transition_type == "move_existing"
    assert delta_move.target_location_id == nb.destination.id
    assert delta_move.new_world_timestamp == "2094-11-15 05:00"
    assert delta_move.elapsed_minutes == 180

    # 2. Explore new exterior space with room extraction
    delta_explore = heuristic_post_turn_delta(
        user_message="I step outside into the Neon Alley.",
        raw_prose="Cold drizzle hits the pavement.",
        pre_turn=PreTurnAnalysis(spatial_intent="explore_new"),
        active_location=start_loc,
        neighbors=neighbors,
    )
    assert delta_explore.transition_type == "improvise_new"
    assert delta_explore.improvised_location is not None
    assert delta_explore.improvised_location.name == "Neon Alley"
    assert delta_explore.improvised_location.is_exterior is True

    # 3. character_rolls + legacy resolved_roll Critical Failure triggers crisis flag
    roll = DiceRollResult(
        action_description="hack the blast door",
        skill_or_approach="Tech",
        d20_raw=1,
        modifier=0,
        total=1,
        difficulty_class=15,
        outcome_tier="Critical Failure",
        narrative_directive="Alarm trips.",
    )
    delta_char_roll = heuristic_post_turn_delta(
        user_message="Slice the panel.",
        raw_prose="*Sparks shower the corridor.*",
        pre_turn=PreTurnAnalysis(spatial_intent="stay", dice_mode="auto", character_rolls={"char_1": roll}),
        active_location=start_loc,
        neighbors=[],
    )
    assert delta_char_roll.notable_event_summary is not None
    assert "Critical Failure" in delta_char_roll.notable_event_summary
    assert any(flag.startswith("Crisis:") for flag in delta_char_roll.scene_flags_updated)

    delta_crisis = heuristic_post_turn_delta(
        user_message="Slice the panel.",
        raw_prose="*Sparks shower the corridor.*",
        pre_turn=PreTurnAnalysis.model_construct(spatial_intent="stay", resolved_roll=roll, character_rolls={}),
        active_location=start_loc,
        neighbors=[],
    )
    assert delta_crisis.notable_event_summary is not None
    assert "Critical Failure" in delta_crisis.notable_event_summary
    assert any(flag.startswith("Crisis:") for flag in delta_crisis.scene_flags_updated)

