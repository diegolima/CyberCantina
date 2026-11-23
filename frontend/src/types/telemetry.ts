import type { ProviderColor } from "./providers";

export type TelemetryPhaseKey =
  | "phase1_pre"
  | "phase3_cognition"
  | "phase4_prose"
  | "phase5_clerk";

export type ContextHealthStatus = "healthy" | "warning" | "critical" | "idle";

export type TokenUsageSource = "exact" | "estimated";

export type AggregateUsageSource = "exact" | "estimated" | "mixed" | "none";

export interface LlmCallTelemetry {
  phase: TelemetryPhaseKey;
  label: string;
  model: string;
  provider_type: string;
  provider_id?: string | null;
  provider_name?: string | null;
  provider_color?: ProviderColor | null;
  prompt_tokens: number;
  completion_tokens: number;
  usage_source: TokenUsageSource;
  context_ceiling?: number | null;
  finish_reason: string;
  retries: number;
  duration_ms: number;
  ttft_ms?: number | null;
  eval_duration_ms?: number | null;
  cost_usd?: number | null;
  error?: string | null;
}

export interface Phase4BudgetReport {
  context_ceiling?: number | null;
  reserved_output_tokens: number;
  safety_margin_tokens: number;
  input_budget?: number | null;
  zone1_tokens: number;
  zone2_tokens: number;
  zone3_tokens: number;
  zone4_tokens: number;
  total_zone3_turns_available: number;
  dropped_zone3_turns: number;
  trimmed_below_min_wm: boolean;
  total_zone2_chunks_available: number;
  downgraded_zone2_chunks: number;
  dropped_zone2_chunks: number;
  base_exceeds_budget: boolean;
  estimated_cropped_tokens: number;
}

export interface PhaseTelemetrySummary {
  phase: TelemetryPhaseKey;
  status: ContextHealthStatus;
  call_count: number;
  peak_prompt_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  context_ceiling?: number | null;
  peak_utilization_pct?: number | null;
  usage_source: AggregateUsageSource;
  dropped_summary?: string | null;
  cropped_summary?: string | null;
  truncated_output: boolean;
  budget_report?: Phase4BudgetReport | null;
  calls: LlmCallTelemetry[];
}

export interface TurnTelemetry {
  overall_status: ContextHealthStatus;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  usage_source: AggregateUsageSource;
  phase5_pending: boolean;
  phases: Partial<Record<TelemetryPhaseKey, PhaseTelemetrySummary>>;
}
