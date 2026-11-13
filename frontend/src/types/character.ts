import type {
  AffectiveCareState,
  AgencyLevel,
  CopingLevel,
  FeelingTone,
  IntensityLevel,
  TemperamentConfig,
  ThreatLevel,
  VoiceAnchor,
  WorldviewProfile,
} from "./affective";
import type { ChoiceComplianceOutcome } from "./mechanics";
import type { PersonaKnowledgeProvenance } from "./persona";
import type { WorldWizardDraft } from "./world";

export interface BaselinePsyche {
  mood_label: string;
  valence: number;
  arousal: number;
  core_drive: string;
  core_fear: string;
  default_want: string;
  default_plan: string;
  initial_worldview?: WorldviewProfile;
  temperament?: TemperamentConfig;
}

export type MemoryOrigin =
  | "backstory"
  | "clerk_ephemeral"
  | "clerk_promoted"
  | "compacted";

export type MemorySignificance =
  | "trauma"
  | "bonding"
  | "betrayal"
  | "revelation"
  | "vow"
  | "consolidated";

export interface MemoryShard {
  id?: string | null;
  title: string;
  content: string;
  keywords: string[];
  emotional_weight: number;
  origin?: MemoryOrigin;
  significance?: MemorySignificance | null;
  anchor_turn_id?: string | null;
  created_at_depth?: number | null;
  superseded_at_turn_id?: string | null;
}

export interface CharacterWizardSeed {
  name: string;
  archetype: string;
  role_in_story: string;
  personality_keywords: string[];
  rough_notes: string;
  world_id?: string | null;
}

export type BasicEmotion =
  | "default"
  | "happy"
  | "sad"
  | "afraid"
  | "angry"
  | "disgusted"
  | "surprised"
  | "contempt";

export interface GalleryImage {
  id: string;
  url: string;
  caption?: string;
  created_at: string;
}

export type ItemFlag = "permanent" | "artifact";

export interface ItemInstance {
  id: string;
  name: string;
  note: string;
  flags: ItemFlag[];
  lore_id?: string | null;
}

export type InventoryItemInput = string | ItemInstance;

export interface ItemEquipActionPayload {
  item: string;
  item_id?: string | null;
  action: "equip" | "unequip" | "remove" | "add" | "update";
  target?: "equipped" | "inventory";
  character_id?: string;
  new_name?: string | null;
  note?: string | null;
  flags?: ItemFlag[] | null;
  lore_id?: string | null;
}

