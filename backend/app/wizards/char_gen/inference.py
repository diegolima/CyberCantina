"""Deterministic demographic, moral/quirk, dialogue anchor, and offline fallback inference."""

from __future__ import annotations

import re

from app.db.repository import slugify_tag
from app.schemas.affective import infer_temperament_and_worldview_from_text
from app.schemas.character import (
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardSeed,
    MemoryShard,
    VoiceAnchor,
    normalize_starting_mood,
)
from app.schemas.world import WorldRecord

from app.wizards.char_gen.genre_profiles import resolve_genre_fallback_profile

def infer_demographics_and_anatomy(
    name: str,
    archetype: str,
    rough_notes: str = "",
    species: str = "Human",
) -> dict[str, str]:
    """Deterministically infer sex, pronouns, age, metric height, frame, and posture."""
    combined = f"{name} {archetype} {rough_notes}".lower()

    # Species inference
    spec = species.strip() or "Human"
    if spec.lower() == "human":
        for candidate in ("elf", "elven", "dwarf", "dwarven", "tiefling", "android", "cyborg", "orc", "halfling", "gnome", "synthetic", "vampire", "alien"):
            if re.search(rf"\b{candidate}\b", combined):
                spec = candidate.capitalize()
                if spec in ("Elven", "Elf"):
                    spec = "Elf"
                elif spec in ("Dwarven", "Dwarf"):
                    spec = "Dwarf"
                break

    # Sex and Pronouns inference
    female_cues = re.search(r"\b(she|her|hers|female|woman|girl|sister|mother|lady|queen|matriarch|heroine|witch|priestess|sorceress|daughter|actress)\b", combined)
    male_cues = re.search(r"\b(he|him|his|male|man|boy|brother|father|lord|king|patriarch|hero|wizard|priest|son|guy|actor)\b", combined)
    nonbinary_cues = re.search(r"\b(they|them|theirs|non-binary|nonbinary|enby|synthetic|construct|golem|drone|automaton|ageless|neuter)\b", combined)

    name_clean = name.strip()
    first_name = name_clean.split()[0].lower() if name_clean else "character"

    male_names = {"soren", "marcus", "john", "deckard", "victor", "arthur", "bruce", "roland", "kane", "lucas", "ethan", "dante", "felix", "leo", "cyril", "kael", "torin", "ren"}
    female_names = {"lyra", "sarah", "elena", "mia", "diana", "renna", "anya", "talia", "kira", "selene", "valeria", "mara", "seraphina", "chloe", "naomi", "freya"}

    if female_cues and not male_cues:
        sex, pronouns = "Female", "she/her"
    elif male_cues and not female_cues:
        sex, pronouns = "Male", "he/him"
    elif nonbinary_cues or spec.lower() in ("android", "synthetic", "automaton", "construct", "drone"):
        sex, pronouns = "Non-binary", "they/them"
    elif first_name in female_names or (first_name.endswith(("a", "ia", "ina", "ette", "elle")) and first_name not in ("joshua", "luca")):
        sex, pronouns = "Female", "she/her"
    elif first_name in male_names or first_name.endswith(("o", "us", "en", "or", "ard", "on")):
        sex, pronouns = "Male", "he/him"
    else:
        h = sum(ord(c) for c in first_name) % 10
        if h in (0, 1):
            sex, pronouns = "Non-binary", "they/them"
        elif h in (2, 3, 4, 5):
            sex, pronouns = "Male", "he/him"
        else:
            sex, pronouns = "Female", "she/her"

    # Age inference
    explicit_age_match = re.search(r"\b(\d{2})\s*(?:years? old|yo|y/o)?\b", rough_notes)
    if explicit_age_match:
        age = explicit_age_match.group(1)
    elif any(k in combined for k in ("veteran", "elder", "mentor", "retired", "ancient", "grizzled", "patriarch", "matriarch", "gray", "silver")):
        age = "52"
    elif any(k in combined for k in ("young", "rookie", "student", "apprentice", "prodigy", "urchin", "novice", "initiate", "youth")):
        age = "21"
    elif any(k in combined for k in ("seasoned", "infiltrator", "investigator", "captain", "detective", "smuggler", "specialist", "agent", "operative")):
        age = "34"
    else:
        age = "29"

    # Height and Build inference
    spec_lower = spec.lower()
    if "dwarf" in spec_lower:
        height_val = 140
    elif "elf" in spec_lower:
        height_val = 188
    elif any(k in spec_lower for k in ("halfling", "gnome")):
        height_val = 106
    elif any(k in spec_lower for k in ("orc", "giant", "goliath")):
        height_val = 214
    else:
        if sex == "Female":
            height_val = 168
        elif sex == "Male":
            height_val = 180
        else:
            height_val = 174

    if any(k in combined for k in ("knight", "brawler", "tank", "berserker", "soldier", "enforcer", "blacksmith", "heavy", "warrior")):
        build_str = "broad-shouldered athletic frame"
    elif any(k in combined for k in ("rogue", "thief", "assassin", "infiltrator", "dancer", "scout", "ranger", "wiry", "slender")):
        build_str = "lean, wiry athletic frame"
    elif any(k in combined for k in ("scholar", "mage", "wizard", "hacker", "clerk", "alchemist", "investigator", "slight")):
        build_str = "slender, wiry build"
    else:
        build_str = "balanced athletic build"

    build_and_height = f"{height_val} cm"

    # Posture inference
    if any(k in combined for k in ("soldier", "enforcer", "paladin", "guard", "officer", "knight")):
        posture = "Rigid, upright military bearing; feet planted shoulder-width apart"
    elif any(k in combined for k in ("rogue", "thief", "outlaw", "smuggler", "assassin", "scavenger")):
        posture = "Relaxed, low-center-of-gravity stance; habitually leaning against doorways or walls"
    elif any(k in combined for k in ("scholar", "mage", "hacker", "clerk", "alchemist", "detective", "investigator")):
        posture = "Slight forward hunch; shoulders rounded with hands clasped behind back or in pockets"
    elif any(k in combined for k in ("noble", "diplomat", "bard", "performer", "captain", "courtier")):
        posture = "Poised, deliberate posture with chin slightly raised and fluid, confident gestures"
    else:
        posture = "Alert, composed bearing with measured, watchful economy of motion"

    return {
        "species": spec,
        "sex": sex,
        "pronouns": pronouns,
        "age": age,
        "height": f"{height_val} cm",
        "build": build_str,
        "build_and_height": build_and_height,
        "posture": posture,
    }


