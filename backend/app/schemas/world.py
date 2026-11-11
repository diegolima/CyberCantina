"""World settings, spatial topology graph, and lore schemas."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CompassDirection = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
SharedLoreCategory = Literal["history", "culture", "faction", "rumor"]
WorldLoreCategory = Literal["history", "culture", "faction", "rumor", "artifact"]
LocationLoreCategory = Literal["history", "culture", "faction", "rumor", "secret"]
AnyLoreCategory = Literal["history", "culture", "faction", "rumor", "artifact", "secret"]

WORLD_LORE_CATEGORIES: tuple[WorldLoreCategory, ...] = (
    "history",
    "culture",
    "faction",
    "rumor",
    "artifact",
)
LOCATION_LORE_CATEGORIES: tuple[LocationLoreCategory, ...] = (
    "history",
    "culture",
    "faction",
    "rumor",
    "secret",
)

_FALLBACK_TAG_STOPWORDS = {
    "the",
    "and",
    "for",
    "from",
    "with",
    "into",
    "over",
    "under",
    "this",
    "that",
    "about",
}


def normalize_lore_category(
    raw: Any,
    *,
    allow_secret: bool,
    allow_artifact: bool | None = None,
    strict: bool = True,
) -> str:
    """Normalize and validate a lore category ('rumour' -> 'rumor')."""
    if allow_artifact is None:
        allow_artifact = not allow_secret

    if not isinstance(raw, str) or not raw.strip():
        if strict:
            raise ValueError("Lore category is required and cannot be empty.")
        return "history"

    cat = raw.strip().lower()
    if cat == "rumour":
        cat = "rumor"

    allowed: set[str] = {"history", "culture", "faction", "rumor"}
    if allow_secret:
        allowed.add("secret")
    if allow_artifact:
        allowed.add("artifact")

    if cat in allowed:
        return cat

    if not strict:
        legacy_map = {
            "item": "rumor",
            "items": "rumor",
            "artifact": "artifact" if allow_artifact else "rumor",
            "artifacts": "artifact" if allow_artifact else "rumor",
            "rule": "culture",
            "rules": "culture",
            "law": "culture",
            "factions": "faction",
            "rumors": "rumor",
            "rumours": "rumor",
            "secret": "secret" if allow_secret else "rumor",
            "secrets": "secret" if allow_secret else "rumor",
        }
        return legacy_map.get(cat, "history")

    allowed_str = ", ".join(sorted(allowed))
    raise ValueError(f"Invalid lore category '{raw}'. Allowed categories: {allowed_str}.")


def synthesize_fallback_tags(title: str, content: str = "") -> list[str]:
    """Deterministically extract 1-3 fallback keywords for legacy DB migration or LLM salvage."""
    candidates = re.findall(r"[a-z0-9]{3,}", f"{title} {content}".lower())
    seen: set[str] = set()
    tags: list[str] = []
    for tok in candidates:
        if tok in _FALLBACK_TAG_STOPWORDS or tok in seen:
            continue
        seen.add(tok)
        tags.append(tok[:64])
        if len(tags) >= 3:
            break
    return tags or ["lore"]


def normalize_and_validate_entity_tags(
    raw_tags: Any,
    *,
    strict: bool = True,
    fallback_title: str = "",
    fallback_content: str = "",
) -> list[str]:
    """Trim, deduplicate case-insensitively, and enforce >= 1 non-empty trigger keyword."""
    if not isinstance(raw_tags, list):
        if strict:
            raise ValueError("entity_tags must be a list of non-empty strings.")
        raw_tags = []

    cleaned: list[str] = []
    seen_lower: set[str] = set()
    for item in raw_tags:
        if not isinstance(item, str):
            if strict:
                raise ValueError("Each entity tag must be a string.")
            continue
        # Collapse whitespace/newlines and cap individual tag length
        tag = re.sub(r"\s+", " ", item).strip()[:64]
        if not tag:
            continue
        low = tag.lower()
        if low in seen_lower:
            continue
        seen_lower.add(low)
        cleaned.append(tag)
        if len(cleaned) >= 20:
            break

    if not cleaned:
        if strict:
            raise ValueError("Each lore entry must include at least 1 non-empty keyword.")
        return synthesize_fallback_tags(fallback_title, fallback_content)

    return cleaned

COMPASS_DIRECTIONS: tuple[CompassDirection, ...] = (
    "N",
    "NE",
    "E",
    "SE",
    "S",
    "SW",
    "W",
    "NW",
)

OPPOSITE_COMPASS: dict[str, CompassDirection] = {
    "N": "S",
    "NE": "SW",
    "E": "W",
    "SE": "NW",
    "S": "N",
    "SW": "NE",
    "W": "E",
    "NW": "SE",
}

COMPASS_PASSAGE_NAMES: dict[str, str] = {
    "N": "North Passage",
    "NE": "Northeast Passage",
    "E": "East Passage",
    "SE": "Southeast Passage",
    "S": "South Passage",
    "SW": "Southwest Passage",
    "W": "West Passage",
    "NW": "Northwest Passage",
}


def normalize_compass_direction(
    raw_dir: str | None = None,
    fallback_text: str = "",
) -> CompassDirection:
    """Normalize a raw compass string or infer one from narrative direction text."""
    if raw_dir:
        cleaned = re.sub(r"[^A-Za-z]", "", raw_dir).upper()
        alias_map: dict[str, CompassDirection] = {
            "N": "N",
            "NORTH": "N",
            "NE": "NE",
            "NORTHEAST": "NE",
            "E": "E",
            "EAST": "E",
            "SE": "SE",
            "SOUTHEAST": "SE",
            "S": "S",
            "SOUTH": "S",
            "SW": "SW",
            "SOUTHWEST": "SW",
            "W": "W",
            "WEST": "W",
            "NW": "NW",
            "NORTHWEST": "NW",
        }
        if cleaned in alias_map:
            return alias_map[cleaned]

    low = f"{raw_dir or ''} {fallback_text}".lower()
    compound_patterns: list[tuple[str, CompassDirection]] = [
        (r"\b(north[\s\-]?east|ne)\b", "NE"),
        (r"\b(north[\s\-]?west|nw)\b", "NW"),
        (r"\b(south[\s\-]?east|se)\b", "SE"),
        (r"\b(south[\s\-]?west|sw)\b", "SW"),
        (r"\b(north|northern|back|rear|behind|upstairs|up|above|mezzanine|roof)\b", "N"),
        (r"\b(east|eastern|right|starboard)\b", "E"),
        (r"\b(south|southern|front|street|outside|downstairs|down|below|basement|sub-basement|hatch|cellar)\b", "S"),
        (r"\b(west|western|left|port|alley|side)\b", "W"),
    ]
    for pat, cdir in compound_patterns:
        if re.search(pat, low):
            return cdir
    return "N"


def pick_available_compass_direction(
    preferred: CompassDirection,
    occupied: set[str],
) -> CompassDirection:
    """Return preferred direction if free, else the nearest unoccupied compass slot."""
    if preferred not in occupied:
        return preferred
    idx = COMPASS_DIRECTIONS.index(preferred)
    n_dirs = len(COMPASS_DIRECTIONS)
    for offset in range(1, n_dirs):
        for sign in (1, -1):
            candidate = COMPASS_DIRECTIONS[(idx + offset * sign) % n_dirs]
            if candidate not in occupied:
                return candidate
    return preferred


class WorldGlobalRules(BaseModel):
    """High-level setting rules kept in Zone 1 Static Prefix."""

    genre: str = Field(description="Primary genre and subgenre.")
    tone: str = Field(
        default="Immersive, atmospheric, grounded consequences, sharp dialogue.",
        description="Narrative tone and stylistic atmosphere.",
    )
    setting_overview: str = Field(
        description="2-4 sentence macro overview of the world, power structures, and daily reality."
    )
    tech_or_magic_rules: str = Field(
        default="Actions and physical feats are bounded by the plausible technology, magic, or physical laws of the setting.",
        description="Key constraints so the LLM maintains world consistency.",
    )
    starting_timestamp: str = Field(
        default="2094-11-14 23:15",
        description="Initial world clock timestamp (YYYY-MM-DD HH:MM).",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_rules(cls, data: Any) -> Any:
        if isinstance(data, dict):
            raw_genre = data.get("genre")
            if not raw_genre or not str(raw_genre).strip():
                for alias in ("genre_and_tone", "genre_tone", "genre_setting"):
                    val = data.get(alias)
                    if isinstance(val, str) and val.strip():
                        data["genre"] = val.strip()
                        break
                else:
                    data["genre"] = "Speculative Fiction"
            raw_tone = data.get("tone")
            if not raw_tone or not str(raw_tone).strip():
                for alias in ("mood", "atmosphere", "narrative_tone"):
                    val = data.get(alias)
                    if isinstance(val, str) and val.strip():
                        data["tone"] = val.strip()
                        break
        return data


class BaseLoreNodeInput(BaseModel):
    """Shared strict validation base for any user-submitted or persisted lore input."""

    id: str | None = None
    title: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=2000)
    entity_tags: list[str] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="Keywords/names that link this lore node to mentions in dialogue (at least 1 required).",
    )

    @field_validator("title", "content", mode="before")
    @classmethod
    def _validate_non_empty_text(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Lore title and content cannot be empty.")
        return v.strip()

    @field_validator("entity_tags", mode="before")
    @classmethod
    def _validate_entity_tags(cls, v: Any) -> list[str]:
        return normalize_and_validate_entity_tags(v, strict=True)


class WorldLoreNodeDraft(BaseLoreNodeInput):
    """Strict world-level macro lore entry (history, culture, faction, rumor, artifact)."""

    category: WorldLoreCategory

    @field_validator("category", mode="before")
    @classmethod
    def _validate_world_category(cls, v: Any) -> str:
        return normalize_lore_category(v, allow_secret=False, allow_artifact=True, strict=True)


LoreNodeDraft = WorldLoreNodeDraft


class LocationLoreNodeDraft(BaseLoreNodeInput):
    """Strict location-level lore entry (history, culture, faction, rumor, secret)."""

    category: LocationLoreCategory

    @field_validator("category", mode="before")
    @classmethod
    def _validate_location_category(cls, v: Any) -> str:
        return normalize_lore_category(v, allow_secret=True, allow_artifact=False, strict=True)


class WizardLoreNodeLLMOutput(BaseModel):
    """Lenient LLM-ingestion schema for World Wizard generation; salvages legacy categories & missing tags."""

    title: str = Field(default="")
    category: str = Field(
        default="faction",
        description="One of: history, culture, faction, rumor, artifact.",
    )
    content: str = Field(default="", description="Concise 2-4 sentence macro world lore entry.")
    entity_tags: list[str] = Field(
        default_factory=list,
        description="At least 1-5 trigger keywords linking this lore entry to dialogue mentions.",
    )

    @model_validator(mode="before")
    @classmethod
    def _remap_llm_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Remap name/topic/header -> title
            if not data.get("title") and data.get("name"):
                data["title"] = data["name"]
            elif not data.get("title") and data.get("topic"):
                data["title"] = data["topic"]
            elif not data.get("title") and data.get("header"):
                data["title"] = data["header"]

            # Remap description/text/body/summary/lore -> content
            if not data.get("content"):
                data["content"] = (
                    data.get("description")
                    or data.get("text")
                    or data.get("body")
                    or data.get("summary")
                    or data.get("lore")
                    or ""
                )
        return data

    def to_strict_draft(self) -> WorldLoreNodeDraft:
        clean_title = (self.title or "").strip()[:120]
        clean_cat = normalize_lore_category(self.category, allow_secret=False, strict=False)
        clean_tags = normalize_and_validate_entity_tags(
            self.entity_tags,
            strict=False,
            fallback_title=clean_title or f"{clean_cat.capitalize()} Lore",
            fallback_content=(self.content or "").strip()[:2000],
        )
        if not clean_title or clean_title.lower() == "world lore":
            if clean_tags:
                clean_title = f"{clean_cat.capitalize()}: {', '.join(t.capitalize() for t in clean_tags[:2])}"
            else:
                clean_title = f"{clean_cat.capitalize()} Lore"

        clean_content = (self.content or "").strip()[:2000]
        if not clean_content or clean_content.lower() == "world lore":
            tag_summary = f" relating to {', '.join(clean_tags)}" if clean_tags else ""
            clean_content = f"Key {clean_cat} lore shaping regional history and events{tag_summary}."

        return WorldLoreNodeDraft(
            title=clean_title,
            category=clean_cat,  # type: ignore[arg-type]
            content=clean_content,
            entity_tags=clean_tags,
        )


class WizardLocationNodeLLMOutput(BaseModel):
    """LLM-facing draft location node without lore_nodes so location lore is never autogenerated."""

    key: str = Field(description="Slug identifier used to wire edges during creation, e.g. 'main_bar'.")
    name: str = Field(description="Display name of the location, e.g. 'The Neon Rust Main Floor'.")
    summary: str = Field(
        description="1-sentence purpose/hook injected when this location is an adjacent exit."
    )
    description: str = Field(
        description="3-5 sentences of rich sensory detail injected when characters are inside this location."
    )
    environmental_tags: list[str] = Field(
        default_factory=list,
        description="Ambient features, interactive props, lighting, or hazards.",
    )
    is_starting_location: bool = Field(default=False)
    is_hub: bool = Field(default=False)
    starting_message: str = Field(
        default="",
        description="Atmospheric Turn 0 opening scene prose if this room serves as campaign entry.",
    )

    def to_location_draft(self) -> "LocationNodeDraft":
        return LocationNodeDraft(
            key=self.key,
            name=self.name,
            summary=self.summary,
            description=self.description,
            environmental_tags=list(self.environmental_tags),
            is_starting_location=self.is_starting_location,
            is_hub=self.is_hub,
            starting_message=self.starting_message,
            lore_nodes=[],
        )


class LocationNodeDraft(BaseModel):
    """Draft location node for the Spatial Engine and World Wizard commit payload."""

    key: str = Field(description="Slug identifier used to wire edges during creation, e.g. 'main_bar'.")
    name: str = Field(description="Display name of the location, e.g. 'The Neon Rust Main Floor'.")
    summary: str = Field(
        description="1-sentence purpose/hook injected when this location is an adjacent exit."
    )
    description: str = Field(
        description="3-5 sentences of rich sensory detail injected when characters are inside this location."
    )
    environmental_tags: list[str] = Field(
        default_factory=list,
        description="Ambient features, interactive props, lighting, or hazards.",
    )
    is_starting_location: bool = Field(default=False)
    is_hub: bool = Field(default=False)
    starting_message: str = Field(
        default="",
        description="Atmospheric Turn 0 opening scene prose if this room serves as campaign entry.",
    )
    lore_nodes: list[LocationLoreNodeDraft] = Field(
        default_factory=list,
        description="User-authored location lore entries preserved across wizard review -> commit.",
    )


class LocationEdgeDraft(BaseModel):
    """Directed or bidirectional connection between two locations."""

    from_key: str = Field(description="Source location slug key.")
    to_key: str = Field(description="Target location slug key.")
    direction_label: str = Field(
        description="How a character traverses this path, e.g. 'Beaded curtain behind the bar'."
    )
    reverse_direction_label: str = Field(
        default="Way back",
        description="Label for returning along this edge.",
    )
    compass_direction: CompassDirection | None = Field(
        default=None,
        description="Compass slot (N, NE, E, SE, S, SW, W, NW) from source to target.",
    )
    travel_minutes: int = Field(default=1, ge=0, le=1440)
    is_locked_or_hidden: bool = Field(default=False)
    bidirectional: bool = Field(default=True)


class WorldWizardSeed(BaseModel):
    """User-provided basic inputs for the 1.2 World Creation Wizard."""

    name: str = Field(..., min_length=1, description="Name of the world or scenario setting.")
    genre_and_tone: str = Field(..., description="Genre, mood, and inspirations.")
    core_premise: str = Field(..., description="Central conflict, atmosphere, or starting hook.")
    initial_hub_concept: str = Field(
        default="",
        description="Description of the starting area where roleplay begins.",
    )
    location_count: int = Field(default=5, ge=3, le=10)


class WorldWizardDraft(BaseModel):
    """AI-expanded world package produced by the World Wizard (strict on commit)."""

    name: str
    global_rules: WorldGlobalRules
    locations: list[LocationNodeDraft]
    edges: list[LocationEdgeDraft]
    lore_nodes: list[WorldLoreNodeDraft]


class WorldMapReimagineRequest(BaseModel):
    """User request to re-imagine the spatial map of a world draft or existing world."""

    world_name: str = Field(..., description="Name of the world setting.")
    global_rules: WorldGlobalRules = Field(..., description="Active world rules and tone.")
    map_description: str = Field(
        ...,
        min_length=1,
        description="User's desired vision, thematic focus, or specific spatial layout for the regenerated map.",
    )
    location_count: int = Field(default=5, ge=3, le=10)


class WorldMapDraft(BaseModel):
    """Regenerated spatial topology package."""

    locations: list[LocationNodeDraft]
    edges: list[LocationEdgeDraft]


class LoreNode(BaseModel):
    """Persisted lore node (world-scoped when location_id is None, location-scoped when set)."""

    id: str
    world_id: str
    location_id: str | None = None
    campaign_id: str | None = None
    title: str = Field(..., min_length=1, max_length=120)
    category: AnyLoreCategory
    content: str = Field(..., min_length=1, max_length=2000)
    entity_tags: list[str] = Field(..., min_length=1, max_length=20)

    @field_validator("title", "content", mode="before")
    @classmethod
    def _validate_text(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Lore title and content cannot be empty.")
        return v.strip()

    @field_validator("category", mode="before")
    @classmethod
    def _validate_category(cls, v: Any) -> str:
        return normalize_lore_category(v, allow_secret=True, allow_artifact=True, strict=True)

    @field_validator("entity_tags", mode="before")
    @classmethod
    def _validate_tags(cls, v: Any) -> list[str]:
        return normalize_and_validate_entity_tags(v, strict=True)

    @model_validator(mode="after")
    def _enforce_scope_invariants(self) -> "LoreNode":
        if self.location_id is None and self.category == "secret":
            raise ValueError(
                "Category 'secret' is only allowed on location lore entries, not world lore."
            )
        if self.location_id is not None and self.category == "artifact":
            raise ValueError(
                "Category 'artifact' is only allowed on world lore entries, not location lore."
            )
        if self.campaign_id is not None and self.location_id is None:
            raise ValueError(
                "Campaign-scoped lore overrides must belong to a specific location."
            )
        return self


class LocationNode(BaseModel):
    """Persisted spatial graph node."""

    id: str
    world_id: str
    created_at_turn_id: str | None = None
    name: str
    summary: str
    description: str
    environmental_tags: list[str] = Field(default_factory=list)
    is_starting_location: bool = False
    is_hub: bool = False
    starting_message: str = Field(
        default="",
        description="Atmospheric Turn 0 opening scene prose if this room serves as campaign entry.",
    )
    lore_nodes: list[LoreNode] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _bind_nested_location_lore(cls, data: Any) -> Any:
        if isinstance(data, dict) and isinstance(data.get("lore_nodes"), list):
            loc_id = data.get("id")
            w_id = data.get("world_id") or ""
            if loc_id:
                bound: list[Any] = []
                for idx, entry in enumerate(data["lore_nodes"]):
                    if isinstance(entry, dict):
                        patched = dict(entry)
                        patched["location_id"] = patched.get("location_id") or loc_id
                        patched["world_id"] = patched.get("world_id") or w_id
                        patched["id"] = patched.get("id") or f"new_loc_lore_{idx}"
                        bound.append(patched)
                    elif isinstance(entry, LoreNode) and entry.location_id != loc_id:
                        bound.append(entry.model_copy(update={"location_id": loc_id}))
                    else:
                        bound.append(entry)
                data = {**data, "lore_nodes": bound}
        return data


class LocationEdge(BaseModel):
    """Persisted spatial graph edge."""

    id: str
    world_id: str
    from_location_id: str
    to_location_id: str
    direction_label: str
    compass_direction: CompassDirection | None = None
    travel_minutes: int = 1
    is_locked_or_hidden: bool = False
    created_at_turn_id: str | None = None
    superseded_at_turn_id: str | None = None


class NeighborLocationView(BaseModel):
    """1-hop spatial neighbor resolved for the active location."""

    edge_id: str
    direction_label: str
    compass_direction: CompassDirection | None = None
    travel_minutes: int
    is_locked_or_hidden: bool
    destination: LocationNode


def _enforce_world_level_lore_nodes(nodes: list[LoreNode]) -> list[LoreNode]:
    for node in nodes:
        if node.location_id is not None:
            raise ValueError(
                "World-level lore_nodes must not set location_id; attach location lore to LocationNode.lore_nodes."
            )
        if node.category == "secret":
            raise ValueError("Category 'secret' is not allowed on world-level lore entries.")
    return nodes


class WorldRecord(BaseModel):
    """Complete persisted world with spatial topology and lore."""

    id: str
    name: str
    global_rules: WorldGlobalRules
    pending_deletion: bool = False
    created_at: str
    locations: list[LocationNode] = Field(default_factory=list)
    edges: list[LocationEdge] = Field(default_factory=list)
    lore_nodes: list[LoreNode] = Field(default_factory=list)

    @field_validator("lore_nodes")
    @classmethod
    def _validate_world_lore(cls, v: list[LoreNode]) -> list[LoreNode]:
        return _enforce_world_level_lore_nodes(v)


class WorldUpdatePayload(BaseModel):
    """Payload for updating a world (in-place if unused, or silently forked if used by a campaign)."""

    name: str
    global_rules: WorldGlobalRules
    locations: list[LocationNode] = Field(default_factory=list)
    edges: list[LocationEdge] = Field(default_factory=list)
    lore_nodes: list[LoreNode] = Field(default_factory=list)

    @field_validator("lore_nodes")
    @classmethod
    def _validate_world_lore(cls, v: list[LoreNode]) -> list[LoreNode]:
        return _enforce_world_level_lore_nodes(v)


class CampaignLocationLoreUpdatePayload(BaseModel):
    """Atomic Copy-on-Write location lore replacement payload during an active campaign."""

    lore_nodes: list[LocationLoreNodeDraft] = Field(default_factory=list)
