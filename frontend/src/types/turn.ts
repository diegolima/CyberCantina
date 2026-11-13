import type {
  AgencyLevel,
  CopingLevel,
  FeelingTone,
  IntensityLevel,
  OrdinalImpact,
  RelationalEventSpec,
  ThreatLevel,
} from "./affective";
import type { CharacterRecord, CharacterStateSnapshot, CognitionBlock } from "./character";
import type {
  CharacterChoiceSet,
  ChoiceComplianceOutcome,
  DiceMode,
  PreTurnAnalysis,
} from "./mechanics";
import type { PersonaRecord } from "./persona";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
  NeighborLocationView,
} from "./world";

export interface RecalledMemoryItem {
  id: string;
  source_type:
    | "lore"
    | "location_lore"
    | "container_lore"
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
  campaign_elapsed_minutes?: number;
  active_location_id: string;
  scene_flags: string[];
  visited_location_ids?: string[];
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
  affect_tone?: FeelingTone | null;
  affect_intensity?: IntensityLevel | null;
  affect_agency?: AgencyLevel | null;
  scene_threat?: ThreatLevel;
  scene_coping?: CopingLevel;
  goal_congruence?: OrdinalImpact;
  scene_surprise?: IntensityLevel;
  relational_events?: RelationalEventSpec[];
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
  | "location_tags"
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
      entity_kind?: "location" | "container";
      world_id?: string | null;
      location_id?: string | null;
      world_name?: string | null;
      genre?: string | null;
      tone?: string | null;
      setting_overview?: string | null;
      location_name?: string | null;
      location_summary?: string | null;
      location_description?: string | null;
      existing_tags?: string[] | null;
      child_names?: string[] | null;
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
  containers?: LocationContainer[];
  episodic_chunks: EpisodicChunkRecord[];
}

export interface LiveStreamState {
  userMessage: string;
  preTurn: PreTurnAnalysis | null;
  recalledItems: RecalledMemoryItem[];
  cognitionRaw: string;
  cognitionParsed: CognitionBlock | null;
  proseText: string;
  phaseStatus: string;
  isNarrator?: boolean;
}
