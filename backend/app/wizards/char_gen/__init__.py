"""AI Character Creation Wizard (3-Pass Pipeline & Multi-Genre Fallbacks)."""

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
