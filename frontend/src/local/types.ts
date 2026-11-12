import { ProviderModelInfo } from "../types";

export interface RelayLlmOptions {
  temperature: number;
  max_tokens: number;
  context_size?: number | null;
  keep_alive?: string | number;
  json_mode?: boolean;
  json_schema?: Record<string, unknown> | null;
  disable_reasoning?: boolean;
}

export interface RelayLlmRequest {
  type: "llm.request";
  request_id: string;
  driver: "browser_ollama" | "webgpu";
  mode: "complete" | "stream";
  base_url?: string;
  model: string;
  messages: { role: string; content: string }[];
  options: RelayLlmOptions;
}

export interface RelayProbeRequest {
  type: "probe.request";
  request_id: string;
  driver: "browser_ollama" | "webgpu";
  base_url?: string;
}

export interface RelayDriverResult {
  content: string;
  thinking?: string;
  done_reason?: string | null;
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
