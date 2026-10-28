"""Template rendering and validation engine for prompts."""

from __future__ import annotations

import re
from typing import Any

from app.prompts.defaults import FACTORY_DEFAULT_PROMPTS, PROMPTS_METADATA

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}")


def get_default_prompt(prompt_key: str) -> str:
    """Retrieve the hardcoded factory default prompt string for a key."""
    if prompt_key not in FACTORY_DEFAULT_PROMPTS:
        raise KeyError(f"Unknown prompt key: '{prompt_key}'")
    return FACTORY_DEFAULT_PROMPTS[prompt_key]


def render_template(template: str | None, **kwargs: Any) -> str:
    """Safely render a prompt template with provided variables.

    Supports both `{variable_name}` and `{{ variable_name }}` syntax.
    Curly braces that do not match known kwargs (such as JSON schemas or regex
    patterns like `{requires_roll}` or `{2,4}`) are preserved untouched without throwing errors.
    """
    if not template:
        return ""

    def _replace_match(match: re.Match[str]) -> str:
        var_name = match.group(1) or match.group(2)
        if var_name in kwargs:
            val = kwargs[var_name]
            return str(val) if val is not None else ""
        return match.group(0)

    return _PLACEHOLDER_RE.sub(_replace_match, template)


def validate_prompt_template(prompt_key: str, template: str) -> list[str]:
    """Validate a prompt template against required structural tokens.

    Returns a list of warning strings if essential tokens are missing.
    """
    warnings: list[str] = []
    meta = next((m for m in PROMPTS_METADATA if m["key"] == prompt_key), None)
    if not meta:
        return warnings

    for req in meta.get("required_tags", []):
        if req not in template:
            warnings.append(
                f"Missing recommended structural token '{req}'. The LLM response parser may malfunction without it."
            )

    return warnings
