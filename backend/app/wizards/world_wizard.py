"""1.2 World & Spatial Graph Wizard: Generates world rules, connected locations, and lore."""

from __future__ import annotations

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    LoreNodeDraft,
    WorldGlobalRules,
    WorldWizardDraft,
    WorldWizardSeed,
    normalize_compass_direction,
    pick_available_compass_direction,
)


def _normalize_draft_topology(draft: WorldWizardDraft) -> WorldWizardDraft:
    """Ensure starting location is set and edges have non-colliding compass directions."""
    if not any(loc.is_starting_location for loc in draft.locations):
        draft.locations[0].is_starting_location = True

    occupied_from: dict[str, set[str]] = {}
    for edge in draft.edges:
        occ = occupied_from.setdefault(edge.from_key, set())
        preferred = normalize_compass_direction(
            edge.compass_direction, edge.direction_label
        )
        cdir = pick_available_compass_direction(preferred, occ)
        occ.add(cdir)
        edge.compass_direction = cdir
    return draft


def _fallback_world_expansion(seed: WorldWizardSeed) -> WorldWizardDraft:
    """Seed-adaptive fallback world & spatial graph generator when the LLM server is offline."""
    hub_name = seed.initial_hub_concept.strip() or f"{seed.name} Central Sanctuary"
    draft = WorldWizardDraft(
        name=seed.name,
        global_rules=WorldGlobalRules(
            genre=seed.genre_and_tone,
            tone="Immersive, sensory-rich, consistent world logic and consequences.",
            setting_overview=seed.core_premise,
            tech_or_magic_rules=(
                f"Grounded within {seed.genre_and_tone}. Actions require plausible tools, "
                "time, and spatial proximity."
            ),
            starting_timestamp="2094-11-14 21:00",
        ),
        locations=[
            LocationNodeDraft(
                key="hub_center",
                name=hub_name,
                summary=f"The primary gathering hub of {seed.name}, where travelers and locals cross paths.",
                description=(
                    f"Inside {hub_name}, the atmosphere reflects the heart of {seed.name}. "
                    f"{seed.core_premise} Conversations hum in low tones while the exits lead out "
                    "to the surrounding quarters."
                ),
                environmental_tags=["ambient lighting", "central counter", "vantage point"],
                is_starting_location=True,
                is_hub=False,
            ),
            LocationNodeDraft(
                key="private_backroom",
                name="Secluded Back Quarter",
                summary="A private, restricted chamber adjoining the main hub for sensitive dealings.",
                description=(
                    "Insulated from the noise of the main hub, this chamber holds worktables, "
                    "locked storage lockers, and a secondary escape route."
                ),
                environmental_tags=["locked lockers", "sound-dampened walls", "worktable"],
            ),
            LocationNodeDraft(
                key="outer_courtyard",
                name="Shadowed Thoroughfare",
                summary="The exterior street and transit passage outside the main hub.",
                description=(
                    "Just beyond the threshold of the hub, the thoroughfare stretches between "
                    "towering structures, patrolled intermittently and slick with weather."
                ),
                environmental_tags=["streetlights", "patrol route", "transit access"],
            ),
            LocationNodeDraft(
                key="overlook_gallery",
                name="Upper Overlook Gallery",
                summary="An elevated vantage point looking down over the central hub.",
                description=(
                    "Accessible via a narrow stair, the gallery provides privacy and a clear "
                    "sightline over everyone entering or leaving below."
                ),
                environmental_tags=["railing sightline", "shadowed alcove", "private booth"],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="hub_center",
                to_key="private_backroom",
                direction_label="Reinforced side door",
                reverse_direction_label="Door back to the main hub",
                compass_direction="E",
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="hub_center",
                to_key="outer_courtyard",
                direction_label="Main entrance threshold",
                reverse_direction_label="Entrance into the hub",
                compass_direction="S",
                travel_minutes=2,
            ),
            LocationEdgeDraft(
                from_key="hub_center",
                to_key="overlook_gallery",
                direction_label="Narrow staircase up",
                reverse_direction_label="Staircase down to the main floor",
                compass_direction="N",
                travel_minutes=1,
            ),
        ],
        lore_nodes=[
            LoreNodeDraft(
                title=f"Dominant Power of {seed.name}",
                category="faction",
                content=(
                    f"The ruling authority shaping life in {seed.name}. {seed.core_premise}"
                ),
                entity_tags=["authority", "faction", "control", "law"],
            ),
            LoreNodeDraft(
                title="Unwritten Local Code",
                category="culture",
                content=(
                    f"Within {hub_name}, disputes are settled quietly; drawing unwanted outside "
                    "attention is the fastest way to lose safe harbor."
                ),
                entity_tags=["code", "rules", "safe harbor", "customs"],
            ),
            LoreNodeDraft(
                title="Recent Catalyst Event",
                category="history",
                content=(
                    "Tensions have spiked recently following a high-stakes incident that left "
                    "local factions searching for answers."
                ),
                entity_tags=["incident", "tension", "history", "rumor"],
            ),
        ],
    )
    return _normalize_draft_topology(draft)


async def generate_world_draft(
    seed: WorldWizardSeed,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> WorldWizardDraft:
    """Use the LLM to expand a WorldWizardSeed into an interconnected WorldWizardDraft."""
    system_prompt = render_template(
        prompt_template or get_default_prompt("wizard_world_system"),
        location_count=seed.location_count,
    )
    user_prompt = (
        f"World Name: {seed.name}\n"
        f"Genre & Tone: {seed.genre_and_tone}\n"
        f"Core Premise: {seed.core_premise}\n"
        f"Starting Hub Concept: {seed.initial_hub_concept or 'A central gathering place'}\n"
        f"Requested Locations: {seed.location_count}"
    )

    actor_prof = profile or settings.actor_profile
    try:
        draft = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            WorldWizardDraft,
            profile=actor_prof,
            max_tokens=4096,
        )
        if not draft.locations:
            return _fallback_world_expansion(seed)
        return _normalize_draft_topology(draft)
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return _fallback_world_expansion(seed)