def infer_moral_code_and_quirks(
    archetype: str,
    personality_keywords: list[str],
    rough_notes: str = "",
    core_persona: str = "",
) -> tuple[list[str], list[str]]:
    """Generate persona-aligned moral boundaries and concrete behavioral quirks."""
    combined = f"{archetype} {' '.join(personality_keywords)} {rough_notes} {core_persona}".lower()

    if any(k in combined for k in ("cynic", "detached", "mercenary", "selfish", "outlaw", "hustler", "assassin", "criminal", "smuggler", "fixer", "cold", "ruthless", "pragmat")):
        moral_code = [
            "Never risks life or freedom for sentimental causes without tangible leverage or collateral",
            "Demands fair payment and strictly honors a deal once blood, coin, or collateral is exchanged",
            "Refuses to become anyone's expendable pawn or die for another's ideology",
        ]
        quirks_flaws = [
            "Instinctively tracks exits and calculates escape vectors whenever entering an unfamiliar room",
            "Deflects personal inquiries with abrasive irony or evasive, dry sarcasm",
            "Cannot sleep soundly unless a weapon is within direct arm's reach and back is against a solid wall",
        ]
    elif any(k in combined for k in ("paladin", "guardian", "knight", "protector", "hero", "healer", "cleric", "devoted", "altruist")):
        moral_code = [
            "Will not abandon an ally or vulnerable innocent when direct action can prevent tragedy",
            "Refuses to employ extortion, cruelty, or terror even when facing ruthless adversaries",
            "Holds sworn oaths sacred, standing ground even when withdrawal offers tactical advantage",
        ]
        quirks_flaws = [
            "Carries deep survivor's guilt, obsessively holding themselves personally responsible for collateral harm",
            "Stiff and visibly awkward in casual social settings, reflexively defaulting to vigilant patrol duty",
            "Prone to taking unreasonable physical risks to shield others from danger",
        ]
    elif any(k in combined for k in ("scholar", "mage", "scientist", "investigator", "detective", "hacker", "curious", "analyst")):
        moral_code = [
            "Refuses to destroy unique knowledge, historical records, or documented evidence under political pressure",
            "Will not test untested theories or hazardous arcana on unwitting subjects",
            "Stands by verified empirical fact even when confronting hostile, dogmatic authority",
        ]
        quirks_flaws = [
            "Becomes dangerously hyperfocused on unsolved enigmas, neglecting basic rest and immediate threats",
            "Speaks in overly dense analytical jargon when under stress, alienating non-specialists",
            "Struggles to process subtle emotional subtext, often taking figurative sarcasm as literal inquiry",
        ]
    elif any(k in combined for k in ("rogue", "thief", "trickster", "scavenger", "rebel", "drifter")):
        moral_code = [
            "Never steals from or exploits those who have already lost everything",
            "Never betrays a fellow fugitive or street partner who has kept their word",
            "Always secures an emergency exit for themselves and a clean escape path for companions",
        ]
        quirks_flaws = [
            "Compulsively fidgets with small lockpicks, coins, or trinkets when forced to stay still",
            "Has a visceral aversion to rigid authority, visibly bristling whenever given a direct order",
            "Maintains hidden emergency supply stashes in multiple locations out of perpetual distrust",
        ]
    else:
        moral_code = [
            "Never betrays an ally or employer who has acted in transparent good faith",
            "Refuses to sacrifice personal autonomy or sell out core principles for empty promises",
            "Will not initiate unprovoked violence against unarmed parties",
        ]
        quirks_flaws = [
            "Habitually suspicious of unsolicited kindness, immediately searching for hidden leverage",
            "Subtly checks weapon holster or belt fastenings when conversation turns tense",
            "Pauses deliberately before answering direct personal questions, studying the listener's eyes",
        ]

    return moral_code, quirks_flaws


