"""Cognition XML parsing, feeling attribute extraction, and text sanitization."""

from __future__ import annotations

import logging
import re

from app.schemas.affective import (
    CategoricalFeelingImpulse,
    INTENSITY_TO_AROUSAL,
    TONE_TO_VALENCE,
    coerce_agency_level,
    coerce_coping_level,
    coerce_feeling_tone,
    coerce_intensity_level,
    coerce_threat_level,
    impulse_from_legacy_floats,
)
from app.schemas.character import (
    CharacterStateSnapshot,
    CognitionBlock,
)

logger = logging.getLogger(__name__)


def _extract_xml_tag(
    text: str,
    tag: str,
    *,
    allow_attrs: bool = False,
) -> tuple[str, str] | None:
    """Extract (attrs, inner_text) for the first closed <tag...>...</tag> in O(n) time."""
    lower = text.lower()
    open_prefix = f"<{tag.lower()}"
    close_tag = f"</{tag.lower()}>"
    pos = 0
    while True:
        start = lower.find(open_prefix, pos)
        if start == -1:
            return None
        after_name = start + len(open_prefix)
        if after_name >= len(lower):
            return None
        if allow_attrs:
            if lower[after_name] != ">" and not lower[after_name].isspace():
                pos = after_name
                continue
            open_end = lower.find(">", after_name)
        else:
            if lower[after_name] != ">":
                pos = after_name
                continue
            open_end = after_name
        if open_end == -1:
            return None
        close_start = lower.find(close_tag, open_end + 1)
        if close_start == -1:
            return None
        attrs = text[after_name:open_end] if allow_attrs else ""
        inner = text[open_end + 1 : close_start]
        return attrs, inner


def strip_xml_tag_blocks(
    text: str,
    tags: tuple[str, ...],
    *,
    strip_trailing_ws: bool = False,
) -> str:
    """Strip closed <tag>...</tag> blocks case-insensitively in linear time."""
    result = text
    for tag in tags:
        open_tag = f"<{tag.lower()}>"
        close_tag = f"</{tag.lower()}>"
        lower = result.lower()
        out: list[str] = []
        pos = 0
        while True:
            start = lower.find(open_tag, pos)
            if start == -1:
                out.append(result[pos:])
                break
            end = lower.find(close_tag, start + len(open_tag))
            if end == -1:
                out.append(result[pos:])
                break
            out.append(result[pos:start])
            pos = end + len(close_tag)
            if strip_trailing_ws:
                while pos < len(result) and result[pos].isspace():
                    pos += 1
        result = "".join(out)
    return result


