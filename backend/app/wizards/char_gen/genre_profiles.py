"""Multi-genre character fallback profiles and sanitization helpers."""

from __future__ import annotations

import re

from typing import Any

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
