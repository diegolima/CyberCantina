export interface VoiceAnchor {
  context: string;
  snippet: string;
}

export interface BaselinePsyche {
  mood_label: string;
  valence: number;
  arousal: number;
  core_drive: string;
  core_fear: string;
  default_want: string;
  default_plan: string;
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

export interface CharacterWizardDraft {
  name: string;
  tagline: string;
  physical_appearance: string;
  core_persona: string;
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
}

export interface WorldGlobalRules {
  genre: string;
  tone: string;
  setting_overview: string;
  tech_or_magic_rules: string;
  starting_timestamp: string;
}

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type SharedLoreCategory = "history" | "culture" | "faction" | "rumor";
export type WorldLoreCategory = SharedLoreCategory | "artifact";
export type LocationLoreCategory = SharedLoreCategory | "secret";
export type AnyLoreCategory = WorldLoreCategory | LocationLoreCategory;

export const WORLD_LORE_CATEGORIES: WorldLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "rumor",
  "artifact",
];

export const LOCATION_LORE_CATEGORIES: LocationLoreCategory[] = [
  "history",
  "culture",
  "faction",
  "rumor",
  "secret",
];

export interface LocationLoreNodeDraft {
  id?: string | null;
  title: string;
  category: LocationLoreCategory;
  content: string;
  entity_tags: string[];
}

export interface LoreNode {
  id: string;
  world_id: string;
  location_id?: string | null;
  campaign_id?: string | null;
  title: string;
  category: AnyLoreCategory;
  content: string;
  entity_tags: string[];
}

export interface LocationNode {
  id: string;
  world_id: string;
  created_at_turn_id?: string | null;
  name: string;
  summary: string;
  description: string;
  environmental_tags: string[];
  is_starting_location: boolean;
  is_hub?: boolean;
  starting_message?: string;
  lore_nodes?: LoreNode[];
}

export interface LocationEdge {
  id: string;
  world_id: string;
  from_location_id: string;
  to_location_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  created_at_turn_id?: string | null;
  superseded_at_turn_id?: string | null;
}

export interface NeighborLocationView {
  edge_id: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  destination: LocationNode;
}

export interface WorldRecord {
  id: string;
  name: string;
  global_rules: WorldGlobalRules;
  pending_deletion?: boolean;
  created_at: string;
  locations: LocationNode[];
  edges: LocationEdge[];
  lore_nodes: LoreNode[];
}

export interface LocationNodeDraft {
  key: string;
  name: string;
  summary: string;
  description: string;
  environmental_tags: string[];
  is_starting_location: boolean;
  is_hub?: boolean;
  starting_message?: string;
  lore_nodes?: LocationLoreNodeDraft[];
}

export interface LocationEdgeDraft {
  from_key: string;
  to_key: string;
  direction_label: string;
  reverse_direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  bidirectional: boolean;
}

export interface WorldWizardSeed {
  name: string;
  genre_and_tone: string;
  core_premise: string;
  initial_hub_concept: string;
  location_count: number;
}

export interface WorldWizardDraft {
  name: string;
  global_rules: WorldGlobalRules;
  locations: LocationNodeDraft[];
  edges: LocationEdgeDraft[];
  lore_nodes: Array<{
    id?: string | null;
    title: string;
    category: WorldLoreCategory;
    content: string;
    entity_tags: string[];
  }>;
}

export interface WorldMapDraft {
  locations: LocationNodeDraft[];
  edges: LocationEdgeDraft[];
}

export interface WorldMapReimagineRequest {
  world_name: string;
  global_rules: WorldGlobalRules;
  map_description: string;
  location_count?: number;
}

export type CanonicalOutcomeTier =
  | "Critical Failure"
  | "Failure with Consequences"
  | "Simple Failure"
  | "Clean Success"
  | "Critical Success";

export type LegacyOutcomeTier = "Failure with Consequence" | "Partial Success";

export type OutcomeTier = CanonicalOutcomeTier | LegacyOutcomeTier;

export type CheckRole = "active_attempt" | "contested_reaction" | "scene_hazard" | "co_present_bystander";

