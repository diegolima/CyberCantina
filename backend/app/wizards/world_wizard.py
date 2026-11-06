"""1.2 World & Spatial Graph Wizard: Generates world rules, connected locations, and lore."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    LoreNodeDraft,
    WizardLocationNodeLLMOutput,
    WizardLoreNodeLLMOutput,
    WorldGlobalRules,
    WorldMapDraft,
    WorldMapReimagineRequest,
    WorldWizardDraft,
    WorldWizardSeed,
    normalize_compass_direction,
    pick_available_compass_direction,
)


class _WizardWorldLLMOutput(BaseModel):
    """LLM-only schema: omits location lore_nodes and normalizes world lore categories/tags."""

    name: str
    global_rules: WorldGlobalRules
    locations: list[WizardLocationNodeLLMOutput]
    edges: list[LocationEdgeDraft]
    lore_nodes: list[WizardLoreNodeLLMOutput]

    def to_strict_draft(self) -> WorldWizardDraft:
        return WorldWizardDraft(
            name=self.name,
            global_rules=self.global_rules,
            locations=[loc.to_location_draft() for loc in self.locations],
            edges=list(self.edges),
            lore_nodes=[lore.to_strict_draft() for lore in self.lore_nodes],
        )


class _WizardMapLLMOutput(BaseModel):
    """LLM-only map reimagine schema: omits location lore_nodes."""

    locations: list[WizardLocationNodeLLMOutput]
    edges: list[LocationEdgeDraft]

    def to_strict_draft(self) -> WorldMapDraft:
        return WorldMapDraft(
            locations=[loc.to_location_draft() for loc in self.locations],
            edges=list(self.edges),
        )


def _normalize_topology(draft: Any) -> Any:
    """Ensure starting location is set and edges have non-colliding compass directions."""
    if draft.locations and not any(loc.is_starting_location for loc in draft.locations):
        draft.locations[0].is_starting_location = True

    for loc in draft.locations:
        if loc.is_starting_location and not (getattr(loc, "starting_message", None) or "").strip():
            desc = getattr(loc, "description", "").strip()
            loc.starting_message = (
                f"*{loc.name} serves as the threshold into this realm. {desc}*"
                if desc
                else f"*{loc.name} stands ready as the entry point into this world.*"
            )

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


def _normalize_draft_topology(draft: WorldWizardDraft) -> WorldWizardDraft:
    """Ensure starting location is set and edges have non-colliding compass directions."""
    return _normalize_topology(draft)


def _align_draft_rules_with_seed(
    draft: WorldWizardDraft, seed: WorldWizardSeed
) -> WorldWizardDraft:
    """Ensure generated world rules match the user's intended seed rather than defaulting."""
    seed_genre_tone = seed.genre_and_tone.strip()
    current_genre = (draft.global_rules.genre or "").strip()

    seed_lower = seed_genre_tone.lower()
    is_cyberpunk_requested = (
        "cyberpunk" in seed_lower
        or "cyberpunk" in seed.name.lower()
        or "cyberpunk" in seed.core_premise.lower()
    )
    if (
        not current_genre
        or current_genre == "Speculative Fiction"
        or (
            current_genre.lower() in ("cyberpunk noir", "cyberpunk")
            and not is_cyberpunk_requested
        )
    ):
        draft.global_rules.genre = seed_genre_tone

    if not draft.global_rules.tone or not draft.global_rules.tone.strip():
        draft.global_rules.tone = "Immersive, sensory-rich, consistent world logic and consequences."

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
                starting_message=(
                    f"The heavy threshold of {hub_name} gives way to the ambient warmth and low chatter of {seed.name}. "
                    f"{seed.core_premise} Outside, the elements press against the reinforced glass, while the steady rhythm "
                    f"of daily life continues under the dim, watchful fixtures above."
                ),
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
        raw_draft = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            _WizardWorldLLMOutput,
            profile=actor_prof,
            max_tokens=4096,
        )
        draft = (
            raw_draft.to_strict_draft()
            if isinstance(raw_draft, _WizardWorldLLMOutput)
            else raw_draft
        )
        # Never autogenerate location lore on wizard-generated locations
        for loc in draft.locations:
            loc.lore_nodes = []
        if not draft.locations:
            return _fallback_world_expansion(seed)
        draft = _align_draft_rules_with_seed(draft, seed)
        return _normalize_draft_topology(draft)
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return _fallback_world_expansion(seed)


