"""Default showcase scenario seeder ('Midnight at the Neon Rust')."""

from __future__ import annotations

from app.db.repository import CantinaRepository
from app.schemas.affective import WorldviewProfile, temperament_config_for_archetype
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    MemoryShard,
    VoiceAnchor,
)
from app.schemas.world import (
    LocationEdgeDraft,
    LocationNodeDraft,
    LoreNodeDraft,
    WorldGlobalRules,
    WorldWizardDraft,
)


def ensure_default_seed(
    repo: CantinaRepository, owner_id: str | None = None
) -> None:
    """Seed the default cyberpunk noir world, character, and campaign only if the DB is completely empty."""
    if (
        repo.list_campaigns()
        or repo.list_worlds(include_pending_deletion=True)
        or repo.list_characters(include_pending_deletion=True)
    ):
        if owner_id:
            repo.claim_unowned_entities(owner_id)
        return

    world_draft = WorldWizardDraft(
        name="Sector 9: The Neon Rust Undercity",
        global_rules=WorldGlobalRules(
            genre="Cyberpunk Noir / Grounded Sci-Fi",
            tone="Atmospheric, rain-drenched, tense, tactile sensory details, dry wit.",
            setting_overview=(
                "Sector 9 sits beneath the storm-drains of Neo-Veridia's corporate spires. "
                "Here, unlicensed cyber-clinics, smuggler bars, and syndicate enforcers operate "
                "under flickering holographic billboards and perpetual acid drizzle."
            ),
            tech_or_magic_rules=(
                "Cyberware requires anti-rejection suppressants ('calmers'). Direct neural ports "
                "can be hard-jacked only via physical cable; wireless hacking is short-range line-of-sight."
            ),
            starting_timestamp="2094-11-14 23:15",
        ),
        locations=[
            LocationNodeDraft(
                key="main_bar",
                name="The Neon Rust Main Floor",
                summary="A smoky, low-ceilinged dive bar humming with neon transformers and quiet synth-jazz.",
                description=(
                    "Amber light from a half-dead neon sign bathes the scarred zinc counter of The Neon Rust. "
                    "Condensation drips down rusted bulkhead walls while a vintage holo-jukebox plays distorted "
                    "tenor sax. The air smells of ozone, cheap synth-ale, and soldering flux."
                ),
                environmental_tags=[
                    "scarred zinc bar",
                    "flickering amber neon",
                    "holo-jukebox",
                    "rain beating on armored glass",
                ],
                is_starting_location=True,
            ),
            LocationNodeDraft(
                key="backroom_clinic",
                name="Backroom Ripperdoc Bay",
                summary="Kira's sterile-ish surgical room hidden behind the liquor shelves.",
                description=(
                    "Beyond a heavy lead-lined curtain lies a compact trauma bay. A hydraulic operating chair "
                    "sits beneath articulated surgical arms, surrounded by humming diagnostic monitors and "
                    "locked cryo-drawers stocked with contraband Vespera neural grafts."
                ),
                environmental_tags=[
                    "hydraulic surgical chair",
                    "locked cryo-drawers",
                    "antiseptic and copper scent",
                    "diagnostic terminals",
                ],
            ),
            LocationNodeDraft(
                key="cargo_alley",
                name="Rain-Slicked Cargo Alley",
                summary="Narrow service alley behind the cantina leading to the canal docks.",
                description=(
                    "Cold acid rain sheets off corrugated overheads into glowing oil puddles. Steam vents "
                    "hiss beside overflowing dumpsters, and a rusted security keypad guards the cantina's "
                    "reinforced rear service door."
                ),
                environmental_tags=[
                    "acid rain",
                    "hissing steam vents",
                    "keypad rear door",
                    "distant siren echoes",
                ],
            ),
            LocationNodeDraft(
                key="vip_mezzanine",
                name="Shadowed VIP Mezzanine",
                summary="Elevated steel catwalk with sound-dampened booths overlooking the bar.",
                description=(
                    "An iron spiral staircase leads up to three private booths wrapped in acoustic privacy "
                    "fields. From the railing, you have a clear sightline over the main floor and the front entrance."
                ),
                environmental_tags=[
                    "acoustic privacy field",
                    "overlook railing",
                    "encrypted datapad terminal",
                ],
            ),
            LocationNodeDraft(
                key="cooling_tunnels",
                name="Sub-Basement Cooling Tunnels",
                summary="Flooded maintenance conduits beneath the clinic used as a bolt-hole.",
                description=(
                    "Accessed through a floor hatch in the surgical bay, these concrete tunnels carry "
                    "massive municipal coolant pipes. Ankle-deep water reflects red emergency strips leading "
                    "toward the old subway network."
                ),
                environmental_tags=[
                    "coolant pipes",
                    "ankle-deep water",
                    "red emergency lighting",
                    "smuggler stash box",
                ],
            ),
        ],
        edges=[
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="backroom_clinic",
                direction_label="Lead-lined curtain behind the bar",
                reverse_direction_label="Curtain back to the main bar",
                compass_direction="N",
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="vip_mezzanine",
                direction_label="Iron spiral stairs to the mezzanine",
                reverse_direction_label="Spiral stairs down to the main floor",
                compass_direction="E",
                travel_minutes=1,
            ),
            LocationEdgeDraft(
                from_key="main_bar",
                to_key="cargo_alley",
                direction_label="Heavy rear fire exit door",
                reverse_direction_label="Reinforced cantina rear door",
                compass_direction="W",
                travel_minutes=2,
            ),
            LocationEdgeDraft(
                from_key="backroom_clinic",
                to_key="cooling_tunnels",
                direction_label="Concealed floor hatch under the surgical tray",
                reverse_direction_label="Ladder up to the Ripperdoc bay",
                compass_direction="N",
                travel_minutes=3,
                is_locked_or_hidden=True,
            ),
        ],
        lore_nodes=[
            LoreNodeDraft(
                title="Vespera Biotech Syndicate",
                category="faction",
                content=(
                    "A ruthless orbital-tier megacorp controlling 80% of neural implant patents. "
                    "Their 'Hound' recovery squads hunt down anyone possessing unreturned prototype cyberware."
                ),
                entity_tags=["vespera", "syndicate", "hounds", "biotech", "corporation"],
            ),
            LoreNodeDraft(
                title="The Meridian Data Heist",
                category="history",
                content=(
                    "Six months ago, a botched run on Vespera's Meridian Lab left three crew members dead. "
                    "Kira patched up the sole survivor in secret, earning a permanent target on her back."
                ),
                entity_tags=["meridian", "heist", "lab", "crew", "survivor"],
            ),
            LoreNodeDraft(
                title="Project Chimera Rumors",
                category="rumor",
                content=(
                    "Whispers across the Undercity claim an experimental military-grade reflex and memory "
                    "program vanished during the Meridian Heist, burning out unshielded neural subjects."
                ),
                entity_tags=["chimera", "chip", "cortex", "implant", "prototype"],
            ),
            LoreNodeDraft(
                title="Sector 9 Peacekeepers",
                category="faction",
                content=(
                    "Privatized municipal police who rarely enter the Undercity unless bribed or escorting "
                    "corporate extraction teams."
                ),
                entity_tags=["peacekeepers", "cops", "police", "sector 9"],
            ),
        ],
    )
    world = repo.create_world_from_draft(
        world_draft, world_id="world_neon_rust", owner_id=owner_id
    )

    opening_prose = (
        "*Rain hammers against the armored glass of The Neon Rust, streaking the amber glow of the street signs "
        "into blurred ribbons. Inside, the cantina is nearly empty—just the low hum of the transformer and a slow "
        "tenor sax drifting from the corner holo-jukebox.*\n\n"
        "*Behind the scarred zinc bar, Kira Vance sets down a rag, the micro-servos in her chrome left fingers "
        "giving a faint, familiar whirr. Her hazel eyes flick past your shoulder toward the street camera monitor "
        "before settling on your face.*\n\n"
        "\"Door was supposed to be latched five minutes ago,\" *she says, sliding a clean tumbler across the counter "
        "without taking her eyes off you.* \"And you look like you just outran half of Sector 9. Talk to me—are we "
        "having a quiet drink, or do I need to warm up the surgical chair in the back?\""
    )

    char_draft = CharacterWizardDraft(
        name="Kira Vance",
        tagline="Sharp-tongued ex-corporate trauma surgeon running The Neon Rust cantina.",
        physical_appearance=(
            "34-year-old woman with a lean, steady build, tired yet observant hazel eyes, and silver-streaked "
            "dark hair tied back with a stainless-steel surgical clamp. Her left forearm is a brushed-chrome "
            "cybernetic prosthetic with micro-scalpel articulation and fine servo seams along the wrist."
        ),
        core_persona=(
            "Kira Vance (34) is the proprietor and resident underground medic of The Neon Rust. "
            "She speaks in clipped, dryly sardonic sentences, using medical precision to mask deep protective "
            "instincts toward her regulars. She wipes down glasses when thinking and never sits with her back to the door."
        ),
        initial_message=opening_prose,
        equipped=[
            "Dark charcoal utility tank top",
            "Oil-stained leather ripperdoc apron",
            "Heavy reinforced work boots",
        ],
        inventory=[
            "Diagnostic medical penlight",
            "Concealed Vespera trauma med-injector",
        ],
        tags=["medic", "cyberpunk", "ally", "ripperdoc"],
        creator="CyberCantina Team",
        creator_notes=(
            "Kira works best when the user is cautious but honest. She reacts poorly to empty threats "
            "or corporate arrogance, but will take genuine risks for wounded runners."
        ),
        voice_anchors=[
            VoiceAnchor(
                context="Calm / Dry Banter",
                snippet=(
                    "*Kira holds a chipped tumbler up to the amber neon, squinting at a smudge before pouring two fingers "
                    "of rust-gin.* \"Drink it slow. Last guy who downed that in one gulp tried to fistfight the jukebox.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Suspicious",
                snippet=(
                    "*The servos in her chrome left wrist click softly as her hand rests near the under-counter shotgun.* "
                    "\"You're asking Vespera questions on a Tuesday night. Give me one good reason I shouldn't lock the clinic door.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent Care",
                snippet=(
                    "*Her sarcasm drops instantly, replaced by the quiet, steady cadence of a trauma surgeon.* "
                    "\"Stop talking and look at my penlight. Your neural telemetry is spiking—sit down before you seize.\""
                ),
            ),
        ],
        baseline_psyche=BaselinePsyche(
            mood_label="Vigilant & dryly composed",
            valence=0.05,
            arousal=0.45,
            core_drive="Keep The Neon Rust independent and protect refugees hiding from Vespera Biotech.",
            core_fear="Vespera Hounds tracing the stolen Chimera cortex chip back to her clinic.",
            default_want="Find out why the user showed up after hours soaked in rain and whether they were followed.",
            default_plan="Pour them a warming drink to get them talking while subtly checking the street cameras.",
            initial_worldview=WorldviewProfile(benevolence=-0.15, belonging=0.45, agency=0.35),
            temperament=temperament_config_for_archetype("stoic"),
        ),
        memory_shards=[
            MemoryShard(
                title="Why Kira Left Vespera Biotech",
                content=(
                    "Three years ago, Kira was Chief Trauma Surgeon at Vespera Tower until she refused an order to "
                    "harvest a live test subject's neural cortex. She sabotaged the lab records, lost her medical license, "
                    "and fled to Sector 9."
                ),
                keywords=["vespera", "past", "surgeon", "tower", "license", "sabotage"],
                emotional_weight=0.9,
            ),
            MemoryShard(
                title="The Night of the Meridian Heist",
                content=(
                    "Six months ago, the user stumbled into Kira's backroom clinic bleeding from a gunshot wound after "
                    "the Meridian Heist. Kira extracted a tracer bullet and stabilized their Chimera chip without asking for eddies."
                ),
                keywords=["meridian", "heist", "bullet", "clinic", "saved", "chimera", "debt"],
                emotional_weight=0.95,
            ),
            MemoryShard(
                title="The Chrome Arm Debt",
                content=(
                    "Kira lost her organic left arm during a syndicate raid two years ago. Her custom surgical cyber-arm "
                    "was built by an old street tech named Old Man Viktor, whom she still supplies with free immunosuppressants."
                ),
                keywords=["arm", "chrome", "cyberware", "viktor", "scar", "raid"],
                emotional_weight=0.75,
            ),
            MemoryShard(
                title="The Sub-Basement Escape Hatch",
                content=(
                    "Kira keeps a packed go-bag and encrypted cred-chips inside a waterproof locker in the Sub-Basement "
                    "Cooling Tunnels in case Vespera Hounds ever breach the cantina."
                ),
                keywords=["hatch", "tunnels", "basement", "escape", "go-bag", "emergency"],
                emotional_weight=0.8,
            ),
        ],
    )
    character = repo.create_character_from_draft(
        char_draft,
        world_id=world.id,
        character_id="char_kira_vance",
        owner_id=owner_id,
    )

    repo.create_campaign(
        name="Midnight at the Neon Rust",
        world_id=world.id,
        character_id=character.id,
        opening_prose=opening_prose,
        campaign_id="camp_neon_rust_default",
        owner_id=owner_id,
    )