export type DiceMode = "auto" | "forced" | "disabled";

export type ChoiceGate =
  | "any"
  | "critical_success"
  | "success_plus"
  | "failure_minus"
  | "critical_failure";

export type ChoiceStatus = "available" | "eliminated";

export type ChoiceComplianceOutcome = "followed" | "coerced" | "free_fallback";

export const DEFAULT_GATE_DC = 12;
export const MAX_CHOICE_LABEL_LENGTH = 80;
export const MAX_CHOICE_OPTIONS = 6;

export interface CharacterChoiceOption {
  id: string;
  label: string;
  gate?: ChoiceGate;
}

export interface CharacterChoiceSet {
  character_id: string;
  options: CharacterChoiceOption[];
  gate_difficulty_class?: number;
}

export interface EvaluatedChoiceOption {
  id: string;
  label: string;
  gate: ChoiceGate;
  status: ChoiceStatus;
}

export interface ChoiceResolution {
  character_id: string;
  roll_outcome_tier?: OutcomeTier | null;
  options_evaluated: EvaluatedChoiceOption[];
  available_option_ids: string[];
  all_eliminated: boolean;
}

export interface ChoicePreviewOutcome {
  status: ChoiceStatus;
  allowed: string[];
  excluded: string[];
  probability: number;
  tiers: CanonicalOutcomeTier[];
}

export interface ChoicePreviewResponse {
  difficulty_class: number;
  modifier: number;
  pinned_d20: number | null;
  tier_probabilities: Record<CanonicalOutcomeTier, number>;
  gate_probabilities: Record<ChoiceGate, number>;
  outcomes: ChoicePreviewOutcome[];
}

export interface CharacterCheckSpec {
  character_id: string;
  requires_roll: boolean;
  check_role: CheckRole;
  action_description: string;
  skill_or_approach: string;
  difficulty_class: number;
  relevant_modifier: number;
}

export interface MechanicsTrigger {
  requires_roll: boolean;
  action_description: string;
  skill_or_approach: string;
  difficulty_class: number;
  relevant_modifier: number;
}

export interface DiceRollResult {
  character_id?: string | null;
  character_name?: string | null;
  check_role?: CheckRole;
  is_manual_override?: boolean;
  is_choice_gate?: boolean;
  action_description: string;
  skill_or_approach: string;
  d20_raw: number;
  modifier: number;
  total: number;
  difficulty_class: number;
  outcome_tier: OutcomeTier;
  plan_directive?: string;
  narrative_directive: string;
}

export interface PreTurnAnalysis {
  user_sentiment: string;
  subtext_interpretation: string;
  mentioned_entities: string[];
  memory_search_queries: string[];
  spatial_intent: "stay" | "move_known" | "explore_new";
  target_location_hint?: string | null;
  active_speaker_id?: string | null;
  speaker_order?: string[];
  dice_mode?: DiceMode;
  manual_dice_value?: number | null;
  mechanics_check: MechanicsTrigger;
  character_checks?: CharacterCheckSpec[];
  character_rolls?: Record<string, DiceRollResult>;
  resolved_roll?: DiceRollResult | null;
  character_choices?: Record<string, CharacterChoiceSet>;
  choice_resolutions?: Record<string, ChoiceResolution>;
  dice_mode_promoted?: boolean;
}

export interface RecalledMemoryItem {
  id: string;
  source_type:
    | "lore"
    | "location_lore"
    | "character_shard"
    | "episodic_chunk"
    | "item_lore";
  title: string;
  content: string;
  score: number;
}

export interface WorldStateSnapshot {
  turn_id: string;
  world_timestamp: string;
  active_location_id: string;
  scene_flags: string[];
}

export interface ExtractedCharacterMemory {
  character_id: string;
  title: string;
  content: string;
  significance: "trauma" | "bonding" | "betrayal" | "revelation" | "vow";
  keywords: string[];
  emotional_weight: number;
  supersedes_memory_id?: string | null;
}

export type AgentDispatchMode = "sequential" | "parallel";

