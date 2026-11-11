"""1.1 Character Creation Wizard: Expands basic user seeds into an agentic roleplay character."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.config import ModelProfile, settings
from app.engine.llm_client import llm_client
from app.prompts import get_default_prompt, render_template
from app.schemas.affective import infer_temperament_and_worldview_from_text
from app.schemas.character import (
    BASELINE_MOOD_PRESETS,
    BaselinePsyche,
    CharacterWizardDraft,
    CharacterWizardLLMOutput,
    CharacterWizardPass1LLMOutput,
    CharacterWizardPass2LLMOutput,
    CharacterWizardPass3LLMOutput,
    CharacterWizardSeed,
    ItemInstance,
    MemoryShard,
    VoiceAnchor,
    coerce_item_list,
    normalize_bullet_plan,
    normalize_starting_mood,
    sanitize_character_markup,
)
from app.schemas.world import WorldRecord
from app.db.repository import slugify_tag

logger = logging.getLogger(__name__)


def _sanitize_height_only(raw_val: str, fallback_height: str) -> str:
    """Extract only linear height (preferring metric cm), stripping build/frame descriptors."""
    clean = (raw_val or "").strip()
    if not clean:
        return fallback_height
    cm_match = re.search(r"(\d{2,3}(?:\.\d+)?)\s*cm\b", clean, re.IGNORECASE)
    if cm_match:
        return f"{round(float(cm_match.group(1)))} cm"
    m_match = re.search(r"\b(\d)\.(\d{2})\s*m\b", clean, re.IGNORECASE)
    if m_match:
        return f"{int(m_match.group(1)) * 100 + int(m_match.group(2))} cm"
    ft_match = re.search(r"\b(\d)\s*['’]\s*(\d{1,2})\s*(?:\"|”|in)?", clean)
    if ft_match:
        inches = int(ft_match.group(1)) * 12 + int(ft_match.group(2))
        return f"{round(inches * 2.54)} cm"
    head = re.split(r"[,;—–-]", clean)[0].strip()
    if any(ch.isdigit() for ch in head):
        return head
    return fallback_height


def _clean_mannerism(raw_text: str) -> str:
    """Strip redundant slot category labels such as 'idle tell: ' or 'when under pressure: '."""
    cleaned = re.sub(
        r"^(?:when\s+(?:under\s+pressure|guarded|idle|stressed)|under\s+pressure|guarded\s+tell|idle\s+tell|stress\s+tell|speech\s+cadence(?:\s+tic)?|conversational\s+tell)\s*[:\-]\s*",
        "",
        (raw_text or "").strip(),
        flags=re.IGNORECASE,
    ).strip()
    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


def _split_compound_items(items: list[str]) -> list[str]:
    """Split compound item strings like 'Cloak and linen tunic' into single discrete items."""
    result: list[str] = []
    compound_regex = re.compile(r"^(.*?)\s+(?:and|&)\s+(.*)$", re.IGNORECASE)
    color_adjectives = {
        "black", "white", "red", "blue", "green", "grey", "gray",
        "worn", "torn", "old", "new", "gold", "silver", "dark", "light"
    }
    for it in items:
        cleaned = it.strip()
        if not cleaned:
            continue
        match = compound_regex.match(cleaned)
        if match:
            left, right = match.group(1).strip(), match.group(2).strip()
            if (
                len(left) >= 4
                and len(right) >= 4
                and left.lower() not in color_adjectives
                and right.lower() not in color_adjectives
            ):
                result.append(left)
                result.append(right.capitalize() if right and right[0].islower() else right)
                continue
        result.append(cleaned)
    return result


GENRE_PROFILES = [
    {
        "id": "fantasy",
        "keywords": [
            "fantasy", "medieval", "sword", "magic", "sorcer", "wizard", "elf", "dwarf",
            "d&d", "tavern", "castle", "bard", "paladin", "rogue", "dragon", "cleric",
            "warlock", "ranger", "enchant", "kingdom", "realm", "dungeon", "crusade"
        ],
        "equipped": lambda arch: [
            f"Tailored traveling cloak suited for a {arch}",
            f"Linen traveling tunic suited for a {arch}",
            "Reinforced leather breeches",
            "Sturdy brass-buckled belt",
            "High-cuff weathered riding boots",
        ],
        "inventory": lambda note: [
            "Embroidered coin pouch with local minted silver",
            f"Signature keepsake ({note[:42].rstrip('.')})" if note else "Weathered traveler's journal and charcoal quill",
        ],
        "features": [
            "Sun-weathered skin with faint laugh lines around the eyes",
            "Keen, observant gaze with weathered crow's feet",
            "Thick dark hair cropped roughly at the nape",
            "Faint dueling scar along the left jawline",
            "Calloused swordsman's palms and knuckles",
            "Quirky heterochromia with one hazel eye and one pale silver-flecked iris",
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
            f"Pressurized thermal flight jacket suited for a {arch}",
            "Sealed utility jumpsuit",
            "Magnetic-clamp utility harness",
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
            "Faint chemical burn mark across right collarbone",
            "Lean, conditioned zero-g musculature with quiet footfalls",
            "Quirky geometric pilot's tattoo spanning the back of the left hand",
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
            f"Reinforced weatherproof utility jacket suited for a {arch}",
            "Dark synthetic fiber undershirt",
            "Dark cargo trousers with concealed equipment pockets",
            "Quick-release nylon utility belt",
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
            "Quirky synthetic biometric tattoo that subtly shifts hue with pulse rate",
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
            "Dark pressed waistcoat and collared shirt",
            "Sturdy charcoal woolen trousers",
            "Treaded leather boots stained with damp earth",
        ],
        "inventory": lambda note: [
            "Tarnished silver talisman engraved with warding sigils",
            f"Occult dossier ({note[:42].rstrip('.')})" if note else "Leatherbound pocket ledger with cryptic handwritten notes and wax matches",
        ],
        "features": [
            "Hollow, sleep-deprived eyes carrying a haunted wariness",
            "Prematurely silvered streaks through dark hair",
            "Slight involuntary tremor in left hand when startled",
            "Faint claw or ritual scar concealed beneath the collar",
            "Ashen, gaunt cheekbones and sunken temple contours",
            "Quirky crescent-shaped birthmark high on the left temple",
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
            "Faded denim work shirt",
            "Reinforced riding pants",
            "Tooled leather gunbelt with brass buckle",
            "Spurred leather boots with worn riding heels",
        ],
        "inventory": lambda note: [
            "Scratched tin canteen of water and pouch of dried jerky",
            f"Pocket heirloom ({note[:42].rstrip('.')})" if note else "Brass pocket compass with a dented lid",
        ],
        "features": [
            "Sun-weathered skin with deep squint lines from the frontier glare",
            "Steely, unblinking grey eyes beneath a heavy brow",
            "Coarse stubble along a square jaw",
            "Faint powder burn mark on trigger finger",
            "Wiry, sun-hardened frame with corded forearm tendons",
            "Quirky notched left earlobe from a near-miss bullet graze",
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
            f"Layered scavenger coat with reinforced shoulders suited for a {arch}",
            "Heavy canvas work shirt",
            "Stitched cargo pants with knee guards",
            "Modular webbed utility belt",
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
            "Knotted, scarred knuckles from hand-to-hand survival",
            "Quirky mismatched tooth: an implanted jagged titanium bicuspid",
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
            f"Heavy wool trenchcoat suited for a {arch}",
            "Dark collared dress shirt with loosened silk tie",
            "Pressed charcoal wool slacks",
            "Concealed shoulder holster",
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
            "Heavy-set shoulders showing the wear of long stakeouts",
            "Calloused fingertips stained with tobacco or ink",
            "Quirky crooked bridge on a twice-broken boxer's nose",
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
            "Form-fitting moisture-wicking undershirt",
            "Fitted tactical cargo pants",
            "Rigid nylon utility belt",
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
            "Tightly conditioned athletic frame with silent, balanced footwork",
            "Quirky pale scar tracing an angle across the left eyebrow",
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
            f"Leather-trimmed tweed coat suited for a {arch}",
            "Heavy linen shirt with brass studs",
            "High-waisted trousers with reinforced tool loops",
            "Brass-buckled mechanic's tool harness",
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
            "Faint circular pressure mark around eye orbits from loupe lenses",
            "Lean, kinetic frame with quick, dexterous fingers",
            "Quirky brass prosthetic finger joint on right index finger",
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
            f"Weather-beaten broadcloth captain's coat suited for a {arch}",
            "Loose linen deck shirt",
            "Tough sailcloth breeches",
            "Wide leather baldric with brass buckle",
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
            "Broad chest and calloused, weather-hardened palms",
            "Quirky faded kraken tattoo wrapping around left forearm",
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
            f"Traditional woven tunic or mantle suited for a {arch}",
            "Pleated linen undertunic",
            "Fastened leather leg wraps",
            "Studded leather girdle with bronze clasp",
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
            "Disciplined, corded muscle with zero wasted body fat",
            "Quirky ritual brand mark etched onto the inner right forearm",
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
            f"Reinforced ballistic weave outer jacket suited for a {arch}",
            "Flexible compression undersuit",
            "Reinforced tactical trousers with hidden padding",
            "Utility belt with discrete sealed pouches",
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
            "Faint lightning-pattern electrical burn scar across left shoulder",
            "Dense, hyper-conditioned muscle fiber across back and shoulders",
            "Quirky heterochromia with one eye glowing faintly under low light",
        ],
        "visual_aesthetic": "Reinforced impact-resistant textiles with personalized insignia or cowl",
    },
    {
        "id": "universal",
        "keywords": [],
        "equipped": lambda arch: [
            f"Durable all-weather travel coat suited for a {arch}",
            "Sturdy collared utility shirt",
            "Reinforced travel trousers",
            "Heavy leather belt with brass buckle",
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
            "Quirky subtle amber fleck in the left iris",
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
                title=f"Formative Incident: Escape from the Old Order",
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


async def generate_character_draft(
    seed: CharacterWizardSeed,
    world: WorldRecord | None = None,
    profile: ModelProfile | None = None,
    prompt_template: str | None = None,
) -> CharacterWizardDraft:
    """Use a 3-Pass Pipelined LLM generation to expand a CharacterWizardSeed into a rich, coherent draft."""
    world_context = ""
    start_loc = None
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

    loc_name = start_loc.name if start_loc else "the starting district"
    loc_desc = (
        f" {start_loc.summary}"
        if start_loc
        else " Shadows stretch across the room as ambient noise hums in the background."
    )

    fallback = _fallback_character_expansion(seed, world)
    actor_prof = profile or settings.actor_profile

    # If user provided a custom prompt_template, run single-pass legacy path
    if prompt_template:
        system_prompt = render_template(prompt_template)
        user_prompt = (
            f"Name: {seed.name}\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )
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
            # Heal single pass omissions
            demo = infer_demographics_and_anatomy(draft.name, seed.archetype, seed.rough_notes, draft.species or "Human")
            if not draft.species:
                draft.species = fallback.species
            draft.sex = draft.sex or demo["sex"]
            draft.pronouns = draft.pronouns or demo["pronouns"]
            draft.age = draft.age or demo["age"]
            draft.build_and_height = _sanitize_height_only(draft.build_and_height, demo["height"])
            draft.posture = draft.posture or demo["posture"]
            if not draft.distinctive_features or len(draft.distinctive_features) < 6:
                draft.distinctive_features = _normalize_distinctive_features(
                    draft.distinctive_features,
                    demo["build"],
                    fallback.distinctive_features,
                )
            if not draft.character_bio:
                world_note = f" in {world.name}" if world else ""
                notes_part = f" {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
                draft.character_bio = f"{draft.name} is an active {seed.archetype}{world_note}, operating as {seed.role_in_story}.{notes_part}".strip()
            if not draft.physical_appearance:
                draft.physical_appearance = f"{draft.name} has an {demo['build']}, standing at {draft.build_and_height}, featuring {', '.join(draft.distinctive_features[:3])}."
            if not draft.mannerisms:
                draft.mannerisms = fallback.mannerisms
            else:
                draft.mannerisms = [_clean_mannerism(m) for m in draft.mannerisms if _clean_mannerism(m)] or fallback.mannerisms
            if not draft.visual_aesthetic:
                draft.visual_aesthetic = fallback.visual_aesthetic
            if not draft.personality_traits:
                draft.personality_traits = fallback.personality_traits
            if not draft.moral_code:
                aligned_m, aligned_q = infer_moral_code_and_quirks(seed.archetype, seed.personality_keywords, seed.rough_notes, draft.core_persona)
                draft.moral_code = aligned_m
                draft.quirks_flaws = draft.quirks_flaws or aligned_q
            if not draft.communication_style or not draft.voice_anchors:
                c_style, v_anchors = infer_dialogue_anchors_and_style(draft.name, seed.archetype, world.global_rules.genre if world else "", seed.rough_notes)
                draft.communication_style = draft.communication_style or c_style
                draft.voice_anchors = draft.voice_anchors or v_anchors
            if not draft.equipped and not draft.inventory:
                draft.equipped = fallback.equipped
                draft.inventory = fallback.inventory
            if not draft.initial_message:
                draft.initial_message = fallback.initial_message
            draft.baseline_psyche.default_plan = (
                normalize_bullet_plan(draft.baseline_psyche.default_plan)
                or fallback.baseline_psyche.default_plan
            )
            # Snap mood
            m_label, m_val, m_ar = normalize_starting_mood(
                draft.baseline_psyche.mood_label,
                draft.baseline_psyche.valence,
                draft.baseline_psyche.arousal,
            )
            draft.baseline_psyche.mood_label = m_label
            draft.baseline_psyche.valence = m_val
            draft.baseline_psyche.arousal = m_ar
            return draft
        except Exception:
            if not settings.allow_offline_fallback:
                raise
            return fallback

    # --- 3-PASS PIPELINED GENERATION ---
    try:
        # PASS 1: Identity, Demographics, Height, Anatomy, and Gear
        pass1_system = render_template(get_default_prompt("wizard_character_pass1_system"))
        pass1_user = (
            f"Name: {seed.name}\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )

        p1_out: CharacterWizardPass1LLMOutput = await llm_client.complete_structured(
            [
                {"role": "system", "content": pass1_system},
                {"role": "user", "content": pass1_user},
            ],
            CharacterWizardPass1LLMOutput,
            profile=actor_prof,
            max_tokens=2048,
            required_properties=list(CharacterWizardPass1LLMOutput.model_fields.keys()),
        )

        # Heal Pass 1 output using procedural demographics and anatomy
        demo = infer_demographics_and_anatomy(
            p1_out.name or seed.name,
            seed.archetype,
            seed.rough_notes,
            p1_out.species or "Human",
        )
        name = sanitize_character_markup(p1_out.name or seed.name, single_line=True) or fallback.name
        tagline = sanitize_character_markup(p1_out.tagline or "", single_line=True) or fallback.tagline
        species = sanitize_character_markup(p1_out.species or "", single_line=True) or demo["species"]
        sex = sanitize_character_markup(p1_out.sex or "", single_line=True) or demo["sex"]
        pronouns = sanitize_character_markup(p1_out.pronouns or "", single_line=True) or demo["pronouns"]
        age = sanitize_character_markup(p1_out.age or "", single_line=True) or demo["age"]

        raw_height_field = sanitize_character_markup(p1_out.build_and_height or "", single_line=True)
        build_and_height = _sanitize_height_only(raw_height_field, demo["height"])
        # Preserve any trailing build descriptor if the LLM put one in build_and_height
        build_hint = demo["build"]
        if "," in raw_height_field:
            trailing_build = raw_height_field.split(",", 1)[1].strip()
            if trailing_build:
                build_hint = trailing_build

        posture = sanitize_character_markup(p1_out.posture or "", single_line=True) or demo["posture"]
        visual_aesthetic = sanitize_character_markup(p1_out.visual_aesthetic or "", single_line=True) or fallback.visual_aesthetic

        raw_features = [
            s
            for s in (sanitize_character_markup(f, single_line=True) for f in p1_out.distinctive_features)
            if s
        ]
        features = _normalize_distinctive_features(raw_features, build_hint, fallback.distinctive_features)

        character_bio = sanitize_character_markup(p1_out.character_bio or "")
        if not character_bio:
            world_note = f" within {world.name}" if world else ""
            notes_part = f" {seed.rough_notes.strip()}" if seed.rough_notes.strip() else ""
            character_bio = f"{name} is an active {seed.archetype}{world_note}, operating as {seed.role_in_story}.{notes_part}".strip() or fallback.character_bio

        physical_appearance = sanitize_character_markup(p1_out.physical_appearance or "")
        if not physical_appearance:
            physical_appearance = f"{name} has an {build_hint}, standing at {build_and_height}, featuring {', '.join(features[:3])}."

        mannerisms = [
            _clean_mannerism(sanitize_character_markup(m, single_line=True))
            for m in p1_out.mannerisms
            if _clean_mannerism(sanitize_character_markup(m, single_line=True))
        ] or list(fallback.mannerisms)
        if len(mannerisms) < 4:
            for m in fallback.mannerisms:
                if len(mannerisms) >= 4:
                    break
                if m not in mannerisms:
                    mannerisms.append(m)

        raw_equipped = _split_compound_items(
            [
                s
                for s in (sanitize_character_markup(it, single_line=True) for it in p1_out.equipped)
                if s
            ]
            or [str(it) for it in fallback.equipped]
        )
        raw_inventory = _split_compound_items(
            [
                s
                for s in (sanitize_character_markup(it, single_line=True) for it in p1_out.inventory)
                if s
            ]
            or [str(it) for it in fallback.inventory]
        )

        # PASS 2: Psychology, Demeanor, Aligned Ethics, Voice Anchors, Plan, and Shards
        pass2_system = render_template(get_default_prompt("wizard_character_pass2_system"))
        pass2_user = (
            f"=== ESTABLISHED PASS 1 IDENTITY & PHYSICALITY ===\n"
            f"Name: {name}\n"
            f"Tagline: {tagline}\n"
            f"Demographics: {species}, {sex} ({pronouns}), Age: {age}, Height: {build_and_height}\n"
            f"Resting Posture: {posture}\n"
            f"Distinctive Physical Features: {', '.join(features)}\n"
            f"Mannerisms / Tells: {'; '.join(mannerisms)}\n"
            f"Visual Aesthetic: {visual_aesthetic}\n"
            f"Starting Gear: Equipped: {', '.join(raw_equipped)} | Inventory: {', '.join(raw_inventory)}\n"
            f"Character Bio / Concept: {character_bio}\n\n"
            f"=== ORIGINAL USER SEED & CONTEXT ===\n"
            f"Archetype / Concept: {seed.archetype}\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Personality Keywords: {', '.join(seed.personality_keywords)}\n"
            f"Rough Notes: {seed.rough_notes}\n"
            f"{world_context}"
        )

        p2_out: CharacterWizardPass2LLMOutput = await llm_client.complete_structured(
            [
                {"role": "system", "content": pass2_system},
                {"role": "user", "content": pass2_user},
            ],
            CharacterWizardPass2LLMOutput,
            profile=actor_prof,
            max_tokens=2560,
            required_properties=list(CharacterWizardPass2LLMOutput.model_fields.keys()),
        )

        personality_traits = [
            s
            for s in (sanitize_character_markup(t, single_line=True) for t in p2_out.personality_traits)
            if s
        ] or fallback.personality_traits
        core_persona = sanitize_character_markup(p2_out.core_persona or "") or fallback.core_persona

        aligned_moral, aligned_quirks = infer_moral_code_and_quirks(
            seed.archetype,
            seed.personality_keywords,
            seed.rough_notes,
            core_persona,
        )
        moral_code = [
            s
            for s in (sanitize_character_markup(m, single_line=True) for m in p2_out.moral_code)
            if s
        ] or aligned_moral
        quirks_flaws = [
            s
            for s in (sanitize_character_markup(q, single_line=True) for q in p2_out.quirks_flaws)
            if s
        ] or aligned_quirks

        genre_text = (world.global_rules.genre if (world and world.global_rules) else "")
        style_fallback, anchors_fallback = infer_dialogue_anchors_and_style(name, seed.archetype, genre_text, seed.rough_notes)
        communication_style = [
            s
            for s in (sanitize_character_markup(c, single_line=True) for c in p2_out.communication_style)
            if s
        ] or style_fallback
        voice_anchors = p2_out.voice_anchors or anchors_fallback
        for va in voice_anchors:
            va.context = sanitize_character_markup(va.context, single_line=True)
            va.snippet = sanitize_character_markup(va.snippet, preserve_italics=True)

        core_drive = sanitize_character_markup(p2_out.core_drive or "", single_line=True) or fallback.baseline_psyche.core_drive
        core_fear = sanitize_character_markup(p2_out.core_fear or "", single_line=True) or fallback.baseline_psyche.core_fear
        default_want = sanitize_character_markup(p2_out.default_want or "", single_line=True) or fallback.baseline_psyche.default_want
        default_plan = normalize_bullet_plan(
            [sanitize_character_markup(s) for s in p2_out.default_plan]
        ) or fallback.baseline_psyche.default_plan

        memory_shards = p2_out.memory_shards or fallback.memory_shards
        for ms in memory_shards:
            ms.title = sanitize_character_markup(ms.title, single_line=True)
            ms.content = sanitize_character_markup(ms.content)

        mood_label, val, ar = normalize_starting_mood(p2_out.starting_mood)

        inferred_temp, inferred_wv = infer_temperament_and_worldview_from_text(
            character_bio,
            core_persona,
            " ".join(seed.personality_keywords),
            seed.rough_notes,
        )

        # PASS 3: Dedicated 3-Beat Turn 0 Opening Scene & Intent-Driven Greeting
        pass3_system = render_template(get_default_prompt("wizard_character_pass3_system"))
        anchors_summary = "\n".join(
            f"- [{va.context}]: {va.snippet}" for va in voice_anchors[:2]
        )
        memories_summary = "\n".join(
            f"- {ms.title}: {ms.content}" for ms in memory_shards[:3]
        )
        pass3_user = (
            f"=== CHARACTER SITUATION, BIO & INTENT ===\n"
            f"Name: {name} ({tagline})\n"
            f"Role in Story: {seed.role_in_story}\n"
            f"Creator Notes / Current Predicament: {seed.rough_notes.strip() or 'None specified'}\n"
            f"Character Bio: {character_bio}\n"
            f"Core Drive: {core_drive}\n"
            f"Immediate Want: {default_want}\n"
            f"Immediate Tactical Plan:\n{default_plan}\n"
            f"Recent Backstory Context:\n{memories_summary}\n\n"
            f"=== APPEARANCE, VOICE & GEAR ===\n"
            f"Demographics: {species}, {sex} ({pronouns}), Age: {age}, Height: {build_and_height}\n"
            f"Distinctive Features: {', '.join(features)}\n"
            f"Resting Posture: {posture}\n"
            f"Mannerisms / Tells: {'; '.join(mannerisms)}\n"
            f"Equipped Attire & Gear: {', '.join(raw_equipped)}\n"
            f"Carried Inventory: {', '.join(raw_inventory)}\n"
            f"Persona & Defense Mechanisms: {core_persona}\n"
            f"Communication Style: {', '.join(communication_style)}\n"
            f"Active Starting Mood: {mood_label}\n"
            f"Voice Anchors:\n{anchors_summary}\n\n"
            f"=== STARTING LOCATION ===\n"
            f"Location: {loc_name}\n"
            f"Atmosphere & Sensory Details: {loc_desc}\n\n"
            f"Compose the 3-beat Turn 0 opening scene:\n"
            f"1. *Environment & Stakes* grounded in why {name} is here right now.\n"
            f"2. *Quick Character Overview* (key visual details, posture/state, and a tell).\n"
            f"3. \"First spoken line driven by their current predicament and immediate intent.\""
        )

        try:
            p3_out: CharacterWizardPass3LLMOutput = await llm_client.complete_structured(
                [
                    {"role": "system", "content": pass3_system},
                    {"role": "user", "content": pass3_user},
                ],
                CharacterWizardPass3LLMOutput,
                profile=actor_prof,
                max_tokens=1024,
                required_properties=["initial_message"],
            )
            initial_message = (p3_out.initial_message or "").strip()
        except Exception as p3_exc:
            logger.warning("Pass 3 scene generation failed (%s); falling back to location-aware template.", p3_exc)
            initial_message = ""

        if not initial_message:
            initial_message = fallback.initial_message

        draft = CharacterWizardDraft(
            name=name,
            tagline=tagline,
            character_bio=character_bio,
            physical_appearance=physical_appearance,
            species=species,
            sex=sex,
            pronouns=pronouns,
            age=age,
            build_and_height=build_and_height,
            distinctive_features=features,
            posture=posture,
            mannerisms=mannerisms,
            modifications=[],
            visual_aesthetic=visual_aesthetic,
            personality_traits=personality_traits,
            core_persona=core_persona,
            moral_code=moral_code,
            quirks_flaws=quirks_flaws,
            communication_style=communication_style,
            initial_message=initial_message,
            equipped=coerce_item_list(raw_equipped),
            inventory=coerce_item_list(raw_inventory),
            voice_anchors=voice_anchors,
            baseline_psyche=BaselinePsyche(
                mood_label=mood_label,
                valence=val,
                arousal=ar,
                core_drive=core_drive,
                core_fear=core_fear,
                default_want=default_want,
                default_plan=default_plan,
                initial_worldview=inferred_wv,
                temperament=inferred_temp,
            ),
            memory_shards=memory_shards,
            tags=[slugify_tag(kw) for kw in seed.personality_keywords if kw.strip()] or fallback.tags,
            creator="",
            creator_notes=seed.rough_notes.strip() if seed.rough_notes else "",
            portraits={},
            gallery=[],
        )
        return draft
    except Exception:
        if not settings.allow_offline_fallback:
            raise
        return fallback
