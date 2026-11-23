import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProfileModelSettingsResponse, UserProfile } from "../../types";
import { ProvidersProvider } from "../providers/ProvidersContext";
import {
  ProfileBehaviorCards,
  type ProfileBehaviorValues,
} from "../auth/ProfileBehaviorCards";
import { ProfileModal } from "../auth/ProfileModal";
import { ProfilePreferencesTab } from "../auth/ProfilePreferencesTab";

const PLAYER_USER: UserProfile = {
  id: "user_1",
  username: "player_one",
  display_name: "Player One",
  role: "user",
  has_password: true,
  passkeys: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  last_login_at: "2026-11-01T00:00:00Z",
  last_active_at: "2026-11-10T00:00:00Z",
  media_bytes_used: 0,
  media_quota_bytes: 5 * 1024 * 1024,
};

const BASE_DEFAULTS: ProfileBehaviorValues = {
  workingMemoryTurns: 12,
  minWorkingMemoryTurns: 4,
  lodSummaryChunks: 6,
  lodImportanceBonus: 2,
  zone2BudgetSharePct: 45,
  recallBudgetProseTokens: 450,
  recallBudgetCognitionTokens: 220,
  maxSceneFlags: 10,
  agentDispatchMode: "sequential",
  personaDisclosureMode: "llm_intent",
  delegateCognitionToClerk: false,
  gmModelRole: "primary",
  gmTemperature: 0.5,
  gmMaxTokens: 1024,
};