export interface CharacterAgentDelta {
  mood_label: string;
  valence_delta: number;
  arousal_delta: number;
  updated_want?: string | null;
  stance_updates: Record<string, string>;
  items_equipped: string[];
  items_unequipped: string[];
  items_obtained: string[];
  items_removed: string[];
  location_transition: "stay_here" | "follow_player" | "move_to_neighbor";
  target_location_id?: string | null;
  new_memories: ExtractedCharacterMemory[];
}

export interface ImprovisedLocationSpec {
  name: string;
  description: string;
  direction_label: string;
  compass_direction: CompassDirection;
  travel_minutes: number;
  environmental_tags: string[];
}

export interface WorldPostTurnDelta {
  elapsed_minutes: number;
  new_world_timestamp?: string | null;
  transition_type: "stay" | "move_existing" | "improvise_new";
  target_location_id?: string | null;
  improvised_location?: ImprovisedLocationSpec | null;
  notable_event_summary?: string | null;
  scene_flags_updated: string[];
  scene_flags_removed: string[];
}

export interface ArbitrationRulingRecord {
  item_name: string;
  reason: "multi_claim" | "unrelinquished_transfer";
  claimant_ids: string[];
  prior_holder_id?: string | null;
  winner_id: string;
  winner_label: string;
  rationale: string;
}

export interface PostTurnStateDelta {
  elapsed_minutes: number;
  new_world_timestamp?: string | null;
  transition_type: "stay" | "move_existing" | "improvise_new";
  target_location_id?: string | null;
  improvised_location?: ImprovisedLocationSpec | null;
  notable_event_summary?: string | null;
  scene_flags_updated: string[];
  scene_flags_removed?: string[];
  inventory_added?: string[];
  inventory_removed?: string[];
  relationship_shift_note?: string | null;
  character_memories?: ExtractedCharacterMemory[];
  character_deltas?: Record<string, CharacterAgentDelta>;
  character_names?: Record<string, string>;
  arbitration_notes?: string[];
  arbitration_rulings?: ArbitrationRulingRecord[];
  compacted_character_ids?: string[];
}

export type Phase5AgentKind = "world_clerk" | "character";
export type Phase4AgentKind = Phase5AgentKind;

export type Phase4PillStatus =
  | "queued"
  | "running"
  | "arbitrating"
  | "completed"
  | "failed";
export type Phase5PillStatus = Phase4PillStatus;

export interface Phase5RosterEntry {
  agent_key: string;
  kind: Phase5AgentKind;
  label: string;
}
export type Phase4RosterEntry = Phase5RosterEntry;

export interface Phase5ProgressEventPayload {
  event:
    | "phase5_start"
    | "phase5_agent_start"
    | "phase5_agent_complete"
    | "phase5_agent_error"
    | "phase5_arbitration_start"
    | "phase5_complete"
    | "phase4_start"
    | "phase4_agent_start"
    | "phase4_agent_complete"
    | "phase4_agent_error"
    | "phase4_arbitration_start"
    | "phase4_complete";
  turn_id: string;
  dispatch_mode?: AgentDispatchMode;
  roster?: Phase5RosterEntry[];
  agent_key?: string;
  kind?: Phase5AgentKind;
  label?: string;
  world_delta?: WorldPostTurnDelta | null;
  character_delta?: CharacterAgentDelta | null;
  contested_agent_keys?: string[];
  error?: string;
}
export type Phase4ProgressEventPayload = Phase5ProgressEventPayload;

export type CharacterSpotlightRole = "primary_speaker" | "co_present";

export interface Phase3RosterEntry {
  character_id: string;
  character_name: string;
  role: CharacterSpotlightRole;
}

export type Phase3PillStatus = "queued" | "thinking" | "completed" | "failed";

export interface Phase3AgentProgressItem {
  characterId: string;
  characterName: string;
  role: CharacterSpotlightRole;
  status: Phase3PillStatus;
  cognition?: CognitionBlock | null;
  usedFallback?: boolean;
  error?: string | null;
}

export interface Phase3TurnProgress {
  dispatchMode: AgentDispatchMode;
  isComplete: boolean;
  orderedCharacterIds: string[];
  agents: Record<string, Phase3AgentProgressItem>;
}

