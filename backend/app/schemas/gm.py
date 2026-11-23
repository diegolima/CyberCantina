"""Leaf Pydantic v2 schemas for GM Talk ('Neuromancer') out-of-character chat."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

GmModelRole = Literal["primary", "clerk"]
GmMentionKind = Literal["character", "persona", "lore", "location", "container", "turn"]
GmMentionCategory = Literal["characters", "lore", "locations", "containers", "turns"]


class GmMentionRef(BaseModel):
    """Structured reference pinned by a player via `@` mention in GM Talk."""

    kind: GmMentionKind
    id: str = Field(..., min_length=1, max_length=256)
    label: str = Field(..., min_length=1, max_length=200)


class GmMentionCandidate(BaseModel):
    """Live-search candidate returned by `GET /api/campaigns/{id}/gm/mentions`."""

    kind: GmMentionKind
    category: GmMentionCategory
    id: str
    label: str
    subtitle: str = ""
    badge: str = ""


class GmSourceRef(BaseModel):
    """Source attribution entry shown under a GM Talk assistant reply."""

    kind: str
    id: str
    label: str


class GmChatMessage(BaseModel):
    """Persisted out-of-character GM Talk message anchored to a timeline branch."""

    id: str
    campaign_id: str
    anchor_turn_id: str | None = None
    role: Literal["user", "assistant"]
    content: str
    mentions: list[GmMentionRef] = Field(default_factory=list)
    sources: list[GmSourceRef] = Field(default_factory=list)
    created_at: str


class GmChatRequest(BaseModel):
    """Incoming GM Talk question and pinned entity references."""

    message: str = Field(..., min_length=1, max_length=8000)
    mentions: list[GmMentionRef] = Field(default_factory=list, max_length=10)

    @field_validator("message")
    @classmethod
    def _validate_message_non_blank(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("GM message must not be empty.")
        return cleaned


class GmMessagesResponse(BaseModel):
    """Response payload for `GET /api/campaigns/{id}/gm/messages`."""

    messages: list[GmChatMessage] = Field(default_factory=list)
    unlock_lore: bool = False
    gm_model_role: GmModelRole = "primary"
    gm_model_name: str = ""
    gm_temperature: float = 0.5
    gm_max_tokens: int = 1024


class GmMentionsResponse(BaseModel):
    """Response payload for `GET /api/campaigns/{id}/gm/mentions`."""

    items: list[GmMentionCandidate] = Field(default_factory=list)
