import type { AgentDispatchMode } from "./turn";

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
  keep_alive_minutes?: number;
  context_size?: number | null;
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
    min_working_memory_turns?: number;
    lod_summary_chunks?: number;
    lod_importance_bonus?: number;
    zone2_budget_share_pct?: number;
    recall_budget_prose_tokens?: number;
    recall_budget_cognition_tokens?: number;
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

export type ProviderType =
  | "ollama"
  | "openrouter"
  | "aihorde"
  | "browser_ollama"
  | "webgpu";
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
  | "relay_offline"
  | "webgpu_unsupported"
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

export interface ClientProbeReport {
  reachable: boolean;
  protocol?: "ollama_native" | "openai_compat" | null;
  models: ProviderModelInfo[];
  error_code?: ProbeErrorCode | null;
  error?: string | null;
}

export interface LocalRelayStatusResponse {
  connected: boolean;
  tabs: {
    tab_id: string;
    webgpu_supported: boolean;
    loaded_webgpu_model?: string | null;
    webgpu_error?: string | null;
  }[];
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
