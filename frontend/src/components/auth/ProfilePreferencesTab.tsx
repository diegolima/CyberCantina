import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  FileText,
  Loader2,
  Lock,
  RotateCcw,
  Server,
} from "lucide-react";
import { api } from "../../api";
import { PromptPresetsManager } from "../PromptPresetsManager";
import {
  ProfileModelSettingsResponse,
  UserModelSettingsPayload,
} from "../../types";
import {
  buildUserModelSettingsPayload,
  canAutoSaveProfileModels,
  extractDraftFromProfileSettings,
  ProfileModelDraft,
  ProfilePrefSubTab,
  serializeProfileModelPayload,
} from "../../utils/profilePreferences";
import { ModelDeck } from "../models/ModelDeck";
import {
  DEFAULT_ACTOR_CONTEXT_SIZE,
  DEFAULT_CLERK_CONTEXT_SIZE,
} from "../models/modelLimits";
import { ProvidersManager } from "../providers/ProvidersManager";
import { useProviders } from "../providers/ProvidersContext";
import {
  ProfileBehaviorCards,
  ProfileBehaviorValues,
} from "./ProfileBehaviorCards";

export interface ProfilePreferencesTabProps {
  activePrefTab: ProfilePrefSubTab;
  setActivePrefTab: (tab: ProfilePrefSubTab) => void;
  hasExplicitSubTab?: boolean;
  setStatusMsg: (msg: string | null) => void;
  setErrorMsg: (msg: string | null) => void;
  onLockStateChange?: (locked: boolean) => void;
  initialModelSettings?: ProfileModelSettingsResponse | null;
}

type AutoSaveState = "idle" | "saving" | "saved" | "paused" | "error";

const INITIAL_DRAFT: ProfileModelDraft = {
  actorProviderId: null,
  actorModel: "",
  actorTemp: 0.75,
  actorTokens: 1024,
  actorKeepAlive: 30,
  actorContextSize: DEFAULT_ACTOR_CONTEXT_SIZE,
  clerkProviderId: null,
  clerkModel: "",
  clerkTemp: 0.2,
  clerkTokens: 768,
  clerkKeepAlive: 30,
  clerkContextSize: DEFAULT_CLERK_CONTEXT_SIZE,
  clerkMirrorsActor: false,
  clerkRunOnCpu: false,
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
  activePromptPresetId: null,
};

