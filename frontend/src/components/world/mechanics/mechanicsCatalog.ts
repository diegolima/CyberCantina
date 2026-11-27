import {
  DEFAULT_GATE_DC,
  MAX_CHOICE_OPTIONS,
  MAX_PHYSICAL_CONTEXT_LENGTH,
  PHYSICAL_STANCE_OPTIONS,
  STALE_TIME_SKIP_MINUTES,
  TEMPERAMENT_ARCHETYPE_OPTIONS,
  type MechanicsSubcategoryId,
  type MechanicsTopicId,
} from "../../../types";
import {
  SEARCH_COOLDOWN_TURNS,
  getSlashCommandSpec,
} from "../../../utils/slashCommands";
import {
  LINK_SPEED_PRESET_GROUPS,
  MAX_EDGE_SPEED_MODIFIER,
  MIN_EDGE_SPEED_MODIFIER,
  WALKING_METERS_PER_MINUTE,
} from "../../../utils/spatialDistance";
import {
  PHASE_DISPLAY_META,
  TELEMETRY_PHASE_ORDER,
} from "../../chat/contextHealthHelpers";
import { CONTAINER_DEPTH_LABELS } from "../../map/topologyProjection";

export type MechanicsAccent =
  | "cyan"
  | "emerald"
  | "amber"
  | "violet"
  | "rose"
  | "muted";

export interface MechanicsSubcategoryMeta {
  id: MechanicsSubcategoryId;
  label: string;
  shortLabel: string;
  description: string;
  accent: MechanicsAccent;
}

export interface MechanicsScaleRow {
  label: string;
  rangeOrTag: string;
  meaning: string;
  accent?: MechanicsAccent;
}

export interface MechanicsUnderTheHoodItem {
  label: string;
  value: string;
  detail?: string;
}

export interface MechanicsUnderTheHoodSpec {
  title?: string;
  summary: string;
  items: readonly MechanicsUnderTheHoodItem[];
}

export interface MechanicsArticle {
  id: MechanicsTopicId;
  subcategoryId: MechanicsSubcategoryId;
  title: string;
  shortTitle?: string;
  keywords: readonly string[];
  inOneLine: string;
  scales?: readonly MechanicsScaleRow[];
  howItChanges: readonly string[];
  effectOnPlay: readonly string[];
  underTheHood?: MechanicsUnderTheHoodSpec;
  relatedTopicIds: readonly MechanicsTopicId[];
}

const LOOK_SPEC = getSlashCommandSpec("look");
const SEARCH_SPEC = getSlashCommandSpec("search");
const WAIT_SPEC = getSlashCommandSpec("wait");
const EVENT_SPEC = getSlashCommandSpec("event");
const NARRATE_SPEC = getSlashCommandSpec("narrate");
const CHOICE_SPEC = getSlashCommandSpec("choice");
const PARTY_SPEC = getSlashCommandSpec("party");
const GM_SPEC = getSlashCommandSpec("gm");

function formatAliases(aliases: readonly string[]): string {
  return aliases.length > 0
    ? `Aliases: ${aliases.map((a) => `/${a}`).join(", ")}`
    : "No aliases";
}

function formatSigned(val: number): string {
  return val >= 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
}

/** Ordered subcategories for the Codex Game Mechanics reference browser. */
export const MECHANICS_SUBCATEGORIES: readonly MechanicsSubcategoryMeta[] = [
  {
    id: "care",
    label: "CARE (Emotions & Bonds)",
    shortLabel: "CARE",
    description:
      "Deterministic 4-layer psychology: worldview, PAD mood & composure, scene appraisal, and relational bonds.",
    accent: "violet",
  },
  {
    id: "dice",
    label: "Dice & Action Resolution",
    shortLabel: "Dice & Choices",
    description:
      "d20 modes, the 5 outcome tiers, natural roll precedence, and Director Choices (/choice).",
    accent: "cyan",
  },
  {
    id: "directing",
    label: "Directing & Privacy",
    shortLabel: "Directing",
    description:
      "Public room actions, @Character whispers, remote comms, Narrator commands, and Persona gossip.",
    accent: "emerald",
  },
  {
    id: "spatial",
    label: "Parties, Map & Travel",
    shortLabel: "Parties & Map",
    description:
      "Co-located parties, nested containers and portals, metric distances, speed modifiers, and secret passages.",
    accent: "cyan",
  },
  {
    id: "memory",
    label: "Memory, Lore & Context",
    shortLabel: "Memory & Context",
    description:
      "3-tier memory, Context Health 4-zone KV-cache economy, hybrid RAG recall, secrets, and scene flags.",
    accent: "amber",
  },
  {
    id: "timelines",
    label: "Timelines & Chronicles",
    shortLabel: "Timelines",
    description:
      "Branch-safe timelines, Branch Graph episodes, out-of-context bookmarks, and Major Events.",
    accent: "violet",
  },
  {
    id: "gm",
    label: "GM Tools & Overrides",
    shortLabel: "GM Tools",
    description:
      "Neuromancer GM Talk, Unlock Lore & Secrets (GM Mode), manual relocations, and inventory locks.",
    accent: "amber",
  },
] as const;

const TEMPERAMENT_SCALES: readonly MechanicsScaleRow[] =
  TEMPERAMENT_ARCHETYPE_OPTIONS.map((opt) => ({
    label: opt.label,
    rangeOrTag: opt.archetype,
    meaning: opt.summary,
    accent:
      opt.archetype === "volatile" || opt.archetype === "paranoiac"
        ? "amber"
        : opt.archetype === "confidant"
          ? "emerald"
          : opt.archetype === "stoic"
            ? "cyan"
            : "violet",
  }));

const TEMPERAMENT_HOOD_ITEMS: readonly MechanicsUnderTheHoodItem[] =
  TEMPERAMENT_ARCHETYPE_OPTIONS.map((opt) => ({
    label: opt.label,
    value: `Inertia ${opt.temperament.relational_inertia.toFixed(2)} · Negativity ${opt.temperament.negativity_ratio.toFixed(1)}× · Resilience ${opt.temperament.composure_resilience.toFixed(1)}`,
    detail: `Default worldview: Benevolence ${formatSigned(opt.worldview.benevolence)}, Belonging ${formatSigned(opt.worldview.belonging)}, Agency ${formatSigned(opt.worldview.agency)}`,
  }));

const NARRATOR_SCALES: readonly MechanicsScaleRow[] = [
  {
    label: LOOK_SPEC.syntax,
    rangeOrTag: formatAliases(LOOK_SPEC.aliases),
    meaning: LOOK_SPEC.description,
    accent: "cyan",
  },
  {
    label: WAIT_SPEC.syntax,
    rangeOrTag: formatAliases(WAIT_SPEC.aliases),
    meaning: `${WAIT_SPEC.description} Supports durations like 30m or 2h and decays CARE states across elapsed time.`,
    accent: "amber",
  },
  {
    label: EVENT_SPEC.syntax,
    rangeOrTag: formatAliases(EVENT_SPEC.aliases),
    meaning: EVENT_SPEC.description,
    accent: "amber",
  },
  {
    label: NARRATE_SPEC.syntax,
    rangeOrTag: formatAliases(NARRATE_SPEC.aliases),
    meaning: NARRATE_SPEC.description,
    accent: "violet",
  },
];

const CONTAINER_DEPTH_SCALES: readonly MechanicsScaleRow[] = (
  [4, 3, 2, 1] as const
).map((depth) => ({
  label: `Level ${depth} Container`,
  rangeOrTag: CONTAINER_DEPTH_LABELS[depth],
  meaning:
    depth === 1
      ? "Innermost structure (e.g., building or deck) that can carry local lore and enclose Level 0 Locations."
      : `Macro geographic tier grouping ${depth === 2 ? "Level 1 structures or rooms" : `Level ${depth - 1} areas`} on the spatial map.`,
  accent: depth === 1 ? "emerald" : "cyan",
}));

const SPEED_PRESET_HOOD_ITEMS: readonly MechanicsUnderTheHoodItem[] =
  LINK_SPEED_PRESET_GROUPS.map((grp) => ({
    label: grp.label,
    value: grp.items.map((p) => `${p.label} (${p.modifier}×)`).join(" · "),
  }));

const PHASE_CONTEXT_SCALES: readonly MechanicsScaleRow[] =
  TELEMETRY_PHASE_ORDER.map((key) => {
    const meta = PHASE_DISPLAY_META[key];
    return {
      label: `${meta.shortLabel} · ${meta.title}`,
      rangeOrTag:
        key === "phase4_prose"
          ? "Actor (4-Zone)"
          : key === "phase3_cognition"
            ? "Actor or Clerk"
            : "Clerk",
      meaning: meta.subtitle,
      accent: key === "phase4_prose" ? "cyan" : "violet",
    };
  });

