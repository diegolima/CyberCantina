"""Campaign router instance, request schemas, concurrency turn gate, and monkeypatch resolver."""

from __future__ import annotations

import asyncio
import logging

from app.schemas.character import ItemFlag
from fastapi import APIRouter
from pydantic import (
    BaseModel,
    Field,
)
from typing import Literal


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


class LinkedLocationCreateRequest(BaseModel):
    from_location_id: str
    name: str
    compass_direction: str
    travel_minutes: int = 2
    description: str
    environmental_tags: list[str] = []


class CampaignEdgeCreateRequest(BaseModel):
    from_location_id: str
    to_location_id: str
    direction_label: str | None = None
    compass_direction: str = "N"
    travel_minutes: int = 1
    bidirectional: bool = True


class CampaignEdgeDistanceUpdateRequest(BaseModel):
    travel_minutes: int
    update_reciprocal: bool = True


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
