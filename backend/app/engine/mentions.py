"""Targeted Character Mentions and Mixed Sensory Whisper Engine.

Implements parsing, decomposition, quote normalization, and epistemic history isolation
for @Character Name: directed dialogue and sensory cues across the 5-phase pipeline.
"""

from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field

from app.schemas.character import CharacterRecord
from app.schemas.turn import CharacterWhisper, MentionTargetScope

# Unicode quote normalization map
_SMART_DOUBLE_QUOTES = ("“", "”", "„", "‟", "«", "»")
_SMART_SINGLE_QUOTES = ("‘", "’", "‚", "‛")

_MENTION_LINE_RE = re.compile(r"^@(?P<name>[^:\n]+):(?P<content>.*)$")


class DecomposedUserMessage(BaseModel):
    """Complete decomposition of a turn message into shared vs directed slices."""

    raw_message: str
    public_text: str = Field(
        default="",
        description="Shared scene action and dialogue observed by all characters present.",
    )
    whispers: list[CharacterWhisper] = Field(
        default_factory=list,
        description="Ordered list of character-specific directed whispers.",
    )
    whispers_by_character_id: dict[str, CharacterWhisper] = Field(
        default_factory=dict,
        description="Lookup map of merged whispers keyed by character_id.",
    )
    remote_whispers: list[CharacterWhisper] = Field(
        default_factory=list,
        description="Whispers directed to characters not currently in the room.",
    )


@runtime_checkable
class MentionParserProtocol(Protocol):
    """Protocol for parsing and decomposing turn messages containing @mentions."""

    def normalize_quotes(self, text: str) -> str:
        """Normalize smart/curly quotes and Unicode variants to standard ASCII straight quotes."""
        ...

    def parse_whisper_content(self, content: str) -> tuple[list[str], list[str]]:
        """Split content after '@Character Name:' into (speech_parts, sensory_parts)."""
        ...

    def decompose_user_message(
        self,
        raw_text: str,
        campaign_characters: list[CharacterRecord],
        present_character_ids: set[str] | None = None,
    ) -> DecomposedUserMessage:
        """Decompose raw user message into public text and character-directed whispers."""
        ...

    def filter_user_message_for_character(
        self,
        user_message: str,
        target_character_id: str,
        campaign_characters: list[CharacterRecord],
    ) -> str:
        """Filter a user message for a specific character's working memory or prompt."""
        ...

    def sanitize_history_for_episodic_summary(
        self,
        user_message: str,
        campaign_characters: list[CharacterRecord],
    ) -> str:
        """Scrub private whispers from user messages before episodic compression."""
        ...


def normalize_quotes(text: str) -> str:
    """Normalize smart/curly quotes and Unicode variants to standard ASCII straight quotes."""
    if not text:
        return ""
    result = text
    for q in _SMART_DOUBLE_QUOTES:
        result = result.replace(q, '"')
    for q in _SMART_SINGLE_QUOTES:
        result = result.replace(q, "'")
    return result


def parse_whisper_content(content: str) -> tuple[list[str], list[str]]:
    """Split content after '@Character Name:' into (speech_parts, sensory_parts).

    Double quotes delimit speech. Content outside quotes represents sensory perception.
    Handles unclosed quotes and whitespace normalization.
    """
    normalized = normalize_quotes(content).strip()
    if not normalized:
        return [], []

    speeches: list[str] = []
    sensory: list[str] = []

    parts = normalized.split('"')
    for idx, raw_part in enumerate(parts):
        part = raw_part.strip()
        if not part:
            continue
        if idx % 2 == 1:
            # Inside quotes (or trailing unclosed quote)
            speeches.append(part)
        else:
            # Outside quotes
            # Strip leading/trailing punctuation artifacts like orphan colons or commas
            cleaned = part.strip()
            while cleaned and cleaned[0] in ",;:":
                cleaned = cleaned[1:].lstrip()
            while cleaned and cleaned[-1] in ",;:":
                cleaned = cleaned[:-1].rstrip()
            if cleaned:
                sensory.append(cleaned)

    return speeches, sensory


def _normalize_name_key(name: str) -> str:
    """Normalize a character name for resilient key matching."""
    return re.sub(r"\s+", " ", name.strip().lower())


