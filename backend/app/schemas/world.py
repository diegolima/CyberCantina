"""World settings, spatial topology graph, and lore schemas."""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Sequence
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.character import sanitize_character_markup
from app.schemas.unsupported import sanitize_unsupported_fields_dict

WALKING_METERS_PER_MINUTE: Final[int] = 70
MAX_EDGE_DISTANCE_METERS: Final[int] = 100_000_000
DEFAULT_INTERIOR_DISTANCE_METERS: Final[int] = 20
DEFAULT_EXTERIOR_DISTANCE_METERS: Final[int] = 100
DEFAULT_FALLBACK_DISTANCE_METERS: Final[int] = 50
MIN_EDGE_SPEED_MODIFIER: Final[float] = 0.05
MAX_EDGE_SPEED_MODIFIER: Final[float] = 100.0
DEFAULT_EDGE_SPEED_MODIFIER: Final[float] = 1.0
MAX_EDGE_OBSTACLES: Final[int] = 6
MAX_EDGE_OBSTACLE_LENGTH: Final[int] = 48
MAX_EDGE_TRAVEL_MODE_LENGTH: Final[int] = 40


def coerce_edge_distance_meters(
    value: Any,
    *,
    fallback: int = DEFAULT_FALLBACK_DISTANCE_METERS,
) -> int:
    """Coerce a raw distance value into a bounded positive integer meter count."""
    if value is None or isinstance(value, bool):
        return max(1, min(MAX_EDGE_DISTANCE_METERS, int(fallback)))
    try:
        if isinstance(value, str):
            raw = value.strip().lower()
            if not raw:
                return max(1, min(MAX_EDGE_DISTANCE_METERS, int(fallback)))
            if raw.endswith("km"):
                parsed = float(raw[:-2].strip()) * 1000.0
            elif raw.endswith("k"):
                parsed = float(raw[:-1].strip()) * 1000.0
            elif raw.endswith("m"):
                parsed = float(raw[:-1].strip())
            else:
                parsed = float(raw)
        else:
            parsed = float(value)
    except (TypeError, ValueError):
        return max(1, min(MAX_EDGE_DISTANCE_METERS, int(fallback)))
    if not (parsed == parsed) or parsed == float("inf") or parsed == float("-inf"):
        return max(1, min(MAX_EDGE_DISTANCE_METERS, int(fallback)))
    return max(1, min(MAX_EDGE_DISTANCE_METERS, int(round(parsed))))


def resolve_legacy_edge_distance_meters(
    data: Any,
    *,
    fallback: int = DEFAULT_FALLBACK_DISTANCE_METERS,
) -> Any:
    """Normalize dict payloads carrying `distance_meters` or legacy `travel_minutes`."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    raw_dist = out.get("distance_meters")
    if raw_dist is not None and not (isinstance(raw_dist, str) and not raw_dist.strip()):
        out["distance_meters"] = coerce_edge_distance_meters(raw_dist, fallback=fallback)
        out.pop("travel_minutes", None)
        return out
    if "travel_minutes" in out and out.get("travel_minutes") is not None:
        raw_min = out.pop("travel_minutes")
        try:
            minutes = float(raw_min)
            if not (minutes == minutes) or minutes == float("inf") or minutes == float("-inf"):
                meters = fallback
            else:
                meters = max(1, int(round(minutes * WALKING_METERS_PER_MINUTE)))
        except (TypeError, ValueError):
            meters = fallback
        out["distance_meters"] = max(1, min(MAX_EDGE_DISTANCE_METERS, meters))
        return out
    out.pop("travel_minutes", None)
    if "distance_meters" in out:
        out["distance_meters"] = max(1, min(MAX_EDGE_DISTANCE_METERS, int(fallback)))
    return out


def extract_edge_distance_meters(
    edge: dict[str, Any],
    *,
    fallback: int = DEFAULT_FALLBACK_DISTANCE_METERS,
) -> int:
    """Resolve `distance_meters` from a dict, converting legacy `travel_minutes` (* 70) once."""
    normalized = resolve_legacy_edge_distance_meters(edge, fallback=fallback)
    return coerce_edge_distance_meters(
        normalized.get("distance_meters"), fallback=fallback
    )


def normalize_edge_speed_modifier(
    raw: Any,
    *,
    fallback: float = DEFAULT_EDGE_SPEED_MODIFIER,
) -> float:
    """Clamp a link speed multiplier into `[0.05, 100.0]`, falling back to `1.0`."""
    safe_fallback = max(
        MIN_EDGE_SPEED_MODIFIER, min(MAX_EDGE_SPEED_MODIFIER, float(fallback))
    )
    if raw is None or isinstance(raw, bool):
        return round(safe_fallback, 4)
    try:
        parsed = float(raw)
    except (TypeError, ValueError):
        return round(safe_fallback, 4)
    if (
        not (parsed == parsed)
        or parsed == float("inf")
        or parsed == float("-inf")
        or parsed <= 0.0
    ):
        return round(safe_fallback, 4)
    return round(
        max(MIN_EDGE_SPEED_MODIFIER, min(MAX_EDGE_SPEED_MODIFIER, parsed)), 4
    )


def normalize_edge_travel_mode(raw: Any) -> str | None:
    """Sanitize an optional link travel mode label (max 40 chars, None if blank)."""
    if raw is None or isinstance(raw, bool):
        return None
    cleaned = sanitize_character_markup(
        str(raw), preserve_italics=False, single_line=True
    )[:MAX_EDGE_TRAVEL_MODE_LENGTH].strip()
    return cleaned or None


def normalize_edge_obstacles(raw: Any) -> list[str]:
    """Sanitize, deduplicate case-insensitively, and cap link obstacle chips (max 6)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        items: Sequence[Any] = [part for part in raw.split(",")]
    elif isinstance(raw, (list, tuple, set)):
        items = list(raw)
    else:
        return []

    cleaned: list[str] = []
    seen_lower: set[str] = set()
    for item in items:
        if item is None or isinstance(item, bool):
            continue
        chip = sanitize_character_markup(
            str(item), preserve_italics=False, single_line=True
        )[:MAX_EDGE_OBSTACLE_LENGTH].strip()
        if not chip:
            continue
        low = chip.casefold()
        if low in seen_lower:
            continue
        seen_lower.add(low)
        cleaned.append(chip)
        if len(cleaned) >= MAX_EDGE_OBSTACLES:
            break
    return cleaned