def _fallback_map_reimagine(req: WorldMapReimagineRequest) -> WorldMapDraft:
    """Offline fallback when LLM server is not responding, tailored to req.map_description."""
    desc_words = [
        w.strip(".,;:!?\"'()") for w in req.map_description.split() if len(w) > 3
    ]
    theme_anchor = desc_words[0].capitalize() if desc_words else "Central"
    hub_name = f"{req.world_name} {theme_anchor} Hub"
    count = max(3, min(req.location_count, 8))

    locations = [
        LocationNodeDraft(
            key="reimagined_hub",
            name=hub_name,
            summary=f"The central hub of {req.world_name}, redesigned around the new spatial layout.",
            description=(
                f"Anchored in the heart of {req.world_name}. {req.map_description[:160]}. "
                "Exits lead out to surrounding quarters according to the re-imagined layout."
            ),
            environmental_tags=["central", "re-imagined", "arrival"],
            is_starting_location=True,
            is_hub=True,
        ),
        LocationNodeDraft(
            key="reimagined_sector_alpha",
            name=f"{theme_anchor} Sector Passage",
            summary="An adjoining wing aligned with the re-imagined design.",
            description=(
                f"Extending away from {hub_name}, this section incorporates features from the requested layout: "
                f"{req.map_description}."
            ),
            environmental_tags=["passage", "corridor"],
        ),
        LocationNodeDraft(
            key="reimagined_perimeter",
            name=f"{theme_anchor} Perimeter Outpost",
            summary="An outer threshold overlooking the surrounding area.",
            description=(
                f"Positioned on the outer ring of {req.world_name}. Structural lines and atmospheric detail "
                "mesh with the primary setting."
            ),
            environmental_tags=["perimeter", "vantage point"],
        ),
    ]

    edges = [
        LocationEdgeDraft(
            from_key="reimagined_hub",
            to_key="reimagined_sector_alpha",
            direction_label="Primary transit arch",
            reverse_direction_label="Back to central hub",
            compass_direction="E",
            travel_minutes=1,
            bidirectional=True,
        ),
        LocationEdgeDraft(
            from_key="reimagined_hub",
            to_key="reimagined_perimeter",
            direction_label="Secured perimeter corridor",
            reverse_direction_label="Back to central hub",
            compass_direction="N",
            travel_minutes=2,
            bidirectional=True,
        ),
    ]

    if count >= 4:
        locations.append(
            LocationNodeDraft(
                key="reimagined_sublevel",
                name=f"{theme_anchor} Sub-level Chambers",
                summary="A lower auxiliary sector matching the re-imagined layout.",
                description=(
                    "Beneath the main floor, quiet machinery and secondary corridors provide access "
                    "to specialized infrastructure."
                ),
                environmental_tags=["lower level", "utility"],
            )
        )
        edges.append(
            LocationEdgeDraft(
                from_key="reimagined_hub",
                to_key="reimagined_sublevel",
                direction_label="Access stairwell down",
                reverse_direction_label="Stairwell up to hub",
                compass_direction="S",
                travel_minutes=1,
                bidirectional=True,
            )
        )

    draft = WorldMapDraft(locations=locations, edges=edges)
    return _normalize_topology(draft)


async def reimagine_world_map(
    req: WorldMapReimagineRequest,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> WorldMapDraft:
    """Use the LLM to regenerate spatial topology based on user description and world rules."""
    system_prompt = render_template(
        prompt_template or get_default_prompt("wizard_map_reimagine_system"),
        location_count=req.location_count,
        genre=req.global_rules.genre,
        tone=req.global_rules.tone,
    )
    user_prompt = (
        f"World Name: {req.world_name}\n"
        f"Genre: {req.global_rules.genre}\n"
        f"Tone: {req.global_rules.tone}\n"
        f"Setting Overview: {req.global_rules.setting_overview}\n"
        f"World Rules / Constraints: {req.global_rules.tech_or_magic_rules}\n\n"
        f"=== DESIRED MAP VISION & LAYOUT ===\n"
        f"{req.map_description}\n\n"
        f"Requested Locations Count: {req.location_count}"
    )

    actor_prof = profile or settings.actor_profile
    try:
        raw_map = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            _WizardMapLLMOutput,
            profile=actor_prof,
            max_tokens=4096,
        )
        draft = (
            raw_map.to_strict_draft()
            if isinstance(raw_map, _WizardMapLLMOutput)
            else raw_map
        )
        for loc in draft.locations:
            loc.lore_nodes = []
        if not draft.locations:
            return _fallback_map_reimagine(req)
        return _normalize_topology(draft)
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return _fallback_map_reimagine(req)
