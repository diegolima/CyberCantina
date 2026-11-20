"""Unit and integration tests for v0.27.0 Turn Context Telemetry & Context Health."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

import pytest

from app.config import ModelProfile
from app.db.repository import CantinaRepository
from app.engine.context.assembler import assemble_four_zone_messages
from app.engine.llm_client import LLMClient
from app.engine.telemetry import (
    TurnTelemetryCollector,
    active_turn_telemetry,
    classify_phase_telemetry,
    telemetry_phase_scope,
)
from app.providers.endpoint import ResolvedEndpoint
from app.schemas.character import BaselinePsyche, CharacterRecord, CharacterStateSnapshot, CognitionBlock
from app.schemas.telemetry import LlmCallTelemetry, Phase4BudgetReport
from app.schemas.turn import PreTurnAnalysis, TurnNodeRecord, WorldStateSnapshot
from app.schemas.world import LocationNode, WorldRecord


# ---------------------------------------------------------------------------
# 1. Health Classification & Collector Rules
# ---------------------------------------------------------------------------


def test_classify_idle_when_no_calls_or_budget() -> None:
    summary = classify_phase_telemetry("phase3_cognition", [])
    assert summary.status == "idle"
    assert summary.call_count == 0
    assert summary.peak_utilization_pct is None
    assert summary.usage_source == "none"


def test_classify_healthy_and_peak_single_call_utilization() -> None:
    calls = [
        LlmCallTelemetry(
            phase="phase3_cognition",
            label="Cognition: Mira",
            model="llama3",
            provider_type="ollama",
            prompt_tokens=2000,
            completion_tokens=120,
            usage_source="exact",
            context_ceiling=8192,
            finish_reason="stop",
        ),
        LlmCallTelemetry(
            phase="phase3_cognition",
            label="Cognition: Jax",
            model="llama3",
            provider_type="ollama",
            prompt_tokens=4096,
            completion_tokens=140,
            usage_source="exact",
            context_ceiling=8192,
            finish_reason="stop",
        ),
    ]
    summary = classify_phase_telemetry("phase3_cognition", calls)
    assert summary.status == "healthy"
    assert summary.call_count == 2
    assert summary.peak_prompt_tokens == 4096
    assert summary.total_prompt_tokens == 6096
    assert summary.total_completion_tokens == 260
    assert summary.peak_utilization_pct == 50.0
    assert summary.usage_source == "exact"
    assert summary.dropped_summary is None
    assert summary.cropped_summary is None


def test_classify_warning_on_zone3_and_zone2_drops() -> None:
    call = LlmCallTelemetry(
        phase="phase4_prose",
        label="Prose: Mira",
        model="llama3",
        provider_type="ollama",
        prompt_tokens=9200,
        completion_tokens=300,
        usage_source="exact",
        context_ceiling=12288,
        finish_reason="stop",
    )
    report = Phase4BudgetReport(
        context_ceiling=12288,
        reserved_output_tokens=1024,
        input_budget=11008,
        zone1_tokens=4000,
        zone2_tokens=1500,
        zone3_tokens=2000,
        zone4_tokens=1700,
        total_zone3_turns_available=8,
        dropped_zone3_turns=2,
        trimmed_below_min_wm=False,
        total_zone2_chunks_available=4,
        downgraded_zone2_chunks=1,
        dropped_zone2_chunks=0,
        base_exceeds_budget=False,
    )
    summary = classify_phase_telemetry("phase4_prose", [call], report)
    assert summary.status == "warning"
    assert summary.dropped_summary is not None
    assert "2 working-memory turns dropped" in summary.dropped_summary
    assert "1 episodic chunk downgraded" in summary.dropped_summary
    assert summary.cropped_summary is None


def test_classify_warning_on_90_percent_fill() -> None:
    call = LlmCallTelemetry(
        phase="phase1_pre",
        label="Pre-Turn Analysis",
        model="llama3",
        provider_type="ollama",
        prompt_tokens=7500,
        completion_tokens=100,
        usage_source="exact",
        context_ceiling=8192,
        finish_reason="stop",
    )
    summary = classify_phase_telemetry("phase1_pre", [call])
    assert summary.status == "warning"
    assert summary.peak_utilization_pct is not None and summary.peak_utilization_pct >= 90.0


@pytest.mark.parametrize(
    "case_name,call_kwargs,report",
    [
        (
            "base_exceeds_budget",
            {"prompt_tokens": 7000, "context_ceiling": 8192, "finish_reason": "stop"},
            Phase4BudgetReport(
                context_ceiling=8192,
                input_budget=6912,
                zone1_tokens=5000,
                zone4_tokens=2500,
                base_exceeds_budget=True,
                estimated_cropped_tokens=588,
            ),
        ),
        (
            "trimmed_below_min_wm",
            {"prompt_tokens": 6800, "context_ceiling": 8192, "finish_reason": "stop"},
            Phase4BudgetReport(
                context_ceiling=8192,
                input_budget=6912,
                dropped_zone3_turns=4,
                trimmed_below_min_wm=True,
            ),
        ),
        (
            "provider_prompt_hit_ceiling",
            {"prompt_tokens": 8192, "context_ceiling": 8192, "finish_reason": "stop"},
            None,
        ),
        (
            "output_truncated_length",
            {"prompt_tokens": 3000, "context_ceiling": 8192, "finish_reason": "length"},
            None,
        ),
    ],
)
def test_classify_critical_triggers(
    case_name: str,
    call_kwargs: dict[str, Any],
    report: Phase4BudgetReport | None,
) -> None:
    call = LlmCallTelemetry(
        phase="phase4_prose",
        label=case_name,
        model="llama3",
        provider_type="ollama",
        completion_tokens=512,
        usage_source="exact",
        **call_kwargs,
    )
    summary = classify_phase_telemetry("phase4_prose", [call], report)
    assert summary.status == "critical"
    assert summary.cropped_summary is not None


def test_unknown_ceiling_still_flags_output_truncation() -> None:
    healthy_call = LlmCallTelemetry(
        phase="phase4_prose",
        label="Prose",
        model="gpt-4o-mini",
        provider_type="openai_compat",
        prompt_tokens=3200,
        completion_tokens=400,
        usage_source="exact",
        context_ceiling=None,
        finish_reason="stop",
    )
    s_ok = classify_phase_telemetry("phase4_prose", [healthy_call])
    assert s_ok.status == "healthy"
    assert s_ok.peak_utilization_pct is None

    trunc_call = healthy_call.model_copy(update={"finish_reason": "length"})
    s_crit = classify_phase_telemetry("phase4_prose", [trunc_call])
    assert s_crit.status == "critical"
    assert s_crit.truncated_output is True


def test_collector_rolls_up_overall_worst_status() -> None:
    collector = TurnTelemetryCollector()
    collector.record_call(
        LlmCallTelemetry(
            phase="phase1_pre",
            label="Pre-Turn",
            prompt_tokens=900,
            completion_tokens=80,
            usage_source="exact",
            context_ceiling=8192,
            finish_reason="stop",
        )
    )
    collector.record_call(
        LlmCallTelemetry(
            phase="phase4_prose",
            label="Prose",
            prompt_tokens=5000,
            completion_tokens=300,
            usage_source="estimated",
            context_ceiling=12288,
            finish_reason="stop",
        )
    )
    collector.set_phase4_budget(
        Phase4BudgetReport(
            context_ceiling=12288,
            dropped_zone3_turns=1,
        )
    )
    snap = collector.build_snapshot(phase5_pending=True)
    assert snap.overall_status == "warning"
    assert snap.usage_source == "mixed"
    assert snap.phase5_pending is True
    assert snap.phases["phase1_pre"].status == "healthy"
    assert snap.phases["phase3_cognition"].status == "idle"
    assert snap.phases["phase4_prose"].status == "warning"
    assert snap.phases["phase5_clerk"].status == "idle"


# ---------------------------------------------------------------------------
# 2. LLMClient Usage Extraction (Ollama + OpenAI-Compat + Fallback)
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or json.dumps(self._payload)

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeStreamResponse:
    def __init__(self, status_code: int, lines: list[str], body: str = "") -> None:
        self.status_code = status_code
        self._lines = lines
        self._body = body

    async def __aenter__(self) -> _FakeStreamResponse:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def aread(self) -> bytes:
        return self._body.encode("utf-8")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _FakeHttpClient:
    def __init__(self, post_responses: list[_FakeResponse] | None = None, stream_responses: list[_FakeStreamResponse] | None = None) -> None:
        self.post_responses = list(post_responses or [])
        self.stream_responses = list(stream_responses or [])
        self.seen_payloads: list[dict[str, Any]] = []

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any], timeout: float) -> _FakeResponse:
        self.seen_payloads.append(json)
        return self.post_responses.pop(0)

    def stream(self, method: str, url: str, *, headers: dict[str, str], json: dict[str, Any], timeout: float) -> _FakeStreamResponse:
        self.seen_payloads.append(json)
        return self.stream_responses.pop(0)


@pytest.mark.asyncio
async def test_llm_client_captures_exact_ollama_usage() -> None:
    client = LLMClient()
    fake_http = _FakeHttpClient(
        post_responses=[
            _FakeResponse(
                200,
                {
                    "message": {"content": '{"ok": true}'},
                    "prompt_eval_count": 1432,
                    "eval_count": 98,
                    "done_reason": "stop",
                },
            )
        ],
        stream_responses=[
            _FakeStreamResponse(
                200,
                [
                    json.dumps({"message": {"content": "Hello "}, "done": False}),
                    json.dumps(
                        {
                            "message": {"content": "world."},
                            "done": True,
                            "prompt_eval_count": 3210,
                            "eval_count": 42,
                            "done_reason": "stop",
                        }
                    ),
                ],
            )
        ],
    )

    async def _get_http(*, timeout: float = 120.0) -> _FakeHttpClient:
        return fake_http

    client.get_http_client = _get_http  # type: ignore[method-assign]
    profile = ModelProfile(
        model="gemma3:12b",
        context_size=8192,
        resolved=ResolvedEndpoint(
            provider_id="p_ollama",
            type="ollama",
            root_url="http://localhost:11434",
            credential_storage="none",
        ),
    )

    collector = TurnTelemetryCollector()
    tok = active_turn_telemetry.set(collector)
    try:
        with telemetry_phase_scope("phase1_pre", "Pre-Turn Analysis"):
            out = await client.complete_text(
                [{"role": "user", "content": "Look around."}],
                profile=profile,
            )
        assert out == '{"ok": true}'

        chunks: list[str] = []
        with telemetry_phase_scope("phase4_prose", "Prose: Mira"):
            async for d in client.stream_chat(
                [{"role": "user", "content": "Look around."}],
                profile=profile,
            ):
                chunks.append(d)
        assert "".join(chunks) == "Hello world."
    finally:
        active_turn_telemetry.reset(tok)

    snap = collector.build_snapshot()
    assert snap.usage_source == "exact"
    assert snap.phases["phase1_pre"].peak_prompt_tokens == 1432
    assert snap.phases["phase1_pre"].total_completion_tokens == 98
    assert snap.phases["phase4_prose"].peak_prompt_tokens == 3210
    assert snap.phases["phase4_prose"].total_completion_tokens == 42
    assert snap.phases["phase4_prose"].context_ceiling == 8192


@pytest.mark.asyncio
async def test_llm_client_openai_stream_retries_without_stream_options_and_estimates() -> None:
    client = LLMClient()
    fake_http = _FakeHttpClient(
        stream_responses=[
            _FakeStreamResponse(400, [], body='{"error": "Unsupported parameter: stream_options"}'),
            _FakeStreamResponse(
                200,
                [
                    'data: {"choices": [{"delta": {"content": "Hi there!"}}]}',
                    'data: {"choices": [{"delta": {}, "finish_reason": "stop"}]}',
                    "data: [DONE]",
                ],
            ),
        ]
    )

    async def _get_http(*, timeout: float = 120.0) -> _FakeHttpClient:
        return fake_http

    client.get_http_client = _get_http  # type: ignore[method-assign]
    profile = ModelProfile(
        model="local-vllm-model",
        resolved=ResolvedEndpoint(
            provider_id="p_oai",
            type="openai_compat",
            root_url="http://localhost:8000/v1",
            credential_storage="none",
        ),
    )

    collector = TurnTelemetryCollector()
    tok = active_turn_telemetry.set(collector)
    try:
        chunks: list[str] = []
        with telemetry_phase_scope("phase4_prose", "Prose: Mira"):
            async for d in client.stream_chat(
                [{"role": "user", "content": "Test prompt"}],
                profile=profile,
            ):
                chunks.append(d)
        assert "".join(chunks) == "Hi there!"
    finally:
        active_turn_telemetry.reset(tok)

    assert "stream_options" in fake_http.seen_payloads[0]
    assert "stream_options" not in fake_http.seen_payloads[1]
    snap = collector.build_snapshot()
    p4 = snap.phases["phase4_prose"]
    assert p4.usage_source == "estimated"
    assert p4.peak_prompt_tokens > 0
    assert p4.total_completion_tokens > 0
    assert p4.status == "healthy"


# ---------------------------------------------------------------------------
# 3. Phase 4 Assembler Budget Report
# ---------------------------------------------------------------------------


def test_assemble_four_zone_messages_emits_budget_report() -> None:
    world = WorldRecord(
        id="w1",
        name="Test World",
        global_rules={"genre": "Sci-Fi", "setting_overview": "An orbital dock."},
        created_at="2026-01-01T00:00:00Z",
    )
    loc = LocationNode(id="loc1", world_id="w1", name="Dock", summary="A dock.", description="Wet concrete.")
    char = CharacterRecord(
        id="c1",
        name="Mira",
        tagline="Scout",
        core_persona="Careful scout.",
        communication_style=["Brief."],
        baseline_psyche=BaselinePsyche(
            core_drive="Survive",
            core_fear="Betrayal",
            default_want="Find exit",
            default_plan="Scan room",
        ),
        initial_mood="Alert",
        initial_want="Find exit",
        initial_plan="Scan room",
        created_at="2026-01-01T00:00:00Z",
    )
    base_state = CharacterStateSnapshot(
        turn_id="t0",
        character_id="c1",
        current_location_id="loc1",
        mood_label="Alert",
        active_want="Find exit",
        active_plan="Scan room",
    )
    ws = WorldStateSnapshot(turn_id="t0", world_timestamp="Day 1, 08:00", active_location_id="loc1")
    turns = [
        TurnNodeRecord(
            id=f"t{i}",
            campaign_id="camp1",
            parent_turn_id=f"t{i-1}" if i > 0 else None,
            depth_index=i,
            user_message=f"Turn {i} message " + ("details " * 40),
            actor_id="c1",
            raw_prose=f"Turn {i} prose response " + ("narrative " * 60),
            cognition=CognitionBlock(recall="ok", feeling="Alert", want="go", plan="move"),
            pre_turn=PreTurnAnalysis(),
            world_snapshot=ws,
            character_state=base_state,
            created_at="2026-01-01T00:00:00Z",
        )
        for i in range(6)
    ]

    reports: list[Phase4BudgetReport] = []
    assemble_four_zone_messages(
        world=world,
        character=char,
        branch_turns=turns,
        episodic_chunks=[],
        active_location=loc,
        neighbors=[],
        recalled_items=[],
        pre_turn=PreTurnAnalysis(),
        user_message="What now?",
        present_characters=[char],
        max_context_tokens=2048,
        reserved_output_tokens=256,
        min_working_memory_turns=1,
        budget_report_out=reports,
    )
    assert len(reports) == 1
    rep = reports[0]
    assert rep.context_ceiling == 2048
    assert rep.zone1_tokens > 0
    assert rep.zone4_tokens > 0
    assert rep.dropped_zone3_turns > 0


# ---------------------------------------------------------------------------
# 4. SQLite Persistence & Migration Round-Trip
# ---------------------------------------------------------------------------


def test_turn_telemetry_persists_and_migrates(empty_repo: CantinaRepository) -> None:
    from app.db.seed import seed_showcase_for_user

    repo = empty_repo
    seed_showcase_for_user(repo, user_id=None)

    # Verify telemetry_json column exists on fresh DB
    conn = sqlite3.connect(repo.db_path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(turn_nodes)").fetchall()}
    conn.close()
    assert "telemetry_json" in cols

    worlds = repo.list_worlds()
    chars = repo.list_characters()
    assert worlds and chars
    camp = repo.create_campaign(
        name="Telemetry Camp",
        world_id=worlds[0].id,
        character_id=chars[0].id,
    )
    root_turn = repo.get_turn_node(camp.active_leaf_turn_id)  # type: ignore[arg-type]
    assert root_turn.telemetry is None
    char_id = camp.character_id
    loc_id = root_turn.world_snapshot.active_location_id

    collector = TurnTelemetryCollector()
    collector.record_call(
        LlmCallTelemetry(
            phase="phase4_prose",
            label="Prose: Mira",
            model="gemma3:12b",
            provider_type="ollama",
            prompt_tokens=2400,
            completion_tokens=180,
            usage_source="exact",
            context_ceiling=12288,
            finish_reason="stop",
        )
    )
    provisional = collector.build_snapshot(phase5_pending=True)
    saved = repo.save_turn_node(
        turn_id="turn_t1",
        campaign_id=camp.id,
        parent_turn_id=root_turn.id,
        depth_index=root_turn.depth_index + 1,
        user_message="Hello",
        actor_id=char_id,
        raw_prose="Hi.",
        cognition=CognitionBlock(recall="", feeling="Calm", want="Talk", plan="Reply"),
        pre_turn=PreTurnAnalysis(),
        world_snapshot=WorldStateSnapshot(
            turn_id="turn_t1",
            world_timestamp="Day 1, 08:05",
            active_location_id=loc_id,
        ),
        character_state=CharacterStateSnapshot(
            turn_id="turn_t1",
            character_id=char_id,
            current_location_id=loc_id,
            mood_label="Calm",
            active_want="Talk",
            active_plan="Reply",
        ),
        recalled_items=[],
        telemetry=provisional,
    )
    assert saved.telemetry is not None
    assert saved.telemetry.phase5_pending is True
    assert saved.telemetry.overall_status == "healthy"

    collector.record_call(
        LlmCallTelemetry(
            phase="phase5_clerk",
            label="World Clerk",
            model="gemma3:12b",
            provider_type="ollama",
            prompt_tokens=1100,
            completion_tokens=90,
            usage_source="exact",
            context_ceiling=8192,
            finish_reason="stop",
        )
    )
    final_snap = collector.build_snapshot(phase5_pending=False)
    repo.update_turn_telemetry("turn_t1", final_snap)

    reloaded = repo.get_turn_node("turn_t1")
    assert reloaded.telemetry is not None
    assert reloaded.telemetry.phase5_pending is False
    assert reloaded.telemetry.phases["phase5_clerk"].peak_prompt_tokens == 1100
    assert reloaded.telemetry.total_prompt_tokens == 3500
