"""Leaf physical stance & motion continuity schemas, normalization, and staleness resolution."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

PhysicalStance = Literal[
    "unspecified",
    "standing",
    "sitting",
    "leaning",
    "crouching",
    "kneeling",
    "lying_down",
    "moving",
    "restrained",
    "incapacitated",
]

PHYSICAL_STANCE_VALUES: tuple[PhysicalStance, ...] = (
    "unspecified",
    "standing",
    "sitting",
    "leaning",
    "crouching",
    "kneeling",
    "lying_down",
    "moving",
    "restrained",
    "incapacitated",
)

PERSISTENT_PHYSICAL_STANCES: frozenset[PhysicalStance] = frozenset(
    {"restrained", "incapacitated"}
)

PhysicalStateResetReason = Literal["location_changed", "time_skip"]

STALE_TIME_SKIP_MINUTES: int = 30
MAX_PHYSICAL_CONTEXT_LENGTH: int = 120

_COT_WRAPPER_TAGS: tuple[str, ...] = (
    "think",
    "thought",
    "reasoning",
    "scratchpad",
)
_STRICT_HTML_TAG_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^<>]*)?/?>")
_WHITESPACE_RE = re.compile(r"\s+")

_STANCE_SYNONYM_MAP: dict[str, PhysicalStance] = {
    "unspecified": "unspecified",
    "unknown": "unspecified",
    "none": "unspecified",
    "n_a": "unspecified",
    "na": "unspecified",
    "null": "unspecified",
    "unset": "unspecified",
    "neutral": "unspecified",
    "standing": "standing",
    "stand": "standing",
    "upright": "standing",
    "stood": "standing",
    "on_feet": "standing",
    "on_their_feet": "standing",
    "sitting": "sitting",
    "sit": "sitting",
    "seated": "sitting",
    "sat": "sitting",
    "perched": "sitting",
    "leaning": "leaning",
    "lean": "leaning",
    "leaned": "leaning",
    "propped": "leaning",
    "braced": "leaning",
    "slouched": "leaning",
    "crouching": "crouching",
    "crouch": "crouching",
    "crouched": "crouching",
    "squatting": "crouching",
    "squat": "crouching",
    "hunched": "crouching",
    "ducked": "crouching",
    "ducking": "crouching",
    "hunkered": "crouching",
    "kneeling": "kneeling",
    "kneel": "kneeling",
    "knelt": "kneeling",
    "on_knees": "kneeling",
    "on_one_knee": "kneeling",
    "lying_down": "lying_down",
    "lying": "lying_down",
    "laying": "lying_down",
    "laying_down": "lying_down",
    "lying_prone": "lying_down",
    "lying_supine": "lying_down",
    "prone": "lying_down",
    "supine": "lying_down",
    "flat": "lying_down",
    "reclining": "lying_down",
    "reclined": "lying_down",
    "sprawled": "lying_down",
    "on_stomach": "lying_down",
    "on_back": "lying_down",
    "moving": "moving",
    "move": "moving",
    "walking": "moving",
    "walk": "moving",
    "running": "moving",
    "run": "moving",
    "sprinting": "moving",
    "jogging": "moving",
    "pacing": "moving",
    "climbing": "moving",
    "crawling": "moving",
    "swimming": "moving",
    "striding": "moving",
    "stepping": "moving",
    "restrained": "restrained",
    "restrain": "restrained",
    "bound": "restrained",
    "tied": "restrained",
    "tied_up": "restrained",
    "pinned": "restrained",
    "cuffed": "restrained",
    "handcuffed": "restrained",
    "grappled": "restrained",
    "trapped": "restrained",
    "shackled": "restrained",
    "incapacitated": "incapacitated",
    "unconscious": "incapacitated",
    "collapsed": "incapacitated",
    "fainted": "incapacitated",
    "paralyzed": "incapacitated",
    "stunned": "incapacitated",
    "knocked_out": "incapacitated",
    "passed_out": "incapacitated",
    "limp": "incapacitated",
}


def normalize_physical_stance(
    raw: Any,
    *,
    fallback: PhysicalStance = "unspecified",
) -> PhysicalStance:
    """Coerce raw or synonym stance inputs into the 10 canonical PhysicalStance literals."""
    if raw is None:
        return fallback
    token = str(raw).strip().lower()
    if not token:
        return fallback
    normalized = token.replace("-", "_").replace("/", "_")
    normalized = "_".join(part for part in normalized.split() if part)
    if normalized in _STANCE_SYNONYM_MAP:
        return _STANCE_SYNONYM_MAP[normalized]
    return fallback


def _strip_cot_wrappers(text: str) -> str:
    """Remove leaked chain-of-thought XML wrapper blocks linearly without ReDoS backtracking."""
    result = text
    for tag in _COT_WRAPPER_TAGS:
        open_tok = f"<{tag}>"
        close_tok = f"</{tag}>"
        while True:
            lowered = result.lower()
            start = lowered.find(open_tok)
            if start == -1:
                break
            end = lowered.find(close_tok, start + len(open_tok))
            if end == -1:
                result = result[:start]
                break
            result = result[:start] + " " + result[end + len(close_tok) :]
    return result


def sanitize_physical_context(
    raw: Any,
    *,
    max_length: int = MAX_PHYSICAL_CONTEXT_LENGTH,
) -> str:
    """Clean, strip tags/CoT wrappers, collapse whitespace, and bound physical_context."""
    if raw is None:
        return ""
    text = str(raw)
    if not text.strip():
        return ""
    text = _strip_cot_wrappers(text)
    text = _STRICT_HTML_TAG_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ('"', "'"):
        text = text[1:-1].strip()
    if text.lower() in ("none", "n/a", "null", "unspecified", "-"):
        return ""
    if len(text) <= max_length:
        return text
    clipped = text[:max_length].rstrip()
    if " " in clipped and max_length > 16:
        word_boundary = clipped.rsplit(" ", 1)[0].rstrip(",;:-")
        if len(word_boundary) >= max_length // 2:
            return word_boundary
    return clipped


def is_physical_state_established(
    stance: PhysicalStance,
    context: str,
) -> bool:
    """Return True when either stance is non-unspecified or context carries detail."""
    return stance != "unspecified" or bool((context or "").strip())


def format_physical_state_prompt_value(
    stance: PhysicalStance,
    context: str,
) -> str:
    """Format physical stance and context concisely for prompts; empty when unestablished."""
    norm_stance = normalize_physical_stance(stance)
    clean_ctx = sanitize_physical_context(context)
    if norm_stance == "unspecified" and not clean_ctx:
        return ""
    if norm_stance != "unspecified" and clean_ctx:
        return f"[{norm_stance}] {clean_ctx}"
    if norm_stance != "unspecified":
        return f"[{norm_stance}]"
    return clean_ctx


def resolve_post_turn_physical_state(
    prev_stance: Any,
    prev_context: Any,
    clerk_stance: Any,
    clerk_context: Any,
    *,
    location_changed: bool,
    time_elapsed_minutes: int,
) -> tuple[PhysicalStance, str, PhysicalStateResetReason | None]:
    """Apply smart staleness resets when travel or >=30m time skips leave prior state untouched."""
    p_stance = normalize_physical_stance(prev_stance)
    p_ctx = sanitize_physical_context(prev_context)
    c_stance = normalize_physical_stance(clerk_stance)
    c_ctx = sanitize_physical_context(clerk_context)

    prev_norm = (p_stance, p_ctx.casefold())
    clerk_norm = (c_stance, c_ctx.casefold())
    time_skipped = int(time_elapsed_minutes) >= STALE_TIME_SKIP_MINUTES

    if clerk_norm == prev_norm and (location_changed or time_skipped):
        reason: PhysicalStateResetReason = (
            "location_changed" if location_changed else "time_skip"
        )
        if p_stance in PERSISTENT_PHYSICAL_STANCES:
            next_stance: PhysicalStance = p_stance
            # Clear room-bound micro-context when relocating; keep restraint/incapacitation intact.
            next_ctx = "" if location_changed else p_ctx
        else:
            next_stance = "standing" if location_changed else "unspecified"
            next_ctx = ""
        if (next_stance, next_ctx) != (p_stance, p_ctx):
            return next_stance, next_ctx, reason
        return next_stance, next_ctx, None

    return c_stance, c_ctx, None


class PhysicalStateOverrideRequest(BaseModel):
    """Always-available manual override payload for NPC or Player physical state."""

    physical_stance: PhysicalStance = Field(default="unspecified")
    physical_context: str = Field(default="")

    @field_validator("physical_stance", mode="before")
    @classmethod
    def _normalize_stance(cls, v: Any) -> PhysicalStance:
        return normalize_physical_stance(v)

    @field_validator("physical_context", mode="before")
    @classmethod
    def _sanitize_context(cls, v: Any) -> str:
        return sanitize_physical_context(v)


_HEURISTIC_STANCE_RULES: tuple[tuple[PhysicalStance, re.Pattern[str]], ...] = (
    (
        "incapacitated",
        re.compile(
            r"\b(?:knocked unconscious|passed out|falls? unconscious|blacked out|blacks? out|paralyzed|collapses? limp)\b",
            re.I,
        ),
    ),
    (
        "restrained",
        re.compile(
            r"\b(?:handcuffed|cuffed|shackled|tied up|pinned down|pinned against)\b",
            re.I,
        ),
    ),
    (
        "lying_down",
        re.compile(
            r"\b(?:lies? (?:flat|down)|lying (?:flat|down)|lays? down|sprawled|drops? flat|on (?:my|his|her|their) stomach|on (?:my|his|her|their) back|face[- ]down)\b",
            re.I,
        ),
    ),
    (
        "kneeling",
        re.compile(
            r"\b(?:kneels?|knelt|drops? to (?:my|his|her|their|one) knees?)\b",
            re.I,
        ),
    ),
    (
        "crouching",
        re.compile(
            r"\b(?:crouches?|crouched|squats?|squatted|hunkers? down|ducks? low)\b",
            re.I,
        ),
    ),
    (
        "sitting",
        re.compile(
            r"\b(?:sits? (?:down|back|in|on|at)|sat (?:down|back|in|on|at)|slumps? into|settles? into)\b",
            re.I,
        ),
    ),
    (
        "leaning",
        re.compile(
            r"\b(?:leans? (?:against|on|back)|leaned (?:against|on|back)|propped against)\b",
            re.I,
        ),
    ),
    (
        "standing",
        re.compile(
            r"\b(?:stands? up|stood up|gets? back up|gets? to (?:my|his|her|their) feet|rises? to (?:my|his|her|their) feet|scrambles? up)\b",
            re.I,
        ),
    ),
    (
        "moving",
        re.compile(
            r"\b(?:sprints?|runs? (?:toward|away|out|down|into)|walks? (?:toward|across|into|out)|paces?|climbs?|crawls?)\b",
            re.I,
        ),
    ),
)


def extract_heuristic_physical_state(
    text: str,
    *,
    prev_stance: PhysicalStance = "unspecified",
    prev_context: str = "",
) -> tuple[PhysicalStance, str]:
    """Deterministically detect unambiguous stance changes in prose, else carry forward prior state."""
    norm_prev_stance = normalize_physical_stance(prev_stance)
    clean_prev_ctx = sanitize_physical_context(prev_context)
    cleaned = (text or "").strip()
    if not cleaned:
        return norm_prev_stance, clean_prev_ctx

    for stance, pattern in _HEURISTIC_STANCE_RULES:
        if pattern.search(cleaned):
            low = cleaned.lower()
            ctx = ""
            if stance == "lying_down":
                if "stomach" in low or "face-down" in low or "face down" in low:
                    ctx = "on stomach"
                elif "on my back" in low or "on his back" in low or "on her back" in low or "on their back" in low:
                    ctx = "on back"
            return stance, ctx

    return norm_prev_stance, clean_prev_ctx
