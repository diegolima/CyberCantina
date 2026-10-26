"""World settings, spatial topology graph, and lore schemas."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

CompassDirection = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

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

    genre: str = Field(default="Cyberpunk Noir", description="Primary genre and subgenre.")
    tone: str = Field(
        default="Gritty, atmospheric, grounded consequences, sharp dialogue.",
        description="Narrative tone and stylistic atmosphere.",
    )
    setting_overview: str = Field(
        description="2-4 sentence macro overview of the world, power structures, and daily reality."
    )
    tech_or_magic_rules: str = Field(
        default="Cyberware requires immunosuppressive drugs; net-running is local-jacked.",
        description="Key constraints so the LLM maintains world consistency.",
    )
    starting_timestamp: str = Field(
        default="2094-11-14 23:15",
        description="Initial world clock timestamp (YYYY-MM-DD HH:MM).",
    )


class LocationNodeDraft(BaseModel):
    """Draft location node for the Spatial Engine and World Wizard."""

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


class LoreNodeDraft(BaseModel):
    """World lore entry (factions, history, items, local customs) indexed in Hybrid GraphRAG."""

    title: str
    category: Literal["faction", "history", "item", "culture", "rule", "rumor"] = "faction"
    content: str = Field(description="Concise 2-4 sentence lore entry.")
    entity_tags: list[str] = Field(
        default_factory=list,
        description="Keywords/names that link this lore node to mentions in dialogue.",
    )


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
    """AI-expanded world package produced by the World Wizard."""

    name: str
    global_rules: WorldGlobalRules
    locations: list[LocationNodeDraft]
    edges: list[LocationEdgeDraft]
    lore_nodes: list[LoreNodeDraft]


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


class LoreNode(BaseModel):
    """Persisted world lore node."""

    id: str
    world_id: str
    title: str
    category: str
    content: str
    entity_tags: list[str] = Field(default_factory=list)


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


class WorldUpdatePayload(BaseModel):
    """Payload for updating a world (in-place if unused, or silently forked if used by a campaign)."""

    name: str
    global_rules: WorldGlobalRules
    locations: list[LocationNode] = Field(default_factory=list)
    edges: list[LocationEdge] = Field(default_factory=list)
    lore_nodes: list[LoreNode] = Field(default_factory=list)
