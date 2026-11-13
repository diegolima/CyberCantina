import type { DisclosureDetectionMode } from "./persona";
import type { AppSettings, EffectiveWarning, ModelProfile } from "./providers";
import type { AgentDispatchMode } from "./turn";

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
  min_working_memory_turns?: number | null;
  lod_summary_chunks?: number | null;
  lod_importance_bonus?: number | null;
  zone2_budget_share_pct?: number | null;
  recall_budget_prose_tokens?: number | null;
  recall_budget_cognition_tokens?: number | null;
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
  effective_min_working_memory_turns?: number;
  effective_lod_summary_chunks?: number;
  effective_lod_importance_bonus?: number;
  effective_zone2_budget_share_pct?: number;
  effective_recall_budget_prose_tokens?: number;
  effective_recall_budget_cognition_tokens?: number;
  user_actor_profile?: ModelProfile | null;
  user_clerk_profile?: ModelProfile | null;
  user_working_memory_turns?: number | null;
  user_delegate_cognition_to_clerk?: boolean | null;
  user_max_scene_flags?: number | null;
  user_agent_dispatch_mode?: AgentDispatchMode | null;
  user_persona_disclosure_mode?: DisclosureDetectionMode | null;
  user_min_working_memory_turns?: number | null;
  user_lod_summary_chunks?: number | null;
  user_lod_importance_bonus?: number | null;
  user_zone2_budget_share_pct?: number | null;
  user_recall_budget_prose_tokens?: number | null;
  user_recall_budget_cognition_tokens?: number | null;
  active_prompt_preset_id?: string | null;
  default_actor_profile: ModelProfile;
  default_clerk_profile: ModelProfile;
  default_working_memory_turns: number;
  default_delegate_cognition_to_clerk: boolean;
  default_max_scene_flags?: number;
  default_agent_dispatch_mode?: AgentDispatchMode;
  default_persona_disclosure_mode?: DisclosureDetectionMode;
  default_min_working_memory_turns?: number;
  default_lod_summary_chunks?: number;
  default_lod_importance_bonus?: number;
  default_zone2_budget_share_pct?: number;
  default_recall_budget_prose_tokens?: number;
  default_recall_budget_cognition_tokens?: number;
  default_embedding_profile?: AppSettings["embedding_profile"];
}