export interface Phase3ProgressEventPayload {
  event:
    | "phase3_start"
    | "phase3_agent_start"
    | "phase3_agent_complete"
    | "phase3_agent_error"
    | "phase3_complete";
  dispatch_mode?: AgentDispatchMode;
  roster?: Phase3RosterEntry[];
  character_id?: string;
  character_name?: string;
  role?: CharacterSpotlightRole;
  cognition?: CognitionBlock;
  cognitions?: Record<string, CognitionBlock>;
  character_names?: Record<string, string>;
  selected_choice?: string | null;
  choice_compliance?: ChoiceComplianceOutcome | null;
  choice_compliance_note?: string | null;
  used_fallback?: boolean;
  error?: string;
}

export interface Phase4AgentProgressItem {
  agentKey: string; // "clerk" | character_id
  kind: Phase4AgentKind;
  label: string; // "clerk" | character_name
  status: Phase4PillStatus;
  reconciled: boolean;
  provisionalWorldDelta?: WorldPostTurnDelta | null;
  provisionalCharacterDelta?: CharacterAgentDelta | null;
  error?: string | null;
}

export interface Phase4TurnProgress {
  turnId: string;
  dispatchMode: AgentDispatchMode;
  isComplete: boolean;
  orderedAgentKeys: string[];
  agents: Record<string, Phase4AgentProgressItem>;
}
export type Phase5TurnProgress = Phase4TurnProgress;

export type NarrativeMode =
  | "standard"
  | "describe"
  | "advance"
  | "complication"
  | "custom";

export type ComposerPopoverId = "none" | "narrator" | "exits";
export type ComposerTrayId = "none" | "pass_time" | "custom_directive" | "choices";

export type EnrichFieldRole =
  | "player_turn_prompt"
  | "narrator_directive"
  | "location_description"
  | "character_persona"
  | "lore_content";

export type EnrichInstruction = "auto" | "polish" | "expand" | "concise";

export type MagicContextRef =
  | {
      scope: "campaign_turn";
      campaign_id: string;
      parent_turn_id?: string | null;
      override_location_id?: string | null;
    }
  | {
      scope: "world_location";
      world_id: string;
      location_id?: string | null;
    }
  | {
      scope: "character_field";
      character_id: string;
      world_id?: string | null;
    };

export interface PromptEnrichRequest {
  field_role: EnrichFieldRole;
  current_text: string;
  instruction?: EnrichInstruction;
  context_ref: MagicContextRef;
  single_line?: boolean;
  max_words?: number;
}

export interface PromptEnrichResponse {
  enriched_text: string;
  mode_applied: "generated" | "enriched";
  model_used: string;
}

export type MagicWandStatus = "idle" | "enriching" | "applied" | "error";

export interface UseMagicWandReturn {
  status: MagicWandStatus;
  error: string | null;
  canEnrich: boolean;
  canRevert: boolean;
  isDirtyAfterApply: boolean;
  triggerEnrich: (instruction?: EnrichInstruction) => Promise<void>;
  cancelEnrich: () => void;
  revert: () => void;
  dismissUndo: () => void;
  reset: () => void;
}

export interface TurnSubmitOptions {
  user_message: string;
  parent_turn_id?: string | null;
  dice_mode?: DiceMode;
  manual_dice_override?: number | null;
  override_location_id?: string | null;
  narrative_mode?: NarrativeMode;
  narrator_directive?: string | null;
  duration_minutes?: number | null;
  character_choices?: Record<string, CharacterChoiceSet>;
  whispers?: CharacterWhisper[];
}

export type MentionTargetScope = "local" | "remote";

export interface CharacterWhisper {
  character_id: string;
  character_name: string;
  target_scope: MentionTargetScope;
  raw_lines: string[];
  speech_parts: string[];
  sensory_parts: string[];
}

export interface DecomposedUserMessage {
  raw_message: string;
  public_text: string;
  whispers: CharacterWhisper[];
  whispers_by_character_id: Record<string, CharacterWhisper>;
  remote_whispers: CharacterWhisper[];
}