def resolve_legacy_edge_flags(data: Any) -> Any:
    """Normalize first-class link properties and map legacy `is_locked_or_hidden` -> `is_blocked`."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    if "speed_modifier" in out:
        out["speed_modifier"] = normalize_edge_speed_modifier(out.get("speed_modifier"))
    if "travel_mode" in out:
        out["travel_mode"] = normalize_edge_travel_mode(out.get("travel_mode"))
    if "obstacles" in out:
        out["obstacles"] = normalize_edge_obstacles(out.get("obstacles"))
    elif "obstacles_json" in out:
        raw_obs_json = out.get("obstacles_json")
        if isinstance(raw_obs_json, str):
            try:
                parsed_obs = json.loads(raw_obs_json or "[]")
            except Exception:
                parsed_obs = []
        else:
            parsed_obs = raw_obs_json
        out["obstacles"] = normalize_edge_obstacles(parsed_obs)

    has_legacy = "is_locked_or_hidden" in out
    legacy_val = out.pop("is_locked_or_hidden", None)
    if has_legacy and "is_blocked" not in out and "is_secret" not in out:
        out["is_blocked"] = bool(legacy_val)
        out["is_secret"] = False

    if out.get("is_blocked") is None:
        out["is_blocked"] = False
    else:
        out["is_blocked"] = bool(out["is_blocked"])
    if out.get("is_secret") is None:
        out["is_secret"] = False
    else:
        out["is_secret"] = bool(out["is_secret"])
    return out


def extract_edge_link_fields(
    edge: dict[str, Any],
) -> tuple[float, str | None, list[str], bool, bool]:
    """Extract normalized `(speed_modifier, travel_mode, obstacles, is_blocked, is_secret)` from raw dicts."""
    normalized = resolve_legacy_edge_flags(edge)
    return (
        normalize_edge_speed_modifier(normalized.get("speed_modifier")),
        normalize_edge_travel_mode(normalized.get("travel_mode")),
        normalize_edge_obstacles(normalized.get("obstacles")),
        bool(normalized.get("is_blocked", False)),
        bool(normalized.get("is_secret", False)),
    )


def canonical_edge_pair_key(from_location_id: str, to_location_id: str) -> tuple[str, str]:
    """Return canonical unordered endpoint pair `(min_id, max_id)` for bidirectional link matching."""
    return (
        (from_location_id, to_location_id)
        if from_location_id <= to_location_id
        else (to_location_id, from_location_id)
    )


def resolve_revealed_edge_pairs(
    edges: Iterable["LocationEdge"],
    revealed_edge_ids: Iterable[str],
) -> set[tuple[str, str]]:
    """Derive canonical endpoint pairs for any edge whose ID is in `revealed_edge_ids`."""
    id_set = {str(eid) for eid in revealed_edge_ids if eid}
    if not id_set:
        return set()
    return {
        canonical_edge_pair_key(edge.from_location_id, edge.to_location_id)
        for edge in edges
        if edge.id in id_set
    }


def is_edge_revealed(
    edge_id: str,
    from_location_id: str,
    to_location_id: str,
    revealed_ids: set[str],
    revealed_pairs: set[tuple[str, str]],
) -> bool:
    """Return True when an edge is revealed directly by ID or symmetrically by endpoint pair."""
    return (
        edge_id in revealed_ids
        or canonical_edge_pair_key(from_location_id, to_location_id) in revealed_pairs
    )


def derive_travel_minutes(
    distance_meters: int,
    speed_modifier: float = DEFAULT_EDGE_SPEED_MODIFIER,
) -> int:
    """Derive rounded integer travel minutes from meters and speed_modifier (min 1)."""
    safe_meters = max(1, int(distance_meters))
    safe_mod = normalize_edge_speed_modifier(speed_modifier)
    return max(1, int(safe_meters / (WALKING_METERS_PER_MINUTE * safe_mod) + 0.5))


def derive_walking_minutes(distance_meters: int) -> int:
    """Derive rounded integer walking minutes from meters at 70 m/min (min 1)."""
    return derive_travel_minutes(distance_meters, DEFAULT_EDGE_SPEED_MODIFIER)


def format_distance_meters(distance_meters: int) -> str:
    """Format meters compactly (`350m`, `1.4km`, `2km`, `125km`)."""
    safe_meters = max(1, int(distance_meters))
    if safe_meters < 1000:
        return f"{safe_meters}m"
    if safe_meters < 100_000:
        km = round(safe_meters / 1000.0, 1)
        if km.is_integer():
            return f"{int(km)}km"
        return f"{km:.1f}km"
    return f"{int(round(safe_meters / 1000.0))}km"


def format_travel_duration(
    distance_meters: int,
    speed_modifier: float = DEFAULT_EDGE_SPEED_MODIFIER,
) -> str:
    """Format speed-adjusted travel duration (`< 1 min`, `~5 min`, `~1h 15min`)."""
    safe_meters = max(1, int(distance_meters))
    safe_mod = normalize_edge_speed_modifier(speed_modifier)
    if (safe_meters / (WALKING_METERS_PER_MINUTE * safe_mod)) < 0.5:
        return "< 1 min"
    mins = derive_travel_minutes(safe_meters, safe_mod)
    if mins < 60:
        return f"~{mins} min"
    hours, rem = divmod(mins, 60)
    if rem == 0:
        return f"~{hours}h"
    return f"~{hours}h {rem}min"


def format_walking_duration(distance_meters: int) -> str:
    """Format canonical walking duration (`< 1 min`, `~5 min`, `~1h 15min`)."""
    return format_travel_duration(distance_meters, DEFAULT_EDGE_SPEED_MODIFIER)


def format_exit_travel_phrase(
    distance_meters: int,
    speed_modifier: float = DEFAULT_EDGE_SPEED_MODIFIER,
    travel_mode: str | None = None,
) -> str:
    """Format mode-aware travel phrase for prompts and UI (`~5 min walk`, `~2 min via Rail`, `~18 min travel`)."""
    safe_mod = normalize_edge_speed_modifier(speed_modifier)
    dur = format_travel_duration(distance_meters, safe_mod)
    mode = normalize_edge_travel_mode(travel_mode)
    if mode:
        return f"{dur} via {mode}"
    if abs(safe_mod - DEFAULT_EDGE_SPEED_MODIFIER) < 0.01:
        return f"{dur} walk"
    return f"{dur} travel"

CompassDirection = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
SharedLoreCategory = Literal["history", "culture", "faction", "rumor"]
WorldLoreCategory = Literal[
    "history", "culture", "faction", "figure", "rumor", "threat", "artifact"
]
LocationLoreCategory = Literal["history", "culture", "faction", "rumor", "secret"]
AnyLoreCategory = Literal[
    "history", "culture", "faction", "figure", "rumor", "threat", "artifact", "secret"
]

WORLD_LORE_CATEGORIES: tuple[WorldLoreCategory, ...] = (
    "history",
    "culture",
    "faction",
    "figure",
    "rumor",
    "threat",
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
        allowed.update({"artifact", "figure", "threat"})

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
            "figure": "figure" if allow_artifact else "culture",
            "figures": "figure" if allow_artifact else "culture",
            "person": "figure" if allow_artifact else "culture",
            "people": "figure" if allow_artifact else "culture",
            "npc": "figure" if allow_artifact else "culture",
            "npcs": "figure" if allow_artifact else "culture",
            "notable": "figure" if allow_artifact else "culture",
            "rumors": "rumor",
            "rumours": "rumor",
            "threat": "threat" if allow_artifact else "rumor",
            "threats": "threat" if allow_artifact else "rumor",
            "enemy": "threat" if allow_artifact else "rumor",
            "enemies": "threat" if allow_artifact else "rumor",
            "monster": "threat" if allow_artifact else "rumor",
            "monsters": "threat" if allow_artifact else "rumor",
            "hazard": "threat" if allow_artifact else "rumor",
            "hazards": "threat" if allow_artifact else "rumor",
            "danger": "threat" if allow_artifact else "rumor",
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
    describe_on_first_visit: bool = Field(
        default=True,
        description="Default campaign setting: display cosmetic atmospheric description cards on first entry to unvisited locations/containers.",
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
    """Strict world-level macro lore entry (history, culture, faction, figure, rumor, threat, artifact)."""

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
        description="One of: history, culture, faction, figure, rumor, threat, artifact.",
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

    model_config = ConfigDict(
        json_schema_extra=lambda schema: schema.update(
            required=list(schema.get("properties", {}).keys())
        )
    )

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
    distance_meters: int = Field(
        default=DEFAULT_FALLBACK_DISTANCE_METERS,
        ge=1,
        le=MAX_EDGE_DISTANCE_METERS,
        description="Physical separation in meters along this path (10-60 indoor rooms, 80-500 streets/courtyards, 500-5000+ overland).",
    )
    speed_modifier: float = Field(
        default=DEFAULT_EDGE_SPEED_MODIFIER,
        ge=MIN_EDGE_SPEED_MODIFIER,
        le=MAX_EDGE_SPEED_MODIFIER,
        description="Traversal speed multiplier relative to 70 m/min walking (0.05-100.0, e.g. 0.3 swamp, 1.0 walk, 10 vehicle, 25 rail).",
    )
    travel_mode: str | None = Field(
        default=None,
        max_length=MAX_EDGE_TRAVEL_MODE_LENGTH,
        description="Optional short mode label when speed_modifier differs from normal walking (e.g. 'Mag-Lev Rail', 'Flooded Tunnel').",
    )
    obstacles: list[str] = Field(
        default_factory=list,
        description="Up to 6 concise hazard or obstacle keywords along this link (e.g. ['laser grid', 'customs checkpoint']).",
    )
    is_blocked: bool = Field(
        default=False,
        description="Whether this link is currently barred, sealed, or checkpoint-blocked.",
    )
    is_secret: bool = Field(
        default=False,
        description="Whether this link is hidden from players until discovered via search/roll or GM reveal.",
    )
    bidirectional: bool = Field(default=True)

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_edge_inputs(cls, data: Any) -> Any:
        normalized = resolve_legacy_edge_distance_meters(
            data, fallback=DEFAULT_FALLBACK_DISTANCE_METERS
        )
        return resolve_legacy_edge_flags(normalized)


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
    lore_nodes: list[WorldLoreNodeDraft]


class GhostCoord(BaseModel):
    """Saved canvas coordinates for an external ghost destination inside a container view."""

    x: float
    y: float

    @model_validator(mode="after")
    def _validate_finite(self) -> "GhostCoord":
        if not (math.isfinite(self.x) and math.isfinite(self.y)):
            raise ValueError("Ghost coordinates must be finite numbers.")
        return self


def coerce_ghost_coords_map(raw: Any) -> dict[str, dict[str, float]]:
    """Normalize a raw ghost_coords mapping, keeping only valid finite {x, y} entries."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, float]] = {}
    for k, v in raw.items():
        if not isinstance(k, str):
            continue
        loc_id = k.strip()
        if not loc_id:
            continue
        if isinstance(v, GhostCoord):
            rx, ry = v.x, v.y
        elif isinstance(v, dict):
            rx, ry = v.get("x"), v.get("y")
        else:
            continue
        if isinstance(rx, bool) or isinstance(ry, bool):
            continue
        try:
            fx = float(rx)
            fy = float(ry)
        except (TypeError, ValueError):
            continue
        if math.isfinite(fx) and math.isfinite(fy):
            out[loc_id] = {"x": fx, "y": fy}
    return out


