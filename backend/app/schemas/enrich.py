"""Pydantic schemas for the AI Magic Wand text enrichment endpoint."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

EnrichFieldRole = Literal[
    "player_turn_prompt",
    "narrator_directive",
    "location_description",
    "location_tags",
    "character_persona",
    "lore_content",
]

EnrichInstruction = Literal["auto", "polish", "expand", "concise"]


class CampaignTurnEnrichContextRef(BaseModel):
    scope: Literal["campaign_turn"] = "campaign_turn"
    campaign_id: str
    parent_turn_id: str | None = None
    override_location_id: str | None = None


class WorldLocationEnrichContextRef(BaseModel):
    scope: Literal["world_location"] = "world_location"
    world_id: str | None = None
    location_id: str | None = None
    world_name: str | None = None
    genre: str | None = None
    tone: str | None = None
    setting_overview: str | None = None
    location_name: str | None = None
    location_summary: str | None = None
    location_description: str | None = None
    existing_tags: list[str] | None = None


class CharacterFieldEnrichContextRef(BaseModel):
    scope: Literal["character_field"] = "character_field"
    character_id: str
    world_id: str | None = None


EnrichContextRef = Annotated[
    CampaignTurnEnrichContextRef
    | WorldLocationEnrichContextRef
    | CharacterFieldEnrichContextRef,
    Field(discriminator="scope"),
]


class PromptEnrichRequest(BaseModel):
    field_role: EnrichFieldRole
    current_text: str = Field(default="", max_length=4000)
    instruction: EnrichInstruction = Field(default="auto")
    context_ref: EnrichContextRef
    single_line: bool = Field(default=False)
    max_words: int = Field(default=120, ge=10, le=500)


class PromptEnrichResponse(BaseModel):
    enriched_text: str
    mode_applied: Literal["generated", "enriched"]
    model_used: str
