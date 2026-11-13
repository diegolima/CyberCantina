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
