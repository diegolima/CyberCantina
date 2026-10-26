"""In-world clock helpers: parsing, describing, advancing, and extracting narrative time hints."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

_TIMESTAMP_FORMATS = ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")
_CANONICAL_FORMAT = "%Y-%m-%d %H:%M"

# Maximum backwards gap we treat as "the Clerk forgot to roll the date forward" (e.g. 23:00 -> "05:00").
_ROLLOVER_WINDOW = timedelta(days=1)


def parse_world_timestamp(timestamp_str: str | None) -> datetime | None:
    """Parse a 'YYYY-MM-DD HH:MM' style timestamp; return None for custom/unparseable calendars."""
    if not timestamp_str:
        return None
    cleaned = timestamp_str.strip()
    for fmt in _TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None


def format_world_timestamp(dt: datetime) -> str:
    return dt.strftime(_CANONICAL_FORMAT)


def time_of_day_label(hour: int) -> str:
    if hour < 5:
        return "late night"
    if hour < 7:
        return "dawn"
    if hour < 12:
        return "morning"
    if hour < 14:
        return "midday"
    if hour < 18:
        return "afternoon"
    if hour < 21:
        return "evening"
    return "night"


def describe_world_timestamp(timestamp_str: str) -> str:
    """Human-readable clock for prompts, e.g. '2094-11-14 23:15 (Saturday, night)'."""
    dt = parse_world_timestamp(timestamp_str)
    if dt is None:
        return timestamp_str
    return f"{format_world_timestamp(dt)} ({dt.strftime('%A')}, {time_of_day_label(dt.hour)})"


def advance_world_timestamp(timestamp_str: str, elapsed_minutes: int) -> str:
    """Advance a 'YYYY-MM-DD HH:MM' timestamp by elapsed_minutes, preserving custom calendars."""
    minutes = max(0, elapsed_minutes)
    dt = parse_world_timestamp(timestamp_str)
    if dt is not None:
        return format_world_timestamp(dt + timedelta(minutes=minutes))
    return f"{timestamp_str} (+{minutes}m)"


def resolve_turn_timestamp(
    current_timestamp: str,
    elapsed_minutes: int,
    explicit_timestamp: str | None = None,
) -> str:
    """Compute the post-turn clock.

    An explicit absolute timestamp (set by the Clerk when the turn states or implies a specific
    time) wins over elapsed_minutes, provided it does not move the clock backwards. A target up to
    one day *earlier* than the current time is assumed to mean the next occurrence of that time
    (e.g. 'it's 5am' said at 23:00 -> 05:00 the next day).
    """
    explicit = (explicit_timestamp or "").strip()
    if explicit:
        cur_dt = parse_world_timestamp(current_timestamp)
        new_dt = parse_world_timestamp(explicit)
        if cur_dt is not None and new_dt is not None:
            if new_dt < cur_dt and cur_dt - new_dt <= _ROLLOVER_WINDOW:
                new_dt += timedelta(days=1)
            if new_dt >= cur_dt:
                return format_world_timestamp(new_dt)
            # Large backwards jump (flashback / hallucination): ignore and fall back to elapsed.
        elif cur_dt is None:
            # Custom calendar: trust the Clerk's verbatim timestamp.
            return explicit
    return advance_world_timestamp(current_timestamp, elapsed_minutes)


# --------------------------------------------------------------------------------------------
# Deterministic time-hint extraction (used by the offline Clerk fallback)
# --------------------------------------------------------------------------------------------

_NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "couple of": 2, "a couple of": 2, "few": 3, "a few": 3, "several": 4,
}
_UNIT_MINUTES = {"minute": 1, "min": 1, "hour": 60, "hr": 60, "day": 1440, "week": 10080}

_NAMED_TIMES = {
    "dawn": (6, 0), "sunrise": (6, 0), "daybreak": (6, 0),
    "morning": (8, 0), "noon": (12, 0), "midday": (12, 0),
    "afternoon": (15, 0), "dusk": (18, 30), "sunset": (18, 30), "nightfall": (19, 0),
    "evening": (19, 0), "night": (22, 0), "midnight": (0, 0),
}

_NUM = r"(\d+|a couple of|couple of|a few|few|several|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)"
_UNIT = r"(minute|min|hour|hr|day|week)s?"

_HALF_HOUR_RE = re.compile(r"\bhalf an hour\b", re.I)
_RELATIVE_LATER_RE = re.compile(
    rf"\b{_NUM}\s+{_UNIT}\s+(?:later|pass(?:es|ed)?|go(?:es)? by|went by|elapse[sd]?)\b", re.I
)
_RELATIVE_FOR_RE = re.compile(
    rf"\b(?:for|after|another|in)\s+(?:about\s+|around\s+|roughly\s+)?{_NUM}\s+{_UNIT}\b", re.I
)
_CLOCK_12H_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)(?![a-z])", re.I)
_CLOCK_24H_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")
_OVERNIGHT_RE = re.compile(
    r"\b(?:through the night|all night|overnight|sleep(?:s|ing)? (?:in|till morning|until morning)|"
    r"slept (?:in|till morning|until morning))\b",
    re.I,
)
_NEXT_DAY_RE = re.compile(r"\b(?:the )?(?:next|following) day\b", re.I)
_NAMED_TIME_RE = re.compile(
    r"\b(next|following|until|till|til|by|wait(?:s|ed|ing)? (?:for|until)|it'?s|it is|now|comes?|came|arrives?|arrived|at)\s+"
    r"(?:the\s+)?(dawn|sunrise|daybreak|morning|noon|midday|afternoon|evening|dusk|sunset|nightfall|midnight|night)\b",
    re.I,
)


def _num_value(token: str) -> int:
    token = token.lower().strip()
    if token.isdigit():
        return int(token)
    return _NUMBER_WORDS.get(token, 1)


def _minutes_until(cur: datetime, hour: int, minute: int, *, force_next_day: bool = False) -> int:
    target = cur.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if force_next_day or target <= cur:
        target += timedelta(days=1)
    return int((target - cur).total_seconds() // 60)


def extract_time_hint_minutes(text: str, current_timestamp: str) -> int | None:
    """Return minutes to advance the clock if `text` contains an explicit time cue, else None.

    Recognizes clock times ('it's 5am', 'at 17:30'), named times ('until morning', 'next dawn'),
    overnight cues ('slept through the night'), and relative spans ('two hours later',
    'wait for 20 minutes', 'half an hour'). Absolute cues require a parseable current timestamp.
    """
    if not text:
        return None
    cur = parse_world_timestamp(current_timestamp)

    # 1. Absolute clock time
    if cur is not None:
        m = _CLOCK_12H_RE.search(text)
        if m:
            hour = int(m.group(1))
            minute = int(m.group(2) or 0)
            suffix = m.group(3).lower().replace(".", "")
            if 1 <= hour <= 12 and minute < 60:
                if suffix.startswith("p") and hour != 12:
                    hour += 12
                elif suffix.startswith("a") and hour == 12:
                    hour = 0
                elif suffix.startswith("o"):
                    # "5 o'clock": pick the next occurrence of either AM or PM
                    am = _minutes_until(cur, hour % 12, minute)
                    pm = _minutes_until(cur, hour % 12 + 12, minute)
                    return min(am, pm)
                return _minutes_until(cur, hour, minute)
        m = _CLOCK_24H_RE.search(text)
        if m:
            return _minutes_until(cur, int(m.group(1)), int(m.group(2)))

        # 2. Named times of day
        m = _NAMED_TIME_RE.search(text)
        if m:
            cue = m.group(1).lower()
            hour, minute = _NAMED_TIMES[m.group(2).lower()]
            force_next = cue in {"next", "following"} and m.group(2).lower() != "midnight"
            return _minutes_until(cur, hour, minute, force_next_day=force_next)

        # 3. Overnight cues -> next morning
        if _OVERNIGHT_RE.search(text):
            return _minutes_until(cur, 8, 0)

    # 4. Relative spans
    if _NEXT_DAY_RE.search(text):
        return 1440
    if _HALF_HOUR_RE.search(text):
        return 30
    for regex in (_RELATIVE_LATER_RE, _RELATIVE_FOR_RE):
        m = regex.search(text)
        if m:
            unit = m.group(2).lower()
            return _num_value(m.group(1)) * _UNIT_MINUTES[unit]
    return None
