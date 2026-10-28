"""Prompt presets and templating package for CyberCantina."""

from app.prompts.defaults import (
    ALL_PROMPT_KEYS,
    BUILTIN_PRESETS,
    DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM,
    FACTORY_DEFAULT_PROMPTS,
    PROMPT_KEY_ACTOR_ZONE1,
    PROMPT_KEY_CLERK_POST_TURN,
    PROMPT_KEY_CLERK_PRE_TURN,
    PROMPT_KEY_CLERK_SUMMARY,
    PROMPT_KEY_WIZARD_CHARACTER,
    PROMPT_KEY_WIZARD_WORLD,
    PROMPTS_METADATA,
)
from app.prompts.renderer import get_default_prompt, render_template, validate_prompt_template

__all__ = [
    "ALL_PROMPT_KEYS",
    "BUILTIN_PRESETS",
    "DEFAULT_CLERK_MEMORY_COMPACTION_SYSTEM",
    "FACTORY_DEFAULT_PROMPTS",
    "PROMPT_KEY_ACTOR_ZONE1",
    "PROMPT_KEY_CLERK_POST_TURN",
    "PROMPT_KEY_CLERK_PRE_TURN",
    "PROMPT_KEY_CLERK_SUMMARY",
    "PROMPT_KEY_WIZARD_CHARACTER",
    "PROMPT_KEY_WIZARD_WORLD",
    "PROMPTS_METADATA",
    "get_default_prompt",
    "render_template",
    "validate_prompt_template",
]