def decompose_user_message(
    raw_text: str,
    campaign_characters: list[CharacterRecord],
    present_character_ids: set[str] | None = None,
) -> DecomposedUserMessage:
    """Decompose raw user message into public text and character-directed whispers.

    Strictly matches line-starting `@Character Name: <content>` against campaign roster.
    Merges multiple mention lines for the same character.
    Categorizes targets as LOCAL vs REMOTE based on present_character_ids.
    """
    if not raw_text or not raw_text.strip():
        return DecomposedUserMessage(raw_message=raw_text or "", public_text="")

    char_lookup: dict[str, CharacterRecord] = {}
    for c in campaign_characters:
        norm_key = _normalize_name_key(c.name)
        if norm_key:
            char_lookup[norm_key] = c

    present_ids = (
        present_character_ids
        if present_character_ids is not None
        else {c.id for c in campaign_characters}
    )

    public_lines: list[str] = []
    # Dict to aggregate multiple lines per character
    whispers_dict: dict[str, CharacterWhisper] = {}
    whispers_order: list[str] = []

    for raw_line in raw_text.splitlines():
        line = normalize_quotes(raw_line)
        match = _MENTION_LINE_RE.match(line)
        if match:
            candidate_name = _normalize_name_key(match.group("name"))
            target_char = char_lookup.get(candidate_name)
            if target_char:
                content = match.group("content").lstrip()
                speech, sensory = parse_whisper_content(content)
                scope = (
                    MentionTargetScope.LOCAL
                    if target_char.id in present_ids
                    else MentionTargetScope.REMOTE
                )

                if target_char.id not in whispers_dict:
                    whispers_dict[target_char.id] = CharacterWhisper(
                        character_id=target_char.id,
                        character_name=target_char.name,
                        target_scope=scope,
                        raw_lines=[raw_line],
                        speech_parts=speech,
                        sensory_parts=sensory,
                    )
                    whispers_order.append(target_char.id)
                else:
                    existing = whispers_dict[target_char.id]
                    existing.raw_lines.append(raw_line)
                    existing.speech_parts.extend(speech)
                    existing.sensory_parts.extend(sensory)
                continue

        # If not matching a known campaign character mention, line is public
        public_lines.append(raw_line)

    ordered_whispers = [whispers_dict[cid] for cid in whispers_order]
    remote_whispers = [
        w for w in ordered_whispers if w.target_scope == MentionTargetScope.REMOTE
    ]

    return DecomposedUserMessage(
        raw_message=raw_text,
        public_text="\n".join(public_lines).strip(),
        whispers=ordered_whispers,
        whispers_by_character_id=whispers_dict,
        remote_whispers=remote_whispers,
    )


def filter_user_message_for_character(
    user_message: str,
    target_character_id: str,
    campaign_characters: list[CharacterRecord],
) -> str:
    """Filter a user message for a specific character's working memory or prompt.

    Retains public lines and whispers addressed to target_character_id.
    Strips private whispers addressed to other characters.
    """
    decomposed = decompose_user_message(
        user_message,
        campaign_characters=campaign_characters,
    )
    retained_parts: list[str] = []
    if decomposed.public_text:
        retained_parts.append(decomposed.public_text)

    target_whisper = decomposed.whispers_by_character_id.get(target_character_id)
    if target_whisper:
        retained_parts.extend(target_whisper.raw_lines)

    return "\n".join(retained_parts).strip()


def sanitize_history_for_episodic_summary(
    user_message: str,
    campaign_characters: list[CharacterRecord],
) -> str:
    """Scrub private whispers from user messages before episodic compression.

    Ensures private sensory whispers do not leak into global storyline chunks.
    Retains public text and spoken dialogue in mentions, while scrubbing sensory cues.
    """
    decomposed = decompose_user_message(
        user_message,
        campaign_characters=campaign_characters,
    )
    summary_parts: list[str] = []
    if decomposed.public_text:
        summary_parts.append(decomposed.public_text)

    # Retain spoken speech (public dialogue) while dropping sensory whispers
    for whisper in decomposed.whispers:
        if whisper.speech_parts:
            speech_str = " ".join(f'"{s}"' for s in whisper.speech_parts)
            summary_parts.append(f"[{whisper.character_name}]: {speech_str}")

    return "\n".join(summary_parts).strip()
