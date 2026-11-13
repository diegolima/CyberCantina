"""AI Character Creation Wizard (3-Pass Pipeline & Multi-Genre Fallbacks).

Submodules:
- `genre_profiles`: Multi-genre fallback defaults & height/mannerism/item normalization
- `inference`: Heuristic trait, moral code, quirk, and dialogue anchor extractors
- `draft_pipeline`: 3-pass structured LLM character generation (`generate_character_draft`)
"""

from __future__ import annotations

from app.wizards.char_gen.genre_profiles import (
    _sanitize_height_only,
    _clean_mannerism,
    _split_compound_items,
    GENRE_PROFILES,
    resolve_genre_fallback_profile,
)
from app.wizards.char_gen.inference import (
    infer_demographics_and_anatomy,
    infer_moral_code_and_quirks,
    infer_dialogue_anchors_and_style,
    _normalize_distinctive_features,
    _fallback_character_expansion,
)
from app.wizards.char_gen.draft_pipeline import (
    logger,
    generate_character_draft,
)

__all__ = [
    "_sanitize_height_only",
    "_clean_mannerism",
    "_split_compound_items",
    "GENRE_PROFILES",
    "resolve_genre_fallback_profile",
    "infer_demographics_and_anatomy",
    "infer_moral_code_and_quirks",
    "infer_dialogue_anchors_and_style",
    "_normalize_distinctive_features",
    "_fallback_character_expansion",
    "logger",
    "generate_character_draft",
]