def infer_dialogue_anchors_and_style(
    name: str,
    archetype: str,
    genre: str = "",
    rough_notes: str = "",
) -> tuple[list[str], list[VoiceAnchor]]:
    """Derive literary-grounded voice anchors and communication style chips."""
    combined = f"{archetype} {genre} {rough_notes}".lower()

    if any(k in combined for k in ("noir", "detective", "gumshoe", "hardboiled", "speakeasy", "crime")):
        style = ["clipped", "laconic", "dryly sarcastic", "low gravel tone", "elliptical pauses"]
        anchors = [
            VoiceAnchor(
                context="Calm / Conversational (Chandler style)",
                snippet=(
                    f"*{name} strikes a wooden match against the doorframe, letting the sulfur burn down before speaking.* "
                    f"\"If you came to hire a miracle, you're at the wrong address. If you came to buy trouble, sit down.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Under Pressure (Hammett style)",
                snippet=(
                    f"*{name}'s jaw sets hard, eyes narrowing beneath the brim of their collar.* "
                    f"\"Drop the poker face. In this town, anyone playing that innocent already has blood on their cuffs.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent",
                snippet=(
                    f"*{name} exhales a slow, ragged breath, running calloused fingers along the desk edge.* "
                    f"\"I don't give a damn about the money anymore. What they found in that warehouse—it changes everything.\""
                ),
            ),
        ]
    elif any(k in combined for k in ("fantasy", "medieval", "sword", "magic", "bard", "d&d", "tavern")):
        style = ["measured cadence", "dry wit", "subtext-heavy", "grounded vernacular", "economical phrasing"]
        anchors = [
            VoiceAnchor(
                context="Calm / Conversational (Abercrombie style)",
                snippet=(
                    f"*{name} tests the edge of a pewter tankard with one calloused thumb, gaze lingering on the hearth.* "
                    f"\"You have to be realistic about these things. Heroes get statues, and sensible folk get tomorrow.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Under Pressure (Rothfuss style)",
                snippet=(
                    f"*{name}'s expression cools into still stone, posture coiling imperceptibly.* "
                    f"\"Step back. Words once spoken cannot be gathered back into the throat, and some names carry teeth.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent",
                snippet=(
                    f"*{name} lets out an uncharacteristically raw sigh, holding unbroken eye contact.* "
                    f"\"I swore I wouldn't go back to that ruin. But if they've taken the seal... God help us, I have to.\""
                ),
            ),
        ]
    elif any(k in combined for k in ("cyberpunk", "netrunner", "hacker", "cyborg", "neon", "spire", "high-tech")):
        style = ["clipped", "street techwear slang", "deadpan delivery", "no wasted words", "cynical undercurrent"]
        anchors = [
            VoiceAnchor(
                context="Calm / Conversational (Gibson style)",
                snippet=(
                    f"*{name} taps two fingers against the neural jack behind their ear, listening to the static fade.* "
                    f"\"The street finds its own uses for things. If your fix isn't dirty, you're paying twice what it's worth.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Under Pressure (Stephenson style)",
                snippet=(
                    f"*{name}'s optics track a passing surveillance drone before their gaze snaps back.* "
                    f"\"Burn that chip right now. You don't ping an ICE firewall like that without leaving a flare behind you.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent",
                snippet=(
                    f"*{name}'s synthetic knuckles clench with a quiet metallic chime.* "
                    f"\"They didn't just wipe the server. They scrubbed the backup node where Ren was running. I need to get back in.\""
                ),
            ),
        ]
    elif any(k in combined for k in ("western", "wasteland", "post-apocalyptic", "frontier", "desert", "fallout")):
        style = ["sparse drawl", "unflinching eye contact", "poetic bluntness", "low timber", "unhurried cadence"]
        anchors = [
            VoiceAnchor(
                context="Calm / Conversational (McCarthy style)",
                snippet=(
                    f"*{name} squats on the heels of their boots, sifting dry dust through weathered fingers.* "
                    f"\"Out here a man carries what he is and nothing more. What brought you across the dry creek?\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Under Pressure (Leonard style)",
                snippet=(
                    f"*{name}'s right hand rests casually two inches above their holster.* "
                    f"\"I told you once to keep your hands where the sun hits them. I don't generally make a habit of saying things twice.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent",
                snippet=(
                    f"*{name} looks out toward the blackened ridge, jaw clenching tight.* "
                    f"\"The well went dry three nights ago. If we don't clear that pass before sundown, nobody makes the winter.\""
                ),
            ),
        ]
    else:
        style = ["measured", "direct", "guarded", "deliberate cadence", "quiet authority"]
        anchors = [
            VoiceAnchor(
                context="Calm / Conversational (Le Guin style)",
                snippet=(
                    f"*{name} pauses, leaning back against the bulkhead with an unhurried, attentive gaze.* "
                    f"\"You don't cross half the quadrant just for pleasantries. Tell me what's actually on your mind.\""
                ),
            ),
            VoiceAnchor(
                context="Guarded / Under Pressure",
                snippet=(
                    f"*{name}'s posture stiffens almost imperceptibly, voice dropping into a quiet, cold register.* "
                    f"\"Careful. Those who push that hard on airlock seals usually don't like what they find on the other side.\""
                ),
            ),
            VoiceAnchor(
                context="Vulnerable / Urgent",
                snippet=(
                    f"*{name} exhales slowly, lowering their guard for a brief, candid breath.* "
                    f"\"Cards on the table—I've kept this quiet as long as I could. But I can't navigate this alone.\""
                ),
            ),
        ]

    return style, anchors


def _normalize_distinctive_features(
    raw_features: list[str],
    build_str: str,
    fallback_features: list[str],
) -> list[str]:
    """Ensure exactly 6 immutable anatomical features, including the build chip and strictly zero clothing/gear."""
    gear_pattern = re.compile(
        r"\b(attire|clothes|clothing|jacket|coat|duster|trenchcoat|tunic|breeches|boots|hat|cap|fedora|goggles|ring|pocket watch|watch|necklace|amulet|talisman|compass|canteen|holster|belt|gloves|apron)\b",
        re.IGNORECASE,
    )
    cleaned: list[str] = []
    for f in raw_features:
        trimmed = f.strip()
        if trimmed and not gear_pattern.search(trimmed):
            if trimmed not in cleaned:
                cleaned.append(trimmed)

    # Ensure build frame is present in features
    has_build = any(b in " ".join(cleaned).lower() for b in ("build", "frame", "stature", "musculature", "physique", "slender", "wiry", "athletic", "muscular"))
    if not has_build and build_str:
        cleaned.insert(0, build_str)

    # Backfill up to 6 from fallback_features
    for fb in fallback_features:
        if len(cleaned) >= 6:
            break
        if fb not in cleaned:
            cleaned.append(fb)

    return cleaned[:6]


def _fallback_character_expansion(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
) -> CharacterWizardDraft:
    """Seed-adaptive fallback builder with procedural demographics, aligned ethics, and genre-coherent gear."""
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

    demo = infer_demographics_and_anatomy(
        seed.name,
        seed.archetype,
        seed.rough_notes,
    )

    profile_data = resolve_genre_fallback_profile(
        world_genre,
        seed.archetype,
        seed.rough_notes,
    )

    default_equipped = profile_data["equipped"]
    default_inventory = profile_data["inventory"]
    distinctive_features = _normalize_distinctive_features(
        profile_data["distinctive_features"],
        demo["build"],
        profile_data["distinctive_features"],
    )
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

    core_persona = (
        f"{seed.name} is a {seed.archetype}{setting_note}, recognized as {seed.role_in_story}. "
        f"Their demeanor is defined by being {kw_str}. In conversation, {seed.name} avoids "
        f"melodrama, preferring grounded observations, physical micro-actions, and subtext-heavy "
        f"dialogue.{notes_suffix}"
    )

    moral_code, quirks_flaws = infer_moral_code_and_quirks(
        seed.archetype,
        seed.personality_keywords,
        seed.rough_notes,
        core_persona,
    )

    comm_style, voice_anchors = infer_dialogue_anchors_and_style(
        seed.name,
        seed.archetype,
        world_genre,
        seed.rough_notes,
    )

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
        raw_mood = "Calm & Composed"
    elif temp_arch in ("paranoiac", "proud_rival"):
        raw_mood = "Wary & Guarded"
    elif temp_arch == "confidant":
        raw_mood = "Warm & Receptive"
    elif temp_arch == "volatile":
        raw_mood = "Uneasy & On-Edge"
    else:
        raw_mood = "Wary & Guarded"

    mood_label, val, ar = normalize_starting_mood(raw_mood)

    return CharacterWizardDraft(
        name=seed.name,
        tagline=f"{seed.archetype} ({kw_str})",
        character_bio=seed.rough_notes.strip() if seed.rough_notes.strip() else f"{seed.name} is an active {seed.archetype}{setting_note}, recognized as {seed.role_in_story}.",
        physical_appearance=seed.rough_notes.strip() if seed.rough_notes.strip() else f"{seed.name} is an active {seed.archetype}{setting_note}, recognized as {seed.role_in_story}.",
        species=demo["species"],
        sex=demo["sex"],
        pronouns=demo["pronouns"],
        age=demo["age"],
        build_and_height=demo["build_and_height"],
        distinctive_features=distinctive_features,
        posture=demo["posture"],
        mannerisms=mannerisms,
        modifications=[],
        visual_aesthetic=visual_aesthetic,
        personality_traits=personality_traits,
        moral_code=moral_code,
        quirks_flaws=quirks_flaws,
        communication_style=comm_style,
        core_persona=core_persona,
        initial_message=(
            f"*Inside {loc_name},{loc_desc} {seed.name} pauses, scanning the entrance with a practiced, "
            f"unhurried gaze before noticing your arrival.*\n\n"
            f"\"You made it,\" *{seed.name} says quietly, gesturing toward a spot nearby.* "
            f"\"We don't have much time before attention catches up with us. Tell me what you found.\""
        ),
        equipped=default_equipped,
        inventory=default_inventory,
        voice_anchors=voice_anchors,
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
                title="Formative Incident: Escape from the Old Order",
                content=(
                    f"During their earlier years in {world.name if world else 'their home settlement'}, {seed.name} "
                    f"was caught defying local authorities while operating as a {seed.archetype}. "
                    "They were forced to flee overnight, abandoning their possessions and learning never to place blind trust in any institution."
                ),
                keywords=[seed.name.lower(), "past", "origin", "escape"],
                emotional_weight=0.85,
            ),
            MemoryShard(
                title="The Broken Contract",
                content=(
                    f"{seed.name} took on a high-stakes contract with a partner who betrayed them for a purse of coin. "
                    "They barely escaped the ambush, and the experience left them permanently cynical and vigilant about hidden motives."
                ),
                keywords=["contract", "betrayal", "ambush", "cynicism"],
                emotional_weight=0.8,
            ),
            MemoryShard(
                title="The Heist at Highwall",
                content=(
                    f"{seed.name} broke into a heavily guarded vault to recover critical documents. "
                    "When the alarm sounded, they had to scale the outer parapet under crossbow fire to evade the garrison."
                ),
                keywords=["vault", "heist", "alarm", "evasion"],
                emotional_weight=0.75,
            ),
        ],
        tags=[slugify_tag(kw) for kw in seed.personality_keywords if kw.strip()],
        creator="",
        creator_notes=seed.rough_notes.strip() if seed.rough_notes else "",
    )
