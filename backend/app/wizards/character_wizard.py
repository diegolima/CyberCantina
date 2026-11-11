"""1.1 Character Creation Wizard: Expands basic user seeds into an agentic roleplay character."""

from __future__ import annotations

import re

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.affective import infer_temperament_and_worldview_from_text
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardLLMOutput,
    CharacterWizardSeed,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
    coerce_item_list,
)
from app.schemas.world import WorldRecord
from app.db.repository import slugify_tag


GENRE_PROFILES = [
    {
        "id": "fantasy",
        "keywords": [
            "fantasy", "medieval", "sword", "magic", "sorcer", "wizard", "elf", "dwarf",
            "d&d", "tavern", "castle", "bard", "paladin", "rogue", "dragon", "cleric",
            "warlock", "ranger", "enchant", "kingdom", "realm", "dungeon", "crusade"
        ],
        "equipped": lambda arch: [
            f"Tailored traveling cloak and tunic suited for a {arch}",
            "Reinforced leather breeches and sturdy brass-buckled belt",
            "High-cuff weathered riding boots",
        ],
        "inventory": lambda note: [
            "Embroidered coin pouch with local minted silver",
            f"Signature keepsake ({note[:42].rstrip('.')})" if note else "Weathered traveler's journal and charcoal quill",
        ],
        "features": [
            "Weathered traveling attire with braided trim",
            "Keen, observant gaze with weathered crow's feet",
            "Hair bound back with a durable leather cord",
            "Faint dueling scar along the left jawline",
            "Broad, grounded posture accustomed to long roads",
            "Quirky silver ring bearing an unidentifiable guild seal",
        ],
        "visual_aesthetic": "Practical layered leather, linen, and travel-worn wool",
    },
    {
        "id": "scifi_space",
        "keywords": [
            "space", "starship", "sci-fi", "scifi", "galactic", "orbit", "planetary",
            "station", "pilot", "astro", "alien", "vacuum", "federation", "colony",
            "warp", "freighter", "cosmos", "zero-g", "stardrive"
        ],
        "equipped": lambda arch: [
            f"Pressurized flight jumpsuit with utility thermal lining suited for a {arch}",
            "Magnetic-clamp utility harness and seal gloves",
            "Reinforced deck boots with magnetic grip soles",
        ],
        "inventory": lambda note: [
            "Compact handheld spectrum scanner",
            f"Encrypted data-chit ({note[:42].rstrip('.')})" if note else "Digital flight manifest and auxiliary power cell",
        ],
        "features": [
            "Slight pallor from extended cycles under artificial ship lighting",
            "Sharp, calculating gaze practiced at monitoring telemetry",
            "Close-trimmed hair designed for helmet seals",
            "Hydraulic pressure grease stain on wrist cuff",
            "Steady, zero-gravity accustomed gait",
            "Unusual brass astronomical compass kept as an analog good luck charm",
        ],
        "visual_aesthetic": "Sealed utilitarian flightwear with thermal insulation and magnetic fasteners",
    },
    {
        "id": "cyberpunk",
        "keywords": [
            "cyberpunk", "netrunner", "cyborg", "neural", "megacorp", "spire", "neon",
            "hacker", "augment", "street samurai", "eddie", "subdermal", "braindance",
            "chrome", "deck", "corpo", "fixer", "slum"
        ],
        "equipped": lambda arch: [
            f"Reinforced utility jacket suited for a {arch}",
            "Dark cargo trousers with concealed equipment pockets",
            "Scuffed composite work boots",
        ],
        "inventory": lambda note: [
            "Encrypted personal comm-link",
            f"Signature gear ({note[:42].rstrip('.')})" if note else "Multi-channel pocket diagnostic tool and patch cables",
        ],
        "features": [
            "Subdermal neural port or port cover behind left ear",
            "Piercing, alert eyes with faint reflective sheen",
            "Cropped dark hair styled for utility",
            "Faint electrical burn scar across right knuckles",
            "Lean, wiry athletic frame",
            "Mismatched chrome-plated thumb ring or finger casing",
        ],
        "visual_aesthetic": "Weathered high-tech streetwear with moisture-sealed cabling channels",
    },
    {
        "id": "horror_gothic",
        "keywords": [
            "horror", "gothic", "eldritch", "occult", "lovecraft", "supernatural", "curse",
            "haunt", "investigator", "asylum", "coven", "vampire", "werewolf", "dread",
            "tomb", "manor", "crypt", "sanity", "shadow over"
        ],
        "equipped": lambda arch: [
            f"Heavy charcoal wool greatcoat with high upturned collar suited for a {arch}",
            "Dark pressed waistcoat, collared shirt, and sturdy trousers",
            "Treaded leather boots stained with damp earth",
        ],
        "inventory": lambda note: [
            "Tarnished silver talisman engraved with warding sigils",
            f"Occult dossier ({note[:42].rstrip('.')})" if note else "Leatherbound pocket ledger with cryptic handwritten notes and wax matches",
        ],
        "features": [
            "Hollow, sleep-deprived eyes carrying a haunted wariness",
            "Prematurely silvered streaks through dark hair",
            "Nervous, hyper-attentive posture constantly checking shadows",
            "Faint claw or ritual scar concealed beneath the collar",
            "Faint scent of old parchment, sulfur, or sweet pipe tobacco",
            "Curious tarnished talisman that seems faintly cold to the touch",
        ],
        "visual_aesthetic": "Dark Victorian tailoring and heavy layered wool with weathered hemlines",
    },
    {
        "id": "western",
        "keywords": [
            "western", "cowboy", "gunslinger", "frontier", "outlaw", "sheriff", "saloon",
            "steed", "desert", "bounty", "revolver", "wasteland west", "ranch", "posse",
            "badlands", "wild west"
        ],
        "equipped": lambda arch: [
            f"Dust-caked canvas duster coat suited for a {arch}",
            "Faded denim work shirt and reinforced riding pants with utility gunbelt",
            "Spurred leather boots with worn riding heels",
        ],
        "inventory": lambda note: [
            "Scratched tin canteen of water and pouch of dried jerky",
            f"Pocket heirloom ({note[:42].rstrip('.')})" if note else "Brass pocket compass with a dented lid",
        ],
        "features": [
            "Sun-weathered skin with deep squint lines from the frontier glare",
            "Dusty wide-brimmed hat casting a shadow over watchful eyes",
            "Coarse stubble along a square jaw",
            "Faint powder burn mark on trigger finger",
            "Slow, relaxed drawl masking coiled physical reflexes",
            "Unusual silver half-dollar coin with a bullet dent carried in pocket",
        ],
        "visual_aesthetic": "Weather-beaten canvas, denim, and sun-cured leather with brass hardware",
    },
    {
        "id": "post_apocalyptic",
        "keywords": [
            "post-apocalyptic", "apocalypse", "apocalyptic", "wasteland", "fallout",
            "scavenger", "ruin", "radiation", "mutant", "scrap", "survivalist", "collapse",
            "bunker", "doomsday", "nuclear"
        ],
        "equipped": lambda arch: [
            f"Layered scavenger coat patched with salvaged tire rubber and fabric suited for a {arch}",
            "Stitched canvas cargo pants with reinforced knee guards",
            "Reinforced combat boots bound with wire and duct tape",
        ],
        "inventory": lambda note: [
            "Analog radiation dosimeter or Geiger needle badge",
            f"Salvaged artifact ({note[:42].rstrip('.')})" if note else "Canteen with charcoal filter and roll of reinforced adhesive tape",
        ],
        "features": [
            "Respirator strap indentations along cheekbones and bridge of nose",
            "Alert, hungry eyes trained on perimeter movement",
            "Patchy hair cut short with a combat knife",
            "Mottled chemical burn scar along forearm",
            "Low, economical center of gravity and quiet footfalls",
            "Quirky necklace made of deactivated pre-collapse circuitry and animal bone",
        ],
        "visual_aesthetic": "Scavenged protective layers, reinforced patches, and modular gear webbing",
    },
    {
        "id": "noir_detective",
        "keywords": [
            "noir", "detective", "hardboiled", "gumshoe", "1920", "1930", "1940", "1950",
            "mobster", "gangster", "speakeasy", "private eye", "syndicate crime", "corrupt city"
        ],
        "equipped": lambda arch: [
            f"Heavy wool trenchcoat favored by this {arch}",
            "Dark collared shirt, loosened tie, and pressed slacks",
            "Polished leather brogues showing street wear",
        ],
        "inventory": lambda note: [
            "Brass pocket lighter and half-empty cigarette case",
            f"Notepad dossier ({note[:42].rstrip('.')})" if note else "Moleskine notebook and fountain pen",
        ],
        "features": [
            "Shadowed, watchful eyes beneath a lowered brow",
            "Slicked-back dark hair silvering at the temples",
            "Faint razor nick near the collar",
            "Upright yet weary posture",
            "Calloused fingertips stained with tobacco or ink",
            "Curious vintage pocket watch that ticks slightly out of tempo",
        ],
        "visual_aesthetic": "Classic mid-century monochrome tailoring, trenchcoat, and felt fedora",
    },
    {
        "id": "modern_espionage",
        "keywords": [
            "modern", "espionage", "agent", "thriller", "contemporary", "heist",
            "tactical", "conspiracy", "covert", "cia", "fbi", "interpol", "operator", "hitman"
        ],
        "equipped": lambda arch: [
            f"Weather-resistant dark softshell jacket suited for a {arch}",
            "Fitted tactical cargo pants or dark durable denim",
            "Low-profile trail running shoes with grip soles",
        ],
        "inventory": lambda note: [
            "Burner smartphone with encrypted offline maps",
            f"Tactical dossier ({note[:42].rstrip('.')})" if note else "Compact multi-tool and small tactical penlight",
        ],
        "features": [
            "Clean-cut, forgettably generic appearance designed to blend into crowds",
            "Sharp, scanning eyes that instinctively track exits and CCTV domes",
            "Neatly groomed hair with zero identifying fashion statements",
            "Faint surgical scar behind the hairline",
            "Calm, measured neutral posture",
            "Unusual scarred knuckle or customized wristwatch with dual-timezone bezel",
        ],
        "visual_aesthetic": "Low-profile civilian technical apparel designed for crowd concealment",
    },
    {
        "id": "steampunk",
        "keywords": [
            "steampunk", "gaslamp", "clockwork", "dirigible", "airship", "victorian science",
            "brass", "cog", "inventor", "aether", "alchemical", "boiler"
        ],
        "equipped": lambda arch: [
            f"Leather-trimmed tweed coat or brass-buckled mechanic's apron suited for a {arch}",
            "High-waisted trousers with reinforced tool loops",
            "Oil-treated leather work boots with brass lace eyelets",
        ],
        "inventory": lambda note: [
            "Pocket clockwork chronometer with exposed balance wheel",
            f"Component pouch ({note[:42].rstrip('.')})" if note else "Foldable brass loupe and velvet pouch of miniature gears",
        ],
        "features": [
            "Soot smudges near temples and grease under fingernails",
            "Intense, calculating gaze analyzing structural tolerances",
            "Wild hair tied loosely with an oiled string",
            "Brass-rimmed goggles pushed up on forehead or neck",
            "Erect, energetic posture with rapid hand gestures",
            "Odd mechanical pocket gadget that whirs and clicks at random intervals",
        ],
        "visual_aesthetic": "Victorian industrial leather, tweed, brass fittings, and utilitarian tool aprons",
    },
    {
        "id": "swashbuckling",
        "keywords": [
            "pirate", "swashbuckler", "naval", "sail", "ocean", "ship", "sea", "buccaneer",
            "privateer", "cutlass", "caribbean", "corsair", "maritime", "islands"
        ],
        "equipped": lambda arch: [
            f"Weather-beaten captain's coat or linen deck shirt suited for a {arch}",
            "Tough sailcloth breeches bound with a wide leather sash",
            "Salt-stained leather deck boots with brass buckles",
        ],
        "inventory": lambda note: [
            "Brass navigational spyglass or pocket compass",
            f"Sealed navigation chart ({note[:42].rstrip('.')})" if note else "Pouch of dried ship's tobacco and steel striker",
        ],
        "features": [
            "Sun-bleached hair and deeply tanned, weather-hardened face",
            "Piercing, wind-squinting gaze conditioned by open seas",
            "Faint rope-burn scarring along palms and wrists",
            "Balanced sea-legs stance swaying instinctively with movement",
            "Small gold hoop earring worn in left earlobe",
            "Curious carved whalebone scrimshaw token depicting a sea creature",
        ],
        "visual_aesthetic": "Weathered sailcloth, linen deck shirts, wide leather belts, and brass hardware",
    },
    {
        "id": "antiquity_feudal",
        "keywords": [
            "ancient", "rome", "gladiator", "spartan", "greek", "antiquity", "samurai",
            "feudal", "ronin", "wuxia", "dynasty", "pharaoh", "bronze", "legion", "sparta"
        ],
        "equipped": lambda arch: [
            f"Traditional woven tunic or layered silk and leather robe suited for a {arch}",
            "Sturdy hide-wrapped girdle and fastened leg wraps",
            "Laced leather sandals or wrapped straw waraji",
        ],
        "inventory": lambda note: [
            "Clay water flask or bamboo gourd",
            f"Inscribed tablet ({note[:42].rstrip('.')})" if note else "Polished jade carving or stamped bronze drachma",
        ],
        "features": [
            "Sun-bronzed skin with disciplined, dignified posture",
            "Severe, focused gaze disciplined by classical training",
            "Topknot or braided hair bound with iron pin or cord",
            "Old sparring scars across forearms and shoulders",
            "Economy of motion; never fidgets or wastes movement",
            "Quirky ceremonial bronze ring etched with archaic glyphs",
        ],
        "visual_aesthetic": "Traditional woven fabrics, wrapped leather armor, and classical ceremonial draping",
    },
    {
        "id": "superhero",
        "keywords": [
            "superhero", "vigilante", "superpower", "hero", "cape", "masked", "villain",
            "mutant power", "crimefighter", "costumed", "nemesis"
        ],
        "equipped": lambda arch: [
            f"Reinforced ballistic weave bodysuit or customized street vigilante jacket suited for a {arch}",
            "Reinforced tactical trousers with hidden padding",
            "Impact-resistant athletic combat boots",
        ],
        "inventory": lambda note: [
            "Compact grappling line or specialized tool dispenser",
            f"Signature gadget ({note[:42].rstrip('.')})" if note else "Miniature secure communicator and medical trauma patch",
        ],
        "features": [
            "Mask line or subtle tan line across upper face",
            "Hyper-alert, scanning gaze tracking high perimeters",
            "Athletic, coiled posture ready to spring into motion",
            "Faint electrical or chemical singe marks on collar",
            "Fingers taped or reinforced with lightweight composite",
            "Curious customized emblem pin with hidden miniature compartment",
        ],
        "visual_aesthetic": "Reinforced impact-resistant textiles with personalized insignia or cowl",
    },
    {
        "id": "universal",
        "keywords": [],
        "equipped": lambda arch: [
            f"Durable all-weather travel coat suited for a {arch}",
            "Tailored utility garments with secure fastenings and sturdy belt",
            "Hard-wearing, all-terrain travel boots",
        ],
        "inventory": lambda note: [
            "Durable personal journal with writing stylus or pencil",
            f"Keepsake token ({note[:42].rstrip('.')})" if note else "Compact multi-purpose pocket utility tool and sturdy water canteen",
        ],
        "features": [
            "Keen, observant gaze taking in every detail of the room",
            "Carefully trimmed hair styled for practicality",
            "Athletic, measured bearing that commands quiet respect",
            "Distinctive pale scar across left brow",
            "Calloused hands accustomed to hard work and skilled craft",
            "Curious carved stone talisman or coin carried as a personal touchstone",
        ],
        "visual_aesthetic": "Timeless, durable travel attire designed for utility across diverse realms",
    },
]


