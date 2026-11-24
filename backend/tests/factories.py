"""Composable, owner-scoped per-test fixture builders for backend tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from app.db.repository import CantinaRepository
from app.schemas.affective import (
    TemperamentArchetype,
    WorldviewProfile,
    temperament_config_for_archetype,
)
from app.schemas.auth import UserProfile
from app.schemas.character import (
    BaselinePsyche,
    CharacterRecord,
    CharacterWizardDraft,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.turn import CampaignRecord
from app.schemas.world import (
    COMPASS_DIRECTIONS,
    LocationContainer,
    LocationEdgeDraft,
    LocationNode,
    LocationNodeDraft,
    WorldGlobalRules,
    WorldLoreNodeDraft,
    WorldRecord,
    WorldWizardDraft,
)

_REVERSE_COMPASS: dict[str, str] = {
    "N": "S",
    "NE": "SW",
    "E": "W",
    "SE": "NW",
    "S": "N",
    "SW": "NE",
    "W": "E",
    "NW": "SE",
}


@dataclass
class ScenarioBundle:
    """Minimal self-contained user, world, locations, character, and campaign bundle."""

    user: UserProfile
    world: WorldRecord
    locations: list[LocationNode]
    character: CharacterRecord
    campaign: CampaignRecord


def seed_user(
    repo: CantinaRepository,
    *,
    username: str | None = None,
    display_name: str | None = None,
    role: str = "admin",
    user_id: str | None = None,
) -> UserProfile:
    """Create a persistent test user with explicit ownership."""
    suffix = uuid.uuid4().hex[:6]
    uname = username or f"test_user_{suffix}"
    return repo.create_user(
        username=uname,
        display_name=display_name or uname.replace("_", " ").title(),
        password_hash="test_password_hash",
        role=role,
        user_id=user_id,
    )


def seed_world(
    repo: CantinaRepository,
    *,
    owner_id: str | None,
    name: str = "Test Sector",
    locations: list[LocationNodeDraft] | None = None,
    edges: list[LocationEdgeDraft] | None = None,
    containers: list[LocationContainer] | None = None,
    lore_nodes: list[WorldLoreNodeDraft] | None = None,
    global_rules: WorldGlobalRules | None = None,
    world_id: str | None = None,
    unsupported_fields: dict[str, Any] | None = None,
) -> WorldRecord:
    """Create a minimal persistent world (1 starting hub location by default)."""
    locs = locations or [
        LocationNodeDraft(
            key="hub",
            name="Hub Room",
            summary="A quiet central hub room.",
            description="Flickering overhead lamps illuminate a reinforced steel table.",
            environmental_tags=["steel table", "overhead lamp"],
            is_starting_location=True,
            is_hub=True,
        )
    ]
    draft = WorldWizardDraft(
        name=name,
        global_rules=global_rules
        or WorldGlobalRules(
            genre="Cyberpunk Noir",
            tone="Atmospheric and grounded.",
            setting_overview="A compact orbital testing sector.",
            tech_or_magic_rules="Standard cyberware and physical terminals.",
            starting_timestamp="2094-11-14 23:15",
        ),
        containers=containers or [],
        locations=locs,
        edges=edges or [],
        lore_nodes=lore_nodes or [],
    )
    return repo.create_world_from_draft(
        draft,
        world_id=world_id,
        owner_id=owner_id,
        unsupported_fields=unsupported_fields,
    )


def seed_linear_world(
    repo: CantinaRepository,
    *,
    owner_id: str | None,
    names: tuple[str, ...] = ("Main Floor", "Backroom Clinic", "Sub-Basement Tunnels"),
    locked_edges: tuple[int, ...] = (),
    world_name: str = "Linear Test Sector",
    lore_nodes: list[WorldLoreNodeDraft] | None = None,
    global_rules: WorldGlobalRules | None = None,
    world_id: str | None = None,
) -> tuple[WorldRecord, list[LocationNode]]:
    """Create a connected chain A <-> B <-> C ... with explicit edge directions."""
    if not names:
        raise ValueError("names must contain at least one location")

    loc_drafts: list[LocationNodeDraft] = []
    keys: list[str] = []
    for idx, loc_name in enumerate(names):
        key = f"loc_{idx}"
        keys.append(key)
        loc_drafts.append(
            LocationNodeDraft(
                key=key,
                name=loc_name,
                summary=f"{loc_name} summary.",
                description=f"Detailed interior of {loc_name}.",
                environmental_tags=[loc_name.lower(), "sector"],
                is_starting_location=(idx == 0),
                is_hub=(idx == 0),
            )
        )

    edge_drafts: list[LocationEdgeDraft] = []
    for idx in range(len(keys) - 1):
        compass = COMPASS_DIRECTIONS[idx % len(COMPASS_DIRECTIONS)]
        rev = _REVERSE_COMPASS.get(compass, "S")
        edge_drafts.append(
            LocationEdgeDraft(
                from_key=keys[idx],
                to_key=keys[idx + 1],
                direction_label=f"Passage to {names[idx + 1]}",
                reverse_direction_label=f"Passage back to {names[idx]}",
                compass_direction=compass,
                reverse_compass_direction=rev,
                distance_meters=140,
                is_locked_or_hidden=(idx in locked_edges),
            )
        )

    world = seed_world(
        repo,
        owner_id=owner_id,
        name=world_name,
        locations=loc_drafts,
        edges=edge_drafts,
        lore_nodes=lore_nodes,
        global_rules=global_rules,
        world_id=world_id,
    )
    loc_by_name = {loc.name: loc for loc in world.locations}
    ordered_locs = [loc_by_name[n] for n in names]
    return world, ordered_locs


def seed_character(
    repo: CantinaRepository,
    *,
    owner_id: str | None,
    world_id: str | None = None,
    name: str = "Vesper Operative",
    temperament: TemperamentArchetype = "stoic",
    equipped: list[str | ItemInstance] | None = None,
    inventory: list[str | ItemInstance] | None = None,
    memory_shards: list[MemoryShard] | None = None,
    voice_anchors: list[VoiceAnchor] | None = None,
    initial_message: str = '*Vesper glances toward the doorway.* "You are right on time."',
    character_id: str | None = None,
    unsupported_fields: dict[str, Any] | None = None,
) -> CharacterRecord:
    """Create a minimal persistent character owned by owner_id."""
    draft = CharacterWizardDraft(
        name=name,
        tagline="Pragmatic sector operative.",
        character_bio="Veteran technician keeping a low profile.",
        species="Human",
        sex="Female",
        pronouns="she/her",
        age="32",
        build_and_height="170 cm",
        distinctive_features=["Sharp grey eyes", "Brushed-steel wrist cuff"],
        posture="Alert and composed.",
        mannerisms=["Checks the door monitor before speaking."],
        visual_aesthetic="Utilitarian charcoal jacket.",
        personality_traits=["observant", "guarded", "dry"],
        core_persona="Measured, observant, and fiercely loyal to trusted allies.",
        moral_code=["Keep client secrets", "Never leave a wounded ally behind"],
        quirks_flaws=["Never sits with her back to an entrance"],
        communication_style=["clipped", "dry", "precise"],
        initial_message=initial_message,
        equipped=equipped if equipped is not None else ["Charcoal utility jacket"],
        inventory=inventory if inventory is not None else ["Diagnostic penlight"],
        tags=["cyberpunk", "ally"],
        creator="Test Suite",
        creator_notes="Prefers direct answers.",
        voice_anchors=voice_anchors
        or [VoiceAnchor(context="Calm", snippet='"Keep your voice down and tell me what happened."')],
        baseline_psyche=BaselinePsyche(
            mood_label="Vigilant and composed",
            valence=0.05,
            arousal=0.45,
            core_drive="Keep the safehouse independent.",
            core_fear="Corporate trace on her files.",
            default_want="Learn why the visitor arrived after hours.",
            default_plan="Observe quietly while keeping a hand near the counter.",
            initial_worldview=WorldviewProfile(benevolence=-0.15, belonging=0.45, agency=0.35),
            temperament=temperament_config_for_archetype(temperament),
        ),
        memory_shards=memory_shards or [],
        unsupported_fields=unsupported_fields or {},
    )
    return repo.create_character_from_draft(
        draft,
        world_id=world_id,
        character_id=character_id,
        owner_id=owner_id,
    )


def seed_campaign(
    repo: CantinaRepository,
    *,
    owner_id: str | None,
    world_id: str,
    character_id: str,
    character_ids: list[str] | None = None,
    name: str = "Test Campaign",
    opening_prose: str = '*Rain taps against the armored glass.* "Door was supposed to be latched."',
    campaign_id: str | None = None,
    actor_id: str | None = None,
    start_focus: str | None = None,
) -> CampaignRecord:
    """Create a campaign directly with Turn 0 initialized."""
    return repo.create_campaign(
        name=name,
        world_id=world_id,
        character_id=character_id,
        character_ids=character_ids,
        opening_prose=opening_prose,
        campaign_id=campaign_id,
        owner_id=owner_id,
        actor_id=actor_id,
        start_focus=start_focus,
    )


def seed_minimal_scenario(
    repo: CantinaRepository,
    *,
    owner_id: str | None = None,
    role: str = "admin",
    location_names: tuple[str, ...] = ("Main Floor", "Backroom Clinic", "Cooling Tunnels"),
    locked_edges: tuple[int, ...] = (),
    character_name: str = "Vesper Operative",
    temperament: TemperamentArchetype = "stoic",
    with_lore: bool = False,
    with_shards: bool = False,
    campaign_name: str = "Test Sector Run",
) -> ScenarioBundle:
    """Seed an owner-scoped minimal user + linear world + character + campaign."""
    if owner_id is None:
        user = seed_user(repo, role=role)
    else:
        user = repo.get_user_by_id(owner_id)

    lore = (
        [
            WorldLoreNodeDraft(
                title="Orbital Syndicate",
                category="faction",
                content="A megacorp hunting down prototype neural hardware in the lower sectors.",
                entity_tags=["syndicate", "neural", "hounds"],
            ),
            WorldLoreNodeDraft(
                title="The Dockyard Heist",
                category="history",
                content="Six months ago a botched run left an encrypted chip hidden in the clinic.",
                entity_tags=["heist", "dockyard", "chip", "clinic"],
            ),
        ]
        if with_lore
        else []
    )
    shards = (
        [
            MemoryShard(
                title="The Dockyard Debt",
                content="Six months ago the operative patched up a wounded runner with a stolen chip.",
                keywords=["heist", "chip", "dockyard", "debt"],
                emotional_weight=0.9,
            ),
            MemoryShard(
                title="Escape Tunnel Cache",
                content="A waterproof emergency locker is hidden in the Cooling Tunnels.",
                keywords=["tunnels", "cache", "escape", "locker"],
                emotional_weight=0.75,
            ),
        ]
        if with_shards
        else []
    )

    world, locations = seed_linear_world(
        repo,
        owner_id=user.id,
        names=location_names,
        locked_edges=locked_edges,
        lore_nodes=lore,
    )
    character = seed_character(
        repo,
        owner_id=user.id,
        world_id=world.id,
        name=character_name,
        temperament=temperament,
        memory_shards=shards,
    )
    campaign = seed_campaign(
        repo,
        owner_id=user.id,
        world_id=world.id,
        character_id=character.id,
        name=campaign_name,
        opening_prose=character.initial_message,
    )
    return ScenarioBundle(
        user=user,
        world=world,
        locations=locations,
        character=character,
        campaign=campaign,
    )
