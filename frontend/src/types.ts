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

export interface CharacterWizardDraft {
  name: string;
  tagline: string;
  physical_appearance: string;
  core_persona: string;
  initial_message: string;
  equipped?: string[];
  inventory: string[];
  voice_anchors: VoiceAnchor[];
  baseline_psyche: BaselinePsyche;
  memory_shards: MemoryShard[];
  tags?: string[];
  creator?: string;
  creator_notes?: string;
  portraits?: Record<string, string>;
  gallery?: GalleryImage[];
}

export interface CharacterRecord extends CharacterWizardDraft {
  id: string;
  world_id?: string | null;
  pending_deletion?: boolean;
  version: number;
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
  equipped?: string[];
  inventory: string[];
}

export interface WorldGlobalRules {
  genre: string;
  tone: string;
  setting_overview: string;
  tech_or_magic_rules: string;
  starting_timestamp: string;
}

export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

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

export interface LoreNode {
  id: string;
  world_id: string;
  title: string;
  category: string;
  content: string;
  entity_tags: string[];
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
    title: string;
    category: "faction" | "history" | "item" | "culture" | "rule" | "rumor";
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

export interface MechanicsTrigger {
  requires_roll: boolean;
  action_description: string;
  skill_or_approach: string;
  difficulty_class: number;
  relevant_modifier: number;
}

export interface DiceRollResult {
  action_description: string;
  skill_or_approach: string;
  d20_raw: number;
  modifier: number;
  total: number;
  difficulty_class: number;
  outcome_tier:
    | "Critical Failure"
    | "Failure with Consequence"
    | "Partial Success"
    | "Clean Success"
    | "Critical Success";
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
  mechanics_check: MechanicsTrigger;
  resolved_roll?: DiceRollResult | null;
}

export interface RecalledMemoryItem {
  id: string;
  source_type: "lore" | "character_shard" | "episodic_chunk";
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

export interface PostTurnStateDelta {
  elapsed_minutes: number;
  new_world_timestamp?: string | null;
  transition_type: "stay" | "move_existing" | "improvise_new";
  target_location_id?: string | null;
  notable_event_summary?: string | null;
  scene_flags_updated: string[];
  scene_flags_removed?: string[];
  inventory_added?: string[];
  inventory_removed?: string[];
  relationship_shift_note?: string | null;
  character_memories?: ExtractedCharacterMemory[];
}

export type NarrativeMode =
  | "standard"
  | "describe"
  | "advance"
  | "complication"
  | "perception"
  | "custom";

export interface TurnSubmitOptions {
  user_message: string;
  parent_turn_id?: string | null;
  manual_dice_override?: number | null;
  override_location_id?: string | null;
  narrative_mode?: NarrativeMode;
  narrator_directive?: string | null;
  duration_minutes?: number | null;
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
  pre_turn: PreTurnAnalysis;
  post_turn?: PostTurnStateDelta | null;
  world_snapshot: WorldStateSnapshot;
  character_state: CharacterStateSnapshot;
  character_states?: Record<string, CharacterStateSnapshot>;
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
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  timeout_seconds: number;
}

export interface AppSettings {
  db_path: string;
  actor_profile: ModelProfile;
  clerk_profile: ModelProfile;
  embedding_profile: {
    mode: "local_hash" | "openai_compat" | "fastembed";
    base_url: string;
    api_key: string;
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
  delegate_cognition_to_clerk: boolean;
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
}

export interface ProfileModelSettingsResponse {
  allow_user_model_overrides: boolean;
  has_override: boolean;
  effective_actor_profile: ModelProfile;
  effective_clerk_profile: ModelProfile;
  effective_working_memory_turns: number;
  effective_delegate_cognition_to_clerk: boolean;
  effective_max_scene_flags?: number;
  user_actor_profile?: ModelProfile | null;
  user_clerk_profile?: ModelProfile | null;
  user_working_memory_turns?: number | null;
  user_delegate_cognition_to_clerk?: boolean | null;
  user_max_scene_flags?: number | null;
  active_prompt_preset_id?: string | null;
  default_actor_profile: ModelProfile;
  default_clerk_profile: ModelProfile;
  default_working_memory_turns: number;
  default_delegate_cognition_to_clerk: boolean;
  default_max_scene_flags?: number;
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


