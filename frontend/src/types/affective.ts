import type { BasicEmotion } from "./character";

export interface VoiceAnchor {
  context: string;
  snippet: string;
}

export type TemperamentArchetype =
  | "balanced"
  | "stoic"
  | "volatile"
  | "confidant"
  | "paranoiac"
  | "proud_rival";

export type FeelingTone =
  | "elated"
  | "warm"
  | "content"
  | "neutral"
  | "guarded"
  | "uneasy"
  | "melancholy"
  | "bitter"
  | "hostile"
  | "anguished";

export type IntensityLevel = "calm" | "low" | "moderate" | "high" | "extreme";
export type AgencyLevel = "helpless" | "pressured" | "steady" | "assured" | "commanding";
export type ThreatLevel = "none" | "low" | "moderate" | "high" | "critical";
export type CopingLevel = "overwhelmed" | "strained" | "adequate" | "mastery";
export type OrdinalImpact = "strong_neg" | "mild_neg" | "none" | "mild_pos" | "strong_pos";
export type GrievanceShift = "reconciled" | "eased" | "none" | "slighted" | "grave_wrong";
export type VisibilityScope = "public_room" | "local_whisper" | "remote_comm";

export interface WorldviewProfile {
  benevolence: number;
  belonging: number;
  agency: number;
}

export interface TemperamentConfig {
  archetype: TemperamentArchetype;
  relational_inertia: number;
  negativity_ratio: number;
  theta_pos_base: number;
  theta_neg_base: number;
  composure_resilience: number;
}

export interface TemperamentPresetMeta {
  archetype: TemperamentArchetype;
  label: string;
  summary: string;
  temperament: TemperamentConfig;
  worldview: WorldviewProfile;
}

export const TEMPERAMENT_ARCHETYPE_OPTIONS: TemperamentPresetMeta[] = [
  {
    archetype: "balanced",
    label: "Balanced Realist",
    summary: "Measured trust and steady emotional recovery; fair give-and-take.",
    temperament: {
      archetype: "balanced",
      relational_inertia: 0.8,
      negativity_ratio: 3.5,
      theta_pos_base: 0.15,
      theta_neg_base: -0.12,
      composure_resilience: 1.0,
    },
    worldview: { benevolence: 0.0, belonging: 0.1, agency: 0.2 },
  },
  {
    archetype: "stoic",
    label: "Stoic Guardian",
    summary: "High composure mask & slow-moving loyalty; unshaken by minor friction.",
    temperament: {
      archetype: "stoic",
      relational_inertia: 0.92,
      negativity_ratio: 2.5,
      theta_pos_base: 0.16,
      theta_neg_base: -0.16,
      composure_resilience: 1.8,
    },
    worldview: { benevolence: -0.2, belonging: 0.3, agency: 0.1 },
  },
  {
    archetype: "volatile",
    label: "Volatile Firebrand",
    summary: "Thin emotional mask, rapid mood swings, and sharp reactions to slights.",
    temperament: {
      archetype: "volatile",
      relational_inertia: 0.55,
      negativity_ratio: 6.0,
      theta_pos_base: 0.15,
      theta_neg_base: -0.08,
      composure_resilience: 0.6,
    },
    worldview: { benevolence: -0.5, belonging: -0.3, agency: 0.6 },
  },
  {
    archetype: "confidant",
    label: "Warm Confidant",
    summary: "Open-hearted, forgiving of small missteps, and deeply hurt by betrayal.",
    temperament: {
      archetype: "confidant",
      relational_inertia: 0.78,
      negativity_ratio: 1.8,
      theta_pos_base: 0.1,
      theta_neg_base: -0.18,
      composure_resilience: 1.1,
    },
    worldview: { benevolence: 0.6, belonging: 0.7, agency: 0.2 },
  },
  {
    archetype: "paranoiac",
    label: "Guarded Paranoiac",
    summary: "Skeptical of cheap flattery; requires costly proof before trusting.",
    temperament: {
      archetype: "paranoiac",
      relational_inertia: 0.88,
      negativity_ratio: 8.0,
      theta_pos_base: 0.28,
      theta_neg_base: -0.06,
      composure_resilience: 0.8,
    },
    worldview: { benevolence: -0.8, belonging: -0.7, agency: 0.3 },
  },
  {
    archetype: "proud_rival",
    label: "Proud Rival",
    summary: "Respect-gated warmth; admires competence and despises condescension.",
    temperament: {
      archetype: "proud_rival",
      relational_inertia: 0.84,
      negativity_ratio: 4.0,
      theta_pos_base: 0.18,
      theta_neg_base: -0.12,
      composure_resilience: 1.4,
    },
    worldview: { benevolence: -0.3, belonging: -0.1, agency: 0.8 },
  },
];

export function getTemperamentPresetMeta(
  archetype?: TemperamentArchetype | string | null
): TemperamentPresetMeta {
  return (
    TEMPERAMENT_ARCHETYPE_OPTIONS.find((opt) => opt.archetype === archetype) ??
    TEMPERAMENT_ARCHETYPE_OPTIONS[0]
  );
}

export interface SituationalAppraisal {
  threat: number;
  coping: number;
  goal_congruence: number;
  ambiguity: number;
}

export interface RelationalEdge {
  target_id: string;
  warmth: number;
  respect: number;
  trust: number;
  power: number;
  grievance: number;
  obligation: number;
  consolidated_warmth: number;
  consolidated_trust: number;
  episodic_note: string;
}

export interface AffectiveCareState {
  schema_version: number;
  is_provisional: boolean;
  state_elapsed_minutes: number;
  valence: number;
  arousal: number;
  dominance: number;
  composure: number;
  mood_variance: [number, number, number];
  active_emotion: BasicEmotion;
  short_mood_label: string;
  outward_demeanor: string;
  active_worldview: WorldviewProfile;
  appraisal: SituationalAppraisal;
  relations: Record<string, RelationalEdge>;
}

export interface RelationalEventSpec {
  target: string;
  warmth_shift?: OrdinalImpact;
  respect_shift?: OrdinalImpact;
  trust_shift?: OrdinalImpact;
  power_shift?: OrdinalImpact;
  grievance_shift?: GrievanceShift;
  obligation_shift?: OrdinalImpact;
  visibility?: VisibilityScope;
  note?: string;
}