const BASE_MODEL_SETTINGS: ProfileModelSettingsResponse = {
  allow_user_model_overrides: true,
  allow_user_providers: true,
  provider_credential_store: "prefer_server",
  warnings: [],
  effective_clerk_mirrors_actor: false,
  user_clerk_mirrors_actor: null,
  default_clerk_mirrors_actor: false,
  has_override: true,
  effective_actor_profile: {
    provider_id: null,
    model: "actor-default",
    temperature: 0.75,
    max_tokens: 1024,
    keep_alive_minutes: 30,
    context_size: 12288,
    timeout_seconds: 60,
  },
  effective_clerk_profile: {
    provider_id: null,
    model: "clerk-default",
    temperature: 0.2,
    max_tokens: 768,
    keep_alive_minutes: 30,
    context_size: 8192,
    run_on_cpu: false,
    timeout_seconds: 60,
  },
  effective_working_memory_turns: 16,
  effective_delegate_cognition_to_clerk: true,
  effective_max_scene_flags: 10,
  effective_agent_dispatch_mode: "sequential",
  effective_persona_disclosure_mode: "llm_intent",
  effective_min_working_memory_turns: 4,
  effective_lod_summary_chunks: 6,
  effective_lod_importance_bonus: 2,
  effective_zone2_budget_share_pct: 45,
  effective_recall_budget_prose_tokens: 450,
  effective_recall_budget_cognition_tokens: 220,
  user_working_memory_turns: 16,
  user_delegate_cognition_to_clerk: true,
  active_prompt_preset_id: null,
  default_actor_profile: {
    provider_id: null,
    model: "actor-default",
    temperature: 0.75,
    max_tokens: 1024,
    keep_alive_minutes: 30,
    context_size: 12288,
    timeout_seconds: 60,
  },
  default_clerk_profile: {
    provider_id: null,
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
  default_recall_budget_cognition_tokens: 220,
};

describe("ProfileModal UX Redesign UI", () => {
  it("renders stable modal frame with Preferences before Account and sub-tabs ordered Providers -> Models -> Prompts & Presets -> Behavior", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProfileModal, {
        user: PLAYER_USER,
        singleUserMode: false,
        initialModelSettings: BASE_MODEL_SETTINGS,
        onClose: vi.fn(),
        onUserUpdated: vi.fn(),
        onAccountReset: vi.fn(async () => {}),
        onAccountDeleted: vi.fn(async () => {}),
      })
    );

    expect(html).toContain("profile-modal-panel");
    expect(html).not.toContain("max-width:660px");

    const prefIdx = html.indexOf(">Preferences");
    const accountIdx = html.indexOf(">Account");
    expect(prefIdx).toBeGreaterThan(-1);
    expect(accountIdx).toBeGreaterThan(prefIdx);
    expect(html).not.toContain(">Identity<");

    const providersIdx = html.indexOf(">Providers");
    const modelsIdx = html.indexOf(">Models");
    const promptsIdx = html.indexOf(">Prompts &amp; Presets");
    const behaviorIdx = html.indexOf(">Behavior");
    expect(providersIdx).toBeGreaterThan(-1);
    expect(modelsIdx).toBeGreaterThan(providersIdx);
    expect(promptsIdx).toBeGreaterThan(modelsIdx);
    expect(behaviorIdx).toBeGreaterThan(promptsIdx);
  });

  it("defaults to Models sub-tab when personal providers are disabled and routes legacy identity initialTab to Account", () => {
    const noByopHtml = renderToStaticMarkup(
      React.createElement(ProfileModal, {
        user: PLAYER_USER,
        singleUserMode: false,
        initialModelSettings: {
          ...BASE_MODEL_SETTINGS,
          allow_user_providers: false,
        },
        onClose: vi.fn(),
        onUserUpdated: vi.fn(),
        onAccountReset: vi.fn(async () => {}),
        onAccountDeleted: vi.fn(async () => {}),
      })
    );
    expect(noByopHtml).toContain("Primary Actor");
    expect(noByopHtml).not.toContain("Save My Model Overrides");

    const legacyIdentityHtml = renderToStaticMarkup(
      React.createElement(ProfileModal, {
        user: PLAYER_USER,
        singleUserMode: false,
        initialTab: "identity",
        onClose: vi.fn(),
        onUserUpdated: vi.fn(),
        onAccountReset: vi.fn(async () => {}),
        onAccountDeleted: vi.fn(async () => {}),
      })
    );
    expect(legacyIdentityHtml).toContain("Account Identity");
    expect(legacyIdentityHtml).toContain("Username (Read-Only)");
    expect(legacyIdentityHtml).toContain("Display Name");
    expect(legacyIdentityHtml).toContain("Media Storage &amp; Activity");
  });

  it("renders Behavior sub-tab with 4 zone cards, Reset All action, no manual Save button, and Delegate Cognition to Clerk", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProvidersProvider, {
        probeSystem: false,
        children: React.createElement(ProfilePreferencesTab, {
          activePrefTab: "behavior",
          setActivePrefTab: vi.fn(),
          hasExplicitSubTab: true,
          setStatusMsg: vi.fn(),
          setErrorMsg: vi.fn(),
          initialModelSettings: BASE_MODEL_SETTINGS,
        }),
      })
    );

    expect(html).not.toContain("Save Preferences");
    expect(html).toContain("Reset All");
    expect(html).toContain("Recent Dialogue");
    expect(html).toContain("Story Recaps");
    expect(html).toContain("Long-Term Recall");
    expect(html).toContain("Scene State &amp; Turn Engine");
    expect(html).toContain("Delegate Cognition to Clerk");
    expect(html).not.toContain("System Default:");
  });

  it("places Behavior settings into their accurate cards and renders per-field reset icons only for overridden unlocked fields", () => {
    const overriddenHtml = renderToStaticMarkup(
      React.createElement(ProfileBehaviorCards, {
        values: {
          ...BASE_DEFAULTS,
          workingMemoryTurns: 20,
          delegateCognitionToClerk: true,
        },
        defaults: BASE_DEFAULTS,
        isLocked: false,
        onChangeField: vi.fn(),
      })
    );

    const recallIdx = overriddenHtml.indexOf("Long-Term Recall");
    const engineIdx = overriddenHtml.indexOf("Scene State &amp; Turn Engine");
    const proseRecallIdx = overriddenHtml.indexOf(
      "Story Prose Recall Budget (tokens)"
    );
    const cogRecallIdx = overriddenHtml.indexOf(
      "Character Cognition Recall Budget (tokens)"
    );
    const flagsIdx = overriddenHtml.indexOf("Max Active Scene Flags");
    const delegateIdx = overriddenHtml.indexOf("Delegate Cognition to Clerk");

    expect(recallIdx).toBeGreaterThan(-1);
    expect(engineIdx).toBeGreaterThan(recallIdx);
    expect(proseRecallIdx).toBeGreaterThan(recallIdx);
    expect(proseRecallIdx).toBeLessThan(engineIdx);
    expect(cogRecallIdx).toBeGreaterThan(recallIdx);
    expect(cogRecallIdx).toBeLessThan(engineIdx);
    expect(flagsIdx).toBeGreaterThan(engineIdx);
    expect(delegateIdx).toBeGreaterThan(engineIdx);

    expect(overriddenHtml).toContain("Reset to system default (12)");
    expect(overriddenHtml).toContain("Reset to system default (Off)");
    expect(overriddenHtml).not.toContain("Reset to system default (450)");

    const lockedHtml = renderToStaticMarkup(
      React.createElement(ProfileBehaviorCards, {
        values: {
          ...BASE_DEFAULTS,
          workingMemoryTurns: 20,
          delegateCognitionToClerk: true,
        },
        defaults: BASE_DEFAULTS,
        isLocked: true,
        onChangeField: vi.fn(),
      })
    );
    expect(lockedHtml).not.toContain("Reset to system default (");
  });
});
