"""Clerk Scene Staging Engine for World-focused Campaign Starts."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence

from app.config import ModelProfile
from app.engine.llm_client import LLMClient
from app.prompts.defaults import (
    DEFAULT_CLERK_WORLD_START_PLACEMENT_SYSTEM,
)
from app.schemas.character import CharacterRecord
from app.schemas.world import LocationNode, WorldRecord

logger = logging.getLogger("cybercantina.engine.clerk_placement")


def build_fallback_placement_prose(characters: Sequence[CharacterRecord]) -> str:
    """Deterministic fallback staging prose when Clerk LLM fails or times out."""
    if not characters:
        return ""
    lines = [f"You see {c.name} nearby." for c in characters]
    return "\n\n" + "\n".join(lines)


async def generate_clerk_starting_placement(
    *,
    world: WorldRecord,
    location: LocationNode,
    participant_characters: Sequence[CharacterRecord],
    profile: ModelProfile,
    llm_client: LLMClient | None = None,
    prompt_template: str | None = None,
    timeout_seconds: float = 10.0,
) -> str:
    """Invokes the Clerk LLM (max_tokens=256, temp=0.5) to stage non-user characters.

    Enforces strict anti-dialogue and pure physical placement constraints.
    Returns the generated paragraph (prefixed with '\\n\\n') or a deterministic fallback
    upon timeout or provider error.
    """
    if not participant_characters:
        return ""

    fallback_text = build_fallback_placement_prose(participant_characters)

    char_summaries: list[str] = []
    for c in participant_characters:
        tagline = getattr(c, "tagline", None) or ""
        core_persona = getattr(c, "core_persona", None) or ""
        char_desc = tagline or (core_persona[:120] if core_persona else "")
        char_summaries.append(f"- **{c.name}**: {char_desc}")

    system_prompt = (prompt_template or DEFAULT_CLERK_WORLD_START_PLACEMENT_SYSTEM).strip()

    user_prompt = (
        f"=== SETTING CONTEXT ===\n"
        f"World: {world.name} ({world.global_rules.genre} - {world.global_rules.tone})\n"
        f"Location: {location.name}\n"
        f"Location Atmosphere:\n{location.starting_message or location.description}\n\n"
        f"=== CHARACTERS PRESENT IN THE ROOM ===\n"
        + "\n".join(char_summaries)
        + "\n\n"
        "=== YOUR TASK ===\n"
        "Write a single descriptive paragraph placing these characters in the room. "
        "Strictly NO dialogue, NO internal thoughts. Begin your response with a double newline."
    )

    client = llm_client or LLMClient()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    try:
        raw_output = await asyncio.wait_for(
            client.complete_text(
                messages,
                profile=profile,
                temperature=0.5,
                max_tokens=256,
            ),
            timeout=timeout_seconds,
        )
        cleaned = (raw_output or "").strip()
        if not cleaned:
            return fallback_text
        return f"\n\n{cleaned}"
    except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
        logger.warning(
            "Clerk starting placement timed out after %.1fs; applying deterministic fallback. (%s)",
            timeout_seconds,
            exc,
        )
        return fallback_text
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Clerk starting placement failed (%s); applying deterministic fallback.",
            exc,
        )
        return fallback_text