_VALENCE_ATTR_RE = re.compile(r'valence=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)


_AROUSAL_ATTR_RE = re.compile(r'arousal=["\']([+-]?\d+(?:\.\d+)?)["\']', re.IGNORECASE)


_TONE_ATTR_RE = re.compile(r'tone=["\']([^"\']+)["\']', re.IGNORECASE)


_INTENSITY_ATTR_RE = re.compile(r'intensity=["\']([^"\']+)["\']', re.IGNORECASE)


_AGENCY_ATTR_RE = re.compile(r'agency=["\']([^"\']+)["\']', re.IGNORECASE)


_THREAT_ATTR_RE = re.compile(r'threat=["\']([^"\']+)["\']', re.IGNORECASE)


_COPING_ATTR_RE = re.compile(r'coping=["\']([^"\']+)["\']', re.IGNORECASE)


_ROLL_OUTCOME_ATTR_RE = re.compile(r'roll_outcome=["\']([^"\']+)["\']', re.IGNORECASE)


def _clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


def parse_cognition_xml(
    cognition_xml: str,
    fallback_state: CharacterStateSnapshot,
) -> CognitionBlock:
    """Parse inner tags of <cognition>...</cognition> supporting both CARE enums and legacy floats."""
    recall_match = _extract_xml_tag(cognition_xml, "recall")
    feeling_match = _extract_xml_tag(cognition_xml, "feeling", allow_attrs=True)
    want_match = _extract_xml_tag(cognition_xml, "want")
    plan_match = _extract_xml_tag(cognition_xml, "plan")

    recall = (
        recall_match[1].strip()
        if recall_match
        else "- Holding onto the current thread of conversation."
    )
    feeling = (
        feeling_match[1].strip()
        if feeling_match
        else fallback_state.mood_label
    )

    fallback_imp = impulse_from_legacy_floats(fallback_state.valence, fallback_state.arousal)
    valence = fallback_state.valence
    arousal = fallback_state.arousal
    impulse: CategoricalFeelingImpulse = fallback_imp

    if feeling_match:
        attrs = feeling_match[0] or ""
        t_m = _TONE_ATTR_RE.search(attrs)
        i_m = _INTENSITY_ATTR_RE.search(attrs)
        ag_m = _AGENCY_ATTR_RE.search(attrs)
        th_m = _THREAT_ATTR_RE.search(attrs)
        cp_m = _COPING_ATTR_RE.search(attrs)

        if any((t_m, i_m, ag_m, th_m, cp_m)):
            tone = coerce_feeling_tone(t_m.group(1), default=fallback_imp.tone) if t_m else fallback_imp.tone
            intensity = (
                coerce_intensity_level(i_m.group(1), default=fallback_imp.intensity)
                if i_m
                else fallback_imp.intensity
            )
            agency = (
                coerce_agency_level(ag_m.group(1), default=fallback_imp.agency)
                if ag_m
                else fallback_imp.agency
            )
            threat = (
                coerce_threat_level(th_m.group(1), default=fallback_imp.threat)
                if th_m
                else fallback_imp.threat
            )
            coping = (
                coerce_coping_level(cp_m.group(1), default=fallback_imp.coping)
                if cp_m
                else fallback_imp.coping
            )
            impulse = CategoricalFeelingImpulse(
                tone=tone,
                intensity=intensity,
                agency=agency,
                threat=threat,
                coping=coping,
                used_legacy_float_fallback=False,
            )
            valence = TONE_TO_VALENCE[impulse.tone]
            arousal = INTENSITY_TO_AROUSAL[impulse.intensity]
        else:
            v_m = _VALENCE_ATTR_RE.search(attrs)
            a_m = _AROUSAL_ATTR_RE.search(attrs)
            if v_m:
                try:
                    valence = _clamp(float(v_m.group(1)), -1.0, 1.0)
                except ValueError:
                    pass
            if a_m:
                try:
                    arousal = _clamp(float(a_m.group(1)), 0.0, 1.0)
                except ValueError:
                    pass
            impulse = impulse_from_legacy_floats(valence, arousal)

    recall = _sanitize_cognition_text(recall, field_type="recall", location_id=fallback_state.current_location_id)
    recall = _format_cognition_bullets(recall, max_bullets=3, max_words_per_bullet=12)
    raw_want = want_match[1].strip() if want_match else fallback_state.active_want
    want = _sanitize_cognition_text(raw_want, field_type="want") or fallback_state.active_want
    choice_match = _extract_xml_tag(cognition_xml, "selected_choice")
    selected_choice = choice_match[1].strip() if choice_match else None
    raw_plan = plan_match[1].strip() if plan_match else fallback_state.active_plan
    plan = _sanitize_cognition_text(raw_plan, field_type="plan") or fallback_state.active_plan
    plan = _format_cognition_bullets(plan, max_bullets=3, max_words_per_bullet=25)

    ro_m = _ROLL_OUTCOME_ATTR_RE.search(cognition_xml)
    roll_outcome_tier = ro_m.group(1).strip() if ro_m else None

    return CognitionBlock(
        recall=recall,
        feeling=feeling,
        feeling_tone=impulse.tone,
        feeling_intensity=impulse.intensity,
        feeling_agency=impulse.agency,
        scene_threat=impulse.threat,
        scene_coping=impulse.coping,
        valence=round(valence, 2),
        arousal=round(arousal, 2),
        feeling_impulse=impulse,
        want=want,
        selected_choice=selected_choice,
        plan=plan,
        roll_outcome_tier=roll_outcome_tier,
    )


def _format_cognition_bullets(
    text: str,
    *,
    max_bullets: int | None = None,
    max_words_per_bullet: int | None = None,
) -> str:
    """Format cognition multi-item fields (recall, plan) into clean newline-separated bullet points."""
    if not text:
        return ""
    t = re.sub(r"^[,\s\[]+", "", text).strip()
    while t and (t[-1] == "]" or t[-1].isspace()):
        t = t[:-1]
    t = t.strip()
    t = re.sub(
        r"\[(EPISODIC_CHUNK|CHARACTER_SHARD|LOCATION_LORE|LORE)\]\s*",
        "",
        t,
        flags=re.I,
    ).strip()

    if "\n" not in t and re.search(r"\b[1-9][.)]\s+", t):
        parts = re.split(r"\b[1-9][.)]\s+", t)
        items = [f"- {p.strip()}" for p in parts if p.strip()]
        if items:
            t = "\n".join(items)

    lines: list[str] = []
    for line in t.splitlines():
        line = line.strip()
        if not line:
            continue
        cleaned = re.sub(r"^(?:[-*•]|\d+[.)])\s*", "- ", line)
        if not cleaned.startswith("- "):
            cleaned = f"- {cleaned}"
        if max_words_per_bullet is not None and max_words_per_bullet > 0:
            content = cleaned[2:].strip()
            words = content.split()
            if len(words) > max_words_per_bullet:
                cleaned = f"- {' '.join(words[:max_words_per_bullet])}..."
        lines.append(cleaned)

    if max_bullets is not None and max_bullets > 0:
        lines = lines[:max_bullets]

    if lines:
        return "\n".join(lines)

    fallback = f"- {t}" if not t.startswith("- ") else t
    if max_words_per_bullet is not None and max_words_per_bullet > 0:
        content = fallback[2:].strip()
        words = content.split()
        if len(words) > max_words_per_bullet:
            fallback = f"- {' '.join(words[:max_words_per_bullet])}..."
    return fallback


_PROMPT_LEAKAGE_RE = re.compile(
    r"(?:strictly\s*1-2\s*ultra-concise|critical\s*negative\s*constraint|"
    r"state\s*only\s*the\s*single\s*immediate|maximum\s*15-20\s*words|"
    r"strictly\s*under\s*(?:10|12)\s*words|up\s*to\s*2-3\s*concise|"
    r"never\s*pad\s*with\s*filler|1\s*singular\s*sentence\s*defining|"
    r"2-3\s*brief\s*sequential\s*bullet|adhering\s*strictly\s*to\s*the\s*object|"
    r"output\s*only\s*the\s*<cognition>|following\s*this\s*exact\s*4-step|"
    r"output\s*only\s*the\s*requested\s*structured|never\s*echo,?\s*copy,?\s*or\s*quote|"
    r"write\s*\{?character_name\}?'?s?\s*actual\s*in-character)",
    re.IGNORECASE,
)


def _sanitize_cognition_text(
    text: str | None,
    *,
    field_type: str,
    location_id: str | None = None,
) -> str:
    """Sanitize cognition text to remove prompt instruction leakage and malformed prefixes."""
    if not text:
        return ""
    t = text.strip()

    if field_type == "want":
        t = re.sub(r"^(?:<want>|want>|\[want\]|\"want\"[:=]|\bwant[:=])\s*", "", t, flags=re.I)
        t = re.sub(r"^1\s+singular\s+sentence\s+(?:defining\s[^.]*\.\s*)?", "", t, flags=re.I)
        t = re.sub(r"</want>$", "", t, flags=re.I).strip()
    elif field_type == "plan":
        cleaned_tokens = re.sub(r"^[-*•\s]*plan[=:\s]*$", "", t, flags=re.I).strip()
        if not cleaned_tokens:
            return ""
        t = re.sub(r"^(?:[-*•\s]*(?:<plan>|plan>|\[plan\]|\"plan\"[:=]|\bplan[=:]))\s*", "", t, flags=re.I)
        t = re.sub(r"</plan>$", "", t, flags=re.I).strip()
    elif field_type == "recall":
        t = re.sub(r"^(?:<recall>|recall>|\[recall\]|\"recall\"[:=]|\brecall[:=])\s*", "", t, flags=re.I)
        t = re.sub(r"</recall>$", "", t, flags=re.I).strip()

    if _PROMPT_LEAKAGE_RE.search(t):
        if field_type == "recall":
            loc_str = f" in {location_id}" if location_id else ""
            return f"- Sizing up the interaction{loc_str}."
        elif field_type in ("want", "plan"):
            cleaned = _PROMPT_LEAKAGE_RE.sub("", t).strip()
            return cleaned if len(cleaned) > 5 else ""

    return t
