"""Critical-success situational room prop generation with strict power bounds."""

from __future__ import annotations

import hashlib
import logging
import re
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.engine.telemetry import telemetry_phase_scope
from app.schemas.character import sanitize_character_markup
from app.schemas.turn import (
    CampaignWorldSettings,
    PreTurnAnalysis,
    PropTier,
    SpawnedLocationProp,
    TurnNodeRecord,
    WorldStateSnapshot,
)
from app.schemas.world import LocationNode, LocationProp, WorldRecord

logger = logging.getLogger("cybercantina.engine.prop_spawn")

_FORBIDDEN_PROP_RE = re.compile(
    r"\b("
    r"gun|pistol|revolver|rifle|shotgun|smg|carbine|firearm|handgun|sidearm|"
    r"grenade|explosive|bomb|c4|dynamite|katana|sword|dagger|machete|crossbow|"
    r"taser|stun\s*gun|laser\s*weapon|plasma\s*(?:rifle|pistol|cutter)|"
    r"master\s*key|skeleton\s*key|universal\s*(?:key|keycard|pass|decrypt|override)|"
    r"root\s*(?:key|password|access)|admin\s*override|omni-?tool|"
    r"chest\s*of\s*gold|gold\s*bars?|diamonds?|briefcase\s*of\s*cash|"
    r"wad\s*of\s*credits|million\s*credits|treasure\s*hoard|"
    r"amulet\s*of\s*power|ring\s*of\s*wishes|teleporter|time\s*machine"
    r")\b",
    re.IGNORECASE,
)

_TIER_BADGE_MAP: dict[PropTier, str] = {
    "clue": "Clue",
    "mundane_tool": "Tool",
    "minor_consumable": "Consumable",
    "improvised_aid": "Aid",
}


class CritAutoSpawnPropLLMOutput(BaseModel):
    """Structured output for bounded situational prop spawned on /search Critical Success."""

    model_config = ConfigDict(
        json_schema_extra=lambda schema: schema.update(
            required=list(schema.get("properties", {}).keys())
        )
    )

    name: str = Field(
        ...,
        min_length=2,
        max_length=80,
        description="Short grounded object name (2-5 words, e.g. 'Smudged Maintenance Slip', 'Bent Brass Hairpin').",
    )
    note: str = Field(
        ...,
        min_length=5,
        max_length=220,
        description="One concise sentence explaining what it is and its modest situational utility.",
    )
    tier: PropTier = Field(
        ...,
        description="Strictly one of: 'clue', 'mundane_tool', 'minor_consumable', or 'improvised_aid'.",
    )

    @model_validator(mode="after")
    def _sanitize_and_validate_bounds(self) -> "CritAutoSpawnPropLLMOutput":
        clean_name = re.sub(
            r"\s+",
            " ",
            sanitize_character_markup(self.name, single_line=True),
        ).strip()[:80]
        clean_note = re.sub(
            r"\s+",
            " ",
            sanitize_character_markup(self.note, single_line=True),
        ).strip()[:220]
        if not clean_name or not clean_note:
            raise ValueError("Spawned prop name and note cannot be empty.")
        combined = f"{clean_name} {clean_note}"
        if _FORBIDDEN_PROP_RE.search(combined):
            raise ValueError("Spawned prop violated power-boundary restrictions.")
        self.name = clean_name
        self.note = clean_note
        return self


