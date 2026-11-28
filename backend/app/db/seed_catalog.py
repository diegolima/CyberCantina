"""Central registry and version-check helpers for built-in showcase seeds."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.schemas.seed import SeedUpdateInfo

# Immutable public showcase media version (controls pub_v2_* filenames and /api/media/public/v2/... URLs).
SHOWCASE_MEDIA_VERSION = 2
# Backward-compatible alias preserved for existing media callers/tests.
SHOWCASE_SEED_VERSION = SHOWCASE_MEDIA_VERSION

# Independent per-asset content versions (incremented when world.json / character.json content upgrades).
SHOWCASE_WORLD_SEED_VERSION = 3
SHOWCASE_CHARACTER_SEED_VERSION = 3

SHOWCASE_WORLD_SEED_KEY = "showcase:the_green_lie"
# Preserved as stable internal provenance/media keys for existing DB rows and immutable public media URLs.
SHOWCASE_CHARACTER_SEED_KEY = "showcase:kira_vance"


@dataclass(frozen=True)
class SeedAssetSpec:
    """Version & changelog specification for a tracked built-in seed asset."""

    seed_key: str
    entity_type: Literal["world", "character"]
    display_name: str
    latest_version: int
    changelog: str


SEED_CATALOG: dict[str, SeedAssetSpec] = {
    SHOWCASE_WORLD_SEED_KEY: SeedAssetSpec(
        seed_key=SHOWCASE_WORLD_SEED_KEY,
        entity_type="world",
        display_name="The Green Lie",
        latest_version=SHOWCASE_WORLD_SEED_VERSION,
        changelog=(
            "v3: Upgraded spatial topology (37 locations, 88 edges, 11 vertical arcology "
            "transitions with obstacle metadata, 3 cross-container anchors, 2 tracked "
            "location props, and Aegis Security Patrols threat lore)."
        ),
    ),
    SHOWCASE_CHARACTER_SEED_KEY: SeedAssetSpec(
        seed_key=SHOWCASE_CHARACTER_SEED_KEY,
        entity_type="character",
        display_name="Yulia Halim",
        latest_version=SHOWCASE_CHARACTER_SEED_VERSION,
        changelog=(
            "v3: Updated character sheet to Yulia Halim with refined profile, voice anchors, "
            "and Sovereign Cipher artifact linkage."
        ),
    ),
}


def get_seed_spec(
    seed_key: str | None,
    entity_type: Literal["world", "character"] | None = None,
) -> SeedAssetSpec | None:
    """Return the SeedAssetSpec for a seed_key (optionally matching entity_type), or None."""
    if not seed_key:
        return None
    spec = SEED_CATALOG.get(str(seed_key))
    if spec is None:
        return None
    if entity_type is not None and spec.entity_type != entity_type:
        return None
    return spec


def compute_seed_update_info(
    *,
    seed_key: str | None,
    entity_type: Literal["world", "character"],
    current_version: int | None,
    seed_modified: bool | int,
    dismissed_version: int | None,
    has_custom_media: bool,
    active_campaigns_count: int,
    linked_characters_count: int = 0,
) -> SeedUpdateInfo | None:
    """Compute library SeedUpdateInfo for a seeded asset row, or None if not in SEED_CATALOG."""
    spec = get_seed_spec(seed_key, entity_type=entity_type)
    if spec is None:
        return None
    cur = int(current_version or 0)
    update_available = cur < spec.latest_version
    dismissed = int(dismissed_version) if dismissed_version is not None else None
    is_dismissed = bool(
        update_available and dismissed is not None and dismissed >= spec.latest_version
    )
    return SeedUpdateInfo(
        seed_key=spec.seed_key,
        current_version=cur,
        latest_version=spec.latest_version,
        update_available=update_available,
        seed_modified=bool(seed_modified),
        dismissed_version=dismissed,
        is_dismissed=is_dismissed,
        changelog=spec.changelog,
        has_custom_media=bool(has_custom_media),
        active_campaigns_count=max(0, int(active_campaigns_count)),
        linked_characters_count=max(0, int(linked_characters_count)),
    )
