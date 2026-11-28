import { describe, expect, it } from "vitest";
import type { ProfileModelSettingsResponse } from "../../types";
import {
  buildUserModelSettingsPayload,
  canAutoSaveProfileModels,
  extractDraftFromProfileSettings,
  hasExplicitPrefSubTab,
  resolveProfileInitialTab,
  resolveProfilePrefSubTab,
  serializeProfileModelPayload,
} from "../profilePreferences";

const SAMPLE_SETTINGS: ProfileModelSettingsResponse = {
  allow_user_model_overrides: true,
  allow_user_providers: true,
  provider_credential_store: "prefer_server",
  warnings: [],
  effective_clerk_mirrors_actor: false,
  user_clerk_mirrors_actor: null,
  default_clerk_mirrors_actor: false,
  has_override: false,
  effective_actor_profile: {
    provider_id: "prov-1",
    model: "actor-default",
    temperature: 0.75,
    max_tokens: 1024,
    keep_alive_minutes: 30,
    context_size: 12288,
    timeout_seconds: 60,
  },
  effective_clerk_profile: {
    provider_id: "prov-1",
    model: "clerk-default",
    temperature: 0.2,
    max_tokens: 768,
    keep_alive_minutes: 30,
    context_size: 8192,
    run_on_cpu: false,
    timeout_seconds: 60,
  },
  effective_working_memory_turns: 12,
  effective_delegate_cognition_to_clerk: false,
  effective_max_scene_flags: 10,
  effective_agent_dispatch_mode: "sequential",
  effective_persona_disclosure_mode: "llm_intent",
  effective_min_working_memory_turns: 4,
  effective_lod_summary_chunks: 6,
  effective_lod_importance_bonus: 2,
  effective_zone2_budget_share_pct: 45,
  effective_recall_budget_prose_tokens: 450,
  effective_recall_budget_cognition_tokens: 450,
  active_prompt_preset_id: null,
  default_actor_profile: {
    provider_id: "prov-1",
    model: "actor-default",
    temperature: 0.75,
    max_tokens: 1024,
    keep_alive_minutes: 30,
    context_size: 12288,
    timeout_seconds: 60,
  },
  default_clerk_profile: {
    provider_id: "prov-1",
    model: "clerk-default",
    temperature: 0.2,
    max_tokens: 768,
    keep_alive_minutes: 30,
    context_size: 8192,
    run_on_cpu: false,
    timeout_seconds: 60,
  },
  default_working_memory_turns: 12,
  default_delegate_cognition_to_clerk: false,
  default_max_scene_flags: 10,
  default_agent_dispatch_mode: "sequential",
  default_persona_disclosure_mode: "llm_intent",
  default_min_working_memory_turns: 4,
  default_lod_summary_chunks: 6,
  default_lod_importance_bonus: 2,
  default_zone2_budget_share_pct: 45,
  default_recall_budget_prose_tokens: 450,
  default_recall_budget_cognition_tokens: 450,
};

describe("profilePreferences helpers", () => {
  it("resolves top-level tabs defaulting to preferences and aliasing identity to account", () => {
    expect(resolveProfileInitialTab(undefined)).toBe("preferences");
    expect(resolveProfileInitialTab("preferences")).toBe("preferences");
    expect(resolveProfileInitialTab("models")).toBe("preferences");
    expect(resolveProfileInitialTab("prompts")).toBe("preferences");
    expect(resolveProfileInitialTab("behavior")).toBe("preferences");
    expect(resolveProfileInitialTab("account")).toBe("account");
    expect(resolveProfileInitialTab("identity")).toBe("account");
  });

  it("resolves Preferences sub-tab respecting explicit targets and BYOP policy", () => {
    expect(hasExplicitPrefSubTab(undefined, undefined)).toBe(false);
    expect(hasExplicitPrefSubTab("preferences", undefined)).toBe(false);
    expect(hasExplicitPrefSubTab("models", undefined)).toBe(true);
    expect(hasExplicitPrefSubTab("preferences", "behavior")).toBe(true);

    expect(
      resolveProfilePrefSubTab({
        initialTab: "preferences",
        allowUserProviders: true,
      })
    ).toBe("providers");
    expect(
      resolveProfilePrefSubTab({
        initialTab: "preferences",
        allowUserProviders: false,
      })
    ).toBe("models");
    expect(
      resolveProfilePrefSubTab({
        initialTab: "behavior",
        allowUserProviders: true,
      })
    ).toBe("behavior");
    expect(
      resolveProfilePrefSubTab({
        initialTab: "preferences",
        initialSubTab: "prompts",
        allowUserProviders: false,
      })
    ).toBe("prompts");
  });

  it("extracts, builds, and compares model/behavior payloads ignoring active_prompt_preset_id", () => {
    const draft = extractDraftFromProfileSettings(SAMPLE_SETTINGS);
    const payloadA = buildUserModelSettingsPayload(draft, SAMPLE_SETTINGS);
    const payloadB = buildUserModelSettingsPayload(
      { ...draft, activePromptPresetId: "preset-custom-1" },
      SAMPLE_SETTINGS
    );
    expect(serializeProfileModelPayload(payloadA)).toBe(
      serializeProfileModelPayload(payloadB)
    );

    const payloadC = buildUserModelSettingsPayload(
      { ...draft, delegateCognitionToClerk: true },
      SAMPLE_SETTINGS
    );
    expect(serializeProfileModelPayload(payloadC)).not.toBe(
      serializeProfileModelPayload(payloadA)
    );
  });

  it("gates auto-save on lock state, field validity, and provider/model completeness", () => {
    const base = {
      modelLoading: false,
      allowUserModelOverrides: true,
      modelsDeckInvalid: 0,
      behaviorInvalid: 0,
      providerCount: 1,
      actorProviderId: "prov-1",
      actorModel: "actor-default",
      clerkMirrorsActor: false,
      clerkProviderId: "prov-1",
      clerkModel: "clerk-default",
    };

    expect(canAutoSaveProfileModels(base)).toBe(true);
    expect(canAutoSaveProfileModels({ ...base, modelLoading: true })).toBe(false);
    expect(
      canAutoSaveProfileModels({ ...base, allowUserModelOverrides: false })
    ).toBe(false);
    expect(canAutoSaveProfileModels({ ...base, modelsDeckInvalid: 1 })).toBe(
      false
    );
    expect(canAutoSaveProfileModels({ ...base, behaviorInvalid: 1 })).toBe(
      false
    );
    expect(canAutoSaveProfileModels({ ...base, actorModel: "" })).toBe(false);
    expect(
      canAutoSaveProfileModels({
        ...base,
        clerkProviderId: null,
        clerkModel: "",
        clerkMirrorsActor: false,
      })
    ).toBe(false);
    expect(
      canAutoSaveProfileModels({
        ...base,
        clerkProviderId: null,
        clerkModel: "",
        clerkMirrorsActor: true,
      })
    ).toBe(true);
  });
});
