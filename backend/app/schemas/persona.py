"""User persona, knowledge visibility, and dynamic state schemas."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator
from app.schemas.character import ItemFlag

DisclosureDetectionMode = Literal["llm_intent", "token_matching", "hybrid"]


def normalize_persona_item_key(raw: str) -> str:
    """Normalize item name for stable deterministic ID derivation."""
    cleaned = re.sub(r"\s+", " ", (raw or "").strip().lower())
    cleaned = re.sub(r"^\[(?:worn|carried|equipped|held|stashed|clothing|item|object)\]\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*\((?:worn|carried|equipped|held|stashed|clothing|item|object)\)$", "", cleaned, flags=re.I).strip()
    return cleaned or "item"


def deterministic_persona_item_id(name: str) -> str:
    """Generate deterministic item ID from normalized name."""
    norm = normalize_persona_item_key(name)
    digest = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:10]
    return f"item_{digest}"


class PersonaItemInstance(BaseModel):
    """An item owned by the persona (equipped or carried in inventory)."""

    id: str = Field(
        default="",
        description="Stable item identifier (deterministic hash if omitted).",
    )
    name: str = Field(..., min_length=1, max_length=160)
    note: str = Field(
        default="",
        max_length=300,
        description="Sensory details, function, or secret properties.",
    )
    flags: list[ItemFlag] = Field(default_factory=list)
    is_secret: bool = Field(
        default=True,
        description="Whether this item is concealed from characters until revealed.",
    )
    trigger_keywords: list[str] = Field(
        default_factory=list,
        description="Keywords that reveal this item when typed in the user prompt or mentioned in gossip.",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_input(cls, data: Any) -> Any:
        if isinstance(data, cls):
            return data
        if isinstance(data, str):
            clean = re.sub(r"\s+", " ", data.strip())[:160]
            if not clean:
                raise ValueError("Item name cannot be empty.")
            return {
                "id": deterministic_persona_item_id(clean),
                "name": clean,
                "note": "",
                "flags": [],
                "is_secret": True,
                "trigger_keywords": [clean.lower()],
            }
        if isinstance(data, dict):
            raw_name = str(data.get("name") or "").strip()[:160]
            if not raw_name:
                raise ValueError("Item name cannot be empty.")
            item_id = str(data.get("id") or "").strip() or deterministic_persona_item_id(raw_name)
            kws = data.get("trigger_keywords")
            if not isinstance(kws, list):
                kws = [raw_name.lower()]
            return {
                **data,
                "id": item_id,
                "name": raw_name,
                "trigger_keywords": [str(k).strip().lower() for k in kws if str(k).strip()],
            }
        return data


class PersonaLoreEntry(BaseModel):
    """A secret backstory, affiliation, or trait possessed by the player character."""

    id: str = Field(
        default="",
        description="Unique identifier, e.g. 'lore_ex_corpo_agent'.",
    )
    title: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=1500)
    is_secret: bool = Field(
        default=True,
        description="If True, only characters who have unlocked this entry will recall it.",
    )
    trigger_keywords: list[str] = Field(
        default_factory=list,
        description="Keywords in dialogue/prose that trigger the revelation of this lore.",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_input(cls, data: Any) -> Any:
        if isinstance(data, cls):
            return data
        if isinstance(data, dict):
            raw_title = str(data.get("title") or "").strip()[:120]
            lore_id = str(data.get("id") or "").strip()
            if not lore_id:
                digest = hashlib.sha1((raw_title or "lore").lower().encode("utf-8")).hexdigest()[:10]
                lore_id = f"lore_{digest}"
            kws = data.get("trigger_keywords")
            if not isinstance(kws, list):
                kws = [raw_title.lower()] if raw_title else []
            return {
                **data,
                "id": lore_id,
                "title": raw_title,
                "trigger_keywords": [str(k).strip().lower() for k in kws if str(k).strip()],
            }
        return data


class PersonaKnowledgeProvenance(BaseModel):
    """Tracks how an NPC learned a piece of player knowledge."""

    unlocked_at_turn_id: str
    learned_from: str = Field(description="'player' or character_id of the gossiping NPC.")


class PersonaRecord(BaseModel):
    """Stored player persona profile (used for both master template and campaign baseline)."""

    id: str
    owner_id: str
    name: str = Field(..., min_length=1, max_length=100)
    age: str | None = None
    age_is_secret: bool = Field(
        default=True,
        description="Default True. If True, locked until user mentions or introduces age.",
    )
    physical_appearance: str = Field(
        default="",
        description="Immutable visible anatomy. Always public (cannot be marked secret).",
    )
    equipped: list[PersonaItemInstance] = Field(
        default_factory=list,
        description="Visible garments and wielded weapons. Default is_secret: False.",
    )
    inventory: list[PersonaItemInstance] = Field(
        default_factory=list,
        description="Concealed carried items. Default is_secret: True.",
    )
    lore_entries: list[PersonaLoreEntry] = Field(
        default_factory=list,
        description="Secret background facets. Default is_secret: True.",
    )
    created_at: str
    updated_at: str


DEFAULT_PERSONA_NAME = "User"
DEFAULT_PERSONA_ID = "persona_default_user"


def default_persona_id_for_user(user_id: str) -> str:
    """Return the deterministic persona ID for a user's default persona."""
    return f"persona_default_{user_id}"


def is_default_persona_id(persona_id: str) -> bool:
    """Check if a persona ID belongs to a default persona."""
    return persona_id.startswith("persona_default_") or persona_id == DEFAULT_PERSONA_ID


def get_default_persona(owner_id: str = "default_user") -> PersonaRecord:
    """Return the hard-coded default persona with blank attributes and named 'User' for a specific owner."""
    resolved_owner = owner_id or "default_user"
    p_id = default_persona_id_for_user(resolved_owner)
    return PersonaRecord(
        id=p_id,
        owner_id=resolved_owner,
        name=DEFAULT_PERSONA_NAME,
        age=None,
        age_is_secret=False,
        physical_appearance="",
        equipped=[],
        inventory=[],
        lore_entries=[],
        created_at="2025-01-01T00:00:00Z",
        updated_at="2025-01-01T00:00:00Z",
    )


class PersonaCreatePayload(BaseModel):
    """Payload to create a new persona in the master gallery."""

    name: str = Field(..., min_length=1, max_length=100)
    age: str | None = None
    age_is_secret: bool = True
    physical_appearance: str = ""
    equipped: list[PersonaItemInstance] = Field(default_factory=list)
    inventory: list[PersonaItemInstance] = Field(default_factory=list)
    lore_entries: list[PersonaLoreEntry] = Field(default_factory=list)


class PersonaUpdatePayload(BaseModel):
    """Payload to update an existing persona in the master gallery."""

    name: str | None = None
    age: str | None = None
    age_is_secret: bool | None = None
    physical_appearance: str | None = None
    equipped: list[PersonaItemInstance] | None = None
    inventory: list[PersonaItemInstance] | None = None
    lore_entries: list[PersonaLoreEntry] | None = None


class PersonaTurnStateSnapshot(BaseModel):
    """Turn-indexed mutable inventory state of the player character."""

    turn_id: str
    equipped: list[PersonaItemInstance] = Field(default_factory=list)
    inventory: list[PersonaItemInstance] = Field(default_factory=list)