def parse_ghost_coords_json(raw: Any) -> dict[str, GhostCoord]:
    """Parse a JSON string or dict into validated GhostCoord entries."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "{}")
        except Exception:
            return {}
    normalized = coerce_ghost_coords_map(raw)
    return {k: GhostCoord(x=v["x"], y=v["y"]) for k, v in normalized.items()}


def remap_ghost_coords_dict(
    raw: Any,
    id_remap: dict[str, str],
    valid_ids: set[str] | None = None,
) -> dict[str, dict[str, float]]:
    """Remap ghost coordinate location ID keys using `id_remap`, optionally pruning deleted IDs."""
    normalized = coerce_ghost_coords_map(
        json.loads(raw or "{}") if isinstance(raw, str) else raw
    )
    out: dict[str, dict[str, float]] = {}
    for old_id, pt in normalized.items():
        mapped = id_remap.get(old_id, old_id)
        if valid_ids is not None and mapped not in valid_ids:
            continue
        out[mapped] = pt
    return out


class LocationContainerDraft(BaseModel):
    """User-authored spatial container draft preserved across World Wizard review -> commit."""

    id: str = Field(..., min_length=1)
    parent_container_id: str | None = None
    depth: int = Field(..., ge=1, le=4)
    name: str = Field(..., min_length=1, max_length=160)
    description: str = ""
    environmental_tags: list[str] = Field(default_factory=list)
    ui_x: float | None = None
    ui_y: float | None = None
    ghost_coords: dict[str, GhostCoord] = Field(default_factory=dict)
    icon: str | None = None
    lore_nodes: list[LocationLoreNodeDraft] = Field(default_factory=list)

    @field_validator("ghost_coords", mode="before")
    @classmethod
    def _validate_ghost_coords(cls, v: Any) -> dict[str, dict[str, float]]:
        return coerce_ghost_coords_map(v)

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Container name cannot be empty.")
        return v.strip()

    @model_validator(mode="after")
    def validate_lore_depth(self) -> "LocationContainerDraft":
        if self.depth > 1 and self.lore_nodes:
            raise ValueError(
                f"Lore nodes are strictly forbidden on macro containers (depth={self.depth}). Lore is only allowed on Level 1 containers."
            )
        return self


class LocationNodeCommitDraft(LocationNodeDraft):
    """Draft location node extended with optional user-authored container, portal, and layout metadata on commit."""

    container_id: str | None = None
    is_entry_exit: bool = False
    ui_x: float | None = None
    ui_y: float | None = None
    icon: str | None = None

    @model_validator(mode="after")
    def _normalize_root_portal(self) -> "LocationNodeCommitDraft":
        if not self.container_id:
            self.is_entry_exit = False
        return self


class WorldWizardCommitPayload(WorldWizardDraft):
    """Strict World Wizard commit payload supporting user-authored containers, portals, and layout."""

    locations: list[LocationNodeCommitDraft]  # type: ignore[assignment]
    containers: list[LocationContainerDraft] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_containers(self) -> "WorldWizardCommitPayload":
        validate_container_hierarchy_integrity(
            world_id=None,
            containers=self.containers,
            locations=self.locations,
        )
        return self


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
    """Persisted lore node (world-scoped when both location_id and container_id are None)."""

    id: str
    world_id: str
    location_id: str | None = None
    container_id: str | None = None
    campaign_id: str | None = None
    created_at_turn_id: str | None = None
    origin_lore_id: str | None = None
    is_major_event: bool = False
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
        if self.location_id is None and self.container_id is None and self.category == "secret":
            raise ValueError(
                "Category 'secret' is only allowed on location or container lore entries, not world lore."
            )
        if (self.location_id is not None or self.container_id is not None) and self.category in (
            "artifact",
            "figure",
            "threat",
        ):
            raise ValueError(
                f"Category '{self.category}' is only allowed on world lore entries, not location or container lore."
            )
        if self.location_id is not None and self.container_id is not None:
            raise ValueError("Lore entry cannot be scoped to both a location and a container.")
        return self


class WorldMediaItem(BaseModel):
    """Deduplicated media asset attached to a world (images with optional 1:1 linked videos)."""

    id: str
    media_type: Literal["image", "video", "audio"] = "image"
    url: str
    label: str = ""
    mime_type: str = "image/webp"
    byte_size: int = 0
    sort_order: int = 0
    is_public: bool = False
    created_at: str = ""
    video_asset_id: str | None = None
    video_url: str | None = None
    video_mime_type: str | None = None
    video_byte_size: int | None = None


class LocationContainer(BaseModel):
    """Hierarchical spatial container node (Level 1=Building/Dungeon w/ Lore; Levels 2-4=Macro Org)."""

    id: str
    world_id: str = ""
    created_at_turn_id: str | None = None
    parent_container_id: str | None = None
    depth: int = Field(
        ...,
        ge=1,
        le=4,
        description="1=Building/Complex (supports lore), 2=District, 3=City/Region, 4=Planet/Realm",
    )
    name: str = Field(..., min_length=1, max_length=160)
    description: str = ""
    environmental_tags: list[str] = Field(default_factory=list)
    ui_x: float | None = None
    ui_y: float | None = None
    ghost_coords: dict[str, GhostCoord] = Field(default_factory=dict)
    icon: str | None = None
    image_media_id: str | None = None
    image_url: str | None = None
    image_label: str | None = None
    video_url: str | None = None
    video_mime_type: str | None = None
    lore_nodes: list[LoreNode] = Field(
        default_factory=list,
        description="Scoped lore entries (strictly allowed only on depth=1 containers).",
    )

    @field_validator("ghost_coords", mode="before")
    @classmethod
    def _validate_ghost_coords(cls, v: Any) -> dict[str, dict[str, float]]:
        return coerce_ghost_coords_map(v)

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip():
            raise ValueError("Container name cannot be empty.")
        return v.strip()

    @model_validator(mode="before")
    @classmethod
    def _bind_nested_container_lore(cls, data: Any) -> Any:
        """Bind container_id and world_id to raw nested lore dicts before field validation runs."""
        if isinstance(data, dict) and isinstance(data.get("lore_nodes"), list):
            cont_id = data.get("id")
            w_id = data.get("world_id") or ""
            if cont_id:
                bound: list[Any] = []
                for idx, entry in enumerate(data["lore_nodes"]):
                    if isinstance(entry, dict):
                        patched = dict(entry)
                        patched["container_id"] = patched.get("container_id") or cont_id
                        patched["world_id"] = patched.get("world_id") or w_id
                        patched["location_id"] = None
                        patched["id"] = patched.get("id") or f"new_cont_lore_{idx}"
                        bound.append(patched)
                    elif isinstance(entry, LoreNode):
                        bound.append(
                            entry.model_copy(update={"container_id": cont_id, "location_id": None})
                        )
                    else:
                        bound.append(entry)
                data = {**data, "lore_nodes": bound}
        return data

    @model_validator(mode="after")
    def validate_lore_depth(self) -> "LocationContainer":
        if self.depth > 1 and self.lore_nodes:
            raise ValueError(
                f"Lore nodes are strictly forbidden on macro containers (depth={self.depth}). Lore is only allowed on Level 1 containers."
            )
        return self


class LocationNode(BaseModel):
    """Persisted spatial graph node."""

    id: str
    world_id: str = ""
    created_at_turn_id: str | None = None
    superseded_at_turn_id: str | None = None
    container_id: str | None = None
    is_entry_exit: bool = False
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
    ui_x: float | None = None
    ui_y: float | None = None
    icon: str | None = None
    image_media_id: str | None = None
    image_url: str | None = None
    image_label: str | None = None
    video_url: str | None = None
    video_mime_type: str | None = None
    is_visited: bool = False
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
                        patched["container_id"] = None
                        patched["world_id"] = patched.get("world_id") or w_id
                        patched["id"] = patched.get("id") or f"new_loc_lore_{idx}"
                        bound.append(patched)
                    elif isinstance(entry, LoreNode):
                        bound.append(
                            entry.model_copy(update={"location_id": loc_id, "container_id": None})
                        )
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
    distance_meters: int = Field(
        default=DEFAULT_FALLBACK_DISTANCE_METERS,
        ge=1,
        le=MAX_EDGE_DISTANCE_METERS,
    )
    speed_modifier: float = Field(
        default=DEFAULT_EDGE_SPEED_MODIFIER,
        ge=MIN_EDGE_SPEED_MODIFIER,
        le=MAX_EDGE_SPEED_MODIFIER,
    )
    travel_mode: str | None = Field(
        default=None,
        max_length=MAX_EDGE_TRAVEL_MODE_LENGTH,
    )
    obstacles: list[str] = Field(default_factory=list)
    is_blocked: bool = False
    is_secret: bool = False
    created_at_turn_id: str | None = None
    superseded_at_turn_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_edge_inputs(cls, data: Any) -> Any:
        normalized = resolve_legacy_edge_distance_meters(
            data, fallback=DEFAULT_FALLBACK_DISTANCE_METERS
        )
        return resolve_legacy_edge_flags(normalized)


class NeighborLocationView(BaseModel):
    """1-hop spatial neighbor resolved for the active location."""

    edge_id: str
    direction_label: str
    compass_direction: CompassDirection | None = None
    distance_meters: int = Field(ge=1, le=MAX_EDGE_DISTANCE_METERS)
    speed_modifier: float = Field(
        default=DEFAULT_EDGE_SPEED_MODIFIER,
        ge=MIN_EDGE_SPEED_MODIFIER,
        le=MAX_EDGE_SPEED_MODIFIER,
    )
    travel_mode: str | None = Field(
        default=None,
        max_length=MAX_EDGE_TRAVEL_MODE_LENGTH,
    )
    obstacles: list[str] = Field(default_factory=list)
    is_blocked: bool = False
    is_secret: bool = False
    destination: LocationNode

    @model_validator(mode="before")
    @classmethod
    def _coerce_legacy_edge_inputs(cls, data: Any) -> Any:
        normalized = resolve_legacy_edge_distance_meters(
            data, fallback=DEFAULT_FALLBACK_DISTANCE_METERS
        )
        return resolve_legacy_edge_flags(normalized)


def _enforce_world_level_lore_nodes(nodes: list[LoreNode]) -> list[LoreNode]:
    for node in nodes:
        if node.location_id is not None or node.container_id is not None:
            raise ValueError(
                "World-level lore_nodes must not set location_id or container_id; attach scoped lore to LocationNode or LocationContainer."
            )
        if node.category == "secret":
            raise ValueError("Category 'secret' is not allowed on world-level lore entries.")
    return nodes


def validate_container_hierarchy_integrity(
    *,
    world_id: str | None,
    containers: Sequence[LocationContainer | LocationContainerDraft],
    locations: Sequence[LocationNode | LocationNodeCommitDraft],
) -> None:
    """Validate container ID uniqueness, world scoping, dangling references, depth monotonicity, and absence of cycles."""
    c_by_id: dict[str, LocationContainer | LocationContainerDraft] = {}
    for c in containers:
        if c.id in c_by_id:
            raise ValueError(f"Duplicate container ID '{c.id}'.")
        c_world_id = getattr(c, "world_id", "")
        if world_id and c_world_id and c_world_id != world_id:
            raise ValueError(
                f"Container '{c.name}' world_id '{c_world_id}' does not match world '{world_id}'."
            )
        c_by_id[c.id] = c

    for loc in locations:
        if loc.container_id and loc.container_id not in c_by_id:
            raise ValueError(
                f"Location '{loc.name}' references non-existent container '{loc.container_id}'."
            )

    for c in containers:
        if c.parent_container_id:
            if c.parent_container_id not in c_by_id:
                raise ValueError(
                    f"Container '{c.name}' references non-existent parent '{c.parent_container_id}'."
                )
            parent = c_by_id[c.parent_container_id]
            if parent.depth <= c.depth:
                raise ValueError(
                    f"Container '{c.name}' (depth {c.depth}) parent '{parent.name}' must have strictly higher depth (found {parent.depth})."
                )

    for c in containers:
        curr = c
        visited: set[str] = set()
        while curr.parent_container_id:
            if curr.id in visited:
                raise ValueError(f"Cycle detected in container hierarchy involving '{curr.name}'.")
            visited.add(curr.id)
            curr = c_by_id[curr.parent_container_id]


def validate_world_reachability(
    locations: list[LocationNode],
    edges: list[LocationEdge],
) -> None:
    """Validate bidirectional reachability from the Starting Hub to every location in the graph."""
    if not locations:
        return
    loc_by_id = {loc.id: loc for loc in locations}
    starters = [loc.id for loc in locations if loc.is_starting_location]
    if len(starters) != 1:
        raise ValueError(
            f"World must have exactly one Starting Location (found {len(starters)})."
        )
    start_id = starters[0]

    fwd_adj: dict[str, list[str]] = {loc_id: [] for loc_id in loc_by_id}
    rev_adj: dict[str, list[str]] = {loc_id: [] for loc_id in loc_by_id}
    for edge in edges:
        if edge.from_location_id in loc_by_id and edge.to_location_id in loc_by_id:
            fwd_adj[edge.from_location_id].append(edge.to_location_id)
            rev_adj[edge.to_location_id].append(edge.from_location_id)

    def _bfs(adj: dict[str, list[str]]) -> set[str]:
        visited: set[str] = {start_id}
        queue = [start_id]
        idx = 0
        while idx < len(queue):
            curr = queue[idx]
            idx += 1
            for nxt in adj.get(curr, ()):
                if nxt not in visited:
                    visited.add(nxt)
                    queue.append(nxt)
        return visited

    fwd_reachable = _bfs(fwd_adj)
    rev_reachable = _bfs(rev_adj)
    unreachable = [
        loc.name or loc.id
        for loc in locations
        if loc.id not in fwd_reachable or loc.id not in rev_reachable
    ]
    if unreachable:
        preview = ", ".join(unreachable[:5])
        suffix = f" (+{len(unreachable) - 5} more)" if len(unreachable) > 5 else ""
        raise ValueError(
            f"All locations must connect to and from Starting Hub '{loc_by_id[start_id].name}': unreachable {preview}{suffix}."
        )


class WorldRecord(BaseModel):
    """Complete persisted world with spatial topology and lore."""

    id: str
    name: str
    global_rules: WorldGlobalRules
    pending_deletion: bool = False
    created_at: str
    containers: list[LocationContainer] = Field(default_factory=list)
    locations: list[LocationNode] = Field(default_factory=list)
    edges: list[LocationEdge] = Field(default_factory=list)
    lore_nodes: list[LoreNode] = Field(default_factory=list)
    media: list[WorldMediaItem] = Field(default_factory=list)
    unsupported_fields: dict[str, Any] = Field(
        default_factory=dict,
        description="Read-only deprecated or unrecognized future .zcc attributes excluded from LLM prompts.",
    )

    @field_validator("lore_nodes")
    @classmethod
    def _validate_world_lore(cls, v: list[LoreNode]) -> list[LoreNode]:
        return _enforce_world_level_lore_nodes(v)

    @model_validator(mode="after")
    def _validate_containers(self) -> "WorldRecord":
        validate_container_hierarchy_integrity(
            world_id=self.id,
            containers=self.containers,
            locations=self.locations,
        )
        return self


CANONICAL_WORLD_GLOBAL_RULE_KEYS: frozenset[str] = frozenset(
    {
        "genre",
        "tone",
        "setting_overview",
        "tech_or_magic_rules",
        "starting_timestamp",
        "describe_on_first_visit",
    }
)
LEGACY_DEPRECATED_WORLD_GLOBAL_RULE_KEYS: frozenset[str] = frozenset(
    {"narrative_style", "sensory_profile", "taboos_and_limits"}
)
WORLD_GLOBAL_RULE_GENRE_ALIASES: tuple[str, ...] = (
    "genre_and_tone",
    "genre_tone",
    "genre_setting",
)
WORLD_GLOBAL_RULE_TONE_ALIASES: tuple[str, ...] = (
    "mood",
    "atmosphere",
    "narrative_tone",
)
CANONICAL_WORLD_RECORD_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "name",
        "global_rules",
        "pending_deletion",
        "created_at",
        "containers",
        "locations",
        "edges",
        "lore_nodes",
        "media",
        "unsupported_fields",
    }
)
CANONICAL_CONTAINER_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "world_id",
        "created_at_turn_id",
        "parent_container_id",
        "depth",
        "name",
        "description",
        "environmental_tags",
        "ui_x",
        "ui_y",
        "icon",
        "image_media_id",
        "image_url",
        "image_label",
        "video_url",
        "video_mime_type",
        "lore_nodes",
        "created_at",
    }
)
CANONICAL_LOCATION_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "world_id",
        "created_at_turn_id",
        "superseded_at_turn_id",
        "container_id",
        "is_entry_exit",
        "name",
        "summary",
        "description",
        "environmental_tags",
        "is_starting_location",
        "is_hub",
        "starting_message",
        "ui_x",
        "ui_y",
        "icon",
        "image_media_id",
        "image_url",
        "image_label",
        "video_url",
        "video_mime_type",
        "is_visited",
        "lore_nodes",
    }
)
CANONICAL_EDGE_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "world_id",
        "from_location_id",
        "to_location_id",
        "direction_label",
        "compass_direction",
        "distance_meters",
        "travel_minutes",  # Legacy v0.35.x key auto-converted (* 70) on import without spurious warnings
        "speed_modifier",
        "travel_mode",
        "obstacles",
        "is_blocked",
        "is_secret",
        "is_locked_or_hidden",  # Legacy v0.36.x key auto-converted to is_blocked without spurious warnings
        "created_at_turn_id",
        "superseded_at_turn_id",
    }
)
CANONICAL_LORE_KEYS: frozenset[str] = frozenset(
    {
        "id",
        "world_id",
        "location_id",
        "container_id",
        "campaign_id",
        "title",
        "category",
        "content",
        "entity_tags",
    }
)


def sanitize_world_unsupported_fields(
    raw: Any,
    *,
    strict: bool = False,
) -> dict[str, Any]:
    """Validate and bound arbitrary extension/legacy keys in world unsupported_fields."""
    return sanitize_unsupported_fields_dict(
        raw,
        blocked_keys=CANONICAL_WORLD_RECORD_KEYS,
        strict=strict,
    )


def extract_world_unsupported_fields(
    raw_world_dict: dict[str, Any],
    *,
    strict: bool = False,
) -> dict[str, Any]:
    """Extract top-level unknown world keys and legacy/unknown global_rules keys into unsupported_fields."""
    raw_unsupported: dict[str, Any] = {}
    nested_ext = raw_world_dict.get("unsupported_fields")
    if isinstance(nested_ext, dict):
        for k, v in nested_ext.items():
            if isinstance(k, str) and k not in CANONICAL_WORLD_RECORD_KEYS:
                raw_unsupported[k] = v

    for k, v in raw_world_dict.items():
        if not isinstance(k, str) or k in CANONICAL_WORLD_RECORD_KEYS:
            continue
        raw_unsupported[k] = v

    raw_rules = raw_world_dict.get("global_rules")
    if isinstance(raw_rules, dict):
        raw_genre = str(raw_rules.get("genre") or "").strip()
        raw_tone = str(raw_rules.get("tone") or "").strip()

        consumed_aliases: set[str] = set()
        effective_genre = raw_genre
        if not effective_genre:
            for alias in WORLD_GLOBAL_RULE_GENRE_ALIASES:
                val = raw_rules.get(alias)
                if isinstance(val, str) and val.strip():
                    effective_genre = val.strip()
                    consumed_aliases.add(alias)
                    break

        effective_tone = raw_tone
        if not effective_tone:
            for alias in WORLD_GLOBAL_RULE_TONE_ALIASES:
                val = raw_rules.get(alias)
                if isinstance(val, str) and val.strip():
                    effective_tone = val.strip()
                    consumed_aliases.add(alias)
                    break

        for rk, rv in raw_rules.items():
            if not isinstance(rk, str) or rk in CANONICAL_WORLD_GLOBAL_RULE_KEYS:
                continue
            if rk in consumed_aliases:
                continue
            if rk in WORLD_GLOBAL_RULE_GENRE_ALIASES and isinstance(rv, str) and rv.strip() == effective_genre:
                continue
            if rk in WORLD_GLOBAL_RULE_TONE_ALIASES and isinstance(rv, str) and rv.strip() == effective_tone:
                continue
            raw_unsupported[f"global_rules.{rk}"] = rv

    return sanitize_world_unsupported_fields(raw_unsupported, strict=strict)


def find_nested_world_unsupported_keys(raw_world_dict: dict[str, Any]) -> list[str]:
    """Identify unrecognized keys on nested world sub-entities for non-blocking import warnings."""
    found: list[str] = []

    def _scan(items: Any, prefix: str, allowed: frozenset[str]) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            for k in item.keys():
                if isinstance(k, str) and k not in allowed:
                    label = f"{prefix}.{k}"
                    if label not in found:
                        found.append(label)

    _scan(raw_world_dict.get("containers"), "containers", CANONICAL_CONTAINER_KEYS)
    _scan(raw_world_dict.get("locations"), "locations", CANONICAL_LOCATION_KEYS)
    _scan(raw_world_dict.get("edges"), "edges", CANONICAL_EDGE_KEYS)
    _scan(raw_world_dict.get("lore_nodes"), "lore_nodes", CANONICAL_LORE_KEYS)

    for cont in raw_world_dict.get("containers") or []:
        if isinstance(cont, dict):
            _scan(cont.get("lore_nodes"), "containers.lore_nodes", CANONICAL_LORE_KEYS)
    for loc in raw_world_dict.get("locations") or []:
        if isinstance(loc, dict):
            _scan(loc.get("lore_nodes"), "locations.lore_nodes", CANONICAL_LORE_KEYS)
    return found


class WorldUpdatePayload(BaseModel):
    """Payload for updating a world (in-place if unused, or silently forked if used by a campaign)."""

    name: str
    global_rules: WorldGlobalRules
    containers: list[LocationContainer] = Field(default_factory=list)
    locations: list[LocationNode] = Field(default_factory=list)
    edges: list[LocationEdge] = Field(default_factory=list)
    lore_nodes: list[LoreNode] = Field(default_factory=list)
    unsupported_fields: dict[str, Any] | None = None

    @field_validator("lore_nodes")
    @classmethod
    def _validate_world_lore(cls, v: list[LoreNode]) -> list[LoreNode]:
        return _enforce_world_level_lore_nodes(v)

    @model_validator(mode="after")
    def _validate_containers(self) -> "WorldUpdatePayload":
        validate_container_hierarchy_integrity(
            world_id=None,
            containers=self.containers,
            locations=self.locations,
        )
        validate_world_reachability(
            locations=self.locations,
            edges=self.edges,
        )
        return self


class CampaignLocationLoreUpdatePayload(BaseModel):
    """Atomic Copy-on-Write location lore replacement payload during an active campaign."""

    lore_nodes: list[LocationLoreNodeDraft] = Field(default_factory=list)


class CampaignContainerLoreUpdatePayload(BaseModel):
    """Atomic Copy-on-Write Level 1 container lore replacement payload during an active campaign."""

    lore_nodes: list[LocationLoreNodeDraft] = Field(default_factory=list)
