"""Phase 3 Character Cognition & Hidden Thought Generation package.

Submodules:
- `xml_parser`: Deterministic `<cognition>` XML tag/attribute extractor & prose leakage sanitizer
- `heuristics`: Offline/fallback cognition generator when no LLM endpoint is configured
- `prompt_builder`: System/user instructions enforcing per-character epistemic viewpoint & choices
- `runner`: Parallel/sequential multi-character Phase 3 cognition execution
"""

from __future__ import annotations

from app.engine.cognition.xml_parser import (
    logger,
    _extract_xml_tag,
    strip_xml_tag_blocks,
    _VALENCE_ATTR_RE,
    _AROUSAL_ATTR_RE,
    _TONE_ATTR_RE,
    _INTENSITY_ATTR_RE,
    _AGENCY_ATTR_RE,
    _THREAT_ATTR_RE,
    _COPING_ATTR_RE,
    _ROLL_OUTCOME_ATTR_RE,
    _clamp,
    parse_cognition_xml,
    _format_cognition_bullets,
    _PROMPT_LEAKAGE_RE,
    _sanitize_cognition_text,
)
from app.engine.cognition.heuristics import (
    PriorCognitionCue,
    heuristic_character_cognition,
    select_cognition_recalled_items,
)
from app.engine.cognition.runner import (
    run_character_cognition_agent,
    run_phase3_multi_cognition,
    generate_clerk_cognition,
)

__all__ = [
    "logger",
    "_extract_xml_tag",
    "strip_xml_tag_blocks",
    "_VALENCE_ATTR_RE",
    "_AROUSAL_ATTR_RE",
    "_TONE_ATTR_RE",
    "_INTENSITY_ATTR_RE",
    "_AGENCY_ATTR_RE",
    "_THREAT_ATTR_RE",
    "_COPING_ATTR_RE",
    "_ROLL_OUTCOME_ATTR_RE",
    "_clamp",
    "parse_cognition_xml",
    "_format_cognition_bullets",
    "_PROMPT_LEAKAGE_RE",
    "_sanitize_cognition_text",
    "PriorCognitionCue",
    "heuristic_character_cognition",
    "select_cognition_recalled_items",
    "run_character_cognition_agent",
    "run_phase3_multi_cognition",
    "generate_clerk_cognition",
]