_GENRE_FALLBACK_POOLS: dict[str, tuple[tuple[str, PropTier, str], ...]] = {
    "scifi": (
        (
            "Smudged Shift-Log Microcard",
            "clue",
            "A discarded thermal slip noting recent maintenance traffic and a partial bay code.",
        ),
        (
            "Bent Copper Jumper Wire",
            "mundane_tool",
            "A short insulated copper lead useful for bridging low-voltage diagnostic pins.",
        ),
        (
            "Single-Dose Electrolyte Ampoule",
            "minor_consumable",
            "A sealed foil-cap stimulant vial that eases mild fatigue for a few minutes.",
        ),
        (
            "Magnetic Pocket Pry Wedge",
            "improvised_aid",
            "A slim anodized shim suited for propping latches or easing stuck panels.",
        ),
    ),
    "fantasy": (
        (
            "Wax-Sealed Scrap of Parchment",
            "clue",
            "A folded note bearing a hurried tally and a smudged Wax-guild mark.",
        ),
        (
            "Tarnished Copper Awl",
            "mundane_tool",
            "A worn pocket awl fit for scoring wood, prying wax, or probing tight seams.",
        ),
        (
            "Dried Herbal Poultice",
            "minor_consumable",
            "A small linen bundle of bitter herbs that soothes minor scrapes and burns.",
        ),
        (
            "Sturdy Iron Door Wedge",
            "improvised_aid",
            "A heavy forged wedge handy for jamming hinges or holding a shutter ajar.",
        ),
    ),
    "horror": (
        (
            "Torn Matchbook with Initials",
            "clue",
            "A damp paper matchbook with three matches left and a penciled room number inside.",
        ),
        (
            "Rusted Brass Pocket Screwdriver",
            "mundane_tool",
            "A small flathead tool capable of loosening painted-over vent screws.",
        ),
        (
            "Half-Full Smelling Salts Vial",
            "minor_consumable",
            "A corked glass vial pungent enough to steady dizziness or clear a foggy head.",
        ),
        (
            "Heavy Brass Stopper Wedge",
            "improvised_aid",
            "A solid metal wedge useful for bracing a door or tapping hollow masonry.",
        ),
    ),
    "noir": (
        (
            "Crumpled Carbon-Copy Receipt",
            "clue",
            "A faded duplicate receipt listing a delivery time and an abbreviated signature.",
        ),
        (
            "Folding Pocket Inspection Mirror",
            "mundane_tool",
            "A scratched compact mirror on a hinge for peering behind tight fixtures.",
        ),
        (
            "Foil Pack of Mint Stimulants",
            "minor_consumable",
            "A couple of stale caffeine tablets tucked behind a torn cardboard tab.",
        ),
        (
            "Hard Rubber Door Wedge",
            "improvised_aid",
            "A scuffed wedge that quietly holds heavy interior doors from latching shut.",
        ),
    ),
    "default": (
        (
            "Faded Handwritten Memo",
            "clue",
            "A creased note left behind in a crevice with a brief, context-relevant detail.",
        ),
        (
            "Compact Multi-Bit Pocket Driver",
            "mundane_tool",
            "A modest pocket tool suitable for loose fasteners, latches, or casings.",
        ),
        (
            "Sealed Travel Bandage Strip",
            "minor_consumable",
            "A clean, single-use dressing helpful for patching minor cuts on the spot.",
        ),
        (
            "Sturdy Brass Pry Shim",
            "improvised_aid",
            "A flat metal shim useful for wedging seams or propping small covers open.",
        ),
    ),
}


def _pick_genre_fallback_prop(
    *,
    genre: str,
    location_id: str,
    search_focus: str | None,
) -> CritAutoSpawnPropLLMOutput:
    g = (genre or "").lower()
    if any(k in g for k in ("cyber", "sci-fi", "scifi", "space", "futur", "neon", "dystop")):
        pool = _GENRE_FALLBACK_POOLS["scifi"]
    elif any(k in g for k in ("fantasy", "medieval", "arcane", "sword", "myth", "dungeon")):
        pool = _GENRE_FALLBACK_POOLS["fantasy"]
    elif any(k in g for k in ("horror", "gothic", "eldritch", "occult", "survival")):
        pool = _GENRE_FALLBACK_POOLS["horror"]
    elif any(k in g for k in ("noir", "mystery", "detective", "modern", "thriller", "crime")):
        pool = _GENRE_FALLBACK_POOLS["noir"]
    else:
        pool = _GENRE_FALLBACK_POOLS["default"]

    seed = f"{location_id}:{search_focus or ''}".encode("utf-8")
    idx = int(hashlib.sha1(seed).hexdigest(), 16) % len(pool)
    name, tier, note = pool[idx]
    return CritAutoSpawnPropLLMOutput(name=name, tier=tier, note=note)


