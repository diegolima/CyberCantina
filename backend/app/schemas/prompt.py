"""Schemas for Prompt Presets, Template Customization, and Documentation."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PromptVariableDoc(BaseModel):
    name: str
    description: str


class PromptMetadata(BaseModel):
    key: str
    title: str
    description: str
    available_variables: list[PromptVariableDoc] = Field(default_factory=list)
    required_tags: list[str] = Field(default_factory=list)


class PromptPresetRecord(BaseModel):
    id: str
    owner_id: str | None = None
    name: str
    description: str = ""
    is_builtin: bool = False
    prompts: dict[str, str] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class PromptPresetCreatePayload(BaseModel):
    name: str
    description: str = ""
    base_preset_id: str | None = None
    prompts: dict[str, str] | None = None


class PromptPresetUpdatePayload(BaseModel):
    name: str | None = None
    description: str | None = None
    prompts: dict[str, str] | None = None


class PromptDefaultsResponse(BaseModel):
    presets: list[PromptPresetRecord]
    defaults: dict[str, str]
    metadata: list[PromptMetadata]
    active_preset_id: str | None = None
