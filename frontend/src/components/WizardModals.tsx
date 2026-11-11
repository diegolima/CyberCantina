import React, { useMemo, useState } from "react";
import {
  Brain,
  Check,
  Database,
  Eye,
  Globe,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  CharacterRecord,
  CharacterWizardDraft,
  ItemInstance,
  WorldRecord,
  WorldWizardDraft,
  normalizeItemInstance,
} from "../types";
import {
  WorldInspectorModal,
  draftToWorldRecord,
  worldStateToDraft,
} from "./EntityEditorModals";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
} from "./character";
import { TagChipsInput } from "./TagChipsInput";

interface GenreFallbackProfile {
  id: string;
  keywords: string[];
  equipped: (arch: string) => ItemInstance[];
  inventory: (note: string) => ItemInstance[];
  features: string[];
  visualAesthetic: string;
}

const GENRE_FALLBACK_PROFILES: GenreFallbackProfile[] = [
  {
    id: "fantasy",
    keywords: [
      "fantasy", "high fantasy", "dark fantasy", "medieval", "magic", "sword", "d&d",
      "elven", "elf", "dwarf", "tavern", "bard", "sorcerer", "wizard", "druid",
      "dungeon", "dragon", "paladin", "cleric", "kingdom", "realm"
    ],
    equipped: (arch) => [
      normalizeItemInstance(`Tailored traveling cloak and tunic suited for a ${arch}`),
      normalizeItemInstance("Reinforced leather breeches and sturdy brass-buckled belt"),
      normalizeItemInstance("High-cuff weathered riding boots"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Embroidered coin pouch with local minted silver"),
      normalizeItemInstance(note ? `Signature keepsake (${note.slice(0, 42).replace(/\.+$/, "")})` : "Weathered traveler's journal and charcoal quill"),
    ],
    features: [
      "Weathered traveling attire with braided trim",
      "Keen, observant gaze with weathered crow's feet",
      "Hair bound back with a durable leather cord",
      "Faint dueling scar along the left jawline",
      "Broad, grounded posture accustomed to long roads",
      "Quirky silver ring bearing an unidentifiable guild seal",
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
      normalizeItemInstance(`Pressurized flight jumpsuit with utility thermal lining suited for a ${arch}`),
      normalizeItemInstance("Magnetic-clamp utility harness and seal gloves"),
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
      "Hydraulic pressure grease stain on wrist cuff",
      "Steady, zero-gravity accustomed gait",
      "Unusual brass astronomical compass kept as an analog good luck charm",
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
      normalizeItemInstance(`Reinforced utility jacket suited for a ${arch}`),
      normalizeItemInstance("Dark cargo trousers with concealed equipment pockets"),
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
      "Mismatched chrome-plated thumb ring or finger casing",
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
      normalizeItemInstance("Dark pressed waistcoat, collared shirt, and sturdy trousers"),
      normalizeItemInstance("Treaded leather boots stained with damp earth"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Tarnished silver talisman engraved with warding sigils"),
      normalizeItemInstance(note ? `Occult dossier (${note.slice(0, 42).replace(/\.+$/, "")})` : "Leatherbound pocket ledger with cryptic handwritten notes and wax matches"),
    ],
    features: [
      "Hollow, sleep-deprived eyes carrying a haunted wariness",
      "Prematurely silvered streaks through dark hair",
      "Nervous, hyper-attentive posture constantly checking shadows",
      "Faint claw or ritual scar concealed beneath the collar",
      "Faint scent of old parchment, sulfur, or sweet pipe tobacco",
      "Curious tarnished talisman that seems faintly cold to the touch",
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
      normalizeItemInstance("Faded denim work shirt and reinforced riding pants with utility gunbelt"),
      normalizeItemInstance("Spurred leather boots with worn riding heels"),
    ],
    inventory: (note) => [
      normalizeItemInstance("Scratched tin canteen of water and pouch of dried jerky"),
      normalizeItemInstance(note ? `Pocket heirloom (${note.slice(0, 42).replace(/\.+$/, "")})` : "Brass pocket compass with a dented lid"),
    ],
    features: [
      "Sun-weathered skin with deep squint lines from the frontier glare",
      "Dusty wide-brimmed hat casting a shadow over watchful eyes",
      "Coarse stubble along a square jaw",
      "Faint powder burn mark on trigger finger",
      "Slow, relaxed drawl masking coiled physical reflexes",
      "Unusual silver half-dollar coin with a bullet dent carried in pocket",
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
      normalizeItemInstance(`Layered scavenger coat patched with salvaged tire rubber and fabric suited for a ${arch}`),
      normalizeItemInstance("Stitched canvas cargo pants with reinforced knee guards"),
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
      "Low, economical center of gravity and quiet footfalls",
      "Quirky necklace made of deactivated pre-collapse circuitry and animal bone",
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
      normalizeItemInstance(`Heavy wool trenchcoat favored by this ${arch}`),
      normalizeItemInstance("Dark collared shirt, loosened tie, and pressed slacks"),
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
      "Upright yet weary posture",
      "Calloused fingertips stained with tobacco or ink",
      "Curious vintage pocket watch that ticks slightly out of tempo",
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
      normalizeItemInstance("Fitted tactical cargo pants or dark durable denim"),
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
      "Calm, measured neutral posture",
      "Unusual scarred knuckle or customized wristwatch with dual-timezone bezel",
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
      normalizeItemInstance(`Leather-trimmed tweed coat or brass-buckled mechanic's apron suited for a ${arch}`),
      normalizeItemInstance("High-waisted trousers with reinforced tool loops"),
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
      "Brass-rimmed goggles pushed up on forehead or neck",
      "Erect, energetic posture with rapid hand gestures",
      "Odd mechanical pocket gadget that whirs and clicks at random intervals",
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
      normalizeItemInstance(`Weather-beaten captain's coat or linen deck shirt suited for a ${arch}`),
      normalizeItemInstance("Tough sailcloth breeches bound with a wide leather sash"),
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
      "Small gold hoop earring worn in left earlobe",
      "Curious carved whalebone scrimshaw token depicting a sea creature",
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
      normalizeItemInstance(`Traditional woven tunic or layered silk and leather robe suited for a ${arch}`),
      normalizeItemInstance("Sturdy hide-wrapped girdle and fastened leg wraps"),
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
      "Economy of motion; never fidgets or wastes movement",
      "Quirky ceremonial bronze ring etched with archaic glyphs",
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
      normalizeItemInstance(`Reinforced ballistic weave bodysuit or customized street vigilante jacket suited for a ${arch}`),
      normalizeItemInstance("Reinforced tactical trousers with hidden padding"),
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
      "Faint electrical or chemical singe marks on collar",
      "Fingers taped or reinforced with lightweight composite",
      "Curious customized emblem pin with hidden miniature compartment",
    ],
    visualAesthetic: "Reinforced impact-resistant textiles with personalized insignia or cowl",
  },
  {
    id: "universal",
    keywords: [],
    equipped: (arch) => [
      normalizeItemInstance(`Durable all-weather travel coat suited for a ${arch}`),
      normalizeItemInstance("Tailored utility garments with secure fastenings and sturdy belt"),
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
      "Curious carved stone talisman or coin carried as a personal touchstone",
    ],
    visualAesthetic: "Timeless, durable travel attire designed for utility across diverse realms",
  },
];

function resolveGenreFallbackProfile(genreText: string, archetype: string, roughNotes: string) {
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

export interface CharacterWizardModalProps {
  worlds: WorldRecord[];
  defaultWorldId: string;
  onClose: () => void;
  onCreated: (char: CharacterRecord, launchWorldId: string) => void;
  initialDraft?: CharacterWizardDraft | null;
  initialPreassignedId?: string | null;
  initialWorldDraft?: WorldWizardDraft | null;
}

export const CharacterWizardModal: React.FC<CharacterWizardModalProps> = ({
  worlds,
  defaultWorldId,
  onClose,
  onCreated,
  initialDraft = null,
  initialPreassignedId = null,
  initialWorldDraft = null,
}) => {
  const [name, setName] = useState("Soren Kael");
  const [archetype, setArchetype] = useState(
    "Rogue corporate courier with an encrypted memory vault"
  );
  const [roleInStory, setRoleInStory] = useState(
    "High-stakes informant seeking safe passage"
  );
  const [personalityKeywords, setPersonalityKeywords] = useState<string[]>([
    "paranoid",
    "razor-sharp",
    "dryly funny",
    "loyal",
  ]);
  const [roughNotes, setRoughNotes] = useState(
    "Fled an ambush in the upper spire; carries a locked bio-drive."
  );
  const [worldId, setWorldId] = useState(defaultWorldId);

  const [preassignedCharId, setPreassignedCharId] = useState<string | null>(initialPreassignedId);
  const [importedWorldDraft, setImportedWorldDraft] = useState<WorldWizardDraft | null>(initialWorldDraft);

  const [draft, setDraft] = useState<CharacterWizardDraft | null>(initialDraft);
  const [draftTab, setDraftTab] = useState<
    "base" | "appearance" | "personality" | "voice" | "inventory" | "memories"
  >("base");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleManualCreate = () => {
    const kwList = personalityKeywords.filter(Boolean);
    const selectedWorld = worlds.find((w) => w.id === worldId);
    const worldGenre = selectedWorld?.global_rules?.genre || "";

    const genreProfile = resolveGenreFallbackProfile(worldGenre, archetype, roughNotes);

    const mannerisms = [
      "Clenches jaw and briefly slows breathing when under sudden pressure",
      "Habitually sweeps gaze toward entrances and tracks weapon hands before speaking",
      "Subtly taps fingertips against thigh in measured four-beat intervals when calculating odds",
      "Pauses deliberately before answering direct personal inquiries, holding unbroken eye contact",
    ];

    const moralCode = [
      "Never betrays an ally or employer who has kept their word in good faith",
      "Refuses to exploit or intentionally harm vulnerable non-combatants",
      "Will never sacrifice personal autonomy or sell out core principles for empty promises",
    ];

    const quirksFlaws = [
      "Habitually suspicious of unsolicited kindness, immediately searching for hidden leverage",
      "Deflects genuine vulnerability with caustic, dry humor or tactical distractions",
      "Sleeps with a weapon within arm's reach and insists on sitting with back to a wall",
    ];

    const traitsList = kwList.length >= 4 ? kwList : [...kwList, "hyper-observant", "cynical", "calculating"].slice(0, 5);

    const manualDraft: CharacterWizardDraft = {
      name: name.trim() || "New Character",
      tagline: archetype.trim() || "Independent Operative",
      character_bio: roughNotes.trim() || `${name} is a ${archetype}.`,
      physical_appearance: roughNotes.trim() || `${name} is a ${archetype}.`,
      species: "Human",
      sex: "",
      pronouns: "",
      age: "",
      build_and_height: "",
      distinctive_features: genreProfile.distinctiveFeatures,
      posture: "Alert, composed bearing",
      mannerisms: mannerisms,
      modifications: [],
      visual_aesthetic: genreProfile.visualAesthetic,
      personality_traits: traitsList,
      core_persona: `${name.trim() || "New Character"} is a ${archetype.trim() || "character"}, serving as ${roleInStory.trim() || "a key figure"}. In conversation, they avoid melodrama, preferring grounded observations and subtext-heavy dialogue.`,
      moral_code: moralCode,
      quirks_flaws: quirksFlaws,
      communication_style: ["direct", "measured", "guarded"],
      initial_message: `*${name.trim() || "The character"} pauses, observing you with a measured, attentive gaze.*\n\n"What brings you here?"`,
      equipped: genreProfile.equipped,
      inventory: genreProfile.inventory,
      voice_anchors: [
        {
          context: "Calm / Conversational",
          snippet: `*${name.trim() || "They"} speak in an unhurried, measured cadence.* "Tell me what's actually on your mind."`,
        },
      ],
      baseline_psyche: {
        mood_label: "Calm & Composed",
        valence: 0.2,
        arousal: 0.2,
        core_drive: `Pursue goals as a ${archetype.trim() || "character"} while maintaining independence.`,
        core_fear: "Losing autonomy or being compromised by past events.",
        default_want: `Assess the situation and establish their dynamic as ${roleInStory.trim() || "an ally"}.`,
        default_plan: "- Observe the immediate threshold and identify all viable exit paths.\n- Test the user's motives with a measured, probing question.\n- Maintain tactical distance and safeguard autonomy until reliability is proven.",
        temperament: {
          archetype: "balanced",
          relational_inertia: 0.8,
          negativity_ratio: 3.5,
          theta_pos_base: 0.15,
          theta_neg_base: -0.12,
          composure_resilience: 1.0,
        },
        initial_worldview: {
          benevolence: 0.0,
          belonging: 0.1,
          agency: 0.2,
        },
      },
      memory_shards: [
        {
          id: "shard_seed_0",
          title: "Origins & Background",
          content: roughNotes.trim() || `${name} began their journey in this region.`,
          keywords: ["backstory", "origin"],
          emotional_weight: 0.7,
        },
      ],
      tags: kwList,
      creator: "",
      creator_notes: roughNotes.trim(),
      portraits: {},
      gallery: [],
    };
    setDraft(manualDraft);
    setPreassignedCharId(null);
    setImportedWorldDraft(null);
  };

  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.draftCharacter({
        name,
        archetype,
        role_in_story: roleInStory,
        personality_keywords: personalityKeywords,
        rough_notes: roughNotes,
        world_id: worldId || null,
      });
      setDraft(res);
      setPreassignedCharId(null);
      setImportedWorldDraft(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      if (importedWorldDraft) {
        const createdWorld = await api.commitWorld(importedWorldDraft);
        const created = await api.commitCharacter(
          draft,
          createdWorld.id,
          preassignedCharId
        );
        onCreated(created, createdWorld.id);
      } else {
        const created = await api.commitCharacter(
          draft,
          worldId,
          preassignedCharId
        );
        onCreated(created, worldId);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-amber)" }}>
            <UserPlus size={18} />
            1.1 Character Creation Wizard (Seed → Expand → Shard into RAG)
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ color: "var(--accent-rose)", fontSize: "0.82rem" }}>
              {error}
            </div>
          )}

          {!draft ? (
            <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="field-group">
                    <label>Target World Setting</label>
                    <select
                      className="field-select"
                      value={worldId}
                      onChange={(e) => setWorldId(e.target.value)}
                    >
                      <option value="">Standalone (No specific world)</option>
                      {worlds.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} ({w.global_rules.genre})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label>Character Name</label>
                    <input
                      className="field-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label>Archetype / High Concept</label>
                    <input
                      className="field-input"
                      value={archetype}
                      onChange={(e) => setArchetype(e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label>Role in Story</label>
                    <input
                      className="field-input"
                      value={roleInStory}
                      onChange={(e) => setRoleInStory(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <label>Personality Keywords &amp; Traits</label>
                    <TagChipsInput
                      value={personalityKeywords}
                      placeholder="e.g. paranoid, razor-sharp, loyal (press comma or enter)"
                      accentVariant="violet"
                      onChange={setPersonalityKeywords}
                    />
                  </div>

                  <div className="field-group">
                    <label>Rough Notes, Secrets, or Backstory Ideas</label>
                    <textarea
                      className="field-textarea"
                      value={roughNotes}
                      onChange={(e) => setRoughNotes(e.target.value)}
                    />
                  </div>

              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                Looking to import an existing character card (.png / .json) or .zcc archive? Use <strong>Import</strong> on the Home Screen.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleManualCreate}
                >
                  <Pencil size={15} />
                  Manually Create Character
                </button>
                <button
                  type="submit"
                  className="btn btn-amber"
                  disabled={loading}
                >
                  <Sparkles size={15} />
                  {loading ? "AI Expanding Character..." : "Expand & Optimize with AI"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Media Preview Banner if Portrait Present */}
              {draft.portraits?.default && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                  }}
                >
                  <img
                    src={draft.portraits.default}
                    alt={draft.name}
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 8,
                      objectFit: "cover",
                      border: "1px solid var(--border-subtle)",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--accent-amber)", fontSize: "0.95rem" }}>
                      {draft.name}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                      {draft.tagline}
                    </div>
                    {draft.gallery && draft.gallery.length > 0 && (
                      <div style={{ fontSize: "0.74rem", color: "var(--accent-cyan)", marginTop: 2 }}>
                        Photo album initialized with {draft.gallery.length} artwork asset(s)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Auto-Generated World Notice */}
              {importedWorldDraft && (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "rgba(56, 189, 248, 0.08)",
                    border: "1px solid var(--accent-cyan)",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                  }}
                >
                  <strong style={{ color: "var(--accent-cyan)" }}>Auto-Generated World: </strong>
                  <span>
                    "{importedWorldDraft.name}" ({importedWorldDraft.locations.length} interconnected locations) will be launched with this character.
                  </span>
                </div>
              )}

              {/* Modal Tabs for Draft Preview & Fine-Grained Editing */}
              <div className="modal-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "base"}
                  className={`modal-tab-btn ${draftTab === "base" ? "active" : ""}`}
                  onClick={() => setDraftTab("base")}
                >
                  <User size={14} />
                  <span>Base</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "appearance"}
                  className={`modal-tab-btn ${draftTab === "appearance" ? "active" : ""}`}
                  onClick={() => setDraftTab("appearance")}
                >
                  <Eye size={14} />
                  <span>Appearance</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "personality"}
                  className={`modal-tab-btn ${draftTab === "personality" ? "active" : ""}`}
                  onClick={() => setDraftTab("personality")}
                >
                  <Brain size={14} />
                  <span>Personality</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "voice"}
                  className={`modal-tab-btn ${draftTab === "voice" ? "active" : ""}`}
                  onClick={() => setDraftTab("voice")}
                >
                  <MessageSquare size={14} />
                  <span>Voice &amp; Dialogue</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "inventory"}
                  className={`modal-tab-btn ${draftTab === "inventory" ? "active" : ""}`}
                  onClick={() => setDraftTab("inventory")}
                >
                  <Package size={14} />
                  <span>Inventory</span>
                  <span className="modal-tab-badge">
                    {(draft.equipped ?? []).length + draft.inventory.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "memories"}
                  className={`modal-tab-btn ${draftTab === "memories" ? "active" : ""}`}
                  onClick={() => setDraftTab("memories")}
                >
                  <Database size={14} />
                  <span>Memories</span>
                  <span className="modal-tab-badge">{draft.memory_shards.length}</span>
                </button>
              </div>

              {/* Tab Content */}
              {draftTab === "base" && (
                <CharacterBaseTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                  worlds={worlds}
                />
              )}

              {draftTab === "appearance" && (
                <CharacterAppearanceTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "personality" && (
                <CharacterPersonalityTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "voice" && (
                <CharacterVoiceTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "inventory" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Equipped Attire */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span className="sidebar-label">
                        Equipped Attire &amp; Gear ({(draft.equipped ?? []).length})
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            equipped: [...(draft.equipped ?? []), "New equipped attire"],
                          })
                        }
                      >
                        <Plus size={12} /> Add Equipped
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(draft.equipped ?? []).map((item, idx) => {
                        const itemObj = normalizeItemInstance(item, idx);
                        return (
                          <div
                            key={itemObj.id || idx}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <input
                              className="field-input"
                              style={{ flex: 1, padding: "5px 8px", fontSize: "0.78rem" }}
                              value={typeof item === "string" ? item : item.name}
                              placeholder="e.g. Leather jacket"
                              onChange={(e) => {
                                const next = [...(draft.equipped ?? [])];
                                next[idx] =
                                  typeof item === "string"
                                    ? e.target.value
                                    : { ...item, name: e.target.value };
                                setDraft({ ...draft, equipped: next });
                              }}
                            />
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  equipped: (draft.equipped ?? []).filter((_, i) => i !== idx),
                                })
                              }
                              title="Remove equipped item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {(draft.equipped ?? []).length === 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No equipped gear specified.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Carried Inventory */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span className="sidebar-label">
                        Carried Inventory ({draft.inventory.length})
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            inventory: [...draft.inventory, "New carried item"],
                          })
                        }
                      >
                        <Plus size={12} /> Add Item
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {draft.inventory.map((item, idx) => {
                        const itemObj = normalizeItemInstance(item, idx);
                        return (
                          <div
                            key={itemObj.id || idx}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <input
                              className="field-input"
                              style={{ flex: 1, padding: "5px 8px", fontSize: "0.78rem" }}
                              value={typeof item === "string" ? item : item.name}
                              placeholder="e.g. Encrypted datapad"
                              onChange={(e) => {
                                const next = [...draft.inventory];
                                next[idx] =
                                  typeof item === "string"
                                    ? e.target.value
                                    : { ...item, name: e.target.value };
                                setDraft({ ...draft, inventory: next });
                              }}
                            />
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  inventory: draft.inventory.filter((_, i) => i !== idx),
                                })
                              }
                              title="Remove item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {draft.inventory.length === 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No carried items specified.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {draftTab === "memories" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="sidebar-label">
                    Atomic Backstory Memory Shards ({draft.memory_shards.length} — Indexed into Vector Store)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {draft.memory_shards.map((m, i) => (
                      <div key={i} className="cog-step" style={{ fontSize: "0.78rem", padding: "8px 12px" }}>
                        <div style={{ fontWeight: 600, color: "var(--accent-cyan)", marginBottom: 4 }}>
                          {m.title}
                        </div>
                        <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>
                          {m.content}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 4 }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Trigger Keywords:</span>
                          {m.keywords.map((kw, ki) => (
                            <span
                              key={ki}
                              className="badge"
                              style={{
                                fontSize: "0.68rem",
                                padding: "1px 6px",
                                background: "rgba(168, 85, 247, 0.12)",
                                borderColor: "rgba(168, 85, 247, 0.3)",
                                color: "var(--accent-violet)",
                              }}
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {draft.memory_shards.length === 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                        No backstory memory shards generated.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDraft(null);
                    setPreassignedCharId(null);
                    setImportedWorldDraft(null);
                  }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={handleCommit}
                  disabled={loading}
                >
                  <Check size={15} />
                  {loading ? "Saving..." : "Commit Character & Launch Campaign"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface WorldWizardModalProps {
  onClose: () => void;
  onCreated: (world: WorldRecord) => void;
}

export const WorldWizardModal: React.FC<WorldWizardModalProps> = ({
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState("Orbital Station Helios-7");
  const [genreAndTone, setGenreAndTone] = useState(
    "Hard Sci-Fi Corporate Thriller / Claustrophobic Noir"
  );
  const [corePremise, setCorePremise] = useState(
    "A quarantined deep-space mining spindle where oxygen is rationed and a rogue AI whispers through the comms."
  );
  const [hubConcept, setHubConcept] = useState(
    "The Low-G Hydroponics Cantina ('The Oxygen Garden')"
  );
  const [locationCount, setLocationCount] = useState(4);

  const [draft, setDraft] = useState<WorldWizardDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const draftWorld = useMemo(
    () => (draft ? draftToWorldRecord(draft) : null),
    [draft]
  );

  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.draftWorld({
        name,
        genre_and_tone: genreAndTone,
        core_premise: corePremise,
        initial_hub_concept: hubConcept,
        location_count: locationCount,
      });
      if (res && res.global_rules) {
        const curGenre = (res.global_rules.genre || "").trim();
        const curLower = curGenre.toLowerCase();
        const intendedLower = genreAndTone.trim().toLowerCase();
        if (
          !curGenre ||
          ((curLower === "cyberpunk noir" || curLower === "cyberpunk") &&
            !intendedLower.includes("cyberpunk"))
        ) {
          res.global_rules.genre = genreAndTone.trim();
        }
      }
      setDraft(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (draftWorld) {
    return (
      <WorldInspectorModal
        world={draftWorld}
        mode="wizard"
        onClose={onClose}
        onBackToSeed={() => setDraft(null)}
        onCommitDraft={async (payload) => {
          const nextDraft = worldStateToDraft(payload);
          return api.commitWorld(nextDraft);
        }}
        onSaved={onCreated}
      />
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-cyan)" }}>
            <Globe size={18} />
            1.2 World & Spatial Topology Wizard
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ color: "var(--accent-rose)", fontSize: "0.82rem" }}>
              {error}
            </div>
          )}

          <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field-group">
              <label>World / Scenario Name</label>
              <input
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>Genre & Tone</label>
              <input
                className="field-input"
                value={genreAndTone}
                onChange={(e) => setGenreAndTone(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>Core Premise & Conflict</label>
              <textarea
                className="field-textarea"
                value={corePremise}
                onChange={(e) => setCorePremise(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>Starting Hub Location Concept</label>
              <input
                className="field-input"
                value={hubConcept}
                onChange={(e) => setHubConcept(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label>Initial Connected Locations (3–8)</label>
              <input
                type="number"
                min={3}
                max={8}
                className="field-input"
                value={locationCount}
                onChange={(e) => setLocationCount(Number(e.target.value))}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-cyan" disabled={loading}>
                <Sparkles size={15} />
                {loading ? "Building Spatial Graph..." : "Generate World & Spatial Graph"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