def resolve_genre_fallback_profile(
    genre_text: str,
    archetype: str,
    rough_notes: str,
) -> dict[str, Any]:
    """Score all standard genres and return genre-coherent equipment, inventory, features, and aesthetic."""
    combined = f"{genre_text} {archetype} {rough_notes}".lower()
    genre_lower = genre_text.lower()
    best_profile = GENRE_PROFILES[-1]  # universal fallback
    best_score = 0

    for prof in GENRE_PROFILES[:-1]:
        score = 0
        for kw in prof["keywords"]:
            if kw in combined:
                score += 3 if kw in genre_lower else 1
        if score > best_score:
            best_score = score
            best_profile = prof

    clean_arch = archetype.strip() or "traveler"
    clean_notes = rough_notes.strip()

    return {
        "id": best_profile["id"],
        "equipped": best_profile["equipped"](clean_arch),
        "inventory": best_profile["inventory"](clean_notes),
        "distinctive_features": list(best_profile["features"]),
        "visual_aesthetic": best_profile["visual_aesthetic"],
    }


def _fallback_character_expansion(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
) -> CharacterWizardDraft:
    """Seed-adaptive fallback builder when the LLM server is unreachable."""
    kw_str = ", ".join(seed.personality_keywords) if seed.personality_keywords else "perceptive, guarded, dry-witted"
    setting_note = f" within {world.name}" if world else ""
    notes_suffix = f" Additional details: {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
    start_loc = (
        next((loc for loc in world.locations if loc.is_starting_location), world.locations[0])
        if (world and world.locations)
        else None
    )
    loc_name = start_loc.name if start_loc else "{location_name}"
    loc_desc = (
        f" {start_loc.summary}"
        if start_loc
        else " Shadows stretch across the room as ambient noise hums in the background."
    )

    world_genre = (
        world.global_rules.genre
        if (world and world.global_rules and world.global_rules.genre)
        else ""
    )

    profile_data = resolve_genre_fallback_profile(
        world_genre,
        seed.archetype,
        seed.rough_notes,
    )

    default_equipped = profile_data["equipped"]
    default_inventory = profile_data["inventory"]
    distinctive_features = profile_data["distinctive_features"]
    visual_aesthetic = profile_data["visual_aesthetic"]

    mannerisms = [
        "Clenches jaw and briefly slows breathing when under sudden pressure",
        "Habitually sweeps gaze toward entrances and tracks weapon hands before speaking",
        "Subtly taps fingertips against thigh in measured four-beat intervals when calculating odds",
        "Pauses deliberately before answering direct personal inquiries, holding unbroken eye contact",
    ]

    raw_traits = [k.strip() for k in seed.personality_keywords if k.strip()]
    fallback_archetype_traits = ["hyper-observant", "cynical", "fiercely autonomous", "dry-witted", "calculating"]
    for t in fallback_archetype_traits:
        if len(raw_traits) >= 5:
            break
        if t not in raw_traits:
            raw_traits.append(t)
    personality_traits = raw_traits

    moral_code = [
        "Never betrays an ally or employer who has kept their word in good faith",
        "Refuses to exploit or intentionally harm vulnerable non-combatants",
        "Will never sacrifice personal autonomy or sell out core principles for empty promises",
    ]

    quirks_flaws = [
        "Habitually suspicious of unsolicited kindness, immediately searching for hidden leverage",
        "Deflects genuine vulnerability with caustic, dry humor or tactical distractions",
        "Sleeps with a weapon within arm's reach and insists on sitting with back to a wall",
    ]

    default_plan = (
        "- Observe the immediate threshold and identify all viable exit paths.\n"
        "- Test the user's motives with a measured, probing question.\n"
        "- Maintain tactical distance and safeguard autonomy until reliability is proven."
    )

    inferred_temp, inferred_wv = infer_temperament_and_worldview_from_text(
        seed.archetype,
        seed.role_in_story,
        " ".join(seed.personality_keywords),
        seed.rough_notes,
    )

    temp_arch = getattr(inferred_temp, "archetype", "balanced")
    if temp_arch in ("stoic", "balanced"):
        mood_label, val, ar = "Calm & Composed", 0.2, 0.2
    elif temp_arch in ("paranoiac", "proud_rival"):
        mood_label, val, ar = "Wary & Guarded", -0.2, 0.4
    elif temp_arch == "confidant":
        mood_label, val, ar = "Warm & Receptive", 0.6, 0.3
    elif temp_arch == "volatile":
        mood_label, val, ar = "Uneasy & On-Edge", -0.4, 0.6
    else:
        mood_label, val, ar = "Wary & Guarded", -0.2, 0.4

    return CharacterWizardDraft(
        name=seed.name,
        tagline=f"{seed.archetype} ({kw_str})",
        character_bio=seed.rough_notes.strip() if seed.rough_notes.strip() else f"{seed.name} is an active {seed.archetype}{setting_note}, recognized as {seed.role_in_story}.",
        physical_appearance=seed.rough_notes.strip() if seed.rough_notes.strip() else f"{seed.name} is an active {seed.archetype}{setting_note}, recognized as {seed.role_in_story}.",
        species="Human",
        sex="",
        pronouns="",
        age="",
        build_and_height="",
        distinctive_features=distinctive_features,
        posture="Alert, composed bearing",
        mannerisms=mannerisms,
        modifications=[],
        visual_aesthetic="Practical, functional attire suited to role and environment",
        personality_traits=personality_traits,
        moral_code=moral_code,
        quirks_flaws=quirks_flaws,
        communication_style=["measured", "direct", "guarded"],
        core_persona=(
            f"{seed.name} is a {seed.archetype}{setting_note}, serving as {seed.role_in_story}. "
            f"Their demeanor is defined by being {kw_str}. In conversation, {seed.name} avoids "
            f"melodrama, preferring grounded observations, physical micro-actions, and subtext-heavy "
            f"dialogue.{notes_suffix}"
        ),
        initial_message=(
            f"*Inside {loc_name},{loc_desc} {seed.name} pauses, scanning the entrance with a practiced, "
            f"unhurried gaze before noticing your arrival.*\n\n"
            f"\"You made it,\" *{seed.name} says quietly, gesturing toward a spot nearby.* "
            f"\"We don't have much time before attention catches up with us. Tell me what you found.\""
        ),
        equipped=default_equipped,
        inventory=default_inventory,
        voice_anchors=[
            VoiceAnchor(
                context="Calm / Conversational",
                snippet=(
                    f"*{seed.name} leans back slightly, studying the room before speaking in an even, "
                    f"unhurried cadence.* \"You don't come all this way just for small talk. Tell me what's actually on your mind.\""
                ),
            ),
            VoiceAnchor(
                context="Under Pressure / Guarded",
                snippet=(
                    f"*{seed.name}'s posture stiffens almost imperceptibly, voice dropping half an octave.* "
                    f"\"Careful. People who push that hard usually don't like what they find on the other side.\""
                ),
            ),
            VoiceAnchor(
                context="Trusting / Candid",
                snippet=(
                    f"*A rare, genuine exhale softens {seed.name}'s expression.* "
                    f"\"Alright—cards on the table. I've been keeping this quiet, but I can't handle it alone.\""
                ),
            ),
        ],
        baseline_psyche=BaselinePsyche(
            mood_label=mood_label,
            valence=val,
            arousal=ar,
            core_drive=f"Fulfill their purpose as {seed.archetype} while protecting their autonomy.",
            core_fear="Being compromised by past mistakes or losing the few allies they trust.",
            default_want=f"Assess the user's intentions and establish their dynamic as {seed.role_in_story}.",
            default_plan=default_plan,
            initial_worldview=inferred_wv,
            temperament=inferred_temp,
        ),
        memory_shards=[
            MemoryShard(
                title=f"Formative Turning Point of {seed.name}",
                content=(
                    f"Before becoming known as a {seed.archetype}, {seed.name} walked away from an institution "
                    "that demanded they compromise their principles, leaving behind status for independence."
                ),
                keywords=[seed.name.lower(), "past", "origin", "choice"],
                emotional_weight=0.85,
            ),
            MemoryShard(
                title="Unsettled Debt & Secret",
                content=(
                    f"{seed.name} still carries an unresolved obligation tied to their past work. "
                    f"{seed.rough_notes or 'They keep an emergency contingency plan hidden from almost everyone.'}"
                ),
                keywords=["debt", "secret", "contingency", "trust"],
                emotional_weight=0.8,
            ),
            MemoryShard(
                title="First Impression of the Protagonist",
                content=(
                    f"As {seed.role_in_story}, {seed.name} recognizes that the user is someone who can "
                    "either tip the balance in their favor or bring dangerous heat to their doorstep."
                ),
                keywords=["ally", "history", "protagonist", "reputation"],
                emotional_weight=0.75,
            ),
        ],
        tags=[slugify_tag(kw) for kw in seed.personality_keywords if kw.strip()],
        creator="",
        creator_notes=seed.rough_notes.strip() if seed.rough_notes else "",
    )


