import { ProviderModelInfo } from "../types";

export interface RelayLlmOptions {
  temperature: number;
  max_tokens: number;
  context_size?: number | null;
  keep_alive?: string | number;
  json_mode?: boolean;
  json_schema?: Record<string, unknown> | null;
  disable_reasoning?: boolean;
  tools?: Record<string, unknown>[];
}

export interface RelayLlmMessage {
  role: string;
  content?: string | null;
  [key: string]: unknown;
}

export type RelayDriver =
  | "browser_ollama"
  | "webgpu"
  | "ollama"
  | "openai_compat"
  | "openrouter"
  | "aihorde"
  | "nanogpt";

export interface RelayLlmRequest {
  type: "llm.request";
  request_id: string;
  driver: RelayDriver;
  provider_id?: string | null;
  mode: "complete" | "stream";
  base_url?: string;
  model: string;
  messages: RelayLlmMessage[];
  options: RelayLlmOptions;
}

export interface RelayProbeRequest {
  type: "probe.request";
  request_id: string;
  driver: RelayDriver;
  provider_id?: string | null;
  base_url?: string;
}

export interface RelayDriverResult {
  content: string;
  thinking?: string;
  done_reason?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  eval_duration_ms?: number | null;
  cost_usd?: number | null;
  tool_calls?: Record<string, unknown>[];
}

export function nsToMs(ns: unknown): number | null {
  if (typeof ns !== "number" || !Number.isFinite(ns) || ns <= 0) return null;
  return Math.max(1, Math.round(ns / 1_000_000));
}

export function extractCostUsd(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

export function extractOllamaUsage(payload: any): {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  eval_duration_ms: number | null;
} {
  return {
    prompt_tokens: typeof payload?.prompt_eval_count === "number" ? payload.prompt_eval_count : null,
    completion_tokens: typeof payload?.eval_count === "number" ? payload.eval_count : null,
    eval_duration_ms: nsToMs(payload?.eval_duration),
  };
}

export interface WebGpuProgress {
  model: string;
  progress: number; // 0..1
  text: string;
}

export interface ContextClampNotice {
  model: string;
  requestedContext: number;
  effectiveContext: number;
}

export interface BrowserOllamaProbeOutcome {
  reachable: boolean;
  protocol: "ollama_native" | "openai_compat" | null;
  models: ProviderModelInfo[];
  error_code: "connect_refused" | "timeout" | "not_found" | "bad_payload" | "unknown" | null;
  error: string | null;
  needsCorsOrLnaSetup?: boolean;
}
