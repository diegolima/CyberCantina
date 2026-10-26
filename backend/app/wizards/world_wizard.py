"""1.2 World & Spatial Graph Wizard: Generates world rules, connected locations, and lore."""

from __future__ import annotations

from app.config import settings
from app.engine.llm_client import llm_client
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    LoreNodeDraft,
    WorldGlobalRules,
    WorldWizardDraft,
    WorldWizardSeed,
)


def _fallback_world_expansion(seed: WorldWizardSeed) -> WorldWizardDraft:
    """Seed-adaptive fallback world & spatial graph generator when the LLM server is offline."""
    hub_name = seed.initial_hub_concept.strip() or f"{seed.name} Central Sanctuary"
    return WorldWizardDraft(
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
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="hub_center",
                to_key="outer_courtyard",
                direction_label="Main entrance threshold",
                reverse_direction_label="Entrance into the hub",
                travel_minutes=2,
            ),
            LocationEdgeDraft(
                from_key="hub_center",
                to_key="overlook_gallery",
                direction_label="Narrow staircase up",
                reverse_direction_label="Staircase down to the main floor",
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


async def generate_world_draft(seed: WorldWizardSeed) -> WorldWizardDraft:
    """Use the LLM to expand a WorldWizardSeed into an interconnected WorldWizardDraft."""
    system_prompt = (
        "You are an expert AI Worldbuilder & Spatial Level Designer for an agentic roleplay framework.\n"
        "Given the user's world seed, output a JSON object matching WorldWizardDraft:\n"
        "1. global_rules: genre, tone, setting_overview (2-4 sentences), tech_or_magic_rules, starting_timestamp ('YYYY-MM-DD HH:MM').\n"
        f"2. locations: Create {seed.location_count} distinct, atmospheric LocationNodeDraft objects with slug `key` values, "
        "`name`, 1-sentence `summary` (used when shown as an adjacent exit), 3-4 sentence sensory `description` "
        "(used when characters are inside), `environmental_tags`, and mark the primary hub `is_starting_location: true`.\n"
        "3. edges: Connect the locations using LocationEdgeDraft (`from_key`, `to_key`, evocative `direction_label`, "
        "`reverse_direction_label`, `travel_minutes`, `is_locked_or_hidden`, `bidirectional: true`). Every location must be reachable.\n"
        "4. lore_nodes: Create 4 LoreNodeDraft entries covering key factions, history, items, or cultural rules with `entity_tags`.\n"
        "Return ONLY valid JSON matching WorldWizardDraft."
    )
    user_prompt = (
        f"World Name: {seed.name}\n"
        f"Genre & Tone: {seed.genre_and_tone}\n"
        f"Core Premise: {seed.core_premise}\n"
        f"Starting Hub Concept: {seed.initial_hub_concept or 'A central gathering place'}\n"
        f"Requested Locations: {seed.location_count}"
    )

    try:
        draft = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            WorldWizardDraft,
            profile=settings.actor_profile,
            max_tokens=4096,
        )
        if not draft.locations:
            return _fallback_world_expansion(seed)
        if not any(loc.is_starting_location for loc in draft.locations):
            draft.locations[0].is_starting_location = True
        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return _fallback_world_expansion(seed)
