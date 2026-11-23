import type {
  AgentDispatchMode,
  DisclosureDetectionMode,
  ProfileModelSettingsResponse,
  UserModelSettingsPayload,
} from "../types";

export type ProfileTopTab = "preferences" | "account";
export type ProfilePrefSubTab = "providers" | "models" | "prompts" | "behavior";
export type ProfileInitialTab =
  | "identity"
  | "account"
  | "preferences"
  | "models"
  | "prompts"
  | "behavior";
export type BehaviorIconKey = "dialogue" | "recaps" | "recall" | "engine" | "gm";

const FALLBACK_ACTOR_CONTEXT_SIZE = 12288;
const FALLBACK_CLERK_CONTEXT_SIZE = 8192;

export interface ProfileModelDraft {
  actorProviderId: string | null;
  actorModel: string;
  actorTemp: number;
  actorTokens: number;
  actorKeepAlive: number;
  actorContextSize: number;
  clerkProviderId: string | null;
  clerkModel: string;
  clerkTemp: number;
  clerkTokens: number;
  clerkKeepAlive: number;
  clerkContextSize: number;
  clerkMirrorsActor: boolean;
  clerkRunOnCpu: boolean;
  workingMemoryTurns: number;
  minWorkingMemoryTurns: number;
  lodSummaryChunks: number;
  lodImportanceBonus: number;
  zone2BudgetSharePct: number;
  recallBudgetProseTokens: number;
  recallBudgetCognitionTokens: number;
  maxSceneFlags: number;
  agentDispatchMode: AgentDispatchMode;
  personaDisclosureMode: DisclosureDetectionMode;
  delegateCognitionToClerk: boolean;
  gmModelRole: "primary" | "clerk";
  gmTemperature: number;
  gmMaxTokens: number;
  activePromptPresetId: string | null;
}

export interface BehaviorCardMeta {
  id: BehaviorIconKey;
  title: string;
  subtitle: string;
  accent: string;
}

export const BEHAVIOR_CARD_META: readonly BehaviorCardMeta[] = [
  {
    id: "dialogue",
    title: "Recent Dialogue",
    subtitle: "Working Memory · Zone 3",
    accent: "var(--accent-cyan)",
  },
  {
    id: "recaps",
    title: "Story Recaps",
    subtitle: "Episodic Summaries · Zone 2",
    accent: "var(--accent-amber)",
  },
  {
    id: "recall",
    title: "Long-Term Recall",
    subtitle: "Vector Memory & Lore",
    accent: "var(--accent-purple, #a855f7)",
  },
  {
    id: "engine",
    title: "Scene State & Turn Engine",
    subtitle: "Simulation & Pipeline · Zone 4",
    accent: "var(--accent-emerald)",
  },
  {
    id: "gm",
    title: "GM Talk",
    subtitle: "Neuromancer · OOC Assistant",
    accent: "var(--accent-violet, #a78bfa)",
  },
] as const;

/** Resolve the top-level ProfileModal tab, defaulting to Preferences and routing legacy "identity" to Account. */
export function resolveProfileInitialTab(
  initialTab?: ProfileInitialTab
): ProfileTopTab {
  if (initialTab === "account" || initialTab === "identity") {
    return "account";
  }
  return "preferences";
}

/** Return true when the caller explicitly requested a specific Preferences sub-tab. */
export function hasExplicitPrefSubTab(
  initialTab?: ProfileInitialTab,
  initialSubTab?: ProfilePrefSubTab
): boolean {
  return (
    initialSubTab !== undefined ||
    initialTab === "models" ||
    initialTab === "prompts" ||
    initialTab === "behavior"
  );
}

/** Resolve the Preferences sub-tab, defaulting to Providers when BYOP is enabled or Models otherwise. */
export function resolveProfilePrefSubTab(opts: {
  initialTab?: ProfileInitialTab;
  initialSubTab?: ProfilePrefSubTab;
  allowUserProviders?: boolean;
}): ProfilePrefSubTab {
  if (opts.initialSubTab) {
    return opts.initialSubTab;
  }
  if (
    opts.initialTab === "models" ||
    opts.initialTab === "prompts" ||
    opts.initialTab === "behavior"
  ) {
    return opts.initialTab;
  }
  return opts.allowUserProviders === false ? "models" : "providers";
}

