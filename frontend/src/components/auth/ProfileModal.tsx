import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  FileText,
  Fingerprint,
  KeyRound,
  Lock,
  RefreshCw,
  Server,
  Sliders,
  Trash2,
  User,
  X,
} from "lucide-react";
import { api } from "../../api";
import { PromptPresetsManager } from "../PromptPresetsManager";
import {
  AuthStatusResponse,
  DisclosureDetectionMode,
  PasskeyInfo,
  ProfileModelSettingsResponse,
  UserModelSettingsPayload,
  UserProfile,
} from "../../types";
import { FeedbackModal } from "./FeedbackModal";
import { ModelDeck } from "../models/ModelDeck";
import {
  DEFAULT_ACTOR_CONTEXT_SIZE,
  DEFAULT_CLERK_CONTEXT_SIZE,
} from "../models/modelLimits";
import { ProvidersManager } from "../providers/ProvidersManager";
import { ProvidersProvider, useProviders } from "../providers/ProvidersContext";

export interface ProfileModalProps {
  user: UserProfile;
  singleUserMode: boolean;
  initialTab?: "identity" | "account" | "preferences" | "models" | "prompts" | "behavior";
  initialSubTab?: "behavior" | "prompts" | "models" | "providers";
  onClose: () => void;
  onUserUpdated: (updated: UserProfile, singleUserMode?: boolean) => void;
  onAccountReset: () => Promise<void>;
  onAccountDeleted: () => Promise<void>;
}