export function normalizeItemInstance(
  raw: InventoryItemInput,
  fallbackIndex = 0
): ItemInstance {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return {
      id: `legacy_${fallbackIndex}_${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: trimmed,
      note: "",
      flags: [],
      lore_id: null,
    };
  }
  const cleanFlags = Array.from(
    new Set(
      (raw.flags ?? []).filter(
        (f): f is ItemFlag => f === "permanent" || f === "artifact"
      )
    )
  );
  return {
    id: raw.id || `item_${fallbackIndex}_${(raw.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    name: (raw.name ?? "").trim(),
    note: raw.note ?? "",
    flags: cleanFlags,
    lore_id: raw.lore_id ?? null,
  };
}

export function normalizeItemList(
  raw?: readonly InventoryItemInput[] | null
): ItemInstance[] {
  if (!raw || raw.length === 0) return [];
  return raw
    .map((entry, idx) => normalizeItemInstance(entry, idx))
    .filter((it) => it.name.length > 0);
}

export function splitLegacyWornItems(
  equipped?: readonly InventoryItemInput[] | null,
  inventory?: readonly InventoryItemInput[] | null
): { equippedList: ItemInstance[]; inventoryList: ItemInstance[] } {
  let equippedList = normalizeItemList(equipped);
  let inventoryList = normalizeItemList(inventory);
  if (
    equippedList.length === 0 &&
    inventoryList.some((it) => /^\[(?:worn|equipped)\]/i.test(it.name))
  ) {
    equippedList = inventoryList
      .filter((it) => /^\[(?:worn|equipped)\]/i.test(it.name))
      .map((it) => ({
        ...it,
        name: it.name.replace(/^\[(?:worn|equipped)\]\s*/i, "").trim(),
      }))
      .filter((it) => it.name.length > 0);
    inventoryList = inventoryList.filter(
      (it) => !/^\[(?:worn|equipped)\]/i.test(it.name)
    );
  }
  return { equippedList, inventoryList };
}

export function hasItemFlag(item: ItemInstance, flag: ItemFlag): boolean {
  return item.flags.includes(flag);
}

export interface MoodPreset {
  id: string;
  label: string;
  valence: number;
  arousal: number;
}

export const BASELINE_MOOD_PRESETS: MoodPreset[] = [
  { id: "calm_composed", label: "Calm & Composed", valence: 0.2, arousal: 0.2 },
  { id: "wary_guarded", label: "Wary & Guarded", valence: -0.2, arousal: 0.4 },
  { id: "melancholy_subdued", label: "Melancholy & Subdued", valence: -0.5, arousal: 0.2 },
  { id: "hostile_tense", label: "Hostile & Tense", valence: -0.7, arousal: 0.8 },
  { id: "uneasy_on_edge", label: "Uneasy & On-Edge", valence: -0.4, arousal: 0.6 },
  { id: "warm_receptive", label: "Warm & Receptive", valence: 0.6, arousal: 0.3 },
  { id: "elated_triumphant", label: "Elated & Triumphant", valence: 0.8, arousal: 0.7 },
];

export interface CharacterWizardDraft {
  name: string;
  tagline: string;
  character_bio?: string;
  physical_appearance: string;
  species?: string;
  sex?: string;
  pronouns?: string;
  age?: string;
  build_and_height?: string;
  distinctive_features?: string[];
  posture?: string;
  mannerisms?: string[];
  modifications?: string[];
  visual_aesthetic?: string;
  personality_traits?: string[];
  core_persona: string;
  moral_code?: string[];
  quirks_flaws?: string[];
  communication_style?: string[];
  initial_message: string;
  equipped?: InventoryItemInput[];
  inventory: InventoryItemInput[];
  voice_anchors: VoiceAnchor[];
  baseline_psyche: BaselinePsyche;
  memory_shards: MemoryShard[];
  tags?: string[];
  creator?: string;
  creator_notes?: string;
  portraits?: Record<string, string>;
  gallery?: GalleryImage[];
}

export interface SillyTavernImportResponse {
  draft: CharacterWizardDraft;
  preassigned_character_id: string;
  auto_generated_world?: WorldWizardDraft | null;
}

export interface CharacterRecord extends Omit<CharacterWizardDraft, "equipped" | "inventory"> {
  id: string;
  world_id?: string | null;
  pending_deletion?: boolean;
  version: number;
  equipped?: ItemInstance[];
  inventory: ItemInstance[];
  tags: string[];
  creator: string;
  creator_notes: string;
  portraits: Record<string, string>;
  gallery: GalleryImage[];
  created_at: string;
}

export interface CharacterVersionSummary {
  id: string;
  character_id: string;
  version: number;
  created_at: string;
}

export interface CognitionBlock {
  recall: string;
  feeling: string;
  feeling_tone?: FeelingTone | null;
  feeling_intensity?: IntensityLevel | null;
  feeling_agency?: AgencyLevel | null;
  scene_threat?: ThreatLevel | null;
  scene_coping?: CopingLevel | null;
  valence: number;
  arousal: number;
  want: string;
  plan: string;
  skipped?: boolean;
  selected_choice?: string | null;
  choice_compliance?: ChoiceComplianceOutcome | null;
  choice_compliance_note?: string | null;
}

export interface CharacterStateSnapshot {
  turn_id: string;
  character_id: string;
  current_location_id: string;
  mood_label: string;
  valence: number;
  arousal: number;
  active_want: string;
  active_plan: string;
  relationship_notes: Record<string, string>;
  equipped?: ItemInstance[];
  inventory: ItemInstance[];
  unlocked_persona_keys?: string[];
  persona_knowledge_provenance?: Record<string, PersonaKnowledgeProvenance>;
  care_state?: AffectiveCareState | null;
}