/** Extract an editable ProfileModelDraft from a ProfileModelSettingsResponse (user overrides or defaults). */
export function extractDraftFromProfileSettings(
  data: ProfileModelSettingsResponse,
  opts?: { useDefaultsOnly?: boolean }
): ProfileModelDraft {
  const useDefaults = Boolean(opts?.useDefaultsOnly);
  const activeActor = useDefaults
    ? data.default_actor_profile
    : (data.user_actor_profile ?? data.default_actor_profile);
  const activeClerk = useDefaults
    ? data.default_clerk_profile
    : (data.user_clerk_profile ?? data.default_clerk_profile);

  return {
    actorProviderId: activeActor.provider_id ?? null,
    actorModel: activeActor.model,
    actorTemp: activeActor.temperature,
    actorTokens: activeActor.max_tokens,
    actorKeepAlive: activeActor.keep_alive_minutes ?? 30,
    actorContextSize:
      activeActor.context_size ??
      data.default_actor_profile.context_size ??
      FALLBACK_ACTOR_CONTEXT_SIZE,
    clerkProviderId: activeClerk.provider_id ?? null,
    clerkModel: activeClerk.model,
    clerkTemp: activeClerk.temperature,
    clerkTokens: activeClerk.max_tokens,
    clerkKeepAlive: activeClerk.keep_alive_minutes ?? 30,
    clerkContextSize:
      activeClerk.context_size ??
      data.default_clerk_profile.context_size ??
      FALLBACK_CLERK_CONTEXT_SIZE,
    clerkMirrorsActor: useDefaults
      ? (data.default_clerk_mirrors_actor ?? false)
      : (data.user_clerk_mirrors_actor ??
        data.default_clerk_mirrors_actor ??
        false),
    clerkRunOnCpu: activeClerk.run_on_cpu ?? false,
    workingMemoryTurns: useDefaults
      ? data.default_working_memory_turns
      : (data.user_working_memory_turns ?? data.default_working_memory_turns),
    minWorkingMemoryTurns: useDefaults
      ? (data.default_min_working_memory_turns ?? 4)
      : (data.user_min_working_memory_turns ??
        data.default_min_working_memory_turns ??
        4),
    lodSummaryChunks: useDefaults
      ? (data.default_lod_summary_chunks ?? 6)
      : (data.user_lod_summary_chunks ?? data.default_lod_summary_chunks ?? 6),
    lodImportanceBonus: useDefaults
      ? (data.default_lod_importance_bonus ?? 2)
      : (data.user_lod_importance_bonus ??
        data.default_lod_importance_bonus ??
        2),
    zone2BudgetSharePct: useDefaults
      ? (data.default_zone2_budget_share_pct ?? 45)
      : (data.user_zone2_budget_share_pct ??
        data.default_zone2_budget_share_pct ??
        45),
    recallBudgetProseTokens: useDefaults
      ? (data.default_recall_budget_prose_tokens ?? 450)
      : (data.user_recall_budget_prose_tokens ??
        data.default_recall_budget_prose_tokens ??
        450),
    recallBudgetCognitionTokens: useDefaults
      ? (data.default_recall_budget_cognition_tokens ?? 220)
      : (data.user_recall_budget_cognition_tokens ??
        data.default_recall_budget_cognition_tokens ??
        220),
    maxSceneFlags: useDefaults
      ? (data.default_max_scene_flags ?? 10)
      : (data.user_max_scene_flags ?? data.default_max_scene_flags ?? 10),
    agentDispatchMode: useDefaults
      ? (data.default_agent_dispatch_mode ?? "sequential")
      : (data.user_agent_dispatch_mode ??
        data.default_agent_dispatch_mode ??
        "sequential"),
    personaDisclosureMode: useDefaults
      ? (data.default_persona_disclosure_mode ?? "llm_intent")
      : (data.user_persona_disclosure_mode ??
        data.default_persona_disclosure_mode ??
        "llm_intent"),
    delegateCognitionToClerk: useDefaults
      ? data.default_delegate_cognition_to_clerk
      : (data.user_delegate_cognition_to_clerk ??
        data.default_delegate_cognition_to_clerk),
    gmModelRole: useDefaults
      ? (data.default_gm_model_role ?? "primary")
      : (data.user_gm_model_role ?? data.default_gm_model_role ?? "primary"),
    gmTemperature: useDefaults
      ? (data.default_gm_temperature ?? 0.5)
      : (data.user_gm_temperature ?? data.default_gm_temperature ?? 0.5),
    gmMaxTokens: useDefaults
      ? (data.default_gm_max_tokens ?? 1024)
      : (data.user_gm_max_tokens ?? data.default_gm_max_tokens ?? 1024),
    activePromptPresetId: data.active_prompt_preset_id ?? null,
  };
}

