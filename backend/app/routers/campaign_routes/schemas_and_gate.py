"""Campaign router instance, request schemas, concurrency turn gate, and monkeypatch resolver."""

from __future__ import annotations

import asyncio
import logging

from app.schemas.character import ItemFlag
from app.schemas.gm import GmCodexProposal
from app.schemas.turn import CampaignStateBundle
from app.schemas.world import (
    DEFAULT_INTERIOR_DISTANCE_METERS,
    MAX_EDGE_DISTANCE_METERS,
    MAX_EDGE_SPEED_MODIFIER,
    MAX_EDGE_TRAVEL_MODE_LENGTH,
    MIN_EDGE_SPEED_MODIFIER,
    WALKING_METERS_PER_MINUTE,
    WorldLoreNodeDraft,
)
from app.schemas.party import LocationOverrideMoveMode
from fastapi import APIRouter
from pydantic import (
    BaseModel,
    Field,
    model_validator,
)
from typing import Any, Literal


def _resolve_facade_attr(name: str, default: object):
    import sys

    mod = sys.modules.get("app.routers.campaigns")
    if mod is not None and hasattr(mod, name):
        return getattr(mod, name)
    return default

logger = logging.getLogger("cybercantina.routers.campaigns")


router = APIRouter(tags=["campaigns"])


class CampaignCreateRequest(BaseModel):
    name: str
    world_id: str
    character_id: str | None = None
    persona_id: str | None = None
    character_ids: list[str] = Field(default_factory=list)
    character_locations: dict[str, str] | None = None
    start_in_party_character_ids: list[str] = Field(default_factory=list)
    opening_prose: str | None = None
    start_focus: Literal["world", "character"] = "character"
    focus_character_id: str | None = None


class CampaignAddCharacterRequest(BaseModel):
    character_id: str
    location_id: str | None = None


class BranchCheckoutRequest(BaseModel):
    turn_id: str


class LocationOverrideRequest(BaseModel):
    location_id: str
    move_mode: LocationOverrideMoveMode = "party"
    accompanying_character_ids: list[str] | None = None


class CharacterLocationOverrideRequest(BaseModel):
    location_id: str


class PartyCreateRequest(BaseModel):
    member_ids: list[str] = Field(default_factory=list)
    name: str | None = None
    shared_goal: str | None = None


class ItemEquipToggleRequest(BaseModel):
    item: str = ""
    item_id: str | None = None
    action: Literal["equip", "unequip", "remove", "add", "update"]
    target: Literal["equipped", "inventory"] | None = None
    character_id: str | None = None
    new_name: str | None = None
    note: str | None = None
    flags: list[ItemFlag] | None = None
    lore_id: str | None = None


def _coerce_legacy_api_distance(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    if data.get("distance_meters") is None and data.get("travel_minutes") is not None:
        out = dict(data)
        raw_min = out.pop("travel_minutes")
        try:
            out["distance_meters"] = max(
                1,
                min(
                    MAX_EDGE_DISTANCE_METERS,
                    int(round(float(raw_min) * WALKING_METERS_PER_MINUTE)),
                ),
            )
        except (TypeError, ValueError):
            out["distance_meters"] = raw_min
        return out
    return data


class LinkedLocationCreateRequest(BaseModel):
    from_location_id: str
    name: str
    compass_direction: str
    distance_meters: int = Field(
        default=DEFAULT_INTERIOR_DISTANCE_METERS,
        ge=1,
        le=MAX_EDGE_DISTANCE_METERS,
    )
    description: str
    environmental_tags: list[str] = []

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_distance(cls, data: Any) -> Any:
        return _coerce_legacy_api_distance(data)


class CampaignEdgeCreateRequest(BaseModel):
    from_location_id: str
    to_location_id: str
    direction_label: str | None = None
    compass_direction: str = "N"
    distance_meters: int | None = Field(
        default=None,
        ge=1,
        le=MAX_EDGE_DISTANCE_METERS,
    )
    speed_modifier: float = Field(
        default=1.0,
        ge=MIN_EDGE_SPEED_MODIFIER,
        le=MAX_EDGE_SPEED_MODIFIER,
    )
    travel_mode: str | None = Field(default=None, max_length=MAX_EDGE_TRAVEL_MODE_LENGTH)
    obstacles: list[str] = Field(default_factory=list)
    is_blocked: bool = False
    is_secret: bool = False
    bidirectional: bool = True

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_distance(cls, data: Any) -> Any:
        return _coerce_legacy_api_distance(data)


class CampaignEdgeDistanceUpdateRequest(BaseModel):
    distance_meters: int | None = Field(
        default=None, ge=1, le=MAX_EDGE_DISTANCE_METERS
    )
    speed_modifier: float | None = Field(
        default=None, ge=MIN_EDGE_SPEED_MODIFIER, le=MAX_EDGE_SPEED_MODIFIER
    )
    travel_mode: str | None = Field(default=None, max_length=MAX_EDGE_TRAVEL_MODE_LENGTH)
    obstacles: list[str] | None = None
    is_blocked: bool | None = None
    is_secret: bool | None = None
    direction_label: str | None = Field(default=None, max_length=120)
    reciprocal_direction_label: str | None = Field(default=None, max_length=120)
    update_reciprocal: bool = True

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_distance(cls, data: Any) -> Any:
        return _coerce_legacy_api_distance(data)


CampaignEdgeUpdateRequest = CampaignEdgeDistanceUpdateRequest


class CampaignEdgeRevealRequest(BaseModel):
    revealed: bool


class CampaignWorldSettingsPatchRequest(BaseModel):
    describe_on_first_visit: bool | None = None
    unlock_lore: bool | None = None


class CampaignWorldLoreUpdateRequest(BaseModel):
    lore_nodes: list[WorldLoreNodeDraft] = Field(default_factory=list)


class CampaignWorldLoreEntryUpsertRequest(BaseModel):
    draft: WorldLoreNodeDraft
    replace_lore_id: str | None = Field(default=None, max_length=128)
    proposal_message_id: str | None = Field(default=None, max_length=128)
    proposal_id: str | None = Field(default=None, max_length=128)


class CampaignWorldLoreEntryUpsertResponse(BaseModel):
    bundle: CampaignStateBundle
    saved_lore_id: str
    proposal: GmCodexProposal | None = None


class CampaignLoreRevealRequest(BaseModel):
    revealed: bool


class CampaignMajorEventUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    summary: str = Field(..., min_length=1, max_length=2000)
    keywords: list[str] = Field(default_factory=list)
    updated_description: str | None = None
    environmental_tags: list[str] | None = None


class TurnBookmarkUpdateRequest(BaseModel):
    is_bookmarked: bool | None = None
    user_note: str | None = Field(default=None, max_length=500)


class TurnBookmarkSummaryResponse(BaseModel):
    summary: str


class CampaignTurnGate:
    """Keyed per-campaign asyncio.Lock registry serializing turn streams, swipes, and deletes."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}

    def lock_for(self, campaign_id: str) -> asyncio.Lock:
        lock = self._locks.get(campaign_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[campaign_id] = lock
        return lock


campaign_turn_gate = CampaignTurnGate()