/** Static read-only reference articles across all 7 CyberCantina mechanics subcategories. */
export const MECHANICS_ARTICLES: readonly MechanicsArticle[] = [
  // =========================================================================
  // 1. CARE (Emotions & Bonds) — Layer 1 -> Layer 4 progression
  // =========================================================================
  {
    id: "care-overview",
    subcategoryId: "care",
    title: "How CARE Works",
    keywords: [
      "care",
      "affective",
      "psychology",
      "emotion",
      "layers",
      "qualitative",
      "decay",
      "half-life",
    ],
    inOneLine:
      "CARE (CyberCantina Affective & Relational Engine) is a deterministic 4-layer psychology solver that tracks each NPC's worldview, mood, composure, scene appraisal, and relationships across turns.",
    scales: [
      {
        label: "Layer 1 · Active Worldview",
        rangeOrTag: "Slow Baseline",
        meaning:
          "Temperament preset, existential beliefs (Benevolence, Belonging, Agency), Core Drive, and Core Fear.",
        accent: "violet",
      },
      {
        label: "Layer 2 · Mood & Composure",
        rangeOrTag: "PAD + Mask",
        meaning:
          "4D emotional state (Valence, Arousal, Dominance, Composure) driving outward demeanor and portrait expressions.",
        accent: "cyan",
      },
      {
        label: "Layer 3 · Scene Appraisal",
        rangeOrTag: "Tactical Read",
        meaning:
          "Immediate read of Threat, Coping, Goal Fit, and Surprise shaping Active Scene Want and Tactical Plan.",
        accent: "amber",
      },
      {
        label: "Layer 4 · Dyadic Bonds",
        rangeOrTag: "Per-Actor Edges",
        meaning:
          "Directed trust, warmth, respect, power, grievance, and obligation toward you and other characters.",
        accent: "emerald",
      },
    ],
    howItChanges: [
      "Before updating each turn, elapsed in-world minutes gently relax active emotions and acute threat back toward the character's resting baseline.",
      "During Phase 3, the character evaluates the scene using compact qualitative tags (<feeling>, <want>, <plan>).",
      "After prose finishes in Phase 5, the Clerk records categorical social impacts and grievances, and Python updates continuous state deterministically.",
    ],
    effectOnPlay: [
      "LLMs never see or emit raw decimal floats—CARE converts continuous numbers into clear qualitative directives so small and large models react consistently.",
      "Every turn's CARE snapshot is stored per timeline node, so branching, swiping, or rewinding automatically restores exact emotional and relational state.",
      "Use /wait (or travel across distant map links) to let high arousal and acute danger cool down naturally while long-term bonds remain anchored.",
    ],
    underTheHood: {
      summary:
        "Symmetric Semantic Quantization keeps math deterministic in Python while feeding clean qualitative cues to prompts, with continuous-time exponential decay between turns.",
      items: [
        {
          label: "Acute Threat half-life",
          value: "30 minutes",
          detail: "Situational threat fades quickly once danger passes.",
        },
        {
          label: "Arousal half-life",
          value: "45 minutes",
          detail: "Adrenaline and startle responses settle within an hour of calm.",
        },
        {
          label: "Dominance half-life",
          value: "180 minutes (3 hours)",
          detail: "Feeling cornered or in command lingers across a scene.",
        },
        {
          label: "Composure rest half-life",
          value: "240 minutes (4 hours)",
          detail: "Safe downtime gradually rebuilds a character's emotional mask.",
        },
        {
          label: "Valence half-life",
          value: "360 minutes (6 hours)",
          detail: "Overall warmth or distress shifts slowly across the day.",
        },
        {
          label: "Consolidated Bond anchor",
          value: "14 days",
          detail: "Deep-rooted trust and warmth resist sudden resets after one tense moment.",
        },
      ],
    },
    relatedTopicIds: [
      "care-worldview-temperament",
      "care-mood-composure",
      "care-scene-appraisal",
      "care-dyadic-bonds",
    ],
  },
  {
    id: "care-worldview-temperament",
    subcategoryId: "care",
    title: "Worldview & Temperament (Layer 1)",
    shortTitle: "Worldview & Temperament",
    keywords: [
      "layer 1",
      "worldview",
      "benevolence",
      "belonging",
      "agency",
      "temperament",
      "stoic",
      "volatile",
      "paranoiac",
      "confidant",
      "proud rival",
      "balanced",
    ],
    inOneLine:
      "Layer 1 defines a character's deep-seated existential assumptions and emotional reactivity profile—explaining why two NPCs react very differently to the exact same event.",
    scales: [
      {
        label: "Benevolence",
        rangeOrTag: "-1.0 to +1.0",
        meaning:
          "How fair vs. predatory the character believes the world and other people's motives are.",
        accent: "emerald",
      },
      {
        label: "Belonging",
        rangeOrTag: "-1.0 to +1.0",
        meaning:
          "Rooted ally/protector mindset (+1) versus isolated outsider detachment (-1).",
        accent: "cyan",
      },
      {
        label: "Agency",
        rangeOrTag: "-1.0 to +1.0",
        meaning:
          "Self-determined belief in shaping outcomes (+1) versus fatalistic helplessness (-1).",
        accent: "violet",
      },
      ...TEMPERAMENT_SCALES,
    ],
    howItChanges: [
      "Temperament Archetype, Baseline Mood, Core Drive, and Core Fear are authored on the character's Personality profile.",
      "Active Worldview starts from the character's baseline profile (or Temperament preset) and shifts only slowly through sustained, transformative campaign experiences.",
    ],
    effectOnPlay: [
      "A Guarded Paranoiac discounts small favors and treats insults harshly, whereas a Warm Confidant builds trust quickly but feels betrayal deeply.",
      "A Stoic Guardian holds a thick emotional mask under pressure, while a Volatile Firebrand swings rapidly and leaks feelings right away.",
      "Core Drive and Core Fear act as permanent motivational anchors inside Phase 1 static prompts (Zone 1).",
    ],
    underTheHood: {
      summary:
        "Each Temperament Archetype configures relational inertia, Gottman negativity ratio (how much harder negative events hit than positive ones), trust-step thresholds, and composure resilience.",
      items: TEMPERAMENT_HOOD_ITEMS,
    },
    relatedTopicIds: [
      "care-overview",
      "care-mood-composure",
      "care-dyadic-bonds",
    ],
  },
  {
    id: "care-mood-composure",
    subcategoryId: "care",
    title: "Mood & Composure (PAD · Layer 2)",
    shortTitle: "Mood & Composure (PAD)",
    keywords: [
      "layer 2",
      "valence",
      "arousal",
      "tension",
      "dominance",
      "composure",
      "emotional mask",
      "outward demeanor",
      "expression",
      "portrait",
      "leakage",
    ],
    inOneLine:
      "Layer 2 tracks a character's current emotional coordinates (Valence, Arousal/Tension, Dominance) gated by their Composure & Emotional Mask.",
    scales: [
      {
        label: "Valence (Distressed ↔ Warm)",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Overall emotional tone from distressed/hostile (rose) to warm/pleased (emerald).",
        accent: "emerald",
      },
      {
        label: "Arousal / Tension",
        rangeOrTag: "0.00 to 1.00",
        meaning:
          "Physiological activation and alertness—from calm/sedate to wired, frantic, or explosive.",
        accent: "amber",
      },
      {
        label: "Dominance (Cornered ↔ Commanding)",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Perceived social or tactical leverage in the moment: cornered/submissive (-) vs. commanding (+).",
        accent: "cyan",
      },
      {
        label: "Composure & Emotional Mask",
        rangeOrTag: "0% to 100%",
        meaning:
          "Self-control shielding raw feelings. Below 35% (rose), cracks and involuntary somatic tells leak into prose.",
        accent: "violet",
      },
    ],
    howItChanges: [
      "Phase 3 emotional tags (<feeling> tone, intensity, agency) nudge PAD coordinates through a composure-gated filter.",
      "Acute threat and shocks drain Composure toward a threat- and coping-scaled equilibrium floor rather than flatlining permanently at 0%.",
      "Coping-assisted steadying helps characters recover part of their poise during lulls and short /wait pauses under moderate threat, while calm scenes and longer /wait advances restore Arousal (45m half-life), Dominance (3h), Composure (4h), and Valence (6h) toward baseline.",
    ],
    effectOnPlay: [
      "High Composure dampens wild turn-to-turn emotional swings and lets an NPC project a cool Outward Demeanor even while inwardly uneasy.",
      "When Composure drops below 35%, CARE allows somatic leakage—trembling hands, clipped breathing, flushed voice—into Phase 4 directives.",
      "Layer 2 resolves a discrete Expression (happy, sad, afraid, angry, disgusted, surprised, contempt, or default) that swaps character portraits in the UI.",
    ],
    underTheHood: {
      summary:
        "Discretized Ornstein-Uhlenbeck mean reversion combined with a Composure-Gated Kalman Gain resists single-turn noise unless a severe shock triggers bypass strain.",
      items: [
        {
          label: "Somatic Leakage Threshold",
          value: "Composure < 35% (0.35)",
          detail: "Mask breaks; involuntary physical tells surface in outward demeanor.",
        },
        {
          label: "Composure Damper (Beta)",
          value: "2.0 × resilience",
          detail: "High composure scales down Kalman gain on routine emotional fluctuations.",
        },
        {
          label: "Shock Bypass (Psi)",
          value: "3.5× gain multiplier",
          detail: "Severe shocks bypass the composure damper and strain the mask directly.",
        },
        {
          label: "Strain Coefficient (Eta)",
          value: "0.14",
          detail: "Controls how fast threat + vulnerability erode Composure per turn.",
        },
      ],
    },
    relatedTopicIds: [
      "care-overview",
      "care-worldview-temperament",
      "care-scene-appraisal",
      "directing-narrator-clock",
    ],
  },
  {
    id: "care-scene-appraisal",
    subcategoryId: "care",
    title: "Scene Appraisal & Intent (Layer 3)",
    shortTitle: "Scene Appraisal & Intent",
    keywords: [
      "layer 3",
      "appraisal",
      "threat",
      "coping",
      "goal fit",
      "goal congruence",
      "surprise",
      "ambiguity",
      "want",
      "plan",
      "cognition",
    ],
    inOneLine:
      "Layer 3 captures how a character tactically reads the immediate room—Threat, Coping, Goal Fit, and Surprise—to form their Active Scene Want and Tactical Plan.",
    scales: [
      {
        label: "Threat",
        rangeOrTag: "0% to 100%",
        meaning:
          "Immediate perceived physical, social, or exposure danger in the active scene.",
        accent: "rose",
      },
      {
        label: "Coping",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Confidence in handling the situation: overwhelmed (-) vs. adequate/mastery (+).",
        accent: "cyan",
      },
      {
        label: "Goal Fit",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Whether recent turns help (+1) or obstruct (-1) what the character wants right now.",
        accent: "emerald",
      },
      {
        label: "Surprise",
        rangeOrTag: "0% to 100%",
        meaning:
          "Unexpectedness or ambiguity of current events—spikes when sudden twists occur.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Updated every turn from Phase 3 <feeling> threat/coping attributes alongside Phase 5 social/hazard outcomes.",
      "High Threat combined with negative Coping rapidly drains Layer 2 Composure and Dominance.",
      "Acute Threat decays rapidly with a 30-minute half-life once the scene stabilizes.",
    ],
    effectOnPlay: [
      "Active Scene Want summarizes what the NPC is pursuing right now; Active Tactical Plan captures their next concrete move.",
      "If a character feels overwhelmed (negative Coping + high Threat), their cognition shifts toward deflection, retreat, or crisis containment rather than bold offense.",
      "Staged Director Choices (/choice) and d20 outcomes inject directly alongside Layer 3 appraisal inside Phase 3 private <cognition>.",
    ],
    underTheHood: {
      summary:
        "Backend stores Goal Fit as `goal_congruence` and Surprise as `ambiguity` inside `SituationalAppraisal`, decaying acute threat toward zero with LN(2)/30 per minute.",
      items: [
        {
          label: "Phase 3 Categorical Inputs",
          value: "threat (none..critical) · coping (overwhelmed..mastery)",
          detail: "Discrete XML attributes parsed from private <cognition> blocks.",
        },
        {
          label: "Acute Threat Half-Life",
          value: "30 minutes",
          detail: "Shortest CARE decay timer; cleared rapidly by /wait or safe travel.",
        },
      ],
    },
    relatedTopicIds: [
      "care-mood-composure",
      "care-dyadic-bonds",
      "dice-director-choices",
    ],
  },
  {
    id: "care-dyadic-bonds",
    subcategoryId: "care",
    title: "Dyadic Relational Bonds (Layer 4)",
    shortTitle: "Dyadic Relational Bonds",
    keywords: [
      "layer 4",
      "bonds",
      "warmth",
      "trust",
      "respect",
      "power",
      "grievance",
      "obligation",
      "indebted",
      "owed debt",
      "witness coupling",
      "chart",
      "history",
    ],
    inOneLine:
      "Layer 4 tracks how a character specifically feels about you and every other known actor across Warmth, Trust, Respect, Power, Grievance, and Obligation.",
    scales: [
      {
        label: "Warmth",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Personal fondness or hostility toward that actor (does not require trusting them).",
        accent: "emerald",
      },
      {
        label: "Trust",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Confidence that the actor is reliable, honest, and won't betray them.",
        accent: "cyan",
      },
      {
        label: "Respect",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Admiration for competence, resolve, or stature—especially decisive for Proud Rivals.",
        accent: "violet",
      },
      {
        label: "Power",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Perceived leverage balance: whether the target holds upper hand (+) or the character does (-).",
        accent: "amber",
      },
      {
        label: "Grievance",
        rangeOrTag: "0% to 100%",
        meaning:
          "Accumulated resentment from slights or grave wrongs; resists quick flattery until addressed.",
        accent: "rose",
      },
      {
        label: "Obligation",
        rangeOrTag: "-1.00 to +1.00",
        meaning:
          "Favor ledger: Indebted (+) means the NPC owes the target; Owed Debt (-) means the target owes them.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Phase 5 Clerk scores directed interactions on a 5-point ordinal scale (strong negative to strong positive) plus Grievance shifts (reconciled, eased, none, slighted, grave wrong).",
      "Public room actions trigger Co-Present Witness Coupling: bystanders in the same room adjust their bonds with you based on what they saw and how allied they are with the target.",
      "Local @Character whispers keep relational shifts strictly between you and that character.",
    ],
    effectOnPlay: [
      "Strong positive or negative bonds change tone, candor, willingness to share secrets, and whether an NPC accepts /party invitations.",
      "Un-aggrieved guarded strangers (including Guarded Paranoiacs) thaw slowly through consistent positive actions, whereas once genuine grievance or deep hostility sets in, Negative Sentiment Override blocks cheap flattery until costly proof or reconciliation.",
      "Negative shocks hit harder than positive compliments (scaled by Temperament negativity ratio).",
      "Click any bond card on a character's Current tab to expand its turn-by-turn line chart (toggle Grievance/Obligation pills, switch All / Last 25 on long branches, and inspect per-turn episodic notes).",
    ],
    underTheHood: {
      summary:
        "Each edge pairs fast dynamic signals with slow 14-day consolidated anchors (`consolidated_warmth`, `consolidated_trust`), Weber-Fechner diminishing returns, and Gottman override dampening.",
      items: [
        {
          label: "Two-Timescale Consolidation",
          value: "14-day anchor half-life",
          detail: "Long-time allies don't drop to strangers after one awkward exchange.",
        },
        {
          label: "Gottman Negativity Override",
          value: "Base slope 1.35 × negativity_ratio",
          detail: "Betrayals carry multiplied weight scaled by the character's Temperament.",
        },
        {
          label: "Chart Filtering",
          value: "Excludes __arrival__ waypoints",
          detail: "Bond charts plot narrative turns starting from the first turn that actor appeared.",
        },
      ],
    },
    relatedTopicIds: [
      "care-worldview-temperament",
      "directing-whispers-privacy",
      "spatial-parties",
    ],
  },

  // =========================================================================
  // 2. Dice & Action Resolution
  // =========================================================================
  {
    id: "dice-modes",
    subcategoryId: "dice",
    title: "d20 Modes (Auto, Forced, Disabled)",
    shortTitle: "d20 Modes",
    keywords: [
      "d20",
      "dice",
      "auto",
      "forced",
      "disabled",
      "dc",
      "modifier",
      "check",
      "contested",
      "hazard",
      "bystander",
      "/search",
    ],
    inOneLine:
      "The footer dice pill controls whether Phase 1 triggers real 1d20 + modifier checks automatically, forces a roll on every turn, or suppresses dice for pure dialogue.",
    scales: [
      {
        label: "Auto (Default)",
        rangeOrTag: "auto",
        meaning:
          "Phase 1 Clerk decides when an uncertain/risky action needs a roll, assigning skill, DC (5–25), and modifier (-5 to +8).",
        accent: "cyan",
      },
      {
        label: "Forced",
        rangeOrTag: "forced · 1–20",
        meaning:
          "Guarantees a d20 check on this turn. Leave the override box blank for a random 1–20 roll, or pin an exact natural roll.",
        accent: "amber",
      },
      {
        label: "Disabled",
        rangeOrTag: "disabled",
        meaning:
          "Skips dice rolls for slice-of-life or pure roleplay scenes (automatically promoted to Auto if gated choices or blocked exits require a check).",
        accent: "muted",
      },
    ],
    howItChanges: [
      "Click the dice pill in the bottom-right composer footer to cycle Auto → Forced → Disabled.",
      "Staging gated Director Choices (/choice with @success, @fail, etc.) or stepping onto Blocked/Obstacle exits promotes Disabled to Auto automatically.",
      `${SEARCH_SPEC.syntax} forces a fixed DC ${DEFAULT_GATE_DC} room-search roll even in empty rooms (promoting Disabled to Forced; pinned manual rolls are respected but disable Crit prop auto-spawn).`,
      "Narrator turns (/look, /wait, /event, /narrate) never roll dice.",
    ],
    effectOnPlay: [
      "Phase 1 supports multiple per-character check roles on a single turn: active attempts, contested reactions, scene hazards, and co-present bystanders.",
      "Every roll resolves before Phase 3 cognition so NPC thoughts and Phase 4 prose must respect the dice result.",
    ],
    underTheHood: {
      summary:
        "Phase 1 evaluates player intent, location obstacles, and character checks before assembling Zone 4 roll directives.",
      items: [
        {
          label: "Check Roles",
          value: "active_attempt · contested_reaction · scene_hazard · co_present_bystander",
        },
        {
          label: "DC & Modifier Clamps",
          value: "DC 5–25 · Modifier -5 to +8",
        },
      ],
    },
    relatedTopicIds: [
      "dice-outcome-tiers",
      "dice-director-choices",
      "spatial-links-travel",
    ],
  },
  {
    id: "dice-outcome-tiers",
    subcategoryId: "dice",
    title: "The 5 Outcome Tiers",
    shortTitle: "5 Outcome Tiers",
    keywords: [
      "outcome tier",
      "critical failure",
      "critical success",
      "clean success",
      "simple failure",
      "consequences",
      "margin",
      "nat 1",
      "nat 20",
    ],
    inOneLine:
      "Every d20 check classifies into 5 narrative tiers where natural 1 and natural 20 always override total margin against Difficulty Class (DC).",
    scales: [
      {
        label: "Critical Success",
        rangeOrTag: "d20 = 20 or margin ≥ +5",
        meaning:
          "Attempt succeeds with outstanding flair, extra advantage, or bonus insight.",
        accent: "emerald",
      },
      {
        label: "Clean Success",
        rangeOrTag: "0 ≤ margin ≤ +4",
        meaning:
          "Attempt succeeds smoothly as intended without unexpected complications.",
        accent: "cyan",
      },
      {
        label: "Simple Failure",
        rangeOrTag: "-2 ≤ margin ≤ -1",
        meaning:
          "Clean miss or narrow shortfall without piling on extra disasters.",
        accent: "amber",
      },
      {
        label: "Failure with Consequences",
        rangeOrTag: "-5 ≤ margin ≤ -3",
        meaning:
          "Attempt fails with noticeable resistance, lost leverage, or secondary trouble.",
        accent: "amber",
      },
      {
        label: "Critical Failure",
        rangeOrTag: "d20 = 1 or margin ≤ -6",
        meaning:
          "Catastrophic backfire with severe fallout—Phase 4 prose is forbidden from narrating success.",
        accent: "rose",
      },
    ],
    howItChanges: [
      "Margin is computed deterministically as (d20_raw + modifier) - DC after checking strict natural 1 and natural 20 precedence.",
    ],
    effectOnPlay: [
      "Outcome tiers inject strict plan and narrative directives into Phase 3 cognition and Phase 4 prose so models cannot soft-retcon failures into wins.",
      "Critical Success and Critical Failure turns automatically boost episodic salience (+2), keeping pivotal moments in full summary memory longer.",
    ],
    relatedTopicIds: [
      "dice-modes",
      "dice-director-choices",
      "memory-3-tier",
    ],
  },
  {
    id: "dice-director-choices",
    subcategoryId: "dice",
    title: "Director Choices (/choice)",
    shortTitle: "Director Choices",
    keywords: [
      "choice",
      "choices",
      "director",
      "gate",
      "odds",
      "dc",
      "coerced",
      "complied",
      "slash",
    ],
    inOneLine:
      "Director Choices let you steer what an NPC chooses to do next—optionally gating options behind d20 outcome tiers—without writing their dialogue yourself.",
    scales: [
      {
        label: "Slash Syntax",
        rangeOrTag: CHOICE_SPEC.syntax,
        meaning: `Stage up to ${MAX_CHOICE_OPTIONS} options per present character (default DC ${DEFAULT_GATE_DC}).`,
        accent: "cyan",
      },
      {
        label: "Gate Tags",
        rangeOrTag: "@any · @success · @crit · @fail · @critfail",
        meaning:
          "Restrict which options remain eligible depending on the turn's resolved outcome tier.",
        accent: "violet",
      },
      {
        label: "Compliance Badges",
        rangeOrTag: "followed · coerced · free_fallback",
        meaning:
          "Cognition cards show whether the NPC complied naturally, was coerced within bounds, or hit free fallback when every gate was eliminated.",
        accent: "emerald",
      },
    ],
    howItChanges: [
      "Open the Choices tray in the composer or type /choice ...; submitting with an empty message box continues the scene straight from your staged choices.",
      "Staging gated options displays live backend odds per outcome tier and automatically upgrades Disabled dice mode to Auto.",
    ],
    effectOnPlay: [
      "Available options are presented inside Phase 3 <cognition> so characters weigh them against their CARE mood and bonds before speaking.",
      "Cannot be combined with Narrator commands (/look, /wait, /event, /narrate).",
    ],
    underTheHood: {
      summary:
        "Choice odds are evaluated server-side (`POST /api/mechanics/choice-preview`) across all 20 faces of the d20 using the active DC, modifier, and any pinned roll.",
      items: [
        {
          label: "Gate Mapping",
          value: "@success → Clean/Crit · @crit → Crit Success · @fail → Any Failure · @critfail → Crit Failure",
        },
        {
          label: "Example",
          value: CHOICE_SPEC.example,
        },
      ],
    },
    relatedTopicIds: [
      "dice-modes",
      "dice-outcome-tiers",
      "care-scene-appraisal",
    ],
  },

  // =========================================================================
  // 3. Directing & Privacy
  // =========================================================================
  {
    id: "directing-whispers-privacy",
    subcategoryId: "directing",
    title: "Whispers, Remote Comms & Privacy (@Character:)",
    shortTitle: "Whispers & Privacy",
    keywords: [
      "whisper",
      "mention",
      "@",
      "remote",
      "comms",
      "privacy",
      "isolation",
      "quotes",
      "solo",
      "epistemic",
    ],
    inOneLine:
      "Use @Character Name: blocks to privately address one person in the room, feed hidden sensory/GM cues, or reach an off-site ally over remote comms without breaking room privacy.",
    scales: [
      {
        label: "Shared Public Action",
        rangeOrTag: "Outside @Name:",
        meaning:
          "Observed by every character physically present in the active location and kept in shared history.",
        accent: "cyan",
      },
      {
        label: "Local Whisper (In Room)",
        rangeOrTag: '@Name: "speech" + cue',
        meaning:
          'Text inside "double quotes" is spoken dialogue for that character; unquoted text is private perception/GM guidance hidden from peers and scrubbed from summaries.',
        accent: "violet",
      },
      {
        label: "Remote Comms (Off-Site)",
        rangeOrTag: "@Name: (Elsewhere)",
        meaning:
          "Reaches an off-site participant over radio/comms, updating their mood and bond without moving them into the room.",
        accent: "emerald",
      },
      {
        label: "Solo / Empty Room",
        rangeOrTag: "0 NPCs Present",
        meaning:
          "Runs lore recall, d20 rolls, secret discovery, and exits normally without pulling or hallucinating absent characters.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Type @ in the composer to open the character mention picker, separating present NPCs from off-site contacts.",
      "Characters only retain Zone 3 verbatim turns from scenes where they were physically present (or remote comms directed specifically to them).",
    ],
    effectOnPlay: [
      "Co-present characters never see private whispers or unquoted cues directed at someone else—preventing accidental omniscient AI leaks.",
      "When Phase 5 seals an episodic summary chunk, private whisper lines are scrubbed first so secrets aren't leaked through shared Zone 2 summaries.",
    ],
    relatedTopicIds: [
      "directing-knowledge-gossip",
      "care-dyadic-bonds",
      "memory-3-tier",
    ],
  },
  {
    id: "directing-narrator-clock",
    subcategoryId: "directing",
    title: "Narrator Mode & World Clock",
    shortTitle: "Narrator & World Clock",
    keywords: [
      "narrator",
      "world clock",
      "time",
      "/look",
      "/wait",
      "/event",
      "/narrate",
      "complication",
      "slash",
    ],
    inOneLine:
      "Narrator mode runs neutral environmental prose, external complications, or explicit time passage via the World Clock without rolling dice or forcing NPC turns.",
    scales: NARRATOR_SCALES,
    howItChanges: [
      "Trigger via the Narrator menu in the composer footer or type /look, /wait, /event, or /narrate directly.",
      `/${LOOK_SPEC.name} stays strictly neutral and highlights visible tracked Location Props without rolling; use ${SEARCH_SPEC.syntax} (DC ${DEFAULT_GATE_DC}, ${SEARCH_COOLDOWN_TURNS}-turn room cooldown) for an active character inspection roll.`,
      "On normal dialogue/action turns, Phase 5 Clerk estimates elapsed minutes; on /wait or map travel, explicit durations advance the World Clock deterministically.",
    ],
    effectOnPlay: [
      "Narrator turns never trigger d20 checks and use a neutral narrator prefix rather than adopting an NPC persona.",
      "Advancing the clock with /wait 2h or long travel relaxes NPC Arousal, acute Threat, Valence, and Composure along CARE's real half-life curves.",
    ],
    underTheHood: {
      summary:
        "Narrator turns bypass character <cognition> unless NPCs react to an external complication, and stamp the updated world_timestamp onto the new turn node.",
      items: [
        {
          label: "Supported /wait Formats",
          value: "30m, 2h, minutes/hours, or free-form pause cues",
        },
        {
          label: "Dice Rule",
          value: "Narrator turns strictly suppress d20 checks (/search is a character action)",
        },
      ],
    },
    relatedTopicIds: [
      "care-overview",
      "spatial-links-travel",
      "dice-modes",
    ],
  },
  {
    id: "directing-knowledge-gossip",
    subcategoryId: "directing",
    title: "Knowledge of You & Gossip",
    shortTitle: "Knowledge & Gossip",
    keywords: [
      "knowledge of you",
      "persona",
      "secrets",
      "gossip",
      "direct",
      "provenance",
      "unlocked",
      "age",
      "lore",
    ],
    inOneLine:
      "NPCs only learn your Player Persona's hidden facts (secret age, concealed items, personal lore) when revealed directly in play or passed along via Gossip.",
    scales: [
      {
        label: "Direct",
        rangeOrTag: "Learned from you",
        meaning:
          "Fact unlocked when you openly showed, wore, or disclosed it in that character's presence.",
        accent: "emerald",
      },
      {
        label: "Gossip",
        rangeOrTag: "Gossiped by NPC",
        meaning:
          "Fact heard secondhand from another NPC who already knew it, tagged with the original source's name.",
        accent: "violet",
      },
    ],
    howItChanges: [
      "Phase 5 Clerk inspects each turn to unlock newly disclosed Persona keys for co-present witnesses.",
      "Between turns, co-located NPCs with sufficient trust/rapport can propagate known Persona facts to peers via background gossip.",
    ],
    effectOnPlay: [
      "Until a Persona secret is unlocked for a specific NPC, that fact is omitted from their prompts so they cannot meta-read your sheet.",
      "Inspect any NPC's Current tab under Knowledge of You to verify exactly which secrets they know and hover chips for Direct vs. Gossip provenance.",
    ],
    relatedTopicIds: [
      "directing-whispers-privacy",
      "care-dyadic-bonds",
      "memory-lore-flags",
    ],
  },

  // =========================================================================
  // 4. Parties, Map & Travel
  // =========================================================================
  {
    id: "spatial-parties",
    subcategoryId: "spatial",
    title: "Parties & Strict Co-Location (/party)",
    shortTitle: "Parties & Co-Location",
    keywords: [
      "party",
      "parties",
      "co-location",
      "invite",
      "kick",
      "leave",
      "disband",
      "npc party",
      "leader",
      "persuasion",
    ],
    inOneLine:
      "Parties group co-located characters so companions travel together across exits while enforcing strict same-room co-location and single-party membership.",
    scales: [
      {
        label: PARTY_SPEC.syntax,
        rangeOrTag: "In-Character",
        meaning:
          "Invite co-located NPCs, kick companions, leave, or disband via a narrative turn (with scoped @Name autocomplete).",
        accent: "violet",
      },
      {
        label: "Player Party",
        rangeOrTag: "In Party",
        meaning:
          "Companions who follow you automatically across Exits, prose travel, and Narrator travel unless they choose to stay behind.",
        accent: "emerald",
      },
      {
        label: "NPC-Only Party",
        rangeOrTag: "NPC Party · Leader",
        meaning:
          "Groups of 2+ co-located NPCs traveling together under an elected leader (created via Party modal or when you leave 2+ companions behind).",
        accent: "cyan",
      },
    ],
    howItChanges: [
      "Invited NPCs weigh CARE trust/warmth/grievance, active goals, existing NPC-party ties, and any Social/Persuasion d20 check inside Phase 3 cognition.",
      "If a party splits across rooms, any 2+ cluster staying together remains an NPC-only party while isolated singletons leave cleanly.",
      "Relocating an NPC out of the room (via Current tab or Party modal) removes them from that party automatically.",
    ],
    effectOnPlay: [
      "Non-party NPCs stay behind in their current room when you depart rather than teleporting silently with you.",
      "Party membership is snapshotted per turn node, so branching, swiping, or deleting restores exact group lineups.",
    ],
    underTheHood: {
      summary:
        "Strict command validation blocks misspelled, off-site, or ineligible @Name targets instead of falling back to inviting the entire room.",
      items: (PARTY_SPEC.subcommands ?? []).map((sub) => ({
        label: sub.syntax,
        value: sub.description,
      })),
    },
    relatedTopicIds: [
      "spatial-links-travel",
      "care-dyadic-bonds",
      "gm-overrides-locks",
    ],
  },
  {
    id: "spatial-hierarchy-portals",
    subcategoryId: "spatial",
    title: "Locations, Containers & Portals",
    shortTitle: "Locations & Portals",
    keywords: [
      "location",
      "container",
      "portal",
      "entry/exit",
      "ghost stub",
      "arrival",
      "depth",
      "hierarchy",
      "building",
      "district",
      "props",
      "location props",
    ],
    inOneLine:
      "Worlds organize Level 0 Locations inside nested Level 1–4 Containers connected across thresholds by [Entry/Exit Portal] rooms and cross-boundary links.",
    scales: CONTAINER_DEPTH_SCALES,
    howItChanges: [
      "Opening or entering an interior building/structure drills inside its Level 1 Container, rendering exterior destinations as Ghost Stubs.",
      "Crossing outside a building uses designated [Entry/Exit Portal] threshold rooms so indoor hallways don't leak straight onto city highways.",
      "Entering an unvisited location or container emits collapsible First-Visit Arrival descriptions/visuals in chat (zero LLM prompt bloat).",
    ],
    effectOnPlay: [
      "Phase 2 injects hierarchical <spatial_hierarchy> breadcrumbs and Level 1 ambient lore so characters understand where they are in the world.",
      "Only Level 0 Locations and Level 1 Containers carry local lore nodes; tracked portable Location Props attach exclusively to Level 0 Locations and stay excluded from World Codex and RAG.",
    ],
    relatedTopicIds: [
      "spatial-links-travel",
      "memory-lore-flags",
      "gm-mode",
    ],
  },
  {
    id: "spatial-links-travel",
    subcategoryId: "spatial",
    title: "Links, Travel Time & Secret Passages",
    shortTitle: "Links & Secret Passages",
    keywords: [
      "link",
      "edge",
      "distance",
      "metric",
      "speed modifier",
      "travel time",
      "blocked",
      "obstacle",
      "secret passage",
      "secret link",
      "distance rule",
      "flexible",
      "locked",
      "non-euclidean",
      "vertical",
      "spatial anchor",
      "consistency",
      "reconcile",
    ],
    inOneLine:
      "Every map connection carries a metric distance, Distance Rule (Flexible, Locked, or Non-Euclidean), optional Vertical transition flag, speed modifier, obstacles/blocked flags, and optional Secret gating.",
    scales: [
      {
        label: "Metric Distance & Base Pace",
        rangeOrTag: `m / km · ${WALKING_METERS_PER_MINUTE}m/min`,
        meaning:
          "Default walking pace (~4.2 km/h) sets a deterministic travel duration floor on the World Clock when crossing a link.",
        accent: "cyan",
      },
      {
        label: "Distance Rules & Vertical",
        rangeOrTag: "Flexible / Locked / Non-Euclidean",
        meaning:
          "Flexible links adjust during consistency reconciliation; Locked links act as fixed ground truth; Non-Euclidean links (magic portals, folded space) bypass 2D geometry checks; Vertical links add 0m horizontal offset while keeping travel meters/time.",
        accent: "cyan",
      },
      {
        label: "Speed Modifier",
        rangeOrTag: `${MIN_EDGE_SPEED_MODIFIER}× to ${MAX_EDGE_SPEED_MODIFIER}×`,
        meaning:
          "Scales pace for terrain or transit—from Crawl/Swamp (0.25×–0.3×) up to Rail (25×) or High-Speed Air (60×).",
        accent: "emerald",
      },
      {
        label: "Blocked & Obstacles",
        rangeOrTag: "Auto-Check",
        meaning:
          "Exits marked Blocked or carrying Obstacles automatically trigger Auto dice checks (unless Forced) when traversed.",
        accent: "amber",
      },
      {
        label: "Secret Passages",
        rangeOrTag: "Hidden Until Found",
        meaning:
          "Excluded from Exits (N), Mini-Map, Full Map, Phase 1/Zone 4 prompts, and Neuromancer until discovered in play (or revealed in GM Mode).",
        accent: "violet",
      },
    ],
    howItChanges: [
      "Shift+Click any map distance badge to toggle an instant speed-adjusted duration preview; double-click a link badge (when editing is unlocked) to edit metric distance inline.",
      "Containerized Level 0 locations can pin an External Spatial Anchor so upper/outer container distances constrain underground/interior links; open Consistency in the map toolbar to inspect diagnostics, Preview Reconciliation, or enable Auto-Sync Unlocked Links.",
      "In play, succeeding on a discovery roll or searching when dice are Disabled reveals both directions of a Secret Link on the active timeline branch.",
    ],
    effectOnPlay: [
      "Travel time derived from a link prevents instant cross-city teleports from passing 0 minutes—long transit visibly advances the clock and decays CARE states.",
      "Even when GM Mode shows secret ghost links visually on your map, AI characters still cannot use or mention unrevealed passages.",
    ],
    underTheHood: {
      summary:
        "Traversal duration floor formula: `distance_meters / (WALKING_METERS_PER_MINUTE * speed_modifier)` minutes (minimum 1m when nonzero). Authoring consistency uses a 2D compass-vector solver (Schur-complement weighted reconciliation) purely at edit time.",
      items: [
        {
          label: "Base Walking Speed",
          value: `${WALKING_METERS_PER_MINUTE} m/min (4.2 km/h)`,
        },
        ...SPEED_PRESET_HOOD_ITEMS,
      ],
    },
    relatedTopicIds: [
      "spatial-hierarchy-portals",
      "spatial-physical-stance",
      "directing-narrator-clock",
      "gm-mode",
    ],
  },
  {
    id: "spatial-physical-stance",
    subcategoryId: "spatial",
    title: "Physical Stance & Motion Continuity",
    shortTitle: "Physical Stance",
    keywords: [
      "stance",
      "posture",
      "position",
      "motion",
      "continuity",
      "prone",
      "stomach",
      "kneeling",
      "crouching",
      "sitting",
      "restrained",
      "incapacitated",
      "physical context",
    ],
    inOneLine:
      "Tracks each present NPC's and the Player's bodily stance and micro-position across turns so characters do not teleport out of cover, kneel abruptly after lying prone, or shrug off restraints.",
    scales: [
      {
        label: "Canonical Stances",
        rangeOrTag: `${PHYSICAL_STANCE_OPTIONS.length} Stances`,
        meaning: PHYSICAL_STANCE_OPTIONS.map((opt) => opt.label).join(" · "),
        accent: "cyan",
      },
      {
        label: "Position Context",
        rangeOrTag: `<= ${MAX_PHYSICAL_CONTEXT_LENGTH} chars`,
        meaning:
          "Concise anchor capturing body orientation (on stomach/back/side), room cover, hands/props, or physical contact.",
        accent: "emerald",
      },
      {
        label: "Smart Staleness Reset",
        rangeOrTag: `Travel / >=${STALE_TIME_SKIP_MINUTES}m`,
        meaning:
          "Relocating rooms or skipping 30+ minutes clears untouched pose context (moving -> Standing, time skip -> Unspecified) while keeping Restrained/Incapacitated intact.",
        accent: "amber",
      },
      {
        label: "Manual Overrides",
        rangeOrTag: "Always Available",
        meaning:
          "Edit live in the right-pane Here persona card, Codex → Current, or Codex → Player Persona without needing GM Mode.",
        accent: "violet",
      },
    ],
    howItChanges: [
      "Phase 5 World Clerk (for You) and Character State Agents (for present NPCs) carry forward prior physical state verbatim unless turn prose depicts an explicit bodily or micro-spatial change.",
      "Zone 4 injects non-unspecified positions as Starting Physical State—explicitly framed as a starting point, never a static lock—paired with a blocking continuity cue.",
      "Zone 1 renders static character card Posture separately as Habitual Bearing so lasting mannerisms never collide with transient turn poses.",
    ],
    effectOnPlay: [
      "Both Phase 3 Cognition and Phase 4 Prose account for starting physical constraints (such as scrambling up from Lying Down before rushing an exit, or fighting while Restrained).",
      "Turn Clerk inspection modals display exact before -> after stance diffs and note whenever travel or a time skip triggered an automatic staleness reset.",
    ],
    underTheHood: {
      summary:
        "Zero extra LLM calls: physical fields piggyback on WorldPostTurnDelta and CharacterAgentDelta, silently omitted from prompts whenever Unspecified + empty.",
      items: PHYSICAL_STANCE_OPTIONS.map((opt) => ({
        label: opt.label,
        value: opt.value,
        detail: opt.shortHint,
      })),
    },
    relatedTopicIds: [
      "spatial-links-travel",
      "gm-overrides-locks",
      "directing-narrator-clock",
    ],
  },

  // =========================================================================
  // 5. Memory, Lore & Context
  // =========================================================================
  {
    id: "memory-3-tier",
    subcategoryId: "memory",
    title: "How the AI Remembers (3-Tier Memory)",
    shortTitle: "3-Tier Memory",
    keywords: [
      "memory",
      "working memory",
      "episodic",
      "summary",
      "synopsis",
      "lod",
      "shard",
      "rag",
      "rrf",
      "mmr",
      "compaction",
    ],
    inOneLine:
      "CyberCantina layers verbatim Working Memory, sealed Episodic Summaries with Level-of-Detail compression, and Hybrid RRF/MMR long-term vector recall.",
    scales: [
      {
        label: "Tier 1 · Working Memory",
        rangeOrTag: "Zone 3 · 12 turns",
        meaning:
          "Recent verbatim turns filtered strictly to rooms where that NPC was present (with private whispers to others removed).",
        accent: "emerald",
      },
      {
        label: "Tier 2 · Episodic Summaries",
        rangeOrTag: "Zone 2 · LOD Cascade",
        meaning:
          "Older 6-turn slices sealed into narrative Episode chunks; newest/pivotal stay full summaries while ancient ones fold to 1-line synopses.",
        accent: "violet",
      },
      {
        label: "Tier 3 · Long-Term Shards & Vectors",
        rangeOrTag: "Zone 4 · Hybrid Search",
        meaning:
          "Character Memory Shards, Lore, and Episode chunks ranked by BM25/IDF + embedding MMR and dynamically elevated when recalled.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Once active history exceeds working_memory_turns (default 12), Phase 5 Clerk compresses the oldest 6-turn slice into an EpisodicChunkRecord.",
      "High-salience episodes (critical d20 rolls, shattered composure, room transitions, secret reveals) resist LOD synopsis compression longer.",
      "After 40 turns, unpromoted clerk_ephemeral character shards compact into permanent Memory Shards without losing key facts.",
    ],
    effectOnPlay: [
      "Even after 50+ turns, recalling an old episode dynamically elevates its matching verbatim turns (strictly gated by room presence) into Zone 4.",
      "Phase 3 reserves up to 2 personal character_shard slots so global world lore never crowds out an NPC's own core memories.",
    ],
    underTheHood: {
      summary:
        "Default memory pipeline parameters (tunable in User Profile / Server Settings).",
      items: [
        { label: "Working Memory Default / Floor", value: "12 turns (min 4 protected)" },
        { label: "Episodic Chunk Size / Full LOD Cap", value: "6 turns / 6 full chunks" },
        { label: "High-Salience LOD Bonus", value: "salience ≥ 8 → +2 longevity positions" },
        { label: "Ephemeral Shard Compaction", value: "40 turns (superseded cleanly per branch)" },
      ],
    },
    relatedTopicIds: [
      "memory-context-health",
      "memory-lore-flags",
      "timelines-branching",
    ],
  },
  {
    id: "memory-context-health",
    subcategoryId: "memory",
    title: "Context Health & 4-Zone Economy",
    shortTitle: "Context Health & Zones",
    keywords: [
      "context health",
      "4-zone",
      "kv cache",
      "tokens",
      "phase 1",
      "phase 3",
      "phase 4",
      "phase 5",
      "num_ctx",
      "truncation",
    ],
    inOneLine:
      "Every Actor turn partitions prompts into 4 cache-friendly Zones, and the Context Health pill monitors token headroom across all 4 LLM phases.",
    scales: [
      {
        label: "Zone 1 · Static Prefix",
        rangeOrTag: "Cached Forever",
        meaning:
          "World genre/rules, character identity, drives, voice anchors, and public persona summary—byte-identical across turns.",
        accent: "cyan",
      },
      {
        label: "Zone 2 · Episodic Summaries",
        rangeOrTag: "Shared Semi-Static",
        meaning:
          "Sealed Episode summaries shared across characters; capped at 45% of remaining history budget during tight context windows.",
        accent: "violet",
      },
      {
        label: "Zone 3 · Working Memory",
        rangeOrTag: "Recent Verbatim",
        meaning:
          "Last N turns; protects at least 4 turns before Zone 2 LOD chunks are cascaded or dropped.",
        accent: "emerald",
      },
      {
        label: "Zone 4 · Ephemeral Frame",
        rangeOrTag: "Tail Volatility",
        meaning:
          "World Clock, exits, scene flags, budget-packed RAG recalls, CARE state, d20 results, cognition directives, and your message.",
        accent: "amber",
      },
      ...PHASE_CONTEXT_SCALES,
    ],
    howItChanges: [
      "Click the 4-bar Context Health pill in the top stage header (Green / Amber / Red) after any turn—or via a turn's Prose Model Pill—to inspect Telemetry, Scene & Recall (flags and recalled items), and the searchable Lore Index.",
      "When local endpoints (like Ollama num_ctx) near their limit, overflow protection cascades oldest Zone 2 summaries down to synopses before trimming recent turns.",
    ],
    effectOnPlay: [
      "Keeping volatile data in Zone 4 preserves local KV-cache prefixes so turns respond much faster on Ollama, llama.cpp, and vLLM.",
      "If Context Health turns Amber or Red, you can raise context_size, lower working_memory_turns, or compact lore without losing earlier summaries.",
    ],
    underTheHood: {
      summary:
        "Two-form RAG packing (`recall_budget_prose_tokens = 450`, `recall_budget_cognition_tokens = 220`) guarantees Rank 0 in full form while squeezing more breadth via 1-line summaries.",
      items: [
        { label: "Zone 2 Budget Share Cap", value: "45% of history budget" },
        { label: "Zone 3 Protected Floor", value: "4 turns (min_working_memory_turns)" },
      ],
    },
    relatedTopicIds: [
      "memory-3-tier",
      "memory-lore-flags",
    ],
  },
  {
    id: "memory-lore-flags",
    subcategoryId: "memory",
    title: "Lore Recall, Secrets & Scene Flags",
    shortTitle: "Lore, Secrets & Flags",
    keywords: [
      "lore",
      "secret",
      "scene flags",
      "internals",
      "recalled",
      "artifact",
      "fifo",
      "rag",
      "props",
      "hidden props",
      "/search",
      "auto-spawn",
    ],
    inOneLine:
      "Global, Location, Level 1 Container, Artifact lore, and hidden Location Props stay spoiler-gated until discovered, while Scene Flags track temporary room state via FIFO inside Context Health → Scene & Recall.",
    scales: [
      {
        label: "World / Artifact Lore",
        rangeOrTag: "Hybrid Recalled",
        meaning:
          "Recalled automatically into Zone 4 via keywords/embeddings; equipped Artifacts link directly to World Codex entries.",
        accent: "violet",
      },
      {
        label: "Location & L1 Container Lore",
        rangeOrTag: "Room-Scoped",
        meaning:
          "Active room lore injects deterministically; secret entries stay hidden from UI/Phase 1 until revealed in public prose.",
        accent: "cyan",
      },
      {
        label: "Location Props & /search",
        rangeOrTag: `DC ${DEFAULT_GATE_DC} · ${SEARCH_COOLDOWN_TURNS}-turn cooldown`,
        meaning:
          "Tracked Level 0 portable items (excluded from Codex/RAG). Visible props hint on /look; hidden props unlock on Clean/Critical Success via /search or discovery rolls. Optional Critical auto-spawn creates 1 bounded utility prop in an empty room.",
        accent: "amber",
      },
      {
        label: "Scene Flags",
        rangeOrTag: "FIFO · Max 10",
        meaning:
          'Short-lived tactical state markers (e.g., "alarm tripped", "vault door ajar") updated each turn by Phase 5 Clerk.',
        accent: "emerald",
      },
    ],
    howItChanges: [
      "Phase 5 Clerk detects when the substance of a secret location/container lore entry is spoken or uncovered in public prose and reveals it on that branch.",
      "When a Player or co-present NPC explicitly picks up a visible room prop, Phase 5 Clerk transfers it into their inventory and removes it from the room on that branch.",
      "Scene Flags append on turn resolution and automatically evict oldest flags once the active cap (default 10) is reached.",
    ],
    effectOnPlay: [
      "Open Context Health → Scene & Recall to inspect active Scene Flags and exact Recalled item scores, or switch to Context Health → Lore Index to browse visible shards and lore.",
      "Rewinding or branching prior to a secret reveal re-hides that secret cleanly on the earlier branch.",
    ],
    relatedTopicIds: [
      "memory-3-tier",
      "memory-context-health",
      "gm-mode",
    ],
  },

  // =========================================================================
  // 6. Timelines & Chronicles
  // =========================================================================
  {
    id: "timelines-branching",
    subcategoryId: "timelines",
    title: "Branching, Swiping & Editing",
    shortTitle: "Branching & Swiping",
    keywords: [
      "branch",
      "timeline",
      "swipe",
      "edit",
      "delete",
      "rewind",
      "checkout",
      "multiverse",
    ],
    inOneLine:
      "Campaign history is an acyclic turn tree—letting you Branch from any earlier turn, Swipe responses, or Edit prompts while keeping every state snapshot branch-isolated.",
    scales: [
      {
        label: "Branch",
        rangeOrTag: "Any Earlier Turn",
        meaning:
          "Rewinds the active view to that turn (including Turn #0) without deleting your existing continuation—your next message forks a new timeline.",
        accent: "cyan",
      },
      {
        label: "Swipe / Edit",
        rangeOrTag: "Sibling Variants",
        meaning:
          "Swipe regenerates an alternate reply from the same parent state; Edit revises your latest prompt into a sibling turn. Compare and switch siblings via the compact ‹ v#/N › stepper and preview popover (showing Active, Edited prompt tags, bookmarks, descendant counts, and 1-line previews).",
        accent: "violet",
      },
      {
        label: "Delete",
        rangeOrTag: "Leaf-Only Safe",
        meaning:
          "Removes only a true leaf turn (and unfollowed unbookmarked sibling swipes) using an inline two-tap confirmation (Delete → Confirm?, rendered as a compact trash icon at rest on narrow phones); blocked on interior turns that have descendants.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Checking out another branch tip inside Story → Timelines switches atomically to that branch's lineage.",
    ],
    effectOnPlay: [
      "World Clock, character positions, improvised rooms, secret reveals, parties, inventories, CARE states, episodic summaries, and RAG vectors all switch atomically—zero cross-branch contamination.",
    ],
    relatedTopicIds: [
      "timelines-graph-bookmarks",
      "timelines-major-events",
      "care-overview",
    ],
  },
  {
    id: "timelines-graph-bookmarks",
    subcategoryId: "timelines",
    title: "Branch Graph & Bookmarks",
    shortTitle: "Branch Graph & Bookmarks",
    keywords: [
      "branch graph",
      "bookmark",
      "note",
      "episode",
      "summary",
      "magic wand",
      "unfollowed swipes",
    ],
    inOneLine:
      "Story → Timelines renders your campaign multiverse as a collapsible pan/zoom tree, paired with Bookmarks for out-of-character notes that never leak to the AI.",
    scales: [
      {
        label: "Summarized Episodes",
        rangeOrTag: "+N turns pill",
        meaning:
          "Summarized turn spans fold into stacked episode nodes while keeping Turn #0, recent turns, and your active branch tip expanded.",
        accent: "violet",
      },
      {
        label: "Episode in Progress",
        rangeOrTag: "Spoiler-Safe",
        meaning:
          "Shows when another timeline summarized turns your current branch hasn't sealed yet, with ‹ › controls to preview alternates.",
        accent: "cyan",
      },
      {
        label: "Bookmark Notes",
        rangeOrTag: "100% OOC · Private",
        meaning:
          "Stored on the turn (and retained even if un-bookmarked temporarily); strictly excluded from LLM prompts and vector memory.",
        accent: "amber",
      },
    ],
    howItChanges: [
      "Pan by dragging the canvas with a mouse or single finger, zoom smoothly with the mouse wheel or two-finger pinch gesture on touchscreens, and tap Fit All / Active Leaf to refocus.",
      "Click the Bookmark icon on any narrative turn after Turn #0; click the Magic Wand inside the note editor to ask your Clerk for an objective 1-sentence summary.",
      "Unfollowed same-prompt swipes stay tucked behind +N swipes pills unless bookmarked or toggled via Show swipes.",
    ],
    effectOnPlay: [
      "Click any bookmark in Story → Bookmarks to scroll straight to it on the active branch or locate it on an alternate branch inside the Branch Graph.",
      "Personal bookmark notes help you track theories and pacing without polluting context tokens.",
    ],
    relatedTopicIds: [
      "timelines-branching",
      "timelines-major-events",
      "memory-3-tier",
    ],
  },
  {
    id: "timelines-major-events",
    subcategoryId: "timelines",
    title: "Major Events & Copy-on-Write",
    shortTitle: "Major Events & CoW",
    keywords: [
      "major events",
      "copy-on-write",
      "cow",
      "history",
      "chronicle",
      "location change",
      "campaign lore",
    ],
    inOneLine:
      "Permanent world-shaking milestones and physical location transformations are recorded chronologically under Story → Major Events using branch-safe Copy-on-Write.",
    scales: [
      {
        label: "World Scope",
        rangeOrTag: "YYYY-MM-DD History",
        meaning:
          "Permanent world-level shifts (e.g., ruler fallen, faction dissolved) saved as branch-scoped World Codex history entries.",
        accent: "amber",
      },
      {
        label: "Location Scope",
        rangeOrTag: "Room Override",
        meaning:
          "Permanent physical or regime changes revise that room's branch-scoped description and environmental tags.",
        accent: "emerald",
      },
    ],
    howItChanges: [
      "Phase 5 Clerk emits Major Events automatically when irreversible milestones occur in play.",
      "With GM Mode enabled, expanded Major Event cards let you edit mistakes or Delete / Revert location transformations.",
    ],
    effectOnPlay: [
      "Reused base Worlds stay pristine across campaigns—all Codex edits, location lore overrides, and Major Events apply strictly to this campaign branch.",
      "Click Jump to Turn #N on any Major Event card to inspect the originating moment in chat.",
    ],
    relatedTopicIds: [
      "timelines-branching",
      "gm-mode",
      "memory-lore-flags",
    ],
  },

  // =========================================================================
  // 7. GM Tools & Overrides
  // =========================================================================
  {
    id: "gm-neuromancer",
    subcategoryId: "gm",
    title: "GM Talk (Neuromancer)",
    shortTitle: "GM Talk (Neuromancer)",
    keywords: [
      "neuromancer",
      "gm talk",
      "ooc",
      "/gm",
      "@mechanics",
      "game rules",
      "draft codex",
      "agentic tools",
      "clerk",
      "spoiler",
    ],
    inOneLine:
      "Neuromancer is your zero-mutation out-of-character GM assistant for recapping turns, querying lore, checking CyberCantina game rules via @mechanics, and drafting human-confirmed Codex entries.",
    scales: [
      {
        label: GM_SPEC.syntax,
        rangeOrTag: formatAliases(GM_SPEC.aliases),
        meaning:
          "Opens the ~50% slide-out drawer above the composer (or sends an OOC question immediately without spending a turn).",
        accent: "violet",
      },
      {
        label: "Spoiler Boundary",
        rangeOrTag: "Tracks GM Mode",
        meaning:
          "Spoiler-Safe hides unrevealed secrets, unvisited areas, and NPC private thoughts; GM Mode unlocks full behind-the-scenes visibility.",
        accent: "emerald",
      },
      {
        label: "GM Agentic Tools (Opt-In)",
        rangeOrTag: "Primary or Clerk Role",
        meaning:
          "Optional native read-only lookups across Codex, turns, cast, and visited rooms—plus lookup_game_rules when @mechanics is active; can run on Clerk while prose stays on Primary.",
        accent: "cyan",
      },
    ],
    howItChanges: [
      "Type @ inside GM Mode to browse or live-search Characters, Lore, Locations, Containers, Turns, and Game Mechanics (@mechanics:).",
      "Reference @mechanics (or pin an article with @mechanics:) whenever you want Neuromancer to inspect CyberCantina rules—leaving normal campaign turns uncluttered; mechanic context carries over for 1 follow-up turn if a mechanic source was cited.",
      "Click any mechanic chip in Sources used to jump directly to its Game Mechanics Codex article, or click Draft Codex on a story reply to prepare an editable World Codex card.",
    ],
    effectOnPlay: [
      "Conversations with Neuromancer never advance the World Clock, mutate CARE states, or pollute story turns.",
      "Confirmed Draft Codex entries save strictly to the active branch and index immediately for future RAG recall.",
    ],
    relatedTopicIds: [
      "gm-mode",
      "timelines-major-events",
      "memory-lore-flags",
    ],
  },
  {
    id: "gm-mode",
    subcategoryId: "gm",
    title: "Unlock Lore & Secrets (GM Mode)",
    shortTitle: "GM Mode",
    keywords: [
      "gm mode",
      "unlock lore",
      "secrets",
      "auto-layout",
      "ghost",
      "spoiler",
      "edit lore",
      "props",
      "search cooldown",
    ],
    inOneLine:
      "Toggling Unlock Lore & Secrets (GM Mode) in World Settings reveals hidden secrets and props, bypasses /search room cooldowns, and unlocks campaign-scoped authoring tools—while AI characters still obey in-game discovery rules.",
    scales: [
      {
        label: "Codex, Map, Props & Index",
        rangeOrTag: "UI-Only Reveal",
        meaning:
          "Shows undiscovered secret lore entries, hidden Location Props, unrevealed Secret Map Links (dashed violet lines), and Reveal/Hide toggles.",
        accent: "amber",
      },
      {
        label: "Editing, Props & Major Events",
        rangeOrTag: "Branch-Scoped CoW",
        meaning:
          "Unlocks adding/editing/deleting campaign Codex lore, Location/L1 lore, Level 0 Location Props (including instant Transfer to Player/NPC), visited room details, and Major Events.",
        accent: "violet",
      },
      {
        label: "Scoped Auto-Layout & /search",
        rangeOrTag: "GM Mode Only",
        meaning:
          `Exposes Auto-Layout preview on the map toolbar and bypasses the ${SEARCH_COOLDOWN_TURNS}-turn per-room cooldown on /search (also allowing Crit auto-spawn even when manual dice are pinned).`,
        accent: "cyan",
      },
    ],
    howItChanges: [
      "Toggle in Campaign → World → World Settings; takes effect immediately across Codex, Map Inspector, Context Health → Lore Index, Story Major Events, and Neuromancer.",
    ],
    effectOnPlay: [
      "Critical invariant: enabling GM Mode never leaks unrevealed secrets into AI character prompts—NPCs still only react to what they discovered in play.",
      "All campaign edits apply from the current turn onward on that timeline branch and never modify the reusable base World.",
    ],
    relatedTopicIds: [
      "gm-neuromancer",
      "gm-overrides-locks",
      "spatial-links-travel",
    ],
  },
  {
    id: "gm-overrides-locks",
    subcategoryId: "gm",
    title: "Manual Overrides & Item Locks",
    shortTitle: "Overrides & Item Locks",
    keywords: [
      "override",
      "relocate",
      "move scene",
      "move party",
      "permanent",
      "artifact",
      "inventory",
      "memory shards",
    ],
    inOneLine:
      "Manual overrides let you correct room placement, relocate individual NPCs, edit campaign memory shards, and lock pivotal equipment without breaking turn lineage.",
    scales: [
      {
        label: "Scene Location Override",
        rangeOrTag: "Move Party / Alone / Selected",
        meaning:
          "Re-anchors the active leaf turn from the mini-map or full map drawer; split menu preserves left-behind 2+ companions as an NPC party.",
        accent: "cyan",
      },
      {
        label: "NPC Relocation",
        rangeOrTag: "Current Tab / Party Modal",
        meaning:
          "Moves one NPC cleanly to any visible location without relocating you or firing player arrival cards.",
        accent: "emerald",
      },
      {
        label: "Inventory Locks",
        rangeOrTag: "permanent · artifact",
        meaning:
          "permanent prevents Phase 5 Clerk from silently dropping essential gear; artifact links an item to a World Codex Artifact entry.",
        accent: "amber",
      },
      {
        label: "Campaign Memory Edits",
        rangeOrTag: "Codex → Memories",
        meaning:
          "Add, edit, or prune an NPC's Memory Shards from the next turn onward without mutating the base Character template.",
        accent: "violet",
      },
    ],
    howItChanges: [
      "Inventory changes, Memory Shard edits, and Location overrides apply directly on the active leaf turn.",
    ],
    effectOnPlay: [
      "Gives you clean surgical control whenever an LLM makes a spatial or inventory slip—preserving smooth play across future turns and swipes.",
    ],
    relatedTopicIds: [
      "spatial-parties",
      "spatial-physical-stance",
      "gm-mode",
      "memory-lore-flags",
    ],
  },
] as const;