/** Build the PUT /api/profile/models payload from draft state and loaded settings. */
export function buildUserModelSettingsPayload(
  draft: ProfileModelDraft,
  settings: ProfileModelSettingsResponse
): UserModelSettingsPayload {
  return {
    actor_profile: {
      ...settings.effective_actor_profile,
      provider_id: draft.actorProviderId,
      model: draft.actorModel,
      temperature: draft.actorTemp,
      max_tokens: draft.actorTokens,
      keep_alive_minutes: draft.actorKeepAlive,
      context_size: draft.actorContextSize,
    },
    clerk_profile: {
      ...settings.effective_clerk_profile,
      provider_id: draft.clerkProviderId,
      model: draft.clerkModel,
      temperature: draft.clerkTemp,
      max_tokens: draft.clerkTokens,
      run_on_cpu: draft.clerkRunOnCpu,
      keep_alive_minutes: draft.clerkKeepAlive,
      context_size: draft.clerkContextSize,
    },
    working_memory_turns: draft.workingMemoryTurns,
    active_prompt_preset_id: draft.activePromptPresetId,
    delegate_cognition_to_clerk: draft.delegateCognitionToClerk,
    max_scene_flags: draft.maxSceneFlags,
    agent_dispatch_mode: draft.agentDispatchMode,
    persona_disclosure_mode: draft.personaDisclosureMode,
    clerk_mirrors_actor: draft.clerkMirrorsActor,
    min_working_memory_turns: draft.minWorkingMemoryTurns,
    lod_summary_chunks: draft.lodSummaryChunks,
    lod_importance_bonus: draft.lodImportanceBonus,
    zone2_budget_share_pct: draft.zone2BudgetSharePct,
    recall_budget_prose_tokens: draft.recallBudgetProseTokens,
    recall_budget_cognition_tokens: draft.recallBudgetCognitionTokens,
    gm_model_role: draft.gmModelRole,
    gm_temperature: draft.gmTemperature,
    gm_max_tokens: draft.gmMaxTokens,
  };
}

/** Canonical payload signature excluding active_prompt_preset_id (saved directly by PromptPresetsManager). */
export function serializeProfileModelPayload(
  payload: UserModelSettingsPayload
): string {
  return JSON.stringify({
    actor_profile: payload.actor_profile
      ? {
          provider_id: payload.actor_profile.provider_id ?? null,
          model: payload.actor_profile.model,
          temperature: payload.actor_profile.temperature,
          max_tokens: payload.actor_profile.max_tokens,
          keep_alive_minutes: payload.actor_profile.keep_alive_minutes ?? 30,
          context_size:
            payload.actor_profile.context_size ?? FALLBACK_ACTOR_CONTEXT_SIZE,
        }
      : null,
    clerk_profile: payload.clerk_profile
      ? {
          provider_id: payload.clerk_profile.provider_id ?? null,
          model: payload.clerk_profile.model,
          temperature: payload.clerk_profile.temperature,
          max_tokens: payload.clerk_profile.max_tokens,
          run_on_cpu: payload.clerk_profile.run_on_cpu ?? false,
          keep_alive_minutes: payload.clerk_profile.keep_alive_minutes ?? 30,
          context_size:
            payload.clerk_profile.context_size ?? FALLBACK_CLERK_CONTEXT_SIZE,
        }
      : null,
    working_memory_turns: payload.working_memory_turns ?? null,
    delegate_cognition_to_clerk: payload.delegate_cognition_to_clerk ?? null,
    max_scene_flags: payload.max_scene_flags ?? null,
    agent_dispatch_mode: payload.agent_dispatch_mode ?? null,
    persona_disclosure_mode: payload.persona_disclosure_mode ?? null,
    clerk_mirrors_actor: payload.clerk_mirrors_actor ?? null,
    min_working_memory_turns: payload.min_working_memory_turns ?? null,
    lod_summary_chunks: payload.lod_summary_chunks ?? null,
    lod_importance_bonus: payload.lod_importance_bonus ?? null,
    zone2_budget_share_pct: payload.zone2_budget_share_pct ?? null,
    recall_budget_prose_tokens: payload.recall_budget_prose_tokens ?? null,
    recall_budget_cognition_tokens:
      payload.recall_budget_cognition_tokens ?? null,
    gm_model_role: payload.gm_model_role ?? null,
    gm_temperature: payload.gm_temperature ?? null,
    gm_max_tokens: payload.gm_max_tokens ?? null,
  });
}

/** Return true only when model and behavior changes are allowed, valid, and safe to persist. */
export function canAutoSaveProfileModels(opts: {
  modelLoading: boolean;
  allowUserModelOverrides: boolean;
  modelsDeckInvalid: number;
  behaviorInvalid?: number;
  providerCount: number;
  actorProviderId: string | null;
  actorModel: string;
  clerkMirrorsActor: boolean;
  clerkProviderId: string | null;
  clerkModel: string;
}): boolean {
  if (opts.modelLoading || !opts.allowUserModelOverrides) {
    return false;
  }
  if (opts.modelsDeckInvalid > 0 || (opts.behaviorInvalid ?? 0) > 0) {
    return false;
  }
  if (opts.providerCount > 0) {
    if (!opts.actorProviderId || !opts.actorModel) {
      return false;
    }
    if (!opts.clerkMirrorsActor && (!opts.clerkProviderId || !opts.clerkModel)) {
      return false;
    }
  }
  return true;
}