export interface MentionSuggestion {
  character_id: string;
  character_name: string;
  tagline?: string;
  is_present: boolean;
  avatar_url?: string;
}

export interface EpisodicChunkRecord {
  id: string;
  campaign_id: string;
  start_turn_depth: number;
  end_turn_depth: number;
  leaf_turn_id: string;
  summary_text: string;
  created_at: string;
}

export interface TurnNodeRecord {
  id: string;
  campaign_id: string;
  parent_turn_id?: string | null;
  depth_index: number;
  user_message: string;
  actor_id: string;
  raw_prose: string;
  cognition: CognitionBlock;
  cognitions?: Record<string, CognitionBlock>;
  cognition_character_names?: Record<string, string>;
  pre_turn: PreTurnAnalysis;
  post_turn?: PostTurnStateDelta | null;
  world_snapshot: WorldStateSnapshot;
  character_state: CharacterStateSnapshot;
  character_states?: Record<string, CharacterStateSnapshot>;
  whispers?: CharacterWhisper[];
  recalled_items: RecalledMemoryItem[];
  created_at: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  world_id: string;
  character_id: string;
  participant_character_ids?: string[];
  active_leaf_turn_id?: string | null;
  prompt_preset_id?: string | null;
  created_at: string;
  persona_id?: string | null;
  persona_snapshot?: PersonaRecord | null;
}

export interface CreateCampaignPayload {
  name: string;
  world_id: string;
  character_id?: string;
  character_ids?: string[];
  persona_id?: string | null;
  opening_prose?: string;
  start_focus?: "world" | "character";
  focus_character_id?: string | null;
  character_locations?: Record<string, string>;
}

export interface CampaignStateBundle {
  campaign: CampaignRecord;
  active_branch_turns: TurnNodeRecord[];
  all_turn_nodes: TurnNodeRecord[];
  current_world_snapshot: WorldStateSnapshot;
  current_character_state: CharacterStateSnapshot;
  character_states?: Record<string, CharacterStateSnapshot>;
  character_records?: Record<string, CharacterRecord>;
  present_character_ids?: string[];
  active_location: LocationNode;
  neighbor_locations: NeighborLocationView[];
  visible_locations: LocationNode[];
  visible_edges?: LocationEdge[];
  episodic_chunks: EpisodicChunkRecord[];
}

export interface ModelProfile {
  /** Provider that serves this role (connection details live on the provider). */
  provider_id?: string | null;
  /** LEGACY: ignored by the server whenever provider_id is set. */
  base_url?: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
  run_on_cpu?: boolean;
}

export interface AppSettings {
  db_path: string;
  actor_profile: ModelProfile;
  clerk_profile: ModelProfile;
  embedding_profile: {
    provider_id?: string | null;
    mode: "local_hash" | "openai_compat" | "fastembed";
    base_url?: string;
    model: string;
    dimensions: number;
  };
  memory_config: {
    working_memory_turns: number;
    episodic_chunk_size: number;
    rag_top_k: number;
    ephemeral_memory_lifespan_turns?: number;
    max_scene_flags?: number;
  };
  allow_offline_fallback: boolean;
  allow_user_model_overrides: boolean;
  /** BYOP: users may register private providers. Forces allow_user_model_overrides on (server-enforced). */
  allow_user_providers?: boolean;
  clerk_mirrors_actor?: boolean;
  /** Optimistic-concurrency counter; echo back what you loaded. */
  settings_revision?: number;
  delegate_cognition_to_clerk: boolean;
  agent_dispatch_mode?: AgentDispatchMode;
}

export interface SettingsUpdateResponse extends AppSettings {
  embedding_reindex_required: boolean;
  stale_embedding_entries: number;
}

export type ProviderType = "ollama" | "openrouter" | "aihorde";
export type ProviderScope = "system" | "user";
export type ProviderColor = "neutral" | "cyan" | "purple" | "indigo" | "bronze";
export type ProbeErrorCode =
  | "dns_failure"
  | "connect_refused"
  | "timeout"
  | "tls_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_payload"
  | "blocked_by_policy"
  | "invalid_url"
  | "rate_limited"
  | "unknown";