async def generate_character_draft(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CharacterWizardDraft:
    """Use the LLM to expand a CharacterWizardSeed into an optimized CharacterWizardDraft."""
    world_context = ""
    if world:
        start_loc = next(
            (loc for loc in world.locations if loc.is_starting_location),
            world.locations[0] if world.locations else None,
        )
        loc_line = (
            f"Starting Hub Location: {start_loc.name} — {start_loc.summary}\n"
            if start_loc
            else ""
        )
        world_context = (
            f"\nTarget World Setting: {world.name} ({world.global_rules.genre})\n"
            f"World Overview: {world.global_rules.setting_overview}\n"
            f"World Rules: {world.global_rules.tech_or_magic_rules}\n"
            f"{loc_line}"
        )

    system_prompt = render_template(
        prompt_template or get_default_prompt("wizard_character_system")
    )
    user_prompt = (
        f"Name: {seed.name}\n"
        f"Archetype / Concept: {seed.archetype}\n"
        f"Role in Story: {seed.role_in_story}\n"
        f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
        f"Rough Notes: {seed.rough_notes}\n"
        f"{world_context}"
    )

    fallback = _fallback_character_expansion(seed, world)
    actor_prof = profile or settings.actor_profile
    try:
        llm_out = await llm_client.complete_structured(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            CharacterWizardLLMOutput,
            profile=actor_prof,
            max_tokens=4096,
        )
        draft = (
            llm_out.to_draft()
            if isinstance(llm_out, CharacterWizardLLMOutput)
            else llm_out
        )
        if not draft.physical_appearance.strip():
            draft.physical_appearance = fallback.physical_appearance
        if not draft.initial_message.strip():
            draft.initial_message = fallback.initial_message
        if not draft.distinctive_features:
            draft.distinctive_features = fallback.distinctive_features
        if not draft.mannerisms:
            draft.mannerisms = fallback.mannerisms
        if not draft.personality_traits:
            draft.personality_traits = fallback.personality_traits
        if not draft.moral_code:
            draft.moral_code = fallback.moral_code
        if not draft.quirks_flaws:
            draft.quirks_flaws = fallback.quirks_flaws
        if not draft.equipped and not draft.inventory:
            draft.equipped = fallback.equipped
            draft.inventory = fallback.inventory
        elif not draft.equipped:
            # If LLM put [Worn] items into inventory, separate them while preserving ItemInstance metadata
            new_inv: list[ItemInstance] = []
            new_eq: list[ItemInstance] = []
            for it in draft.inventory:
                raw_label = str(it)
                if re.match(r"^\[(?:worn|equipped)\]\s*", raw_label, re.IGNORECASE):
                    cleaned = re.sub(
                        r"^\[(?:worn|equipped)\]\s*", "", raw_label, flags=re.IGNORECASE
                    ).strip()
                    if cleaned:
                        new_eq.extend(coerce_item_list([cleaned]))
                else:
                    new_inv.append(it)
            draft.equipped = new_eq or fallback.equipped
            draft.inventory = new_inv or fallback.inventory

        # Media assets must strictly be managed by user uploads or the media pipeline, not LLM
        draft.portraits = {}
        draft.gallery = []

        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return fallback