const ProfileModalInner: React.FC<ProfileModalProps> = ({
  user,
  singleUserMode,
  initialTab,
  initialSubTab,
  onClose,
  onUserUpdated,
  onAccountReset,
  onAccountDeleted,
}) => {
  const getInitialTab = (): "identity" | "account" | "preferences" => {
    if (initialTab === "account") return "account";
    if (
      initialTab === "preferences" ||
      initialTab === "models" ||
      initialTab === "prompts" ||
      initialTab === "behavior"
    ) {
      return "preferences";
    }
    return "identity";
  };

  const getInitialPrefTab = (): "behavior" | "prompts" | "models" | "providers" => {
    if (initialSubTab === "providers") return "providers";
    if (initialTab === "models" || initialSubTab === "models") return "models";
    if (initialTab === "prompts" || initialSubTab === "prompts") return "prompts";
    return "behavior";
  };

  const [activeTab, setActiveTab] = useState<"identity" | "account" | "preferences">(getInitialTab);
  const [activePrefTab, setActivePrefTab] = useState<"behavior" | "prompts" | "models" | "providers">(getInitialPrefTab);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [savingName, setSavingName] = useState(false);

  // Per-User Model & Behavior Overrides state
  const [modelSettings, setModelSettings] =
    useState<ProfileModelSettingsResponse | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const providerStore = useProviders();
  const [modelsDeckInvalid, setModelsDeckInvalid] = useState(0);
  const [userActorProviderId, setUserActorProviderId] = useState<string | null>(null);
  const [userClerkProviderId, setUserClerkProviderId] = useState<string | null>(null);
  const [userClerkMirrors, setUserClerkMirrors] = useState(false);

  const [userActorModel, setUserActorModel] = useState("");
  const [userActorTemp, setUserActorTemp] = useState(0.75);
  const [userActorTokens, setUserActorTokens] = useState(1024);
  const [userActorKeepAlive, setUserActorKeepAlive] = useState(30);
  const [userActorContextSize, setUserActorContextSize] = useState(DEFAULT_ACTOR_CONTEXT_SIZE);

  const [userClerkModel, setUserClerkModel] = useState("");
  const [userClerkTemp, setUserClerkTemp] = useState(0.2);
  const [userClerkTokens, setUserClerkTokens] = useState(768);
  const [userClerkKeepAlive, setUserClerkKeepAlive] = useState(30);
  const [userClerkContextSize, setUserClerkContextSize] = useState(DEFAULT_CLERK_CONTEXT_SIZE);
  const [userClerkRunOnCpu, setUserClerkRunOnCpu] = useState(false);
  const [userDelegateCognition, setUserDelegateCognition] = useState<boolean>(false);

  const [userWmTurns, setUserWmTurns] = useState<number>(10);
  const [userMaxSceneFlags, setUserMaxSceneFlags] = useState<number>(10);
  const [userMinWmTurns, setUserMinWmTurns] = useState<number>(4);
  const [userLodSummaryChunks, setUserLodSummaryChunks] = useState<number>(6);
  const [userLodImportanceBonus, setUserLodImportanceBonus] = useState<number>(2);
  const [userZone2BudgetSharePct, setUserZone2BudgetSharePct] = useState<number>(45);
  const [userRecallBudgetProseTokens, setUserRecallBudgetProseTokens] = useState<number>(450);
  const [userRecallBudgetCognitionTokens, setUserRecallBudgetCognitionTokens] = useState<number>(220);
  const [userAgentDispatchMode, setUserAgentDispatchMode] = useState<"sequential" | "parallel">("sequential");
  const [userPersonaDisclosureMode, setUserPersonaDisclosureMode] = useState<DisclosureDetectionMode>("llm_intent");
  const [userActivePresetId, setUserActivePresetId] = useState<string | null>(null);

  // Password change state
  const [currentPasswordForPwd, setCurrentPasswordForPwd] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showBlankPwdConfirm, setShowBlankPwdConfirm] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  // Passkey add / renew / delete state
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [currentPasswordForPasskey, setCurrentPasswordForPasskey] =
    useState("");
  const [renewTarget, setRenewTarget] = useState<PasskeyInfo | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  // Danger Zone: Reset Account Data & Delete Account
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmPwd, setResetConfirmPwd] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmPwd, setDeleteConfirmPwd] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user.display_name);
  }, [user.display_name]);

  const loadProfileModels = async () => {
    setModelLoading(true);
    try {
      const data = await api.getProfileModels();
      setModelSettings(data);
      const activeActor = data.user_actor_profile ?? data.default_actor_profile;
      const activeClerk = data.user_clerk_profile ?? data.default_clerk_profile;

      setUserActorProviderId(activeActor.provider_id ?? null);
      setUserClerkProviderId(activeClerk.provider_id ?? null);
      setUserClerkMirrors(
        data.user_clerk_mirrors_actor ?? data.default_clerk_mirrors_actor ?? false
      );
      setUserActorModel(activeActor.model);
      setUserActorTemp(activeActor.temperature);
      setUserActorTokens(activeActor.max_tokens);
      setUserActorKeepAlive(activeActor.keep_alive_minutes ?? 30);
      setUserActorContextSize(
        activeActor.context_size ??
          data.default_actor_profile.context_size ??
          DEFAULT_ACTOR_CONTEXT_SIZE
      );

      setUserClerkModel(activeClerk.model);
      setUserClerkTemp(activeClerk.temperature);
      setUserClerkTokens(activeClerk.max_tokens);
      setUserClerkKeepAlive(activeClerk.keep_alive_minutes ?? 30);
      setUserClerkContextSize(
        activeClerk.context_size ??
          data.default_clerk_profile.context_size ??
          DEFAULT_CLERK_CONTEXT_SIZE
      );
      setUserClerkRunOnCpu(activeClerk.run_on_cpu ?? false);

      setUserWmTurns(
        data.user_working_memory_turns ?? data.default_working_memory_turns
      );
      setUserMaxSceneFlags(
        data.user_max_scene_flags ?? data.default_max_scene_flags ?? 10
      );
      setUserMinWmTurns(
        data.user_min_working_memory_turns ?? data.default_min_working_memory_turns ?? 4
      );
      setUserLodSummaryChunks(
        data.user_lod_summary_chunks ?? data.default_lod_summary_chunks ?? 6
      );
      setUserLodImportanceBonus(
        data.user_lod_importance_bonus ?? data.default_lod_importance_bonus ?? 2
      );
      setUserZone2BudgetSharePct(
        data.user_zone2_budget_share_pct ?? data.default_zone2_budget_share_pct ?? 45
      );
      setUserRecallBudgetProseTokens(
        data.user_recall_budget_prose_tokens ?? data.default_recall_budget_prose_tokens ?? 450
      );
      setUserRecallBudgetCognitionTokens(
        data.user_recall_budget_cognition_tokens ?? data.default_recall_budget_cognition_tokens ?? 220
      );

      const activeDelegate =
        data.user_delegate_cognition_to_clerk ??
        data.default_delegate_cognition_to_clerk;
      setUserDelegateCognition(activeDelegate);
      setUserAgentDispatchMode(
        data.user_agent_dispatch_mode ??
          data.default_agent_dispatch_mode ??
          "sequential"
      );
      setUserPersonaDisclosureMode(
        data.user_persona_disclosure_mode ??
          data.default_persona_disclosure_mode ??
          "llm_intent"
      );
      setUserActivePresetId(data.active_prompt_preset_id ?? null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load preferences.");
    } finally {
      setModelLoading(false);
    }
  };

  useEffect(() => {
    loadProfileModels();
  }, []);

  const handleSaveModelOverrides = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelSettings?.allow_user_model_overrides) return;
    setModelSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload: UserModelSettingsPayload = {
        actor_profile: {
          ...modelSettings.effective_actor_profile,
          provider_id: userActorProviderId,
          model: userActorModel,
          temperature: userActorTemp,
          max_tokens: userActorTokens,
          keep_alive_minutes: userActorKeepAlive,
          context_size: userActorContextSize,
        },
        clerk_profile: {
          ...modelSettings.effective_clerk_profile,
          provider_id: userClerkProviderId,
          model: userClerkModel,
          temperature: userClerkTemp,
          max_tokens: userClerkTokens,
          run_on_cpu: userClerkRunOnCpu,
          keep_alive_minutes: userClerkKeepAlive,
          context_size: userClerkContextSize,
        },
        working_memory_turns: userWmTurns,
        active_prompt_preset_id: userActivePresetId,
        delegate_cognition_to_clerk: userDelegateCognition,
        max_scene_flags: userMaxSceneFlags,
        agent_dispatch_mode: userAgentDispatchMode,
        persona_disclosure_mode: userPersonaDisclosureMode,
        clerk_mirrors_actor: userClerkMirrors,
        min_working_memory_turns: userMinWmTurns,
        lod_summary_chunks: userLodSummaryChunks,
        lod_importance_bonus: userLodImportanceBonus,
        zone2_budget_share_pct: userZone2BudgetSharePct,
        recall_budget_prose_tokens: userRecallBudgetProseTokens,
        recall_budget_cognition_tokens: userRecallBudgetCognitionTokens,
      };
      const res = await api.updateProfileModels(payload);
      setModelSettings(res);
      setStatusMsg("Preferences saved successfully.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save preferences.");
    } finally {
      setModelSaving(false);
    }
  };

  const handleResetActor = () => {
    if (!modelSettings) return;
    setUserActorProviderId(modelSettings.default_actor_profile.provider_id ?? null);
    setUserActorModel(modelSettings.default_actor_profile.model);
    setUserActorTemp(modelSettings.default_actor_profile.temperature);
    setUserActorTokens(modelSettings.default_actor_profile.max_tokens);
    setUserActorKeepAlive(modelSettings.default_actor_profile.keep_alive_minutes ?? 30);
    setUserActorContextSize(modelSettings.default_actor_profile.context_size ?? DEFAULT_ACTOR_CONTEXT_SIZE);
  };

  const handleResetClerk = () => {
    if (!modelSettings) return;
    setUserClerkProviderId(modelSettings.default_clerk_profile.provider_id ?? null);
    setUserClerkModel(modelSettings.default_clerk_profile.model);
    setUserClerkTemp(modelSettings.default_clerk_profile.temperature);
    setUserClerkTokens(modelSettings.default_clerk_profile.max_tokens);
    setUserClerkKeepAlive(modelSettings.default_clerk_profile.keep_alive_minutes ?? 30);
    setUserClerkContextSize(modelSettings.default_clerk_profile.context_size ?? DEFAULT_CLERK_CONTEXT_SIZE);
    setUserClerkMirrors(modelSettings.default_clerk_mirrors_actor ?? false);
    setUserClerkRunOnCpu(modelSettings.default_clerk_profile.run_on_cpu ?? false);
  };

  const isActorOverridden =
    !!modelSettings?.user_actor_profile ||
    userActorModel !== modelSettings?.default_actor_profile.model ||
    (userActorProviderId ?? null) !== (modelSettings?.default_actor_profile.provider_id ?? null) ||
    userActorTemp !== modelSettings?.default_actor_profile.temperature ||
    userActorTokens !== modelSettings?.default_actor_profile.max_tokens ||
    userActorContextSize !== (modelSettings?.default_actor_profile.context_size ?? DEFAULT_ACTOR_CONTEXT_SIZE);

  const isClerkOverridden =
    !!modelSettings?.user_clerk_profile ||
    userClerkModel !== modelSettings?.default_clerk_profile.model ||
    (userClerkProviderId ?? null) !== (modelSettings?.default_clerk_profile.provider_id ?? null) ||
    userClerkTemp !== modelSettings?.default_clerk_profile.temperature ||
    userClerkTokens !== modelSettings?.default_clerk_profile.max_tokens ||
    userClerkContextSize !== (modelSettings?.default_clerk_profile.context_size ?? DEFAULT_CLERK_CONTEXT_SIZE) ||
    userClerkMirrors !== (modelSettings?.default_clerk_mirrors_actor ?? false);

  const handleResetModelOverrides = async () => {
    setModelSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.resetProfileModels();
      setModelSettings(res);
      setUserActorProviderId(res.default_actor_profile.provider_id ?? null);
      setUserClerkProviderId(res.default_clerk_profile.provider_id ?? null);
      setUserClerkMirrors(res.default_clerk_mirrors_actor ?? false);
      setUserActorModel(res.default_actor_profile.model);
      setUserActorTemp(res.default_actor_profile.temperature);
      setUserActorTokens(res.default_actor_profile.max_tokens);
      setUserActorKeepAlive(res.default_actor_profile.keep_alive_minutes ?? 30);
      setUserActorContextSize(res.default_actor_profile.context_size ?? DEFAULT_ACTOR_CONTEXT_SIZE);
      setUserClerkModel(res.default_clerk_profile.model);
      setUserClerkTemp(res.default_clerk_profile.temperature);
      setUserClerkTokens(res.default_clerk_profile.max_tokens);
      setUserClerkKeepAlive(res.default_clerk_profile.keep_alive_minutes ?? 30);
      setUserClerkContextSize(res.default_clerk_profile.context_size ?? DEFAULT_CLERK_CONTEXT_SIZE);
      setUserClerkRunOnCpu(res.default_clerk_profile.run_on_cpu ?? false);
      setUserWmTurns(res.default_working_memory_turns);
      setUserDelegateCognition(res.default_delegate_cognition_to_clerk);
      setUserMaxSceneFlags(res.default_max_scene_flags ?? 10);
      setUserMinWmTurns(res.default_min_working_memory_turns ?? 4);
      setUserLodSummaryChunks(res.default_lod_summary_chunks ?? 6);
      setUserLodImportanceBonus(res.default_lod_importance_bonus ?? 2);
      setUserZone2BudgetSharePct(res.default_zone2_budget_share_pct ?? 45);
      setUserRecallBudgetProseTokens(res.default_recall_budget_prose_tokens ?? 450);
      setUserRecallBudgetCognitionTokens(res.default_recall_budget_cognition_tokens ?? 220);
      setUserAgentDispatchMode(res.default_agent_dispatch_mode ?? "sequential");
      setUserPersonaDisclosureMode(res.default_persona_disclosure_mode ?? "llm_intent");
      setStatusMsg("Reverted to system default preferences.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to reset preferences.");
    } finally {
      setModelSaving(false);
    }
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!displayName.trim()) {
      setErrorMsg("Display name cannot be empty.");
      return;
    }
    setSavingName(true);
    try {
      const updated = await api.updateProfile({
        display_name: displayName.trim(),
      });
      onUserUpdated(updated);
      setStatusMsg("Profile display name updated.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to update display name.");
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (
    e: React.FormEvent,
    confirmBlank: boolean = false
  ) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (user.has_password && !currentPasswordForPwd) {
      setErrorMsg("Please confirm your current password before making changes.");
      return;
    }

    if (newPassword && newPassword !== confirmNewPassword) {
      setErrorMsg("New passwords do not match.");
      return;
    }

    if (!newPassword) {
      if (user.role !== "admin") {
        setErrorMsg("Standard user accounts cannot have a blank password.");
        return;
      }
      if (!confirmBlank) {
        setShowBlankPwdConfirm(true);
        return;
      }
    }

    setSavingPwd(true);
    try {
      const res: AuthStatusResponse = await api.changePassword({
        current_password: currentPasswordForPwd,
        new_password: newPassword,
        confirm_blank_password: confirmBlank,
      });
      setCurrentPasswordForPwd("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowBlankPwdConfirm(false);
      if (res.user) {
        onUserUpdated(res.user, res.single_user_mode);
      }
      setStatusMsg(
        newPassword
          ? "Password updated. Multi-user support is active."
          : "Password cleared. Switched to single-user local mode."
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to change password.");
    } finally {
      setSavingPwd(false);
    }
  };

  const handleAddOrRenewPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (!user.has_password) {
      setErrorMsg("Set a password on your account before adding passkeys.");
      return;
    }

    if (!currentPasswordForPasskey) {
      setErrorMsg(
        "Please confirm your current password before adding or renewing a passkey."
      );
      return;
    }

    const label =
      passkeyLabel.trim() ||
      (renewTarget ? renewTarget.friendly_name : `Passkey #${user.passkeys.length + 1}`);

    setPasskeyBusy(true);
    try {
      const updated = await api.registerPasskey({
        current_password: currentPasswordForPasskey,
        friendly_name: label,
        replace_credential_id: renewTarget ? renewTarget.id : null,
      });
      onUserUpdated(updated);
      setStatusMsg(
        renewTarget
          ? `Passkey "${label}" renewed.`
          : `Passkey "${label}" registered.`
      );
      setPasskeyLabel("");
      setCurrentPasswordForPasskey("");
      setRenewTarget(null);
    } catch (err: any) {
      setErrorMsg(err?.message || "Passkey registration failed.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleConfirmDeletePasskey = async (credentialId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    if (!currentPasswordForPasskey) {
      setErrorMsg(
        "Enter your current password in the Passkey confirmation field to remove a passkey."
      );
      return;
    }
    setPasskeyBusy(true);
    try {
      const updated = await api.deletePasskey(
        credentialId,
        currentPasswordForPasskey
      );
      onUserUpdated(updated);
      setDeleteTargetId(null);
      setCurrentPasswordForPasskey("");
      setStatusMsg("Passkey removed.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to remove passkey.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleConfirmResetData = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (user.has_password && !resetConfirmPwd) {
      setFeedback({
        type: "error",
        title: "Password Required",
        message:
          "Please enter your current password to confirm account data reset.",
        onConfirm: () => setFeedback(null),
      });
      return;
    }
    setResetBusy(true);
    try {
      await api.resetProfileData({ current_password: resetConfirmPwd });
      setFeedback({
        type: "success",
        title: "Account Data Reset",
        message:
          "All your characters, worlds, and campaigns have been successfully deleted.",
        onConfirm: async () => {
          setFeedback(null);
          setResetConfirmPwd("");
          setShowResetConfirm(false);
          await onAccountReset();
        },
      });
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Account Reset Error",
        message:
          err?.message ||
          "Failed to reset account data. Please check your password and try again.",
        onConfirm: () => {
          setFeedback(null);
          setResetConfirmPwd("");
        },
      });
    } finally {
      setResetBusy(false);
    }
  };

  const handleConfirmDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (user.has_password && !deleteConfirmPwd) {
      setFeedback({
        type: "error",
        title: "Password Required",
        message:
          "Please enter your current password to confirm account deletion.",
        onConfirm: () => setFeedback(null),
      });
      return;
    }
    setDeleteBusy(true);
    try {
      await api.deleteProfileAccount({ current_password: deleteConfirmPwd });
      setFeedback({
        type: "success",
        title: "Account Deleted",
        message:
          "Your account and all associated characters, worlds, and campaigns have been permanently deleted.",
        onConfirm: async () => {
          setFeedback(null);
          setDeleteConfirmPwd("");
          setShowDeleteConfirm(false);
          onClose();
          await onAccountDeleted();
        },
      });
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "Account Deletion Error",
        message:
          err?.message ||
          "Failed to delete account. Please check your password and try again.",
        onConfirm: () => {
          setFeedback(null);
          setDeleteConfirmPwd("");
        },
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const isWideTab =
    (activeTab === "preferences" && (activePrefTab === "models" || activePrefTab === "prompts")) ||
    (activeTab as string) === "models";

  return (
    <div className="modal-backdrop">
      <div
        className="modal-panel"
        style={{
          maxWidth: isWideTab ? 880 : 660,
          width: isWideTab ? "min(880px, 95vw)" : undefined,
          transition: "max-width 0.2s ease",
        }}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <User size={18} color="var(--accent-amber)" />
            User Profile &amp; Preferences
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Profile Modal Tabs */}
        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "identity" ? "active" : ""
            }`}
            onClick={() => setActiveTab("identity")}
          >
            <User size={14} />
            Identity
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "account" ? "active" : ""
            }`}
            onClick={() => setActiveTab("account")}
          >
            <Lock size={14} />
            Account
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "preferences" ? "active" : ""
            }`}
            onClick={() => setActiveTab("preferences")}
          >
            <Sliders size={14} />
            Preferences
            {modelSettings && !modelSettings.allow_user_model_overrides && (
              <span className="modal-tab-badge">Locked</span>
            )}
          </button>
        </div>

        <div className="modal-body" style={{ gap: 18 }}>
          {statusMsg && (
            <div className="auth-alert auth-alert-success">
              <Check size={15} />
              <span>{statusMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="auth-alert auth-alert-error">
              <AlertTriangle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Identity & Display Name */}
          {activeTab === "identity" && (
            <form
            onSubmit={handleSaveName}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: "0.86rem" }}>
                Account Identity
              </span>
              <span
                className="role-pill"
                style={{
                  borderColor:
                    user.role === "admin"
                      ? "var(--accent-amber)"
                      : "var(--accent-cyan)",
                  color:
                    user.role === "admin"
                      ? "var(--accent-amber)"
                      : "var(--accent-cyan)",
                }}
              >
                {user.role.toUpperCase()}
              </span>
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Username (Read-Only)</label>
                <input
                  type="text"
                  className="form-input"
                  value={user.username}
                  readOnly
                  disabled
                  style={{ opacity: 0.75, cursor: "not-allowed" }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Display Name</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    className="form-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name..."
                  />
                  <button
                    type="submit"
                    className="btn btn-amber"
                    disabled={savingName}
                  >
                    {savingName ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </form>
          )}

          {/* 2. Password Management & Account Credentials */}
          {activeTab === "account" && (
            <>
              <form
                onSubmit={(e) => handleChangePassword(e, false)}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 600,
                  fontSize: "0.86rem",
                }}
              >
                <KeyRound size={15} color="var(--accent-amber)" />
                {user.has_password ? "Change Password" : "Set Account Password"}
              </span>
              {singleUserMode && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--accent-amber)",
                  }}
                >
                  Single-User Mode Active (Passwordless)
                </span>
              )}
            </div>

            {user.has_password && (
              <div className="form-group">
                <label className="form-label">
                  Confirm Current Password (Required)
                </label>
                <input
                  type="password"
                  className="form-input"
                  value={currentPasswordForPwd}
                  onChange={(e) => setCurrentPasswordForPwd(e.target.value)}
                  placeholder="Enter your current password to confirm..."
                />
              </div>
            )}

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (e.target.value) setShowBlankPwdConfirm(false);
                  }}
                  placeholder={
                    user.role === "admin"
                      ? "New password (or blank if sole user)"
                      : "Enter new password..."
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Repeat new password..."
                />
              </div>
            </div>

            {showBlankPwdConfirm && !newPassword && (
              <div className="auth-warning-box">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 700,
                    color: "var(--accent-amber)",
                    marginBottom: 4,
                  }}
                >
                  <AlertTriangle size={15} />
                  <span>Confirm Blank Admin Password?</span>
                </div>
                <p
                  style={{
                    fontSize: "0.76rem",
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                  }}
                >
                  Leaving the admin password blank will disable multi-user
                  support and enable automatic login. This is only allowed when
                  no other users exist in the system.
                </p>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowBlankPwdConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-amber"
                    onClick={(e) => handleChangePassword(e, true)}
                    disabled={savingPwd}
                  >
                    Confirm Blank Password
                  </button>
                </div>
              </div>
            )}

            {!showBlankPwdConfirm && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  className="btn btn-amber"
                  disabled={savingPwd}
                >
                  {savingPwd
                    ? "Updating..."
                    : user.has_password
                    ? "Update Password"
                    : "Set Password & Enable Multi-User"}
                </button>
              </div>
            )}
          </form>

          {/* 3. Passkeys Management (Multiple Passkeys Supported) */}
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 600,
                  fontSize: "0.86rem",
                }}
              >
                <Fingerprint size={16} color="var(--accent-cyan)" />
                Passkeys ({user.passkeys.length})
              </span>
              <span
                style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}
              >
                WebAuthn / FIDO2 Hardware &amp; Platform Keys
              </span>
            </div>

            {!user.has_password ? (
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  padding: "6px 0",
                }}
              >
                Set an account password above first to register or renew
                passkeys.
              </div>
            ) : (
              <>
                {user.passkeys.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {user.passkeys.map((pk) => {
                      const isRenewing = renewTarget?.id === pk.id;
                      const isDeleting = deleteTargetId === pk.id;
                      return (
                        <div
                          key={pk.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 10px",
                            borderRadius: 6,
                            background: "var(--bg-deep)",
                            border: `1px solid ${
                              isRenewing
                                ? "var(--accent-cyan)"
                                : "var(--border-subtle)"
                            }`,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: "0.82rem",
                                color: "var(--text-primary)",
                              }}
                            >
                              {pk.friendly_name}
                            </div>
                            <div
                              style={{
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              Added {pk.created_at.slice(0, 10)} • Last used{" "}
                              {pk.last_used_at.slice(0, 10)}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: "4px 8px",
                                fontSize: "0.72rem",
                                borderColor: isRenewing
                                  ? "var(--accent-cyan)"
                                  : undefined,
                              }}
                              onClick={() => {
                                setDeleteTargetId(null);
                                if (isRenewing) {
                                  setRenewTarget(null);
                                  setPasskeyLabel("");
                                } else {
                                  setRenewTarget(pk);
                                  setPasskeyLabel(pk.friendly_name);
                                }
                              }}
                              disabled={passkeyBusy}
                              title="Renew this passkey with a fresh WebAuthn credential"
                            >
                              <RefreshCw size={12} />
                              <span>{isRenewing ? "Cancel Renew" : "Renew"}</span>
                            </button>

                            {isDeleting ? (
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "0.72rem",
                                  borderColor: "var(--accent-rose)",
                                  color: "var(--accent-rose)",
                                }}
                                onClick={() => handleConfirmDeletePasskey(pk.id)}
                                disabled={passkeyBusy}
                              >
                                Confirm Remove
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "0.72rem",
                                }}
                                onClick={() => {
                                  setRenewTarget(null);
                                  setDeleteTargetId(pk.id);
                                }}
                                disabled={passkeyBusy}
                                title="Remove passkey"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      padding: "4px 0",
                    }}
                  >
                    No passkeys registered yet. Add one below for passwordless
                    one-tap sign-in.
                  </div>
                )}

                <form
                  onSubmit={handleAddOrRenewPasskey}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 4,
                    paddingTop: 10,
                    borderTop: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      color: renewTarget
                        ? "var(--accent-cyan)"
                        : "var(--text-secondary)",
                    }}
                  >
                    {renewTarget
                      ? `Renewing Passkey: "${renewTarget.friendly_name}"`
                      : "Add New Passkey"}
                  </div>

                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Passkey Name / Label</label>
                      <input
                        type="text"
                        className="form-input"
                        value={passkeyLabel}
                        onChange={(e) => setPasskeyLabel(e.target.value)}
                        placeholder="e.g. MacBook Touch ID, YubiKey"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Confirm Password (Required)
                      </label>
                      <input
                        type="password"
                        className="form-input"
                        value={currentPasswordForPasskey}
                        onChange={(e) =>
                          setCurrentPasswordForPasskey(e.target.value)
                        }
                        placeholder="Current password..."
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    {renewTarget && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setRenewTarget(null);
                          setPasskeyLabel("");
                        }}
                      >
                        Cancel Renewal
                      </button>
                    )}
                    <button
                      type="submit"
                      className="btn btn-cyan"
                      disabled={passkeyBusy}
                    >
                      <Fingerprint size={14} />
                      <span>
                        {passkeyBusy
                          ? "Waiting for Authenticator..."
                          : renewTarget
                          ? "Confirm & Renew Passkey"
                          : "Add Passkey"}
                      </span>
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* 4. Danger Zone: Reset Data & Delete Account */}
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid rgba(244, 63, 94, 0.35)",
              borderRadius: 8,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 600,
                  fontSize: "0.86rem",
                  color: "#fda4af",
                }}
              >
                <AlertTriangle size={16} />
                Danger Zone: Account Reset &amp; Deletion
              </span>
            </div>

            {/* Sub-item A: Reset Account Data */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 12px",
                background: "var(--bg-deep)",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                    Reset Account Data
                  </div>
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    Permanently delete all your characters, worlds, and campaigns.
                    Your login credentials and passkeys will remain active.
                  </div>
                </div>
                {!showResetConfirm && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{
                      padding: "5px 10px",
                      fontSize: "0.74rem",
                      whiteSpace: "nowrap",
                    }}
                    onClick={() => {
                      setShowResetConfirm(true);
                      setShowDeleteConfirm(false);
                      setResetConfirmPwd("");
                    }}
                  >
                    Reset Data
                  </button>
                )}
              </div>

              {showResetConfirm && (
                <form
                  onSubmit={handleConfirmResetData}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginTop: 6,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(244, 63, 94, 0.2)",
                  }}
                >
                  <div style={{ fontSize: "0.75rem", color: "#fda4af" }}>
                    Are you sure? This will immediately purge all your
                    campaigns, worlds, and characters.
                  </div>
                  {user.has_password && (
                    <div className="form-group">
                      <label
                        className="form-label"
                        style={{ fontSize: "0.72rem" }}
                      >
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        className="form-input"
                        value={resetConfirmPwd}
                        onChange={(e) => setResetConfirmPwd(e.target.value)}
                        placeholder="Current password to confirm reset..."
                        required
                      />
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowResetConfirm(false)}
                      disabled={resetBusy}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-danger"
                      disabled={resetBusy}
                    >
                      {resetBusy
                        ? "Resetting..."
                        : "Confirm Reset Account Data"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Sub-item B: Delete Account (Regular Users) */}
            {user.role === "user" ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "10px 12px",
                  background: "var(--bg-deep)",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.82rem",
                        color: "#fda4af",
                      }}
                    >
                      Delete Account
                    </div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-secondary)",
                        marginTop: 2,
                      }}
                    >
                      Permanently delete your user account, login credentials,
                      passkeys, and all created characters, worlds, and
                      campaigns.
                    </div>
                  </div>
                  {!showDeleteConfirm && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{
                        padding: "5px 10px",
                        fontSize: "0.74rem",
                        whiteSpace: "nowrap",
                      }}
                      onClick={() => {
                        setShowDeleteConfirm(true);
                        setShowResetConfirm(false);
                        setDeleteConfirmPwd("");
                      }}
                    >
                      Delete Account
                    </button>
                  )}
                </div>

                {showDeleteConfirm && (
                  <form
                    onSubmit={handleConfirmDeleteAccount}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 6,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(244, 63, 94, 0.2)",
                    }}
                  >
                    <div style={{ fontSize: "0.75rem", color: "#fda4af" }}>
                      This action is irreversible. Your account and all
                      associated data will be permanently destroyed.
                    </div>
                    {user.has_password && (
                      <div className="form-group">
                        <label
                          className="form-label"
                          style={{ fontSize: "0.72rem" }}
                        >
                          Confirm Password
                        </label>
                        <input
                          type="password"
                          className="form-input"
                          value={deleteConfirmPwd}
                          onChange={(e) => setDeleteConfirmPwd(e.target.value)}
                          placeholder="Current password to confirm account deletion..."
                          required
                        />
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setShowDeleteConfirm(false)}
                        disabled={deleteBusy}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-danger"
                        disabled={deleteBusy}
                      >
                        {deleteBusy
                          ? "Deleting..."
                          : "Confirm Delete My Account"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "var(--text-muted)",
                  padding: "4px 2px",
                }}
              >
                Administrator accounts can be managed and deleted from the Admin
                Area (as long as at least 1 admin user remains).
              </div>
            )}
          </div>
            </>
          )}

          {/* 3. Preferences (Behavior, Prompts & Presets, Models) */}
          {activeTab === "preferences" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Secondary Sub-tab Navigation */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  borderBottom: "1px solid var(--border-subtle)",
                  paddingBottom: 10,
                  marginBottom: 2,
                }}
              >
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activePrefTab === "behavior" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActivePrefTab("behavior")}
                >
                  <Activity size={13} />
                  Behavior
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activePrefTab === "prompts" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActivePrefTab("prompts")}
                >
                  <FileText size={13} />
                  Prompts &amp; Presets
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activePrefTab === "models" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActivePrefTab("models")}
                >
                  <Cpu size={13} />
                  Models
                  {modelSettings && !modelSettings.allow_user_model_overrides && (
                    <span className="modal-tab-badge" style={{ marginLeft: 6 }}>
                      Locked
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activePrefTab === "providers" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActivePrefTab("providers")}
                >
                  <Server size={13} />
                  Providers
                  {modelSettings && !modelSettings.allow_user_providers && (
                    <span className="modal-tab-badge" style={{ marginLeft: 6 }}>
                      Locked
                    </span>
                  )}
                </button>
              </div>

              {activePrefTab === "providers" && (
                <ProvidersManager
                  variant="profile"
                  allowUserProviders={!!modelSettings?.allow_user_providers}
                />
              )}

              {modelLoading && (
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

              {/* Behavior Sub-tab */}
              {!modelLoading && activePrefTab === "behavior" && (
                <form
                  onSubmit={handleSaveModelOverrides}
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
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

                  <div className="form-group">
                    <label className="form-label">
                      Max Active Scene Flags (Sliding FIFO Cap)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="form-input"
                      value={userMaxSceneFlags}
                      disabled={!modelSettings?.allow_user_model_overrides}
                      onChange={(e) =>
                        setUserMaxSceneFlags(parseInt(e.target.value, 10) || 10)
                      }
                    />
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      Maximum number of active scene flags kept in world snapshots via sliding FIFO. Drops older flags as new ones are added (System Default: {modelSettings?.default_max_scene_flags ?? 10}).
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Zone 3 Working Memory Turns (N)
                    </label>
                    <input
                      type="number"
                      min={4}
                      max={64}
                      className="form-input"
                      value={userWmTurns}
                      disabled={!modelSettings?.allow_user_model_overrides}
                      onChange={(e) =>
                        setUserWmTurns(parseInt(e.target.value, 10) || 12)
                      }
                    />
                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      Number of verbatim recent turns in active context before
                      episodic compression (System Default:{" "}
                      {modelSettings?.default_working_memory_turns ?? 12}).
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">
                        Zone 3 Min Protected Turns
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        className="form-input"
                        value={userMinWmTurns}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) =>
                          setUserMinWmTurns(parseInt(e.target.value, 10) || 4)
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Minimum verbatim turns protected before Zone 2 LOD trims (Default:{" "}
                        {modelSettings?.default_min_working_memory_turns ?? 4}).
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Zone 2 LOD Summary Chunks
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        className="form-input"
                        value={userLodSummaryChunks}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) =>
                          setUserLodSummaryChunks(parseInt(e.target.value, 10) || 6)
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Newest/salient episodes kept at full paragraph before 1-line synopsis (Default:{" "}
                        {modelSettings?.default_lod_summary_chunks ?? 6}).
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Zone 2 Salience Bonus
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        className="form-input"
                        value={userLodImportanceBonus}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value, 10);
                          setUserLodImportanceBonus(Number.isNaN(parsed) ? 2 : parsed);
                        }}
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Effective-age bonus for high-salience (≥8) episodes (Default:{" "}
                        {modelSettings?.default_lod_importance_bonus ?? 2}).
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Zone 2 History Budget Share (%)
                      </label>
                      <input
                        type="number"
                        min={10}
                        max={80}
                        className="form-input"
                        value={userZone2BudgetSharePct}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) =>
                          setUserZone2BudgetSharePct(parseInt(e.target.value, 10) || 45)
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Max percentage of history token budget for Zone 2 LOD (Default:{" "}
                        {modelSettings?.default_zone2_budget_share_pct ?? 45}%).
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Zone 4 Prose Recall Budget (tokens)
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={2000}
                        className="form-input"
                        value={userRecallBudgetProseTokens}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) =>
                          setUserRecallBudgetProseTokens(parseInt(e.target.value, 10) || 450)
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Token cap for mixed full+short recalled memories in Phase 4 (Default:{" "}
                        {modelSettings?.default_recall_budget_prose_tokens ?? 450}).
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Phase 3 Cognition Recall Budget (tokens)
                      </label>
                      <input
                        type="number"
                        min={60}
                        max={1000}
                        className="form-input"
                        value={userRecallBudgetCognitionTokens}
                        disabled={!modelSettings?.allow_user_model_overrides}
                        onChange={(e) =>
                          setUserRecallBudgetCognitionTokens(parseInt(e.target.value, 10) || 220)
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Token cap for recalled memories in Phase 3 Cognition (Default:{" "}
                        {modelSettings?.default_recall_budget_cognition_tokens ?? 220}).
                      </span>
                    </div>
                  </div>


                  <div
                    style={{
                      padding: "12px 14px",
                      background: "rgba(255, 255, 255, 0.03)",
                      borderRadius: 6,
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                      Character Agent Dispatch Mode{" "}
                      <span style={{ fontWeight: 400, fontSize: "0.74rem", color: "var(--text-secondary)" }}>
                        (System Default: {modelSettings?.default_agent_dispatch_mode ?? "sequential"})
                      </span>
                    </label>
                    <select
                      className="field-select"
                      disabled={!modelSettings?.allow_user_model_overrides}
                      value={userAgentDispatchMode}
                      onChange={(e) =>
                        setUserAgentDispatchMode(e.target.value as "sequential" | "parallel")
                      }
                    >
                      <option value="sequential">
                        Sequential — One-at-a-Time (Single Local GPU / Ollama)
                      </option>
                      <option value="parallel">
                        Parallel — Concurrent Dispatch (Cloud APIs / Multi-Slot vLLM)
                      </option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      marginBottom: 12,
                    }}
                  >
                    <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                      Persona Disclosure Detection Strategy{" "}
                      <span style={{ fontWeight: 400, fontSize: "0.74rem", color: "var(--text-secondary)" }}>
                        (System Default: {modelSettings?.default_persona_disclosure_mode ?? "llm_intent"})
                      </span>
                    </label>
                    <select
                      className="field-select"
                      disabled={!modelSettings?.allow_user_model_overrides}
                      value={userPersonaDisclosureMode}
                      onChange={(e) =>
                        setUserPersonaDisclosureMode(e.target.value as DisclosureDetectionMode)
                      }
                    >
                      <option value="llm_intent">
                        LLM Intent (Semantic Phase 1 Analysis)
                      </option>
                      <option value="token_matching">
                        Token Matching (Fast Deterministic Keywords)
                      </option>
                      <option value="hybrid">
                        Hybrid (Token Matching + Semantic LLM)
                      </option>
                    </select>
                  </div>

                  {modelSettings?.allow_user_model_overrides && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 4,
                      }}
                    >
                      {modelSettings.has_override ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={handleResetModelOverrides}
                          disabled={modelSaving}
                        >
                          Reset to Defaults
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        type="submit"
                        className="btn btn-amber"
                        disabled={modelSaving}
                      >
                        <Check size={14} />
                        <span>
                          {modelSaving ? "Saving..." : "Save Preferences"}
                        </span>
                      </button>
                    </div>
                  )}
                </form>
              )}

              {/* Prompts & Presets Sub-tab */}
              {!modelLoading && activePrefTab === "prompts" && (
                <PromptPresetsManager
                  activePresetId={userActivePresetId}
                  onActivePresetChanged={async (presetId) => {
                    setUserActivePresetId(presetId);
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
                          : w.code === "disabled"
                            ? "the provider is disabled"
                            : w.code === "missing_provider"
                              ? "no provider selected"
                              : "the provider is gone"}
                        ). The system default is used until you choose again.
                      </span>
                    </div>
                  ))}

              {!modelLoading && modelSettings && (
                <form
                  onSubmit={handleSaveModelOverrides}
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
                  {!modelSettings.allow_user_model_overrides ? (
                    <div className="auth-warning-box">
                      <Lock size={16} style={{ flexShrink: 0 }} />
                      <span>
                        <strong>Per-User Model Overrides Disabled:</strong> The
                        system administrator has configured global default
                        models for all roleplay sessions. Custom model overrides
                        are currently locked.
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
                      providerId: userActorProviderId,
                      model: userActorModel,
                    }}
                    onActorSelection={(sel) => {
                      setUserActorProviderId(sel.providerId);
                      setUserActorModel(sel.model);
                    }}
                    actorTemp={userActorTemp}
                    onActorTemp={setUserActorTemp}
                    actorTokens={userActorTokens}
                    onActorTokens={setUserActorTokens}
                    actorKeepAlive={userActorKeepAlive}
                    onActorKeepAlive={setUserActorKeepAlive}
                    actorContextSize={userActorContextSize}
                    onActorContextSize={setUserActorContextSize}
                    actorOverridden={isActorOverridden}
                    onResetActor={handleResetActor}
                    clerkSelection={{
                      providerId: userClerkProviderId,
                      model: userClerkModel,
                    }}
                    onClerkSelection={(sel) => {
                      setUserClerkProviderId(sel.providerId);
                      setUserClerkModel(sel.model);
                      const newProv = sel.providerId ? providerStore.byId(sel.providerId) : null;
                      if (newProv && newProv.type !== "ollama" && newProv.type !== "browser_ollama") {
                        setUserClerkRunOnCpu(false);
                      }
                    }}
                    clerkTemp={userClerkTemp}
                    onClerkTemp={setUserClerkTemp}
                    clerkTokens={userClerkTokens}
                    onClerkTokens={setUserClerkTokens}
                    clerkKeepAlive={userClerkKeepAlive}
                    onClerkKeepAlive={setUserClerkKeepAlive}
                    clerkContextSize={userClerkContextSize}
                    onClerkContextSize={setUserClerkContextSize}
                    clerkMirrorsActor={userClerkMirrors}
                    onToggleClerkMirror={setUserClerkMirrors}
                    clerkRunOnCpu={userClerkRunOnCpu}
                    onToggleClerkRunOnCpu={setUserClerkRunOnCpu}
                    clerkOverridden={isClerkOverridden}
                    onResetClerk={handleResetClerk}
                    vectorMode={modelSettings.default_embedding_profile?.mode || "local_hash"}
                    vectorSelection={{
                      providerId: modelSettings.default_embedding_profile?.provider_id ?? null,
                      model: modelSettings.default_embedding_profile?.model || "nomic-embed-text",
                    }}
                    workingMemoryTurns={modelSettings.effective_working_memory_turns}
                    episodicChunkSize={6}
                    maxSceneFlags={modelSettings.effective_max_scene_flags ?? 10}
                    onInvalidChange={setModelsDeckInvalid}
                  />

                  {modelSettings.allow_user_model_overrides && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 4,
                      }}
                    >
                      {modelSettings.has_override ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={handleResetModelOverrides}
                          disabled={modelSaving}
                        >
                          Reset All to Defaults
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        type="submit"
                        className="btn btn-amber"
                        disabled={
                          modelSaving ||
                          modelsDeckInvalid > 0 ||
                          (providerStore.providers.length > 0 &&
                            (!userActorProviderId ||
                              !userActorModel ||
                              (!userClerkMirrors &&
                                (!userClerkProviderId || !userClerkModel))))
                        }
                      >
                        <Check size={14} />
                        <span>
                          {modelSaving ? "Saving..." : "Save My Model Overrides"}
                        </span>
                      </button>
                    </div>
                  )}
                </form>
              )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {feedback && (
        <FeedbackModal
          type={feedback.type}
          title={feedback.title}
          message={feedback.message}
          onConfirm={feedback.onConfirm}
        />
      )}
    </div>
  );
};

export const ProfileModal: React.FC<ProfileModalProps> = (props) => (
  <ProvidersProvider probeSystem={false}>
    <ProfileModalInner {...props} />
  </ProvidersProvider>
);
