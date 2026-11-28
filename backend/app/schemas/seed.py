"""Leaf schemas for showcase/seed update inspection, confirmation, and dismissal."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SeedUpdateMode = Literal["replace", "copy_and_update"]


class SeedUpdateInfo(BaseModel):
    """Library-only metadata indicating whether a seeded asset has a newer version."""

    seed_key: str
    current_version: int
    latest_version: int
    update_available: bool
    seed_modified: bool
    dismissed_version: int | None = None
    is_dismissed: bool = False
    changelog: str = ""
    has_custom_media: bool = False
    active_campaigns_count: int = 0
    linked_characters_count: int = 0


class SeedUpdateRequest(BaseModel):
    """Request payload for applying a seed update to a library world or character."""

    mode: SeedUpdateMode = "replace"
    copy_name: str | None = Field(default=None, max_length=160)
