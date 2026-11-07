"""Unit tests for the in-world clock helpers (time-hint extraction & timestamp resolution)."""

from __future__ import annotations

import pytest

from app.engine.world_clock import (
    advance_world_timestamp,
    describe_world_timestamp,
    extract_time_hint_minutes,
    resolve_bounded_turn_elapsed_minutes,
    resolve_turn_timestamp,
)

NOW = "2094-11-14 23:15"  # Sunday night


def _apply(text: str, now: str = NOW) -> str | None:
    minutes = extract_time_hint_minutes(text, now)
    return None if minutes is None else advance_world_timestamp(now, minutes)


def test_describe_world_timestamp():
    assert describe_world_timestamp(NOW) == "2094-11-14 23:15 (Sunday, night)"
    assert describe_world_timestamp("Third Bell, Year of Ash") == "Third Bell, Year of Ash"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("It's 5am and the bar is empty.", "2094-11-15 05:00"),
        ("We meet at 11:45 pm.", "2094-11-14 23:45"),
        ("They wait until 17:30.", "2094-11-15 17:30"),
        ("They slept until morning.", "2094-11-15 08:00"),
        ("We crash here through the night.", "2094-11-15 08:00"),
        ("Let's wait until dawn.", "2094-11-15 06:00"),
        ("Come back next evening.", "2094-11-15 19:00"),
        ("Two hours later, the door opens.", "2094-11-15 01:15"),
        ("I sit and wait for 20 minutes.", "2094-11-14 23:35"),
        ("Half an hour passes in silence.", "2094-11-14 23:45"),
        ("Three days later we return.", "2094-11-17 23:15"),
        ("The next day, I head out.", "2094-11-15 23:15"),
    ],
)
def test_extract_time_hint(text: str, expected: str):
    assert _apply(text) == expected


@pytest.mark.parametrize(
    "text",
    ["I order a drink and look around.", "Tell me about the morning shift.", "Give me a minute."],
)
def test_no_time_hint(text: str):
    assert extract_time_hint_minutes(text, NOW) is None


def test_resolve_prefers_explicit_timestamp():
    assert resolve_turn_timestamp(NOW, 3, "2094-11-15 07:30") == "2094-11-15 07:30"


def test_resolve_rolls_forgotten_date_forward():
    # Clerk said 05:00 but kept today's date -> next day's 05:00
    assert resolve_turn_timestamp(NOW, 3, "2094-11-14 05:00") == "2094-11-15 05:00"


def test_resolve_ignores_large_backwards_jump_and_garbage():
    assert resolve_turn_timestamp(NOW, 3, "2090-01-01 05:00") == "2094-11-14 23:18"
    assert resolve_turn_timestamp(NOW, 3, "soon-ish") == "2094-11-14 23:18"
    assert resolve_turn_timestamp(NOW, 3, None) == "2094-11-14 23:18"


def test_resolve_custom_calendar_accepts_verbatim():
    assert resolve_turn_timestamp("Third Bell", 5, "Fourth Bell") == "Fourth Bell"
    assert resolve_turn_timestamp("Third Bell", 5, None) == "Third Bell (+5m)"
    assert (
        resolve_bounded_turn_elapsed_minutes(
            prev_timestamp="Third Bell",
            new_timestamp="Fourth Bell",
            clerk_elapsed_minutes=12,
            raw_turn_text="The fourth bell tolls.",
        )
        == 12
    )


def test_resolve_rejects_hallucinated_multi_year_forward_jump():
    assert resolve_turn_timestamp(NOW, 4, "2099-11-14 23:19") == "2094-11-14 23:19"
    assert (
        resolve_bounded_turn_elapsed_minutes(
            prev_timestamp=NOW,
            new_timestamp="2099-11-14 23:19",
            clerk_elapsed_minutes=4,
            raw_turn_text="Quiet sip at the bar.",
        )
        == 4
    )