def is_crit_auto_spawn_eligible(
    *,
    world_settings: CampaignWorldSettings,
    pre_turn: PreTurnAnalysis,
    effective_unclaimed_props: list[LocationProp],
    world_snapshot: WorldStateSnapshot,
    active_location_id: str,
) -> bool:
    """Enforce all 5 eligibility gates before auto-spawning a prop on /search Critical Success."""
    if not world_settings.auto_spawn_props_on_search_crit:
        return False
    if not pre_turn.is_search_action:
        return False
    roll = pre_turn.resolved_roll
    if roll is None and pre_turn.character_rolls:
        roll = next(iter(pre_turn.character_rolls.values()), None)
    if roll is None or roll.outcome_tier != "Critical Success":
        return False
    if pre_turn.roll_was_pinned and not world_settings.unlock_lore:
        return False
    if len(effective_unclaimed_props) > 0:
        return False
    if active_location_id in (world_snapshot.auto_spawned_prop_location_ids or []):
        return False
    return True


async def generate_crit_auto_spawn_prop(
    *,
    active_location: LocationNode,
    world: WorldRecord,
    recent_turns: list[TurnNodeRecord],
    search_focus: str | None = None,
    profile: ModelProfile | None = None,
) -> SpawnedLocationProp:
    """Generate a bounded, situationally relevant prop for a Critical Success /search."""
    clerk_prof = profile or settings.clerk_profile
    recent_snippets: list[str] = []
    for t in recent_turns[-3:]:
        u = " ".join((t.user_message or "").split())[:180]
        p = " ".join((t.raw_prose or "").split())[:260]
        if u or p:
            recent_snippets.append(f"- User: {u}\n  Scene: {p}")
    recent_context = "\n".join(recent_snippets) if recent_snippets else "- Scene just began."

    env_tags = ", ".join(active_location.environmental_tags) if active_location.environmental_tags else "None"
    focus_line = f"Player Search Focus: {search_focus}" if search_focus else "Player Search Focus: General sweep of the room"
    system_prompt = (
        "You are a disciplined tabletop RPG quartermaster generating ONE minor, grounded, "
        "situationally useful portable prop uncovered during a Critical Success room search.\n"
        "HARD BOUNDARIES (never violate):\n"
        "- Allowed tiers ONLY: 'clue' (note, slip, tag, log), 'mundane_tool' (wire, awl, mirror, screwdriver), "
        "'minor_consumable' (single bandage, stimulant, salts, oil), 'improvised_aid' (wedge, shim, twine, chalk).\n"
        "- FORBIDDEN: weapons, firearms, blades, explosives, master/universal keys, admin overrides, "
        "currency hoards, rare valuables, or plot-solving magical/sci-fi relics.\n"
        "- Keep the object small, plausible for the room and genre, and modest in impact."
    )
    user_prompt = (
        f"World Genre: {world.global_rules.genre}\n"
        f"World Tone: {world.global_rules.tone}\n"
        f"Location: {active_location.name}\n"
        f"Location Description: {active_location.description}\n"
        f"Environmental Tags: {env_tags}\n"
        f"{focus_line}\n\n"
        f"Recent 2-3 Turns:\n{recent_context}\n\n"
        "Return one modest, grounded portable prop matching the scene."
    )

    spec: CritAutoSpawnPropLLMOutput | None = None
    try:
        with telemetry_phase_scope("phase1_pre", "Crit Auto-Spawn Prop"):
            spec = await llm_client.complete_structured(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                CritAutoSpawnPropLLMOutput,
                profile=clerk_prof,
                required_properties=list(CritAutoSpawnPropLLMOutput.model_fields.keys()),
            )
    except Exception as exc:
        logger.debug("Crit auto-spawn LLM generation skipped/rejected (%s); using genre fallback.", exc)
        spec = None

    if spec is None:
        spec = _pick_genre_fallback_prop(
            genre=world.global_rules.genre,
            location_id=active_location.id,
            search_focus=search_focus,
        )

    tier_label = _TIER_BADGE_MAP.get(spec.tier, "Found")
    note_with_tier = spec.note
    if not note_with_tier.startswith(f"[{tier_label}]"):
        note_with_tier = f"[{tier_label}] {note_with_tier}"[:300]

    return SpawnedLocationProp(
        id=f"prop_{uuid.uuid4().hex[:10]}",
        location_id=active_location.id,
        name=spec.name,
        note=note_with_tier,
        flags=[],
        lore_id=None,
        is_hidden=False,
        auto_spawned=True,
    )