const FALLBACK_BEHAVIOR_DEFAULTS: ProfileBehaviorValues = {
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

function getBehaviorDefaultsFromSettings(
  settings: ProfileModelSettingsResponse | null
): ProfileBehaviorValues {
  if (!settings) return FALLBACK_BEHAVIOR_DEFAULTS;
  return {
    workingMemoryTurns: settings.default_working_memory_turns,
    minWorkingMemoryTurns: settings.default_min_working_memory_turns ?? 4,
    lodSummaryChunks: settings.default_lod_summary_chunks ?? 6,
    lodImportanceBonus: settings.default_lod_importance_bonus ?? 2,
    zone2BudgetSharePct: settings.default_zone2_budget_share_pct ?? 45,
    recallBudgetProseTokens: settings.default_recall_budget_prose_tokens ?? 450,
    recallBudgetCognitionTokens:
      settings.default_recall_budget_cognition_tokens ?? 220,
    maxSceneFlags: settings.default_max_scene_flags ?? 10,
    agentDispatchMode: settings.default_agent_dispatch_mode ?? "sequential",
    personaDisclosureMode:
      settings.default_persona_disclosure_mode ?? "llm_intent",
    delegateCognitionToClerk: settings.default_delegate_cognition_to_clerk,
    gmModelRole: settings.default_gm_model_role ?? "primary",
    gmTemperature: settings.default_gm_temperature ?? 0.5,
    gmMaxTokens: settings.default_gm_max_tokens ?? 1024,
  };
}

export const ProfilePreferencesTab: React.FC<ProfilePreferencesTabProps> = ({
  activePrefTab,
  setActivePrefTab,
  hasExplicitSubTab = false,
  setStatusMsg,
  setErrorMsg,
  onLockStateChange,
  initialModelSettings = null,
}) => {
  const providerStore = useProviders();
  const [modelSettings, setModelSettings] =
    useState<ProfileModelSettingsResponse | null>(initialModelSettings);
  const [modelLoading, setModelLoading] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [modelsDeckInvalid, setModelsDeckInvalid] = useState(0);
  const [behaviorInvalid, setBehaviorInvalid] = useState(0);
  const [saveState, setSaveState] = useState<AutoSaveState>("idle");
  const [draft, setDraft] = useState<ProfileModelDraft>(() =>
    initialModelSettings
      ? extractDraftFromProfileSettings(initialModelSettings)
      : INITIAL_DRAFT
  );

  const lastPersistedSigRef = useRef<string | null>(
    initialModelSettings
      ? serializeProfileModelPayload(
          buildUserModelSettingsPayload(
            extractDraftFromProfileSettings(initialModelSettings),
            initialModelSettings
          )
        )
      : null
  );
  const saveTimerRef = useRef<number | null>(null);
  const savedFadeTimerRef = useRef<number | null>(null);
  const saveSeqRef = useRef(0);
  const nextDelayRef = useRef(400);
  const pendingPayloadRef = useRef<UserModelSettingsPayload | null>(null);
  const allowOverridesRef = useRef(
    Boolean(initialModelSettings?.allow_user_model_overrides)
  );
  const userChoseSubTabRef = useRef(false);
  const setActivePrefTabRef = useRef(setActivePrefTab);
  const setErrorMsgRef = useRef(setErrorMsg);
  const hasExplicitSubTabRef = useRef(hasExplicitSubTab);

  setActivePrefTabRef.current = setActivePrefTab;
  setErrorMsgRef.current = setErrorMsg;
  hasExplicitSubTabRef.current = hasExplicitSubTab;

  useEffect(() => {
    allowOverridesRef.current = Boolean(modelSettings?.allow_user_model_overrides);
  }, [modelSettings?.allow_user_model_overrides]);

  const clearSaveTimer = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const clearSavedFadeTimer = () => {
    if (savedFadeTimerRef.current !== null) {
      window.clearTimeout(savedFadeTimerRef.current);
      savedFadeTimerRef.current = null;
    }
  };

  const scheduleSavedFade = useCallback(() => {
    clearSavedFadeTimer();
    savedFadeTimerRef.current = window.setTimeout(() => {
      setSaveState((cur) => (cur === "saved" ? "idle" : cur));
    }, 2200);
  }, []);

  const persistPayload = useCallback(
    async (payload: UserModelSettingsPayload, sig: string) => {
      const seq = ++saveSeqRef.current;
      clearSavedFadeTimer();
      setSaveState("saving");
      try {
        const res = await api.updateProfileModels(payload);
        if (seq !== saveSeqRef.current) return;
        setModelSettings(res);
        lastPersistedSigRef.current = sig;
        pendingPayloadRef.current = null;
        setErrorMsgRef.current(null);
        setSaveState("saved");
        scheduleSavedFade();
      } catch (err: any) {
        if (seq !== saveSeqRef.current) return;
        setSaveState("error");
        setErrorMsgRef.current(err?.message || "Failed to save preferences.");
      }
    },
    [scheduleSavedFade]
  );

  const loadProfileModels = useCallback(async () => {
    setModelLoading(true);
    try {
      const data = await api.getProfileModels();
      const hydrated = extractDraftFromProfileSettings(data);
      const initialPayload = buildUserModelSettingsPayload(hydrated, data);
      lastPersistedSigRef.current = serializeProfileModelPayload(initialPayload);
      pendingPayloadRef.current = null;
      setModelSettings(data);
      setDraft(hydrated);
      setSaveState("idle");

      if (
        !hasExplicitSubTabRef.current &&
        !userChoseSubTabRef.current &&
        !data.allow_user_providers
      ) {
        setActivePrefTabRef.current("models");
      }
    } catch (err: any) {
      setErrorMsgRef.current(err?.message || "Failed to load preferences.");
    } finally {
      setModelLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfileModels();
  }, [loadProfileModels]);

  useEffect(() => {
    if (modelSettings) {
      onLockStateChange?.(!modelSettings.allow_user_model_overrides);
    }
  }, [modelSettings?.allow_user_model_overrides, onLockStateChange]);

  const updateDraft = useCallback(
    (patch: Partial<ProfileModelDraft>, opts?: { immediate?: boolean }) => {
      nextDelayRef.current = opts?.immediate ? 150 : 400;
      setDraft((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const canSaveNow = canAutoSaveProfileModels({
    modelLoading,
    allowUserModelOverrides: Boolean(modelSettings?.allow_user_model_overrides),
    modelsDeckInvalid,
    behaviorInvalid,
    providerCount: providerStore.providers.length,
    actorProviderId: draft.actorProviderId,
    actorModel: draft.actorModel,
    clerkMirrorsActor: draft.clerkMirrorsActor,
    clerkProviderId: draft.clerkProviderId,
    clerkModel: draft.clerkModel,
  });

  useEffect(() => {
    if (!modelSettings || modelLoading || lastPersistedSigRef.current === null) {
      return;
    }

    const payload = buildUserModelSettingsPayload(draft, modelSettings);
    const sig = serializeProfileModelPayload(payload);

    if (sig === lastPersistedSigRef.current) {
      clearSaveTimer();
      pendingPayloadRef.current = null;
      setSaveState((cur) => (cur === "paused" ? "idle" : cur));
      return;
    }

    if (!canSaveNow) {
      clearSaveTimer();
      pendingPayloadRef.current = null;
      if (modelSettings.allow_user_model_overrides) {
        setSaveState("paused");
      }
      return;
    }

    pendingPayloadRef.current = payload;
    clearSaveTimer();
    const delay = nextDelayRef.current;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistPayload(payload, sig);
    }, delay);
  }, [
    modelSettings,
    modelLoading,
    draft,
    canSaveNow,
    persistPayload,
  ]);

  const flushPendingSave = useCallback(() => {
    if (
      saveTimerRef.current === null ||
      !pendingPayloadRef.current ||
      !modelSettings ||
      !canSaveNow
    ) {
      return;
    }
    const payload = pendingPayloadRef.current;
    const sig = serializeProfileModelPayload(payload);
    clearSaveTimer();
    void persistPayload(payload, sig);
  }, [canSaveNow, modelSettings, persistPayload]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (savedFadeTimerRef.current !== null) {
        window.clearTimeout(savedFadeTimerRef.current);
        savedFadeTimerRef.current = null;
      }
      if (pendingPayloadRef.current && allowOverridesRef.current) {
        const pending = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        void api.updateProfileModels(pending).catch(() => undefined);
      }
    };
  }, []);

  const handleSelectSubTab = (tab: ProfilePrefSubTab) => {
    userChoseSubTabRef.current = true;
    setActivePrefTab(tab);
  };

  const handleResetActor = () => {
    if (!modelSettings) return;
    const def = modelSettings.default_actor_profile;
    updateDraft(
      {
        actorProviderId: def.provider_id ?? null,
        actorModel: def.model,
        actorTemp: def.temperature,
        actorTokens: def.max_tokens,
        actorKeepAlive: def.keep_alive_minutes ?? 30,
        actorContextSize: def.context_size ?? DEFAULT_ACTOR_CONTEXT_SIZE,
      },
      { immediate: true }
    );
  };

  const handleResetClerk = () => {
    if (!modelSettings) return;
    const def = modelSettings.default_clerk_profile;
    updateDraft(
      {
        clerkProviderId: def.provider_id ?? null,
        clerkModel: def.model,
        clerkTemp: def.temperature,
        clerkTokens: def.max_tokens,
        clerkKeepAlive: def.keep_alive_minutes ?? 30,
        clerkContextSize: def.context_size ?? DEFAULT_CLERK_CONTEXT_SIZE,
        clerkMirrorsActor: modelSettings.default_clerk_mirrors_actor ?? false,
        clerkRunOnCpu: def.run_on_cpu ?? false,
      },
      { immediate: true }
    );
  };

  const isActorOverridden =
    !!modelSettings?.user_actor_profile ||
    draft.actorModel !== modelSettings?.default_actor_profile.model ||
    (draft.actorProviderId ?? null) !==
      (modelSettings?.default_actor_profile.provider_id ?? null) ||
    draft.actorTemp !== modelSettings?.default_actor_profile.temperature ||
    draft.actorTokens !== modelSettings?.default_actor_profile.max_tokens ||
    draft.actorContextSize !==
      (modelSettings?.default_actor_profile.context_size ??
        DEFAULT_ACTOR_CONTEXT_SIZE);

  const isClerkOverridden =
    !!modelSettings?.user_clerk_profile ||
    draft.clerkModel !== modelSettings?.default_clerk_profile.model ||
    (draft.clerkProviderId ?? null) !==
      (modelSettings?.default_clerk_profile.provider_id ?? null) ||
    draft.clerkTemp !== modelSettings?.default_clerk_profile.temperature ||
    draft.clerkTokens !== modelSettings?.default_clerk_profile.max_tokens ||
    draft.clerkContextSize !==
      (modelSettings?.default_clerk_profile.context_size ??
        DEFAULT_CLERK_CONTEXT_SIZE) ||
    draft.clerkMirrorsActor !==
      (modelSettings?.default_clerk_mirrors_actor ?? false);

  const handleResetModelOverrides = async () => {
    clearSaveTimer();
    clearSavedFadeTimer();
    pendingPayloadRef.current = null;
    saveSeqRef.current += 1;
    setResettingAll(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setSaveState("saving");
    try {
      const res = await api.resetProfileModels();
      const resetDraft = extractDraftFromProfileSettings(res);
      const resetPayload = buildUserModelSettingsPayload(resetDraft, res);
      lastPersistedSigRef.current = serializeProfileModelPayload(resetPayload);
      setModelSettings(res);
      setDraft(resetDraft);
      setSaveState("saved");
      scheduleSavedFade();
    } catch (err: any) {
      setSaveState("error");
      setErrorMsg(err?.message || "Failed to reset preferences.");
    } finally {
      setResettingAll(false);
    }
  };

  const behaviorValues: ProfileBehaviorValues = {
    workingMemoryTurns: draft.workingMemoryTurns,
    minWorkingMemoryTurns: draft.minWorkingMemoryTurns,
    lodSummaryChunks: draft.lodSummaryChunks,
    lodImportanceBonus: draft.lodImportanceBonus,
    zone2BudgetSharePct: draft.zone2BudgetSharePct,
    recallBudgetProseTokens: draft.recallBudgetProseTokens,
    recallBudgetCognitionTokens: draft.recallBudgetCognitionTokens,
    maxSceneFlags: draft.maxSceneFlags,
    agentDispatchMode: draft.agentDispatchMode,
    personaDisclosureMode: draft.personaDisclosureMode,
    delegateCognitionToClerk: draft.delegateCognitionToClerk,
    gmModelRole: draft.gmModelRole,
    gmTemperature: draft.gmTemperature,
    gmMaxTokens: draft.gmMaxTokens,
  };

  const behaviorDefaults = getBehaviorDefaultsFromSettings(modelSettings);
  const isLocked = modelSettings ? !modelSettings.allow_user_model_overrides : false;

  const renderSavePill = () => {
    if (saveState === "saving") {
      return (
        <span className="ui-pill ui-pill--cyan" role="status">
          <Loader2 size={12} className="spin" />
          Saving…
        </span>
      );
    }
    if (saveState === "saved") {
      return (
        <span className="ui-pill ui-pill--emerald" role="status">
          <Check size={12} />
          Saved
        </span>
      );
    }
    if (saveState === "paused") {
      const label =
        modelsDeckInvalid > 0 && activePrefTab !== "models"
          ? "Save paused: fix invalid Model settings"
          : "Save paused: fix invalid input";
      return (
        <span className="ui-pill ui-pill--amber" role="status">
          <AlertTriangle size={12} />
          {label}
        </span>
      );
    }
    if (saveState === "error") {
      return (
        <span className="ui-pill ui-pill--rose" role="alert">
          <AlertTriangle size={12} />
          Save failed
        </span>
      );
    }
    return null;
  };

  const showResetAll =
    (activePrefTab === "models" || activePrefTab === "behavior") &&
    Boolean(modelSettings?.allow_user_model_overrides && modelSettings?.has_override);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Secondary Sub-tab Navigation (Providers -> Models -> Prompts & Presets -> Behavior) */}
      <div className="pref-subtabs-bar">
        <div
          className="pref-subtabs-group"
          role="tablist"
          aria-label="Preferences sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activePrefTab === "providers"}
            className={`btn btn-sm ${
              activePrefTab === "providers" ? "btn-amber" : ""
            }`}
            onClick={() => handleSelectSubTab("providers")}
          >
            <Server size={13} />
            Providers
            {modelSettings && !modelSettings.allow_user_providers && (
              <span className="modal-tab-badge" style={{ marginLeft: 4 }}>
                Locked
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePrefTab === "models"}
            className={`btn btn-sm ${
              activePrefTab === "models" ? "btn-amber" : ""
            }`}
            onClick={() => handleSelectSubTab("models")}
          >
            <Cpu size={13} />
            Models
            {modelSettings && !modelSettings.allow_user_model_overrides && (
              <span className="modal-tab-badge" style={{ marginLeft: 4 }}>
                Locked
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePrefTab === "prompts"}
            className={`btn btn-sm ${
              activePrefTab === "prompts" ? "btn-amber" : ""
            }`}
            onClick={() => handleSelectSubTab("prompts")}
          >
            <FileText size={13} />
            Prompts &amp; Presets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePrefTab === "behavior"}
            className={`btn btn-sm ${
              activePrefTab === "behavior" ? "btn-amber" : ""
            }`}
            onClick={() => handleSelectSubTab("behavior")}
          >
            <Activity size={13} />
            Behavior
            {modelSettings && !modelSettings.allow_user_model_overrides && (
              <span className="modal-tab-badge" style={{ marginLeft: 4 }}>
                Locked
              </span>
            )}
          </button>
        </div>

        <div className="pref-subtabs-actions">
          {renderSavePill()}
          {showResetAll && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleResetModelOverrides}
              disabled={resettingAll}
              title="Reset all model and behavior preferences to system defaults"
            >
              <RotateCcw size={12} />
              Reset All
            </button>
          )}
        </div>
      </div>

      {/* Providers Sub-tab */}
      {activePrefTab === "providers" && (
        <ProvidersManager
          variant="profile"
          allowUserProviders={!!modelSettings?.allow_user_providers}
          credentialStoreMode={
            modelSettings?.provider_credential_store ?? "prefer_server"
          }
        />
      )}

      {modelLoading && activePrefTab !== "providers" && (
        <div
          style={{
            padding: "24px 0",
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
          }}
        >
          Loading preferences...
        </div>
      )}

      {/* Models Sub-tab */}
      {!modelLoading && activePrefTab === "models" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {modelSettings?.warnings?.map((w, i) => (
            <div key={i} className="provider-warning" role="alert">
              <AlertTriangle size={13} />
              <span>
                Your saved {w.role} choice is not usable (
                {w.code === "byop_disabled"
                  ? "personal providers are disabled"
                  : w.code === "browser_storage_disabled"
                    ? "browser-stored provider credentials are disabled"
                    : w.code === "disabled"
                      ? "the provider is disabled"
                      : w.code === "missing_provider"
                        ? "no provider selected"
                        : "the provider is gone"}
                ). The system default is used until you choose again.
              </span>
            </div>
          ))}

          {modelSettings && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!modelSettings.allow_user_model_overrides ? (
                <div className="auth-warning-box">
                  <Lock size={16} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>Per-User Model Overrides Disabled:</strong> The
                    system administrator has configured global default models
                    for all roleplay sessions. Custom model overrides are
                    currently locked.
                  </span>
                </div>
              ) : (
                <div className="provider-note">
                  Providers are managed in the <strong>Providers</strong> tab
                  {modelSettings.allow_user_providers
                    ? ", where you can also add your own."
                    : "."}
                </div>
              )}

              <ModelDeck
                scope="user"
                isLocked={!modelSettings.allow_user_model_overrides}
                actorSelection={{
                  providerId: draft.actorProviderId,
                  model: draft.actorModel,
                }}
                onActorSelection={(sel) =>
                  updateDraft(
                    { actorProviderId: sel.providerId, actorModel: sel.model },
                    { immediate: true }
                  )
                }
                actorTemp={draft.actorTemp}
                onActorTemp={(v) => updateDraft({ actorTemp: v })}
                actorTokens={draft.actorTokens}
                onActorTokens={(v) => updateDraft({ actorTokens: v })}
                actorKeepAlive={draft.actorKeepAlive}
                onActorKeepAlive={(v) => updateDraft({ actorKeepAlive: v })}
                actorContextSize={draft.actorContextSize}
                onActorContextSize={(v) => updateDraft({ actorContextSize: v })}
                actorOverridden={isActorOverridden}
                onResetActor={handleResetActor}
                clerkSelection={{
                  providerId: draft.clerkProviderId,
                  model: draft.clerkModel,
                }}
                onClerkSelection={(sel) => {
                  const newProv = sel.providerId
                    ? providerStore.byId(sel.providerId)
                    : null;
                  const clearCpu =
                    newProv &&
                    newProv.type !== "ollama" &&
                    newProv.type !== "browser_ollama";
                  updateDraft(
                    {
                      clerkProviderId: sel.providerId,
                      clerkModel: sel.model,
                      ...(clearCpu ? { clerkRunOnCpu: false } : {}),
                    },
                    { immediate: true }
                  );
                }}
                clerkTemp={draft.clerkTemp}
                onClerkTemp={(v) => updateDraft({ clerkTemp: v })}
                clerkTokens={draft.clerkTokens}
                onClerkTokens={(v) => updateDraft({ clerkTokens: v })}
                clerkKeepAlive={draft.clerkKeepAlive}
                onClerkKeepAlive={(v) => updateDraft({ clerkKeepAlive: v })}
                clerkContextSize={draft.clerkContextSize}
                onClerkContextSize={(v) => updateDraft({ clerkContextSize: v })}
                clerkMirrorsActor={draft.clerkMirrorsActor}
                onToggleClerkMirror={(v) =>
                  updateDraft({ clerkMirrorsActor: v }, { immediate: true })
                }
                clerkRunOnCpu={draft.clerkRunOnCpu}
                onToggleClerkRunOnCpu={(v) =>
                  updateDraft({ clerkRunOnCpu: v }, { immediate: true })
                }
                clerkOverridden={isClerkOverridden}
                onResetClerk={handleResetClerk}
                vectorMode={
                  modelSettings.default_embedding_profile?.mode || "local_hash"
                }
                vectorSelection={{
                  providerId:
                    modelSettings.default_embedding_profile?.provider_id ?? null,
                  model:
                    modelSettings.default_embedding_profile?.model ||
                    "nomic-embed-text",
                }}
                workingMemoryTurns={modelSettings.effective_working_memory_turns}
                episodicChunkSize={6}
                maxSceneFlags={modelSettings.effective_max_scene_flags ?? 10}
                onInvalidChange={setModelsDeckInvalid}
              />
            </div>
          )}
        </div>
      )}

      {/* Prompts & Presets Sub-tab */}
      {!modelLoading && activePrefTab === "prompts" && (
        <PromptPresetsManager
          activePresetId={draft.activePromptPresetId}
          onActivePresetChanged={async (presetId) => {
            setDraft((prev) => ({ ...prev, activePromptPresetId: presetId }));
            await api.setActivePromptPreset(presetId);
            setModelSettings((prev) =>
              prev
                ? {
                    ...prev,
                    active_prompt_preset_id: presetId,
                    has_override: true,
                  }
                : prev
            );
          }}
        />
      )}

      {/* Behavior Sub-tab */}
      {!modelLoading && activePrefTab === "behavior" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {modelSettings && !modelSettings.allow_user_model_overrides && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                color: "var(--accent-amber)",
                fontSize: "0.82rem",
              }}
            >
              <Lock size={16} style={{ flexShrink: 0 }} />
              <span>
                <strong>Preferences Overrides Disabled:</strong> The system
                administrator has configured global defaults. Custom preferences
                are currently locked.
              </span>
            </div>
          )}

          <ProfileBehaviorCards
            values={behaviorValues}
            defaults={behaviorDefaults}
            isLocked={isLocked}
            clerkMirrorsActor={draft.clerkMirrorsActor}
            onChangeField={(key, val, opts) =>
              updateDraft({ [key]: val } as Partial<ProfileModelDraft>, opts)
            }
            onFieldBlurSettled={flushPendingSave}
            onBehaviorInvalidChange={setBehaviorInvalid}
          />
        </div>
      )}
    </div>
  );
};
