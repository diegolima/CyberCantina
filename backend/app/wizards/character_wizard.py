"""AI Character Generation Wizard & Deterministic Fallbacks.

Domain modules live under ``app.wizards.char_gen``; this module remains a
backwards-compatible re-export facade."""

from __future__ import annotations

from app.config import ModelProfile, settings  # noqa: F401
from app.engine.llm_client import llm_client  # noqa: F401
from app.prompts import get_default_prompt, render_template  # noqa: F401
from app.schemas.affective import infer_temperament_and_worldview_from_text  # noqa: F401
from app.schemas.character import (
    BASELINE_MOOD_PRESETS,
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardLLMOutput,
    CharacterWizardPass1LLMOutput,
    CharacterWizardPass2LLMOutput,
    CharacterWizardPass3LLMOutput,
    CharacterWizardSeed,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
    coerce_item_list,
    normalize_bullet_plan,
    normalize_starting_mood,
    sanitize_character_markup,
)  # noqa: F401
from app.schemas.world import WorldRecord  # noqa: F401
from app.db.repository import slugify_tag  # noqa: F401

from app.wizards.char_gen.genre_profiles import (  # noqa: F401
    _sanitize_height_only,
    _clean_mannerism,
    _split_compound_items,
    GENRE_PROFILES,
    resolve_genre_fallback_profile,
)
from app.wizards.char_gen.inference import (  # noqa: F401
    infer_demographics_and_anatomy,
    infer_moral_code_and_quirks,
    infer_dialogue_anchors_and_style,
    _normalize_distinctive_features,
    _fallback_character_expansion,
)
from app.wizards.char_gen.draft_pipeline import (  # noqa: F401
    logger,
    generate_character_draft,
)
