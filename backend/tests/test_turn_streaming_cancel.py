"""Tests for client-initiated cancellation of campaign turn SSE streams."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.db.repository import CantinaRepository
from app.routers import campaigns as campaigns_facade
from app.routers.campaign_routes import turn_streaming
from app.schemas.character import CognitionBlock
from app.schemas.turn import Phase3ProgressEvent, PreTurnAnalysis, TurnSubmitRequest
from tests.factories import seed_campaign, seed_character, seed_user, seed_world


@pytest.mark.asyncio
async def test_phase3_worker_cancelled_on_stream_close(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = empty_repo
    user = seed_user(repo)
    world = seed_world(repo, owner_id=user.id)
    char = seed_character(repo, owner_id=user.id, world_id=world.id)
    camp = seed_campaign(
        repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=char.id,
    )

    p3_started = asyncio.Event()
    p3_cancelled = asyncio.Event()

    async def fake_phase1(**kwargs: Any) -> PreTurnAnalysis:
        return PreTurnAnalysis(active_speaker_id=char.id)

    async def fake_phase3(**kwargs: Any) -> dict[str, CognitionBlock]:
        on_progress = kwargs.get("on_progress")
        if on_progress is not None:
            await on_progress(
                Phase3ProgressEvent(
                    event="phase3_start",
                    dispatch_mode="sequential",
                    roster=[],
                )
            )
        p3_started.set()
        try:
            await asyncio.sleep(10)
            return {}
        except asyncio.CancelledError:
            p3_cancelled.set()
            raise

    monkeypatch.setattr(campaigns_facade, "run_phase1_pre_analysis", fake_phase1)
    monkeypatch.setattr(campaigns_facade, "run_phase3_multi_cognition", fake_phase3)
    monkeypatch.setattr(turn_streaming, "run_phase1_pre_analysis", fake_phase1)
    monkeypatch.setattr(turn_streaming, "run_phase3_multi_cognition", fake_phase3)

    gen = turn_streaming._execute_turn_stream_events(
        camp.id,
        TurnSubmitRequest(user_message="Hello?"),
        owner_id=user.id,
    )

    # Advance past phase1_complete into Phase 3 (yields phase3_start while fake_phase3 sleeps)
    first = await gen.__anext__()
    assert first["event"] == "phase1_complete"
    second = await gen.__anext__()
    assert second["event"] == "phase3_start"

    await asyncio.wait_for(p3_started.wait(), timeout=2.0)

    # Close the generator (simulates client aborting SSE stream before turn_saved)
    await gen.aclose()

    assert p3_cancelled.is_set(), "Phase 3 worker task should be cancelled on stream abort"
    bundle = repo.get_campaign_state_bundle(camp.id, owner_id=user.id)
    assert len(bundle.active_branch_turns) == 1  # Only root greeting turn; no partial turn saved


@pytest.mark.asyncio
async def test_sse_generator_exits_cleanly_on_cancelled_error(
    empty_repo: CantinaRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = seed_user(empty_repo)

    async def cancelled_events(*args: Any, **kwargs: Any):
        yield {"event": "phase1_complete", "data": {"ok": True}}
        raise asyncio.CancelledError

    monkeypatch.setattr(turn_streaming, "_execute_turn_stream_events", cancelled_events)

    response = await turn_streaming.stream_campaign_turn(
        campaign_id="camp_fake",
        req=TurnSubmitRequest(user_message="Ping"),
        current_user=user,
    )

    chunks: list[str] = []
    async for raw_chunk in response.body_iterator:
        chunks.append(raw_chunk.decode("utf-8") if isinstance(raw_chunk, bytes) else raw_chunk)

    joined = "".join(chunks)
    assert "event: phase1_complete" in joined
    assert "event: error" not in joined
