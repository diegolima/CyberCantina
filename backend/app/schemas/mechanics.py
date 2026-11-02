"""Schemas for mechanics checks, previews, and dice calculations."""

from __future__ import annotations

import re
from typing import Any
from pydantic import BaseModel, Field, field_validator

from app.schemas.turn import (
    DEFAULT_GATE_DC,
    CanonicalOutcomeTier,
    CharacterChoiceSet,
    ChoiceGate,
    ChoiceStatus,
    DiceMode,
)


class ChoicePreviewOption(BaseModel):
    id: str = ""
    label: str = Field(default="", max_length=80)
    gate: ChoiceGate = "any"

    @field_validator("label", mode="before")
    @classmethod
    def _sanitize_label(cls, v: Any) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[<>]", "", s).strip()
        return s


class ChoicePreviewSet(BaseModel):
    character_id: str = ""
    options: list[ChoicePreviewOption] = Field(default_factory=list, max_length=10)
    gate_difficulty_class: int = Field(default=DEFAULT_GATE_DC, ge=1, le=30)


class ChoicePreviewRequest(BaseModel):
    choice_set: ChoicePreviewSet | CharacterChoiceSet
    dice_mode: DiceMode = "auto"
    manual_dice_override: int | None = Field(default=None, ge=1, le=20)


class ChoicePreviewOutcome(BaseModel):
    status: ChoiceStatus
    allowed: list[str]
    excluded: list[str]
    probability: float
    tiers: list[CanonicalOutcomeTier]


class ChoicePreviewResponse(BaseModel):
    difficulty_class: int
    modifier: int
    pinned_d20: int | None
    tier_probabilities: dict[CanonicalOutcomeTier, float]
    gate_probabilities: dict[ChoiceGate, float]
    outcomes: list[ChoicePreviewOutcome]
