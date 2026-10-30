"""Schemas for User Notes."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UserNoteRecord(BaseModel):
    id: str
    owner_id: str
    title: str = ""
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    is_starred: bool = False
    is_character_note: bool = False
    character_id: str | None = None
    created_at: str
    updated_at: str


class UserNoteCreatePayload(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    is_starred: bool = False


class UserNoteUpdatePayload(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    is_starred: bool | None = None
