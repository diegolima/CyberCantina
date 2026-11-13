import { ItemInstance, normalizeItemInstance } from "../../types";

export interface GenreFallbackProfile {
  id: string;
  keywords: string[];
  equipped: (arch: string) => ItemInstance[];
  inventory: (note: string) => ItemInstance[];
  features: string[];
  visualAesthetic: string;
}

export const GENRE_FALLBACK_PROFILES: GenreFallbackProfile[] = [
  {
    id: "fantasy",
    keywords: [
      "fantasy", "high fantasy", "dark fantasy", "medieval", "magic", "sword", "d&d",
      "elven", "elf", "dwarf", "tavern", "bard", "sorcerer", "wizard", "druid",
      "dungeon", "dragon", "paladin", "cleric", "kingdom", "realm"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Tailored traveling cloak suited for a ${arch}`),
      normalizeItemInstance(`Linen traveling tunic suited for a ${arch}`),
      normalizeItemInstance("Reinforced leather breeches"),
      normalizeItemInstance("Sturdy brass-buckled belt"),
      normalizeItemInstance("High-cuff weathered riding boots"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Embroidered coin pouch with local minted silver"),
      normalizeItemInstance(note ? `Signature keepsake (${note.slice(0, 42).replace(/\.+$/, "")})` : "Weathered traveler's journal and charcoal quill"),
    ],
    features: [
      "Sun-weathered skin with faint laugh lines around the eyes",
      "Keen, observant gaze with weathered crow's feet",
      "Thick dark hair cropped roughly at the nape",
      "Faint dueling scar along the left jawline",
      "Calloused swordsman's palms and knuckles",
      "Quirky heterochromia with one hazel eye and one pale silver-flecked iris",
    ],
    visualAesthetic: "Practical layered leather, linen, and travel-worn wool",
  },
  {
    id: "scifi_space",
    keywords: [
      "space", "starship", "sci-fi", "scifi", "galactic", "orbit", "planetary",
      "station", "pilot", "astro", "alien", "vacuum", "federation", "colony",
      "warp", "freighter", "cosmos", "zero-g", "stardrive"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Pressurized thermal flight jacket suited for a ${arch}`),
      normalizeItemInstance("Sealed utility jumpsuit"),
      normalizeItemInstance("Magnetic-clamp utility harness"),
      normalizeItemInstance("Reinforced deck boots with magnetic grip soles"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Compact handheld spectrum scanner"),
      normalizeItemInstance(note ? `Encrypted data-chit (${note.slice(0, 42).replace(/\.+$/, "")})` : "Digital flight manifest and auxiliary power cell"),
    ],
    features: [
      "Slight pallor from extended cycles under artificial ship lighting",
      "Sharp, calculating gaze practiced at monitoring telemetry",
      "Close-trimmed hair designed for helmet seals",
      "Faint chemical burn mark across right collarbone",
      "Lean, conditioned zero-g musculature with quiet footfalls",
      "Quirky geometric pilot's tattoo spanning the back of the left hand",
    ],
    visualAesthetic: "Sealed utilitarian flightwear with thermal insulation and magnetic fasteners",
  },
  {
    id: "cyberpunk",
    keywords: [
      "cyberpunk", "netrunner", "cyborg", "neural", "megacorp", "spire", "neon",
      "hacker", "augment", "street samurai", "eddie", "subdermal", "braindance",
      "chrome", "deck", "corpo", "fixer", "slum"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Reinforced weatherproof utility jacket suited for a ${arch}`),
      normalizeItemInstance("Dark synthetic fiber undershirt"),
      normalizeItemInstance("Dark cargo trousers with concealed equipment pockets"),
      normalizeItemInstance("Quick-release nylon utility belt"),
      normalizeItemInstance("Scuffed composite work boots"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Encrypted personal comm-link"),
      normalizeItemInstance(note ? `Signature gear (${note.slice(0, 42).replace(/\.+$/, "")})` : "Multi-channel pocket diagnostic tool and patch cables"),
    ],
    features: [
      "Subdermal neural port or port cover behind left ear",
      "Piercing, alert eyes with faint reflective sheen",
      "Cropped dark hair styled for utility",
      "Faint electrical burn scar across right knuckles",
      "Lean, wiry athletic frame",
      "Quirky synthetic biometric tattoo that subtly shifts hue with pulse rate",
    ],
    visualAesthetic: "Weathered high-tech streetwear with moisture-sealed cabling channels",
  },
  {
    id: "horror_gothic",
    keywords: [
      "horror", "gothic", "eldritch", "occult", "lovecraft", "supernatural", "curse",
      "haunt", "investigator", "asylum", "coven", "vampire", "werewolf", "dread",
      "tomb", "manor", "crypt", "sanity", "shadow over"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Heavy charcoal wool greatcoat with high upturned collar suited for a ${arch}`),
      normalizeItemInstance("Dark pressed waistcoat and collared shirt"),
      normalizeItemInstance("Sturdy charcoal woolen trousers"),
      normalizeItemInstance("Treaded leather boots stained with damp earth"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Tarnished silver talisman engraved with warding sigils"),
      normalizeItemInstance(note ? `Occult dossier (${note.slice(0, 42).replace(/\.+$/, "")})` : "Leatherbound pocket ledger with cryptic handwritten notes and wax matches"),
    ],
    features: [
      "Hollow, sleep-deprived eyes carrying a haunted wariness",
      "Prematurely silvered streaks through dark hair",
      "Slight involuntary tremor in left hand when startled",
      "Faint claw or ritual scar concealed beneath the collar",
      "Ashen, gaunt cheekbones and sunken temple contours",
      "Quirky crescent-shaped birthmark high on the left temple",
    ],
    visualAesthetic: "Dark Victorian tailoring and heavy layered wool with weathered hemlines",
  },
  {
    id: "western",
    keywords: [
      "western", "cowboy", "gunslinger", "frontier", "outlaw", "sheriff", "saloon",
      "steed", "desert", "bounty", "revolver", "wasteland west", "ranch", "posse",
      "badlands", "wild west"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Dust-caked canvas duster coat suited for a ${arch}`),
      normalizeItemInstance("Faded denim work shirt"),
      normalizeItemInstance("Reinforced riding pants"),
      normalizeItemInstance("Tooled leather gunbelt with brass buckle"),
      normalizeItemInstance("Spurred leather boots with worn riding heels"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Scratched tin canteen of water and pouch of dried jerky"),
      normalizeItemInstance(note ? `Pocket heirloom (${note.slice(0, 42).replace(/\.+$/, "")})` : "Brass pocket compass with a dented lid"),
    ],
    features: [
      "Sun-weathered skin with deep squint lines from the frontier glare",
      "Steely, unblinking grey eyes beneath a heavy brow",
      "Coarse stubble along a square jaw",
      "Faint powder burn mark on trigger finger",
      "Wiry, sun-hardened frame with corded forearm tendons",
      "Quirky notched left earlobe from a near-miss bullet graze",
    ],
    visualAesthetic: "Weather-beaten canvas, denim, and sun-cured leather with brass hardware",
  },
  {
    id: "post_apocalyptic",
    keywords: [
      "post-apocalyptic", "apocalypse", "apocalyptic", "wasteland", "fallout",
      "scavenger", "ruin", "radiation", "mutant", "scrap", "survivalist", "collapse",
      "bunker", "doomsday", "nuclear"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Layered scavenger coat with reinforced shoulders suited for a ${arch}`),
      normalizeItemInstance("Heavy canvas work shirt"),
      normalizeItemInstance("Stitched cargo pants with knee guards"),
      normalizeItemInstance("Modular webbed utility belt"),
      normalizeItemInstance("Reinforced combat boots bound with wire and duct tape"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Analog radiation dosimeter or Geiger needle badge"),
      normalizeItemInstance(note ? `Salvaged artifact (${note.slice(0, 42).replace(/\.+$/, "")})` : "Canteen with charcoal filter and roll of reinforced adhesive tape"),
    ],
    features: [
      "Respirator strap indentations along cheekbones and bridge of nose",
      "Alert, hungry eyes trained on perimeter movement",
      "Patchy hair cut short with a combat knife",
      "Mottled chemical burn scar along forearm",
      "Knotted, scarred knuckles from hand-to-hand survival",
      "Quirky mismatched tooth: an implanted jagged titanium bicuspid",
    ],
    visualAesthetic: "Scavenged protective layers, reinforced patches, and modular gear webbing",
  },
  {
    id: "noir_detective",
    keywords: [
      "noir", "detective", "hardboiled", "gumshoe", "1920", "1930", "1940", "1950",
      "mobster", "gangster", "speakeasy", "private eye", "syndicate crime", "corrupt city"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Heavy wool trenchcoat suited for a ${arch}`),
      normalizeItemInstance("Dark collared dress shirt with loosened silk tie"),
      normalizeItemInstance("Pressed charcoal wool slacks"),
      normalizeItemInstance("Concealed shoulder holster"),
      normalizeItemInstance("Polished leather brogues showing street wear"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Brass pocket lighter and half-empty cigarette case"),
      normalizeItemInstance(note ? `Notepad dossier (${note.slice(0, 42).replace(/\.+$/, "")})` : "Moleskine notebook and fountain pen"),
    ],
    features: [
      "Shadowed, watchful eyes beneath a lowered brow",
      "Slicked-back dark hair silvering at the temples",
      "Faint razor nick near the collar",
      "Heavy-set shoulders showing the wear of long stakeouts",
      "Calloused fingertips stained with tobacco or ink",
      "Quirky crooked bridge on a twice-broken boxer's nose",
    ],
    visualAesthetic: "Classic mid-century monochrome tailoring, trenchcoat, and felt fedora",
  },
  {
    id: "modern_espionage",
    keywords: [
      "modern", "espionage", "agent", "thriller", "contemporary", "heist",
      "tactical", "conspiracy", "covert", "cia", "fbi", "interpol", "operator", "hitman"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Weather-resistant dark softshell jacket suited for a ${arch}`),
      normalizeItemInstance("Form-fitting moisture-wicking undershirt"),
      normalizeItemInstance("Fitted tactical cargo pants"),
      normalizeItemInstance("Rigid nylon utility belt"),
      normalizeItemInstance("Low-profile trail running shoes with grip soles"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Burner smartphone with encrypted offline maps"),
      normalizeItemInstance(note ? `Tactical dossier (${note.slice(0, 42).replace(/\.+$/, "")})` : "Compact multi-tool and small tactical penlight"),
    ],
    features: [
      "Clean-cut, forgettably generic appearance designed to blend into crowds",
      "Sharp, scanning eyes that instinctively track exits and CCTV domes",
      "Neatly groomed hair with zero identifying fashion statements",
      "Faint surgical scar behind the hairline",
      "Tightly conditioned athletic frame with silent, balanced footwork",
      "Quirky pale scar tracing an angle across the left eyebrow",
    ],
    visualAesthetic: "Low-profile civilian technical apparel designed for crowd concealment",
  },
  {
    id: "steampunk",
    keywords: [
      "steampunk", "gaslamp", "clockwork", "dirigible", "airship", "victorian science",
      "brass", "cog", "inventor", "aether", "alchemical", "boiler"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Leather-trimmed tweed coat suited for a ${arch}`),
      normalizeItemInstance("Heavy linen shirt with brass studs"),
      normalizeItemInstance("High-waisted trousers with reinforced tool loops"),
      normalizeItemInstance("Brass-buckled mechanic's tool harness"),
      normalizeItemInstance("Oil-treated leather work boots with brass lace eyelets"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Pocket clockwork chronometer with exposed balance wheel"),
      normalizeItemInstance(note ? `Component pouch (${note.slice(0, 42).replace(/\.+$/, "")})` : "Foldable brass loupe and velvet pouch of miniature gears"),
    ],
    features: [
      "Soot smudges near temples and grease under fingernails",
      "Intense, calculating gaze analyzing structural tolerances",
      "Wild hair tied loosely with an oiled string",
      "Faint circular pressure mark around eye orbits from loupe lenses",
      "Lean, kinetic frame with quick, dexterous fingers",
      "Quirky brass prosthetic finger joint on right index finger",
    ],
    visualAesthetic: "Victorian industrial leather, tweed, brass fittings, and utilitarian tool aprons",
  },
  {
    id: "swashbuckling",
    keywords: [
      "pirate", "swashbuckler", "naval", "sail", "ocean", "ship", "sea", "buccaneer",
      "privateer", "cutlass", "caribbean", "corsair", "maritime", "islands"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Weather-beaten broadcloth captain's coat suited for a ${arch}`),
      normalizeItemInstance("Loose linen deck shirt"),
      normalizeItemInstance("Tough sailcloth breeches"),
      normalizeItemInstance("Wide leather baldric with brass buckle"),
      normalizeItemInstance("Salt-stained leather deck boots with brass buckles"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Brass navigational spyglass or pocket compass"),
      normalizeItemInstance(note ? `Sealed navigation chart (${note.slice(0, 42).replace(/\.+$/, "")})` : "Pouch of dried ship's tobacco and steel striker"),
    ],
    features: [
      "Sun-bleached hair and deeply tanned, weather-hardened face",
      "Piercing, wind-squinting gaze conditioned by open seas",
      "Faint rope-burn scarring along palms and wrists",
      "Balanced sea-legs stance swaying instinctively with movement",
      "Broad chest and calloused, weather-hardened palms",
      "Quirky faded kraken tattoo wrapping around left forearm",
    ],
    visualAesthetic: "Weathered sailcloth, linen deck shirts, wide leather belts, and brass hardware",
  },
  {
    id: "antiquity_feudal",
    keywords: [
      "ancient", "rome", "gladiator", "spartan", "greek", "antiquity", "samurai",
      "feudal", "ronin", "wuxia", "dynasty", "pharaoh", "bronze", "legion", "sparta"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Traditional woven tunic or mantle suited for a ${arch}`),
      normalizeItemInstance("Pleated linen undertunic"),
      normalizeItemInstance("Fastened leather leg wraps"),
      normalizeItemInstance("Studded leather girdle with bronze clasp"),
      normalizeItemInstance("Laced leather sandals or wrapped straw waraji"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Clay water flask or bamboo gourd"),
      normalizeItemInstance(note ? `Inscribed tablet (${note.slice(0, 42).replace(/\.+$/, "")})` : "Polished jade carving or stamped bronze drachma"),
    ],
    features: [
      "Sun-bronzed skin with disciplined, dignified posture",
      "Severe, focused gaze disciplined by classical training",
      "Topknot or braided hair bound with iron pin or cord",
      "Old sparring scars across forearms and shoulders",
      "Disciplined, corded muscle with zero wasted body fat",
      "Quirky ritual brand mark etched onto the inner right forearm",
    ],
    visualAesthetic: "Traditional woven fabrics, wrapped leather armor, and classical ceremonial draping",
  },
  {
    id: "superhero",
    keywords: [
      "superhero", "vigilante", "superpower", "hero", "cape", "masked", "villain",
      "mutant power", "crimefighter", "costumed", "nemesis"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Reinforced ballistic weave outer jacket suited for a ${arch}`),
      normalizeItemInstance("Flexible compression undersuit"),
      normalizeItemInstance("Reinforced tactical trousers with hidden padding"),
      normalizeItemInstance("Utility belt with discrete sealed pouches"),
      normalizeItemInstance("Impact-resistant athletic combat boots"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Compact grappling line or specialized tool dispenser"),
      normalizeItemInstance(note ? `Signature gadget (${note.slice(0, 42).replace(/\.+$/, "")})` : "Miniature secure communicator and medical trauma patch"),
    ],
    features: [
      "Mask line or subtle tan line across upper face",
      "Hyper-alert, scanning gaze tracking high perimeters",
      "Athletic, coiled posture ready to spring into motion",
      "Faint lightning-pattern electrical burn scar across left shoulder",
      "Dense, hyper-conditioned muscle fiber across back and shoulders",
      "Quirky heterochromia with one eye glowing faintly under low light",
    ],
    visualAesthetic: "Reinforced impact-resistant textiles with personalized insignia or cowl",
  },
  {
    id: "universal",
    keywords: [],
    equipped: (arch) => [
      normalizeItemInstance(`Durable all-weather travel coat suited for a ${arch}`),
      normalizeItemInstance("Sturdy collared utility shirt"),
      normalizeItemInstance("Reinforced travel trousers"),
      normalizeItemInstance("Heavy leather belt with brass buckle"),
      normalizeItemInstance("Hard-wearing, all-terrain travel boots"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Durable personal journal with writing stylus or pencil"),
      normalizeItemInstance(note ? `Keepsake token (${note.slice(0, 42).replace(/\.+$/, "")})` : "Compact multi-purpose pocket utility tool and sturdy water canteen"),
    ],
    features: [
      "Keen, observant gaze taking in every detail of the room",
      "Carefully trimmed hair styled for practicality",
      "Athletic, measured bearing that commands quiet respect",
      "Distinctive pale scar across left brow",
      "Calloused hands accustomed to hard work and skilled craft",
      "Quirky subtle amber fleck in the left iris",
    ],
    visualAesthetic: "Timeless, durable travel attire designed for utility across diverse realms",
  },
];

export function resolveGenreFallbackProfile(genreText: string, archetype: string, roughNotes: string) {
  const combined = `${genreText} ${archetype} ${roughNotes}`.toLowerCase();
  const genreLower = genreText.toLowerCase();
  let bestProfile = GENRE_FALLBACK_PROFILES[GENRE_FALLBACK_PROFILES.length - 1];
  let bestScore = 0;

  for (let i = 0; i < GENRE_FALLBACK_PROFILES.length - 1; i++) {
    const prof = GENRE_FALLBACK_PROFILES[i];
    let score = 0;
    for (const kw of prof.keywords) {
      if (combined.includes(kw)) {
        score += genreLower.includes(kw) ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestProfile = prof;
    }
  }

  const cleanArch = archetype.trim() || "traveler";
  const cleanNotes = roughNotes.trim();

  return {
    id: bestProfile.id,
    equipped: bestProfile.equipped(cleanArch),
    inventory: bestProfile.inventory(cleanNotes),
    distinctiveFeatures: [...bestProfile.features],
    visualAesthetic: bestProfile.visualAesthetic,
  };
}

export function inferClientDemographicsAndEthics(name: string, archetype: string, notes: string) {
  const combined = `${name} ${archetype} ${notes}`.toLowerCase();
  const cleanName = name.trim();
  const firstName = cleanName.split(/\s+/)[0]?.toLowerCase() || "character";

  const femaleCues = /\b(she|her|female|woman|girl|sister|mother|lady|queen|daughter|witch|priestess|actress)\b/i.test(combined);
  const maleCues = /\b(he|him|male|man|boy|brother|father|lord|king|son|wizard|priest|guy|actor)\b/i.test(combined);

  let sex = "Male";
  let pronouns = "he/him";
  if (femaleCues && !maleCues) {
    sex = "Female";
    pronouns = "she/her";
  } else if (!maleCues && !femaleCues) {
    if (firstName.endsWith("a") || firstName.endsWith("ia") || firstName.endsWith("elle")) {
      sex = "Female";
      pronouns = "she/her";
    }
  }

  let age = "32";
  if (/\b(veteran|elder|mentor|ancient|grizzled|old)\b/i.test(combined)) {
    age = "52";
  } else if (/\b(young|rookie|apprentice|student|prodigy|urchin)\b/i.test(combined)) {
    age = "21";
  }

  const heightVal = sex === "Female" ? 168 : 180;
  let buildStr = "balanced athletic build";
  if (/\b(knight|brawler|tank|berserker|heavy|soldier|enforcer)\b/i.test(combined)) {
    buildStr = "broad-shouldered athletic frame";
  } else if (/\b(rogue|thief|assassin|infiltrator|scout|wiry)\b/i.test(combined)) {
    buildStr = "lean, wiry athletic frame";
  } else if (/\b(scholar|mage|wizard|hacker|investigator|slender)\b/i.test(combined)) {
    buildStr = "slender, wiry build";
  }

  let posture = "Alert, composed bearing with measured, watchful economy of motion";
  if (/\b(soldier|enforcer|paladin|knight)\b/i.test(combined)) {
    posture = "Rigid, upright military bearing; feet planted shoulder-width apart";
  } else if (/\b(rogue|thief|outlaw|smuggler|assassin)\b/i.test(combined)) {
    posture = "Relaxed, low-center-of-gravity stance; habitually leaning against doorways or walls";
  }

  let moralCode = [
    "Never betrays an ally or employer who has acted in transparent good faith",
    "Refuses to sacrifice personal autonomy or sell out core principles for empty promises",
    "Will not initiate unprovoked violence against unarmed parties",
  ];
  let quirksFlaws = [
    "Habitually suspicious of unsolicited kindness, immediately searching for hidden leverage",
    "Deflects genuine vulnerability with caustic, dry humor or tactical distractions",
    "Sleeps with a weapon within arm's reach and insists on sitting with back to a wall",
  ];

  if (/\b(cynic|detached|mercenary|selfish|outlaw|hustler|assassin|smuggler|fixer)\b/i.test(combined)) {
    moralCode = [
      "Never risks life or freedom for sentimental causes without tangible leverage or collateral",
      "Demands fair payment and strictly honors a deal once blood, coin, or collateral is exchanged",
      "Refuses to become anyone's expendable pawn or die for another's ideology",
    ];
    quirksFlaws = [
      "Instinctively tracks exits and calculates escape vectors whenever entering an unfamiliar room",
      "Deflects personal inquiries with abrasive irony or evasive, dry sarcasm",
      "Cannot sleep soundly unless a weapon is within direct arm's reach and back is against a solid wall",
    ];
  } else if (/\b(paladin|guardian|knight|protector|hero|healer|cleric|devoted)\b/i.test(combined)) {
    moralCode = [
      "Will not abandon an ally or vulnerable innocent when direct action can prevent tragedy",
      "Refuses to employ extortion, cruelty, or terror even when facing ruthless adversaries",
      "Holds sworn oaths sacred, standing ground even when withdrawal offers tactical advantage",
    ];
    quirksFlaws = [
      "Carries deep survivor's guilt, obsessively holding themselves personally responsible for collateral harm",
      "Stiff and visibly awkward in casual social settings, reflexively defaulting to vigilant patrol duty",
      "Prone to taking unreasonable physical risks to shield others from danger",
    ];
  }

  return {
    species: "Human",
    sex,
    pronouns,
    age,
    build: buildStr,
    buildAndHeight: `${heightVal} cm`,
    posture,
    moralCode,
    quirksFlaws,
  };
}