export interface ProviderModelInfo {
  name: string;
  size_mb: number;
  parameter_size: string;
  quantization_level: string;
  family: string;
  is_embedding: boolean;
  workers?: number;
  queued?: number;
  supported_parameters?: string[];
}

export interface LLMProvider {
  id: string;
  name: string;
  type: ProviderType;
  scope: ProviderScope;
  owner_id: string | null;
  color: ProviderColor;
  is_enabled: boolean;
  /** Only present for admins and the owner. */
  base_url: string | null;
  has_bearer_token: boolean;
  usable: boolean;
  unusable_reason: "disabled" | "byop_disabled" | null;
  cached_models: ProviderModelInfo[];
  last_probed_at: string | null;
  last_error_code: ProbeErrorCode | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderCreatePayload {
  name?: string | null;
  type: ProviderType;
  scope: ProviderScope;
  color: ProviderColor;
  is_enabled: boolean;
  settings: { base_url: string; bearer_token?: string | null };
}

export interface ProviderUpdatePayload {
  expected_version: number;
  name?: string;
  color?: ProviderColor;
  is_enabled?: boolean;
  base_url?: string;
  bearer_token?: string;
  clear_bearer_token?: boolean;
}

export interface ProviderDraft {
  provider_id?: string | null;
  type: ProviderType;
  base_url: string;
  bearer_token?: string | null;
}

export interface ProviderProbeResponse {
  provider_id: string | null;
  reachable: boolean;
  protocol: "ollama_native" | "openai_compat" | null;
  models: ProviderModelInfo[];
  chat_models: string[];
  embedding_models: string[];
  error_code: ProbeErrorCode | null;
  /** Detailed text, only for admins and owners. */
  error: string | null;
  config_version: number;
  probed_at: string;
  from_cache: boolean;
}

export interface ProviderReference {
  kind: "system_role" | "user_override" | "embedding";
  role: string | null;
  user_count: number;
}

export interface EffectiveWarning {
  role: "actor" | "clerk";
  code: "not_found" | "disabled" | "byop_disabled" | "no_token" | "missing_provider";
  provider_id?: string | null;
}

export interface OllamaModelInfo {
  name: string;
  size_mb: number;
  parameter_size: string;
  quantization_level: string;
  family: string;
  is_embedding: boolean;
}

export interface OllamaStatusResponse {
  reachable: boolean;
  ollama_root_url: string;
  error?: string | null;
  models: OllamaModelInfo[];
  chat_models: string[];
  embedding_models: string[];
  active_actor_model: string;
  active_clerk_model: string;
}

export type UserRole = "user" | "admin";

export interface PasskeyInfo {
  id: string;
  friendly_name: string;
  transports: string[];
  aaguid: string;
  created_at: string;
  last_used_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  has_password: boolean;
  passkeys: PasskeyInfo[];
  created_at: string;
  updated_at: string;
}

export interface AuthStatusResponse {
  setup_required: boolean;
  single_user_mode: boolean;
  authenticated: boolean;
  user?: UserProfile | null;
}

export interface AuthSessionResponse {
  token: string;
  user: UserProfile;
  single_user_mode: boolean;
}

export interface AdminResetPasswordResponse {
  user: UserProfile;
  generated_password: string;
}

export interface UserModelSettingsPayload {
  actor_profile?: ModelProfile | null;
  clerk_profile?: ModelProfile | null;
  working_memory_turns?: number | null;
  active_prompt_preset_id?: string | null;
  delegate_cognition_to_clerk?: boolean | null;
  max_scene_flags?: number | null;
  agent_dispatch_mode?: AgentDispatchMode | null;
  persona_disclosure_mode?: DisclosureDetectionMode | null;
  clerk_mirrors_actor?: boolean | null;
}

export interface ProfileModelSettingsResponse {
  allow_user_model_overrides: boolean;
  allow_user_providers?: boolean;
  warnings?: EffectiveWarning[];
  effective_clerk_mirrors_actor?: boolean;
  user_clerk_mirrors_actor?: boolean | null;
  default_clerk_mirrors_actor?: boolean;
  has_override: boolean;
  effective_actor_profile: ModelProfile;
  effective_clerk_profile: ModelProfile;
  effective_working_memory_turns: number;
  effective_delegate_cognition_to_clerk: boolean;
  effective_max_scene_flags?: number;
  effective_agent_dispatch_mode?: AgentDispatchMode;
  effective_persona_disclosure_mode?: DisclosureDetectionMode;
  user_actor_profile?: ModelProfile | null;
  user_clerk_profile?: ModelProfile | null;
  user_working_memory_turns?: number | null;
  user_delegate_cognition_to_clerk?: boolean | null;
  user_max_scene_flags?: number | null;
  user_agent_dispatch_mode?: AgentDispatchMode | null;
  user_persona_disclosure_mode?: DisclosureDetectionMode | null;
  active_prompt_preset_id?: string | null;
  default_actor_profile: ModelProfile;
  default_clerk_profile: ModelProfile;
  default_working_memory_turns: number;
  default_delegate_cognition_to_clerk: boolean;
  default_max_scene_flags?: number;
  default_agent_dispatch_mode?: AgentDispatchMode;
  default_persona_disclosure_mode?: DisclosureDetectionMode;
}

export interface PromptVariableDoc {
  name: string;
  description: string;
}

export interface PromptMetadata {
  key: string;
  title: string;
  description: string;
  available_variables: PromptVariableDoc[];
  required_tags: string[];
}

export interface PromptPresetRecord {
  id: string;
  owner_id?: string | null;
  name: string;
  description: string;
  is_builtin: boolean;
  prompts: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PromptPresetCreatePayload {
  name: string;
  description?: string;
  base_preset_id?: string | null;
  prompts?: Record<string, string> | null;
}

export interface PromptPresetUpdatePayload {
  name?: string | null;
  description?: string | null;
  prompts?: Record<string, string> | null;
}

export interface PromptDefaultsResponse {
  presets: PromptPresetRecord[];
  defaults: Record<string, string>;
  metadata: PromptMetadata[];
}

export interface UserNote {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  tags: string[];
  is_starred: boolean;
  is_character_note?: boolean;
  character_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateNotePayload {
  title?: string;
  content: string;
  tags?: string[];
  is_starred?: boolean;
}

export interface UpdateNotePayload {
  title?: string;
  content?: string;
  tags?: string[];
  is_starred?: boolean;
}

export type DisclosureDetectionMode = "llm_intent" | "token_matching" | "hybrid";

export interface PersonaItemInstance {
  id: string;
  name: string;
  note: string;
  flags: ItemFlag[];
  is_secret: boolean;
  trigger_keywords: string[];
}

export interface PersonaLoreEntry {
  id: string;
  title: string;
  content: string;
  is_secret: boolean;
  trigger_keywords: string[];
}

export interface PersonaKnowledgeProvenance {
  unlocked_at_turn_id: string;
  learned_from: string;
}

export interface PersonaRecord {
  id: string;
  owner_id: string;
  name: string;
  age?: string | null;
  age_is_secret: boolean;
  physical_appearance: string;
  equipped: PersonaItemInstance[];
  inventory: PersonaItemInstance[];
  lore_entries: PersonaLoreEntry[];
  created_at: string;
  updated_at: string;
}

export interface PersonaCreatePayload {
  name: string;
  age?: string | null;
  age_is_secret?: boolean;
  physical_appearance?: string;
  equipped?: PersonaItemInstance[];
  inventory?: PersonaItemInstance[];
  lore_entries?: PersonaLoreEntry[];
}

export interface PersonaUpdatePayload {
  name?: string;
  age?: string | null;
  age_is_secret?: boolean;
  physical_appearance?: string;
  equipped?: PersonaItemInstance[];
  inventory?: PersonaItemInstance[];
  lore_entries?: PersonaLoreEntry[];
}

export interface PersonaTurnStateSnapshot {
  turn_id: string;
  equipped: PersonaItemInstance[];
  inventory: PersonaItemInstance[];
}


